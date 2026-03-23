/**
 * 导入导出模块
 * @description 提供快速回复包的导入导出功能，支持JSON序列化和文件操作
 */

import type { Pack, PackMeta, Category, Item, Settings, UiState } from '../types';
import { state, updatePack } from '../store';
import { DATA_VERSION, SCRIPT_LABEL, CONNECTOR_ONLY_KEYS } from '../constants';
import { deepClone, nowIso } from '../utils/data';
import { uid } from '../utils/dom';
import { logError } from '../services/debug';
import { toast } from '../ui/components';

// ============================================================================
// 类型守卫
// ============================================================================

/**
 * 检查是否为有效的Pack元数据
 * @param data 待检查的数据
 * @returns 是否为有效的Pack元数据
 */
function isValidPackMeta(data: unknown): data is PackMeta {
  if (!data || typeof data !== 'object') return false;
  const meta = data as Record<string, unknown>;
  return (
    typeof meta.version === 'number' &&
    typeof meta.createdAt === 'string' &&
    typeof meta.source === 'string' &&
    typeof meta.name === 'string'
  );
}

/**
 * 检查是否为有效的Category
 * @param data 待检查的数据
 * @returns 是否为有效的Category
 */
function isValidCategory(data: unknown): data is Category {
  if (!data || typeof data !== 'object') return false;
  const cat = data as Record<string, unknown>;
  return (
    typeof cat.id === 'string' &&
    typeof cat.name === 'string' &&
    (cat.parentId === null || typeof cat.parentId === 'string') &&
    typeof cat.order === 'number' &&
    typeof cat.collapsed === 'boolean'
  );
}

/**
 * 检查是否为有效的Item
 * @param data 待检查的数据
 * @returns 是否为有效的Item
 */
function isValidItem(data: unknown): data is Item {
  if (!data || typeof data !== 'object') return false;
  const item = data as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    (item.categoryId === null || typeof item.categoryId === 'string') &&
    typeof item.name === 'string' &&
    typeof item.content === 'string' &&
    (item.mode === 'append' || item.mode === 'inject') &&
    typeof item.favorite === 'boolean' &&
    typeof item.order === 'number'
  );
}

/**
 * 检查是否为旧版QR JSON格式
 * @param data 待检查的数据
 * @returns 是否为旧版QR JSON
 */
function isLegacyQrJson(data: unknown): data is { qrList: unknown[] } & Record<string, unknown> {
  return !!(data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).qrList));
}

// ============================================================================
// Pack 规范化
// ============================================================================

/**
 * 规范化快速回复包
 * @description 确保Pack数据结构完整，填充默认值
 * @param pack 待规范化的Pack数据
 * @returns 规范化后的Pack
 */
