/**
 * 状态管理单例
 * @description 集中管理应用程序状态，提供状态访问和持久化功能
 */

import type { AppState, Pack } from './types';

const STORE_KEY = 'fastPlotQRPack';
const PERSIST_DEBOUNCE_MS = 260;

// 持久化计时器（模块级私有变量）
let persistTimer: ReturnType<typeof setTimeout> | null = null;
// 持久化序列号，用于防止竞态条件
let persistSeq = 0;

/**
 * 应用程序状态单例
 * @description 全局状态对象，包含所有运行时状态
 */
export const state: AppState = {
  pack: null,
  currentCategoryId: null,
  history: [],
  filter: '',
  contextMenu: null,
  longPressTimer: null,
  hostResizeHandler: null,
  resizeRaf: null,
  inputSyncTarget: null,
  inputSyncHandler: null,
  suspendInputSync: false,
  activeCharacterId: null,
  activeCharacterName: '',
  activeCharacterSwitchKey: '__boot__',
  activeIsGroupChat: false,
  qrLlmSecretCache: null,
  qrLlmModelList: [],
  editGenerateState: {
    isGenerating: false,
    abortController: null,
    lastDraftBeforeGenerate: '',
    lastGeneratedText: '',
    status: '',
    requestSeq: 0,
    activeRequestId: 0,
  },
  debugLogs: [],
  debugHooksBound: false,
  debugErrorHandler: null,
  debugRejectionHandler: null,
  storageLoadHadCorruption: false,
  lastLoadedPackUpdatedAt: '',
};

/**
 * 获取完整状态对象
 * @returns 当前应用程序状态
 */
export function getState(): AppState {
  return state;
}

/**
 * 获取当前快速回复包
 * @returns 当前Pack对象，如果没有则返回null
 */
export function getCurrentPack(): Pack | null {
  return state.pack;
}

/**
 * 获取当前分类ID
 * @returns 当前选中的分类ID，如果没有则返回null
 */
export function getCurrentCategoryId(): string | null {
  return state.currentCategoryId;
}

/**
 * 更新快速回复包
 * @description 替换当前pack并触发持久化（防抖）
 * @param pack - 新的Pack对象
 */
export function updatePack(pack: Pack): void {
  state.pack = pack;
  persistPack();
}

// 辅助函数：获取ISO格式当前时间
function nowIso(): string {
  return new Date().toISOString();
}

// 辅助函数：解析pack的更新时间戳（毫秒）
function parsePackUpdatedAtMs(pack: unknown): number {
  const ts = String(
    (pack as { meta?: { updatedAt?: string; createdAt?: string } } | null | undefined)?.meta?.updatedAt ||
      (pack as { meta?: { updatedAt?: string; createdAt?: string } } | null | undefined)?.meta?.createdAt ||
      '',
  ).trim();
  if (!ts) return 0;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : 0;
}

// 辅助函数：推入调试日志
function pushDebugLog(message: string, payload?: unknown): void {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const lines: string[] = [`[${ts}] ${String(message || '')}`];
  if (payload !== undefined) {
    try {
      lines.push(typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2));
    } catch {
      lines.push(String(payload));
    }
  }
  state.debugLogs.push(lines.join('\n'));
  if (state.debugLogs.length > 500) {
    state.debugLogs = state.debugLogs.slice(-500);
  }
}

// 辅助函数：记录错误日志
function logError(message: string, payload?: unknown): void {
  pushDebugLog(`ERROR ${message}`, payload);
}

// 脚本存储读取结果接口
interface ScriptStoreReadResult {
  pack: Pack | null;
  hasStoredValue: boolean;
  parseFailed: boolean;
  source: 'script' | 'local' | null;
}

