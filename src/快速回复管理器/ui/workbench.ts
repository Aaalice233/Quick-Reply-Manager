/**
 * 主界面渲染模块
 * @description 负责快速回复管理器主工作界面的渲染和交互
 */

import type { Category, Item, DragData } from '../types';
import { state, persistPack } from '../store';
import { OVERLAY_ID, CONNECTOR_COLOR_HEX } from '../constants';
import { resolveHostWindow, escapeHtml } from '../utils/dom';
import { iconSvg, renderTopButton, toast } from './components';
import { moveCategoryRelative } from '../features/categories';
import { moveItem } from '../features/items';
import {
  runSnapshotReorderDrag,
  createItemCardDragStrategy,
  scheduleTreeAutoExpand,
  unbindWorkbenchEvents,
} from './events';

// ============================================================================
// 类型定义
// ============================================================================

/** 分组条目结构 */
interface GroupedItems {
  groupId: string;
  groupName: string;
  items: Item[];
}

// ============================================================================
// 宿主环境
// ============================================================================

const pW = resolveHostWindow();
const pD = pW.document || document;

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取视口尺寸
 */
function getViewportSize(): { width: number; height: number } {
  const root = pD?.documentElement;
  const w = Number(pW?.innerWidth) || Number(root?.clientWidth) || Number(window.innerWidth) || 320;
  const h = Number(pW?.innerHeight) || Number(root?.clientHeight) || Number(window.innerHeight) || 360;
  return {
    width: Math.max(320, w),
    height: Math.max(360, h),
  };
}

/**
 * 根据ID获取分类
 */
function getCategoryById(id: string | null): Category | null {
  if (!state.pack || !id) return null;
  return state.pack.categories.find(c => c.id === id) || null;
}

/**
 * 获取分类的子分类
 */
function treeChildren(parentId: string | null): Category[] {
  if (!state.pack) return [];
  return state.pack.categories.filter(c => c.parentId === parentId).sort((a, b) => a.order - b.order);
}

/**
 * 获取分类路径
 */
function getPath(id: string | null): Category[] {
  const path: Category[] = [];
  let current = getCategoryById(id);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getCategoryById(current.parentId) : null;
  }
  return path;
}

/**
 * 获取分类下的条目
 */
function getItemsByCategory(catId: string | null, includeDesc = true): Item[] {
  if (!state.pack) return [];
  const catIds = new Set<string>();
  if (catId) {
    catIds.add(catId);
    if (includeDesc) {
      const collect = (parentId: string) => {
        const kids = state.pack!.categories.filter(c => c.parentId === parentId);
        for (const k of kids) {
          catIds.add(k.id);
          collect(k.id);
        }
      };
      collect(catId);
    }
  }
  return state.pack.items
    .filter(i => (catId ? catIds.has(i.categoryId || '') : !i.categoryId))
    .sort((a, b) => a.order - b.order);
}

/**
 * 截断内容文本
 */
