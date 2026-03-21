/**
 * 事件处理模块
 * @description 集中处理 UI 事件，包括拖拽、点击、右键菜单等
 */

import { state, persistPack } from '../store';
import { logError, logInfo } from '../services/debug';
import { toast } from './components';
import type { Category, Item, DragData } from '../types';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 拖拽类型
 */
export type DragType = 'category' | 'item';

/**
 * 拖拽放置模式
 */
export type DropMode = 'before' | 'after' | 'inside';

// ============================================================================
// 全局事件处理器存储
// ============================================================================

/**
 * 存储已绑定的事件处理器，用于后续解绑
 */
const boundEventHandlers: Map<string, EventListener[]> = new Map();

/**
 * 当前拖拽数据
 */
let currentDragData: DragData | null = null;

/**
 * 拖拽幽灵元素
 */
let dragGhost: HTMLElement | null = null;

/**
 * 点击抑制计时器
 */
let suppressClicksUntil = 0;

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 生成唯一ID
 * @param prefix - ID前缀
 * @returns 唯一ID字符串
 */
function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

/**
 * 检查点击是否被抑制
 * @returns 如果点击被抑制返回true
 */
export function isClickSuppressed(): boolean {
  return Date.now() < suppressClicksUntil;
}

/**
 * 抑制接下来的点击事件
 * @param ms - 抑制时长（毫秒）
 */
export function suppressNextClick(ms = 220): void {
  suppressClicksUntil = Date.now() + ms;
}

/**
 * 获取宿主窗口
 * @returns Window对象
 */
function resolveHostWindow(): Window {
  const candidates: Window[] = [];
  try {
    if (window.top) candidates.push(window.top);
  } catch {
    /* ignore */
  }
  try {
    if (window.parent) candidates.push(window.parent);
  } catch {
    /* ignore */
  }
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
    } catch {
      /* ignore */
    }
  }
  return best;
}

/**
 * 获取宿主文档
 * @returns Document对象
 */
function getHostDocument(): Document {
  try {
    return resolveHostWindow().document;
  } catch {
    return document;
  }
}

/**
 * 深拷贝对象
 * @param v - 要拷贝的值
 * @returns 拷贝后的值
 */
function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

// ============================================================================
// 数据操作辅助函数
// ============================================================================

/**
 * 根据ID获取分类
 * @param id - 分类ID
 * @returns 分类对象或null
 */
function getCategoryById(id: string | null): Category | null {
  if (!state.pack || !id) return null;
  return state.pack.categories.find(c => c.id === id) || null;
}

/**
 * 获取子分类
 * @param parentId - 父分类ID
 * @returns 子分类数组
 */
