# 快速回复管理器架构重构计划

## TL;DR

> **Quick Summary**: 将 9728 行单文件 `index.ts` 重构为模块化架构，提升可维护性和复用性，同时保持单文件打包输出。
>
> **Deliverables**: 7 个核心模块目录 + 24 个独立模块文件 + 更新后的 AGENTS.md
>
> **Estimated Effort**: Large (2-3天) **Parallel Execution**: YES - 6 waves **Critical Path**: T1 → T5 → T10 → T14 → T16
> → T23 → F1-F4

---

## Context

### Original Request

用户要求重构
`src/快速回复管理器/index.ts`（9728 行），该文件已成为"屎山"，需要提高可维护性、组件复用性、性能，同时保持最终能打包成单个 JSON 脚本到酒馆使用。

### Interview Summary

- **当前代码分析**：9728 行单文件，80+ 函数，17 接口，1270 行内联 CSS
- **架构咨询**：Oracle 建议功能切片 + 模块级单例状态
- **Gap Analysis**：Metis 识别关键风险（CSS 类名稳定性、数据格式兼容）

### Research Findings

- **CSS 位置**: `ensureStyle()` 函数内，1317-2586 行，约 1270 行
- **状态对象**: 23 个属性，包含 `AbortController` 等非序列化对象
- **构建系统**: Webpack 5，支持 `?raw` 导入 SCSS
- **测试覆盖**: 零测试

### Metis Review - Identified Gaps (addressed)

- CSS 类名稳定性：必须保持所有 `.fp-*` 类名不变
- 数据格式兼容：`Pack.version` 必须保持，属性初始化顺序不变
- 自定义 CSS 功能：`applyCustomCSS()` 必须保留
- 验证策略：无测试，采用手动冒烟测试 + 构建验证

---

## Work Objectives

### Core Objective

将单文件架构重构为模块化架构，提升代码可维护性和可读性，同时保持：

1. 100% 功能兼容
2. 单文件打包输出
3. 数据格式向后兼容
4. CSS 类名和变量名不变

### Concrete Deliverables

```
src/快速回复管理器/
├── index.ts              # 入口，组装各模块
├── types.ts              # 类型定义 (17 interfaces)
├── constants.ts          # 常量
├── store.ts              # 状态管理
├── utils/                # 工具函数 (dom, data, validation, network)
├── services/             # 业务服务 (storage, debug, llm, placeholder)
├── ui/                   # UI渲染 (styles, components, workbench, preview, events)
├── features/             # 功能模块 (categories, items, import-export, settings)
└── styles/               # SCSS 样式 (tokens, base, components, animations)
```

### Definition of Done

- [ ] `pnpm build` 成功
- [ ] `pnpm lint` 无错误
- [ ] 打包后的 `dist/快速回复管理器/index.js` 可在酒馆中正常运行
- [ ] 所有原有功能正常（分类、条目、预览、设置、导入导出、LLM 生成）
- [ ] AGENTS.md 已更新（≤400行）

### Must Have

- 保持所有 CSS 类名 `.fp-*` 不变
- 保持所有 CSS 变量 `--qr-*` 不变
- 保持 `state` 对象结构和属性名
- 保持数据格式向后兼容

### Must NOT Have (Guardrails)

- 禁止改变任何公开 API 的签名
- 禁止引入 Pinia/Vue 响应式状态
- 禁止将 CSS 转换为 Tailwind
- 禁止删除或重命名任何 CSS 类名
- 禁止改变 state 属性的初始化顺序

---

## Verification Strategy

### Test Decision

- **Infrastructure exists**: NO
- **Automated tests**: None
- **Agent-Executed QA**: 构建验证 + 功能冒烟测试

### Verification Commands

```bash
pnpm build          # 必须成功
pnpm lint           # 必须无错误
npx tsc --noEmit    # 必须通过
```

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — 基础设施):
├── T1: 创建 types.ts [quick]
├── T2: 创建 constants.ts [quick]
├── T3: 创建 styles/ 并提取 CSS [visual-engineering]
└── T4: 创建验证脚本 [quick]

Wave 2 (After Wave 1 — 状态和工具):
├── T5: 创建 store.ts [unspecified-high]
├── T6: 创建 utils/dom.ts [quick]
├── T7: 创建 utils/data.ts [quick]
├── T8: 创建 utils/validation.ts [quick]
└── T9: 创建 utils/network.ts [quick]

