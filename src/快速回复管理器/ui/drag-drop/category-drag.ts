/**
 * 分类拖拽模块
 * @description 处理分类的拖拽排序和层级移动
 * @module ui/drag-drop/category-drag
 */

import { state, persistPack } from '../../store';
import type { Category } from '../../types';
import type { DropMode } from '../events';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 分类移动结果
 */
export interface CategoryMoveResult {
  success: boolean;
  message?: string;
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

// ============================================================================
// 分类移动功能
// ============================================================================

/**
 * 移动分类到相对位置
 * @param dragId - 拖拽的分类ID
 * @param targetId - 目标分类ID
 * @param mode - 放置模式（before/after/inside）
 * @returns 移动结果
 */
export function moveCategoryRelative(dragId: string, targetId: string, mode: DropMode): CategoryMoveResult {
  if (!dragId || !targetId || dragId === targetId) {
    return { success: false, message: '无效的拖拽参数' };
  }

  const drag = getCategoryById(dragId);
  const target = getCategoryById(targetId);

  if (!drag || !target) {
    return { success: false, message: '分类不存在' };
  }

  // 检查是否拖拽到自身子树中
  let p: Category | null = mode === 'inside' ? target : target.parentId ? getCategoryById(target.parentId) : null;
  while (p) {
    if (p.id === drag.id) {
      return { success: false, message: '不能将分类移动到自身子树中' };
    }
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
  return { success: true };
}

// ============================================================================
// 导出
// ============================================================================

export { getCategoryById, treeChildren };