function treeChildren(parentId: string | null): Category[] {
  if (!state.pack) return [];
  return state.pack.categories
    .filter(c => c.parentId === parentId)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/**
 * 获取分类下的条目
 * @param catId - 分类ID
 * @param includeDesc - 是否包含子分类条目
 * @returns 条目数组
 */
function getItemsByCategory(catId: string | null, includeDesc = true): Item[] {
  if (!state.pack || !catId) return [];
  if (!includeDesc) {
    return state.pack.items.filter(i => i.categoryId === catId).sort((a, b) => a.order - b.order);
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
  return state.pack.items.filter(i => ids.has(i.categoryId || '')).sort((a, b) => a.order - b.order);
}

/**
 * 移动分类
 * @param dragId - 拖拽的分类ID
 * @param targetId - 目标分类ID
 * @param mode - 放置模式
 */
function moveCategoryRelative(dragId: string, targetId: string, mode: DropMode): void {
  if (!dragId || !targetId || dragId === targetId) return;
  const drag = getCategoryById(dragId);
  const target = getCategoryById(targetId);
  if (!drag || !target) return;
  let p: Category | null = mode === 'inside' ? target : target.parentId ? getCategoryById(target.parentId) : null;
  while (p) {
    if (p.id === drag.id) return;
    p = p.parentId ? getCategoryById(p.parentId) : null;
  }

  const oldParentId = drag.parentId;
  const newParentId = mode === 'inside' ? target.id : target.parentId;
  const siblings = treeChildren(newParentId);
  const filtered = siblings.filter(c => c.id !== dragId);
  let insertIndex = filtered.length;
  if (mode !== 'inside') {
    const targetIndex = filtered.findIndex(c => c.id === targetId);
    if (targetIndex >= 0) insertIndex = mode === 'before' ? targetIndex : targetIndex + 1;
  }
  if (insertIndex < 0) insertIndex = 0;
  if (insertIndex > filtered.length) insertIndex = filtered.length;

  drag.parentId = newParentId;
  filtered.splice(insertIndex, 0, drag);
  filtered.forEach((cat, idx) => {
    cat.order = idx;
  });
  if (oldParentId !== newParentId) {
    const oldSiblings = treeChildren(oldParentId);
    oldSiblings.forEach((cat, idx) => {
      cat.order = idx;
    });
  }
  persistPack();
}

/**
 * 移动条目到分类
 * @param itemId - 条目ID
 * @param targetCatId - 目标分类ID
 */
function moveItemToCategory(itemId: string, targetCatId: string): void {
  if (!state.pack) return;
  const item = state.pack.items.find(i => i.id === itemId);
  if (!item || !getCategoryById(targetCatId)) return;
  const oldCatId = item.categoryId;
  const siblings = state.pack.items
    .filter(i => i.categoryId === targetCatId && i.id !== itemId)
    .sort((a, b) => a.order - b.order);
  item.categoryId = targetCatId;
  siblings.push(item);
  siblings.forEach((it, idx) => {
    it.order = idx;
  });
  if (oldCatId && oldCatId !== targetCatId) {
    getItemsByCategory(oldCatId, false).forEach((it, idx) => {
      it.order = idx;
    });
  }
  persistPack();
}

// ============================================================================
// 拖拽相关功能
// ============================================================================

/**
 * 创建拖拽幽灵元素
 * @param sourceEl - 源元素
 * @returns 幽灵元素
 */
function createDragGhost(sourceEl: HTMLElement): HTMLElement {
  const pD = getHostDocument();
  const rect = sourceEl.getBoundingClientRect();
  const ghost = sourceEl.cloneNode(true) as HTMLElement;
  ghost.classList.remove('dragging', 'fp-token-dragging', 'is-pointer-dragging');
  ghost.classList.add('fp-drag-ghost');
  ghost.style.width = `${Math.max(40, Math.round(rect.width))}px`;
  ghost.style.height = `${Math.max(20, Math.round(rect.height))}px`;
  (pD.body || pD.documentElement).appendChild(ghost);
  return ghost;
}

/**
 * 清理拖拽状态
 */
function cleanupDrag(): void {
  if (dragGhost) {
    dragGhost.remove();
    dragGhost = null;
  }
  currentDragData = null;
  const pD = getHostDocument();
  (pD.body || pD.documentElement).classList.remove('fp-drag-active');
}

/**
 * 处理拖拽开始
 * @param e - 拖拽事件
 * @param type - 拖拽类型
 * @param id - 拖拽对象ID
 */
export function handleDragStart(e: DragEvent, type: DragType, id: string): void {
  currentDragData = { type, id };
  const target = e.target as HTMLElement;
  if (target) {
    target.classList.add('dragging');
  }
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify({ type, id }));
  }
  suppressNextClick(260);
}

/**
 * 处理拖拽经过
 * @param e - 拖拽事件
 */
export function handleDragOver(e: DragEvent): void {
  e.preventDefault();
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move';
  }

  const target = e.target as HTMLElement;
  if (!target) return;

  // 清除之前的放置标记
  const pD = getHostDocument();
  pD.querySelectorAll('.drop-target, .drop-before, .drop-after, .drop-inside').forEach(el => {
    el.classList.remove('drop-target', 'drop-before', 'drop-after', 'drop-inside');
  });

  // 查找可放置的目标
  const treeNode = target.closest('.fp-tree-node[data-cat-id]') as HTMLElement | null;
  if (treeNode && currentDragData) {
    const catId = treeNode.dataset.catId || '';
    const category = getCategoryById(catId);
    if (category) {
      if (currentDragData.type === 'category') {
        // 分类拖拽：支持 before/after/inside
        const rect = treeNode.getBoundingClientRect();
        const offsetY = e.clientY - rect.top;
        const edgeBand = Math.min(10, rect.height * 0.28);
        let mode: DropMode = 'inside';
        if (offsetY <= edgeBand) mode = 'before';
        else if (offsetY >= rect.height - edgeBand) mode = 'after';
        treeNode.classList.add(
          'drop-target',
          mode === 'before' ? 'drop-before' : mode === 'after' ? 'drop-after' : 'drop-inside',
        );
        treeNode.dataset.dropMode = mode;
      } else {
        // 条目拖拽：只能放入分类内部
        treeNode.classList.add('drop-target', 'drop-inside');
        treeNode.dataset.dropMode = 'inside';
      }
    }
  }
}

/**
 * 处理拖拽放下
 * @param e - 拖拽事件
 */
