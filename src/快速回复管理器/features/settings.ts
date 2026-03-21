/**
 * 设置管理模块
 * @description 集中管理应用程序设置和UI状态的读写操作
 */

import type { Settings, UiState } from '../types';
import { state, updatePack, persistPack } from '../store';
import { deepClone } from '../utils/data';
import { logError } from '../services/debug';

/**
 * 获取当前设置
 * @returns 当前Settings对象，如果没有pack则返回默认设置
 */
export function getSettings(): Settings {
  if (!state.pack) {
    return getDefaultSettings();
  }
  return state.pack.settings;
}

/**
 * 更新设置
 * @description 合并新设置到当前设置并持久化
 * @param updates - 要更新的部分设置
 */
export function updateSettings(updates: Partial<Settings>): void {
  if (!state.pack) {
    logError('updateSettings 失败：pack 不存在');
    return;
  }

  const updatedSettings = {
    ...state.pack.settings,
    ...updates,
  };

  const updatedPack = {
    ...state.pack,
    settings: updatedSettings,
  };

  updatePack(updatedPack);
}

/**
 * 获取UI设置
 * @returns 当前UiState对象，如果没有pack则返回默认UI状态
 */
export function getUiSettings(): UiState {
  if (!state.pack) {
    return getDefaultUiSettings();
  }
  return state.pack.uiState;
}

/**
 * 更新UI设置
 * @description 合并新UI设置到当前UI状态并持久化
 * @param updates - 要更新的部分UI设置
 */
export function updateUiSettings(updates: Partial<UiState>): void {
  if (!state.pack) {
    logError('updateUiSettings 失败：pack 不存在');
    return;
  }

  const updatedUiState = {
    ...state.pack.uiState,
    ...updates,
  };

  const updatedPack = {
    ...state.pack,
    uiState: updatedUiState,
  };

  updatePack(updatedPack);
}

/**
 * 重置为默认设置
 * @description 将设置和UI状态重置为默认值，保留数据和元数据
 */
export function resetSettings(): void {
  if (!state.pack) {
    logError('resetSettings 失败：pack 不存在');
    return;
  }

  const defaultSettings = getDefaultSettings();
  const defaultUiState = getDefaultUiSettings();

  // 保留当前面板大小，避免重置后窗口尺寸不适配
  const currentPanelSize = state.pack.uiState.panelSize;

  const updatedPack = {
    ...state.pack,
    settings: defaultSettings,
    uiState: {
      ...defaultUiState,
      panelSize: currentPanelSize,
    },
  };

  updatePack(updatedPack);
  persistPack({ immediate: true });
}

/**
 * 获取默认设置
 * @returns 默认Settings对象
 */
export function getDefaultSettings(): Settings {
  return {
    placeholders: {
      用户: '用户',
      角色: '角色',
      苦主: '苦主',
      黄毛: '黄毛',
    },
    placeholderRoleMaps: {
      byCharacterId: {},
      characterMeta: {},
    },
    tokens: {
      simultaneous: '<同时>',
      then: '<然后>',
    },
    connectors: [
      { id: 'conn_default_then', label: '然后', token: '<然后>', color: 'orange' },
      { id: 'conn_default_sim', label: '同时', token: '<同时>', color: 'purple' },
    ],
    toast: {
      maxStack: 4,
      timeout: 1800,
    },
    defaults: {
      mode: 'append',
      previewExpanded: true,
      connectorPrefixMode: false,
      connectorPrefixId: null,
    },
    ui: {
      theme: 'herdi-light',
      customCSS: '',
    },
    qrLlm: getDefaultQrLlmSettings(),
  };
}

/**
 * 获取默认UI状态
 * @returns 默认UiState对象
 */
function getDefaultUiSettings(): UiState {
  return {
    sidebar: {
      expanded: {},
      width: 280,
      collapsed: false,
    },
    preview: {
      expanded: true,
      height: 140,
      tokens: [],
    },
    panelSize: {
      width: 1040,
      height: 660,
    },
    lastPath: [],
  };
}

/**
 * 获取默认LLM设置
 * @returns 默认QrLlmSettings对象
 */
function getDefaultQrLlmSettings(): Settings['qrLlm'] {
  return {
    enabledStream: true,
    generationParams: {
      temperature: 1,
      top_p: 1,
      max_tokens: 8192,
      presence_penalty: 0,
      frequency_penalty: 0,
    },
    activePresetName: '默认预设',
    presetStore: {
      version: 1,
      defaultPresetVersion: 2,
      presets: {},
    },
  };
}

/**
 * 深克隆设置
 * @description 获取设置的可修改副本
 * @returns 设置对象的深克隆
 */
export function cloneSettings(): Settings {
  return deepClone(getSettings());
}

/**
 * 深克隆UI设置
 * @description 获取UI设置的可修改副本
 * @returns UI设置对象的深克隆
 */
export function cloneUiSettings(): UiState {
  return deepClone(getUiSettings());
}
