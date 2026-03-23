/**
 * 模态框模块
 * @description 集中管理所有模态框的显示和交互
 */

// 从 ui/components 重新导出基础模态框功能
export { showModal } from '../../ui/components';
export type { ModalOptions, ModalContentFactory } from '../../ui/components';

// 条目编辑模态框
export { showEditItemModal } from './item-modal';

// TODO: Task 9-11 将在这里添加更多导出
// export { showCategoryModal } from './category-modal';
// export { showSettingsModal } from './settings-modal';
// export { showImportExportModal } from './import-modal';
