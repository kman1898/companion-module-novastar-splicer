import { InstanceBase, InstanceStatus, Regex, UDPHelper } from '@companion-module/base';

import { ACTIONS_CMD, PRODUCTS_INFORMATION, TEST_PATTERNS } from '../utils/constant.js';
import { UpgradeScripts } from './upgrades.js';

import { EventEmitter } from 'events';
import { HeartbeatManager } from '../utils/heartbeat.js';
import {
  decodeRes,
  formatLayerVariable,
  formatPresetCollectionVariable,
  formatPresetVariable,
  formatScreenVariable,
  formatSourceList,
  formatSourceVariable,
  handleParams,
  sendUDPRequestsSync,
} from '../utils/index.js';
import {
  getInputListSimplify,
  getLayerList,
  getOutputList,
  getPresetCollectionList,
  getPresetList,
  getScreenDetails,
  getScreenList,
} from '../utils/request.js';
import { getActions } from './actions.js';
import { getFeedbacks } from './feedbacks.js';
import { getPresetDefinitions } from './presets.js';

// Fallback config defaults. Companion applies a config field's `default` only
// when a brand-new connection is created; it does NOT backfill defaults onto a
// connection whose stored config predates a field (e.g. after importing this
// module over an existing connection, or on Companion 5.0 where the field
// defaults are not re-applied). Without this, pollInterval shows 0 and the
// offline counts show blank. We merge these UNDER the stored config and, when a
// value was actually missing, persist it so the config UI reflects the default.
const DEFAULT_CONFIG = {
  host: '127.0.0.1',
  port: '6000',
  pollInterval: 1000,
  offlineMode: false,
  screenCount: 1,
  inputCardCount: 1,
  inputSignalPolling: false,
};

/**
 * Merge DEFAULT_CONFIG under `config`, returning the normalized config and
 * whether any default had to be filled in (so the caller can persist it).
 */
function applyConfigDefaults(config) {
  const merged = { ...config };
  let filledMissing = false;
  // Numeric fields where 0 is never a legal value — a stored 0 means the field
  // was never populated (Companion does not backfill defaults onto an existing
  // connection), so treat it as missing. Without this, Poll Interval shows 0 in
  // the config UI even though the runtime falls back to 1000.
  const zeroIsMissing = new Set(['pollInterval', 'screenCount', 'inputCardCount']);
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    const current = merged[key];
    const missing =
      current === undefined || current === null || current === '' || (zeroIsMissing.has(key) && Number(current) === 0);
    if (missing) {
      merged[key] = value;
      filledMissing = true;
    }
  }
  return { config: merged, filledMissing };
}

class ModuleInstance extends InstanceBase {
  constructor(internal) {
    super(internal);
    Object.assign(this, EventEmitter.prototype);
    EventEmitter.call(this);
    /** 屏幕列表 包含图层和场景和屏幕的详细信息 */
    this.screenList = [];
    /**组合场景列表 */
    this.presetCollectionList = [];
    /**输入源列表 */
    this.sourceList = [];
    /** 选中的屏幕列表 */
    this.selectedScreenList = [];
    /** Per-screen brightness hold-to-ramp interval handles (keyed by screenId) */
    this.brightnessRampTimers = {};
    /** 选中的图层 */
    this.selectedLayerInfo = null;
    /** 定时器句柄 */
    this.dataInterval = null;
    /**PGM/PVW/Take 按钮选中状态 */
    this.pgmOrPvwActive = {
      pgmActive: false,
      pvwActive: false,
      takeActive: false,
    };
    /** 选中的组合场景 */
    this.selectedPresetCollectionId = null;
    /**黑屏 */
    this.ftb = false;
    /** 音量静音 */
    this.volumeMute = false;
    /** 屏幕冻结状态 */
    this.screenFRZState = 0;
    /** 图层冻结状态 */
    this.layerFRZState = 0;
    /** 测试画面开关 */
    this.testPattern = false;
    /**选中的输入源id */
    this.inputId = false;
    /** BKG开关状态 */
    this.bkgEnable = false;
    /** 文字OSD开关状态 */
    this.textOsdEnable = false;
    /** 图片OSD开关状态 */
    this.imgOsdEnable = false;
    this.deviceId = 0; // 设备ID，按需设置
    this.initRate = 0; // 设备初始化进度
    this.connectStatus = false; // 设备连接状态
    this.initStatusTimer = null; // 初始化状态查询定时器
    this.heartbeatManager = new HeartbeatManager({
      sendHeartbeat: () => this.sendHeartbeat(),
      onTimeout: () => this.handleHeartbeatTimeout(),
      onRecover: () => this.handleHeartbeatRecover(),
      timeout: 3000,
      maxRetry: 3,
    });
    /** 加载的场景信息 */
    this.selectedPresetInfo = null;
    /**
     * Per-screen state for direct actions/feedbacks.
     * Mirrors device truth (populated from R0401 apply_screen_details) and
     * accepts optimistic updates from action callbacks for instant feedback.
     */
    this.enhancedState = { screens: {} };
    /**
     * Per-connector input signal state. Keyed by `input_${slotId+1}_${interfaceId+1}`
     * (1-based labels in the UI, 0-based on the wire). Populated from R0102
     * (Get Slot Information) responses when input signal polling is enabled.
     */
    this.inputSignalState = {};
    /**
     * Physical output connectors, keyed by outputId, harvested from R0401
     * screen details. W0303 test patterns are addressed per connector.
     */
    this.outputConnectors = {};
    /** Last test pattern we set per outputId (optimistic; W0303 is write-only) */
    this.connectorTestPatterns = {};
  }

  /**
   * Apply a single relative brightness step to a screen and push it to the
   * device. Shared by the direct +/- actions and the hold-to-ramp timer.
   * Returns the new brightness (0-100), or undefined if the screen is unknown.
   */
  stepBrightness(screenId, delta) {
    // Dropdown ids are numbers, but an imported/legacy button config can carry
    // the id as a string; a strict === lookup would then silently match nothing.
    const id = Number(screenId);
    const details = this.screenList?.find((s) => s.screenId === id)?.details;
    if (!details) return undefined;
    const brightness = Math.max(0, Math.min(100, (details.brightness ?? 100) + delta));
    details.brightness = brightness;
    this.updateEnhancedFromAction(id, 'brightness', brightness);
    this.safeSend(handleParams(ACTIONS_CMD.apply_screen_brightness, { screenId: id, brightness }));
    return brightness;
  }

