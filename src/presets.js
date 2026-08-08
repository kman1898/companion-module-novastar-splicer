import { combineRgb } from '@companion-module/base';
import { MODULE_NAME, PGM_PVW_TYPE, TEST_PATTERN_TYPE } from '../utils/constant.js';

// Fixed brightness levels (5% steps, 100→0). Shared between the per-level
// preset builder and the structure builder so the two never drift.
const BRIGHTNESS_LEVELS = [100, 95, 90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 0];

// Default cadence for the hold-to-ramp brightness buttons, in milliseconds per
// 1% step. This is emitted as an `internal:wait` Time value on the button, so
// the operator can change it per button without touching the module.
const BRIGHTNESS_RAMP_MS = 200;
// Ready-made test patterns across every sending card. Each is a two-step
// toggle: press once for the pattern, again for Off. These are the ones an
// LED tech actually reaches for - uniformity, dead pixels, geometry.
const GLOBAL_TEST_PATTERNS = [
  { id: 'white', label: 'White', pattern: 0x0004, text: 'Test\nWhite' },
  { id: 'black', label: 'Black', pattern: 0x0000, text: 'Test\nBlack' },
  { id: 'red', label: 'Red', pattern: 0x0001, text: 'Test\nRed' },
  { id: 'green', label: 'Green', pattern: 0x0002, text: 'Test\nGreen' },
  { id: 'blue', label: 'Blue', pattern: 0x0003, text: 'Test\nBlue' },
  { id: 'bars', label: 'Colour Bars', pattern: 0x0005, text: 'Test\nBars' },
  { id: 'checker', label: 'Checkerboard', pattern: 0x0007, text: 'Test\nCheck' },
  { id: 'grid', label: 'Grid', pattern: 0x0204, text: 'Test\nGrid' },
];


