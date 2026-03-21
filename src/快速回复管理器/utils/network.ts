/**
 * 网络工具函数
 */

import { FETCH_TIMEOUT_MS } from '../constants';
import { resolveHostWindow } from './dom';

function mergeAbortSignals(
  parentSignal: AbortSignal | null | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const timeoutCtrl = new AbortController();
  const tid = setTimeout(() => timeoutCtrl.abort(new Error(`请求超时（>${timeoutMs}ms）`)), timeoutMs);
  const merged = new AbortController();
  let parentAbortHandler: (() => void) | null = null;
  let timeoutAbortHandler: (() => void) | null = null;
  const forwardAbort = (reason: unknown) => {
    try {
      merged.abort(reason);
    } catch (e) {
      // 忽略：AbortController可能已处于abort状态，重复abort会抛出错误
    }
  };
  if (parentSignal) {
    if (parentSignal.aborted) {
      forwardAbort(parentSignal.reason);
    } else {
      parentAbortHandler = () => forwardAbort(parentSignal.reason);
      parentSignal.addEventListener('abort', parentAbortHandler, { once: true });
    }
  }
  timeoutAbortHandler = () => forwardAbort(timeoutCtrl.signal.reason);
  timeoutCtrl.signal.addEventListener('abort', timeoutAbortHandler, { once: true });
  const cleanup = () => {
    clearTimeout(tid);
    if (parentSignal && parentAbortHandler) parentSignal.removeEventListener('abort', parentAbortHandler);
    if (timeoutAbortHandler) timeoutCtrl.signal.removeEventListener('abort', timeoutAbortHandler);
  };
  return { signal: merged.signal, cleanup };
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const merged = mergeAbortSignals(init?.signal, timeoutMs);
  try {
    return await fetch(input, { ...init, signal: merged.signal });
  } finally {
    merged.cleanup();
  }
}

export async function copyTextRobust(text: string): Promise<void> {
  const pW = resolveHostWindow();
  const pD = pW.document;
  const value = String(text || '');
  try {
    if (pW.navigator?.clipboard?.writeText) {
      await pW.navigator.clipboard.writeText(value);
      return;
    }
  } catch (e) {
    // 忽略：剪贴板API可能因权限或安全策略被拒绝，降级使用execCommand
  }
  const ta = pD.createElement('textarea');
  ta.value = value;
  ta.setAttribute('readonly', 'true');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  ta.style.top = '0';
  ta.style.opacity = '0';
  pD.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = pD.execCommand('copy');
  } catch (e) {
    // 忽略：execCommand失败时返回false表示复制失败
    ok = false;
  } finally {
    ta.remove();
  }
  if (!ok) throw new Error('copy_failed');
}