  /**
   * Start a hold-to-ramp on a screen's brightness. `ms` is the per-button step
   * cadence (comes from the ramp action's ms option). Fires one step
   * immediately (so a quick tap still nets a single step) then keeps stepping
   * every `ms` until stopBrightnessRamp (button release), a 0/100 boundary, or
   * a failsafe max duration (in case a release event is ever missed). delta is
   * +1 or -1.
   */
  startBrightnessRamp(screenId, delta, ms) {
    const id = Number(screenId);
    this.stopBrightnessRamp(id);
    // Note the explicit isFinite check: `Number(0) || 200` would be 200, since
    // 0 is falsy, and 0 is exactly how the operator asks for repeat to be off.
    const raw = Number(ms);
    const requested = Number.isFinite(raw) ? raw : 200;

    // Always take one step, so a press always moves 1% whether or not the
    // button repeats.
    const first = this.stepBrightness(id, delta);
    if (first === undefined) return; // unknown screen, nothing to ramp

    // Repeat off: single 1% increment per press, no hold behaviour at all.
    if (requested <= 0) return;

    const rampMs = Math.max(20, Math.min(2000, requested));
    const MAX_MS = 30000; // failsafe: never ramp longer than this without a release
    let elapsed = 0;
    this.brightnessRampTimers[id] = setInterval(() => {
      elapsed += rampMs;
      const v = this.stepBrightness(id, delta);
      if (v === undefined || v <= 0 || v >= 100 || elapsed >= MAX_MS) this.stopBrightnessRamp(id);
    }, rampMs);
  }

  /** Stop a screen's brightness ramp (button release). */
  stopBrightnessRamp(screenId) {
    const id = Number(screenId);
    const timer = this.brightnessRampTimers?.[id];
    if (timer) {
      clearInterval(timer);
      delete this.brightnessRampTimers[id];
    }
  }

  /** Clear every active brightness ramp (used on destroy). */
  stopAllBrightnessRamps() {
    for (const key of Object.keys(this.brightnessRampTimers || {})) {
      clearInterval(this.brightnessRampTimers[key]);
    }
    this.brightnessRampTimers = {};
  }

  /** Initialize per-screen enhanced state with defaults */
  initEnhancedScreen(screenId) {
    this.enhancedState.screens[screenId] = {
      brightness: 100,
      frozen: false,
      ftb: false,
      bkg: false,
      bkgId: 0,
      osdText: false,
      osdImage: false,
      testPattern: false,
    };
  }

  /**
   * Update enhanced state from the R0401 apply_screen_details response.
   *
   * The device reports per-screen state in NESTED objects, not flat fields:
   *   { brightness: 45,
   *     Freeze: { enable: 0|1 },
   *     Ftb:    { enable: 0|1 },
   *     Bkg:    { enable: 0|1, bkgId: N },
   *     Osd:    { enable: 0|1 },        // screen text OSD
   *     OsdImage: { enable: 0|1 } }
   * An earlier version read flat names (bkgEnable, screenFrz, blackout,
   * textOsdEnable) that don't exist in the payload, so freeze/ftb/bkg/osd
   * never reconciled from device truth — they only reflected optimistic
   * action presses. This reads the real nested fields.
   */
  updateEnhancedFromDetails(screenId, details) {
    if (!this.enhancedState.screens[screenId]) this.initEnhancedScreen(screenId);
    const s = this.enhancedState.screens[screenId];
    const before = { ...s };
    if (details.brightness !== undefined) s.brightness = details.brightness;
    if (details.Freeze?.enable !== undefined) s.frozen = details.Freeze.enable === 1;
    // FTB uses the INVERTED convention (known Novastar quirk): per protocol
    // W0409 "Set Screen FTB", type 0 = FTB enabled, 1 = FTB disabled — the
    // opposite of Freeze. So Ftb.enable === 0 means FTB is on.
    if (details.Ftb?.enable !== undefined) s.ftb = details.Ftb.enable === 0;
    if (details.Bkg?.enable !== undefined) {
      s.bkg = details.Bkg.enable === 1;
      if (details.Bkg.bkgId !== undefined) s.bkgId = details.Bkg.bkgId;
    }
    if (details.Osd?.enable !== undefined) s.osdText = details.Osd.enable === 1;
    if (details.OsdImage?.enable !== undefined) s.osdImage = details.OsdImage.enable === 1;

    // Redraw any direct feedback whose underlying state changed on this poll.
    // Without this the boolean direct
    // feedbacks) only redraw on optimistic action updates, not when the
    // device reports a change made elsewhere (e.g. from the front panel).
    const changed = [];
    if (before.brightness !== s.brightness) changed.push('brightness_match');
    if (before.frozen !== s.frozen) changed.push('frozen_direct');
    if (before.ftb !== s.ftb) changed.push('ftb_direct');
    if (before.bkg !== s.bkg) changed.push('bkg_direct');
    if (before.osdText !== s.osdText) changed.push('osd_text_direct');
    if (before.osdImage !== s.osdImage) changed.push('osd_image_direct');
    if (before.testPattern !== s.testPattern) changed.push('test_pattern_direct');
    if (changed.length > 0) this.checkFeedbacks(...changed);
  }

  /** Optimistic update from action callback — instant variable + feedback refresh */
  updateEnhancedFromAction(screenId, property, value) {
    if (!this.enhancedState.screens[screenId]) this.initEnhancedScreen(screenId);
    this.enhancedState.screens[screenId][property] = value;
    const prefix = `screen_${screenId + 1}`;
    const varMap = {
      brightness: { key: `${prefix}_brightness`, val: value, feedbacks: ['brightness_match'] },
      frozen: { key: `${prefix}_frozen`, val: value ? 'On' : 'Off', feedbacks: ['frozen_direct'] },
      ftb: { key: `${prefix}_ftb`, val: value ? 'On' : 'Off', feedbacks: ['ftb_direct'] },
      bkg: { key: `${prefix}_bkg`, val: value ? 'On' : 'Off', feedbacks: ['bkg_direct'] },
      osdText: { key: `${prefix}_osd_text`, val: value ? 'On' : 'Off', feedbacks: ['osd_text_direct'] },
      osdImage: { key: `${prefix}_osd_image`, val: value ? 'On' : 'Off', feedbacks: ['osd_image_direct'] },
      // The legacy action only knows on/off, but the name variable exists now and
      // would otherwise keep reporting a stale pattern after a legacy toggle.
      testPattern: {
        key: `${prefix}_test_pattern`,
        val: value ? 'On' : 'Off',
        also: { [`${prefix}_test_pattern_name`]: value ? 'On' : 'Off' },
        feedbacks: ['test_pattern_direct', 'test_pattern_is'],
      },
    };
    if (varMap[property]) {
      this.setVariableValues({ [varMap[property].key]: varMap[property].val, ...(varMap[property].also ?? {}) });
      this.checkFeedbacks(...varMap[property].feedbacks);
    }
  }

