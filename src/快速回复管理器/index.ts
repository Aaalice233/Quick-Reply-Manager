/**
 * 快速回复管理器 - 入口文件
 * @description 主入口，负责初始化、事件绑定和清理
 */

// ============================================================================
// 类型导入
// ============================================================================
import type { Pack, Category, Item, DragData, AppState } from './types';

// ============================================================================
// 常量导入
// ============================================================================
import {
  SCRIPT_LABEL,
  BUTTON_LABEL,
  STORE_KEY,
  STYLE_ID,
  OVERLAY_ID,
  TOAST_CONTAINER_ID,
  QR_LLM_SECRET_KEY,
  DEFAULT_QR_LLM_PRESET_NAME,
  DEFAULT_QR_LLM_PRESET_VERSION,
  DATA_VERSION,
  THEME_NAMES,
  CONNECTOR_COLOR_NAMES,
  CONNECTOR_COLOR_HEX,
  CONNECTOR_ONLY_KEYS,
  RUNTIME_KEY,
} from './constants';

// ============================================================================
// 状态导入
// ============================================================================
import { state, getState, getCurrentPack, getCurrentCategoryId, updatePack, persistPack } from './store';

// ============================================================================
// 工具函数导入
// ============================================================================
import { uid, resolveHostWindow, escapeHtml, getInputValueTrim, asDomElement } from './utils/dom';
import { deepClone, parsePackUpdatedAtMs, nowIso } from './utils/data';
import { validateApiUrlOrThrow, mergeAbortSignals } from './utils/validation';
import { fetchWithTimeout, copyTextRobust } from './utils/network';

// ============================================================================
// 服务导入
// ============================================================================
import { pushDebugLog, logInfo, logError, getDebugLogText } from './services/debug';
import { loadPack, saveScriptStoreRaw, getScriptStoreRaw, buildDefaultPack } from './services/storage';
import {
  buildDefaultQrLlmPresetStore,
  normalizeQrLlmPresetStore,
  getDefaultQrLlmSettings,
  loadQrLlmSecretConfig,
  saveQrLlmSecretConfig,
  getQrLlmSecretConfig,
  fetchQrLlmModels,
  callQrLlmGenerate,
  generateQrExpandedContent,
  testQrLlmConnection,
  invalidateEditGeneration,
} from './services/llm';
import {
  resolvePlaceholders,
  extractPlaceholderTokens,
  getCurrentRolePlaceholderMap,
  getEffectivePlaceholderValues,
  detectCurrentCharacterState,
  handleActiveCharacterContextChanged,
} from './services/placeholder';
import type { ThemeData } from './services/theme';
import {
  getCurrentTheme,
  setTheme,
  applyThemeToDOM,
  exportTheme,
  importTheme,
  downloadTheme,
  importThemeFromFile,
  getAvailableThemes,
  getThemeDisplayName,
  isValidTheme,
  getCustomCSS,
  setCustomCSS,
  initTheme,
} from './services/theme';

// ============================================================================
// 功能导入
// ============================================================================
import type { CategoryTreeNode } from './features/categories';
import {
  getCategoryById,
  getItemsByCategory as getCategoryItems,
  getPath,
  getChildCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  moveCategory,
  reorderCategories,
  moveCategoryRelative,
  getCategoryTree,
  hasChildren,
  getDescendantIds,
} from './features/categories';
import {
  getItemById,
  getItemsByCategory,
  createItem,
  updateItem,
  deleteItem,
  moveItem,
  reorderItems,
  toggleItemFavorite,
  duplicateItem,
  insertQrContent,
} from './features/items';
import {
  exportPackToJson,
  exportPackToJsonSafe,
  exportPackToFile,
  exportPackSubtreeToFile,
  importPackFromJson,
  importPackFromFile,
  validatePack,
  migratePack,
  collectSubtreeIds,
  mergePacks,
  createPackBackup,
  restorePackFromBackup,
} from './features/import-export';
import {
  getSettings,
  updateSettings,
  getUiSettings,
  updateUiSettings,
  resetSettings,
  getDefaultSettings,
  cloneSettings,
  cloneUiSettings,
} from './features/settings';
import { openAdvancedImportModal } from './features/modal';

