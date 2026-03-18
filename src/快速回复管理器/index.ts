(() => {
  'use strict';

  const SCRIPT_LABEL = '💌快速回复管理器';
  const BUTTON_LABEL = '💌快速回复管理器';
  const STORE_KEY = 'fastPlotQRPack';
  const STYLE_ID = 'fast-plot-workbench-style-v1';
  const OVERLAY_ID = 'fast-plot-workbench-overlay';
  const TOAST_CONTAINER_ID = 'fast-plot-toast-container';
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

  interface Settings {
    placeholders: Record<string, string>;
    tokens: { simultaneous: string; then: string };
    connectors: ConnectorButton[];
    toast: { maxStack: number; timeout: number };
    defaults: { mode: 'append' | 'inject'; previewExpanded: boolean };
    ui: { theme: string; customCSS: string };
  }

  interface UiState {
    sidebar: { expanded: Record<string, boolean>; width: number; collapsed: boolean };
    preview: { expanded: boolean; height: number; tokens: Array<{ id: string; type: string; label: string }> };
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
    dragData: DragData | null;
    hostResizeHandler: (() => void) | null;
    resizeRaf: number | null;
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
    dragData: null,
    hostResizeHandler: null,
    resizeRaf: null,
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
    };
    safe.settings!.ui = safe.settings!.ui || { theme: 'herdi-light', customCSS: '' };
    if (!('customCSS' in safe.settings!.ui)) (safe.settings!.ui as any).customCSS = '';

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
        },
        ui: {
          theme: 'herdi-light',
        },
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
.fp-panel{position:relative;display:flex;flex-direction:column;border-radius:20px;overflow:hidden;border:1px solid var(--qr-border-1);background:var(--qr-bg-1);box-shadow:0 28px 70px var(--qr-shadow);color:var(--qr-text-1);font-family:'Manrope','Noto Sans SC','Segoe UI',sans-serif;flex-shrink:0;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);margin:8px auto;transition:background .3s ease,color .3s ease}
.fp-panel *{scrollbar-color:var(--qr-scrollbar) transparent}
.fp-panel ::-webkit-scrollbar-thumb{background:var(--qr-scrollbar)}
.fp-panel ::-webkit-scrollbar-thumb:hover{background:var(--qr-scrollbar-hover)}
.fp-top{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;padding:10px 12px;border-bottom:1px solid var(--qr-topbar-border);background:var(--qr-topbar-bg);column-gap:10px}
.fp-left,.fp-right{display:flex;align-items:center;gap:8px}
.fp-right{justify-content:flex-end;min-width:0;overflow:auto}
.fp-left{min-width:0;overflow:auto}
.fp-btn{border:1px solid var(--qr-btn-border);background:var(--qr-btn-bg);color:var(--qr-text-1);border-radius:999px;padding:7px 13px;min-height:var(--qr-btn-h-md);cursor:pointer;font-size:13px;font-weight:600;white-space:nowrap;line-height:1.2;box-shadow:var(--qr-control-inset-shadow),var(--qr-control-rest-shadow);transform:translateY(0);transition:background .18s ease,border-color .18s ease,box-shadow .2s ease,transform .12s ease,opacity .15s ease}
.fp-btn:hover{background:var(--qr-btn-hover-bg);border-color:var(--qr-btn-hover-border);box-shadow:var(--qr-control-inset-shadow),var(--qr-control-hover-shadow);transform:translateY(var(--qr-control-lift))}
.fp-btn:active{transform:translateY(0) scale(var(--qr-control-press-scale))}
.fp-btn:focus-visible{outline:none;box-shadow:var(--qr-control-inset-shadow),var(--qr-control-focus-shadow)}
.fp-btn:disabled{opacity:.48;cursor:not-allowed;transform:none;box-shadow:var(--qr-control-inset-shadow)}
.fp-btn.primary{background:var(--qr-accent);border-color:var(--qr-accent);color:var(--qr-text-on-accent)}
.fp-btn.icon-only{padding:6px 8px;min-height:var(--qr-btn-h-sm);min-width:var(--qr-btn-h-sm);display:inline-flex;align-items:center;justify-content:center}
.fp-top .fp-btn{min-height:var(--qr-btn-h-sm);padding:6px 11px}
.fp-top .fp-btn.icon-only{padding:6px 8px}
.fp-btn .fp-ico{width:14px;height:14px;display:inline-block;vertical-align:-2px;margin-right:6px}
.fp-btn.icon-only .fp-ico{margin-right:0}
.fp-title{font-weight:800;font-size:14px;letter-spacing:.2px;color:inherit;white-space:nowrap}
.fp-quick-actions{display:flex;align-items:center;gap:7px;margin-left:4px}
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
.fp-side-head{display:flex;gap:8px;padding:10px;border-bottom:1px solid var(--qr-border-2)}
.fp-input{width:100%;padding:8px 12px;border:1px solid var(--qr-btn-border);border-radius:var(--qr-control-radius);min-height:var(--qr-control-min-h);background:var(--qr-bg-input);color:var(--qr-text-1);box-shadow:var(--qr-control-inset-shadow);transition:border-color .16s ease,box-shadow .18s ease,transform .12s ease,background .16s ease}
.fp-input::placeholder{color:var(--qr-placeholder)}
#${OVERLAY_ID} input:not([type="checkbox"]):not([type="radio"]),#${OVERLAY_ID} textarea,#${OVERLAY_ID} select{background:var(--qr-bg-input)!important;color:var(--qr-text-1)!important;border:1px solid var(--qr-btn-border)!important;border-radius:var(--qr-control-radius)!important;min-height:var(--qr-control-min-h)!important;box-shadow:var(--qr-control-inset-shadow)!important;outline:none!important;transition:border-color .16s ease,box-shadow .18s ease,transform .12s ease,background .16s ease}
#${OVERLAY_ID} input:not([type="checkbox"]):not([type="radio"])::placeholder,#${OVERLAY_ID} textarea::placeholder{color:var(--qr-placeholder)!important}
#${OVERLAY_ID} input:not([type="checkbox"]):not([type="radio"]):focus,#${OVERLAY_ID} textarea:focus,#${OVERLAY_ID} select:focus{border-color:var(--qr-accent)!important;background:var(--qr-btn-hover-bg)!important;box-shadow:var(--qr-control-inset-shadow),var(--qr-control-focus-shadow)!important;transform:translateY(var(--qr-control-lift))}
#${OVERLAY_ID} input:-webkit-autofill,#${OVERLAY_ID} input:-webkit-autofill:hover,#${OVERLAY_ID} input:-webkit-autofill:focus,#${OVERLAY_ID} textarea:-webkit-autofill,#${OVERLAY_ID} select:-webkit-autofill{-webkit-text-fill-color:var(--qr-text-1)!important;box-shadow:0 0 0 1000px var(--qr-bg-input) inset!important;transition:background-color 9999s ease-in-out 0s}
.fp-tree{padding:8px;overflow:auto;flex:1}
.fp-tree-node{display:flex;align-items:center;gap:6px;padding:7px 8px;border-radius:10px;cursor:pointer;font-size:13px;color:var(--qr-tree-text);transition:background .15s ease,color .15s ease}
.fp-tree-node:hover{background:var(--qr-bg-hover)}
.fp-tree-node.active{background:var(--qr-tree-active-bg);color:var(--qr-tree-active-text)}
.fp-tree-indent{display:inline-block;width:12px;flex:none}
.fp-main{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--qr-main-bg)}
.fp-main-scroll{flex:1;overflow:auto;padding:14px}
.fp-group-title{font-weight:800;font-size:13px;color:inherit;margin:14px 0 8px}
.fp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.fp-card{position:relative;border:1px solid var(--qr-card-border);border-radius:16px;padding:11px;background:var(--qr-card-bg);cursor:pointer;min-height:72px;box-shadow:0 1px 0 rgba(255,255,255,.03),0 2px 14px var(--qr-card-shadow);transition:transform .16s ease,box-shadow .18s ease,border-color .18s ease,background .16s ease}
.fp-card:hover{border-color:var(--qr-card-border-hover);box-shadow:0 1px 0 rgba(255,255,255,.05),0 6px 22px var(--qr-card-hover-shadow);transform:translateY(0)}
.fp-card-title{font-size:13px;font-weight:700;line-height:1.35;word-break:break-word;padding-right:54px;color:inherit}
.fp-card-icons{position:absolute;right:8px;top:8px;display:flex;gap:6px}
.fp-mini{font-size:11px;padding:2px 6px;border-radius:99px;background:var(--qr-tag-bg);border:1px solid var(--qr-tag-border);color:var(--qr-tag-text);white-space:nowrap}
.fp-mini.inject{background:var(--qr-tag-inject-bg);border-color:var(--qr-tag-inject-border);color:var(--qr-tag-inject-text)}
.fp-fav-badge{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:999px;background:rgba(224,80,112,.14);border:1px solid rgba(224,80,112,.55);color:var(--qr-fav-color);box-shadow:0 2px 8px rgba(224,80,112,.28)}
.fp-fav-badge svg{width:12px;height:12px;display:block}
.fp-bottom{border-top:1px solid var(--qr-topbar-border);background:var(--qr-bottom-bg);display:flex;flex-direction:column;transition:height .25s ease}
.fp-bottom.collapsed{height:auto!important}
.fp-bottom.collapsed .fp-preview{display:none}
.fp-bottom-head{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;font-size:12px;color:var(--qr-text-2)}
.fp-preview{overflow:auto;padding:8px 12px;display:flex;flex-wrap:wrap;gap:6px}
.fp-token{font-size:13px;border-radius:999px;padding:5px 12px;border:1px solid transparent;display:inline-flex;align-items:center;gap:4px;cursor:grab;user-select:none;transition:transform .15s ease,opacity .15s ease}
.fp-token:active{cursor:grabbing}
.fp-token .fp-token-del{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:rgba(0,0,0,.12);color:inherit;font-size:10px;line-height:1;cursor:pointer;opacity:.5;transition:opacity .15s ease,background .15s ease}
.fp-token .fp-token-del:hover{opacity:1;background:rgba(200,50,50,.25)}
.fp-token.dragging{opacity:.4;transform:scale(.95)}
.fp-token.drag-over{transform:scale(1.05);box-shadow:0 0 0 2px rgba(100,150,255,.4)}
.fp-token.item{background:var(--qr-token-item-bg);border-color:var(--qr-token-item-border);color:var(--qr-token-item-text)}
.fp-token.then{background:var(--qr-token-then-bg);border-color:var(--qr-token-then-border);color:var(--qr-token-then-text)}
.fp-token.simultaneous{background:var(--qr-token-simul-bg);border-color:var(--qr-token-simul-border);color:var(--qr-token-simul-text)}
.fp-token.raw{background:var(--qr-token-raw-bg);border-color:var(--qr-token-raw-border);color:var(--qr-token-raw-text)}
.fp-split-v{width:5px;cursor:col-resize;background:linear-gradient(180deg,transparent,rgba(24,24,27,.18),transparent)}
.fp-split-h{height:5px;cursor:row-resize;background:linear-gradient(90deg,transparent,rgba(24,24,27,.18),transparent)}
.fp-menu{position:fixed;z-index:2147483600;min-width:148px;padding:6px;background:var(--qr-menu-bg);border:1px solid var(--qr-menu-border);border-radius:10px;box-shadow:0 14px 30px rgba(0,0,0,.18);animation:fp-menu-pop .15s ease}
.fp-menu-btn{display:block;width:100%;text-align:left;padding:8px;border-radius:7px;background:transparent;border:none;color:var(--qr-text-1);cursor:pointer;font-size:12px}
.fp-menu-btn:hover{background:var(--qr-menu-hover)}
#${TOAST_CONTAINER_ID}{position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483700;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;max-width:calc(100vw - 16px)}
.fp-toast{pointer-events:auto;max-width:430px;padding:8px 12px;border-radius:12px;background:var(--qr-toast-bg);border:1px solid var(--qr-toast-border);color:var(--qr-toast-text);font-size:12px;box-shadow:0 8px 20px rgba(0,0,0,.30);animation:fp-toast-in .22s ease}
.fp-modal{position:absolute;inset:0;background:var(--qr-modal-overlay);display:flex;align-items:center;justify-content:center;padding:20px;animation:fp-modal-fadein .2s ease}
.fp-modal-card{width:min(760px,95%);max-height:88vh;overflow:hidden;display:flex;flex-direction:column;border:1px solid var(--qr-menu-border);border-radius:14px;background:var(--qr-modal-bg);padding:14px;color:var(--qr-text-1);animation:fp-modal-card-in .25s ease}
.fp-modal-title{font-weight:800;font-size:15px;margin-bottom:10px}
.fp-settings-shell{display:grid;grid-template-columns:180px minmax(0,1fr);gap:12px;flex:1;min-height:0;overflow:hidden}
.fp-settings-nav{display:flex;flex-direction:column;gap:6px;padding-right:8px;border-right:1px solid var(--qr-card-border)}
.fp-settings-tab{padding:9px 10px;border:1px solid var(--qr-tab-border);border-radius:12px;background:var(--qr-tab-bg);font-size:12px;font-weight:700;cursor:pointer;text-align:left;color:var(--qr-tree-text);box-shadow:var(--qr-control-inset-shadow);transition:border-color .16s ease,background .16s ease,box-shadow .16s ease}
.fp-settings-tab.active{background:var(--qr-tab-active-bg);color:var(--qr-tab-active-text);border-color:var(--qr-tab-active-bg)}
.fp-settings-body{min-width:0;overflow-y:auto;padding-right:4px}
.fp-tab{display:none}
.fp-tab.active{display:block}
.fp-row{display:flex;gap:8px;align-items:center;margin-bottom:8px}
.fp-row > label{width:98px;font-size:12px;color:var(--qr-row-label)}
.fp-row > input,.fp-row > textarea,.fp-row > select{flex:1;padding:8px;border-radius:var(--qr-control-radius);border:1px solid var(--qr-btn-border);background:var(--qr-bg-input);color:var(--qr-text-1)}
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
.fp-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px;flex-shrink:0}
.fp-actions button{padding:8px 14px;border-radius:999px;min-height:var(--qr-btn-h-lg);border:1px solid var(--qr-btn-border);background:var(--qr-bg-3);color:var(--qr-text-1);cursor:pointer;font-weight:600;box-shadow:var(--qr-control-inset-shadow),var(--qr-control-rest-shadow);transition:background .18s ease,border-color .18s ease,box-shadow .2s ease,transform .12s ease}
.fp-actions button:hover{border-color:var(--qr-btn-hover-border);box-shadow:var(--qr-control-inset-shadow),var(--qr-control-hover-shadow);transform:translateY(var(--qr-control-lift))}
.fp-actions button:active{transform:translateY(0) scale(var(--qr-control-press-scale))}
.fp-actions button:focus-visible{outline:none;box-shadow:var(--qr-control-inset-shadow),var(--qr-control-focus-shadow)}
.fp-actions button.primary{background:var(--qr-accent);border-color:var(--qr-accent);color:var(--qr-text-on-accent)}
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
.fp-tab.active{animation:fp-tab-fadein .2s ease}
@media (max-width: 900px){
  .fp-top{grid-template-columns:1fr;gap:8px}
  .fp-left,.fp-right{justify-content:center}
  .fp-grid{grid-template-columns:1fr}
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

  function resolvePlaceholders(text: string): string {
    const placeholders = state.pack?.settings?.placeholders || {};
    return String(text || '').replace(/\{@([^:}]+)(?::([^}]*))?\}/g, (_, key: string, fallback: string) => {
      const v = placeholders[key];
      if (v !== undefined && String(v).length > 0) return String(v);
      return fallback !== undefined ? String(fallback) : '';
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
      close: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 4 8 8M12 4 4 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
      'chevron-up': '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 10.5 8 6.5l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      'chevron-down': '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 5.5 8 9.5l4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
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

  function appendToInput(content: string): void {
    const ta = pD.querySelector('#send_textarea') as HTMLTextAreaElement | null;
    if (!ta) {
      toast('未找到输入框');
      return;
    }
    const raw = String(ta.value || '');
    const next = raw + content;
    ta.value = next;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
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

  function pushPreviewToken(type: string, label: string): void {
    if (!state.pack) return;
    const arr = state.pack.uiState.preview.tokens || [];
    arr.push({ id: uid('tok'), type, label: String(label || '') });
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

  async function runItem(item: Item): Promise<void> {
    const parsed = resolvePlaceholders(item.content || '');
    if (item.mode === 'inject') {
      const ok = await injectContent(parsed, item.name);
      if (ok) {
        pushPreviewToken('item', item.name);
        toast(`已注入: ${item.name}`);
      }
      return;
    }

    appendToInput(`<${parsed}>`);
    pushPreviewToken('item', item.name);
    toast(`已追加: ${item.name}`);
  }

  function addConnector(connector: ConnectorButton): void {
    if (!state.pack) return;
    appendToInput(connector.token);
    pushPreviewToken(connector.label, connector.token);
    toast(`已插入“${connector.label}”`);
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
      node.draggable = true;
      node.dataset.catId = cat.id;
      const kids = treeChildren(cat.id);
      const isOpen = expanded[cat.id] !== false;
      const indent = '<span class="fp-tree-indent"></span>'.repeat(depth);
      node.innerHTML = `${indent}<span>${kids.length ? (isOpen ? '▾' : '▸') : '·'}</span><span>${cat.name}</span>`;

      node.onclick = (e) => {
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

      node.addEventListener('dragstart', (e) => {
        state.dragData = { type: 'category', id: cat.id };
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      node.addEventListener('dragover', (e) => {
        e.preventDefault();
        node.style.outline = '1px dashed rgba(170,220,200,.8)';
      });
      node.addEventListener('dragleave', () => {
        node.style.outline = '';
      });
      node.addEventListener('drop', (e) => {
        e.preventDefault();
        node.style.outline = '';
        if (!state.dragData) return;
        if (state.dragData.type === 'category') {
          moveCategory(state.dragData.id, cat.id);
          renderWorkbench();
        }
        if (state.dragData.type === 'item') {
          moveItemToCategory(state.dragData.id, cat.id);
          renderWorkbench();
          toast('条目已移动到分类');
        }
      });

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

  function showModal(contentFactory: (close: () => void) => HTMLElement): void {
    const overlay = pD.getElementById(OVERLAY_ID);
    if (!overlay) return;
    let container = overlay.querySelector('.fp-modal') as HTMLElement | null;
    if (container) container.remove();
    container = pD.createElement('div');
    container.className = 'fp-modal';
    container.appendChild(contentFactory(() => container!.remove()));
    overlay.appendChild(container);
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
    showModal((close) => {
      const card = pD.createElement('div');
      card.className = 'fp-modal-card';

      const placeholders = state.pack!.settings.placeholders || {};
      const rows = ['用户', '角色', '苦主', '黄毛'];

      const customKeys = Object.keys(placeholders).filter((k) => !rows.includes(k));
      const ui = state.pack!.settings.ui || {};
      const currentTheme = ui.theme || 'herdi-light';
      const toastSettings = state.pack!.settings.toast || { maxStack: 4, timeout: 1800 };

      card.innerHTML = `
        <div class="fp-modal-title">⚙️ 设置中心</div>
        <div class="fp-settings-shell">
          <div class="fp-settings-nav">
            <button class="fp-settings-tab active" data-tab-btn="placeholders">占位符</button>
            <button class="fp-settings-tab" data-tab-btn="tokens">执行与连接符</button>
            <button class="fp-settings-tab" data-tab-btn="themes">主题</button>
            <button class="fp-settings-tab" data-tab-btn="advanced">高级</button>
          </div>
          <div class="fp-settings-body">
            <div class="fp-tab active" data-tab="placeholders">
              ${rows.map((k) => `<div class="fp-row"><label>${k}</label><input data-ph="${k}" value="${String(placeholders[k] || '')}" /></div>`).join('')}
              <div style="border-top:1px solid var(--qr-border-2);margin-top:10px;padding-top:10px">
                <div style="font-size:12px;font-weight:700;color:var(--qr-row-label);margin-bottom:8px">自定义占位符</div>
                <div data-custom-ph-list></div>
                <button class="fp-btn" data-add-ph style="margin-top:6px">+ 添加占位符</button>
              </div>
            </div>
            <div class="fp-tab" data-tab="tokens">
              <div style="font-size:12px;color:var(--qr-text-2);margin-bottom:8px">自定义顶栏连接符按钮，点击后插入对应文本到输入框</div>
              <div data-connectors-list></div>
              <button class="fp-btn" data-add-connector style="margin-top:8px">+ 添加连接符</button>
              <div style="border-top:1px solid var(--qr-border-2);margin-top:12px;padding-top:12px">
                <div class="fp-row"><label>默认执行方式</label>
                  <select data-default-mode>
                    <option value="append" ${state.pack!.settings.defaults.mode === 'append' ? 'selected' : ''}>追加到输入框</option>
                    <option value="inject" ${state.pack!.settings.defaults.mode === 'inject' ? 'selected' : ''}>注入上下文</option>
                  </select>
                </div>
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
            <input data-conn-label="${idx}" value="${conn.label}" placeholder="名称" style="width:80px;padding:6px 8px;border:1px solid rgba(24,24,27,.18);border-radius:8px;font-size:12px" />
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

      // 自定义占位符列表管理
      const localCustomPhs: Array<{key: string; value: string}> = customKeys.map(k => ({ key: k, value: placeholders[k] || '' }));
      const renderCustomPhList = () => {
        const listEl = card.querySelector('[data-custom-ph-list]') as HTMLElement;
        if (!listEl) return;
        listEl.innerHTML = '';
        localCustomPhs.forEach((ph, idx) => {
          const row = pD.createElement('div');
          row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px';
          row.innerHTML = `
            <input data-cph-key="${idx}" value="${ph.key}" placeholder="键名" style="width:100px;padding:6px 8px;border:1px solid rgba(24,24,27,.18);border-radius:8px;font-size:12px" />
            <input data-cph-val="${idx}" value="${ph.value}" placeholder="值" style="flex:1;padding:6px 8px;border:1px solid rgba(24,24,27,.18);border-radius:8px;font-size:12px" />
            <button class="fp-btn icon-only" data-del-cph="${idx}" title="删除" style="padding:4px 8px;font-size:14px;color:#c44">✕</button>
          `;
          listEl.appendChild(row);
          (row.querySelector(`[data-del-cph="${idx}"]`) as HTMLElement).onclick = () => {
            localCustomPhs.splice(idx, 1);
            renderCustomPhList();
          };
        });
      };
      renderCustomPhList();
      (card.querySelector('[data-add-ph]') as HTMLElement).onclick = () => {
        localCustomPhs.push({ key: '', value: '' });
        renderCustomPhList();
      };

      const themeSelect = card.querySelector('[data-theme]') as HTMLSelectElement | null;
      if (themeSelect) {
        themeSelect.onchange = () => {
          const panel = pD.querySelector('.fp-panel') as HTMLElement | null;
          const overlay = pD.getElementById(OVERLAY_ID) as HTMLElement | null;
          if (panel) panel.setAttribute('data-theme', themeSelect.value);
          if (overlay) overlay.setAttribute('data-theme', themeSelect.value);
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

      (card.querySelector('[data-close]') as HTMLElement | null)!.onclick = close;
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
        // 收集占位符（包括预定义和自定义）
        const newPlaceholders: Record<string, string> = {};
        for (const k of rows) {
          const el = card.querySelector(`[data-ph="${k}"]`) as HTMLInputElement | null;
          newPlaceholders[k] = String(el?.value || '').trim() || k;
        }
        // 收集自定义占位符列表
        localCustomPhs.forEach((_ph, idx) => {
          const key = (card.querySelector(`[data-cph-key="${idx}"]`) as HTMLInputElement)?.value.trim();
          const val = (card.querySelector(`[data-cph-val="${idx}"]`) as HTMLInputElement)?.value.trim();
          if (key && !rows.includes(key)) {
            newPlaceholders[key] = val || key;
          }
        });
        state.pack!.settings.placeholders = newPlaceholders;
        persistPack();
        renderWorkbench();
        toast('设置已保存');
        close();
      };
      return card;
    });
  }

  function openEditItemModal(item: Item | null): void {
    if (!state.pack) return;
    showModal((close) => {
      const card = pD.createElement('div');
      card.className = 'fp-modal-card';

      const cats = state.pack!.categories.sort((a, b) => a.order - b.order);

      card.innerHTML = `
        <div class="fp-modal-title">✏️ 编辑条目</div>
        <div class="fp-row"><label>名称</label><input data-name value="${item ? item.name : ''}" /></div>
        <div class="fp-row"><label>执行内容</label><textarea data-content>${item ? item.content : ''}</textarea></div>
        <div class="fp-row"><label>执行方式</label>
          <select data-mode>
            <option value="append" ${(item?.mode || state.pack!.settings.defaults.mode) === 'append' ? 'selected' : ''}>追加到输入框</option>
            <option value="inject" ${(item?.mode || state.pack!.settings.defaults.mode) === 'inject' ? 'selected' : ''}>注入到上下文</option>
          </select>
        </div>
        <div class="fp-row"><label>所属分类</label>
          <select data-cat>${cats.map((c) => `<option value="${c.id}" ${((item?.categoryId || state.currentCategoryId) === c.id) ? 'selected' : ''}>${c.name}</option>`).join('')}</select>
        </div>
        <div class="fp-row"><label>变量快捷</label>
          <select data-ins>
            <option value="">选择并插入...</option>
            ${Object.keys(state.pack!.settings.placeholders).map((k) => `<option value="{@${k}:${state.pack!.settings.placeholders[k]}}">{@${k}}</option>`).join('')}
          </select>
        </div>
        <div class="fp-actions">
          ${item ? '<button data-del>删除</button>' : ''}
          <button data-close>取消</button>
          <button class="primary" data-save>${item ? '保存' : '创建'}</button>
        </div>
      `;

      const contentEl = card.querySelector('[data-content]') as HTMLTextAreaElement | null;
      (card.querySelector('[data-ins]') as HTMLSelectElement | null)!.onchange = (e) => {
        const v = (e.target as HTMLSelectElement).value;
        if (!v) return;
        if (contentEl) contentEl.value += v;
        (e.target as HTMLSelectElement).value = '';
      };

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

      (card.querySelector('[data-close]') as HTMLElement | null)!.onclick = close;
      (card.querySelector('[data-save]') as HTMLElement | null)!.onclick = () => {
        const name = (card.querySelector('[data-name]') as HTMLInputElement | null)?.value.trim();
        const content = (card.querySelector('[data-content]') as HTMLTextAreaElement | null)?.value.trim();
        const mode = (card.querySelector('[data-mode]') as HTMLSelectElement | null)?.value === 'inject' ? 'inject' : 'append';
        const categoryId = (card.querySelector('[data-cat]') as HTMLSelectElement | null)?.value;
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
            <span>导入设置（占位符 / 连接符 / 主题 / 自定义CSS）</span>
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
            applyImport(selectedIncoming, [], includeSettings);
            close();
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
              applyImport(selectedIncoming, conflicts, includeSettings);
              closeConflict();
              close();
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

  function applyImport(incoming: Pack, conflicts: ImportConflict[], includeSettings = false): void {
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

  function renderPreview(previewEl: HTMLElement): void {
    previewEl.innerHTML = '';
    const tokens = state.pack?.uiState?.preview?.tokens || [];
    
    tokens.forEach((t, index) => {
      const chip = pD.createElement('span');
      chip.className = `fp-token ${t.type || 'raw'}`;
      chip.draggable = true;
      chip.dataset.tokenIndex = String(index);
      
      // 标签文字
      const labelSpan = pD.createElement('span');
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
        persistPack();
        refreshPreviewPanel();
      };
      chip.appendChild(del);
      
      // PC 拖拽排序
      chip.addEventListener('dragstart', (e) => {
        chip.classList.add('dragging');
        e.dataTransfer!.effectAllowed = 'move';
        e.dataTransfer!.setData('text/plain', String(index));
      });
      chip.addEventListener('dragend', () => {
        chip.classList.remove('dragging');
      });
      chip.addEventListener('dragover', (e) => {
        e.preventDefault();
        chip.classList.add('drag-over');
      });
      chip.addEventListener('dragleave', () => {
        chip.classList.remove('drag-over');
      });
      chip.addEventListener('drop', (e) => {
        e.preventDefault();
        chip.classList.remove('drag-over');
        const fromIndex = parseInt(e.dataTransfer!.getData('text/plain'), 10);
        const toIndex = index;
        if (isNaN(fromIndex) || fromIndex === toIndex || !state.pack) return;
        const arr = state.pack.uiState.preview.tokens;
        const [moved] = arr.splice(fromIndex, 1);
        arr.splice(toIndex, 0, moved);
        persistPack();
        refreshPreviewPanel();
      });
      
      // 手机端长按拖拽 - 使用 touchstart/touchmove/touchend 模拟
      let touchStartY = 0;
      let touchStartX = 0;
      let touchTimer: ReturnType<typeof setTimeout> | null = null;
      let isDragging = false;
      let dragClone: HTMLElement | null = null;
      
      chip.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        touchTimer = setTimeout(() => {
          isDragging = true;
          chip.classList.add('dragging');
          // 创建拖拽幽灵
          dragClone = chip.cloneNode(true) as HTMLElement;
          dragClone.style.cssText = 'position:fixed;z-index:999999;pointer-events:none;opacity:.8;transform:scale(1.05)';
          dragClone.style.left = `${touch.clientX - 30}px`;
          dragClone.style.top = `${touch.clientY - 15}px`;
          pD.body.appendChild(dragClone);
        }, 400);
      }, { passive: true });
      
      chip.addEventListener('touchmove', (e) => {
        if (!isDragging) {
          // 如果移动超过阈值，取消长按
          const touch = e.touches[0];
          if (Math.abs(touch.clientX - touchStartX) > 10 || Math.abs(touch.clientY - touchStartY) > 10) {
            if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; }
          }
          return;
        }
        e.preventDefault();
        const touch = e.touches[0];
        if (dragClone) {
          dragClone.style.left = `${touch.clientX - 30}px`;
          dragClone.style.top = `${touch.clientY - 15}px`;
        }
      });
      
      chip.addEventListener('touchend', (e) => {
        if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; }
        if (!isDragging) return;
        isDragging = false;
        chip.classList.remove('dragging');
        if (dragClone) { dragClone.remove(); dragClone = null; }
        
        // 查找放置目标
        const touch = e.changedTouches[0];
        const target = pD.elementFromPoint(touch.clientX, touch.clientY);
        const targetChip = target?.closest('.fp-token') as HTMLElement | null;
        if (targetChip && targetChip !== chip && targetChip.dataset.tokenIndex && state.pack) {
          const fromIdx = index;
          const toIdx = parseInt(targetChip.dataset.tokenIndex, 10);
          if (!isNaN(toIdx) && fromIdx !== toIdx) {
            const arr = state.pack.uiState.preview.tokens;
            const [moved] = arr.splice(fromIdx, 1);
            arr.splice(toIdx, 0, moved);
            persistPack();
            refreshPreviewPanel();
          }
        }
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
            <div class="fp-row"><label>目标分类</label>
              <select data-target>${state.pack?.categories.map((c) => `<option value="${c.id}" ${c.id === item.categoryId ? 'selected' : ''}>${c.name}</option>`).join('') || ''}</select>
            </div>
            <div class="fp-actions"><button data-close>取消</button><button class="primary" data-ok>移动</button></div>
          `;
          (card.querySelector('[data-close]') as HTMLElement | null)!.onclick = close;
          (card.querySelector('[data-ok]') as HTMLElement | null)!.onclick = () => {
            moveItemToCategory(item.id, (card.querySelector('[data-target]') as HTMLSelectElement | null)?.value || '');
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

  function showItemSubmenu(item: Item, x: number, y: number): void {
    closeContextMenu();
    if (!state.pack) return;
    const connectors = state.pack.settings.connectors || [];
    
    const menu = pD.createElement('div');
    menu.className = 'fp-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    
    // 直接插入
    const directBtn = pD.createElement('button');
    directBtn.className = 'fp-menu-btn';
    directBtn.textContent = '直接插入';
    directBtn.onclick = () => {
      runItem(item);
      menu.remove();
      state.contextMenu = null;
    };
    menu.appendChild(directBtn);
    
    // 带连接符插入
    for (const conn of connectors) {
      const btn = pD.createElement('button');
      btn.className = 'fp-menu-btn';
      btn.textContent = `${conn.label} + 插入`;
      btn.onclick = () => {
        addConnector(conn);
        runItem(item);
        menu.remove();
        state.contextMenu = null;
      };
      menu.appendChild(btn);
    }
    
    const menuHost = pD.getElementById(OVERLAY_ID) || pD.body;
    menuHost.appendChild(menu);
    state.contextMenu = menu;
    
    // 边界修正
    const rect = menu.getBoundingClientRect();
    const vp = getViewportSize();
    if (rect.right > vp.width - 6) menu.style.left = `${vp.width - rect.width - 8}px`;
    if (rect.bottom > vp.height - 6) menu.style.top = `${vp.height - rect.height - 8}px`;
  }

  function renderMain(mainScroll: HTMLElement): void {
    mainScroll.innerHTML = '';
    const groups = groupedItemsForMain();

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
        card.draggable = true;
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
          e.preventDefault();
          e.stopPropagation();
          if (item.mode === 'inject') {
            runItem(item);
          } else {
            showItemSubmenu(item, e.clientX, e.clientY);
          }
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

        card.addEventListener('dragstart', (e) => {
          state.dragData = { type: 'item', id: item.id };
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        });

        grid.appendChild(card);
      }

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
      if (item.mode === 'inject') {
        runItem(item);
      } else {
        showItemSubmenu(item, e.clientX, e.clientY);
      }
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

    splitV.onmousedown = (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = sidebar.getBoundingClientRect().width;
      const move = (ev: MouseEvent) => {
        const next = Math.min(maxSide, Math.max(minSide, startW + (ev.clientX - startX)));
        sidebar.style.width = `${next}px`;
      };
      const up = () => {
        pD.removeEventListener('mousemove', move);
        pD.removeEventListener('mouseup', up);
        if (state.pack) {
          state.pack.uiState.sidebar.width = Math.round(sidebar.getBoundingClientRect().width);
          persistPack();
        }
      };
      pD.addEventListener('mousemove', move);
      pD.addEventListener('mouseup', up);
    };

    splitH.onmousedown = (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = bottom.getBoundingClientRect().height;
      const panelH = panel.getBoundingClientRect().height;
      const move = (ev: MouseEvent) => {
        const next = Math.min(panelH * 0.55, Math.max(90, startH - (ev.clientY - startY)));
        bottom.style.height = `${next}px`;
      };
      const up = () => {
        pD.removeEventListener('mousemove', move);
        pD.removeEventListener('mouseup', up);
        if (state.pack) {
          state.pack.uiState.preview.height = Math.round(bottom.getBoundingClientRect().height);
          persistPack();
        }
      };
      pD.addEventListener('mousemove', move);
      pD.addEventListener('mouseup', up);
    };
  }

  function renderWorkbench() {
    const overlay = pD.getElementById(OVERLAY_ID);
    if (!overlay) return;

    const panel = overlay.querySelector('.fp-panel') as HTMLElement | null;
    if (!panel || !state.pack) return;
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
    const connectorBtnsHtml = connectors.map((c, i) => 
      renderTopButton({ data: `conn-${i}`, icon: i === 0 ? 'then' : (i === 1 ? 'simul' : 'add'), label: c.label, className: `fp-btn fp-conn-${c.color}` })
    ).join('');

    if (compact) {
      top.innerHTML = `
        <div class="fp-left">
          ${renderTopButton({ data: 'back', icon: 'back', label: '返回' })}
          <div class="fp-quick-actions">
            ${connectorBtnsHtml}
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
          <span class="fp-title">💌 快速回复管理器</span>
          <div class="fp-quick-actions">
            ${connectorBtnsHtml}
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
      compactBottomHead.innerHTML = '<span>预览令牌流</span><button class="fp-btn icon-only" data-toggle-preview title="收起/展开">' + iconSvg(previewExpanded ? 'chevron-down' : 'chevron-up') + '</button>';

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
    } else {
      // ===== 原有桌面分栏模式 =====
      const sidebar = pD.createElement('div');
      sidebar.className = 'fp-sidebar';
      sidebar.style.width = `${state.pack.uiState.sidebar.width || 280}px`;

      const sideHead = pD.createElement('div');
      sideHead.className = 'fp-side-head';
      sideHead.innerHTML = '<input class="fp-input" placeholder="筛选分类/条目" />';

      const tree = pD.createElement('div');
      tree.className = 'fp-tree';

      sidebar.appendChild(sideHead);
      sidebar.appendChild(tree);

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
      bottomHead.innerHTML = '<span>预览令牌流</span><button class="fp-btn icon-only" data-toggle-preview title="收起/展开">' + iconSvg(previewExpanded ? 'chevron-down' : 'chevron-up') + '</button>';

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
      if (el) el.onclick = () => addConnector(conn);
    });
    const settingsBtn = top.querySelector('[data-settings]') as HTMLElement | null;
    if (settingsBtn) settingsBtn.onclick = openSettingsModal;
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
    }
  }

  function closeWorkbench() {
    closeContextMenu();
    detachHostResize();
    const overlay = pD.getElementById(OVERLAY_ID);
    if (overlay) overlay.remove();
  }

  function openWorkbench() {
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
    renderWorkbench();
  }

  function bootstrap() {
    state.pack = loadPack();

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
    }

    try {
      const ev = getButtonEvent(BUTTON_LABEL);
      eventOn(ev, openWorkbench);
    } catch (e) {
      console.error('[快速回复管理器] 事件监听失败', e);
    }

    pD.addEventListener('click', (e) => {
      if (state.contextMenu && !(e.target as HTMLElement).closest('.fp-menu')) closeContextMenu();
    });

    console.log('[快速回复管理器] 已加载');
  }

  bootstrap();
})();