Wave 3 (After Wave 2 — 服务层):
├── T10: 创建 services/storage.ts [unspecified-high]
├── T11: 创建 services/debug.ts [quick]
├── T12: 创建 services/llm.ts [unspecified-high]
└── T13: 创建 services/placeholder.ts [unspecified-high]

Wave 4 (After Wave 3 — UI 层):
├── T14: 创建 ui/styles.ts [quick]
├── T15: 创建 ui/components.ts [visual-engineering]
├── T16: 创建 ui/workbench.ts [visual-engineering]
├── T17: 创建 ui/preview.ts [visual-engineering]
└── T18: 创建 ui/events.ts [unspecified-high]

Wave 5 (After Wave 4 — 功能层):
├── T19: 创建 features/categories.ts [unspecified-high]
├── T20: 创建 features/items.ts [unspecified-high]
├── T21: 创建 features/import-export.ts [unspecified-high]
└── T22: 创建 features/settings.ts [unspecified-high]

Wave 6 (After Wave 5 — 入口整合):
├── T23: 重写 index.ts 入口 [deep]
└── T24: 清理和验证 [unspecified-high]

Wave FINAL (After ALL tasks):
├── F1: 功能回归测试 [oracle]
├── F2: 代码质量检查 [unspecified-high]
├── F3: 酒馆环境冒烟测试 [unspecified-high]
└── F4: 更新 AGENTS.md [writing]

