# 快速回复管理器代码优化计划

## TL;DR

> **目标**: 消除代码重复、拆分大文件、抽象可复用组件，提升代码可维护性。
>
> **范围**:
>
> - **Phase 1**: 消除重复工具函数（5个文件需修改）
> - **Phase 2**: 拆分 index.ts（4347行 → 多个模块）
> - **Phase 3**: 拆分 workbench.ts（1484行 → 渲染子模块）
> - **Phase 4**: 抽象 UI 组件（卡片、列表、按钮组等）
>
> **预估工作量**: 中等（约20-30个独立任务） **并行执行**: YES - 4个独立阶段

---

## 当前问题汇总

### 1. 代码重复

| 函数                  | 正确定义位置          | 重复位置                                                                                        |
| --------------------- | --------------------- | ----------------------------------------------------------------------------------------------- |
| `uid()`               | `utils/dom.ts:10`     | `ui/events.ts:58`, `ui/preview.ts:37`, `services/storage.ts:40`, `features/import-export.ts:89` |
| `resolveHostWindow()` | `utils/dom.ts:19`     | `ui/events.ts:82`, `services/placeholder.ts:18`                                                 |
| `getViewportSize()`   | `ui/workbench.ts:45`  | `services/storage.ts:48`                                                                        |
| `isClickSuppressed()` | `ui/events.ts:66`     | `ui/workbench.ts:122-125`                                                                       |
| `suppressNextClick()` | `ui/events.ts:74`     | `ui/workbench.ts:130-133`                                                                       |
| `truncateContent()`   | `ui/workbench.ts:111` | 可能还有其他类似函数                                                                            |

### 2. 大文件分析

| 文件              | 行数       | 问题                                                                            |
| ----------------- | ---------- | ------------------------------------------------------------------------------- |
| `index.ts`        | **4347行** | 混合了：初始化逻辑、事件绑定、模态框管理、拖拽处理、LLM集成、导入导出、设置管理 |
| `ui/workbench.ts` | **1484行** | 渲染函数混杂：分类树、条目网格、预览、工具栏、侧边栏、拖拽逻辑、resize处理      |
| `ui/events.ts`    | **1237行** | 事件处理器、拖拽策略、上下文菜单、各种手势处理                                  |
| `ui/preview.ts`   | 约800行    | 预览令牌流渲染、占位符高亮                                                      |

### 3. UI 组件缺失

当前大量 DOM 操作是内联编写的，缺少可复用组件：

- 条目卡片（在 workbench.ts 和 components.ts 都有类似实现）
- 分类树节点
- 工具栏按钮组
- 模态框结构
- 紧凑列表项

---

## 优化策略

### Phase 1: 消除重复函数（Wave 1）

**策略**: 统一从 `utils/dom.ts` 导出，删除其他位置的本地定义。

**顺序**:

1. 先确保 utils/dom.ts 导出完整
2. 再替换各文件的本地定义
3. 无依赖关系，可并行执行

**风险提示**:

- 需要检查各文件是否有细微差异（如 uid() 实现是否一致）
- 确认所有调用点正确导入

### Phase 2: 拆分 index.ts（Waves 2-4）

**策略**: 按功能域拆分，保持入口文件只做协调。

**拆分方案**:

```
index.ts (入口，保留初始化、生命周期)
├── features/modal/
│   ├── index.ts          # 模态框管理（从 index.ts 提取）
│   ├── category-modal.ts # 分类相关模态框
│   ├── item-modal.ts     # 条目相关模态框
│   ├── settings-modal.ts # 设置模态框
│   └── import-modal.ts   # 导入模态框
├── features/editor/
│   ├── index.ts          # 编辑器初始化
│   ├── item-editor.ts    # 条目编辑器逻辑
│   └── qr-llm.ts         # QR LLM 相关
├── features/workflow/
│   ├── index.ts          # 工作流协调
│   ├── execution.ts      # 条目执行逻辑
│   └── navigation.ts     # 导航历史管理
└── ui/interactions/
    ├── index.ts          # 交互绑定
    ├── keyboard.ts       # 键盘快捷键
    └── resize.ts         # resize 处理
```

