# 快速回复管理器重构修复计划

## 执行概要

**项目**: 快速回复管理器架构重构后的功能修复  
**发现的问题**: 35个（按严重程度分组）  
**预估工作量**: 10-15小时（顺序执行）/ 3-4小时（并行执行）  
**建议执行方式**: 使用4-6个并行子代理同时修复不同模块

**计划文件路径**: `.sisyphus/plans/quick-reply-manager-fix-plan.md` ✅

---

## 并行执行策略

### 推荐的子代理分配方案

为了最大化效率，建议启动 **5个并行子代理** 同时工作：

| 子代理                 | 负责模块                              | 任务数 | 预估时间 | 依赖              |
| ---------------------- | ------------------------------------- | ------ | -------- | ----------------- |
| **Agent 1 - 核心修复** | index.ts 致命问题                     | 4      | 1小时    | 无                |
| **Agent 2 - 条目功能** | features/items.ts                     | 6      | 1小时    | 无                |
| **Agent 3 - UI组件**   | ui/components.ts, ui/events.ts        | 4      | 1.5小时  | 无                |
| **Agent 4 - 服务层**   | services/placeholder.ts, utils/dom.ts | 5      | 1小时    | 无                |
| **Agent 5 - 高级功能** | 拖拽、导入导出                        | 6      | 2小时    | 等待Agent 1-4完成 |

### 启动命令示例

```bash
# 启动5个并行修复任务
task(subagent_type="quick", prompt="修复index.ts的4个P0级别问题...")
task(subagent_type="quick", prompt="修复features/items.ts的6个问题...")
task(subagent_type="quick", prompt="修复UI组件层的问题...")
task(subagent_type="quick", prompt="修复服务层的问题...")
task(subagent_type="unspecified-high", prompt="实现拖拽和导入导出功能...")
```

### 批次划分原则

1. **Wave 1 (立即并行)** - 无依赖的基础修复
   - 所有P0级别问题（4个任务）
   - 独立的函数添加（10个任务）

2. **Wave 2 (后续并行)** - 依赖Wave 1的高级功能
   - 拖拽排序系统
   - 导入导出界面
   - 复杂模态框

3. **Wave 3 (最终验证)**
   - 整体测试
   - 回归验证
   - 构建验证

---

## 顺序执行 vs 并行执行对比

| 执行方式     | 预估时间    | 效率   | 风险   | 适用场景          |
| ------------ | ----------- | ------ | ------ | ----------------- |
| 顺序执行     | 10-15小时   | 低     | 低     | 单人开发          |
| **并行执行** | **3-4小时** | **高** | **中** | **团队/代理协作** |

**建议**: 使用并行执行，通过清晰的任务划分和文件锁定避免冲突。

---

## P0 - 立即修复（功能完全不可用）

### 任务1: 修复条目点击执行逻辑

**严重度**: 🔴 致命 **文件**: `src/快速回复管理器/index.ts` **问题**: 点击条目只添加到预览，没有实际执行 **原始代码**
(行501-513):

```typescript
const itemCard = target.closest('.fp-card[data-item-id]') as HTMLElement | null;
if (itemCard && !target.closest('.fp-card-add')) {
  const itemId = itemCard.dataset.itemId;
  if (itemId) {
    const item = getItemById(itemId);
    if (item) {
      addPreviewToken('item', item.name, item.content); // ❌ 只添加预览
      syncPreviewToInput();
    }
  }
  return;
}
```

**修复代码**:

```typescript
const itemCard = target.closest('.fp-card[data-item-id]') as HTMLElement | null;
if (itemCard && !target.closest('.fp-card-add')) {
  const itemId = itemCard.dataset.itemId;
  if (itemId) {
    // ❌ 修复：实际执行条目
    import('./features/items').then(({ insertQrContent }) => {
      insertQrContent(itemId);
    });
  }
  return;
}
```

**验证**: 点击条目后应该实际追加内容到输入框

**分配给**: Agent 1 (核心修复)

---

