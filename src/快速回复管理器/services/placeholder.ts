/**
 * 占位符服务
 * @description 处理占位符解析、提取和角色相关占位符管理
 */

import { state } from '../store';
import { logError } from './debug';
import { invalidateEditGeneration } from './llm';

// ============================================================================
// 全局访问辅助函数
// ============================================================================

/**
 * 解析宿主窗口
 * @returns 父窗口对象
 */
function resolveHostWindow(): Window {
  return window.parent as Window;
}

/**
 * 获取酒馆上下文
 * @returns 酒馆上下文对象
 */
function getContext(): unknown {
  try {
    const pW = resolveHostWindow();
    const st = (pW as { SillyTavern?: { getContext?: () => unknown } })?.SillyTavern;
    if (st?.getContext) return st.getContext();
  } catch (e) {
    // 忽略获取上下文失败
  }
  return null;
}

// ============================================================================
// 内部辅助函数
// ============================================================================

/**
 * 使用映射解析占位符
 * @param text - 包含占位符的文本
 * @param placeholders - 默认占位符映射
 * @param roleValues - 角色特定占位符值（可选）
 * @returns 解析后的文本
 */
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

// ============================================================================
// 公共 API
// ============================================================================

/**
 * 解析文本中的占位符并替换
 * @param text - 包含占位符的文本（支持 {@key} 格式）
 * @param values - 占位符值映射（优先使用）
 * @returns 解析后的文本
 */
export function resolvePlaceholders(text: string, values: Record<string, string>): string {
  const placeholders = state.pack?.settings?.placeholders || {};
  // 合并传入的值（优先）与默认占位符
  const mergedPlaceholders = { ...placeholders, ...values };
  const roleValues = getCurrentRolePlaceholderMap(false);
  return resolvePlaceholdersWithMap(text, mergedPlaceholders, roleValues);
}

/**
 * 从文本中提取所有占位符名称
 * @param text - 包含占位符的文本
 * @returns 唯一的占位符列表
 */
export function extractPlaceholderTokens(text: string): string[] {
  const tokens = new Set<string>();
  String(text || '').replace(/\{@([^:}]+)(?::([^}]*))?\}/g, full => {
    const token = String(full || '').trim();
    if (token) tokens.add(token);
    return full;
  });
  return Array.from(tokens.values());
}

/**
 * 获取当前角色的占位符映射
 * @param createIfMissing - 如果不存在是否创建
 * @returns 角色占位符映射或 null
 */
export function getCurrentRolePlaceholderMap(createIfMissing = false): Record<string, string> | null {
  if (!state.pack || state.activeIsGroupChat || !state.activeCharacterId) return null;
  const maps = state.pack.settings.placeholderRoleMaps.byCharacterId;
  if (!maps[state.activeCharacterId] && createIfMissing) maps[state.activeCharacterId] = {};
  return maps[state.activeCharacterId] || null;
}

/**
 * 获取所有有效的占位符值
 * @param placeholders - 占位符对象（可选，默认从state获取）
 * @param roleValues - 角色值对象（可选，默认从state获取）
 * @returns 合并后的占位符值（默认、用户设置和角色特定值）
 */
export function getEffectivePlaceholderValues(
  placeholders?: Record<string, string>,
  roleValues?: Record<string, string> | null,
): Record<string, string> {
  const finalPlaceholders = placeholders ?? state.pack?.settings?.placeholders ?? {};
  const finalRoleValues = roleValues ?? getCurrentRolePlaceholderMap(false);

  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(finalPlaceholders || {})) merged[k] = String(v ?? '');
  if (!finalRoleValues) return merged;
  for (const [k, v] of Object.entries(finalRoleValues || {})) {
    if (v !== undefined && String(v).length > 0) merged[k] = String(v);
  }
  return merged;
}

/**
 * 检测当前角色状态
 * @returns 角色状态信息，包括角色ID、名称和是否群聊
 */
