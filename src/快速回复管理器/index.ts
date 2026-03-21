/**
 * 快速回复管理器 - 入口文件
 * @description 主入口，负责初始化、事件绑定和清理
 */

// ============================================================================
// 类型导入
// ============================================================================
import type {
  Pack,
  Category,
  Item,
  DragData,
  AppState,
  QrLlmSettings,
  QrLlmSecretConfig,
  QrLlmPresetStore,
  QrLlmPreset,
  ConnectorButton,
  Settings,
} from './types';

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
import { uid, resolveHostWindow, escapeHtml, getInputValueTrim, asDomElement, getInputBox } from './utils/dom';
import { deepClone, parsePackUpdatedAtMs, nowIso, splitMultiValue, joinMultiValue } from './utils/data';
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
  normalizePromptGroup,
  compileQrLlmPreset,
} from './services/llm';
import {
  resolvePlaceholders,
  extractPlaceholderTokens,
  getCurrentRolePlaceholderMap,
  getEffectivePlaceholderValues,
  detectCurrentCharacterState,
  syncActiveCharacterMapping,
  getExistingCharacterCardsSafe,
  handleActiveCharacterContextChanged,
  getAllWorldbookNamesSafe,
  getCurrentCharacterBoundWorldbookNames,
  getWorldbookEntryOptionsByNames,
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
  createCircularColorPicker,
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
  currentDragData,
  cleanupDrag,
  closeContextMenu,
  runSnapshotReorderDrag,
} from './ui/events';

// ============================================================================
// 本地辅助函数
// ============================================================================

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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.prototype.toString.call(v) === '[object Object]';
}

function parseSimpleYamlObject(text: string): Record<string, unknown> | null {
  const lines = String(text || '').split(/\r?\n/);
  const result: Record<string, unknown> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (!key) continue;
    result[key] = val;
  }
  return Object.keys(result).length > 0 ? result : null;
}

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
  if (!state.pack?.uiState?.panelSize) return;

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
 * 绑定面板内的事件
 * @description 绑定面板内部的点击、拖拽等交互事件
 */