// 辅助函数：从存储中读取原始数据
function getScriptStoreRaw(): ScriptStoreReadResult {
  let hasStoredValue = false;
  let parseFailed = false;
  let scriptCandidate: Pack | null = null;
  let localCandidate: Pack | null = null;

  // 从脚本变量读取
  try {
    if (typeof getVariables === 'function') {
      const vars = (getVariables({ type: 'script' }) || {}) as Record<string, unknown>;
      if (vars && Object.prototype.hasOwnProperty.call(vars, STORE_KEY)) {
        hasStoredValue = true;
        const raw = vars[STORE_KEY];
        if (raw && typeof raw === 'object') {
          scriptCandidate = raw as Pack;
        } else if (typeof raw === 'string' && String(raw).trim()) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') scriptCandidate = parsed as Pack;
            else parseFailed = true;
          } catch {
            parseFailed = true;
          }
        } else if (raw !== undefined && raw !== null) {
          parseFailed = true;
        }
      }
    }
  } catch (e) {
    parseFailed = true;
    logError('读取脚本变量存储失败', String(e));
  }

  // 从localStorage读取
  try {
    const pW = window.parent as typeof window;
    const fallback = pW.localStorage.getItem(`__${STORE_KEY}__`);
    if (fallback !== null) {
      hasStoredValue = true;
      if (String(fallback).trim()) {
        try {
          const parsed = JSON.parse(fallback);
          if (parsed && typeof parsed === 'object') localCandidate = parsed as Pack;
          else parseFailed = true;
        } catch (e) {
          parseFailed = true;
          logError('读取本地存储失败(JSON解析)', String(e));
        }
      } else {
        parseFailed = true;
      }
    }
  } catch (e) {
    parseFailed = true;
    logError('读取本地存储失败', String(e));
  }

  // 合并结果，选择较新的数据
  if (scriptCandidate && localCandidate) {
    const scriptMs = parsePackUpdatedAtMs(scriptCandidate);
    const localMs = parsePackUpdatedAtMs(localCandidate);
    const pickScript = scriptMs >= localMs;
    return {
      pack: pickScript ? scriptCandidate : localCandidate,
      hasStoredValue,
      parseFailed,
      source: pickScript ? 'script' : 'local',
    };
  }
  if (scriptCandidate) return { pack: scriptCandidate, hasStoredValue, parseFailed, source: 'script' };
  if (localCandidate) return { pack: localCandidate, hasStoredValue, parseFailed, source: 'local' };
  return { pack: null, hasStoredValue, parseFailed, source: null };
}

// 辅助函数：保存数据到存储
function saveScriptStoreRaw(data: Pack): boolean {
  let anySaved = false;
  const pW = window.parent as typeof window;

  // 保存到脚本变量
  try {
    if (typeof insertOrAssignVariables === 'function') {
      insertOrAssignVariables({ [STORE_KEY]: data }, { type: 'script' });
      anySaved = true;
    } else if (typeof updateVariablesWith === 'function') {
      updateVariablesWith(
        (vars: Record<string, unknown>) => {
          vars[STORE_KEY] = data;
          return vars;
        },
        { type: 'script' },
      );
      anySaved = true;
    }
  } catch (e) {
    logError('写入脚本变量存储失败', String(e));
  }

  // 保存到localStorage作为备份
  try {
    pW.localStorage.setItem(`__${STORE_KEY}__`, JSON.stringify(data));
    anySaved = true;
  } catch (e) {
    logError('写入本地存储失败', String(e));
  }

  return anySaved;
}

// 内部函数：立即执行持久化
function persistPackNow(): void {
  if (!state.pack) return;
  const latest = getScriptStoreRaw();
  if (latest.pack) {
    const latestMs = parsePackUpdatedAtMs(latest.pack);
    const knownMs = Number.isFinite(Date.parse(state.lastLoadedPackUpdatedAt))
      ? Date.parse(state.lastLoadedPackUpdatedAt)
      : 0;
    const currentMs = parsePackUpdatedAtMs(state.pack);
    if (latestMs > knownMs && latestMs > currentMs) {
      logError('检测到跨实例数据更新，已跳过本次自动保存以避免覆盖较新数据');
      return;
    }
  }
  state.pack.meta.updatedAt = nowIso();
  state.pack.favorites = state.pack.items.filter(i => i.favorite).map(i => i.id);
  const saved = saveScriptStoreRaw(state.pack);
  if (saved) state.lastLoadedPackUpdatedAt = String(state.pack.meta.updatedAt || '');
}

// 内部函数：刷新持久化（取消防抖立即执行）
function flushPersistPack(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistPackNow();
}

/**
 * 持久化当前pack到存储
 * @description 使用防抖机制避免频繁写入，可通过immediate选项立即执行
 * @param opts - 配置选项，immediate为true时立即持久化
 */
export function persistPack(opts?: { immediate?: boolean }): void {
  if (!state.pack) return;
  if (opts?.immediate) {
    flushPersistPack();
    return;
  }

  // 增加序列号，用于追踪最新的保存请求
  const currentSeq = ++persistSeq;

  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    // 在回调中重新检查 state.pack 是否存在
    // 并且只保存序列号匹配的最新数据，防止竞态条件
    if (state.pack && persistSeq === currentSeq) {
      persistPackNow();
    }
  }, PERSIST_DEBOUNCE_MS);
}