Critical Path: T1 → T5 → T10 → T14 → T16 → T23 → F1-F4
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 5 (Waves 1 & 2)
```

### Dependency Matrix

| Task  | Depends On | Blocks       |
| ----- | ---------- | ------------ |
| 1-4   | —          | 5, 6-9, 14   |
| 5     | 1, 2       | 10-13, 19-22 |
| 6-9   | 1          | 10-13        |
| 10-13 | 5, 6-9     | 19-22, 23    |
| 14    | 3          | 15-18, 23    |
| 15-18 | 14, 5      | 23           |
| 19-22 | 5, 10-13   | 23           |
| 23    | ALL        | 24, F1-F4    |
| F1-F4 | 23         | —            |

### Agent Dispatch Summary

- **Wave 1**: T1-T2, T4 → quick, T3 → visual-engineering
- **Wave 2**: T5 → unspecified-high, T6-T9 → quick
- **Wave 3**: T10, T12-T13 → unspecified-high, T11 → quick
- **Wave 4**: T14 → quick, T15-T17 → visual-engineering, T18 → unspecified-high
- **Wave 5**: T19-T22 → unspecified-high
- **Wave 6**: T23 → deep, T24 → unspecified-high
- **FINAL**: F1 → oracle, F2-F3 → unspecified-high, F4 → writing

---

## TODOs

### Wave 1: 基础设施

- [ ] 1. **创建 types.ts** — `quick`

  **What to do**: 创建 `src/快速回复管理器/types.ts`，从 index.ts 提取所有 17 个接口定义（PackMeta, Category, Item,
  ConnectorButton, QrLlmPreset, QrLlmPresetStore, QrLlmSettings, QrLlmSecretConfig, Settings, UiState, Pack, DragData,
  AppState, ScriptStoreReadResult），使用 `export interface` 导出。

  **Must NOT do**: 改变任何属性名或类型

  **References**: `src/快速回复管理器/index.ts:42-196`

  **Acceptance Criteria**:
  - [ ] 文件创建: src/快速回复管理器/types.ts
  - [ ] 所有 17 个接口已导出
  - [ ] `tsc --noEmit` 通过

  **QA Scenarios**:

  ```
  Scenario: Verify interfaces exported
    Tool: Bash
    Steps: grep -c "^export interface" src/快速回复管理器/types.ts
    Expected: 17
    Evidence: .sisyphus/evidence/task-1-interfaces.txt
  ```

  **Commit**: YES (groups with T2, T3, T4)

- [ ] 2. **创建 constants.ts** — `quick`

  **What to do**: 创建 `src/快速回复管理器/constants.ts`，提取所有常量（SCRIPT_LABEL, STORE_KEY, STYLE_ID, OVERLAY_ID,
  TOAST_CONTAINER_ID, QR_LLM_SECRET_KEY, DEFAULT_QR_LLM_PRESET_NAME, DEFAULT_QR_LLM_PRESET_VERSION, DATA_VERSION,
  PERSIST_DEBOUNCE_MS, FETCH_TIMEOUT_MS, RUNTIME_KEY, THEME_NAMES, CONNECTOR_COLOR_NAMES, CONNECTOR_COLOR_HEX,
  CONNECTOR_ONLY_KEYS）。

  **Must NOT do**: 改变任何常量值

  **References**: `src/快速回复管理器/index.ts:4-40, 258-262`

  **Acceptance Criteria**:
  - [ ] 文件创建: src/快速回复管理器/constants.ts
  - [ ] 所有常量已导出
  - [ ] `pnpm build` 成功

  **Commit**: YES (groups with T1, T3, T4)

- [ ] 3. **创建 styles/ 并提取 CSS** — `visual-engineering`

  **What to do**: 创建 `src/快速回复管理器/styles/` 目录，从 `ensureStyle()`
  函数（1317-2586行）提取内联 CSS 到 SCSS 文件：`_tokens.scss`（CSS变量）、`_base.scss`（基础样式）、`_components.scss`（组件样式）、`_animations.scss`（动画）、`index.scss`（入口）。保持字体导入在顶部。

  **Must NOT do**: 改变任何 `.fp-*` 类名或 `--qr-*` 变量名

  **References**: `src/快速回复管理器/index.ts:1317-2586`

  **Acceptance Criteria**:
  - [ ] 目录创建: src/快速回复管理器/styles/
  - [ ] 所有 SCSS 文件已创建
  - [ ] CSS 可通过 `?raw` 导入
  - [ ] 视觉效果与原版一致

  **QA Scenarios**:

  ```
  Scenario: Verify CSS class names preserved
    Tool: Bash
    Steps: grep -o "\.fp-[a-z0-9-]*" src/快速回复管理器/styles/*.scss | sort -u | wc -l
    Expected: 与原版相同数量
    Evidence: .sisyphus/evidence/task-3-css-classes.txt
  ```

  **Commit**: YES (groups with T1, T2, T4)

- [ ] 4. **创建验证脚本** — `quick`

  **What to do**: 创建 `scripts/verify-refactor.ts`，定义测试 fixtures 和冒烟测试函数（verifyBuild, verifyTypes,
  verifyBundle），添加 npm script `"verify": "ts-node scripts/verify-refactor.ts"`。

  **Acceptance Criteria**:
  - [ ] 文件创建: scripts/verify-refactor.ts
  - [ ] npm script 已添加
  - [ ] 脚本运行无错误

  **Commit**: YES (groups with T1, T2, T3)

### Wave 2: 状态和工具

- [ ] 5. **创建 store.ts** — `unspecified-high`

  **What to do**: 创建 `src/快速回复管理器/store.ts`，定义模块级单例 `state` 对象，导出状态访问函数（getState, loadPack,
  persistPack, persistPackNow, flushPersistPack）。从 types.ts, constants.ts 导入。

  **Must NOT do**: 改变 state 属性名或初始化顺序

  **References**: `src/快速回复管理器/index.ts:219-252, 1253-1311`

  **Acceptance Criteria**:
  - [ ] 文件创建: src/快速回复管理器/store.ts
  - [ ] state 单例已导出
  - [ ] 访问函数已导出

  **Commit**: YES

- [ ] 6. **创建 utils/dom.ts** — `quick`

  **What to do**: 提取纯 DOM 工具函数：uid(), escapeHtml(), asDomElement(), getInputValueTrim(),
  resolveHostWindow()。不导入 store。

  **References**: `src/快速回复管理器/index.ts:197-281`

  **Commit**: YES (groups with T7-9)

- [ ] 7. **创建 utils/data.ts** — `quick`

  **What to do**: 提取数据工具函数：deepClone(), parsePackUpdatedAtMs(), nowIso()。不导入 store。

  **References**: `src/快速回复管理器/index.ts:264-266, 381-383, 478-485`

  **Commit**: YES (groups with T6, T8, T9)

- [ ] 8. **创建 utils/validation.ts** — `quick`

  **What to do**: 提取验证工具函数：validateApiUrlOrThrow(), mergeAbortSignals()。不导入 store。

  **References**: `src/快速回复管理器/index.ts:330-379`

  **Commit**: YES (groups with T6, T7, T9)

- [ ] 9. **创建 utils/network.ts** — `quick`

  **What to do**: 提取网络工具函数：fetchWithTimeout(),
  copyTextRobust()。从 utils/validation.ts 导入 mergeAbortSignals。

  **References**: `src/快速回复管理器/index.ts:290-379`

  **Commit**: YES (groups with T6-8)

### Wave 3: 服务层

- [ ] 10. **创建 services/storage.ts** — `unspecified-high`

  **What to do**: 提取存储服务函数：getScriptStoreRaw(), saveScriptStoreRaw(), buildDefaultPack(), normalizePack(),
  getViewportSize(), computeFitPanelSize(), applyFitPanelSize()。从 store.ts, types.ts, constants.ts, utils/ 导入。

  **References**: `src/快速回复管理器/index.ts:413-435, 463-580, 983-1311`

  **Commit**: YES (groups with T11-13)

- [ ] 11. **创建 services/debug.ts** — `quick`

  **What to do**: 提取调试服务函数：pushDebugLog(), logInfo(), logError(), getDebugLogText()。从 store.ts 导入。

  **References**: `src/快速回复管理器/index.ts:385-411`

  **Commit**: YES (groups with T10, T12, T13)

- [ ] 12. **创建 services/llm.ts** — `unspecified-high`

  **What to do**: 提取 LLM 服务函数：buildDefaultQrLlmPresetStore(), normalizeQrLlmPresetStore(), compileQrLlmPreset(),
  normalizePromptGroup(), sanitizeDefaultQrLlmPreset(), loadQrLlmSecretConfig(), saveQrLlmSecretConfig(),
  getQrLlmSecretConfig(), invalidateEditGeneration(), getDefaultQrLlmSettings()。从 store.ts, types.ts, constants.ts,
  utils/ 导入。

  **References**: `src/快速回复管理器/index.ts:319-328, 581-981`

  **Commit**: YES (groups with T10, T11, T13)

- [ ] 13. **创建 services/placeholder.ts** — `unspecified-high`

  **What to do**: 提取占位符服务函数：占位符解析、角色映射、Token 替换逻辑。从 store.ts, types.ts, constants.ts 导入。

  **Commit**: YES (groups with T10-12)

### Wave 4: UI 层

- [ ] 14. **创建 ui/styles.ts** — `quick`

  **What to do**: 从 `../styles/index.scss?raw` 导入 CSS，创建 ensureStyle(),
  applyCustomCSS() 函数。从 constants.ts 导入。

  **References**: `src/快速回复管理器/index.ts:1313-1316`

  **Commit**: YES (groups with T15-18)

- [ ] 15. **创建 ui/components.ts** — `visual-engineering`

  **What to do**: 提取可复用 UI 组件：showModal(), toast(), openContextMenu(), 按钮和表单组件助手。从 store.ts,
  constants.ts, utils/ 导入。

  **Commit**: YES (groups with T14, T16-18)

- [ ] 16. **创建 ui/workbench.ts** — `visual-engineering`

  **What to do**: 提取主 UI 渲染函数：renderWorkbench(), renderSidebar(), renderMain(), renderTopBar(),
  renderPath()。从 store.ts, constants.ts, utils/, ui/components.ts 导入。

  **Commit**: YES (groups with T14, T15, T17, T18)

- [ ] 17. **创建 ui/preview.ts** — `visual-engineering`

  **What to do**: 提取预览面板函数：renderPreview(), Token 拖拽逻辑, 预览文本生成。从 store.ts, constants.ts, utils/,
  ui/ 导入。

  **Commit**: YES (groups with T14-16, T18)

- [ ] 18. **创建 ui/events.ts** — `unspecified-high`

  **What to do**: 提取事件处理函数：点击、拖拽、键盘、调整大小、输入同步处理器。从 store.ts, features/, services/ 导入。

  **Commit**: YES (groups with T14-17)

### Wave 5: 功能层

- [ ] 19. **创建 features/categories.ts** — `unspecified-high`

  **What to do**: 提取分类操作：CRUD、树操作（展开/折叠）、路径解析、排序。从 store.ts, types.ts, constants.ts 导入。

  **Commit**: YES (groups with T20-22)

- [ ] 20. **创建 features/items.ts** — `unspecified-high`

  **What to do**: 提取条目操作：CRUD、执行（append/inject）、收藏管理、排序。从 store.ts, types.ts, constants.ts,
  services/ 导入。

  **Commit**: YES (groups with T19, T21, T22)

- [ ] 21. **创建 features/import-export.ts** — `unspecified-high`

  **What to do**: 提取导入导出操作：Pack 导入（JSON/文件）、Pack 导出（JSON/文件）、冲突解决、数据迁移。从 store.ts,
  types.ts, constants.ts, services/ 导入。

  **References**: `src/快速回复管理器/index.ts:8000+`

  **Commit**: YES (groups with T19, T20, T22)

- [ ] 22. **创建 features/settings.ts** — `unspecified-high`

  **What to do**: 提取设置操作：设置模态渲染、保存/加载、主题切换、占位符管理。从 store.ts, types.ts, constants.ts,
  services/, ui/ 导入。

  **Commit**: YES (groups with T19-21)

### Wave 6: 入口整合

- [ ] 23. **重写 index.ts 入口** — `deep`

  **What to
  do**: 将 index.ts 重写为 ES 模块，移除 IIFE 包装，从所有模块导入，仅保留初始化逻辑（`$(() => { errorCatched(initApp)(); })`
  和 `$(window).on('pagehide', cleanup)`）。验证所有导入正确解析。

  **Must NOT do**: 添加新功能或改变初始化顺序

  **Acceptance Criteria**:
  - [ ] index.ts 已重写为 ES 模块
  - [ ] 所有导入已解析
  - [ ] IIFE 包装已移除
  - [ ] `pnpm build` 成功
  - [ ] `pnpm lint` 通过

  **Commit**: YES

- [ ] 24. **清理和验证** — `unspecified-high`

  **What to do**: 移除任何重复代码，验证无循环依赖，运行完整验证（pnpm build, pnpm lint, tsc
  --noEmit），对比打包大小与原版。

  **Acceptance Criteria**:
  - [ ] 无重复代码
  - [ ] 无循环依赖
  - [ ] 所有验证通过
  - [ ] 打包大小相近

  **Commit**: YES

---

## Final Verification Wave

- [ ] F1. **Plan Compliance Audit** — `oracle`

  验证所有 TODO 已完成，所有文件已创建，所有导入导出正确。检查所有 Must Have 条件满足，所有 Must NOT Have 条件未违反。

  Output: `Must Have [N/N] | Must NOT Have [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`

  运行质量检查：`pnpm lint`（无错误）、`tsc --noEmit`（无类型错误）、`pnpm build`（构建成功），检查无
  `as any`、无空 catch、无未使用导入。

  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Types [PASS/FAIL] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`

  在酒馆环境中进行冒烟测试：脚本加载、分类导航、条目执行、预览面板、设置保存、导入导出、LLM 生成。

  Output: `Scenarios [N/N pass] | Features [N/N] | VERDICT`

- [ ] F4. **Update AGENTS.md** — `writing`

  更新项目文档，添加快速回复管理器架构说明、模块结构、开发指南。文档不超过 400 行。

  Output: `AGENTS.md updated | Lines [N] | VERDICT`

---

## Commit Strategy

每个 Wave 完成后提交：

- **Wave 1**: `refactor(qr): extract foundation layer - types, constants, styles`
- **Wave 2**: `refactor(qr): extract state and utilities`
- **Wave 3**: `refactor(qr): extract services layer`
- **Wave 4**: `refactor(qr): extract UI layer`
- **Wave 5**: `refactor(qr): extract features layer`
- **Wave 6**: `refactor(qr): rewrite entry point and cleanup`
- **Final**: `refactor(qr): complete modular architecture - update docs`

---

## Success Criteria

### Verification Commands

```bash
pnpm build          # Expected: success
pnpm lint           # Expected: no errors
tsc --noEmit        # Expected: no type errors
ls dist/快速回复管理器/index.js  # Expected: file exists
```

### Final Checklist

- [ ] 所有 Must Have 条件满足
- [ ] 所有 Must NOT Have 条件未被违反
- [ ] `pnpm build` 成功
- [ ] 打包后脚本在酒馆中正常运行
- [ ] AGENTS.md 已更新（≤400行）