function normalizePack(pack: unknown): Pack {
  const safe = (pack && typeof pack === 'object' ? deepClone(pack as Pack) : {}) as Partial<Pack>;

  // 元数据
  safe.meta = safe.meta || ({} as PackMeta);
  safe.meta!.version = Number(safe.meta!.version) || DATA_VERSION;
  safe.meta!.createdAt = safe.meta!.createdAt || nowIso();
  safe.meta!.updatedAt = nowIso();
  safe.meta!.source = safe.meta!.source || SCRIPT_LABEL;
  safe.meta!.name = safe.meta!.name || '💌快速回复管理器数据';

  // 核心数据
  safe.categories = Array.isArray(safe.categories) ? safe.categories : [];
  safe.items = Array.isArray(safe.items) ? safe.items : [];

  // 设置
  safe.settings = safe.settings || ({} as Settings);
  safe.settings!.placeholders = safe.settings!.placeholders || {
    用户: '用户',
    角色: '角色',
    苦主: '苦主',
    黄毛: '黄毛',
  };
  // 删除保留键
  for (const key of CONNECTOR_ONLY_KEYS) delete safe.settings!.placeholders[key];

  safe.settings!.placeholderRoleMaps = safe.settings!.placeholderRoleMaps || {
    byCharacterId: {},
    characterMeta: {},
  };
  if (
    !safe.settings!.placeholderRoleMaps.byCharacterId ||
    typeof safe.settings!.placeholderRoleMaps.byCharacterId !== 'object'
  ) {
    safe.settings!.placeholderRoleMaps.byCharacterId = {};
  }
  if (
    !safe.settings!.placeholderRoleMaps.characterMeta ||
    typeof safe.settings!.placeholderRoleMaps.characterMeta !== 'object'
  ) {
    safe.settings!.placeholderRoleMaps.characterMeta = {};
  }

  // 令牌
  safe.settings!.tokens = safe.settings!.tokens || {
    simultaneous: '<同时>',
    then: '<然后>',
  };

  // 连接器
  if (!Array.isArray(safe.settings!.connectors) || !safe.settings!.connectors.length) {
    safe.settings!.connectors = [
      { id: uid('conn'), label: '然后', token: safe.settings!.tokens?.then || '<然后>', color: 'orange' },
      { id: uid('conn'), label: '同时', token: safe.settings!.tokens?.simultaneous || '<同时>', color: 'purple' },
    ];
  }

  // Toast设置
  safe.settings!.toast = safe.settings!.toast || {
    maxStack: 4,
    timeout: 1800,
  };

  // 默认值
  safe.settings!.defaults = safe.settings!.defaults || {
    mode: 'append',
    previewExpanded: true,
    connectorPrefixMode: false,
    connectorPrefixId: null,
  };
  if (typeof safe.settings!.defaults.connectorPrefixMode !== 'boolean') {
    safe.settings!.defaults.connectorPrefixMode = false;
  }
  safe.settings!.defaults.connectorPrefixId = safe.settings!.defaults.connectorPrefixId ?? null;

  // UI设置
  safe.settings!.ui = safe.settings!.ui || { theme: 'herdi-light', customCSS: '' };
  if (!('customCSS' in safe.settings!.ui)) (safe.settings!.ui as Record<string, string>).customCSS = '';

  // UI状态
  safe.uiState = safe.uiState || ({} as UiState);
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

  // 面板大小
  if (!safe.uiState!.panelSize || typeof safe.uiState!.panelSize !== 'object') {
    safe.uiState!.panelSize = { width: 1040, height: 660 };
  }
  safe.uiState!.panelSize!.width = Number(safe.uiState!.panelSize!.width) || 1040;
  safe.uiState!.panelSize!.height = Number(safe.uiState!.panelSize!.height) || 660;
  safe.uiState!.lastPath = safe.uiState!.lastPath || [];

  // 收藏
  safe.favorites = Array.isArray(safe.favorites) ? safe.favorites : [];

  // 修复分类数据
  const categoryIds = new Set<string>();
  for (const cat of safe.categories) {
    if (!cat.id) cat.id = uid('cat');
    if (typeof cat.order !== 'number') cat.order = 0;
    if (typeof cat.collapsed !== 'boolean') cat.collapsed = false;
    if (!('parentId' in cat)) (cat as Category).parentId = null;
    categoryIds.add(cat.id);
  }

  // 修复条目数据
  for (const item of safe.items) {
    if (!item.id) item.id = uid('item');
    if (!item.categoryId || !categoryIds.has(item.categoryId)) {
      item.categoryId = safe.categories[0]?.id || null;
    }
    if (typeof item.order !== 'number') item.order = 0;
    item.mode = item.mode === 'inject' ? 'inject' : 'append';
    item.favorite = Boolean(item.favorite) || safe.favorites.includes(item.id);
  }

  // 更新收藏列表
  safe.favorites = safe.items.filter(i => i.favorite).map(i => i.id);

  // 版本升级
  if (safe.meta!.version < DATA_VERSION) {
    safe.meta!.version = DATA_VERSION;
  }

  return safe as Pack;
}

// ============================================================================
// 旧版QR转换
// ============================================================================

interface LegacyQrItem {
  label?: string;
  message?: string;
}

interface LegacyQr {
  name?: string;
  qrList?: LegacyQrItem[];
}

/**
 * 清理旧版文本
 * @param text 旧版文本
 * @returns 清理后的文本
 */