export function handleDrop(e: DragEvent): void {
  e.preventDefault();
  const pD = getHostDocument();

  // 查找放置目标
  const dropTarget = pD.querySelector('.fp-tree-node.drop-target') as HTMLElement | null;
  if (dropTarget && currentDragData) {
    const targetId = dropTarget.dataset.catId || '';
    const dropMode = (dropTarget.dataset.dropMode || 'inside') as DropMode;

    if (currentDragData.type === 'category') {
      moveCategoryRelative(currentDragData.id, targetId, dropMode);
    } else if (currentDragData.type === 'item') {
      moveItemToCategory(currentDragData.id, targetId);
      toast('条目已移动到分类');
    }

    // 触发重新渲染
    const event = new CustomEvent('workbench:refresh', { bubbles: true });
    pD.dispatchEvent(event);
  }

  // 清理
  pD.querySelectorAll('.drop-target, .drop-before, .drop-after, .drop-inside').forEach(el => {
    el.classList.remove('drop-target', 'drop-before', 'drop-after', 'drop-inside');
    delete (el as HTMLElement).dataset.dropMode;
  });
  cleanupDrag();
}

/**
 * 处理拖拽结束
 * @param e - 拖拽事件
 */
export function handleDragEnd(e: DragEvent): void {
  const target = e.target as HTMLElement;
  if (target) {
    target.classList.remove('dragging');
  }
  cleanupDrag();
}

// ============================================================================
// 点击事件处理
// ============================================================================

/**
 * 处理分类点击
 * @param categoryId - 分类ID
 */
export function handleCategoryClick(categoryId: string): void {
  if (isClickSuppressed()) return;
  state.history.push(state.currentCategoryId);
  state.currentCategoryId = categoryId;

  // 触发自定义事件通知UI更新
  const pD = getHostDocument();
  const event = new CustomEvent('workbench:refresh', { bubbles: true });
  pD.dispatchEvent(event);
}

/**
 * 处理条目点击
 * @param itemId - 条目ID
 */
export function handleItemClick(itemId: string): void {
  if (isClickSuppressed()) return;
  if (!state.pack) return;

  const item = state.pack.items.find(i => i.id === itemId);
  if (!item) return;

  // 触发条目执行事件
  const pD = getHostDocument();
  const event = new CustomEvent('item:execute', {
    bubbles: true,
    detail: { item: deepClone(item) },
  });
  pD.dispatchEvent(event);
}

// ============================================================================
// 右键菜单处理
// ============================================================================

/**
 * 关闭右键菜单
 */
function closeContextMenu(): void {
  if (state.contextMenu) {
    state.contextMenu.remove();
    state.contextMenu = null;
  }
}

/**
 * 打开条目右键菜单
 * @param x - X坐标
 * @param y - Y坐标
 * @param item - 条目对象
 */
function openItemContextMenu(x: number, y: number, item: Item): void {
  const pD = getHostDocument();
  closeContextMenu();

  const menu = pD.createElement('div');
  menu.className = 'fp-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  // 编辑选项
  const editBtn = pD.createElement('button');
  editBtn.className = 'fp-menu-btn';
  editBtn.innerHTML = '<span>✎</span> 编辑';
  editBtn.onclick = () => {
    closeContextMenu();
    const event = new CustomEvent('item:edit', { bubbles: true, detail: { itemId: item.id } });
    pD.dispatchEvent(event);
  };
  menu.appendChild(editBtn);

  // 执行选项
  const runBtn = pD.createElement('button');
  runBtn.className = 'fp-menu-btn';
  runBtn.innerHTML = '<span>▶</span> 执行';
  runBtn.onclick = () => {
    closeContextMenu();
    import('../features/items').then(({ runItem }) => {
      void runItem(item);
    });
  };
  menu.appendChild(runBtn);

  // 收藏/取消收藏
  const favBtn = pD.createElement('button');
  favBtn.className = 'fp-menu-btn';
  favBtn.innerHTML = item.favorite ? '<span>♥</span> 取消收藏' : '<span>♡</span> 收藏';
  favBtn.onclick = () => {
    closeContextMenu();
    if (state.pack) {
      item.favorite = !item.favorite;
      persistPack();
      toast(item.favorite ? '已收藏' : '已取消收藏');
      const event = new CustomEvent('workbench:refresh', { bubbles: true });
      pD.dispatchEvent(event);
    }
  };
  menu.appendChild(favBtn);

  // 复制
  const copyBtn = pD.createElement('button');
  copyBtn.className = 'fp-menu-btn';
  copyBtn.innerHTML = '<span>⎘</span> 复制内容';
  copyBtn.onclick = () => {
    closeContextMenu();
    const event = new CustomEvent('item:copy', { bubbles: true, detail: { item: deepClone(item) } });
    pD.dispatchEvent(event);
  };
  menu.appendChild(copyBtn);

  // 删除
  const deleteBtn = pD.createElement('button');
  deleteBtn.className = 'fp-menu-btn fp-menu-btn-danger';
  deleteBtn.innerHTML = '<span>🗑</span> 删除';
  deleteBtn.onclick = () => {
    closeContextMenu();
    if (state.pack && confirm(`确定要删除条目 "${item.name}" 吗？`)) {
      state.pack.items = state.pack.items.filter(i => i.id !== item.id);
      persistPack();
      toast('条目已删除');
      const event = new CustomEvent('workbench:refresh', { bubbles: true });
      pD.dispatchEvent(event);
    }
  };
  menu.appendChild(deleteBtn);

  // 添加到文档
  const overlay = pD.getElementById('fast-plot-workbench-overlay') || pD.body;
  overlay.appendChild(menu);
  state.contextMenu = menu;

  // 边界修正
  const menuRect = menu.getBoundingClientRect();
  const vp = { width: window.innerWidth, height: window.innerHeight };
  if (menuRect.right > vp.width - 6) menu.style.left = `${vp.width - menuRect.width - 8}px`;
  if (menuRect.bottom > vp.height - 6) menu.style.top = `${vp.height - menuRect.height - 8}px`;
}