### Phase 3: 拆分 workbench.ts（Waves 5-6）

**策略**: 按渲染区域拆分。

**拆分方案**:

```
ui/workbench/
├── index.ts              # 主入口，renderWorkbench()
├── layout.ts             # 布局计算、紧凑模式检测
├── sidebar.ts            # 侧边栏渲染
├── toolbar.ts            # 工具栏渲染（已存在部分）
├── content/
│   ├── index.ts          # 主内容区域
│   ├── grid.ts           # 条目网格
│   └── compact.ts        # 紧凑列表
├── preview.ts            # 预览区域（可与现有 preview.ts 合并）
├── path.ts               # 面包屑路径
└── drag-drop/
    ├── index.ts          # 拖拽协调
    ├── category-drag.ts  # 分类树拖拽
    └── item-drag.ts      # 条目卡片拖拽
```

### Phase 4: UI 组件抽象（Waves 7-8）

**策略**: 提取可复用组件，统一 DOM 创建逻辑。

**新增组件**:

```
ui/components/
├── index.ts              # 已有，保留
├── icon.ts               # 图标系统（从 components.ts 提取）
├── button.ts             # 按钮变体
├── card/
│   ├── index.ts          # 卡片容器
│   ├── item-card.ts      # 条目卡片
│   └── category-card.ts  # 分类卡片
├── list/
│   ├── index.ts          # 列表容器
│   └── list-item.ts      # 列表项
├── form/
│   ├── input.ts          # 输入框封装
│   └── select.ts         # 选择框封装
└── feedback/
    ├── toast.ts          # 提示（已有）
    └── modal.ts          # 模态框（已有）
```

---

## 执行计划

### 依赖关系图

```
Phase 1 (Wave 1)
  ├── Task 1-6: 消除重复函数
  └── 产出: 干净的工具函数导入

Phase 2 (Waves 2-4) 依赖 Phase 1
  ├── Task 7-12: 创建 features/modal/
  ├── Task 13-16: 创建 features/editor/
  ├── Task 17-19: 创建 features/workflow/
  └── Task 20-22: 创建 ui/interactions/

Phase 3 (Waves 5-6) 依赖 Phase 1
  ├── Task 23-28: 拆分 workbench.ts
  └── Task 29-31: 整理 drag-drop/

Phase 4 (Waves 7-8) 依赖 Phase 1-3
  ├── Task 32-37: 抽象 UI 组件
  └── Task 38-40: 替换内联 DOM 代码

Final Verification (Wave 9)
  ├── Task 41: 编译检查
  ├── Task 42: 功能测试
  └── Task 43: 代码审查
```

### 并行优化

- **最大并行**: 4个 Phase 可以部分并行
- **Wave 1**: 6个任务并行（修改不同文件，无冲突）
- **Wave 2-4**: 3个模态相关任务可并行
- **Wave 5-6**: sidebar/toolbar/content 可并行
- **Wave 7-8**: 各组件可并行开发

**预计节省**:

- Phase 1: 约150行重复代码 → 30行工具函数
- Phase 2: index.ts 从4347行 → 约500行
- Phase 3: workbench.ts 从1484行 → 约200行
- Phase 4: 减少约30%的DOM操作重复代码

---

## TODOs

### Wave 1: 消除重复函数（可并行）