// ============================================================================
// UI导入
// ============================================================================
import { ensureStyle, applyCustomCSS, removeStyle, refreshStyles } from './ui/styles';
import type { ModalOptions, ModalContentFactory, TopButtonOptions } from './ui/components';
import {
  iconSvg,
  renderTopButton,
  createButton,
  registerModalCloseCallback,
  clearModalCloseCallbacks,
  showModal,
  setToastConfig,
  resetToastConfig,
  toast,
  createCard,
} from './ui/components';
import {
  ensureOverlay,
  renderPath,
  renderCategoryTree,
  renderItemGrid,
  renderMainContent,
  renderPreview,
  renderCompactListContent,
  renderCompactList,
  renderToolbar,
  renderSidebar,
  enableResizers,
  renderWorkbench,
} from './ui/workbench';

// ============================================================================
// 模态框导入
// ============================================================================
import { showSettingsModal } from './features/modal';
import { showEditItemModal } from './features/modal';
import type { PreviewToken, PlaceholderValues } from './ui/preview';
import {
  highlightPlaceholders,
  renderPreviewPanel,
  updatePreview,
  renderPlaceholderPreview,
  refreshPreviewPanel,
  getPreviewTokens,
  setPreviewTokens,
  addPreviewToken,
  clearPreviewTokens,
} from './ui/preview';
import type { DragType, DropMode } from './ui/events';
import {
  isClickSuppressed,
  suppressNextClick,
  handleDragStart,
  handleDragOver,
  handleDrop,
  handleDragEnd,
  handleCategoryClick,
  handleItemClick,
  handleContextMenu,
  bindWorkbenchEvents,
  unbindWorkbenchEvents,
  addTouchLongPress,
  closeContextMenu,
  currentDragData,
  cleanupDrag,
} from './ui/events';

// ============================================================================
// 全局变量
// ============================================================================

/** 宿主窗口引用 */
const pW = resolveHostWindow();

/** 宿主文档引用 */
const pD = pW.document || document;

/** 是否已初始化 */
let isInitialized = false;

/** 窗口大小变化处理器 */
let resizeHandler: (() => void) | null = null;

/** 键盘快捷键处理器 */
let keyboardHandler: ((e: KeyboardEvent) => void) | null = null;

/** 面板点击事件处理器 */
let panelClickHandler: ((e: MouseEvent) => void) | null = null;

// ============================================================================
// 核心功能函数
// ============================================================================

/**
 * 检测当前角色信息
 * @description 更新 state 中的角色相关信息
 */
function detectCharacter(): void {
  const charState = detectCurrentCharacterState();
  state.activeCharacterId = charState.characterId;
  state.activeCharacterName = charState.characterName;
  state.activeIsGroupChat = charState.isGroupChat;

  // 检测角色切换
  const currentSwitchKey = `${state.activeCharacterId || '__none__'}_${state.activeIsGroupChat ? 'group' : 'solo'}`;
  if (state.activeCharacterSwitchKey !== '__boot__' && state.activeCharacterSwitchKey !== currentSwitchKey) {
    logInfo('检测到角色切换', {
      from: state.activeCharacterSwitchKey,
      to: currentSwitchKey,
      name: state.activeCharacterName,
    });
  }
  state.activeCharacterSwitchKey = currentSwitchKey;
}

/**
 * 同步预览令牌到输入框
 * @description 将预览区的内容同步到酒馆的输入框
 */
function syncPreviewToInput(): void {
  if (!state.pack) return;

  const ta = pD.querySelector('#send_textarea') as HTMLTextAreaElement | null;
  if (!ta) return;

  const tokens = state.pack.uiState.preview.tokens || [];
  const next = tokens.map(t => String(t.text !== undefined ? t.text : t.label)).join('');

  if (String(ta.value || '') === next) return;

  state.suspendInputSync = true;
  ta.value = next;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  state.suspendInputSync = false;
}