function sanitizeLegacyText(text: string): string {
  return String(text || '')
    .replace(/\{\{input\}\}|\{input\}/g, '')
    .trim();
}

/**
 * 检查是否包含被阻止的内容
 * @param text 待检查的文本
 * @returns 是否包含被阻止的内容
 */
function containsBlockedContent(text: string): boolean {
  const blocked = ['未成年', '幼女', '幼男', '正太', '萝莉', '小男孩', '小女孩', '儿童'];
  const raw = String(text || '');
  return blocked.some(kw => raw.includes(kw));
}

/**
 * 将旧版QR转换为Pack
 * @param legacy 旧版QR数据
 * @returns 转换结果
 */
function convertLegacyQrToPack(legacy: LegacyQr): { pack: Pack; skippedUnsafe: number } {
  const rootId = uid('cat');
  const rootName = String(legacy.name || 'QR导入').trim() || 'QR导入';
  const categories: Category[] = [{ id: rootId, name: rootName, parentId: null, order: 0, collapsed: false }];
  const items: Item[] = [];

  const labelToCatId = new Map<string, string>();
  const childParentMap = new Map<string, string>();
  const list = Array.isArray(legacy.qrList) ? legacy.qrList : [];

  // 创建分类
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

  // 解析条目
  let skippedUnsafe = 0;
  for (const q of list) {
    const curLabel = String(q?.label || '').trim();
    const curCatId = labelToCatId.get(curLabel);
    if (!curCatId) continue;
    const msg = String(q?.message || '');
    const ruleRegex = /right="([^"]+)"\s*\{:\s*([\s\S]*?)\s*:\}/g;
    let m: RegExpExecArray | null;
    let localOrder = items.filter(it => it.categoryId === curCatId).length;

    while ((m = ruleRegex.exec(msg)) !== null) {
      const choice = String(m[1] || '').trim();
      const action = String(m[2] || '').trim();
      if (!choice || ['⬅️返回', '✨然后', '⚡同时', '--------'].includes(choice)) continue;

      const runMatch = action.match(/\/run\s+([^\n|:}]+)/);

      if (runMatch) {
        const targetLabel = String(runMatch[1] || '').trim();
        if (labelToCatId.has(targetLabel) && targetLabel !== curLabel && !childParentMap.has(targetLabel)) {
          childParentMap.set(targetLabel, curLabel);
        }
      }

      let mode: 'append' | 'inject' | null = null;
      let content = '';
      const setInputMatch = action.match(/\/setinput[\s\S]*?<([\s\S]*?)>/);
      const injectMatch = action.match(/\/inject(?:\s+[^\n]*)?\s*"?([\s\S]*?)"?(?:\s*\|\||$)/);

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

      const duplicateCount = items.filter(it => it.categoryId === curCatId && it.name === choice).length;
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

  // 更新分类父子关系
  for (const [childLabel, parentLabel] of childParentMap.entries()) {
    const childId = labelToCatId.get(childLabel);
    const parentId = labelToCatId.get(parentLabel);
    const child = categories.find(c => c.id === childId);
    if (child && parentId && child.id !== parentId) child.parentId = parentId;
  }

  // 排序
  const byParent = new Map<string | null, Category[]>();
  for (const c of categories) {
    const key = c.parentId || 'root';
    const arr = byParent.get(key) || [];
    arr.push(c);
    byParent.set(key, arr);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    arr.forEach((c, idx) => {
      c.order = idx;
    });
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
      settings: {} as Settings,
      uiState: {} as UiState,
      favorites: [],
    }),
    skippedUnsafe,
  };
}

// ============================================================================
// 导出功能
// ============================================================================

/**
 * 导出Pack为JSON字符串
 * @description 将当前Pack序列化为格式化的JSON字符串
 * @returns JSON字符串
 */
export function exportPackToJson(): string {
  if (!state.pack) {
    throw new Error('没有可导出的数据');
  }

  const packToExport = deepClone(state.pack);

  // 更新元数据
  packToExport.meta.updatedAt = nowIso();
  packToExport.meta.source = SCRIPT_LABEL;

  // 更新收藏列表
  packToExport.favorites = packToExport.items.filter(i => i.favorite).map(i => i.id);

  return JSON.stringify(packToExport, null, 2);
}