- [x] 1. 提取和标准化 uid() 函数

  **What to do**:
  - 确认 `utils/dom.ts` 中的 uid() 实现是标准版本
  - 删除 `ui/events.ts` 中的本地 uid() 定义
  - 删除 `ui/preview.ts` 中的本地 uid() 定义
  - 删除 `services/storage.ts` 中的本地 uid() 定义
  - 删除 `features/import-export.ts` 中的本地 uid() 定义
  - 在每个删除的文件中添加: `import { uid } from '../utils/dom';`

  **References**:
  - Pattern: `utils/dom.ts:10-12`
  - Files to modify: `ui/events.ts:58`, `ui/preview.ts:37`, `services/storage.ts:40`, `features/import-export.ts:89`

  **Verification**:
  - [ ] `pnpm build` 成功，无 TypeScript 错误
  - [ ] 运行测试确认 uid 生成正常
  - [ ] 检查各调用点无运行时错误

  **Commit**: `refactor(utils): 统一 uid() 函数到 utils/dom.ts`

- [x] 2. 提取和标准化 resolveHostWindow() 函数

  **What to do**:
  - 确认 `utils/dom.ts` 中的 resolveHostWindow() 是标准版本
  - 删除 `ui/events.ts` 中的本地定义
  - 删除 `services/placeholder.ts` 中的本地定义
  - 更新导入语句

  **References**:
  - Pattern: `utils/dom.ts:19-46`
  - Files to modify: `ui/events.ts:82`, `services/placeholder.ts:18`

  **Verification**:
  - [ ] `pnpm build` 成功
  - [ ] 验证宿主窗口检测正常工作

  **Commit**: `refactor(utils): 统一 resolveHostWindow() 函数`

- [x] 3. 提取 getViewportSize() 函数到 utils/dom.ts

  **What to do**:
  - 将 `ui/workbench.ts:45-53` 的实现提升到 `utils/dom.ts`
  - 删除 `services/storage.ts:48-56` 的本地定义
  - 更新两个文件的导入

  **References**:
  - Source: `ui/workbench.ts:45-53`
  - Target location: `utils/dom.ts` (添加到文件末尾)
  - Files to modify: `services/storage.ts`

  **Verification**:
  - [ ] `pnpm build` 成功
  - [ ] 面板尺寸计算正常

  **Commit**: `refactor(utils): 统一 getViewportSize() 函数`

- [x] 4. 提取 isClickSuppressed 和 suppressNextClick

  **What to do**:
  - 从 `ui/events.ts` 导出这两个函数
  - 删除 `ui/workbench.ts:122-133` 的本地定义
  - 更新 workbench.ts 的导入

  **References**:
  - Source: `ui/events.ts:66-76`
  - Files to modify: `ui/workbench.ts`

  **Verification**:
  - [ ] 点击抑制逻辑正常工作
  - [ ] 拖拽后点击不触发意外行为

  **Commit**: `refactor(events): 统一点击抑制函数`

- [x] 5. 检查并消除 truncateContent 重复

  **What to do**:
  - 搜索整个代码库中 truncateContent 或类似截断函数
  - 如有重复，统一提取到 utils/data.ts

  **References**:
  - Search pattern: `truncate|截断|slice.*length`

  **Verification**:
  - [ ] 所有文本截断使用统一函数
  - [ ] 卡片文本显示正常

  **Commit**: `refactor(utils): 统一文本截断函数`

- [x] 6. 创建 utils/index.ts 统一导出

  **What to do**:
  - 创建 `utils/index.ts` 重新导出所有工具函数
  - 简化其他文件的导入：`import { uid, escapeHtml } from '../utils'`

  **References**:
  - Pattern: 参考其他项目的 index.ts 导出模式

  **Verification**:
  - [ ] 所有导入通过 utils/index.ts 可用
  - [ ] pnpm build 成功

  **Commit**: `refactor(utils): 创建统一工具函数导出`

---

### Wave 2: 创建 features/modal/ 模块

- [x] 7. 创建 features/modal/index.ts - 模态框管理器

  **What to do**:
  - 从 `index.ts` 提取模态框显示/关闭逻辑（约200-300行）
  - 包括: `showModal`, `closeModal`, `registerModalCloseCallback` 等

  **References**:
  - Source: `index.ts` 中搜索 `showModal`, `closeModal`, `modal`

  **Acceptance Criteria**:
  - [ ] 所有模态框相关函数从 modal/index.ts 导出
  - [ ] index.ts 更新导入

  **Commit**: `refactor(modal): 创建模态框管理模块`

