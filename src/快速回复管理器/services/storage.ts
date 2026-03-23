/**
 * 存储服务
 * @description 提供数据持久化和存储管理功能，包括脚本变量读写、数据迁移和默认数据生成
 */

import type { Pack, PackMeta, Category, Settings, UiState, QrLlmSettings, QrLlmPresetStore } from '../types';
import {
  STORE_KEY,
  DATA_VERSION,
  SCRIPT_LABEL,
  DEFAULT_QR_LLM_PRESET_NAME,
  DEFAULT_QR_LLM_PRESET_VERSION,
  CONNECTOR_ONLY_KEYS,
} from '../constants';
import { state, persistPack } from '../store';
import { deepClone, parsePackUpdatedAtMs, nowIso } from '../utils/data';
import { getViewportSize, uid } from '../utils/dom';
import { logError } from './debug';

// 重新导出 persistPack，保持向后兼容
export { persistPack };

// 父窗口引用
const pW = window.parent as typeof window;

/**
 * 脚本存储读取结果
 */
interface ScriptStoreReadResult {
  pack: Pack | null;
  hasStoredValue: boolean;
  parseFailed: boolean;
  source: 'script' | 'local' | null;
}

/**
 * 构建默认的QR LLM预设存储
 * @returns 默认预设存储对象
 */
function buildDefaultQrLlmPresetStore(): QrLlmPresetStore {
  const now = nowIso();
  const defaultPromptGroup = [
    {
      id: uid('qrp'),
      role: 'ASSISTANT' as const,
      name: '执行角色',
      position: 'RELATIVE' as const,
      enabled: true,
      injectionDepth: 4,
      injectionOrder: 100,
      content: [
        '你是"快速回复执行内容润写助手"。',
        '把用户给出的简短草稿润成可直接使用的一小段自然中文。',
        '必须保持草稿原意，不擅自改目标，不偷换人物关系。',
      ].join('\n'),
    },
    {
      id: uid('qrp'),
      role: 'SYSTEM' as const,
      name: '回复格式规范',
      position: 'RELATIVE' as const,
      enabled: true,
      injectionDepth: 4,
      injectionOrder: 100,
      content: [
        '只输出最终可执行正文。',
        '默认写成 1 段自然语言，不列提纲、不编号、不分条。',
        '不要输出解释、注释、前言、后记、分析过程。',
        '不要写"执行要求如下""当前场景聚焦于"这类模板腔。',
        '不要输出 Markdown 代码块围栏。',
      ].join('\n'),
    },
    {
      id: uid('qrp'),
      role: 'USER' as const,
      name: 'QR草稿输入',
      position: 'RELATIVE' as const,
      enabled: true,
      injectionDepth: 4,
      injectionOrder: 100,
      content: [
        '【草稿】',
        '{{draft}}',
        '',
        '【草稿中已出现的占位符原文】',
        '{{draft_placeholder_tokens}}',
        '',
        '【可用占位符】',
        '{{placeholder_list}}',
        '',
        '【占位符映射(JSON)】',
        '{{placeholder_map_json}}',
      ].join('\n'),
    },
    {
      id: uid('qrp'),
      role: 'SYSTEM' as const,
      name: '变量MAP使用规范',
      position: 'RELATIVE' as const,
      enabled: true,
      injectionDepth: 4,
      injectionOrder: 100,
      content: [
        '草稿里已经出现的占位符，必须原样保留并沿用，不要改写成别的格式。',
        '如果占位符在映射中有值，可以用来理解语义，但输出时优先复用草稿里的原占位符文本。',
        '未映射的占位符保持原样，不要删除、不硬编码。',
        '不要新增未提供的新占位符键名。',
        '保持占位符结构可替换性，不破坏现有占位符语法。',
      ].join('\n'),
    },
    {
      id: uid('qrp'),
      role: 'SYSTEM' as const,
      name: '扩写策略',
      position: 'RELATIVE' as const,
      enabled: true,
      injectionDepth: 4,
      injectionOrder: 100,
      content: [
        '优先补足最必要的信息，让句子顺、清楚、能直接用。',
        '除非草稿本身信息很多，否则控制在 1 到 3 句，不要明显扩太长。',
        '避免空泛套话，避免与草稿无关的新增设定，避免过度戏剧化和过强结构感。',
      ].join('\n'),
    },
  ];
  return {
    version: 1,
    defaultPresetVersion: DEFAULT_QR_LLM_PRESET_VERSION,
    presets: {
      [DEFAULT_QR_LLM_PRESET_NAME]: {
        systemPrompt: '',
        userPromptTemplate: '',
        promptGroup: defaultPromptGroup,
        updatedAt: now,
      },
    },
  };
}

