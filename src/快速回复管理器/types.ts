/**
 * 快速回复管理器类型定义
 * @description 包含数据模型、UI状态和应用程序状态的所有接口定义
 */

/**
 * 快速回复包元数据
 * @description 存储包的基本信息和版本控制
 */
export interface PackMeta {
  version: number;
  createdAt: string;
  updatedAt?: string;
  source: string;
  name: string;
}

/**
 * 分类节点
 * @description 用于组织快速回复的分层分类结构
 */
export interface Category {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  collapsed: boolean;
}

/**
 * 快速回复条目
 * @description 单个快速回复的内容和元数据
 */
export interface Item {
  id: string;
  categoryId: string | null;
  name: string;
  content: string;
  mode: 'append' | 'inject';
  favorite: boolean;
  order: number;
}

/**
 * 连接器按钮配置
 * @description 自定义插入按钮的颜色和显示文本
 */
export interface ConnectorButton {
  id: string;
  label: string;
  token: string;
  color: string; // 'orange'|'purple'|'green'|'blue'|'red'|'cyan' 或自定义hex
}

/**
 * LLM预设配置
 * @description AI生成快速回复的提示词和参数设置
 */
export interface QrLlmPreset {
  systemPrompt: string;
  userPromptTemplate: string;
  updatedAt: string;
  promptGroup?: Array<{
    id?: string;
    role: 'SYSTEM' | 'USER' | 'ASSISTANT';
    position?: 'RELATIVE' | 'CHAT';
    enabled?: boolean;
    content: string;
    note?: string;
    name?: string;
    injectionDepth?: number;
    injectionOrder?: number;
    marker?: boolean;
    forbidOverrides?: boolean;
  }>;
  finalSystemDirective?: string;
}

/**
 * LLM预设存储
 * @description 管理多个LLM预设的版本控制存储
 */
export interface QrLlmPresetStore {
  version: 1;
  defaultPresetVersion?: number;
  presets: Record<string, QrLlmPreset>;
}

/**
 * LLM设置
 * @description AI生成功能的流式传输和生成参数配置
 */
export interface QrLlmSettings {
  enabledStream: boolean;
  generationParams: {
    temperature: number;
    top_p: number;
    max_tokens: number;
    presence_penalty: number;
    frequency_penalty: number;
  };
  activePresetName: string;
  presetStore: QrLlmPresetStore;
}

/**
 * LLM密钥配置
 * @description AI服务连接的API密钥和模型配置（敏感信息）
 */
export interface QrLlmSecretConfig {
  url: string;
  apiKey: string;
  model: string;
  manualModelId: string;
  extraBodyParamsText: string;
}

/**
 * 应用程序设置
 * @description 包含占位符、连接器、UI主题等所有配置
 */
export interface Settings {
  placeholders: Record<string, string>;
  placeholderRoleMaps: {
    byCharacterId: Record<string, Record<string, string>>;
    characterMeta: Record<string, { name: string; lastSeenAt: string }>;
  };
  tokens: { simultaneous: string; then: string };
  connectors: ConnectorButton[];
  toast: { maxStack: number; timeout: number };
  defaults: {
    mode: 'append' | 'inject';
    previewExpanded: boolean;
    connectorPrefixMode: boolean;
    connectorPrefixId: string | null;
  };
  ui: { theme: string; customCSS: string };
  qrLlm: QrLlmSettings;
}

/**
 * UI状态
 * @description 管理界面布局、尺寸和用户界面状态
 */
export interface UiState {
  sidebar: { expanded: Record<string, boolean>; width: number; collapsed: boolean };
  preview: {
    expanded: boolean;
    height: number;
    tokens: Array<{ id: string; type: string; label: string; text?: string }>;
  };
  panelSize: { width: number; height: number };
  lastPath: string[];
}

/**
 * 快速回复包
 * @description 包含所有数据、设置和状态的主数据结构
 */
export interface Pack {
  meta: PackMeta;
  categories: Category[];
  items: Item[];
  settings: Settings;
  uiState: UiState;
  favorites: string[];
}

/**
 * 拖拽数据
 * @description 拖拽操作中传递的标识信息
 */
export interface DragData {
  type: 'category' | 'item';
  id: string;
}

/**
 * 应用状态
 * @description 运行时状态管理，包含UI交互状态、编辑状态和调试信息
 */
export interface AppState {
  pack: Pack | null;
  currentCategoryId: string | null;
  history: (string | null)[];
  filter: string;
  contextMenu: HTMLElement | null;
  longPressTimer: ReturnType<typeof setTimeout> | null;
  hostResizeHandler: (() => void) | null;
  resizeRaf: number | null;
  inputSyncTarget: HTMLTextAreaElement | null;
  inputSyncHandler: ((e: Event) => void) | null;
  suspendInputSync: boolean;
  activeCharacterId: string | null;
  activeCharacterName: string;
  activeCharacterSwitchKey: string;
  activeIsGroupChat: boolean;
  qrLlmSecretCache: QrLlmSecretConfig | null;
  qrLlmModelList: string[];
  editGenerateState: {
    isGenerating: boolean;
    abortController: AbortController | null;
    lastDraftBeforeGenerate: string;
    lastGeneratedText: string;
    status: string;
    requestSeq: number;
    activeRequestId: number;
  };
  debugLogs: string[];
  debugHooksBound: boolean;
  debugErrorHandler: ((ev: Event) => void) | null;
  debugRejectionHandler: ((ev: Event) => void) | null;
  storageLoadHadCorruption: boolean;
  lastLoadedPackUpdatedAt: string;
}
