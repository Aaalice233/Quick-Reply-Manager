/**
 * 工具函数统一导出
 */

// DOM 工具
export {
  uid,
  resolveHostWindow,
  escapeHtml,
  getInputValueTrim,
  asDomElement,
  getInputBox,
  getViewportSize,
} from './dom';

// 数据工具
export { deepClone, parsePackUpdatedAtMs, nowIso, splitMultiValue, joinMultiValue, truncateContent } from './data';

// 验证工具
export { validateApiUrlOrThrow, mergeAbortSignals } from './validation';

// 网络工具
export { fetchWithTimeout, copyTextRobust } from './network';