/**
 * 应用面板尺寸到视口
 * @description 根据视口大小调整面板尺寸
 */
function applyFitPanelSize(): void {
  if (!state.pack) return;
  if (!state.pack.uiState?.panelSize) return;

  const vp = {
    width: Math.max(320, Number(pW?.innerWidth) || 320),
    height: Math.max(360, Number(pW?.innerHeight) || 360),
  };

  const width = Math.min(Math.max(320, vp.width - 16), Math.max(320, Math.round(vp.width * 0.86)));
  const height = Math.min(Math.max(360, vp.height - 16), Math.max(360, Math.round(vp.height * 0.88)));

  state.pack.uiState.panelSize.width = width;
  state.pack.uiState.panelSize.height = height;
}

/**
 * 处理窗口大小变化
 * @description 防抖处理窗口大小变化，重新渲染界面
 */
function handleResize(): void {
  if (state.resizeRaf) {
    pW.cancelAnimationFrame(state.resizeRaf);
  }

  state.resizeRaf = pW.requestAnimationFrame(() => {
    state.resizeRaf = null;
    applyFitPanelSize();
    persistPack();
    renderWorkbench();
  });
}

/**
 * 绑定全局事件
 * @description 绑定窗口大小变化、键盘快捷键等全局事件
 */
function bindGlobalEvents(): void {
  // 窗口大小变化
  resizeHandler = () => handleResize();
  pW.addEventListener('resize', resizeHandler);

  // 键盘快捷键
  keyboardHandler = (e: KeyboardEvent) => {
    // ESC 关闭右键菜单
    if (e.key === 'Escape') {
      closeContextMenu();

      // 如果处于生成状态，取消生成
      if (state.editGenerateState.isGenerating && state.editGenerateState.abortController) {
        state.editGenerateState.abortController.abort();
        state.editGenerateState.isGenerating = false;
        toast('已取消生成');
      }
    }

    // Ctrl/Cmd + S 保存
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      persistPack({ immediate: true });
      toast('已保存');
    }
  };
  pD.addEventListener('keydown', keyboardHandler);
}

/**
 * 解绑全局事件
 * @description 清理绑定的全局事件处理器
 */
function unbindGlobalEvents(): void {
  if (resizeHandler) {
    pW.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
  }

  if (keyboardHandler) {
    pD.removeEventListener('keydown', keyboardHandler);
    keyboardHandler = null;
  }

  if (state.resizeRaf) {
    pW.cancelAnimationFrame(state.resizeRaf);
    state.resizeRaf = null;
  }
}

/**
 * 处理面板点击事件
 * @param e - 点击事件
 */