function bindPanelEvents(): void {
  const overlay = pD.getElementById(OVERLAY_ID);
  if (!overlay) return;

  // 工作台事件
  bindWorkbenchEvents();

  // 面板点击事件委托
  overlay.addEventListener('click', e => {
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
      const name = prompt('条目名称');
      if (name) {
        createItem(catId, name.trim(), '');
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
      const name = prompt('条目名称');
      if (name && catId) {
        createItem(catId === '__favorites__' ? null : catId, name.trim(), '');
        renderWorkbench();
      }
      return;
    }
  });

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
 * 显示设置模态框
 * @description 创建设置面板并显示
 */
function showSettingsModal(): void {
  if (!state.pack) return;
  syncActiveCharacterMapping({ silent: true });
  showModal(close => {
    const card = pD.createElement('div');
    card.className = 'fp-modal-card fp-settings-card';

    const placeholders = state.pack!.settings.placeholders || {};
    const rows = ['用户', '角色', '苦主', '黄毛'];
    const customKeys = Object.keys(placeholders).filter(k => !rows.includes(k));
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
    const localCustomPhs: Array<{ originalKey: string; key: string; defaultValue: string }> = customKeys.map(k => ({
      originalKey: k,
      key: k,
      defaultValue: placeholders[k] || k,
    }));
    const localAllRoleMaps: Record<string, Record<string, string>> = deepClone(
      state.pack!.settings.placeholderRoleMaps.byCharacterId || {},
    );
    const localAllRoleMeta: Record<string, { name: string; lastSeenAt: string }> = deepClone(
      state.pack!.settings.placeholderRoleMaps.characterMeta || {},
    );
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
                <div class="fp-ph-top-layout">
                  <aside class="fp-ph-context-card">
                    <div class="fp-ph-context-head">
                      <div class="fp-ph-context-title-wrap">
                        <span class="fp-ph-context-title-dot"></span>
                        <div>
                          <div class="fp-ph-context-caption">Context</div>
                          <div class="fp-ph-context-title">当前上下文</div>
                        </div>
                      </div>
                      <div class="fp-ph-context-badge">已同步</div>
                    </div>
                    <div class="fp-ph-context-grid">
                      <div class="fp-ph-context-item">
                        <div class="fp-ph-context-label">当前角色卡</div>
                        <div class="fp-ph-context-value" data-ph-current-card></div>
                        <div class="fp-ph-context-sub" data-ph-current-card-sub></div>
                      </div>
                      <div class="fp-ph-context-item">
                        <div class="fp-ph-context-label">当前编辑目标</div>
                        <div class="fp-ph-context-value" data-ph-current-edit-target></div>
                        <div class="fp-ph-context-sub" data-ph-current-edit-target-sub></div>
                      </div>
                      <div class="fp-ph-context-item map-overview">
                        <div class="fp-ph-map-head">
                          <div class="fp-ph-map-head-main">
                            <div class="fp-ph-context-label">当前映射</div>
                            <div class="fp-ph-context-value" data-ph-current-map></div>
                            <div class="fp-ph-context-sub" data-ph-current-map-sub></div>
                          </div>
                        </div>
                        <div class="fp-ph-map-preview-wrap">
                          <div class="fp-ph-map-preview" data-ph-map-preview></div>
                          <button type="button" class="fp-ph-map-toggle" data-ph-map-toggle aria-expanded="false" title="展开映射预览">
                            ${iconSvg('chevron-down')}
                          </button>
                        </div>
                        <div class="fp-ph-map-detail" data-ph-map-detail>
                          <div class="fp-ph-map-detail-grid" data-ph-map-detail-grid></div>
                        </div>
                      </div>
                    </div>
                  </aside>
                  <div class="fp-ph-top-fields">
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
                  ${Object.keys(THEME_NAMES)
                    .map(k => `<option value="${k}" ${currentTheme === k ? 'selected' : ''}>${THEME_NAMES[k]}</option>`)
                    .join('')}
                </select>
              </div>
              <div class="fp-row" style="align-items:flex-start"><label>自定义CSS</label><textarea class="fp-textarea" data-custom-css placeholder="输入自定义CSS样式...">${state.pack!.settings.ui.customCSS || ''}</textarea></div>
              <div class="fp-row" style="gap:8px;justify-content:flex-end">
                <button class="fp-btn" data-export-theme>导出主题</button>
                <button class="fp-btn" data-import-theme>导入主题</button>
              </div>
            </div>
            <div class="fp-tab" data-tab="advanced">
              <div class="fp-row"><label>Toast堆叠上限</label><input data-toast-max type="number" min="1" max="8" value="${Number(toastSettings.maxStack || 4)}" /></div>
              <div class="fp-row"><label>Toast时长(ms)</label><input data-toast-timeout type="number" min="600" max="8000" step="100" value="${Number(toastSettings.timeout || 1800)}" /></div>
            </div>
            <div class="fp-tab fp-tab-debug" data-tab="debug">
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
              <div class="fp-row fp-qr-api-row"><label>API URL</label><input data-qr-api-url value="${localQrLlmSecret.url || ''}" placeholder="如：https://api.openai.com/v1" /></div>
              <div class="fp-row fp-qr-api-row"><label>API Key</label><input data-qr-api-key type="password" value="${localQrLlmSecret.apiKey || ''}" placeholder="sk-..." /></div>
              <div class="fp-row fp-qr-api-row"><label>模型列表</label>
                <div style="display:flex;gap:6px;flex:1">
                  <select data-qr-model-select style="flex:1;min-width:0"></select>
                  <button class="fp-btn" data-qr-load-models style="flex:0 0 auto">拉取模型列表</button>
                </div>
              </div>
              <div class="fp-row fp-qr-api-row"><label>模型ID</label><input data-qr-model-manual value="${localQrLlmSecret.manualModelId || localQrLlmSecret.model || ''}" placeholder="可手动填写模型ID" /></div>
              <div class="fp-row fp-row-block fp-qr-api-row"><label>附加参数</label>
                <div style="flex:1;display:flex;flex-direction:column;gap:6px">
                  <textarea class="fp-textarea" data-qr-extra-body-params placeholder="可选，附加到请求体。支持JSON或简易YAML。例如：&#10;reasoning:&#10;  enabled: false&#10;  effort: none&#10;thinking:&#10;  type: disabled"></textarea>
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;white-space:nowrap">
                    <div style="font-size:12px;color:var(--qr-text-2);overflow:hidden;text-overflow:ellipsis">用于传入供应商自定义参数（不参与导出）。</div>
                    <div style="display:flex;align-items:center;gap:8px;flex:0 0 auto">
                    <button class="fp-btn" data-qr-fill-disable-thinking>一键禁用思考</button>
                    <button class="fp-btn" data-qr-test-connect>测试连通性</button>
                    </div>
                  </div>
                </div>
              </div>
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
                  <div class="fp-qr-param-item"><label>temperature</label><input data-qr-temperature type="number" step="0.1" min="0" max="2" value="${Number(localQrLlmSettings.generationParams.temperature ?? 1)}" /></div>
                  <div class="fp-qr-param-item"><label>top_p</label><input data-qr-top-p type="number" step="0.05" min="0" max="1" value="${Number(localQrLlmSettings.generationParams.top_p ?? 1)}" /></div>
                  <div class="fp-qr-param-item"><label>max_tokens</label><input data-qr-max-tokens type="number" step="1" min="16" max="8192" value="${Number(localQrLlmSettings.generationParams.max_tokens ?? 8192)}" /></div>
                  <div class="fp-qr-param-item"><label>presence_penalty</label><input data-qr-presence type="number" step="0.1" min="-2" max="2" value="${Number(localQrLlmSettings.generationParams.presence_penalty ?? 0)}" /></div>
                  <div class="fp-qr-param-item"><label>frequency_penalty</label><input data-qr-frequency type="number" step="0.1" min="-2" max="2" value="${Number(localQrLlmSettings.generationParams.frequency_penalty ?? 0)}" /></div>
                </div>
              </div>
            </div>
            <div class="fp-tab" data-tab="qr-llm-presets">
              <div class="fp-qr-preset-workbench">
                <div class="fp-qr-section">
                  <div class="fp-qr-preset-head">
                    <div class="fp-qr-note">用于扩写执行内容草稿的 Prompt 预设（可导入/导出共享）</div>
                    <div class="fp-qr-preset-tools is-file" aria-label="预设文件操作">
                      <button class="fp-btn fp-qr-preset-action icon-only" data-qr-preset-save title="保存/覆盖" aria-label="保存/覆盖">${iconSvg('save')}</button>
                      <button class="fp-btn fp-qr-preset-action icon-only" data-qr-preset-import title="导入预设" aria-label="导入预设">${iconSvg('upload')}</button>
                      <button class="fp-btn fp-qr-preset-action icon-only" data-qr-preset-export title="导出预设" aria-label="导出预设">${iconSvg('download')}</button>
                    </div>
                  </div>
                  <div class="fp-qr-bar fp-qr-preset-topbar">
                    <select data-qr-preset-select class="fp-select"></select>
                    <div class="fp-qr-preset-tools" aria-label="预设操作">
                      <button class="fp-btn fp-qr-preset-action icon-only" data-qr-preset-new title="新增预设" aria-label="新增预设">${iconSvg('add')}</button>
                      <button class="fp-btn fp-qr-preset-action icon-only" data-qr-preset-rename title="重命名预设" aria-label="重命名预设">${iconSvg('pencil')}</button>
                      <button class="fp-btn fp-qr-preset-action icon-only" data-qr-preset-delete title="删除预设" aria-label="删除预设">${iconSvg('trash')}</button>
                      <button class="fp-btn fp-qr-preset-action icon-only" data-qr-preset-reset-default title="重置默认预设" aria-label="重置默认预设">${iconSvg('undo')}</button>
                    </div>
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
    const qrPresetRenameBtn = card.querySelector('[data-qr-preset-rename]') as HTMLElement | null;
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
      const color =
        level === 'ok' ? '#4caf50' : level === 'warn' ? '#d89614' : level === 'error' ? '#d64848' : 'var(--qr-text-2)';
      qrApiStatusEl.textContent = `状态：${msg}`;
      qrApiStatusEl.style.color = color;
    };

    const renderQrModelSelect = () => {
      if (!qrModelSelectEl) return;
      const current = String(localQrLlmSecret.manualModelId || localQrLlmSecret.model || '').trim();
      const models = [...new Set((state.qrLlmModelList || []).map(x => String(x || '').trim()).filter(Boolean))];
      qrModelSelectEl.innerHTML = '<option value="">手动模型ID</option>';
      models.forEach(model => {
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
      const stPresetObj =
        obj.sillytavern_prompt_preset && typeof obj.sillytavern_prompt_preset === 'object'
          ? (obj.sillytavern_prompt_preset as Record<string, unknown>)
          : null;
      const firstNonEmpty = (...values: unknown[]): string => {
        for (const value of values) {
          const text = String(value ?? '').trim();
          if (text) return text;
        }
        return '';
      };
      const name = firstNonEmpty(
        obj.name,
        obj.presetName,
        obj.preset_name,
        obj.title,
        obj.preset,
        obj.preset_title,
        stPresetObj?.name,
        stPresetObj?.presetName,
        stPresetObj?.preset_name,
        stPresetObj?.title,
        fallbackName,
      );
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
        const enabledPrompts = prompts.filter(p => p.enabled !== false);
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

        enabledPrompts.forEach(p => {
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
          Object.keys(varMap).forEach(key => {
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

        return prompts.map(p => {
          const rawContent = String(p.content || '');
          const stripped = renderExpandedContent(rawContent);
          const roleUpper = String(p.role || '').toUpperCase();
          const role: 'SYSTEM' | 'USER' | 'ASSISTANT' =
            roleUpper === 'ASSISTANT' ? 'ASSISTANT' : roleUpper === 'SYSTEM' ? 'SYSTEM' : 'USER';
          return {
            id: String(p.identifier || uid('qrp')),
            role,
            name: String(p.name || p.identifier || 'Prompt'),
            note: String(p.name || p.identifier || 'Prompt'),
            enabled: p.enabled !== false,
            position: Number(p.injection_position || 0) === 1 ? ('CHAT' as const) : ('RELATIVE' as const),
            injectionDepth: Number(p.injection_depth ?? 4),
            injectionOrder: Number(p.injection_order ?? 100),
            marker: Boolean(p.marker),
            forbidOverrides: Boolean(p.forbid_overrides),
            content: stripped || rawContent,
          };
        });
      };

      const stPrompts = Array.isArray(obj.prompts)
        ? obj.prompts
        : Array.isArray(stPresetObj?.prompts)
          ? stPresetObj.prompts
          : null;
      if (!promptGroup.length && Array.isArray(stPrompts)) {
        promptGroup = expandStVars(
          stPrompts as Array<{
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
        );
      }
      if (!userPromptTemplate) {
        userPromptTemplate = String(obj.userTemplate || obj.userPrompt || '').trim();
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

    const listLocalPresetNames = () =>
      Object.keys(localQrLlmPresetStore.presets || {}).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    const persistLocalQrLlmPresetChanges = (): void => {
      localQrLlmSettings.presetStore = normalizeQrLlmPresetStore(localQrLlmPresetStore);
      if (
        !localQrLlmSettings.activePresetName ||
        !localQrLlmSettings.presetStore.presets[localQrLlmSettings.activePresetName]
      ) {
        localQrLlmSettings.activePresetName = DEFAULT_QR_LLM_PRESET_NAME;
      }
      state.pack!.settings.qrLlm = deepClone(localQrLlmSettings);
      persistPack();
    };

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
      const esc = (v: string) =>
        String(v || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      const roleText = (role: 'SYSTEM' | 'USER' | 'ASSISTANT') =>
        role === 'SYSTEM' ? '系统段' : role === 'USER' ? '用户段' : 'AI助手段';
      localPromptGroupDraft.forEach((seg, idx) => {
        const row = pD.createElement('div');
        row.className = `fp-qr-seg-row ${seg.enabled === false ? 'is-disabled' : ''}`;
        row.setAttribute('data-qr-seg-row', String(idx));
        row.innerHTML = `
            <button class="fp-qr-drag-handle" data-qr-seg-drag-handle="${idx}" title="拖拽排序" aria-label="拖拽排序">
              <span class="fp-qr-drag-handle-dots" aria-hidden="true">
                <span></span><span></span>
                <span></span><span></span>
                <span></span><span></span>
              </span>
            </button>
            <div class="fp-qr-seg-main">
              <div class="fp-qr-seg-note">${esc(seg.name || seg.note || `${roleText(seg.role)} ${idx + 1}`)}</div>
            </div>
            <div class="fp-qr-seg-ops">
              <button class="fp-btn icon-only" data-qr-seg-edit="${idx}" title="编辑">${iconSvg('pencil')}</button>
              <button class="fp-btn icon-only" data-qr-seg-add-after="${idx}" title="复制">${iconSvg('copy')}</button>
              <button class="fp-btn icon-only" data-qr-seg-up="${idx}" title="上移">${iconSvg('chevron-up')}</button>
              <button class="fp-btn icon-only" data-qr-seg-down="${idx}" title="下移">${iconSvg('chevron-down')}</button>
              <button class="fp-btn icon-only" data-qr-seg-del="${idx}" title="删除" style="color:#c44">${iconSvg('trash')}</button>
            </div>
            <button class="fp-qr-seg-switch ${seg.enabled !== false ? 'is-on' : ''}" data-qr-seg-toggle="${idx}" title="${seg.enabled !== false ? '已启用，点击禁用' : '已禁用，点击启用'}" aria-pressed="${seg.enabled !== false ? 'true' : 'false'}"></button>
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
      showModal(
        closeSeg => {
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
            <div class="fp-seg-edit-row"><label>提示词</label><textarea class="fp-textarea" data-seg-content placeholder="输入该段的完整提示词"></textarea></div>
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
          const segCloseBtn = segCard.querySelector('[data-close]') as HTMLElement | null;
          if (segCloseBtn) segCloseBtn.onclick = closeSeg;
          const segSaveBtn = segCard.querySelector('[data-save]') as HTMLElement | null;
          if (segSaveBtn)
            segSaveBtn.onclick = () => {
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
              localPromptGroupDraft[idx].role = roleVal === 'USER' || roleVal === 'ASSISTANT' ? roleVal : 'SYSTEM';
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
        },
        { replace: false },
      );
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
      const presetNames = listLocalPresetNames().filter(x => x !== fromName);
      if (!presetNames.length) {
        toast('至少需要另一个预设作为目标');
        return;
      }
      showModal(
        closeTransfer => {
          const tf = pD.createElement('div');
          tf.className = 'fp-modal-card';
          tf.style.width = 'min(760px,94vw)';
          tf.style.maxHeight = '84vh';
          const esc = (v: string) =>
            String(v || '')
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
                ${presetNames.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}
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
            listEl.innerHTML = localPromptGroupDraft
              .map((seg, idx) => {
                const title = String(seg.name || seg.note || `条目${idx + 1}`);
                const brief = String(seg.content || '')
                  .replace(/\s+/g, ' ')
                  .slice(0, 72);
                return `
                <label style="display:flex;gap:8px;align-items:flex-start;padding:7px 6px;border-radius:8px">
                  <input type="checkbox" data-qr-transfer-item="${idx}" />
                  <div style="min-width:0">
                    <div style="font-size:13px;font-weight:600">${esc(title)}</div>
                    <div style="font-size:12px;color:var(--qr-text-2)">${esc(brief || '(空内容)')}</div>
                  </div>
                </label>
              `;
              })
              .join('');
          }
          const transferAllBtn = tf.querySelector('[data-qr-transfer-all]') as HTMLElement | null;
          if (transferAllBtn)
            transferAllBtn.onclick = () => {
              tf.querySelectorAll<HTMLInputElement>('[data-qr-transfer-item]').forEach(el => {
                el.checked = true;
              });
            };
          const transferNoneBtn = tf.querySelector('[data-qr-transfer-none]') as HTMLElement | null;
          if (transferNoneBtn)
            transferNoneBtn.onclick = () => {
              tf.querySelectorAll<HTMLInputElement>('[data-qr-transfer-item]').forEach(el => {
                el.checked = false;
              });
            };
          const transferCloseBtn = tf.querySelector('[data-close]') as HTMLElement | null;
          if (transferCloseBtn) transferCloseBtn.onclick = closeTransfer;
          const transferSubmitBtn = tf.querySelector('[data-submit]') as HTMLElement | null;
          if (transferSubmitBtn)
            transferSubmitBtn.onclick = () => {
              const targetName = String(
                (tf.querySelector('[data-qr-transfer-target]') as HTMLSelectElement | null)?.value || '',
              ).trim();
              const mode = String(
                (tf.querySelector('[data-qr-transfer-mode]') as HTMLSelectElement | null)?.value || 'copy',
              ).trim();
              if (!targetName) {
                toast('请选择目标预设');
                return;
              }
              if (targetName === fromName) {
                toast('目标预设不能与源预设相同');
                return;
              }
              const selectedIdx = [...tf.querySelectorAll<HTMLInputElement>('[data-qr-transfer-item]')]
                .filter(el => el.checked)
                .map(el => Number(el.getAttribute('data-qr-transfer-item')))
                .filter(n => Number.isInteger(n) && n >= 0 && n < localPromptGroupDraft.length);
              if (!selectedIdx.length) {
                toast('请至少选择一个条目');
                return;
              }

              const picked = selectedIdx.map(idx => ({ ...deepClone(localPromptGroupDraft[idx]), id: uid('qrp') }));
              const targetCompiled = compileQrLlmPreset(
                localQrLlmPresetStore.presets[targetName] || {
                  systemPrompt: '你是执行内容扩写助手。',
                  userPromptTemplate: '{{draft}}',
                  updatedAt: nowIso(),
                },
              );
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
                sorted.forEach(idx => {
                  localPromptGroupDraft.splice(idx, 1);
                });
                localQrLlmPresetStore.presets[fromName] = compileQrLlmPreset({
                  systemPrompt: '',
                  userPromptTemplate: '',
                  promptGroup: localPromptGroupDraft,
                  finalSystemDirective: '',
                  updatedAt: nowIso(),
                });
                renderPromptGroupEditor();
                compileDraftToFields();
              }
              persistLocalQrLlmPresetChanges();
              toast(`已${mode === 'move' ? '移动' : '复制'} ${selectedIdx.length} 条到「${targetName}」`);
              closeTransfer();
            };
          return tf;
        },
        { replace: false },
      );
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
      if (!localPromptGroupDraft.length) {
        const defPreset = buildDefaultQrLlmPresetStore().presets[DEFAULT_QR_LLM_PRESET_NAME];
        localPromptGroupDraft = normalizePromptGroup(defPreset.promptGroup);
        if (!localPromptGroupDraft.length) {
          localPromptGroupDraft = [
            {
              id: uid('qrp'),
              role: 'SYSTEM',
              name: '系统段',
              note: '系统段',
              position: 'RELATIVE',
              enabled: true,
              injectionDepth: 4,
              injectionOrder: 100,
              content: normalizedPreset.systemPrompt || '',
            },
            {
              id: uid('qrp'),
              role: 'USER',
              name: 'Main Prompt',
              note: 'Main Prompt',
              position: 'RELATIVE',
              enabled: true,
              injectionDepth: 4,
              injectionOrder: 100,
              content: normalizedPreset.userPromptTemplate || '',
            },
          ];
        }
      }
      renderPromptGroupEditor();
    };

    const renderQrPresetSelect = (prefer?: string) => {
      if (!qrPresetSelectEl) return;
      const names = listLocalPresetNames();
      qrPresetSelectEl.innerHTML = '';
      names.forEach(name => {
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
    if (
      !localQrLlmSettings.activePresetName ||
      !localQrLlmSettings.presetStore.presets[localQrLlmSettings.activePresetName]
    ) {
      localQrLlmSettings.activePresetName = DEFAULT_QR_LLM_PRESET_NAME;
    }
    if (localQrLlmSecret.model && !localQrLlmSecret.manualModelId)
      localQrLlmSecret.manualModelId = localQrLlmSecret.model;
    if (localQrLlmSecret.manualModelId && !localQrLlmSecret.model)
      localQrLlmSecret.model = localQrLlmSecret.manualModelId;
    if (localQrLlmSecret.model && !state.qrLlmModelList.includes(localQrLlmSecret.model)) {
      state.qrLlmModelList = [...state.qrLlmModelList, localQrLlmSecret.model];
    }
    renderQrModelSelect();
    if (qrModelManualEl) qrModelManualEl.value = localQrLlmSecret.manualModelId || localQrLlmSecret.model || '';
    renderQrPresetSelect(localQrLlmSettings.activePresetName);
    updateQrApiStatus(
      localQrLlmSecret.url
        ? `已设置URL${localQrLlmSecret.model ? `，当前模型：${localQrLlmSecret.model}` : '，未选模型'}`
        : '待配置',
    );
    const isDebugNearBottom = (el: HTMLElement, threshold = 24): boolean => {
      return el.scrollHeight - (el.scrollTop + el.clientHeight) <= threshold;
    };
    let debugAutoScroll = true;
    if (debugConsoleEl) {
      debugConsoleEl.addEventListener('scroll', () => {
        debugAutoScroll = isDebugNearBottom(debugConsoleEl);
      });
    }
    const renderDebugConsole = (forceBottom = false) => {
      if (!debugConsoleEl) return;
      const shouldStickBottom = forceBottom || debugAutoScroll || isDebugNearBottom(debugConsoleEl);
      const text = state.debugLogs.length ? getDebugLogText() : '[暂无日志]';
      debugConsoleEl.textContent = text;
      if (shouldStickBottom) debugConsoleEl.scrollTop = debugConsoleEl.scrollHeight;
    };
    renderDebugConsole(true);
    if (debugClearBtn) {
      debugClearBtn.onclick = () => {
        state.debugLogs = [];
        renderDebugConsole(true);
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
          await copyTextRobust(text);
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

    if (qrApiUrlEl)
      qrApiUrlEl.oninput = () => {
        localQrLlmSecret.url = String(qrApiUrlEl.value || '').trim();
      };
    if (qrApiKeyEl)
      qrApiKeyEl.oninput = () => {
        localQrLlmSecret.apiKey = String(qrApiKeyEl.value || '');
      };
    if (qrExtraBodyParamsEl)
      qrExtraBodyParamsEl.oninput = () => {
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
    if (qrModelSelectEl)
      qrModelSelectEl.onchange = () => {
        const val = String(qrModelSelectEl.value || '').trim();
        if (val) {
          localQrLlmSecret.model = val;
          localQrLlmSecret.manualModelId = val;
          if (qrModelManualEl) qrModelManualEl.value = val;
        }
        updateQrApiStatus(val ? `模型已选择：${val}` : '请选择或手动填写模型', val ? 'ok' : 'warn');
      };
    if (qrModelManualEl)
      qrModelManualEl.oninput = () => {
        const val = String(qrModelManualEl.value || '').trim();
        localQrLlmSecret.manualModelId = val;
        localQrLlmSecret.model = val;
        if (qrModelSelectEl) {
          const has = [...qrModelSelectEl.options].some(x => x.value === val);
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
        const model = String(
          qrModelManualEl?.value || localQrLlmSecret.manualModelId || localQrLlmSecret.model || '',
        ).trim();
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
        persistLocalQrLlmPresetChanges();
      };
    }
    if (qrPromptGroupListEl) {
      qrPromptGroupListEl.onpointerdown = ev => {
        const target = ev.target as HTMLElement | null;
        const handle = target?.closest('[data-qr-seg-drag-handle]') as HTMLElement | null;
        if (!handle || ev.button !== 0) return;
        const row = handle.closest('[data-qr-seg-row]') as HTMLElement | null;
        if (!row) return;
        const idx = Number(row.getAttribute('data-qr-seg-row'));
        if (!Number.isInteger(idx) || idx < 0 || idx >= localPromptGroupDraft.length) return;
        ev.preventDefault();
        if (isClickSuppressed()) return;
        runSnapshotReorderDrag<HTMLElement>({
          startEvent: ev,
          sourceEl: row,
          containerEl: qrPromptGroupListEl,
          scrollHost: qrPromptGroupListEl,
          createPlaceholder: () => {
            const placeholder = row.cloneNode(true) as HTMLElement;
            placeholder.classList.remove('is-dragging');
            placeholder.classList.add('fp-qr-seg-placeholder');
            placeholder.removeAttribute('data-qr-seg-row');
            placeholder.querySelectorAll('button').forEach(btn => {
              btn.setAttribute('tabindex', '-1');
              btn.setAttribute('aria-hidden', 'true');
            });
            return placeholder;
          },
          getSnapshotElements: () =>
            Array.from(qrPromptGroupListEl.querySelectorAll('[data-qr-seg-row]')).filter(
              el => el !== row,
            ) as HTMLElement[],
          resolvePlacement: ({ event, snapshots }) => {
            for (const snap of snapshots) {
              if (event.clientY < snap.rect.centerY) {
                return {
                  dropIndex: snap.index,
                  placementKey: `seg:${snap.index}`,
                  insertBeforeEl: snap.el,
                };
              }
            }
            return {
              dropIndex: snapshots.length,
              placementKey: 'seg:end',
            };
          },
          onDragStart: () => {
            row.classList.add('is-dragging');
          },
          onCleanup: () => {
            row.classList.remove('is-dragging');
          },
          onDrop: (finalDropIndex, didDrag) => {
            if (!didDrag) return;
            let toIndex = finalDropIndex;
            if (toIndex > idx) toIndex -= 1;
            if (toIndex < 0) toIndex = 0;
            if (toIndex >= localPromptGroupDraft.length) toIndex = localPromptGroupDraft.length - 1;
            if (toIndex === idx) return;
            const [moved] = localPromptGroupDraft.splice(idx, 1);
            localPromptGroupDraft.splice(toIndex, 0, moved);
            renderPromptGroupEditor();
            compileDraftToFields();
          },
        });
      };
      qrPromptGroupListEl.onclick = ev => {
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
          const source = deepClone(
            localPromptGroupDraft[addIdx] || {
              role: 'USER' as const,
              name: '新条目',
              note: '新条目',
              position: 'RELATIVE' as const,
              enabled: true,
              injectionDepth: 4,
              injectionOrder: 100,
              content: '',
            },
          );
          localPromptGroupDraft.splice(addIdx + 1, 0, {
            ...source,
            id: uid('qrp'),
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
        const toggleIdx = getSegIndex(btn, 'data-qr-seg-toggle');
        if (toggleIdx >= 0) {
          localPromptGroupDraft[toggleIdx].enabled = localPromptGroupDraft[toggleIdx].enabled === false;
          renderPromptGroupEditor();
          compileDraftToFields();
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
          const base = compileQrLlmPreset(
            localQrLlmPresetStore.presets[DEFAULT_QR_LLM_PRESET_NAME] || {
              systemPrompt: '你是执行内容扩写助手。',
              userPromptTemplate: '{{draft}}',
              updatedAt: nowIso(),
            },
          );
          localQrLlmPresetStore.presets[name] = deepClone(base);
          localQrLlmPresetStore.presets[name].updatedAt = nowIso();
        }
        localQrLlmSettings.activePresetName = name;
        renderQrPresetSelect(name);
        persistLocalQrLlmPresetChanges();
        toast(`已创建预设：${name}`);
      };
    }
    if (qrPresetRenameBtn) {
      qrPresetRenameBtn.onclick = () => {
        const selected = String(qrPresetSelectEl?.value || localQrLlmSettings.activePresetName || '').trim();
        if (!selected) {
          toast('请先选择预设');
          return;
        }
        if (selected === DEFAULT_QR_LLM_PRESET_NAME) {
          toast('默认预设不可重命名');
          return;
        }
        const draftName = prompt('输入新的预设名称', selected);
        const nextName = String(draftName || '').trim();
        if (!nextName || nextName === selected) return;
        if (nextName === DEFAULT_QR_LLM_PRESET_NAME) {
          toast('该名称已被默认预设占用');
          return;
        }
        if (localQrLlmPresetStore.presets[nextName]) {
          toast('同名预设已存在');
          return;
        }
        const preset = localQrLlmPresetStore.presets[selected];
        if (!preset) {
          toast('当前预设不存在');
          return;
        }
        localQrLlmPresetStore.presets[nextName] = compileQrLlmPreset({
          ...deepClone(preset),
          updatedAt: nowIso(),
        });
        delete localQrLlmPresetStore.presets[selected];
        localQrLlmSettings.activePresetName = nextName;
        renderQrPresetSelect(nextName);
        persistLocalQrLlmPresetChanges();
        toast(`预设已重命名：${selected} → ${nextName}`);
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
        persistLocalQrLlmPresetChanges();
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
        const defaultStore = buildDefaultQrLlmPresetStore();
        const def = defaultStore.presets[DEFAULT_QR_LLM_PRESET_NAME];
        localQrLlmPresetStore.defaultPresetVersion = defaultStore.defaultPresetVersion;
        localQrLlmPresetStore.presets[DEFAULT_QR_LLM_PRESET_NAME] = deepClone(def);
        localQrLlmSettings.activePresetName = DEFAULT_QR_LLM_PRESET_NAME;
        renderQrPresetSelect(DEFAULT_QR_LLM_PRESET_NAME);
        loadSelectedPresetToForm(DEFAULT_QR_LLM_PRESET_NAME);
        persistLocalQrLlmPresetChanges();
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
        persistLocalQrLlmPresetChanges();
        toast(`预设已保存：${name}`);
      };
    }
    if (qrPresetExportBtn) {
      qrPresetExportBtn.onclick = () => {
        const selected = String(qrPresetSelectEl?.value || localQrLlmSettings.activePresetName || '').trim();
        const selectedPreset = selected ? localQrLlmPresetStore.presets[selected] : null;
        const stPrompts = selectedPreset
          ? normalizePromptGroup(selectedPreset.promptGroup).map(seg => ({
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
            const fileBaseName = String(file.name || '')
              .replace(/\.[^.]+$/, '')
              .trim();
            const text = await file.text();
            const parsed = JSON.parse(text);
            const imported: Array<{ name: string; preset: QrLlmPreset }> = [];
            if (
              parsed &&
              typeof parsed === 'object' &&
              !Array.isArray(parsed) &&
              Number((parsed as Record<string, unknown>).version) === 1 &&
              typeof (parsed as Record<string, unknown>).presets === 'object'
            ) {
              const presetsMap = ((parsed as Record<string, unknown>).presets || {}) as Record<string, unknown>;
              Object.entries(presetsMap).forEach(([name, raw]) => {
                const hit = normalizeImportedPreset({ ...(raw as Record<string, unknown>), name }, name);
                if (hit) imported.push(hit);
              });
            } else if (Array.isArray(parsed)) {
              parsed.forEach((raw, idx) => {
                const hit = normalizeImportedPreset(raw, fileBaseName || `导入预设_${idx + 1}`);
                if (hit) imported.push(hit);
              });
            } else {
              const hit = normalizeImportedPreset(parsed, fileBaseName || `导入预设_${Date.now()}`);
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
            persistLocalQrLlmPresetChanges();
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
            <input data-conn-label="${idx}" value="${escapeHtml(conn.label)}" placeholder="名称" style="width:80px;padding:6px 8px;border:1px solid rgba(24,24,27,.18);border-radius:8px;font-size:12px;text-align:center" />
            <input data-conn-token="${idx}" value="${escapeHtml(conn.token)}" placeholder="插入内容" style="flex:1;padding:6px 8px;border:1px solid rgba(24,24,27,.18);border-radius:8px;font-size:12px" />
            <div data-conn-color-picker="${idx}" style="display:flex;align-items:center"></div>
            <button class="fp-btn icon-only" data-del-conn="${idx}" title="删除" style="padding:4px 8px;font-size:14px;color:#c44">✕</button>
          `;
        listEl.appendChild(row);
        const colorHost = row.querySelector(`[data-conn-color-picker="${idx}"]`) as HTMLElement | null;
        if (colorHost) {
          const options = Object.keys(CONNECTOR_COLOR_HEX);
          const initColor = options.includes(conn.color) ? conn.color : 'orange';
          conn.color = initColor;
          colorHost.appendChild(
            createCircularColorPicker({
              value: initColor,
              options,
              getColor: v => CONNECTOR_COLOR_HEX[v] || CONNECTOR_COLOR_HEX.orange,
              getTitle: v => CONNECTOR_COLOR_NAMES[v] || v,
              onChange: v => {
                conn.color = v;
              },
            }),
          );
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
    const currentCardEl = card.querySelector('[data-ph-current-card]') as HTMLElement | null;
    const currentCardSubEl = card.querySelector('[data-ph-current-card-sub]') as HTMLElement | null;
    const currentEditTargetEl = card.querySelector('[data-ph-current-edit-target]') as HTMLElement | null;
    const currentEditTargetSubEl = card.querySelector('[data-ph-current-edit-target-sub]') as HTMLElement | null;
    const currentMapEl = card.querySelector('[data-ph-current-map]') as HTMLElement | null;
    const currentMapSubEl = card.querySelector('[data-ph-current-map-sub]') as HTMLElement | null;
    const currentMapPreviewEl = card.querySelector('[data-ph-map-preview]') as HTMLElement | null;
    const currentMapDetailEl = card.querySelector('[data-ph-map-detail]') as HTMLElement | null;
    const currentMapDetailGridEl = card.querySelector('[data-ph-map-detail-grid]') as HTMLElement | null;
    const currentMapToggleBtn = card.querySelector('[data-ph-map-toggle]') as HTMLButtonElement | null;
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
      return existing.map(card => ({
        id: card.id,
        name: String(localAllRoleMeta[card.id]?.name || card.name || card.id),
      }));
    };

    const renderRoleSelector = () => {
      if (!roleSelectorEl) return;
      const options = getRoleSelectorOptions();
      const validIds = new Set<string>(options.map(x => x.id));
      if (selectedRoleOption !== ROLE_DEFAULT_OPTION && selectedRoleOption && !validIds.has(selectedRoleOption)) {
        selectedRoleOption = ROLE_DEFAULT_OPTION;
        loadRoleValuesBySelection();
      }
      roleSelectorEl.innerHTML = [
        `<option value="${escapeHtml(ROLE_DEFAULT_OPTION)}" ${selectedRoleOption === ROLE_DEFAULT_OPTION ? 'selected' : ''}>默认</option>`,
        ...options.map(({ id, name }) => {
          return `<option value="${escapeHtml(id)}" ${selectedRoleOption === id ? 'selected' : ''}>${escapeHtml(name)}（${escapeHtml(id)}）</option>`;
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

    const getRoleDisplayName = (roleId: string): string => {
      return String(
        localAllRoleMeta[roleId]?.name ||
          (roleId === state.activeCharacterId ? state.activeCharacterName : '') ||
          roleId,
      );
    };
    let mapOverviewExpanded = false;

    const measureMapChipWidth = (key: string, value: string, overflowText?: string) => {
      const measureHost = pD.createElement('div');
      measureHost.style.position = 'fixed';
      measureHost.style.left = '-99999px';
      measureHost.style.top = '0';
      measureHost.style.visibility = 'hidden';
      measureHost.style.pointerEvents = 'none';
      measureHost.style.whiteSpace = 'nowrap';
      const chip = pD.createElement('span');
      chip.className = `fp-ph-map-chip${overflowText ? ' is-overflow' : ''}`;
      if (overflowText) {
        chip.textContent = overflowText;
      } else {
        chip.innerHTML = `<span class="fp-ph-map-chip-key">${escapeHtml(key)}</span><span class="fp-ph-map-chip-sep"></span><span class="fp-ph-map-chip-val">${escapeHtml(value)}</span>`;
      }
      measureHost.appendChild(chip);
      (pD.body || pD.documentElement).appendChild(measureHost);
      const width = Math.ceil(chip.getBoundingClientRect().width);
      measureHost.remove();
      return width;
    };

    const getAdaptiveMapPreviewCount = (pairs: Array<{ key: string; value: string }>) => {
      const hostWidth = Math.max(
        currentMapPreviewEl?.clientWidth || 0,
        currentMapPreviewEl?.parentElement?.clientWidth || 0,
        280,
      );
      const gap = 6;
      const overflowChipWidth = measureMapChipWidth('', '', '+99');
      const maxRows = 2;
      let used = 0;
      let row = 1;
      let count = 0;
      for (let i = 0; i < pairs.length; i += 1) {
        const remainingAfterThis = pairs.length - (i + 1);
        const chipWidth = measureMapChipWidth(pairs[i].key, pairs[i].value);
        const chipGap = used > 0 ? gap : 0;
        const reservedOverflow = remainingAfterThis > 0 ? (used > 0 ? gap : 0) + overflowChipWidth : 0;
        if (used + chipGap + chipWidth + reservedOverflow <= hostWidth) {
          used += chipGap + chipWidth;
          count += 1;
          continue;
        }
        if (row >= maxRows) break;
        row += 1;
        used = chipWidth;
        count += 1;
      }
      return Math.max(1, count);
    };

    const renderCurrentMapOverview = (activeMapRoleId: string, selectedValues: Record<string, string>) => {
      const preferredKeys = [...rows, ...Object.keys(placeholders).filter(k => !rows.includes(k))];
      const uniqueKeys = [...new Set(preferredKeys.filter(Boolean))];
      const pairs = uniqueKeys.map(key => ({
        key,
        value: String(selectedValues[key] || placeholders[key] || key),
      }));
      if (currentMapPreviewEl) {
        const previewCount = getAdaptiveMapPreviewCount(pairs);
        const summaryPairs = pairs.slice(0, previewCount);
        const overflowCount = Math.max(0, pairs.length - summaryPairs.length);
        currentMapPreviewEl.innerHTML = [
          ...summaryPairs.map(
            pair => `
            <span class="fp-ph-map-chip" title="${escapeHtml(pair.key)} = ${escapeHtml(pair.value)}">
              <span class="fp-ph-map-chip-key">${escapeHtml(pair.key)}</span>
              <span class="fp-ph-map-chip-sep"></span>
              <span class="fp-ph-map-chip-val">${escapeHtml(pair.value)}</span>
            </span>
          `,
          ),
          overflowCount > 0
            ? `<span class="fp-ph-map-chip is-overflow" title="还有 ${overflowCount} 个变量">+${overflowCount}</span>`
            : '',
        ].join('');
      }
      if (currentMapDetailGridEl) {
        currentMapDetailGridEl.innerHTML = pairs
          .map(
            pair => `
            <div class="fp-ph-map-detail-row" title="${escapeHtml(pair.key)} = ${escapeHtml(pair.value)}">
              <span class="fp-ph-map-detail-key">${escapeHtml(pair.key)}</span>
              <span class="fp-ph-map-detail-sep"></span>
              <span class="fp-ph-map-detail-val">${escapeHtml(pair.value)}</span>
            </div>
          `,
          )
          .join('');
      }
      if (currentMapDetailEl) currentMapDetailEl.classList.toggle('is-open', mapOverviewExpanded);
      if (currentMapToggleBtn) {
        const isTruncated = pairs.length > getAdaptiveMapPreviewCount(pairs);
        currentMapToggleBtn.hidden = !isTruncated;
        currentMapToggleBtn.setAttribute('aria-expanded', mapOverviewExpanded ? 'true' : 'false');
        currentMapToggleBtn.title = mapOverviewExpanded
          ? '收起映射预览'
          : activeMapRoleId === ROLE_DEFAULT_OPTION
            ? '展开默认映射预览'
            : '展开当前角色映射预览';
      }
    };

    const refreshContextLabel = () => {
      if (!contextEl) return;
      if (selectedRoleOption === ROLE_DEFAULT_OPTION) {
        contextEl.textContent = '编辑目标：默认占位符值';
        return;
      }
      const displayName = getRoleDisplayName(selectedRoleOption);
      contextEl.textContent = `编辑目标：${displayName}（${selectedRoleOption}）`;
    };

    const refreshContextPanel = () => {
      const activeMapRoleId =
        !state.activeIsGroupChat && state.activeCharacterId ? state.activeCharacterId : ROLE_DEFAULT_OPTION;
      const activeMapDisplayName =
        activeMapRoleId === ROLE_DEFAULT_OPTION ? '默认占位符 MAP' : getRoleDisplayName(activeMapRoleId);
      const editingDisplayName =
        selectedRoleOption === ROLE_DEFAULT_OPTION ? '默认占位符 MAP' : getRoleDisplayName(selectedRoleOption);
      const activeMapValues =
        activeMapRoleId === ROLE_DEFAULT_OPTION
          ? getEffectivePlaceholderValues(placeholders, null)
          : getEffectivePlaceholderValues(
              placeholders,
              state.pack?.settings?.placeholderRoleMaps?.byCharacterId?.[activeMapRoleId] || null,
            );
      if (currentCardEl) {
        if (state.activeIsGroupChat) {
          currentCardEl.textContent = '群聊模式';
          currentCardEl.classList.remove('is-placeholder');
        } else if (state.activeCharacterId) {
          currentCardEl.textContent = getRoleDisplayName(state.activeCharacterId);
          currentCardEl.classList.remove('is-placeholder');
        } else {
          currentCardEl.textContent = '未识别到当前角色';
          currentCardEl.classList.add('is-placeholder');
        }
      }
      if (currentCardSubEl) {
        if (state.activeIsGroupChat) {
          currentCardSubEl.textContent = '群聊模式';
          currentCardSubEl.classList.remove('is-placeholder');
        } else if (state.activeCharacterId) {
          currentCardSubEl.textContent = state.activeCharacterId;
          currentCardSubEl.classList.remove('is-placeholder');
        } else {
          currentCardSubEl.textContent = '等待检测当前酒馆角色卡。';
          currentCardSubEl.classList.add('is-placeholder');
        }
      }
      if (currentEditTargetEl) {
        currentEditTargetEl.textContent = editingDisplayName;
        currentEditTargetEl.classList.remove('is-placeholder');
      }
      if (currentEditTargetSubEl) {
        currentEditTargetSubEl.textContent =
          selectedRoleOption === ROLE_DEFAULT_OPTION
            ? '默认占位符'
            : `${selectedRoleOption}${selectedRoleOption === state.activeCharacterId ? ' · 当前角色' : ' · 单独编辑'}`;
        currentEditTargetSubEl.classList.remove('is-placeholder');
      }
      if (currentMapEl) {
        currentMapEl.textContent = activeMapDisplayName;
        currentMapEl.classList.remove('is-placeholder');
      }
      if (currentMapSubEl) {
        if (activeMapRoleId === ROLE_DEFAULT_OPTION) {
          currentMapSubEl.textContent =
            selectedRoleOption === ROLE_DEFAULT_OPTION
              ? '当前会话读取默认值'
              : `当前会话读取默认值 · 正在编辑 ${editingDisplayName}`;
        } else {
          currentMapSubEl.textContent =
            selectedRoleOption === activeMapRoleId
              ? `${activeMapRoleId} · 当前会话使用中`
              : `${activeMapRoleId} · 会话使用中 / 编辑目标：${editingDisplayName}`;
        }
        currentMapSubEl.classList.remove('is-placeholder');
      }
      renderCurrentMapOverview(activeMapRoleId, activeMapValues);
    };

    if (selectedRoleOption !== ROLE_DEFAULT_OPTION) {
      if (!localAllRoleMeta[selectedRoleOption]) {
        localAllRoleMeta[selectedRoleOption] = {
          name:
            selectedRoleOption === state.activeCharacterId
              ? state.activeCharacterName || selectedRoleOption
              : selectedRoleOption,
          lastSeenAt: nowIso(),
        };
      }
    }
    loadRoleValuesBySelection();
    renderRoleSelector();
    refreshContextLabel();
    refreshContextPanel();
    if (currentMapToggleBtn) {
      currentMapToggleBtn.onclick = () => {
        mapOverviewExpanded = !mapOverviewExpanded;
        refreshContextPanel();
      };
    }

    const getValidSelectedValues = (selectedValue: string): string[] => {
      const selectedValues = splitMultiValue(selectedValue);
      const validValues = new Set<string>(worldbookOptions.map(x => x.value));
      return selectedValues.filter(v => validValues.has(v));
    };

    const mountValueMultiPicker = (
      host: HTMLElement,
      defaultValue: string,
      selectedValue: string,
      onChange: (value: string) => void,
    ) => {
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
        defaultBtn.innerHTML = `<input type="checkbox" ${selected.length ? '' : 'checked'} />`;
        const defaultSpan = pD.createElement('span');
        defaultSpan.textContent = `默认值（${defaultValue || '空'}）`;
        defaultBtn.appendChild(defaultSpan);
        defaultBtn.onclick = () => {
          selected = [];
          setTriggerText();
          emit();
          renderOptions();
        };
        list.appendChild(defaultBtn);
        worldbookOptions.forEach(opt => {
          const active = selected.includes(opt.value);
          const btn = pD.createElement('button');
          btn.type = 'button';
          btn.className = `fp-multi-opt ${active ? 'active' : ''}`;
          btn.innerHTML = `<input type="checkbox" ${active ? 'checked' : ''} />`;
          const optSpan = pD.createElement('span');
          optSpan.textContent = opt.label;
          btn.appendChild(optSpan);
          btn.onclick = () => {
            if (selected.includes(opt.value)) selected = selected.filter(v => v !== opt.value);
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
      trigger.onclick = e => {
        e.preventDefault();
        e.stopPropagation();
        picker.classList.toggle('open');
      };
      picker.addEventListener('focusout', e => {
        const next = e.relatedTarget as Node | null;
        if (next && picker.contains(next)) return;
        picker.classList.remove('open');
      });
    };

    const renderWorldbookSourceSelector = () => {
      if (!worldbookSelectorEl) return;
      worldbookSelectorEl.innerHTML = [
        `<option value="" ${!selectedWorldbookName ? 'selected' : ''}>无</option>`,
        ...allWorldbookNames.map(
          name =>
            `<option value="${escapeHtml(name)}" ${selectedWorldbookName === name ? 'selected' : ''}>${escapeHtml(name)}</option>`,
        ),
      ].join('');
    };

    const renderFixedPhList = () => {
      if (!fixedListEl) return;
      fixedListEl.innerHTML = '';
      rows.forEach(k => {
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
          mountValueMultiPicker(pickerHost, defaultValue, currentValue, val => {
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
            <input data-cph-key="${idx}" value="${escapeHtml(ph.key)}" placeholder="键名" style="width:100px;padding:6px 8px;border:1px solid rgba(24,24,27,.18);border-radius:8px;font-size:12px" />
            <div data-cph-picker="${idx}" style="flex:1"></div>
            <input type="hidden" data-cph-picked="${idx}" />
            <button type="button" class="fp-btn icon-only" data-cph-edit-default="${idx}" title="编辑默认值">${iconSvg('pencil')}</button>
            <button class="fp-btn icon-only" data-del-cph="${idx}" title="删除" style="padding:4px 8px;font-size:14px;color:#c44">✕</button>
          `;
        customListEl.appendChild(row);
        const pickerHost = row.querySelector(`[data-cph-picker="${idx}"]`) as HTMLElement | null;
        const hidden = row.querySelector(`[data-cph-picked="${idx}"]`) as HTMLInputElement | null;
        if (pickerHost && hidden) {
          mountValueMultiPicker(pickerHost, defaultValue, currentValue, val => {
            hidden.value = val;
            const key = String(
              (row.querySelector(`[data-cph-key="${idx}"]`) as HTMLInputElement | null)?.value || ph.key || '',
            ).trim();
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
            name:
              selectedRoleOption === state.activeCharacterId
                ? state.activeCharacterName || selectedRoleOption
                : selectedRoleOption,
            lastSeenAt: nowIso(),
          };
        }
        loadRoleValuesBySelection();
        renderRoleSelector();
        refreshContextLabel();
        refreshContextPanel();
        renderFixedPhList();
        renderCustomPhList();
      };
    }
    const resetDefaultsBtn = card.querySelector('[data-reset-ph-defaults]') as HTMLElement | null;
    if (resetDefaultsBtn)
      resetDefaultsBtn.onclick = () => {
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

    let worldbookLoadSeq = 0;
    const loadWorldbookOptions = async (mode: 'init' | 'manual' | 'auto' | 'watch' = 'init') => {
      const seq = ++worldbookLoadSeq;
      if (!worldbookStatusEl) return;
      worldbookStatusEl.textContent =
        mode === 'watch' ? '已检测到角色切换，正在读取世界书列表...' : '正在读取世界书列表...';
      allWorldbookNames = getAllWorldbookNamesSafe();
      autoSelectedWorldbookNames = getCurrentCharacterBoundWorldbookNames();
      if (mode === 'init' || mode === 'watch' || mode === 'auto') {
        selectedWorldbookName = autoSelectedWorldbookNames[0] || '';
      }
      if (!selectedWorldbookName) {
        for (const k of Object.keys(localRoleValues)) delete localRoleValues[k];
      }
      renderWorldbookSourceSelector();
      worldbookStatusEl.textContent = '正在读取所选世界书条目...';
      const nextOptions = await getWorldbookEntryOptionsByNames(selectedWorldbookName ? [selectedWorldbookName] : []);
      if (seq !== worldbookLoadSeq) return;
      worldbookOptions = nextOptions;
      if (!worldbookOptions.length) {
        worldbookStatusEl.textContent =
          mode === 'auto' ? '自动选择的世界书暂无可用条目' : '未读取到可用世界书条目（可手动切换映射来源）';
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
      worldbookSelectorEl.onkeydown = e => {
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
        await loadWorldbookOptions('manual');
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
        await loadWorldbookOptions('auto');
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
          refreshContextPanel();
          allWorldbookNames = getAllWorldbookNamesSafe();
          autoSelectedWorldbookNames = getCurrentCharacterBoundWorldbookNames();
          selectedWorldbookName = autoSelectedWorldbookNames[0] || '';
          if (!selectedWorldbookName) {
            for (const k of Object.keys(localRoleValues)) delete localRoleValues[k];
          }
          renderWorldbookSourceSelector();
          await loadWorldbookOptions('watch');
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
        const key = getInputValueTrim(card, `[data-cph-key="${idx}"]`);
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
        const pickedVal = String(
          (card.querySelector(`[data-ph-picked="${k}"]`) as HTMLInputElement | null)?.value || '',
        ).trim();
        if (pickedVal && pickedVal !== defaultVal) draft[k] = pickedVal;
      }
      localCustomPhs.forEach((ph, idx) => {
        const key = getInputValueTrim(card, `[data-cph-key="${idx}"]`);
        const pickedVal = String(
          (card.querySelector(`[data-cph-picked="${idx}"]`) as HTMLInputElement | null)?.value || '',
        ).trim();
        const defaultVal = String(ph.defaultValue || key || '').trim();
        if (key && !rows.includes(key) && pickedVal) {
          if (pickedVal && pickedVal !== defaultVal) draft[key] = pickedVal;
        }
        ph.key = key || '';
      });
      return draft;
    };

    const refreshInputBtn = card.querySelector('[data-refresh-input]') as HTMLElement | null;
    if (refreshInputBtn)
      refreshInputBtn.onclick = () => {
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
                const themeEl = card.querySelector('[data-theme]') as HTMLSelectElement | null;
                if (themeEl) themeEl.value = String(data.theme);
              }
              if (data.customCSS !== undefined) {
                const cssEl = card.querySelector('[data-custom-css]') as HTMLTextAreaElement | null;
                if (cssEl) cssEl.value = String(data.customCSS || '');
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

    const settingsCloseBtn = card.querySelector('[data-close]') as HTMLElement | null;
    if (settingsCloseBtn) settingsCloseBtn.onclick = () => close();
    const settingsSaveBtn = card.querySelector('[data-save]') as HTMLElement | null;
    if (settingsSaveBtn)
      settingsSaveBtn.onclick = () => {
        // 收集连接符数据
        const updatedConnectors: ConnectorButton[] = [];
        localConnectors.forEach((conn, idx) => {
          const label = getInputValueTrim(card, `[data-conn-label="${idx}"]`);
          const token = getInputValueTrim(card, `[data-conn-token="${idx}"]`);
          const color = CONNECTOR_COLOR_HEX[conn.color] ? conn.color : 'orange';
          if (label && token) {
            updatedConnectors.push({ id: conn.id, label, token, color });
          }
        });
        state.pack!.settings.connectors = updatedConnectors;
        if (!updatedConnectors.length) {
          state.pack!.settings.defaults.connectorPrefixId = null;
        } else if (!updatedConnectors.find(c => c.id === state.pack!.settings.defaults.connectorPrefixId)) {
          state.pack!.settings.defaults.connectorPrefixId = updatedConnectors[0].id;
        }
        // 同步到 tokens（向后兼容）
        const thenConn = updatedConnectors.find(c => c.label === '然后');
        const simulConn = updatedConnectors.find(c => c.label === '同时');
        state.pack!.settings.tokens.then = thenConn?.token || '<然后>';
        state.pack!.settings.tokens.simultaneous = simulConn?.token || '<同时>';
        state.pack!.settings.defaults.mode =
          (card.querySelector('[data-default-mode]') as HTMLSelectElement | null)?.value === 'inject'
            ? 'inject'
            : 'append';
        state.pack!.settings.ui = state.pack!.settings.ui || {};
        state.pack!.settings.ui.theme =
          (card.querySelector('[data-theme]') as HTMLSelectElement | null)?.value || 'herdi-light';
        state.pack!.settings.ui.customCSS =
          (card.querySelector('[data-custom-css]') as HTMLTextAreaElement | null)?.value || '';
        const toastMax = Number((card.querySelector('[data-toast-max]') as HTMLInputElement | null)?.value || 4);
        const toastTimeout = Number(
          (card.querySelector('[data-toast-timeout]') as HTMLInputElement | null)?.value || 1800,
        );
        state.pack!.settings.toast.maxStack = Math.max(1, Math.min(8, toastMax || 4));
        state.pack!.settings.toast.timeout = Math.max(600, Math.min(8000, toastTimeout || 1800));

        localQrLlmSettings.enabledStream = !!(card.querySelector('[data-qr-stream]') as HTMLInputElement | null)
          ?.checked;
        localQrLlmSettings.generationParams.temperature = Number(
          (card.querySelector('[data-qr-temperature]') as HTMLInputElement | null)?.value || 1,
        );
        localQrLlmSettings.generationParams.top_p = Number(
          (card.querySelector('[data-qr-top-p]') as HTMLInputElement | null)?.value || 1,
        );
        localQrLlmSettings.generationParams.max_tokens = Number(
          (card.querySelector('[data-qr-max-tokens]') as HTMLInputElement | null)?.value || 8192,
        );
        localQrLlmSettings.generationParams.presence_penalty = Number(
          (card.querySelector('[data-qr-presence]') as HTMLInputElement | null)?.value || 0,
        );
        localQrLlmSettings.generationParams.frequency_penalty = Number(
          (card.querySelector('[data-qr-frequency]') as HTMLInputElement | null)?.value || 0,
        );
        localQrLlmSettings.generationParams.temperature = Math.max(
          0,
          Math.min(
            2,
            Number.isFinite(localQrLlmSettings.generationParams.temperature)
              ? localQrLlmSettings.generationParams.temperature
              : 1,
          ),
        );
        localQrLlmSettings.generationParams.top_p = Math.max(
          0,
          Math.min(
            1,
            Number.isFinite(localQrLlmSettings.generationParams.top_p) ? localQrLlmSettings.generationParams.top_p : 1,
          ),
        );
        localQrLlmSettings.generationParams.max_tokens = Math.max(
          16,
          Math.min(
            8192,
            Number.isFinite(localQrLlmSettings.generationParams.max_tokens)
              ? Math.round(localQrLlmSettings.generationParams.max_tokens)
              : 8192,
          ),
        );
        localQrLlmSettings.generationParams.presence_penalty = Math.max(
          -2,
          Math.min(
            2,
            Number.isFinite(localQrLlmSettings.generationParams.presence_penalty)
              ? localQrLlmSettings.generationParams.presence_penalty
              : 0,
          ),
        );
        localQrLlmSettings.generationParams.frequency_penalty = Math.max(
          -2,
          Math.min(
            2,
            Number.isFinite(localQrLlmSettings.generationParams.frequency_penalty)
              ? localQrLlmSettings.generationParams.frequency_penalty
              : 0,
          ),
        );
        localQrLlmSettings.presetStore = normalizeQrLlmPresetStore(localQrLlmPresetStore);
        localQrLlmSettings.activePresetName = String(
          (card.querySelector('[data-qr-preset-select]') as HTMLSelectElement | null)?.value ||
            localQrLlmSettings.activePresetName ||
            '',
        ).trim();
        if (
          !localQrLlmSettings.activePresetName ||
          !localQrLlmSettings.presetStore.presets[localQrLlmSettings.activePresetName]
        ) {
          localQrLlmSettings.activePresetName = DEFAULT_QR_LLM_PRESET_NAME;
        }
        state.pack!.settings.qrLlm = deepClone(localQrLlmSettings);

        localQrLlmSecret.url = String(
          (card.querySelector('[data-qr-api-url]') as HTMLInputElement | null)?.value || localQrLlmSecret.url || '',
        ).trim();
        localQrLlmSecret.apiKey = String(
          (card.querySelector('[data-qr-api-key]') as HTMLInputElement | null)?.value || localQrLlmSecret.apiKey || '',
        );
        localQrLlmSecret.extraBodyParamsText = String(
          (card.querySelector('[data-qr-extra-body-params]') as HTMLTextAreaElement | null)?.value ||
            localQrLlmSecret.extraBodyParamsText ||
            '',
        );
        localQrLlmSecret.manualModelId = String(
          (card.querySelector('[data-qr-model-manual]') as HTMLInputElement | null)?.value ||
            localQrLlmSecret.manualModelId ||
            localQrLlmSecret.model ||
            '',
        ).trim();
        localQrLlmSecret.model =
          localQrLlmSecret.manualModelId ||
          String((card.querySelector('[data-qr-model-select]') as HTMLSelectElement | null)?.value || '').trim();
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
        localCustomPhs.forEach(ph => {
          const from = String(ph.originalKey || '').trim();
          const to = String(ph.key || '').trim();
          if (!from || !to || from === to) return;
          renamePairs.push({ from, to });
        });

        const roleMaps = localAllRoleMaps;
        for (const map of Object.values(roleMaps)) {
          for (const pair of renamePairs) {
            if (
              Object.prototype.hasOwnProperty.call(map, pair.from) &&
              !Object.prototype.hasOwnProperty.call(map, pair.to)
            ) {
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
            name: String(
              localAllRoleMeta[selectedRoleOption]?.name ||
                (selectedRoleOption === state.activeCharacterId ? state.activeCharacterName : '') ||
                selectedRoleOption,
            ),
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
        const savedSecret = saveQrLlmSecretConfig(localQrLlmSecret);
        if (!savedSecret) {
          toast('设置保存失败：LLM私密配置写入失败');
          return;
        }
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

function showEditItemModal(itemId: string): void {
  const item = getItemById(itemId);
  if (!item || !state.pack) return;

  showModal(close => {
    const container = document.createElement('div');
    container.className = 'fp-edit-modal';

    const header = document.createElement('div');
    header.className = 'fp-modal-header';
    header.innerHTML = `<h3>${iconSvg('pencil')} 编辑条目</h3>`;

    const content = document.createElement('div');
    content.className = 'fp-edit-content';
    content.innerHTML = `
      <div class="fp-form-group">
        <label>名称</label>
        <input type="text" class="fp-input" id="edit-name" value="${escapeHtml(item.name)}">
      </div>
      <div class="fp-form-group">
        <label>内容</label>
        <textarea class="fp-textarea" id="edit-content" rows="8">${escapeHtml(item.content)}</textarea>
      </div>
      <div class="fp-form-row">
        <div class="fp-form-group">
          <label>模式</label>
          <select class="fp-select" id="edit-mode">
            <option value="append" ${item.mode === 'append' ? 'selected' : ''}>追加</option>
            <option value="inject" ${item.mode === 'inject' ? 'selected' : ''}>注入</option>
          </select>
        </div>
        <div class="fp-form-group">
          <label>收藏</label>
          <input type="checkbox" id="edit-favorite" ${item.favorite ? 'checked' : ''}>
        </div>
      </div>
    `;

    const footer = document.createElement('div');
    footer.className = 'fp-modal-footer';
    footer.innerHTML = `
      <button class="fp-btn" id="cancel-edit">取消</button>
      <button class="fp-btn primary" id="save-edit">保存</button>
    `;

    container.appendChild(header);
    container.appendChild(content);
    container.appendChild(footer);

    // 绑定事件
    setTimeout(() => {
      const cancelBtn = container.querySelector('#cancel-edit');
      if (cancelBtn) cancelBtn.addEventListener('click', close);

      const saveBtn = container.querySelector('#save-edit');
      if (saveBtn) {
        saveBtn.addEventListener('click', () => {
          const name = (container.querySelector('#edit-name') as HTMLInputElement)?.value;
          const content = (container.querySelector('#edit-content') as HTMLTextAreaElement)?.value;
          const mode = (container.querySelector('#edit-mode') as HTMLSelectElement)?.value as 'append' | 'inject';
          const favorite = (container.querySelector('#edit-favorite') as HTMLInputElement)?.checked;

          updateItem(itemId, {
            name: name?.trim() || item.name,
            content: content?.trim() || '',
            mode,
            favorite,
          });

          toast('条目已更新');
          renderWorkbench();
          close();
        });
      }
    }, 0);

    return container;
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
// 导入选择界面和冲突处理
// ============================================================================

/**
 * 导入冲突项
 */
interface ImportConflict {
  type: 'category' | 'item';
  incoming: Category | Item;
  existing: Category | Item;
  action: 'skip' | 'overwrite' | 'rename';
  rename: string;
}

/**
 * 检查是否有占位符角色映射冲突
 * @param localSettings - 本地设置
 * @param incomingSettings - 导入的设置
 * @returns 是否有冲突
 */
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

/**
 * 合并占位符角色映射
 * @param localSettings - 本地设置
 * @param incomingSettings - 导入的设置
 * @param policy - 合并策略
 * @returns 合并后的角色映射
 */
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

/**
 * 根据选择构建过滤后的导入数据
 * @param incoming - 原始导入数据
 * @param selectedCategoryIds - 选中的分类ID
 * @param selectedItemIds - 选中的条目ID
 * @returns 过滤后的导入数据
 */
function buildFilteredIncomingBySelection(
  incoming: Pack,
  selectedCategoryIds: string[],
  selectedItemIds: string[],
): Pack {
  const catIdSet = new Set(selectedCategoryIds);
  const itemIdSet = new Set(selectedItemIds);
  return {
    ...incoming,
    categories: incoming.categories.filter(c => catIdSet.has(c.id)),
    items: incoming.items.filter(i => itemIdSet.has(i.id)),
  };
}

/**
 * 打开导入选择模态框
 * @param incoming - 要导入的数据包
 * @param onDone - 完成回调
 */
function openImportSelectionModal(
  incoming: Pack,
  onDone: (selected: Pack | null, includeSettings: boolean) => void,
): void {
  showModal(closeSelect => {
    const card = pD.createElement('div');
    card.className = 'fp-modal-card';

    // 构建分类路径映射
    const pathMap = new Map<string, string>();
    const catById = new Map<string, Category>(incoming.categories.map(c => [c.id, c]));
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
        row.innerHTML = `<input type="checkbox" data-cat-id="${escapeHtml(cat.id)}" checked /><span style="font-size:12px;line-height:1.35">${escapeHtml(p)}</span>`;
        catsWrap?.appendChild(row);
      }

      for (const item of incoming.items) {
        const full = `${pathMap.get(item.categoryId || '') || ''} / ${item.name}`;
        if (kw && !full.toLowerCase().includes(kw) && !(item.content || '').toLowerCase().includes(kw)) continue;
        const row = pD.createElement('label');
        row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;padding:6px;border-radius:8px';
        row.innerHTML = `<input type="checkbox" data-item-id="${escapeHtml(item.id)}" checked /><span style="font-size:12px;line-height:1.35"><b>${escapeHtml(item.name)}</b><br/><span style="opacity:.7">${escapeHtml(pathMap.get(item.categoryId || '') || '')}</span></span>`;
        itemsWrap?.appendChild(row);
      }
    };
    renderLists();

    if (filterInput) filterInput.oninput = renderLists;
    const allBtn = card.querySelector('[data-all]') as HTMLElement | null;
    if (allBtn)
      allBtn.onclick = () => {
        card.querySelectorAll('input[type="checkbox"]').forEach(el => {
          (el as HTMLInputElement).checked = true;
        });
      };
    const noneBtn = card.querySelector('[data-none]') as HTMLElement | null;
    if (noneBtn)
      noneBtn.onclick = () => {
        card.querySelectorAll('input[type="checkbox"]').forEach(el => {
          (el as HTMLInputElement).checked = false;
        });
      };

    const closeBtn = card.querySelector('[data-close]') as HTMLElement | null;
    if (closeBtn)
      closeBtn.onclick = () => {
        closeSelect();
        onDone(null, false);
      };

    const nextBtn = card.querySelector('[data-next]') as HTMLElement | null;
    if (nextBtn)
      nextBtn.onclick = () => {
        const selectedCategoryIds = [...card.querySelectorAll('input[data-cat-id]:checked')].map(
          el => el.getAttribute('data-cat-id') || '',
        );
        const selectedItemIds = [...card.querySelectorAll('input[data-item-id]:checked')].map(
          el => el.getAttribute('data-item-id') || '',
        );
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

/**
 * 打开冲突处理模态框
 * @param conflicts - 冲突列表
 * @param onApply - 应用回调
 */
function openConflictResolutionModal(
  conflicts: ImportConflict[],
  onApply: (resolvedConflicts: ImportConflict[]) => void,
): void {
  showModal(closeConflict => {
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
        <div style="font-size:12px;margin-bottom:6px">${c.type === 'category' ? '分类' : '条目'} 冲突：<b>${escapeHtml(c.incoming.name)}</b></div>
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

    const conflictCloseBtn = c2.querySelector('[data-close]') as HTMLElement | null;
    if (conflictCloseBtn) conflictCloseBtn.onclick = closeConflict;
    const conflictApplyBtn = c2.querySelector('[data-apply]') as HTMLElement | null;
    if (conflictApplyBtn)
      conflictApplyBtn.onclick = () => {
        conflicts.forEach((c, idx) => {
          c.action = ((c2.querySelector(`[data-action="${idx}"]`) as HTMLSelectElement | null)?.value ||
            'skip') as ImportConflict['action'];
          c.rename = ((c2.querySelector(`[data-rename="${idx}"]`) as HTMLInputElement | null)?.value || '').trim();
        });
        onApply(conflicts);
        closeConflict();
      };

    return c2;
  });
}

/**
 * 应用导入
 * @param incoming - 导入的数据包
 * @param conflicts - 冲突处理列表
 * @param includeSettings - 是否包含设置
 * @param placeholderMapPolicy - 占位符映射策略
 */
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

  // 处理分类
  const catIdMap = new Map<string, string>();
  for (const c of incoming.categories) {
    const cf = conflictMap.get(`category::${c.id}`);
    if (!cf) {
      const copy = deepClone(c);
      if (next.categories.find(x => x.id === copy.id)) copy.id = uid('cat');
      next.categories.push(copy);
      catIdMap.set(c.id, copy.id);
      continue;
    }

    if (cf.action === 'skip') {
      catIdMap.set(c.id, (cf.existing as Category).id);
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

  // 处理条目
  for (const it of incoming.items) {
    const mappedCat = catIdMap.get(it.categoryId || '') || it.categoryId;
    const cf = conflictMap.get(`item::${it.id}`);
    if (!cf) {
      const copy = deepClone(it);
      copy.id = next.items.find(x => x.id === copy.id) ? uid('item') : copy.id;
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
    next.settings.placeholderRoleMaps = mergePlaceholderRoleMaps(
      state.pack.settings,
      incoming.settings,
      placeholderMapPolicy,
    );
  }

  state.pack = next;
  persistPack();
  renderWorkbench();
  toast('导入完成');
}

/**
 * 打开高级导入模态框（带选择界面和冲突处理）
 */
function openAdvancedImportModal(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!validatePack(parsed)) {
        toast('无效的导入数据');
        return;
      }
      const incoming = parsed as Pack;

      openImportSelectionModal(incoming, (selectedIncoming, includeSettings) => {
        if (!selectedIncoming) return;
        if (!state.pack) return;

        // 询问占位符映射策略
        const askRoleMapPolicyThenApply = (doApply: (policy: 'skip' | 'overwrite') => void) => {
          if (!includeSettings || !hasPlaceholderRoleMapConflict(state.pack!.settings, selectedIncoming.settings)) {
            doApply('overwrite');
            return;
          }
          showModal(closePolicy => {
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
            const policyCloseBtn = policyCard.querySelector('[data-close]') as HTMLElement | null;
            if (policyCloseBtn) policyCloseBtn.onclick = closePolicy;
            const policyApplyBtn = policyCard.querySelector('[data-apply]') as HTMLElement | null;
            if (policyApplyBtn)
              policyApplyBtn.onclick = () => {
                const policy = ((policyCard.querySelector('[data-map-policy]') as HTMLSelectElement | null)?.value ||
                  'overwrite') as 'skip' | 'overwrite';
                closePolicy();
                doApply(policy);
              };
            return policyCard;
          });
        };

        // 检测冲突
        const conflicts: ImportConflict[] = [];
        const catByParentAndName = new Map<string, Category>();
        for (const c of state.pack.categories) {
          catByParentAndName.set(`${c.parentId || 'root'}::${c.name}`, c);
        }
        const itemByCatAndName = new Map<string, Item>();
        for (const i of state.pack.items) {
          itemByCatAndName.set(`${i.categoryId}::${i.name}`, i);
        }

        for (const cat of selectedIncoming.categories) {
          const key = `${cat.parentId || 'root'}::${cat.name}`;
          const hit = catByParentAndName.get(key);
          if (hit) conflicts.push({ type: 'category', incoming: cat, existing: hit, action: 'skip', rename: '' });
        }
        for (const item of selectedIncoming.items) {
          const key = `${item.categoryId}::${item.name}`;
          const hit = itemByCatAndName.get(key);
          if (hit) conflicts.push({ type: 'item', incoming: item, existing: hit, action: 'skip', rename: '' });
        }

        if (!conflicts.length) {
          askRoleMapPolicyThenApply(policy => {
            applyImport(selectedIncoming, [], includeSettings, policy);
          });
          return;
        }

        openConflictResolutionModal(conflicts, resolvedConflicts => {
          askRoleMapPolicyThenApply(policy => {
            applyImport(selectedIncoming, resolvedConflicts, includeSettings, policy);
          });
        });
      });
    } catch {
      toast('JSON解析失败');
    }
  };
  input.click();
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
