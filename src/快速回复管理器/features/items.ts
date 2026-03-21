/**
 * 条目管理模块
 * @description 提供快速回复条目的CRUD操作和管理功能
 */

import type { Item } from '../types';
import { state, persistPack } from '../store';
import { uid } from '../utils/dom';
import { deepClone } from '../utils/data';
import { logError, logInfo } from '../services/debug';
import { toast } from '../ui/components';
import { addPreviewToken } from '../ui/preview';
import { handleActiveCharacterContextChanged, getCurrentRolePlaceholderMap } from '../services/placeholder';

/**
 * 根据ID获取条目
 * @param id - 条目ID
 * @returns 条目对象，未找到时返回null
 */
export function getItemById(id: string): Item | null {
  if (!state.pack) return null;
  return state.pack.items.find(i => i.id === id) || null;
}

/**
 * 获取分类下的所有条目
 * @param catId - 分类ID
 * @param includeDesc - 是否包含子分类的条目
 * @returns 条目数组
 */
export function getItemsByCategory(catId: string | null, includeDesc = true): Item[] {
  if (!state.pack) return [];
  if (!catId) {
    return state.pack.items.filter(i => i.categoryId === null).sort((a, b) => a.order - b.order);
  }

  if (!includeDesc) {
    return state.pack.items.filter(i => i.categoryId === catId).sort((a, b) => a.order - b.order);
  }

  // 包含子分类
  const ids = new Set<string>([catId]);
  const collect = (parentId: string) => {
    const children = state.pack!.categories.filter(c => c.parentId === parentId);
    for (const c of children) {
      ids.add(c.id);
      collect(c.id);
    }
  };
  collect(catId);

  return state.pack.items.filter(i => ids.has(i.categoryId || '')).sort((a, b) => a.order - b.order);
}

/**
 * 创建新条目
 * @param categoryId - 所属分类ID
 * @param name - 条目名称
 * @param content - 条目内容
 * @returns 新创建的条目对象
 */
export function createItem(categoryId: string | null, name: string, content: string): Item {
  if (!state.pack) throw new Error('数据未初始化');

  const siblings = getItemsByCategory(categoryId, false);
  const newItem: Item = {
    id: uid('item'),
    categoryId,
    name: String(name || '').trim() || '未命名条目',
    content: String(content || '').trim(),
    mode: state.pack.settings.defaults.mode,
    favorite: false,
    order: siblings.length,
  };

  state.pack.items.push(newItem);
  persistPack({ immediate: true });
  toast('条目已创建');
  return newItem;
}

/**
 * 更新条目
 * @param id - 条目ID
 * @param updates - 部分更新数据
 * @returns 更新后的条目对象，未找到时返回null
 */
export function updateItem(id: string, updates: Partial<Omit<Item, 'id'>>): Item | null {
  if (!state.pack) return null;

  const item = state.pack.items.find(i => i.id === id);
  if (!item) {
    logError('更新条目失败：未找到条目', id);
    return null;
  }

  if (updates.name !== undefined) {
    item.name = String(updates.name || '').trim() || item.name;
  }
  if (updates.content !== undefined) {
    item.content = String(updates.content || '').trim();
  }
  if (updates.mode !== undefined && (updates.mode === 'append' || updates.mode === 'inject')) {
    item.mode = updates.mode;
  }
  if (updates.categoryId !== undefined) {
    item.categoryId = updates.categoryId;
    // 重新计算order
    const siblings = getItemsByCategory(item.categoryId, false).filter(i => i.id !== id);
    item.order = siblings.length;
  }
  if (updates.favorite !== undefined) {
    item.favorite = Boolean(updates.favorite);
  }
  if (updates.order !== undefined && typeof updates.order === 'number') {
    item.order = updates.order;
  }

  persistPack();
  return item;
}

/**
 * 删除条目
 * @param id - 条目ID
 * @returns 是否删除成功
 */
