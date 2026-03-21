/**
 * 样式注入模块
 * @description 负责注入基础样式和自定义CSS到宿主文档
 */

import cssContent from '../styles/index.scss?raw';
// @ts-expect-error webpack raw-loader
import { STYLE_ID } from '../constants';
import { state } from '../store';
import { resolveHostWindow } from '../utils/dom';

const CUSTOM_CSS_ID = 'fast-plot-custom-css-v1';

/**
 * 确保基础样式已注入
 * @description 检查并注入打包后的SCSS样式到宿主文档head中，避免重复注入
 */
export function ensureStyle(): void {
  const hostWindow = resolveHostWindow();
  const doc = hostWindow.document;

  // 检查是否已注入
  if (doc.getElementById(STYLE_ID)) {
    return;
  }

  // 创建style元素并注入CSS
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = cssContent;
  doc.head.appendChild(style);
}

/**
 * 应用自定义CSS
 * @description 从state中获取用户自定义CSS并注入到宿主文档
 */
export function applyCustomCSS(): void {
  const hostWindow = resolveHostWindow();
  const doc = hostWindow.document;
  const css = state.pack?.settings?.ui?.customCSS || '';

  let el = doc.getElementById(CUSTOM_CSS_ID) as HTMLStyleElement | null;

  // 如果没有自定义CSS，移除现有元素
  if (!css) {
    if (el) {
      el.remove();
    }
    return;
  }

  // 创建或更新自定义CSS元素
  if (!el) {
    el = doc.createElement('style');
    el.id = CUSTOM_CSS_ID;
    (doc.head || doc.body).appendChild(el);
  }

  el.textContent = css;
}

/**
 * 移除所有注入的样式
 * @description 清理函数，用于卸载时移除注入的基础样式和自定义CSS
 */
export function removeStyle(): void {
  const hostWindow = resolveHostWindow();
  const doc = hostWindow.document;

  // 移除基础样式
  const baseStyle = doc.getElementById(STYLE_ID);
  if (baseStyle) {
    baseStyle.remove();
  }

  // 移除自定义CSS
  const customStyle = doc.getElementById(CUSTOM_CSS_ID);
  if (customStyle) {
    customStyle.remove();
  }
}

/**
 * 重新应用所有样式
 * @description 先移除再重新注入所有样式，用于主题切换或样式更新
 */
export function refreshStyles(): void {
  removeStyle();
  ensureStyle();
  applyCustomCSS();
}