function handlePanelClick(e: MouseEvent): void {
  const target = e.target as HTMLElement;
  if (!target) return;

  // 关闭按钮
  if (target.closest('[data-close]')) {
    closeWorkbench();
    return;
  }

  // 返回按钮
  if (target.closest('[data-back]')) {
    const prev = state.history.pop();
    if (prev !== undefined) {
      state.currentCategoryId = prev;
      renderWorkbench();
    }
    return;
  }

  // 新增分类
  if (target.closest('[data-new-cat]')) {
    const name = prompt('分类名称');
    if (name && state.pack) {
      const cat = createCategory(name.trim(), state.currentCategoryId);
      if (cat) {
        toast('分类已创建');
        renderWorkbench();
      }
    }
    return;
  }

  // 新增条目
  if (target.closest('[data-new-item]')) {
    if (!state.pack) return;
    const catId = state.currentCategoryId || state.pack.categories[0]?.id || null;
    const itemName = prompt('条目名称');
    if (itemName) {
      createItem(catId, itemName.trim(), '');
      renderWorkbench();
    }
    return;
  }

  // 导入
  if (target.closest('[data-import]')) {
    openAdvancedImportModal();
    return;
  }

  // 导出
  if (target.closest('[data-export]')) {
    exportPackToFile();
    return;
  }

  // 设置
  if (target.closest('[data-settings]')) {
    showSettingsModal();
    return;
  }

  // 清空预览
  if (target.closest('[data-clear-preview]')) {
    clearPreviewTokens();
    syncPreviewToInput();
    return;
  }

  // 收起/展开预览
  if (target.closest('[data-toggle-preview]')) {
    if (state.pack) {
      state.pack.uiState.preview.expanded = !state.pack.uiState.preview.expanded;
      persistPack();
      renderWorkbench();
    }
    return;
  }

  // 树展开/折叠切换
  if (target.closest('[data-tree-toggle]')) {
    if (!state.pack) return;
    const expanded = state.pack.uiState.sidebar.expanded || {};
    const allExpanded = state.pack.categories.every(c => expanded[c.id] !== false);
    state.pack.categories.forEach(c => {
      expanded[c.id] = allExpanded;
    });
    persistPack();
    renderWorkbench();
    return;
  }

  // 搜索输入
  const searchInput = target.closest('.fp-side-search-input') as HTMLInputElement | null;
  if (searchInput) {
    state.filter = searchInput.value;
    renderWorkbench();
    return;
  }

  // 分类树节点点击
  const treeNode = target.closest('.fp-tree-node[data-cat-id]') as HTMLElement | null;
  if (treeNode) {
    const catId = treeNode.dataset.catId;
    if (catId) {
      handleCategoryClick(catId);
      renderWorkbench();
    }
    return;
  }

  // 条目卡片点击
  const itemCard = target.closest('.fp-card[data-item-id]') as HTMLElement | null;
  if (itemCard && !target.closest('.fp-card-add')) {
    const itemId = itemCard.dataset.itemId;
    if (itemId) {
      // 实际执行条目
      import('./features/items').then(({ insertQrContent }) => {
        insertQrContent(itemId);
      });
    }
    return;
  }

  // 连接符按钮点击
  const connectors = state.pack?.settings?.connectors || [];
  connectors.forEach((conn, i) => {
    const connBtn = target.closest(`[data-conn-${i}]`) as HTMLElement | null;
    if (connBtn) {
      if (!state.pack) return;
      if (!state.pack.settings.defaults.connectorPrefixMode) {
        // 直接插入模式
        addPreviewToken(`conn-id:${conn.id}`, conn.token, conn.token);
        syncPreviewToInput();
        toast(`已插入"${conn.label}"`);
      } else {
        // 前缀模式：选择激活连接符
        state.pack.settings.defaults.connectorPrefixId = conn.id;
        persistPack();
        renderWorkbench();
      }
      return;
    }
  });

  // 连接符模式切换开关
  const connModeToggle = target.closest('[data-conn-mode-toggle]') as HTMLElement | null;
  if (connModeToggle) {
    if (!state.pack) return;
    const next = !state.pack.settings.defaults.connectorPrefixMode;
    state.pack.settings.defaults.connectorPrefixMode = next;
    if (next && !state.pack.settings.defaults.connectorPrefixId && connectors.length > 0) {
      state.pack.settings.defaults.connectorPrefixId = connectors[0].id;
    }
    persistPack();
    renderWorkbench();
    return;
  }

  // 自定义连接符按钮
  const connCustomBtn = target.closest('[data-conn-custom]') as HTMLElement | null;
  if (connCustomBtn) {
    const token = prompt('输入自定义连接符内容');
    if (token && state.pack) {
      addPreviewToken('raw', token, token);
      syncPreviewToInput();
    }
    return;
  }

  // 快速添加按钮
  const quickAddBtn = target.closest('.fp-card-add[data-quick-add-cat]') as HTMLElement | null;
  if (quickAddBtn) {
    const catId = quickAddBtn.dataset.quickAddCat;
    const itemName = prompt('条目名称');
    if (itemName && catId) {
      createItem(catId === '__favorites__' ? null : catId, itemName.trim(), '');
      renderWorkbench();
    }
    return;
  }
}

