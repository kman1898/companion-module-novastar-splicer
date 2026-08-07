export default function formatDropDownData(instance) {
  /** 场景下拉 */
  const presetDropDown = [];
  /** 屏幕下拉 */
  const screenListDropDown = [];
  /** 图层下拉 */
  const layerListDropDown = [];
  //场景组下拉
  const presetCollectionListDropDown = instance.presetCollectionList?.map((_item) => ({
    id: _item.presetCollectionId,
    label: _item.name,
  }));
  //输入源下拉
  const sourceListDropDown = instance.sourceList?.map((item) => ({
    id: `${item.inputId}_${item.cropId}`,
    label: item.name,
  }));

  instance.screenList?.forEach((screen) => {
    screenListDropDown.push({
      id: screen.screenId,
      label: screen.name,
    });
    // 统一使用 combineId 逻辑
    screen?.layers?.forEach((layer) => {
      layerListDropDown.push({
        id: `${screen.screenId}_${layer.layerId}`,
        label: `${screen.name}_${layer.name}`,
      });
    });
    screen?.presets?.forEach((preset) => {
      presetDropDown.push({
        id: `${screen.screenId}_${preset.presetId}`,
        label: `${screen.name}_${preset.name}`,
      });
    });
  });

  // Output connectors, harvested from R0401 screen details. W0303 test patterns
  // are addressed by outputId (a physical connector), not by screen, so this is
  // the list an operator picks from. Sorted by slot then connector so the order
  // matches the chassis. Labels are 1-based to match the panel.
  const outputConnectorDropDown = Object.values(instance.outputConnectors ?? {})
    .sort((a, b) => (a.slotId ?? 0) - (b.slotId ?? 0) || (a.interfaceId ?? 0) - (b.interfaceId ?? 0))
    .map((c) => ({
      id: c.outputId,
      label:
        `Slot ${(c.slotId ?? 0) + 1}-${(c.interfaceId ?? 0) + 1}` +
        (c.screenName ? ` (${c.screenName})` : '') +
        (c.isCardOnline === 0 ? ' [offline]' : ''),
    }));

  return {
    presetCollectionListDropDown,
    sourceListDropDown,
    presetDropDown,
    screenListDropDown,
    layerListDropDown,
    outputConnectorDropDown,
  };
}
