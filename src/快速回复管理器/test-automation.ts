/**
 * 快速回复管理器自动化测试模块
 * @description 提供DOM操作辅助函数，用于自动化测试快速回复管理器的各项功能
 * @note 此模块仅在测试环境中使用，不属于产品代码
 */

import { OVERLAY_ID } from './constants';
import { resolveHostWindow } from './utils/dom';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 连接符类型
 */
export type ConnectorType = 'then' | 'simultaneous' | 'direct' | 'custom';

/**
 * 设置标签页名称
 */
export type SettingsTab =
  | 'placeholders'
  | 'tokens'
  | 'default-mode'
  | 'qr-llm-api'
  | 'qr-llm-presets'
  | 'themes'
  | 'advanced'
  | 'debug';

/**
 * 截图选项
 */
export interface ScreenshotOptions {
  /** 截图步骤说明 */
  stepDescription: string;
  /** 是否保存到控制台 */
  logToConsole?: boolean;
}

// ============================================================================
// 宿主环境
// ============================================================================

const pW = resolveHostWindow();
const pD = pW.document || document;

// ============================================================================
// 核心测试函数
// ============================================================================

/**
 * 触发点击快速回复管理器按钮
 * @description 点击酒馆界面中打开快速回复管理器的按钮
 * @returns 是否成功触发点击
 * @example
 * ```typescript
 * clickQrmButton();
 * ```
 */
export function clickQrmButton(): boolean {
  const btn = pD.querySelector('[data-qrm-button], .qrm-toggle-btn, #fast-plot-toggle-btn') as HTMLElement | null;
  if (btn) {
    btn.click();
    return true;
  }
  console.warn('[TestAuto] 快速回复管理器按钮未找到');
  return false;
}

/**
 * 点击特定条目
 * @description 根据条目ID或名称点击对应的快速回复条目
 * @param itemIdOrName - 条目ID或名称
 * @returns 是否成功点击条目
 * @example
 * ```typescript
 * clickItem('item_123');
 * clickItem('打招呼'); // 通过名称点击
 * ```
 */
export function clickItem(itemIdOrName: string): boolean {
  // 首先尝试通过ID查找
  let card = pD.querySelector(`.fp-card[data-item-id="${itemIdOrName}"]`) as HTMLElement | null;

  // 如果没找到，尝试通过名称查找
  if (!card) {
    const cards = pD.querySelectorAll('.fp-card[data-item-id]');
    for (const c of cards) {
      const titleEl = c.querySelector('.fp-card-title');
      if (titleEl?.textContent?.trim() === itemIdOrName) {
        card = c as HTMLElement;
        break;
      }
    }
  }

  if (card) {
    card.click();
    return true;
  }

  console.warn(`[TestAuto] 条目未找到: ${itemIdOrName}`);
  return false;
}

/**
 * 点击连接符按钮
 * @description 点击顶部工具栏的连接符按钮
 * @param type - 连接符类型：'then'(然后) | 'simultaneous'(同时) | 'direct'(直连) | 'custom'(自定义)
 * @param customToken - 自定义连接符内容（仅当type为'custom'时需要）
 * @returns 是否成功点击
 * @example
 * ```typescript
 * clickConnector('then');      // 点击"然后"按钮
 * clickConnector('simultaneous'); // 点击"同时"按钮
 * clickConnector('direct');    // 点击直连切换开关
 * clickConnector('custom', '自定义内容'); // 点击自定义按钮并输入内容
 * ```
 */
export function clickConnector(type: ConnectorType, customToken?: string): boolean {
  switch (type) {
    case 'then': {
      // 第一个连接符按钮（通常是"然后"）
      const thenBtn = pD.querySelector('[data-conn-0]') as HTMLElement | null;
      if (thenBtn) {
        thenBtn.click();
        return true;
      }
      console.warn('[TestAuto] "然后"连接符按钮未找到');
      return false;
    }

    case 'simultaneous': {
      // 第二个连接符按钮（通常是"同时"）
      const simBtn = pD.querySelector('[data-conn-1]') as HTMLElement | null;
      if (simBtn) {
        simBtn.click();
        return true;
      }
      console.warn('[TestAuto] "同时"连接符按钮未找到');
      return false;
    }

    case 'direct': {
      // 连接模式切换开关
      const toggleBtn = pD.querySelector('[data-conn-mode-toggle]') as HTMLElement | null;
      if (toggleBtn) {
        toggleBtn.click();
        return true;
      }
      console.warn('[TestAuto] 连接模式切换开关未找到');
      return false;
    }

    case 'custom': {
      // 自定义连接符按钮
      const customBtn = pD.querySelector('[data-conn-custom]') as HTMLElement | null;
      if (customBtn) {
        customBtn.click();
        // 如果有自定义内容，模拟prompt输入
        if (customToken) {
          // 注意：由于prompt是浏览器原生对话框，测试环境中可能需要特殊处理
          console.info(`[TestAuto] 自定义连接符点击成功，等待输入: ${customToken}`);
        }
        return true;
      }
      console.warn('[TestAuto] 自定义连接符按钮未找到');
      return false;
    }

    default:
      console.warn(`[TestAuto] 未知的连接符类型: ${type}`);
      return false;
  }
}