/**
 * 获取默认的QR LLM设置
 * @returns 默认LLM设置对象
 */
function getDefaultQrLlmSettings(): QrLlmSettings {
  const presetStore = buildDefaultQrLlmPresetStore();
  return {
    enabledStream: true,
    generationParams: {
      temperature: 1,
      top_p: 1,
      max_tokens: 8192,
      presence_penalty: 0,
      frequency_penalty: 0,
    },
    activePresetName: presetStore.presets[DEFAULT_QR_LLM_PRESET_NAME]
      ? DEFAULT_QR_LLM_PRESET_NAME
      : Object.keys(presetStore.presets)[0] || '',
    presetStore,
  };
}

/**
 * 规范化QR LLM预设存储
 * @param raw - 原始预设存储数据
 * @returns 规范化后的预设存储对象
 */
function normalizeQrLlmPresetStore(raw: unknown): QrLlmPresetStore {
  const safe = (raw && typeof raw === 'object' ? deepClone(raw as QrLlmPresetStore) : {}) as Partial<QrLlmPresetStore>;

  safe.version = 1;
  safe.defaultPresetVersion = Number(safe.defaultPresetVersion) || DEFAULT_QR_LLM_PRESET_VERSION;

  if (!safe.presets || typeof safe.presets !== 'object' || !Object.keys(safe.presets).length) {
    const built = buildDefaultQrLlmPresetStore();
    safe.presets = built.presets;
    safe.defaultPresetVersion = built.defaultPresetVersion;
  } else {
    const cleaned: Record<string, QrLlmPresetStore['presets'][string]> = {};
    for (const [k, v] of Object.entries(safe.presets)) {
      if (!v || typeof v !== 'object') continue;
      const preset = v as QrLlmPresetStore['presets'][string];
      cleaned[k] = {
        systemPrompt: String(preset.systemPrompt ?? ''),
        userPromptTemplate: String(preset.userPromptTemplate ?? ''),
        updatedAt: String(preset.updatedAt || nowIso()),
        promptGroup: Array.isArray(preset.promptGroup) ? preset.promptGroup : [],
        finalSystemDirective:
          preset.finalSystemDirective !== undefined ? String(preset.finalSystemDirective) : undefined,
      };
    }
    safe.presets = cleaned;
  }

  return safe as QrLlmPresetStore;
}

/**
 * 规范化Pack对象，确保所有字段都有有效值
 * @param pack - 原始Pack对象
 * @returns 规范化后的Pack对象
 */