/**
 * 绑定面板内的事件
 * @description 绑定面板内部的点击、拖拽等交互事件
 */
function bindPanelEvents(): void {
  const overlay = pD.getElementById(OVERLAY_ID);
  if (!overlay) {
    logError('bindPanelEvents: overlay not found');
    return;
  }

  // 先解绑所有工作台事件（避免时序问题）
  unbindWorkbenchEvents();

  // 如果已有面板点击处理器，先移除旧的
  if (panelClickHandler) {
    overlay.removeEventListener('click', panelClickHandler);
    panelClickHandler = null;
    logInfo('已移除旧的面板点击事件监听器');
  }

  // 重新绑定工作台事件
  bindWorkbenchEvents();

  // 保存处理器引用并绑定新的事件
  panelClickHandler = handlePanelClick;
  overlay.addEventListener('click', panelClickHandler);
  logInfo('面板点击事件已绑定');

  // 右键菜单
  overlay.addEventListener('contextmenu', e => {
    const target = e.target as HTMLElement;
    if (!target) return;

    const treeNode = target.closest('.fp-tree-node[data-cat-id]') as HTMLElement | null;
    if (treeNode) {
      const catId = treeNode.dataset.catId;
      if (catId) {
        handleContextMenu(e as MouseEvent, 'category', catId);
      }
      return;
    }

    const itemCard = target.closest('.fp-card[data-item-id]') as HTMLElement | null;
    if (itemCard) {
      const itemId = itemCard.dataset.itemId;
      if (itemId) {
        handleContextMenu(e as MouseEvent, 'item', itemId);
      }
      return;
    }
  });

  // 条目执行事件
  pD.addEventListener('item:execute', ((e: CustomEvent) => {
    const item = e.detail?.item as Item | undefined;
    if (item) {
      insertQrContent(item.id);
    }
  }) as EventListener);

  // 条目编辑事件
  pD.addEventListener('item:edit', ((e: CustomEvent) => {
    const itemId = e.detail?.itemId as string | undefined;
    if (itemId) {
      showEditItemModal(itemId);
    }
  }) as EventListener);

  // 条目复制事件
  pD.addEventListener('item:copy', ((e: CustomEvent) => {
    const item = e.detail?.item as Item | undefined;
    if (item) {
      copyTextRobust(item.content)
        .then(() => {
          toast('内容已复制');
        })
        .catch(() => {
          toast('复制失败');
        });
    }
  }) as EventListener);

  // 刷新工作台事件
  pD.addEventListener('workbench:refresh', () => {
    renderWorkbench();
  });
}

/**
 * 创建覆盖层
 * @description 创建工作台覆盖层并添加到文档
 */
function createOverlay(): HTMLElement {
  let overlay = pD.getElementById(OVERLAY_ID);
  if (overlay) return overlay;

  overlay = pD.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'fp-overlay';

  const panel = pD.createElement('div');
  panel.className = 'fp-panel';
  panel.setAttribute('data-theme', state.pack?.settings.ui.theme || 'herdi-light');

  overlay.appendChild(panel);
  pD.body.appendChild(overlay);

  return overlay;
}

/**
 * 打开工作台
 * @description 显示快速回复管理器主界面
 */
function openWorkbench(): void {
  if (!state.pack) {
    toast('数据未加载');
    return;
  }

  // 创建覆盖层
  createOverlay();

  // 注入样式
  ensureStyle();
  applyCustomCSS();

  // 绑定事件
  bindPanelEvents();
  bindGlobalEvents();

  // 初始化主题
  initTheme();

  // 渲染界面
  renderWorkbench();

  logInfo('工作台已打开');
}

/**
 * 关闭工作台
 * @description 隐藏并清理快速回复管理器界面
 */