  /** Build per-screen enhanced variable defs + values */
  getEnhancedVariables() {
    const definitions = [];
    const values = {};
    for (const [screenIdStr, state] of Object.entries(this.enhancedState.screens)) {
      const screenId = Number(screenIdStr);
      const screen = this.screenList.find((s) => s.screenId === screenId);
      const screenName = screen ? screen.name : `Screen ${screenId + 1}`;
      const prefix = `screen_${screenId + 1}`;
      definitions.push(
        { variableId: `${prefix}_brightness`, name: `${screenName} Brightness` },
        { variableId: `${prefix}_frozen`, name: `${screenName} Frozen` },
        { variableId: `${prefix}_ftb`, name: `${screenName} FTB` },
        { variableId: `${prefix}_bkg`, name: `${screenName} BKG` },
        { variableId: `${prefix}_bkg_id`, name: `${screenName} BKG ID` },
        { variableId: `${prefix}_osd_text`, name: `${screenName} OSD Text` },
        { variableId: `${prefix}_osd_image`, name: `${screenName} OSD Image` },
        { variableId: `${prefix}_test_pattern`, name: `${screenName} Test Pattern` },
        { variableId: `${prefix}_test_pattern_name`, name: `${screenName} Test Pattern Name` },
      );
      values[`${prefix}_brightness`] = state.brightness;
      values[`${prefix}_frozen`] = state.frozen ? 'On' : 'Off';
      values[`${prefix}_ftb`] = state.ftb ? 'On' : 'Off';
      values[`${prefix}_bkg`] = state.bkg ? 'On' : 'Off';
      // Display 1-based to match the rest of the UI (device bkgId is 0-based).
      values[`${prefix}_bkg_id`] = (state.bkgId ?? 0) + 1;
      values[`${prefix}_osd_text`] = state.osdText ? 'On' : 'Off';
      values[`${prefix}_osd_image`] = state.osdImage ? 'On' : 'Off';
      // Test pattern state comes from the output connectors, not enhancedState:
      // W0303 is addressed per connector, so the connector-aware actions track
      // it in connectorTestPatterns. enhancedState.testPattern is only written
      // by the legacy per-screen action, which is why this variable used to sit
      // at "Off" while the cycle button was clearly working.
      const screenConnectors = Object.values(this.outputConnectors ?? {}).filter((c) => c.screenId === screenId);
      const livePattern = screenConnectors
        .map((c) => this.connectorTestPatterns?.[c.outputId])
        .find((v) => v !== undefined && v !== 0xffff);
      const legacyOn = !!state.testPattern;
      values[`${prefix}_test_pattern`] = livePattern !== undefined || legacyOn ? 'On' : 'Off';
      values[`${prefix}_test_pattern_name`] =
        livePattern !== undefined ? (TEST_PATTERNS.find((p) => p.id === livePattern)?.label ?? `0x${livePattern.toString(16)}`) : 'Off';
    }
    return { definitions, values };
  }

  /**
   * Send data via UDP with error handling so transport errors don't
   * crash the instance. Flips status to ConnectionFailure on failure.
   */
  safeSend(data) {
    if (!this.udp) {
      this.log('debug', 'safeSend: no UDP socket');
      return;
    }
    try {
      this.udp.send(data);
    } catch (err) {
      this.log('warn', `UDP send error: ${err.message}`);
      this.updateStatus(InstanceStatus.ConnectionFailure);
    }
  }

  handleGetAllData() {
    this.getAllData();
    this.updateAll();
    // 启动定时器，定时获取全量数据
    if (this.dataInterval) {
      clearInterval(this.dataInterval);
    }
    const interval = Math.max(500, Math.min(30000, Number(this.config.pollInterval) || 1000));
    this.dataInterval = setInterval(() => {
      // Surface the "polling into the void" case: we keep transmitting on a
      // timer whether or not the device ever answers, so without this the log
      // shows a healthy-looking request stream while nothing comes back.
      const rx = this.rxCount ?? 0;
      if (rx === this.lastSeenRxCount) {
        this.noReplyTicks = (this.noReplyTicks ?? 0) + 1;
        // Warn once at ~5 ticks, then every ~30 ticks, so the log is not spammed.
        if (this.noReplyTicks === 5 || this.noReplyTicks % 30 === 0) {
          this.log(
            'warn',
            `No response from device at ${this.config.host}:${this.config.port} for ${this.noReplyTicks} poll cycles. ` +
              `Check the IP/port, that the splicer is reachable, and that inbound UDP is not blocked by a firewall.`,
          );
          this.updateStatus(InstanceStatus.ConnectionFailure, 'No response from device');
        }
      } else if (this.noReplyTicks) {
        this.log('info', 'Device responding again');
        this.noReplyTicks = 0;
      }
      this.lastSeenRxCount = rx;
      // Flush whatever the last cycle's responses changed, once, at ping rate.
      if (this.pendingUpdate) {
        this.pendingUpdate = false;
        this.updateAll();
      }
      this.getAllData();
    }, interval);
  }

  async init(config) {
    const { config: normalized, filledMissing } = applyConfigDefaults({
      ...this.config,
      ...config,
    });
    this.config = normalized;
    // Persist the filled-in defaults so the config UI shows real values
    // (e.g. poll interval 1000, screen/input counts) instead of 0/blank.
    if (filledMissing) this.saveConfig(this.config);

    // Build banner so the loaded version is visible in the connection log.
    this.log('info', `${PRODUCTS_INFORMATION}`);

    // Offline Programming Mode: synthesize a virtual screen/layer/preset tree
    // so variables, actions, and feedbacks all work without a device. Useful
    // when building buttons for a show before rental/deployment hardware
    // is on-site.
    if (this.config.offlineMode) {
      this.generateOfflineData();
      this.updateAll();
      this.log('info', 'Offline Programming Mode enabled');
      this.updateStatus(InstanceStatus.Ok, 'Offline Programming Mode');
      return;
    }

    this.updateStatus(InstanceStatus.Connecting);
    this.initUDP();
  }