export function detectCurrentCharacterState(): {
  characterId: string | null;
  characterName: string;
  isGroupChat: boolean;
} {
  const ctx = getContext() as Record<string, unknown>;
  const pW = resolveHostWindow();
  const st = (pW as { SillyTavern?: Record<string, unknown> })?.SillyTavern || {};
  const groupId = String(ctx?.groupId ?? st?.groupId ?? '').trim();
  const isGroupChat = Boolean(groupId);
  if (isGroupChat) return { characterId: null, characterName: '群聊', isGroupChat: true };

  const readExplicitCharacterRef = (): { raw: unknown; hasRef: boolean } => {
    const candidates: Array<[boolean, unknown]> = [
      [ctx && Object.prototype.hasOwnProperty.call(ctx, 'characterId'), ctx?.characterId],
      [ctx && Object.prototype.hasOwnProperty.call(ctx, 'character_id'), ctx?.character_id],
      [ctx && Object.prototype.hasOwnProperty.call(ctx, 'this_chid'), ctx?.this_chid],
      [st && Object.prototype.hasOwnProperty.call(st, 'characterId'), st?.characterId],
      [st && Object.prototype.hasOwnProperty.call(st, 'this_chid'), st?.this_chid],
      [
        typeof (globalThis as unknown as { this_chid?: unknown }).this_chid !== 'undefined',
        (globalThis as unknown as { this_chid?: unknown }).this_chid,
      ],
    ];
    for (const [hasRef, raw] of candidates) {
      if (!hasRef) continue;
      return { raw, hasRef: true };
    }
    return { raw: null, hasRef: false };
  };

  const findCardByRef = (rawRef: unknown): { avatar?: string; name?: string } | null => {
    const ref = String(rawRef ?? '').trim();
    const numericRef = Number(ref);
    const pick = (entry: unknown): { avatar?: string; name?: string } | null =>
      entry && typeof entry === 'object' ? entry : null;
    const pools: unknown[] = [];
    if (typeof getCharData === 'function') {
      try {
        pools.push(getCharData('all') as unknown);
      } catch (e) {
        // 忽略获取角色数据失败
      }
    }
    pools.push(
      ctx?.characters,
      ctx?.characterList,
      ctx?.allCharacters,
      st?.characters,
      st?.characterList,
      st?.allCharacters,
    );

    for (const all of pools) {
      if (!all) continue;
      if (Array.isArray(all)) {
        if (Number.isFinite(numericRef) && numericRef >= 0 && numericRef < all.length) {
          const byIndex = pick(all[Math.trunc(numericRef)]);
          if (byIndex) return byIndex;
        }
        const byMatch = pick(
          all.find(entry => {
            const avatar = String((entry as { avatar?: unknown })?.avatar ?? '').trim();
            const name = String((entry as { name?: unknown })?.name ?? '').trim();
            return ref && (avatar === ref || name === ref);
          }),
        );
        if (byMatch) return byMatch;
        continue;
      }
      if (typeof all === 'object') {
        const byKey = (all as Record<string, unknown>)[ref];
        if (byKey && typeof byKey === 'object') return pick(byKey);
        for (const [key, value] of Object.entries(all as Record<string, unknown>)) {
          const entry = pick(value);
          if (!entry) continue;
          const avatar = String(entry.avatar ?? key).trim();
          const name = String(entry.name ?? '').trim();
          if (ref && (avatar === ref || name === ref || key === ref)) return entry;
        }
      }
    }
    return null;
  };

  const explicitRef = readExplicitCharacterRef();
  const explicitRefText = String(explicitRef.raw ?? '').trim();
  const hasExplicitNoCharacter = explicitRef.hasRef && !explicitRefText;

  const currentCard =
    !hasExplicitNoCharacter && typeof getCharData === 'function'
      ? (getCharData('current') as { name?: string } | null) || null
      : null;
  const resolvedCard = explicitRefText ? findCardByRef(explicitRef.raw) || currentCard : currentCard;

  const characterId =
    String((resolvedCard as { avatar?: string; name?: string } | null)?.avatar || resolvedCard?.name || '').trim() ||
    null;
  let characterName = String(resolvedCard?.name || '').trim();
  if (!characterName) {
    try {
      if (typeof substitudeMacros === 'function') characterName = String(substitudeMacros('{{char}}') || '').trim();
    } catch (e) {
      // 忽略宏替换失败
    }
  }
  if (!characterId && characterName) {
    const byName = findCardByRef(characterName);
    if (byName) {
      return {
        characterId: String(byName.avatar || byName.name || '').trim() || null,
        characterName: String(byName.name || characterName || '').trim(),
        isGroupChat: false,
      };
    }
  }

  if (!characterId && hasExplicitNoCharacter) {
    return { characterId: null, characterName: '', isGroupChat: false };
  }
  return { characterId, characterName: characterName || '当前角色', isGroupChat: false };
}

/**
 * 同步当前角色映射
 * @param opts - 选项
 */