- [ ] 8. 创建 features/modal/category-modal.ts

  **What to do**:
  - 提取分类相关模态框：新建分类、编辑分类、删除确认

  **References**:
  - Source: `index.ts` 中搜索 `[data-new-cat]`, `openCategoryEditModal`

  **Commit**: `refactor(modal): 提取分类模态框`

- [x] 9. 创建 features/modal/item-modal.ts

  **What to do**:
  - 提取条目相关模态框：新建条目、编辑条目、删除确认

  **References**:
  - Source: `index.ts` 中搜索 `[data-new-item]`, `openItemEditModal`

  **Commit**: `refactor(modal): 提取条目模态框`

- [ ] 10. 创建 features/modal/settings-modal.ts

  **What to do**:
  - 提取设置模态框：所有设置面板逻辑

  **References**:
  - Source: `index.ts` 中搜索 `openSettingsPanel`, `[data-settings]`

  **Commit**: `refactor(modal): 提取设置模态框`

- [ ] 11. 创建 features/modal/import-modal.ts

  **What to do**:
  - 提取导入导出模态框

  **References**:
  - Source: `index.ts` 中搜索 `openAdvancedImportModal`, `[data-import]`

  **Commit**: `refactor(modal): 提取导入导出模态框`

- [ ] 12. 更新 index.ts 使用新的 modal 模块

  **What to do**:
  - 删除已提取的代码
  - 更新导入语句
  - 验证功能完整

  **Commit**: `refactor(index): 集成新的 modal 模块`

---

### Wave 3: 创建 features/editor/ 模块

- [ ] 13. 创建 features/editor/index.ts

  **What to do**:
  - 提取编辑器初始化逻辑

  **References**:
  - Source: `index.ts` 中编辑器相关代码

  **Commit**: `refactor(editor): 创建编辑器模块入口`

- [ ] 14. 创建 features/editor/item-editor.ts

  **What to do**:
  - 提取条目编辑器逻辑（约500-800行）

  **References**:
  - Source: `index.ts` 中搜索 `openItemEditModal` 及后续编辑逻辑

  **Commit**: `refactor(editor): 提取条目编辑器`

- [ ] 15. 创建 features/editor/qr-llm.ts

  **What to do**:
  - 提取 QR LLM 编辑器相关逻辑

  **References**:
  - Source: `index.ts` 中搜索 `editGenerateState`, `qrLlm`

  **Commit**: `refactor(editor): 提取 QR LLM 编辑器逻辑`

- [ ] 16. 更新 index.ts 使用新的 editor 模块

  **What to do**:
  - 删除已提取的代码
  - 更新导入

  **Commit**: `refactor(index): 集成 editor 模块`

---

### Wave 4: 创建 ui/interactions/ 模块

- [ ] 17. 创建 ui/interactions/index.ts

  **What to do**:
  - 提取事件绑定协调逻辑

  **References**:
  - Source: `index.ts` 中的 `bindGlobalEvents`, `unbindGlobalEvents`

  **Commit**: `refactor(interactions): 创建交互模块入口`

- [ ] 18. 创建 ui/interactions/keyboard.ts

  **What to do**:
  - 提取键盘快捷键处理（ESC、Ctrl+S等）

  **References**:
  - Source: `index.ts:395-415` 附近

  **Commit**: `refactor(interactions): 提取键盘快捷键处理`

- [ ] 19. 创建 ui/interactions/resize.ts

  **What to do**:
  - 提取 resize 事件处理

  **References**:
  - Source: `index.ts:372-383` 附近

  **Commit**: `refactor(interactions): 提取 resize 处理`

---

### Wave 5: 拆分 ui/workbench.ts