/**
 * 导出Pack为JSON字符串（简化版，不依赖state）
 * @param pack 要导出的Pack
 * @returns JSON字符串
 */
export function exportPackToJsonSafe(pack: Pack): string {
  const packToExport = deepClone(pack);

  // 更新元数据
  packToExport.meta.updatedAt = nowIso();
  packToExport.meta.source = SCRIPT_LABEL;

  // 更新收藏列表
  packToExport.favorites = packToExport.items.filter(i => i.favorite).map(i => i.id);

  return JSON.stringify(packToExport, null, 2);
}

/**
 * 导出Pack到文件
 * @description 将当前Pack导出为JSON文件并触发下载
 */
export function exportPackToFile(): void {
  try {
    const json = exportPackToJson();
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });

    const pW = window.parent as typeof window;
    const pD = pW.document || document;

    const a = pD.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `快速回复管理器_导出_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);

    toast('导出成功');
  } catch (e) {
    logError('导出失败', e);
    toast('导出失败');
    throw e;
  }
}

/**
 * 导出Pack子树到文件
 * @param pack 要导出的Pack
 * @param categoryIds 要导出的分类ID集合
 * @param filename 文件名（可选）
 */
export function exportPackSubtreeToFile(pack: Pack, categoryIds: Set<string>, filename?: string): void {
  const payload = normalizePack({
    meta: {
      version: DATA_VERSION,
      createdAt: nowIso(),
      source: SCRIPT_LABEL,
      name: `导出_${pack.meta.name || '分类子树'}`,
    },
    categories: pack.categories.filter(c => categoryIds.has(c.id)),
    items: pack.items.filter(i => categoryIds.has(i.categoryId || '')),
    settings: deepClone(pack.settings),
    uiState: deepClone(pack.uiState),
    favorites: pack.favorites.filter(id => pack.items.find(x => x.id === id && categoryIds.has(x.categoryId || ''))),
  });

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });

  const pW = window.parent as typeof window;
  const pD = pW.document || document;

  const a = pD.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename || `快速回复管理器_导出_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);

  toast('导出成功');
}

// ============================================================================
// 导入功能
// ============================================================================

/**
 * 从JSON字符串导入Pack
 * @description 解析JSON字符串并验证数据结构
 * @param json JSON字符串
 * @returns 解析后的Pack，失败返回null
 */
export function importPackFromJson(json: string): Pack | null {
  try {
    const raw = String(json || '').trim();
    if (!raw) {
      logError('导入失败：空内容');
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      logError('导入失败：JSON解析错误', e);
      return null;
    }

    // 处理旧版QR格式
    if (isLegacyQrJson(parsed)) {
      const converted = convertLegacyQrToPack(parsed as LegacyQr);
      if (converted.skippedUnsafe > 0) {
        toast(`已自动过滤 ${converted.skippedUnsafe} 条不兼容条目`);
      }
      return converted.pack;
    }

    // 验证并规范化
    if (!validatePack(parsed)) {
      logError('导入失败：数据结构验证失败');
      return null;
    }

    return normalizePack(parsed);
  } catch (e) {
    logError('导入失败', e);
    return null;
  }
}

/**
 * 从文件导入Pack
 * @description 读取文件内容并导入为Pack
 * @param file 要导入的文件
 * @returns Promise<Pack | null> 导入的Pack，失败返回null
 */
export async function importPackFromFile(file: File): Promise<Pack | null> {
  try {
    if (!file) {
      toast('请选择文件');
      return null;
    }

    const text = await file.text();
    const result = importPackFromJson(text);

    if (result) {
      toast(`已导入: ${file.name}`);
    } else {
      toast('导入失败：文件格式错误或数据无效');
    }

    return result;
  } catch (e) {
    logError('读取文件失败', e);
    toast('读取文件失败');
    return null;
  }
}

