/**
 * 验证工具函数
 */

/**
 * 验证API URL格式，无效时抛出错误
 * @param input - 输入的URL字符串
 * @returns 验证通过后的URL字符串
 * @throws 当URL为空、格式不合法或协议不支持时抛出错误
 */
export function validateApiUrlOrThrow(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('请先填写API URL');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch (e) {
    throw new Error('API URL 格式不合法');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('API URL 仅支持 http/https 协议');
  }
  return parsed.toString();
}

/**
 * 合并AbortSignal与超时控制
 * @param parentSignal - 父级AbortSignal，为null/undefined时只使用超时
 * @param timeoutMs - 超时毫秒数
 * @returns 包含合并后的signal和cleanup函数的对象
 */
export function mergeAbortSignals(
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