export function deleteItem(id: string): boolean {
  if (!state.pack) return false;

  const item = state.pack.items.find(i => i.id === id);
  if (!item) {
    logError('删除条目失败：未找到条目', id);
    return false;
  }

  const catId = item.categoryId;
  state.pack.items = state.pack.items.filter(i => i.id !== id);

  // 重新排序该分类下的其他条目
  if (catId) {
    getItemsByCategory(catId, false).forEach((it, idx) => {
      it.order = idx;
    });
  }

  persistPack({ immediate: true });
  toast('条目已删除');
  return true;
}

/**
 * 移动条目到新分类
 * @param id - 条目ID
 * @param newCategoryId - 目标分类ID
 * @returns 是否移动成功
 */
export function moveItem(id: string, newCategoryId: string | null): boolean {
  if (!state.pack) return false;

  const item = state.pack.items.find(i => i.id === id);
  if (!item) {
    logError('移动条目失败：未找到条目', id);
    return false;
  }

  // 验证目标分类是否存在
  if (newCategoryId && !state.pack.categories.find(c => c.id === newCategoryId)) {
    logError('移动条目失败：目标分类不存在', newCategoryId);
    return false;
  }

  const oldCatId = item.categoryId;

  // 获取目标分类下的现有条目
  const siblings = state.pack.items
    .filter(i => i.categoryId === newCategoryId && i.id !== id)
    .sort((a, b) => a.order - b.order);

  // 更新条目分类和顺序
  item.categoryId = newCategoryId;
  item.order = siblings.length;
  siblings.push(item);

  // 重新排序旧分类下的条目
  if (oldCatId && oldCatId !== newCategoryId) {
    getItemsByCategory(oldCatId, false).forEach((it, idx) => {
      it.order = idx;
    });
  }

  // 重新排序新分类下的条目
  siblings.forEach((it, idx) => {
    it.order = idx;
  });

  persistPack({ immediate: true });
  toast('条目已移动');
  return true;
}

/**
 * 重新排序条目
 * @param categoryId - 分类ID
 * @param orderedIds - 排序后的条目ID数组
 * @returns 是否排序成功
 */
export function reorderItems(categoryId: string | null, orderedIds: string[]): boolean {
  if (!state.pack) return false;

  const items = getItemsByCategory(categoryId, false);
  const itemMap = new Map(items.map(i => [i.id, i]));

  // 验证所有ID都存在
  for (const id of orderedIds) {
    if (!itemMap.has(id)) {
      logError('重新排序失败：条目ID不存在', id);
      return false;
    }
  }

  // 应用新顺序
  orderedIds.forEach((id, idx) => {
    const item = itemMap.get(id);
    if (item) {
      item.order = idx;
    }
  });

  persistPack();
  return true;
}

/**
 * 切换条目收藏状态
 * @param id - 条目ID
 * @returns 切换后的收藏状态，未找到时返回null
 */
export function toggleItemFavorite(id: string): boolean | null {
  if (!state.pack) return null;

  const item = state.pack.items.find(i => i.id === id);
  if (!item) {
    logError('切换收藏失败：未找到条目', id);
    return null;
  }

  item.favorite = !item.favorite;
  persistPack({ immediate: true });
  toast(item.favorite ? '已收藏' : '已取消收藏');
  return item.favorite;
}

/**
 * 执行条目（追加或注入）
 * @param item - 要执行的条目
 * @returns Promise<void>
 */
export async function runItem(item: Item): Promise<void> {
  if (!state.pack) return;

  // 解析占位符
  const parsed = resolvePlaceholdersForRun(item.content || '');

  // 添加到预览
  addPreviewToken('item', item.name, parsed);

  // 获取当前角色映射，同步角色映射（如果有）
  const mapping = getCurrentRolePlaceholderMap(false);
  if (mapping && Object.keys(mapping).length > 0) {
    handleActiveCharacterContextChanged({ silent: true });
  }

  if (item.mode === 'inject') {
    const ok = await injectContentToContext(parsed, item.name);
    if (ok) {
      toast(`已注入: ${item.name}`);
    }
    return;
  }

  // 追加模式
  appendToInputBox(`<${parsed}>`);
  toast(`已追加: ${item.name}`);

  logInfo('执行条目', item.name);
}

