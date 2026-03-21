/**
 * 通用UI组件
 * @description 提供图标、按钮、模态框、Toast等通用UI组件
 */

import { TOAST_CONTAINER_ID, OVERLAY_ID } from '../constants';
import { resolveHostWindow } from '../utils/dom';
import { logInfo } from '../services/debug';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 模态框选项
 */
export interface ModalOptions {
  /** 是否替换现有模态框内容 (默认: true) */
  replace?: boolean;
}

/**
 * 模态框内容工厂函数类型
 */
export type ModalContentFactory = (close: () => void) => HTMLElement;

/**
 * 顶部按钮选项
 */
export interface TopButtonOptions {
  /** 数据属性名 */
  data?: string;
  /** CSS类名 */
  className?: string;
  /** 是否仅显示图标 */
  iconOnly?: boolean;
  /** 按钮标签 */
  label?: string;
  /** 图标名称 */
  icon?: string;
  /** 悬停提示 */
  title?: string;
}

// ============================================================================
// 图标组件
// ============================================================================

/**
 * SVG图标映射表
 */
const ICON_MAP: Record<string, string> = {
  back: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.8 3.2 5 8l4.8 4.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.4 8h5.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  then: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="m8.5 4.8 3.5 3.2-3.5 3.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  simul:
    '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 5.2h10M3 10.8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="6" cy="5.2" r="1.2" fill="currentColor"/><circle cx="10" cy="10.8" r="1.2" fill="currentColor"/></svg>',
  folder:
    '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.8 4.8h4l1.2 1.4h7v6.8a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1V4.8Z" stroke="currentColor" stroke-width="1.5"/><path d="M1.8 6.2h12.4" stroke="currentColor" stroke-width="1.5"/></svg>',
  add: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  upload:
    '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 10.8V3.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="m5.2 6.2 2.8-2.8 2.8 2.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12.5h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  download:
    '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3.5v7.3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="m10.8 7.8-2.8 2.8-2.8-2.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12.5h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  settings:
    '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6.7 2 .4 1.4a4.8 4.8 0 0 1 1.8 0L9.3 2l1.6.5-.1 1.5c.5.3 1 .7 1.3 1.3l1.5-.1.5 1.6-1.4.4a4.8 4.8 0 0 1 0 1.8l1.4.4-.5 1.6-1.5-.1c-.3.5-.7 1-1.3 1.3l.1 1.5-1.6.5-.4-1.4a4.8 4.8 0 0 1-1.8 0l-.4 1.4-1.6-.5.1-1.5a4.2 4.2 0 0 1-1.3-1.3l-1.5.1-.5-1.6 1.4-.4a4.8 4.8 0 0 1 0-1.8l-1.4-.4.5-1.6 1.5.1c.3-.5.7-1 1.3-1.3l-.1-1.5L6.7 2Z" stroke="currentColor" stroke-width="1.1"/><circle cx="8" cy="8" r="1.8" stroke="currentColor" stroke-width="1.2"/></svg>',
  custom:
    '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.6v2.2M8 11.2v2.2M2.6 8h2.2M11.2 8h2.2M3.8 3.8l1.6 1.6M10.6 10.6l1.6 1.6M12.2 3.8l-1.6 1.6M5.4 10.6l-1.6 1.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="8" cy="8" r="2.3" stroke="currentColor" stroke-width="1.3"/></svg>',
  check:
    '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3.4 8.2 2.9 2.9 6.3-6.3" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close:
    '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 4 8 8M12 4 4 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  'chevron-up':
    '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 10.5 8 6.5l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  'chevron-down':
    '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 5.5 8 9.5l4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  'expand-all':
    '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.8 5.3 8 9.2l4.2-3.9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.8 2.8 8 6.7l4.2-3.9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  'collapse-all':
    '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.8 10.7 8 6.8l4.2 3.9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.8 13.2 8 9.3l4.2 3.9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  braces:
    '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.1 2.7c-1.6 0-2.2.8-2.2 2.2v1.1c0 .8-.3 1.2-.9 1.5.6.3.9.7.9 1.5v1.1c0 1.4.6 2.2 2.2 2.2M9.9 2.7c1.6 0 2.2.8 2.2 2.2v1.1c0 .8.3 1.2.9 1.5-.6.3-.9.7-.9 1.5v1.1c0 1.4-.6 2.2-2.2 2.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  link: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.1 9.9 4.8 11.2a2.1 2.1 0 0 1-3-3L3.1 6.9a2.1 2.1 0 0 1 3 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="m9.9 6.1 1.3-1.3a2.1 2.1 0 0 1 3 3l-1.3 1.3a2.1 2.1 0 0 1-3 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M6.1 9.9h3.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  wand: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m5 11 6.4-6.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="m10.6 3.3.7-.7M12.7 5.4l.7-.7M12.1 2.7h1.2M13.3 4.9h1.2M2.7 12.1h1.2M3.9 10.9h1.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  trash:
    '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.8 4.6h8.4M6.2 4.6V3.4h3.6v1.2M5.2 6.2v5.3M8 6.2v5.3M10.8 6.2v5.3" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/><path d="M4.8 4.6h6.4v7.2a1 1 0 0 1-1 1H5.8a1 1 0 0 1-1-1V4.6Z" stroke="currentColor" stroke-width="1.3"/></svg>',
  save: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.2 2.8h7.4l2.2 2.2v7.8a1 1 0 0 1-1 1H4.2a1 1 0 0 1-1-1V2.8Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M5.1 2.8v3h4.6v-3M5.3 12h5.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  sparkles:
    '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1.9 9.2 5l3.1 1.2-3.1 1.2L8 10.5 6.8 7.4 3.7 6.2 6.8 5 8 1.9Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="m12.2 9.6.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6.6-1.5ZM3.2 10.1l.4 1 .9.4-.9.4-.4 1-.4-1-.9-.4.9-.4.4-1Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>',
  undo: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.2 4.1 3.4 6.8l2.8 2.7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 6.8h4.3a3.7 3.7 0 1 1 0 7.4H5.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  palette:
    '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.2a5.8 5.8 0 1 0 0 11.6h1.2a1.6 1.6 0 0 0 0-3.2H8.8a1 1 0 0 1 0-2h1.7a3.5 3.5 0 0 0 0-7H8Z" stroke="currentColor" stroke-width="1.4"/><circle cx="4.8" cy="7" r=".8" fill="currentColor"/><circle cx="6.5" cy="5.2" r=".8" fill="currentColor"/><circle cx="9.1" cy="5.1" r=".8" fill="currentColor"/></svg>',
  sliders:
    '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 4.2h6M11.5 4.2H13M3 8h2.5M7 8H13M3 11.8h7M11.5 11.8H13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="10.2" cy="4.2" r="1.1" stroke="currentColor" stroke-width="1.3"/><circle cx="5.8" cy="8" r="1.1" stroke="currentColor" stroke-width="1.3"/><circle cx="10.2" cy="11.8" r="1.1" stroke="currentColor" stroke-width="1.3"/></svg>',
  pencil:
    '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m10.9 2.2 2.9 2.9-7.6 7.6-3.2.3.3-3.2 7.6-7.6Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="m9.8 3.3 2.9 2.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  copy: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5.1" y="3.1" width="7.2" height="8.4" rx="1.4" stroke="currentColor" stroke-width="1.3"/><path d="M3.7 5.3V11a1.3 1.3 0 0 0 1.3 1.3h4.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  swap: '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 5.2h8.4M9.2 3.6l2.2 1.6-2.2 1.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 10.8H4.6M6.8 9.2l-2.2 1.6 2.2 1.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  'more-v':
    '<svg class="fp-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="3.5" r="1.3" fill="currentColor"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="8" cy="12.5" r="1.3" fill="currentColor"/></svg>',
};