/**
 * 打开设置面板
 * @description 点击设置按钮打开设置模态框
 * @returns 是否成功打开设置面板
 * @example
 * ```typescript
 * openSettingsPanel();
 * ```
 */
export function openSettingsPanel(): boolean {
  // 首先检查面板是否已经打开
  const existingModal = pD.querySelector('.fp-modal-card.fp-settings-card');
  if (existingModal) {
    console.info('[TestAuto] 设置面板已经打开');
    return true;
  }

  const settingsBtn = pD.querySelector('[data-settings]') as HTMLElement | null;
  if (settingsBtn) {
    settingsBtn.click();
    return true;
  }

  console.warn('[TestAuto] 设置按钮未找到');
  return false;
}

/**
 * 切换设置标签
 * @description 在设置面板中切换到指定的标签页
 * @param tabName - 标签页名称
 * @returns 是否成功切换标签
 * @example
 * ```typescript
 * switchSettingsTab('placeholders');    // 切换到占位符设置
 * switchSettingsTab('tokens');          // 切换到连接符设置
 * switchSettingsTab('themes');          // 切换到主题设置
 * switchSettingsTab('qr-llm-api');      // 切换到API设置
 * ```
 */
export function switchSettingsTab(tabName: SettingsTab): boolean {
  const tabBtn = pD.querySelector(`[data-tab-btn="${tabName}"]`) as HTMLElement | null;
  if (tabBtn) {
    tabBtn.click();
    return true;
  }

  console.warn(`[TestAuto] 设置标签未找到: ${tabName}`);
  return false;
}

/**
 * 关闭面板
 * @description 关闭快速回复管理器主面板或设置面板
 * @param target - 要关闭的面板：'main'(主面板) | 'settings'(设置面板) | 'all'(全部)
 * @returns 是否成功关闭
 * @example
 * ```typescript
 * closePanel('settings'); // 关闭设置面板
 * closePanel('main');     // 关闭主面板
 * closePanel('all');      // 关闭所有面板
 * ```
 */
export function closePanel(target: 'main' | 'settings' | 'all' = 'main'): boolean {
  let closed = false;

  if (target === 'settings' || target === 'all') {
    // 关闭设置面板（模态框）
    const closeBtn = pD.querySelector('.fp-modal-card [data-close]') as HTMLElement | null;
    if (closeBtn) {
      closeBtn.click();
      closed = true;
    }
  }

  if (target === 'main' || target === 'all') {
    // 关闭主面板
    const overlay = pD.getElementById(OVERLAY_ID);
    if (overlay) {
      const closeBtn = overlay.querySelector('[data-close]') as HTMLElement | null;
      if (closeBtn) {
        closeBtn.click();
        closed = true;
      }
    }
  }

  if (!closed) {
    console.warn(`[TestAuto] 未找到可关闭的面板: ${target}`);
  }

  return closed;
}

/**
 * 获取输入框内容
 * @description 获取酒馆输入框的当前内容，用于验证条目是否正确插入
 * @returns 输入框的文本内容
 * @example
 * ```typescript
 * const content = getInputBoxContent();
 * console.log('当前输入框内容:', content);
 * ```
 */
export function getInputBoxContent(): string {
  const ta = pD.querySelector('#send_textarea') as HTMLTextAreaElement | null;
  if (ta) {
    return ta.value || '';
  }
  console.warn('[TestAuto] 输入框未找到');
  return '';
}

/**
 * 检查面板是否打开
 * @description 检查快速回复管理器主面板是否处于打开状态
 * @returns 面板是否打开
 * @example
 * ```typescript
 * if (isPanelOpen()) {
 *   console.log('面板已打开');
 * }
 * ```
 */
export function isPanelOpen(): boolean {
  const overlay = pD.getElementById(OVERLAY_ID);
  return !!overlay && overlay.style.display !== 'none';
}

/**
 * 检查设置面板是否打开
 * @description 检查设置模态框是否处于打开状态
 * @returns 设置面板是否打开
 * @example
 * ```typescript
 * if (isSettingsPanelOpen()) {
 *   console.log('设置面板已打开');
 * }
 * ```
 */
export function isSettingsPanelOpen(): boolean {
  return !!pD.querySelector('.fp-modal-card.fp-settings-card');
}

/**
 * 截图辅助函数
 * @description 在测试步骤中输出日志，便于调试和记录测试过程
 * @param options - 截图选项
 * @example
 * ```typescript
 * captureScreenshot({ stepDescription: '打开快速回复管理器' });
 * captureScreenshot({ stepDescription: '点击条目后的状态', logToConsole: true });
 * ```
 */