### 任务2: 添加连接符按钮事件绑定

**严重度**: 🔴 致命 **文件**: `src/快速回复管理器/index.ts` **问题**: 连接符按钮、前缀模式开关、自定义按钮事件未绑定
**位置**: `bindPanelEvents()` 函数（行367-526）后添加 **修复代码**:

```typescript
// 连接符按钮点击（在 bindPanelEvents 函数中添加）
const connectors = state.pack?.settings?.connectors || [];
connectors.forEach((conn, i) => {
  const connBtn = target.closest(`[data-conn-${i}]`) as HTMLElement | null;
  if (connBtn) {
    if (!state.pack) return;
    if (!state.pack.settings.defaults.connectorPrefixMode) {
      // 直接插入模式
      addPreviewToken(`conn-id:${conn.id}`, conn.token, conn.token);
      syncPreviewToInput();
      toast(`已插入"${conn.label}"`);
    } else {
      // 前缀模式：选择激活连接符
      state.pack.settings.defaults.connectorPrefixId = conn.id;
      persistPack();
      renderWorkbench();
    }
    return;
  }
});

// 连接符模式切换开关
const connModeToggle = target.closest('[data-conn-mode-toggle]') as HTMLElement | null;
if (connModeToggle) {
  if (!state.pack) return;
  const next = !state.pack.settings.defaults.connectorPrefixMode;
  state.pack.settings.defaults.connectorPrefixMode = next;
  if (next && !state.pack.settings.defaults.connectorPrefixId && connectors.length > 0) {
    state.pack.settings.defaults.connectorPrefixId = connectors[0].id;
  }
  persistPack();
  renderWorkbench();
  return;
}

// 自定义连接符按钮
const connCustomBtn = target.closest('[data-conn-custom]') as HTMLElement | null;
if (connCustomBtn) {
  const token = prompt('输入自定义连接符内容');
  if (token && state.pack) {
    addPreviewToken('raw', token, token);
    syncPreviewToInput();
  }
  return;
}
```

**验证**: 点击连接符按钮应该能插入到输入框

---

### 任务3: 添加热重载/重复注入处理机制

**严重度**: 🔴 致命 **文件**: `src/快速回复管理器/index.ts`, `src/快速回复管理器/constants.ts`
**问题**: 缺少 RUNTIME_KEY 机制，热重载后事件会重复绑定 **修复步骤**:

1. 在 `constants.ts` 添加: `export const RUNTIME_KEY = '__QRM_RUNTIME_V2__';`
2. 修改 `init()` 函数开头:

```typescript
function init(): void {
  // 热重载/重复注入时先清理旧实例
  try {
    const oldRuntime = (pW as unknown as Record<string, unknown>)[RUNTIME_KEY] as { teardown?: () => void } | undefined;
    if (oldRuntime?.teardown) oldRuntime.teardown();
  } catch (e) {}

  if (isInitialized) {
    logInfo('已经初始化，跳过');
    return;
  }

  // 创建全局运行时对象
  const cleanups: Array<() => void> = [];
  (pW as unknown as Record<string, unknown>)[RUNTIME_KEY] = {
    teardown: () => {
      for (const fn of cleanups.splice(0)) {
        try {
          fn();
        } catch (e) {}
      }
      cleanup();
    },
  };

  // ... 后续初始化代码，将清理函数添加到 cleanups 数组
}
```

**验证**: 热重载后不应该有重复的事件绑定

**分配给**: Agent 1 (核心修复)

---

### 任务4: 恢复角色切换监听

**严重度**: 🔴 致命 **文件**: `src/快速回复管理器/index.ts`
**问题**: 缺少 CHAT_CHANGED 和 CHARACTER_PAGE_LOADED 监听，角色切换后占位符不更新 **修复代码** (在 init() 中添加):