/**
 * 获取SVG图标字符串
 * @param name - 图标名称
 * @returns SVG字符串或空字符串
 */
export function iconSvg(name: string): string {
  return ICON_MAP[name] || '';
}

// ============================================================================
// 按钮组件
// ============================================================================

/**
 * 渲染顶部工具栏按钮
 * @param opts - 按钮选项
 * @returns HTML字符串
 */
export function renderTopButton(opts?: TopButtonOptions): string {
  const o = opts || {};
  const dataKey = o.data || '';
  const cls = `fp-btn ${o.className || ''} ${o.iconOnly ? 'icon-only' : ''}`.trim();
  const label = o.iconOnly ? '' : String(o.label || '');
  return `<button class="${cls}" ${dataKey ? `data-${dataKey}` : ''} title="${o.title || o.label || ''}">${iconSvg(o.icon || '')}${label}</button>`;
}

/**
 * 创建通用按钮元素
 * @param text - 按钮文本
 * @param onClick - 点击回调
 * @param className - 额外CSS类名
 * @returns HTMLButtonElement
 */
export function createButton(text: string, onClick?: () => void, className?: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.className = className || '';
  if (onClick) {
    btn.addEventListener('click', onClick);
  }
  return btn;
}

// ============================================================================
// 模态框组件
// ============================================================================