export function captureScreenshot(options: ScreenshotOptions): void {
  const { stepDescription, logToConsole = true } = options;

  const timestamp = new Date().toISOString();
  const panelOpen = isPanelOpen();
  const settingsOpen = isSettingsPanelOpen();
  const inputContent = getInputBoxContent();

  const logData = {
    timestamp,
    step: stepDescription,
    panelOpen,
    settingsOpen,
    inputContentLength: inputContent.length,
    inputContentPreview: inputContent.slice(0, 100) + (inputContent.length > 100 ? '...' : ''),
  };

  if (logToConsole) {
    console.info(`[TestAuto] 📸 ${stepDescription}`, logData);
  }

  // 触发浏览器截图（如果支持）
  if (typeof (window as unknown as Record<string, unknown>).captureScreenshot === 'function') {
    (window as unknown as Record<string, (desc: string) => void>).captureScreenshot(stepDescription);
  }
}

/**
 * 等待元素出现
 * @description 等待指定选择器的元素出现在DOM中
 * @param selector - CSS选择器
 * @param timeout - 超时时间（毫秒）
 * @returns 是否在规定时间内找到元素
 * @example
 * ```typescript
 * await waitForElement('.fp-card[data-item-id]', 5000);
 * ```
 */
export function waitForElement(selector: string, timeout = 5000): Promise<boolean> {
  return new Promise(resolve => {
    // 如果元素已经存在
    if (pD.querySelector(selector)) {
      resolve(true);
      return;
    }

    // 设置超时
    const timeoutId = setTimeout(() => {
      observer.disconnect();
      resolve(false);
    }, timeout);

    // 使用MutationObserver监听DOM变化
    const observer = new MutationObserver(() => {
      if (pD.querySelector(selector)) {
        clearTimeout(timeoutId);
        observer.disconnect();
        resolve(true);
      }
    });

    observer.observe(pD.body, {
      childList: true,
      subtree: true,
    });
  });
}

/**
 * 获取所有可见条目
 * @description 获取当前显示的所有条目信息
 * @returns 条目信息数组
 * @example
 * ```typescript
 * const items = getAllVisibleItems();
 * console.log(`找到 ${items.length} 个条目`);
 * ```
 */
export function getAllVisibleItems(): Array<{ id: string; name: string; categoryId: string }> {
  const cards = pD.querySelectorAll('.fp-card[data-item-id]');
  const items: Array<{ id: string; name: string; categoryId: string }> = [];

  cards.forEach(card => {
    const id = card.getAttribute('data-item-id') || '';
    const categoryId = card.getAttribute('data-item-category') || '';
    const titleEl = card.querySelector('.fp-card-title');
    const name = titleEl?.textContent?.trim() || '';

    if (id) {
      items.push({ id, name, categoryId });
    }
  });

  return items;
}

/**
 * 获取当前分类信息
 * @description 获取当前选中的分类信息
 * @returns 分类信息对象
 * @example
 * ```typescript
 * const category = getCurrentCategory();
 * console.log('当前分类:', category.name);
 * ```
 */
export function getCurrentCategory(): { id: string | null; name: string; path: string } {
  const pathEl = pD.querySelector('.fp-path');
  const pathText = pathEl?.textContent?.trim() || '';

  // 从路径面包屑中提取当前分类
  const activeNode = pD.querySelector('.fp-tree-node.active');
  const id = activeNode?.getAttribute('data-cat-id') || null;
  const name = activeNode?.textContent?.trim() || pathText.split('/').pop() || '';

  return { id, name, path: pathText };
}

/**
 * 执行完整测试流程
 * @description 执行一个完整的测试流程，包含截图记录
 * @param testName - 测试名称
 * @param steps - 测试步骤函数数组
 * @example
 * ```typescript
 * await runTestWorkflow('基本功能测试', [
 *   () => { openPanel(); return true; },
 *   () => clickItem('打招呼'),
 *   () => getInputBoxContent().includes('你好'),
 * ]);
 * ```
 */
export async function runTestWorkflow(
  testName: string,
  steps: Array<() => boolean | Promise<boolean>>,
): Promise<{ success: boolean; completedSteps: number; errors: string[] }> {
  console.info(`[TestAuto] 🚀 开始测试: ${testName}`);
  captureScreenshot({ stepDescription: `开始测试: ${testName}` });

  const errors: string[] = [];
  let completedSteps = 0;

  for (let i = 0; i < steps.length; i++) {
    try {
      const result = await steps[i]();
      if (result) {
        completedSteps++;
        captureScreenshot({ stepDescription: `步骤 ${i + 1}/${steps.length} 完成` });
      } else {
        errors.push(`步骤 ${i + 1} 返回失败`);
        console.warn(`[TestAuto] 步骤 ${i + 1} 返回失败`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push(`步骤 ${i + 1} 异常: ${errorMsg}`);
      console.error(`[TestAuto] 步骤 ${i + 1} 异常:`, error);
    }
  }

  const success = completedSteps === steps.length;
  captureScreenshot({ stepDescription: `测试结束: ${testName} - ${success ? '通过' : '失败'}` });
  console.info(
    `[TestAuto] ✅ 测试完成: ${testName} - ${success ? '通过' : '失败'} (${completedSteps}/${steps.length})`,
  );

  return { success, completedSteps, errors };
}