// ============================================================================
// 验证功能
// ============================================================================

/**
 * 验证Pack数据结构
 * @description 验证数据是否符合Pack的基本结构要求
 * @param data 待验证的数据
 * @returns 是否为有效的Pack结构
 */
export function validatePack(data: unknown): data is Pack {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const pack = data as Partial<Pack>;

  // 验证必要字段
  if (!isValidPackMeta(pack.meta)) {
    return false;
  }

  // 验证数组字段
  if (!Array.isArray(pack.categories)) {
    return false;
  }
  if (!Array.isArray(pack.items)) {
    return false;
  }
  if (!Array.isArray(pack.favorites)) {
    return false;
  }

  // 验证分类数据
  for (const cat of pack.categories) {
    if (!isValidCategory(cat)) {
      return false;
    }
  }

  // 验证条目数据
  for (const item of pack.items) {
    if (!isValidItem(item)) {
      return false;
    }
  }

  return true;
}

// ============================================================================
// 迁移功能
// ============================================================================

/**
 * 迁移旧版本数据
 * @description 将旧版本的数据结构迁移到当前版本
 * @param data 旧版本数据
 * @returns 迁移后的Pack
 */
export function migratePack(data: unknown): Pack {
  if (!data || typeof data !== 'object') {
    logError('迁移失败：无效的数据');
    return buildDefaultPack();
  }

  const pack = data as Partial<Pack>;

  // 如果没有元数据，视为非常旧的数据
  if (!pack.meta) {
    pack.meta = {
      version: 0,
      createdAt: nowIso(),
      source: 'migration',
      name: '迁移的数据',
    };
  }

  const originalVersion = pack.meta.version || 0;

  // 版本0 -> 版本1的迁移
  if (originalVersion < 1) {
    // 确保基本字段存在
    pack.categories = pack.categories || [];
    pack.items = pack.items || [];
    pack.settings = pack.settings || ({} as Settings);
    pack.uiState = pack.uiState || ({} as UiState);
    pack.favorites = pack.favorites || [];
  }

  // 使用normalizePack完成剩余规范化
  const normalized = normalizePack(pack);

  // 记录迁移
  if (originalVersion < DATA_VERSION) {
    logError(`数据已从版本 ${originalVersion} 迁移到版本 ${DATA_VERSION}`);
  }

  return normalized;
}

/**
 * 构建默认Pack
 * @returns 默认的Pack对象
 */
function buildDefaultPack(): Pack {
  const catRoot = uid('cat');
  const catPlot = uid('cat');
  const catTime = uid('cat');
  const catScene = uid('cat');

  const categories: Category[] = [
    { id: catRoot, name: '👑超级菜单', parentId: null, order: 0, collapsed: false },
    { id: catPlot, name: '🎬剧情编排', parentId: catRoot, order: 0, collapsed: false },
    { id: catTime, name: '⏰时间推进', parentId: catPlot, order: 0, collapsed: false },
    { id: catScene, name: '🧭场景安排', parentId: catPlot, order: 1, collapsed: false },
  ];

  const items: Item[] = [
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
      categoryId: catScene,
      name: '安排新角色登场',
      content: '根据当前剧情安排一名新角色合理登场，保持世界观一致。',
      mode: 'append',
      favorite: true,
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
      placeholderRoleMaps: {
        byCharacterId: {},
        characterMeta: {},
      },
      tokens: {
        simultaneous: '<同时>',
        then: '<然后>',
      },
      connectors: [
        { id: uid('conn'), label: '然后', token: '<然后>', color: 'orange' },
        { id: uid('conn'), label: '同时', token: '<同时>', color: 'purple' },
      ],
      toast: {
        maxStack: 4,
        timeout: 1800,
      },
      defaults: {
        mode: 'append',
        previewExpanded: true,
        connectorPrefixMode: false,
        connectorPrefixId: null,
      },
      ui: {
        theme: 'herdi-light',
        customCSS: '',
      },
      qrLlm: {} as Settings['qrLlm'],
    } as Settings,
    uiState: {
      sidebar: { expanded: {}, width: 280, collapsed: false },
      preview: { expanded: true, height: 140, tokens: [] },
      panelSize: { width: 1040, height: 660 },
      lastPath: [catRoot, catPlot],
    } as UiState,
    favorites: items.filter(i => i.favorite).map(i => i.id),
  });
}