  /**
   * Generate synthetic screenList/presetCollectionList/sourceList data from
   * the configured screen and input card counts so offline programming can
   * populate variable dropdowns and previews.
   */
  generateOfflineData() {
    const screenCount = this.config.screenCount || 4;
    const inputCardCount = this.config.inputCardCount || 1;
    const PRESETS_PER_SCREEN = 20;

    // Rebuild enhanced per-screen state too, so the screen_N_brightness /
    // _frozen / _ftb / _bkg / _osd / _test_pattern variables exist offline
    // (getEnhancedVariables iterates enhancedState.screens). Without this,
    // offline mode has no screen brightness variable.
    this.enhancedState = { screens: {} };
    this.screenList = [];
    for (let i = 0; i < screenCount; i++) {
      this.initEnhancedScreen(i);
      this.screenList.push({
        screenId: i,
        name: `Screen ${i + 1}`,
        layers: [
          { layerId: 0, name: 'Layer 1' },
          { layerId: 1, name: 'Layer 2' },
          { layerId: 2, name: 'Layer 3' },
          { layerId: 3, name: 'Layer 4' },
        ],
        presets: Array.from({ length: PRESETS_PER_SCREEN }, (_, p) => ({
          presetId: p,
          name: `Preset ${p + 1}`,
        })),
        details: {
          screenId: i,
          brightness: 100,
          screenFrz: 0,
          blackout: 1, // 1 = not blacked out (protocol inverted: 0=FTB on)
          bkgEnable: 0,
          textOsdEnable: 0,
          imgOsdEnable: 0,
        },
      });
    }

    this.presetCollectionList = [];
    // Synthetic input source entries so source dropdowns populate offline.
    // `inputId = slot * 4 + conn` gives a unique identifier across all cards;
    // formatSourceVariable builds `source_${inputId}_${cropId}` variable ids,
    // so duplicate inputIds would collide and only the last entry would show.
    // Synthetic input-signal state so the input_signal feedback and the
    // input_N_M_signal variables can be built and tested offline. Alternate
    // signal/no-signal so both feedback states are visible without hardware.
    // Only emitted when the polling toggle is on, matching live behaviour.
    this.inputSignalState = {};
    if (this.config.inputSignalPolling) {
      for (let slot = 0; slot < inputCardCount; slot++) {
        for (let conn = 0; conn < 4; conn++) {
          this.inputSignalState[`input_${slot + 1}_${conn + 1}`] = (slot * 4 + conn) % 3 !== 2;
        }
      }
    }

    // Synthetic output connectors, one per screen, so the test pattern actions,
    // feedbacks and presets can be built and driven offline. Without these the
    // connector list is empty, per-screen targeting matches nothing and the
    // cycle button sits on its base style with no colour feedback.
    this.outputConnectors = {};
    this.connectorTestPatterns = {};
    this.slotCardTypes = {};
    for (let i = 0; i < screenCount; i++) {
      const outputId = i * 4; // mirrors the device's card*4 + connector spacing
      const slotId = 20 + i * 2;
      this.outputConnectors[outputId] = {
        outputId,
        interfaceId: 0,
        slotId,
        interfaceType: 2,
        isCardOnline: 1,
        isUsed: 1,
        screenId: i,
        screenName: `Screen ${i + 1}`,
        deviceName: `output ${slotId + 1}-1`,
      };
      this.connectorTestPatterns[outputId] = 0xffff; // Off
      this.slotCardTypes[slotId] = 3; // Sender, so "All Sending Cards" works offline
    }

    this.sourceList = [];
    for (let slot = 0; slot < inputCardCount; slot++) {
      for (let conn = 0; conn < 4; conn++) {
        const inputId = slot * 4 + conn;
        this.sourceList.push({
          inputId,
          cropId: 255,
          streamId: 0,
          templateId: 0,
          sourceType: 1,
          groupName: 'Video Inputs',
          name: `Input ${slot + 1}-${conn + 1}`,
          inputName: `Input ${slot + 1}-${conn + 1}`,
          slotId: slot,
          interfaceId: conn,
          online: 1,
        });
      }
    }
  }

  /** 更新actions、presets、feedbacks */
  /**
   * Cheap signature of everything the action/feedback/preset definitions are
   * built from. Definitions only need rebuilding when one of these changes;
   * brightness and other live values do not affect them.
   */
  definitionSignature() {
    const screens = (this.screenList ?? [])
      .map(
        (s) =>
          `${s.screenId}:${s.name}:` +
          `${(s.layers ?? []).map((l) => `${l.layerId}~${l.name}`).join(',')}:` +
          `${(s.presets ?? []).map((p) => `${p.presetId}~${p.name}`).join(',')}`,
      )
      .join('|');
    const groups = (this.presetCollectionList ?? []).map((g) => `${g.presetCollectionId}~${g.name}`).join(',');
    const sources = (this.sourceList ?? [])
      .map((s) => `${s.inputId}~${s.cropId}~${s.slotId}~${s.interfaceId}~${s.name}`)
      .join(',');
    // The polling flag itself matters: it gates the input_signal feedback and
    // variables, so toggling it must rebuild even when no signals are known yet.
    const polling = this.config?.inputSignalPolling ? '1' : '0';
    const signals = this.config?.inputSignalPolling ? Object.keys(this.inputSignalState ?? {}).sort().join(',') : '';
    return `${screens}#${groups}#${sources}#${polling}#${signals}`;
  }

  /**
   * Rebuild definitions only when their inputs changed, then always refresh
   * variable values.
   *
   * updateAll() runs at the end of every inbound UDP packet, which at a 1 s poll
   * with several screens is well over a dozen times a second. Re-pushing every
   * action, feedback and preset that often costs megabytes per second of IPC,
   * and Companion 5.0 revalidates every preset on each push, which shows up as
   * UI lag and a stuck "running" indicator on buttons. Values are cheap, so they
   * still go every time.
   */
  updateAll(force = false) {
    const signature = this.definitionSignature();
    if (force || signature !== this.lastDefinitionSignature) {
      this.lastDefinitionSignature = signature;
      this.updateDefinitions();
    }
    this.updateVariables();
  }

  updateDefinitions() {
    this.setActionDefinitions(getActions(this));
    this.setFeedbackDefinitions(getFeedbacks(this));
    const { structure, presets } = getPresetDefinitions(this);
    this.setPresetDefinitions(structure, presets);
  }

  updateVariables() {
    // 处理变量
    const { screenVariableDefinitions, screenDefaultVariableValues } = formatScreenVariable(this.screenList);
    const { layerVariableDefinitions, layerDefaultVariableValues } = formatLayerVariable(this.screenList);
    const { presetVariableDefinitions, presetDefaultVariableValues } = formatPresetVariable(this.screenList);
    const { presetCollectionVariableDefinitions, presetCollectionDefaultVariableValues } =
      formatPresetCollectionVariable(this.presetCollectionList);
    const { sourceVariableDefinitions, sourceDefaultVariableValues } = formatSourceVariable(this.sourceList);
    const { definitions: enhancedDefs, values: enhancedVals } = this.getEnhancedVariables();

    // Input signal variables — only emitted when polling is enabled, so the
    // feature is dead code (no defs, no values) when the toggle is off.
    const inputSignalDefs = [];
    const inputSignalVals = {};
    if (this.config.inputSignalPolling) {
      for (const [inputKey, hasSignal] of Object.entries(this.inputSignalState)) {
        const label = inputKey.replace('input_', '').replace('_', '-');
        inputSignalDefs.push({ variableId: `${inputKey}_signal`, name: `Input ${label} Signal` });
        inputSignalVals[`${inputKey}_signal`] = hasSignal ? 'Active' : 'No Signal';
      }
    }

    // base 2.0 requires variable definitions as an OBJECT keyed by
    // variableId ({ [id]: { name } }), not an array. The format helpers
    // still return arrays of { variableId, name }, so flatten them into the
    // object form here at the single call site.
    const allVariableDefs = [
      ...screenVariableDefinitions,
      ...layerVariableDefinitions,
      ...presetVariableDefinitions,
      ...presetCollectionVariableDefinitions,
      ...sourceVariableDefinitions,
      ...enhancedDefs,
      ...inputSignalDefs,
    ];
    const variableDefsObject = {};
    for (const def of allVariableDefs) {
      if (def && def.variableId) variableDefsObject[def.variableId] = { name: def.name };
    }
    // Only (re)declare variables when the set of them actually changed. Pushing
    // definitions makes Companion re-evaluate feedbacks, which visibly flashes
    // every button showing an active feedback. bmd-videohub declares once in
    // initThings() and thereafter only pushes values plus targeted
    // checkFeedbacks(); this is the same split.
    const defsKey = Object.keys(variableDefsObject).sort().join(',');
    if (defsKey !== this.lastVariableDefsKey) {
      this.lastVariableDefsKey = defsKey;
      this.setVariableDefinitions(variableDefsObject);
    }
    this.setVariableValues({
      ...screenDefaultVariableValues,
      ...layerDefaultVariableValues,
      ...presetDefaultVariableValues,
      ...presetCollectionDefaultVariableValues,
      ...sourceDefaultVariableValues,
      ...enhancedVals,
      ...inputSignalVals,
    });
  }

