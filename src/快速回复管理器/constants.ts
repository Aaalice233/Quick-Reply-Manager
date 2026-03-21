/**
 * 快速回复管理器常量定义
 */

export const SCRIPT_LABEL = '💌快速回复管理器';
export const BUTTON_LABEL = '💌快速回复管理器';
export const STORE_KEY = 'fastPlotQRPack';
export const STYLE_ID = 'fast-plot-workbench-style-v1';
export const OVERLAY_ID = 'fast-plot-workbench-overlay';
export const TOAST_CONTAINER_ID = 'fast-plot-toast-container';
export const CUSTOM_CSS_ID = 'fast-plot-custom-css-v1';
export const QR_LLM_SECRET_KEY = 'fastPlotQRLlmSecret';
export const DEFAULT_QR_LLM_PRESET_NAME = '默认预设';
export const DEFAULT_QR_LLM_PRESET_VERSION = 2;
export const DATA_VERSION = 1;
export const FETCH_TIMEOUT_MS = 20000;
export const RUNTIME_KEY = '__QRM_RUNTIME_V2__';

export const THEME_NAMES: Record<string, string> = {
  'herdi-light': '晨光白',
  'ink-noir': '墨夜黑',
  'sand-gold': '沙金暖',
  'rose-pink': '樱粉柔',
  'forest-green': '翡翠绿',
  'ocean-blue': '深海蓝',
  'purple-mist': '薰衣紫',
} as const;

export const CONNECTOR_COLOR_NAMES: Record<string, string> = {
  orange: '橙色',
  purple: '紫色',
  green: '绿色',
  blue: '蓝色',
  red: '红色',
  cyan: '青色',
} as const;

export const CONNECTOR_COLOR_HEX: Record<string, string> = {
  orange: '#f5a547',
  purple: '#b487ff',
  green: '#5dc97e',
  blue: '#60a6ff',
  red: '#ff6e6e',
  cyan: '#47d3e2',
} as const;

export const CONNECTOR_ONLY_KEYS = new Set(['同时', '然后']);