/**
 * 处理右键菜单
 * @param e - 鼠标事件
 * @param type - 对象类型
 * @param id - 对象ID
 */
export function handleContextMenu(e: MouseEvent, type: DragType, id: string): void {
  e.preventDefault();
  e.stopPropagation();

  if (type === 'item') {
    if (!state.pack) return;
    const item = state.pack.items.find(i => i.id === id);
    if (item) {
      openItemContextMenu(e.clientX, e.clientY, item);
    }
  } else if (type === 'category') {
    // 分类右键菜单
    const pD = getHostDocument();
    closeContextMenu();

    const category = getCategoryById(id);
    if (!category) return;

    const menu = pD.createElement('div');
    menu.className = 'fp-menu';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    // 编辑分类
    const editBtn = pD.createElement('button');
    editBtn.className = 'fp-menu-btn';
    editBtn.innerHTML = '<span>✎</span> 重命名';
    editBtn.onclick = () => {
      closeContextMenu();
      const newName = prompt('新名称', category.name);
      if (newName && state.pack) {
        category.name = newName.trim() || category.name;
        persistPack();
        toast('分类已重命名');
        const event = new CustomEvent('workbench:refresh', { bubbles: true });
        pD.dispatchEvent(event);
      }
    };
    menu.appendChild(editBtn);

    // 新建子分类
    const addChildBtn = pD.createElement('button');
    addChildBtn.className = 'fp-menu-btn';
    addChildBtn.innerHTML = '<span>+</span> 新建子分类';
    addChildBtn.onclick = () => {
      closeContextMenu();
      const name = prompt('子分类名称');
      if (name && state.pack) {
        const finalName = String(name).trim();
        if (!finalName) {
          toast('分类名称不能为空');
          return;
        }
        const dup = state.pack.categories.find(c => c.parentId === id && c.name === finalName);
        if (dup) {
          toast('同级已存在同名分类');
          return;
        }
        state.pack.categories.push({
          id: uid('cat'),
          name: finalName,
          parentId: id,
          order: treeChildren(id).length,
          collapsed: false,
        });
        persistPack();
        toast('子分类已创建');
        const event = new CustomEvent('workbench:refresh', { bubbles: true });
        pD.dispatchEvent(event);
      }
    };
    menu.appendChild(addChildBtn);

    // 删除分类
    const deleteBtn = pD.createElement('button');
    deleteBtn.className = 'fp-menu-btn fp-menu-btn-danger';
    deleteBtn.innerHTML = '<span>🗑</span> 删除';
    deleteBtn.onclick = () => {
      closeContextMenu();
      if (state.pack && confirm(`确定要删除分类 "${category.name}" 吗？该分类下的条目将被移动到父分类。`)) {
        const parentId = category.parentId;
        // 移动条目到父分类
        state.pack.items.forEach(item => {
          if (item.categoryId === id) {
            item.categoryId = parentId;
          }
        });
        // 移动子分类到父分类
        state.pack.categories.forEach(cat => {
          if (cat.parentId === id) {
            cat.parentId = parentId;
          }
        });
        // 删除分类
        state.pack.categories = state.pack.categories.filter(c => c.id !== id);
        // 更新当前选中
        if (state.currentCategoryId === id) {
          state.currentCategoryId = parentId;
        }
        persistPack();
        toast('分类已删除');
        const event = new CustomEvent('workbench:refresh', { bubbles: true });
        pD.dispatchEvent(event);
      }
    };
    menu.appendChild(deleteBtn);

    const overlay = pD.getElementById('fast-plot-workbench-overlay') || pD.body;
    overlay.appendChild(menu);
    state.contextMenu = menu;

    // 边界修正
    const menuRect = menu.getBoundingClientRect();
    const vp = { width: window.innerWidth, height: window.innerHeight };
    if (menuRect.right > vp.width - 6) menu.style.left = `${vp.width - menuRect.width - 8}px`;
    if (menuRect.bottom > vp.height - 6) menu.style.top = `${vp.height - menuRect.height - 8}px`;
  }
}