  /** 获取全量列表数据 */
  getAllData() {
    this.log('debug', `${new Date().getTime()} getAllData`);
    getScreenList(this);
    getPresetCollectionList(this);
    getOutputList(this);
    getInputListSimplify(this);
    // Opt-in input signal polling. Default off, no extra packets unless enabled.
    if (this.config.inputSignalPolling) {
      this.pollInputSignals();
    }
  }

  /**
   * Poll R0102 (Get Slot Information) once per installed slot. Each response
   * carries an `interfaces[]` array with `iSignal` for all 4 connectors on
   * that slot, so one call per slot covers every connector (75% fewer round
   * trips than per-connector R0103 polling).
   *
   * Slot range is derived from `this.sourceList` (populated by the existing
   * R0226 getInputListSimplify poll) rather than a static config, so we only
   * poll slots that actually have cards installed.
   */
  pollInputSignals() {
    if (!this.udp || !this.connectStatus) return;
    // Per Novastar H Series Control Protocol V1.0.19 §4.3.1, R0100
    // (Get Device Details) returns slotList[] with the complete inventory of
    // every installed card: slotId, cardType (1=Input, 2=Output, 3=Sender,
    // 4=MVR), and interfaces[] including iSignal for each connector.
    // One call enumerates every input slot and connector on the device — no
    // need to scan slot numbers or guess at card layout. The response handler
    // filters to cardType=1 slots so only real input connectors are surfaced.
    const cmd = JSON.stringify([{ cmd: ACTIONS_CMD.get_device_details, param0: this.deviceId }]);
    this.safeSend(Buffer.from(cmd));
  }

  getConfigFields() {
    const screenCountChoices = [];
    for (let i = 1; i <= 40; i++) screenCountChoices.push({ id: i, label: `${i}` });
    const inputCardChoices = [];
    for (let i = 1; i <= 40; i++) inputCardChoices.push({ id: i, label: `${i} (${i * 4} inputs)` });

    return [
      {
        type: 'static-text',
        id: 'info',
        width: 12,
        label: 'Information',
        value: PRODUCTS_INFORMATION,
      },
      {
        type: 'textinput',
        id: 'host',
        label: 'IP Address',
        width: 6,
        default: '127.0.0.1',
        regex: Regex.IP,
      },
      {
        type: 'textinput',
        id: 'port',
        label: 'Port',
        width: 6,
        default: '6000',
        regex: Regex.PORT,
      },
      {
        type: 'number',
        id: 'pollInterval',
        label: 'Poll Interval (ms)',
        width: 6,
        min: 500,
        max: 30000,
        default: 1000,
        tooltip: 'How often to poll the device for state updates (500-30000ms). Lower = more responsive feedback at the cost of more UDP traffic.',
      },
      {
        type: 'static-text',
        id: 'offline_heading',
        width: 12,
        label: 'Offline Programming',
        value:
          'Enable Offline Programming Mode to build and test buttons against a synthetic device — useful when hardware arrives after the show is being programmed. Actions will be silently no-op for the UDP layer; variables and feedbacks populate from the counts below.',
      },
      {
        type: 'checkbox',
        id: 'offlineMode',
        label: 'Enable Offline Programming Mode',
        width: 6,
        default: false,
      },
      {
        type: 'dropdown',
        id: 'screenCount',
        label: 'Number of Screens',
        width: 6,
        default: 1,
        choices: screenCountChoices,
        tooltip: 'Used in offline mode to synthesize the screen list. Overridden by live device data when connected.',
      },
      {
        type: 'dropdown',
        id: 'inputCardCount',
        label: 'Number of Input Cards',
        width: 6,
        default: 1,
        choices: inputCardChoices,
        tooltip: 'Used in offline mode to synthesize input source entries (each card has 4 connectors).',
      },
      {
        type: 'static-text',
        id: 'input_signal_heading',
        width: 12,
        label: 'Input Signal Polling',
        value:
          'Optional feature for live operators who need to drive button feedback off whether an input connector has signal. When enabled, the module polls R0102 (Get Slot Information) once per installed slot on the regular getAllData tick and exposes input_N_M_signal variables and an input_signal boolean feedback. Slots are auto-detected from the existing source list, so no additional configuration is needed. Default off, leave it off if you do not need this.',
      },
      {
        type: 'checkbox',
        id: 'inputSignalPolling',
        label: 'Enable Input Signal Polling',
        width: 6,
        default: false,
      },
    ];
  }

  //暂时不需要支持ipc ndi
  async getInputListSync() {
    let _list = [];
    const addList = async (cmd, params, expr) => {
      if (_list.length < 500) {
        const res = await sendUDPRequestsSync(this, [
          {
            cmd: ACTIONS_CMD[cmd],
            params,
          },
        ]);
        const croupList = [];
        // console.info(1111, res[0]?.data?.inputs);
        const _data =
          res[0]?.data?.inputs?.map((_item) => {
            _item.crops?.forEach((cropItem) => {
              croupList.push({ ...cropItem, ...expr, templateId: 0, ...cropItem });
            });
            return { ..._item, ...expr, templateId: 0, cropId: 255 };
          }) ?? [];
        _list = [..._list, ..._data, ...croupList];
      }
      if (_list.length > 500) {
        _list = _list.slice(0, 500);
      }
    };
    // Mosaic Network Inputs
    await addList(
      'get_input_list',
      {
        param0: 0,
        param1: 1,
      },
      { groupName: 'Video Inputs', streamI: 0 },
    );
    await addList(
      'get_ipc_input_list',
      {
        segPagelndex: 0,
        segPageSize: 10,
      },
      { groupName: 'IPC Input Signal' },
    );
    await addList(
      'get_ndi_input_list',
      {
        segPagelndex: 0,
        segPageSize: 500,
      },
      { groupName: 'NDI Input Signal' },
    );
    this.sourceList = formatSourceList(_list);
  }

  // When module gets deleted
  async destroy() {
    this.log('info', 'destroy:' + this.id);
    this.stopAllBrightnessRamps();
    if (this.udp !== undefined) {
      this.udp.destroy();
    }
    if (this.dataInterval) {
      clearInterval(this.dataInterval);
      this.dataInterval = null;
    }
    this.heartbeatManager.stop();
    this.clearInitStatusTimer();
  }

