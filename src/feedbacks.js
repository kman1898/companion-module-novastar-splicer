import { combineRgb } from '@companion-module/base';
import { PGM_PVW_TYPE, TEST_PATTERNS } from '../utils/constant.js';
import formatDropDownData from '../utils/formatDropDown.js';

export const getFeedbacks = (instance) => {
  const {
    presetCollectionListDropDown,
    sourceListDropDown,
    presetDropDown,
    screenListDropDown,
    layerListDropDown,
    outputConnectorDropDown,
  } = formatDropDownData(instance);
  return {
    screen_selected: {
      type: 'boolean',
      name: 'Select Screen',
      description: 'Update button style when the screen is selected.',
      options: [
        {
          type: 'dropdown',
          name: 'Select Screen',
          label: 'Select Screen',
          id: 'screenId',
          default: screenListDropDown[0]?.id ?? null,
          choices: screenListDropDown,
        },
      ],
      callback: (event) => instance.selectedScreenList && instance.selectedScreenList.includes(event.options.screenId),
    },
    layer_selected: {
      type: 'boolean',
      name: 'Select Layer',
      description: 'Update button style when the layer is selected.',
      options: [
        {
          type: 'dropdown',
          name: 'Select Layer',
          label: 'Select Layer',
          id: 'combineId',
          default: layerListDropDown[0]?.id ?? null,
          choices: layerListDropDown,
        },
      ],
      callback: (event) => {
        // combineId defaults to null until the layer list has loaded (fresh
        // connection, or a device with no screens), so guard before splitting.
        if (!event.options.combineId) return false;
        const [screenId, layerId] = String(event.options.combineId).split('_').map((item) => Number(item));
        return (
          instance.selectedLayerInfo &&
          instance.selectedLayerInfo.screenId === screenId &&
          instance.selectedLayerInfo.layerId === layerId
        );
      },
    },
    screen_frz: {
      type: 'boolean',
      name: 'Freeze Screen',
      description: 'Update button style when the selected screen is frozen.',
      options: [],
      callback: () => instance.screenFRZState === 1,
    },
    layer_frz: {
      type: 'boolean',
      name: 'Freeze Layer',
      description: 'Update button style when the selected layer is frozen.',
      options: [],
      callback: () => instance.layerFRZState === 1,
    },
    pgm_pvw_switch: {
      type: 'boolean',
      name: 'PGM/PVW Status Detection',
      description: 'Update button style on PGM/PVW change.',
      options: [
        {
          type: 'dropdown',
          label: 'Model',
          id: 'type',
          default: PGM_PVW_TYPE.PGM,
          choices: [
            {
              id: PGM_PVW_TYPE.PGM,
              label: 'PGM',
            },
            {
              id: PGM_PVW_TYPE.PVW,
              label: 'PVW',
            },
          ],
        },
      ],
      callback: (event) =>
        (instance.pgmOrPvwActive.pgmActive && event.options.type === PGM_PVW_TYPE.PGM) ||
        (instance.pgmOrPvwActive.pvwActive && event.options.type === PGM_PVW_TYPE.PVW),
    },
    pvw_take_selected: {
      type: 'boolean',
      name: 'Take Status Detection',
      options: [],
      description: 'TUpdate button style when Take is selected.',
      callback: () => instance.pgmOrPvwActive.takeActive && instance.pgmOrPvwActive.pvwActive,
    },
    preset_group_selected: {
      type: 'boolean',
      name: 'Preset Group Selection Detection',
      description: 'Update button style when the new preset group is loaded.',
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
      callback: (event) => instance.selectedPresetCollectionId === event.options.presetCollectionId,
    },
    source_switch_selected: {
      type: 'boolean',
      name: 'Input Source Selection Detection',
      description: 'Update button style when the new preset group is loaded.',
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
      callback: (event) => instance.selectedSourceId === event.options.id,
    },
    ftb_selected: {
      type: 'boolean',
      name: 'FTB Status Detection',
      options: [],
      description: 'Update button style on FTB status change.',
      callback: () => instance.ftb,
    },
    volume_switch_selected: {
      type: 'boolean',
      name: 'Volume On/Off Status Detection',
      options: [],
      description: 'Update button style on volume status change.',
      callback: () => instance.volumeMute,
    },
    test_pattern_selected: {
      type: 'boolean',
      name: 'Test Pattern On/Off Status Detection',
      options: [],
      description: 'Update button style on test pattern status change.',
      callback: () => instance.testPattern,
    },
    bkg_switch: {
      type: 'boolean',
      name: 'BKG Status Detection',
      description: 'Update button style when BKG status is selected.',
      defaultStyle: {
        bgcolor: combineRgb(0, 255, 0),
        color: combineRgb(0, 0, 0),
      },
      options: [],
      callback: () => instance.bkgEnable,
    },
    osd_switch: {
      type: 'boolean',
      name: 'OSD Status Detection',
      description: 'Update button style when OSD status is selected.',
      defaultStyle: {
        bgcolor: combineRgb(0, 255, 0),
        color: combineRgb(0, 0, 0),
      },
      options: [
        {
          type: 'dropdown',
          label: 'OSD Type',
          id: 'osdType',
          default: 'text',
          choices: [
            { id: 'text', label: 'OSD Text' },
            { id: 'image', label: 'OSD Image' },
          ],
        },
      ],
      callback: (feedback) => {
        if (feedback.options.osdType === 'image') {
          return instance.imgOsdEnable;
        } else {
          return instance.textOsdEnable;
        }
      },
    },
    // Per-connector test pattern. Optimistic: reflects what this module last
    // set on that connector, since W0303 has no direct read-back.
    test_pattern_connector: {
      type: 'boolean',
      name: 'Test Pattern Active (Per Connector)',
      description: 'True when a test pattern (any pattern other than Off) is set on the chosen output connector.',
      defaultStyle: { bgcolor: combineRgb(255, 140, 0), color: combineRgb(0, 0, 0) },
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
        },
      ],
      callback: (feedback) => {
        const v = instance.connectorTestPatterns?.[Number(feedback.options.outputId)];
        return v !== undefined && v !== 0xffff;
      },
    },
    // True when a specific pattern is live on a screen. Lets a button show
    // which pattern is running rather than just that one is: the cycle button
    // takes on the colour of the current pattern, and each per-pattern button
    // lights when it is the active one.
    test_pattern_is: {
      type: 'boolean',
      name: 'Test Pattern Is (Screen)',
      description: 'True when the chosen pattern is currently set on the screen\'s output connectors.',
      defaultStyle: { bgcolor: combineRgb(255, 255, 255), color: combineRgb(0, 0, 0) },
      options: [
        {
          type: 'dropdown',
          label: 'Screen',
          id: 'screenId',
          default: screenListDropDown[0]?.id ?? null,
          choices: screenListDropDown,
        },
        { type: 'dropdown', label: 'Pattern', id: 'testPattern', default: 0x0004, choices: TEST_PATTERNS },
      ],
      callback: (feedback) => {
        const screenId = Number(feedback.options.screenId);
        const want = Number(feedback.options.testPattern);
        const connectors = Object.values(instance.outputConnectors ?? {}).filter((c) => c.screenId === screenId);
        if (!connectors.length) return false;
        // Any connector on the screen showing it counts: they are driven
        // together, and a partial state should still be visible.
        return connectors.some((c) => instance.connectorTestPatterns?.[c.outputId] === want);
      },
    },
    // ==================== Direct per-screen feedbacks ====================
    // Boolean feedbacks that read the enhancedState for a specific screen.
    // Let operators show live state on per-screen buttons without requiring
    // the screen to be selected first.
    brightness_match: {
      type: 'boolean',
      name: 'Brightness Matches Value (Direct)',
      description: 'True when the selected screen brightness equals the given value. Brightness field supports variables/expressions (used by the Brightness Level template preset).',
      defaultStyle: { bgcolor: combineRgb(0, 200, 0), color: combineRgb(255, 255, 255) },
      options: [
        { type: 'dropdown', label: 'Screen', id: 'screenId', default: screenListDropDown[0]?.id ?? null, choices: screenListDropDown },
        { type: 'textinput', label: 'Brightness (0-100)', id: 'brightness', default: '100', useVariables: true },
      ],
      callback: (event) => {
        const s = instance.enhancedState?.screens[event.options.screenId];
        return s ? Number(s.brightness) === Number(event.options.brightness) : false;
      },
    },
    frozen_direct: {
      type: 'boolean',
      name: 'Freeze State (Direct)',
      description: 'True when the specific screen is frozen.',
      defaultStyle: { bgcolor: combineRgb(0, 200, 255), color: combineRgb(0, 0, 0) },
      options: [
        { type: 'dropdown', label: 'Screen', id: 'screenId', default: screenListDropDown[0]?.id ?? null, choices: screenListDropDown },
      ],
      callback: (event) => instance.enhancedState?.screens[event.options.screenId]?.frozen === true,
    },
    ftb_direct: {
      type: 'boolean',
      name: 'FTB State (Direct)',
      description: 'True when FTB is active on the specific screen.',
      defaultStyle: { bgcolor: combineRgb(200, 0, 0), color: combineRgb(255, 255, 255) },
      options: [
        { type: 'dropdown', label: 'Screen', id: 'screenId', default: screenListDropDown[0]?.id ?? null, choices: screenListDropDown },
      ],
      callback: (event) => instance.enhancedState?.screens[event.options.screenId]?.ftb === true,
    },
    bkg_direct: {
      type: 'boolean',
      name: 'BKG State (Direct)',
      description: 'True when BKG is enabled on the specific screen.',
      defaultStyle: { bgcolor: combineRgb(0, 200, 0), color: combineRgb(0, 0, 0) },
      options: [
        { type: 'dropdown', label: 'Screen', id: 'screenId', default: screenListDropDown[0]?.id ?? null, choices: screenListDropDown },
      ],
      callback: (event) => instance.enhancedState?.screens[event.options.screenId]?.bkg === true,
    },
    osd_text_direct: {
      type: 'boolean',
      name: 'OSD Text State (Direct)',
      description: 'True when OSD Text is enabled on the specific screen.',
      defaultStyle: { bgcolor: combineRgb(0, 200, 0), color: combineRgb(0, 0, 0) },
      options: [
        { type: 'dropdown', label: 'Screen', id: 'screenId', default: screenListDropDown[0]?.id ?? null, choices: screenListDropDown },
      ],
      callback: (event) => instance.enhancedState?.screens[event.options.screenId]?.osdText === true,
    },
    osd_image_direct: {
      type: 'boolean',
      name: 'OSD Image State (Direct)',
      description: 'True when OSD Image is enabled on the specific screen.',
      defaultStyle: { bgcolor: combineRgb(0, 200, 0), color: combineRgb(0, 0, 0) },
      options: [
        { type: 'dropdown', label: 'Screen', id: 'screenId', default: screenListDropDown[0]?.id ?? null, choices: screenListDropDown },
      ],
      callback: (event) => instance.enhancedState?.screens[event.options.screenId]?.osdImage === true,
    },
    test_pattern_direct: {
      type: 'boolean',
      name: 'Test Pattern State (Direct)',
      description: 'True when test pattern is enabled on the specific screen.',
      defaultStyle: { bgcolor: combineRgb(255, 200, 0), color: combineRgb(0, 0, 0) },
      options: [
        { type: 'dropdown', label: 'Screen', id: 'screenId', default: screenListDropDown[0]?.id ?? null, choices: screenListDropDown },
      ],
      callback: (event) => instance.enhancedState?.screens[event.options.screenId]?.testPattern === true,
    },
    // ==================== End direct per-screen feedbacks ====================
    preset_loaded: {
      type: 'boolean',
      name: 'Load Preset',
      description: 'Update button style when the preset is loaded.',
      options: [
        {
          type: 'dropdown',
          label: 'Load Preset',
          name: 'Load Preset',
          id: 'combineId',
          default: presetDropDown[0]?.id ?? null,
          choices: presetDropDown,
        },
      ],
      callback: (event) => {
        // combineId defaults to null until the preset list has loaded.
        if (!event.options.combineId) return false;
        const [screenId, presetId] = String(event.options.combineId).split('_').map((item) => Number(item));
        return (
          instance.selectedPresetInfo &&
          instance.selectedPresetInfo.screenId === screenId &&
          instance.selectedPresetInfo.presetId === presetId
        );
      },
    },
    // Input signal feedback. Only registers when input signal polling is on
    // in config, otherwise the feedback is unavailable in the UI (matches
    // the variable-emission gate in main.js).
    ...(instance.config?.inputSignalPolling
      ? {
          input_signal: {
            type: 'boolean',
            name: 'Input Signal Active',
            description: 'True when the selected input connector has an active signal (R0102 iSignal=1).',
            defaultStyle: {
              bgcolor: combineRgb(0, 200, 0),
              color: combineRgb(255, 255, 255),
            },
            options: [
              {
                type: 'dropdown',
                label: 'Input',
                id: 'inputKey',
                // Choices derived from inputSignalState — only real
                // slot/connector pairs that have actually returned R0102
                // data appear in the dropdown. Updated on every poll tick,
                // so the menu populates within ~1 second of enabling
                // polling on a live device.
                default: (() => {
                  const keys = Object.keys(instance.inputSignalState ?? {}).sort();
                  return keys[0] ?? 'input_1_1';
                })(),
                choices: (() => {
                  const keys = Object.keys(instance.inputSignalState ?? {}).sort();
                  if (keys.length === 0) {
                    return [{ id: 'input_1_1', label: '(waiting for device data...)' }];
                  }
                  return keys.map((inputKey) => {
                    const m = inputKey.match(/^input_(\d+)_(\d+)$/);
                    const label = m ? `Input slot ${m[1]} conn ${m[2]}` : inputKey;
                    return { id: inputKey, label };
                  });
                })(),
              },
            ],
            callback: (event) => instance.inputSignalState[event.options.inputKey] === true,
          },
        }
      : {}),
  };
};
