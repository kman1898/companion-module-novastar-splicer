import { ACTIONS_CMD, DEFAULT_COMMAND, TEST_PATTERN_TYPE, TEST_PATTERNS } from '../utils/constant.js';
import formatDropDownData from '../utils/formatDropDown.js';
import { handleParams, sendUDPRequestsSync } from '../utils/index.js';
import { applyPgmOrPvw, applyPresetCollection, blackScreen } from '../utils/request.js';
export const getActions = (instance) => {
  const {
    presetCollectionListDropDown,
    sourceListDropDown,
    presetDropDown,
    screenListDropDown,
    layerListDropDown,
    outputConnectorDropDown,
  } = formatDropDownData(instance);
  return {
    // 选择屏幕
    select_screen: {
      name: 'Select Screen',
      description: 'Select/Deselect a screen (without affecting operations performed on other terminals).',
      options: [
        {
          type: 'dropdown',
          name: 'Screen Select',
          label: 'Screen Select',
          id: 'screenId',
          default: screenListDropDown[0]?.id ?? null,
          choices: screenListDropDown,
        },
        {
          type: 'dropdown',
          name: 'Screen Select',
          label: 'Screen Select',
          id: 'enable',
          default: 1,
          choices: [
            {
              id: 1,
              label: 'Select',
            },
            {
              id: 0,
              label: 'Unselect',
            },
          ],
        },
      ],
      callback: (event) => {
        const { screenId, enable } = event.options;
        instance.log('debug', JSON.stringify(event.options));
        if (enable === 1 && !instance.selectedScreenList.includes(screenId)) {
          instance.selectedScreenList.push(screenId);
        }
        if (enable === 0) {
          instance.selectedScreenList = instance.selectedScreenList.filter((item) => item !== screenId);
        }
        instance.checkAllFeedbacks();
      },
    },
    // 选择图层
    select_layer: {
      name: 'Select Layer',
      description:
        'Select a layer (screen and layer display, without affecting operations performed on other terminals).',
      options: [
        {
          type: 'dropdown',
          name: 'Screen Layer',
          label: 'Screen Layer',
          id: 'combineId',
          default: layerListDropDown[0]?.id ?? null,
          choices: layerListDropDown,
        },
        {
          type: 'dropdown',
          name: 'Layer Select',
          label: 'Layer Select',
          id: 'enable',
          default: 1,
          choices: [
            {
              id: 1,
              label: 'Select',
            },
            {
              id: 0,
              label: 'Unselect',
            },
          ],
        },
      ],
      callback: (event) => {
        const { enable } = event.options;
        if (!event.options.combineId) {
          instance.log('warn', 'select_layer: no layer selected (layer list not loaded yet)');
          return;
        }
        const [screenId, layerId] = String(event.options.combineId).split('_').map((item) => Number(item));
        instance.log('debug', JSON.stringify(event.options));
        if (enable) {
          instance.selectedLayerInfo = { layerId, screenId };
        }
        if (enable === 0) {
          instance.selectedLayerInfo = null;
        }
        instance.checkAllFeedbacks();
      },
    },
    // 加载场景
    load_preset: {
      name: 'Preset',
      description: 'Read the screen list and preset list of each screen. Preset loading is allowed.',
      options: [
        {
          type: 'dropdown',
          name: 'Preset',
          label: 'Preset',
          id: 'combineId',
          default: presetDropDown[0]?.id ?? null,
          choices: presetDropDown,
        },
      ],
      callback: (event) => {
        const { combineId } = event.options;
        instance.log('debug', JSON.stringify(event.options));
        if (!combineId) {
          instance.log('warn', 'load_preset: no preset selected (preset list not loaded yet)');
          return;
        }
        const [screenId, presetId] = String(combineId).split('_').map((item) => Number(item));
        instance.selectedPresetInfo = { screenId, presetId };
        instance.checkAllFeedbacks();
        const command = handleParams(ACTIONS_CMD.load_preset, {
          screenId,
          presetId,
        });
        instance.safeSend(command);
      },
    },
    // 发送命令
    send_command: {
      name: 'Send Command',
      description: 'You can send a custom command',
      options: [
        {
          type: 'textinput',
          name: 'command',
          label: 'Command',
          id: 'command',
          default: DEFAULT_COMMAND,
        },
      ],
      callback: (event) => {
        const {
          options: { command },
        } = event;
        try {
          const params = Buffer.from(command);
          instance.safeSend(params);
        } catch (error) {
          instance.log('error', 'send command error');
        }
      },
    },
    play_preset_collection: {
      name: 'Preset group',
      description:
        'Read the preset group list of the selected screen. Select a preset group to load it. (Once loaded, the screen with presets saved in the preset group is selected.',
      options: [
        {
          type: 'dropdown',
          label: 'Preset Collection',
          name: 'Preset Collection',
          id: 'presetCollectionId',
          default: presetCollectionListDropDown[0]?.id ?? null,
          choices: presetCollectionListDropDown,
        },
      ],
      callback: async (action) => {
        const { presetCollectionId } = action.options;
        instance.selectedPresetCollectionId = presetCollectionId;
        instance.checkAllFeedbacks();
        applyPresetCollection(instance, { presetCollectionId });
      },
    },
    pgm_pvw_switch: {
      name: 'PGM/PVW',
      description: 'Switch to PGM/PVW mode for the selected screen.',
      options: [
        {
          type: 'dropdown',
          label: 'Model',
          id: 'enNonTime',
          default: 0,
          choices: [
            {
              id: 0,
              label: 'PGM',
            },
            {
              id: 1,
              label: 'PVW',
            },
          ],
        },
      ],
      callback: async (action) => {
        const { enNonTime } = action.options;
        const isPgm = enNonTime === 0;
        instance.pgmOrPvwActive = {
          pgmActive: isPgm,
          pvwActive: !isPgm,
          takeActive: false,
        };
        instance.checkAllFeedbacks();
        instance.selectedScreenList?.forEach((_screenId) => {
          applyPgmOrPvw(instance, {
            enNonTime,
            manualPlay: 0,
            screenId: _screenId,
          });
        });
      },
    },
    take_switch: {
      name: 'Take',
      description: 'Press Take button to take the content to the screen in PVW mode.',
      options: [
        {
          type: 'dropdown',
          name: 'Take Select',
          label: 'Take Select',
          id: 'manualPlay',
          default: 1,
          choices: [
            {
              id: 1,
              label: 'Select',
            },
            {
              id: 0,
              label: 'Unselect',
            },
          ],
        },
      ],
      callback: async (action) => {
        if (!instance.pgmOrPvwActive.pvwActive) return;
        const { manualPlay } = action.options;
        instance.pgmOrPvwActive.takeActive = manualPlay === 1;
        instance.checkAllFeedbacks();
        instance.selectedScreenList?.forEach((_screenId) => {
          applyPgmOrPvw(instance, {
            enNonTime: 1,
            manualPlay,
            screenId: _screenId,
          });
        });
      },
    },
    apply_ftb: {
      name: 'FTB',
      description: 'On/Off; make the selected screen go black.',
      options: [
        {
          type: 'dropdown',
          label: 'FTB',
          name: 'FTB',
          id: 'type',
          default: 0,
          choices: [
            {
              id: 0,
              label: 'FTB',
            },
            {
              id: 1,
              label: 'unFTB',
            },
          ],
        },
      ],
      callback: async (action) => {
        const { type } = action.options;
        instance.ftb = !type;
        instance.checkAllFeedbacks();
        if (!instance.selectedScreenList?.length) {
          // These are the legacy "select screen first" actions. Silently doing
          // nothing is indistinguishable from a broken device, so say so.
          instance.log('warn', 'No screen selected. Use Select Screen first, or use the per-screen (Direct) action instead.');
          return;
        }
        const param = instance.selectedScreenList.map((screenId) => ({ type, screenId }));
        blackScreen(instance, param);
      },
    },
    apply_volume_switch: {
      name: 'Volume Switch',
      description: 'On/Off; turn on or turn off the audio of the selected screen.',
      options: [
        {
          type: 'dropdown',
          label: 'Switch',
          name: 'Switch',
          id: 'isMute',
          default: 0,
          choices: [
            {
              id: 0,
              label: 'open',
            },
            {
              id: 1,
              label: 'close',
            },
          ],
        },
      ],
      callback: async (action) => {
        const { isMute } = action.options;
        instance.volumeMute = !isMute;
        instance.checkAllFeedbacks();
        if (!instance.selectedScreenList?.length) {
          // These are the legacy "select screen first" actions. Silently doing
          // nothing is indistinguishable from a broken device, so say so.
          instance.log('warn', 'No screen selected. Use Select Screen first, or use the per-screen (Direct) action instead.');
          return;
        }
        const resList = [];
        //音量批量下发只生效一个，所以需要遍历下发
        const requests = [];
        instance.selectedScreenList?.forEach((screenId) => {
          requests.push(
            {
              cmd: ACTIONS_CMD.apply_screen_details,
              params: { param0: 0, param1: screenId },
            },
            {
              cmd: ACTIONS_CMD.volume_switch,
              processParams: (results, idx) => {
                const detailRes = results[idx - 1]?.data || {};
                return {
                  isMute,
                  screenId,
                  volume: detailRes?.audio?.volume ?? 0,
                };
              },
            },
          );
        });
        sendUDPRequestsSync(instance, requests);
      },
    },
    /** 屏幕冻结 */
    screen_frz_toggle: {
      name: 'Screen FRZ',
      description: 'On/Off; freeze the selected screen.',
      options: [
        {
          type: 'dropdown',
          name: 'Screen FRZ',
          label: 'Screen FRZ',
          id: 'enable',
          default: 1,
          choices: [
            {
              id: 1,
              label: 'On',
            },
            {
              id: 0,
              label: 'Off',
            },
          ],
        },
      ],
      callback: async (action) => {
        const { enable } = action.options;
        instance.log('debug', enable);
        instance.screenFRZState = enable;
        instance.checkAllFeedbacks();
        if (instance.selectedScreenList.length === 0) {
          instance.log('error', 'Please select a screen');
          return;
        }
        instance.selectedScreenList.forEach((screenId) => {
          instance.log('debug', { screenId, enable });
          instance.safeSend(handleParams(ACTIONS_CMD.screen_frz, { screenId, enable }));
        });
      },
    },
    screen_volume_add: {
      name: 'Screen Volume Add',
      options: [],
      description: 'Increase the volume of the selected screen.',
      callback: () => {
        instance.selectedScreenList?.forEach((screenId) => {
          const curScreenDetails = instance.screenList.find((screen) => screen.screenId === screenId)?.details;
          // Guard audio separately: not every screen reports an audio block, and
          // an unguarded read here throws, which aborts every later action on
          // the same button rather than just skipping this one.
          if (!curScreenDetails?.audio) return;
          let volume = curScreenDetails.audio.volume;
          volume = Math.min(volume + 1, 100);
          curScreenDetails.audio.volume = volume;
          const command = handleParams(ACTIONS_CMD.apply_screen_volume, {
            screenId,
            volume: volume,
            isMute: 0,
          });
          instance.safeSend(command);
        });
      },
    },
    screen_volume_minus: {
      name: 'Screen Volume Minus',
      options: [],
      description: 'Decrease the volume of the selected screen.',
      callback: () => {
        instance.selectedScreenList?.forEach((screenId) => {
          const curScreenDetails = instance.screenList.find((screen) => screen.screenId === Number(screenId))?.details;
          // See screen_volume_add: audio may be absent.
          if (!curScreenDetails?.audio) return;
          let volume = curScreenDetails.audio.volume;
          volume = Math.max(volume - 1, 0);
          curScreenDetails.audio.volume = volume;
          const command = handleParams(ACTIONS_CMD.apply_screen_volume, {
            screenId,
            volume: volume,
            isMute: 0,
          });
          instance.safeSend(command);
        });
      },
    },
    // ==================== Direct per-screen actions ====================
    // One-click, screen-targeted variants that don't require a prior select_screen.
    // Each updates `enhancedState` optimistically for instant feedback then sends
    // the protocol command. Device truth reconciles on the next R0401 details poll.
    brightness_add_direct: {
      name: 'Brightness + (Direct)',
      description: 'Increase brightness by 1% on a specific screen (no select_screen needed).',
      options: [
        { type: 'dropdown', label: 'Screen', id: 'screenId', default: screenListDropDown[0]?.id ?? null, choices: screenListDropDown },
      ],
      callback: async (event) => {
        const screenId = event.options.screenId;
        const details = instance.screenList?.find((s) => s.screenId === screenId)?.details;
        if (!details) return;
        const brightness = Math.min((details.brightness ?? 100) + 1, 100);
        details.brightness = brightness;
        instance.updateEnhancedFromAction(screenId, 'brightness', brightness);
        // safeSend guards on missing udp internally
        instance.safeSend(handleParams(ACTIONS_CMD.apply_screen_brightness, { screenId, brightness }));
      },
    },
    brightness_minus_direct: {
      name: 'Brightness - (Direct)',
      description: 'Decrease brightness by 1% on a specific screen (no select_screen needed).',
      options: [
        { type: 'dropdown', label: 'Screen', id: 'screenId', default: screenListDropDown[0]?.id ?? null, choices: screenListDropDown },
      ],
      callback: async (event) => {
        const screenId = event.options.screenId;
        const details = instance.screenList?.find((s) => s.screenId === screenId)?.details;
        if (!details) return;
        const brightness = Math.max((details.brightness ?? 100) - 1, 0);
        details.brightness = brightness;
        instance.updateEnhancedFromAction(screenId, 'brightness', brightness);
        // safeSend guards on missing udp internally
        instance.safeSend(handleParams(ACTIONS_CMD.apply_screen_brightness, { screenId, brightness }));
      },
    },
    // Hold-to-ramp brightness. ramp_up/ramp_down go on the button DOWN action
    // (each carries its own ms speed), ramp_stop goes on the button UP action.
    // The module runs the repeat internally (Companion fires held action groups
    // once, not on a loop), so holding ramps brightness until release. The ms
    // option makes the ramp speed fully editable per button.
    brightness_ramp_up: {
      name: 'Brightness Ramp + (Hold)',
      description: 'Hold to continuously increase brightness on a screen. Put on the button DOWN action; pair with Brightness Ramp Stop on the UP action.',
      options: [
        { type: 'dropdown', label: 'Screen', id: 'screenId', default: screenListDropDown[0]?.id ?? null, choices: screenListDropDown },
        { type: 'number', label: 'Ramp speed (ms per 1% step, 0 = off)', id: 'ms', default: 200, min: 0, max: 2000, tooltip: 'Milliseconds between each 1% step while the button is held. Lower = faster. Set to 0 to turn repeat off, so each press steps exactly 1%.' },
      ],
      callback: (event) => instance.startBrightnessRamp(event.options.screenId, 1, event.options.ms),
    },
    brightness_ramp_down: {
      name: 'Brightness Ramp - (Hold)',
      description: 'Hold to continuously decrease brightness on a screen. Put on the button DOWN action; pair with Brightness Ramp Stop on the UP action.',
      options: [
        { type: 'dropdown', label: 'Screen', id: 'screenId', default: screenListDropDown[0]?.id ?? null, choices: screenListDropDown },
        { type: 'number', label: 'Ramp speed (ms per 1% step, 0 = off)', id: 'ms', default: 200, min: 0, max: 2000, tooltip: 'Milliseconds between each 1% step while the button is held. Lower = faster. Set to 0 to turn repeat off, so each press steps exactly 1%.' },
      ],
      callback: (event) => instance.startBrightnessRamp(event.options.screenId, -1, event.options.ms),
    },
    brightness_ramp_stop: {
      name: 'Brightness Ramp Stop (Release)',
      description: 'Stop a brightness ramp on a screen. Put on the button UP (release) action.',
      options: [
        { type: 'dropdown', label: 'Screen', id: 'screenId', default: screenListDropDown[0]?.id ?? null, choices: screenListDropDown },
      ],
      callback: (event) => instance.stopBrightnessRamp(event.options.screenId),
    },
    set_brightness: {
      name: 'Set Brightness',
      description: 'Set brightness of a specific screen to an absolute value (0-100). Supports variables.',
      options: [
        { type: 'dropdown', label: 'Screen', id: 'screenId', default: screenListDropDown[0]?.id ?? null, choices: screenListDropDown },
        { type: 'textinput', label: 'Brightness (0-100)', id: 'brightness', default: '100', useVariables: true },
      ],
      callback: async (event) => {
        const screenId = event.options.screenId;
        // base 2.0 resolves useVariables/expression options before the
        // callback, so event.options.brightness is already the final value.
        const raw = String(event.options.brightness);
        const brightness = Math.max(0, Math.min(100, Math.round(Number(raw))));
        if (isNaN(brightness)) {
          instance.log('warn', `set_brightness: invalid value "${raw}"`);
          return;
        }
        const details = instance.screenList?.find((s) => s.screenId === screenId)?.details;
        if (details) details.brightness = brightness;
        instance.updateEnhancedFromAction(screenId, 'brightness', brightness);
        // safeSend guards on missing udp internally
        instance.safeSend(handleParams(ACTIONS_CMD.apply_screen_brightness, { screenId, brightness }));
      },
    },
    freeze_direct: {
      name: 'Freeze (Direct)',
      description: 'Enable or disable freeze on a specific screen.',
      options: [
        { type: 'dropdown', label: 'Screen', id: 'screenId', default: screenListDropDown[0]?.id ?? null, choices: screenListDropDown },
        { type: 'dropdown', label: 'State', id: 'state', default: 1, choices: [{ id: 1, label: 'Enable' }, { id: 0, label: 'Disable' }] },
      ],
      callback: async (event) => {
        const screenId = event.options.screenId;
        const enable = parseInt(event.options.state);
        instance.updateEnhancedFromAction(screenId, 'frozen', enable === 1);
        // safeSend guards on missing udp internally
        instance.safeSend(handleParams(ACTIONS_CMD.screen_frz, { screenId, enable }));
      },
    },
    ftb_direct: {
      name: 'FTB (Direct)',
      description: 'Enable or disable Fade-to-Black on a specific screen.',
      options: [
        { type: 'dropdown', label: 'Screen', id: 'screenId', default: screenListDropDown[0]?.id ?? null, choices: screenListDropDown },
        { type: 'dropdown', label: 'State', id: 'state', default: 1, choices: [{ id: 1, label: 'Enable' }, { id: 0, label: 'Disable' }] },
      ],
      callback: async (event) => {
        const screenId = event.options.screenId;
        const enable = parseInt(event.options.state);
        instance.updateEnhancedFromAction(screenId, 'ftb', enable === 1);
        // safeSend guards on missing udp internally
        // Protocol: blackout 0 = FTB on, 1 = FTB off (inverted)
        instance.safeSend(handleParams(ACTIONS_CMD.black_screen, { screenId, type: enable === 1 ? 0 : 1 }));
      },
    },
    bkg_direct: {
      name: 'BKG (Direct)',
      description: 'Enable or disable BKG on a specific screen, choosing which BKG preset (by ID) to apply when enabling.',
      options: [
        { type: 'dropdown', label: 'Screen', id: 'screenId', default: screenListDropDown[0]?.id ?? null, choices: screenListDropDown },
        { type: 'dropdown', label: 'State', id: 'state', default: 1, choices: [{ id: 1, label: 'Enable' }, { id: 0, label: 'Disable' }] },
        {
          type: 'number',
          label: 'BKG (when enabling)',
          id: 'bkgId',
          default: 1,
          min: 1,
          max: 256,
          tooltip: 'Which stored background to show (1-based, matches the screen_N_bkg_id variable). Ignored when disabling.',
        },
      ],
      callback: async (event) => {
        const screenId = event.options.screenId;
        const enable = parseInt(event.options.state);
        // UI is 1-based; the device bkgId is 0-based.
        const deviceBkgId = Math.max(0, Math.min(255, (Number(event.options.bkgId) || 1) - 1));
        instance.updateEnhancedFromAction(screenId, 'bkg', enable === 1);
        if (enable === 1) instance.updateEnhancedFromAction(screenId, 'bkgId', deviceBkgId);
        // safeSend guards on missing udp internally
        instance.safeSend(handleParams(ACTIONS_CMD.bkg_switch, { screenId, enable, bkgId: deviceBkgId }));
      },
    },
    osd_direct: {
      name: 'OSD (Direct)',
      description: 'Enable or disable OSD on a specific screen.',
      options: [
        { type: 'dropdown', label: 'Screen', id: 'screenId', default: screenListDropDown[0]?.id ?? null, choices: screenListDropDown },
        { type: 'dropdown', label: 'Type', id: 'osdType', default: 'text', choices: [{ id: 'text', label: 'OSD Text' }, { id: 'image', label: 'OSD Image' }] },
        { type: 'dropdown', label: 'State', id: 'state', default: 1, choices: [{ id: 1, label: 'Enable' }, { id: 0, label: 'Disable' }] },
      ],
      callback: async (event) => {
        const screenId = event.options.screenId;
        const enable = parseInt(event.options.state);
        const osdType = event.options.osdType;
        instance.updateEnhancedFromAction(screenId, osdType === 'image' ? 'osdImage' : 'osdText', enable === 1);
        // W040C (protocol 4.4.12/4.4.13) is a flat payload keyed by `type`:
        // 0 = text OSD, 1 = image OSD. This previously sent `Osd: { enable }`,
        // which buried the flag in an object the device does not read and left
        // out `type` entirely, so it could never toggle the image OSD - while
        // the variable above happily reported that it had.
        // safeSend guards on missing udp internally
        instance.safeSend(
          handleParams(ACTIONS_CMD.osd_switch, { screenId, enable, type: osdType === 'image' ? 1 : 0 }),
        );
      },
    },
    test_pattern_direct: {
      name: 'Test Pattern (Direct)',
      description: 'Enable or disable test pattern on a specific screen.',
      options: [
        { type: 'dropdown', label: 'Screen', id: 'screenId', default: screenListDropDown[0]?.id ?? null, choices: screenListDropDown },
        { type: 'dropdown', label: 'State', id: 'state', default: 1, choices: [{ id: 1, label: 'Enable' }, { id: 0, label: 'Disable' }] },
      ],
      callback: async (event) => {
        const screenId = event.options.screenId;
        const enable = parseInt(event.options.state);
        instance.updateEnhancedFromAction(screenId, 'testPattern', enable === 1);
        // safeSend guards on missing udp internally
        instance.safeSend(handleParams(ACTIONS_CMD.test_pattern_switch, { screenId, enable, type: 0 }));
      },
    },
    // ==================== End direct per-screen actions ====================
    screen_brightness_add: {
      name: 'Screen Brightness Add',
      options: [],
      description: 'Increase the brightness of the screen loaded by the selected sending card.',
      callback: () => {
        instance.selectedScreenList?.forEach((screenId) => {
          const curScreenDetails = instance.screenList.find((screen) => screen.screenId === screenId)?.details;
          if (!curScreenDetails) return;
          let brightness = curScreenDetails.brightness;
          brightness = Math.min(brightness + 1, 100);
          curScreenDetails.brightness = brightness;
          // The brightness variable and gauge read enhancedState, not this list,
          // so mirror the change across or the button moves the wall while the
          // readout sits still until the next poll (and forever when offline).
          instance.updateEnhancedFromAction(screenId, 'brightness', brightness);
          const command = handleParams(ACTIONS_CMD.apply_screen_brightness, {
            screenId,
            brightness: brightness,
          });
          instance.safeSend(command);
        });
      },
    },
    screen_brightness_minus: {
      name: 'Screen Brightness Minus',
      options: [],
      description: 'Decrease the brightness of the screen loaded by the selected sending card.',
      callback: () => {
        instance.selectedScreenList?.forEach((screenId) => {
          const curScreenDetails = instance.screenList.find((screen) => screen.screenId === screenId)?.details;
          if (!curScreenDetails) return;
          let brightness = curScreenDetails.brightness;
          brightness = Math.max(brightness - 1, 0);
          curScreenDetails.brightness = brightness;
          // See screen_brightness_add: enhancedState is what the readout reads.
          instance.updateEnhancedFromAction(screenId, 'brightness', brightness);
          const command = handleParams(ACTIONS_CMD.apply_screen_brightness, {
            screenId,
            brightness: brightness,
          });
          instance.safeSend(command);
        });
      },
    },
    /** 图层冻结 */
    layer_frz_toggle: {
      name: 'Layer FRZ',
      description: 'On/Off; freeze the layer of the selected screen.',
      options: [
        {
          type: 'dropdown',
          name: 'Layer FRZ',
          label: 'Layer FRZ',
          id: 'enable',
          default: 1,
          choices: [
            {
              id: 1,
              label: 'On',
            },
            {
              id: 0,
              label: 'Off',
            },
          ],
        },
      ],
      callback: async (action) => {
        const { enable } = action.options;
        instance.log('debug', action.options);
        instance.layerFRZState = enable;
        instance.checkAllFeedbacks();
        if (!instance.selectedLayerInfo) {
          instance.log('error', 'Please select a layer');
          return;
        }
        instance.safeSend(
          handleParams(ACTIONS_CMD.layer_frz, {
            layerId: instance.selectedLayerInfo.layerId,
            screenId: instance.selectedLayerInfo.screenId,
            enable,
          }),
        );
      },
    },
    source_switch: {
      name: 'Source',
      description:
        'Invoke the command to switch the selected source to that of the selected layer displayed on the selected screen.',
      options: [
        {
          type: 'dropdown',
          name: 'Source List',
          label: 'Source List',
          id: 'id',
          default: sourceListDropDown[0]?.id ?? null,
          choices: sourceListDropDown,
        },
      ],
      callback: async (action) => {
        const { id } = action.options;
        const source = instance.sourceList?.find((_item) => id === `${_item.inputId}_${_item.cropId}`);
        instance.selectedSourceId = id;
        instance.checkAllFeedbacks();
        if (!source || !instance.selectedLayerInfo) return;
        instance.safeSend(
          handleParams(ACTIONS_CMD.source_switch, {
            inputId: source.inputId,
            sourceType: source.sourceType,
            interfaceType: source.interfaceType,
            slotId: source.slotId,
            templateId: 0,
            cropId: source.cropId,
            streamId: source.streamId,
            screenId: instance.selectedLayerInfo.screenId,
            layerId: instance.selectedLayerInfo.layerId,
          }),
        );
      },
    },
    // ---- Per-connector test pattern (protocol V1.0.20 section 4.7.1) ----
    // W0303 is addressed by outputId, i.e. one physical output connector. The
    // older test_pattern_switch action fans the same pattern out across every
    // connector of the selected screens; this one targets exactly one.
    test_pattern_connector: {
      name: 'Test Pattern (Per Connector)',
      description:
        'Set the test pattern on one physical output connector. Spacing/Speed/Brightness match the sliders on the device panel.',
      options: [
        {
          type: 'dropdown',
          label: 'Output Connector',
          id: 'outputId',
          default: outputConnectorDropDown[0]?.id ?? 0,
          choices: outputConnectorDropDown.length
            ? outputConnectorDropDown
            : [{ id: 0, label: '(waiting for device data...)' }],
          allowCustom: true,
          tooltip: 'Discovered from the screen configuration. Only assigned connectors are listed.',
        },
        {
          type: 'dropdown',
          label: 'Pattern',
          id: 'testPattern',
          default: 0xffff,
          choices: TEST_PATTERNS,
        },
        {
          type: 'number',
          label: 'Spacing',
          id: 'grid',
          default: 5,
          min: 0,
          max: 7,
          tooltip: 'Grid/line density, 0-7. Shown as "Spacing" on the device panel. Only affects line and grid patterns.',
        },
        {
          type: 'number',
          label: 'Speed',
          id: 'speed',
          default: 3,
          min: 0,
          max: 3,
          tooltip: 'Motion speed, 0-3. Only affects the moving line and grid patterns.',
        },
        {
          type: 'number',
          label: 'Brightness',
          id: 'bright',
          default: 3,
          min: 0,
          max: 3,
          tooltip: 'Test pattern brightness, 0-3.',
        },
      ],
      callback: async (event) => {
        const outputId = Number(event.options.outputId);
        if (!Number.isFinite(outputId)) {
          instance.log('warn', 'Test Pattern (Per Connector): no output connector selected');
          return;
        }
        const testPattern = Number(event.options.testPattern);
        const payload = {
          outputId,
          testPattern,
          bright: Math.max(0, Math.min(3, Number(event.options.bright) || 0)),
          grid: Math.max(0, Math.min(7, Number(event.options.grid) || 0)),
          speed: Math.max(0, Math.min(3, Number(event.options.speed) || 0)),
        };
        instance.setConnectorTestPattern(outputId, testPattern);
        instance.safeSend(handleParams(ACTIONS_CMD.test_pattern_switch, payload));
      },
    },
    // ---- Test pattern across a whole screen, or every screen at once ----
    // W0303 addresses one connector, so a screen-wide pattern means one command
    // per connector. With the R0300 inventory we know exactly which connectors
    // belong to which screen, so this fans out in one press -- useful for
    // flashing a whole wall for alignment and killing it again just as fast.
    test_pattern_screen: {
      name: 'Test Pattern (Screen / All Screens)',
      description:
        'Set the same test pattern on every output connector of a screen, or of every screen at once. Sends one W0303 per connector.',
      options: [
        {
          type: 'dropdown',
          label: 'Target',
          id: 'target',
          default: 'all',
          choices: [
            { id: 'all', label: 'All Screens' },
            { id: 'sending', label: 'All Sending Cards' },
            ...screenListDropDown,
          ],
          tooltip:
            'All Screens covers every connector assigned to a screen. All Sending Cards covers every connector on a card the device reports as a sending card, assigned or not.',
        },
        {
          type: 'dropdown',
          label: 'Pattern',
          id: 'testPattern',
          default: 0xffff,
          choices: TEST_PATTERNS,
        },
        { type: 'number', label: 'Spacing', id: 'grid', default: 3, min: 0, max: 7,
          tooltip: 'Grid/line density, 0-7. Shown as "Spacing" on the device panel.' },
        { type: 'number', label: 'Speed', id: 'speed', default: 2, min: 0, max: 3,
          tooltip: 'Motion speed, 0-3. Only affects the moving patterns.' },
        { type: 'number', label: 'Brightness', id: 'bright', default: 2, min: 0, max: 3 },
      ],
      callback: async (event) => {
        const target = event.options.target;
        const testPattern = Number(event.options.testPattern);
        const bright = Math.max(0, Math.min(3, Number(event.options.bright) || 0));
        const grid = Math.max(0, Math.min(7, Number(event.options.grid) || 0));
        const speed = Math.max(0, Math.min(3, Number(event.options.speed) || 0));

        const all = Object.values(instance.outputConnectors ?? {});
        const targets =
          target === 'all'
            ? all.filter((c) => c.screenId !== undefined)
            : target === 'sending'
              ? // cardType 3 = Sender, per protocol 4.3.2. These are the cards
                // driving LED panels, as opposed to plain monitor outputs.
                all.filter((c) => instance.slotCardTypes?.[c.slotId] === 3)
              : all.filter((c) => c.screenId === Number(target));

        if (!targets.length) {
          instance.log(
            'warn',
            'Test Pattern (Screen): no output connectors known yet for that target. Wait for the device to report its screen configuration.',
          );
          return;
        }

        for (const c of targets) {
          instance.setConnectorTestPattern(c.outputId, testPattern);
          instance.safeSend(
            handleParams(ACTIONS_CMD.test_pattern_switch, {
              outputId: c.outputId,
              testPattern,
              bright,
              grid,
              speed,
            }),
          );
        }
        instance.log(
          'debug',
          `Test pattern ${testPattern} sent to ${targets.length} connector(s): ${targets.map((c) => c.outputId).join(', ')}`,
        );
      },
    },
    test_pattern_switch: {
      name: 'Test Pattern',
      description: 'On/Off; turn on or turn off the test pattern for the selected screen.',
      options: [
        {
          type: 'dropdown',
          label: 'testPattern',
          name: 'testPattern',
          id: 'testPattern',
          default: TEST_PATTERN_TYPE.OPEN,
          choices: [
            {
              id: TEST_PATTERN_TYPE.OPEN,
              label: 'open',
            },
            {
              id: TEST_PATTERN_TYPE.CLOSE,
              label: 'close',
            },
          ],
        },
      ],
      callback: async (action) => {
        const { testPattern } = action.options;
        instance.testPattern = testPattern === TEST_PATTERN_TYPE.OPEN;
        instance.checkAllFeedbacks();
        //目前的协议只支持遍历通过接口修改测试画面，后续协议支持按照屏幕修改后调整
        for (const screenId of instance.selectedScreenList) {
          const requests = [];
          let validInterfaces = [];
          requests.push(
            {
              cmd: ACTIONS_CMD.apply_screen_details,
              params: { param0: 0, param1: screenId },
            },
            {
              cmd: ACTIONS_CMD.get_output_details,
              processParams: (results, idx) => {
                const detail = results[idx - 1]?.data || {};
                // 遍历 screenInterfaces 找到 outputId 不是 255 的项
                validInterfaces = detail?.outputMode?.screenInterfaces?.filter(
                  (screenInterface) => screenInterface.outputId !== 255,
                );
                //查询某一个接口的详情，用于下发的bright、grid、speed回填参数
                const outputId = validInterfaces[0]?.outputId;
                return {
                  param0: 0,
                  param1: outputId,
                };
              },
            },
            {
              cmd: ACTIONS_CMD.test_pattern_switch,
              processParams: (results, idx) => {
                const detail = results[idx - 1]?.data || {};
                return validInterfaces.map((item) => ({
                  bright: detail?.testPattern?.bright,
                  grid: detail?.testPattern?.grid,
                  outputId: item.outputId,
                  speed: detail?.testPattern?.speed,
                  testPattern,
                }));
              },
            },
          );
          await sendUDPRequestsSync(instance, requests);
        }
      },
    },
    bkg_switch: {
      name: 'BKG',
      description: 'On/Off; turn on or turn off the BKG function for the selected screen.',
      options: [
        {
          type: 'dropdown',
          name: 'BKG Status',
          label: 'BKG Status',
          id: 'enable',
          default: 1,
          choices: [
            {
              id: 1,
              label: 'On',
            },
            {
              id: 0,
              label: 'Off',
            },
          ],
        },
      ],
      callback: (action) => {
        const { enable } = action.options;
        instance.bkgEnable = !!enable;
        instance.checkAllFeedbacks();
        if (!instance.selectedScreenList?.length) {
          // These are the legacy "select screen first" actions. Silently doing
          // nothing is indistinguishable from a broken device, so say so.
          instance.log('warn', 'No screen selected. Use Select Screen first, or use the per-screen (Direct) action instead.');
          return;
        }
        const requests = [];
        instance.selectedScreenList?.forEach((screenId) => {
          requests.push(
            {
              cmd: ACTIONS_CMD.apply_screen_details,
              params: { param0: 0, param1: screenId },
            },
            {
              cmd: ACTIONS_CMD.bkg_switch,
              processParams: (results, idx) => {
                const detailRes = results[idx - 1]?.data || {};
                return {
                  screenId,
                  enable,
                  bkgId: detailRes.Bkg?.bkgId ?? 0,
                };
              },
            },
          );
        });
        sendUDPRequestsSync(instance, requests);
      },
    },
    osd_switch: {
      name: 'OSD',
      description: 'On/Off; turn on or turn off the OSD function for the selected screen.',
      options: [
        {
          type: 'dropdown',
          name: 'OSD Status',
          label: 'OSD Status',
          id: 'enable',
          default: 1,
          choices: [
            {
              id: 1,
              label: 'On',
            },
            {
              id: 0,
              label: 'Off',
            },
          ],
        },
        {
          type: 'dropdown',
          name: 'OSD Type',
          label: 'OSD Type',
          id: 'osdType',
          default: 'text',
          choices: [
            {
              id: 'text',
              label: 'OSD Text',
            },
            {
              id: 'image',
              label: 'OSD Image',
            },
          ],
        },
      ],
      callback: (action) => {
        const { enable, osdType } = action.options;
        if (osdType === 'image') {
          instance.imgOsdEnable = !!enable;
        } else {
          instance.textOsdEnable = !!enable;
        }
        instance.checkAllFeedbacks();
        if (!instance.selectedScreenList?.length) {
          // These are the legacy "select screen first" actions. Silently doing
          // nothing is indistinguishable from a broken device, so say so.
          instance.log('warn', 'No screen selected. Use Select Screen first, or use the per-screen (Direct) action instead.');
          return;
        }
        const requests = [];
        instance.selectedScreenList?.forEach((screenId) => {
          requests.push(
            {
              cmd: ACTIONS_CMD.apply_screen_details,
              params: { param0: 0, param1: screenId },
            },
            {
              cmd: ACTIONS_CMD.osd_switch,
              processParams: (results, idx) => {
                const detailRes = results[idx - 1]?.data || {};
                return {
                  ...(osdType === 'image' ? detailRes.OsdImage : detailRes.Osd),
                  enable,
                  screenId,
                };
              },
            },
          );
        });
        sendUDPRequestsSync(instance, requests);
      },
    },
    // Save current screen brightness to the LED receiving card hardware (W0417)
    // so the brightness setting persists across a power cycle.
    save_brightness: {
      name: 'Save Brightness',
      description: 'Save the current screen brightness to the LED receiving card hardware so it survives a reboot.',
      options: [
        {
          type: 'dropdown',
          name: 'Screen',
          label: 'Screen',
          id: 'screenId',
          default: screenListDropDown[0]?.id ?? null,
          choices: screenListDropDown,
        },
      ],
      callback: (event) => {
        const screenId = event.options.screenId;
        const command = handleParams(ACTIONS_CMD.save_screen_brightness, { screenId });
        instance.safeSend(command);
      },
    },
    // Global blackout (W0700). Distinct from per-screen FTB / black_screen —
    // this affects every screen on the device at once.
    blackout: {
      name: 'Blackout (Global)',
      description: 'Enable or disable a global blackout across every screen on the device. Distinct from per-screen FTB.',
      options: [
        {
          type: 'dropdown',
          name: 'State',
          label: 'State',
          id: 'state',
          default: 1,
          choices: [
            { id: 1, label: 'Enable' },
            { id: 0, label: 'Disable' },
          ],
        },
      ],
      callback: (event) => {
        const state = parseInt(event.options.state);
        const command = handleParams(ACTIONS_CMD.blackout, { blackout: state });
        instance.safeSend(command);
      },
    },
  };
};