function closeWorkbench(): void {
  // 使当前编辑生成失效
  invalidateEditGeneration();

  // 解绑事件
  unbindWorkbenchEvents();
  unbindGlobalEvents();

  // 移除覆盖层
  const overlay = pD.getElementById(OVERLAY_ID);
  if (overlay) {
    overlay.remove();
  }

  // 移除 Toast 容器
  const toastContainer = pD.getElementById(TOAST_CONTAINER_ID);
  if (toastContainer) {
    toastContainer.remove();
  }

  // 清理右键菜单
  closeContextMenu();

  logInfo('工作台已关闭');
}

/**
 * 切换工作台显示状态
 * @description 打开或关闭工作台
 */
function toggleWorkbench(): void {
  const overlay = pD.getElementById(OVERLAY_ID);
  if (overlay) {
    closeWorkbench();
  } else {
    openWorkbench();
  }
}

/**
 * 注册酒馆助手原生按钮
 * @description 使用酒馆助手提供的 replaceScriptButtons API 注册按钮
 */
function registerTavernButton(): void {
  console.log('[快速回复管理器] 开始注册酒馆助手原生按钮...');

  try {
    // 使用酒馆助手原生 API 注册按钮
    replaceScriptButtons([{ name: BUTTON_LABEL, visible: true }]);

    // 绑定按钮点击事件
    eventOn(getButtonEvent(BUTTON_LABEL), () => {
      console.log('[快速回复管理器] 原生按钮被点击');
      toggleWorkbench();
    });

    console.log('[快速回复管理器] 酒馆助手原生按钮注册成功');
    logInfo('酒馆助手原生按钮已注册');
  } catch (error) {
    console.error('[快速回复管理器] 注册原生按钮失败:', error);
    logError('注册原生按钮失败', error);
  }
}

/**
 * 初始化数据
 * @description 加载或创建默认Pack数据
 */
function initData(): void {
  // 加载Pack
  const pack = loadPack();
  state.pack = pack;

  // 加载LLM密钥配置
  loadQrLlmSecretConfig();

  // 初始化当前分类
  if (!state.currentCategoryId && state.pack.categories.length > 0) {
    state.currentCategoryId = state.pack.categories[0].id;
  }

  // 检测当前角色
  detectCharacter();

  logInfo('数据已初始化', { categories: pack.categories.length, items: pack.items.length });
}

/**
 * 注册角色切换监听
 * @description 监听CHAT_CHANGED和CHARACTER_PAGE_LOADED事件
 * @param cleanups - 清理函数数组
 */
function registerCharacterListeners(cleanups: Array<() => void>): void {
  try {
    const onChatChanged = () => {
      handleActiveCharacterContextChanged({ silent: true, rerender: true });
    };
    const onCharacterLoaded = () => {
      handleActiveCharacterContextChanged({ silent: true, rerender: true });
    };

    eventOn(tavern_events.CHAT_CHANGED, onChatChanged);
    eventOn(tavern_events.CHARACTER_PAGE_LOADED, onCharacterLoaded);

    // 定时同步（可选）
    const roleSyncTimer = pW.setInterval(() => {
      handleActiveCharacterContextChanged({ silent: true });
    }, 900);

    cleanups.push(() => {
      try {
        const offFn = (globalThis as unknown as { eventOff?: (name: unknown, handler: unknown) => void }).eventOff;
        if (typeof offFn === 'function') {
          offFn(tavern_events.CHAT_CHANGED, onChatChanged);
          offFn(tavern_events.CHARACTER_PAGE_LOADED, onCharacterLoaded);
        }
      } catch (e) {
        /* ignore */
      }
      try {
        pW.clearInterval(roleSyncTimer);
      } catch (e) {
        /* ignore */
      }
    });
  } catch (e) {
    logError('角色切换监听注册失败', String(e));
  }
}

/**
 * 初始化函数
 * @description 应用程序入口，执行完整的初始化流程
 */
