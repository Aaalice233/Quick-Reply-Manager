# 快速回复管理器函数缺失修复计划

## TL;DR

> **目标**: 修复快速回复管理器重构过程中缺失的7个关键函数和1个常量
>
> **核心问题**:
>
> - AI生成无法取消 (`invalidateEditGeneration`)
> - 窗口自适应失效 (`attachHostResize`/`detachHostResize`)
> - 无法关闭面板/编辑条目 (`closeWorkbench`, `showEditItemModal`)
>
> **预计工作量**: 中等 (~2-3小时) **并行执行**: YES - 3个波次 **关键路径**: Wave 1 (AI生成控制) → Wave 2 (UI功能) → Wave
> 3 (优化)

---

## Context

### 原始请求

对比原始单文件脚本 (index.ts.original, 9,728行) 与当前模块化项目，识别并修复函数缺失问题。

### 调查方法

启动5个并行子代理进行全方位分析：

1. 当前项目结构分析 - 完成
2. 原始脚本导出分析 - 完成
3. 函数缺失对比 - 完成
4. 功能完整性检查 - 完成
5. 类型和常量分析 - 完成

### 核心发现

- **项目架构**: 分层模块化 (Core → Utils → Services → Features → UI)
- **代码规模**: 原始9,728行 → 当前~3,000行 (20+文件)
- **功能完整性**: ~95% (核心功能完整，缺失主要是辅助功能)
- **类型系统**: 100% 完整迁移

---

## Work Objectives

### Core Objective

补充重构过程中遗漏的7个关键函数和1个常量，确保AI生成功能可控、UI交互完整、资源正确释放。

### Concrete Deliverables

- `services/llm.ts`: 添加 `invalidateEditGeneration()`
- `ui/workbench.ts`: 添加 `attachHostResize()`, `detachHostResize()`, `closeWorkbench()`
- `features/items.ts`: 添加 `showEditItemModal()` 或确认现有实现
- `features/import-export.ts`: 添加 `openAdvancedImportModal()`
- `constants.ts`: 添加 `CUSTOM_CSS_ID`

### Definition of Done

- [ ] AI生成可以被ESC键取消
- [ ] 窗口大小变化时面板自动调整尺寸
- [ ] 点击关闭按钮可以关闭工作台
- [ ] 点击编辑条目可以打开编辑模态框
- [ ] 导入功能入口正常工作

### Must Have

- AI生成状态控制函数
- 窗口resize事件绑定/解绑
- 工作台关闭功能

### Must NOT Have (Guardrails)

- 不修改现有正常工作功能
- 不改变函数签名（如需改变需保持向后兼容）
- 不引入新的依赖

---

## Verification Strategy

### Test Decision

- **Infrastructure exists**: YES (项目有完整TypeScript配置)
- **Automated tests**: NO (本项目无测试框架)
- **Agent-Executed QA**: MANDATORY - 每个任务包含具体QA场景

### QA Policy

每个任务必须包含可执行的QA验证步骤：

- **功能验证**: 通过代码审查确认函数存在和调用正确
- **集成验证**: 确认函数在正确的模块导出并被使用
- **行为验证**: 确认功能符合原始脚本行为

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (高优先级 - 阻塞性功能修复):
├── Task 1: 添加 invalidateEditGeneration [quick]
│   └── 文件: services/llm.ts
│   └── 依赖: 无
│   └── 阻塞: Task 2 (ESC取消生成)
│
├── Task 2: 添加 attachHostResize/detachHostResize [quick]
│   └── 文件: ui/workbench.ts
│   └── 依赖: 无
│   └── 阻塞: 无
│
└── Task 3: 添加 CUSTOM_CSS_ID 常量 [quick]
    └── 文件: constants.ts
    └── 依赖: 无
    └── 阻塞: 无

Wave 2 (中优先级 - UI功能补全):
├── Task 4: 添加 closeWorkbench [quick]
│   └── 文件: ui/workbench.ts
│   └── 依赖: Wave 1 Task 2
│   └── 阻塞: 无
│
├── Task 5: 确认/添加 showEditItemModal [quick]
│   └── 文件: features/items.ts 或 index.ts
│   └── 依赖: 无
│   └── 阻塞: 无
│
└── Task 6: 添加 openAdvancedImportModal [quick]
    └── 文件: features/import-export.ts
    └── 依赖: 无
    └── 阻塞: 无

Wave 3 (低优先级 - 可选优化):
└── Task 7: 添加 computeFitPanelSize [quick]
    └── 文件: ui/workbench.ts
    └── 依赖: Wave 1 Task 2
    └── 阻塞: 无

