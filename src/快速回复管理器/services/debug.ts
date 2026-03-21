/**
 * 调试服务
 * @description 提供日志记录和调试功能
 */

import { state } from '../store';

// 父窗口引用
const pW = window.parent as typeof window;

/**
 * 添加调试日志到 state.debugLogs
 * @param message 日志消息
 * @param payload 可选的附加数据
 */
export function pushDebugLog(message: string, payload?: unknown): void {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const lines: string[] = [`[${ts}] ${String(message || '')}`];
  if (payload !== undefined) {
    try {
      lines.push(typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2));
    } catch (e) {
      lines.push(String(payload));
    }
  }
  state.debugLogs.push(lines.join('\n'));
  if (state.debugLogs.length > 500) {
    state.debugLogs = state.debugLogs.slice(-500);
  }
}

/**
 * 记录信息级别日志
 * @param message 日志消息
 * @param payload 可选的附加数据
 */
export function logInfo(message: string, payload?: unknown): void {
  pushDebugLog(`INFO ${message}`, payload);
}

/**
 * 记录错误级别日志
 * @param message 错误消息
 * @param error 可选的错误对象或数据
 */
export function logError(message: string, error?: unknown): void {
  pushDebugLog(`ERROR ${message}`, error);
}

/**
 * 获取所有日志的文本表示
 * @returns 所有日志的字符串表示
 */
export function getDebugLogText(): string {
  return state.debugLogs.join('\n\n');
}

/**
 * 附加全局调试钩子
 * @description 监听全局错误和未处理的Promise拒绝
 */
export function attachGlobalDebugHooks(): void {
  if (state.debugHooksBound) return;
  state.debugHooksBound = true;
  try {
    state.debugErrorHandler = (ev: Event) => {
      const e = ev as ErrorEvent;
      logError('全局异常', {
        message: String(e.message || ''),
        source: String(e.filename || ''),
        line: Number(e.lineno || 0),
        column: Number(e.colno || 0),
      });
    };
    state.debugRejectionHandler = (ev: Event) => {
      const e = ev as PromiseRejectionEvent;
      logError('未处理Promise拒绝', e.reason);
    };
    pW.addEventListener('error', state.debugErrorHandler);
    pW.addEventListener('unhandledrejection', state.debugRejectionHandler);
  } catch (e) {
    // 忽略添加监听器失败
  }
}

/**
 * 分离全局调试钩子
 * @description 移除全局错误和Promise拒绝的监听
 */
export function detachGlobalDebugHooks(): void {
  if (!state.debugHooksBound) return;
  try {
    if (state.debugErrorHandler) pW.removeEventListener('error', state.debugErrorHandler);
    if (state.debugRejectionHandler) pW.removeEventListener('unhandledrejection', state.debugRejectionHandler);
  } catch (e) {
    // 忽略移除监听器失败
  }
  state.debugHooksBound = false;
  state.debugErrorHandler = null;
  state.debugRejectionHandler = null;
}
