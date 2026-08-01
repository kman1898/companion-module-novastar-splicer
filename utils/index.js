/** 生成协议的参数 */
export const handleParams = (cmd, params) => {
  if (Array.isArray(params)) {
    return Buffer.from(
      JSON.stringify(
        params.map((param) => {
          return { ...param, cmd, deviceId: 0 };
        }),
      ),
    );
  }
  return Buffer.from(JSON.stringify([{ ...params, cmd, deviceId: 0 }]));
};

/** 解析协议数据 */
export const decodeRes = (msg) => {
  try {
    const res = msg.toString();
    const { cmd, ack, ...data } = JSON.parse(res)[0];
    return {
      cmd,
      ack: Boolean(ack === 'Ok'),
      data,
    };
  } catch (error) {}
};

/** 通用的UDP请求Promise包装器 - 使用事件监听器 */
export const sendUDPRequest = (instance, cmd, params = {}) => {
  return new Promise((resolve, reject) => {
    const command = handleParams(cmd, params);

    // 设置超时处理
    const timeout = setTimeout(() => {
      // 清理事件监听器
      instance.removeListener('udp_response', responseHandler);
      reject(new Error(`UDP request timeout for command: ${cmd}`));
    }, 10000); // 10秒超时

    // 响应处理函数
    const responseHandler = (res) => {
      if (res.cmd === cmd) {
        clearTimeout(timeout);
        // 清理事件监听器
        instance.removeListener('udp_response', responseHandler);
        resolve(res);
      }
    };

    // 添加事件监听器
    instance.on('udp_response', responseHandler);

    // 发送UDP请求
    instance.safeSend(command);
  });
};

/** 串行执行多个UDP请求 */
export const sendUDPRequestsSync = async (instance, requests) => {
  const results = [];
  for (let i = 0; i < requests.length; i++) {
    const request = requests[i];
    try {
      // 如果请求有依赖处理函数，则使用它来处理参数
      let params = request.params;
      if (request.processParams && typeof request.processParams === 'function') {
        params = request.processParams(results, i);
      }

      const result = await sendUDPRequest(instance, request.cmd, params);
      results.push(result);

      // 可选：在请求之间添加延迟
      if (request.delay) {
        await new Promise((resolve) => setTimeout(resolve, request.delay));
      }
    } catch (error) {
      instance.log('error', `Serial UDP request failed at step ${i + 1}: ${error.message}`);
    }
  }
  return results;
};

/** 并行执行多个UDP请求 */
export const sendUDPRequestsAll = async (instance, requests) => {
  // 创建所有请求的 Promise
  const requestPromises = requests.map(async (request, index) => {
    try {
      // 如果请求有依赖处理函数，则使用它来处理参数
      let params = request.params;
      if (request.processParams && typeof request.processParams === 'function') {
        // 注意：并行模式下，processParams 无法访问之前的结果
        // 只能使用传入的初始数据或实例状态
        params = request.processParams([], index);
      }

      const result = await sendUDPRequest(instance, request.cmd, params);

      // 可选：在请求后添加延迟
      if (request.delay) {
        await new Promise((resolve) => setTimeout(resolve, request.delay));
      }

      return result;
    } catch (error) {
      instance.log('error', `Parallel UDP request failed at step ${index + 1}: ${error.message}`);
    }
  });

  // 并行执行所有请求
  return await Promise.all(requestPromises);
};

/** 生成屏幕的变量 */
export const formatScreenVariable = (list) => {
  const screensArr = list.map((item) => ({
    variableId: `screenId_${item.screenId}`,
    name: `Screen ID: ${item.screenId}`,
    value: item.name,
  }));
  const screensObj = {};
  screensArr.forEach((variable) => {
    screensObj[variable.variableId] = variable.value;
  });
  return {
    screenVariableDefinitions: screensArr,
    screenDefaultVariableValues: screensObj,
  };
};

/** 生成图层的变量 */
export const formatLayerVariable = (screenList) => {
  const layersArr = [];
  const layersObj = {};
  screenList?.forEach((screen) => {
    (screen.layers || []).forEach((layer) => {
      const variableId = `screenId_${screen.screenId}_layerId_${layer.layerId}`;
      layersArr.push({
        variableId,
        name: `Layer ID: ${variableId}`,
        value: layer.name,
      });
      layersObj[variableId] = layer.name;
    });
  });
  return {
    layerVariableDefinitions: layersArr,
    layerDefaultVariableValues: layersObj,
  };
};

