/**
 * Workbench 模块入口
 * @description 重新导出 workbench 相关功能，未来逐步迁移到本模块
 */

// 从现有 workbench.ts 重新导出所有公开 API
export {
  // 布局渲染
  renderWorkbench,
  renderToolbar,
  renderSidebar,
  renderMainContent,
  // 内容渲染
  renderItemGrid,
  renderCompactList,
  renderCompactListContent,
  renderPreview,
  // 路径和导航
  renderPath,
  renderCategoryTree,
  // 状态检查
  isWorkbenchOpen,
  hasOpenWorkbenchModal,
  ensureOverlay,
  // 生命周期
  closeWorkbench,
  attachHostResize,
  detachHostResize,
  computeFitPanelSize,
  // 调整大小
  enableResizers,
  // 拖拽功能
  attachPointerCategoryDropDrag,
  attachPointerItemCardDrag,
} from '../workbench';
