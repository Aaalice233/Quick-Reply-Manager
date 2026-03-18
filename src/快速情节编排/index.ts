(() => {
  'use strict';

  const SCRIPT_LABEL = '💌快速情节编排';
  const BUTTON_LABEL = '💌快速情节编排';
  const STORE_KEY = 'fastPlotQRPack';
  const STYLE_ID = 'fast-plot-workbench-style-v1';
  const OVERLAY_ID = 'fast-plot-workbench-overlay';
  const TOAST_CONTAINER_ID = 'fast-plot-toast-container';
  const DATA_VERSION = 1;

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

  interface Settings {
    placeholders: Record<string, string>;
    tokens: { simultaneous: string; then: string };
    toast: { maxStack: number; timeout: number };
    defaults: { mode: 'append' | 'inject'; previewExpanded: boolean };
    ui: { theme: string };
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
      console.error('[快速情节编排] 保存失败', e);
    }
  }

  function normalizePack(pack: unknown): Pack {
    const safe = (pack && typeof pack === 'object' ? deepClone(pack as Pack) : {}) as Partial<Pack>;

    safe.meta = safe.meta || {} as PackMeta;
    safe.meta!.version = Number(safe.meta!.version) || DATA_VERSION;
    safe.meta!.createdAt = safe.meta!.createdAt || nowIso();
    safe.meta!.updatedAt = nowIso();
    safe.meta!.source = safe.meta!.source || SCRIPT_LABEL;
    safe.meta!.name = safe.meta!.name || '💌快速情节编排数据';

    safe.categories = Array.isArray(safe.categories) ? safe.categories : [];
    safe.items = Array.isArray(safe.items) ? safe.items : [];

    safe.settings = safe.settings || {} as Settings;
    safe.settings!.placeholders = safe.settings!.placeholders || {
      用户: '用户',
      角色: '角色',
      苦主: '苦主',
      黄毛: '黄毛',
      同时: '同时',
      然后: '然后',
    };
    safe.settings!.tokens = safe.settings!.tokens || {
      simultaneous: '<同时>',
      then: '<然后>',
    };
    safe.settings!.toast = safe.settings!.toast || {
      maxStack: 4,
      timeout: 1800,
    };
    safe.settings!.defaults = safe.settings!.defaults || {
      mode: 'append',
      previewExpanded: true,
    };
    safe.settings!.ui = safe.settings!.ui || {
      theme: 'herdi-light',
    };

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
        name: '💌快速情节编排数据',
      },
      categories,
      items,
      settings: {
        placeholders: {
          用户: '用户',
          角色: '角色',
          苦主: '苦主',
          黄毛: '黄毛',
          同时: '同时',
          然后: '然后',
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
#${OVERLAY_ID}{position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483000;display:flex;align-items:flex-start;justify-content:center;background:radial-gradient(1200px 520px at 12% 0%,rgba(255,255,255,.25),transparent 56%),radial-gradient(1000px 560px at 92% 8%,rgba(244,228,204,.34),transparent 54%),rgba(10,10,12,.52);backdrop-filter:blur(7px);overflow:auto;padding:8px;scrollbar-gutter:stable}
#${OVERLAY_ID} *{box-sizing:border-box}
.fp-panel{position:relative;display:flex;flex-direction:column;border-radius:20px;overflow:hidden;border:1px solid rgba(27,27,30,.14);background:linear-gradient(180deg,#f9f6f0 0%,#f3eee5 100%);box-shadow:0 28px 70px rgba(0,0,0,.30);color:#1f2023;font-family:'Manrope','Noto Sans SC','Segoe UI',sans-serif;flex-shrink:0;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);margin:8px auto}
.fp-top{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;padding:10px 12px;border-bottom:1px solid rgba(26,26,30,.10);background:linear-gradient(180deg,#ffffff,#f5f2ea);column-gap:10px}
.fp-left,.fp-right{display:flex;align-items:center;gap:8px}
.fp-right{justify-content:flex-end;min-width:0;overflow:auto}
.fp-left{min-width:0;overflow:auto}
.fp-btn{border:1px solid rgba(23,24,28,.18);background:rgba(255,255,255,.9);color:#1f2023;border-radius:11px;padding:7px 12px;cursor:pointer;font-size:13px;font-weight:600;white-space:nowrap;line-height:1.2}
.fp-btn:hover{background:#fff;border-color:rgba(23,24,28,.34)}
.fp-btn.primary{background:#1f2023;border-color:#1f2023;color:#fff}
.fp-btn.icon-only{padding:7px 9px;min-width:34px;display:inline-flex;align-items:center;justify-content:center}
.fp-btn .fp-ico{width:14px;height:14px;display:inline-block;vertical-align:-2px;margin-right:6px}
.fp-btn.icon-only .fp-ico{margin-right:0}
.fp-title{font-weight:800;font-size:14px;letter-spacing:.2px;color:#17181b;white-space:nowrap}
.fp-quick-actions{display:flex;align-items:center;gap:7px;margin-left:4px}
.fp-btn-then{background:linear-gradient(180deg,#ffe8cf,#f9dbb8);border-color:rgba(170,112,42,.35);color:#7e4e16}
.fp-btn-then:hover{background:linear-gradient(180deg,#ffe2c2,#f5d0a6);border-color:rgba(170,112,42,.5)}
.fp-btn-simul{background:linear-gradient(180deg,#efe9ff,#dfd3ff);border-color:rgba(92,77,155,.35);color:#4b3a8a}
.fp-btn-simul:hover{background:linear-gradient(180deg,#e8e0ff,#d3c3ff);border-color:rgba(92,77,155,.52)}
.fp-path{padding:8px 12px;border-bottom:1px solid rgba(26,26,30,.09);background:#f1ebe1;color:#5a5148;font-size:12px;white-space:nowrap;overflow:auto}
.fp-body{flex:1;display:flex;min-height:0}
.fp-sidebar{display:flex;flex-direction:column;border-right:1px solid rgba(26,26,30,.09);background:linear-gradient(180deg,#fbf8f3,#f6f0e6);min-width:220px;max-width:520px}
.fp-side-head{display:flex;gap:8px;padding:10px;border-bottom:1px solid rgba(26,26,30,.09)}
.fp-input{width:100%;padding:8px 10px;border:1px solid rgba(23,24,28,.2);border-radius:10px;background:#fff;color:#1f2023}
.fp-tree{padding:8px;overflow:auto;flex:1}
.fp-tree-node{display:flex;align-items:center;gap:6px;padding:7px 8px;border-radius:10px;cursor:pointer;font-size:13px;color:#423c34}
.fp-tree-node:hover{background:rgba(35,31,28,.08)}
.fp-tree-node.active{background:#1f2023;color:#fff}
.fp-tree-indent{display:inline-block;width:12px;flex:none}
.fp-main{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;background:linear-gradient(180deg,#f8f4ec,#f3eee5)}
.fp-main-scroll{flex:1;overflow:auto;padding:14px}
.fp-group-title{font-weight:800;font-size:13px;color:#4f463d;margin:14px 0 8px}
.fp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.fp-card{position:relative;border:1px solid rgba(24,24,27,.12);border-radius:14px;padding:11px;background:#fff;cursor:pointer;min-height:72px;box-shadow:0 6px 14px rgba(20,20,22,.06)}
.fp-card:hover{border-color:rgba(24,24,27,.28);box-shadow:0 10px 22px rgba(20,20,22,.12);transform:translateY(-1px)}
.fp-card-title{font-size:13px;font-weight:700;line-height:1.35;word-break:break-word;padding-right:54px;color:#1d1e22}
.fp-card-icons{position:absolute;right:8px;top:8px;display:flex;gap:6px}
.fp-mini{font-size:11px;padding:2px 6px;border-radius:99px;background:#f2ede5;border:1px solid rgba(24,24,27,.12);color:#5d544a}
.fp-mini.inject{background:#f6ebdc;border-color:rgba(132,88,35,.28);color:#845823}
.fp-mini.fav{background:#f8e8ea;border-color:rgba(158,69,90,.28);color:#9e455a}
.fp-bottom{border-top:1px solid rgba(26,26,30,.10);background:#f7f2e9;display:flex;flex-direction:column}
.fp-bottom.collapsed{height:auto!important}
.fp-bottom.collapsed .fp-preview{display:none}
.fp-bottom-head{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;font-size:12px;color:#60574d}
.fp-preview{overflow:auto;padding:8px 12px;display:flex;flex-wrap:wrap;gap:6px}
.fp-token{font-size:12px;border-radius:999px;padding:3px 10px;border:1px solid transparent}
.fp-token.item{background:#f1ebe2;border-color:rgba(26,26,30,.14);color:#3c342c}
.fp-token.then{background:#ffe6c9;border-color:rgba(170,112,42,.34);color:#7e4e16}
.fp-token.simultaneous{background:#ece7ff;border-color:rgba(92,77,155,.34);color:#4b3a8a}
.fp-token.raw{background:#ececec;border-color:rgba(105,105,110,.28);color:#4a4a4f}
.fp-split-v{width:5px;cursor:col-resize;background:linear-gradient(180deg,transparent,rgba(24,24,27,.18),transparent)}
.fp-split-h{height:5px;cursor:row-resize;background:linear-gradient(90deg,transparent,rgba(24,24,27,.18),transparent)}
.fp-menu{position:fixed;z-index:2147483600;min-width:148px;padding:6px;background:#fff;border:1px solid rgba(24,24,27,.16);border-radius:10px;box-shadow:0 14px 30px rgba(0,0,0,.18)}
.fp-menu-btn{display:block;width:100%;text-align:left;padding:8px;border-radius:7px;background:transparent;border:none;color:#1f2023;cursor:pointer;font-size:12px}
.fp-menu-btn:hover{background:#f1ece4}
#${TOAST_CONTAINER_ID}{position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483700;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;max-width:calc(100vw - 16px)}
.fp-toast{pointer-events:auto;max-width:430px;padding:8px 12px;border-radius:12px;background:rgba(24,24,27,.92);border:1px solid rgba(255,255,255,.16);color:#faf8f4;font-size:12px;box-shadow:0 8px 20px rgba(0,0,0,.30)}
.fp-modal{position:absolute;inset:0;background:rgba(11,12,14,.52);display:flex;align-items:center;justify-content:center;padding:20px}
.fp-modal-card{width:min(760px,95%);max-height:88%;overflow:auto;border:1px solid rgba(24,24,27,.15);border-radius:14px;background:linear-gradient(180deg,#ffffff,#f7f2e9);padding:14px;color:#1f2023}
.fp-modal-title{font-weight:800;font-size:15px;margin-bottom:10px}
.fp-settings-shell{display:grid;grid-template-columns:180px minmax(0,1fr);gap:12px}
.fp-settings-nav{display:flex;flex-direction:column;gap:6px;padding-right:8px;border-right:1px solid rgba(24,24,27,.12)}
.fp-settings-tab{padding:9px 10px;border:1px solid rgba(24,24,27,.16);border-radius:10px;background:#fff;font-size:12px;font-weight:700;cursor:pointer;text-align:left}
.fp-settings-tab.active{background:#1f2023;color:#fff;border-color:#1f2023}
.fp-settings-body{min-width:0}
.fp-tab{display:none}
.fp-tab.active{display:block}
.fp-row{display:flex;gap:8px;align-items:center;margin-bottom:8px}
.fp-row > label{width:98px;font-size:12px;color:#5d544b}
.fp-row > input,.fp-row > textarea,.fp-row > select{flex:1;padding:8px;border-radius:10px;border:1px solid rgba(24,24,27,.18);background:#fff;color:#1f2023}
.fp-row > textarea{min-height:90px;resize:vertical}
.fp-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}
.fp-actions button{padding:8px 12px;border-radius:10px;border:1px solid rgba(24,24,27,.18);background:#fff;color:#1f2023;cursor:pointer;font-weight:600}
.fp-actions button.primary{background:#1f2023;border-color:#1f2023;color:#fff}
.fp-panel.fp-compact .fp-body{flex-direction:column}
.fp-panel.fp-compact .fp-sidebar{width:100%!important;max-width:none;min-width:0;border-right:none;border-bottom:1px solid rgba(26,26,30,.10);max-height:44%}
.fp-panel.fp-compact .fp-split-v{display:none}
.fp-panel.fp-compact .fp-main{min-height:0}
.fp-panel.fp-compact .fp-main-scroll{padding:10px}
.fp-panel.fp-compact .fp-grid{grid-template-columns:1fr}
.fp-panel[data-theme="ink-noir"]{background:linear-gradient(180deg,#16181d 0%,#121419 100%);color:#e8edf5;border-color:rgba(255,255,255,.12)}
.fp-panel[data-theme="ink-noir"] .fp-top,
.fp-panel[data-theme="ink-noir"] .fp-path,
.fp-panel[data-theme="ink-noir"] .fp-sidebar,
.fp-panel[data-theme="ink-noir"] .fp-main,
.fp-panel[data-theme="ink-noir"] .fp-bottom,
.fp-panel[data-theme="ink-noir"] .fp-modal-card{background:#171a20!important;color:#e8edf5}
.fp-panel[data-theme="ink-noir"] .fp-btn{background:#1f2430;color:#e8edf5;border-color:rgba(255,255,255,.18)}
.fp-panel[data-theme="ink-noir"] .fp-card{background:#1e232c;border-color:rgba(255,255,255,.14)}
.fp-panel[data-theme="ink-noir"] .fp-tree-node{color:#d6deea}
.fp-panel[data-theme="ink-noir"] .fp-tree-node.active{background:#e8edf5;color:#171a20}
.fp-panel[data-theme="sand-gold"]{background:linear-gradient(180deg,#f6efe3 0%,#efe4d3 100%);color:#2a241c}
.fp-panel[data-theme="sand-gold"] .fp-top{background:linear-gradient(180deg,#fff9ef,#f2e6d4)}
.fp-panel[data-theme="sand-gold"] .fp-path,
.fp-panel[data-theme="sand-gold"] .fp-sidebar,
.fp-panel[data-theme="sand-gold"] .fp-main,
.fp-panel[data-theme="sand-gold"] .fp-bottom,
.fp-panel[data-theme="sand-gold"] .fp-modal-card{background:#f7efdf!important;color:#2a241c}
.fp-panel[data-theme="sand-gold"] .fp-btn{background:#fff7ea;color:#2a241c;border-color:rgba(97,74,38,.22)}
.fp-panel[data-theme="sand-gold"] .fp-card{background:#fffaf1;border-color:rgba(97,74,38,.14)}
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
    const previewEl = overlay.querySelector('.fp-preview') as HTMLElement | null;
    if (!previewEl) return;
    renderPreview(previewEl);
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

  function addConnector(type: 'then' | 'simultaneous'): void {
    if (!state.pack) return;
    const token = type === 'then'
      ? state.pack.settings.tokens.then
      : state.pack.settings.tokens.simultaneous;
    appendToInput(token);
    pushPreviewToken(type === 'then' ? 'then' : 'simultaneous', token);
    toast(type === 'then' ? '已插入“然后”' : '已插入“同时”');
  }

  function closeContextMenu() {
    if (state.contextMenu) {
      state.contextMenu.remove();
      state.contextMenu = null;
    }
  }

  function renderPath(pathEl: HTMLElement): void {
    if (!state.pack) return;
    const nodes = getPath(state.currentCategoryId);
    state.pack.uiState.lastPath = nodes.map((n) => n.id);
    pathEl.textContent = nodes.map((n) => n.name).join('  /  ') || '未选择分类';
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

  function openSettingsModal(): void {
    if (!state.pack) return;
    showModal((close) => {
      const card = pD.createElement('div');
      card.className = 'fp-modal-card';

      const placeholders = state.pack!.settings.placeholders || {};
      const rows = ['用户', '角色', '苦主', '黄毛', '同时', '然后'];

      const customKeys = Object.keys(placeholders).filter((k) => !rows.includes(k));
      const ui = state.pack!.settings.ui || {};
      const currentTheme = ui.theme || 'herdi-light';
      const toastSettings = state.pack!.settings.toast || { maxStack: 4, timeout: 1800 };

      card.innerHTML = `
        <div class="fp-modal-title">⚙️ 设置中心</div>
        <div class="fp-settings-shell">
          <div class="fp-settings-nav">
            <button class="fp-settings-tab active" data-tab-btn="placeholders">占位符</button>
            <button class="fp-settings-tab" data-tab-btn="tokens">执行与令牌</button>
            <button class="fp-settings-tab" data-tab-btn="themes">主题</button>
            <button class="fp-settings-tab" data-tab-btn="advanced">高级</button>
          </div>
          <div class="fp-settings-body">
            <div class="fp-tab active" data-tab="placeholders">
              ${rows.map((k) => `<div class="fp-row"><label>${k}</label><input data-ph="${k}" value="${String(placeholders[k] || '')}" /></div>`).join('')}
              <div class="fp-row"><label>自定义占位符</label><input data-new-key placeholder="例如：主角" /></div>
              <div class="fp-row"><label>对应值</label><input data-new-val placeholder="例如：勇者" /></div>
              ${customKeys.length ? `<div class="fp-row"><label>现有扩展</label><textarea readonly>${customKeys.map((k) => `${k}=${placeholders[k]}`).join('\n')}</textarea></div>` : ''}
            </div>
            <div class="fp-tab" data-tab="tokens">
              <div class="fp-row"><label>同时按钮文本</label><input data-token="simultaneous" value="${state.pack!.settings.tokens.simultaneous || '<同时>'}" /></div>
              <div class="fp-row"><label>然后按钮文本</label><input data-token="then" value="${state.pack!.settings.tokens.then || '<然后>'}" /></div>
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
                  <option value="herdi-light" ${currentTheme === 'herdi-light' ? 'selected' : ''}>Herdi Light</option>
                  <option value="ink-noir" ${currentTheme === 'ink-noir' ? 'selected' : ''}>Ink Noir</option>
                  <option value="sand-gold" ${currentTheme === 'sand-gold' ? 'selected' : ''}>Sand Gold</option>
                </select>
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

      (card.querySelector('[data-close]') as HTMLElement | null)!.onclick = close;
      (card.querySelector('[data-save]') as HTMLElement | null)!.onclick = () => {
        for (const k of rows) {
          const el = card.querySelector(`[data-ph="${k}"]`) as HTMLInputElement | null;
          placeholders[k] = String(el?.value || '').trim() || k;
        }
        const tokenSim = (card.querySelector('[data-token="simultaneous"]') as HTMLInputElement | null)?.value.trim();
        const tokenThen = (card.querySelector('[data-token="then"]') as HTMLInputElement | null)?.value.trim();
        state.pack!.settings.tokens.simultaneous = tokenSim || '<同时>';
        state.pack!.settings.tokens.then = tokenThen || '<然后>';
        state.pack!.settings.defaults.mode = (card.querySelector('[data-default-mode]') as HTMLSelectElement | null)?.value === 'inject' ? 'inject' : 'append';
        state.pack!.settings.ui = state.pack!.settings.ui || {};
        state.pack!.settings.ui.theme = (card.querySelector('[data-theme]') as HTMLSelectElement | null)?.value || 'herdi-light';
        const toastMax = Number((card.querySelector('[data-toast-max]') as HTMLInputElement | null)?.value || 4);
        const toastTimeout = Number((card.querySelector('[data-toast-timeout]') as HTMLInputElement | null)?.value || 1800);
        state.pack!.settings.toast.maxStack = Math.max(1, Math.min(8, toastMax || 4));
        state.pack!.settings.toast.timeout = Math.max(600, Math.min(8000, toastTimeout || 1800));
        const newKey = (card.querySelector('[data-new-key]') as HTMLInputElement | null)?.value.trim();
        const newVal = (card.querySelector('[data-new-val]') as HTMLInputElement | null)?.value.trim();
        if (newKey) placeholders[newKey] = newVal || newKey;
        state.pack!.settings.placeholders = placeholders;
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

  function openImportSelectionModal(incoming: Pack, onDone: (selected: Pack | null) => void): void {
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
        onDone(null);
      };

      (card.querySelector('[data-next]') as HTMLElement | null)!.onclick = () => {
        const selectedCategoryIds = [...card.querySelectorAll('input[data-cat-id]:checked')].map((el) => el.getAttribute('data-cat-id') || '');
        const selectedItemIds = [...card.querySelectorAll('input[data-item-id]:checked')].map((el) => el.getAttribute('data-item-id') || '');
        const filtered = buildFilteredIncomingBySelection(incoming, selectedCategoryIds, selectedItemIds);
        if (!filtered.categories.length && !filtered.items.length) {
          toast('请至少勾选一个分类或条目');
          return;
        }
        closeSelect();
        onDone(filtered);
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

        openImportSelectionModal(incoming, (selectedIncoming) => {
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
            applyImport(selectedIncoming, []);
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
              applyImport(selectedIncoming, conflicts);
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

  function applyImport(incoming: Pack, conflicts: ImportConflict[]): void {
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
        a.download = `快速情节编排_导出_${Date.now()}.json`;
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
    for (const t of tokens) {
      const chip = pD.createElement('span');
      chip.className = `fp-token ${t.type || 'raw'}`;
      chip.textContent = t.label || '';
      previewEl.appendChild(chip);
    }
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

    pD.body.appendChild(menu);
    state.contextMenu = menu;

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
        card.innerHTML = `
          <div class="fp-card-icons">
            <span class="fp-mini ${item.mode === 'inject' ? 'inject' : ''}">${item.mode === 'inject' ? '注入' : '追加'}</span>
            ${item.favorite ? '<span class="fp-mini fav">❤</span>' : ''}
          </div>
          <div class="fp-card-title">${item.name}</div>
        `;

        card.onclick = () => runItem(item);

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
    panel.setAttribute('data-theme', (state.pack.settings.ui && state.pack.settings.ui.theme) || 'herdi-light');

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
    top.innerHTML = `
      <div class="fp-left">
        ${renderTopButton({ data: 'back', icon: 'back', label: '返回' })}
        <span class="fp-title">💌 快速情节编排</span>
        <div class="fp-quick-actions">
          ${renderTopButton({ data: 'then', icon: 'then', label: '然后', className: 'fp-btn-then' })}
          ${renderTopButton({ data: 'simul', icon: 'simul', label: '同时', className: 'fp-btn-simul' })}
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

    const path = pD.createElement('div');
    path.className = 'fp-path';

    const body = pD.createElement('div');
    body.className = 'fp-body';

    const sidebar = pD.createElement('div');
    sidebar.className = 'fp-sidebar';
    sidebar.style.width = compact ? '100%' : `${state.pack.uiState.sidebar.width || 280}px`;

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
    const previewExpanded = compact ? false : state.pack.uiState.preview.expanded !== false;
    if (!previewExpanded) {
      bottom.classList.add('collapsed');
      splitH.style.display = 'none';
    }

    const bottomHead = pD.createElement('div');
    bottomHead.className = 'fp-bottom-head';
    bottomHead.innerHTML = '<span>预览令牌流（条目名 / 同时 / 然后）</span><button class="fp-btn" data-toggle-preview>收起</button>';

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

    (top.querySelector('[data-back]') as HTMLElement | null)!.onclick = () => {
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
    (top.querySelector('[data-then]') as HTMLElement | null)!.onclick = () => addConnector('then');
    (top.querySelector('[data-simul]') as HTMLElement | null)!.onclick = () => addConnector('simultaneous');
    (top.querySelector('[data-settings]') as HTMLElement | null)!.onclick = openSettingsModal;
    (top.querySelector('[data-import]') as HTMLElement | null)!.onclick = openImportModal;
    (top.querySelector('[data-export]') as HTMLElement | null)!.onclick = openExportModal;
    (top.querySelector('[data-close]') as HTMLElement | null)!.onclick = closeWorkbench;

    (top.querySelector('[data-new-item]') as HTMLElement | null)!.onclick = () => openEditItemModal(null);
    (top.querySelector('[data-new-cat]') as HTMLElement | null)!.onclick = () => {
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

    const toggleBtn = bottomHead.querySelector('[data-toggle-preview]') as HTMLElement | null;
    if (toggleBtn) {
      toggleBtn.textContent = previewExpanded ? '收起' : '展开';
      toggleBtn.onclick = () => {
        if (!state.pack) return;
        state.pack.uiState.preview.expanded = !(state.pack.uiState.preview.expanded !== false);
        persistPack();
        renderWorkbench();
      };
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
      console.error('[快速情节编排] 按钮注册失败', e);
    }

    try {
      const ev = getButtonEvent(BUTTON_LABEL);
      eventOn(ev, openWorkbench);
    } catch (e) {
      console.error('[快速情节编排] 事件监听失败', e);
    }

    pD.addEventListener('click', (e) => {
      if (state.contextMenu && !(e.target as HTMLElement).closest('.fp-menu')) closeContextMenu();
    });

    console.log('[快速情节编排] 已加载');
  }

  bootstrap();
})();