  initUDP() {
    if (this.udp !== undefined) {
      this.udp.destroy();
      delete this.udp;
    }

    if (this.config.host !== undefined) {
      this.udp = new UDPHelper(this.config.host, this.config.port);

      this.udp.on('error', (err) => {
        this.log('error', `UDP error: ${err?.message ?? err}`);
        this.updateStatus(InstanceStatus.ConnectionFailure);
      });

      this.udp.on('listening', () => {
        this.log('debug', 'UDP listening');
        this.updateStatus(InstanceStatus.Connecting);
        this.connectStatus = false;
        this.startInitStatusQuery();
        this.heartbeatManager.stop(); // 确保心跳管理器重置
      });

      // If we get data, thing should be good
      this.udp.on('data', (msg) => {
        // Inbound packets were previously silent, which made "module transmits
        // but nothing comes back" impossible to diagnose from the log: a
        // response that decodes without an `ack` was dropped with no trace.
        // Log receipt (and any drop) at debug so the log distinguishes
        // "no reply from device" from "reply arrived but was discarded".
        this.rxCount = (this.rxCount ?? 0) + 1;
        try {
          const res = decodeRes(msg);
          if (res.ack) {
            this.log('debug', `UDP rx #${this.rxCount} cmd=${res.cmd ?? '?'} ack=${res.ack}`);
            this.UDPResponse(res);
          } else {
            this.log('debug', `UDP rx #${this.rxCount} DROPPED (no ack) cmd=${res?.cmd ?? '?'}`);
          }
        } catch (err) {
          this.log('error', `udp data error: ${err}`);
        }
      });

      this.udp.on('status_change', (status, message) => {
        this.log('debug', 'UDP status_change: ' + status);
      });
      this.log('debug', 'initUDP finish');
    } else {
      this.log('error', 'No host configured');
      // this.updateStatus(InstanceStatus.BadConfig);
    }
  }
  /** devices cmd handle end */

  async configUpdated(config) {
    const { config: normalized } = applyConfigDefaults({ ...this.config, ...config });

    const hostChanged = this.config.host != normalized.host;
    const offlineModeChanged = this.config.offlineMode !== normalized.offlineMode;
    const sizeChanged =
      this.config.screenCount !== normalized.screenCount || this.config.inputCardCount !== normalized.inputCardCount;

    this.log('info', 'configUpdated module....');

    // Any in-flight hold-to-ramp is tied to the old connection/screen list.
    this.stopAllBrightnessRamps();

    this.config = normalized;

    // If offline mode is on and size changed, regenerate synthetic data
    if (sizeChanged && this.config.offlineMode) {
      this.generateOfflineData();
      this.updateAll(true);
    }

    // Handle offline mode toggle
    if (offlineModeChanged) {
      if (this.config.offlineMode) {
        // Entering offline mode — tear down any live connection cleanly
        if (this.udp) {
          this.udp.destroy();
          delete this.udp;
        }
        if (this.dataInterval) {
          clearInterval(this.dataInterval);
          this.dataInterval = null;
        }
        this.heartbeatManager.stop();
        this.clearInitStatusTimer();
        this.connectStatus = false;
        this.generateOfflineData();
        this.updateAll(true);
        this.updateStatus(InstanceStatus.Ok, 'Offline Programming Mode');
        return;
      } else {
        // Leaving offline mode — clear synthetic data and immediately fetch
        // real device state so Presets/Feedback refresh without needing a
        // host change or polling cycle.
        this.screenList = [];
        this.presetCollectionList = [];
        this.sourceList = [];
        this.connectStatus = false;
        this.updateAll(true);
        if (this.config.host) {
          this.updateStatus(InstanceStatus.Connecting);
          this.heartbeatManager.stop();
          this.clearInitStatusTimer();
          this.initUDP();
          this.handleGetAllData();
        } else {
          this.updateStatus(InstanceStatus.Disconnected, 'No host configured');
        }
        return;
      }
    }

    if (hostChanged && !this.config.offlineMode) {
      this.updateStatus(InstanceStatus.Connecting);
      this.heartbeatManager.stop();
      this.clearInitStatusTimer();
      this.initUDP();
      this.handleGetAllData();
    }
  }

  // 初始化状态查询
  startInitStatusQuery() {
    this.log('debug', 'Starting initial status query...');
    this.clearInitStatusTimer();
    this.sendInitStatusRequest();
  }

  sendInitStatusRequest() {
    this.log('debug', 'Sending initial status request...');
    if (this.udp) {
      this.safeSend(Buffer.from(JSON.stringify([{ cmd: ACTIONS_CMD.get_device_init_status, param0: this.deviceId }])));
    }
  }

  handleInitStatusResponse(rate) {
    this.log('debug', `Handling init status response with rate: ${rate}`);
    this.initRate = rate;
    if (rate === 100) {
      this.handleGetAllData();
      this.connectStatus = true;
      this.updateStatus(InstanceStatus.Ok);
      this.clearInitStatusTimer();
      this.heartbeatManager.start();
    } else {
      this.connectStatus = false;
      this.updateStatus(InstanceStatus.Connecting);
      this.initStatusTimer = setTimeout(() => {
        this.sendInitStatusRequest();
      }, 15000);
    }
  }

  clearInitStatusTimer() {
    if (this.initStatusTimer) {
      clearTimeout(this.initStatusTimer);
      this.initStatusTimer = null;
    }
  }

  sendHeartbeat() {
    if (this.udp) {
      this.safeSend(Buffer.from(JSON.stringify([{ cmd: ACTIONS_CMD.device_heartbeat, deviceId: this.deviceId }])));
    }
  }

  /** 处理返回数据 */
  UDPResponse(res) {
    // 发出UDP响应事件，供串行请求监听
    this.emit('udp_response', res);
    switch (res.cmd) {
      case ACTIONS_CMD.get_screen_list:
        this.dealScreenList(res.data);
        break;
      case ACTIONS_CMD.get_layer_list:
        this.dealLayerList(res.data);
        break;
      case ACTIONS_CMD.get_preset_collection_list:
        this.presetCollectionList = res.data?.presetCollectionList ?? [];
        break;
      case ACTIONS_CMD.get_preset_list:
        this.dealPresetList(res.data);
        // this.log('debug', `presetList22: ${JSON.stringify(res)}`);

        break;
      case ACTIONS_CMD.apply_screen_details:
        this.dealScreenDetails(res.data);
        break;
      case ACTIONS_CMD.get_input_list_simplify:
        this.sourceList = formatSourceList(res.data.inputs);
        break;
      case ACTIONS_CMD.get_output_list:
        // Previously polled every cycle and discarded. It carries the output
        // connector inventory, their device names, and live test pattern state.
        this.dealOutputList(res.data);
        break;
      case ACTIONS_CMD.device_heartbeat:
        this.heartbeatManager.receive();
        break;
      case ACTIONS_CMD.get_device_init_status:
        this.handleInitStatusResponse(res.data.rate);
        break;
      case ACTIONS_CMD.get_device_details:
        this.dealDeviceDetails(res);
        break;
      default:
        break;
    }
    // Do not push definitions/variables per packet. A poll cycle delivers well
    // over a dozen responses, and pushing on each one floods Companion (which
    // in 5.0 revalidates every preset per push). Mark dirty and flush once on
    // the next poll tick instead, so updates land at the configured ping rate.
    this.pendingUpdate = true;
  }

