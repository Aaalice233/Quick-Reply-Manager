/**
 * 模态框模块
 * @description 集中管理所有模态框的显示和交互
 */

// 从 ui/components 重新导出基础模态框功能
export { showModal } from '../../ui/components';
export type { ModalOptions, ModalContentFactory } from '../../ui/components';

// 条目编辑模态框
export { showEditItemModal } from './item-modal';

// 设置模态框
export { showSettingsModal } from './settings-modal';

// 导入导出模态框
export {
  openAdvancedImportModal,
  openImportSelectionModal,
  openConflictResolutionModal,
  applyImport,
  type ImportConflict,
} from './import-modal';