// ============================================================================
// 工作台事件绑定/解绑
// ============================================================================

/**
 * 文档点击处理器
 * @param e - 鼠标事件
 */
function onDocumentClick(e: MouseEvent): void {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (state.contextMenu && !target.closest('.fp-menu')) {
    closeContextMenu();
  }
}

/**
 * 绑定主界面所有事件
 * @description 绑定全局事件处理器
 */
export function bindWorkbenchEvents(): void {
  const pD = getHostDocument();

  // 文档点击事件（用于关闭菜单）
  pD.addEventListener('click', onDocumentClick);
  boundEventHandlers.set('document:click', [onDocumentClick as EventListener]);

  // 拖拽全局事件
  pD.addEventListener('dragover', handleDragOver);
  pD.addEventListener('drop', handleDrop);
  boundEventHandlers.set('document:drag', [handleDragOver as EventListener, handleDrop as EventListener]);

  logError('工作台事件已绑定');
}

/**
 * 解绑所有事件
 * @description 清理所有绑定的事件处理器
 */
export function unbindWorkbenchEvents(): void {
  const pD = getHostDocument();

  // 解绑文档点击事件
  pD.removeEventListener('click', onDocumentClick);

  // 解绑拖拽事件
  pD.removeEventListener('dragover', handleDragOver);
  pD.removeEventListener('drop', handleDrop);

  // 清理所有记录的处理器
  // key格式: "scope:eventName", 如 "document:click", "document:drag"
  boundEventHandlers.forEach((handlers, key) => {
    // 安全地解析事件名，处理格式异常
    const parts = key.split(':');
    if (parts.length < 2) {
      console.warn(`[unbindWorkbenchEvents] 无效的事件key: ${key}`);
      return;
    }

    // 特殊处理复合事件key（如 "document:drag" 对应 dragover 和 drop）
    const eventName = parts[1];
    const actualEvents: string[] = [];

    if (eventName === 'drag') {
      actualEvents.push('dragover', 'drop');
    } else {
      actualEvents.push(eventName);
    }

    handlers.forEach(handler => {
      actualEvents.forEach(evt => {
        try {
          pD.removeEventListener(evt, handler);
        } catch (e) {
          console.warn(`[unbindWorkbenchEvents] 解绑事件失败: ${evt}`, e);
        }
      });
    });
  });
  boundEventHandlers.clear();

  // 清理右键菜单
  closeContextMenu();

  // 清理拖拽状态
  cleanupDrag();

  logInfo('工作台事件已解绑');
}

// ============================================================================
// 触摸长按支持
// ============================================================================

/**
 * 为元素添加触摸长按支持
 * @param element - 目标元素
 * @param callback - 长按回调
 * @param duration - 长按持续时间（毫秒）
 */
export function addTouchLongPress(element: HTMLElement, callback: (e: TouchEvent) => void, duration = 520): void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onTouchStart = (e: TouchEvent) => {
    timer = setTimeout(() => {
      callback(e);
    }, duration);
  };

  const onTouchEnd = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const onTouchCancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  element.addEventListener('touchstart', onTouchStart, { passive: true });
  element.addEventListener('touchend', onTouchEnd);
  element.addEventListener('touchcancel', onTouchCancel);
}

// ============================================================================
// 快照拖拽重排序
// ============================================================================

/**
 * 快照矩形信息
 */
