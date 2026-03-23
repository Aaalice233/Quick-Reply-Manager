/**
 * DOM工具函数
 */

/**
 * 生成唯一ID
 * @param prefix - ID前缀
 * @returns 生成的唯一ID字符串
 */
export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

/**
 * 解析宿主窗口
 * 从多个候选窗口中选择面积最大的作为宿主窗口
 * @returns 解析到的宿主Window对象
 */
export function resolveHostWindow(): Window {
  const candidates: Window[] = [];
  try {
    if (window.top) candidates.push(window.top);
  } catch (e) {
    // 忽略：跨域访问限制导致无法读取window.top
  }
  try {
    if (window.parent) candidates.push(window.parent);
  } catch (e) {
    // 忽略：跨域访问限制导致无法读取window.parent
  }
  candidates.push(window);
  let best: Window = window;
  let bestArea = 0;
  for (const w of candidates) {
    try {
      const area = Number(w.innerWidth || 0) * Number(w.innerHeight || 0);
      if (area > bestArea && w.document) {
        best = w;
        bestArea = area;
      }
    } catch (e) {
      // 忽略：窗口可能已关闭或不可访问
    }
  }
  return best;
}

/**
 * HTML转义
 * 将特殊字符转换为HTML实体
 * @param value - 需要转义的值
 * @returns 转义后的字符串
 */
export function escapeHtml(value: unknown): string {
  const raw = String(value ?? '');
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 获取输入值并trim
 * @param root - 父节点
 * @param selector - 选择器
 * @returns trim后的输入值
 */
export function getInputValueTrim(root: ParentNode, selector: string): string {
  const el = root.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
  return String(el?.value || '').trim();
}

/**
 * 转换为DOM元素
 * @param target - 目标对象
 * @returns Element或null
 */
export function asDomElement(target: unknown): Element | null {
  if (!target || typeof target !== 'object') return null;
  const node = target as { nodeType?: unknown; closest?: unknown };
  if (node.nodeType !== 1 || typeof node.closest !== 'function') return null;
  return target as Element;
}

/**
 * 获取酒馆输入框元素
 * @returns 输入框textarea元素或null
 */
export function getInputBox(): HTMLTextAreaElement | null {
  try {
    const pW = window.parent as Window;
    const pD = pW.document;

    // 尝试多个可能的选择器
    const selectors = [
      '#send_textarea',
      '.send_textarea',
      '[id*="send_textarea"]',
      'textarea[data-id="send_textarea"]',
    ];

    for (const selector of selectors) {
      const el = pD.querySelector(selector) as HTMLTextAreaElement | null;
      if (el) return el;
    }

    // 兜底：查找主textarea
    return pD.querySelector('textarea') as HTMLTextAreaElement | null;
  } catch (e) {
    return null;
  }
}

/**
 * 获取视口尺寸
 * @returns 视口的宽度和高度
 */
export function getViewportSize(): { width: number; height: number } {
  const hostWindow = resolveHostWindow();
  const root = hostWindow.document?.documentElement;
  const w = Number(hostWindow?.innerWidth) || Number(root?.clientWidth) || Number(window.innerWidth) || 320;
  const h = Number(hostWindow?.innerHeight) || Number(root?.clientHeight) || Number(window.innerHeight) || 360;
  return {
    width: Math.max(320, w),
    height: Math.max(360, h),
  };
}