- [ ] 20. 创建 ui/workbench/layout.ts

  **What to do**:
  - 提取布局计算：`getViewportSize`, `applyFitPanelSize`, 紧凑模式检测

  **References**:
  - Source: `ui/workbench.ts:45-53`, `computeFitPanelSize`

  **Commit**: `refactor(workbench): 提取布局计算模块`

- [ ] 21. 创建 ui/workbench/sidebar.ts

  **What to do**:
  - 提取侧边栏渲染：`renderSidebar`, `renderCategoryTree`

  **References**:
  - Source: `ui/workbench.ts:862-892`, `299-383`

  **Commit**: `refactor(workbench): 提取侧边栏渲染`

- [ ] 22. 创建 ui/workbench/toolbar.ts

  **What to do**:
  - 提取工具栏渲染：`renderToolbar`
  - 可与现有 toolbar 逻辑合并

  **References**:
  - Source: `ui/workbench.ts:791-857`

  **Commit**: `refactor(workbench): 提取工具栏渲染`

- [ ] 23. 创建 ui/workbench/content/grid.ts

  **What to do**:
  - 提取条目网格渲染：`renderItemGrid`, `groupedItemsForMain`

  **References**:
  - Source: `ui/workbench.ts:388-463`

  **Commit**: `refactor(workbench): 提取条目网格渲染`

- [ ] 24. 创建 ui/workbench/content/compact.ts

  **What to do**:
  - 提取紧凑列表渲染：`renderCompactList`, `renderCompactListContent`

  **References**:
  - Source: `ui/workbench.ts:607-765`

  **Commit**: `refactor(workbench): 提取紧凑列表渲染`

- [ ] 25. 更新 ui/workbench/index.ts

  **What to do**:
  - 简化为协调入口，导入各子模块
  - 保留 `renderWorkbench` 作为主入口

  **Commit**: `refactor(workbench): 重构为协调入口`

---

### Wave 6: 整理 drag-drop/ 模块

- [ ] 26. 创建 ui/drag-drop/index.ts

  **What to do**:
  - 提取拖拽协调逻辑

  **References**:
  - Source: `ui/workbench.ts:1200-1311`, `1321-1420`

  **Commit**: `refactor(drag-drop): 创建拖拽模块入口`

- [ ] 27. 创建 ui/drag-drop/category-drag.ts

  **What to do**:
  - 提取分类树拖拽：`attachPointerCategoryDropDrag`, `canDropCategoryTo`

  **Commit**: `refactor(drag-drop): 提取分类拖拽逻辑`

- [ ] 28. 创建 ui/drag-drop/item-drag.ts

  **What to do**:
  - 提取条目卡片拖拽：`attachPointerItemCardDrag`

  **Commit**: `refactor(drag-drop): 提取条目拖拽逻辑`

- [ ] 29. 迁移 ui/events.ts 的拖拽策略

  **What to do**:
  - 将 `runSnapshotReorderDrag`, `createItemCardDragStrategy` 迁移到 drag-drop/

  **Commit**: `refactor(drag-drop): 迁移拖拽策略`

---

### Wave 7: 抽象 UI 组件

- [ ] 30. 创建 ui/components/card/

  **What to do**:
  - 创建 `item-card.ts`: 提取条目卡片 DOM 创建
  - 创建 `category-card.ts`: 提取分类卡片 DOM 创建

  **References**:
  - Source: `ui/workbench.ts:411-450` 卡片创建逻辑

  **Commit**: `refactor(components): 创建卡片组件`

- [ ] 31. 创建 ui/components/list/

  **What to do**:
  - 创建列表容器和列表项组件

  **Commit**: `refactor(components): 创建列表组件`

- [ ] 32. 创建 ui/components/button/

  **What to do**:
  - 提取按钮变体：工具栏按钮、操作按钮、图标按钮

  **Commit**: `refactor(components): 创建按钮组件`

- [ ] 33. 重构 ui/components.ts

  **What to do**:
  - 拆分过大的 components.ts 到子目录
  - 保持向后兼容的导出

  **Commit**: `refactor(components): 拆分 components.ts`