/**
 * 模态框关闭回调集合 (用于外部清理)
 */
const modalCloseCallbacks: Set<() => void> = new Set();

/**
 * 注册模态框关闭回调
 * @param callback - 关闭时执行的回调
 */
export function registerModalCloseCallback(callback: () => void): void {
  modalCloseCallbacks.add(callback);
}

/**
 * 清除所有模态框关闭回调
 */
export function clearModalCloseCallbacks(): void {
  modalCloseCallbacks.clear();
}

/**
 * 执行所有模态框关闭回调
 */
function executeModalCloseCallbacks(): void {
  modalCloseCallbacks.forEach(callback => {
    try {
      callback();
    } catch (e) {
      /* ignore */
    }
  });
}

/**
 * 获取宿主文档
 * @returns Document
 */
function getHostDocument(): Document {
  try {
    return resolveHostWindow().document;
  } catch (e) {
    return document;
  }
}

/**
 * 显示模态对话框
 * @param contentFactory - 内容工厂函数，接收关闭函数作为参数
 * @param opts - 模态框选项
 */
export function showModal(contentFactory: ModalContentFactory, opts?: ModalOptions): void {
  const pD = getHostDocument();
  let overlay = pD.getElementById(OVERLAY_ID);

  // 如果 overlay 不存在，创建一个简单的遮罩层
  if (!overlay) {
    overlay = pD.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'fp-overlay';
    pD.body.appendChild(overlay);
  }

  const replace = opts?.replace !== false;
  let modalWrapper = overlay.querySelector('.fp-modal') as HTMLElement | null;

  if (replace && modalWrapper) {
    executeModalCloseCallbacks();
    modalWrapper.remove();
  }

  // 创建模态框外层（遮罩层）
  modalWrapper = pD.createElement('div');
  modalWrapper.className = 'fp-modal';

  // 创建模态框卡片容器
  const card = pD.createElement('div');
  card.className = 'fp-modal-card';
  card.appendChild(
    contentFactory(() => {
      executeModalCloseCallbacks();
      modalWrapper?.remove();
    }),
  );

  modalWrapper.appendChild(card);
  overlay.appendChild(modalWrapper);
}

// ============================================================================
// Toast 组件
// ============================================================================

/**
 * Toast配置
 */
interface ToastConfig {
  /** 最大堆叠数 */
  maxStack: number;
  /** 显示时长(ms) */
  timeout: number;
}

/**
 * 默认Toast配置
 */
const DEFAULT_TOAST_CONFIG: ToastConfig = {
  maxStack: 4,
  timeout: 1800,
};

/**
 * 当前Toast配置
 */
let toastConfig: ToastConfig = { ...DEFAULT_TOAST_CONFIG };

/**
 * 设置Toast配置
 * @param config - 部分配置
 */
export function setToastConfig(config: Partial<ToastConfig>): void {
  toastConfig = { ...toastConfig, ...config };
}

/**
 * 重置Toast配置为默认值
 */
export function resetToastConfig(): void {
  toastConfig = { ...DEFAULT_TOAST_CONFIG };
}

/**
 * 确保Toast容器存在
 * @returns Toast容器元素
 */
function ensureToastContainer(): HTMLElement {
  const pD = getHostDocument();
  let c = pD.getElementById(TOAST_CONTAINER_ID);
  if (!c) {
    c = pD.createElement('div');
    c.id = TOAST_CONTAINER_ID;
    (pD.body || pD.documentElement).appendChild(c);
  }
  return c;
}

/**
 * 显示Toast通知
 * @param message - 消息内容
 */