interface SnapshotRect {
  left: number;
  top: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

/**
 * 快照条目
 */
interface SnapshotEntry<T extends HTMLElement> {
  el: T;
  index: number;
  rect: SnapshotRect;
}

/**
 * 快照放置信息
 */
interface SnapshotPlacement<T extends HTMLElement> {
  dropIndex: number;
  placementKey: string;
  targetEl?: T | null;
  insertBeforeEl?: HTMLElement | null;
}

/**
 * 快照拖拽选项
 */
interface SnapshotReorderOptions<T extends HTMLElement> {
  startEvent: PointerEvent;
  sourceEl: HTMLElement;
  containerEl: HTMLElement;
  scrollHost: HTMLElement;
  createPlaceholder: () => HTMLElement;
  getSnapshotElements: () => T[];
  resolvePlacement: (ctx: {
    event: PointerEvent;
    snapshots: Array<SnapshotEntry<T>>;
    lastPlacementKey: string;
  }) => SnapshotPlacement<T> | null;
  onDragStart?: (ctx: { ghost: HTMLElement; placeholder: HTMLElement }) => void;
  onMove?: (ctx: {
    event: PointerEvent;
    dragging: boolean;
    ghost: HTMLElement | null;
    placeholder: HTMLElement | null;
  }) => boolean | void;
  onPlacementChange?: (placement: SnapshotPlacement<T>) => void;
  onCleanup?: () => void;
  onDrop: (dropIndex: number, didDrag: boolean) => void;
  ghostOffsetX?: number;
  ghostOffsetY?: number;
  tailAnchorResolver?: () => HTMLElement | null;
}

// ============================================================================
// 条目卡片拖拽策略
// ============================================================================

/**
 * 条目卡片拖拽策略接口
 */
export interface ItemCardDragStrategy {
  clearAll(): void;
  handleTreePointer(event: PointerEvent): boolean;
  consumeTreeDrop(): string | null;
  resolveCardPlacement(
    event: PointerEvent,
    snapshots: Array<SnapshotEntry<HTMLElement>>,
  ): SnapshotPlacement<HTMLElement> | null;
  applyCardPlacement(placement: SnapshotPlacement<HTMLElement>): void;
}

/**
 * 创建条目卡片拖拽策略
 * @param item - 条目对象
 * @param onTreeRefresh - 树刷新回调
 * @returns 拖拽策略对象
 */
export function createItemCardDragStrategy(item: Item, onTreeRefresh?: () => void): ItemCardDragStrategy {
  // 树形拖放策略
  const autoExpand: AutoExpandState = { timer: null, catId: null };
  let dropTreeNode: HTMLElement | null = null;
  let dropCatId: string | null = null;

  const clearTreeDrop = () => {
    if (dropTreeNode) {
      dropTreeNode.classList.remove('drop-target', 'drop-before', 'drop-after', 'drop-inside');
    }
    dropTreeNode = null;
    dropCatId = null;
    clearTreeAutoExpand(autoExpand);
  };

  // 卡片放置状态
  let dropCardNode: HTMLElement | null = null;
  let lastCardPlacement: { itemId: string; side: 'before' | 'after' } | null = null;

  const clearCardDrop = () => {
    if (dropCardNode) dropCardNode.classList.remove('drop-before', 'drop-after');
    dropCardNode = null;
    lastCardPlacement = null;
  };

  return {
    clearAll() {
      clearTreeDrop();
      clearCardDrop();
    },

    handleTreePointer(event: PointerEvent): boolean {
      const pD = getHostDocument();
      const hit = pD.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const treeNode = hit?.closest('.fp-tree-node[data-cat-id]') as HTMLElement | null;

      if (!treeNode) {
        clearTreeDrop();
        return false;
      }

      const catId = treeNode.dataset.catId || '';
      const category = getCategoryById(catId);

      if (!category || catId === (item.categoryId || '')) {
        clearTreeDrop();
        return false;
      }

      if (dropTreeNode !== treeNode) {
        clearTreeDrop();
        treeNode.classList.add('drop-target', 'drop-inside');
        dropTreeNode = treeNode;
        dropCatId = catId;
      }

      scheduleTreeAutoExpand(catId, onTreeRefresh, autoExpand);
      return true;
    },

    consumeTreeDrop(): string | null {
      const finalCatId = dropCatId;
      clearTreeDrop();
      return finalCatId;
    },

    resolveCardPlacement(
      event: PointerEvent,
      snapshots: Array<SnapshotEntry<HTMLElement>>,
    ): SnapshotPlacement<HTMLElement> | null {
      if (!snapshots.length) return { dropIndex: 0, placementKey: 'card:end' };

      // 查找命中的卡片
      const hit = snapshots.find(
        snap =>
          event.clientX >= snap.rect.left - 8 &&
          event.clientX <= snap.rect.left + snap.rect.width + 8 &&
          event.clientY >= snap.rect.top - 10 &&
          event.clientY <= snap.rect.top + snap.rect.height + 10,
      );

      if (hit) {
        const sameRow = event.clientY >= hit.rect.top - 6 && event.clientY <= hit.rect.top + hit.rect.height + 6;
        const hysteresis = sameRow
          ? Math.max(14, Math.min(26, hit.rect.width * 0.09))
          : Math.max(10, Math.min(18, hit.rect.height * 0.22));
        const axisPos = sameRow ? event.clientX : event.clientY;
        const axisMid = sameRow ? hit.rect.centerX : hit.rect.centerY;

        let before = axisPos < axisMid;
        if (lastCardPlacement && lastCardPlacement.itemId === (hit.el as HTMLElement).dataset.itemId) {
          if (lastCardPlacement.side === 'before' && axisPos < axisMid + hysteresis) before = true;
          if (lastCardPlacement.side === 'after' && axisPos > axisMid - hysteresis) before = false;
        }

        return {
          dropIndex: before ? hit.index : hit.index + 1,
          placementKey: `card:${(hit.el as HTMLElement).dataset.itemId || ''}:${before ? 'before' : 'after'}`,
          targetEl: hit.el as HTMLElement,
          insertBeforeEl: before ? hit.el : (snapshots[hit.index + 1]?.el as HTMLElement | null),
        };
      }

      // 在所有卡片上方
      const aboveAll = snapshots.every(snap => event.clientY < snap.rect.top);
      if (aboveAll) {
        return {
          dropIndex: 0,
          placementKey: `card:${(snapshots[0]?.el as HTMLElement)?.dataset.itemId || ''}:before`,
          targetEl: snapshots[0]?.el as HTMLElement | null,
          insertBeforeEl: snapshots[0]?.el as HTMLElement | null,
        };
      }

      // 在所有卡片下方
      const belowAll = snapshots.every(snap => event.clientY > snap.rect.top + snap.rect.height);
      if (belowAll) return { dropIndex: snapshots.length, placementKey: 'card:end' };

      // 找到最近的卡片
      let nearest = snapshots[0];
      let nearestDist = Number.POSITIVE_INFINITY;
      for (const snap of snapshots) {
        const dx = event.clientX - snap.rect.centerX;
        const dy = event.clientY - snap.rect.centerY;
        const dist = Math.abs(dx) * 0.75 + Math.abs(dy);
        if (dist < nearestDist) {
          nearest = snap;
          nearestDist = dist;
        }
      }
      const before = event.clientY < nearest.rect.centerY;
      return {
        dropIndex: before ? nearest.index : nearest.index + 1,
        placementKey: `card:${(nearest.el as HTMLElement).dataset.itemId || ''}:${before ? 'before' : 'after'}`,
        targetEl: nearest.el as HTMLElement,
        insertBeforeEl: before ? nearest.el : (snapshots[nearest.index + 1]?.el as HTMLElement | null),
      };
    },

    applyCardPlacement(placement: SnapshotPlacement<HTMLElement>) {
      clearCardDrop();
      if (placement.targetEl) {
        const side = placement.placementKey.endsWith(':before') ? 'before' : 'after';
        placement.targetEl.classList.add(side === 'before' ? 'drop-before' : 'drop-after');
        dropCardNode = placement.targetEl;
        lastCardPlacement = { itemId: String(placement.targetEl.dataset.itemId || ''), side };
      }
    },
  };
}

/**
 * 运行快照重排序拖拽
 * @param opts - 拖拽选项
 */
export function runSnapshotReorderDrag<T extends HTMLElement>(opts: SnapshotReorderOptions<T>): void {
  const startX = opts.startEvent.clientX;
  const startY = opts.startEvent.clientY;
  let dragging = false;
  let ghost: HTMLElement | null = null;
  let placeholder: HTMLElement | null = null;
  let snapshots: Array<SnapshotEntry<T>> = [];
  let snapshotScrollTop = 0;
  let dropIndex = -1;
  let lastPlacementKey = '';

  const captureSnapshots = () => {
    snapshotScrollTop = opts.scrollHost.scrollTop;
    snapshots = opts.getSnapshotElements().map((el, index) => {
      const rect = el.getBoundingClientRect();
      return {
        el,
        index,
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
        },
      };
    });
  };