function init(): void {
  // 热重载/重复注入时先清理旧实例
  try {
    const oldRuntime = (pW as unknown as Record<string, unknown>)[RUNTIME_KEY] as { teardown?: () => void } | undefined;
    if (oldRuntime?.teardown) oldRuntime.teardown();
  } catch (e) {
    /* ignore */
  }

  if (isInitialized) {
    logInfo('已经初始化，跳过');
    console.log('[快速回复管理器] 已经初始化，跳过');
    return;
  }

  console.log('[快速回复管理器] 开始初始化');
  logInfo('开始初始化快速回复管理器');

  try {
    // 创建全局运行时对象
    const cleanups: Array<() => void> = [];
    (pW as unknown as Record<string, unknown>)[RUNTIME_KEY] = {
      teardown: () => {
        for (const fn of cleanups.splice(0)) {
          try {
            fn();
          } catch (e) {
            /* ignore */
          }
        }
        cleanup();
      },
    };

    // 初始化数据
    console.log('[快速回复管理器] 初始化数据...');
    initData();
    console.log('[快速回复管理器] 数据初始化完成');

    // 注册酒馆按钮
    console.log('[快速回复管理器] 注册酒馆按钮...');
    registerTavernButton();
    console.log('[快速回复管理器] 按钮注册完成');

    // 注册角色切换监听
    registerCharacterListeners(cleanups);

    isInitialized = true;
    logInfo('快速回复管理器初始化完成');
    console.log('[快速回复管理器] 初始化完成');

    // 显示加载成功提示
    toast(`${SCRIPT_LABEL} 已加载`);
  } catch (error) {
    console.error('[快速回复管理器] 初始化失败:', error);
    logError('初始化失败', error);
    throw error;
  }
}

/**
 * 清理函数
 * @description 页面卸载时执行清理
 */
function cleanup(): void {
  try {
    console.log('[快速回复管理器] 开始清理');
    logInfo('开始清理');

    // 关闭工作台
    closeWorkbench();

    // 移除样式
    removeStyle();

    // 注意：使用酒馆助手原生按钮，不需要手动移除

    // 保存数据
    persistPack({ immediate: true });

    isInitialized = false;
    logInfo('清理完成');
    console.log('[快速回复管理器] 清理完成');
  } catch (error) {
    console.error('[快速回复管理器] 清理时出错:', error);
  }
}

// ============================================================================
// 导出公共API
// ============================================================================