/**
 * 直接执行条目（带连接符前缀处理）
 * @param item - 要执行的条目
 * @returns Promise<void>
 */
export async function runItemDirect(item: Item): Promise<void> {
  if (!state.pack) return;

  if (item.mode === 'append' && state.pack.settings.defaults.connectorPrefixMode) {
    const activeConn = getActivePrefixConnector();
    if (activeConn) addConnector(activeConn, { silent: true });
  }

  await runItem(item);
}

/**
 * 获取当前激活的前缀连接符
 * @returns 连接符对象，未找到时返回null
 */
function getActivePrefixConnector(): { id: string; label: string; token: string } | null {
  if (!state.pack) return null;
  const connectors = state.pack.settings.connectors || [];
  if (!connectors.length) return null;
  const selectedId = state.pack.settings.defaults.connectorPrefixId;
  const selected = connectors.find(c => c.id === selectedId);
  if (selected) return selected;
  state.pack.settings.defaults.connectorPrefixId = connectors[0].id;
  persistPack();
  return connectors[0];
}

/**
 * 添加连接符到输入框
 * @param connector - 连接符对象
 * @param opts - 选项
 */
function addConnector(connector: { id: string; label: string; token: string }, opts?: { silent?: boolean }): void {
  appendToInputBox(connector.token);

  // 添加到预览
  addPreviewToken('conn-id:' + connector.id, connector.token, connector.token);

  if (!opts?.silent) toast(`已插入"${connector.label}"`);
}

/**
 * 解析占位符（执行时版本）
 * @param content - 原始内容
 * @returns 解析后的内容
 */
function resolvePlaceholdersForRun(content: string): string {
  const placeholders = state.pack?.settings?.placeholders || {};
  const placeholderRoleMaps = state.pack?.settings?.placeholderRoleMaps || { byCharacterId: {}, characterMeta: {} };
  const activeCharacterId = (state as unknown as { activeCharacterId?: string }).activeCharacterId || null;

  let result = content;

  // 解析 {@key} 或 {@key:value} 格式的占位符
  const placeholderRegex = /\{@([^:}]+)(?::([^}]*))?\}/g;
  result = result.replace(placeholderRegex, (_match, key, fallback) => {
    if (activeCharacterId && placeholderRoleMaps.byCharacterId[activeCharacterId]) {
      const charMap = placeholderRoleMaps.byCharacterId[activeCharacterId];
      if (charMap[key] !== undefined && String(charMap[key]).length > 0) {
        return charMap[key];
      }
    }
    if (placeholders[key] !== undefined && String(placeholders[key]).length > 0) {
      return placeholders[key];
    }
    return fallback !== undefined ? String(fallback) : '';
  });

  return result;
}

/**
 * 复制条目
 * @param id - 要复制的条目ID
 * @returns 新创建的条目副本，未找到时返回null
 */
export function duplicateItem(id: string): Item | null {
  if (!state.pack) return null;

  const item = state.pack.items.find(i => i.id === id);
  if (!item) {
    logError('复制条目失败：未找到条目', id);
    return null;
  }

  const siblings = getItemsByCategory(item.categoryId, false);
  const copy = deepClone(item);
  copy.id = uid('item');
  copy.name = `${item.name} (复制)`;
  copy.order = siblings.length;
  copy.favorite = false;

  state.pack.items.push(copy);
  persistPack({ immediate: true });
  toast('条目已复制');
  return copy;
}

/**
 * 插入快速回复内容到输入框
 * @param itemId - 条目ID
 * @param mode - 插入模式，可选'append'或'inject'，默认使用条目设置
 * @returns 是否插入成功
 */
export async function insertQrContent(itemId: string, mode?: 'append' | 'inject'): Promise<boolean> {
  if (!state.pack) return false;

  const item = state.pack.items.find(i => i.id === itemId);
  if (!item) {
    logError('插入内容失败：未找到条目', itemId);
    return false;
  }

  const useMode = mode || item.mode;
  const content = item.content || '';

  if (!content.trim()) {
    toast('条目内容为空');
    return false;
  }

  try {
    // 解析占位符
    const parsed = resolvePlaceholdersForInsert(content);

    if (useMode === 'inject') {
      // 注入模式
      const ok = await injectContentToContext(parsed, item.name);
      if (ok) {
        toast(`已注入: ${item.name}`);
      }
      return ok;
    } else {
      // 追加模式
      appendToInputBox(`<${parsed}>`);
      toast(`已追加: ${item.name}`);
      return true;
    }
  } catch (e) {
    logError('插入内容失败', e);
    return false;
  }
}