// =====================================================================// Screen-first preset layout with template groups
// =====================================================================
/** Build all preset definitions (flat map, keyed by unique ID) */
const buildAllPresets = (instance) => {
  const presets = {};

  // ---- Screen Selection presets (one per screen, stays simple) ----
  instance.screenList?.forEach((screen) => {
    const { name, screenId } = screen;
    presets[`screen_${screenId}`] = {
      type: 'simple',
      name,
      style: {
        text: `Select\n$(${MODULE_NAME}:screenId_${screenId})`,
        size: '18',
        color: combineRgb(255, 255, 255),
        bgcolor: combineRgb(0, 0, 0),
      },
      feedbacks: [
        {
          feedbackId: 'screen_selected',
          options: { screenId },
          style: { bgcolor: combineRgb(0, 255, 0), color: combineRgb(0, 0, 0) },
        },
      ],
      steps: [
        { down: [{ actionId: 'select_screen', options: { screenId, enable: 1 } }], up: [] },
        { down: [{ actionId: 'select_screen', options: { screenId, enable: 0 } }], up: [] },
      ],
    };
  });

  // ---- Preset Recall (one preset per scene, real scene name baked in) ----
  // A Companion template can only substitute a numeric value into the button
  // text, never the per-value name, so a template would show "Preset 2" rather
  // than the scene name. Generate one simple preset per scene instead (matching
  // the millumin per-item pattern) so the real name is shown.
  instance.screenList?.forEach((screen) => {
    const { screenId } = screen;
    (screen.presets || []).forEach((p) => {
      const presetId = p.presetId;
      const label = p.name || `Preset ${presetId + 1}`;
      const combineId = `${screenId}_${presetId}`;
      presets[`preset_recall_${screenId}_${presetId}`] = {
        type: 'simple',
        name: label,
        style: {
          text: `$(${MODULE_NAME}:screenId_${screenId})\n$(${MODULE_NAME}:screenId_${screenId}_presetId_${presetId})`,
          size: 'auto',
          color: combineRgb(255, 255, 255),
          bgcolor: combineRgb(0, 0, 0),
        },
        feedbacks: [
          {
            feedbackId: 'preset_loaded',
            options: { combineId },
            style: { bgcolor: combineRgb(0, 255, 0), color: combineRgb(0, 0, 0) },
          },
        ],
        steps: [
          { down: [{ actionId: 'load_preset', options: { combineId } }], up: [] },
        ],
      };
    });
  });

  // ---- Layer Selection (one preset per layer, real layer name baked in) ----
  // Same reasoning as Preset Recall: a template can't render the per-layer
  // name, so generate one simple preset per layer with the real name.
  instance.screenList?.forEach((screen) => {
    const { screenId } = screen;
    (screen.layers || []).forEach((l) => {
      const layerId = l.layerId;
      const label = l.name || `Layer ${layerId + 1}`;
      const combineId = `${screenId}_${layerId}`;
      presets[`layer_select_${screenId}_${layerId}`] = {
        type: 'simple',
        name: label,
        style: {
          text: `$(${MODULE_NAME}:screenId_${screenId})\n$(${MODULE_NAME}:screenId_${screenId}_layerId_${layerId})`,
          size: 'auto',
          color: combineRgb(255, 255, 255),
          bgcolor: combineRgb(0, 0, 0),
        },
        feedbacks: [
          {
            feedbackId: 'layer_selected',
            options: { combineId },
            style: { bgcolor: combineRgb(0, 255, 0), color: combineRgb(0, 0, 0) },
          },
        ],
        steps: [
          { down: [{ actionId: 'select_layer', options: { combineId, enable: 1 } }], up: [] },
          { down: [{ actionId: 'select_layer', options: { combineId, enable: 0 } }], up: [] },
        ],
      };
    });
  });

  // ---- Brightness fixed levels (one preset per level, literal % baked in) ----
  // A template would preview the local-variable startup value (100%) for every
  // entry in the preset library; individual presets show each level's real %
  // in the library and on the button. Matches the parent / pre-template module.
  instance.screenList?.forEach((screen) => {
    const { name, screenId } = screen;
    BRIGHTNESS_LEVELS.forEach((pct) => {
      presets[`set_bright_${screenId}_${pct}`] = {
        type: 'simple',
        name: `${name} Brightness ${pct}%`,
        style: {
          text: `$(${MODULE_NAME}:screenId_${screenId})\n${pct}%`,
          size: 'auto',
          color: combineRgb(255, 255, 255),
          bgcolor: combineRgb(0, 0, 0),
        },
        feedbacks: [
          {
            feedbackId: 'brightness_match',
            options: { screenId, brightness: String(pct) },
            style: { bgcolor: combineRgb(0, 255, 0), color: combineRgb(0, 0, 0) },
          },
        ],
        steps: [
          {
            down: [
              { actionId: 'set_brightness', options: { screenId, brightness: String(pct) } },
              { actionId: 'save_brightness', options: { screenId }, delay: 100 },
            ],
            up: [],
          },
        ],
      };
    });
  });

  // ---- Per-screen Brightness +/- (stays simple, not templatable) ----
  instance.screenList?.forEach((screen) => {
    const { name, screenId } = screen;

    // Hold to ramp: press starts a continuous ramp (one immediate step so a
    // quick tap still nudges 1%), release stops it. The module drives the repeat
    // internally with a timer. This replaced an internal:logicWhile version --
    // that has no working precedent in any shipping module and did not run.
    const holdRampStep = (actionId) => ({
      down: [{ actionId, options: { screenId, ms: BRIGHTNESS_RAMP_MS } }],
      up: [{ actionId: 'brightness_ramp_stop', options: { screenId } }],
    });

    presets[`direct_bright_up_${screenId}`] = {
      type: 'simple',
      name: `${name} Brightness +`,
      style: { text: `$(${MODULE_NAME}:screenId_${screenId})\nBright +`, size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
      steps: [holdRampStep('brightness_ramp_up')],
      feedbacks: [],
    };

    presets[`direct_bright_down_${screenId}`] = {
      type: 'simple',
      name: `${name} Brightness -`,
      style: { text: `$(${MODULE_NAME}:screenId_${screenId})\nBright -`, size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
      steps: [holdRampStep('brightness_ramp_down')],
      feedbacks: [],
    };

    // Brightness readout as a LAYERED preset with a native `gauge` element
    // (API 2.1 / Companion 5.0). This replaces the old advanced feedback that
    // returned an imageBuffer, which Companion now marks deprecated. The gauge
    // reads the live brightness variable via an expression, so it needs no
    // feedback at all and stays resolution independent.
    //
    // Drawn as a RING rather than a bar: a ring wraps the edge and frees the
    // whole centre for a large, readable value, and on surfaces with LED rings
    // (Stream Deck+ dials) Companion drives the physical ring from the same
    // colour model, so the hardware matches the screen.
    const brightnessVar = `$(${MODULE_NAME}:screen_${screenId + 1}_brightness)`;
    const brightBarLayered = {
      type: 'layered',
      name: `${name} Brightness Ring`,
      canvas: { decoration: 'none' },
      elements: [
        {
          // squareCoords keeps the ring circular on non-square keys instead of
          // stretching it into an oval.
          id: 'ring_group',
          name: 'Ring',
          type: 'group',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          squareCoords: true,
          children: [
            {
              id: 'brightness_gauge',
              name: 'Brightness',
              type: 'gauge',
              x: 6,
              y: 6,
              width: 88,
              height: 88,
              min: 0,
              max: 100,
              value: { isExpression: true, value: brightnessVar },
              // Arc with a gap at the bottom, so the ring reads as a gauge and
              // leaves room for the screen name underneath.
              orientation: 'ring',
              startAngle: 215,
              endAngle: 145,
              ringWidth: 15,
              roundedEnds: true,
              fillEnabled: true,
              // Dim-to-bright ramp: the arc both grows and brightens as the
              // level rises. multiColour shows every stop inside the filled
              // portion, and gradient blends between them rather than stepping.
              multiColour: true,
              stops: [
                { value: 0, color: combineRgb(0, 45, 20), gradient: true },
                { value: 50, color: combineRgb(0, 150, 60), gradient: true },
                { value: 100, color: combineRgb(90, 255, 140), gradient: false },
              ],
              // Set trackAmount explicitly: Companion defaults it to 70 when a
              // preset is imported but to 30 when an element is added in the UI,
              // so relying on the default gives two different looks.
              trackStyle: 'dimmed',
              trackAmount: 25,
            },
          ],
        },
        {
          // Big value in the middle of the ring.
          id: 'value',
          name: 'Value',
          type: 'text',
          x: 0,
          y: 26,
          width: 100,
          height: 38,
          text: { isExpression: true, value: `concat(${brightnessVar}, "%")` },
          fontsize: 100,
          fontsizeAllowShrink: true,
          color: combineRgb(255, 255, 255),
          halign: 'center',
          valign: 'center',
        },
        {
          // Screen name tucked into the gap at the bottom of the arc.
          id: 'label',
          name: 'Label',
          type: 'text',
          x: 0,
          y: 64,
          width: 100,
          height: 24,
          text: `$(${MODULE_NAME}:screenId_${screenId})`,
          fontsize: 55,
          fontsizeAllowShrink: true,
          color: combineRgb(170, 170, 170),
          halign: 'center',
          valign: 'center',
        },
      ],
      steps: [{ down: [], up: [] }],
      feedbacks: [],
    };

    // Ship the gauge with a plain-text fallback under `alternatives`. Companion
    // renders the first variant it can; hosts that cannot draw layered buttons
    // (e.g. Bitfocus Buttons) fall back to the simple one instead of losing the
    // preset entirely. Both read the same brightness variable.
    presets[`bright_bar_${screenId}`] = {
      type: 'alternatives',
      variants: [
        brightBarLayered,
        {
          type: 'simple',
          name: `${name} Brightness Ring`,
          style: {
            text: `$(${MODULE_NAME}:screenId_${screenId})\n${brightnessVar}%`,
            size: 'auto',
            color: combineRgb(255, 255, 255),
            bgcolor: combineRgb(0, 0, 0),
          },
          steps: [{ down: [], up: [] }],
          feedbacks: [],
        },
      ],
    };
  });

  // ---- Preset Collection (Group) presets ----
  instance.presetCollectionList?.forEach(({ name, presetCollectionId }) => {
    presets[`preset_group_${presetCollectionId}`] = {
      type: 'simple',
      name,
      style: {
        text: `$(${MODULE_NAME}:presetCollectionId_${presetCollectionId})`,
        size: 'auto',
        color: combineRgb(255, 255, 255),
        bgcolor: combineRgb(0, 0, 0),
      },
      steps: [
        { down: [{ actionId: 'play_preset_collection', options: { presetCollectionId } }], up: [] },
      ],
      feedbacks: [
        {
          feedbackId: 'preset_group_selected',
          options: { presetCollectionId },
          style: { bgcolor: combineRgb(0, 255, 0), color: combineRgb(0, 0, 0) },
        },
      ],
    };
  });

  // ---- Source List presets ----
  instance.sourceList?.forEach(({ name, inputId, cropId }) => {
    presets[`source_${inputId}_${cropId}`] = {
      type: 'simple',
      name,
      style: {
        text: `$(${MODULE_NAME}:source_${inputId}_${cropId})`,
        size: '12',
        color: combineRgb(255, 255, 255),
        bgcolor: combineRgb(0, 0, 0),
      },
      steps: [
        { down: [{ actionId: 'source_switch', options: { id: `${inputId}_${cropId}` } }], up: [] },
      ],
      feedbacks: [
        {
          feedbackId: 'source_switch_selected',
          options: { id: `${inputId}_${cropId}` },
          style: { bgcolor: combineRgb(0, 255, 0), color: combineRgb(0, 0, 0) },
        },
      ],
    };
  });

  // ---- Global Display controls ----
  presets['pgm_pvw_switch'] = {
    type: 'simple',
    name: 'PGM/PVW',
    style: { text: 'PGM/PVW', size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
    steps: [
      { down: [{ actionId: 'pgm_pvw_switch', options: { enNonTime: 0 } }], up: [] },
      { down: [{ actionId: 'pgm_pvw_switch', options: { enNonTime: 1 } }], up: [] },
    ],
    feedbacks: [
      { feedbackId: 'pgm_pvw_switch', options: { type: PGM_PVW_TYPE.PGM }, style: { bgcolor: combineRgb(0, 255, 0), color: combineRgb(0, 0, 0), text: 'PGM' } },
      { feedbackId: 'pgm_pvw_switch', options: { type: PGM_PVW_TYPE.PVW }, style: { bgcolor: combineRgb(255, 0, 0), color: combineRgb(0, 0, 0), text: 'PVW' } },
    ],
  };

  presets['take_apply'] = {
    type: 'simple',
    name: 'Take',
    style: { text: 'Take', size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
    steps: [
      { down: [{ actionId: 'take_switch', options: { manualPlay: 1 } }], up: [] },
      { down: [{ actionId: 'take_switch', options: { manualPlay: 0 } }], up: [] },
    ],
    feedbacks: [
      { feedbackId: 'pvw_take_selected', options: {}, style: { bgcolor: combineRgb(0, 255, 0), color: combineRgb(0, 0, 0) } },
    ],
  };

  presets['ftb_global'] = {
    type: 'simple',
    name: 'FTB',
    style: { text: 'FTB', size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
    steps: [
      { down: [{ actionId: 'apply_ftb', options: { type: 0 } }], up: [] },
      { down: [{ actionId: 'apply_ftb', options: { type: 1 } }], up: [] },
    ],
    feedbacks: [
      { feedbackId: 'ftb_selected', options: {}, style: { bgcolor: combineRgb(255, 0, 0), color: combineRgb(0, 0, 0) } },
    ],
  };

  presets['volume_switch'] = {
    type: 'simple',
    name: 'Volume Switch',
    style: { text: 'Volume\nSwitch', size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
    steps: [
      { down: [{ actionId: 'apply_volume_switch', options: { isMute: 0 } }], up: [] },
      { down: [{ actionId: 'apply_volume_switch', options: { isMute: 1 } }], up: [] },
    ],
    feedbacks: [
      { feedbackId: 'volume_switch_selected', options: {}, style: { bgcolor: combineRgb(0, 255, 0), color: combineRgb(0, 0, 0) } },
    ],
  };

  presets['screen_frz_global'] = {
    type: 'simple',
    name: 'Screen FRZ',
    style: { text: 'Screen\nFRZ', size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
    steps: [
      { down: [{ actionId: 'screen_frz_toggle', options: { enable: 1 } }], up: [] },
      { down: [{ actionId: 'screen_frz_toggle', options: { enable: 0 } }], up: [] },
    ],
    feedbacks: [
      { feedbackId: 'screen_frz', options: {}, style: { bgcolor: combineRgb(255, 0, 0), color: combineRgb(0, 0, 0) } },
    ],
  };

  presets['layer_frz_global'] = {
    type: 'simple',
    name: 'Layer FRZ',
    style: { text: 'Layer\nFRZ', size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
    steps: [
      { down: [{ actionId: 'layer_frz_toggle', options: { enable: 1 } }], up: [] },
      { down: [{ actionId: 'layer_frz_toggle', options: { enable: 0 } }], up: [] },
    ],
    feedbacks: [
      { feedbackId: 'layer_frz', options: {}, style: { bgcolor: combineRgb(255, 0, 0), color: combineRgb(0, 0, 0) } },
    ],
  };

  presets['volume_add'] = {
    type: 'simple',
    name: 'Volume +',
    style: { text: 'Volume\n+', size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
    steps: [{ down: [{ actionId: 'screen_volume_add', options: {} }], up: [] }],
    feedbacks: [],
  };

  presets['volume_minus'] = {
    type: 'simple',
    name: 'Volume -',
    style: { text: 'Volume\n-', size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
    steps: [{ down: [{ actionId: 'screen_volume_minus', options: {} }], up: [] }],
    feedbacks: [],
  };

  presets['brightness_add_global'] = {
    type: 'simple',
    name: 'Brightness +',
    style: { text: 'Brightness\n+', size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
    steps: [{ down: [{ actionId: 'screen_brightness_add', options: {} }], up: [] }],
    feedbacks: [],
  };

  presets['brightness_minus_global'] = {
    type: 'simple',
    name: 'Brightness -',
    style: { text: 'Brightness\n-', size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
    steps: [{ down: [{ actionId: 'screen_brightness_minus', options: {} }], up: [] }],
    feedbacks: [],
  };

  for (const tp of GLOBAL_TEST_PATTERNS) {
    presets[`test_pattern_${tp.id}`] = {
      type: 'simple',
      name: `Test Pattern: ${tp.label} (All Sending Cards)`,
      style: { text: tp.text, size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
      steps: [
        { down: [{ actionId: 'test_pattern_screen', options: { target: 'sending', testPattern: tp.pattern, grid: 3, speed: 2, bright: 2 } }], up: [] },
        { down: [{ actionId: 'test_pattern_screen', options: { target: 'sending', testPattern: 0xffff, grid: 3, speed: 2, bright: 2 } }], up: [] },
      ],
      feedbacks: [],
    };
  }

  presets['test_pattern_global'] = {
    type: 'simple',
    name: 'Test Pattern (All Sending Cards)',
    style: { text: 'Test\nPattern', size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
    steps: [
      { down: [{ actionId: 'test_pattern_screen', options: { target: 'sending', testPattern: 0x0004, grid: 3, speed: 2, bright: 2 } }], up: [] },
      { down: [{ actionId: 'test_pattern_screen', options: { target: 'sending', testPattern: 0xffff, grid: 3, speed: 2, bright: 2 } }], up: [] },
    ],
    feedbacks: [
      { feedbackId: 'test_pattern_selected', options: {}, style: { bgcolor: combineRgb(0, 255, 0), color: combineRgb(0, 0, 0) } },
    ],
  };

  presets['bkg_global'] = {
    type: 'simple',
    name: 'BKG',
    style: { text: 'BKG', size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
    steps: [
      { down: [{ actionId: 'bkg_switch', options: { enable: 1 } }], up: [] },
      { down: [{ actionId: 'bkg_switch', options: { enable: 0 } }], up: [] },
    ],
    feedbacks: [
      { feedbackId: 'bkg_switch', options: {}, style: { bgcolor: combineRgb(0, 255, 0), color: combineRgb(0, 0, 0) } },
    ],
  };

  presets['osd_text_global'] = {
    type: 'simple',
    name: 'OSD Text',
    style: { text: 'OSD\nText', size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
    steps: [
      { down: [{ actionId: 'osd_switch', options: { enable: 1, osdType: 'text' } }], up: [] },
      { down: [{ actionId: 'osd_switch', options: { enable: 0, osdType: 'text' } }], up: [] },
    ],
    feedbacks: [
      { feedbackId: 'osd_switch', options: { osdType: 'text' }, style: { bgcolor: combineRgb(0, 255, 0), color: combineRgb(0, 0, 0) } },
    ],
  };

  presets['osd_image_global'] = {
    type: 'simple',
    name: 'OSD Image',
    style: { text: 'OSD\nImage', size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
    steps: [
      { down: [{ actionId: 'osd_switch', options: { enable: 1, osdType: 'image' } }], up: [] },
      { down: [{ actionId: 'osd_switch', options: { enable: 0, osdType: 'image' } }], up: [] },
    ],
    feedbacks: [
      { feedbackId: 'osd_switch', options: { osdType: 'image' }, style: { bgcolor: combineRgb(0, 255, 0), color: combineRgb(0, 0, 0) } },
    ],
  };

  // ---- Global Blackout ----
  presets['blackout_global'] = {
    type: 'simple',
    name: 'Blackout',
    style: { text: 'BLACKOUT', size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
    steps: [
      { down: [{ actionId: 'blackout', options: { state: 1 } }], up: [] },
      { down: [{ actionId: 'blackout', options: { state: 0 } }], up: [] },
    ],
    feedbacks: [],
  };

  // ---- Per-screen direct controls (not templatable - each is unique) ----
  instance.screenList?.forEach((screen) => {
    const { name, screenId } = screen;

    presets[`direct_pgm_pvw_${screenId}`] = {
      type: 'simple',
      name: `${name} PGM/PVW`,
      style: { text: `$(${MODULE_NAME}:screenId_${screenId})\nPGM/PVW`, size: '14', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
      steps: [
        { down: [{ actionId: 'select_screen', options: { screenId, enable: 1 } }, { actionId: 'pgm_pvw_switch', options: { enNonTime: 0 } }], up: [] },
        { down: [{ actionId: 'select_screen', options: { screenId, enable: 1 } }, { actionId: 'pgm_pvw_switch', options: { enNonTime: 1 } }], up: [] },
      ],
      feedbacks: [
        { feedbackId: 'pgm_pvw_switch', options: { type: PGM_PVW_TYPE.PGM }, style: { bgcolor: combineRgb(0, 255, 0), color: combineRgb(0, 0, 0), text: `$(${MODULE_NAME}:screenId_${screenId})\nPGM` } },
        { feedbackId: 'pgm_pvw_switch', options: { type: PGM_PVW_TYPE.PVW }, style: { bgcolor: combineRgb(255, 0, 0), color: combineRgb(0, 0, 0), text: `$(${MODULE_NAME}:screenId_${screenId})\nPVW` } },
      ],
    };

    presets[`direct_take_${screenId}`] = {
      type: 'simple',
      name: `${name} Take`,
      style: { text: `$(${MODULE_NAME}:screenId_${screenId})\nTake`, size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
      steps: [
        { down: [{ actionId: 'select_screen', options: { screenId, enable: 1 } }, { actionId: 'take_switch', options: { manualPlay: 1 } }], up: [] },
        { down: [{ actionId: 'select_screen', options: { screenId, enable: 1 } }, { actionId: 'take_switch', options: { manualPlay: 0 } }], up: [] },
      ],
      feedbacks: [
        { feedbackId: 'pvw_take_selected', options: {}, style: { bgcolor: combineRgb(0, 255, 0), color: combineRgb(0, 0, 0) } },
      ],
    };

    presets[`direct_ftb_${screenId}`] = {
      type: 'simple',
      name: `${name} FTB`,
      style: { text: `$(${MODULE_NAME}:screenId_${screenId})\nFTB`, size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
      steps: [
        { down: [{ actionId: 'ftb_direct', options: { screenId, state: 1 } }], up: [] },
        { down: [{ actionId: 'ftb_direct', options: { screenId, state: 0 } }], up: [] },
      ],
      feedbacks: [
        { feedbackId: 'ftb_direct', options: { screenId }, style: { bgcolor: combineRgb(255, 0, 0), color: combineRgb(255, 255, 255) } },
      ],
    };

    presets[`direct_freeze_${screenId}`] = {
      type: 'simple',
      name: `${name} Freeze`,
      style: { text: `$(${MODULE_NAME}:screenId_${screenId})\nFreeze`, size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
      steps: [
        { down: [{ actionId: 'freeze_direct', options: { screenId, state: 1 } }], up: [] },
        { down: [{ actionId: 'freeze_direct', options: { screenId, state: 0 } }], up: [] },
      ],
      feedbacks: [
        { feedbackId: 'frozen_direct', options: { screenId }, style: { bgcolor: combineRgb(0, 0, 255), color: combineRgb(255, 255, 255) } },
      ],
    };

    presets[`direct_bkg_${screenId}`] = {
      type: 'simple',
      name: `${name} BKG`,
      style: { text: `$(${MODULE_NAME}:screenId_${screenId})\nBKG`, size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
      steps: [
        { down: [{ actionId: 'bkg_direct', options: { screenId, state: 1 } }], up: [] },
        { down: [{ actionId: 'bkg_direct', options: { screenId, state: 0 } }], up: [] },
      ],
      feedbacks: [
        { feedbackId: 'bkg_direct', options: { screenId }, style: { bgcolor: combineRgb(0, 255, 0), color: combineRgb(0, 0, 0) } },
      ],
    };

    presets[`direct_osd_text_${screenId}`] = {
      type: 'simple',
      name: `${name} OSD Text`,
      style: { text: `$(${MODULE_NAME}:screenId_${screenId})\nOSD Text`, size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
      steps: [
        { down: [{ actionId: 'osd_direct', options: { screenId, state: 1 } }], up: [] },
        { down: [{ actionId: 'osd_direct', options: { screenId, state: 0 } }], up: [] },
      ],
      feedbacks: [
        { feedbackId: 'osd_text_direct', options: { screenId }, style: { bgcolor: combineRgb(0, 255, 0), color: combineRgb(0, 0, 0) } },
      ],
    };

    presets[`direct_osd_image_${screenId}`] = {
      type: 'simple',
      name: `${name} OSD Image`,
      style: { text: `$(${MODULE_NAME}:screenId_${screenId})\nOSD Img`, size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
      steps: [
        { down: [{ actionId: 'osd_direct', options: { screenId, state: 1 } }], up: [] },
        { down: [{ actionId: 'osd_direct', options: { screenId, state: 0 } }], up: [] },
      ],
      feedbacks: [
        { feedbackId: 'osd_image_direct', options: { screenId }, style: { bgcolor: combineRgb(0, 255, 0), color: combineRgb(0, 0, 0) } },
      ],
    };

    // Test pattern for this screen. Uses the connector-aware action so it hits
    // every output of the screen, and defaults to White (a uniformity check)
    // rather than Black -- the legacy action's "on" value was 0x0000 = Black,
    // which is why the old button only ever toggled black and off.
    presets[`direct_test_${screenId}`] = {
      type: 'simple',
      name: `${name} Test Pattern`,
      style: { text: `$(${MODULE_NAME}:screenId_${screenId})\nTest`, size: 'auto', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 0, 0) },
      steps: [
        { down: [{ actionId: 'test_pattern_screen', options: { target: screenId, testPattern: 0x0004, grid: 3, speed: 2, bright: 2 } }], up: [] },
        { down: [{ actionId: 'test_pattern_screen', options: { target: screenId, testPattern: 0xffff, grid: 3, speed: 2, bright: 2 } }], up: [] },
      ],
      feedbacks: [
        { feedbackId: 'test_pattern_direct', options: { screenId }, style: { bgcolor: combineRgb(0, 255, 0), color: combineRgb(0, 0, 0) } },
      ],
    };
  });

  // ---- Input Signal status presets (one per real connector) ----
  // Generated from inputSignalState, which is only populated when input
  // signal polling is enabled. Info-only buttons; input_signal feedback
  // turns them green when the connector has an active signal.
  if (instance.config?.inputSignalPolling) {
    const keys = Object.keys(instance.inputSignalState ?? {}).sort();
    for (const inputKey of keys) {
      const m = inputKey.match(/^input_(\d+)_(\d+)$/);
      if (!m) continue;
      const slot = m[1];
      const conn = m[2];
      presets[`input_signal_${slot}_${conn}`] = {
        type: 'simple',
        name: `Input ${slot}-${conn} Signal`,
        style: {
          text: `In ${slot}-${conn}\n$(${MODULE_NAME}:${inputKey}_signal)`,
          size: 'auto',
          color: combineRgb(255, 255, 255),
          bgcolor: combineRgb(0, 0, 0),
        },
        steps: [{ down: [], up: [] }],
        feedbacks: [
          {
            feedbackId: 'input_signal',
            options: { inputKey },
            style: { bgcolor: combineRgb(0, 200, 0), color: combineRgb(0, 0, 0) },
          },
        ],
      };
    }
  }

  return presets;
};

// =====================================================================// STRUCTURE: Screen-first hierarchy with template groups
// =====================================================================
const buildStructure = (instance) => {
  const structure = [];
  const screens = instance.screenList || [];

  // Per-screen sections
  screens.forEach((screen) => {
    const { name, screenId } = screen;
    const groups = [];

    // Group order is deliberate and matches how operators reach for them during
    // a show: brightness first (most used), then scene recall, then the
    // per-screen controls, with selection/layers/test pattern further down.

    // 1. Brightness levels (one simple preset per level — each shows its own %)
    groups.push({
      id: `screen_${screenId}_brightness_levels`,
      type: 'simple',
      name: 'Brightness',
      keywords: ['brightness', 'dim', 'level', 'percent'],
      presets: BRIGHTNESS_LEVELS.map((pct) => `set_bright_${screenId}_${pct}`),
    });

    // 2. Brightness Adjust
    groups.push({
      id: `screen_${screenId}_brightness_adjust`,
      type: 'simple',
      name: 'Brightness Adjust',
      keywords: ['brightness', 'adjust', 'up', 'down', 'bar'],
      presets: [
        `direct_bright_up_${screenId}`,
        `direct_bright_down_${screenId}`,
        `bright_bar_${screenId}`,
      ],
    });

    // 3. Preset Recall (one simple preset per scene — real names baked in)
    const screenPresets = screen.presets || [];
    if (screenPresets.length > 0) {
      groups.push({
        id: `screen_${screenId}_presets`,
        type: 'simple',
        name: 'Preset Recall',
        keywords: ['preset', 'recall', 'scene', 'load'],
        presets: screenPresets.map((p) => `preset_recall_${screenId}_${p.presetId}`),
      });
    }

    // 4. Controls (simple - each is unique)
    groups.push({
      id: `screen_${screenId}_controls`,
      type: 'simple',
      name: 'Controls',
      keywords: ['pgm', 'pvw', 'take', 'ftb', 'freeze', 'background', 'osd', 'control'],
      presets: [
        `direct_pgm_pvw_${screenId}`,
        `direct_take_${screenId}`,
        `direct_ftb_${screenId}`,
        `direct_freeze_${screenId}`,
        `direct_bkg_${screenId}`,
        `direct_osd_text_${screenId}`,
        `direct_osd_image_${screenId}`,
      ],
    });

    // 5. Select Screen (simple - only one button)
    groups.push({
      id: `screen_${screenId}_select`,
      type: 'simple',
      name: 'Select Screen',
      keywords: ['select', 'screen'],
      presets: [`screen_${screenId}`],
    });

    // 6. Layers (one simple preset per layer — real names baked in)
    const screenLayers = screen.layers || [];
    if (screenLayers.length > 0) {
      groups.push({
        id: `screen_${screenId}_layers`,
        type: 'simple',
        name: 'Layers',
        keywords: ['layer', 'select'],
        presets: screenLayers.map((l) => `layer_select_${screenId}_${l.layerId}`),
      });
    }

    // 7. Test Pattern (simple - single button)
    groups.push({
      id: `screen_${screenId}_test_pattern`,
      type: 'simple',
      name: 'Test Pattern',
      keywords: ['test', 'pattern', 'test pattern', 'grid'],
      presets: [
        `direct_test_${screenId}`,
      ],
    });

    structure.push({
      id: `section_screen_${screenId}`,
      name: name,
      keywords: ['screen', `screen ${screenId + 1}`, name.toLowerCase()],
      definitions: groups,
    });
  });

  // Section: Global Display Controls
  structure.push({
    id: 'section_global',
    name: 'Global Display',
    keywords: ['global', 'display', 'transport', 'volume', 'brightness'],
    definitions: [
      {
        id: 'global_transport',
        type: 'simple',
        name: 'Transport',
        presets: ['pgm_pvw_switch', 'take_apply'],
      },
      {
        id: 'global_controls',
        type: 'simple',
        name: 'Controls',
        presets: [
          'ftb_global',
          'screen_frz_global',
          'layer_frz_global',
          'bkg_global',
          'osd_text_global',
          'osd_image_global',
        ],
      },
      {
        id: 'global_test_pattern',
        type: 'simple',
        name: 'Test Pattern',
        keywords: ['test', 'pattern', 'grid'],
        presets: ['test_pattern_global', ...GLOBAL_TEST_PATTERNS.map((t) => `test_pattern_${t.id}`)],
      },
      {
        id: 'global_volume',
        type: 'simple',
        name: 'Volume',
        presets: ['volume_switch', 'volume_add', 'volume_minus'],
      },
      {
        id: 'global_brightness',
        type: 'simple',
        name: 'Brightness',
        presets: ['brightness_add_global', 'brightness_minus_global'],
      },
      {
        id: 'global_blackout',
        type: 'simple',
        name: 'Blackout',
        keywords: ['blackout', 'all', 'off'],
        presets: ['blackout_global'],
      },
    ],
  });

  // Section: Preset Groups (flat list)
  const groupIds = (instance.presetCollectionList || []).map((g) => `preset_group_${g.presetCollectionId}`);
  if (groupIds.length > 0) {
    structure.push({
      id: 'section_preset_groups',
      name: 'Preset Groups',
      definitions: groupIds,
    });
  }

  // Section: Source List (flat list)
  const sourceIds = (instance.sourceList || []).map((s) => `source_${s.inputId}_${s.cropId}`);
  if (sourceIds.length > 0) {
    structure.push({
      id: 'section_sources',
      name: 'Source List',
      definitions: sourceIds,
    });
  }

  // Section: Input Signal (flat list, only when polling enabled)
  if (instance.config?.inputSignalPolling) {
    const inputSignalIds = Object.keys(instance.inputSignalState ?? {})
      .sort()
      .map((k) => {
        const m = k.match(/^input_(\d+)_(\d+)$/);
        return m ? `input_signal_${m[1]}_${m[2]}` : null;
      })
      .filter(Boolean);
    if (inputSignalIds.length > 0) {
      structure.push({
        id: 'section_input_signal',
        name: 'Input Signal',
        keywords: ['input', 'signal', 'source', 'active'],
        definitions: inputSignalIds,
      });
    }
  }

  return structure;
};

// =====================================================================// EXPORT
// =====================================================================
export const getPresetDefinitions = function (instance) {
  const presets = buildAllPresets(instance);
  const structure = buildStructure(instance);
  return { structure, presets };
};