function normalizePack(pack: unknown): Pack {
  const safe = (pack && typeof pack === 'object' ? deepClone(pack as Pack) : {}) as Partial<Pack>;

  safe.meta = safe.meta || ({} as PackMeta);
  safe.meta!.version = Number(safe.meta!.version) || DATA_VERSION;
  safe.meta!.createdAt = safe.meta!.createdAt || nowIso();
  safe.meta!.updatedAt = nowIso();
  safe.meta!.source = safe.meta!.source || SCRIPT_LABEL;
  safe.meta!.name = safe.meta!.name || '💌快速回复管理器数据';

  safe.categories = Array.isArray(safe.categories) ? safe.categories : [];
  safe.items = Array.isArray(safe.items) ? safe.items : [];

  safe.settings = safe.settings || ({} as Settings);
  safe.settings!.placeholders = safe.settings!.placeholders || {
    用户: '用户',
    角色: '角色',
    苦主: '苦主',
    黄毛: '黄毛',
  };
  for (const key of CONNECTOR_ONLY_KEYS) delete safe.settings!.placeholders[key];
  safe.settings!.placeholderRoleMaps = safe.settings!.placeholderRoleMaps || {
    byCharacterId: {},
    characterMeta: {},
  };
  if (
    !safe.settings!.placeholderRoleMaps.byCharacterId ||
    typeof safe.settings!.placeholderRoleMaps.byCharacterId !== 'object'
  ) {
    safe.settings!.placeholderRoleMaps.byCharacterId = {};
  }
  if (
    !safe.settings!.placeholderRoleMaps.characterMeta ||
    typeof safe.settings!.placeholderRoleMaps.characterMeta !== 'object'
  ) {
    safe.settings!.placeholderRoleMaps.characterMeta = {};
  }
  for (const [characterId, values] of Object.entries(safe.settings!.placeholderRoleMaps.byCharacterId)) {
    if (!values || typeof values !== 'object') {
      delete safe.settings!.placeholderRoleMaps.byCharacterId[characterId];
      continue;
    }
    const cleanMap: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (!k || CONNECTOR_ONLY_KEYS.has(k)) continue;
      cleanMap[String(k)] = String(v ?? '');
    }
    safe.settings!.placeholderRoleMaps.byCharacterId[characterId] = cleanMap;
  }
  for (const [characterId, meta] of Object.entries(safe.settings!.placeholderRoleMaps.characterMeta)) {
    if (!meta || typeof meta !== 'object') {
      delete safe.settings!.placeholderRoleMaps.characterMeta[characterId];
      continue;
    }
    safe.settings!.placeholderRoleMaps.characterMeta[characterId] = {
      name: String((meta as { name?: string }).name || ''),
      lastSeenAt: String((meta as { lastSeenAt?: string }).lastSeenAt || nowIso()),
    };
  }
  safe.settings!.tokens = safe.settings!.tokens || {
    simultaneous: '<同时>',
    then: '<然后>',
  };
  if (!Array.isArray(safe.settings!.connectors) || !safe.settings!.connectors.length) {
    safe.settings!.connectors = [
      { id: uid('conn'), label: '然后', token: safe.settings!.tokens?.then || '<然后>', color: 'orange' },
      { id: uid('conn'), label: '同时', token: safe.settings!.tokens?.simultaneous || '<同时>', color: 'purple' },
    ];
  }
  safe.settings!.toast = safe.settings!.toast || {
    maxStack: 4,
    timeout: 1800,
  };
  safe.settings!.defaults = safe.settings!.defaults || {
    mode: 'append',
    previewExpanded: true,
    connectorPrefixMode: false,
    connectorPrefixId: null,
  };
  if (typeof safe.settings!.defaults.connectorPrefixMode !== 'boolean') {
    safe.settings!.defaults.connectorPrefixMode = false;
  }
  safe.settings!.defaults.connectorPrefixId = safe.settings!.defaults.connectorPrefixId ?? null;
  safe.settings!.ui = safe.settings!.ui || { theme: 'herdi-light', customCSS: '' };
  if (!('customCSS' in safe.settings!.ui)) (safe.settings!.ui as { customCSS?: string }).customCSS = '';
  safe.settings!.qrLlm = safe.settings!.qrLlm || getDefaultQrLlmSettings();
  if (typeof safe.settings!.qrLlm.enabledStream !== 'boolean') safe.settings!.qrLlm.enabledStream = true;
  safe.settings!.qrLlm.generationParams =
    safe.settings!.qrLlm.generationParams || getDefaultQrLlmSettings().generationParams;
  safe.settings!.qrLlm.generationParams.temperature = Number.isFinite(
    Number(safe.settings!.qrLlm.generationParams.temperature),
  )
    ? Number(safe.settings!.qrLlm.generationParams.temperature)
    : 1;
  safe.settings!.qrLlm.generationParams.top_p = Number.isFinite(Number(safe.settings!.qrLlm.generationParams.top_p))
    ? Number(safe.settings!.qrLlm.generationParams.top_p)
    : 1;
  safe.settings!.qrLlm.generationParams.max_tokens = Number.isFinite(
    Number(safe.settings!.qrLlm.generationParams.max_tokens),
  )
    ? Number(safe.settings!.qrLlm.generationParams.max_tokens)
    : 8192;
  safe.settings!.qrLlm.generationParams.presence_penalty = Number.isFinite(
    Number(safe.settings!.qrLlm.generationParams.presence_penalty),
  )
    ? Number(safe.settings!.qrLlm.generationParams.presence_penalty)
    : 0;
  safe.settings!.qrLlm.generationParams.frequency_penalty = Number.isFinite(
    Number(safe.settings!.qrLlm.generationParams.frequency_penalty),
  )
    ? Number(safe.settings!.qrLlm.generationParams.frequency_penalty)
    : 0;
  safe.settings!.qrLlm.presetStore = normalizeQrLlmPresetStore(
    safe.settings!.qrLlm.presetStore || buildDefaultQrLlmPresetStore(),
  );
  safe.settings!.qrLlm.activePresetName = String(safe.settings!.qrLlm.activePresetName || '').trim();
  if (
    !safe.settings!.qrLlm.activePresetName ||
    !safe.settings!.qrLlm.presetStore.presets[safe.settings!.qrLlm.activePresetName]
  ) {
    safe.settings!.qrLlm.activePresetName = DEFAULT_QR_LLM_PRESET_NAME;
  }

  safe.uiState = safe.uiState || ({} as UiState);
  safe.uiState!.sidebar = safe.uiState!.sidebar || {
    expanded: {},
    width: 280,
    collapsed: false,
  };
  safe.uiState!.preview = safe.uiState!.preview || {
    expanded: true,
    height: 140,
    tokens: [],
  };
  if (!safe.uiState!.panelSize || typeof safe.uiState!.panelSize !== 'object')
    safe.uiState!.panelSize = {} as UiState['panelSize'];
  const vp = getViewportSize();
  const fallbackWidth = Math.max(1040, Math.min(vp.width * 0.86, vp.width - 16));
  const fallbackHeight = Math.max(660, Math.min(vp.height * 0.88, vp.height - 16));
  safe.uiState!.panelSize!.width = Number(safe.uiState!.panelSize!.width) || fallbackWidth;
  safe.uiState!.panelSize!.height = Number(safe.uiState!.panelSize!.height) || fallbackHeight;
  safe.uiState!.lastPath = safe.uiState!.lastPath || [];

  safe.favorites = Array.isArray(safe.favorites) ? safe.favorites : [];

  const categoryIds = new Set<string>();
  for (const cat of safe.categories) {
    if (!cat.id) cat.id = uid('cat');
    if (typeof cat.order !== 'number') cat.order = 0;
    if (typeof cat.collapsed !== 'boolean') cat.collapsed = false;
    if (!('parentId' in cat)) (cat as Category).parentId = null;
    categoryIds.add(cat.id);
  }

  for (const item of safe.items) {
    if (!item.id) item.id = uid('item');
    if (!item.categoryId || !categoryIds.has(item.categoryId)) {
      item.categoryId = safe.categories[0]?.id || null;
    }
    if (typeof item.order !== 'number') item.order = 0;
    item.mode = item.mode === 'inject' ? 'inject' : 'append';
    item.favorite = Boolean(item.favorite) || safe.favorites.includes(item.id);
  }

  safe.favorites = safe.items.filter(i => i.favorite).map(i => i.id);

  if (safe.meta!.version < DATA_VERSION) {
    safe.meta!.version = DATA_VERSION;
  }

  return safe as Pack;
}