// ============================================================================
// 内部辅助函数
// ============================================================================

/**
 * 解析占位符
 * @param content - 原始内容
 * @returns 解析后的内容
 */
function resolvePlaceholdersForInsert(content: string): string {
  // 获取占位符映射
  const placeholders = state.pack?.settings?.placeholders || {};
  const placeholderRoleMaps = state.pack?.settings?.placeholderRoleMaps || { byCharacterId: {}, characterMeta: {} };
  const activeCharacterId = (state as unknown as { activeCharacterId?: string }).activeCharacterId || null;

  let result = content;

  // 解析 {@key} 或 {@key:default} 格式的占位符
  const placeholderRegex = /\{@([^:}]+)(?::([^}]*))?\}/g;
  result = result.replace(placeholderRegex, (_match, key, fallback) => {
    // 首先检查角色特定的映射
    if (activeCharacterId && placeholderRoleMaps.byCharacterId[activeCharacterId]) {
      const charMap = placeholderRoleMaps.byCharacterId[activeCharacterId];
      if (charMap[key] !== undefined && String(charMap[key]).length > 0) {
        return charMap[key];
      }
    }

    // 使用全局占位符映射
    if (placeholders[key] !== undefined && String(placeholders[key]).length > 0) {
      return placeholders[key];
    }

    // 返回默认值或空字符串
    return fallback !== undefined ? String(fallback) : '';
  });

  return result;
}

/**
 * 注入内容到上下文
 * @param content - 要注入的内容
 * @param itemName - 条目名称（用于错误提示）
 * @returns 是否注入成功
 */
async function injectContentToContext(content: string, itemName: string): Promise<boolean> {
  try {
    if (typeof injectPrompts === 'function') {
      injectPrompts(
        [
          {
            id: uid('inject'),
            position: 'in_chat',
            depth: 1,
            role: 'system',
            content,
          },
        ],
        { once: true },
      );
      return true;
    }
  } catch (e) {
    logError('injectPrompts 注入失败', String(e));
  }

  try {
    // 尝试使用STScript注入
    const ctx = (
      window.parent as unknown as { SillyTavern?: { getContext?: () => unknown } }
    ).SillyTavern?.getContext?.();
    if (
      (ctx as { executeSlashCommandsWithOptions?: (cmd: string) => Promise<unknown> })?.executeSlashCommandsWithOptions
    ) {
      const safe = content.replace(/"/g, '\\"');
      await (
        ctx as { executeSlashCommandsWithOptions: (cmd: string) => Promise<unknown> }
      ).executeSlashCommandsWithOptions(`/inject id=${uid('inj')} "${safe}"`);
      return true;
    }
  } catch (e) {
    logError('Slash 注入失败', String(e));
  }

  toast(`注入失败: ${itemName}`);
  return false;
}

/**
 * 追加内容到输入框
 * @param content - 要追加的内容
 * @param options - 选项
 */
function appendToInputBox(content: string, options?: { suspendSync?: boolean }): void {
  const pW = window.parent as typeof window;
  const pD = pW.document || document;
  const ta = pD.querySelector('#send_textarea') as HTMLTextAreaElement | null;

  if (!ta) {
    toast('未找到输入框');
    return;
  }

  // 暂存当前同步状态
  const wasSuspended = state.suspendInputSync;

  if (options?.suspendSync) {
    state.suspendInputSync = true;
  }

  try {
    const raw = String(ta.value || '');
    const next = raw + content;
    ta.value = next;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  } finally {
    // 恢复同步状态
    if (options?.suspendSync) {
      state.suspendInputSync = wasSuspended;
    }
  }
}
