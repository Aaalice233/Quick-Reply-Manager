(() => {
  'use strict';

  const SCRIPT_LABEL = '💌快速回复管理器';
  const BUTTON_LABEL = '💌快速回复管理器';
  const STORE_KEY = 'fastPlotQRPack';
  const STYLE_ID = 'fast-plot-workbench-style-v1';
  const OVERLAY_ID = 'fast-plot-workbench-overlay';
  const TOAST_CONTAINER_ID = 'fast-plot-toast-container';
  const QR_LLM_SECRET_KEY = 'fastPlotQRLlmSecret';
  const DEFAULT_QR_LLM_PRESET_NAME = '默认预设';
  const DATA_VERSION = 1;

  const THEME_NAMES: Record<string, string> = {
    'herdi-light': '晨光白',
    'ink-noir': '墨夜黑',
    'sand-gold': '沙金暖',
    'rose-pink': '樱粉柔',
    'forest-green': '翡翠绿',
    'ocean-blue': '深海蓝',
    'purple-mist': '薰衣紫',
  };
  const CONNECTOR_COLOR_NAMES: Record<string, string> = {
    orange: '橙色',
    purple: '紫色',
    green: '绿色',
    blue: '蓝色',
    red: '红色',
    cyan: '青色',
  };
  const CONNECTOR_COLOR_HEX: Record<string, string> = {
    orange: '#f5a547',
    purple: '#b487ff',
    green: '#5dc97e',
    blue: '#60a6ff',
    red: '#ff6e6e',
    cyan: '#47d3e2',
  };
  const CONNECTOR_ONLY_KEYS = new Set(['同时', '然后']);

  interface PackMeta {
    version: number;
    createdAt: string;
    updatedAt?: string;
    source: string;
    name: string;
  }

  interface Category {
    id: string;
    name: string;
    parentId: string | null;
    order: number;
    collapsed: boolean;
  }

  interface Item {
    id: string;
    categoryId: string | null;
    name: string;
    content: string;
    mode: 'append' | 'inject';
    favorite: boolean;
    order: number;
  }

  interface ConnectorButton {
    id: string;
    label: string;
    token: string;
    color: string; // 'orange'|'purple'|'green'|'blue'|'red'|'cyan' 或自定义hex
  }

  interface QrLlmPreset {
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

  interface QrLlmPresetStore {
    version: 1;
    presets: Record<string, QrLlmPreset>;
  }

  interface QrLlmSettings {
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

  interface QrLlmSecretConfig {
    url: string;
    apiKey: string;
    model: string;
    manualModelId: string;
    extraBodyParamsText: string;
  }

  interface Settings {
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

  interface UiState {
    sidebar: { expanded: Record<string, boolean>; width: number; collapsed: boolean };
    preview: { expanded: boolean; height: number; tokens: Array<{ id: string; type: string; label: string; text?: string }> };
    panelSize: { width: number; height: number };
    lastPath: string[];
  }

  interface Pack {
    meta: PackMeta;
    categories: Category[];
    items: Item[];
    settings: Settings;
    uiState: UiState;
    favorites: string[];
  }

  interface DragData {
    type: 'category' | 'item';
    id: string;
  }

  interface AppState {
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
    };
    debugLogs: string[];
    debugHooksBound: boolean;
  }

  function resolveHostWindow(): Window {
    const candidates: Window[] = [];
    try { if (window.top) candidates.push(window.top); } catch (e) { /* ignore */ }
    try { if (window.parent) candidates.push(window.parent); } catch (e) { /* ignore */ }
    candidates.push(window);
    let best: Window = window;
    let bestArea = 0;
    for (const w of candidates) {
      try {
        const area = Number(w.innerWidth || 0) * Number(w.innerHeight || 0);
        if (area > bestArea && w.document) {
          best = w;
          bestArea = area;
        }
      } catch (e) { /* ignore */ }
    }
    return best;
  }

  const pW = resolveHostWindow();
  const pD = pW.document || document;

  const state: AppState = {
    pack: null,
    currentCategoryId: null,
    history: [],
    filter: '',
    contextMenu: null,
    longPressTimer: null,
    hostResizeHandler: null,
    resizeRaf: null,
    inputSyncTarget: null,
    inputSyncHandler: null,
    suspendInputSync: false,
    activeCharacterId: null,
    activeCharacterName: '',
    activeCharacterSwitchKey: '__boot__',
    activeIsGroupChat: false,
    qrLlmSecretCache: null,
    qrLlmModelList: [],
    editGenerateState: {
      isGenerating: false,
      abortController: null,
      lastDraftBeforeGenerate: '',
      lastGeneratedText: '',
      status: '',
    },
    debugLogs: [],
    debugHooksBound: false,
  };

  function uid(prefix: string): string {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
  }

  function deepClone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function pushDebugLog(message: string, payload?: unknown): void {
    const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const lines: string[] = [`[${ts}] ${String(message || '')}`];
    if (payload !== undefined) {
      try {
        lines.push(typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2));
      } catch (e) {
        lines.push(String(payload));
      }
    }
    state.debugLogs.push(lines.join('\n'));
    if (state.debugLogs.length > 500) {
      state.debugLogs = state.debugLogs.slice(-500);
    }
  }

  function logInfo(message: string, payload?: unknown): void {
    pushDebugLog(`INFO ${message}`, payload);
  }

  function logError(message: string, payload?: unknown): void {
    pushDebugLog(`ERROR ${message}`, payload);
  }

  function getDebugLogText(): string {
    return state.debugLogs.join('\n\n');
  }

  function getViewportSize() {
    const root = pD?.documentElement;
    const w = Number(pW?.innerWidth) || Number(root?.clientWidth) || Number(window.innerWidth) || 320;
    const h = Number(pW?.innerHeight) || Number(root?.clientHeight) || Number(window.innerHeight) || 360;
    return {
      width: Math.max(320, w),
      height: Math.max(360, h),
    };
  }

  function computeFitPanelSize() {
    const vp = getViewportSize();
    const width = Math.min(Math.max(320, vp.width - 16), Math.max(320, Math.round(vp.width * 0.86)));
    const height = Math.min(Math.max(360, vp.height - 16), Math.max(360, Math.round(vp.height * 0.88)));
    return { width, height };
  }

  function applyFitPanelSize() {
    if (!state.pack?.uiState?.panelSize) return;
    const fit = computeFitPanelSize();
    state.pack.uiState.panelSize.width = fit.width;
    state.pack.uiState.panelSize.height = fit.height;
  }

  function detachHostResize() {
    if (state.hostResizeHandler) {
      try { pW.removeEventListener('resize', state.hostResizeHandler); } catch (e) {}
      state.hostResizeHandler = null;
    }
    if (state.resizeRaf) {
      try { pW.cancelAnimationFrame(state.resizeRaf); } catch (e) {}
      state.resizeRaf = null;
    }
  }

  function attachHostResize() {
    detachHostResize();
    state.hostResizeHandler = () => {
      if (!pD.getElementById(OVERLAY_ID)) return;
      if (state.resizeRaf) return;
      state.resizeRaf = pW.requestAnimationFrame(() => {
        state.resizeRaf = null;
        applyFitPanelSize();
        persistPack();
        renderWorkbench();
      });
    };
    pW.addEventListener('resize', state.hostResizeHandler);
  }

  function getContext(): unknown {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((pW as any).SillyTavern?.getContext) return (pW as any).SillyTavern.getContext();
    } catch (e) { /* ignore */ }
    return null;
  }

  function getScriptStoreRaw() {
    try {
      if (typeof getVariables === 'function') {
        const vars = getVariables({ type: 'script' }) || {};
        if (vars && typeof vars[STORE_KEY] === 'object') return vars[STORE_KEY];
      }
    } catch (e) {}
    try {
      const fallback = pW.localStorage.getItem(`__${STORE_KEY}__`);
      return fallback ? JSON.parse(fallback) : null;
    } catch (e) {
      return null;
    }
  }

  function saveScriptStoreRaw(data: Pack): void {
    try {
      if (typeof insertOrAssignVariables === 'function') {
        insertOrAssignVariables({ [STORE_KEY]: data }, { type: 'script' });
        return;
      }
      if (typeof updateVariablesWith === 'function') {
        updateVariablesWith((vars) => {
          vars[STORE_KEY] = data;
          return vars;
        }, { type: 'script' });
        return;
      }
    } catch (e) {}

    try {
      pW.localStorage.setItem(`__${STORE_KEY}__`, JSON.stringify(data));
    } catch (e) {
      console.error('[快速回复管理器] 保存失败', e);
      logError('保存脚本存储失败', String(e));
    }
  }

  function buildDefaultQrLlmPresetStore(): QrLlmPresetStore {
    const now = nowIso();
    return {
      version: 1,
      presets: {
        [DEFAULT_QR_LLM_PRESET_NAME]: {
          systemPrompt: '',
          userPromptTemplate: '',
          promptGroup: [
            {
              id: uid('qrp'),
              role: 'ASSISTANT',
              name: '执行角色',
              position: 'RELATIVE',
              enabled: true,
              injectionDepth: 4,
              injectionOrder: 100,
              content: [
                '你是“快速回复执行内容扩写助手”。',
                '任务：将用户给出的简要草稿扩写为可直接执行的完整执行内容。',
                '必须保持草稿原意，不擅自改写目标。',
              ].join('\n'),
            },
            {
              id: uid('qrp'),
              role: 'SYSTEM',
              name: '回复格式规范',
              position: 'RELATIVE',
              enabled: true,
              injectionDepth: 4,
              injectionOrder: 100,
              content: [
                '只输出最终可执行正文。',
                '不要输出解释、注释、前言、后记、分析过程。',
                '不要输出 Markdown 代码块围栏。',
              ].join('\n'),
            },
            {
              id: uid('qrp'),
              role: 'USER',
              name: 'QR草稿输入',
              position: 'RELATIVE',
              enabled: true,
              injectionDepth: 4,
              injectionOrder: 100,
              content: [
                '【草稿】',
                '{{draft}}',
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
              role: 'SYSTEM',
              name: '变量MAP使用规范',
              position: 'RELATIVE',
              enabled: true,
              injectionDepth: 4,
              injectionOrder: 100,
              content: [
                '如果占位符在映射中有值，优先使用映射值理解语义。',
                '未映射的占位符保持原样，不要删除、不硬编码。',
                '不要新增未提供的新占位符键名。',
                '保持占位符结构可替换性，不破坏现有占位符语法。',
              ].join('\n'),
            },
            {
              id: uid('qrp'),
              role: 'SYSTEM',
              name: '扩写策略',
              position: 'RELATIVE',
              enabled: true,
              injectionDepth: 4,
              injectionOrder: 100,
              content: [
                '补充必要的动作、场景、对象、约束和结果，使文本可以直接执行。',
                '在不改变目标的前提下提升清晰度与可执行性。',
                '避免空泛套话，避免与草稿无关的新增设定。',
              ].join('\n'),
            },
          ],
          updatedAt: now,
        },
      },
    };
  }

  function normalizePromptGroup(
    raw: unknown,
  ): Array<{
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
  }> {
    if (!Array.isArray(raw)) return [];
    const out: Array<{
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
    }> = [];
    raw.forEach((seg) => {
      if (!seg || typeof seg !== 'object') return;
      const roleRaw = String((seg as { role?: string }).role || '').toUpperCase();
      const role = roleRaw === 'USER' || roleRaw === 'ASSISTANT' ? roleRaw : 'SYSTEM';
      const content = String((seg as { content?: string }).content || '');
      const note = String(
        (seg as { note?: string; remark?: string; name?: string; title?: string }).note
        || (seg as { remark?: string }).remark
        || (seg as { name?: string }).name
        || (seg as { title?: string }).title
        || '',
      ).trim();
      const rawPos = String((seg as { position?: string }).position || '').toUpperCase();
      const rawInjectionPos = Number((seg as { injection_position?: number }).injection_position);
      const position: 'RELATIVE' | 'CHAT' =
        rawPos === 'CHAT' || rawPos === 'IN_CHAT' || rawPos === 'CHAT_INJECTION' || rawInjectionPos === 1
          ? 'CHAT'
          : 'RELATIVE';
      const enabled = typeof (seg as { enabled?: boolean }).enabled === 'boolean'
        ? Boolean((seg as { enabled?: boolean }).enabled)
        : true;
      const identifier = String((seg as { id?: string; identifier?: string }).id || (seg as { identifier?: string }).identifier || '').trim();
      const injectionDepth = Number((seg as { injectionDepth?: number; injection_depth?: number }).injectionDepth ?? (seg as { injection_depth?: number }).injection_depth ?? 4);
      const injectionOrder = Number((seg as { injectionOrder?: number; injection_order?: number }).injectionOrder ?? (seg as { injection_order?: number }).injection_order ?? 100);
      const marker = Boolean((seg as { marker?: boolean }).marker);
      const forbidOverrides = Boolean((seg as { forbidOverrides?: boolean; forbid_overrides?: boolean }).forbidOverrides ?? (seg as { forbid_overrides?: boolean }).forbid_overrides);
      if (!content.trim()) return;
      out.push({
        id: identifier || uid('qrp'),
        role,
        position,
        enabled,
        content,
        note: note || undefined,
        name: note || undefined,
        injectionDepth: Number.isFinite(injectionDepth) ? injectionDepth : 4,
        injectionOrder: Number.isFinite(injectionOrder) ? injectionOrder : 100,
        marker: marker || undefined,
        forbidOverrides: forbidOverrides || undefined,
      });
    });
    return out;
  }

  function compileQrLlmPreset(preset: QrLlmPreset): QrLlmPreset {
    const promptGroup = normalizePromptGroup(preset.promptGroup);
    const finalSystemDirective = String(preset.finalSystemDirective || '').trim();
    const activePromptGroup = promptGroup.filter((x) => x.enabled !== false);
    const relativePromptGroup = activePromptGroup.filter((x) => String(x.position || 'RELATIVE') === 'RELATIVE');
    const chatPromptGroup = activePromptGroup.filter((x) => String(x.position || 'RELATIVE') === 'CHAT');

    let systemPrompt = String(preset.systemPrompt || '').trim();
    let userPromptTemplate = String(preset.userPromptTemplate || '').trim();

    if (activePromptGroup.length) {
      const systemSegs = relativePromptGroup.filter((x) => x.role === 'SYSTEM').map((x) => x.content.trim()).filter(Boolean);
      const userSegs = relativePromptGroup.filter((x) => x.role === 'USER').map((x) => x.content.trim()).filter(Boolean);
      const assistantSegs = relativePromptGroup.filter((x) => x.role === 'ASSISTANT').map((x) => x.content.trim()).filter(Boolean);
      const chatSegs = chatPromptGroup
        .map((x) => `[${x.role}] ${String(x.content || '').trim()}`)
        .filter((x) => String(x || '').trim());
      if (systemSegs.length) {
        const systemParts = [...systemSegs];
        if (finalSystemDirective) systemParts.push(finalSystemDirective);
        systemPrompt = systemParts.join('\n\n');
      }
      const userParts: string[] = [];
      if (userSegs.length) userParts.push(userSegs.join('\n\n'));
      if (assistantSegs.length) userParts.push(assistantSegs.join('\n\n'));
      if (chatSegs.length) userParts.push(chatSegs.join('\n\n'));
      if (userParts.length) userPromptTemplate = userParts.join('\n\n');
    } else if (finalSystemDirective) {
      systemPrompt = [systemPrompt, finalSystemDirective].filter(Boolean).join('\n\n');
    }

    if (!systemPrompt) systemPrompt = '你是执行内容扩写助手。';
    if (!userPromptTemplate) userPromptTemplate = '{{draft}}';

    return {
      systemPrompt,
      userPromptTemplate,
      promptGroup: promptGroup.length ? promptGroup : undefined,
      finalSystemDirective: finalSystemDirective || undefined,
      updatedAt: String(preset.updatedAt || nowIso()),
    };
  }

  function normalizeQrLlmPresetStore(store: QrLlmPresetStore | null | undefined): QrLlmPresetStore {
    const safe = (store && typeof store === 'object' ? deepClone(store) : { version: 1, presets: {} }) as QrLlmPresetStore;
    safe.version = 1;
    safe.presets = (safe.presets && typeof safe.presets === 'object') ? safe.presets : {};
    const legacyDefaultNames = ['默认扩写预设', '默认预设(旧)', 'default'];
    legacyDefaultNames.forEach((legacy) => {
      if (!safe.presets[legacy]) return;
      if (!safe.presets[DEFAULT_QR_LLM_PRESET_NAME]) {
        safe.presets[DEFAULT_QR_LLM_PRESET_NAME] = deepClone(safe.presets[legacy]);
      }
      delete safe.presets[legacy];
    });
    for (const [name, preset] of Object.entries(safe.presets)) {
      if (!name || !preset || typeof preset !== 'object') {
        delete safe.presets[name];
        continue;
      }
      safe.presets[name] = compileQrLlmPreset({
        systemPrompt: String(preset.systemPrompt || ''),
        userPromptTemplate: String(preset.userPromptTemplate || ''),
        promptGroup: normalizePromptGroup((preset as QrLlmPreset).promptGroup),
        finalSystemDirective: String((preset as QrLlmPreset).finalSystemDirective || ''),
        updatedAt: String(preset.updatedAt || nowIso()),
      });
    }
    if (!safe.presets[DEFAULT_QR_LLM_PRESET_NAME]) {
      const def = buildDefaultQrLlmPresetStore().presets[DEFAULT_QR_LLM_PRESET_NAME];
      safe.presets[DEFAULT_QR_LLM_PRESET_NAME] = deepClone(def);
    } else {
      const def = buildDefaultQrLlmPresetStore().presets[DEFAULT_QR_LLM_PRESET_NAME];
      const current = safe.presets[DEFAULT_QR_LLM_PRESET_NAME];
      const currentGroups = normalizePromptGroup(current.promptGroup);
      const looksLegacyDefault = currentGroups.some((x) => String(x.name || x.note || '').trim() === '系统规则');
      if (looksLegacyDefault) {
        safe.presets[DEFAULT_QR_LLM_PRESET_NAME] = deepClone(def);
      }
      const migrated = safe.presets[DEFAULT_QR_LLM_PRESET_NAME];
      if (!normalizePromptGroup(migrated.promptGroup).length) {
        safe.presets[DEFAULT_QR_LLM_PRESET_NAME].promptGroup = deepClone(def.promptGroup);
      }
      if (!String(migrated.finalSystemDirective || '').trim()) {
        safe.presets[DEFAULT_QR_LLM_PRESET_NAME].finalSystemDirective = def.finalSystemDirective;
      }
      safe.presets[DEFAULT_QR_LLM_PRESET_NAME] = compileQrLlmPreset(safe.presets[DEFAULT_QR_LLM_PRESET_NAME]);
    }
    return safe;
  }

  function getDefaultQrLlmSettings(): QrLlmSettings {
    const presetStore = buildDefaultQrLlmPresetStore();
    return {
      enabledStream: true,
      generationParams: {
        temperature: 0.9,
        top_p: 1,
        max_tokens: 1024,
        presence_penalty: 0,
        frequency_penalty: 0,
      },
      activePresetName: presetStore.presets[DEFAULT_QR_LLM_PRESET_NAME]
        ? DEFAULT_QR_LLM_PRESET_NAME
        : (Object.keys(presetStore.presets)[0] || ''),
      presetStore,
    };
  }

  function normalizeQrLlmSecret(raw: unknown): QrLlmSecretConfig {
    const safe = (raw && typeof raw === 'object' ? raw : {}) as Partial<QrLlmSecretConfig>;
    const manual = String(safe.manualModelId || '').trim();
    const selected = String(safe.model || '').trim();
    const extraBodyParamsText = String((safe as { extraBodyParamsText?: string; extraBodyParams?: string }).extraBodyParamsText
      || (safe as { extraBodyParamsText?: string; extraBodyParams?: string }).extraBodyParams
      || '');
    return {
      url: String(safe.url || '').trim(),
      apiKey: String(safe.apiKey || ''),
      model: selected || manual,
      manualModelId: manual || selected,
      extraBodyParamsText,
    };
  }

  function loadQrLlmSecretConfig(): QrLlmSecretConfig {
    try {
      const raw = pW.localStorage.getItem(`__${QR_LLM_SECRET_KEY}__`);
      const parsed = raw ? JSON.parse(raw) : null;
      const normalized = normalizeQrLlmSecret(parsed);
      state.qrLlmSecretCache = normalized;
      return normalized;
    } catch (e) {
      const normalized = normalizeQrLlmSecret(null);
      state.qrLlmSecretCache = normalized;
      return normalized;
    }
  }

  function getQrLlmSecretConfig(): QrLlmSecretConfig {
    if (!state.qrLlmSecretCache) return loadQrLlmSecretConfig();
    return normalizeQrLlmSecret(state.qrLlmSecretCache);
  }

  function saveQrLlmSecretConfig(secret: QrLlmSecretConfig): void {
    const normalized = normalizeQrLlmSecret(secret);
    state.qrLlmSecretCache = normalized;
    try {
      pW.localStorage.setItem(`__${QR_LLM_SECRET_KEY}__`, JSON.stringify(normalized));
    } catch (e) {
      console.error('[快速回复管理器] 保存LLM私密配置失败', e);
      logError('保存LLM私密配置失败', String(e));
    }
  }

  function normalizePack(pack: unknown): Pack {
    const safe = (pack && typeof pack === 'object' ? deepClone(pack as Pack) : {}) as Partial<Pack>;

    safe.meta = safe.meta || {} as PackMeta;
    safe.meta!.version = Number(safe.meta!.version) || DATA_VERSION;
    safe.meta!.createdAt = safe.meta!.createdAt || nowIso();
    safe.meta!.updatedAt = nowIso();
    safe.meta!.source = safe.meta!.source || SCRIPT_LABEL;
    safe.meta!.name = safe.meta!.name || '💌快速回复管理器数据';

    safe.categories = Array.isArray(safe.categories) ? safe.categories : [];
    safe.items = Array.isArray(safe.items) ? safe.items : [];

    safe.settings = safe.settings || {} as Settings;
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
    if (!safe.settings!.placeholderRoleMaps.byCharacterId || typeof safe.settings!.placeholderRoleMaps.byCharacterId !== 'object') {
      safe.settings!.placeholderRoleMaps.byCharacterId = {};
    }
    if (!safe.settings!.placeholderRoleMaps.characterMeta || typeof safe.settings!.placeholderRoleMaps.characterMeta !== 'object') {
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
    if (!('customCSS' in safe.settings!.ui)) (safe.settings!.ui as any).customCSS = '';
    safe.settings!.qrLlm = safe.settings!.qrLlm || getDefaultQrLlmSettings();
    if (typeof safe.settings!.qrLlm.enabledStream !== 'boolean') safe.settings!.qrLlm.enabledStream = true;
    safe.settings!.qrLlm.generationParams = safe.settings!.qrLlm.generationParams || getDefaultQrLlmSettings().generationParams;
    safe.settings!.qrLlm.generationParams.temperature = Number.isFinite(Number(safe.settings!.qrLlm.generationParams.temperature)) ? Number(safe.settings!.qrLlm.generationParams.temperature) : 0.9;
    safe.settings!.qrLlm.generationParams.top_p = Number.isFinite(Number(safe.settings!.qrLlm.generationParams.top_p)) ? Number(safe.settings!.qrLlm.generationParams.top_p) : 1;
    safe.settings!.qrLlm.generationParams.max_tokens = Number.isFinite(Number(safe.settings!.qrLlm.generationParams.max_tokens)) ? Number(safe.settings!.qrLlm.generationParams.max_tokens) : 1024;
    safe.settings!.qrLlm.generationParams.presence_penalty = Number.isFinite(Number(safe.settings!.qrLlm.generationParams.presence_penalty)) ? Number(safe.settings!.qrLlm.generationParams.presence_penalty) : 0;
    safe.settings!.qrLlm.generationParams.frequency_penalty = Number.isFinite(Number(safe.settings!.qrLlm.generationParams.frequency_penalty)) ? Number(safe.settings!.qrLlm.generationParams.frequency_penalty) : 0;
    safe.settings!.qrLlm.presetStore = normalizeQrLlmPresetStore(
      safe.settings!.qrLlm.presetStore || buildDefaultQrLlmPresetStore(),
    );
    safe.settings!.qrLlm.activePresetName = String(safe.settings!.qrLlm.activePresetName || '').trim();
    if (!safe.settings!.qrLlm.activePresetName || !safe.settings!.qrLlm.presetStore.presets[safe.settings!.qrLlm.activePresetName]) {
      safe.settings!.qrLlm.activePresetName = DEFAULT_QR_LLM_PRESET_NAME;
    }

    safe.uiState = safe.uiState || {} as UiState;
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
    if (!safe.uiState!.panelSize || typeof safe.uiState!.panelSize !== 'object') safe.uiState!.panelSize = {} as UiState['panelSize'];
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

    safe.favorites = safe.items.filter((i) => i.favorite).map((i) => i.id);

    if (safe.meta!.version < DATA_VERSION) {
      safe.meta!.version = DATA_VERSION;
    }

    return safe as Pack;
  }

  function buildDefaultPack() {
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
        mode: 'append',
        favorite: false,
        order: 0,
      },
      {
        id: uid('item'),
        categoryId: catTime,
        name: '推进到晚上',
        content: '将时间推进到晚上，描述环境变化与角色状态变化。',
        mode: 'append',
        favorite: false,
        order: 1,
      },
      {
        id: uid('item'),
        categoryId: catScene,
        name: '安排新角色登场',
        content: '根据当前剧情安排一名新角色合理登场，保持世界观一致。',
        mode: 'append',
        favorite: true,
        order: 0,
      },
      {
        id: uid('item'),
        categoryId: catScene,
        name: '触发偶遇剧情',
        content: '在当前地点触发一次合乎逻辑的偶遇剧情，并推动主线或支线。',
        mode: 'append',
        favorite: false,
        order: 1,
      },
      {
        id: uid('item'),
        categoryId: catSocial,
        name: '社交试探',
        content: '{@用户:用户}主动试探{@角色:角色}的态度与立场，推进关系层次。',
        mode: 'append',
        favorite: false,
        order: 0,
      },
      {
        id: uid('item'),
        categoryId: catRisk,
        name: '突发风险',
        content: '触发一个突发风险事件，要求角色按性格作出即时应对。',
        mode: 'inject',
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
      favorites: items.filter((i) => i.favorite).map((i) => i.id),
    });
  }

  function loadPack() {
    const existed = getScriptStoreRaw();
    if (!existed) {
      const def = buildDefaultPack();
      saveScriptStoreRaw(def);
      return def;
    }
    const normalized = normalizePack(existed);
    saveScriptStoreRaw(normalized);
    return normalized;
  }

  function persistPack() {
    if (!state.pack) return;
    state.pack.meta.updatedAt = nowIso();
    state.pack.favorites = state.pack.items.filter((i) => i.favorite).map((i) => i.id);
    saveScriptStoreRaw(state.pack);
  }

  function ensureStyle() {
    if (pD.getElementById(STYLE_ID)) return;
    const style = pD.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
@import url("https://fontsapi.zeoseven.com/292/main/result.css");

body {
  font-family: "LXGW WenKai";
  font-weight: normal;
}

/* === CSS Variables Definition (herdi-light as default) === */
#${OVERLAY_ID},.fp-panel{
  /* Layer 1 - Surface & Text */
  --qr-bg-1:linear-gradient(180deg,#f9f6f0 0%,#f3eee5 100%);
  --qr-bg-2:linear-gradient(180deg,#fbf8f3,#f6f0e6);
  --qr-bg-3:#fff;
  --qr-bg-input:#f5f0e6;
  --qr-bg-hover:rgba(35,31,28,.08);
  --qr-text-1:#1f2023;
  --qr-text-2:#5a5148;
  --qr-text-on-accent:#fff;
  --qr-placeholder:rgba(31,32,35,.4);
  /* Layer 2 - Border & Decoration */
  --qr-border-1:rgba(27,27,30,.14);
  --qr-border-2:rgba(26,26,30,.09);
  --qr-accent:#1f2023;
  --qr-accent-hover:#2a2b2f;
  --qr-shadow:rgba(0,0,0,.30);
  --qr-scrollbar:rgba(0,0,0,.15);
  --qr-scrollbar-hover:rgba(0,0,0,.28);
  /* Layer 3 - Component Specific */
  --qr-topbar-bg:linear-gradient(180deg,#ffffff,#f5f2ea);
  --qr-topbar-border:rgba(26,26,30,.10);
  --qr-sidebar-bg:linear-gradient(180deg,#fbf8f3,#f6f0e6);
  --qr-sidebar-border:rgba(26,26,30,.09);
  --qr-main-bg:linear-gradient(180deg,#f8f4ec,#f3eee5);
  --qr-menu-bg:#fff;
  --qr-menu-border:rgba(24,24,27,.16);
  --qr-menu-hover:#f1ece4;
  --qr-modal-bg:linear-gradient(180deg,#ffffff,#f7f2e9);
  --qr-modal-overlay:rgba(11,12,14,.52);
  --qr-toast-bg:rgba(24,24,27,.92);
  --qr-toast-border:rgba(255,255,255,.16);
  --qr-toast-text:#faf8f4;
  --qr-overlay-bg:radial-gradient(1200px 520px at 12% 0%,rgba(255,255,255,.25),transparent 56%),radial-gradient(1000px 560px at 92% 8%,rgba(244,228,204,.34),transparent 54%),rgba(10,10,12,.52);
  --qr-bottom-bg:#f7f2e9;
  --qr-path-bg:#f1ebe1;
  /* Layer 4 - Semantic Tags/Buttons */
  --qr-tag-bg:#e8f4f0;
  --qr-tag-border:rgba(50,140,120,.25);
  --qr-tag-text:#2a8068;
  --qr-tag-inject-bg:#f6ebdc;
  --qr-tag-inject-border:rgba(132,88,35,.28);
  --qr-tag-inject-text:#845823;
  --qr-breadcrumb-bg:transparent;
  --qr-breadcrumb-text:#5a5148;
  --qr-breadcrumb-sep:rgba(90,81,72,.4);
  --qr-breadcrumb-hover-bg:rgba(31,32,35,.1);
  --qr-tab-bg:#fff;
  --qr-tab-border:rgba(24,24,27,.16);
  --qr-tab-active-bg:#1f2023;
  --qr-tab-active-text:#fff;
  /* Tree Node */
  --qr-tree-text:#423c34;
  --qr-tree-active-bg:#1f2023;
  --qr-tree-active-text:#fff;
  /* Card */
  --qr-card-bg:#fff;
  --qr-card-border:rgba(24,24,27,.12);
  --qr-card-border-hover:rgba(24,24,27,.28);
  --qr-card-shadow:rgba(20,20,22,.06);
  --qr-card-hover-shadow:rgba(20,20,22,.12);
  --qr-excerpt-text:#8a7e72;
  /* Button */
  --qr-btn-bg:rgba(255,255,255,.9);
  --qr-btn-border:rgba(23,24,28,.18);
  --qr-btn-hover-bg:#fff;
  --qr-btn-hover-border:rgba(23,24,28,.34);
  --qr-btn-edge-hi:rgba(255,255,255,.16);
  --qr-btn-edge-lo:rgba(0,0,0,.34);
  --qr-btn-ring:rgba(255,255,255,.06);
  /* Component expression tokens (theme-agnostic behavior layer) */
  --qr-control-radius:14px;
  --qr-control-press-scale:.992;
  --qr-control-lift:0px;
  --qr-control-min-h:40px;
  --qr-btn-h-sm:34px;
  --qr-btn-h-md:38px;
  --qr-btn-h-lg:42px;
  --qr-control-inset-shadow:inset 0 1px 0 rgba(255,255,255,.05);
  --qr-control-rest-shadow:0 1px 0 rgba(255,255,255,.03),0 1px 8px rgba(0,0,0,.16);
  --qr-control-hover-shadow:0 1px 0 rgba(255,255,255,.05),0 2px 12px rgba(0,0,0,.22);
  --qr-focus-ring:rgba(180,190,210,.24);
  --qr-control-focus-shadow:0 0 0 1px var(--qr-accent),0 0 0 3px var(--qr-focus-ring);
  /* Fav icon */
  --qr-fav-color:#e05070;
  /* Connector buttons - Orange (then) */
  --qr-conn-orange-bg:linear-gradient(180deg,#ffe8cf,#f9dbb8);
  --qr-conn-orange-border:rgba(170,112,42,.35);
  --qr-conn-orange-text:#7e4e16;
  --qr-conn-orange-hover-bg:linear-gradient(180deg,#ffe2c2,#f5d0a6);
  --qr-conn-orange-hover-border:rgba(170,112,42,.5);
  /* Connector buttons - Purple (simul) */
  --qr-conn-purple-bg:linear-gradient(180deg,#efe9ff,#dfd3ff);
  --qr-conn-purple-border:rgba(92,77,155,.35);
  --qr-conn-purple-text:#4b3a8a;
  --qr-conn-purple-hover-bg:linear-gradient(180deg,#e8e0ff,#d3c3ff);
  --qr-conn-purple-hover-border:rgba(92,77,155,.52);
  /* Connector buttons - Green */
  --qr-conn-green-bg:linear-gradient(180deg,#e4f5e9,#ceebd6);
  --qr-conn-green-border:rgba(50,130,80,.3);
  --qr-conn-green-text:#2d6b42;
  --qr-conn-green-hover-bg:linear-gradient(180deg,#d8f0df,#c2e5cc);
  --qr-conn-green-hover-border:rgba(50,130,80,.45);
  /* Connector buttons - Blue */
  --qr-conn-blue-bg:linear-gradient(180deg,#e0eeff,#cce0ff);
  --qr-conn-blue-border:rgba(50,90,170,.3);
  --qr-conn-blue-text:#2a5090;
  --qr-conn-blue-hover-bg:linear-gradient(180deg,#d4e6ff,#c0d8ff);
  --qr-conn-blue-hover-border:rgba(50,90,170,.45);
  /* Connector buttons - Red */
  --qr-conn-red-bg:linear-gradient(180deg,#ffe4e4,#fcd2d2);
  --qr-conn-red-border:rgba(170,50,50,.3);
  --qr-conn-red-text:#8b3030;
  --qr-conn-red-hover-bg:linear-gradient(180deg,#ffd8d8,#f8c4c4);
  --qr-conn-red-hover-border:rgba(170,50,50,.45);
  /* Connector buttons - Teal/Cyan */
  --qr-conn-teal-bg:linear-gradient(180deg,#e0f6f6,#cceded);
  --qr-conn-teal-border:rgba(40,130,140,.3);
  --qr-conn-teal-text:#1a6e70;
  --qr-conn-teal-hover-bg:linear-gradient(180deg,#d4f0f0,#c0e6e6);
  --qr-conn-teal-hover-border:rgba(40,130,140,.45);
  /* Compact mode buttons */
  --qr-compact-cat-bg:linear-gradient(180deg,#f0f7f4,#e6f0eb);
  --qr-compact-cat-border:rgba(60,120,90,.22);
  --qr-compact-cat-text:#2d5a42;
  --qr-compact-cat-hover-bg:linear-gradient(180deg,#e8f2ec,#dceae3);
  --qr-compact-cat-hover-border:rgba(60,120,90,.38);
  --qr-compact-fav-bg:linear-gradient(180deg,#fef0f2,#fce4e8);
  --qr-compact-fav-border:rgba(158,69,90,.22);
  --qr-compact-fav-text:#9e455a;
  --qr-compact-inject-bg:linear-gradient(180deg,#fef3e6,#fceacd);
  --qr-compact-inject-border:rgba(132,88,35,.22);
  --qr-compact-inject-text:#845823;
  --qr-compact-header-bg:rgba(255,255,255,.4);
  --qr-compact-header-text:#4f463d;
  --qr-compact-group-text:#8a7e72;
  --qr-compact-sep:rgba(26,26,30,.08);
  /* Token styles */
  --qr-token-item-bg:#f1ebe2;
  --qr-token-item-border:rgba(26,26,30,.14);
  --qr-token-item-text:#3c342c;
  --qr-token-then-bg:#ffe6c9;
  --qr-token-then-border:rgba(170,112,42,.34);
  --qr-token-then-text:#7e4e16;
  --qr-token-simul-bg:#ece7ff;
  --qr-token-simul-border:rgba(92,77,155,.34);
  --qr-token-simul-text:#4b3a8a;
  --qr-token-raw-bg:#ececec;
  --qr-token-raw-border:rgba(105,105,110,.28);
  --qr-token-raw-text:#4a4a4f;
  /* Row label */
  --qr-row-label:#5d544b;
}
/* === Base Styles Using CSS Variables === */
#${OVERLAY_ID}{position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483000;display:flex;align-items:flex-start;justify-content:center;backdrop-filter:blur(7px);overflow:auto;padding:8px;scrollbar-gutter:stable}
#${OVERLAY_ID} *{box-sizing:border-box;scrollbar-width:thin}
#${OVERLAY_ID} ::-webkit-scrollbar{width:6px;height:6px}
#${OVERLAY_ID} ::-webkit-scrollbar-track{background:transparent;border-radius:3px}
#${OVERLAY_ID} ::-webkit-scrollbar-thumb{border-radius:3px;transition:background .2s}
#${OVERLAY_ID} ::-webkit-scrollbar-corner{background:transparent}
.fp-panel{position:relative;display:flex;flex-direction:column;border-radius:20px;overflow:hidden;border:1px solid var(--qr-border-1);background:var(--qr-bg-1);box-shadow:0 28px 70px var(--qr-shadow);color:var(--qr-text-1);font-family:"LXGW WenKai","Noto Sans SC","Segoe UI",sans-serif;flex-shrink:0;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);margin:8px auto;transition:background .3s ease,color .3s ease}
.fp-panel *{scrollbar-color:var(--qr-scrollbar) transparent}
.fp-panel ::-webkit-scrollbar-thumb{background:var(--qr-scrollbar)}
.fp-panel ::-webkit-scrollbar-thumb:hover{background:var(--qr-scrollbar-hover)}
.fp-top{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;padding:10px 12px;border-bottom:1px solid var(--qr-topbar-border);background:var(--qr-topbar-bg);column-gap:10px}
.fp-left,.fp-right{display:flex;align-items:center;gap:8px}
.fp-right{justify-content:flex-end;min-width:0;overflow:auto}
.fp-left{min-width:0;overflow:auto}
.fp-btn{border:none;background:color-mix(in srgb,var(--qr-btn-bg,var(--qr-bg-3,#fff)) 94%, #fff 6%);color:var(--qr-text-1,#1f2023);border-radius:999px;padding:7px 13px;min-height:var(--qr-btn-h-md);cursor:pointer;font-size:13px;font-weight:600;white-space:nowrap;line-height:1.2;box-shadow:0 0 0 1px var(--qr-btn-ring),0 2px 8px rgba(0,0,0,.16);transform:translateY(0);transition:background .18s ease,box-shadow .2s ease,transform .12s ease,opacity .15s ease,filter .16s ease}
.fp-btn:hover{background:color-mix(in srgb,var(--qr-btn-hover-bg,#fff) 96%, #fff 4%);box-shadow:0 0 0 1px color-mix(in srgb,var(--qr-btn-ring) 78%, #fff 22%),0 4px 12px rgba(0,0,0,.20);transform:translateY(0);filter:brightness(1.015)}
.fp-btn:active{transform:translateY(0) scale(.99);box-shadow:0 0 0 1px color-mix(in srgb,var(--qr-btn-ring) 70%, #fff 30%),0 1px 4px rgba(0,0,0,.14)}
.fp-btn:focus-visible{outline:none;box-shadow:var(--qr-control-focus-shadow)}
.fp-btn:disabled{opacity:.48;cursor:not-allowed;transform:none;box-shadow:none}
.fp-btn.primary{background:color-mix(in srgb,var(--qr-accent) 92%, #fff 8%);color:var(--qr-text-on-accent)}
.fp-btn.icon-only{padding:6px 8px;min-height:var(--qr-btn-h-sm);min-width:var(--qr-btn-h-sm);display:inline-flex;align-items:center;justify-content:center}
.fp-top .fp-btn{min-height:var(--qr-btn-h-sm);padding:6px 11px}
.fp-top .fp-btn.icon-only{padding:6px 8px}
.fp-top .fp-btn{box-shadow:0 0 0 1px var(--qr-btn-ring),0 2px 8px rgba(12,16,22,.16)}
.fp-top .fp-btn:hover{box-shadow:0 0 0 1px color-mix(in srgb,var(--qr-btn-ring) 78%, #fff 22%),0 4px 12px rgba(12,16,22,.22);transform:translateY(0)}
.fp-top .fp-btn:active{box-shadow:0 0 0 1px color-mix(in srgb,var(--qr-btn-ring) 70%, #fff 30%),0 1px 5px rgba(12,16,22,.15)}
.fp-btn .fp-ico{width:14px;height:14px;display:inline-block;vertical-align:-2px;margin-right:6px}
.fp-btn.icon-only .fp-ico{margin-right:0}
.fp-title{font-weight:800;font-size:14px;letter-spacing:.2px;color:inherit;white-space:nowrap}
.fp-quick-actions{display:flex;align-items:center;gap:7px;margin-left:4px}
.fp-conn-btn{position:relative}
.fp-conn-btn.is-selected{border-width:1px;font-weight:700}
.fp-conn-btn.is-selected .fp-ico{filter:none}
.fp-conn-orange.is-selected{background:#b66a17!important;border-color:#c27722!important;color:#fff7ec!important;box-shadow:0 0 0 1px rgba(255,255,255,.22) inset}
.fp-conn-purple.is-selected{background:#6f52c7!important;border-color:#7b5dd8!important;color:#f7f2ff!important;box-shadow:0 0 0 1px rgba(255,255,255,.22) inset}
.fp-conn-green.is-selected{background:#2d8e4f!important;border-color:#36a35d!important;color:#eefdf3!important;box-shadow:0 0 0 1px rgba(255,255,255,.22) inset}
.fp-conn-blue.is-selected{background:#2f66c8!important;border-color:#3b76e2!important;color:#eff6ff!important;box-shadow:0 0 0 1px rgba(255,255,255,.22) inset}
.fp-conn-red.is-selected{background:#ba4545!important;border-color:#cf5454!important;color:#fff3f3!important;box-shadow:0 0 0 1px rgba(255,255,255,.22) inset}
.fp-conn-cyan.is-selected{background:#177f90!important;border-color:#1f93a6!important;color:#ecfdff!important;box-shadow:0 0 0 1px rgba(255,255,255,.22) inset}
.fp-conn-btn.is-selected:hover{filter:brightness(1.03)}
.fp-connector-switch{display:inline-flex;align-items:center;padding:0;border-radius:999px;border:1px solid var(--qr-btn-border,rgba(120,120,130,.28));background:var(--qr-btn-bg,var(--qr-bg-3,#fff));color:var(--qr-text-1,#1f2023);cursor:pointer;user-select:none;transition:background .18s ease,border-color .18s ease,box-shadow .18s ease}
.fp-connector-switch:hover{background:var(--qr-btn-hover-bg);border-color:var(--qr-btn-hover-border)}
.fp-connector-switch .fp-switch-track{position:relative;display:inline-flex;align-items:center;width:56px;height:24px;padding:0 8px;border-radius:999px;background:rgba(127,127,137,.24);transition:background .18s ease}
.fp-connector-switch .fp-switch-label-off,.fp-connector-switch .fp-switch-label-on{position:absolute;font-size:10px;font-weight:700;letter-spacing:.25px;line-height:1;opacity:.72;transition:opacity .18s ease,color .18s ease}
.fp-connector-switch .fp-switch-label-off{left:10px}
.fp-connector-switch .fp-switch-label-on{right:10px}
.fp-connector-switch .fp-switch-thumb{position:absolute;left:2px;top:2px;width:20px;height:20px;border-radius:50%;background:var(--qr-bg-3,#fff);box-shadow:none;transition:transform .2s cubic-bezier(.22,.8,.32,1),background .18s ease}
.fp-connector-switch.is-on{border-color:var(--qr-accent);box-shadow:0 0 0 2px rgba(96,166,255,.16)}
.fp-connector-switch.is-on .fp-switch-track{background:var(--qr-accent)}
.fp-connector-switch.is-on .fp-switch-thumb{transform:translateX(32px);background:var(--qr-bg-3,#fff)}
.fp-connector-switch.is-on .fp-switch-label-off{opacity:.4;color:var(--qr-text-on-accent,#fff)}
.fp-connector-switch.is-on .fp-switch-label-on{opacity:1;color:var(--qr-text-on-accent,#fff)}
.fp-connector-switch:not(.is-on) .fp-switch-label-off{opacity:1;color:var(--qr-text-1,#1f2023)}
.fp-connector-switch:not(.is-on) .fp-switch-label-on{opacity:.45;color:var(--qr-text-1,#1f2023)}
.fp-btn-then{background:var(--qr-conn-orange-bg);border-color:var(--qr-conn-orange-border);color:var(--qr-conn-orange-text)}
.fp-btn-then:hover{background:var(--qr-conn-orange-hover-bg);border-color:var(--qr-conn-orange-hover-border)}
.fp-btn-simul{background:var(--qr-conn-purple-bg);border-color:var(--qr-conn-purple-border);color:var(--qr-conn-purple-text)}
.fp-btn-simul:hover{background:var(--qr-conn-purple-hover-bg);border-color:var(--qr-conn-purple-hover-border)}
.fp-conn-orange{background:var(--qr-conn-orange-bg);border-color:var(--qr-conn-orange-border);color:var(--qr-conn-orange-text)}
.fp-conn-orange:hover{background:var(--qr-conn-orange-hover-bg);border-color:var(--qr-conn-orange-hover-border)}
.fp-conn-purple{background:var(--qr-conn-purple-bg);border-color:var(--qr-conn-purple-border);color:var(--qr-conn-purple-text)}
.fp-conn-purple:hover{background:var(--qr-conn-purple-hover-bg);border-color:var(--qr-conn-purple-hover-border)}
.fp-conn-green{background:var(--qr-conn-green-bg);border-color:var(--qr-conn-green-border);color:var(--qr-conn-green-text)}
.fp-conn-green:hover{background:var(--qr-conn-green-hover-bg);border-color:var(--qr-conn-green-hover-border)}
.fp-conn-blue{background:var(--qr-conn-blue-bg);border-color:var(--qr-conn-blue-border);color:var(--qr-conn-blue-text)}
.fp-conn-blue:hover{background:var(--qr-conn-blue-hover-bg);border-color:var(--qr-conn-blue-hover-border)}
.fp-conn-red{background:var(--qr-conn-red-bg);border-color:var(--qr-conn-red-border);color:var(--qr-conn-red-text)}
.fp-conn-red:hover{background:var(--qr-conn-red-hover-bg);border-color:var(--qr-conn-red-hover-border)}
.fp-conn-cyan{background:var(--qr-conn-teal-bg);border-color:var(--qr-conn-teal-border);color:var(--qr-conn-teal-text)}
.fp-conn-cyan:hover{background:var(--qr-conn-teal-hover-bg);border-color:var(--qr-conn-teal-hover-border)}
.fp-path{padding:8px 12px;border-bottom:1px solid var(--qr-border-2);background:var(--qr-path-bg);color:var(--qr-breadcrumb-text);font-size:12px;white-space:nowrap;overflow:auto;display:flex;align-items:center;gap:0}
.fp-path-sep{color:var(--qr-breadcrumb-sep);margin:0 2px;flex-shrink:0}
.fp-path-link{cursor:pointer;padding:2px 6px;border-radius:6px;transition:background .15s ease,color .15s ease;white-space:nowrap;flex-shrink:0}
.fp-path-link:hover{background:var(--qr-breadcrumb-hover-bg);color:var(--qr-text-1)}
.fp-path-link:last-child{font-weight:700;color:var(--qr-text-1)}
.fp-body{flex:1;display:flex;min-height:0}
.fp-sidebar{display:flex;flex-direction:column;border-right:1px solid var(--qr-sidebar-border);background:var(--qr-sidebar-bg);min-width:220px;max-width:520px}
.fp-side-head{display:flex;padding:10px;border-bottom:1px solid var(--qr-border-2);align-items:center}
.fp-side-search{display:flex;align-items:stretch;gap:0;flex:1;min-width:0;min-height:40px;padding:2px 2px 2px 12px;border:1px solid var(--qr-btn-border,rgba(120,120,130,.28));border-radius:12px;background:var(--qr-bg-input,var(--qr-bg-3,#fff));box-shadow:var(--qr-control-rest-shadow);overflow:hidden;transition:border-color .16s ease,box-shadow .18s ease,background .16s ease}
.fp-side-search:focus-within{border-color:var(--qr-accent);background:var(--qr-btn-hover-bg);box-shadow:var(--qr-control-focus-shadow)}
.fp-side-head .fp-input{flex:1;min-width:0}
.fp-side-search-input{border:none!important;background:transparent!important;box-shadow:none!important;border-radius:0!important;outline:none!important;appearance:none!important;min-height:36px!important;padding:8px 0!important;transform:none!important}
.fp-side-search-input:focus{border:none!important;background:transparent!important;box-shadow:none!important;outline:none!important;transform:none!important}
.fp-tree-tools{display:flex;align-items:stretch;flex:none;padding:0;margin-left:6px}
.fp-tree-tool-btn{width:36px;height:36px;padding:0;min-height:36px;border-radius:0 10px 10px 0;border:none;background:transparent;color:var(--qr-text-2);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:none;transition:background .15s ease,color .15s ease,transform .12s ease}
.fp-tree-tool-btn:hover{background:var(--qr-bg-hover);color:var(--qr-text-1)}
.fp-tree-tool-btn:active{transform:translateY(1px)}
.fp-tree-tool-btn .fp-ico{width:13px;height:13px}
.fp-input{width:100%;padding:9px 14px;border:1px solid var(--qr-btn-border,rgba(120,120,130,.28));border-radius:var(--qr-control-radius);min-height:var(--qr-control-min-h);background:var(--qr-bg-input,var(--qr-bg-3,#fff));color:var(--qr-text-1,#1f2023);box-shadow:none;transition:border-color .16s ease,box-shadow .18s ease,transform .12s ease,background .16s ease}
.fp-input::placeholder{color:var(--qr-placeholder)}
#${OVERLAY_ID} input:not([type="checkbox"]):not([type="radio"]),#${OVERLAY_ID} textarea,#${OVERLAY_ID} select{background:var(--qr-bg-input,var(--qr-bg-3,#fff))!important;color:var(--qr-text-1,#1f2023)!important;border:1px solid var(--qr-btn-border,rgba(120,120,130,.28))!important;border-radius:var(--qr-control-radius)!important;min-height:var(--qr-control-min-h)!important;box-shadow:none!important;outline:none!important;padding:9px 14px!important;transition:border-color .16s ease,box-shadow .18s ease,transform .12s ease,background .16s ease}
#${OVERLAY_ID} select{appearance:none!important;-webkit-appearance:none!important;-moz-appearance:none!important;padding-right:38px!important;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='M4.2 6.2 8 10l3.8-3.8' stroke='%23939aa8' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")!important;background-repeat:no-repeat!important;background-position:right 12px center!important;background-size:12px 12px!important}
#${OVERLAY_ID} .fp-worldbook-select-wrap{position:relative;display:flex;align-items:center;min-width:220px;max-width:320px;flex:1}
#${OVERLAY_ID} .fp-worldbook-select-wrap > select{width:100%;padding-right:34px!important;background-image:none!important}
#${OVERLAY_ID} .fp-worldbook-select-wrap .fp-worldbook-chevron{position:absolute;right:11px;top:50%;width:14px;height:14px;transform:translateY(-50%) rotate(0deg);transform-origin:center;pointer-events:none;color:var(--qr-text-2);transition:transform .18s ease,color .18s ease}
#${OVERLAY_ID} .fp-worldbook-select-wrap:focus-within .fp-worldbook-chevron,#${OVERLAY_ID} .fp-worldbook-select-wrap.is-open .fp-worldbook-chevron{transform:translateY(-50%) rotate(180deg);color:var(--qr-text-1)}
#${OVERLAY_ID} input:not([type="checkbox"]):not([type="radio"])::placeholder,#${OVERLAY_ID} textarea::placeholder{color:var(--qr-placeholder)!important}
#${OVERLAY_ID} input:not([type="checkbox"]):not([type="radio"]):focus,#${OVERLAY_ID} textarea:focus{border-color:var(--qr-accent)!important;background:var(--qr-btn-hover-bg)!important;box-shadow:var(--qr-control-focus-shadow)!important;transform:translateY(var(--qr-control-lift))}
#${OVERLAY_ID} select:focus{border-color:var(--qr-accent)!important;background-color:var(--qr-btn-hover-bg)!important;box-shadow:var(--qr-control-focus-shadow)!important;transform:translateY(var(--qr-control-lift));background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='M4.2 6.2 8 10l3.8-3.8' stroke='%23939aa8' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")!important;background-repeat:no-repeat!important;background-position:right 12px center!important;background-size:12px 12px!important}
#${OVERLAY_ID} input.fp-side-search-input:not([type="checkbox"]):not([type="radio"]){border:none!important;background:transparent!important;box-shadow:none!important;border-radius:0!important;outline:none!important;appearance:none!important;min-height:36px!important;padding:8px 0!important}
#${OVERLAY_ID} input.fp-side-search-input:not([type="checkbox"]):not([type="radio"]):focus{border:none!important;background:transparent!important;box-shadow:none!important;outline:none!important;transform:none!important}
#${OVERLAY_ID} input:-webkit-autofill,#${OVERLAY_ID} input:-webkit-autofill:hover,#${OVERLAY_ID} input:-webkit-autofill:focus,#${OVERLAY_ID} textarea:-webkit-autofill,#${OVERLAY_ID} select:-webkit-autofill{-webkit-text-fill-color:var(--qr-text-1)!important;box-shadow:0 0 0 1000px var(--qr-bg-input) inset!important;transition:background-color 9999s ease-in-out 0s}
.fp-tree{padding:8px;overflow:auto;flex:1}
.fp-sidebar-foot{display:flex;align-items:center;justify-content:center;gap:6px;padding:8px 10px;border-top:1px solid var(--qr-border-2);color:var(--qr-text-2);font-size:11px;text-align:center}
.fp-sidebar-foot .name{font-weight:700;color:var(--qr-text-1)}
.fp-sidebar-foot .ver{opacity:.78;font-variant-numeric:tabular-nums}
.fp-tree-node{display:flex;align-items:center;gap:6px;padding:7px 8px;border-radius:10px;cursor:pointer;font-size:13px;color:var(--qr-tree-text);transition:background .15s ease,color .15s ease}
.fp-tree-node:hover{background:var(--qr-bg-hover)}
.fp-tree-node.active{background:var(--qr-tree-active-bg);color:var(--qr-tree-active-text)}
.fp-tree-node.drop-target{outline:1px dashed var(--qr-accent);outline-offset:-1px}
.fp-tree-node.is-pointer-dragging{opacity:1;filter:none}
.fp-tree-indent{display:inline-block;width:12px;flex:none}
.fp-main{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--qr-main-bg)}
.fp-main-scroll{flex:1;overflow:auto;padding:14px}
.fp-group-title{font-weight:800;font-size:13px;color:inherit;margin:14px 0 8px}
.fp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.fp-card{position:relative;border:1px solid var(--qr-card-border,rgba(120,120,130,.2));border-radius:16px;padding:11px;background:var(--qr-card-bg,var(--qr-bg-3,#fff));cursor:pointer;min-height:72px;box-shadow:0 1px 0 rgba(255,255,255,.03),0 2px 14px var(--qr-card-shadow);transition:transform .16s ease,box-shadow .18s ease,border-color .18s ease,background .16s ease}
.fp-card:hover{border-color:var(--qr-card-border-hover);box-shadow:0 1px 0 rgba(255,255,255,.05),0 6px 22px var(--qr-card-hover-shadow);transform:translateY(0)}
.fp-card.fp-card-add{display:flex;align-items:center;justify-content:center;padding:0;min-height:72px;border-style:dashed;color:var(--qr-text-2);background:color-mix(in srgb,var(--qr-card-bg,var(--qr-bg-3,#fff)) 82%, var(--qr-accent) 18%)}
.fp-card.fp-card-add:hover{color:var(--qr-accent);background:color-mix(in srgb,var(--qr-card-bg,var(--qr-bg-3,#fff)) 72%, var(--qr-accent) 28%)}
.fp-card.fp-card-add .fp-ico{width:22px;height:22px}
.fp-card.is-pointer-dragging{opacity:1;filter:none}
.fp-card-title{font-size:13px;font-weight:700;line-height:1.35;word-break:break-word;padding-right:54px;color:inherit}
.fp-card-icons{position:absolute;right:8px;top:8px;display:flex;gap:6px}
.fp-mini{font-size:11px;padding:2px 6px;border-radius:99px;background:var(--qr-tag-bg);border:1px solid var(--qr-tag-border);color:var(--qr-tag-text);white-space:nowrap}
.fp-mini.inject{background:var(--qr-tag-inject-bg);border-color:var(--qr-tag-inject-border);color:var(--qr-tag-inject-text)}
.fp-fav-badge{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:999px;background:rgba(224,80,112,.14);border:1px solid rgba(224,80,112,.55);color:var(--qr-fav-color);box-shadow:0 2px 8px rgba(224,80,112,.28)}
.fp-fav-badge svg{width:12px;height:12px;display:block}
.fp-bottom{border-top:1px solid var(--qr-topbar-border);background:var(--qr-bottom-bg);display:flex;flex-direction:column;transition:height .25s ease}
.fp-bottom.is-resizing{transition:none}
.fp-bottom.collapsed{height:auto!important}
.fp-bottom.collapsed .fp-preview{display:none}
.fp-bottom-head{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;font-size:12px;color:var(--qr-text-2)}
.fp-bottom-actions{display:flex;align-items:center;gap:8px}
.fp-preview-btn{min-height:34px;padding:0 12px;font-size:12px;border-radius:999px}
.fp-preview-btn.icon-only{min-width:34px;width:34px;padding:0}
.fp-preview{overflow:auto;padding:8px 12px;display:flex;flex-wrap:wrap;gap:6px}
.fp-token{position:relative;font-size:13px;border-radius:999px;padding:5px 32px 5px 12px;border:1px solid transparent;display:inline-flex;align-items:center;cursor:grab;user-select:none;transition:transform .15s ease,opacity .15s ease}
.fp-token:active{cursor:grabbing}
.fp-token .fp-token-label{display:inline-block;line-height:1.2}
.fp-token .fp-token-del{position:absolute;right:0;top:0;bottom:0;width:28px;display:inline-flex;align-items:center;justify-content:center;padding:0;margin:0;background:transparent;border-left:1px solid var(--qr-border-2);border-top-right-radius:999px;border-bottom-right-radius:999px;color:inherit;font-size:13px;font-weight:700;line-height:1;cursor:pointer;opacity:.72;transition:opacity .15s ease,color .15s ease,background .15s ease}
.fp-token .fp-token-del:hover{opacity:1;color:#d14c4c;background:rgba(209,76,76,.10)}
.fp-token.fp-token-dragging{opacity:1!important;transform:none;filter:none}
.fp-token.drag-over{transform:none;box-shadow:none}
.fp-token.drop-before{box-shadow:inset 2px 0 0 var(--qr-accent)}
.fp-token.drop-after{box-shadow:inset -2px 0 0 var(--qr-accent)}
.fp-token-insert-indicator{width:2px;min-height:22px;align-self:stretch;border-radius:2px;background:var(--qr-accent);opacity:.9;pointer-events:none}
.fp-preview.is-dragging-preview{cursor:grabbing;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
.fp-drag-active,.fp-drag-active *{user-select:none!important;-webkit-user-select:none!important}
.fp-drag-ghost{position:fixed;z-index:2147483690;pointer-events:none;opacity:.96;transform:translate3d(0,0,0);filter:drop-shadow(0 6px 14px rgba(0,0,0,.22))}
.fp-drag-ghost.fp-token{opacity:1}
.fp-token.item{background:var(--qr-token-item-bg);border-color:var(--qr-token-item-border);color:var(--qr-token-item-text)}
.fp-token.then{background:var(--qr-token-then-bg);border-color:var(--qr-token-then-border);color:var(--qr-token-then-text)}
.fp-token.simultaneous{background:var(--qr-token-simul-bg);border-color:var(--qr-token-simul-border);color:var(--qr-token-simul-text)}
.fp-token.conn-orange{background:var(--qr-conn-orange-bg);border-color:var(--qr-conn-orange-border);color:var(--qr-conn-orange-text)}
.fp-token.conn-purple{background:var(--qr-conn-purple-bg);border-color:var(--qr-conn-purple-border);color:var(--qr-conn-purple-text)}
.fp-token.conn-green{background:var(--qr-conn-green-bg);border-color:var(--qr-conn-green-border);color:var(--qr-conn-green-text)}
.fp-token.conn-blue{background:var(--qr-conn-blue-bg);border-color:var(--qr-conn-blue-border);color:var(--qr-conn-blue-text)}
.fp-token.conn-red{background:var(--qr-conn-red-bg);border-color:var(--qr-conn-red-border);color:var(--qr-conn-red-text)}
.fp-token.conn-cyan{background:var(--qr-conn-teal-bg);border-color:var(--qr-conn-teal-border);color:var(--qr-conn-teal-text)}
.fp-token.raw{background:var(--qr-token-raw-bg);border-color:var(--qr-token-raw-border);color:var(--qr-token-raw-text)}
.fp-split-v{width:5px;cursor:col-resize;background:linear-gradient(180deg,transparent,rgba(24,24,27,.18),transparent)}
.fp-split-h{height:5px;cursor:row-resize;background:linear-gradient(90deg,transparent,rgba(24,24,27,.18),transparent)}
.fp-menu{position:fixed;z-index:2147483600;min-width:148px;padding:6px;background:var(--qr-menu-bg,var(--qr-bg-3,#fff));border:1px solid var(--qr-menu-border,var(--qr-border-1,rgba(120,120,130,.3)));border-radius:10px;box-shadow:0 14px 30px rgba(0,0,0,.18);animation:fp-menu-pop .15s ease}
.fp-menu-btn{display:block;width:100%;text-align:left;padding:8px;border-radius:7px;background:transparent;border:none;color:var(--qr-text-1);cursor:pointer;font-size:12px}
.fp-menu-btn:hover{background:var(--qr-menu-hover)}
#${TOAST_CONTAINER_ID}{position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483700;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;max-width:calc(100vw - 16px)}
.fp-toast{pointer-events:auto;max-width:430px;padding:8px 12px;border-radius:12px;background:var(--qr-toast-bg,rgba(24,24,27,.92));border:1px solid var(--qr-toast-border,rgba(255,255,255,.16));color:var(--qr-toast-text,#faf8f4);font-size:12px;box-shadow:0 8px 20px rgba(0,0,0,.30);animation:fp-toast-in .22s ease}
.fp-modal{position:absolute;inset:0;background:var(--qr-modal-overlay);display:flex;align-items:center;justify-content:center;padding:20px;animation:fp-modal-fadein .2s ease;overflow:auto}
.fp-modal-card{width:min(760px,95%);max-height:88vh;overflow:hidden;display:flex;flex-direction:column;border:1px solid var(--qr-menu-border,var(--qr-border-1,rgba(120,120,130,.3)));border-radius:14px;background:var(--qr-modal-bg,var(--qr-bg-3,#fff));padding:14px;color:var(--qr-text-1,#1f2023);animation:fp-modal-card-in .25s ease}
.fp-settings-card{--fp-settings-min-h:460px;--fp-settings-max-h:760px;min-height:var(--fp-settings-min-h);max-height:min(88vh,var(--fp-settings-max-h));height:clamp(var(--fp-settings-min-h),74vh,var(--fp-settings-max-h))}
.fp-edit-item-card{width:min(560px,92vw);min-height:min(70vh,700px);max-height:min(82vh,760px)}
.fp-edit-scroll{flex:1;min-height:0;overflow-y:auto;padding-right:4px;scrollbar-gutter:stable}
.fp-edit-item-card [data-content]{min-height:250px;height:250px}
.fp-content-editor{position:relative;flex:1;min-width:0}
.fp-content-editor [data-content]{padding-bottom:40px}
.fp-qr-gen-btn{position:absolute;right:10px;bottom:10px;z-index:2;border:none;background:transparent;box-shadow:none;padding:0;min-height:auto;line-height:1;color:var(--qr-accent);cursor:pointer;transition:transform .16s ease,filter .16s ease,opacity .16s ease}
.fp-qr-gen-btn .fp-ico{width:20px;height:20px;display:block}
.fp-qr-gen-btn:hover{transform:translateY(-1px) scale(1.08);filter:drop-shadow(0 0 7px color-mix(in srgb,var(--qr-accent) 70%, transparent))}
.fp-qr-gen-btn.is-loading{animation:fp-qr-gen-pulse .95s ease-in-out infinite}
.fp-qr-gen-btn:disabled{opacity:.55;cursor:not-allowed;transform:none;filter:none}
.fp-qr-undo-btn{position:absolute;right:40px;bottom:10px;z-index:2;border:none;background:transparent;box-shadow:none;padding:0;min-height:auto;line-height:1;color:var(--qr-accent);cursor:pointer;transition:transform .16s ease,filter .16s ease,opacity .16s ease}
.fp-qr-undo-btn .fp-ico{width:19px;height:19px;display:block}
.fp-qr-undo-btn:hover{transform:translateY(-1px) scale(1.08);filter:drop-shadow(0 0 6px color-mix(in srgb,var(--qr-accent) 66%, transparent))}
.fp-qr-undo-btn:disabled{opacity:.55;cursor:not-allowed;transform:none;filter:none}
.fp-qr-gen-status{margin:-4px 0 8px 106px;font-size:12px;color:var(--qr-text-2);line-height:1.45;min-height:18px}
.fp-qr-section{border:1px solid var(--qr-border-2);border-radius:12px;padding:10px 12px;background:color-mix(in srgb,var(--qr-bg-2) 72%, var(--qr-bg-3) 28%)}
.fp-qr-section-title{font-size:12px;font-weight:800;color:var(--qr-text-1);margin-bottom:8px}
.fp-qr-grid{display:grid;grid-template-columns:1fr;gap:10px}
.fp-qr-inline{display:flex;gap:8px;align-items:center}
.fp-qr-inline .fp-btn{white-space:nowrap}
.fp-qr-preset-shell{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}
.fp-qr-card{border:1px solid var(--qr-border-2);border-radius:12px;padding:10px;background:color-mix(in srgb,var(--qr-bg-input) 50%, var(--qr-bg-3) 50%)}
.fp-qr-card-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}
.fp-qr-card-title{font-size:12px;font-weight:800;color:var(--qr-text-1)}
.fp-qr-seg-list{display:flex;flex-direction:column;gap:6px}
.fp-qr-seg-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:8px 10px;border:1px solid var(--qr-border-2);border-radius:10px;background:var(--qr-bg-input)}
.fp-qr-seg-main{min-width:0;display:flex;align-items:center}
.fp-qr-seg-note{font-size:13px;font-weight:700;color:var(--qr-text-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fp-qr-seg-ops{display:flex;gap:6px;align-items:center}
.fp-qr-seg-ops .fp-btn{padding:0;min-height:28px;min-width:28px;width:28px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center}
.fp-qr-seg-ops .fp-btn .fp-ico{margin-right:0;width:13px;height:13px}
.fp-qr-drag-handle{cursor:grab}
.fp-qr-drag-handle:active{cursor:grabbing}
.fp-debug-console{width:100%;min-height:420px;max-height:62vh;background:#07090d!important;color:#8dfc9b!important;border:1px solid #1c232e!important;border-radius:12px!important;padding:12px!important;font:12px/1.55 "Cascadia Mono","Consolas","Courier New",monospace;white-space:pre-wrap;word-break:break-word;overflow:auto;box-shadow:inset 0 0 0 1px rgba(255,255,255,.02)}
.fp-debug-console::selection{background:rgba(141,252,155,.25);color:#eaffee}
.fp-debug-console{user-select:text;cursor:text}
.fp-preview-ta{padding:12px 14px!important;border-radius:12px!important;border:1px solid color-mix(in srgb,var(--qr-btn-border) 82%, #fff 18%)!important;background:color-mix(in srgb,var(--qr-bg-input) 86%, #fff 14%)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.35), inset 0 -1px 0 rgba(0,0,0,.04);line-height:1.55;scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--qr-accent) 42%, #9aa4b2 58%) transparent}
.fp-preview-ta::-webkit-scrollbar{width:10px;height:10px}
.fp-preview-ta::-webkit-scrollbar-track{background:transparent;border-left:1px solid color-mix(in srgb,var(--qr-border-2) 76%, transparent 24%)}
.fp-preview-ta::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--qr-accent) 40%, #9aa4b2 60%);border-radius:999px;border:2px solid transparent;background-clip:padding-box}
.fp-preview-ta::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--qr-accent) 56%, #8d97a5 44%)}
.fp-seg-edit-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 12px;margin-bottom:8px}
.fp-seg-edit-grid .fp-row{margin-bottom:0}
.fp-seg-edit-grid .fp-row>label{width:52px}
@media (max-width:760px){
  .fp-seg-edit-grid{grid-template-columns:1fr}
}
.fp-qr-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.fp-qr-toolbar .fp-btn{min-height:32px}
.fp-qr-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.fp-qr-params-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 10px}
.fp-qr-param-item{display:flex;flex-direction:column;gap:4px}
.fp-qr-param-item label{font-size:12px;color:var(--qr-text-2)}
.fp-qr-preset-workbench{display:flex;flex-direction:column;gap:10px}
.fp-qr-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.fp-qr-bar .fp-btn{min-height:32px}
.fp-qr-bar .fp-select{flex:1;min-width:180px}
.fp-qr-bar .fp-select{padding:10px 38px 10px 12px;border-radius:12px;border:1px solid var(--qr-btn-border,rgba(120,120,130,.28));background:var(--qr-bg-input,var(--qr-bg-3,#fff));color:var(--qr-text-1,#1f2023);appearance:none;-webkit-appearance:none;-moz-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='M4.2 6.2 8 10l3.8-3.8' stroke='%23939aa8' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;background-size:12px 12px}
.fp-qr-field{display:flex;flex-direction:column;gap:6px}
.fp-qr-field label{font-size:12px;font-weight:700;color:var(--qr-text-2)}
.fp-qr-field input,.fp-qr-field textarea,.fp-qr-field select{width:100%;padding:10px 12px;border-radius:12px;border:1px solid var(--qr-btn-border,rgba(120,120,130,.28));background:var(--qr-bg-input,var(--qr-bg-3,#fff));color:var(--qr-text-1,#1f2023)}
.fp-qr-field textarea{min-height:104px;resize:vertical;line-height:1.5}
.fp-qr-fields-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.fp-qr-fields-2 .fp-qr-field textarea{min-height:132px}
.fp-qr-inline-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.fp-qr-divider{height:1px;background:var(--qr-border-2);margin:2px 0}
.fp-qr-note{font-size:12px;color:var(--qr-text-2)}
@media (max-width:860px){
  .fp-qr-params-grid{grid-template-columns:1fr}
  .fp-qr-fields-2{grid-template-columns:1fr}
}
@media (max-width:700px){
  .fp-qr-seg-row{grid-template-columns:1fr}
  .fp-qr-seg-ops{justify-content:flex-end;flex-wrap:wrap}
  .fp-qr-bar .fp-select{min-width:0}
}
.fp-modal-title{font-weight:800;font-size:15px;margin-bottom:10px}
.fp-settings-shell{display:grid;grid-template-columns:180px minmax(0,1fr);gap:12px;flex:1;min-height:0;overflow:hidden}
.fp-settings-nav{display:flex;flex-direction:column;gap:4px;padding:2px 10px 2px 0;border-right:1px solid var(--qr-card-border)}
.fp-settings-nav-group{display:flex;flex-direction:column;gap:4px}
.fp-settings-nav-title{font-size:11px;font-weight:800;letter-spacing:.35px;color:var(--qr-text-2);padding:6px 8px 2px}
.fp-settings-tab{position:relative;display:flex;align-items:center;gap:8px;padding:8px 10px;border:none;border-radius:9px;background:transparent;font-size:12px;font-weight:700;cursor:pointer;text-align:left;color:var(--qr-tree-text,var(--qr-text-1,#1f2023));box-shadow:none;transition:background .16s ease,color .16s ease}
.fp-settings-tab:hover{background:var(--qr-bg-hover)}
.fp-settings-tab.active{background:color-mix(in srgb,var(--qr-bg-hover) 80%, var(--qr-accent) 20%);color:var(--qr-text-1);box-shadow:inset 2px 0 0 var(--qr-accent)}
.fp-settings-tab .fp-ico,.fp-settings-tab .fp-tab-ico{width:14px;height:14px;flex:none;opacity:.9}
.fp-settings-body{min-width:0;min-height:0;overflow-y:auto;padding-right:4px;padding-bottom:2px;scrollbar-gutter:stable}
.fp-tab{display:none}
.fp-tab.active{display:block}
.fp-row{display:flex;gap:8px;align-items:center;margin-bottom:8px}
.fp-row > label{width:98px;font-size:12px;color:var(--qr-row-label)}
.fp-row > input,.fp-row > textarea,.fp-row > select{flex:1;padding:9px 14px;border-radius:var(--qr-control-radius);border:1px solid var(--qr-btn-border,rgba(120,120,130,.28));background:var(--qr-bg-input,var(--qr-bg-3,#fff));color:var(--qr-text-1,#1f2023)}
.fp-row > select{appearance:none;-webkit-appearance:none;-moz-appearance:none;padding-right:38px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='M4.2 6.2 8 10l3.8-3.8' stroke='%23939aa8' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;background-size:12px 12px}
.fp-ph-top{display:flex;flex-direction:column;gap:8px;margin-bottom:8px}
.fp-row.fp-ph-top-row{align-items:flex-start;margin-bottom:0}
.fp-row.fp-ph-top-row > label{padding-top:8px}
.fp-ph-top-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.fp-ph-top-line{display:flex;gap:8px;align-items:center;min-width:0}
.fp-ph-auto-spacer{width:88px;flex:0 0 88px;visibility:hidden;pointer-events:none}
.fp-ph-meta{font-size:12px;color:var(--qr-text-2)}
.fp-row.fp-row-block{align-items:flex-start}
.fp-row.fp-row-block > label{padding-top:8px}
.fp-ph-field{flex:1;display:flex;flex-direction:column;gap:8px;min-width:0}
.fp-ph-note{font-size:12px;color:var(--qr-text-2)}
.fp-ph-chip-list{display:flex;flex-wrap:wrap;gap:6px}
.fp-ph-chip{padding:6px 10px;min-height:30px;border-radius:999px;border:1px solid var(--qr-btn-border);background:var(--qr-btn-bg);color:var(--qr-text-1);font-size:12px;line-height:1;cursor:pointer}
.fp-ph-chip:hover{background:var(--qr-btn-hover-bg);border-color:var(--qr-btn-hover-border)}
.fp-ph-chip:focus-visible{outline:none;box-shadow:var(--qr-control-focus-shadow)}
.fp-ph-chip b{font-weight:700}
.fp-quick-custom-btn{min-width:74px}
.fp-row.fp-save-toggle{align-items:center}
.fp-cat-field{flex:1;display:flex;flex-direction:column;gap:8px;min-width:0}
.fp-cat-picker{position:relative;flex:1;min-width:0}
.fp-cat-picker-trigger{width:100%;min-height:40px;padding:8px 34px 8px 12px;border:1px solid var(--qr-btn-border);border-radius:12px;background:var(--qr-bg-input);color:var(--qr-text-1);text-align:left;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;position:relative}
.fp-cat-picker-trigger:hover{border-color:var(--qr-btn-hover-border);background:var(--qr-btn-hover-bg)}
.fp-cat-picker-trigger .fp-ico{position:absolute;right:10px;top:50%;transform:translateY(-50%);width:12px;height:12px;opacity:.72;margin-right:0}
.fp-cat-picker.open .fp-cat-picker-trigger{border-color:var(--qr-accent);box-shadow:var(--qr-control-focus-shadow)}
.fp-cat-picker-panel{position:absolute;left:0;right:0;top:calc(100% + 6px);display:none;z-index:90;border:1px solid var(--qr-menu-border);border-radius:12px;background:var(--qr-menu-bg);box-shadow:0 12px 28px rgba(0,0,0,.24);padding:8px}
.fp-cat-picker.open .fp-cat-picker-panel{display:block}
.fp-cat-picker.open-up .fp-cat-picker-panel{top:auto;bottom:calc(100% + 6px)}
.fp-cat-picker-search{width:100%;margin-bottom:8px}
.fp-cat-picker-list{max-height:220px;overflow:auto;display:flex;flex-direction:column;gap:4px}
.fp-cat-opt{width:100%;border:1px solid transparent;border-radius:9px;background:transparent;color:var(--qr-text-1);padding:7px 9px;text-align:left;cursor:pointer;font-size:12px;line-height:1.35}
.fp-cat-opt:hover{background:var(--qr-menu-hover)}
.fp-cat-opt.active{border-color:var(--qr-accent);background:color-mix(in srgb,var(--qr-menu-hover) 72%, var(--qr-accent) 28%)}
.fp-cat-empty{padding:8px 10px;color:var(--qr-text-2);font-size:12px}
.fp-multi-picker{position:relative;flex:1;min-width:0}
.fp-multi-trigger{width:100%;min-height:36px;padding:6px 30px 6px 10px;border:1px solid var(--qr-btn-border);border-radius:10px;background:var(--qr-bg-input);color:var(--qr-text-1);text-align:left;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;position:relative;font-size:12px;line-height:1.35}
.fp-multi-trigger:hover{border-color:var(--qr-btn-hover-border);background:var(--qr-btn-hover-bg)}
.fp-multi-trigger .fp-ico{position:absolute;right:9px;top:50%;transform:translateY(-50%) rotate(0deg);width:12px;height:12px;opacity:.72;margin-right:0;transition:transform .18s ease,color .18s ease}
.fp-multi-picker.open .fp-multi-trigger .fp-ico{transform:translateY(-50%) rotate(180deg)}
.fp-multi-text{display:block;overflow:hidden;text-overflow:ellipsis}
.fp-multi-picker.open .fp-multi-trigger{border-color:var(--qr-accent);box-shadow:var(--qr-control-focus-shadow)}
.fp-multi-panel{position:absolute;left:0;right:0;top:calc(100% + 5px);display:none;z-index:90;border:1px solid var(--qr-menu-border);border-radius:10px;background:var(--qr-menu-bg);box-shadow:0 8px 20px rgba(0,0,0,.20);padding:6px}
.fp-multi-picker.open .fp-multi-panel{display:block}
.fp-multi-panel-list{max-height:184px;overflow:auto;display:flex;flex-direction:column;gap:2px}
.fp-multi-opt{display:flex;align-items:center;gap:7px;width:100%;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--qr-text-1);padding:6px 8px;text-align:left;cursor:pointer;font-size:12px;line-height:1.35}
.fp-multi-opt:hover{background:var(--qr-menu-hover)}
.fp-multi-opt.active{border-color:var(--qr-accent);background:color-mix(in srgb,var(--qr-menu-hover) 72%, var(--qr-accent) 28%)}
.fp-multi-opt input{pointer-events:none;width:13px;height:13px;margin:0;accent-color:var(--qr-accent)}
.fp-color-picker{position:relative;display:inline-flex;align-items:center}
.fp-color-trigger{width:28px;height:28px;border-radius:50%;border:1px solid var(--qr-btn-border);background:var(--qr-bg-3);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:var(--qr-control-inset-shadow),var(--qr-control-rest-shadow);padding:0;transition:border-color .15s ease,box-shadow .15s ease,transform .1s ease}
.fp-color-trigger:hover{border-color:var(--qr-btn-hover-border);box-shadow:var(--qr-control-inset-shadow),var(--qr-control-hover-shadow)}
.fp-color-trigger:active{transform:scale(.97)}
.fp-color-dot{width:16px;height:16px;border-radius:50%;border:1px solid rgba(255,255,255,.4);box-shadow:inset 0 0 0 1px rgba(0,0,0,.2)}
.fp-color-menu{position:absolute;top:calc(100% + 6px);left:0;display:none;flex-direction:column;gap:7px;z-index:40;padding:8px;border-radius:12px;background:var(--qr-menu-bg);border:1px solid var(--qr-menu-border);box-shadow:0 10px 22px rgba(0,0,0,.28)}
.fp-color-picker.open .fp-color-menu{display:flex}
.fp-color-opt{width:24px;height:24px;border-radius:50%;border:1px solid rgba(255,255,255,.22);padding:0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;background:transparent;transition:transform .1s ease,border-color .12s ease,box-shadow .12s ease}
.fp-color-opt:hover{transform:scale(1.08);border-color:rgba(255,255,255,.52)}
.fp-color-opt.active{border-color:#fff;box-shadow:0 0 0 2px rgba(255,255,255,.2)}
.fp-color-opt .fp-color-dot{width:14px;height:14px}
.fp-row > textarea{min-height:90px;resize:vertical}
.fp-settings-card [data-custom-css]{min-height:240px;height:240px}
.fp-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px;flex-shrink:0}
.fp-actions button{padding:8px 14px;border-radius:999px;min-height:var(--qr-btn-h-lg);border:none;background:color-mix(in srgb,var(--qr-btn-bg,var(--qr-bg-3,#fff)) 94%, #fff 6%);color:var(--qr-text-1);cursor:pointer;font-weight:600;box-shadow:0 0 0 1px var(--qr-btn-ring),0 2px 8px rgba(0,0,0,.16);transition:background .18s ease,box-shadow .2s ease,transform .12s ease,filter .16s ease}
.fp-actions button:hover{box-shadow:0 0 0 1px color-mix(in srgb,var(--qr-btn-ring) 78%, #fff 22%),0 4px 12px rgba(0,0,0,.20);transform:translateY(0);filter:brightness(1.015)}
.fp-actions button:active{transform:translateY(0) scale(var(--qr-control-press-scale))}
.fp-actions button:focus-visible{outline:none;box-shadow:var(--qr-control-inset-shadow),var(--qr-control-focus-shadow)}
.fp-actions button.primary{background:var(--qr-accent);border-color:var(--qr-accent);color:var(--qr-text-on-accent)}
.fp-actions button.danger{background:#a83d3d;border-color:#b64646;color:#fff5f5}
.fp-actions button.danger:hover{background:#b64646;border-color:#c95656}
.fp-toggle{display:inline-flex;align-items:center;gap:10px;cursor:pointer;user-select:none}
.fp-toggle input[type="checkbox"]{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.fp-toggle-track{position:relative;display:inline-flex;align-items:center;width:42px;height:24px;border-radius:999px;background:rgba(127,127,137,.35);border:1px solid var(--qr-btn-border);transition:background .18s ease,border-color .18s ease,box-shadow .18s ease}
.fp-toggle-thumb{position:absolute;left:2px;top:2px;width:18px;height:18px;border-radius:50%;background:var(--qr-bg-3);transition:transform .2s cubic-bezier(.22,.8,.32,1)}
.fp-toggle input[type="checkbox"]:checked + .fp-toggle-track{background:var(--qr-accent);border-color:var(--qr-accent);box-shadow:0 0 0 2px rgba(96,166,255,.16)}
.fp-toggle input[type="checkbox"]:checked + .fp-toggle-track .fp-toggle-thumb{transform:translateX(18px)}
.fp-toggle-text{font-size:12px;color:var(--qr-text-2)}
.fp-panel.fp-compact .fp-body{flex-direction:column}
.fp-panel.fp-compact .fp-sidebar{width:100%!important;max-width:none;min-width:0;border-right:none;border-bottom:1px solid var(--qr-topbar-border);max-height:44%}
.fp-panel.fp-compact .fp-split-v{display:none}
.fp-panel.fp-compact .fp-main{min-height:0}
.fp-panel.fp-compact .fp-main-scroll{padding:10px}
.fp-panel.fp-compact .fp-grid{grid-template-columns:1fr}
/* 紧凑按钮列表模式 */
.fp-compact-list{flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden}
.fp-compact-list .fp-compact-search{padding:8px 10px;border-bottom:1px solid var(--qr-border-2)}
.fp-compact-list .fp-compact-header{padding:8px 12px;font-weight:800;font-size:13px;color:var(--qr-compact-header-text);border-bottom:1px solid rgba(26,26,30,.06);background:var(--qr-compact-header-bg)}
.fp-compact-list .fp-compact-scroll{flex:1;overflow:auto;padding:8px}
.fp-compact-btns{display:flex;flex-wrap:wrap;gap:6px;padding:4px 0}
.fp-compact-btns .fp-cbtn{display:inline-flex;align-items:center;gap:5px;padding:7px 13px;border:1px solid var(--qr-btn-border);border-radius:999px;min-height:var(--qr-btn-h-md);background:var(--qr-btn-bg);color:var(--qr-text-1);font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;line-height:1.3;box-shadow:var(--qr-control-inset-shadow),var(--qr-control-rest-shadow);transition:background .15s,border-color .15s,box-shadow .2s,transform .12s}
.fp-compact-btns .fp-cbtn:hover{background:var(--qr-btn-hover-bg);border-color:var(--qr-btn-hover-border);box-shadow:var(--qr-control-inset-shadow),var(--qr-control-hover-shadow);transform:translateY(var(--qr-control-lift))}
.fp-compact-btns .fp-cbtn:active{transform:scale(.97)}
.fp-compact-btns .fp-cbtn.fp-cbtn-cat{background:var(--qr-compact-cat-bg);border-color:var(--qr-compact-cat-border);color:var(--qr-compact-cat-text)}
.fp-compact-btns .fp-cbtn.fp-cbtn-cat:hover{background:var(--qr-compact-cat-hover-bg);border-color:var(--qr-compact-cat-hover-border)}
.fp-compact-btns .fp-cbtn.fp-cbtn-fav{background:var(--qr-compact-fav-bg);border-color:var(--qr-compact-fav-border);color:var(--qr-compact-fav-text)}
.fp-compact-btns .fp-cbtn.fp-cbtn-inject{background:var(--qr-compact-inject-bg);border-color:var(--qr-compact-inject-border);color:var(--qr-compact-inject-text)}
.fp-compact-sep{width:100%;height:1px;background:var(--qr-compact-sep);margin:6px 0}
.fp-compact-group-label{font-size:12px;color:var(--qr-compact-group-text);font-weight:700;padding:6px 2px 2px;width:100%}
.fp-card-excerpt{font-size:11px;color:var(--qr-excerpt-text);margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-all;line-height:1.4;opacity:.7}
.fp-cbtn-excerpt{font-size:10px;color:var(--qr-excerpt-text);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;opacity:.65;font-weight:400}
.fp-compact-bottom{flex-shrink:0;max-height:120px;border-top:1px solid var(--qr-topbar-border)}
.fp-compact-bottom .fp-preview{max-height:80px;overflow:auto}
/* === Theme: ink-noir (墨夜黑 - Dark) === */
#${OVERLAY_ID}[data-theme="ink-noir"],.fp-panel[data-theme="ink-noir"]{
  --qr-bg-1:linear-gradient(180deg,#16181d 0%,#121419 100%);
  --qr-bg-2:linear-gradient(180deg,#1c1f26,#16181d);
  --qr-bg-3:#1e232c;
  --qr-bg-input:#1e232c;
  --qr-bg-hover:rgba(255,255,255,.08);
  --qr-text-1:#e8edf5;
  --qr-text-2:#b8c4d4;
  --qr-text-on-accent:#171a20;
  --qr-placeholder:rgba(232,237,245,.35);
  --qr-border-1:rgba(255,255,255,.12);
  --qr-border-2:rgba(255,255,255,.08);
  --qr-accent:#e8edf5;
  --qr-accent-hover:#ffffff;
  --qr-shadow:rgba(0,0,0,.50);
  --qr-scrollbar:rgba(255,255,255,.15);
  --qr-scrollbar-hover:rgba(255,255,255,.28);
  --qr-topbar-bg:#171a20;
  --qr-topbar-border:rgba(255,255,255,.08);
  --qr-sidebar-bg:#171a20;
  --qr-sidebar-border:rgba(255,255,255,.08);
  --qr-main-bg:#171a20;
  --qr-menu-bg:#1e232c;
  --qr-menu-border:rgba(255,255,255,.14);
  --qr-menu-hover:rgba(255,255,255,.08);
  --qr-modal-bg:#171a20;
  --qr-modal-overlay:rgba(0,0,0,.65);
  --qr-toast-bg:rgba(30,35,44,.95);
  --qr-toast-border:rgba(255,255,255,.12);
  --qr-toast-text:#e8edf5;
  --qr-overlay-bg:radial-gradient(1200px 520px at 12% 0%,rgba(40,50,70,.35),transparent 56%),radial-gradient(1000px 560px at 92% 8%,rgba(30,40,60,.4),transparent 54%),rgba(8,10,14,.72);
  --qr-bottom-bg:#171a20;
  --qr-path-bg:#171a20;
  --qr-tag-bg:#2a2d36;
  --qr-tag-border:rgba(255,255,255,.15);
  --qr-tag-text:#c8d0dc;
  --qr-tag-inject-bg:#2e2518;
  --qr-tag-inject-border:rgba(200,150,70,.3);
  --qr-tag-inject-text:#d4a86a;
  --qr-breadcrumb-text:#b8c4d4;
  --qr-breadcrumb-sep:rgba(184,196,212,.4);
  --qr-breadcrumb-hover-bg:rgba(255,255,255,.1);
  --qr-card-border-hover:rgba(255,255,255,.22);
  --qr-tab-bg:#1f2430;
  --qr-tab-border:rgba(255,255,255,.18);
  --qr-tab-active-bg:#e8edf5;
  --qr-tab-active-text:#171a20;
  --qr-tree-text:#d6deea;
  --qr-tree-active-bg:#e8edf5;
  --qr-tree-active-text:#171a20;
  --qr-card-bg:#1e232c;
  --qr-card-border:rgba(255,255,255,.14);
  --qr-card-shadow:rgba(0,0,0,.20);
  --qr-card-hover-shadow:rgba(0,0,0,.35);
  --qr-excerpt-text:#8a9aaa;
  --qr-btn-bg:#2b2d31;
  --qr-btn-border:rgba(255,255,255,.14);
  --qr-btn-hover-bg:#33353a;
  --qr-btn-hover-border:rgba(255,255,255,.28);
  --qr-fav-color:#e08a9a;
  --qr-conn-orange-bg:linear-gradient(180deg,#3a2c18,#302414);
  --qr-conn-orange-border:rgba(200,140,50,.35);
  --qr-conn-orange-text:#e8b860;
  --qr-conn-orange-hover-bg:linear-gradient(180deg,#443218,#382a14);
  --qr-conn-orange-hover-border:rgba(200,140,50,.5);
  --qr-conn-purple-bg:linear-gradient(180deg,#2a2440,#221c38);
  --qr-conn-purple-border:rgba(140,120,200,.35);
  --qr-conn-purple-text:#c0b0f0;
  --qr-conn-purple-hover-bg:linear-gradient(180deg,#302840,#28203c);
  --qr-conn-purple-hover-border:rgba(140,120,200,.5);
  --qr-conn-green-bg:linear-gradient(180deg,#1c2e22,#182820);
  --qr-conn-green-border:rgba(80,170,100,.3);
  --qr-conn-green-text:#80c890;
  --qr-conn-green-hover-bg:linear-gradient(180deg,#203424,#1c2e22);
  --qr-conn-green-hover-border:rgba(80,170,100,.45);
  --qr-conn-blue-bg:linear-gradient(180deg,#1a2438,#162030);
  --qr-conn-blue-border:rgba(80,130,220,.3);
  --qr-conn-blue-text:#80b0f0;
  --qr-conn-blue-hover-bg:linear-gradient(180deg,#1e2840,#1a2438);
  --qr-conn-blue-hover-border:rgba(80,130,220,.45);
  --qr-conn-red-bg:linear-gradient(180deg,#301c1c,#281818);
  --qr-conn-red-border:rgba(200,80,80,.3);
  --qr-conn-red-text:#e08080;
  --qr-conn-red-hover-bg:linear-gradient(180deg,#382020,#301c1c);
  --qr-conn-red-hover-border:rgba(200,80,80,.45);
  --qr-conn-teal-bg:linear-gradient(180deg,#182c2e,#142628);
  --qr-conn-teal-border:rgba(60,180,190,.3);
  --qr-conn-teal-text:#70d0d8;
  --qr-conn-teal-hover-bg:linear-gradient(180deg,#1c3032,#182c2e);
  --qr-conn-teal-hover-border:rgba(60,180,190,.45);
  --qr-compact-cat-bg:linear-gradient(180deg,#1c2a24,#1a2420);
  --qr-compact-cat-border:rgba(100,180,130,.28);
  --qr-compact-cat-text:#8ac4a0;
  --qr-compact-cat-hover-bg:linear-gradient(180deg,#203028,#1c2a24);
  --qr-compact-cat-hover-border:rgba(100,180,130,.4);
  --qr-compact-fav-bg:linear-gradient(180deg,#2a1c22,#241a1e);
  --qr-compact-fav-border:rgba(180,90,110,.28);
  --qr-compact-fav-text:#e08a9a;
  --qr-compact-inject-bg:linear-gradient(180deg,#2a2418,#242014);
  --qr-compact-inject-border:rgba(180,130,60,.28);
  --qr-compact-inject-text:#d4a86a;
  --qr-compact-header-bg:rgba(255,255,255,.04);
  --qr-compact-header-text:#d6deea;
  --qr-compact-group-text:#8a9aaa;
  --qr-compact-sep:rgba(255,255,255,.08);
  --qr-token-item-bg:#2a2d36;
  --qr-token-item-border:rgba(255,255,255,.14);
  --qr-token-item-text:#c8d0dc;
  --qr-token-then-bg:#3a2c18;
  --qr-token-then-border:rgba(200,140,50,.34);
  --qr-token-then-text:#e8b860;
  --qr-token-simul-bg:#2a2440;
  --qr-token-simul-border:rgba(140,120,200,.34);
  --qr-token-simul-text:#c0b0f0;
  --qr-token-raw-bg:#2a2d36;
  --qr-token-raw-border:rgba(150,150,160,.28);
  --qr-token-raw-text:#a0a4aa;
  --qr-row-label:#a8b4c4;
}
/* === Theme: sand-gold (沙金暖 - Warm Light) === */
#${OVERLAY_ID}[data-theme="sand-gold"],.fp-panel[data-theme="sand-gold"]{
  --qr-bg-1:linear-gradient(180deg,#f6efe3 0%,#efe4d3 100%);
  --qr-bg-2:linear-gradient(180deg,#fff9ef,#f2e6d4);
  --qr-bg-3:#fffaf1;
  --qr-bg-input:#f8f0e0;
  --qr-bg-hover:rgba(50,40,25,.08);
  --qr-text-1:#2a241c;
  --qr-text-2:#5a4e3c;
  --qr-text-on-accent:#fff;
  --qr-placeholder:rgba(42,36,28,.4);
  --qr-border-1:rgba(97,74,38,.18);
  --qr-border-2:rgba(97,74,38,.12);
  --qr-accent:#614a26;
  --qr-accent-hover:#7a5c30;
  --qr-shadow:rgba(60,40,10,.25);
  --qr-scrollbar:rgba(97,74,38,.18);
  --qr-scrollbar-hover:rgba(97,74,38,.32);
  --qr-topbar-bg:linear-gradient(180deg,#fff9ef,#f2e6d4);
  --qr-topbar-border:rgba(97,74,38,.12);
  --qr-sidebar-bg:#f7efdf;
  --qr-sidebar-border:rgba(97,74,38,.12);
  --qr-main-bg:#f7efdf;
  --qr-menu-bg:#fffaf1;
  --qr-menu-border:rgba(97,74,38,.16);
  --qr-menu-hover:rgba(97,74,38,.08);
  --qr-modal-bg:linear-gradient(180deg,#fff9ef,#f7efdf);
  --qr-modal-overlay:rgba(40,30,10,.45);
  --qr-bottom-bg:#f7efdf;
  --qr-path-bg:#f0e8d8;
  --qr-tab-bg:#fff7ea;
  --qr-tab-border:rgba(97,74,38,.18);
  --qr-tab-active-bg:#614a26;
  --qr-tab-active-text:#fff;
  --qr-tree-text:#4a3e30;
  --qr-tree-active-bg:#614a26;
  --qr-tree-active-text:#fff;
  --qr-card-bg:#fffaf1;
  --qr-card-border:rgba(97,74,38,.14);
  --qr-card-shadow:rgba(60,40,10,.08);
  --qr-card-hover-shadow:rgba(60,40,10,.16);
  --qr-excerpt-text:#8a7e6a;
  --qr-btn-bg:#fff7ea;
  --qr-btn-border:rgba(97,74,38,.22);
  --qr-btn-hover-bg:#fff;
  --qr-btn-hover-border:rgba(97,74,38,.36);
  --qr-compact-cat-bg:linear-gradient(180deg,#f0efe4,#e8e4d8);
  --qr-compact-cat-border:rgba(80,100,70,.22);
  --qr-compact-cat-text:#3a5030;
  --qr-compact-header-bg:rgba(255,250,240,.5);
  --qr-compact-header-text:#5a4e3c;
  --qr-compact-group-text:#8a7e6a;
  --qr-row-label:#6a5e4c;
}
/* === Theme: rose-pink (樱粉柔 - Pink Light) === */
#${OVERLAY_ID}[data-theme="rose-pink"],.fp-panel[data-theme="rose-pink"]{
  --qr-bg-1:linear-gradient(180deg,#fff0f3 0%,#fce8ec 100%);
  --qr-bg-2:linear-gradient(180deg,#fff8f9,#fceef2);
  --qr-bg-3:#fffbfc;
  --qr-bg-input:#fff;
  --qr-bg-hover:rgba(158,69,90,.08);
  --qr-text-1:#4a2832;
  --qr-text-2:#6a4852;
  --qr-text-on-accent:#fff;
  --qr-placeholder:rgba(74,40,50,.4);
  --qr-border-1:rgba(158,69,90,.18);
  --qr-border-2:rgba(158,69,90,.12);
  --qr-accent:#9e455a;
  --qr-accent-hover:#b05068;
  --qr-shadow:rgba(100,40,50,.22);
  --qr-scrollbar:rgba(158,69,90,.18);
  --qr-scrollbar-hover:rgba(158,69,90,.32);
  --qr-topbar-bg:linear-gradient(180deg,#fff8f9,#fceef2);
  --qr-topbar-border:rgba(158,69,90,.12);
  --qr-sidebar-bg:#fff5f7;
  --qr-sidebar-border:rgba(158,69,90,.12);
  --qr-main-bg:#fff5f7;
  --qr-menu-bg:#fffbfc;
  --qr-menu-border:rgba(158,69,90,.16);
  --qr-menu-hover:rgba(158,69,90,.08);
  --qr-modal-bg:linear-gradient(180deg,#fff8f9,#fff5f7);
  --qr-modal-overlay:rgba(50,20,30,.45);
  --qr-bottom-bg:#fff5f7;
  --qr-path-bg:#fceef2;
  --qr-tab-bg:#fff0f3;
  --qr-tab-border:rgba(158,69,90,.18);
  --qr-tab-active-bg:#9e455a;
  --qr-tab-active-text:#fff;
  --qr-tree-text:#5a3842;
  --qr-tree-active-bg:#9e455a;
  --qr-tree-active-text:#fff;
  --qr-card-bg:#fffbfc;
  --qr-card-border:rgba(158,69,90,.14);
  --qr-card-shadow:rgba(100,40,50,.08);
  --qr-card-hover-shadow:rgba(100,40,50,.16);
  --qr-excerpt-text:#b08a92;
  --qr-btn-bg:#fff0f3;
  --qr-btn-border:rgba(158,69,90,.22);
  --qr-btn-hover-bg:#fff;
  --qr-btn-hover-border:rgba(158,69,90,.36);
  --qr-compact-cat-bg:linear-gradient(180deg,#f0f7f4,#e6f0eb);
  --qr-compact-cat-border:rgba(60,120,90,.22);
  --qr-compact-cat-text:#2d5a42;
  --qr-compact-fav-bg:linear-gradient(180deg,#fef0f2,#fce4e8);
  --qr-compact-fav-border:rgba(158,69,90,.26);
  --qr-compact-fav-text:#9e455a;
  --qr-compact-header-bg:rgba(255,245,247,.6);
  --qr-compact-header-text:#5a3842;
  --qr-compact-group-text:#8a6a72;
  --qr-compact-sep:rgba(158,69,90,.12);
  --qr-row-label:#6a4852;
}
/* === Theme: forest-green (翡翠绿 - Green Dark) === */
#${OVERLAY_ID}[data-theme="forest-green"],.fp-panel[data-theme="forest-green"]{
  --qr-bg-1:linear-gradient(180deg,#1a2e24 0%,#142820 100%);
  --qr-bg-2:linear-gradient(180deg,#1e3428,#1a2e24);
  --qr-bg-3:#1e3428;
  --qr-bg-input:#1e3428;
  --qr-bg-hover:rgba(255,255,255,.08);
  --qr-text-1:#d4ead8;
  --qr-text-2:#a4c4aa;
  --qr-text-on-accent:#142820;
  --qr-placeholder:rgba(212,232,218,.35);
  --qr-border-1:rgba(140,200,160,.18);
  --qr-border-2:rgba(140,200,160,.12);
  --qr-accent:#8ac4a0;
  --qr-accent-hover:#9ad4b0;
  --qr-shadow:rgba(0,20,10,.45);
  --qr-scrollbar:rgba(255,255,255,.15);
  --qr-scrollbar-hover:rgba(255,255,255,.28);
  --qr-topbar-bg:linear-gradient(180deg,#1e3428,#1a2e24);
  --qr-topbar-border:rgba(140,200,160,.12);
  --qr-sidebar-bg:#1a2e24;
  --qr-sidebar-border:rgba(140,200,160,.12);
  --qr-main-bg:#1a2e24;
  --qr-menu-bg:#1e3428;
  --qr-menu-border:rgba(140,200,160,.16);
  --qr-menu-hover:rgba(255,255,255,.08);
  --qr-modal-bg:#1a2e24;
  --qr-modal-overlay:rgba(0,15,10,.60);
  --qr-bottom-bg:#1a2e24;
  --qr-path-bg:#1a2e24;
  --qr-tag-bg:#1e2e24;
  --qr-tag-border:rgba(255,255,255,.15);
  --qr-tag-text:#b8d4c4;
  --qr-tag-inject-bg:#2a2818;
  --qr-tag-inject-border:rgba(180,140,50,.3);
  --qr-tag-inject-text:#c4a860;
  --qr-breadcrumb-text:#a4c4aa;
  --qr-breadcrumb-sep:rgba(138,196,160,.4);
  --qr-breadcrumb-hover-bg:rgba(255,255,255,.1);
  --qr-card-border-hover:rgba(138,196,160,.22);
  --qr-tab-bg:#243830;
  --qr-tab-border:rgba(140,200,160,.2);
  --qr-tab-active-bg:#8ac4a0;
  --qr-tab-active-text:#142820;
  --qr-tree-text:#b4d4ba;
  --qr-tree-active-bg:#8ac4a0;
  --qr-tree-active-text:#142820;
  --qr-card-bg:#1e3428;
  --qr-card-border:rgba(140,200,160,.16);
  --qr-card-shadow:rgba(0,20,10,.18);
  --qr-card-hover-shadow:rgba(0,20,10,.32);
  --qr-excerpt-text:#7aa88a;
  --qr-btn-bg:#2a3430;
  --qr-btn-border:rgba(160,190,170,.18);
  --qr-btn-hover-bg:#313c37;
  --qr-btn-hover-border:rgba(160,190,170,.30);
  --qr-fav-color:#d08090;
  --qr-conn-orange-bg:linear-gradient(180deg,#342c16,#2c2412);
  --qr-conn-orange-border:rgba(190,130,40,.35);
  --qr-conn-orange-text:#d8b050;
  --qr-conn-orange-hover-bg:linear-gradient(180deg,#3c3018,#342814);
  --qr-conn-orange-hover-border:rgba(190,130,40,.5);
  --qr-conn-purple-bg:linear-gradient(180deg,#262038,#1e1a30);
  --qr-conn-purple-border:rgba(130,110,190,.35);
  --qr-conn-purple-text:#b0a0e0;
  --qr-conn-purple-hover-bg:linear-gradient(180deg,#2c243c,#241e34);
  --qr-conn-purple-hover-border:rgba(130,110,190,.5);
  --qr-conn-green-bg:linear-gradient(180deg,#1a3020,#16281c);
  --qr-conn-green-border:rgba(70,160,90,.3);
  --qr-conn-green-text:#70c080;
  --qr-conn-green-hover-bg:linear-gradient(180deg,#1e3622,#1a3020);
  --qr-conn-green-hover-border:rgba(70,160,90,.45);
  --qr-conn-blue-bg:linear-gradient(180deg,#182234,#14202c);
  --qr-conn-blue-border:rgba(70,120,210,.3);
  --qr-conn-blue-text:#70a8e8;
  --qr-conn-blue-hover-bg:linear-gradient(180deg,#1c263a,#182234);
  --qr-conn-blue-hover-border:rgba(70,120,210,.45);
  --qr-conn-red-bg:linear-gradient(180deg,#2c1a1a,#241616);
  --qr-conn-red-border:rgba(190,70,70,.3);
  --qr-conn-red-text:#d87070;
  --qr-conn-red-hover-bg:linear-gradient(180deg,#341e1e,#2c1a1a);
  --qr-conn-red-hover-border:rgba(190,70,70,.45);
  --qr-conn-teal-bg:linear-gradient(180deg,#162a2c,#122426);
  --qr-conn-teal-border:rgba(50,170,180,.3);
  --qr-conn-teal-text:#60c8d0;
  --qr-conn-teal-hover-bg:linear-gradient(180deg,#1a2e30,#162a2c);
  --qr-conn-teal-hover-border:rgba(50,170,180,.45);
  --qr-compact-cat-bg:linear-gradient(180deg,#2a4238,#243830);
  --qr-compact-cat-border:rgba(140,200,160,.28);
  --qr-compact-cat-text:#8ac4a0;
  --qr-compact-cat-hover-bg:linear-gradient(180deg,#304840,#2a4238);
  --qr-compact-cat-hover-border:rgba(140,200,160,.4);
  --qr-compact-fav-bg:linear-gradient(180deg,#3a2832,#32242a);
  --qr-compact-fav-border:rgba(200,120,140,.24);
  --qr-compact-fav-text:#e0a0aa;
  --qr-compact-inject-bg:linear-gradient(180deg,#3a3228,#322a22);
  --qr-compact-inject-border:rgba(200,160,100,.24);
  --qr-compact-inject-text:#d4b480;
  --qr-compact-header-bg:rgba(30,52,40,.6);
  --qr-compact-header-text:#b4d4ba;
  --qr-compact-group-text:#8aaa92;
  --qr-compact-sep:rgba(140,200,160,.12);
  --qr-token-item-bg:#243830;
  --qr-token-item-border:rgba(140,200,160,.16);
  --qr-token-item-text:#b4d4ba;
  --qr-token-then-bg:#342c16;
  --qr-token-then-border:rgba(190,130,40,.34);
  --qr-token-then-text:#d8b050;
  --qr-token-simul-bg:#262038;
  --qr-token-simul-border:rgba(130,110,190,.34);
  --qr-token-simul-text:#b0a0e0;
  --qr-token-raw-bg:#2a3430;
  --qr-token-raw-border:rgba(140,150,140,.28);
  --qr-token-raw-text:#98a8a0;
  --qr-row-label:#a4c4aa;
}
/* === Theme: ocean-blue (深海蓝 - Blue Dark) === */
#${OVERLAY_ID}[data-theme="ocean-blue"],.fp-panel[data-theme="ocean-blue"]{
  --qr-bg-1:linear-gradient(180deg,#141e2a 0%,#101824 100%);
  --qr-bg-2:linear-gradient(180deg,#18242e,#141e2a);
  --qr-bg-3:#18242e;
  --qr-bg-input:#18242e;
  --qr-bg-hover:rgba(255,255,255,.08);
  --qr-text-1:#d0e4f4;
  --qr-text-2:#98b8d0;
  --qr-text-on-accent:#101824;
  --qr-placeholder:rgba(200,216,240,.35);
  --qr-border-1:rgba(100,160,220,.18);
  --qr-border-2:rgba(100,160,220,.12);
  --qr-accent:#6aa0d4;
  --qr-accent-hover:#7ab0e4;
  --qr-shadow:rgba(0,10,30,.45);
  --qr-scrollbar:rgba(255,255,255,.15);
  --qr-scrollbar-hover:rgba(255,255,255,.28);
  --qr-topbar-bg:linear-gradient(180deg,#18242e,#141e2a);
  --qr-topbar-border:rgba(100,160,220,.12);
  --qr-sidebar-bg:#141e2a;
  --qr-sidebar-border:rgba(100,160,220,.12);
  --qr-main-bg:#141e2a;
  --qr-menu-bg:#18242e;
  --qr-menu-border:rgba(100,160,220,.16);
  --qr-menu-hover:rgba(255,255,255,.08);
  --qr-modal-bg:#141e2a;
  --qr-modal-overlay:rgba(0,8,20,.60);
  --qr-bottom-bg:#141e2a;
  --qr-path-bg:#141e2a;
  --qr-tag-bg:#1a2230;
  --qr-tag-border:rgba(255,255,255,.15);
  --qr-tag-text:#b8c8e0;
  --qr-tag-inject-bg:#282418;
  --qr-tag-inject-border:rgba(180,140,50,.3);
  --qr-tag-inject-text:#c4a860;
  --qr-breadcrumb-text:#98b8d0;
  --qr-breadcrumb-sep:rgba(106,160,212,.4);
  --qr-breadcrumb-hover-bg:rgba(255,255,255,.1);
  --qr-card-border-hover:rgba(106,160,212,.22);
  --qr-tab-bg:#1e2c3a;
  --qr-tab-border:rgba(100,160,220,.2);
  --qr-tab-active-bg:#6aa0d4;
  --qr-tab-active-text:#101824;
  --qr-tree-text:#a8c8e0;
  --qr-tree-active-bg:#6aa0d4;
  --qr-tree-active-text:#101824;
  --qr-card-bg:#18242e;
  --qr-card-border:rgba(100,160,220,.16);
  --qr-card-shadow:rgba(0,10,30,.18);
  --qr-card-hover-shadow:rgba(0,10,30,.32);
  --qr-excerpt-text:#7a9ab8;
  --qr-btn-bg:#2a313a;
  --qr-btn-border:rgba(170,185,205,.18);
  --qr-btn-hover-bg:#313943;
  --qr-btn-hover-border:rgba(170,185,205,.30);
  --qr-fav-color:#d08090;
  --qr-conn-orange-bg:linear-gradient(180deg,#302816,#282012);
  --qr-conn-orange-border:rgba(180,120,40,.35);
  --qr-conn-orange-text:#d0a848;
  --qr-conn-orange-hover-bg:linear-gradient(180deg,#382c18,#302414);
  --qr-conn-orange-hover-border:rgba(180,120,40,.5);
  --qr-conn-purple-bg:linear-gradient(180deg,#241e38,#1c1830);
  --qr-conn-purple-border:rgba(120,100,180,.35);
  --qr-conn-purple-text:#a898d8;
  --qr-conn-purple-hover-bg:linear-gradient(180deg,#2a2240,#221c38);
  --qr-conn-purple-hover-border:rgba(120,100,180,.5);
  --qr-conn-green-bg:linear-gradient(180deg,#182c1e,#14261a);
  --qr-conn-green-border:rgba(60,150,80,.3);
  --qr-conn-green-text:#68b878;
  --qr-conn-green-hover-bg:linear-gradient(180deg,#1c3222,#182c1e);
  --qr-conn-green-hover-border:rgba(60,150,80,.45);
  --qr-conn-blue-bg:linear-gradient(180deg,#162040,#121c38);
  --qr-conn-blue-border:rgba(60,120,220,.3);
  --qr-conn-blue-text:#68a8f0;
  --qr-conn-blue-hover-bg:linear-gradient(180deg,#1a2448,#162040);
  --qr-conn-blue-hover-border:rgba(60,120,220,.45);
  --qr-conn-red-bg:linear-gradient(180deg,#2a1818,#221414);
  --qr-conn-red-border:rgba(180,60,60,.3);
  --qr-conn-red-text:#d06868;
  --qr-conn-red-hover-bg:linear-gradient(180deg,#321c1c,#2a1818);
  --qr-conn-red-hover-border:rgba(180,60,60,.45);
  --qr-conn-teal-bg:linear-gradient(180deg,#14282c,#102226);
  --qr-conn-teal-border:rgba(40,160,170,.3);
  --qr-conn-teal-text:#58c0c8;
  --qr-conn-teal-hover-bg:linear-gradient(180deg,#182c30,#14282c);
  --qr-conn-teal-hover-border:rgba(40,160,170,.45);
  --qr-compact-cat-bg:linear-gradient(180deg,#1c2a34,#1a262e);
  --qr-compact-cat-border:rgba(100,180,140,.24);
  --qr-compact-cat-text:#80c4a0;
  --qr-compact-cat-hover-bg:linear-gradient(180deg,#22303c,#1c2a34);
  --qr-compact-cat-hover-border:rgba(100,180,140,.36);
  --qr-compact-fav-bg:linear-gradient(180deg,#2a1c28,#24182e);
  --qr-compact-fav-border:rgba(180,100,160,.24);
  --qr-compact-fav-text:#d0a0c4;
  --qr-compact-inject-bg:linear-gradient(180deg,#2a2618,#242014);
  --qr-compact-inject-border:rgba(180,140,80,.24);
  --qr-compact-inject-text:#d4b480;
  --qr-compact-header-bg:rgba(24,36,46,.6);
  --qr-compact-header-text:#a8c8e0;
  --qr-compact-group-text:#7898b0;
  --qr-compact-sep:rgba(100,160,220,.12);
  --qr-token-item-bg:#1e2c3a;
  --qr-token-item-border:rgba(100,160,220,.16);
  --qr-token-item-text:#a8c8e0;
  --qr-token-then-bg:#302816;
  --qr-token-then-border:rgba(180,120,40,.34);
  --qr-token-then-text:#d0a848;
  --qr-token-simul-bg:#241e38;
  --qr-token-simul-border:rgba(120,100,180,.34);
  --qr-token-simul-text:#a898d8;
  --qr-token-raw-bg:#1e2830;
  --qr-token-raw-border:rgba(120,140,160,.28);
  --qr-token-raw-text:#90a0b0;
  --qr-row-label:#98b8d0;
}
/* === Theme: purple-mist (熏衣紫 - Purple Light) === */
#${OVERLAY_ID}[data-theme="purple-mist"],.fp-panel[data-theme="purple-mist"]{
  --qr-bg-1:linear-gradient(180deg,#f4f0fa 0%,#ebe4f4 100%);
  --qr-bg-2:linear-gradient(180deg,#faf8fc,#f0eaf6);
  --qr-bg-3:#fcfaff;
  --qr-bg-input:#f0ecf6;
  --qr-bg-hover:rgba(120,90,160,.08);
  --qr-text-1:#3a2848;
  --qr-text-2:#5a4868;
  --qr-text-on-accent:#fff;
  --qr-placeholder:rgba(58,40,72,.4);
  --qr-border-1:rgba(120,90,160,.18);
  --qr-border-2:rgba(120,90,160,.12);
  --qr-accent:#8a6ab0;
  --qr-accent-hover:#9a7ac0;
  --qr-shadow:rgba(60,40,80,.22);
  --qr-scrollbar:rgba(120,90,160,.18);
  --qr-scrollbar-hover:rgba(120,90,160,.32);
  --qr-topbar-bg:linear-gradient(180deg,#faf8fc,#f0eaf6);
  --qr-topbar-border:rgba(120,90,160,.12);
  --qr-sidebar-bg:#f6f2fa;
  --qr-sidebar-border:rgba(120,90,160,.12);
  --qr-main-bg:#f6f2fa;
  --qr-menu-bg:#fcfaff;
  --qr-menu-border:rgba(120,90,160,.16);
  --qr-menu-hover:rgba(120,90,160,.08);
  --qr-modal-bg:linear-gradient(180deg,#faf8fc,#f6f2fa);
  --qr-modal-overlay:rgba(40,20,50,.45);
  --qr-bottom-bg:#f6f2fa;
  --qr-path-bg:#f0eaf6;
  --qr-tab-bg:#f0eaf6;
  --qr-tab-border:rgba(120,90,160,.18);
  --qr-tab-active-bg:#8a6ab0;
  --qr-tab-active-text:#fff;
  --qr-tree-text:#4a3858;
  --qr-tree-active-bg:#8a6ab0;
  --qr-tree-active-text:#fff;
  --qr-card-bg:#fcfaff;
  --qr-card-border:rgba(120,90,160,.14);
  --qr-card-shadow:rgba(60,40,80,.08);
  --qr-card-hover-shadow:rgba(60,40,80,.16);
  --qr-excerpt-text:#9a8ab0;
  --qr-btn-bg:#f0eaf6;
  --qr-btn-border:rgba(120,90,160,.22);
  --qr-btn-hover-bg:#fff;
  --qr-btn-hover-border:rgba(120,90,160,.36);
  --qr-compact-cat-bg:linear-gradient(180deg,#eaf4f0,#e4f0ea);
  --qr-compact-cat-border:rgba(70,130,100,.22);
  --qr-compact-cat-text:#2a6048;
  --qr-compact-fav-bg:linear-gradient(180deg,#f8eaf0,#f4e0ea);
  --qr-compact-fav-border:rgba(160,80,120,.22);
  --qr-compact-fav-text:#a05078;
  --qr-compact-inject-bg:linear-gradient(180deg,#f8f2e8,#f4eade);
  --qr-compact-inject-border:rgba(140,110,60,.22);
  --qr-compact-inject-text:#8a6a30;
  --qr-compact-header-bg:rgba(246,242,250,.6);
  --qr-compact-header-text:#4a3858;
  --qr-compact-group-text:#7a6888;
  --qr-compact-sep:rgba(120,90,160,.12);
  --qr-row-label:#5a4868;
}
@keyframes fp-modal-fadein{from{opacity:0}to{opacity:1}}
@keyframes fp-modal-card-in{from{opacity:0;transform:scale(.96) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes fp-toast-in{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:translateY(0)}}
@keyframes fp-menu-pop{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:scale(1)}}
@keyframes fp-tab-fadein{from{opacity:0}to{opacity:1}}
@keyframes fp-qr-gen-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.16);opacity:.7}}
.fp-tab.active{animation:fp-tab-fadein .2s ease}
@media (max-width: 900px){
  .fp-top{grid-template-columns:1fr;gap:8px}
  .fp-left,.fp-right{justify-content:center}
  .fp-grid{grid-template-columns:1fr}
  .fp-settings-card{--fp-settings-min-h:360px;height:min(82vh,var(--fp-settings-max-h))}
  .fp-settings-shell{grid-template-columns:1fr}
  .fp-settings-nav{border-right:none;border-bottom:1px solid rgba(24,24,27,.12);padding-right:0;padding-bottom:8px;flex-direction:row;overflow:auto}
}
`;
    (pD.head || pD.body).appendChild(style);
  }

  const CUSTOM_CSS_ID = 'fast-plot-custom-css-v1';
  function applyCustomCSS() {
    const css = state.pack?.settings?.ui?.customCSS || '';
    let el = pD.getElementById(CUSTOM_CSS_ID) as HTMLStyleElement | null;
    if (!css) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = pD.createElement('style');
      el.id = CUSTOM_CSS_ID;
      (pD.head || pD.body).appendChild(el);
    }
    el.textContent = css;
  }

  function ensureToastContainer() {
    let c = pD.getElementById(TOAST_CONTAINER_ID);
    if (!c) {
      c = pD.createElement('div');
      c.id = TOAST_CONTAINER_ID;
      (pD.body || pD.documentElement).appendChild(c);
    }
    return c;
  }

  function toast(message: string): void {
    logInfo(`TOAST ${String(message || '操作已执行')}`);
    const c = ensureToastContainer();
    const max = Math.max(1, Number(state.pack?.settings?.toast?.maxStack || 4));
    const timeout = Math.max(600, Number(state.pack?.settings?.toast?.timeout || 1800));
    while (c.children.length >= max && c.firstElementChild) {
      c.removeChild(c.firstElementChild);
    }
    const t = pD.createElement('div');
    t.className = 'fp-toast';
    t.textContent = String(message || '操作已执行');
    c.appendChild(t);
    setTimeout(() => t.remove(), timeout);
  }

  function getCategoryById(id: string | null): Category | null {
    if (!state.pack || !id) return null;
    return state.pack.categories.find((c) => c.id === id) || null;
  }

  function getItemsByCategory(catId: string | null, includeDesc = true): Item[] {
    if (!state.pack || !catId) return [];
    if (!includeDesc) {
      return state.pack.items.filter((i) => i.categoryId === catId).sort((a, b) => a.order - b.order);
    }
    const ids = new Set<string>([catId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const cat of state.pack.categories) {
        if (cat.parentId && ids.has(cat.parentId) && !ids.has(cat.id)) {
          ids.add(cat.id);
          changed = true;
        }
      }
    }
    return state.pack.items.filter((i) => ids.has(i.categoryId || '')).sort((a, b) => a.order - b.order);
  }

  function getPath(id: string | null): Category[] {
    const res: Category[] = [];
    let cur = getCategoryById(id);
    const guard = new Set<string>();
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id);
      res.unshift(cur);
      cur = cur.parentId ? getCategoryById(cur.parentId) : null;
    }
    return res;
  }

  function detectCurrentCharacterState(): { characterId: string | null; characterName: string; isGroupChat: boolean } {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = getContext() as any;
    const groupId = String(ctx?.groupId ?? (pW as any)?.SillyTavern?.groupId ?? '').trim();
    const isGroupChat = Boolean(groupId);
    if (isGroupChat) return { characterId: null, characterName: '群聊', isGroupChat: true };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const card = (typeof getCharData === 'function' ? (getCharData('current') as any) : null) || null;
    const characterId = String(card?.avatar || card?.name || '').trim() || null;
    let characterName = String(card?.name || '').trim();
    if (!characterName) {
      try {
        if (typeof substitudeMacros === 'function') characterName = String(substitudeMacros('{{char}}') || '').trim();
      } catch (e) {}
    }
    return { characterId, characterName: characterName || '当前角色', isGroupChat: false };
  }

  function getCurrentRolePlaceholderMap(createIfMissing = false): Record<string, string> | null {
    if (!state.pack || state.activeIsGroupChat || !state.activeCharacterId) return null;
    const maps = state.pack.settings.placeholderRoleMaps.byCharacterId;
    if (!maps[state.activeCharacterId] && createIfMissing) maps[state.activeCharacterId] = {};
    return maps[state.activeCharacterId] || null;
  }

  function getEffectivePlaceholderValues(
    placeholders: Record<string, string>,
    roleValues: Record<string, string> | null,
  ): Record<string, string> {
    const merged: Record<string, string> = {};
    for (const [k, v] of Object.entries(placeholders || {})) merged[k] = String(v ?? '');
    if (!roleValues) return merged;
    for (const [k, v] of Object.entries(roleValues || {})) {
      if (v !== undefined && String(v).length > 0) merged[k] = String(v);
    }
    return merged;
  }

  function syncActiveCharacterMapping(opts?: { silent?: boolean; force?: boolean }): void {
    if (!state.pack) return;
    const prevKey = state.activeCharacterSwitchKey;
    const prevName = state.activeCharacterName;
    const detected = detectCurrentCharacterState();
    const nextKey = detected.isGroupChat ? '__group__' : (detected.characterId ? `char:${detected.characterId}` : '__default__');
    const changed = opts?.force || nextKey !== prevKey || detected.characterName !== prevName;

    state.activeCharacterId = detected.characterId;
    state.activeCharacterName = detected.characterName;
    state.activeIsGroupChat = detected.isGroupChat;
    state.activeCharacterSwitchKey = nextKey;

    if (detected.characterId) {
      const meta = state.pack.settings.placeholderRoleMaps.characterMeta[detected.characterId] || { name: '', lastSeenAt: '' };
      meta.name = detected.characterName || meta.name || detected.characterId;
      meta.lastSeenAt = nowIso();
      state.pack.settings.placeholderRoleMaps.characterMeta[detected.characterId] = meta;
      if (!state.pack.settings.placeholderRoleMaps.byCharacterId[detected.characterId]) {
        state.pack.settings.placeholderRoleMaps.byCharacterId[detected.characterId] = {};
      }
    }

    if (changed && !opts?.silent) {
      if (detected.isGroupChat) toast('已切换到群聊模式，占位符使用默认值');
      else toast(`已切换占位符映射：${detected.characterName || '当前角色'}`);
    }
  }

  function getCurrentCharacterBoundWorldbookNames(): string[] {
    if (state.activeIsGroupChat) return [];
    if (typeof getCharWorldbookNames !== 'function') return [];
    try {
      const worldbooks = getCharWorldbookNames('current');
      const names = [
        String(worldbooks?.primary || '').trim(),
        ...(Array.isArray(worldbooks?.additional) ? worldbooks.additional.map((x) => String(x || '').trim()) : []),
      ].filter(Boolean);
      return [...new Set(names)];
    } catch (e) {
      return [];
    }
  }

  function getAllWorldbookNamesSafe(): string[] {
    if (typeof getWorldbookNames !== 'function') return [];
    try {
      const names = getWorldbookNames() || [];
      return [...new Set(names.map((n) => String(n || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    } catch (e) {
      return [];
    }
  }

  function getExistingCharacterCardsSafe(): Array<{ id: string; name: string }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = new Map<string, { id: string; name: string }>();
    const addOne = (raw: any) => {
      const id = String(raw?.avatar || raw?.id || raw?.name || '').trim();
      if (!id) return;
      const name = String(raw?.name || raw?.avatar || id).trim() || id;
      if (!result.has(id)) result.set(id, { id, name });
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const addMany = (data: any) => {
      if (!data) return;
      if (Array.isArray(data)) {
        data.forEach(addOne);
        return;
      }
      if (typeof data === 'object') {
        // 兼容 { id: card } 或其他字典形态
        for (const [k, v] of Object.entries(data)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const card = (v as any) || {};
          if (!card.avatar && k) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            addOne({ ...(card as any), avatar: k });
          } else addOne(card);
        }
      }
    };

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allByApi = typeof getCharData === 'function' ? (getCharData('all') as any) : null;
      addMany(allByApi);
    } catch (e) {}

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx = getContext() as any;
      addMany(ctx?.characters);
      addMany(ctx?.characterList);
      addMany(ctx?.allCharacters);
    } catch (e) {}

    return Array.from(result.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  }

  async function getWorldbookEntryOptionsByNames(names: string[]): Promise<Array<{ value: string; label: string }>> {
    if (typeof getWorldbook !== 'function') return [];
    try {
      const uniqueNames = [...new Set((names || []).map((n) => String(n || '').trim()).filter(Boolean))];
      const options: Array<{ value: string; label: string }> = [];
      const seen = new Set<string>();
      for (const wbName of uniqueNames) {
        // eslint-disable-next-line no-await-in-loop
        const entries = await getWorldbook(wbName);
        for (const entry of entries || []) {
          const itemName = String(entry?.name || '').trim();
          if (!itemName) continue;
          const key = itemName;
          if (seen.has(key)) continue;
          seen.add(key);
          options.push({ value: itemName, label: itemName });
        }
      }
      return options.sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'));
    } catch (e) {
      return [];
    }
  }

  function resolvePlaceholdersWithMap(
    text: string,
    placeholders: Record<string, string>,
    roleValues?: Record<string, string> | null,
  ): string {
    return String(text || '').replace(/\{@([^:}]+)(?::([^}]*))?\}/g, (_, key: string, fallback: string) => {
      const roleValue = roleValues?.[key];
      if (roleValue !== undefined && String(roleValue).length > 0) return String(roleValue);
      const defaultValue = placeholders[key];
      if (defaultValue !== undefined && String(defaultValue).length > 0) return String(defaultValue);
      return fallback !== undefined ? String(fallback) : '';
    });
  }

  function splitMultiValue(raw: string): string[] {
    return String(raw || '')
      .split(/[,\n，、|｜]+/g)
      .map((x) => String(x || '').trim())
      .filter(Boolean);
  }

  function joinMultiValue(values: string[]): string {
    return [...new Set((values || []).map((x) => String(x || '').trim()).filter(Boolean))].join('、');
  }

  function resolvePlaceholders(text: string): string {
    const placeholders = state.pack?.settings?.placeholders || {};
    const roleValues = getCurrentRolePlaceholderMap(false);
    return resolvePlaceholdersWithMap(text, placeholders, roleValues);
  }

  function getRequestHeadersSafe(): Record<string, string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const st = (pW as any)?.SillyTavern;
      if (st?.getRequestHeaders) return st.getRequestHeaders();
    } catch (e) {}
    return {};
  }

  function normalizeApiBaseUrl(rawUrl: string): string {
    let url = String(rawUrl || '').trim();
    if (!url) return '';
    url = url.replace(/\/+$/, '');
    url = url.replace(/\/v\d+\/chat\/completions$/i, (m) => m.replace(/\/chat\/completions$/i, ''));
    url = url.replace(/\/chat\/completions$/i, '');
    url = url.replace(/\/completions$/i, '');
    return url.replace(/\/+$/, '');
  }

  function buildApiBaseCandidates(rawUrl: string): string[] {
    const input = String(rawUrl || '').trim().replace(/\/+$/, '');
    if (!input) return [];
    const normalized = normalizeApiBaseUrl(input);
    const out = new Set<string>();
    const add = (u: string) => {
      const v = String(u || '').trim().replace(/\/+$/, '');
      if (v) out.add(v);
    };
    add(input);
    add(normalized);
    if (normalized) {
      if (/\/v\d+$/i.test(normalized)) {
        add(normalized.replace(/\/v\d+$/i, ''));
      } else {
        add(`${normalized}/v1`);
      }
    }
    return [...out];
  }

  function sanitizeLlmReqBodyForLog(reqBody: Record<string, unknown>): Record<string, unknown> {
    const cloned = deepClone(reqBody || {});
    const hdr = String((cloned.custom_include_headers as string) || '');
    if (hdr) {
      cloned.custom_include_headers = hdr.replace(/(Authorization:\s*Bearer\s+).+/i, '$1***');
    }
    return cloned;
  }

  function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function parseLooseScalar(raw: string): unknown {
    const text = String(raw || '').trim();
    if (!text.length) return '';
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('\'') && text.endsWith('\''))) {
      return text.slice(1, -1);
    }
    if (/^(true|false)$/i.test(text)) return text.toLowerCase() === 'true';
    if (/^null$/i.test(text)) return null;
    if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
    return text;
  }

  function parseSimpleYamlObject(raw: string): Record<string, unknown> {
    const lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n');
    const root: Record<string, unknown> = {};
    const stack: Array<{ indent: number; obj: Record<string, unknown> }> = [{ indent: -1, obj: root }];

    for (const sourceLine of lines) {
      const noComment = sourceLine.replace(/\s+#.*$/, '');
      if (!noComment.trim()) continue;
      const indent = (noComment.match(/^\s*/) || [''])[0].length;
      const line = noComment.trim();
      let sep = line.indexOf(':');
      if (sep <= 0) sep = line.indexOf('：');
      if (sep <= 0) throw new Error(`无效行：${sourceLine}`);
      const key = line.slice(0, sep).trim();
      const rest = line.slice(sep + 1).trim();
      if (!key) throw new Error(`空键名：${sourceLine}`);

      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
      const parent = stack[stack.length - 1].obj;

      if (!rest) {
        const child: Record<string, unknown> = {};
        parent[key] = child;
        stack.push({ indent, obj: child });
      } else {
        parent[key] = parseLooseScalar(rest);
      }
    }

    return root;
  }

  function parseAdditionalBodyParams(raw: string): Record<string, unknown> {
    const text = String(raw || '').trim();
    if (!text) return {};
    try {
      const parsed = JSON.parse(text);
      if (!isPlainObject(parsed)) throw new Error('附加参数必须是对象');
      return parsed;
    } catch (e) {
      const parsedYaml = parseSimpleYamlObject(text);
      if (!isPlainObject(parsedYaml)) throw new Error('附加参数必须是对象');
      return parsedYaml;
    }
  }

  function mergeDeepRecord(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(patch || {})) {
      const prev = out[key];
      if (isPlainObject(prev) && isPlainObject(value)) out[key] = mergeDeepRecord(prev, value);
      else out[key] = value;
    }
    return out;
  }

  function getEffectivePlaceholderMapForLlm(): Record<string, string> {
    const placeholders = state.pack?.settings?.placeholders || {};
    const roleValues = getCurrentRolePlaceholderMap(false);
    return getEffectivePlaceholderValues(placeholders, roleValues);
  }

  function getActiveQrLlmPreset(): QrLlmPreset {
    const fallbackStore = buildDefaultQrLlmPresetStore();
    const qrLlm = state.pack?.settings?.qrLlm;
    if (!qrLlm) return fallbackStore.presets[Object.keys(fallbackStore.presets)[0]];
    const name = qrLlm.activePresetName;
    const preset = qrLlm.presetStore?.presets?.[name];
    if (preset) return preset;
    return fallbackStore.presets[Object.keys(fallbackStore.presets)[0]];
  }

  function applyLlmPresetTemplate(
    template: string,
    draft: string,
    placeholderMap: Record<string, string>,
  ): string {
    const placeholderList = Object.keys(placeholderMap || {}).map((x) => `- ${x}`).join('\n') || '- (无)';
    return String(template || '')
      .replaceAll('{{draft}}', String(draft || ''))
      .replaceAll('{{placeholder_list}}', placeholderList)
      .replaceAll('{{placeholder_map_json}}', JSON.stringify(placeholderMap || {}, null, 2));
  }

  function extractContentFromGenerateJson(data: unknown): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyData = data as any;
    if (!anyData || typeof anyData !== 'object') return '';
    if (typeof anyData.response === 'string') return anyData.response;
    const choices = Array.isArray(anyData.choices) ? anyData.choices : [];
    const first = choices[0] || {};
    const fromMessage = first?.message?.content;
    const fromText = first?.text;
    const fromDelta = first?.delta?.content;
    if (typeof fromMessage === 'string') return fromMessage;
    if (typeof fromText === 'string') return fromText;
    if (typeof fromDelta === 'string') return fromDelta;
    if (typeof anyData.content === 'string') return anyData.content;
    if (typeof anyData.text === 'string') return anyData.text;
    return '';
  }

  function buildOpenAiModelsUrl(apiBase: string): string {
    const base = normalizeApiBaseUrl(apiBase);
    if (!base) return '';
    if (/\/v\d+$/i.test(base)) return `${base}/models`;
    return `${base}/v1/models`;
  }

  function buildOpenAiChatCompletionsUrl(apiBase: string): string {
    const base = normalizeApiBaseUrl(apiBase);
    if (!base) return '';
    if (/\/v\d+$/i.test(base)) return `${base}/chat/completions`;
    return `${base}/v1/chat/completions`;
  }

  async function fetchModelsViaDirectOpenAi(apiBase: string, apiKey: string): Promise<string[]> {
    const modelsUrl = buildOpenAiModelsUrl(apiBase);
    if (!modelsUrl) return [];
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    pushDebugLog('实际API请求 直连模型列表', {
      url: modelsUrl,
      headers: { ...headers, Authorization: apiKey ? 'Bearer ***' : '' },
    });
    const res = await fetch(modelsUrl, { method: 'GET', headers });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`${res.status} ${res.statusText}${detail ? ` (${detail.slice(0, 120)})` : ''}`);
    }
    const data = await res.json();
    const modelsRaw = Array.isArray(data?.models) ? data.models : (Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []));
    const models: string[] = modelsRaw
      .map((m: unknown) => (typeof m === 'string' ? m : String((m as { id?: string })?.id || '')))
      .map((x: string) => String(x || '').trim())
      .filter((x: string): x is string => Boolean(x));
    return models;
  }

  async function fetchQrLlmModels(secret: QrLlmSecretConfig): Promise<string[]> {
    const url = String(secret.url || '').trim();
    if (!url) throw new Error('请先填写API URL');
    const candidates = buildApiBaseCandidates(url);
    const errors: string[] = [];

    for (const apiBase of candidates) {
      const body = {
        reverse_proxy: apiBase,
        proxy_password: '',
        chat_completion_source: 'custom',
        custom_url: apiBase,
        custom_include_headers: secret.apiKey ? `Authorization: Bearer ${secret.apiKey}` : '',
      };
      pushDebugLog('实际API请求 /api/backends/chat-completions/status', sanitizeLlmReqBodyForLog(body));
      try {
        const res = await fetch('/api/backends/chat-completions/status', {
          method: 'POST',
          headers: { ...getRequestHeadersSafe(), 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          errors.push(`${apiBase} -> ${res.status} ${res.statusText}${detail ? ` (${detail.slice(0, 120)})` : ''}`);
          continue;
        }
        const data = await res.json();
        const modelsRaw = Array.isArray(data?.models) ? data.models : (Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []));
        const models: string[] = modelsRaw
          .map((m: unknown) => (typeof m === 'string' ? m : String((m as { id?: string })?.id || '')))
          .map((x: string) => String(x || '').trim())
          .filter((x: string): x is string => Boolean(x));
        if (models.length) return [...new Set(models)];
        errors.push(`${apiBase} -> 模型列表为空`);
      } catch (e) {
        errors.push(`${apiBase} -> ${String(e)}`);
      }
    }

    // 某些服务在 status 过程中会先探测根路径，可能误报 403；兜底直连 OpenAI 模型列表接口
    for (const apiBase of candidates) {
      try {
        const models = await fetchModelsViaDirectOpenAi(apiBase, secret.apiKey || '');
        if (models.length) return [...new Set(models)];
        errors.push(`${apiBase} -> 直连模型列表为空`);
      } catch (e) {
        errors.push(`${apiBase} -> 直连模型列表失败: ${String(e)}`);
      }
    }

    throw new Error(`状态检查失败（已尝试: ${candidates.join(' , ')}）${errors.length ? ` | ${errors[0]}` : ''}`);
  }

  async function callQrLlmGenerate(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    opts: {
      stream: boolean;
      model: string;
      params: QrLlmSettings['generationParams'];
      secretOverride?: QrLlmSecretConfig;
      signal?: AbortSignal;
      onDelta?: (text: string) => void;
    },
  ): Promise<string> {
    const secret = opts.secretOverride || getQrLlmSecretConfig();
    const model = String(opts.model || secret.manualModelId || secret.model || '').trim();
    if (!secret.url) throw new Error('API URL 未配置');
    if (!model) throw new Error('模型ID未配置');
    let extraBodyParams: Record<string, unknown> = {};
    try {
      extraBodyParams = parseAdditionalBodyParams(secret.extraBodyParamsText || '');
    } catch (e) {
      pushDebugLog('附加参数解析失败，已忽略本次附加参数', e instanceof Error ? e.message : String(e));
      extraBodyParams = {};
    }
    const candidates = buildApiBaseCandidates(secret.url);
    const errors: string[] = [];

    for (const apiBase of candidates) {
      const reqBodyBase = {
        messages,
        model,
        temperature: Number(opts.params.temperature),
        top_p: Number(opts.params.top_p),
        max_tokens: Number(opts.params.max_tokens),
        presence_penalty: Number(opts.params.presence_penalty),
        frequency_penalty: Number(opts.params.frequency_penalty),
        stream: Boolean(opts.stream),
        chat_completion_source: 'custom',
        reverse_proxy: apiBase,
        custom_url: apiBase,
        custom_include_headers: secret.apiKey ? `Authorization: Bearer ${secret.apiKey}` : '',
      };
      const reqBody = mergeDeepRecord(reqBodyBase as unknown as Record<string, unknown>, extraBodyParams);
      pushDebugLog('实际API请求 /api/backends/chat-completions/generate', sanitizeLlmReqBodyForLog(reqBody));

      try {
        const res = await fetch('/api/backends/chat-completions/generate', {
          method: 'POST',
          headers: { ...getRequestHeadersSafe(), 'Content-Type': 'application/json' },
          body: JSON.stringify(reqBody),
          signal: opts.signal,
        });
        if (!res.ok) {
          let detail = '';
          try { detail = await res.text(); } catch (e) {}
          pushDebugLog('AI请求失败', {
            apiBase,
            status: res.status,
            statusText: res.statusText,
            detail: detail ? detail.slice(0, 500) : '',
          });
          errors.push(`${apiBase} -> ${res.status} ${res.statusText}`);
          continue;
        }

        if (!opts.stream || !res.body) {
          const data = await res.json();
          const text = extractContentFromGenerateJson(data);
          if (!text) throw new Error('响应中未找到可用文本');
          pushDebugLog('AI返回（非流式）', text);
          return text;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let out = '';
        let sawSse = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';
          for (const lineRaw of lines) {
            const line = String(lineRaw || '').trim();
            if (!line) continue;
            if (!line.startsWith('data:')) continue;
            sawSse = true;
            const dataText = line.slice(5).trim();
            if (!dataText || dataText === '[DONE]') continue;
            try {
              const parsed = JSON.parse(dataText);
              const delta =
                String(parsed?.choices?.[0]?.delta?.content ?? '') ||
                String(parsed?.choices?.[0]?.message?.content ?? '') ||
                String(parsed?.text ?? '') ||
                '';
              if (delta) {
                out += delta;
                opts.onDelta?.(out);
              }
            } catch (e) {
              // 有些后端可能混入非 JSON 心跳，忽略即可
            }
          }
        }

        if (out) {
          pushDebugLog('AI返回（流式）', out);
          return out;
        }
        const tail = `${buffer}${decoder.decode()}`.trim();
        if (!sawSse && tail) {
          try {
            const parsed = JSON.parse(tail);
            const text = extractContentFromGenerateJson(parsed);
            if (text) {
              pushDebugLog('AI返回（流式尾包）', text);
              return text;
            }
          } catch (e) {}
          pushDebugLog('AI返回（流式尾包原文）', tail);
          return tail;
        }
        throw new Error('流式响应为空');
      } catch (e) {
        if (opts.signal?.aborted) throw e;
        errors.push(`${apiBase} -> ${String(e)}`);
      }
    }

    // 某些服务在酒馆后端代理路径下会触发额外探测，兜底直连 OpenAI 兼容接口
    for (const apiBase of candidates) {
      const directUrl = buildOpenAiChatCompletionsUrl(apiBase);
      if (!directUrl) continue;
      const directBodyBase = {
        messages,
        model,
        temperature: Number(opts.params.temperature),
        top_p: Number(opts.params.top_p),
        max_tokens: Number(opts.params.max_tokens),
        presence_penalty: Number(opts.params.presence_penalty),
        frequency_penalty: Number(opts.params.frequency_penalty),
        stream: Boolean(opts.stream),
      };
      const directBody = mergeDeepRecord(directBodyBase as unknown as Record<string, unknown>, extraBodyParams);
      pushDebugLog('实际API请求 直连 /v1/chat/completions', {
        url: directUrl,
        headers: { Authorization: secret.apiKey ? 'Bearer ***' : '' },
        body: directBody,
      });
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (secret.apiKey) headers.Authorization = `Bearer ${secret.apiKey}`;
        const res = await fetch(directUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(directBody),
          signal: opts.signal,
        });
        if (!res.ok) {
          let detail = '';
          try { detail = await res.text(); } catch (e) {}
          pushDebugLog('AI直连请求失败', {
            url: directUrl,
            status: res.status,
            statusText: res.statusText,
            detail: detail ? detail.slice(0, 500) : '',
          });
          errors.push(`${directUrl} -> ${res.status} ${res.statusText}`);
          continue;
        }

        if (!opts.stream || !res.body) {
          const data = await res.json();
          const text = extractContentFromGenerateJson(data);
          if (!text) throw new Error('响应中未找到可用文本');
          pushDebugLog('AI返回（直连非流式）', text);
          return text;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let out = '';
        let sawSse = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';
          for (const lineRaw of lines) {
            const line = String(lineRaw || '').trim();
            if (!line) continue;
            if (!line.startsWith('data:')) continue;
            sawSse = true;
            const dataText = line.slice(5).trim();
            if (!dataText || dataText === '[DONE]') continue;
            try {
              const parsed = JSON.parse(dataText);
              const delta =
                String(parsed?.choices?.[0]?.delta?.content ?? '') ||
                String(parsed?.choices?.[0]?.message?.content ?? '') ||
                String(parsed?.text ?? '') ||
                '';
              if (delta) {
                out += delta;
                opts.onDelta?.(out);
              }
            } catch (e) {}
          }
        }

        if (out) {
          pushDebugLog('AI返回（直连流式）', out);
          return out;
        }
        const tail = `${buffer}${decoder.decode()}`.trim();
        if (!sawSse && tail) {
          try {
            const parsed = JSON.parse(tail);
            const text = extractContentFromGenerateJson(parsed);
            if (text) {
              pushDebugLog('AI返回（直连流式尾包）', text);
              return text;
            }
          } catch (e) {}
          pushDebugLog('AI返回（直连流式尾包原文）', tail);
          return tail;
        }
        throw new Error('流式响应为空');
      } catch (e) {
        if (opts.signal?.aborted) throw e;
        errors.push(`${directUrl} -> ${String(e)}`);
      }
    }

    throw new Error(`请求失败（已尝试: ${candidates.join(' , ')}）${errors.length ? ` - ${errors[0]}` : ''}`);
  }

  async function testQrLlmConnection(secret: QrLlmSecretConfig, modelOverride?: string): Promise<string> {
    const model = String(modelOverride || secret.manualModelId || secret.model || '').trim();
    if (!secret.url) throw new Error('请先填写API URL');
    if (!model) throw new Error('请先选择或填写模型ID');
    const text = await callQrLlmGenerate(
      [
        { role: 'system', content: '你是连通性测试助手。严格只输出小写字符串：ok。不得输出任何解释、思考、标点或多余字符。' },
        { role: 'user', content: 'ok' },
      ],
      {
        stream: false,
        model,
        secretOverride: secret,
        params: {
          temperature: 0.1,
          top_p: 1,
          max_tokens: 16,
          presence_penalty: 0,
          frequency_penalty: 0,
        },
      },
    );
    const normalized = String(text || '').trim().toLowerCase();
    if (normalized === 'ok' || normalized.startsWith('ok')) return 'ok';
    return normalized.slice(0, 20) || 'ok';
  }

  async function generateQrExpandedContent(
    draft: string,
    opts?: { onDelta?: (content: string) => void; signal?: AbortSignal },
  ): Promise<string> {
    if (!state.pack) throw new Error('数据未初始化');
    const qrLlm = state.pack.settings.qrLlm;
    const secret = getQrLlmSecretConfig();
    const modelId = String(secret.manualModelId || secret.model || '').trim();
    if (!secret.url) throw new Error('请先在设置中填写 API URL');
    if (!modelId) throw new Error('请先在设置中选择或填写模型ID');

    const placeholderMap = getEffectivePlaceholderMapForLlm();
    const preset = getActiveQrLlmPreset();
    const systemPrompt = String(preset.systemPrompt || '').trim() || '你是执行内容扩写助手。';
    const userPromptTemplate = String(preset.userPromptTemplate || '').trim() || '{{draft}}';
    const userPrompt = applyLlmPresetTemplate(userPromptTemplate, draft, placeholderMap);
    const messageList: Array<{ role: 'system' | 'user'; content: string }> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
    return callQrLlmGenerate(messageList, {
      stream: Boolean(qrLlm.enabledStream),
      model: modelId,
      params: qrLlm.generationParams,
      signal: opts?.signal,
      onDelta: opts?.onDelta,
    });
  }

  function truncateContent(content: string, maxLen = 60): string {
    const text = String(content || '').replace(/\{@[^}]*\}/g, '…').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
  }

  function iconSvg(name: string): string {
    const map: Record<string, string> = {
      back: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.8 3.2 5 8l4.8 4.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.4 8h5.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
      then: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="m8.5 4.8 3.5 3.2-3.5 3.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      simul: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 5.2h10M3 10.8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="6" cy="5.2" r="1.2" fill="currentColor"/><circle cx="10" cy="10.8" r="1.2" fill="currentColor"/></svg>',
      folder: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.8 4.8h4l1.2 1.4h7v6.8a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1V4.8Z" stroke="currentColor" stroke-width="1.5"/><path d="M1.8 6.2h12.4" stroke="currentColor" stroke-width="1.5"/></svg>',
      add: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
      upload: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 10.8V3.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="m5.2 6.2 2.8-2.8 2.8 2.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12.5h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
      download: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3.5v7.3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="m10.8 7.8-2.8 2.8-2.8-2.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12.5h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
      settings: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6.7 2 .4 1.4a4.8 4.8 0 0 1 1.8 0L9.3 2l1.6.5-.1 1.5c.5.3 1 .7 1.3 1.3l1.5-.1.5 1.6-1.4.4a4.8 4.8 0 0 1 0 1.8l1.4.4-.5 1.6-1.5-.1c-.3.5-.7 1-1.3 1.3l.1 1.5-1.6.5-.4-1.4a4.8 4.8 0 0 1-1.8 0l-.4 1.4-1.6-.5.1-1.5a4.2 4.2 0 0 1-1.3-1.3l-1.5.1-.5-1.6 1.4-.4a4.8 4.8 0 0 1 0-1.8l-1.4-.4.5-1.6 1.5.1c.3-.5.7-1 1.3-1.3l-.1-1.5L6.7 2Z" stroke="currentColor" stroke-width="1.1"/><circle cx="8" cy="8" r="1.8" stroke="currentColor" stroke-width="1.2"/></svg>',
      custom: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.6v2.2M8 11.2v2.2M2.6 8h2.2M11.2 8h2.2M3.8 3.8l1.6 1.6M10.6 10.6l1.6 1.6M12.2 3.8l-1.6 1.6M5.4 10.6l-1.6 1.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="8" cy="8" r="2.3" stroke="currentColor" stroke-width="1.3"/></svg>',
      check: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3.4 8.2 2.9 2.9 6.3-6.3" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      close: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 4 8 8M12 4 4 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
      'chevron-up': '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 10.5 8 6.5l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      'chevron-down': '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 5.5 8 9.5l4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      'expand-all': '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.8 5.3 8 9.2l4.2-3.9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.8 2.8 8 6.7l4.2-3.9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      'collapse-all': '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.8 10.7 8 6.8l4.2 3.9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.8 13.2 8 9.3l4.2 3.9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      braces: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.1 2.7c-1.6 0-2.2.8-2.2 2.2v1.1c0 .8-.3 1.2-.9 1.5.6.3.9.7.9 1.5v1.1c0 1.4.6 2.2 2.2 2.2M9.9 2.7c1.6 0 2.2.8 2.2 2.2v1.1c0 .8.3 1.2.9 1.5-.6.3-.9.7-.9 1.5v1.1c0 1.4-.6 2.2-2.2 2.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
      link: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.1 9.9 4.8 11.2a2.1 2.1 0 0 1-3-3L3.1 6.9a2.1 2.1 0 0 1 3 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="m9.9 6.1 1.3-1.3a2.1 2.1 0 0 1 3 3l-1.3 1.3a2.1 2.1 0 0 1-3 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M6.1 9.9h3.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
      wand: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m5 11 6.4-6.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="m10.6 3.3.7-.7M12.7 5.4l.7-.7M12.1 2.7h1.2M13.3 4.9h1.2M2.7 12.1h1.2M3.9 10.9h1.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
      trash: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.8 4.6h8.4M6.2 4.6V3.4h3.6v1.2M5.2 6.2v5.3M8 6.2v5.3M10.8 6.2v5.3" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/><path d="M4.8 4.6h6.4v7.2a1 1 0 0 1-1 1H5.8a1 1 0 0 1-1-1V4.6Z" stroke="currentColor" stroke-width="1.3"/></svg>',
      sparkles: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1.9 9.2 5l3.1 1.2-3.1 1.2L8 10.5 6.8 7.4 3.7 6.2 6.8 5 8 1.9Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="m12.2 9.6.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6.6-1.5ZM3.2 10.1l.4 1 .9.4-.9.4-.4 1-.4-1-.9-.4.9-.4.4-1Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>',
      undo: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.2 4.1 3.4 6.8l2.8 2.7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 6.8h4.3a3.7 3.7 0 1 1 0 7.4H5.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
      palette: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.2a5.8 5.8 0 1 0 0 11.6h1.2a1.6 1.6 0 0 0 0-3.2H8.8a1 1 0 0 1 0-2h1.7a3.5 3.5 0 0 0 0-7H8Z" stroke="currentColor" stroke-width="1.4"/><circle cx="4.8" cy="7" r=".8" fill="currentColor"/><circle cx="6.5" cy="5.2" r=".8" fill="currentColor"/><circle cx="9.1" cy="5.1" r=".8" fill="currentColor"/></svg>',
      sliders: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 4.2h6M11.5 4.2H13M3 8h2.5M7 8H13M3 11.8h7M11.5 11.8H13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="10.2" cy="4.2" r="1.1" stroke="currentColor" stroke-width="1.3"/><circle cx="5.8" cy="8" r="1.1" stroke="currentColor" stroke-width="1.3"/><circle cx="10.2" cy="11.8" r="1.1" stroke="currentColor" stroke-width="1.3"/></svg>',
      pencil: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m10.9 2.2 2.9 2.9-7.6 7.6-3.2.3.3-3.2 7.6-7.6Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="m9.8 3.3 2.9 2.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
      swap: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 5.2h8.4M9.2 3.6l2.2 1.6-2.2 1.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 10.8H4.6M6.8 9.2l-2.2 1.6 2.2 1.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      'more-v': '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="3.5" r="1.3" fill="currentColor"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="8" cy="12.5" r="1.3" fill="currentColor"/></svg>',
    };
    return map[name] || '';
  }

  function renderTopButton(opts?: { data?: string; className?: string; iconOnly?: boolean; label?: string; icon?: string; title?: string }): string {
    const o = opts || {};
    const dataKey = o.data || '';
    const cls = `fp-btn ${o.className || ''} ${o.iconOnly ? 'icon-only' : ''}`.trim();
    const label = o.iconOnly ? '' : String(o.label || '');
    return `<button class="${cls}" ${dataKey ? `data-${dataKey}` : ''} title="${o.title || o.label || ''}">${iconSvg(o.icon || '')}${label}</button>`;
  }

  function getInputBox(): HTMLTextAreaElement | null {
    return pD.querySelector('#send_textarea') as HTMLTextAreaElement | null;
  }

  function previewTokensToInputText(tokens: Array<{ text?: string; label: string }>): string {
    return tokens.map((t) => String((t && t.text !== undefined) ? t.text : (t?.label || ''))).join('');
  }

  function buildPreviewTokensFromInputText(rawInput: string): Array<{ id: string; type: string; label: string; text: string }> {
    const raw = String(rawInput || '');
    if (!raw) return [];
    const parts = raw.match(/<[^>]*>|[^<]+/g) || [raw];
    const connectors = state.pack?.settings?.connectors || [];
    return parts
      .map((part) => {
        const text = String(part || '');
        if (!text) return null;
        const conn = connectors.find((c) => c.token === text);
        if (conn) {
          return { id: uid('tok'), type: `conn-id:${conn.id}`, label: text, text };
        }
        return { id: uid('tok'), type: 'raw', label: text, text };
      })
      .filter((x): x is { id: string; type: string; label: string; text: string } => Boolean(x));
  }

  function syncInputFromPreviewTokens(): void {
    if (!state.pack) return;
    const ta = getInputBox();
    if (!ta) return;
    const tokens = state.pack.uiState.preview.tokens || [];
    const next = previewTokensToInputText(tokens);
    if (String(ta.value || '') === next) return;
    state.suspendInputSync = true;
    ta.value = next;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    state.suspendInputSync = false;
  }

  function ensurePreviewSyncWithInput(): void {
    if (!state.pack) return;
    const ta = getInputBox();
    if (!ta) return;
    const tokens = state.pack.uiState.preview.tokens || [];
    const tokensText = previewTokensToInputText(tokens);
    const inputText = String(ta.value || '');
    if (tokensText === inputText) return;
    state.pack.uiState.preview.tokens = buildPreviewTokensFromInputText(inputText);
    persistPack();
  }

  function detachInputSyncListener(): void {
    if (state.inputSyncTarget && state.inputSyncHandler) {
      state.inputSyncTarget.removeEventListener('input', state.inputSyncHandler);
    }
    state.inputSyncTarget = null;
    state.inputSyncHandler = null;
  }

  function attachInputSyncListener(): void {
    const ta = getInputBox();
    if (!ta) return;
    if (state.inputSyncTarget === ta && state.inputSyncHandler) return;
    detachInputSyncListener();
    state.inputSyncTarget = ta;
    state.inputSyncHandler = () => {
      if (state.suspendInputSync || !state.pack) return;
      const inputText = String(ta.value || '');
      const tokensText = previewTokensToInputText(state.pack.uiState.preview.tokens || []);
      if (inputText === tokensText) return;
      state.pack.uiState.preview.tokens = buildPreviewTokensFromInputText(inputText);
      persistPack();
      refreshPreviewPanel();
    };
    ta.addEventListener('input', state.inputSyncHandler);
  }

  function appendToInput(content: string): void {
    const ta = getInputBox();
    if (!ta) {
      toast('未找到输入框');
      return;
    }
    const raw = String(ta.value || '');
    const next = raw + content;
    state.suspendInputSync = true;
    ta.value = next;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    state.suspendInputSync = false;
  }

  async function injectContent(content: string, itemName: string): Promise<boolean> {
    try {
      if (typeof injectPrompts === 'function') {
        injectPrompts([
          {
            id: uid('inject'),
            position: 'in_chat',
            depth: 1,
            role: 'system',
            content,
          },
        ], { once: true });
        return true;
      }
    } catch (e) {}

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx = getContext() as any;
      if (ctx?.executeSlashCommandsWithOptions) {
        const safe = content.replace(/"/g, '\\"');
        await ctx.executeSlashCommandsWithOptions(`/inject id=${uid('inj')} "${safe}"`);
        return true;
      }
    } catch (e) {}

    toast(`注入失败: ${itemName}`);
    return false;
  }

  function pushPreviewToken(type: string, label: string, text?: string): void {
    if (!state.pack) return;
    const arr = state.pack.uiState.preview.tokens || [];
    arr.push({ id: uid('tok'), type, label: String(label || ''), text: String(text !== undefined ? text : (label || '')) });
    if (arr.length > 120) arr.splice(0, arr.length - 120);
    state.pack.uiState.preview.tokens = arr;
    persistPack();
    refreshPreviewPanel();
  }

  function refreshPreviewPanel(): void {
    const overlay = pD.getElementById(OVERLAY_ID);
    if (!overlay) return;
    const previewEls = overlay.querySelectorAll('.fp-preview');
    previewEls.forEach((el) => renderPreview(el as HTMLElement));
  }

  function clearPreviewTokens(): void {
    if (!state.pack) return;
    const tokens = state.pack.uiState.preview.tokens || [];
    if (!tokens.length) return;
    state.pack.uiState.preview.tokens = [];
    syncInputFromPreviewTokens();
    persistPack();
    refreshPreviewPanel();
    toast('预览令牌流已清空');
  }

  async function runItem(item: Item): Promise<void> {
    syncActiveCharacterMapping({ silent: true });
    const parsed = resolvePlaceholders(item.content || '');
    if (item.mode === 'inject') {
      const ok = await injectContent(parsed, item.name);
      if (ok) {
        toast(`已注入: ${item.name}`);
      }
      return;
    }

    appendToInput(`<${parsed}>`);
    pushPreviewToken('item', item.name, `<${parsed}>`);
    toast(`已追加: ${item.name}`);
  }

  function addConnector(connector: ConnectorButton, opts?: { silent?: boolean }): void {
    if (!state.pack) return;
    appendToInput(connector.token);
    pushPreviewToken(`conn-id:${connector.id}`, connector.token, connector.token);
    if (!opts?.silent) toast(`已插入“${connector.label}”`);
  }

  function getActivePrefixConnector(): ConnectorButton | null {
    if (!state.pack) return null;
    const connectors = state.pack.settings.connectors || [];
    if (!connectors.length) return null;
    const selectedId = state.pack.settings.defaults.connectorPrefixId;
    const selected = connectors.find((c) => c.id === selectedId);
    if (selected) return selected;
    state.pack.settings.defaults.connectorPrefixId = connectors[0].id;
    persistPack();
    return connectors[0];
  }

  async function runItemDirect(item: Item): Promise<void> {
    if (!state.pack) return;
    if (item.mode === 'append' && state.pack.settings.defaults.connectorPrefixMode) {
      const activeConn = getActivePrefixConnector();
      if (activeConn) addConnector(activeConn, { silent: true });
    }
    await runItem(item);
  }

  function closeContextMenu() {
    if (state.contextMenu) {
      state.contextMenu.remove();
      state.contextMenu = null;
    }
  }

  function renderPath(pathEl: HTMLElement): void {
    if (!state.pack) return;
    pathEl.innerHTML = '';
    const nodes = getPath(state.currentCategoryId);
    state.pack.uiState.lastPath = nodes.map((n) => n.id);
    
    if (!nodes.length) {
      pathEl.textContent = '未选择分类';
      return;
    }
    
    nodes.forEach((node, idx) => {
      if (idx > 0) {
        const sep = pD.createElement('span');
        sep.className = 'fp-path-sep';
        sep.textContent = ' / ';
        pathEl.appendChild(sep);
      }
      const link = pD.createElement('span');
      link.className = 'fp-path-link';
      link.textContent = node.name;
      link.title = `跳转到: ${node.name}`;
      link.onclick = () => {
        state.history.push(state.currentCategoryId);
        state.currentCategoryId = node.id;
        renderWorkbench();
      };
      pathEl.appendChild(link);
    });
  }

  function treeChildren(parentId: string | null): Category[] {
    if (!state.pack) return [];
    return state.pack.categories
      .filter((c) => c.parentId === parentId)
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }

  function moveCategory(dragId: string, targetId: string): void {
    if (!dragId || !targetId || dragId === targetId) return;
    const drag = getCategoryById(dragId);
    const target = getCategoryById(targetId);
    if (!drag || !target) return;
    let p: Category | null = target;
    while (p) {
      if (p.id === drag.id) return;
      p = p.parentId ? getCategoryById(p.parentId) : null;
    }
    drag.parentId = target.id;
    const siblings = treeChildren(target.id);
    drag.order = siblings.length;
    persistPack();
  }

  function moveItemToCategory(itemId: string, targetCatId: string): void {
    if (!state.pack) return;
    const item = state.pack.items.find((i) => i.id === itemId);
    if (!item || !getCategoryById(targetCatId)) return;
    item.categoryId = targetCatId;
    item.order = getItemsByCategory(targetCatId, false).length;
    persistPack();
  }

  let suppressClicksUntil = 0;
  function isClickSuppressed() {
    return Date.now() < suppressClicksUntil;
  }
  function suppressNextClick(ms = 220) {
    suppressClicksUntil = Date.now() + ms;
  }

  function createDragGhost(sourceEl: HTMLElement): HTMLElement {
    const rect = sourceEl.getBoundingClientRect();
    const ghost = sourceEl.cloneNode(true) as HTMLElement;
    ghost.classList.remove('dragging', 'fp-token-dragging', 'is-pointer-dragging');
    ghost.classList.add('fp-drag-ghost');
    ghost.style.width = `${Math.max(40, Math.round(rect.width))}px`;
    ghost.style.height = `${Math.max(20, Math.round(rect.height))}px`;
    (pD.body || pD.documentElement).appendChild(ghost);
    return ghost;
  }

  function canDropCategoryTo(dragId: string, targetId: string): boolean {
    if (!dragId || !targetId || dragId === targetId) return false;
    const drag = getCategoryById(dragId);
    let p = getCategoryById(targetId);
    if (!drag || !p) return false;
    while (p) {
      if (p.id === drag.id) return false;
      p = p.parentId ? getCategoryById(p.parentId) : null;
    }
    return true;
  }

  function attachPointerCategoryDropDrag(el: HTMLElement, payload: DragData): void {
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let ghost: HTMLElement | null = null;
    let dropNode: HTMLElement | null = null;
    let dropCatId: string | null = null;

    const clearDropNode = () => {
      if (dropNode) dropNode.classList.remove('drop-target');
      dropNode = null;
      dropCatId = null;
    };

    const cleanup = () => {
      if (ghost) ghost.remove();
      ghost = null;
      el.classList.remove('is-pointer-dragging');
      (pD.body || pD.documentElement).classList.remove('fp-drag-active');
      clearDropNode();
      pW.removeEventListener('pointermove', onMove as EventListener);
      pW.removeEventListener('pointerup', onUp as EventListener);
      pW.removeEventListener('pointercancel', onUp as EventListener);
    };

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) < 6) return;
      if (!dragging) {
        dragging = true;
        suppressNextClick(260);
        (pD.body || pD.documentElement).classList.add('fp-drag-active');
        el.classList.add('is-pointer-dragging');
        ghost = createDragGhost(el);
      }
      if (ghost) {
        ghost.style.left = `${Math.round(ev.clientX + 12)}px`;
        ghost.style.top = `${Math.round(ev.clientY + 12)}px`;
      }
      clearDropNode();
      const hit = pD.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const node = hit?.closest('.fp-tree-node[data-cat-id]') as HTMLElement | null;
      if (node) {
        const catId = node.dataset.catId || '';
        const valid = payload.type === 'item'
          ? Boolean(getCategoryById(catId))
          : canDropCategoryTo(payload.id, catId);
        if (valid) {
          node.classList.add('drop-target');
          dropNode = node;
          dropCatId = catId;
        }
      }
      ev.preventDefault();
    };

    const onUp = (_ev: PointerEvent) => {
      const shouldApply = dragging && dropCatId;
      const finalCatId = dropCatId;
      cleanup();
      if (!shouldApply || !finalCatId) return;
      if (payload.type === 'category') {
        moveCategory(payload.id, finalCatId);
        renderWorkbench();
      } else {
        moveItemToCategory(payload.id, finalCatId);
        renderWorkbench();
        toast('条目已移动到分类');
      }
    };

    el.addEventListener('pointerdown', (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      if (isClickSuppressed()) {
        ev.preventDefault();
        return;
      }
      startX = ev.clientX;
      startY = ev.clientY;
      dragging = false;
      ghost = null;
      dropNode = null;
      dropCatId = null;
      pW.addEventListener('pointermove', onMove as EventListener, { passive: false });
      pW.addEventListener('pointerup', onUp as EventListener, { passive: false });
      pW.addEventListener('pointercancel', onUp as EventListener, { passive: false });
    });
  }

  function renderTree(treeEl: HTMLElement, onSelect: () => void): void {
    treeEl.innerHTML = '';

    const favNode = pD.createElement('div');
    favNode.className = `fp-tree-node ${state.currentCategoryId === '__favorites__' ? 'active' : ''}`;
    favNode.innerHTML = '<span>❤</span><span>收藏夹</span>';
    favNode.onclick = () => {
      state.history.push(state.currentCategoryId);
      state.currentCategoryId = '__favorites__';
      renderWorkbench();
    };
    treeEl.appendChild(favNode);

    const roots = treeChildren(null);
    if (!state.pack) return;
    const expanded = state.pack.uiState.sidebar.expanded || {};
    const keyword = (state.filter || '').trim().toLowerCase();

    const categoryHasMatch = (catId: string): boolean => {
      if (!keyword) return true;
      const cat = getCategoryById(catId);
      if (!cat) return false;
      if (cat.name.toLowerCase().includes(keyword)) return true;
      const ownItems = getItemsByCategory(cat.id, false);
      if (ownItems.some((i) => i.name.toLowerCase().includes(keyword) || (i.content || '').toLowerCase().includes(keyword))) {
        return true;
      }
      const children = treeChildren(cat.id);
      return children.some((child) => categoryHasMatch(child.id));
    };

    const createNode = (cat: Category, depth: number): void => {
      if (!categoryHasMatch(cat.id)) return;
      const node = pD.createElement('div');
      node.className = `fp-tree-node ${state.currentCategoryId === cat.id ? 'active' : ''}`;
      node.dataset.catId = cat.id;
      const kids = treeChildren(cat.id);
      const isOpen = expanded[cat.id] !== false;
      const indent = '<span class="fp-tree-indent"></span>'.repeat(depth);
      node.innerHTML = `${indent}<span>${kids.length ? (isOpen ? '▾' : '▸') : '·'}</span><span>${cat.name}</span>`;

      node.onclick = (e) => {
        if (isClickSuppressed()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (kids.length && (e.offsetX < 28 + depth * 12)) {
          expanded[cat.id] = !isOpen;
          persistPack();
          renderWorkbench();
          return;
        }
        state.history.push(state.currentCategoryId);
        state.currentCategoryId = cat.id;
        onSelect();
      };
      attachPointerCategoryDropDrag(node, { type: 'category', id: cat.id });

      treeEl.appendChild(node);
      if (kids.length && isOpen) {
        for (const child of kids) createNode(child, depth + 1);
      }
    };

    for (const r of roots) createNode(r, 0);
  }

  function groupedItemsForMain() {
    const keyword = (state.filter || '').trim().toLowerCase();

    if (state.currentCategoryId === '__favorites__') {
      if (!state.pack) return [];
      const favs = state.pack.items.filter((i) => i.favorite);
      const filtered = keyword
        ? favs.filter((i) => i.name.toLowerCase().includes(keyword) || (i.content || '').toLowerCase().includes(keyword))
        : favs;
      return [{ groupId: '__favorites__', groupName: '❤ 收藏条目', items: filtered }];
    }

    const focus = getCategoryById(state.currentCategoryId) || (state.pack?.categories.find((c) => c.parentId === null) || null);
    if (!focus) return [];

    const directChildren = treeChildren(focus.id);
    const groups = [];

    const ownItems = getItemsByCategory(focus.id, false);
    const ownFiltered = keyword
      ? ownItems.filter((i) => i.name.toLowerCase().includes(keyword) || (i.content || '').toLowerCase().includes(keyword))
      : ownItems;

    if (ownFiltered.length) {
      groups.push({ groupId: focus.id, groupName: `${focus.name} · 当前`, items: ownFiltered });
    }

    for (const child of directChildren) {
      const items = getItemsByCategory(child.id, true);
      const filtered = keyword
        ? items.filter((i) => i.name.toLowerCase().includes(keyword) || (i.content || '').toLowerCase().includes(keyword))
        : items;
      if (filtered.length) {
        groups.push({ groupId: child.id, groupName: child.name, items: filtered });
      }
    }

    if (!groups.length) {
      const all = getItemsByCategory(focus.id, true);
      const filtered = keyword
        ? all.filter((i) => i.name.toLowerCase().includes(keyword) || (i.content || '').toLowerCase().includes(keyword))
        : all;
      groups.push({ groupId: focus.id, groupName: `${focus.name} · 全部`, items: filtered });
    }

    return groups;
  }

  function showModal(contentFactory: (close: () => void) => HTMLElement, opts?: { replace?: boolean }): void {
    const overlay = pD.getElementById(OVERLAY_ID);
    if (!overlay) return;
    const replace = opts?.replace !== false;
    let container = overlay.querySelector('.fp-modal') as HTMLElement | null;
    if (replace && container) container.remove();
    container = pD.createElement('div');
    container.className = 'fp-modal';
    container.appendChild(contentFactory(() => container!.remove()));
    overlay.appendChild(container);
  }

  function insertTextAtCursor(input: HTMLInputElement | HTMLTextAreaElement, text: string): void {
    const start = Number(input.selectionStart ?? input.value.length);
    const end = Number(input.selectionEnd ?? input.value.length);
    const value = String(input.value || '');
    input.value = value.slice(0, start) + text + value.slice(end);
    const nextPos = start + text.length;
    input.selectionStart = nextPos;
    input.selectionEnd = nextPos;
    input.focus();
  }

  function getOrderedPlaceholderEntries(): Array<{ key: string; value: string }> {
    const placeholders = state.pack?.settings?.placeholders || {};
    const roleValues = getCurrentRolePlaceholderMap(false);
    const mergedValues = getEffectivePlaceholderValues(placeholders, roleValues);
    const baseOrder = ['用户', '角色', '苦主', '黄毛'];
    const allKeys = Object.keys(placeholders);
    const ordered = [...baseOrder.filter((k) => allKeys.includes(k)), ...allKeys.filter((k) => !baseOrder.includes(k))];
    return ordered.map((key) => ({ key, value: String(mergedValues[key] || key) }));
  }

  function buildPlaceholderQuickInsertRow(title = '变量快捷'): string {
    return `
      <div class="fp-row fp-row-block">
        <label>${title}</label>
        <div class="fp-ph-field">
          <div class="fp-ph-note">点击占位符即可插入到执行内容当前光标位置</div>
          <div class="fp-ph-chip-list" data-ph-chips></div>
        </div>
      </div>
    `;
  }

  function mountPlaceholderQuickInsert(card: HTMLElement, opts: { chipsSelector: string; targetSelector: string }): void {
    syncActiveCharacterMapping({ silent: true });
    const chipsEl = card.querySelector(opts.chipsSelector) as HTMLElement | null;
    const target = card.querySelector(opts.targetSelector) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!chipsEl || !target) return;

    chipsEl.innerHTML = '';
    const entries = getOrderedPlaceholderEntries();
    for (const entry of entries) {
      const btn = pD.createElement('button');
      btn.type = 'button';
      btn.className = 'fp-ph-chip';
      btn.innerHTML = `<b>@${entry.key}</b>`;
      btn.title = `插入 {@${entry.key}:${entry.value}}`;
      btn.onclick = (e) => {
        e.preventDefault();
        insertTextAtCursor(target, `{@${entry.key}:${entry.value}}`);
      };
      chipsEl.appendChild(btn);
    }
  }

  function getCategorySearchRows(): Array<{ id: string; fullPath: string; name: string }> {
    if (!state.pack) return [];
    const rows = state.pack.categories.map((cat) => {
      const fullPath = getPath(cat.id).map((p) => p.name).join(' / ');
      return { id: cat.id, fullPath, name: cat.name };
    });
    rows.sort((a, b) => a.fullPath.localeCompare(b.fullPath, 'zh-Hans-CN'));
    return rows;
  }

  function fuzzySubsequenceScore(query: string, text: string): number {
    if (!query) return 0;
    let qi = 0;
    let gaps = 0;
    let last = -1;
    for (let i = 0; i < text.length && qi < query.length; i++) {
      if (text[i] === query[qi]) {
        if (last >= 0) gaps += (i - last - 1);
        last = i;
        qi++;
      }
    }
    if (qi !== query.length) return -1;
    return Math.max(1, 500 - gaps);
  }

  function normalizeFuzzyText(text: string): string {
    return String(text || '').toLowerCase().replace(/\s+|\/|｜|\||>|、|，|。/g, '');
  }

  function scoreCategoryRow(query: string, row: { fullPath: string; name: string }): number {
    if (!query) return 1;
    const q = normalizeFuzzyText(query);
    if (!q) return 1;
    const full = normalizeFuzzyText(row.fullPath);
    const name = normalizeFuzzyText(row.name);
    if (name.includes(q)) return 3000 - name.indexOf(q);
    if (full.includes(q)) return 2000 - full.indexOf(q);
    const nameSeq = fuzzySubsequenceScore(q, name);
    if (nameSeq > 0) return 1200 + nameSeq;
    const fullSeq = fuzzySubsequenceScore(q, full);
    if (fullSeq > 0) return 700 + fullSeq;
    return -1;
  }

  function mountCategorySearchableSelect(
    card: HTMLElement,
    opts: { pickerSelector: string; valueSelector: string; selectedId: string | null; placeholder?: string; searchPlaceholder?: string }
  ): void {
    const host = card.querySelector(opts.pickerSelector) as HTMLElement | null;
    const valueInput = card.querySelector(opts.valueSelector) as HTMLInputElement | null;
    if (!host || !valueInput) return;

    const allRows = getCategorySearchRows();
    let selectedId = opts.selectedId || allRows[0]?.id || '';
    valueInput.value = selectedId;

    host.className = 'fp-cat-picker';
    host.innerHTML = `
      <button type="button" class="fp-cat-picker-trigger">${opts.placeholder || '选择分类'}${iconSvg('chevron-down')}</button>
      <div class="fp-cat-picker-panel">
        <input class="fp-cat-picker-search" placeholder="${opts.searchPlaceholder || '搜索分类（支持模糊匹配）...'}" />
        <div class="fp-cat-picker-list"></div>
      </div>
    `;

    const trigger = host.querySelector('.fp-cat-picker-trigger') as HTMLButtonElement;
    const panel = host.querySelector('.fp-cat-picker-panel') as HTMLElement;
    const search = host.querySelector('.fp-cat-picker-search') as HTMLInputElement;
    const list = host.querySelector('.fp-cat-picker-list') as HTMLElement;

    const close = () => host.classList.remove('open');
    const open = () => {
      pD.querySelectorAll('.fp-cat-picker.open').forEach((el) => el.classList.remove('open'));
      const rect = trigger.getBoundingClientRect();
      const panelNeed = Math.min(280, (allRows.length || 1) * 32 + 56);
      const spaceBelow = (pW.innerHeight || 0) - rect.bottom;
      const spaceAbove = rect.top;
      host.classList.toggle('open-up', spaceBelow < panelNeed && spaceAbove > spaceBelow);
      host.classList.add('open');
      search.focus();
      search.select();
    };
    const syncTriggerLabel = () => {
      const selected = allRows.find((x) => x.id === selectedId);
      trigger.firstChild && (trigger.firstChild.textContent = selected?.fullPath || opts.placeholder || '选择分类');
      valueInput.value = selectedId;
    };

    const render = () => {
      const kw = search.value || '';
      const scored = allRows
        .map((row) => ({ row, score: scoreCategoryRow(kw, row) }))
        .filter((x) => x.score >= 0)
        .sort((a, b) => (b.score - a.score) || a.row.fullPath.localeCompare(b.row.fullPath, 'zh-Hans-CN'));
      list.innerHTML = '';
      if (!scored.length) {
        list.innerHTML = '<div class="fp-cat-empty">无匹配分类</div>';
        return;
      }
      for (const hit of scored) {
        const btn = pD.createElement('button');
        btn.type = 'button';
        btn.className = `fp-cat-opt ${hit.row.id === selectedId ? 'active' : ''}`;
        btn.textContent = hit.row.fullPath;
        btn.onclick = () => {
          selectedId = hit.row.id;
          syncTriggerLabel();
          close();
        };
        list.appendChild(btn);
      }
    };

    trigger.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (host.classList.contains('open')) close();
      else open();
    };
    search.oninput = render;
    search.onkeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    host.addEventListener('focusout', (e) => {
      const next = e.relatedTarget as Node | null;
      if (next && host.contains(next)) return;
      close();
    });
    panel.onclick = (e) => e.stopPropagation();

    syncTriggerLabel();
    render();
  }

  function createCircularColorPicker(opts: {
    value: string;
    options: string[];
    getColor: (value: string) => string;
    getTitle?: (value: string) => string;
    onChange: (value: string) => void;
  }): HTMLElement {
    const root = pD.createElement('div');
    root.className = 'fp-color-picker';

    const trigger = pD.createElement('button');
    trigger.type = 'button';
    trigger.className = 'fp-color-trigger';
    trigger.title = '选择颜色';

    const triggerDot = pD.createElement('span');
    triggerDot.className = 'fp-color-dot';
    trigger.appendChild(triggerDot);
    root.appendChild(trigger);

    const menu = pD.createElement('div');
    menu.className = 'fp-color-menu';
    root.appendChild(menu);

    const closeMenu = () => root.classList.remove('open');
    const openMenu = () => {
      pD.querySelectorAll('.fp-color-picker.open').forEach((el) => el.classList.remove('open'));
      root.classList.add('open');
    };
    const toggleMenu = () => {
      if (root.classList.contains('open')) closeMenu();
      else openMenu();
    };

    const updateTrigger = (val: string) => {
      triggerDot.style.background = opts.getColor(val);
      trigger.setAttribute('aria-label', opts.getTitle ? opts.getTitle(val) : val);
    };

    let currentValue = opts.options.includes(opts.value) ? opts.value : opts.options[0];
    updateTrigger(currentValue);

    const renderOptions = () => {
      menu.innerHTML = '';
      for (const val of opts.options) {
        const item = pD.createElement('button');
        item.type = 'button';
        item.className = `fp-color-opt ${val === currentValue ? 'active' : ''}`;
        item.title = opts.getTitle ? opts.getTitle(val) : val;

        const dot = pD.createElement('span');
        dot.className = 'fp-color-dot';
        dot.style.background = opts.getColor(val);
        item.appendChild(dot);

        item.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          currentValue = val;
          updateTrigger(currentValue);
          opts.onChange(currentValue);
          renderOptions();
          closeMenu();
        };
        menu.appendChild(item);
      }
    };
    renderOptions();

    trigger.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMenu();
    };

    pD.addEventListener('click', (e) => {
      if (!root.contains(e.target as Node)) closeMenu();
    });

    return root;
  }

  function openSettingsModal(): void {
    if (!state.pack) return;
    syncActiveCharacterMapping({ silent: true });
    showModal((close) => {
      const card = pD.createElement('div');
      card.className = 'fp-modal-card fp-settings-card';

      const placeholders = state.pack!.settings.placeholders || {};
      const rows = ['用户', '角色', '苦主', '黄毛'];
      const customKeys = Object.keys(placeholders).filter((k) => !rows.includes(k));
      const ui = state.pack!.settings.ui || {};
      const currentTheme = ui.theme || 'herdi-light';
      const toastSettings = state.pack!.settings.toast || { maxStack: 4, timeout: 1800 };
      const qrLlmSettings = state.pack!.settings.qrLlm || getDefaultQrLlmSettings();
      const localQrLlmSettings: QrLlmSettings = deepClone(qrLlmSettings);
      const localQrLlmSecret: QrLlmSecretConfig = deepClone(getQrLlmSecretConfig());
      const localQrLlmPresetStore: QrLlmPresetStore = normalizeQrLlmPresetStore(
        deepClone(localQrLlmSettings.presetStore || buildDefaultQrLlmPresetStore()),
      );
      const ROLE_DEFAULT_OPTION = '__DEFAULT__';
      const localRoleValues: Record<string, string> = {};
      const localCustomPhs: Array<{ originalKey: string; key: string; defaultValue: string }> =
        customKeys.map((k) => ({ originalKey: k, key: k, defaultValue: placeholders[k] || k }));
      const localAllRoleMaps: Record<string, Record<string, string>> = deepClone(state.pack!.settings.placeholderRoleMaps.byCharacterId || {});
      const localAllRoleMeta: Record<string, { name: string; lastSeenAt: string }> = deepClone(state.pack!.settings.placeholderRoleMaps.characterMeta || {});
      let worldbookOptions: Array<{ value: string; label: string }> = [];
      let allWorldbookNames: string[] = [];
      let autoSelectedWorldbookNames: string[] = [];
      let selectedWorldbookName = '';
      let selectedRoleOption = state.activeCharacterId || ROLE_DEFAULT_OPTION;
      card.innerHTML = `
        <div class="fp-modal-title">⚙️ 设置中心</div>
        <div class="fp-settings-shell">
          <div class="fp-settings-nav">
            <div class="fp-settings-nav-group">
              <div class="fp-settings-nav-title">内容配置</div>
              <button class="fp-settings-tab active" data-tab-btn="placeholders">${iconSvg('braces')}占位符</button>
              <button class="fp-settings-tab" data-tab-btn="tokens">${iconSvg('link')}连接符</button>
              <button class="fp-settings-tab" data-tab-btn="default-mode">${iconSvg('wand')}执行方式</button>
              <button class="fp-settings-tab" data-tab-btn="qr-llm-api">${iconSvg('settings')}API设置</button>
              <button class="fp-settings-tab" data-tab-btn="qr-llm-presets">${iconSvg('custom')}生成预设</button>
            </div>
            <div class="fp-settings-nav-group">
              <div class="fp-settings-nav-title">外观</div>
              <button class="fp-settings-tab" data-tab-btn="themes">${iconSvg('palette')}主题</button>
            </div>
            <div class="fp-settings-nav-group">
              <div class="fp-settings-nav-title">系统</div>
              <button class="fp-settings-tab" data-tab-btn="advanced">${iconSvg('sliders')}高级</button>
              <button class="fp-settings-tab" data-tab-btn="debug">${iconSvg('custom')}调试</button>
            </div>
          </div>
          <div class="fp-settings-body">
            <div class="fp-tab active" data-tab="placeholders">
              <div class="fp-ph-top">
                <div class="fp-row fp-ph-top-row">
                  <label>编辑目标</label>
                  <div class="fp-ph-top-main">
                    <div class="fp-ph-top-line">
                      <select data-ph-role-selector></select>
                      <span class="fp-ph-auto-spacer">自动选择</span>
                    </div>
                    <div data-ph-context class="fp-ph-meta"></div>
                  </div>
                </div>
                <div class="fp-row fp-ph-top-row">
                  <label>映射来源</label>
                  <div class="fp-ph-top-main">
                    <div class="fp-ph-top-line">
                    <div class="fp-worldbook-select-wrap">
                      <select data-worldbook-selector></select>
                      <span class="fp-worldbook-chevron">${iconSvg('chevron-down')}</span>
                    </div>
                      <button class="fp-btn" data-worldbook-auto>自动选择</button>
                    </div>
                    <div data-worldbook-status class="fp-ph-meta"></div>
                  </div>
                </div>
              </div>
              <div data-fixed-ph-list></div>
              <div style="border-top:1px solid var(--qr-border-2);margin-top:10px;padding-top:10px">
                <div style="font-size:12px;font-weight:700;color:var(--qr-row-label);margin-bottom:8px">自定义占位符</div>
                <div data-custom-ph-list></div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
                  <button class="fp-btn" data-add-ph>+ 添加占位符</button>
                  <button class="fp-btn" data-reset-ph-defaults>全部默认值</button>
                  <button class="fp-btn" data-refresh-input>刷新输入框内容</button>
                </div>
              </div>
            </div>
            <div class="fp-tab" data-tab="tokens">
              <div style="font-size:12px;color:var(--qr-text-2);margin-bottom:8px">自定义顶栏连接符按钮，点击后插入对应文本到输入框</div>
              <div data-connectors-list></div>
              <button class="fp-btn" data-add-connector style="margin-top:8px">+ 添加连接符</button>
            </div>
            <div class="fp-tab" data-tab="default-mode">
              <div style="font-size:12px;color:var(--qr-text-2);margin-bottom:8px">设置点击条目后的默认执行方式</div>
              <div class="fp-row"><label>默认执行方式</label>
                <select data-default-mode>
                  <option value="append" ${state.pack!.settings.defaults.mode === 'append' ? 'selected' : ''}>追加到输入框</option>
                  <option value="inject" ${state.pack!.settings.defaults.mode === 'inject' ? 'selected' : ''}>注入上下文</option>
                </select>
              </div>
            </div>
            <div class="fp-tab" data-tab="themes">
              <div class="fp-row"><label>主题风格</label>
                <select data-theme>
                  ${Object.keys(THEME_NAMES).map(k => `<option value="${k}" ${currentTheme === k ? 'selected' : ''}>${THEME_NAMES[k]}</option>`).join('')}
                </select>
              </div>
              <div class="fp-row" style="align-items:flex-start"><label>自定义CSS</label><textarea data-custom-css placeholder="输入自定义CSS样式...">${state.pack!.settings.ui.customCSS || ''}</textarea></div>
              <div class="fp-row" style="gap:8px;justify-content:flex-end">
                <button class="fp-btn" data-export-theme>导出主题</button>
                <button class="fp-btn" data-import-theme>导入主题</button>
              </div>
            </div>
            <div class="fp-tab" data-tab="advanced">
              <div class="fp-row"><label>Toast堆叠上限</label><input data-toast-max type="number" min="1" max="8" value="${Number(toastSettings.maxStack || 4)}" /></div>
              <div class="fp-row"><label>Toast时长(ms)</label><input data-toast-timeout type="number" min="600" max="8000" step="100" value="${Number(toastSettings.timeout || 1800)}" /></div>
            </div>
            <div class="fp-tab" data-tab="debug">
              <div style="font-size:12px;color:var(--qr-text-2);margin-bottom:8px">实时显示当前脚本日志（包含发送给AI的实际消息内容）</div>
              <div class="fp-row" style="justify-content:flex-end;gap:8px">
                <button class="fp-btn" data-debug-clear>清空日志</button>
                <button class="fp-btn" data-debug-copy>复制日志</button>
                <button class="fp-btn" data-debug-export>导出日志</button>
              </div>
              <div class="fp-debug-console" data-debug-console></div>
            </div>
            <div class="fp-tab" data-tab="qr-llm-api">
              <div style="font-size:12px;color:var(--qr-text-2);margin-bottom:8px">OpenAI兼容配置（通过酒馆后端代理调用，敏感信息不会随导出导出）</div>
              <div class="fp-row"><label>API URL</label><input data-qr-api-url value="${localQrLlmSecret.url || ''}" placeholder="如：https://api.openai.com/v1" /></div>
              <div class="fp-row"><label>API Key</label><input data-qr-api-key type="password" value="${localQrLlmSecret.apiKey || ''}" placeholder="sk-..." /></div>
              <div class="fp-row"><label>模型列表</label>
                <div style="display:flex;gap:6px;flex:1">
                  <button class="fp-btn" data-qr-load-models style="flex:0 0 auto">拉取模型列表</button>
                  <select data-qr-model-select style="flex:1;min-width:0"></select>
                </div>
              </div>
              <div class="fp-row"><label>模型ID</label><input data-qr-model-manual value="${localQrLlmSecret.manualModelId || localQrLlmSecret.model || ''}" placeholder="可手动填写模型ID" /></div>
              <div class="fp-row fp-row-block"><label>附加参数</label>
                <div style="flex:1;display:flex;flex-direction:column;gap:6px">
                  <textarea data-qr-extra-body-params style="min-height:140px" placeholder="可选，附加到请求体。支持JSON或简易YAML。例如：&#10;reasoning:&#10;  enabled: false&#10;  effort: none&#10;thinking:&#10;  type: disabled"></textarea>
                  <div style="display:flex;justify-content:flex-end;gap:8px">
                    <button class="fp-btn" data-qr-fill-disable-thinking>一键禁用思考</button>
                  </div>
                  <div style="font-size:12px;color:var(--qr-text-2)">用于传入供应商自定义参数（不参与导出）。</div>
                </div>
              </div>
              <div class="fp-row" style="justify-content:flex-end"><button class="fp-btn" data-qr-test-connect>测试连通性</button></div>
              <div data-qr-api-status style="font-size:12px;color:var(--qr-text-2);line-height:1.5">状态：待配置</div>
              <div class="fp-qr-section" style="margin-top:10px">
                <div class="fp-qr-section-title">生成参数</div>
                <div class="fp-row"><label>流式输出</label>
                  <label class="fp-toggle" style="width:auto">
                    <input type="checkbox" data-qr-stream ${localQrLlmSettings.enabledStream ? 'checked' : ''} />
                    <span class="fp-toggle-track"><span class="fp-toggle-thumb"></span></span>
                    <span class="fp-toggle-text">生成时实时写入输入框</span>
                  </label>
                </div>
                <div class="fp-qr-params-grid">
                  <div class="fp-qr-param-item"><label>temperature</label><input data-qr-temperature type="number" step="0.1" min="0" max="2" value="${Number(localQrLlmSettings.generationParams.temperature ?? 0.9)}" /></div>
                  <div class="fp-qr-param-item"><label>top_p</label><input data-qr-top-p type="number" step="0.05" min="0" max="1" value="${Number(localQrLlmSettings.generationParams.top_p ?? 1)}" /></div>
                  <div class="fp-qr-param-item"><label>max_tokens</label><input data-qr-max-tokens type="number" step="1" min="16" max="8192" value="${Number(localQrLlmSettings.generationParams.max_tokens ?? 1024)}" /></div>
                  <div class="fp-qr-param-item"><label>presence_penalty</label><input data-qr-presence type="number" step="0.1" min="-2" max="2" value="${Number(localQrLlmSettings.generationParams.presence_penalty ?? 0)}" /></div>
                  <div class="fp-qr-param-item"><label>frequency_penalty</label><input data-qr-frequency type="number" step="0.1" min="-2" max="2" value="${Number(localQrLlmSettings.generationParams.frequency_penalty ?? 0)}" /></div>
                </div>
              </div>
            </div>
            <div class="fp-tab" data-tab="qr-llm-presets">
              <div class="fp-qr-note">用于扩写执行内容草稿的 Prompt 预设（可导入/导出共享）</div>
              <div class="fp-qr-preset-workbench">
                <div class="fp-qr-section">
                  <div class="fp-qr-bar">
                    <select data-qr-preset-select class="fp-select"></select>
                    <button class="fp-btn" data-qr-preset-new>${iconSvg('add')}新建</button>
                    <button class="fp-btn" data-qr-preset-delete>删除</button>
                    <button class="fp-btn" data-qr-preset-reset-default>重置默认</button>
                  </div>
                </div>

                <div class="fp-qr-section">
                    <div class="fp-qr-card-head" style="margin-bottom:10px">
                      <div class="fp-qr-card-title">结构化段落</div>
                      <div style="display:flex;gap:6px;flex-wrap:wrap">
                        <button class="fp-btn" data-qr-seg-add>+ 新条目</button>
                        <button class="fp-btn" data-qr-seg-transfer>${iconSvg('swap')}转移条目</button>
                      </div>
                    </div>
                  <div data-qr-prompt-group-list class="fp-qr-seg-list"></div>
                </div>

                <div class="fp-qr-inline-actions">
                  <button class="fp-btn" data-qr-preset-save>保存/覆盖</button>
                  <button class="fp-btn" data-qr-preset-export>导出预设</button>
                  <button class="fp-btn" data-qr-preset-import>导入预设</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="fp-actions">
          <button data-close>取消</button>
          <button class="primary" data-save>保存</button>
        </div>
      `;

      const tabBtns = card.querySelectorAll('[data-tab-btn]');
      const tabs = card.querySelectorAll('[data-tab]');
      for (const btn of tabBtns) {
        (btn as HTMLElement).onclick = () => {
          const key = btn.getAttribute('data-tab-btn');
          for (const b of tabBtns) b.classList.toggle('active', b === btn);
          for (const t of tabs) t.classList.toggle('active', t.getAttribute('data-tab') === key);
        };
      }

      const qrApiStatusEl = card.querySelector('[data-qr-api-status]') as HTMLElement | null;
      const qrApiUrlEl = card.querySelector('[data-qr-api-url]') as HTMLInputElement | null;
      const qrApiKeyEl = card.querySelector('[data-qr-api-key]') as HTMLInputElement | null;
      const qrExtraBodyParamsEl = card.querySelector('[data-qr-extra-body-params]') as HTMLTextAreaElement | null;
      const qrFillDisableThinkingBtn = card.querySelector('[data-qr-fill-disable-thinking]') as HTMLElement | null;
      const qrModelSelectEl = card.querySelector('[data-qr-model-select]') as HTMLSelectElement | null;
      const qrModelManualEl = card.querySelector('[data-qr-model-manual]') as HTMLInputElement | null;
      const qrLoadModelsBtn = card.querySelector('[data-qr-load-models]') as HTMLElement | null;
      const qrTestConnectBtn = card.querySelector('[data-qr-test-connect]') as HTMLElement | null;
      const qrPresetSelectEl = card.querySelector('[data-qr-preset-select]') as HTMLSelectElement | null;
      const qrPresetNewBtn = card.querySelector('[data-qr-preset-new]') as HTMLElement | null;
      const qrPresetDeleteBtn = card.querySelector('[data-qr-preset-delete]') as HTMLElement | null;
      const qrPresetResetDefaultBtn = card.querySelector('[data-qr-preset-reset-default]') as HTMLElement | null;
      const qrPresetSaveBtn = card.querySelector('[data-qr-preset-save]') as HTMLElement | null;
      const qrPresetExportBtn = card.querySelector('[data-qr-preset-export]') as HTMLElement | null;
      const qrPresetImportBtn = card.querySelector('[data-qr-preset-import]') as HTMLElement | null;
      const qrPromptGroupListEl = card.querySelector('[data-qr-prompt-group-list]') as HTMLElement | null;
      const qrSegAddBtn = card.querySelector('[data-qr-seg-add]') as HTMLElement | null;
      const qrSegTransferBtn = card.querySelector('[data-qr-seg-transfer]') as HTMLElement | null;
      const debugConsoleEl = card.querySelector('[data-debug-console]') as HTMLDivElement | null;
      const debugClearBtn = card.querySelector('[data-debug-clear]') as HTMLElement | null;
      const debugCopyBtn = card.querySelector('[data-debug-copy]') as HTMLElement | null;
      const debugExportBtn = card.querySelector('[data-debug-export]') as HTMLElement | null;
      if (qrExtraBodyParamsEl) qrExtraBodyParamsEl.value = String(localQrLlmSecret.extraBodyParamsText || '');

      const updateQrApiStatus = (msg: string, level: 'ok' | 'warn' | 'error' | 'info' = 'info') => {
        if (!qrApiStatusEl) return;
        const color = level === 'ok' ? '#4caf50' : (level === 'warn' ? '#d89614' : (level === 'error' ? '#d64848' : 'var(--qr-text-2)'));
        qrApiStatusEl.textContent = `状态：${msg}`;
        qrApiStatusEl.style.color = color;
      };

      const renderQrModelSelect = () => {
        if (!qrModelSelectEl) return;
        const current = String(localQrLlmSecret.manualModelId || localQrLlmSecret.model || '').trim();
        const models = [...new Set((state.qrLlmModelList || []).map((x) => String(x || '').trim()).filter(Boolean))];
        qrModelSelectEl.innerHTML = '<option value="">手动模型ID</option>';
        models.forEach((model) => {
          const op = pD.createElement('option');
          op.value = model;
          op.textContent = model;
          qrModelSelectEl.appendChild(op);
        });
        if (current && models.includes(current)) qrModelSelectEl.value = current;
        else qrModelSelectEl.value = '';
      };

      const normalizeImportedPreset = (raw: unknown, fallbackName = ''): { name: string; preset: QrLlmPreset } | null => {
        if (!raw || typeof raw !== 'object') return null;
        const obj = raw as Record<string, unknown>;
        const name = String(obj.name || fallbackName || '').trim();
        let systemPrompt = String(obj.systemPrompt || '').trim();
        let userPromptTemplate = String(obj.userPromptTemplate || '').trim();
        let promptGroup = normalizePromptGroup(obj.promptGroup);
        let finalSystemDirective = String(obj.finalSystemDirective || obj.finalDirective || '').trim();

        const expandStVars = (
          prompts: Array<{
            identifier?: string;
            name?: string;
            enabled?: boolean;
            role?: string;
            content?: string;
            injection_position?: number;
            injection_depth?: number;
            injection_order?: number;
            system_prompt?: boolean;
            marker?: boolean;
            forbid_overrides?: boolean;
          }>,
        ) => {
          const enabledPrompts = prompts.filter((p) => p.enabled !== false);
          const varMap: Record<string, string> = {};
          const defineRegex = /\{\{(setvar|addvar)::([^:}]+)::([\s\S]*?)\}\}/gi;
          const readRegex = /\{\{(setvar|getvar)::([^:}]+)(?:::([\s\S]*?))?\}\}/gi;
          const execRegex = /\{\{(setvar|addvar|getvar)::([^:}]+)(?:::([\s\S]*?))?\}\}/gi;

          const resolveVarReads = (text: string) =>
            String(text || '')
              .replace(readRegex, (_all, op, key, body) => {
                const o = String(op || '').toLowerCase();
                const k = String(key || '').trim();
                const b = String(body || '');
                if (!k) return '';
                if (o === 'getvar') return String(varMap[k] || '');
                if (b.trim()) return b;
                return String(varMap[k] || '');
              })
              .replace(/\{\{(setvar|addvar)::([^:}]+)::([\s\S]*?)\}\}/gi, (_all, _op, _key, body) => String(body || ''));

          enabledPrompts.forEach((p) => {
            const content = String(p.content || '');
            let m: RegExpExecArray | null = null;
            while ((m = defineRegex.exec(content)) !== null) {
              const op = String(m[1] || '').toLowerCase();
              const key = String(m[2] || '').trim();
              const rawVal = String(m[3] || '');
              if (!key) continue;
              const val = resolveVarReads(rawVal);
              if (op === 'setvar') {
                if (rawVal.trim()) varMap[key] = val;
              } else if (op === 'addvar') {
                varMap[key] = String(varMap[key] || '') + val;
              }
            }
          });

          for (let i = 0; i < 8; i += 1) {
            let changed = false;
            Object.keys(varMap).forEach((key) => {
              const resolved = resolveVarReads(varMap[key]);
              if (resolved !== varMap[key]) {
                varMap[key] = resolved;
                changed = true;
              }
            });
            if (!changed) break;
          }

          const renderExpandedContent = (content: string) =>
            String(content || '')
              .replace(execRegex, (_all, op, key, body) => {
                const o = String(op || '').toLowerCase();
                const k = String(key || '').trim();
                const b = String(body || '');
                if (o === 'addvar') return '';
                if (o === 'setvar') {
                  if (b.trim()) return '';
                  return String(varMap[k] || '');
                }
                if (o === 'getvar') return String(varMap[k] || '');
                return '';
              })
              .replace(/\{\{(setvar|addvar)::([^:}]+)::([\s\S]*?)\}\}/gi, (_all, _op, _key, body) => String(body || ''))
              .trim();

          return enabledPrompts.map((p) => {
            const rawContent = String(p.content || '');
            const stripped = renderExpandedContent(rawContent);
            const roleUpper = String(p.role || '').toUpperCase();
            const role: 'SYSTEM' | 'USER' | 'ASSISTANT' =
              roleUpper === 'ASSISTANT' ? 'ASSISTANT' : (roleUpper === 'SYSTEM' ? 'SYSTEM' : 'USER');
            return {
              id: String(p.identifier || uid('qrp')),
              role,
              name: String(p.name || p.identifier || 'Prompt'),
              note: String(p.name || p.identifier || 'Prompt'),
              enabled: p.enabled !== false,
              position: Number(p.injection_position || 0) === 1 ? 'CHAT' as const : 'RELATIVE' as const,
              injectionDepth: Number(p.injection_depth ?? 4),
              injectionOrder: Number(p.injection_order ?? 100),
              marker: Boolean(p.marker),
              forbidOverrides: Boolean(p.forbid_overrides),
              content: stripped,
            };
          }).filter((x) => String(x.content || '').trim());
        };

        if (!promptGroup.length && Array.isArray(obj.prompts)) {
          promptGroup = expandStVars(obj.prompts as Array<{
            identifier?: string;
            name?: string;
            enabled?: boolean;
            role?: string;
            content?: string;
            injection_position?: number;
            injection_depth?: number;
            injection_order?: number;
            system_prompt?: boolean;
            marker?: boolean;
            forbid_overrides?: boolean;
          }>);
        }
        if (!userPromptTemplate) {
          userPromptTemplate = String(obj.finalSystemDirective || obj.userTemplate || obj.userPrompt || '').trim();
        }
        if (!finalSystemDirective) {
          finalSystemDirective = String(obj.finalSystemDirective || obj.finalDirective || '').trim();
        }
        if (!systemPrompt) systemPrompt = '你是执行内容扩写助手，负责将草稿扩写为完整可执行内容。';
        if (!userPromptTemplate) userPromptTemplate = '{{draft}}';
        if (!name) return null;
        const compiled = compileQrLlmPreset({
          systemPrompt,
          userPromptTemplate,
          promptGroup,
          finalSystemDirective,
          updatedAt: nowIso(),
        });
        return {
          name,
          preset: compiled,
        };
      };

      const listLocalPresetNames = () => Object.keys(localQrLlmPresetStore.presets || {}).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));

      let localPromptGroupDraft: Array<{
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
      }> = [];
      let draggingSegIndex: number | null = null;

      const compileDraftToFields = () => {
        compileQrLlmPreset({
          systemPrompt: '',
          userPromptTemplate: '',
          promptGroup: localPromptGroupDraft,
          finalSystemDirective: '',
          updatedAt: nowIso(),
        });
      };

      const renderPromptGroupEditor = () => {
        if (!qrPromptGroupListEl) return;
        qrPromptGroupListEl.innerHTML = '';
        const esc = (v: string) => String(v || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
        const roleText = (role: 'SYSTEM' | 'USER' | 'ASSISTANT') => role === 'SYSTEM' ? '系统段' : (role === 'USER' ? '用户段' : 'AI助手段');
        localPromptGroupDraft.forEach((seg, idx) => {
          const row = pD.createElement('div');
          row.className = 'fp-qr-seg-row';
          row.setAttribute('draggable', 'true');
          row.setAttribute('data-qr-seg-row', String(idx));
          row.innerHTML = `
            <div class="fp-qr-seg-main">
              <div class="fp-qr-seg-note">${esc(seg.name || seg.note || `${roleText(seg.role)} ${idx + 1}`)}</div>
            </div>
            <div class="fp-qr-seg-ops">
              <button class="fp-btn icon-only fp-qr-drag-handle" data-qr-seg-drag-handle="${idx}" title="拖拽排序">${iconSvg('more-v')}</button>
              <button class="fp-btn icon-only" data-qr-seg-edit="${idx}" title="编辑">${iconSvg('pencil')}</button>
              <button class="fp-btn icon-only" data-qr-seg-add-after="${idx}" title="新增">${iconSvg('add')}</button>
              <button class="fp-btn icon-only" data-qr-seg-up="${idx}" title="上移">${iconSvg('chevron-up')}</button>
              <button class="fp-btn icon-only" data-qr-seg-down="${idx}" title="下移">${iconSvg('chevron-down')}</button>
              <button class="fp-btn icon-only" data-qr-seg-del="${idx}" title="删除" style="color:#c44">${iconSvg('trash')}</button>
            </div>
          `;
          qrPromptGroupListEl.appendChild(row);
        });
        if (!localPromptGroupDraft.length) {
          qrPromptGroupListEl.innerHTML = '<div class="fp-cat-empty">暂无段落，可新增 SYSTEM/USER 段。</div>';
        }
      };

      const openPromptSegmentModal = (idx: number) => {
        if (idx < 0 || idx >= localPromptGroupDraft.length) return;
        const seg = localPromptGroupDraft[idx];
        showModal((closeSeg) => {
          const segCard = pD.createElement('div');
          segCard.className = 'fp-modal-card';
          segCard.style.width = 'min(640px,92vw)';
          const safeNote = String(seg.name || seg.note || '');
          const safeRole = seg.role;
          const safePos = String(seg.position || 'RELATIVE').toUpperCase() === 'CHAT' ? 'chat' : 'relative';
          const safeEnabled = seg.enabled !== false;
          segCard.innerHTML = `
            <div class="fp-modal-title">编辑</div>
            <div class="fp-seg-edit-grid">
              <div class="fp-row"><label>姓名</label><input data-seg-note placeholder="例如：Main Prompt / 系统段 / 用户段" /></div>
              <div class="fp-row"><label>角色</label>
                <select data-seg-role>
                  <option value="SYSTEM" ${safeRole === 'SYSTEM' ? 'selected' : ''}>系统</option>
                  <option value="USER" ${safeRole === 'USER' ? 'selected' : ''}>用户</option>
                  <option value="ASSISTANT" ${safeRole === 'ASSISTANT' ? 'selected' : ''}>AI助手</option>
                </select>
              </div>
              <div class="fp-row"><label>位置</label>
                <select data-seg-position>
                  <option value="relative" ${safePos === 'relative' ? 'selected' : ''}>相对</option>
                  <option value="chat" ${safePos === 'chat' ? 'selected' : ''}>聊天中</option>
                </select>
              </div>
              <div class="fp-row"><label>启用</label><label class="fp-toggle" style="width:auto"><input type="checkbox" data-seg-enabled ${safeEnabled ? 'checked' : ''}/><span class="fp-toggle-track"><span class="fp-toggle-thumb"></span></span><span class="fp-toggle-text">此条目参与生成</span></label></div>
            </div>
            <div class="fp-row" style="align-items:flex-start"><label>提示词</label><textarea data-seg-content placeholder="输入该段的完整提示词"></textarea></div>
            <div class="fp-actions">
              <button data-close>取消</button>
              <button class="primary" data-save>保存</button>
            </div>
          `;
          const initNoteEl = segCard.querySelector('[data-seg-note]') as HTMLInputElement | null;
          const initContentEl = segCard.querySelector('[data-seg-content]') as HTMLTextAreaElement | null;
          if (initNoteEl) initNoteEl.value = safeNote;
          if (initContentEl) {
            initContentEl.value = String(seg.content || '');
            initContentEl.style.minHeight = '300px';
            initContentEl.style.height = '300px';
          }
          (segCard.querySelector('[data-close]') as HTMLElement | null)!.onclick = closeSeg;
          (segCard.querySelector('[data-save]') as HTMLElement | null)!.onclick = () => {
            const roleEl = segCard.querySelector('[data-seg-role]') as HTMLSelectElement | null;
            const posEl = segCard.querySelector('[data-seg-position]') as HTMLSelectElement | null;
            const enabledEl = segCard.querySelector('[data-seg-enabled]') as HTMLInputElement | null;
            const noteEl = segCard.querySelector('[data-seg-note]') as HTMLInputElement | null;
            const contentEl = segCard.querySelector('[data-seg-content]') as HTMLTextAreaElement | null;
            const roleVal = String(roleEl?.value || '').toUpperCase();
            const posVal = String(posEl?.value || 'relative').toLowerCase();
            const content = String(contentEl?.value || '');
            if (!content.trim()) {
              toast('提示词内容不能为空');
              return;
            }
            localPromptGroupDraft[idx].role = (roleVal === 'USER' || roleVal === 'ASSISTANT') ? roleVal : 'SYSTEM';
            localPromptGroupDraft[idx].name = String(noteEl?.value || '').trim() || undefined;
            localPromptGroupDraft[idx].note = localPromptGroupDraft[idx].name;
            localPromptGroupDraft[idx].position = posVal === 'chat' ? 'CHAT' : 'RELATIVE';
            localPromptGroupDraft[idx].enabled = Boolean(enabledEl?.checked);
            localPromptGroupDraft[idx].content = content;
            renderPromptGroupEditor();
            compileDraftToFields();
            closeSeg();
          };
          return segCard;
        }, { replace: false });
      };

      const openPromptTransferModal = () => {
        const fromName = String(qrPresetSelectEl?.value || localQrLlmSettings.activePresetName || '').trim();
        if (!fromName) {
          toast('请先选择源预设');
          return;
        }
        if (!localPromptGroupDraft.length) {
          toast('当前预设没有可转移条目');
          return;
        }
        const presetNames = listLocalPresetNames().filter((x) => x !== fromName);
        if (!presetNames.length) {
          toast('至少需要另一个预设作为目标');
          return;
        }
        showModal((closeTransfer) => {
          const tf = pD.createElement('div');
          tf.className = 'fp-modal-card';
          tf.style.width = 'min(760px,94vw)';
          tf.style.maxHeight = '84vh';
          const esc = (v: string) => String(v || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
          tf.innerHTML = `
            <div class="fp-modal-title">转移条目</div>
            <div class="fp-row"><label>源预设</label><input value="${esc(fromName)}" readonly /></div>
            <div class="fp-row"><label>目标预设</label>
              <select data-qr-transfer-target>
                ${presetNames.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}
              </select>
            </div>
            <div class="fp-row"><label>转移方式</label>
              <select data-qr-transfer-mode>
                <option value="copy">复制（保留源条目）</option>
                <option value="move">移动（从源预设移除）</option>
              </select>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin:8px 0 6px 0">
              <div style="font-size:12px;color:var(--qr-text-2)">勾选要转移的条目</div>
              <div style="display:flex;gap:6px">
                <button class="fp-btn" data-qr-transfer-all>全选</button>
                <button class="fp-btn" data-qr-transfer-none>清空</button>
              </div>
            </div>
            <div data-qr-transfer-list style="max-height:360px;overflow:auto;border:1px solid var(--qr-border-2);border-radius:10px;padding:8px"></div>
            <div class="fp-actions">
              <button data-close>取消</button>
              <button class="primary" data-submit>执行转移</button>
            </div>
          `;
          const listEl = tf.querySelector('[data-qr-transfer-list]') as HTMLElement | null;
          if (listEl) {
            listEl.innerHTML = localPromptGroupDraft.map((seg, idx) => {
              const title = String(seg.name || seg.note || `条目${idx + 1}`);
              const brief = String(seg.content || '').replace(/\s+/g, ' ').slice(0, 72);
              return `
                <label style="display:flex;gap:8px;align-items:flex-start;padding:7px 6px;border-radius:8px">
                  <input type="checkbox" data-qr-transfer-item="${idx}" />
                  <div style="min-width:0">
                    <div style="font-size:13px;font-weight:600">${esc(title)}</div>
                    <div style="font-size:12px;color:var(--qr-text-2)">${esc(brief || '(空内容)')}</div>
                  </div>
                </label>
              `;
            }).join('');
          }
          (tf.querySelector('[data-qr-transfer-all]') as HTMLElement | null)!.onclick = () => {
            tf.querySelectorAll<HTMLInputElement>('[data-qr-transfer-item]').forEach((el) => { el.checked = true; });
          };
          (tf.querySelector('[data-qr-transfer-none]') as HTMLElement | null)!.onclick = () => {
            tf.querySelectorAll<HTMLInputElement>('[data-qr-transfer-item]').forEach((el) => { el.checked = false; });
          };
          (tf.querySelector('[data-close]') as HTMLElement | null)!.onclick = closeTransfer;
          (tf.querySelector('[data-submit]') as HTMLElement | null)!.onclick = () => {
            const targetName = String((tf.querySelector('[data-qr-transfer-target]') as HTMLSelectElement | null)?.value || '').trim();
            const mode = String((tf.querySelector('[data-qr-transfer-mode]') as HTMLSelectElement | null)?.value || 'copy').trim();
            if (!targetName) {
              toast('请选择目标预设');
              return;
            }
            if (targetName === fromName) {
              toast('目标预设不能与源预设相同');
              return;
            }
            const selectedIdx = [...tf.querySelectorAll<HTMLInputElement>('[data-qr-transfer-item]')]
              .filter((el) => el.checked)
              .map((el) => Number(el.getAttribute('data-qr-transfer-item')))
              .filter((n) => Number.isInteger(n) && n >= 0 && n < localPromptGroupDraft.length);
            if (!selectedIdx.length) {
              toast('请至少选择一个条目');
              return;
            }

            const picked = selectedIdx.map((idx) => ({ ...deepClone(localPromptGroupDraft[idx]), id: uid('qrp') }));
            const targetCompiled = compileQrLlmPreset(localQrLlmPresetStore.presets[targetName] || {
              systemPrompt: '你是执行内容扩写助手。',
              userPromptTemplate: '{{draft}}',
              updatedAt: nowIso(),
            });
            const targetGroup = normalizePromptGroup(targetCompiled.promptGroup);
            targetGroup.push(...picked);
            localQrLlmPresetStore.presets[targetName] = compileQrLlmPreset({
              systemPrompt: '',
              userPromptTemplate: '',
              promptGroup: targetGroup,
              finalSystemDirective: '',
              updatedAt: nowIso(),
            });

            if (mode === 'move') {
              const sorted = [...selectedIdx].sort((a, b) => b - a);
              sorted.forEach((idx) => {
                localPromptGroupDraft.splice(idx, 1);
              });
              renderPromptGroupEditor();
              compileDraftToFields();
            }
            toast(`已${mode === 'move' ? '移动' : '复制'} ${selectedIdx.length} 条到「${targetName}」`);
            closeTransfer();
          };
          return tf;
        }, { replace: false });
      };

      const getSegIndex = (target: EventTarget | null, key: string): number => {
        const el = target as HTMLElement | null;
        if (!el) return -1;
        const raw = el.getAttribute(key);
        if (raw === null || raw === undefined || String(raw).trim() === '') return -1;
        const idx = Number(raw);
        if (!Number.isInteger(idx) || idx < 0 || idx >= localPromptGroupDraft.length) return -1;
        return idx;
      };

      const loadSelectedPresetToForm = (name: string) => {
        const preset = localQrLlmPresetStore.presets[name];
        if (!preset) return;
        const normalizedPreset = compileQrLlmPreset(preset);
        localPromptGroupDraft = normalizePromptGroup(normalizedPreset.promptGroup);
        if (String(normalizedPreset.finalSystemDirective || '').trim() && !localPromptGroupDraft.some((x) => String(x.name || '').includes('Final'))) {
          localPromptGroupDraft.push({
            id: uid('qrp'),
            role: 'SYSTEM',
            name: 'Final指令',
            note: 'Final指令',
            position: 'RELATIVE',
            enabled: true,
            injectionDepth: 4,
            injectionOrder: 100,
            content: String(normalizedPreset.finalSystemDirective || ''),
          });
        }
        if (!localPromptGroupDraft.length) {
          const defPreset = buildDefaultQrLlmPresetStore().presets[DEFAULT_QR_LLM_PRESET_NAME];
          localPromptGroupDraft = normalizePromptGroup(defPreset.promptGroup);
          if (!localPromptGroupDraft.length) {
            localPromptGroupDraft = [
              { id: uid('qrp'), role: 'SYSTEM', name: '系统段', note: '系统段', position: 'RELATIVE', enabled: true, injectionDepth: 4, injectionOrder: 100, content: normalizedPreset.systemPrompt || '' },
              { id: uid('qrp'), role: 'USER', name: 'Main Prompt', note: 'Main Prompt', position: 'RELATIVE', enabled: true, injectionDepth: 4, injectionOrder: 100, content: normalizedPreset.userPromptTemplate || '' },
            ];
          }
        }
        renderPromptGroupEditor();
      };

      const renderQrPresetSelect = (prefer?: string) => {
        if (!qrPresetSelectEl) return;
        const names = listLocalPresetNames();
        qrPresetSelectEl.innerHTML = '';
        names.forEach((name) => {
          const op = pD.createElement('option');
          op.value = name;
          op.textContent = name;
          qrPresetSelectEl.appendChild(op);
        });
        const target = String(prefer || localQrLlmSettings.activePresetName || names[0] || DEFAULT_QR_LLM_PRESET_NAME);
        if (target && names.includes(target)) qrPresetSelectEl.value = target;
        else if (names.length) qrPresetSelectEl.value = names[0];
        localQrLlmSettings.activePresetName = String(qrPresetSelectEl.value || target);
        if (localQrLlmSettings.activePresetName) loadSelectedPresetToForm(localQrLlmSettings.activePresetName);
      };

      localQrLlmSettings.presetStore = normalizeQrLlmPresetStore(localQrLlmPresetStore);
      if (!localQrLlmSettings.activePresetName || !localQrLlmSettings.presetStore.presets[localQrLlmSettings.activePresetName]) {
        localQrLlmSettings.activePresetName = DEFAULT_QR_LLM_PRESET_NAME;
      }
      if (localQrLlmSecret.model && !localQrLlmSecret.manualModelId) localQrLlmSecret.manualModelId = localQrLlmSecret.model;
      if (localQrLlmSecret.manualModelId && !localQrLlmSecret.model) localQrLlmSecret.model = localQrLlmSecret.manualModelId;
      if (localQrLlmSecret.model && !state.qrLlmModelList.includes(localQrLlmSecret.model)) {
        state.qrLlmModelList = [...state.qrLlmModelList, localQrLlmSecret.model];
      }
      renderQrModelSelect();
      if (qrModelManualEl) qrModelManualEl.value = localQrLlmSecret.manualModelId || localQrLlmSecret.model || '';
      renderQrPresetSelect(localQrLlmSettings.activePresetName);
      updateQrApiStatus(localQrLlmSecret.url ? `已设置URL${localQrLlmSecret.model ? `，当前模型：${localQrLlmSecret.model}` : '，未选模型'}` : '待配置');
      const renderDebugConsole = () => {
        if (!debugConsoleEl) return;
        const text = state.debugLogs.length ? getDebugLogText() : '[暂无日志]';
        debugConsoleEl.textContent = text;
        debugConsoleEl.scrollTop = debugConsoleEl.scrollHeight;
      };
      renderDebugConsole();
      if (debugClearBtn) {
        debugClearBtn.onclick = () => {
          state.debugLogs = [];
          renderDebugConsole();
          toast('调试日志已清空');
        };
      }
      if (debugCopyBtn) {
        debugCopyBtn.onclick = async () => {
          const text = getDebugLogText();
          if (!text.trim()) {
            toast('暂无可复制日志');
            return;
          }
          try {
            await pW.navigator.clipboard.writeText(text);
            toast('调试日志已复制');
          } catch (e) {
            toast('复制失败，请手动选择复制');
          }
        };
      }
      if (debugExportBtn) {
        debugExportBtn.onclick = () => {
          const text = getDebugLogText();
          if (!text.trim()) {
            toast('暂无可导出日志');
            return;
          }
          const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
          const a = pD.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `快速回复管理器日志_${Date.now()}.log`;
          a.click();
          URL.revokeObjectURL(a.href);
          toast('日志已导出');
        };
      }
      const debugTimer = pW.setInterval(() => {
        if (!card.isConnected) {
          pW.clearInterval(debugTimer);
          return;
        }
        renderDebugConsole();
      }, 500);

      if (qrApiUrlEl) qrApiUrlEl.oninput = () => {
        localQrLlmSecret.url = String(qrApiUrlEl.value || '').trim();
      };
      if (qrApiKeyEl) qrApiKeyEl.oninput = () => {
        localQrLlmSecret.apiKey = String(qrApiKeyEl.value || '');
      };
      if (qrExtraBodyParamsEl) qrExtraBodyParamsEl.oninput = () => {
        localQrLlmSecret.extraBodyParamsText = String(qrExtraBodyParamsEl.value || '');
      };
      if (qrFillDisableThinkingBtn && qrExtraBodyParamsEl) {
        qrFillDisableThinkingBtn.onclick = () => {
          const presetText = `reasoning:
  enabled: false
  exclude: true
  effort: none

thinking:
  type: disabled

enable_thinking: false
disable_thinking: true
use_thinking: false
thinking_enabled: false
enable_reasoning: false
disable_reasoning: true
reasoning_enabled: false
reasoning_effort: none
seed: -1`;
          qrExtraBodyParamsEl.value = presetText;
          localQrLlmSecret.extraBodyParamsText = presetText;
          updateQrApiStatus('已填入禁思考附加参数', 'ok');
          toast('已填入「一键禁用思考」参数');
        };
      }
      if (qrModelSelectEl) qrModelSelectEl.onchange = () => {
        const val = String(qrModelSelectEl.value || '').trim();
        if (val) {
          localQrLlmSecret.model = val;
          localQrLlmSecret.manualModelId = val;
          if (qrModelManualEl) qrModelManualEl.value = val;
        }
        updateQrApiStatus(val ? `模型已选择：${val}` : '请选择或手动填写模型', val ? 'ok' : 'warn');
      };
      if (qrModelManualEl) qrModelManualEl.oninput = () => {
        const val = String(qrModelManualEl.value || '').trim();
        localQrLlmSecret.manualModelId = val;
        localQrLlmSecret.model = val;
        if (qrModelSelectEl) {
          const has = [...qrModelSelectEl.options].some((x) => x.value === val);
          qrModelSelectEl.value = has ? val : '';
        }
      };
      if (qrLoadModelsBtn) {
        qrLoadModelsBtn.onclick = async () => {
          const url = String(qrApiUrlEl?.value || localQrLlmSecret.url || '').trim();
          const apiKey = String(qrApiKeyEl?.value || localQrLlmSecret.apiKey || '');
          const extraBodyParamsText = String(qrExtraBodyParamsEl?.value || localQrLlmSecret.extraBodyParamsText || '');
          localQrLlmSecret.url = url;
          localQrLlmSecret.apiKey = apiKey;
          localQrLlmSecret.extraBodyParamsText = extraBodyParamsText;
          if (!url) {
            toast('请先填写API URL');
            updateQrApiStatus('请先填写API URL', 'warn');
            return;
          }
          updateQrApiStatus('正在拉取模型列表...');
          try {
            const models = await fetchQrLlmModels(localQrLlmSecret);
            state.qrLlmModelList = models;
            renderQrModelSelect();
            if (models.length) {
              toast(`模型列表加载成功（${models.length}个）`);
              updateQrApiStatus(`模型列表加载成功（${models.length}个）`, 'ok');
            } else {
              toast('模型列表为空');
              updateQrApiStatus('模型列表为空', 'warn');
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            toast(`模型列表加载失败: ${msg}`);
            updateQrApiStatus(`模型列表加载失败: ${msg}`, 'error');
          }
        };
      }
      if (qrTestConnectBtn) {
        qrTestConnectBtn.onclick = async () => {
          const url = String(qrApiUrlEl?.value || localQrLlmSecret.url || '').trim();
          const apiKey = String(qrApiKeyEl?.value || localQrLlmSecret.apiKey || '');
          const extraBodyParamsText = String(qrExtraBodyParamsEl?.value || localQrLlmSecret.extraBodyParamsText || '');
          const model = String(qrModelManualEl?.value || localQrLlmSecret.manualModelId || localQrLlmSecret.model || '').trim();
          localQrLlmSecret.url = url;
          localQrLlmSecret.apiKey = apiKey;
          localQrLlmSecret.extraBodyParamsText = extraBodyParamsText;
          localQrLlmSecret.manualModelId = model;
          localQrLlmSecret.model = model;
          updateQrApiStatus('正在测试连通性...');
          try {
            await testQrLlmConnection(localQrLlmSecret, model);
            toast('连通性测试成功');
            updateQrApiStatus('连通成功', 'ok');
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            toast(`连通性测试失败: ${msg}`);
            updateQrApiStatus(`连通性测试失败: ${msg}`, 'error');
          }
        };
      }

      if (qrPresetSelectEl) {
        qrPresetSelectEl.onchange = () => {
          const name = String(qrPresetSelectEl.value || '').trim();
          if (!name) return;
          localQrLlmSettings.activePresetName = name;
          loadSelectedPresetToForm(name);
        };
      }
      if (qrPromptGroupListEl) {
        qrPromptGroupListEl.ondragstart = (ev) => {
          const target = ev.target as HTMLElement | null;
          const handle = target?.closest('[data-qr-seg-drag-handle]') as HTMLElement | null;
          if (!handle) {
            ev.preventDefault();
            return;
          }
          const row = target?.closest('[data-qr-seg-row]') as HTMLElement | null;
          if (!row) return;
          const idx = Number(row.getAttribute('data-qr-seg-row'));
          if (!Number.isInteger(idx) || idx < 0 || idx >= localPromptGroupDraft.length) return;
          draggingSegIndex = idx;
          row.style.opacity = '0.55';
          if (ev.dataTransfer) {
            ev.dataTransfer.effectAllowed = 'move';
            ev.dataTransfer.setData('text/plain', String(idx));
          }
        };
        qrPromptGroupListEl.ondragover = (ev) => {
          if (draggingSegIndex === null) return;
          ev.preventDefault();
          if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
        };
        qrPromptGroupListEl.ondrop = (ev) => {
          if (draggingSegIndex === null) return;
          ev.preventDefault();
          const target = ev.target as HTMLElement | null;
          const row = target?.closest('[data-qr-seg-row]') as HTMLElement | null;
          if (!row) return;
          const rawTo = Number(row.getAttribute('data-qr-seg-row'));
          if (!Number.isInteger(rawTo) || rawTo < 0 || rawTo >= localPromptGroupDraft.length) return;
          const from = draggingSegIndex;
          let to = rawTo;
          const rect = row.getBoundingClientRect();
          if (ev.clientY > rect.top + rect.height / 2) to = rawTo + 1;
          if (from < to) to -= 1;
          if (to < 0) to = 0;
          if (to >= localPromptGroupDraft.length) to = localPromptGroupDraft.length - 1;
          if (from === to) return;
          const moved = localPromptGroupDraft.splice(from, 1)[0];
          localPromptGroupDraft.splice(to, 0, moved);
          renderPromptGroupEditor();
          compileDraftToFields();
        };
        qrPromptGroupListEl.ondragend = () => {
          draggingSegIndex = null;
          qrPromptGroupListEl.querySelectorAll<HTMLElement>('[data-qr-seg-row]').forEach((el) => {
            el.style.opacity = '';
          });
        };
        qrPromptGroupListEl.onclick = (ev) => {
          const target = ev.target as HTMLElement | null;
          const btn = target?.closest('button');
          if (!btn) return;
          const editIdx = getSegIndex(btn, 'data-qr-seg-edit');
          if (editIdx >= 0) {
            openPromptSegmentModal(editIdx);
            return;
          }
          const addIdx = getSegIndex(btn, 'data-qr-seg-add-after');
          if (addIdx >= 0) {
            const role = localPromptGroupDraft[addIdx]?.role || 'USER';
            localPromptGroupDraft.splice(addIdx + 1, 0, {
              id: uid('qrp'),
              role,
              name: role === 'SYSTEM' ? '系统段' : '新条目',
              note: role === 'SYSTEM' ? '系统段' : '新条目',
              position: 'RELATIVE',
              enabled: true,
              injectionDepth: 4,
              injectionOrder: 100,
              content: '',
            });
            renderPromptGroupEditor();
            openPromptSegmentModal(addIdx + 1);
            return;
          }
          const upIdx = getSegIndex(btn, 'data-qr-seg-up');
          if (upIdx >= 0) {
            if (upIdx > 0) {
              const tmp = localPromptGroupDraft[upIdx - 1];
              localPromptGroupDraft[upIdx - 1] = localPromptGroupDraft[upIdx];
              localPromptGroupDraft[upIdx] = tmp;
              renderPromptGroupEditor();
              compileDraftToFields();
            }
            return;
          }
          const downIdx = getSegIndex(btn, 'data-qr-seg-down');
          if (downIdx >= 0) {
            if (downIdx < localPromptGroupDraft.length - 1) {
              const tmp = localPromptGroupDraft[downIdx + 1];
              localPromptGroupDraft[downIdx + 1] = localPromptGroupDraft[downIdx];
              localPromptGroupDraft[downIdx] = tmp;
              renderPromptGroupEditor();
              compileDraftToFields();
            }
            return;
          }
          const delIdx = getSegIndex(btn, 'data-qr-seg-del');
          if (delIdx >= 0) {
            if (localPromptGroupDraft.length <= 1) {
              toast('至少保留一个段落');
              return;
            }
            localPromptGroupDraft.splice(delIdx, 1);
            renderPromptGroupEditor();
            compileDraftToFields();
          }
        };
      }
      if (qrSegAddBtn) {
        qrSegAddBtn.onclick = () => {
          localPromptGroupDraft.push({
            id: uid('qrp'),
            role: 'USER',
            name: '新条目',
            note: '新条目',
            position: 'RELATIVE',
            enabled: true,
            injectionDepth: 4,
            injectionOrder: 100,
            content: '',
          });
          renderPromptGroupEditor();
          openPromptSegmentModal(localPromptGroupDraft.length - 1);
        };
      }
      if (qrSegTransferBtn) {
        qrSegTransferBtn.onclick = () => {
          openPromptTransferModal();
        };
      }
      if (qrPresetNewBtn) {
        qrPresetNewBtn.onclick = () => {
          const draftName = prompt('输入新预设名称', '新预设');
          const name = String(draftName || '').trim();
          if (!name) return;
          if (!localQrLlmPresetStore.presets[name]) {
            const base = compileQrLlmPreset(localQrLlmPresetStore.presets[DEFAULT_QR_LLM_PRESET_NAME] || {
              systemPrompt: '你是执行内容扩写助手。',
              userPromptTemplate: '{{draft}}',
              updatedAt: nowIso(),
            });
            localQrLlmPresetStore.presets[name] = deepClone(base);
            localQrLlmPresetStore.presets[name].updatedAt = nowIso();
          }
          localQrLlmSettings.activePresetName = name;
          renderQrPresetSelect(name);
          toast(`已创建预设：${name}`);
        };
      }
      if (qrPresetDeleteBtn) {
        qrPresetDeleteBtn.onclick = () => {
          const selected = String(qrPresetSelectEl?.value || localQrLlmSettings.activePresetName || '').trim();
          if (!selected) {
            toast('未选择预设');
            return;
          }
          if (selected === DEFAULT_QR_LLM_PRESET_NAME) {
            toast('默认预设不可删除');
            return;
          }
          if (!confirm(`确认删除预设「${selected}」？`)) return;
          delete localQrLlmPresetStore.presets[selected];
          localQrLlmSettings.activePresetName = DEFAULT_QR_LLM_PRESET_NAME;
          renderQrPresetSelect(DEFAULT_QR_LLM_PRESET_NAME);
          toast('预设已删除');
        };
      }
      if (qrPresetResetDefaultBtn) {
        qrPresetResetDefaultBtn.onclick = () => {
          const selected = String(qrPresetSelectEl?.value || localQrLlmSettings.activePresetName || '').trim();
          if (selected && selected !== DEFAULT_QR_LLM_PRESET_NAME) {
            toast('请先切换到“默认预设”再重置');
            return;
          }
          if (!confirm('确认重置“默认预设”？此操作会覆盖当前默认预设内容。')) return;
          const def = buildDefaultQrLlmPresetStore().presets[DEFAULT_QR_LLM_PRESET_NAME];
          localQrLlmPresetStore.presets[DEFAULT_QR_LLM_PRESET_NAME] = deepClone(def);
          localQrLlmSettings.activePresetName = DEFAULT_QR_LLM_PRESET_NAME;
          renderQrPresetSelect(DEFAULT_QR_LLM_PRESET_NAME);
          loadSelectedPresetToForm(DEFAULT_QR_LLM_PRESET_NAME);
          toast('默认预设已重置');
        };
      }

      if (qrPresetSaveBtn) {
        qrPresetSaveBtn.onclick = () => {
          const name = String(qrPresetSelectEl?.value || localQrLlmSettings.activePresetName || '').trim();
          if (!name) {
            toast('请先选择预设');
            return;
          }
          if (!localPromptGroupDraft.length) {
            toast('至少需要一个结构化段落');
            return;
          }
          const compiled = compileQrLlmPreset({
            systemPrompt: '',
            userPromptTemplate: '',
            promptGroup: localPromptGroupDraft,
            finalSystemDirective: '',
            updatedAt: nowIso(),
          });
          localQrLlmPresetStore.presets[name] = compiled;
          localPromptGroupDraft = normalizePromptGroup(compiled.promptGroup);
          localQrLlmSettings.activePresetName = name;
          renderQrPresetSelect(name);
          toast(`预设已保存：${name}`);
        };
      }
      if (qrPresetExportBtn) {
        qrPresetExportBtn.onclick = () => {
          const selected = String(qrPresetSelectEl?.value || localQrLlmSettings.activePresetName || '').trim();
          const selectedPreset = selected ? localQrLlmPresetStore.presets[selected] : null;
          const stPrompts = selectedPreset
            ? normalizePromptGroup(selectedPreset.promptGroup).map((seg) => ({
                identifier: String(seg.id || uid('qrp')),
                name: String(seg.name || seg.note || 'Prompt'),
                enabled: seg.enabled !== false,
                injection_position: String(seg.position || 'RELATIVE') === 'CHAT' ? 1 : 0,
                injection_depth: Number(seg.injectionDepth ?? 4),
                injection_order: Number(seg.injectionOrder ?? 100),
                role: String(seg.role || 'SYSTEM').toLowerCase(),
                content: String(seg.content || ''),
                system_prompt: false,
                marker: Boolean(seg.marker),
                forbid_overrides: Boolean(seg.forbidOverrides),
              }))
            : [];
          const payload = selected
            ? {
                version: 1,
                presets: { [selected]: localQrLlmPresetStore.presets[selected] },
                sillytavern_prompt_preset: {
                  name: selected,
                  prompts: stPrompts,
                },
              }
            : localQrLlmPresetStore;
          const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
          const a = pD.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `QR生成预设_${selected || '全部'}_${Date.now()}.json`;
          a.click();
          URL.revokeObjectURL(a.href);
          toast('预设已导出');
        };
      }
      if (qrPresetImportBtn) {
        qrPresetImportBtn.onclick = () => {
          const input = pD.createElement('input');
          input.type = 'file';
          input.accept = '.json,application/json';
          input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
              const text = await file.text();
              const parsed = JSON.parse(text);
              const imported: Array<{ name: string; preset: QrLlmPreset }> = [];
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Number((parsed as Record<string, unknown>).version) === 1 && typeof (parsed as Record<string, unknown>).presets === 'object') {
                const presetsMap = ((parsed as Record<string, unknown>).presets || {}) as Record<string, unknown>;
                Object.entries(presetsMap).forEach(([name, raw]) => {
                  const hit = normalizeImportedPreset({ ...(raw as Record<string, unknown>), name }, name);
                  if (hit) imported.push(hit);
                });
              } else if (Array.isArray(parsed)) {
                parsed.forEach((raw, idx) => {
                  const hit = normalizeImportedPreset(raw, `导入预设_${idx + 1}`);
                  if (hit) imported.push(hit);
                });
              } else {
                const hit = normalizeImportedPreset(parsed, `导入预设_${Date.now()}`);
                if (hit) imported.push(hit);
              }
              if (!imported.length) {
                toast('未识别到有效预设');
                return;
              }
              imported.forEach(({ name, preset }) => {
                localQrLlmPresetStore.presets[name] = preset;
              });
              localQrLlmSettings.activePresetName = imported[0].name;
              renderQrPresetSelect(imported[0].name);
              loadSelectedPresetToForm(imported[0].name);
              toast(`已导入 ${imported.length} 个预设`);
            } catch (err) {
              toast('导入失败：JSON格式错误或结构不支持');
            }
          };
          input.click();
        };
      }

      // 连接符列表管理
      const localConnectors: ConnectorButton[] = JSON.parse(JSON.stringify(state.pack!.settings.connectors || []));
      const renderConnectorsList = () => {
        const listEl = card.querySelector('[data-connectors-list]') as HTMLElement;
        if (!listEl) return;
        listEl.innerHTML = '';
        localConnectors.forEach((conn, idx) => {
          const row = pD.createElement('div');
          row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px';
          row.innerHTML = `
            <input data-conn-label="${idx}" value="${conn.label}" placeholder="名称" style="width:80px;padding:6px 8px;border:1px solid rgba(24,24,27,.18);border-radius:8px;font-size:12px;text-align:center" />
            <input data-conn-token="${idx}" value="${conn.token}" placeholder="插入内容" style="flex:1;padding:6px 8px;border:1px solid rgba(24,24,27,.18);border-radius:8px;font-size:12px" />
            <div data-conn-color-picker="${idx}" style="display:flex;align-items:center"></div>
            <button class="fp-btn icon-only" data-del-conn="${idx}" title="删除" style="padding:4px 8px;font-size:14px;color:#c44">✕</button>
          `;
          listEl.appendChild(row);
          const colorHost = row.querySelector(`[data-conn-color-picker="${idx}"]`) as HTMLElement | null;
          if (colorHost) {
            const options = Object.keys(CONNECTOR_COLOR_HEX);
            const initColor = options.includes(conn.color) ? conn.color : 'orange';
            conn.color = initColor;
            colorHost.appendChild(createCircularColorPicker({
              value: initColor,
              options,
              getColor: (v) => CONNECTOR_COLOR_HEX[v] || CONNECTOR_COLOR_HEX.orange,
              getTitle: (v) => CONNECTOR_COLOR_NAMES[v] || v,
              onChange: (v) => { conn.color = v; },
            }));
          }
          (row.querySelector(`[data-del-conn="${idx}"]`) as HTMLElement).onclick = () => {
            localConnectors.splice(idx, 1);
            renderConnectorsList();
          };
        });
      };
      renderConnectorsList();
      (card.querySelector('[data-add-connector]') as HTMLElement).onclick = () => {
        localConnectors.push({ id: uid('conn'), label: '', token: '', color: 'orange' });
        renderConnectorsList();
      };

      const contextEl = card.querySelector('[data-ph-context]') as HTMLElement | null;
      const roleSelectorEl = card.querySelector('[data-ph-role-selector]') as HTMLSelectElement | null;
      const fixedListEl = card.querySelector('[data-fixed-ph-list]') as HTMLElement | null;
      const customListEl = card.querySelector('[data-custom-ph-list]') as HTMLElement | null;
      const worldbookStatusEl = card.querySelector('[data-worldbook-status]') as HTMLElement | null;
      const worldbookSelectorEl = card.querySelector('[data-worldbook-selector]') as HTMLSelectElement | null;
      const worldbookSelectorWrapEl = card.querySelector('.fp-worldbook-select-wrap') as HTMLElement | null;
      const worldbookAutoBtn = card.querySelector('[data-worldbook-auto]') as HTMLElement | null;
      const localFixedDefaults: Record<string, string> = {};
      for (const k of rows) localFixedDefaults[k] = String(placeholders[k] || k);

      const getRoleSelectorOptions = (): Array<{ id: string; name: string }> => {
        const existing = getExistingCharacterCardsSafe();
        return existing.map((card) => ({
          id: card.id,
          name: String(localAllRoleMeta[card.id]?.name || card.name || card.id),
        }));
      };

      const renderRoleSelector = () => {
        if (!roleSelectorEl) return;
        const options = getRoleSelectorOptions();
        const validIds = new Set<string>(options.map((x) => x.id));
        if (selectedRoleOption !== ROLE_DEFAULT_OPTION && selectedRoleOption && !validIds.has(selectedRoleOption)) {
          selectedRoleOption = ROLE_DEFAULT_OPTION;
          loadRoleValuesBySelection();
        }
        roleSelectorEl.innerHTML = [
          `<option value="${ROLE_DEFAULT_OPTION}" ${selectedRoleOption === ROLE_DEFAULT_OPTION ? 'selected' : ''}>默认</option>`,
          ...options.map(({ id, name }) => {
            return `<option value="${id}" ${selectedRoleOption === id ? 'selected' : ''}>${name}（${id}）</option>`;
          }),
        ].join('');
      };

      const loadRoleValuesBySelection = () => {
        for (const k of Object.keys(localRoleValues)) delete localRoleValues[k];
        if (selectedRoleOption === ROLE_DEFAULT_OPTION) return;
        const src = localAllRoleMaps[selectedRoleOption] || {};
        for (const [k, v] of Object.entries(src)) localRoleValues[k] = String(v || '');
      };

      const saveRoleValuesBySelection = () => {
        if (selectedRoleOption === ROLE_DEFAULT_OPTION) return;
        const next: Record<string, string> = {};
        for (const [k, v] of Object.entries(localRoleValues)) {
          const key = String(k || '').trim();
          const val = String(v || '').trim();
          if (!key || !val) continue;
          next[key] = val;
        }
        if (Object.keys(next).length) localAllRoleMaps[selectedRoleOption] = next;
        else delete localAllRoleMaps[selectedRoleOption];
      };

      const refreshContextLabel = () => {
        if (!contextEl) return;
        if (selectedRoleOption === ROLE_DEFAULT_OPTION) {
          contextEl.textContent = '编辑目标：默认占位符值';
          return;
        }
        const displayName = String(localAllRoleMeta[selectedRoleOption]?.name || (selectedRoleOption === state.activeCharacterId ? state.activeCharacterName : '') || selectedRoleOption);
        contextEl.textContent = `编辑目标：${displayName}（${selectedRoleOption}）`;
      };

      if (selectedRoleOption !== ROLE_DEFAULT_OPTION) {
        if (!localAllRoleMeta[selectedRoleOption]) {
          localAllRoleMeta[selectedRoleOption] = {
            name: selectedRoleOption === state.activeCharacterId ? (state.activeCharacterName || selectedRoleOption) : selectedRoleOption,
            lastSeenAt: nowIso(),
          };
        }
      }
      loadRoleValuesBySelection();
      renderRoleSelector();
      refreshContextLabel();

      const getValidSelectedValues = (selectedValue: string): string[] => {
        const selectedValues = splitMultiValue(selectedValue);
        const validValues = new Set<string>(worldbookOptions.map((x) => x.value));
        return selectedValues.filter((v) => validValues.has(v));
      };

      const mountValueMultiPicker = (host: HTMLElement, defaultValue: string, selectedValue: string, onChange: (value: string) => void) => {
        const picker = pD.createElement('div');
        picker.className = 'fp-multi-picker';
        const trigger = pD.createElement('button');
        trigger.type = 'button';
        trigger.className = 'fp-multi-trigger';
        trigger.innerHTML = `<span class="fp-multi-text"></span>${iconSvg('chevron-down')}`;
        const panel = pD.createElement('div');
        panel.className = 'fp-multi-panel';
        const list = pD.createElement('div');
        list.className = 'fp-multi-panel-list';
        panel.appendChild(list);
        picker.appendChild(trigger);
        picker.appendChild(panel);
        host.appendChild(picker);

        let selected = getValidSelectedValues(selectedValue);
        if (!selected.length || (selected.length === 1 && selected[0] === defaultValue)) selected = [];
        const summarize = () => {
          if (!selected.length) return `默认值（${defaultValue || '空'}）`;
          if (selected.length === 1) return selected[0];
          if (selected.length === 2) return `${selected[0]}、${selected[1]}`;
          return `${selected[0]} 等${selected.length}项`;
        };
        const setTriggerText = () => {
          const text = summarize();
          const textEl = trigger.querySelector('.fp-multi-text') as HTMLElement | null;
          if (textEl) textEl.textContent = text;
          trigger.title = text;
        };
        const emit = () => onChange(selected.length ? joinMultiValue(selected) : '');
        const renderOptions = () => {
          list.innerHTML = '';
          const defaultBtn = pD.createElement('button');
          defaultBtn.type = 'button';
          defaultBtn.className = `fp-multi-opt ${selected.length ? '' : 'active'}`;
          defaultBtn.innerHTML = `<input type="checkbox" ${selected.length ? '' : 'checked'} /><span>默认值（${defaultValue || '空'}）</span>`;
          defaultBtn.onclick = () => {
            selected = [];
            setTriggerText();
            emit();
            renderOptions();
          };
          list.appendChild(defaultBtn);
          worldbookOptions.forEach((opt) => {
            const active = selected.includes(opt.value);
            const btn = pD.createElement('button');
            btn.type = 'button';
            btn.className = `fp-multi-opt ${active ? 'active' : ''}`;
            btn.innerHTML = `<input type="checkbox" ${active ? 'checked' : ''} /><span>${opt.label}</span>`;
            btn.onclick = () => {
              if (selected.includes(opt.value)) selected = selected.filter((v) => v !== opt.value);
              else selected.push(opt.value);
              selected = [...new Set(selected)];
              setTriggerText();
              emit();
              renderOptions();
            };
            list.appendChild(btn);
          });
        };
        setTriggerText();
        emit();
        renderOptions();
        trigger.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          picker.classList.toggle('open');
        };
        picker.addEventListener('focusout', (e) => {
          const next = e.relatedTarget as Node | null;
          if (next && picker.contains(next)) return;
          picker.classList.remove('open');
        });
      };

      const renderWorldbookSourceSelector = () => {
        if (!worldbookSelectorEl) return;
        worldbookSelectorEl.innerHTML = [`<option value="" ${!selectedWorldbookName ? 'selected' : ''}>无</option>`, ...allWorldbookNames
          .map((name) => `<option value="${name}" ${selectedWorldbookName === name ? 'selected' : ''}>${name}</option>`)
        ].join('');
      };

      const renderFixedPhList = () => {
        if (!fixedListEl) return;
        fixedListEl.innerHTML = '';
        rows.forEach((k) => {
          const row = pD.createElement('div');
          row.className = 'fp-row';
          row.style.alignItems = 'center';
          const currentValue = String(localRoleValues[k] || '');
          const defaultValue = String(localFixedDefaults[k] || k);
          row.innerHTML = `
            <label>${k}</label>
            <div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;align-items:center;flex:1">
              <div data-ph-picker="${k}"></div>
              <input type="hidden" data-ph-picked="${k}" />
              <button type="button" class="fp-btn icon-only" data-ph-edit-default="${k}" title="编辑默认值">${iconSvg('pencil')}</button>
            </div>
          `;
          fixedListEl.appendChild(row);
          const pickerHost = row.querySelector(`[data-ph-picker="${k}"]`) as HTMLElement | null;
          const hidden = row.querySelector(`[data-ph-picked="${k}"]`) as HTMLInputElement | null;
          if (pickerHost && hidden) {
            mountValueMultiPicker(pickerHost, defaultValue, currentValue, (val) => {
              hidden.value = val;
              localRoleValues[k] = val;
            });
          }
          const editBtn = row.querySelector(`[data-ph-edit-default="${k}"]`) as HTMLElement | null;
          if (editBtn) {
            editBtn.onclick = () => {
              const current = String(localFixedDefaults[k] || k);
              const next = prompt(`设置“${k}”默认值`, current);
              if (next === null) return;
              localFixedDefaults[k] = String(next).trim() || k;
              renderFixedPhList();
            };
          }
        });
      };

      const renderCustomPhList = () => {
        if (!customListEl) return;
        customListEl.innerHTML = '';
        localCustomPhs.forEach((ph, idx) => {
          const row = pD.createElement('div');
          row.className = 'fp-row';
          row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px';
          const currentValue = String(localRoleValues[ph.key] || '');
          const defaultValue = String(ph.defaultValue || ph.key || '');
          row.innerHTML = `
            <input data-cph-key="${idx}" value="${ph.key}" placeholder="键名" style="width:100px;padding:6px 8px;border:1px solid rgba(24,24,27,.18);border-radius:8px;font-size:12px" />
            <div data-cph-picker="${idx}" style="flex:1"></div>
            <input type="hidden" data-cph-picked="${idx}" />
            <button type="button" class="fp-btn icon-only" data-cph-edit-default="${idx}" title="编辑默认值">${iconSvg('pencil')}</button>
            <button class="fp-btn icon-only" data-del-cph="${idx}" title="删除" style="padding:4px 8px;font-size:14px;color:#c44">✕</button>
          `;
          customListEl.appendChild(row);
          const pickerHost = row.querySelector(`[data-cph-picker="${idx}"]`) as HTMLElement | null;
          const hidden = row.querySelector(`[data-cph-picked="${idx}"]`) as HTMLInputElement | null;
          if (pickerHost && hidden) {
            mountValueMultiPicker(pickerHost, defaultValue, currentValue, (val) => {
              hidden.value = val;
              const key = String((row.querySelector(`[data-cph-key="${idx}"]`) as HTMLInputElement | null)?.value || ph.key || '').trim();
              if (key) localRoleValues[key] = val;
            });
          }
          const keyInput = row.querySelector(`[data-cph-key="${idx}"]`) as HTMLInputElement | null;
          const editBtn = row.querySelector(`[data-cph-edit-default="${idx}"]`) as HTMLElement | null;
          if (editBtn) {
            editBtn.onclick = () => {
              const key = String(keyInput?.value || ph.key || '').trim();
              const current = String(ph.defaultValue || key);
              const next = prompt(`设置“${key || '自定义占位符'}”默认值`, current);
              if (next === null) return;
              ph.defaultValue = String(next).trim() || key;
              renderCustomPhList();
            };
          }
          (row.querySelector(`[data-del-cph="${idx}"]`) as HTMLElement).onclick = () => {
            localCustomPhs.splice(idx, 1);
            renderCustomPhList();
          };
        });
      };

      renderFixedPhList();
      renderCustomPhList();
      (card.querySelector('[data-add-ph]') as HTMLElement).onclick = () => {
        localCustomPhs.push({ originalKey: '', key: '', defaultValue: '' });
        renderCustomPhList();
      };
      if (roleSelectorEl) {
        roleSelectorEl.onchange = () => {
          saveRoleValuesBySelection();
          selectedRoleOption = String(roleSelectorEl.value || ROLE_DEFAULT_OPTION);
          if (selectedRoleOption !== ROLE_DEFAULT_OPTION && !localAllRoleMeta[selectedRoleOption]) {
            localAllRoleMeta[selectedRoleOption] = {
              name: selectedRoleOption === state.activeCharacterId ? (state.activeCharacterName || selectedRoleOption) : selectedRoleOption,
              lastSeenAt: nowIso(),
            };
          }
          loadRoleValuesBySelection();
          renderRoleSelector();
          refreshContextLabel();
          renderFixedPhList();
          renderCustomPhList();
        };
      }
      (card.querySelector('[data-reset-ph-defaults]') as HTMLElement | null)!.onclick = () => {
        if (selectedRoleOption === ROLE_DEFAULT_OPTION) {
          toast('当前正在编辑默认值，无需重置');
          return;
        }
        for (const k of Object.keys(localRoleValues)) delete localRoleValues[k];
        selectedWorldbookName = '';
        worldbookOptions = [];
        renderWorldbookSourceSelector();
        if (worldbookStatusEl) worldbookStatusEl.textContent = '已重置为默认值，映射来源：无';
        renderFixedPhList();
        renderCustomPhList();
        toast('已重置为全部默认值');
      };

      const loadWorldbookOptions = async () => {
        if (!worldbookStatusEl) return;
        worldbookStatusEl.textContent = '正在读取世界书列表...';
        allWorldbookNames = getAllWorldbookNamesSafe();
        autoSelectedWorldbookNames = getCurrentCharacterBoundWorldbookNames();
        selectedWorldbookName = autoSelectedWorldbookNames[0] || '';
        if (!selectedWorldbookName) {
          for (const k of Object.keys(localRoleValues)) delete localRoleValues[k];
        }
        renderWorldbookSourceSelector();
        worldbookStatusEl.textContent = '正在读取所选世界书条目...';
        worldbookOptions = await getWorldbookEntryOptionsByNames(selectedWorldbookName ? [selectedWorldbookName] : []);
        if (!worldbookOptions.length) {
          worldbookStatusEl.textContent = '未读取到可用世界书条目（可手动切换映射来源）';
        } else {
          worldbookStatusEl.textContent = `已加载 ${worldbookOptions.length} 个条目`;
        }
        renderFixedPhList();
        renderCustomPhList();
      };
      loadWorldbookOptions();

      if (worldbookSelectorEl) {
        worldbookSelectorEl.onmousedown = () => {
          worldbookSelectorWrapEl?.classList.add('is-open');
        };
        worldbookSelectorEl.onkeydown = (e) => {
          const code = (e as KeyboardEvent).key;
          if (code === 'Enter' || code === ' ' || code === 'ArrowDown' || code === 'ArrowUp') {
            worldbookSelectorWrapEl?.classList.add('is-open');
          }
        };
        worldbookSelectorEl.onblur = () => {
          worldbookSelectorWrapEl?.classList.remove('is-open');
        };
        worldbookSelectorEl.onchange = async () => {
          worldbookSelectorWrapEl?.classList.remove('is-open');
          selectedWorldbookName = String(worldbookSelectorEl.value || '').trim();
          if (!selectedWorldbookName) {
            for (const k of Object.keys(localRoleValues)) delete localRoleValues[k];
          }
          if (worldbookStatusEl) worldbookStatusEl.textContent = '正在读取所选世界书条目...';
          worldbookOptions = await getWorldbookEntryOptionsByNames(selectedWorldbookName ? [selectedWorldbookName] : []);
          if (worldbookStatusEl) {
            worldbookStatusEl.textContent = worldbookOptions.length
              ? `已加载 ${worldbookOptions.length} 个条目`
              : '当前选择下没有可用条目';
          }
          renderFixedPhList();
          renderCustomPhList();
        };
      }
      if (worldbookAutoBtn) {
        worldbookAutoBtn.onclick = async () => {
          autoSelectedWorldbookNames = getCurrentCharacterBoundWorldbookNames();
          selectedWorldbookName = autoSelectedWorldbookNames[0] || '';
          if (!selectedWorldbookName) {
            for (const k of Object.keys(localRoleValues)) delete localRoleValues[k];
          }
          renderWorldbookSourceSelector();
          if (autoSelectedWorldbookNames[0]) {
            toast(`已自动选择角色绑定世界书：${selectedWorldbookName}`);
          } else {
            toast('当前角色未绑定世界书，已回退到：无');
          }
          if (worldbookStatusEl) worldbookStatusEl.textContent = '已按当前角色自动选择世界书，正在刷新条目...';
          worldbookOptions = await getWorldbookEntryOptionsByNames(selectedWorldbookName ? [selectedWorldbookName] : []);
          if (worldbookStatusEl) {
            worldbookStatusEl.textContent = worldbookOptions.length
              ? `已加载 ${worldbookOptions.length} 个条目`
              : '自动选择的世界书暂无可用条目';
          }
          renderFixedPhList();
          renderCustomPhList();
        };
      }
      let roleWatchBusy = false;
      let lastRoleWatchKey = state.activeCharacterSwitchKey;
      const roleWatchTimer = setInterval(async () => {
        if (!pD.body.contains(card)) {
          clearInterval(roleWatchTimer);
          return;
        }
        if (roleWatchBusy) return;
        roleWatchBusy = true;
        try {
          syncActiveCharacterMapping({ silent: true });
          const nextKey = state.activeCharacterSwitchKey;
          if (nextKey !== lastRoleWatchKey) {
            lastRoleWatchKey = nextKey;
            renderRoleSelector();
            allWorldbookNames = getAllWorldbookNamesSafe();
            autoSelectedWorldbookNames = getCurrentCharacterBoundWorldbookNames();
            selectedWorldbookName = autoSelectedWorldbookNames[0] || '';
            if (!selectedWorldbookName) {
              for (const k of Object.keys(localRoleValues)) delete localRoleValues[k];
            }
            renderWorldbookSourceSelector();
            if (worldbookStatusEl) worldbookStatusEl.textContent = '已检测到角色切换，正在刷新世界书条目...';
            worldbookOptions = await getWorldbookEntryOptionsByNames(selectedWorldbookName ? [selectedWorldbookName] : []);
            if (worldbookStatusEl) {
              worldbookStatusEl.textContent = worldbookOptions.length
                ? `已加载 ${worldbookOptions.length} 个条目`
                : '未读取到可用世界书条目（可手动切换映射来源）';
            }
            renderFixedPhList();
            renderCustomPhList();
            toast('已检测角色切换，世界书来源已刷新');
          }
        } finally {
          roleWatchBusy = false;
        }
      }, 900);

      const collectDraftPlaceholders = (): { draft: Record<string, string>; duplicatedKey: string | null } => {
        const draft: Record<string, string> = {};
        const usedKeys = new Set<string>();
        let duplicatedKey: string | null = null;
        for (const k of rows) {
          draft[k] = String(localFixedDefaults[k] || k).trim() || k;
          usedKeys.add(k);
        }
        localCustomPhs.forEach((ph, idx) => {
          const key = (card.querySelector(`[data-cph-key="${idx}"]`) as HTMLInputElement | null)?.value.trim();
          const val = String(ph.defaultValue || '').trim();
          if (key && !rows.includes(key)) {
            if (usedKeys.has(key)) {
              duplicatedKey = duplicatedKey || key;
              return;
            }
            usedKeys.add(key);
            draft[key] = val || key;
            ph.key = key;
            ph.defaultValue = val || key;
          } else {
            ph.key = key || '';
            ph.defaultValue = val || '';
          }
        });
        return { draft, duplicatedKey };
      };

      const collectDraftRoleValues = (): Record<string, string> => {
        const draft: Record<string, string> = {};
        for (const k of rows) {
          const defaultVal = String(localFixedDefaults[k] || k).trim();
          const pickedVal = String((card.querySelector(`[data-ph-picked="${k}"]`) as HTMLInputElement | null)?.value || '').trim();
          if (pickedVal && pickedVal !== defaultVal) draft[k] = pickedVal;
        }
        localCustomPhs.forEach((ph, idx) => {
          const key = (card.querySelector(`[data-cph-key="${idx}"]`) as HTMLInputElement | null)?.value.trim();
          const pickedVal = String((card.querySelector(`[data-cph-picked="${idx}"]`) as HTMLInputElement | null)?.value || '').trim();
          const defaultVal = String(ph.defaultValue || key || '').trim();
          if (key && !rows.includes(key) && pickedVal) {
            if (pickedVal && pickedVal !== defaultVal) draft[key] = pickedVal;
          }
          ph.key = key || '';
        });
        return draft;
      };

      (card.querySelector('[data-refresh-input]') as HTMLElement | null)!.onclick = () => {
        const ta = getInputBox();
        if (!ta) {
          toast('未找到输入框');
          return;
        }
        const raw = String(ta.value || '');
        if (!raw) {
          toast('输入框为空，无需刷新');
          return;
        }
        const { draft, duplicatedKey } = collectDraftPlaceholders();
        if (duplicatedKey) {
          toast(`存在重复占位符键：${duplicatedKey}`);
          return;
        }
        const draftRole = collectDraftRoleValues();
        const next = resolvePlaceholdersWithMap(raw, draft, draftRole);
        if (next === raw) {
          toast('未检测到可刷新的占位符');
          return;
        }
        ta.value = next;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        toast('输入框内容已按最新占位符刷新');
      };

      const themeSelect = card.querySelector('[data-theme]') as HTMLSelectElement | null;
      if (themeSelect) {
        themeSelect.onchange = () => {
          const panel = pD.querySelector('.fp-panel') as HTMLElement | null;
          const overlay = pD.getElementById(OVERLAY_ID) as HTMLElement | null;
          if (panel) panel.setAttribute('data-theme', themeSelect.value);
          if (overlay) overlay.setAttribute('data-theme', themeSelect.value);
          if (state.pack) {
            state.pack.settings.ui = state.pack.settings.ui || { theme: 'herdi-light', customCSS: '' };
            state.pack.settings.ui.theme = themeSelect.value || 'herdi-light';
            persistPack();
          }
        };
      }

      const exportThemeBtn = card.querySelector('[data-export-theme]') as HTMLElement | null;
      if (exportThemeBtn) {
        exportThemeBtn.onclick = () => {
          const themeData = {
            theme: (card.querySelector('[data-theme]') as HTMLSelectElement)?.value || 'herdi-light',
            customCSS: (card.querySelector('[data-custom-css]') as HTMLTextAreaElement)?.value || '',
          };
          const blob = new Blob([JSON.stringify(themeData, null, 2)], { type: 'application/json' });
          const a = pD.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `快速回复管理器_主题_${Date.now()}.json`;
          a.click();
          URL.revokeObjectURL(a.href);
          toast('主题已导出');
        };
      }
      const importThemeBtn = card.querySelector('[data-import-theme]') as HTMLElement | null;
      if (importThemeBtn) {
        importThemeBtn.onclick = () => {
          const input = pD.createElement('input');
          input.type = 'file';
          input.accept = '.json';
          input.onchange = () => {
            const file = input.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              try {
                const data = JSON.parse(reader.result as string);
                if (data.theme) {
                  (card.querySelector('[data-theme]') as HTMLSelectElement).value = data.theme;
                }
                if (data.customCSS !== undefined) {
                  (card.querySelector('[data-custom-css]') as HTMLTextAreaElement).value = data.customCSS;
                }
                const panel = pD.querySelector('.fp-panel') as HTMLElement | null;
                const overlay = pD.getElementById(OVERLAY_ID) as HTMLElement | null;
                if (panel && data.theme) panel.setAttribute('data-theme', data.theme);
                if (overlay && data.theme) overlay.setAttribute('data-theme', data.theme);
                toast('主题已导入，点击保存应用');
              } catch (e) {
                toast('导入失败：文件格式错误');
              }
            };
            reader.readAsText(file);
          };
          input.click();
        };
      }

      (card.querySelector('[data-close]') as HTMLElement | null)!.onclick = () => {
        close();
      };
      (card.querySelector('[data-save]') as HTMLElement | null)!.onclick = () => {
        // 收集连接符数据
        const updatedConnectors: ConnectorButton[] = [];
        localConnectors.forEach((conn, idx) => {
          const label = (card.querySelector(`[data-conn-label="${idx}"]`) as HTMLInputElement)?.value.trim();
          const token = (card.querySelector(`[data-conn-token="${idx}"]`) as HTMLInputElement)?.value.trim();
          const color = CONNECTOR_COLOR_HEX[conn.color] ? conn.color : 'orange';
          if (label && token) {
            updatedConnectors.push({ id: conn.id, label, token, color });
          }
        });
        state.pack!.settings.connectors = updatedConnectors;
        if (!updatedConnectors.length) {
          state.pack!.settings.defaults.connectorPrefixId = null;
        } else if (!updatedConnectors.find((c) => c.id === state.pack!.settings.defaults.connectorPrefixId)) {
          state.pack!.settings.defaults.connectorPrefixId = updatedConnectors[0].id;
        }
        // 同步到 tokens（向后兼容）
        const thenConn = updatedConnectors.find(c => c.label === '然后');
        const simulConn = updatedConnectors.find(c => c.label === '同时');
        state.pack!.settings.tokens.then = thenConn?.token || '<然后>';
        state.pack!.settings.tokens.simultaneous = simulConn?.token || '<同时>';
        state.pack!.settings.defaults.mode = (card.querySelector('[data-default-mode]') as HTMLSelectElement | null)?.value === 'inject' ? 'inject' : 'append';
        state.pack!.settings.ui = state.pack!.settings.ui || {};
        state.pack!.settings.ui.theme = (card.querySelector('[data-theme]') as HTMLSelectElement | null)?.value || 'herdi-light';
        state.pack!.settings.ui.customCSS = (card.querySelector('[data-custom-css]') as HTMLTextAreaElement | null)?.value || '';
        const toastMax = Number((card.querySelector('[data-toast-max]') as HTMLInputElement | null)?.value || 4);
        const toastTimeout = Number((card.querySelector('[data-toast-timeout]') as HTMLInputElement | null)?.value || 1800);
        state.pack!.settings.toast.maxStack = Math.max(1, Math.min(8, toastMax || 4));
        state.pack!.settings.toast.timeout = Math.max(600, Math.min(8000, toastTimeout || 1800));

        localQrLlmSettings.enabledStream = !!(card.querySelector('[data-qr-stream]') as HTMLInputElement | null)?.checked;
        localQrLlmSettings.generationParams.temperature = Number((card.querySelector('[data-qr-temperature]') as HTMLInputElement | null)?.value || 0.9);
        localQrLlmSettings.generationParams.top_p = Number((card.querySelector('[data-qr-top-p]') as HTMLInputElement | null)?.value || 1);
        localQrLlmSettings.generationParams.max_tokens = Number((card.querySelector('[data-qr-max-tokens]') as HTMLInputElement | null)?.value || 1024);
        localQrLlmSettings.generationParams.presence_penalty = Number((card.querySelector('[data-qr-presence]') as HTMLInputElement | null)?.value || 0);
        localQrLlmSettings.generationParams.frequency_penalty = Number((card.querySelector('[data-qr-frequency]') as HTMLInputElement | null)?.value || 0);
        localQrLlmSettings.generationParams.temperature = Math.max(0, Math.min(2, Number.isFinite(localQrLlmSettings.generationParams.temperature) ? localQrLlmSettings.generationParams.temperature : 0.9));
        localQrLlmSettings.generationParams.top_p = Math.max(0, Math.min(1, Number.isFinite(localQrLlmSettings.generationParams.top_p) ? localQrLlmSettings.generationParams.top_p : 1));
        localQrLlmSettings.generationParams.max_tokens = Math.max(16, Math.min(8192, Number.isFinite(localQrLlmSettings.generationParams.max_tokens) ? Math.round(localQrLlmSettings.generationParams.max_tokens) : 1024));
        localQrLlmSettings.generationParams.presence_penalty = Math.max(-2, Math.min(2, Number.isFinite(localQrLlmSettings.generationParams.presence_penalty) ? localQrLlmSettings.generationParams.presence_penalty : 0));
        localQrLlmSettings.generationParams.frequency_penalty = Math.max(-2, Math.min(2, Number.isFinite(localQrLlmSettings.generationParams.frequency_penalty) ? localQrLlmSettings.generationParams.frequency_penalty : 0));
        localQrLlmSettings.presetStore = normalizeQrLlmPresetStore(localQrLlmPresetStore);
        localQrLlmSettings.activePresetName = String((card.querySelector('[data-qr-preset-select]') as HTMLSelectElement | null)?.value || localQrLlmSettings.activePresetName || '').trim();
        if (!localQrLlmSettings.activePresetName || !localQrLlmSettings.presetStore.presets[localQrLlmSettings.activePresetName]) {
          localQrLlmSettings.activePresetName = DEFAULT_QR_LLM_PRESET_NAME;
        }
        state.pack!.settings.qrLlm = deepClone(localQrLlmSettings);

        localQrLlmSecret.url = String((card.querySelector('[data-qr-api-url]') as HTMLInputElement | null)?.value || localQrLlmSecret.url || '').trim();
        localQrLlmSecret.apiKey = String((card.querySelector('[data-qr-api-key]') as HTMLInputElement | null)?.value || localQrLlmSecret.apiKey || '');
        localQrLlmSecret.extraBodyParamsText = String((card.querySelector('[data-qr-extra-body-params]') as HTMLTextAreaElement | null)?.value || localQrLlmSecret.extraBodyParamsText || '');
        localQrLlmSecret.manualModelId = String((card.querySelector('[data-qr-model-manual]') as HTMLInputElement | null)?.value || localQrLlmSecret.manualModelId || localQrLlmSecret.model || '').trim();
        localQrLlmSecret.model = localQrLlmSecret.manualModelId || String((card.querySelector('[data-qr-model-select]') as HTMLSelectElement | null)?.value || '').trim();
        try {
          parseAdditionalBodyParams(localQrLlmSecret.extraBodyParamsText || '');
        } catch (e) {
          toast(`附加参数格式错误: ${e instanceof Error ? e.message : String(e)}`);
          return;
        }

        const { draft: newPlaceholders, duplicatedKey } = collectDraftPlaceholders();
        if (duplicatedKey) {
          toast(`存在重复占位符键：${duplicatedKey}`);
          return;
        }
        const draftRoleValues = collectDraftRoleValues();
        const oldPlaceholders = state.pack!.settings.placeholders || {};
        const oldKeys = new Set(Object.keys(oldPlaceholders));
        const newKeys = new Set(Object.keys(newPlaceholders));
        const renamePairs: Array<{ from: string; to: string }> = [];
        localCustomPhs.forEach((ph) => {
          const from = String(ph.originalKey || '').trim();
          const to = String(ph.key || '').trim();
          if (!from || !to || from === to) return;
          renamePairs.push({ from, to });
        });

        const roleMaps = localAllRoleMaps;
        for (const map of Object.values(roleMaps)) {
          for (const pair of renamePairs) {
            if (Object.prototype.hasOwnProperty.call(map, pair.from) && !Object.prototype.hasOwnProperty.call(map, pair.to)) {
              map[pair.to] = map[pair.from];
            }
            if (Object.prototype.hasOwnProperty.call(map, pair.from)) delete map[pair.from];
          }
          for (const oldKey of oldKeys) {
            if (!newKeys.has(oldKey) && Object.prototype.hasOwnProperty.call(map, oldKey)) delete map[oldKey];
          }
        }

        saveRoleValuesBySelection();
        if (selectedRoleOption !== ROLE_DEFAULT_OPTION) {
          const selectedRoleMap = roleMaps[selectedRoleOption] || (roleMaps[selectedRoleOption] = {});
          for (const key of Object.keys(selectedRoleMap)) {
            if (newKeys.has(key)) delete selectedRoleMap[key];
          }
          for (const [k, v] of Object.entries(draftRoleValues)) {
            if (newKeys.has(k) && v) selectedRoleMap[k] = v;
          }
          localAllRoleMeta[selectedRoleOption] = {
            name: String(localAllRoleMeta[selectedRoleOption]?.name || (selectedRoleOption === state.activeCharacterId ? state.activeCharacterName : '') || selectedRoleOption),
            lastSeenAt: nowIso(),
          };
        }

        state.pack!.settings.placeholders = newPlaceholders;
        const cleanedRoleMaps: Record<string, Record<string, string>> = {};
        for (const [characterId, map] of Object.entries(roleMaps)) {
          const cleanMap: Record<string, string> = {};
          for (const [k, v] of Object.entries(map || {})) {
            const key = String(k || '').trim();
            if (!key || !newKeys.has(key)) continue;
            cleanMap[key] = String(v || '');
          }
          if (Object.keys(cleanMap).length) cleanedRoleMaps[characterId] = cleanMap;
        }
        const cleanedMeta: Record<string, { name: string; lastSeenAt: string }> = {};
        for (const characterId of Object.keys(cleanedRoleMaps)) {
          const meta = localAllRoleMeta[characterId];
          cleanedMeta[characterId] = {
            name: String(meta?.name || characterId),
            lastSeenAt: String(meta?.lastSeenAt || nowIso()),
          };
        }
        state.pack!.settings.placeholderRoleMaps.byCharacterId = cleanedRoleMaps;
        state.pack!.settings.placeholderRoleMaps.characterMeta = cleanedMeta;
        saveQrLlmSecretConfig(localQrLlmSecret);
        if (localQrLlmSecret.model && !state.qrLlmModelList.includes(localQrLlmSecret.model)) {
          state.qrLlmModelList = [...state.qrLlmModelList, localQrLlmSecret.model];
        }
        persistPack();
        renderWorkbench();
        toast('设置已保存');
        close();
      };
      return card;
    });
  }

  function openEditItemModal(item: Item | null, presetCategoryId?: string | null): void {
    if (!state.pack) return;
    state.editGenerateState.isGenerating = false;
    state.editGenerateState.abortController = null;
    state.editGenerateState.lastDraftBeforeGenerate = '';
    state.editGenerateState.lastGeneratedText = '';
    showModal((close) => {
      const card = pD.createElement('div');
      card.className = 'fp-modal-card fp-edit-item-card';

      const cats = state.pack!.categories.sort((a, b) => a.order - b.order);
      const selectedCategoryId = (
        (item?.categoryId && getCategoryById(item.categoryId) ? item.categoryId : null) ||
        (presetCategoryId && getCategoryById(presetCategoryId) ? presetCategoryId : null) ||
        (state.currentCategoryId && getCategoryById(state.currentCategoryId) ? state.currentCategoryId : null) ||
        (cats[0]?.id || null)
      );

      card.innerHTML = `
        <div class="fp-modal-title">✏️ 编辑条目</div>
        <div class="fp-edit-scroll">
        <div class="fp-row"><label>名称</label><input data-name value="${item ? item.name : ''}" /></div>
        <div class="fp-row fp-row-block">
          <label>执行内容</label>
          <div class="fp-content-editor">
            <textarea data-content>${item ? item.content : ''}</textarea>
            <button type="button" class="fp-qr-undo-btn" data-qr-undo style="display:none" title="撤回生成">${iconSvg('undo')}</button>
            <button type="button" class="fp-qr-gen-btn" data-qr-generate title="AI扩写">${iconSvg('sparkles')}</button>
          </div>
        </div>
        <div data-qr-gen-status class="fp-qr-gen-status"></div>
        <div class="fp-row"><label>执行方式</label>
          <select data-mode>
            <option value="append" ${(item?.mode || state.pack!.settings.defaults.mode) === 'append' ? 'selected' : ''}>追加到输入框</option>
            <option value="inject" ${(item?.mode || state.pack!.settings.defaults.mode) === 'inject' ? 'selected' : ''}>注入到上下文</option>
          </select>
        </div>
        <div class="fp-row fp-row-block"><label>所属分类</label>
          <div class="fp-cat-field">
            <div data-cat-picker></div>
            <input type="hidden" data-cat />
          </div>
        </div>
        ${buildPlaceholderQuickInsertRow('变量快捷')}
        </div>
        <div class="fp-actions">
          ${item ? '<button class="danger" data-del>删除</button>' : ''}
          <button data-close>取消</button>
          <button class="primary" data-save>${item ? '保存' : '创建'}</button>
        </div>
      `;

      mountCategorySearchableSelect(card, {
        pickerSelector: '[data-cat-picker]',
        valueSelector: '[data-cat]',
        selectedId: selectedCategoryId,
        placeholder: '选择所属分类',
        searchPlaceholder: '搜索分类（支持模糊匹配）...',
      });
      mountPlaceholderQuickInsert(card, { chipsSelector: '[data-ph-chips]', targetSelector: '[data-content]' });

      const contentEl = card.querySelector('[data-content]') as HTMLTextAreaElement | null;
      const generateBtn = card.querySelector('[data-qr-generate]') as HTMLButtonElement | null;
      const undoBtn = card.querySelector('[data-qr-undo]') as HTMLButtonElement | null;
      const statusEl = card.querySelector('[data-qr-gen-status]') as HTMLElement | null;
      const setGenerateStatus = (msg: string, level: 'info' | 'ok' | 'warn' | 'error' = 'info') => {
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.style.color = level === 'ok' ? '#4caf50' : (level === 'warn' ? '#d89614' : (level === 'error' ? '#d64848' : 'var(--qr-text-2)'));
      };
      const setGeneratingUi = (generating: boolean) => {
        if (generateBtn) {
          generateBtn.disabled = generating;
          generateBtn.classList.toggle('is-loading', generating);
          generateBtn.title = generating ? '生成中...' : 'AI扩写';
        }
      };

      if (undoBtn) {
        undoBtn.onclick = () => {
          if (!contentEl) return;
          const prev = String(state.editGenerateState.lastDraftBeforeGenerate || '');
          if (!prev) {
            toast('没有可撤回内容');
            return;
          }
          contentEl.value = prev;
          state.editGenerateState.lastDraftBeforeGenerate = '';
          state.editGenerateState.lastGeneratedText = '';
          undoBtn.style.display = 'none';
          setGenerateStatus('已撤回到生成前草稿', 'ok');
          toast('已撤回生成结果');
        };
      }

      if (generateBtn) {
        generateBtn.onclick = async () => {
          if (!state.pack || !contentEl) return;
          const draft = String(contentEl.value || '').trim();
          if (!draft) {
            toast('执行内容为空，请先输入草稿');
            setGenerateStatus('执行内容为空，无法生成', 'warn');
            return;
          }
          if (state.editGenerateState.isGenerating) return;

          const ac = new AbortController();
          state.editGenerateState.abortController = ac;
          state.editGenerateState.isGenerating = true;
          state.editGenerateState.lastDraftBeforeGenerate = contentEl.value;
          setGeneratingUi(true);
          setGenerateStatus('正在生成扩写内容...');

          const streamEnabled = !!state.pack.settings.qrLlm.enabledStream;
          if (streamEnabled) {
            contentEl.value = '';
          }

          try {
            const result = await generateQrExpandedContent(draft, {
              signal: ac.signal,
              onDelta: streamEnabled
                ? (text) => {
                    if (!contentEl) return;
                    contentEl.value = text;
                  }
                : undefined,
            });
            const finalText = String(result || '').trim();
            if (!finalText) throw new Error('生成结果为空');
            contentEl.value = finalText;
            state.editGenerateState.lastGeneratedText = finalText;
            if (undoBtn) undoBtn.style.display = '';
            setGenerateStatus('扩写完成，可继续编辑或点击撤回恢复草稿', 'ok');
            toast('执行内容已扩写完成');
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (String(msg).toLowerCase().includes('aborted')) {
              setGenerateStatus('已取消生成', 'warn');
              toast('已取消生成');
            } else {
              if (streamEnabled && state.editGenerateState.lastDraftBeforeGenerate) {
                contentEl.value = state.editGenerateState.lastDraftBeforeGenerate;
              }
              setGenerateStatus(`生成失败: ${msg}`, 'error');
              toast(`生成失败: ${msg}`);
            }
          } finally {
            state.editGenerateState.isGenerating = false;
            state.editGenerateState.abortController = null;
            setGeneratingUi(false);
          }
        };
      }

      if (item) {
        (card.querySelector('[data-del]') as HTMLElement | null)!.onclick = () => {
          if (!confirm('确认删除该条目？')) return;
          state.pack!.items = state.pack!.items.filter((i) => i.id !== item.id);
          persistPack();
          renderWorkbench();
          toast('条目已删除');
          close();
        };
      }

      (card.querySelector('[data-close]') as HTMLElement | null)!.onclick = () => {
        try { state.editGenerateState.abortController?.abort(); } catch (e) {}
        close();
      };
      (card.querySelector('[data-save]') as HTMLElement | null)!.onclick = () => {
        const name = (card.querySelector('[data-name]') as HTMLInputElement | null)?.value.trim();
        const content = (card.querySelector('[data-content]') as HTMLTextAreaElement | null)?.value.trim();
        const mode = (card.querySelector('[data-mode]') as HTMLSelectElement | null)?.value === 'inject' ? 'inject' : 'append';
        const categoryId = (card.querySelector('[data-cat]') as HTMLInputElement | null)?.value;
        if (!name || !content) {
          toast('名称和执行内容不能为空');
          return;
        }
        if (item) {
          item.name = name;
          item.content = content;
          item.mode = mode;
          item.categoryId = categoryId || null;
        } else {
          state.pack!.items.push({
            id: uid('item'),
            categoryId: categoryId || null,
            name,
            content,
            mode,
            favorite: false,
            order: getItemsByCategory(categoryId || null, false).length,
          });
        }
        persistPack();
        renderWorkbench();
        toast(item ? '条目已更新' : '条目已创建');
        close();
      };

      return card;
    });
  }

  function openCustomConnectorActionModal(): void {
    if (!state.pack) return;
    showModal((close) => {
      const card = pD.createElement('div');
      card.className = 'fp-modal-card fp-edit-item-card';

      const cats = state.pack!.categories.sort((a, b) => a.order - b.order);
      const selectedCategoryId = (
        (state.currentCategoryId && getCategoryById(state.currentCategoryId) ? state.currentCategoryId : null) ||
        (cats[0]?.id || null)
      );
      const defaultName = `自定义_${new Date().toLocaleTimeString('zh-CN', { hour12: false }).replace(/:/g, '')}`;

      card.innerHTML = `
        <div class="fp-modal-title">✨ 快速添加自定义</div>
        <div class="fp-edit-scroll">
        <div class="fp-row"><label>名称</label><input data-name value="${defaultName}" placeholder="如：转场总结" /></div>
        <div class="fp-row"><label>执行内容</label><textarea data-content placeholder="输入要发送的内容..."></textarea></div>
        <div class="fp-row"><label>执行方式</label>
          <select data-mode>
            <option value="append" ${state.pack!.settings.defaults.mode === 'append' ? 'selected' : ''}>追加到输入框</option>
            <option value="inject" ${state.pack!.settings.defaults.mode === 'inject' ? 'selected' : ''}>注入到上下文</option>
          </select>
        </div>
        ${buildPlaceholderQuickInsertRow('插入占位符')}
        <div class="fp-row fp-save-toggle">
          <label>保存到库</label>
          <label class="fp-toggle" style="width:auto">
            <input type="checkbox" data-save-lib checked />
            <span class="fp-toggle-track"><span class="fp-toggle-thumb"></span></span>
            <span class="fp-toggle-text">确认后同时创建条目</span>
          </label>
        </div>
        <div class="fp-row fp-row-block" data-save-cat-wrap><label>保存分类</label>
          <div class="fp-cat-field">
            <div data-save-cat-picker></div>
            <input type="hidden" data-save-cat />
          </div>
        </div>
        </div>
        <div class="fp-actions">
          <button data-close>取消</button>
          <button class="primary" data-confirm>确认</button>
        </div>
      `;

      mountCategorySearchableSelect(card, {
        pickerSelector: '[data-save-cat-picker]',
        valueSelector: '[data-save-cat]',
        selectedId: selectedCategoryId,
        placeholder: '选择保存分类',
        searchPlaceholder: '搜索分类（支持模糊匹配）...',
      });
      mountPlaceholderQuickInsert(card, { chipsSelector: '[data-ph-chips]', targetSelector: '[data-content]' });

      const saveLibEl = card.querySelector('[data-save-lib]') as HTMLInputElement | null;
      const saveCatWrapEl = card.querySelector('[data-save-cat-wrap]') as HTMLElement | null;
      const syncSaveCategoryVisibility = () => {
        if (!saveCatWrapEl || !saveLibEl) return;
        saveCatWrapEl.style.display = saveLibEl.checked ? '' : 'none';
      };
      syncSaveCategoryVisibility();
      if (saveLibEl) saveLibEl.onchange = syncSaveCategoryVisibility;

      (card.querySelector('[data-close]') as HTMLElement | null)!.onclick = close;
      (card.querySelector('[data-confirm]') as HTMLElement | null)!.onclick = async () => {
        if (!state.pack) return;
        const nameInput = (card.querySelector('[data-name]') as HTMLInputElement | null)?.value.trim();
        const contentInput = (card.querySelector('[data-content]') as HTMLTextAreaElement | null)?.value.trim();
        const mode = (card.querySelector('[data-mode]') as HTMLSelectElement | null)?.value === 'inject' ? 'inject' : 'append';
        const shouldSave = !!(card.querySelector('[data-save-lib]') as HTMLInputElement | null)?.checked;
        const categoryId = (card.querySelector('[data-save-cat]') as HTMLInputElement | null)?.value || null;

        if (!contentInput) {
          toast('执行内容不能为空');
          return;
        }

        const finalName = nameInput || truncateContent(contentInput, 12) || '自定义条目';
        const tempItem: Item = {
          id: uid('temp'),
          categoryId: null,
          name: finalName,
          content: contentInput,
          mode,
          favorite: false,
          order: 0,
        };
        await runItemDirect(tempItem);

        if (shouldSave) {
          state.pack.items.push({
            id: uid('item'),
            categoryId,
            name: finalName,
            content: contentInput,
            mode,
            favorite: false,
            order: getItemsByCategory(categoryId, false).length,
          });
          persistPack();
          renderWorkbench();
          toast(`已保存到分类: ${getCategoryById(categoryId || '')?.name || '未分类'}`);
        }
        close();
      };
      return card;
    });
  }

  function buildFilteredIncomingBySelection(incoming: Pack, selectedCategoryIds: string[], selectedItemIds: string[]): Pack {
    const catById = new Map<string, Category>(incoming.categories.map((c) => [c.id, c]));
    const includeCatIds = new Set<string>(selectedCategoryIds || []);
    const includeItemIds = new Set<string>(selectedItemIds || []);

    function includeAncestors(catId: string): void {
      let cur = catById.get(catId);
      const guard = new Set<string>();
      while (cur && !guard.has(cur.id)) {
        guard.add(cur.id);
        includeCatIds.add(cur.id);
        cur = cur.parentId ? catById.get(cur.parentId) : undefined;
      }
    }

    for (const item of incoming.items) {
      if (includeItemIds.has(item.id)) {
        includeAncestors(item.categoryId || '');
      }
    }
    for (const catId of [...includeCatIds]) includeAncestors(catId);

    return normalizePack({
      meta: deepClone(incoming.meta),
      settings: deepClone(incoming.settings),
      uiState: deepClone(incoming.uiState),
      favorites: deepClone(incoming.favorites || []),
      categories: incoming.categories.filter((c) => includeCatIds.has(c.id)),
      items: incoming.items.filter((i) => includeItemIds.has(i.id) && includeCatIds.has(i.categoryId || '')),
    });
  }

  function openImportSelectionModal(incoming: Pack, onDone: (selected: Pack | null, includeSettings: boolean) => void): void {
    showModal((closeSelect) => {
      const card = pD.createElement('div');
      card.className = 'fp-modal-card';

      const pathMap = new Map<string, string>();
      const catById = new Map<string, Category>(incoming.categories.map((c) => [c.id, c]));
      for (const cat of incoming.categories) {
        const names: string[] = [];
        let cur: Category | undefined = cat;
        const guard = new Set<string>();
        while (cur && !guard.has(cur.id)) {
          guard.add(cur.id);
          names.unshift(cur.name);
          cur = cur.parentId ? catById.get(cur.parentId) : undefined;
        }
        pathMap.set(cat.id, names.join(' / '));
      }

      card.innerHTML = `
        <div class="fp-modal-title">🧩 导入前勾选</div>
        <div style="font-size:12px;color:#a7c8bc;margin-bottom:10px">先选择要导入的分类和条目，再进入冲突处理。</div>
        <div class="fp-row"><label>筛选</label><input data-filter placeholder="按名称筛选..." /></div>
        <div class="fp-actions" style="justify-content:flex-start;margin-top:0">
          <button data-all>全选</button>
          <button data-none>全不选</button>
        </div>
        <div class="fp-row" style="margin-bottom:10px">
          <label>附加导入</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--qr-text-2);width:auto">
            <input type="checkbox" data-include-settings checked />
            <span>导入设置（占位符默认值 / 角色映射 / 连接符 / 主题 / 自定义CSS）</span>
          </label>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;max-height:52vh;overflow:hidden">
          <div style="border:1px solid rgba(174,199,190,.2);border-radius:10px;overflow:auto">
            <div style="position:sticky;top:0;background:rgba(18,25,26,.96);padding:8px 10px;font-size:12px;color:#a7c8bc;border-bottom:1px solid rgba(174,199,190,.2)">分类（${incoming.categories.length}）</div>
            <div data-cats style="padding:8px"></div>
          </div>
          <div style="border:1px solid rgba(174,199,190,.2);border-radius:10px;overflow:auto">
            <div style="position:sticky;top:0;background:rgba(18,25,26,.96);padding:8px 10px;font-size:12px;color:#a7c8bc;border-bottom:1px solid rgba(174,199,190,.2)">条目（${incoming.items.length}）</div>
            <div data-items style="padding:8px"></div>
          </div>
        </div>
        <div class="fp-actions">
          <button data-close>取消</button>
          <button class="primary" data-next>下一步：冲突处理</button>
        </div>
      `;

      const catsWrap = card.querySelector('[data-cats]') as HTMLElement | null;
      const itemsWrap = card.querySelector('[data-items]') as HTMLElement | null;
      const filterInput = card.querySelector('[data-filter]') as HTMLInputElement | null;

      const renderLists = (): void => {
        const kw = (filterInput?.value || '').trim().toLowerCase();
        if (catsWrap) catsWrap.innerHTML = '';
        if (itemsWrap) itemsWrap.innerHTML = '';

        for (const cat of incoming.categories) {
          const p = pathMap.get(cat.id) || cat.name;
          if (kw && !p.toLowerCase().includes(kw)) continue;
          const row = pD.createElement('label');
          row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;padding:6px;border-radius:8px';
          row.innerHTML = `<input type="checkbox" data-cat-id="${cat.id}" checked /><span style="font-size:12px;line-height:1.35">${p}</span>`;
          catsWrap?.appendChild(row);
        }

        for (const item of incoming.items) {
          const full = `${pathMap.get(item.categoryId || '') || ''} / ${item.name}`;
          if (kw && !full.toLowerCase().includes(kw) && !(item.content || '').toLowerCase().includes(kw)) continue;
          const row = pD.createElement('label');
          row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;padding:6px;border-radius:8px';
          row.innerHTML = `<input type="checkbox" data-item-id="${item.id}" checked /><span style="font-size:12px;line-height:1.35"><b>${item.name}</b><br/><span style="opacity:.7">${pathMap.get(item.categoryId || '') || ''}</span></span>`;
          itemsWrap?.appendChild(row);
        }
      };
      renderLists();

      filterInput!.oninput = renderLists;
      (card.querySelector('[data-all]') as HTMLElement | null)!.onclick = () => {
        card.querySelectorAll('input[type="checkbox"]').forEach((el) => { (el as HTMLInputElement).checked = true; });
      };
      (card.querySelector('[data-none]') as HTMLElement | null)!.onclick = () => {
        card.querySelectorAll('input[type="checkbox"]').forEach((el) => { (el as HTMLInputElement).checked = false; });
      };

      (card.querySelector('[data-close]') as HTMLElement | null)!.onclick = () => {
        closeSelect();
        onDone(null, false);
      };

      (card.querySelector('[data-next]') as HTMLElement | null)!.onclick = () => {
        const selectedCategoryIds = [...card.querySelectorAll('input[data-cat-id]:checked')].map((el) => el.getAttribute('data-cat-id') || '');
        const selectedItemIds = [...card.querySelectorAll('input[data-item-id]:checked')].map((el) => el.getAttribute('data-item-id') || '');
        const includeSettings = !!(card.querySelector('[data-include-settings]') as HTMLInputElement | null)?.checked;
        const filtered = buildFilteredIncomingBySelection(incoming, selectedCategoryIds, selectedItemIds);
        if (!filtered.categories.length && !filtered.items.length && !includeSettings) {
          toast('请至少勾选一个分类或条目，或勾选导入设置');
          return;
        }
        closeSelect();
        onDone(filtered, includeSettings);
      };

      return card;
    });
  }

  function isLegacyQrJson(data: unknown): data is { qrList: unknown[] } & Record<string, unknown> {
    return !!(data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).qrList));
  }

  function sanitizeLegacyText(text: string): string {
    return String(text || '').replace(/\{\{input\}\}|\{input\}/g, '').trim();
  }

  function containsBlockedContent(text: string): boolean {
    const blocked = ['未成年', '幼女', '幼男', '正太', '萝莉', '小男孩', '小女孩', '儿童'];
    const raw = String(text || '');
    return blocked.some((kw) => raw.includes(kw));
  }

  interface LegacyQrItem {
    label?: string;
    message?: string;
  }

  interface LegacyQr {
    name?: string;
    qrList?: LegacyQrItem[];
  }

  function convertLegacyQrToPack(legacy: LegacyQr): { pack: Pack; skippedUnsafe: number } {
    const rootId = uid('cat');
    const rootName = String(legacy.name || 'QR导入').trim() || 'QR导入';
    const categories: Category[] = [{ id: rootId, name: rootName, parentId: null, order: 0, collapsed: false }];
    const items: Item[] = [];
    
    const labelToCatId = new Map<string, string>();
    const childParentMap = new Map<string, string>();
    const list = Array.isArray(legacy.qrList) ? legacy.qrList : [];
    
    list.forEach((q, idx) => {
      const label = String(q?.label || `菜单${idx + 1}`).trim();
      if (!labelToCatId.has(label)) {
        const id = uid('cat');
        labelToCatId.set(label, id);
        categories.push({
          id,
          name: label,
          parentId: rootId,
          order: idx,
          collapsed: false,
        });
      }
    });
    
    let skippedUnsafe = 0;
    for (const q of list) {
      const curLabel = String(q?.label || '').trim();
      const curCatId = labelToCatId.get(curLabel);
      if (!curCatId) continue;
      const msg = String(q?.message || '');
      const ruleRegex = /right="([^"]+)"\s*\{\:\s*([\s\S]*?)\s*:\}/g;
      let m: RegExpExecArray | null;
      let localOrder: number = items.filter((it) => it.categoryId === curCatId).length;
    
      while ((m = ruleRegex.exec(msg)) !== null) {
        const choice = String(m[1] || '').trim();
        const action = String(m[2] || '').trim();
        if (!choice || ['⬅️返回', '✨然后', '⚡同时', '--------'].includes(choice)) continue;
    
        const runMatch = action.match(/\/run\s+([^\n|:}]+)/);
        const setInputMatch = action.match(/\/setinput[\s\S]*?<([\s\S]*?)>/);
        const injectMatch = action.match(/\/inject(?:\s+[^\n]*)?\s+\"?([\s\S]*?)\"?(?:\s*\|\||$)/);
    
        if (runMatch) {
          const targetLabel = String(runMatch[1] || '').trim();
          if (labelToCatId.has(targetLabel) && targetLabel !== curLabel && !childParentMap.has(targetLabel)) {
            childParentMap.set(targetLabel, curLabel);
          }
        }
    
        let mode: 'append' | 'inject' | null = null;
        let content = '';
        if (setInputMatch) {
          mode = 'append';
          content = sanitizeLegacyText(setInputMatch[1]);
        } else if (injectMatch) {
          mode = 'inject';
          content = sanitizeLegacyText(injectMatch[1]);
        }
    
        if (!mode || !content) continue;
        if (containsBlockedContent(`${choice}\n${content}`)) {
          skippedUnsafe += 1;
          continue;
        }
    
        const duplicateCount = items.filter((it) => it.categoryId === curCatId && it.name === choice).length;
        items.push({
          id: uid('item'),
          categoryId: curCatId,
          name: duplicateCount ? `${choice} (${duplicateCount + 1})` : choice,
          content,
          mode,
          favorite: false,
          order: localOrder++,
        });
      }
    }
    
    for (const [childLabel, parentLabel] of childParentMap.entries()) {
      const childId = labelToCatId.get(childLabel);
      const parentId = labelToCatId.get(parentLabel);
      const child = categories.find((c) => c.id === childId);
      if (child && parentId && child.id !== parentId) child.parentId = parentId;
    }
    
    const byParent = new Map<string | null, Category[]>();
    for (const c of categories) {
      const key = c.parentId || 'root';
      const arr = byParent.get(key) || [];
      arr.push(c);
      byParent.set(key, arr);
    }
    for (const arr of byParent.values()) {
      arr.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
      arr.forEach((c, idx) => { c.order = idx; });
    }

    return {
      pack: normalizePack({
        meta: {
          version: DATA_VERSION,
          createdAt: nowIso(),
          source: 'legacy-qr-converter',
          name: rootName,
        },
        categories,
        items,
        settings: deepClone(state.pack?.settings || buildDefaultPack().settings),
        uiState: deepClone(state.pack?.uiState || buildDefaultPack().uiState),
        favorites: [],
      }),
      skippedUnsafe,
    };
  }

  function openImportModal() {
    showModal((close) => {
      const card = pD.createElement('div');
      card.className = 'fp-modal-card';
      card.innerHTML = `
        <div class="fp-modal-title">📥 导入 JSON（支持 QRPack v1 / 原版 QR）</div>
        <div class="fp-row"><label>选择文件</label><input data-file type="file" accept=".json,application/json" /></div>
        <div style="font-size:12px;color:#9fbfb4;margin:-4px 0 8px 106px">仅支持文件导入，请选择本地 JSON 文件（手机可直接选择文件）。</div>
        <div class="fp-actions">
          <button data-close>取消</button>
          <button class="primary" data-parse>解析并导入</button>
        </div>
      `;

      const fileInput = card.querySelector('[data-file]') as HTMLInputElement | null;
      let loadedFileText = '';
      let loadedFileName = '';

      fileInput!.onchange = async () => {
        const file = fileInput?.files && fileInput.files[0];
        if (!file) return;
        try {
          loadedFileText = await file.text();
          loadedFileName = file.name || '';
          toast(`已加载文件: ${loadedFileName || 'JSON'}`);
        } catch (e) {
          loadedFileText = '';
          loadedFileName = '';
          toast('读取文件失败');
        }
      };

      (card.querySelector('[data-close]') as HTMLElement | null)!.onclick = close;
      (card.querySelector('[data-parse]') as HTMLElement | null)!.onclick = async () => {
        let parsed: unknown;
        try {
          let raw = loadedFileText;
          if (!raw.trim()) {
            const file = fileInput?.files && fileInput.files[0];
            if (file) {
              raw = await file.text();
              loadedFileText = raw;
              loadedFileName = file.name || loadedFileName;
            }
          }

          if (!raw.trim()) {
            toast('请先选择 JSON 文件');
            return;
          }
          if (loadedFileName) {
            toast(`开始解析: ${loadedFileName}`);
          }
          parsed = JSON.parse(raw);
        } catch (e) {
          toast('JSON 格式错误');
          return;
        }

        let incoming: Pack;
        if (isLegacyQrJson(parsed)) {
          const converted = convertLegacyQrToPack(parsed as LegacyQr);
          incoming = converted.pack;
          if (converted.skippedUnsafe > 0) {
            toast(`已自动过滤 ${converted.skippedUnsafe} 条不兼容条目`);
          } else {
            toast('已从原版 QR 结构转换为可导入数据');
          }
        } else {
          incoming = normalizePack(parsed);
        }

        openImportSelectionModal(incoming, (selectedIncoming, includeSettings) => {
          if (!selectedIncoming) return;
          if (!state.pack) return;
          const askRoleMapPolicyThenApply = (doApply: (policy: 'skip' | 'overwrite') => void) => {
            if (!includeSettings || !hasPlaceholderRoleMapConflict(state.pack!.settings, selectedIncoming.settings)) {
              doApply('overwrite');
              return;
            }
            showModal((closePolicy) => {
              const policyCard = pD.createElement('div');
              policyCard.className = 'fp-modal-card';
              policyCard.innerHTML = `
                <div class="fp-modal-title">⚖️ 映射冲突处理</div>
                <div style="font-size:12px;color:#a7c8bc;margin-bottom:10px">检测到角色映射冲突，请选择一次性全局策略。</div>
                <div class="fp-row"><label>策略</label>
                  <select data-map-policy>
                    <option value="skip">全部跳过冲突键（保留本地）</option>
                    <option value="overwrite" selected>全部覆盖冲突键（采用导入）</option>
                  </select>
                </div>
                <div class="fp-actions">
                  <button data-close>取消</button>
                  <button class="primary" data-apply>确认</button>
                </div>
              `;
              (policyCard.querySelector('[data-close]') as HTMLElement | null)!.onclick = closePolicy;
              (policyCard.querySelector('[data-apply]') as HTMLElement | null)!.onclick = () => {
                const policy = ((policyCard.querySelector('[data-map-policy]') as HTMLSelectElement | null)?.value || 'overwrite') as 'skip' | 'overwrite';
                closePolicy();
                doApply(policy);
              };
              return policyCard;
            });
          };

          interface ConflictItem {
            type: 'category' | 'item';
            incoming: Category | Item;
            existing: Category | Item;
            action: 'skip' | 'overwrite' | 'rename';
            rename: string;
          }

          const conflicts: ConflictItem[] = [];
          const catByParentAndName = new Map<string, Category | Item>();
          for (const c of state.pack.categories) {
            catByParentAndName.set(`${c.parentId || 'root'}::${c.name}`, c);
          }
          const itemByCatAndName = new Map<string, Category | Item>();
          for (const i of state.pack.items) {
            itemByCatAndName.set(`${i.categoryId}::${i.name}`, i);
          }

          for (const cat of selectedIncoming.categories) {
            const key = `${cat.parentId || 'root'}::${cat.name}`;
            const hit = catByParentAndName.get(key) as Category | undefined;
            if (hit) conflicts.push({ type: 'category', incoming: cat, existing: hit, action: 'skip', rename: '' });
          }
          for (const item of selectedIncoming.items) {
            const key = `${item.categoryId}::${item.name}`;
            const hit = itemByCatAndName.get(key) as Item | undefined;
            if (hit) conflicts.push({ type: 'item', incoming: item, existing: hit, action: 'skip', rename: '' });
          }

          if (!conflicts.length) {
            askRoleMapPolicyThenApply((policy) => {
              applyImport(selectedIncoming, [], includeSettings, policy);
              close();
            });
            return;
          }

          showModal((closeConflict) => {
            const c2 = pD.createElement('div');
            c2.className = 'fp-modal-card';
            c2.innerHTML = `
              <div class="fp-modal-title">⚠️ 导入冲突处理</div>
              <div style="font-size:12px;color:#a7c8bc;margin-bottom:8px">可逐条选择：跳过 / 覆盖 / 重命名</div>
              <div style="max-height:52vh;overflow:auto" data-list></div>
              <div class="fp-actions">
                <button data-close>取消</button>
                <button class="primary" data-apply>应用并导入</button>
              </div>
            `;

            const list = c2.querySelector('[data-list]') as HTMLElement | null;
            conflicts.forEach((c, idx) => {
              const row = pD.createElement('div');
              row.style.cssText = 'padding:8px;border:1px solid rgba(174,199,190,.2);border-radius:10px;margin-bottom:8px';
              row.innerHTML = `
                <div style="font-size:12px;margin-bottom:6px">${c.type === 'category' ? '分类' : '条目'} 冲突：<b>${c.incoming.name}</b></div>
                <div class="fp-row"><label>策略</label>
                  <select data-action="${idx}">
                    <option value="skip" selected>跳过</option>
                    <option value="overwrite">覆盖</option>
                    <option value="rename">重命名导入</option>
                  </select>
                </div>
                <div class="fp-row"><label>新名称</label><input data-rename="${idx}" placeholder="仅在重命名时使用" /></div>
              `;
              list?.appendChild(row);
            });

            (c2.querySelector('[data-close]') as HTMLElement | null)!.onclick = closeConflict;
            (c2.querySelector('[data-apply]') as HTMLElement | null)!.onclick = () => {
              conflicts.forEach((c, idx) => {
                c.action = (c2.querySelector(`[data-action="${idx}"]`) as HTMLSelectElement | null)?.value as ConflictItem['action'] || 'skip';
                c.rename = (c2.querySelector(`[data-rename="${idx}"]`) as HTMLInputElement | null)?.value.trim() || '';
              });
              askRoleMapPolicyThenApply((policy) => {
                applyImport(selectedIncoming, conflicts, includeSettings, policy);
                closeConflict();
                close();
              });
            };

            return c2;
          });
        });
      };

      return card;
    });
  }

  interface ImportConflict {
    type: 'category' | 'item';
    incoming: Category | Item;
    existing: Category | Item;
    action: 'skip' | 'overwrite' | 'rename';
    rename: string;
  }

  function hasPlaceholderRoleMapConflict(localSettings: Settings, incomingSettings: Settings): boolean {
    const localMaps = localSettings?.placeholderRoleMaps?.byCharacterId || {};
    const incomingMaps = incomingSettings?.placeholderRoleMaps?.byCharacterId || {};
    for (const [characterId, incomingMap] of Object.entries(incomingMaps)) {
      const localMap = localMaps[characterId];
      if (!localMap) continue;
      for (const [placeholderKey, incomingValue] of Object.entries(incomingMap || {})) {
        if (!Object.prototype.hasOwnProperty.call(localMap, placeholderKey)) continue;
        if (String(localMap[placeholderKey] || '') !== String(incomingValue || '')) return true;
      }
    }
    return false;
  }

  function mergePlaceholderRoleMaps(
    localSettings: Settings,
    incomingSettings: Settings,
    policy: 'skip' | 'overwrite',
  ): Settings['placeholderRoleMaps'] {
    const localMaps = localSettings?.placeholderRoleMaps || { byCharacterId: {}, characterMeta: {} };
    const incomingMaps = incomingSettings?.placeholderRoleMaps || { byCharacterId: {}, characterMeta: {} };
    const mergedByCharacterId: Record<string, Record<string, string>> = deepClone(localMaps.byCharacterId || {});
    const mergedMeta: Record<string, { name: string; lastSeenAt: string }> = deepClone(localMaps.characterMeta || {});

    for (const [characterId, incomingMap] of Object.entries(incomingMaps.byCharacterId || {})) {
      const cur = mergedByCharacterId[characterId] || {};
      for (const [placeholderKey, incomingValue] of Object.entries(incomingMap || {})) {
        const hasLocal = Object.prototype.hasOwnProperty.call(cur, placeholderKey);
        if (!hasLocal || policy === 'overwrite') cur[placeholderKey] = String(incomingValue || '');
      }
      mergedByCharacterId[characterId] = cur;
    }

    for (const [characterId, meta] of Object.entries(incomingMaps.characterMeta || {})) {
      const localMeta = mergedMeta[characterId];
      if (!localMeta || policy === 'overwrite') {
        mergedMeta[characterId] = {
          name: String(meta?.name || ''),
          lastSeenAt: String(meta?.lastSeenAt || nowIso()),
        };
      }
    }

    return { byCharacterId: mergedByCharacterId, characterMeta: mergedMeta };
  }

  function applyImport(
    incoming: Pack,
    conflicts: ImportConflict[],
    includeSettings = false,
    placeholderMapPolicy: 'skip' | 'overwrite' = 'overwrite',
  ): void {
    if (!state.pack) return;
    const next = deepClone(state.pack);

    const conflictMap = new Map<string, ImportConflict>();
    for (const c of conflicts) {
      const key = `${c.type}::${c.incoming.id}`;
      conflictMap.set(key, c);
    }

    const catIdMap = new Map<string, string>();
    for (const c of incoming.categories) {
      const cf = conflictMap.get(`category::${c.id}`);
      if (!cf) {
        const copy = deepClone(c);
        if (next.categories.find((x) => x.id === copy.id)) copy.id = uid('cat');
        next.categories.push(copy);
        catIdMap.set(c.id, copy.id);
        continue;
      }

      if (cf.action === 'skip') {
        catIdMap.set(c.id, cf.existing.id);
        continue;
      }
      if (cf.action === 'overwrite') {
        (cf.existing as Category).name = c.name;
        (cf.existing as Category).collapsed = c.collapsed;
        catIdMap.set(c.id, cf.existing.id);
        continue;
      }

      const renamed = deepClone(c);
      renamed.id = uid('cat');
      renamed.name = cf.rename || `${c.name}_导入`;
      next.categories.push(renamed);
      catIdMap.set(c.id, renamed.id);
    }

    for (const it of incoming.items) {
      const mappedCat = catIdMap.get(it.categoryId || '') || it.categoryId;
      const cf = conflictMap.get(`item::${it.id}`);
      if (!cf) {
        const copy = deepClone(it);
        copy.id = next.items.find((x) => x.id === copy.id) ? uid('item') : copy.id;
        copy.categoryId = mappedCat || null;
        next.items.push(copy);
        continue;
      }
      if (cf.action === 'skip') continue;
      if (cf.action === 'overwrite') {
        (cf.existing as Item).content = it.content;
        (cf.existing as Item).mode = it.mode;
        (cf.existing as Item).favorite = it.favorite;
        (cf.existing as Item).categoryId = mappedCat || null;
        continue;
      }
      const renamed = deepClone(it);
      renamed.id = uid('item');
      renamed.name = cf.rename || `${it.name}_导入`;
      renamed.categoryId = mappedCat || null;
      next.items.push(renamed);
    }

    if (includeSettings) {
      next.settings = deepClone(incoming.settings);
      next.settings.placeholderRoleMaps = mergePlaceholderRoleMaps(state.pack.settings, incoming.settings, placeholderMapPolicy);
    }

    state.pack = normalizePack(next);
    persistPack();
    renderWorkbench();
    toast('导入完成');
  }

  function collectSubtreeIds(rootId: string): Set<string> {
    const ids = new Set<string>([rootId]);
    let changed = true;
    while (changed) {
      changed = false;
      if (!state.pack) break;
      for (const c of state.pack.categories) {
        if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) {
          ids.add(c.id);
          changed = true;
        }
      }
    }
    return ids;
  }

  function openExportModal(): void {
    if (!state.pack) return;
    const fallbackId = state.pack.categories.find((c) => c.parentId === null)?.id;
    const rootId = state.currentCategoryId && state.currentCategoryId !== '__favorites__' ? state.currentCategoryId : fallbackId;
    if (!rootId) {
      toast('没有可导出的分类');
      return;
    }
    const ids = collectSubtreeIds(rootId);
    const payload = normalizePack({
      meta: {
        version: DATA_VERSION,
        createdAt: nowIso(),
        source: SCRIPT_LABEL,
        name: `导出_${getCategoryById(rootId)?.name || '分类子树'}`,
      },
      categories: state.pack.categories.filter((c) => ids.has(c.id)),
      items: state.pack.items.filter((i) => ids.has(i.categoryId || '')),
      settings: deepClone(state.pack.settings),
      uiState: deepClone(state.pack.uiState),
      favorites: state.pack.favorites.filter((id) => state.pack!.items.find((x) => x.id === id && ids.has(x.categoryId || ''))),
    });

    const text = JSON.stringify(payload, null, 2);

    showModal((close) => {
      const card = pD.createElement('div');
      card.className = 'fp-modal-card';
      card.innerHTML = `
        <div class="fp-modal-title">📤 导出当前分类子树</div>
        <div class="fp-row"><label>JSON</label><textarea data-json></textarea></div>
        <div class="fp-actions">
          <button class="primary" data-download>下载</button>
          <button data-close>关闭</button>
        </div>
      `;
      const ta = card.querySelector('[data-json]') as HTMLTextAreaElement | null;
      if (ta) ta.value = text;
      (card.querySelector('[data-download]') as HTMLElement | null)!.onclick = () => {
        const blob = new Blob([ta?.value || text], { type: 'application/json;charset=utf-8' });
        const a = pD.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `快速回复管理器_导出_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      };
      (card.querySelector('[data-close]') as HTMLElement | null)!.onclick = close;
      return card;
    });
  }

  function resolvePreviewTokenType(token: { type: string; label: string }): string {
    const t = String(token.type || '').trim();
    if (!t) return 'raw';
    if (t === 'item' || t === 'raw') return t;

    const connectors = state.pack?.settings?.connectors || [];
    const isColor = (v: string) => Object.prototype.hasOwnProperty.call(CONNECTOR_COLOR_HEX, v);

    if (t.startsWith('conn-id:')) {
      const id = t.slice('conn-id:'.length);
      const c = connectors.find((x) => x.id === id);
      return c && isColor(c.color) ? `conn-${c.color}` : 'raw';
    }

    return 'raw';
  }

  function renderPreview(previewEl: HTMLElement): void {
    previewEl.innerHTML = '';
    const tokens = state.pack?.uiState?.preview?.tokens || [];
    let insertIndicator: HTMLElement | null = null;
    const clearDropMarkers = () => {
      previewEl.querySelectorAll('.fp-token.drop-before,.fp-token.drop-after').forEach((el) => {
        el.classList.remove('drop-before', 'drop-after');
      });
    };
    const ensureInsertIndicator = () => {
      if (!insertIndicator) {
        insertIndicator = pD.createElement('span');
        insertIndicator.className = 'fp-token-insert-indicator';
      }
      return insertIndicator;
    };
    const clearInsertIndicator = () => {
      if (insertIndicator && insertIndicator.parentElement) {
        insertIndicator.remove();
      }
    };
    
    tokens.forEach((t, index) => {
      const chip = pD.createElement('span');
      chip.className = `fp-token ${resolvePreviewTokenType(t)}`;
      chip.dataset.tokenIndex = String(index);
      
      // 标签文字
      const labelSpan = pD.createElement('span');
      labelSpan.className = 'fp-token-label';
      labelSpan.textContent = t.label || '';
      chip.appendChild(labelSpan);
      
      // 删除按钮
      const del = pD.createElement('span');
      del.className = 'fp-token-del';
      del.innerHTML = '✕';
      del.title = '删除';
      del.onclick = (e) => {
        e.stopPropagation();
        if (!state.pack) return;
        state.pack.uiState.preview.tokens.splice(index, 1);
        syncInputFromPreviewTokens();
        persistPack();
        refreshPreviewPanel();
      };
      chip.appendChild(del);
      chip.addEventListener('pointerdown', (e: PointerEvent) => {
        if (e.button !== 0) return;
        if ((e.target as HTMLElement | null)?.closest('.fp-token-del')) return;
        if (isClickSuppressed()) {
          e.preventDefault();
          return;
        }
        const fromIndex = index;
        const startX = e.clientX;
        const startY = e.clientY;
        let dragging = false;
        let dropIndex = fromIndex;
        let ghost: HTMLElement | null = null;

        const onMove = (ev: PointerEvent) => {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          if (!dragging && Math.hypot(dx, dy) < 6) return;
          if (!dragging) {
            dragging = true;
            suppressNextClick(260);
            previewEl.classList.add('is-dragging-preview');
            chip.classList.add('fp-token-dragging');
            chip.style.pointerEvents = 'none';
            const indicator = ensureInsertIndicator();
            previewEl.insertBefore(indicator, chip.nextSibling);
            ghost = createDragGhost(chip);
          }

          if (ghost) {
            ghost.style.left = `${Math.round(ev.clientX + 12)}px`;
            ghost.style.top = `${Math.round(ev.clientY + 12)}px`;
          }

          const indicator = ensureInsertIndicator();
          const otherChips = Array.from(previewEl.querySelectorAll('.fp-token'))
            .filter((el) => el !== chip) as HTMLElement[];
          dropIndex = otherChips.length;
          for (let i = 0; i < otherChips.length; i++) {
            const rect = otherChips[i].getBoundingClientRect();
            if (ev.clientX < rect.left + rect.width / 2) {
              dropIndex = i;
              break;
            }
          }
          if (dropIndex >= otherChips.length) previewEl.appendChild(indicator);
          else previewEl.insertBefore(indicator, otherChips[dropIndex]);
          ev.preventDefault();
        };

        const onUp = () => {
          pW.removeEventListener('pointermove', onMove as EventListener);
          pW.removeEventListener('pointerup', onUp as EventListener);
          pW.removeEventListener('pointercancel', onUp as EventListener);
          if (ghost) ghost.remove();
          chip.style.pointerEvents = '';
          chip.classList.remove('fp-token-dragging');
          previewEl.classList.remove('is-dragging-preview');
          clearDropMarkers();
          clearInsertIndicator();

          if (!dragging || !state.pack) return;
          let toIndex = dropIndex;
          if (toIndex > fromIndex) toIndex -= 1;
          if (toIndex === fromIndex) return;
          const arr = state.pack.uiState.preview.tokens;
          const [moved] = arr.splice(fromIndex, 1);
          arr.splice(toIndex, 0, moved);
          syncInputFromPreviewTokens();
          persistPack();
          refreshPreviewPanel();
        };

        pW.addEventListener('pointermove', onMove as EventListener, { passive: false });
        pW.addEventListener('pointerup', onUp as EventListener, { passive: false });
        pW.addEventListener('pointercancel', onUp as EventListener, { passive: false });
      });
      
      previewEl.appendChild(chip);
    });
  }

  function openContextMenu(x: number, y: number, item: Item): void {
    closeContextMenu();
    const menu = pD.createElement('div');
    menu.className = 'fp-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.innerHTML = `
      <button class="fp-menu-btn" data-act="edit">编辑</button>
      <button class="fp-menu-btn" data-act="move">移动到...</button>
      <button class="fp-menu-btn" data-act="favorite">${item.favorite ? '取消收藏' : '收藏'}</button>
      <button class="fp-menu-btn" data-act="copy">复制执行内容</button>
      <button class="fp-menu-btn" data-act="delete">删除</button>
    `;
    menu.onclick = async (e) => {
      const btn = (e.target as HTMLElement).closest('[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      if (act === 'edit') openEditItemModal(item);
      if (act === 'favorite') {
        item.favorite = !item.favorite;
        persistPack();
        renderWorkbench();
      }
      if (act === 'copy') {
        try {
          await navigator.clipboard.writeText(item.content || '');
          toast('已复制执行内容');
        } catch (err) {
          toast('复制失败');
        }
      }
      if (act === 'delete') {
        if (confirm(`确认删除条目「${item.name}」吗？`)) {
          if (state.pack) {
            state.pack.items = state.pack.items.filter((i) => i.id !== item.id);
            persistPack();
            renderWorkbench();
            toast('条目已删除');
          }
        }
      }
      if (act === 'move') {
        showModal((close) => {
          const card = pD.createElement('div');
          card.className = 'fp-modal-card';
          card.innerHTML = `
            <div class="fp-modal-title">移动条目：${item.name}</div>
            <div class="fp-row fp-row-block"><label>目标分类</label>
              <div class="fp-cat-field">
                <div data-target-picker></div>
                <input type="hidden" data-target />
              </div>
            </div>
            <div class="fp-actions"><button data-close>取消</button><button class="primary" data-ok>移动</button></div>
          `;
          mountCategorySearchableSelect(card, {
            pickerSelector: '[data-target-picker]',
            valueSelector: '[data-target]',
            selectedId: item.categoryId || null,
            placeholder: '选择目标分类',
            searchPlaceholder: '搜索分类（支持模糊匹配）...',
          });
          (card.querySelector('[data-close]') as HTMLElement | null)!.onclick = close;
          (card.querySelector('[data-ok]') as HTMLElement | null)!.onclick = () => {
            moveItemToCategory(item.id, (card.querySelector('[data-target]') as HTMLInputElement | null)?.value || '');
            renderWorkbench();
            toast('条目已移动');
            close();
          };
          return card;
        });
      }
      closeContextMenu();
    };

    const menuHost = pD.getElementById(OVERLAY_ID) || pD.body;
    menuHost.appendChild(menu);
    state.contextMenu = menu;

    const rect = menu.getBoundingClientRect();
    const vp = getViewportSize();
    if (rect.right > vp.width - 6) menu.style.left = `${vp.width - rect.width - 8}px`;
    if (rect.bottom > vp.height - 6) menu.style.top = `${vp.height - rect.height - 8}px`;
  }

  function renderMain(mainScroll: HTMLElement): void {
    mainScroll.innerHTML = '';
    const groups = groupedItemsForMain();
    const onQuickAdd = (e: Event) => {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest('[data-quick-add-cat]') as HTMLElement | null;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const catId = btn.getAttribute('data-quick-add-cat');
      openEditItemModal(null, catId || null);
    };
    mainScroll.onclick = onQuickAdd;

    if (!groups.length || groups.every((g) => !g.items.length)) {
      const empty = pD.createElement('div');
      empty.style.cssText = 'padding:20px;color:#8fb2a7;font-size:13px';
      empty.textContent = '当前分类暂无条目，可点击“新增条目”创建。';
      mainScroll.appendChild(empty);
      return;
    }

    for (const g of groups) {
      if (!g.items.length) continue;
      const title = pD.createElement('div');
      title.className = 'fp-group-title';
      title.textContent = g.groupName;
      mainScroll.appendChild(title);

      const grid = pD.createElement('div');
      grid.className = 'fp-grid';

      for (const item of g.items) {
        const card = pD.createElement('div');
        card.className = 'fp-card';
        card.style.cursor = 'pointer';
        const excerpt = truncateContent(item.content, 80);
        const modeLabel = item.mode === 'inject' ? '注入' : '追加';
        card.innerHTML = `
          <div class="fp-card-icons">
            <span class="fp-mini${item.mode === 'inject' ? ' inject' : ''}">${modeLabel}</span>
            ${item.favorite ? '<span class="fp-fav-badge" title="已收藏"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 13.6 3.3 9.1A2.9 2.9 0 0 1 7.4 5l.6.6.6-.6a2.9 2.9 0 1 1 4.1 4.1L8 13.6Z" fill="currentColor"/></svg></span>' : ''}
          </div>
          <div class="fp-card-title">${item.name}</div>
          ${excerpt ? `<div class="fp-card-excerpt">${excerpt}</div>` : ''}
        `;

        card.onclick = (e) => {
          if (isClickSuppressed()) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          runItemDirect(item);
        };

        card.oncontextmenu = (e) => {
          e.preventDefault();
          openContextMenu(e.clientX, e.clientY, item);
        };

        card.addEventListener('touchstart', (e) => {
          state.longPressTimer = setTimeout(() => {
            const touch = e.touches?.[0];
            if (touch) openContextMenu(touch.clientX, touch.clientY, item);
          }, 520);
        }, { passive: true });
        card.addEventListener('touchend', () => {
          if (state.longPressTimer) clearTimeout(state.longPressTimer);
          state.longPressTimer = null;
        });

        attachPointerCategoryDropDrag(card, { type: 'item', id: item.id });

        grid.appendChild(card);
      }

      const quickAddCard = pD.createElement('button');
      quickAddCard.type = 'button';
      quickAddCard.className = 'fp-card fp-card-add';
      quickAddCard.setAttribute('data-quick-add-cat', g.groupId);
      quickAddCard.setAttribute('aria-label', '快速新增条目');
      quickAddCard.title = `在“${g.groupName}”中新增条目`;
      quickAddCard.innerHTML = iconSvg('add');
      grid.appendChild(quickAddCard);

      mainScroll.appendChild(grid);
    }
  }

  function renderCompactList(container: HTMLElement): void {
    container.innerHTML = '';
    if (!state.pack) return;

    // 搜索框
    const searchWrap = pD.createElement('div');
    searchWrap.className = 'fp-compact-search';
    searchWrap.innerHTML = '<input class="fp-input" placeholder="搜索分类/条目..." />';
    container.appendChild(searchWrap);

    const searchInput = searchWrap.querySelector('input') as HTMLInputElement;
    searchInput.value = state.filter || '';
    searchInput.oninput = () => {
      state.filter = searchInput.value;
      // 只刷新列表内容，不重建整个 workbench
      renderCompactListContent(scrollArea);
    };

    // 当前分类标题
    const header = pD.createElement('div');
    header.className = 'fp-compact-header';
    if (state.currentCategoryId === '__favorites__') {
      header.textContent = '❤ 收藏夹';
    } else {
      const cat = getCategoryById(state.currentCategoryId);
      header.textContent = cat ? cat.name : '全部';
    }
    container.appendChild(header);

    // 滚动区域
    const scrollArea = pD.createElement('div');
    scrollArea.className = 'fp-compact-scroll';
    container.appendChild(scrollArea);

    renderCompactListContent(scrollArea);
  }

  function renderCompactListContent(scrollArea: HTMLElement): void {
    scrollArea.innerHTML = '';
    if (!state.pack) return;

    const keyword = (state.filter || '').trim().toLowerCase();

    // === 收藏夹视图 ===
    if (state.currentCategoryId === '__favorites__') {
      const favs = state.pack.items.filter((i) => i.favorite);
      const filtered = keyword
        ? favs.filter((i) => i.name.toLowerCase().includes(keyword) || (i.content || '').toLowerCase().includes(keyword))
        : favs;

      if (!filtered.length) {
        scrollArea.innerHTML = '<div style="padding:16px;color:#8a7e72;font-size:13px">暂无收藏条目</div>';
        return;
      }

      const btns = pD.createElement('div');
      btns.className = 'fp-compact-btns';
      for (const item of filtered) {
        btns.appendChild(createCompactItemBtn(item));
      }
      scrollArea.appendChild(btns);
      return;
    }

    // === 正常分类视图 ===
    const focus = getCategoryById(state.currentCategoryId) || (state.pack.categories.find((c) => c.parentId === null) || null);
    if (!focus) return;

    const directChildren = treeChildren(focus.id);
    const ownItems = getItemsByCategory(focus.id, false);

    // 过滤
    const filteredChildren = keyword
      ? directChildren.filter((c) => {
          if (c.name.toLowerCase().includes(keyword)) return true;
          const items = getItemsByCategory(c.id, true);
          return items.some((i) => i.name.toLowerCase().includes(keyword) || (i.content || '').toLowerCase().includes(keyword));
        })
      : directChildren;

    const filteredItems = keyword
      ? ownItems.filter((i) => i.name.toLowerCase().includes(keyword) || (i.content || '').toLowerCase().includes(keyword))
      : ownItems;

    // 收藏夹入口（只在根分类显示）
    if (!keyword && focus.parentId === null) {
      const favCount = state.pack.items.filter((i) => i.favorite).length;
      if (favCount > 0) {
        const favBtns = pD.createElement('div');
        favBtns.className = 'fp-compact-btns';
        const favBtn = pD.createElement('button');
        favBtn.className = 'fp-cbtn fp-cbtn-fav';
        favBtn.textContent = `❤ 收藏夹 (${favCount})`;
        favBtn.onclick = () => {
          state.history.push(state.currentCategoryId);
          state.currentCategoryId = '__favorites__';
          renderWorkbench();
        };
        favBtns.appendChild(favBtn);
        scrollArea.appendChild(favBtns);
      }
    }

    // 子分类按钮
    if (filteredChildren.length) {
      const label = pD.createElement('div');
      label.className = 'fp-compact-group-label';
      label.textContent = '📂 分类';
      scrollArea.appendChild(label);

      const catBtns = pD.createElement('div');
      catBtns.className = 'fp-compact-btns';
      for (const child of filteredChildren) {
        const btn = pD.createElement('button');
        btn.className = 'fp-cbtn fp-cbtn-cat';
        const childItemCount = getItemsByCategory(child.id, true).length;
        btn.textContent = `${child.name}${childItemCount ? ' (' + childItemCount + ')' : ''}`;
        btn.onclick = () => {
          state.history.push(state.currentCategoryId);
          state.currentCategoryId = child.id;
          renderWorkbench();
        };
        catBtns.appendChild(btn);
      }
      scrollArea.appendChild(catBtns);
    }

    // 分隔线
    if (filteredChildren.length && filteredItems.length) {
      const sep = pD.createElement('div');
      sep.className = 'fp-compact-sep';
      scrollArea.appendChild(sep);
    }

    // 条目按钮
    if (filteredItems.length) {
      const label = pD.createElement('div');
      label.className = 'fp-compact-group-label';
      label.textContent = '📝 条目';
      scrollArea.appendChild(label);

      const itemBtns = pD.createElement('div');
      itemBtns.className = 'fp-compact-btns';
      for (const item of filteredItems) {
        itemBtns.appendChild(createCompactItemBtn(item));
      }
      scrollArea.appendChild(itemBtns);
    }

    // 如果子分类没有直接条目，也展示子分类内的条目（按子分类分组）
    if (!filteredItems.length && filteredChildren.length) {
      for (const child of filteredChildren) {
        const childItems = getItemsByCategory(child.id, true);
        const filtered2 = keyword
          ? childItems.filter((i) => i.name.toLowerCase().includes(keyword) || (i.content || '').toLowerCase().includes(keyword))
          : childItems;
        if (filtered2.length) {
          const sep2 = pD.createElement('div');
          sep2.className = 'fp-compact-sep';
          scrollArea.appendChild(sep2);

          const label2 = pD.createElement('div');
          label2.className = 'fp-compact-group-label';
          label2.textContent = child.name;
          scrollArea.appendChild(label2);

          const btns2 = pD.createElement('div');
          btns2.className = 'fp-compact-btns';
          for (const item of filtered2) {
            btns2.appendChild(createCompactItemBtn(item));
          }
          scrollArea.appendChild(btns2);
        }
      }
    }

    // 空状态
    if (!filteredChildren.length && !filteredItems.length) {
      scrollArea.innerHTML = '<div style="padding:16px;color:#8a7e72;font-size:13px">当前分类暂无内容</div>';
    }
  }

  function createCompactItemBtn(item: Item): HTMLButtonElement {
    const btn = pD.createElement('button');
    btn.className = `fp-cbtn${item.mode === 'inject' ? ' fp-cbtn-inject' : ''}`;
    
    // 结构化内容：名称 + 截断摘要
    const excerpt = truncateContent(item.content, 40);
    btn.innerHTML = `<span>${item.name}</span>${excerpt ? `<span class="fp-cbtn-excerpt">${excerpt}</span>` : ''}`;
    btn.style.cssText = 'display:inline-flex;flex-direction:column;align-items:flex-start;gap:1px';
    
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      runItemDirect(item);
    };
    btn.oncontextmenu = (e) => {
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, item);
    };
    btn.addEventListener('touchstart', (e) => {
      state.longPressTimer = setTimeout(() => {
        const touch = e.touches?.[0];
        if (touch) openContextMenu(touch.clientX, touch.clientY, item);
      }, 520);
    }, { passive: true });
    btn.addEventListener('touchend', () => {
      if (state.longPressTimer) clearTimeout(state.longPressTimer);
      state.longPressTimer = null;
    });
    return btn;
  }

  function enableResizers(panel: HTMLElement, sidebar: HTMLElement, splitV: HTMLElement, bottom: HTMLElement, splitH: HTMLElement): void {
    const minSide = 220;
    const maxSide = 520;

    splitV.onpointerdown = (e: PointerEvent) => {
      e.preventDefault();
      try { splitV.setPointerCapture(e.pointerId); } catch (err) {}
      const startX = e.clientX;
      const startW = sidebar.getBoundingClientRect().width;
      (pD.body || pD.documentElement).classList.add('fp-drag-active');
      const move = (ev: PointerEvent) => {
        ev.preventDefault();
        const next = Math.min(maxSide, Math.max(minSide, startW + (ev.clientX - startX)));
        sidebar.style.width = `${next}px`;
      };
      const up = (ev: PointerEvent) => {
        pW.removeEventListener('pointermove', move as EventListener);
        pW.removeEventListener('pointerup', up as EventListener);
        pW.removeEventListener('pointercancel', up as EventListener);
        (pD.body || pD.documentElement).classList.remove('fp-drag-active');
        try { splitV.releasePointerCapture(ev.pointerId); } catch (err) {}
        if (state.pack) {
          state.pack.uiState.sidebar.width = Math.round(sidebar.getBoundingClientRect().width);
          persistPack();
        }
      };
      pW.addEventListener('pointermove', move as EventListener, { passive: false });
      pW.addEventListener('pointerup', up as EventListener, { passive: false });
      pW.addEventListener('pointercancel', up as EventListener, { passive: false });
    };

    splitH.onpointerdown = (e: PointerEvent) => {
      e.preventDefault();
      try { splitH.setPointerCapture(e.pointerId); } catch (err) {}
      const startY = e.clientY;
      const startH = bottom.getBoundingClientRect().height;
      const panelH = panel.getBoundingClientRect().height;
      bottom.classList.add('is-resizing');
      (pD.body || pD.documentElement).classList.add('fp-drag-active');
      const move = (ev: PointerEvent) => {
        ev.preventDefault();
        const next = Math.min(panelH * 0.55, Math.max(90, startH - (ev.clientY - startY)));
        bottom.style.height = `${next}px`;
      };
      const up = (ev: PointerEvent) => {
        pW.removeEventListener('pointermove', move as EventListener);
        pW.removeEventListener('pointerup', up as EventListener);
        pW.removeEventListener('pointercancel', up as EventListener);
        bottom.classList.remove('is-resizing');
        (pD.body || pD.documentElement).classList.remove('fp-drag-active');
        try { splitH.releasePointerCapture(ev.pointerId); } catch (err) {}
        if (state.pack) {
          state.pack.uiState.preview.height = Math.round(bottom.getBoundingClientRect().height);
          persistPack();
        }
      };
      pW.addEventListener('pointermove', move as EventListener, { passive: false });
      pW.addEventListener('pointerup', up as EventListener, { passive: false });
      pW.addEventListener('pointercancel', up as EventListener, { passive: false });
    };
  }

  function renderWorkbench() {
    const overlay = pD.getElementById(OVERLAY_ID);
    if (!overlay) return;

    const panel = overlay.querySelector('.fp-panel') as HTMLElement | null;
    if (!panel || !state.pack) return;
    ensurePreviewSyncWithInput();
    panel.innerHTML = '';
    const activeTheme = (state.pack.settings.ui && state.pack.settings.ui.theme) || 'herdi-light';
    panel.setAttribute('data-theme', activeTheme);
    overlay.setAttribute('data-theme', activeTheme);
    applyCustomCSS();

    const vp = getViewportSize();
    const vw = vp.width;
    const vh = vp.height;
    // 仅在真正小屏时启用紧凑模式，桌面端保持左右分栏。
    const compact = vw <= 760 || vh <= 560;
    const maxPanelWidth = Math.max(320, vw - 16);
    const maxPanelHeight = Math.max(360, vh - 16);
    const desktopMinWidth = Math.min(maxPanelWidth, Math.max(760, Math.round(vw * 0.68)));
    const desktopMinHeight = Math.min(maxPanelHeight, Math.max(560, Math.round(vh * 0.72)));
    const fitWidth = Math.min(maxPanelWidth, Math.max(320, Math.round(vw * 0.86)));
    const fitHeight = Math.min(maxPanelHeight, Math.max(360, Math.round(vh * 0.88)));
    let savedWidth = Number(state.pack.uiState.panelSize.width || 980);
    let savedHeight = Number(state.pack.uiState.panelSize.height || 680);

    // 如果历史尺寸过小(例如在小窗口下保存过)，在大屏时自动放大，避免全屏仍显示很小。
    if (!compact) {
      const tooSmallByRatio = savedWidth < vw * 0.65 || savedHeight < vh * 0.65;
      if (tooSmallByRatio) {
        savedWidth = fitWidth;
        savedHeight = fitHeight;
      }
      savedWidth = Math.max(desktopMinWidth, savedWidth);
      savedHeight = Math.max(desktopMinHeight, savedHeight);
    }

    const desiredWidth = compact ? maxPanelWidth : savedWidth;
    const desiredHeight = compact ? maxPanelHeight : savedHeight;
    const nextWidth = Math.min(maxPanelWidth, Math.max(320, desiredWidth));
    const nextHeight = Math.min(maxPanelHeight, Math.max(360, desiredHeight));
    panel.style.width = `${Math.round(nextWidth)}px`;
    panel.style.height = `${Math.round(nextHeight)}px`;
    panel.classList.toggle('fp-compact', compact);
    state.pack.uiState.panelSize.width = Math.round(nextWidth);
    state.pack.uiState.panelSize.height = Math.round(nextHeight);

    const top = pD.createElement('div');
    top.className = 'fp-top';

    const connectors = state.pack.settings.connectors || [];
    const prefixModeEnabled = !!state.pack.settings.defaults.connectorPrefixMode;
    const selectedPrefixId = state.pack.settings.defaults.connectorPrefixId || connectors[0]?.id || null;
    const connectorBtnsHtml = connectors.map((c, i) => {
      const baseIconName = i === 0 ? 'then' : (i === 1 ? 'simul' : 'add');
      const checked = prefixModeEnabled && c.id === selectedPrefixId;
      const iconName = checked ? 'check' : baseIconName;
      return `<button class="fp-btn fp-conn-${c.color} fp-conn-btn ${checked ? 'is-selected' : ''}" data-conn-${i} title="${c.label}">${iconSvg(iconName)}${c.label}</button>`;
    }).join('');
    const connectorModeSwitchHtml = `
      <button type="button" class="fp-connector-switch ${prefixModeEnabled ? 'is-on' : ''}" data-conn-mode-toggle title="连接模式" aria-pressed="${prefixModeEnabled ? 'true' : 'false'}">
        <span class="fp-switch-track">
          <span class="fp-switch-label-off">直</span>
          <span class="fp-switch-label-on">连</span>
          <span class="fp-switch-thumb"></span>
        </span>
      </button>
    `;
    const customConnectorBtnHtml = `<button class="fp-btn fp-quick-custom-btn" data-conn-custom title="快速添加自定义">${iconSvg('custom')}自定义</button>`;

    if (compact) {
      top.innerHTML = `
          <div class="fp-left">
            ${renderTopButton({ data: 'back', icon: 'back', label: '返回' })}
            <div class="fp-quick-actions">
              ${connectorBtnsHtml}
              ${connectorModeSwitchHtml}
              ${customConnectorBtnHtml}
            </div>
          </div>
        <div class="fp-right">
          ${renderTopButton({ data: 'more-menu', icon: 'more-v', iconOnly: true, title: '更多操作' })}
          ${renderTopButton({ data: 'settings', icon: 'settings', iconOnly: true, title: '设置' })}
          ${renderTopButton({ data: 'close', icon: 'close', iconOnly: true, title: '关闭' })}
        </div>
      `;
    } else {
      top.innerHTML = `
          <div class="fp-left">
            ${renderTopButton({ data: 'back', icon: 'back', label: '返回' })}
            <div class="fp-quick-actions">
              ${connectorBtnsHtml}
              ${connectorModeSwitchHtml}
              ${customConnectorBtnHtml}
            </div>
          </div>
        <div class="fp-right">
          ${renderTopButton({ data: 'new-cat', icon: 'folder', label: '新分类' })}
          ${renderTopButton({ data: 'new-item', icon: 'add', label: '新增条目' })}
          ${renderTopButton({ data: 'export', icon: 'download', iconOnly: true, title: '导出' })}
          ${renderTopButton({ data: 'import', icon: 'upload', iconOnly: true, title: '导入' })}
          ${renderTopButton({ data: 'settings', icon: 'settings', iconOnly: true, title: '设置' })}
          ${renderTopButton({ data: 'close', icon: 'close', iconOnly: true, title: '关闭' })}
        </div>
      `;
    }

    const path = pD.createElement('div');
    path.className = 'fp-path';

    const body = pD.createElement('div');
    body.className = 'fp-body';

    // 用于存储非 compact 模式下的元素引用
    let bottomHead: HTMLElement | null = null;
    let previewExpanded = false;

    if (compact) {
      // ===== 紧凑按钮列表模式 =====
      const compactList = pD.createElement('div');
      compactList.className = 'fp-compact-list';
      body.appendChild(compactList);

      panel.appendChild(top);
      panel.appendChild(path);
      panel.appendChild(body);

      // 紧凑模式预览区
      const compactBottom = pD.createElement('div');
      compactBottom.className = 'fp-bottom fp-compact-bottom';
      previewExpanded = state.pack.uiState.preview.expanded !== false;
      if (!previewExpanded) compactBottom.classList.add('collapsed');

      const compactBottomHead = pD.createElement('div');
      compactBottomHead.className = 'fp-bottom-head';
      compactBottomHead.innerHTML = '<span>预览令牌流</span><div class="fp-bottom-actions"><button class="fp-btn fp-preview-btn" data-clear-preview title="清空预览令牌流">清空</button><button class="fp-btn fp-preview-btn icon-only" data-toggle-preview title="收起/展开">' + iconSvg(previewExpanded ? 'chevron-down' : 'chevron-up') + '</button></div>';

      const compactPreview = pD.createElement('div');
      compactPreview.className = 'fp-preview';

      compactBottom.appendChild(compactBottomHead);
      compactBottom.appendChild(compactPreview);
      panel.appendChild(compactBottom);

      renderPath(path);
      renderCompactList(compactList);
      renderPreview(compactPreview);

      // 紧凑模式的 toggleBtn 事件
      const compactToggleBtn = compactBottomHead.querySelector('[data-toggle-preview]') as HTMLElement | null;
      if (compactToggleBtn) {
        compactToggleBtn.onclick = () => {
          if (!state.pack) return;
          state.pack.uiState.preview.expanded = !(state.pack.uiState.preview.expanded !== false);
          persistPack();
          renderWorkbench();
        };
      }
      const compactClearBtn = compactBottomHead.querySelector('[data-clear-preview]') as HTMLElement | null;
      if (compactClearBtn) {
        compactClearBtn.onclick = () => clearPreviewTokens();
      }
    } else {
      // ===== 原有桌面分栏模式 =====
      const sidebar = pD.createElement('div');
      sidebar.className = 'fp-sidebar';
      sidebar.style.width = `${state.pack.uiState.sidebar.width || 280}px`;

      const sideHead = pD.createElement('div');
      sideHead.className = 'fp-side-head';
      const expandedMap = state.pack.uiState.sidebar.expanded || {};
      const allExpanded = state.pack.categories.length > 0 && state.pack.categories.every((c) => expandedMap[c.id] !== false);
      const treeToggleTitle = allExpanded ? '全部折叠' : '全部展开';
      const treeToggleIcon = allExpanded ? 'collapse-all' : 'expand-all';
      sideHead.innerHTML = '<div class="fp-side-search"><input class="fp-input fp-side-search-input" placeholder="筛选分类/条目" /><div class="fp-tree-tools"><button class="fp-tree-tool-btn" data-tree-toggle title="' + treeToggleTitle + '">' + iconSvg(treeToggleIcon) + '</button></div></div>';

      const tree = pD.createElement('div');
      tree.className = 'fp-tree';
      const sideFoot = pD.createElement('div');
      sideFoot.className = 'fp-sidebar-foot';
      const ver = String(state.pack.meta?.version || DATA_VERSION);
      sideFoot.innerHTML = `<span class="name">快速回复管理器</span><span class="ver">· v${ver}</span>`;

      sidebar.appendChild(sideHead);
      sidebar.appendChild(tree);
      sidebar.appendChild(sideFoot);

      const splitV = pD.createElement('div');
      splitV.className = 'fp-split-v';

      const main = pD.createElement('div');
      main.className = 'fp-main';

      const mainScroll = pD.createElement('div');
      mainScroll.className = 'fp-main-scroll';

      const splitH = pD.createElement('div');
      splitH.className = 'fp-split-h';

      const bottom = pD.createElement('div');
      bottom.className = 'fp-bottom';
      bottom.style.height = `${state.pack.uiState.preview.height || 140}px`;
      previewExpanded = state.pack.uiState.preview.expanded !== false;
      if (!previewExpanded) {
        bottom.classList.add('collapsed');
        splitH.style.display = 'none';
      }

      bottomHead = pD.createElement('div');
      bottomHead.className = 'fp-bottom-head';
      bottomHead.innerHTML = '<span>预览令牌流</span><div class="fp-bottom-actions"><button class="fp-btn fp-preview-btn" data-clear-preview title="清空预览令牌流">清空</button><button class="fp-btn fp-preview-btn icon-only" data-toggle-preview title="收起/展开">' + iconSvg(previewExpanded ? 'chevron-down' : 'chevron-up') + '</button></div>';

      const preview = pD.createElement('div');
      preview.className = 'fp-preview';

      bottom.appendChild(bottomHead);
      bottom.appendChild(preview);

      main.appendChild(mainScroll);
      main.appendChild(splitH);
      main.appendChild(bottom);

      body.appendChild(sidebar);
      body.appendChild(splitV);
      body.appendChild(main);

      panel.appendChild(top);
      panel.appendChild(path);
      panel.appendChild(body);

      renderPath(path);
      renderTree(tree, renderWorkbench);
      renderMain(mainScroll);
      renderPreview(preview);
      enableResizers(panel, sidebar, splitV, bottom, splitH);

      const searchInput = sideHead.querySelector('input') as HTMLInputElement | null;
      if (searchInput) {
        searchInput.value = state.filter;
        searchInput.oninput = () => {
          state.filter = searchInput.value;
          renderWorkbench();
        };
      }
      const treeToggleBtn = sideHead.querySelector('[data-tree-toggle]') as HTMLElement | null;
      if (treeToggleBtn) {
        treeToggleBtn.onclick = () => {
          if (!state.pack) return;
          const expanded = state.pack.uiState.sidebar.expanded || {};
          const shouldCollapseAll = state.pack.categories.length > 0 && state.pack.categories.every((c) => expanded[c.id] !== false);
          for (const c of state.pack.categories) expanded[c.id] = !shouldCollapseAll;
          state.pack.uiState.sidebar.expanded = expanded;
          persistPack();
          renderWorkbench();
        };
      }
    }

    // === 顶栏事件绑定（compact 和非 compact 都需要）===
    const backBtn = top.querySelector('[data-back]') as HTMLElement | null;
    if (backBtn) {
      backBtn.onclick = () => {
        if (state.currentCategoryId === '__favorites__') {
          const firstRoot = state.pack?.categories
            .filter((c) => c.parentId === null)
            .sort((a, b) => a.order - b.order)[0];
          if (firstRoot) {
            state.currentCategoryId = firstRoot.id;
            renderWorkbench();
          }
          return;
        }
        const p = getPath(state.currentCategoryId);
        if (p.length > 1) {
          state.currentCategoryId = p[p.length - 2].id;
          renderWorkbench();
        }
      };
    }
    connectors.forEach((conn, i) => {
      const el = top.querySelector(`[data-conn-${i}]`) as HTMLElement | null;
      if (!el) return;
      el.onclick = () => {
        if (!state.pack) return;
        if (!state.pack.settings.defaults.connectorPrefixMode) {
          addConnector(conn);
          return;
        }
        state.pack.settings.defaults.connectorPrefixId = conn.id;
        persistPack();
        renderWorkbench();
      };
    });
    const connModeToggle = top.querySelector('[data-conn-mode-toggle]') as HTMLElement | null;
    if (connModeToggle) {
      connModeToggle.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!state.pack) return;
        const next = !state.pack.settings.defaults.connectorPrefixMode;
        state.pack.settings.defaults.connectorPrefixMode = next;
        if (next) {
          const connectorsNow = state.pack.settings.connectors || [];
          if (connectorsNow.length && !connectorsNow.find((c) => c.id === state.pack!.settings.defaults.connectorPrefixId)) {
            state.pack.settings.defaults.connectorPrefixId = connectorsNow[0].id;
          }
        }
        persistPack();
        renderWorkbench();
      };
    }
    const connCustomBtn = top.querySelector('[data-conn-custom]') as HTMLElement | null;
    if (connCustomBtn) connCustomBtn.onclick = () => openCustomConnectorActionModal();
    const settingsBtn = top.querySelector('[data-settings]') as HTMLElement | null;
    if (settingsBtn) settingsBtn.onclick = () => {
      try {
        openSettingsModal();
      } catch (e) {
        const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        pushDebugLog('打开设置失败', msg);
        toast(`打开设置失败: ${msg}`);
      }
    };
    // import/export 按钮只在非 compact 模式下存在
    const importBtn = top.querySelector('[data-import]') as HTMLElement | null;
    if (importBtn) importBtn.onclick = openImportModal;
    const exportBtn = top.querySelector('[data-export]') as HTMLElement | null;
    if (exportBtn) exportBtn.onclick = openExportModal;
    const closeBtn = top.querySelector('[data-close]') as HTMLElement | null;
    if (closeBtn) closeBtn.onclick = closeWorkbench;

    // 新增条目/新分类按钮（仅非 compact 模式下存在）
    const newItemBtn = top.querySelector('[data-new-item]') as HTMLElement | null;
    if (newItemBtn) newItemBtn.onclick = () => openEditItemModal(null);
    const newCatBtn = top.querySelector('[data-new-cat]') as HTMLElement | null;
    if (newCatBtn) {
      newCatBtn.onclick = () => {
        const name = prompt('新分类名称');
        if (!name) return;
        const parent = state.currentCategoryId === '__favorites__'
          ? state.pack?.categories.find((c) => c.parentId === null)?.id || null
          : state.currentCategoryId;
        if (!state.pack) return;
        state.pack.categories.push({
          id: uid('cat'),
          name: name.trim(),
          parentId: parent,
          order: treeChildren(parent).length,
          collapsed: false,
        });
        persistPack();
        renderWorkbench();
        toast('分类已创建');
      };
    }

    // 三点菜单按钮（仅 compact 模式下存在）
    const moreMenuBtn = top.querySelector('[data-more-menu]') as HTMLElement | null;
    if (moreMenuBtn) {
      moreMenuBtn.onclick = (e) => {
        e.stopPropagation();
        closeContextMenu();
        const rect = moreMenuBtn.getBoundingClientRect();
        const menu = pD.createElement('div');
        menu.className = 'fp-menu';
        menu.style.left = `${rect.left}px`;
        menu.style.top = `${rect.bottom + 4}px`;

        const catBtn = pD.createElement('button');
        catBtn.className = 'fp-menu-btn';
        catBtn.innerHTML = iconSvg('folder') + ' 新分类';
        catBtn.onclick = () => {
          closeContextMenu();
          const name = prompt('新分类名称');
          if (!name) return;
          const parent = state.currentCategoryId === '__favorites__'
            ? state.pack?.categories.find((c) => c.parentId === null)?.id || null
            : state.currentCategoryId;
          if (!state.pack) return;
          state.pack.categories.push({
            id: uid('cat'),
            name: name.trim(),
            parentId: parent,
            order: treeChildren(parent).length,
            collapsed: false,
          });
          persistPack();
          renderWorkbench();
          toast('分类已创建');
        };
        menu.appendChild(catBtn);

        const itemBtn = pD.createElement('button');
        itemBtn.className = 'fp-menu-btn';
        itemBtn.innerHTML = iconSvg('add') + ' 新增条目';
        itemBtn.onclick = () => {
          closeContextMenu();
          openEditItemModal(null);
        };
        menu.appendChild(itemBtn);

        const menuHost = pD.getElementById(OVERLAY_ID) || pD.body;
        menuHost.appendChild(menu);
        state.contextMenu = menu;

        // 边界修正
        const menuRect = menu.getBoundingClientRect();
        const vp = getViewportSize();
        if (menuRect.right > vp.width - 6) menu.style.left = `${vp.width - menuRect.width - 8}px`;
        if (menuRect.bottom > vp.height - 6) menu.style.top = `${vp.height - menuRect.height - 8}px`;
      };
    }

    // toggleBtn 只在非 compact 模式下存在
    if (bottomHead) {
      const toggleBtn = bottomHead.querySelector('[data-toggle-preview]') as HTMLElement | null;
      if (toggleBtn) {
        toggleBtn.innerHTML = iconSvg(previewExpanded ? 'chevron-down' : 'chevron-up');
        toggleBtn.onclick = () => {
          if (!state.pack) return;
          state.pack.uiState.preview.expanded = !(state.pack.uiState.preview.expanded !== false);
          persistPack();
          renderWorkbench();
        };
      }
      const clearBtn = bottomHead.querySelector('[data-clear-preview]') as HTMLElement | null;
      if (clearBtn) {
        clearBtn.onclick = () => clearPreviewTokens();
      }
    }
  }

  function closeWorkbench() {
    closeContextMenu();
    detachHostResize();
    detachInputSyncListener();
    const overlay = pD.getElementById(OVERLAY_ID);
    if (overlay) overlay.remove();
  }

  function openWorkbench() {
    syncActiveCharacterMapping({ silent: true });
    closeWorkbench();
    ensureStyle();
    applyCustomCSS();

    const overlay = pD.createElement('div');
    overlay.id = OVERLAY_ID;

    const panel = pD.createElement('div');
    panel.className = 'fp-panel';

    overlay.onclick = (e) => {
      if (e.target === overlay) closeWorkbench();
    };

    pD.body.appendChild(overlay);
    overlay.appendChild(panel);

    // 小窗口兼容性修复：检测 overlay 的实际渲染尺寸
    // 如果 position:fixed 被父容器的 transform/filter/contain 等属性约束，
    // 则 getBoundingClientRect 的尺寸会明显小于预期视口尺寸
    requestAnimationFrame(() => {
      try {
        const rect = overlay.getBoundingClientRect();
        const expectedW = pW.innerWidth || window.innerWidth || 320;
        const expectedH = pW.innerHeight || window.innerHeight || 360;
        const actualW = rect.width;
        const actualH = rect.height;
        // 如果实际尺寸明显小于预期（低于 50% 或小于 200px），说明 fixed 定位被约束
        const isConstrained = actualW < Math.min(200, expectedW * 0.5) || actualH < Math.min(200, expectedH * 0.5);
        if (isConstrained) {
          // 尝试方案1：挂载到 window.top.document.body
          let remounted = false;
          try {
            if (window.top && window.top.document && window.top.document.body && window.top !== pW) {
              const topBody = window.top.document.body;
              // 移除旧位置的 overlay
              overlay.remove();
              // 挂载到顶层
              topBody.appendChild(overlay);
              remounted = true;
            }
          } catch (e) {
            // 跨域访问失败，忽略
          }
          // 如果无法挂载到顶层，使用 absolute 定位 + 动态尺寸
          if (!remounted) {
            overlay.style.position = 'absolute';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = `${expectedW}px`;
            overlay.style.height = `${expectedH}px`;
            overlay.style.inset = 'auto';
          }
        }
      } catch (e) {
        // 兼容性保护，忽略错误
      }
    });

    applyFitPanelSize();
    persistPack();
    attachHostResize();
    attachInputSyncListener();
    renderWorkbench();
  }

  function attachGlobalDebugHooks(): void {
    if (state.debugHooksBound) return;
    state.debugHooksBound = true;
    try {
      pW.addEventListener('error', (ev) => {
        const e = ev as ErrorEvent;
        logError('全局异常', {
          message: String(e.message || ''),
          source: String(e.filename || ''),
          line: Number(e.lineno || 0),
          column: Number(e.colno || 0),
        });
      });
      pW.addEventListener('unhandledrejection', (ev) => {
        const e = ev as PromiseRejectionEvent;
        logError('未处理Promise拒绝', e.reason);
      });
    } catch (e) {}
  }

  function bootstrap() {
    attachGlobalDebugHooks();
    state.pack = loadPack();
    loadQrLlmSecretConfig();
    syncActiveCharacterMapping({ silent: true, force: true });

    const roots = state.pack.categories.filter((c) => c.parentId === null).sort((a, b) => a.order - b.order);
    if (!state.currentCategoryId) {
      const remembered = state.pack.uiState.lastPath?.slice(-1)?.[0];
      state.currentCategoryId = remembered && getCategoryById(remembered) ? remembered : (roots[0]?.id || null);
    }

    try {
      if (typeof appendInexistentScriptButtons === 'function') {
        appendInexistentScriptButtons([{ name: BUTTON_LABEL, visible: true }]);
      } else if (typeof updateScriptButtonsWith === 'function') {
        updateScriptButtonsWith((buttons) => {
          const list = Array.isArray(buttons) ? buttons.slice() : [];
          if (!list.find((b) => b && b.name === BUTTON_LABEL)) {
            list.push({ name: BUTTON_LABEL, visible: true });
          }
          return list;
        });
      } else if (typeof replaceScriptButtons === 'function' && typeof getScriptButtons === 'function') {
        const list = getScriptButtons() || [];
        if (!list.find((b) => b && b.name === BUTTON_LABEL)) {
          replaceScriptButtons([...list, { name: BUTTON_LABEL, visible: true }]);
        }
      }
    } catch (e) {
      console.error('[快速回复管理器] 按钮注册失败', e);
      logError('按钮注册失败', String(e));
    }

    try {
      const ev = getButtonEvent(BUTTON_LABEL);
      eventOn(ev, openWorkbench);
    } catch (e) {
      console.error('[快速回复管理器] 事件监听失败', e);
      logError('事件监听失败', String(e));
    }
    try {
      eventOn(tavern_events.CHAT_CHANGED, () => {
        const prevKey = state.activeCharacterSwitchKey;
        syncActiveCharacterMapping();
        if (prevKey !== state.activeCharacterSwitchKey) persistPack();
      });
      eventOn(tavern_events.CHARACTER_PAGE_LOADED, () => {
        const prevKey = state.activeCharacterSwitchKey;
        syncActiveCharacterMapping();
        if (prevKey !== state.activeCharacterSwitchKey) persistPack();
      });
    } catch (e) {}

    pD.addEventListener('click', (e) => {
      if (state.contextMenu && !(e.target as HTMLElement).closest('.fp-menu')) closeContextMenu();
    });

    console.log('[快速回复管理器] 已加载');
    logInfo('脚本已加载');
  }

  bootstrap();
})();
