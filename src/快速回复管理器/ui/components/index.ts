/**
 * UI组件统一入口
 * @module ui/components
 * @description 统一导出所有UI组件，提供一致的组件访问接口
 */

// 卡片组件
export * as card from './card';

// 列表组件
export * as list from './list';

// 按钮组件
export * as button from './button';

// 重新导出所有基础组件（向后兼容）
export {
  // 图标
  iconSvg,
  // 按钮
  renderTopButton,
  createButton,
  // 模态框
  showModal,
  registerModalCloseCallback,
  clearModalCloseCallbacks,
  // Toast
  toast,
  setToastConfig,
  resetToastConfig,
  // 卡片
  createCard,
  // 颜色选择器
  createCircularColorPicker,
} from '../components';

// 重新导出类型定义
export type { ModalOptions, ModalContentFactory, TopButtonOptions, CircularColorPickerOptions } from '../components';