---

### Wave 8: 清理和优化

- [ ] 34. 统一 DOM 创建模式

  **What to do**:
  - 识别所有内联 DOM 操作
  - 逐步替换为组件函数

  **Commit**: `refactor(ui): 统一 DOM 创建模式`

- [ ] 35. 优化导入路径

  **What to do**:
  - 使用统一的 utils/index.ts
  - 简化深层导入

  **Commit**: `refactor(imports): 优化导入路径`

- [ ] 36. 更新类型定义

  **What to do**:
  - 确保所有新模块的类型导出完整

  **Commit**: `refactor(types): 完善类型导出`

- [ ] 37. 添加模块文档

  **What to do**:
  - 为每个新模块添加 JSDoc 注释

  **Commit**: `docs: 添加模块文档`

---

### Wave 9: 最终验证

- [ ] 38. TypeScript 编译检查

  **What to do**:
  - 运行 `pnpm build`
  - 修复所有类型错误

  **Verification**:
  - [ ] `tsc --noEmit` 无错误
  - [ ] `pnpm build` 成功

  **Commit**: `fix(types): 修复编译错误`

- [ ] 39. 功能回归测试

  **What to do**:
  - 按照 AGENTS.md 中的回归检查清单测试
  - 面板打开/关闭
  - 分类/条目 CRUD
  - 拖拽排序
  - 导入/导出
  - 设置保存

  **Verification**:
  - [ ] 所有核心功能正常工作
  - [ ] 无控制台错误

  **Commit**: `test: 功能回归测试通过`

- [ ] 40. 代码审查和清理

  **What to do**:
  - 检查代码规范遵循情况
  - 删除无用代码
  - 检查重复导入

  **Verification**:
  - [ ] 代码符合项目规范
  - [ ] 无未使用变量

  **Commit**: `chore: 代码清理`

---

## Success Criteria

### 量化指标

| 指标                     | 当前    | 目标                 | 验证方式                               |
| ------------------------ | ------- | -------------------- | -------------------------------------- |
| index.ts 行数            | 4347    | < 500                | `wc -l`                                |
| workbench.ts 行数        | 1484    | < 300                | `wc -l`                                |
| uid() 重复定义           | 5处     | 1处                  | `grep -r "function uid"`               |
| resolveHostWindow() 重复 | 3处     | 1处                  | `grep -r "function resolveHostWindow"` |
| 工具函数导出点           | 4个文件 | 1个 (utils/index.ts) | 检查导入语句                           |

### 质量标准

- [ ] 所有 TypeScript 编译通过
- [ ] 运行时无错误
- [ ] 功能完全保持
- [ ] 代码可维护性提升（模块化程度）

---

## Commit 策略

每个 Task 独立提交，使用以下格式：

```
类型(范围): 描述

- 详细变更点1
- 详细变更点2
```

类型：

- `refactor`: 重构（主要）
- `fix`: 修复编译/运行时错误
- `test`: 测试相关
- `docs`: 文档
- `chore`: 清理

---

## 风险评估

| 风险         | 概率 | 影响 | 缓解措施                |
| ------------ | ---- | ---- | ----------------------- |
| 功能回归     | 中   | 高   | 每个 Task 后功能验证    |
| 类型错误     | 高   | 中   | 严格 TypeScript 检查    |
| 导入路径错误 | 中   | 中   | 统一使用 utils/index.ts |
| 合并冲突     | 低   | 中   | 小批量频繁提交          |

---

## 注意事项

1. **不要修改 dist/**: 只修改 src/，dist/ 由 CI 生成
2. **不要修改 .original 文件**: 这些是备份，不在版本控制中
3. **保持向后兼容**: 导出的 API 签名不变
4. **逐步验证**: 每个 Wave 完成后进行功能测试
5. **及时提交**: 每个 Task 完成后立即提交

---

_计划生成时间: 2026-03-23_ _基于代码库状态: commit 需用户确认_
