/**
 * 分类管理模块
 * @description 提供分类的CRUD操作和树形结构管理
 */

import type { Category, Item } from '../types';
import { state, persistPack } from '../store';
import { uid } from '../utils/dom';
import { logError } from '../services/debug';

/**
 * 根据ID获取分类
 * @param id - 分类ID
 * @returns 分类对象或null
 */
export function getCategoryById(id: string | null): Category | null {
  if (!state.pack || !id) return null;
  return state.pack.categories.find(c => c.id === id) || null;
}

/**
 * 获取分类下的条目
 * @param catId - 分类ID
 * @param includeDesc - 是否包含子分类的条目（递归），默认true
 * @returns 条目数组
 */
export function getItemsByCategory(catId: string | null, includeDesc = true): Item[] {
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
 * 获取分类路径（从根到当前分类的完整路径）
 * @param id - 分类ID
 * @returns 分类路径数组（按从根到子分类的顺序）
 */
export function getPath(id: string | null): Category[] {
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

/**
 * 获取子分类列表
 * @param parentId - 父分类ID，null表示获取根分类
 * @returns 子分类数组（已按order排序）
 */
export function getChildCategories(parentId: string | null): Category[] {
  if (!state.pack) return [];
  return state.pack.categories
    .filter(c => c.parentId === parentId)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/**
 * 创建新分类
 * @param name - 分类名称
 * @param parentId - 父分类ID，null表示根分类
 * @returns 新创建的分类对象，创建失败返回null
 */
export function createCategory(name: string, parentId: string | null = null): Category | null {
  if (!state.pack) return null;
  const finalName = String(name || '').trim();
  if (!finalName) {
    logError('createCategory: 分类名称不能为空');
    return null;
  }
  // 检查同级是否已有同名分类
  const dup = state.pack.categories.find(c => c.parentId === parentId && c.name === finalName);
  if (dup) {
    logError('createCategory: 同级已存在同名分类', { name: finalName, parentId });
    return null;
  }
  const siblings = getChildCategories(parentId);
  const newCategory: Category = {
    id: uid('cat'),
    name: finalName,
    parentId,
    order: siblings.length,
    collapsed: false,
  };
  state.pack.categories.push(newCategory);
  persistPack();
  return newCategory;
}

/**
 * 更新分类
 * @param id - 分类ID
 * @param updates - 要更新的字段（部分更新）
 * @returns 是否更新成功
 */
export function updateCategory(id: string, updates: Partial<Omit<Category, 'id'>>): boolean {
  if (!state.pack) return false;
  const category = getCategoryById(id);
  if (!category) {
    logError('updateCategory: 分类不存在', { id });
    return false;
  }
  // 如果更新名称，检查同级同名
  if (updates.name !== undefined) {
    const finalName = String(updates.name).trim();
    if (!finalName) {
      logError('updateCategory: 分类名称不能为空');
      return false;
    }
    const dup = state.pack.categories.find(
      c => c.parentId === category.parentId && c.name === finalName && c.id !== id,
    );
    if (dup) {
      logError('updateCategory: 同级已存在同名分类', { name: finalName });
      return false;
    }
    category.name = finalName;
  }
  // 更新其他字段
  if (updates.parentId !== undefined) {
    category.parentId = updates.parentId;
  }
  if (updates.order !== undefined) {
    category.order = updates.order;
  }
  if (updates.collapsed !== undefined) {
    category.collapsed = updates.collapsed;
  }
  persistPack();
  return true;
}

/**
 * 删除分类
 * @param id - 要删除的分类ID
 * @param moveToParent - 是否将条目和子分类移动到父分类，默认true
 * @returns 是否删除成功
 */
export function deleteCategory(id: string, moveToParent = true): boolean {
  if (!state.pack) return false;
  const category = getCategoryById(id);
  if (!category) {
    logError('deleteCategory: 分类不存在', { id });
    return false;
  }
  const parentId = category.parentId;
  if (moveToParent) {
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
  }
  // 删除分类
  state.pack.categories = state.pack.categories.filter(c => c.id !== id);
  // 更新当前选中
  if (state.currentCategoryId === id) {
    state.currentCategoryId = parentId;
  }
  persistPack();
  return true;
}

/**
 * 移动分类到新的父分类
 * @param id - 要移动的分类ID
 * @param newParentId - 新父分类ID，null表示移动到根
 * @returns 是否移动成功
 */
export function moveCategory(id: string, newParentId: string | null): boolean {
  if (!state.pack) return false;
  const category = getCategoryById(id);
  if (!category) {
    logError('moveCategory: 分类不存在', { id });
    return false;
  }
  if (id === newParentId) {
    logError('moveCategory: 不能将自己设为自己的父分类');
    return false;
  }
  // 检查是否会导致循环引用（不能移动到自己的子分类下）
  let p: Category | null = newParentId ? getCategoryById(newParentId) : null;
  const guard = new Set<string>();
  while (p && !guard.has(p.id)) {
    if (p.id === id) {
      logError('moveCategory: 不能将分类移动到自己的子分类下');
      return false;
    }
    guard.add(p.id);
    p = p.parentId ? getCategoryById(p.parentId) : null;
  }
  const oldParentId = category.parentId;
  const siblings = getChildCategories(newParentId).filter(c => c.id !== id);
  category.parentId = newParentId;
  category.order = siblings.length;
  // 重新排序旧父分类下的子分类
  if (oldParentId !== newParentId) {
    const oldSiblings = getChildCategories(oldParentId);
    oldSiblings.forEach((cat, idx) => {
      cat.order = idx;
    });
  }
  persistPack();
  return true;
}

/**
 * 重新排序分类
 * @param orderedIds - 按新顺序排列的分类ID数组
 * @param parentId - 父分类ID（用于验证所有ID属于同一父分类）
 * @returns 是否排序成功
 */
export function reorderCategories(orderedIds: string[], parentId: string | null = null): boolean {
  if (!state.pack) return false;
  // 验证所有ID是否属于同一父分类
  const validIds = orderedIds.filter(id => {
    const cat = getCategoryById(id);
    return cat && cat.parentId === parentId;
  });
  if (validIds.length === 0) {
    logError('reorderCategories: 没有有效的分类ID');
    return false;
  }
  // 更新order字段
  validIds.forEach((id, idx) => {
    const cat = getCategoryById(id);
    if (cat) {
      cat.order = idx;
    }
  });
  persistPack();
  return true;
}

/**
 * 递归移动分类（带排序位置）
 * @param dragId - 要移动的分类ID
 * @param targetId - 目标分类ID
 * @param mode - 放置模式：'before'|'after'|'inside'
 * @returns 是否移动成功
 */
export function moveCategoryRelative(dragId: string, targetId: string, mode: 'before' | 'after' | 'inside'): boolean {
  if (!state.pack) return false;
  if (!dragId || !targetId || dragId === targetId) return false;
  const drag = getCategoryById(dragId);
  const target = getCategoryById(targetId);
  if (!drag || !target) return false;
  // 检查循环引用
  let p: Category | null = mode === 'inside' ? target : target.parentId ? getCategoryById(target.parentId) : null;
  const guard = new Set<string>();
  while (p && !guard.has(p.id)) {
    if (p.id === drag.id) return false;
    guard.add(p.id);
    p = p.parentId ? getCategoryById(p.parentId) : null;
  }
  const oldParentId = drag.parentId;
  const newParentId = mode === 'inside' ? target.id : target.parentId;
  const siblings = getChildCategories(newParentId).filter(c => c.id !== dragId);
  let insertIndex = siblings.length;
  if (mode !== 'inside') {
    const targetIndex = siblings.findIndex(c => c.id === targetId);
    if (targetIndex >= 0) insertIndex = mode === 'before' ? targetIndex : targetIndex + 1;
  }
  if (insertIndex < 0) insertIndex = 0;
  if (insertIndex > siblings.length) insertIndex = siblings.length;
  drag.parentId = newParentId;
  siblings.splice(insertIndex, 0, drag);
  siblings.forEach((cat, idx) => {
    cat.order = idx;
  });
  // 重新排序旧父分类下的子分类
  if (oldParentId !== newParentId) {
    const oldSiblings = getChildCategories(oldParentId);
    oldSiblings.forEach((cat, idx) => {
      cat.order = idx;
    });
  }
  persistPack();
  return true;
}

/**
 * 获取分类树（递归结构）
 * @param parentId - 父分类ID，null表示从根开始
 * @returns 树形结构数组
 */
export interface CategoryTreeNode extends Category {
  children: CategoryTreeNode[];
}

export function getCategoryTree(parentId: string | null = null): CategoryTreeNode[] {
  if (!state.pack) return [];
  const children = getChildCategories(parentId);
  return children.map(cat => ({
    ...cat,
    children: getCategoryTree(cat.id),
  }));
}

/**
 * 检查分类是否有子分类
 * @param id - 分类ID
 * @returns 是否有子分类
 */
export function hasChildren(id: string): boolean {
  if (!state.pack) return false;
  return state.pack.categories.some(c => c.parentId === id);
}

/**
 * 获取分类下的所有子分类ID（递归）
 * @param id - 分类ID
 * @returns 所有子分类ID集合（包含自身）
 */
export function getDescendantIds(id: string): Set<string> {
  const ids = new Set<string>([id]);
  if (!state.pack) return ids;
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
  return ids;
}