/** 生成场景的变量 */
export const formatPresetVariable = (screenList) => {
  const presetsArr = [];
  const presetsObj = {};
  screenList?.forEach((screen) => {
    (screen.presets || []).forEach((preset) => {
      const variableId = `screenId_${screen.screenId}_presetId_${preset.presetId}`;
      presetsArr.push({
        variableId,
        name: `Preset ID: ${variableId}`,
        value: preset.name,
      });
      presetsObj[variableId] = preset.name;
    });
  });
  return {
    presetVariableDefinitions: presetsArr,
    presetDefaultVariableValues: presetsObj,
  };
};

export const formatPresetCollectionVariable = (presetCollectionList) => {
  const presetCollectionVariables =
    presetCollectionList?.map(({ name, presetCollectionId }) => ({
      variableId: `presetCollectionId_${presetCollectionId}`,
      name: `Preset Group: ${presetCollectionId}`,
      value: name,
    })) || [];
  const presetCollectionVariableObj = {};
  presetCollectionVariables.forEach((variable) => {
    presetCollectionVariableObj[variable.variableId] = variable.value;
  });
  return {
    presetCollectionVariableDefinitions: presetCollectionVariables,
    presetCollectionDefaultVariableValues: presetCollectionVariableObj,
  };
};

/**
 * Human label for a source. The device addresses inputs by slot + connector,
 * so prefer "Input 2-3" when the source carries slotId/interfaceId, and fall
 * back to a 1-based input number otherwise. cropId 255 means the whole source;
 * any other value is a crop region of it.
 */
const sourceLabel = ({ name, inputId, cropId, slotId, interfaceId }) => {
  const where =
    slotId !== undefined && interfaceId !== undefined
      ? `Input ${slotId + 1}-${interfaceId + 1}`
      : `Input ${inputId + 1}`;
  const crop = cropId === 255 || cropId === undefined ? '' : ` Crop ${cropId + 1}`;
  // Include the device's own name when it adds something beyond the position.
  return name && name !== where ? `${where}${crop} (${name})` : `${where}${crop}`;
};

/**
 * Preferred variable id for a source: `input_<slot>_<connector>`, 1-based, so it
 * lines up with the input signal variables (`input_1_1_signal`). Falls back to a
 * 1-based input number when the device does not report slot/connector, and
 * suffixes crop regions so they stay distinct.
 */
const sourceVariableId = ({ inputId, cropId, slotId, interfaceId }) => {
  const base =
    slotId !== undefined && interfaceId !== undefined
      ? `input_${slotId + 1}_${interfaceId + 1}`
      : `input_${inputId + 1}`;
  return cropId === 255 || cropId === undefined ? base : `${base}_crop_${cropId + 1}`;
};

export const formatSourceVariable = (sourceList) => {
  const sourceVariables = [];
  const seen = new Set();
  for (const item of sourceList ?? []) {
    // Friendly, signal-aligned id: $(H_Series:input_1_1) is the name of the
    // source on slot 1 connector 1, alongside $(H_Series:input_1_1_signal).
    const friendly = sourceVariableId(item);
    if (!seen.has(friendly)) {
      seen.add(friendly);
      sourceVariables.push({ variableId: friendly, name: sourceLabel(item), value: item.name });
    }
    // Legacy id kept as an alias so buttons built against it keep working.
    const legacy = `source_${item.inputId}_${item.cropId}`;
    if (legacy !== friendly && !seen.has(legacy)) {
      seen.add(legacy);
      sourceVariables.push({ variableId: legacy, name: `${sourceLabel(item)} (legacy id)`, value: item.name });
    }
  }
  const sourceVariableObj = {};
  sourceVariables.forEach((variable) => {
    sourceVariableObj[variable.variableId] = variable.value;
  });
  return {
    sourceVariableDefinitions: sourceVariables,
    sourceDefaultVariableValues: sourceVariableObj,
  };
};

/**处理输入源 */
export const formatSourceList = (inputs) => {
  // console.log('inputs', JSON.stringify(inputs));
  const _list =
    inputs
      ?.filter((input) => input.online !== 0)
      ?.map((item) => {
        return { ...item, streamId: 0, cropId: 255, templateId: 0, sourceType: 1 };
      }) ?? [];
  const croupList = [];
  _list?.forEach((_item) => {
    _item.crops?.forEach((cropItem) => {
      croupList.push({ ..._item, ...cropItem, templateId: 0, streamId: 0, sourceType: 1 });
    });
  });
  return [..._list, ...croupList];
};