// ============================================================================
// 辅助工具
// ============================================================================

/**
 * 收集子树中的所有分类ID
 * @param pack Pack数据
 * @param rootId 根分类ID
 * @returns 包含所有子分类ID的集合
 */
export function collectSubtreeIds(pack: Pack, rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const c of pack.categories) {
      if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) {
        ids.add(c.id);
        changed = true;
      }
    }
  }

  return ids;
}

/**
 * 合并两个Pack
 * @description 将源Pack合并到目标Pack
 * @param target 目标Pack
 * @param source 源Pack
 * @param options 合并选项
 * @returns 合并后的Pack
 */
export function mergePacks(
  target: Pack,
  source: Pack,
  options: {
    skipConflicts?: boolean;
    prefix?: string;
  } = {},
): Pack {
  const result = deepClone(target);
  const { skipConflicts = false, prefix = '' } = options;

  // 分类ID映射表（用于处理ID冲突）
  const catIdMap = new Map<string, string>();

  // 合并分类
  for (const cat of source.categories) {
    const existing = result.categories.find(c => c.name === cat.name && c.parentId === cat.parentId);

    if (existing) {
      if (skipConflicts) {
        catIdMap.set(cat.id, existing.id);
        continue;
      }
      // 重命名
      const newCat = deepClone(cat);
      newCat.id = uid('cat');
      newCat.name = prefix ? `${prefix}_${cat.name}` : `${cat.name}_导入`;
      result.categories.push(newCat);
      catIdMap.set(cat.id, newCat.id);
    } else {
      const newCat = deepClone(cat);
      if (result.categories.find(c => c.id === newCat.id)) {
        catIdMap.set(cat.id, newCat.id);
        newCat.id = uid('cat');
      }
      result.categories.push(newCat);
      catIdMap.set(cat.id, newCat.id);
    }
  }

  // 合并条目
  for (const item of source.items) {
    const mappedCatId = catIdMap.get(item.categoryId || '') || item.categoryId;
    const existing = result.items.find(i => i.name === item.name && i.categoryId === mappedCatId);

    if (existing) {
      if (skipConflicts) continue;
      // 重命名
      const newItem = deepClone(item);
      newItem.id = uid('item');
      newItem.name = prefix ? `${prefix}_${item.name}` : `${item.name}_导入`;
      newItem.categoryId = mappedCatId || null;
      result.items.push(newItem);
    } else {
      const newItem = deepClone(item);
      if (result.items.find(i => i.id === newItem.id)) {
        newItem.id = uid('item');
      }
      newItem.categoryId = mappedCatId || null;
      result.items.push(newItem);
    }
  }

  // 更新收藏
  result.favorites = result.items.filter(i => i.favorite).map(i => i.id);
  result.meta.updatedAt = nowIso();

  return normalizePack(result);
}

/**
 * 创建Pack备份
 * @description 创建当前Pack的备份副本
 * @returns 备份的Pack
 */
export function createPackBackup(): Pack | null {
  if (!state.pack) return null;

  const backup = deepClone(state.pack);
  backup.meta.name = `${backup.meta.name}_备份_${new Date().toLocaleString('zh-CN')}`;
  backup.meta.updatedAt = nowIso();

  return backup;
}

/**
 * 从备份恢复Pack
 * @description 从备份数据恢复Pack
 * @param backup 备份的Pack
 * @returns 是否恢复成功
 */
export function restorePackFromBackup(backup: Pack): boolean {
  try {
    if (!validatePack(backup)) {
      toast('备份数据无效');
      return false;
    }

    const restored = normalizePack(backup);
    updatePack(restored);
    toast('已从备份恢复');
    return true;
  } catch (e) {
    logError('恢复备份失败', e);
    toast('恢复备份失败');
    return false;
  }
}