  const getAdjustedSnapshots = (): Array<SnapshotEntry<T>> => {
    const scrollDy = opts.scrollHost.scrollTop - snapshotScrollTop;
    return snapshots.map(snap => ({
      ...snap,
      rect: {
        ...snap.rect,
        top: snap.rect.top - scrollDy,
        centerY: snap.rect.centerY - scrollDy,
      },
    }));
  };

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove as EventListener);
    window.removeEventListener('pointerup', onUp as EventListener);
    window.removeEventListener('pointercancel', onUp as EventListener);
    if (ghost) ghost.remove();
    if (placeholder?.parentElement) placeholder.remove();
    opts.onCleanup?.();
  };

  const placePlaceholder = (placement: SnapshotPlacement<T>) => {
    if (!placeholder) return;
    const currentIndex =
      placeholder.parentElement === opts.containerEl ? Array.from(opts.containerEl.children).indexOf(placeholder) : -1;
    if (placement.insertBeforeEl) {
      const desiredIndex = Array.from(opts.containerEl.children).indexOf(placement.insertBeforeEl);
      if (currentIndex !== desiredIndex) opts.containerEl.insertBefore(placeholder, placement.insertBeforeEl);
      return;
    }
    const tailAnchor = opts.tailAnchorResolver?.() || null;
    const desiredIndex = tailAnchor
      ? Array.from(opts.containerEl.children).indexOf(tailAnchor)
      : opts.containerEl.children.length;
    if (currentIndex !== desiredIndex) {
      if (tailAnchor) opts.containerEl.insertBefore(placeholder, tailAnchor);
      else opts.containerEl.appendChild(placeholder);
    }
  };

  const onMove = (moveEv: PointerEvent) => {
    const dx = moveEv.clientX - startX;
    const dy = moveEv.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) < 6) return;
    if (!dragging) {
      dragging = true;
      suppressNextClick(260);
      ghost = createDragGhost(opts.sourceEl);
      placeholder = opts.createPlaceholder();
      captureSnapshots();
      placePlaceholder({ dropIndex: snapshots.length, placementKey: '__init__' });
      opts.onDragStart?.({ ghost, placeholder });
    }

    if (ghost) {
      ghost.style.left = `${Math.round(moveEv.clientX + Number(opts.ghostOffsetX ?? 12))}px`;
      ghost.style.top = `${Math.round(moveEv.clientY + Number(opts.ghostOffsetY ?? 12))}px`;
    }

    const shouldSkipPlacement = opts.onMove?.({ event: moveEv, dragging, ghost, placeholder }) === true;
    if (shouldSkipPlacement) {
      moveEv.preventDefault();
      return;
    }

    const placement = opts.resolvePlacement({
      event: moveEv,
      snapshots: getAdjustedSnapshots(),
      lastPlacementKey,
    });
    if (!placement) {
      moveEv.preventDefault();
      return;
    }
    dropIndex = placement.dropIndex;
    if (lastPlacementKey !== placement.placementKey) {
      lastPlacementKey = placement.placementKey;
      opts.onPlacementChange?.(placement);
    }
    placePlaceholder(placement);
    moveEv.preventDefault();
  };

  const onUp = () => {
    const didDrag = dragging;
    const finalDropIndex = dropIndex;
    cleanup();
    opts.onDrop(finalDropIndex, didDrag);
  };

  window.addEventListener('pointermove', onMove as EventListener);
  window.addEventListener('pointerup', onUp as EventListener);
  window.addEventListener('pointercancel', onUp as EventListener);
}