  /**
   * R0103 response handler. Each response covers one connector and carries:
   *   { deviceId, slotId, interfaceId, interfaceType, iSignal, functionType }
   * Per protocol, iSignal=1 means signal source connected; values 0 (no
   * source) and 2 (disconnected) are both treated as inactive.
   *
   * Matches the V10 working build, which proved this pattern reliable on
   * live H Series chassis. Only fires while inputSignalPolling is enabled;
   * the polling loop checks the toggle so this case is unreachable when off.
   */
  /**
   * R0100 response handler. Walks slotList[], keeps only slots where
   * cardType === 1 (Input card slot), and for each one's interfaces[]
   * builds an `input_${slotId+1}_${interfaceId+1}` entry in
   * `inputSignalState` with iSignal === 1 → Active, else No Signal.
   *
   * Per protocol §4.3.2:
   *   cardType: 0=No card, 1=Input, 2=Output, 3=Sender, 4=MVR
   *   interfaces[].iSignal: 0=no source, 1=connected, 2=disconnected
   */
  dealDeviceDetails(res) {
    if (res.ack !== true) return;
    const slotList = res.data?.slotList;
    if (!Array.isArray(slotList)) return;


    const changedKeys = [];
    const values = {};
    const seenKeys = new Set();

    // Record the card type of every populated slot, not just input slots.
    // Per protocol §4.3.2: 1=Input, 2=Output, 3=Sender, 4=MVR. Output
    // connectors are addressed by outputId, which carries no card type, so
    // this is how we tell a sending card apart from a plain output card.
    this.slotCardTypes = this.slotCardTypes ?? {};
    // Also record which connectors physically exist on each card. R0300 reports
    // a fixed grid of potential outputs per slot (4 per card on an H15), most of
    // which are not real -- an 8-connector chassis still reports 32. R0100's
    // interfaces[] is the actual inventory, so it is what we filter against.
    this.slotInterfaces = {};
    for (const slot of slotList) {
      if (typeof slot?.slotId === 'number' && slot?.cardType !== undefined) {
        this.slotCardTypes[slot.slotId] = slot.cardType;
        if (Array.isArray(slot.interfaces)) {
          this.slotInterfaces[slot.slotId] = new Set(
            slot.interfaces.map((i) => i?.interfaceId).filter((i) => typeof i === 'number'),
          );
        }
      }
    }

    for (const slot of slotList) {
      // Only input card slots that are actually populated. Per protocol
      // §4.3.2: cardType=1 is "Input card slot" (the bay), status=1 is
      // "Normal" (card present and operational). Empty input bays report
      // cardType=1 with status=0 and have to be skipped.
      if (slot?.cardType !== 1 || slot?.status !== 1) continue;
      const slotId = slot.slotId;
      if (typeof slotId !== 'number') continue;
      const interfaces = Array.isArray(slot.interfaces) ? slot.interfaces : [];

      for (const iface of interfaces) {
        const interfaceId = iface?.interfaceId;
        if (typeof interfaceId !== 'number') continue;

        // Skip connectors that are not a usable input.
        //
        // 1) functionType=255 means "Invalid" (protocol §4.3.5) — the
        //    disabled side of a combo HDMI/DP input card where only one
        //    connector can be enabled at a time. Never a usable input.
        if (iface.functionType === 255) continue;

        // 2) 12G-SDI loop-out. The H_1x12G SDI input card exposes two
        //    interfaceType=18 connectors, but only connector 0 is an input —
        //    connector 1 is a hardware LOOP-OUT. The protocol returns both
        //    with identical fields (no direction flag), so we encode the
        //    card's known layout: on a 12G-SDI card, keep connector 0 only.
        if (iface.interfaceType === 18 && interfaceId >= 1) continue;

        const inputKey = `input_${slotId + 1}_${interfaceId + 1}`;
        seenKeys.add(inputKey);
        const hasSignal = iface.iSignal === 1;
        const prev = this.inputSignalState[inputKey];
        this.inputSignalState[inputKey] = hasSignal;
        values[`${inputKey}_signal`] = hasSignal ? 'Active' : 'No Signal';
        if (prev !== hasSignal) changedKeys.push(inputKey);
      }
    }

    // Drop stale entries for connectors that disappeared (card hot-removed).
    for (const key of Object.keys(this.inputSignalState)) {
      if (!seenKeys.has(key)) delete this.inputSignalState[key];
    }

    this.setVariableValues(values);
    if (changedKeys.length > 0) {
      this.checkFeedbacks('input_signal');
    }
  }
  /** 处理屏幕列表 */
  dealScreenList(data) {
    // Preserve existing layers/presets/details on each screen while replacing
    // the rest of the screen record. R0400 carries only top-level screen fields
    // (screenId, name, etc.); layers come from R0500, presets from R0600,
    // and details from R0401. If we wipe screenList on every R0400, the
    // layer/preset/screen-detail presets briefly vanish during each poll
    // cycle until the dependent responses arrive. At 10s polling this was
    // hard to notice; at 1s polling it makes presets flicker on every tick.
    const prev = this.screenList ?? [];
    const merged = (data.screens ?? []).map((newScreen) => {
      const existing = prev.find((s) => s.screenId === newScreen.screenId);
      return {
        ...newScreen,
        layers: newScreen.layers ?? existing?.layers ?? [],
        presets: newScreen.presets ?? existing?.presets ?? [],
        details: newScreen.details ?? existing?.details,
      };
    });
    this.screenList = merged;
    // Seed enhanced state for any screen we have not seen yet, so the
    // screen_N_* variables (and the brightness gauge that reads them) exist
    // immediately instead of staying blank until the first R0401 arrives.
    // updateEnhancedFromDetails overwrites these with device truth on that poll.
    for (const screen of merged) {
      if (!this.enhancedState.screens[screen.screenId]) this.initEnhancedScreen(screen.screenId);
    }
    data.screens.forEach((screen) => {
      getLayerList(this, screen.screenId);
      getPresetList(this, screen.screenId);
      getScreenDetails(this, screen.screenId);
    });
  }

  /** 处理图层列表 */
  dealLayerList(data) {
    // console.log('layerList', JSON.stringify(data));
    if (this.screenList) {
      this.screenList.find((screen) => screen.screenId === data.screenId).layers = data.screenLayers.map((item) => ({
        layerId: item.layerId,
        name: item.name,
      }));
    }
  }

  /** 处理场景列表 */
  dealPresetList(data) {
    // this.log('debug', `presetList1: ${JSON.stringify(data)}`);
    if (this.screenList) {
      this.screenList.find((screen) => screen.screenId === data.screenId).presets = data.presets.map((item) => ({
        presetId: item.presetId,
        name: item.name,
      }));
    }
  }
  /** 处理屏幕详情 */
  dealScreenDetails(data) {
    if (this.screenList) {
      const screen = this.screenList.find((s) => s.screenId === data.screenId);
      if (!screen) return;
      // While a hold-to-ramp is running on this screen we are the authority on
      // brightness: the device's R0401 lags our W0410 writes, so accepting its
      // value mid-ramp makes the level snap backwards (visible rubber-banding).
      // Keep our in-flight value and let the device reconcile on release.
      const ramping = !!this.brightnessRampTimers?.[data.screenId];
      const localBrightness = screen.details?.brightness;
      screen.details = ramping && localBrightness !== undefined ? { ...data, brightness: localBrightness } : data;
      // Reconcile enhanced per-screen state from the device truth
      this.updateEnhancedFromDetails(data.screenId, screen.details);
      this.harvestOutputConnectors(screen);
    }
  }

