import { CARD_TYPES, INTERFACE_TYPES } from './constant.js';

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
  // are addressed by outputId (a physical connector), not by screen. A screen is
  // usually driven by SEVERAL connectors tiled across it, so the label leads with
  // the screen and the connector's cell in the mosaic (R1C2 = row 1, column 2):
  // that is what tells an operator which part of the wall they are about to
  // flash. Slot/connector and the physical type follow, for finding it in a rack.
  const outputConnectorDropDown = Object.values(instance.outputConnectors ?? {})
    .sort(
      (a, b) =>
        (a.screenId ?? 0) - (b.screenId ?? 0) ||
        (a.slotId ?? 0) - (b.slotId ?? 0) ||
        (a.interfaceId ?? 0) - (b.interfaceId ?? 0),
    )
    .map((c) => {
      // Lead with where it lands on the wall when we know it (screen + mosaic
      // cell), otherwise with the device's own connector name.
      const where = c.screenName
        ? c.cell
          ? `${c.screenName} ${c.cell}`
          : c.screenName
        : c.deviceName || `Output ${c.outputId}`;
      // The device names connectors "output 35-1" already; prefer that over our
      // own slot maths. Only repeat it in the detail when the lead is the screen,
      // otherwise the label reads "output 21-1 (output 21-1 ...)".
      const parts = [];
      const connectorName = c.deviceName || `Slot ${(c.slotId ?? 0) + 1}-${(c.interfaceId ?? 0) + 1}`;
      if (connectorName !== where) parts.push(connectorName);
      const card = CARD_TYPES[instance.slotCardTypes?.[c.slotId]];
      if (card === 'Sending') parts.push('Sending');
      const type = INTERFACE_TYPES[c.interfaceType];
      if (type) parts.push(type);
      if (c.isCardOnline === 0) parts.push('offline');
      else if (c.isUsed === 0 && !c.screenName) parts.push('unassigned');
      return { id: c.outputId, label: `${where} (${parts.join(' · ')})` };
    });

  return {
    presetCollectionListDropDown,
    sourceListDropDown,
    presetDropDown,
    screenListDropDown,
    layerListDropDown,
    outputConnectorDropDown,
  };
}