```typescript
function registerCharacterListeners(cleanups: Array<() => void>): void {
  try {
    const onChatChanged = () => {
      handleActiveCharacterContextChanged({ silent: true, rerender: true });
    };
    const onCharacterLoaded = () => {
      handleActiveCharacterContextChanged({ silent: true, rerender: true });
    };

    eventOn(tavern_events.CHAT_CHANGED, onChatChanged);
    eventOn(tavern_events.CHARACTER_PAGE_LOADED, onCharacterLoaded);

    // 定时同步（可选）
    const roleSyncTimer = pW.setInterval(() => {
      handleActiveCharacterContextChanged({ silent: true });
    }, 900);

    cleanups.push(() => {
      try {
        const offFn = (globalThis as unknown as { eventOff?: (name: unknown, handler: unknown) => void }).eventOff;
        if (typeof offFn === 'function') {
          offFn(tavern_events.CHAT_CHANGED, onChatChanged);
          offFn(tavern_events.CHARACTER_PAGE_LOADED, onCharacterLoaded);
        }
      } catch (e) {}
      try {
        pW.clearInterval(roleSyncTimer);
      } catch (e) {}
    });
  } catch (e) {
    logError('角色切换监听注册失败', String(e));
  }
}
```

**验证**: 切换角色卡后占位符应该自动更新

**分配给**: Agent 1 (核心修复)

---

## 🟡 P1 - 尽快修复（严重影响体验）- 8项

**Wave 1 并行执行**（Agent 2-5可同时工作）：

### 任务5: 实现分类树拖拽排序事件绑定

**严重度**: 🟡 高 **文件**: `src/快速回复管理器/ui/workbench.ts` **问题**: 原始版本使用Pointer
Events系统，重构后完全未实现拖拽 **修复方式**: 从 `index.ts.original:4311-4419` 提取 `attachPointerCategoryDropDrag`
函数 **工作量**: 约2小时 **依赖**: 需要将原始版本的Pointer拖拽系统完整移植

**分配给**: Agent 5 (高级功能)

---

### 任务6: 实现条目卡片拖拽排序事件绑定

**严重度**: 🟡 高 **文件**: `src/快速回复管理器/ui/workbench.ts`, `src/快速回复管理器/ui/events.ts`
**问题**: 条目卡片拖拽事件未绑定 **修复方式**: 从 `index.ts.original:4421-4494` 提取 `runSnapshotReorderDrag` 函数
**工作量**: 约2小时

**分配给**: Agent 5 (高级功能)

---

### 任务7: 添加缺失的4个设置面板辅助函数

**严重度**: 🟡 高 **文件**: 多个 **缺失函数**:

1. `createCircularColorPicker` → `ui/components.ts`
2. `runSnapshotReorderDrag` → `ui/events.ts`
3. `getExistingCharacterCardsSafe` → `services/placeholder.ts`
4. `getInputBox` → `utils/dom.ts` **修复方式**: 从 `index.ts.original` 提取相应函数实现 **工作量**: 约1小时

**分配给**: Agent 3 (UI组件) 和 Agent 4 (服务层) 分工

---

### 任务8: 添加缺失的占位符/世界书函数

**严重度**: 🟡 高 **文件**: `src/快速回复管理器/services/placeholder.ts` **缺失函数**:

1. `getCurrentCharacterBoundWorldbookNames()` - 获取角色绑定的世界书
2. `getAllWorldbookNamesSafe()` - 获取所有世界书名称
3. `getExistingCharacterCardsSafe()` - 获取所有存在的角色卡（已在任务7）
4. `extractPlaceholderFallbackMap()` - 提取占位符默认值
   **修复方式**: 添加这些函数的实现（可从原始文件提取或根据已有逻辑实现） **工作量**: 约1小时

**分配给**: Agent 4 (服务层)

---

### 任务9: 实现导入选择界面和冲突处理界面

**严重度**: 🟡 高 **文件**: `src/快速回复管理器/index.ts` **问题**: 当前导入直接替换整个Pack，没有冲突检测 **原始功能**:
`openImportSelectionModal()` - 选择要导入的分类和条目 **原始功能**: 冲突处理模态框 - 逐条选择跳过/覆盖/重命名
**工作量**: 约3小时

