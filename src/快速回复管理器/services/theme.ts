/**
 * 主题服务
 * @description 提供主题切换、导入导出等主题相关功能
 */

import { state, persistPack } from '../store';
import { THEME_NAMES, OVERLAY_ID } from '../constants';
import { resolveHostWindow } from '../utils/dom';
import { logError } from './debug';

/** 默认主题名称 */
const DEFAULT_THEME = 'herdi-light';

/** 主题数据接口 */
export interface ThemeData {
  theme: string;
  customCSS: string;
}

/**
 * 获取当前主题名
 * @returns 当前主题名称，如果没有则返回默认主题 'herdi-light'
 */
export function getCurrentTheme(): string {
  const ui = state.pack?.settings?.ui;
  return ui?.theme || DEFAULT_THEME;
}

/**
 * 设置主题
 * @param themeName - 要设置的主题名称
 * @description 设置主题并保存到 state，同时应用到 DOM
 */
export function setTheme(themeName: string): void {
  // 验证主题名是否有效
  if (!THEME_NAMES[themeName]) {
    logError('设置主题失败：无效的主题名称', themeName);
    return;
  }

  // 更新 state
  if (state.pack) {
    state.pack.settings.ui = state.pack.settings.ui || { theme: DEFAULT_THEME, customCSS: '' };
    state.pack.settings.ui.theme = themeName;
    persistPack();
  }

  // 应用到 DOM
  applyThemeToDOM(themeName);
}

/**
 * 应用主题到 DOM
 * @param themeName - 可选，要应用的主题名称，如果不提供则使用 getCurrentTheme()
 * @description 将主题应用到 DOM 元素的 data-theme 属性
 */
export function applyThemeToDOM(themeName?: string): void {
  const targetTheme = themeName || getCurrentTheme();
  const pD = resolveHostWindow().document;

  // 应用到面板
  const panel = pD.querySelector('.fp-panel') as HTMLElement | null;
  if (panel) {
    panel.setAttribute('data-theme', targetTheme);
  }

  // 应用到覆盖层
  const overlay = pD.getElementById(OVERLAY_ID) as HTMLElement | null;
  if (overlay) {
    overlay.setAttribute('data-theme', targetTheme);
  }
}

/**
 * 导出当前主题为 JSON 字符串
 * @returns JSON 格式的主题数据字符串
 * @description 包含主题名和自定义 CSS
 */
export function exportTheme(): string {
  const ui = state.pack?.settings?.ui;
  const themeData: ThemeData = {
    theme: ui?.theme || DEFAULT_THEME,
    customCSS: ui?.customCSS || '',
  };
  return JSON.stringify(themeData, null, 2);
}

/**
 * 导入主题配置
 * @param themeJson - JSON 格式的主题配置字符串
 * @returns 是否导入成功
 * @description 解析 JSON 并应用主题配置到 state 和 DOM
 */
export function importTheme(themeJson: string): boolean {
  try {
    const data = JSON.parse(themeJson) as Partial<ThemeData>;

    // 验证必要字段
    if (!data.theme && data.customCSS === undefined) {
      logError('导入主题失败：无效的 JSON 数据');
      return false;
    }

    // 验证主题名
    if (data.theme && !THEME_NAMES[data.theme]) {
      logError('导入主题失败：未知的主题名称', data.theme);
      return false;
    }

    // 更新 state
    if (state.pack) {
      state.pack.settings.ui = state.pack.settings.ui || { theme: DEFAULT_THEME, customCSS: '' };

      if (data.theme) {
        state.pack.settings.ui.theme = data.theme;
      }

      if (data.customCSS !== undefined) {
        state.pack.settings.ui.customCSS = data.customCSS;
      }

      persistPack();
    }

    // 应用到 DOM
    const pD = resolveHostWindow().document;

    if (data.theme) {
      const panel = pD.querySelector('.fp-panel') as HTMLElement | null;
      const overlay = pD.getElementById(OVERLAY_ID) as HTMLElement | null;

      if (panel) panel.setAttribute('data-theme', data.theme);
      if (overlay) overlay.setAttribute('data-theme', data.theme);
    }

    return true;
  } catch (e) {
    logError('导入主题失败：JSON 解析错误', e);
    return false;
  }
}

/**
 * 下载主题文件
 * @description 将当前主题导出并下载为 JSON 文件
 */
export function downloadTheme(): void {
  const themeJson = exportTheme();
  const blob = new Blob([themeJson], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `快速回复管理器_主题_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * 从文件导入主题
 * @param file - 要导入的主题文件
 * @returns Promise<boolean> 是否导入成功
 * @description 读取文件内容并调用 importTheme 导入
 */
export function importThemeFromFile(file: File): Promise<boolean> {
  return new Promise(resolve => {
    const reader = new FileReader();

    reader.onload = () => {
      try {
        const content = reader.result as string;
        const success = importTheme(content);
        resolve(success);
      } catch (e) {
        logError('读取主题文件失败', e);
        resolve(false);
      }
    };

    reader.onerror = () => {
      logError('读取主题文件失败：FileReader 错误');
      resolve(false);
    };

    reader.readAsText(file);
  });
}

/**
 * 获取所有可用主题列表
 * @returns 主题名称到显示名称的映射
 */
export function getAvailableThemes(): Record<string, string> {
  return { ...THEME_NAMES };
}

/**
 * 获取主题的显示名称
 * @param themeName - 主题名称
 * @returns 主题的显示名称，如果未知则返回主题名本身
 */
export function getThemeDisplayName(themeName: string): string {
  return THEME_NAMES[themeName] || themeName;
}

/**
 * 检查主题是否有效
 * @param themeName - 要检查的主题名称
 * @returns 是否是有效主题
 */
export function isValidTheme(themeName: string): boolean {
  return themeName in THEME_NAMES;
}

/**
 * 获取自定义 CSS
 * @returns 当前自定义 CSS 字符串
 */
export function getCustomCSS(): string {
  return state.pack?.settings?.ui?.customCSS || '';
}

/**
 * 设置自定义 CSS
 * @param css - 自定义 CSS 字符串
 */
export function setCustomCSS(css: string): void {
  if (state.pack) {
    state.pack.settings.ui = state.pack.settings.ui || { theme: DEFAULT_THEME, customCSS: '' };
    state.pack.settings.ui.customCSS = css;
    persistPack();
  }
}

/**
 * 初始化主题
 * @description 在应用启动时调用，应用当前主题到 DOM
 */
export function initTheme(): void {
  applyThemeToDOM();
}