export function syncActiveCharacterMapping(opts?: { silent?: boolean; force?: boolean }): void {
  if (!state.pack) return;
  const prevKey = state.activeCharacterSwitchKey;
  const prevName = state.activeCharacterName;
  const detected = detectCurrentCharacterState();
  const nextKey = detected.isGroupChat
    ? '__group__'
    : detected.characterId
      ? `char:${detected.characterId}`
      : '__default__';
  const changed = opts?.force || nextKey !== prevKey || detected.characterName !== prevName;

  state.activeCharacterId = detected.characterId;
  state.activeCharacterName = detected.characterName;
  state.activeIsGroupChat = detected.isGroupChat;
  state.activeCharacterSwitchKey = nextKey;

  if (detected.characterId) {
    const meta = state.pack.settings.placeholderRoleMaps.characterMeta[detected.characterId] || {
      name: '',
      lastSeenAt: '',
    };
    meta.name = detected.characterName || meta.name || detected.characterId;
    meta.lastSeenAt = new Date().toISOString();
    state.pack.settings.placeholderRoleMaps.characterMeta[detected.characterId] = meta;
    if (!state.pack.settings.placeholderRoleMaps.byCharacterId[detected.characterId]) {
      state.pack.settings.placeholderRoleMaps.byCharacterId[detected.characterId] = {};
    }
  }

  if (changed && !opts?.silent) {
    const toastr = (
      window.parent as {
        toastr?: { success?: (msg: string) => void; warning?: (msg: string) => void; info?: (msg: string) => void };
      }
    )?.toastr;
    if (detected.isGroupChat) {
      toastr?.info?.('已切换到群聊模式，占位符使用默认值');
    } else {
      toastr?.info?.(`已切换占位符映射：${detected.characterName || '当前角色'}`);
    }
  }
}

/**
 * 处理活动角色上下文变更
 * @param opts - 选项
 * @returns 是否发生了变更
 */
export function handleActiveCharacterContextChanged(opts?: {
  silent?: boolean;
  force?: boolean;
  rerender?: boolean;
}): boolean {
  const prevKey = state.activeCharacterSwitchKey;
  syncActiveCharacterMapping({ silent: opts?.silent, force: opts?.force });
  const changed = prevKey !== state.activeCharacterSwitchKey;
  if (changed) {
    invalidateEditGeneration();
  }
  // 持久化和重新渲染的逻辑会在调用方处理
  return changed;
}

/**
 * 获取世界书条目选项
 * @param names - 世界书名称数组
 * @returns 条目选项数组
 */
export async function getWorldbookEntryOptionsByNames(
  names: string[],
): Promise<Array<{ value: string; label: string }>> {
  if (typeof getWorldbook !== 'function') return [];
  try {
    const uniqueNames = [...new Set((names || []).map(n => String(n || '').trim()).filter(Boolean))];
    const options: Array<{ value: string; label: string }> = [];
    const seen = new Set<string>();
    for (const wbName of uniqueNames) {
      const entries = await getWorldbook(wbName);
      for (const entry of entries || []) {
        const itemName = String((entry as { name?: string })?.name || '').trim();
        if (!itemName) continue;
        const key = itemName;
        if (seen.has(key)) continue;
        seen.add(key);
        options.push({ value: itemName, label: itemName });
      }
    }
    return options.sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'));
  } catch (e) {
    return [];
  }
}

/**
 * 获取当前角色绑定的世界书名称列表
 * @returns 世界书名称数组
 */
export function getCurrentCharacterBoundWorldbookNames(): string[] {
  try {
    const context = getContext() as {
      character?: {
        character_book?: string;
        data?: { character_book?: string };
      };
    } | null;

    if (!context?.character) return [];

    const bookName = context.character.character_book || context.character.data?.character_book;

    return bookName ? [bookName] : [];
  } catch (e) {
    logError('获取角色绑定世界书失败', String(e));
    return [];
  }
}

/**
 * 安全获取所有世界书名称
 * @returns 世界书名称数组
 */
export function getAllWorldbookNamesSafe(): string[] {
  try {
    const pW = resolveHostWindow();
    const worldInfo = (pW as { worldInfo?: { getWorldBooks?: () => Record<string, unknown> } }).worldInfo;

    if (worldInfo?.getWorldBooks) {
      const books = worldInfo.getWorldBooks();
      return Object.keys(books || {});
    }

    return [];
  } catch (e) {
    logError('获取世界书列表失败', String(e));
    return [];
  }
}

/**
 * 安全获取所有存在的角色卡
 * @returns 角色卡信息数组 {name: string, id: string}
 */
export function getExistingCharacterCardsSafe(): Array<{ name: string; id: string }> {
  try {
    const context = getContext() as {
      characters?: Array<{ name: string; avatar?: string }>;
    } | null;

    if (!context?.characters) return [];

    return context.characters.map((char, index) => ({
      name: char.name || '未命名',
      id: char.avatar || String(index),
    }));
  } catch (e) {
    logError('获取角色卡列表失败', String(e));
    return [];
  }
}

/**
 * 从文本中提取占位符及其默认值
 * @param text - 包含占位符的文本
 * @returns 占位符到默认值的映射
 */
export function extractPlaceholderFallbackMap(text: string): Record<string, string> {
  const map: Record<string, string> = {};

  String(text || '').replace(/\{@([^:}]+)(?::([^}]*))?\}/g, (_, key: string, fallback: string) => {
    if (key && fallback !== undefined) {
      map[key] = fallback;
    }
    return _;
  });

  return map;
}