export function toast(message: string): void {
  logInfo(`TOAST ${String(message || '操作已执行')}`);

  const c = ensureToastContainer();
  const max = Math.max(1, toastConfig.maxStack);
  const timeout = Math.max(600, toastConfig.timeout);

  while (c.children.length >= max && c.firstElementChild) {
    c.removeChild(c.firstElementChild);
  }

  const t = document.createElement('div');
  t.className = 'fp-toast';
  t.textContent = String(message || '操作已执行');
  c.appendChild(t);

  setTimeout(() => t.remove(), timeout);
}

// ============================================================================
// 卡片组件
// ============================================================================

/**
 * 创建卡片组件
 * @param title - 卡片标题
 * @param content - 卡片内容 (HTML或纯文本)
 * @returns HTMLElement
 */
export function createCard(title: string, content: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'fp-card';

  const header = document.createElement('div');
  header.className = 'fp-card-header';
  header.textContent = title;

  const body = document.createElement('div');
  body.className = 'fp-card-body';
  body.innerHTML = content;

  card.appendChild(header);
  card.appendChild(body);

  return card;
}

// ============================================================================
// 颜色选择器组件
// ============================================================================

/**
 * 颜色选择器选项
 */
export interface CircularColorPickerOptions {
  /** 当前选中值 */
  value: string;
  /** 可选值数组 */
  options: string[];
  /** 获取颜色函数 */
  getColor: (value: string) => string;
  /** 获取标题函数 */
  getTitle?: (value: string) => string;
  /** 变更回调 */
  onChange: (value: string) => void;
}

/** 全局颜色选择器绑定标记 */
let colorPickerGlobalBound = false;

/**
 * 创建环形颜色选择器
 * @param opts - 颜色选择器选项
 * @returns 颜色选择器根元素
 */
export function createCircularColorPicker(opts: CircularColorPickerOptions): HTMLElement {
  const pD = getHostDocument();
  const root = pD.createElement('div');
  root.className = 'fp-color-picker';

  const trigger = pD.createElement('button');
  trigger.type = 'button';
  trigger.className = 'fp-color-trigger';
  trigger.title = '选择颜色';

  const triggerDot = pD.createElement('span');
  triggerDot.className = 'fp-color-dot';
  trigger.appendChild(triggerDot);
  root.appendChild(trigger);

  const menu = pD.createElement('div');
  menu.className = 'fp-color-menu';
  root.appendChild(menu);

  const closeMenu = () => root.classList.remove('open');
  const openMenu = () => {
    pD.querySelectorAll('.fp-color-picker.open').forEach(el => {
      el.classList.remove('open');
    });
    root.classList.add('open');
  };
  const toggleMenu = () => {
    if (root.classList.contains('open')) closeMenu();
    else openMenu();
  };

  const updateTrigger = (val: string) => {
    triggerDot.style.background = opts.getColor(val);
    trigger.setAttribute('aria-label', opts.getTitle ? opts.getTitle(val) : val);
  };

  let currentValue = opts.options.includes(opts.value) ? opts.value : opts.options[0];
  updateTrigger(currentValue);

  const renderOptions = () => {
    menu.innerHTML = '';
    for (const val of opts.options) {
      const item = pD.createElement('button');
      item.type = 'button';
      item.className = `fp-color-opt ${val === currentValue ? 'active' : ''}`;
      item.title = opts.getTitle ? opts.getTitle(val) : val;

      const dot = pD.createElement('span');
      dot.className = 'fp-color-dot';
      dot.style.background = opts.getColor(val);
      item.appendChild(dot);

      item.onclick = e => {
        e.preventDefault();
        e.stopPropagation();
        currentValue = val;
        updateTrigger(currentValue);
        opts.onChange(currentValue);
        renderOptions();
        closeMenu();
      };
      menu.appendChild(item);
    }
  };
  renderOptions();

  trigger.onclick = e => {
    e.preventDefault();
    e.stopPropagation();
    toggleMenu();
  };

  if (!colorPickerGlobalBound) {
    colorPickerGlobalBound = true;
    pD.addEventListener('click', e => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const holder = target.closest('.fp-color-picker');
      pD.querySelectorAll('.fp-color-picker.open').forEach(el => {
        if (holder && el === holder) return;
        el.classList.remove('open');
      });
    });
  }

  return root;
}