export {
  // 类型
  Pack,
  Category,
  Item,
  DragData,
  AppState,
  PreviewToken,
  PlaceholderValues,
  ThemeData,
  CategoryTreeNode,
  DragType,
  DropMode,
  ModalOptions,
  ModalContentFactory,
  TopButtonOptions,

  // 常量
  SCRIPT_LABEL,
  BUTTON_LABEL,
  STORE_KEY,
  STYLE_ID,
  OVERLAY_ID,
  TOAST_CONTAINER_ID,
  QR_LLM_SECRET_KEY,
  DEFAULT_QR_LLM_PRESET_NAME,
  DEFAULT_QR_LLM_PRESET_VERSION,
  DATA_VERSION,
  THEME_NAMES,
  CONNECTOR_COLOR_NAMES,
  CONNECTOR_COLOR_HEX,
  CONNECTOR_ONLY_KEYS,

  // 状态
  state,
  getState,
  getCurrentPack,
  getCurrentCategoryId,
  updatePack,
  persistPack,

  // 工具函数
  uid,
  resolveHostWindow,
  escapeHtml,
  getInputValueTrim,
  asDomElement,
  deepClone,
  parsePackUpdatedAtMs,
  nowIso,
  validateApiUrlOrThrow,
  mergeAbortSignals,
  fetchWithTimeout,
  copyTextRobust,

  // 调试服务
  pushDebugLog,
  logInfo,
  logError,
  getDebugLogText,

  // 存储服务
  loadPack,
  saveScriptStoreRaw,
  getScriptStoreRaw,
  buildDefaultPack,

  // LLM服务
  buildDefaultQrLlmPresetStore,
  normalizeQrLlmPresetStore,
  getDefaultQrLlmSettings,
  loadQrLlmSecretConfig,
  saveQrLlmSecretConfig,
  getQrLlmSecretConfig,
  fetchQrLlmModels,
  callQrLlmGenerate,
  generateQrExpandedContent,
  testQrLlmConnection,

  // 占位符服务
  resolvePlaceholders,
  extractPlaceholderTokens,
  getCurrentRolePlaceholderMap,
  getEffectivePlaceholderValues,
  detectCurrentCharacterState,

  // 主题服务
  getCurrentTheme,
  setTheme,
  applyThemeToDOM,
  exportTheme,
  importTheme,
  downloadTheme,
  importThemeFromFile,
  getAvailableThemes,
  getThemeDisplayName,
  isValidTheme,
  getCustomCSS,
  setCustomCSS,
  initTheme,

  // 分类功能
  getCategoryById,
  getCategoryItems,
  getPath,
  getChildCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  moveCategory,
  reorderCategories,
  moveCategoryRelative,
  getCategoryTree,
  hasChildren,
  getDescendantIds,

  // 条目功能
  getItemById,
  getItemsByCategory,
  createItem,
  updateItem,
  deleteItem,
  moveItem,
  reorderItems,
  toggleItemFavorite,
  duplicateItem,
  insertQrContent,

  // 导入导出功能
  exportPackToJson,
  exportPackToJsonSafe,
  exportPackToFile,
  exportPackSubtreeToFile,
  importPackFromJson,
  importPackFromFile,
  validatePack as validatePackData,
  migratePack,
  collectSubtreeIds,
  mergePacks,
  createPackBackup,
  restorePackFromBackup,

  // 设置功能
  getSettings,
  updateSettings,
  getUiSettings,
  updateUiSettings,
  resetSettings,
  getDefaultSettings,
  cloneSettings,
  cloneUiSettings,

  // UI样式
  ensureStyle,
  applyCustomCSS,
  removeStyle,
  refreshStyles,

  // UI组件
  iconSvg,
  renderTopButton,
  createButton,
  registerModalCloseCallback,
  clearModalCloseCallbacks,
  showModal,
  setToastConfig,
  resetToastConfig,
  toast,
  createCard,

  // 工作台UI
  ensureOverlay,
  renderPath,
  renderCategoryTree,
  renderItemGrid,
  renderMainContent,
  renderPreview,
  renderCompactListContent,
  renderCompactList,
  renderToolbar,
  renderSidebar,
  enableResizers,
  renderWorkbench,

  // 预览UI
  highlightPlaceholders,
  renderPreviewPanel,
  updatePreview,
  renderPlaceholderPreview,
  refreshPreviewPanel,
  getPreviewTokens,
  setPreviewTokens,
  addPreviewToken,
  clearPreviewTokens,

  // 事件处理
  isClickSuppressed,
  suppressNextClick,
  handleDragStart,
  handleDragOver,
  handleDrop,
  handleDragEnd,
  handleCategoryClick,
  handleItemClick,
  handleContextMenu,
  bindWorkbenchEvents,
  unbindWorkbenchEvents,
  addTouchLongPress,
  currentDragData,
  cleanupDrag,
  closeContextMenu,

  // 核心功能
  openWorkbench,
  closeWorkbench,
  toggleWorkbench,
  registerTavernButton,
  init,
  cleanup,
  detectCharacter,
  syncPreviewToInput,
};

// ============================================================================
// 自动初始化
// ============================================================================

// 安全初始化：优先使用 jQuery ready，失败时回退到原生时序
const hostDollar = typeof pW === 'object' && pW && '$' in pW ? Reflect.get(pW, '$') : undefined;
if (typeof hostDollar === 'function') {
  hostDollar(() => {
    errorCatched(init)();
  });
} else if (document.readyState === 'loading') {
  window.addEventListener('load', () => {
    errorCatched(init)();
  });
} else {
  errorCatched(init)();
}

// 页面卸载时清理：使用原生事件，避免 $(window) 在特定环境抛错
window.addEventListener('pagehide', () => {
  try {
    if (!isInitialized) return;
    cleanup();
  } catch (error) {
    console.error('[快速回复管理器] pagehide 事件处理出错:', error);
  }
});
