/**
 * 条目拖拽模块
 * @description 处理条目的拖拽移动和排序
 * @module ui/drag-drop/item-drag
 */

import { state, persistPack } from '../../store';
import type { Item, Category } from '../../types';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 条目移动结果
 */
export interface ItemMoveResult {
  success: boolean;
  message?: string;
}

/**
 * 条目拖拽策略接口
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
 * 快照条目
 */
interface SnapshotEntry<T extends HTMLElement> {
  el: T;
  index: number;
  rect: SnapshotRect;
}

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
 * 快照放置信息
 */
interface SnapshotPlacement<T extends HTMLElement> {
  dropIndex: number;
  placementKey: string;
  targetEl?: T | null;
  insertBeforeEl?: HTMLElement | null;
}

// ============================================================================
// 辅助函数
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

// ============================================================================
// 条目移动功能
// ============================================================================

/**
 * 移动条目到指定分类
 * @param itemId - 条目ID
 * @param targetCatId - 目标分类ID
 * @returns 移动结果
 */
export function moveItemToCategory(itemId: string, targetCatId: string): ItemMoveResult {
  if (!state.pack) {
    return { success: false, message: '数据未加载' };
  }

  const item = state.pack.items.find(i => i.id === itemId);
  if (!item) {
    return { success: false, message: '条目不存在' };
  }

  if (!getCategoryById(targetCatId)) {
    return { success: false, message: '目标分类不存在' };
  }

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
  return { success: true };
}

// ============================================================================
// 条目卡片拖拽策略
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
function clearTreeAutoExpand(stateRef: AutoExpandState): void {
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
function scheduleTreeAutoExpand(
  catId: string,
  onTreeRefresh: (() => void) | undefined,
  stateRef: AutoExpandState,
): void {
  if (!onTreeRefresh || !state.pack || !catId) {
    clearTreeAutoExpand(stateRef);
    return;
  }

  const children = state.pack.categories.filter(c => c.parentId === catId);
  const expanded = state.pack.uiState.sidebar.expanded || {};

  if (!children.length || expanded[catId] !== false) {
    clearTreeAutoExpand(stateRef);
    return;
  }

  if (stateRef.catId === catId && stateRef.timer) return;

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
      // 获取宿主文档
      let pD: Document;
      try {
        const pW = window.parent as typeof window;
        pD = pW.document || document;
      } catch {
        pD = document;
      }

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

// ============================================================================
// 导出
// ============================================================================

export { getItemsByCategory };