  /**
   * Optimistic write so the per-connector feedback lights the instant a button
   * is pressed. The R0300 poll overwrites this with device truth shortly after.
   */
  setConnectorTestPattern(outputId, testPattern) {
    this.connectorTestPatterns = this.connectorTestPatterns ?? {};
    this.connectorTestPatterns[Number(outputId)] = Number(testPattern);
    // Push variables straight away rather than waiting for the next poll tick:
    // in offline mode there is no poll at all, so the test pattern variables
    // would otherwise never move.
    this.updateVariables();
    this.checkFeedbacks('test_pattern_connector', 'test_pattern_is');
  }

  /**
   * R0300 (Get Output List) response handler.
   *
   * Verified against a packet capture of the device's own web UI, which calls
   * the equivalent `/api/output/readAllList` and gets back one entry per output
   * connector carrying:
   *   outputId, general.name ("output 35-1"), slotId, interfaceId,
   *   interfaceType, isUsed, iSignal, and a testPattern object
   *   { testPattern, bright, grid, speed }.
   *
   * This is a better connector inventory than harvesting screen details: it
   * lists every connector (not just those assigned to a screen), carries the
   * device's own name for each, and gives real test pattern read-back.
   */
  dealOutputList(data) {
    const list = Array.isArray(data) ? data : (data?.outputs ?? data?.data ?? data?.outputList);
    if (!Array.isArray(list)) return;
    this.outputConnectors = this.outputConnectors ?? {};
    this.connectorTestPatterns = this.connectorTestPatterns ?? {};
    for (const out of list) {
      const outputId = out?.outputId;
      if (outputId === undefined || outputId === 255) continue;
      const prev = this.outputConnectors[outputId] ?? {};
      this.outputConnectors[outputId] = {
        ...prev, // keep the mosaic cell worked out from the screen details
        outputId,
        // The device names connectors "output <slot>-<connector>", 1-based.
        deviceName: out.general?.name ?? out.name ?? prev.deviceName,
        slotId: out.slotId ?? prev.slotId,
        interfaceId: out.interfaceId ?? prev.interfaceId,
        interfaceType: out.interfaceType ?? prev.interfaceType,
        isUsed: out.isUsed,
        iSignal: out.iSignal,
      };
      // Device truth for the test pattern, so feedback reflects reality even
      // when the pattern was set from the panel rather than from Companion.
      const tp = out.testPattern?.testPattern;
      if (tp !== undefined) this.connectorTestPatterns[outputId] = Number(tp);
    }

    // R0300 reports a fixed grid of potential connectors per card (4 per slot on
    // an H15), so a chassis with 8 physical outputs still lists 32. Drop the
    // ones R0100 says do not exist, so "All Sending Cards" and the connector
    // picker only ever offer real hardware. If R0100 has not arrived yet, keep
    // everything rather than hiding connectors that do exist.
    if (Object.keys(this.slotInterfaces ?? {}).length > 0) {
      for (const [key, c] of Object.entries(this.outputConnectors)) {
        const real = this.slotInterfaces[c.slotId];
        if (real && !real.has(c.interfaceId)) delete this.outputConnectors[key];
      }
    }

    // Log the inventory whenever it changes. Slot and outputId numbering is
    // chassis specific (an H2 and an H15 number their cards differently), and
    // nothing here assumes a layout, so this is how you confirm what a given
    // processor actually reported without guessing.
    const summary = Object.values(this.outputConnectors)
      .sort((a, b) => a.outputId - b.outputId)
      .map((c) => `${c.outputId}=${c.deviceName ?? `slot${c.slotId}-${c.interfaceId}`}`)
      .join(', ');
    if (summary && summary !== this.lastOutputSummary) {
      this.lastOutputSummary = summary;
      this.log('info', `Output connectors discovered (outputId=name): ${summary}`);
    }
  }

  /**
   * Collect the physical output connectors this screen drives, from the R0401
   * `outputMode.screenInterfaces` list. W0303 (Set Output Test Patterns) is
   * addressed by `outputId`, i.e. a connector, not a screen -- so we need a
   * connector inventory to offer per-connector test patterns.
   *
   * Per protocol V1.0.20 4.4.4, outputId 255 means "connector not assigned".
   */
  harvestOutputConnectors(screen) {
    const outputMode = screen?.details?.outputMode;
    const interfaces = outputMode?.screenInterfaces;
    if (!Array.isArray(interfaces)) return;
    this.outputConnectors = this.outputConnectors ?? {};

    // A screen is usually driven by several connectors tiled across it, so slot
    // number alone does not tell an operator which part of the wall they are
    // about to flash. Work out each connector's cell in the mosaic instead.
    // Interface x/y share the screen's coordinate space, so subtract the
    // screen origin to get the offset within the screen.
    const mosaic = outputMode.mosaic ?? {};
    const size = outputMode.size ?? {};
    const rows = Number(mosaic.row) || 0;
    const cols = Number(mosaic.column) || 0;
    const cellW = cols > 0 && Number(size.width) ? Number(size.width) / cols : 0;
    const cellH = rows > 0 && Number(size.height) ? Number(size.height) / rows : 0;

    for (const iface of interfaces) {
      const outputId = iface?.outputId;
      if (outputId === undefined || outputId === 255) continue; // unassigned

      let cell;
      if (cellW > 0 && cellH > 0 && (rows > 1 || cols > 1)) {
        const relX = (Number(iface.x) || 0) - (Number(size.x) || 0);
        const relY = (Number(iface.y) || 0) - (Number(size.y) || 0);
        const col = Math.round(relX / cellW) + 1;
        const row = Math.round(relY / cellH) + 1;
        if (row >= 1 && row <= rows && col >= 1 && col <= cols) cell = `R${row}C${col}`;
      }

      // Merge, don't replace: R0300 supplies the device's own connector name
      // and live test pattern state, and this handler must not wipe them.
      this.outputConnectors[outputId] = {
        ...(this.outputConnectors[outputId] ?? {}),
        outputId,
        interfaceId: iface.interfaceId,
        slotId: iface.slotId,
        interfaceType: iface.interfaceType,
        isCardOnline: iface.isCardOnline,
        screenId: screen.screenId,
        screenName: screen.name,
        cell,
        width: iface.resolution?.width ?? iface.width,
        height: iface.resolution?.height ?? iface.height,
      };
    }
  }

  handleHeartbeatTimeout() {
    this.connectStatus = false;
    this.updateStatus(InstanceStatus.ConnectionFailure);
    this.log('debug', 'Heartbeat timeout, device disconnected');
    // 保持心跳请求
  }

  handleHeartbeatRecover() {
    this.log('debug', 'handleHeartbeatRecover');
    this.sendInitStatusRequest();
  }
}

export default ModuleInstance;
export { UpgradeScripts };
