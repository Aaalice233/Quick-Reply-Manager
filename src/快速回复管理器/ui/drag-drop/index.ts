/**
 * 拖拽模块入口
 * @description 集中导出所有拖拽相关功能
 * @module ui/drag-drop
 */

// ============================================================================
// 类型导出
// ============================================================================

export type { DragType, DropMode } from '../events';
export type { AutoExpandState } from '../events';

// ============================================================================
// 分类拖拽功能
// ============================================================================

export { moveCategoryRelative } from './category-drag';

// ============================================================================
// 条目拖拽功能
// ============================================================================

export { moveItemToCategory, createItemCardDragStrategy } from './item-drag';

// ============================================================================
// 拖拽事件处理（从 events.ts 重新导出）
// ============================================================================

export {
  handleDragStart,
  handleDragOver,
  handleDrop,
  handleDragEnd,
  isClickSuppressed,
  suppressNextClick,
} from '../events';

// ============================================================================
// 拖拽工具函数（从 events.ts 重新导出）
// ============================================================================

export { runSnapshotReorderDrag, clearTreeAutoExpand, scheduleTreeAutoExpand } from '../events';