**分配给**: Agent 5 (高级功能)

---

### 任务10: 修复 features/items.ts 中的6个问题

**严重度**: 🟡 高 **文件**: `src/快速回复管理器/features/items.ts` **问题列表**:

1. `runItem()` 缺少 `pushPreviewToken` 调用
2. `runItem()` 缺少 `syncActiveCharacterMapping` 调用
3. `addConnector()` 缺少 `pushPreviewToken` 调用
4. 占位符解析正则表达式错误（已部分修复）
5. `appendToInputBox()` 缺少 `suspendInputSync` 控制
6. 右键菜单缺少"执行"选项 **工作量**: 约1小时

**分配给**: Agent 2 (条目功能)

---

## 🟢 P2 - 计划修复（功能缺失但可用）- 15项

### 任务11-15: UI模态框完整实现

- 条目编辑模态框 (`showEditItemModal`)
- 导入/导出模态框
- Compact模式"更多菜单"
- 设置模态框完整功能
- 导出JSON预览界面

### 任务16-20: 拖拽功能增强

- 分类自动展开 (`scheduleTreeAutoExpand`)
- 条目跨分类拖拽
- QR预设段落拖拽
- 自动滚动支持
- 磁滞效应

### 任务21-25: 全局事件和调试

- 增强按钮注册兼容性
- 全局错误捕获 (`attachGlobalDebugHooks`)
- 存储损坏检测
- 按钮事件清理
- 定时角色同步优化

### 任务26-27: 其他

- 角色映射冲突检测函数
- 其他次要功能完善

---

## 执行建议

### 第一批（P0）- 立即执行

**目标**: 让基本功能可用 **任务**: 1-4 **时间**: 2-3小时 **顺序**:

1. 先修复条目点击执行（任务1）
2. 添加连接符事件绑定（任务2）
3. 添加热重载和角色监听（任务3-4）
4. 立即运行测试验证

### 第二批（P1核心）- 次日执行

**目标**: 恢复核心体验 **任务**: 5-10 **时间**: 4-6小时 **重点**:

- 拖拽功能（任务5-6）- 工作量最大
- 设置面板函数（任务7）
- 占位符/世界书函数（任务8）

### 第三批（P1剩余 + P2）- 后续迭代

**目标**: 完善体验 **任务**: 11-27 **时间**: 4-6小时 **可以延后**: 如果P0和P1完成后产品已可用，P2可逐步迭代

---

## 验证清单

每个任务完成后需要验证：

- [ ] `pnpm lint` 无错误
- [ ] `pnpm build` 成功
- [ ] 功能在浏览器中实际可用
- [ ] 不引入新的regression

---

## 风险提醒

1. **拖拽功能复杂度高**: 原始版本使用Pointer Events系统，移植需要仔细测试
2. **事件绑定容易遗漏**: 需要全面检查所有按钮和交互元素的事件绑定
3. **数据兼容性**: 修改存储相关代码时注意向后兼容

---

**建议**: 先执行P0级别的4个任务，验证基本功能可用后再继续P1。

---

## 并行子代理执行命令参考

### Wave 1 - 立即启动（4个并行代理）

```typescript
// Agent 1: 核心修复 (index.ts的P0问题)
task(
  (subagent_type = 'quick'),
  (load_skills = ['frontend-ui-ux']),
  (prompt = `修复快速回复管理器index.ts的4个P0级别问题：
1. 修复条目点击执行逻辑（行501-513）- 改为调用insertQrContent
2. 添加连接符按钮事件绑定（在bindPanelEvents中）
3. 添加热重载机制（RUNTIME_KEY）
4. 恢复角色切换监听（CHAT_CHANGED, CHARACTER_PAGE_LOADED）

参考文件：
- src/快速回复管理器/index.ts.original (9728行) - 查找相关实现
- src/快速回复管理器/index.ts (3413行) - 修复目标
- src/快速回复管理器/constants.ts - 添加RUNTIME_KEY