/**
 * 从脚本变量中读取原始存储数据
 * @returns 存储读取结果，包含pack数据和读取状态
 */
export function getScriptStoreRaw(): ScriptStoreReadResult {
  let hasStoredValue = false;
  let parseFailed = false;
  let scriptCandidate: Pack | null = null;
  let localCandidate: Pack | null = null;

  // 从脚本变量读取
  try {
    if (typeof getVariables === 'function') {
      const vars = (getVariables({ type: 'script' }) || {}) as Record<string, unknown>;
      if (vars && Object.prototype.hasOwnProperty.call(vars, STORE_KEY)) {
        hasStoredValue = true;
        const raw = vars[STORE_KEY];
        if (raw && typeof raw === 'object') {
          scriptCandidate = raw as Pack;
        } else if (typeof raw === 'string' && String(raw).trim()) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') scriptCandidate = parsed as Pack;
            else parseFailed = true;
          } catch {
            parseFailed = true;
          }
        } else if (raw !== undefined && raw !== null) {
          parseFailed = true;
        }
      }
    }
  } catch (e) {
    parseFailed = true;
    logError('读取脚本变量存储失败', String(e));
  }

  // 从localStorage读取作为备用
  try {
    const fallback = pW.localStorage.getItem(`__${STORE_KEY}__`);
    if (fallback !== null) {
      hasStoredValue = true;
      if (String(fallback).trim()) {
        try {
          const parsed = JSON.parse(fallback);
          if (parsed && typeof parsed === 'object') localCandidate = parsed as Pack;
          else parseFailed = true;
        } catch (e) {
          parseFailed = true;
          logError('读取本地存储失败(JSON解析)', String(e));
        }
      } else {
        parseFailed = true;
      }
    }
  } catch (e) {
    parseFailed = true;
    logError('读取本地存储失败', String(e));
  }

  // 合并结果，选择较新的数据
  if (scriptCandidate && localCandidate) {
    const scriptMs = parsePackUpdatedAtMs(scriptCandidate);
    const localMs = parsePackUpdatedAtMs(localCandidate);
    const pickScript = scriptMs >= localMs;
    return {
      pack: pickScript ? scriptCandidate : localCandidate,
      hasStoredValue,
      parseFailed,
      source: pickScript ? 'script' : 'local',
    };
  }
  if (scriptCandidate) return { pack: scriptCandidate, hasStoredValue, parseFailed, source: 'script' };
  if (localCandidate) return { pack: localCandidate, hasStoredValue, parseFailed, source: 'local' };
  return { pack: null, hasStoredValue, parseFailed, source: null };
}