Wave FINAL (验证):
├── Task F1: 代码审查 - 确认所有函数已添加
├── Task F2: 集成检查 - 确认导出和引用正确
└── Task F3: 行为验证 - 确认功能符合预期
```

### Dependency Matrix

| Task  | Depends On | Blocks       | Category |
| ----- | ---------- | ------------ | -------- |
| T1    | -          | T2 (ESC取消) | quick    |
| T2    | -          | T4, T7       | quick    |
| T3    | -          | -            | quick    |
| T4    | T2         | -            | quick    |
| T5    | -          | -            | quick    |
| T6    | -          | -            | quick    |
| T7    | T2         | -            | quick    |
| F1-F3 | T1-T7      | -            | review   |

### Agent Dispatch Summary

- **Wave 1**: 3 tasks → `quick` ×3
- **Wave 2**: 3 tasks → `quick` ×3
- **Wave 3**: 1 task → `quick` ×1
- **Wave FINAL**: 3 tasks → `quick` ×3

---

## TODOs

### Wave 1: 核心功能修复

- [x] 1. 添加 `invalidateEditGeneration` 函数

  **What to do**:
  - 在 `services/llm.ts` 添加函数 `invalidateEditGeneration(shouldAbort = true): void`
  - 函数应中止当前的abortController（如果shouldAbort为true）
  - 重置所有editGenerateState状态字段
  - 递增requestSeq

  **Must NOT do**:
  - 不要改变state的其他字段
  - 不要直接操作DOM

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: TypeScript基础

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 2 (ESC键取消生成)

  **References**:
  - 原始实现: `index.ts.original` 第319-328行
  - 状态定义: `types.ts` 中的 `editGenerateState`
  - 使用位置: `index.ts` 中ESC键处理

  **Acceptance Criteria**:
  - [ ] 函数导出并可调用
  - [ ] 调用后isGenerating设为false
  - [ ] 调用后abortController被中止
  - [ ] requestSeq递增

  **QA Scenarios**:

  ```
  Scenario: AI生成时按ESC取消
    Preconditions: state.editGenerateState.isGenerating = true
    Steps:
      1. 调用 invalidateEditGeneration(true)
    Expected Result:
      - isGenerating = false
      - abortController = null
      - requestSeq 增加1
    Evidence: 代码审查 + console.log验证
  ```

- [x] 2. 添加 `attachHostResize` 和 `detachHostResize` 函数

  **What to do**:
  - 在 `ui/workbench.ts` 添加两个函数
  - `attachHostResize()`: 绑定窗口resize事件，防抖处理，调用applyFitPanelSize和renderWorkbench
  - `detachHostResize()`: 解绑事件，清理resizeRaf

  **Must NOT do**:
  - 不要直接操作state（通过参数传入）
  - 不要在detach时调用render

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: DOM事件处理

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 4, Task 7

  **References**:
  - 原始实现: `index.ts.original` 第437-461行
  - 相关函数: `applyFitPanelSize` (index.ts第348行)
  - 宿主窗口: `utils/dom.ts` 的 `resolveHostWindow`

  **Acceptance Criteria**:
  - [ ] attachHostResize导出并可调用
  - [ ] detachHostResize导出并可调用
  - [ ] resize事件正确绑定到宿主窗口
  - [ ] 防抖机制正确（使用requestAnimationFrame）

  **QA Scenarios**:

  ```
  Scenario: 窗口大小变化时面板自适应
    Tool: 代码审查
    Preconditions: 工作台已打开
    Steps:
      1. 调用 attachHostResize()
      2. 模拟窗口resize事件
    Expected Result:
      - applyFitPanelSize被调用
      - renderWorkbench被调用
    Evidence: 代码静态分析
  ```

- [x] 3. 添加 `CUSTOM_CSS_ID` 常量

  **What to do**:
  - 在 `constants.ts` 添加: `export const CUSTOM_CSS_ID = 'fast-plot-custom-css-v1'`

  **Recommended Agent Profile**:
  - **Category**: `quick`

  **Parallelization**:
  - **Can Run In Parallel**: YES

  **Acceptance Criteria**:
  - [ ] 常量已定义并导出
  - [ ] 值与原始脚本一致

### Wave 2: UI功能补全

- [x] 4. 添加 `closeWorkbench` 函数

  **What to do**:
  - 在 `ui/workbench.ts` 添加 `closeWorkbench(): void`
  - 移除overlay元素
  - 解绑事件
  - 调用detachHostResize

  **Recommended Agent Profile**:
  - **Category**: `quick`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Blocked By**: Task 2 (需要detachHostResize)

  **References**:
  - 原始实现: `index.ts.original` 第9506行附近
  - overlay ID: `OVERLAY_ID` (constants.ts)

  **Acceptance Criteria**:
  - [ ] 函数导出并可调用
  - [ ] 调用后overlay被移除
  - [ ] 调用后resize事件被解绑

- [x] 5. 确认/添加 `showEditItemModal` 函数

  **What to do**:
  - 检查 `index.ts` 是否已有此函数（可能在3209行附近）
  - 如缺失，在 `features/items.ts` 或 `ui/workbench.ts` 添加
  - 函数接收itemId参数，打开编辑模态框

  **Recommended Agent Profile**:
  - **Category**: `quick`

  **Parallelization**:
  - **Can Run In Parallel**: YES

  **References**:
  - 原始实现: `index.ts.original` 第7355行附近
  - 调用位置: `index.ts` 中 `item:edit` 事件处理

  **Acceptance Criteria**:
  - [ ] 函数存在并可调用
  - [ ] 能正确打开编辑模态框
  - [ ] 编辑后数据正确保存

- [x] 6. 添加 `openAdvancedImportModal` 函数

  **What to do**:
  - 在 `features/import-export.ts` 添加 `openAdvancedImportModal(): void`
  - 打开高级导入模态框
  - 支持选择性导入

  **Recommended Agent Profile**:
  - **Category**: `quick`

  **Parallelization**:
  - **Can Run In Parallel**: YES

  **References**:
  - 原始实现: `index.ts.original` 第3947行附近
  - 调用位置: `index.ts` 中 `[data-import]` 按钮处理

  **Acceptance Criteria**:
  - [ ] 函数导出并可调用
  - [ ] 能正确打开导入模态框
  - [ ] 导入功能正常工作

### Wave 3: 可选优化

- [x] 7. 添加 `computeFitPanelSize` 函数

  **What to do**:
  - 在 `ui/workbench.ts` 添加 `computeFitPanelSize(): { width, height }`
  - 根据视口计算最佳面板尺寸
  - 返回推荐的宽度和高度

  **Recommended Agent Profile**:
  - **Category**: `quick`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Blocked By**: Task 2

  **References**:
  - 原始实现: `index.ts.original` 第423-428行

  **Acceptance Criteria**:
  - [ ] 函数导出并可调用
  - [ ] 返回正确的尺寸对象
  - [ ] 尺寸计算逻辑与原始一致

### Final Verification Wave

- [x] F1. 代码审查

  **What to do**:
  - 审查所有添加的函数
  - 确认导出正确
  - 确认类型定义正确

  **Recommended Agent Profile**:
  - **Category**: `quick`

  **Acceptance Criteria**:
  - [ ] 所有7个函数已添加
  - [ ] 所有函数正确导出
  - [ ] 1个常量已添加

- [x] F2. 集成检查

  **What to do**:
  - 检查函数引用关系
  - 确认无循环依赖
  - 确认导出路径正确

  **Recommended Agent Profile**:
  - **Category**: `quick`

  **Acceptance Criteria**:
  - [ ] 无TypeScript编译错误
  - [ ] 所有导出被正确引用

- [x] F3. 行为验证

  **What to do**:
  - 对比原始脚本行为
  - 确认功能一致性

  **Recommended Agent Profile**:
  - **Category**: `deep`

  **Acceptance Criteria**:
  - [ ] 功能行为与原始脚本一致

---

## Commit Strategy

- **Wave 1 commits**:
  - `fix(llm): add invalidateEditGeneration for AI cancellation control`
  - `fix(ui): add attach/detachHostResize for window adaptive`
  - `chore(constants): add CUSTOM_CSS_ID constant`

- **Wave 2 commits**:
  - `feat(ui): add closeWorkbench function`
  - `feat(items): add showEditItemModal function`
  - `feat(import): add openAdvancedImportModal function`

- **Wave 3 commits** (optional):
  - `refactor(ui): add computeFitPanelSize for precise sizing`

---

## Success Criteria

### Verification Commands

```bash
# TypeScript编译检查
pnpm build

# Lint检查
pnpm lint
```

### Final Checklist

- [ ] 所有"Must Have"函数已添加
- [ ] TypeScript编译无错误
- [ ] Lint检查通过
- [ ] 功能行为与原始脚本一致

---

## Risk Assessment

### 高风险

- **AI生成无法取消**: 用户可能陷入长时间生成等待
- **内存泄漏**: 缺少resize事件解绑

### 中风险

- **无法关闭面板**: 影响基础用户体验

### 低风险

- 常量缺失 - 不影响功能

---

## Appendix: Analysis Sources

### Background Task Results

1. `bg_cb46c05b` - 当前项目结构分析
2. `bg_f370d714` - 函数缺失对比
3. `bg_d5823915` - 类型和常量分析
4. `bg_9b4f02cf` - 功能完整性检查
5. `bg_69aba9b2` - 当前项目导出分析
6. `bg_1c208ab5` - 原始脚本导出分析

### Key Files

- 原始脚本: `src/快速回复管理器/index.ts.original`
- 当前项目: `src/快速回复管理器/` (20+ files)
- 分析报告: `.sisyphus/drafts/qr-manager-gap-analysis.md`

---

_Plan generated by Prometheus based on 7 parallel sub-agent analysis results_ _Date: 2026-03-21_