每个修复后运行pnpm lint检查。完成后报告修复了哪些问题。`),
);

// Agent 2: 条目功能修复 (features/items.ts)
task(
  (subagent_type = 'quick'),
  (load_skills = ['frontend-ui-ux']),
  (prompt = `修复快速回复管理器features/items.ts的6个问题：
1. runItem()添加pushPreviewToken调用
2. runItem()添加handleActiveCharacterContextChanged调用
3. addConnector()添加pushPreviewToken调用
4. 修复占位符解析正则表达式（支持{@key}无默认值格式）
5. appendToInputBox()添加suspendInputSync控制
6. 在ui/events.ts右键菜单中添加"执行"选项

需要的导入：
- import { addPreviewToken } from '../ui/preview'
- import { handleActiveCharacterContextChanged } from '../services/placeholder'

修复后运行pnpm lint和pnpm build验证。`),
);

// Agent 3: UI组件修复 (ui/components.ts, ui/events.ts)
task(
  (subagent_type = 'quick'),
  (load_skills = ['frontend-ui-ux']),
  (prompt = `修复快速回复管理器UI组件层的问题：
1. 在ui/components.ts添加createCircularColorPicker函数
   - 从index.ts.original:4982提取实现
2. 在ui/events.ts添加缺失函数：
   - runSnapshotReorderDrag（从index.ts.original:3971提取）
   - 其他拖拽相关辅助函数
3. 修复events.ts中的未使用导入清理

参考：src/快速回复管理器/index.ts.original

修复后运行pnpm lint验证。`),
);

// Agent 4: 服务层修复 (services/placeholder.ts, utils/dom.ts)
task(
  (subagent_type = 'quick'),
  (load_skills = ['frontend-ui-ux']),
  (prompt = `修复快速回复管理器服务层和工具层的问题：

services/placeholder.ts添加：
1. getCurrentCharacterBoundWorldbookNames() - 获取角色绑定的世界书
2. getAllWorldbookNamesSafe() - 获取所有世界书名称  
3. getExistingCharacterCardsSafe() - 获取所有存在的角色卡
4. extractPlaceholderFallbackMap() - 提取占位符默认值

utils/dom.ts添加：
1. getInputBox() - 获取酒馆输入框元素

可以从src/快速回复管理器/index.ts.original中提取这些函数的实现。

修复后运行pnpm lint验证。`),
);
```

### Wave 2 - Wave 1完成后启动（1个高级代理）

```typescript
// Agent 5: 高级功能实现（等待Wave 1完成后）
task(
  (subagent_type = 'unspecified-high'),
  (load_skills = ['frontend-ui-ux']),
  (prompt = `实现快速回复管理器的高级功能（需要等待基础修复完成）：

1. 在ui/workbench.ts实现分类树拖拽排序：
   - 从index.ts.original:4311-4419提取attachPointerCategoryDropDrag
   - 实现Pointer Events拖拽系统

2. 在ui/workbench.ts实现条目卡片拖拽排序：
   - 从index.ts.original:4421-4494提取runSnapshotReorderDrag
   - 实现快照系统和占位符

3. 在index.ts实现导入选择界面和冲突处理：
   - 从index.ts.original提取openImportSelectionModal
   - 实现冲突检测和处理UI

4. 在ui/events.ts添加分类自动展开功能

5. 实现其他P2级别的UI模态框

这些功能依赖Wave 1的基础修复，请确保基础功能已正常工作。

完成后运行pnpm build验证。`),
);
```

### 执行顺序

1. **启动Wave 1** - 同时启动4个代理（Agent 1-4）
2. **等待Wave 1完成** - 收集结果，修复任何冲突
3. **启动Wave 2** - 启动Agent 5实现高级功能
4. **最终验证** - 运行完整测试套件

### 预计时间

- Wave 1: 1-1.5小时（4个代理并行）
- Wave 2: 2小时（1个代理）
- 验证整合：0.5小时
- **总计：3-4小时**（vs 顺序执行的10-15小时）