function truncateContent(content: string, maxLen = 60): string {
  const raw = String(content || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (raw.length <= maxLen) return raw;
  return raw.slice(0, maxLen) + '…';
}

/**
 * 检查点击是否被抑制
 */
let clickSuppressed = false;
function isClickSuppressed(): boolean {
  return clickSuppressed;
}

/**
 * 抑制下一次点击
 */
function suppressNextClick(ms = 220): void {
  clickSuppressed = true;
  setTimeout(() => (clickSuppressed = false), ms);
}

/**
 * 创建拖拽幽灵元素
 */
function createDragGhost(sourceEl: HTMLElement): HTMLElement {
  const ghost = sourceEl.cloneNode(true) as HTMLElement;
  const rect = sourceEl.getBoundingClientRect();
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.classList.add('fp-drag-ghost');
  pD.body.appendChild(ghost);
  return ghost;
}

/**
 * 将预览令牌同步到输入框
 */
function syncInputFromPreviewTokens(): void {
  if (!state.pack) return;
  const ta = pD.querySelector('#send_textarea') as HTMLTextAreaElement | null;
  if (!ta) return;
  const tokens = state.pack.uiState.preview.tokens || [];
  const next = tokens.map(t => String(t.text !== undefined ? t.text : t.label)).join('');
  if (String(ta.value || '') === next) return;
  (state as { suspendInputSync: boolean }).suspendInputSync = true;
  ta.value = next;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  (state as { suspendInputSync: boolean }).suspendInputSync = false;
}

/**
 * 刷新预览面板
 */
function refreshPreviewPanel(): void {
  const overlay = pD.getElementById(OVERLAY_ID);
  if (!overlay) return;
  const previewEls = overlay.querySelectorAll('.fp-preview');
  previewEls.forEach(el => renderPreview(el as HTMLElement));
}

/**
 * 解析预览令牌类型
 */
function resolvePreviewTokenType(t: { type: string }): string {
  if (t.type === 'raw') return 'raw';
  if (t.type === 'item') return 'item';
  if (t.type.startsWith('conn-id:')) {
    const connectors = state.pack?.settings?.connectors || [];
    const id = t.type.slice('conn-id:'.length);
    const c = connectors.find(x => x.id === id);
    if (c && ['orange', 'purple', 'green', 'blue', 'red', 'cyan'].includes(c.color)) {
      return `conn-${c.color}`;
    }
    return 'raw';
  }
  return 'raw';
}

/**
 * 为主界面分组条目
 */
function groupedItemsForMain(): GroupedItems[] {
  const keyword = (state.filter || '').trim().toLowerCase();

  if (state.currentCategoryId === '__favorites__') {
    if (!state.pack) return [];
    const favs = state.pack.items.filter(i => i.favorite);
    const filtered = keyword
      ? favs.filter(i => i.name.toLowerCase().includes(keyword) || (i.content || '').toLowerCase().includes(keyword))
      : favs;
    return [{ groupId: '__favorites__', groupName: '❤ 收藏条目', items: filtered }];
  }

  const focus =
    getCategoryById(state.currentCategoryId) || state.pack?.categories.find(c => c.parentId === null) || null;
  if (!focus) return [];

  const directChildren = treeChildren(focus.id);
  const groups: GroupedItems[] = [];

  const ownItems = getItemsByCategory(focus.id, false);
  const ownFiltered = keyword
    ? ownItems.filter(i => i.name.toLowerCase().includes(keyword) || (i.content || '').toLowerCase().includes(keyword))
    : ownItems;

  if (ownFiltered.length) {
    groups.push({ groupId: focus.id, groupName: `${focus.name} · 当前`, items: ownFiltered });
  }

  for (const child of directChildren) {
    const items = getItemsByCategory(child.id, true);
    const filtered = keyword
      ? items.filter(i => i.name.toLowerCase().includes(keyword) || (i.content || '').toLowerCase().includes(keyword))
      : items;
    if (filtered.length) {
      groups.push({ groupId: child.id, groupName: child.name, items: filtered });
    }
  }

  if (!groups.length) {
    const all = getItemsByCategory(focus.id, true);
    const filtered = keyword
      ? all.filter(i => i.name.toLowerCase().includes(keyword) || (i.content || '').toLowerCase().includes(keyword))
      : all;
    groups.push({ groupId: focus.id, groupName: `${focus.name} · 全部`, items: filtered });
  }

  return groups;
}

// ============================================================================
// 渲染函数
// ============================================================================

/**
 * 确保overlay元素存在
 * @returns overlay元素或null
 */
export function ensureOverlay(): HTMLElement | null {
  return pD.getElementById(OVERLAY_ID);
}

/**
 * 渲染路径面包屑
 */
export function renderPath(pathEl: HTMLElement): void {
  if (!state.pack) return;
  pathEl.innerHTML = '';
  const nodes = getPath(state.currentCategoryId);
  const nextPath = nodes.map(n => n.id);
  const prevPath = Array.isArray(state.pack.uiState.lastPath) ? state.pack.uiState.lastPath : [];
  const pathChanged = nextPath.length !== prevPath.length || nextPath.some((id, idx) => prevPath[idx] !== id);
  if (pathChanged) {
    state.pack.uiState.lastPath = nextPath;
    persistPack();
  }

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

/**
 * 渲染分类树
 */
export function renderCategoryTree(treeEl: HTMLElement, onSelect: () => void): void {
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
    if (
      ownItems.some(i => i.name.toLowerCase().includes(keyword) || (i.content || '').toLowerCase().includes(keyword))
    ) {
      return true;
    }
    const children = treeChildren(cat.id);
    return children.some(child => categoryHasMatch(child.id));
  };

  const createNode = (cat: Category, depth: number): void => {
    if (!categoryHasMatch(cat.id)) return;
    const node = pD.createElement('div');
    node.className = `fp-tree-node ${state.currentCategoryId === cat.id ? 'active' : ''}`;
    node.dataset.catId = cat.id;
    const kids = treeChildren(cat.id);
    const isOpen = expanded[cat.id] !== false;
    const indentWrap = pD.createElement('span');
    for (let i = 0; i < depth; i++) {
      const indentEl = pD.createElement('span');
      indentEl.className = 'fp-tree-indent';
      indentWrap.appendChild(indentEl);
    }
    const arrow = pD.createElement('span');
    arrow.textContent = kids.length ? (isOpen ? '▾' : '▸') : '·';
    const label = pD.createElement('span');
    label.textContent = cat.name;
    node.appendChild(indentWrap);
    node.appendChild(arrow);
    node.appendChild(label);

    node.onclick = e => {
      if (isClickSuppressed()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (kids.length && (e as MouseEvent).offsetX < 28 + depth * 12) {
        expanded[cat.id] = !isOpen;
        persistPack();
        renderWorkbench();
        return;
      }
      state.history.push(state.currentCategoryId);
      state.currentCategoryId = cat.id;
      onSelect();
    };

    // 添加拖拽支持
    attachPointerCategoryDropDrag(node, { type: 'category', id: cat.id }, () => {
      // 重新渲染分类树
      renderWorkbench();
    });

    treeEl.appendChild(node);
    if (kids.length && isOpen) {
      for (const child of kids) createNode(child, depth + 1);
    }
  };

  for (const r of roots) createNode(r, 0);
}

/**
 * 渲染主内容区域条目网格
 */
export function renderItemGrid(mainScroll: HTMLElement): void {
  mainScroll.innerHTML = '';
  const groups = groupedItemsForMain();

  if (!groups.length || groups.every(g => !g.items.length)) {
    const empty = pD.createElement('div');
    empty.style.cssText = 'padding:20px;color:#8fb2a7;font-size:13px';
    empty.textContent = '当前分类暂无条目，可点击"新增条目"创建。';
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
    grid.dataset.groupId = g.groupId;

    for (const item of g.items) {
      const card = pD.createElement('div');
      card.className = 'fp-card';
      card.style.cursor = 'pointer';
      card.dataset.itemId = item.id;
      card.dataset.itemCategory = item.categoryId || '';
      const excerpt = truncateContent(item.content, 80);
      const modeLabel = item.mode === 'inject' ? '注入' : '追加';
      card.innerHTML = `
        <div class="fp-card-icons">
          <span class="fp-mini${item.mode === 'inject' ? ' inject' : ''}">${escapeHtml(modeLabel)}</span>
          ${item.favorite ? '<span class="fp-fav-badge" title="已收藏"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 13.6 3.3 9.1A2.9 2.9 0 0 1 7.4 5l.6.6.6-.6a2.9 2.9 0 1 1 4.1 4.1L8 13.6Z" fill="currentColor"/></svg></span>' : ''}
        </div>
        <div class="fp-card-title">${escapeHtml(item.name)}</div>
        ${excerpt ? `<div class="fp-card-excerpt">${escapeHtml(excerpt)}</div>` : ''}
      `;

      card.onclick = e => {
        if (isClickSuppressed()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        // 条目执行逻辑由调用方处理
      };

      card.oncontextmenu = e => {
        e.preventDefault();
        // 上下文菜单逻辑由调用方处理
      };

      // 添加卡片拖拽支持
      attachPointerItemCardDrag(card, item, grid, mainScroll, () => {
        renderWorkbench();
      });

      grid.appendChild(card);
    }

    const quickAddCard = pD.createElement('button');
    quickAddCard.type = 'button';
    quickAddCard.className = 'fp-card fp-card-add';
    quickAddCard.setAttribute('data-quick-add-cat', g.groupId);
    quickAddCard.setAttribute('aria-label', '快速新增条目');
    quickAddCard.title = `在"${g.groupName}"中新增条目`;
    quickAddCard.innerHTML = iconSvg('add');
    grid.appendChild(quickAddCard);

    mainScroll.appendChild(grid);
  }
}

/**
 * 渲染主内容区域
 */
export function renderMainContent(mainScroll: HTMLElement): void {
  renderItemGrid(mainScroll);
}

/**
 * 渲染预览令牌流
 */
export function renderPreview(previewEl: HTMLElement): void {
  previewEl.innerHTML = '';
  const tokens = state.pack?.uiState?.preview?.tokens || [];
  let insertIndicator: HTMLElement | null = null;
  const clearDropMarkers = () => {
    previewEl.querySelectorAll('.fp-token.drop-before,.fp-token.drop-after').forEach(el => {
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

    const labelSpan = pD.createElement('span');
    labelSpan.className = 'fp-token-label';
    labelSpan.textContent = t.label || '';
    chip.appendChild(labelSpan);

    const del = pD.createElement('span');
    del.className = 'fp-token-del';
    del.innerHTML = '✕';
    del.title = '删除';
    del.onclick = e => {
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
        const otherChips = Array.from(previewEl.querySelectorAll('.fp-token')).filter(
          el => el !== chip,
        ) as HTMLElement[];
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

/**
 * 渲染紧凑列表内容（移动端）
 */
export function renderCompactListContent(scrollArea: HTMLElement): void {
  scrollArea.innerHTML = '';
  if (!state.pack) return;

  const keyword = (state.filter || '').trim().toLowerCase();

  // 收藏夹视图
  if (state.currentCategoryId === '__favorites__') {
    const favs = state.pack.items.filter(i => i.favorite);
    const filtered = keyword
      ? favs.filter(i => i.name.toLowerCase().includes(keyword) || (i.content || '').toLowerCase().includes(keyword))
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

  // 正常分类视图
  const focus =
    getCategoryById(state.currentCategoryId) || state.pack.categories.find(c => c.parentId === null) || null;
  if (!focus) return;

  const directChildren = treeChildren(focus.id);
  const ownItems = getItemsByCategory(focus.id, false);

  const filteredChildren = keyword
    ? directChildren.filter(c => {
        if (c.name.toLowerCase().includes(keyword)) return true;
        const items = getItemsByCategory(c.id, true);
        return items.some(
          i => i.name.toLowerCase().includes(keyword) || (i.content || '').toLowerCase().includes(keyword),
        );
      })
    : directChildren;

  const filteredItems = keyword
    ? ownItems.filter(i => i.name.toLowerCase().includes(keyword) || (i.content || '').toLowerCase().includes(keyword))
    : ownItems;

  // 收藏夹入口
  if (!keyword && focus.parentId === null) {
    const favCount = state.pack.items.filter(i => i.favorite).length;
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

  // 空状态
  if (!filteredChildren.length && !filteredItems.length) {
    scrollArea.innerHTML = '<div style="padding:16px;color:#8a7e72;font-size:13px">当前分类暂无内容</div>';
  }
}

/**
 * 渲染紧凑列表（移动端主界面）
 */
export function renderCompactList(container: HTMLElement): void {
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
    const scrollArea = container.querySelector('.fp-compact-scroll') as HTMLElement;
    if (scrollArea) renderCompactListContent(scrollArea);
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

/**
 * 创建紧凑条目按钮
 */
function createCompactItemBtn(item: Item): HTMLButtonElement {
  const btn = pD.createElement('button');
  btn.className = `fp-cbtn${item.mode === 'inject' ? ' fp-cbtn-inject' : ''}`;
  const excerpt = truncateContent(item.content, 40);
  btn.innerHTML = `<span>${escapeHtml(item.name)}</span>${excerpt ? `<span class="fp-cbtn-excerpt">${escapeHtml(excerpt)}</span>` : ''}`;
  btn.style.cssText = 'display:inline-flex;flex-direction:column;align-items:flex-start;gap:1px';

  btn.onclick = e => {
    e.preventDefault();
    e.stopPropagation();
  };
  btn.oncontextmenu = e => {
    e.preventDefault();
  };

  return btn;
}

/**
 * 渲染顶部工具栏
 */
export function renderToolbar(topEl: HTMLElement, compact: boolean): void {
  if (!state.pack) return;

  const connectors = state.pack.settings.connectors || [];
  const prefixModeEnabled = !!state.pack.settings.defaults.connectorPrefixMode;
  const selectedPrefixId = state.pack.settings.defaults.connectorPrefixId || connectors[0]?.id || null;

  const connectorBtnsHtml = connectors
    .map((c, i) => {
      const baseIconName = i === 0 ? 'then' : i === 1 ? 'simul' : 'add';
      const checked = prefixModeEnabled && c.id === selectedPrefixId;
      const iconName = checked ? 'check' : baseIconName;
      const safeColor = Object.prototype.hasOwnProperty.call(CONNECTOR_COLOR_HEX, c.color) ? c.color : 'orange';
      const safeLabel = escapeHtml(c.label);
      return `<button class="fp-btn fp-conn-${safeColor} fp-conn-btn ${checked ? 'is-selected' : ''}" data-conn-${i} title="${safeLabel}">${iconSvg(iconName)}${safeLabel}</button>`;
    })
    .join('');

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
    topEl.innerHTML = `
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
    topEl.innerHTML = `
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
}

/**
 * 渲染侧边栏
 */
export function renderSidebar(sidebarEl: HTMLElement): void {
  if (!state.pack) return;

  sidebarEl.innerHTML = '';

  const sideHead = pD.createElement('div');
  sideHead.className = 'fp-side-head';
  const expandedMap = state.pack.uiState.sidebar.expanded || {};
  const allExpanded = state.pack.categories.length > 0 && state.pack.categories.every(c => expandedMap[c.id] !== false);
  const treeToggleTitle = allExpanded ? '全部折叠' : '全部展开';
  const treeToggleIcon = allExpanded ? 'collapse-all' : 'expand-all';
  sideHead.innerHTML =
    '<div class="fp-side-search"><input class="fp-input fp-side-search-input" placeholder="筛选分类/条目" /><div class="fp-tree-tools"><button class="fp-tree-tool-btn" data-tree-toggle title="' +
    treeToggleTitle +
    '">' +
    iconSvg(treeToggleIcon) +
    '</button></div></div>';

  const tree = pD.createElement('div');
  tree.className = 'fp-tree';

  const sideFoot = pD.createElement('div');
  sideFoot.className = 'fp-sidebar-foot';
  sideFoot.innerHTML = '<span class="name">快速回复管理器</span>';

  sidebarEl.appendChild(sideHead);
  sidebarEl.appendChild(tree);
  sidebarEl.appendChild(sideFoot);

  renderCategoryTree(tree, renderWorkbench);
}

/**
 * 启用调整大小功能
 */
export function enableResizers(
  panel: HTMLElement,
  sidebar: HTMLElement,
  splitV: HTMLElement,
  bottom: HTMLElement,
  splitH: HTMLElement,
): void {
  const minSide = 220;
  const maxSide = 520;

  splitV.onpointerdown = (e: PointerEvent) => {
    e.preventDefault();
    try {
      splitV.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
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
      try {
        splitV.releasePointerCapture(ev.pointerId);
      } catch (err) {
        /* ignore */
      }
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
    try {
      splitH.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
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
      try {
        splitH.releasePointerCapture(ev.pointerId);
      } catch (err) {
        /* ignore */
      }
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

/**
 * 渲染主界面工作台
 */
export function renderWorkbench(): void {
  const overlay = pD.getElementById(OVERLAY_ID);
  if (!overlay) return;

  const panel = overlay.querySelector('.fp-panel') as HTMLElement | null;
  if (!panel || !state.pack) return;

  panel.innerHTML = '';

  const vp = getViewportSize();
  const vw = vp.width;
  const vh = vp.height;

  // 仅在真正小屏时启用紧凑模式
  const compact = vw <= 760 || vh <= 560;
  const maxPanelWidth = Math.max(320, vw - 16);
  const maxPanelHeight = Math.max(360, vh - 16);
  const fitWidth = Math.min(maxPanelWidth, Math.max(320, Math.round(vw * 0.86)));
  const fitHeight = Math.min(maxPanelHeight, Math.max(360, Math.round(vh * 0.88)));
  let savedWidth = Number(state.pack.uiState.panelSize.width || 980);
  let savedHeight = Number(state.pack.uiState.panelSize.height || 680);

  if (!compact) {
    const tooSmallByRatio = savedWidth < vw * 0.65 || savedHeight < vh * 0.65;
    if (tooSmallByRatio) {
      savedWidth = fitWidth;
      savedHeight = fitHeight;
    }
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

  // 创建顶部工具栏
  const top = pD.createElement('div');
  top.className = 'fp-top';
  renderToolbar(top, compact);

  // 创建路径面包屑
  const path = pD.createElement('div');
  path.className = 'fp-path';

  // 创建主体区域
  const body = pD.createElement('div');
  body.className = 'fp-body';

  let bottomHead: HTMLElement | null = null;
  let previewExpanded = false;

  if (compact) {
    // 紧凑模式
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
    compactBottomHead.innerHTML =
      '<span>预览令牌流</span><div class="fp-bottom-actions"><button class="fp-btn fp-preview-btn" data-clear-preview title="清空预览令牌流">清空</button><button class="fp-btn fp-preview-btn icon-only" data-toggle-preview title="收起/展开">' +
      iconSvg(previewExpanded ? 'chevron-down' : 'chevron-up') +
      '</button></div>';

    const compactPreview = pD.createElement('div');
    compactPreview.className = 'fp-preview';

    compactBottom.appendChild(compactBottomHead);
    compactBottom.appendChild(compactPreview);
    panel.appendChild(compactBottom);

    renderPath(path);
    renderCompactList(compactList);
    renderPreview(compactPreview);
  } else {
    // 桌面模式
    const sidebar = pD.createElement('div');
    sidebar.className = 'fp-sidebar';
    sidebar.style.width = `${state.pack.uiState.sidebar.width || 280}px`;
    renderSidebar(sidebar);

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
    bottomHead.innerHTML =
      '<span>预览令牌流</span><div class="fp-bottom-actions"><button class="fp-btn fp-preview-btn" data-clear-preview title="清空预览令牌流">清空</button><button class="fp-btn fp-preview-btn icon-only" data-toggle-preview title="收起/展开">' +
      iconSvg(previewExpanded ? 'chevron-down' : 'chevron-up') +
      '</button></div>';

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
    renderMainContent(mainScroll);
    renderPreview(preview);
    enableResizers(panel, sidebar, splitV, bottom, splitH);
  }
}

/**
 * 检查工作台是否打开
 * @returns 工作台是否处于打开状态
 */
export function isWorkbenchOpen(): boolean {
  const overlay = pD.getElementById(OVERLAY_ID);
  return !!overlay && overlay.style.display !== 'none';
}

/**
 * 检查是否有打开的模态框
 * @returns 是否有模态框处于打开状态
 */
export function hasOpenWorkbenchModal(): boolean {
  return !!pD.querySelector('.fp-modal-overlay');
}

// ============================================================================
// 拖拽功能实现
// ============================================================================

/**
 * 自动展开状态类型
 */
interface AutoExpandState {
  timer: ReturnType<typeof setTimeout> | null;
  catId: string | null;
}

/**
 * 清除自动展开状态
 */
function clearTreeAutoExpand(stateRef: AutoExpandState): void {
  if (stateRef.timer) {
    clearTimeout(stateRef.timer);
    stateRef.timer = null;
  }
  stateRef.catId = null;
}

/**
 * 检查分类是否可以放置到目标分类
 * @param dragId - 拖拽的分类ID
 * @param targetId - 目标分类ID
 * @returns 是否可以放置
 */
function canDropCategoryTo(dragId: string, targetId: string): boolean {
  if (dragId === targetId) return false;
  const target = getCategoryById(targetId);
  if (!target) return false;
  // 检查是否会导致循环引用
  let p: Category | null = target;
  const guard = new Set<string>();
  while (p && !guard.has(p.id)) {
    if (p.id === dragId) return false;
    guard.add(p.id);
    p = p.parentId ? getCategoryById(p.parentId) : null;
  }
  return true;
}

/**
 * 为分类树节点添加Pointer Events拖拽支持
 * @param el - 分类节点元素
 * @param payload - 拖拽数据
 * @param onTreeRefresh - 树刷新回调
 */
export function attachPointerCategoryDropDrag(el: HTMLElement, payload: DragData, onTreeRefresh?: () => void): void {
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let ghost: HTMLElement | null = null;
  let dropNode: HTMLElement | null = null;
  let dropCatId: string | null = null;
  let dropMode: 'before' | 'after' | 'inside' | null = null;
  const autoExpand: AutoExpandState = { timer: null, catId: null };

  const clearDropNode = () => {
    if (dropNode) {
      dropNode.classList.remove('drop-target', 'drop-before', 'drop-after', 'drop-inside');
    }
    dropNode = null;
    dropCatId = null;
    dropMode = null;
  };

  const cleanup = () => {
    if (ghost) ghost.remove();
    ghost = null;
    el.classList.remove('is-pointer-dragging');
    (pD.body || pD.documentElement).classList.remove('fp-drag-active');
    clearDropNode();
    clearTreeAutoExpand(autoExpand);
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
      const valid = payload.type === 'item' ? Boolean(getCategoryById(catId)) : canDropCategoryTo(payload.id, catId);
      if (valid) {
        let mode: 'before' | 'after' | 'inside' = 'inside';
        if (payload.type === 'category') {
          const rect = node.getBoundingClientRect();
          const offsetY = ev.clientY - rect.top;
          const edgeBand = Math.min(10, rect.height * 0.28);
          if (offsetY <= edgeBand) mode = 'before';
          else if (offsetY >= rect.height - edgeBand) mode = 'after';
        }
        node.classList.add('drop-target');
        node.classList.add(mode === 'before' ? 'drop-before' : mode === 'after' ? 'drop-after' : 'drop-inside');
        dropNode = node;
        dropCatId = catId;
        dropMode = mode;
        if (mode === 'inside') {
          scheduleTreeAutoExpand(catId, onTreeRefresh, autoExpand);
        } else {
          clearTreeAutoExpand(autoExpand);
        }
      }
    } else {
      clearTreeAutoExpand(autoExpand);
    }
    ev.preventDefault();
  };

  const onUp = (_ev: PointerEvent) => {
    const shouldApply = dragging && dropCatId;
    const finalCatId = dropCatId;
    const finalMode = dropMode;
    cleanup();
    if (!shouldApply || !finalCatId) return;
    if (payload.type === 'category') {
      moveCategoryRelative(payload.id, finalCatId, finalMode || 'inside');
      renderWorkbench();
    } else {
      moveItem(payload.id, finalCatId);
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

/**
 * 为条目卡片添加Pointer Events拖拽支持
 * @param card - 卡片元素
 * @param item - 条目对象
 * @param grid - 网格容器元素
 * @param scrollHost - 滚动容器元素
 * @param onTreeRefresh - 树刷新回调
 */
export function attachPointerItemCardDrag(
  card: HTMLElement,
  item: Item,
  grid: HTMLElement,
  scrollHost: HTMLElement,
  onTreeRefresh?: () => void,
): void {
  card.addEventListener('pointerdown', (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    if (isClickSuppressed()) return;

    const dragStrategy = createItemCardDragStrategy(item, onTreeRefresh);

    const maybeAutoScroll = (clientY: number) => {
      const rect = scrollHost.getBoundingClientRect();
      const threshold = Math.min(72, Math.max(40, rect.height * 0.14));
      let delta = 0;
      if (clientY < rect.top + threshold) {
        const ratio = (rect.top + threshold - clientY) / threshold;
        delta = -Math.ceil(6 + ratio * 18);
      } else if (clientY > rect.bottom - threshold) {
        const ratio = (clientY - (rect.bottom - threshold)) / threshold;
        delta = Math.ceil(6 + ratio * 18);
      }
      if (delta) scrollHost.scrollTop += delta;
    };

    runSnapshotReorderDrag<HTMLElement>({
      startEvent: ev,
      sourceEl: card,
      containerEl: grid,
      scrollHost,
      createPlaceholder: () => {
        const placeholder = card.cloneNode(true) as HTMLElement;
        placeholder.classList.add('fp-card-placeholder');
        placeholder.removeAttribute('data-item-id');
        placeholder.removeAttribute('data-item-category');
        return placeholder;
      },
      getSnapshotElements: () =>
        Array.from(grid.querySelectorAll('.fp-card[data-item-id]')).filter(
          el => el !== card && (el as HTMLElement).dataset.itemCategory === (item.categoryId || ''),
        ) as HTMLElement[],
      resolvePlacement: ({ event, snapshots }) => dragStrategy.resolveCardPlacement(event, snapshots),
      onDragStart: () => {
        (pD.body || pD.documentElement).classList.add('fp-drag-active');
        card.classList.add('is-pointer-dragging');
        card.style.display = 'none';
      },
      onMove: ({ event }) => {
        maybeAutoScroll(event.clientY);
        if (dragStrategy.handleTreePointer(event)) {
          dragStrategy.applyCardPlacement({ dropIndex: -1, placementKey: 'card:clear' });
          return true;
        }
        return false;
      },
      onPlacementChange: placement => {
        dragStrategy.applyCardPlacement(placement);
      },
      onCleanup: () => {
        card.style.display = '';
        (pD.body || pD.documentElement).classList.remove('fp-drag-active');
        card.classList.remove('is-pointer-dragging');
        dragStrategy.clearAll();
      },
      onDrop: (finalDropIndex, didDrag) => {
        if (!didDrag) return;
        const treeTargetId = dragStrategy.consumeTreeDrop();
        if (treeTargetId) {
          moveItem(item.id, treeTargetId);
          renderWorkbench();
          toast('条目已移动到分类');
          return;
        }
        if (finalDropIndex >= 0 && item.categoryId) {
          // 在分类内重新排序
          const items =
            state.pack?.items.filter(i => i.categoryId === item.categoryId).sort((a, b) => a.order - b.order) || [];
          const currentIndex = items.findIndex(i => i.id === item.id);
          if (currentIndex >= 0) {
            let newIndex = finalDropIndex;
            if (newIndex > currentIndex) newIndex -= 1;
            if (newIndex !== currentIndex) {
              const [moved] = items.splice(currentIndex, 1);
              items.splice(newIndex, 0, moved);
              items.forEach((it, idx) => {
                it.order = idx;
              });
              persistPack();
              renderWorkbench();
            }
          }
        }
      },
      tailAnchorResolver: () => grid.querySelector('[data-quick-add-cat]') as HTMLElement | null,
    });
  });
}

// ============================================================================
// 宿主窗口 resize 事件处理
// ============================================================================

/**
 * 从宿主窗口分离 resize 事件监听
 * @description 清理 resize 事件处理器和待处理的 RAF
 */
export function detachHostResize(): void {
  if (state.hostResizeHandler) {
    pW.removeEventListener('resize', state.hostResizeHandler);
    state.hostResizeHandler = null;
  }
  if (state.resizeRaf) {
    pW.cancelAnimationFrame(state.resizeRaf);
    state.resizeRaf = null;
  }
}

/**
 * 附加宿主窗口 resize 事件监听
 * @description 绑定 resize 事件，使用 requestAnimationFrame 进行防抖
 * @param applyFitPanelSize - 调整面板尺寸的回调函数（从 index.ts 传入）
 */
export function attachHostResize(applyFitPanelSize: () => void): void {
  detachHostResize(); // 清理任何现有处理器
  state.hostResizeHandler = () => {
    if (state.resizeRaf) return;
    state.resizeRaf = pW.requestAnimationFrame(() => {
      state.resizeRaf = null;
      applyFitPanelSize();
      renderWorkbench();
    });
  };
  pW.addEventListener('resize', state.hostResizeHandler);
}

/**
 * 关闭工作台
 * @description 关闭主界面工作台，清理所有资源和事件监听
 */
export function closeWorkbench(): void {
  const overlay = pD.getElementById(OVERLAY_ID);
  if (overlay) {
    overlay.remove();
  }
  // 解绑工作台事件
  unbindWorkbenchEvents();
  // 清理 resize 监听
  detachHostResize();
}

/**
 * 计算适配面板尺寸
 * @description 基于视口尺寸计算最优面板宽高
 * @returns 包含 width 和 height 的对象
 */
export function computeFitPanelSize(): { width: number; height: number } {
  const vp = getViewportSize();
  const width = Math.min(Math.max(320, vp.width - 16), Math.max(320, Math.round(vp.width * 0.86)));
  const height = Math.min(Math.max(360, vp.height - 16), Math.max(360, Math.round(vp.height * 0.88)));
  return { width, height };
}