/**
 * 保存原始数据到脚本变量存储
 * @param data - 要保存的Pack数据
 * @returns 是否成功保存到至少一个存储位置
 */
export function saveScriptStoreRaw(data: Pack): boolean {
  let anySaved = false;

  // 保存到脚本变量
  try {
    if (typeof insertOrAssignVariables === 'function') {
      insertOrAssignVariables({ [STORE_KEY]: data }, { type: 'script' });
      anySaved = true;
    } else if (typeof updateVariablesWith === 'function') {
      updateVariablesWith(
        (vars: Record<string, unknown>) => {
          vars[STORE_KEY] = data;
          return vars;
        },
        { type: 'script' },
      );
      anySaved = true;
    }
  } catch (e) {
    logError('写入脚本变量存储失败', String(e));
  }

  // 保存到localStorage作为备份
  try {
    pW.localStorage.setItem(`__${STORE_KEY}__`, JSON.stringify(data));
    anySaved = true;
  } catch (e) {
    logError('写入本地存储失败', String(e));
  }

  return anySaved;
}

/**
 * 构建默认的Pack对象
 * @returns 包含默认分类、设置和数据的完整Pack对象
 */
export function buildDefaultPack(): Pack {
  const catRoot = uid('cat');
  const catPlot = uid('cat');
  const catTime = uid('cat');
  const catScene = uid('cat');
  const catSocial = uid('cat');
  const catRisk = uid('cat');

  const categories = [
    { id: catRoot, name: '👑超级菜单', parentId: null, order: 0, collapsed: false },
    { id: catPlot, name: '🎬剧情编排', parentId: catRoot, order: 0, collapsed: false },
    { id: catTime, name: '⏰时间推进', parentId: catPlot, order: 0, collapsed: false },
    { id: catScene, name: '🧭场景安排', parentId: catPlot, order: 1, collapsed: false },
    { id: catSocial, name: '💬社交互动', parentId: catPlot, order: 2, collapsed: false },
    { id: catRisk, name: '👁️风险事件', parentId: catRoot, order: 1, collapsed: false },
  ];

  const items = [
    {
      id: uid('item'),
      categoryId: catTime,
      name: '推进到白天',
      content: '将时间推进到白天，简述期间经过并保留关键剧情节点。',
      mode: 'append' as const,
      favorite: false,
      order: 0,
    },
    {
      id: uid('item'),
      categoryId: catTime,
      name: '推进到晚上',
      content: '将时间推进到晚上，描述环境变化与角色状态变化。',
      mode: 'append' as const,
      favorite: false,
      order: 1,
    },
    {
      id: uid('item'),
      categoryId: catScene,
      name: '安排新角色登场',
      content: '根据当前剧情安排一名新角色合理登场，保持世界观一致。',
      mode: 'append' as const,
      favorite: true,
      order: 0,
    },
    {
      id: uid('item'),
      categoryId: catScene,
      name: '触发偶遇剧情',
      content: '在当前地点触发一次合乎逻辑的偶遇剧情，并推动主线或支线。',
      mode: 'append' as const,
      favorite: false,
      order: 1,
    },
    {
      id: uid('item'),
      categoryId: catSocial,
      name: '社交试探',
      content: '{@用户:用户}主动试探{@角色:角色}的态度与立场，推进关系层次。',
      mode: 'append' as const,
      favorite: false,
      order: 0,
    },
    {
      id: uid('item'),
      categoryId: catRisk,
      name: '突发风险',
      content: '触发一个突发风险事件，要求角色按性格作出即时应对。',
      mode: 'inject' as const,
      favorite: false,
      order: 0,
    },
  ];

  return normalizePack({
    meta: {
      version: DATA_VERSION,
      createdAt: nowIso(),
      source: SCRIPT_LABEL,
      name: '💌快速回复管理器数据',
    },
    categories,
    items,
    settings: {
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
      },
      qrLlm: getDefaultQrLlmSettings(),
    },
    uiState: {
      sidebar: { expanded: {}, width: 280, collapsed: false },
      preview: { expanded: true, height: 140, tokens: [] },
      panelSize: {
        width: Math.max(1040, Math.min(getViewportSize().width * 0.86, getViewportSize().width - 16)),
        height: Math.max(660, Math.min(getViewportSize().height * 0.88, getViewportSize().height - 16)),
      },
      lastPath: [catRoot, catPlot],
    },
    favorites: items.filter(i => i.favorite).map(i => i.id),
  });
}