// ============================================================================
// 分类自动展开功能
// ============================================================================

/**
 * 自动展开状态对象
 */
interface AutoExpandState {
  timer: ReturnType<typeof setTimeout> | null;
  catId: string | null;
}

/**
 * 清除分类自动展开计时器
 * @param stateRef - 自动展开状态对象
 */
export function clearTreeAutoExpand(stateRef: AutoExpandState): void {
  if (stateRef.timer) {
    clearTimeout(stateRef.timer);
    stateRef.timer = null;
  }
  stateRef.catId = null;
}

/**
 * 调度分类自动展开
 * @param catId - 要展开的分类ID
 * @param onTreeRefresh - 树刷新回调函数
 * @param stateRef - 自动展开状态对象
 */
export function scheduleTreeAutoExpand(
  catId: string,
  onTreeRefresh: (() => void) | undefined,
  stateRef: AutoExpandState,
): void {
  if (!onTreeRefresh || !state.pack || !catId) {
    clearTreeAutoExpand(stateRef);
    return;
  }

  // 获取子分类
  const children = state.pack.categories.filter(c => c.parentId === catId);
  const expanded = state.pack.uiState.sidebar.expanded || {};

  // 如果没有子分类或已经展开，则清除计时器
  if (!children.length || expanded[catId] !== false) {
    clearTreeAutoExpand(stateRef);
    return;
  }

  // 如果已经在计时同一个分类，则不做任何操作
  if (stateRef.catId === catId && stateRef.timer) return;

  // 清除之前的计时器并开始新的计时
  clearTreeAutoExpand(stateRef);
  stateRef.catId = catId;
  stateRef.timer = setTimeout(() => {
    stateRef.timer = null;
    stateRef.catId = null;
    if (!state.pack) return;
    state.pack.uiState.sidebar.expanded[catId] = true;
    persistPack();
    onTreeRefresh();
  }, 520);
}

// ============================================================================
// 导出
// ============================================================================

export { currentDragData, cleanupDrag, closeContextMenu };
export type { AutoExpandState };