/**
 * 加载Pack数据
 * @description 从存储中加载数据，处理数据迁移和默认值
 * @returns 完整的Pack对象
 */
export function loadPack(): Pack {
  const existed = getScriptStoreRaw();
  if (!existed.pack) {
    if (existed.hasStoredValue && existed.parseFailed) {
      state.storageLoadHadCorruption = true;
      logError('检测到存储损坏，已跳过自动覆盖，使用默认数据启动');
      const def = buildDefaultPack();
      state.lastLoadedPackUpdatedAt = String(def.meta.updatedAt || '');
      return def;
    }
    const def = buildDefaultPack();
    saveScriptStoreRaw(def);
    state.lastLoadedPackUpdatedAt = String(def.meta.updatedAt || '');
    return def;
  }
  const normalized = normalizePack(existed.pack);
  saveScriptStoreRaw(normalized);
  state.lastLoadedPackUpdatedAt = String(normalized.meta.updatedAt || '');
  return normalized;
}

/**
 * 清除脚本存储
 * @description 清除所有存储的数据，包括脚本变量和 localStorage
 */
export function clearScriptStore(): void {
  try {
    if (typeof insertOrAssignVariables === 'function') {
      insertOrAssignVariables({ [STORE_KEY]: undefined }, { type: 'script' });
    }
    pW.localStorage.removeItem(`__${STORE_KEY}__`);
  } catch (e) {
    logError('清除存储失败', String(e));
  }
}
