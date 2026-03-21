# 快速回复管理器全面测试计划（基于8个子代理完整分析）

## 文档信息

- **创建日期**: 2026-03-21
- **计划版本**: v2.0（基于完整子代理分析）
- **测试工具**: Playwright MCP + TypeScript
- **目标**: 验证重构后的快速回复管理器功能完整性
- **分析基础**: 8个子代理全面分析结果

---

## 1. 执行摘要

本测试计划基于**8个子代理的完整分析**（原始脚本功能提取、重构后代码结构、UI交互细节、数据流分析、Playwright策略、Bug识别、异常场景），旨在通过系统化测试确保重构后的快速回复管理器达到生产就绪状态。

### 关键发现（来自8个子代理分析）

| 分析维度     | 发现                            | 影响           |
| ------------ | ------------------------------- | -------------- |
| **原始脚本** | 83个功能点                      | 测试覆盖基准   |
| **代码结构** | 95%功能完整，7个高风险Bug       | 需先修复再测试 |
| **UI交互**   | 11类按钮、6种模态框、3类拖拽    | 交互测试重点   |
| **数据流**   | 双存储策略、20+操作函数         | 数据一致性核心 |
| **Bug识别**  | 7个高风险、3个中风险、2个低风险 | 修复优先级     |
| **异常场景** | 19个预期错误消息                | 错误处理验证   |

---

## 2. 测试范围

### 2.1 包含范围（IN SCOPE）

#### P0 - 核心功能（必须100%覆盖）- 11个功能点

| 模块           | 功能点数量 | 风险等级             |
| -------------- | ---------- | -------------------- |
| 脚本初始化     | 1          | 极高（无法使用）     |
| 工作台生命周期 | 2          | 极高（无法使用）     |
| 数据持久化     | 4          | 极高（数据丢失）     |
| 分类CRUD       | 2          | 极高（核心功能失效） |
| 条目CRUD       | 2          | 极高（核心功能失效） |

#### P1 - 重要功能（建议90%覆盖）- 10个功能点

| 模块       | 功能点数量 | 风险等级           |
| ---------- | ---------- | ------------------ |
| 导入导出   | 2          | 高（数据迁移失败） |
| 拖拽排序   | 2          | 高（用户体验差）   |
| 占位符系统 | 2          | 高（内容解析错误） |
| 搜索过滤   | 1          | 高（功能不可用）   |
| 收藏功能   | 1          | 高（功能不可用）   |
| 响应式布局 | 2          | 高（移动端不可用） |

#### P2 - 次要功能（建议70%覆盖）- 11个功能点

| 模块       | 功能点数量 | 风险等级           |
| ---------- | ---------- | ------------------ |
| 连接符系统 | 2          | 中（便利功能失效） |
| 预览令牌流 | 3          | 中（预览功能失效） |
| 主题系统   | 2          | 低（外观问题）     |
| 右键菜单   | 2          | 中（便利功能失效） |
| 键盘快捷键 | 2          | 中（便利功能失效） |

#### P3 - 可选功能（建议50%覆盖）- 10个功能点

| 模块          | 功能点数量 | 风险等级       |
| ------------- | ---------- | -------------- |
| LLM集成       | 5          | 低（可选功能） |
| 调试功能      | 2          | 低（调试困难） |
| 世界书集成    | 1          | 低（映射来源） |
| 数据备份/恢复 | 2          | 低（数据安全） |

### 2.2 排除范围（OUT OF SCOPE）

- 性能压力测试（大数据量下的响应时间）- 单独计划
- 跨浏览器兼容性测试（仅测试 Chromium）
- 安全性测试（XSS、CSRF等）
- 移动端触摸手势测试（仅测试桌面端基础功能）

---

## 3. 前置条件

### 3.1 必须修复的高风险Bug（测试前完成）

根据子代理7（Bug分析），以下7个高风险问题必须在测试前修复：

| Bug                                 | 位置              | 风险           | 修复方案                     |
| ----------------------------------- | ----------------- | -------------- | ---------------------------- |
| `invalidateEditGeneration` 调用缺失 | index.ts          | 生成状态不一致 | 在角色切换、关闭编辑框时调用 |
| 面板点击事件重复绑定                | index.ts:629-648  | 多次触发       | 优化bindPanelEvents逻辑      |
| `unbindWorkbenchEvents` 解绑不完全  | events.ts:708-737 | 内存泄漏       | 修复键解析逻辑               |
| `persistPack` 竞态条件              | store.ts:279-290  | 数据丢失       | 使用原子操作或锁             |
| `state.pack` 空值未检查             | index.ts多处      | 空引用异常     | 添加前置条件检查             |
| `fetchQrLlmModels` 错误信息丢失     | llm.ts:800-856    | 诊断困难       | 返回所有错误信息             |
| `callQrLlmGenerate` 流式错误静默    | llm.ts:883-1137   | 空白输出       | 添加错误提示                 |

### 3.2 测试环境要求

```yaml
Node.js: '>= 18'
Playwright: '>= 1.40'
Tavern助手: 运行中 (http://127.0.0.1:8000)
Live Server: 运行中 (http://127.0.0.1:5500)
构建状态: pnpm build 成功
Lint状态: pnpm lint 无错误
```

---

## 4. 测试架构

### 4.1 Page Object Model 结构

```
tests/
├── e2e/
│   ├── 00-setup.spec.ts           # 环境检查
│   ├── 01-core-p0.spec.ts         # P0核心功能
│   ├── 02-data-p1.spec.ts         # P1数据操作
│   ├── 03-ui-p1-p2.spec.ts        # P1-P2 UI交互
│   ├── 04-llm-p3.spec.ts          # P3 LLM功能
│   ├── 05-exception.spec.ts       # 异常场景
│   └── 06-regression.spec.ts      # 回归测试
├── pages/
│   ├── base.page.ts               # 基础页面对象
│   ├── qr-manager.page.ts         # 快速回复管理器页面
│   ├── settings.page.ts           # 设置页面
│   └── modal.page.ts              # 模态框页面
├── components/
│   ├── tree.component.ts          # 树形组件
│   ├── card.component.ts          # 卡片组件
│   └── drag.component.ts          # 拖拽组件
├── fixtures/
│   ├── base.fixture.ts            # 扩展基础测试
│   ├── storage.fixture.ts         # 存储状态管理
│   └── test-data.ts               # 测试数据
├── utils/
│   ├── screenshot.ts              # 截图工具
│   └── validators.ts              # 验证工具
└── mocks/
    ├── tavern-api.mock.ts         # Tavern API Mock
    └── llm-api.mock.ts            # LLM API Mock
```

### 4.2 Fixtures 设计

```typescript
// tests/fixtures/base.fixture.ts
import { test as base, expect } from '@playwright/test';
import { QRManagerPage } from '../pages/qr-manager.page';

export const test = base.extend<{
  qrManagerPage: QRManagerPage;
  tavernContext: TavernContext;
}>({
  qrManagerPage: async ({ page }, use) => {
    await use(new QRManagerPage(page));
  },

  tavernContext: async ({ page }, use) => {
    await use({
      getVariables: async () => {
        return await page.evaluate(() => {
          const pW = window.parent as any;
          return pW.getVariables?.({ type: 'script' }) || {};
        });
      },
      setVariables: async data => {
        await page.evaluate(d => {
          const pW = window.parent as any;
          pW.insertOrAssignVariables?.(d, { type: 'script' });
        }, data);
      },
    });
  },
});

export { expect };
```

---

## 5. 测试执行策略

### 5.1 6阶段执行顺序

```
阶段1: 环境检查
├── 1.1 Tavern助手接口可用性
├── 1.2 宿主窗口访问检查
├── 1.3 存储空间可用性
└── 1.4 依赖库检查 (jQuery, toastr)

阶段2: 核心功能测试 (P0) - 第1周
├── 2.1 初始化流程测试
├── 2.2 数据加载/保存测试
├── 2.3 分类管理测试
├── 2.4 条目管理测试
└── 2.5 条目执行测试

阶段3: 数据操作测试 (P1) - 第1-2周
├── 3.1 导入功能测试
├── 3.2 导出功能测试
├── 3.3 占位符解析测试
└── 3.4 搜索过滤测试

阶段4: UI交互测试 (P1-P2) - 第2周
├── 4.1 渲染测试
├── 4.2 拖拽交互测试
├── 4.3 响应式测试
└── 4.4 设置面板测试

阶段5: 集成测试 (P3) - 第2周
├── 5.1 LLM服务测试
├── 5.2 世界书集成测试
└── 5.3 主题系统测试

阶段6: 边界条件测试 - 第2周末
├── 6.1 大数据量测试
├── 6.2 特殊字符处理
├── 6.3 并发操作测试
└── 6.4 错误恢复测试
```

### 5.2 时间表（2周迭代）

| 时间          | 任务                  | 产出           |
| ------------- | --------------------- | -------------- |
| **第1天**     | 修复7个高风险Bug      | Bug修复PR      |
| **第2天**     | 搭建测试框架          | tests/目录结构 |
| **第3-4天**   | 阶段2：P0核心功能测试 | 11个测试用例   |
| **第5天**     | P0测试执行+Bug修复    | P0测试报告     |
| **第6-7天**   | 阶段3：P1数据操作测试 | 10个测试用例   |
| **第8天**     | P1测试执行            | P1测试报告     |
| **第9-10天**  | 阶段4：UI交互测试     | 11个测试用例   |
| **第11天**    | P2测试执行            | P2测试报告     |
| **第12-13天** | 阶段5-6：P3+边界测试  | 12个测试用例   |
| **第14天**    | 最终验证+文档         | 完整测试报告   |

---

## 6. 功能清单与测试用例

### 6.1 P0 - 核心功能（必须100%覆盖）- 11个测试用例

#### TC-P0-001: 脚本初始化

**前置条件**: 清除所有存储数据，首次加载脚本

**测试步骤**:

1. 清除 localStorage 和脚本变量
2. 刷新页面加载脚本
3. 检查初始化日志

**预期结果**:

- [ ] 检测到无存储数据，创建默认Pack
- [ ] 默认分类和条目存在
- [ ] 控制台无错误
- [ ] 酒馆界面显示"💌快速回复管理器"按钮

**验证点**:

```javascript
const vars = await getVariables({ type: 'script' });
expect(vars.fastPlotQRPack).toBeDefined();
expect(vars.fastPlotQRPack.categories.length).toBeGreaterThan(0);
```

---

#### TC-P0-002: 工作台打开

**前置条件**: 脚本已初始化，按钮可见

**测试步骤**:

1. 点击酒馆界面"💌快速回复管理器"按钮
2. 等待工作台渲染完成
3. 截图保存初始状态

**预期结果**:

- [ ] 工作台 overlay 正常显示 (`#fast-plot-workbench-overlay-v1`)
- [ ] 顶部工具栏包含所有按钮（返回、连接符、新分类、新增条目、导出、导入、设置、关闭）
- [ ] 侧边栏显示分类树
- [ ] 主内容区显示条目卡片
- [ ] 控制台无错误

**验证点**:

```javascript
const overlay = document.getElementById('fast-plot-workbench-overlay-v1');
expect(overlay).toBeTruthy();
expect(overlay.style.display).not.toBe('none');
const buttons = overlay.querySelectorAll('.fp-top .fp-btn');
expect(buttons.length).toBeGreaterThanOrEqual(8);
```

---

#### TC-P0-003: 工作台关闭

**前置条件**: 工作台已打开

**测试步骤**:

1. 点击右上角关闭按钮 (`[data-close]`)
2. 等待动画完成
3. 验证工作台已关闭

**预期结果**:

- [ ] 工作台 overlay 从 DOM 中移除或隐藏
- [ ] 事件监听器正确清理
- [ ] 控制台无错误

**验证点**:

```javascript
const overlay = document.getElementById('fast-plot-workbench-overlay-v1');
expect(overlay).toBeFalsy(); // 或检查 visibility
```

---

#### TC-P0-004: 数据加载（loadPack）

**前置条件**: 已创建测试数据

**测试步骤**:

1. 注入测试数据到存储
2. 刷新页面
3. 验证数据加载

**预期结果**:

- [ ] 测试数据正确加载
- [ ] 分类和条目显示正确
- [ ] 时间戳正确解析

**验证点**:

```javascript
const pack = await page.evaluate(() => state.pack);
expect(pack.categories).toHaveLength(2);
expect(pack.items).toHaveLength(3);
```

---

#### TC-P0-005: 数据保存（persistPack）

**前置条件**: 工作台已打开

**测试步骤**:

1. 创建新分类
2. 等待260ms防抖时间
3. 验证数据已保存

**预期结果**:

- [ ] 数据保存到脚本变量
- [ ] 数据保存到 localStorage 备份
- [ ] 时间戳更新

**验证点**:

```javascript
const localData = await page.evaluate(() => localStorage.getItem('__fastPlotQRPack__'));
expect(localData).toContain('新分类');
```

---

#### TC-P0-006: 双存储一致性

**前置条件**: 工作台已打开

**测试步骤**:

1. 修改数据（创建条目）
2. 等待保存
3. 验证两种存储内容一致

**预期结果**:

- [ ] 脚本变量和 localStorage 内容一致
- [ ] 更新时间戳相同

**验证点**:

```javascript
const scriptVar = await getVariables({ type: 'script' });
const localData = JSON.parse(localStorage.getItem('__fastPlotQRPack__'));
expect(scriptVar.fastPlotQRPack.meta.updatedAt).toBe(localData.meta.updatedAt);
```

---

#### TC-P0-007: 防抖持久化

**前置条件**: 工作台已打开

**测试步骤**:

1. 连续快速创建3个分类（间隔<100ms）
2. 验证只保存一次

**预期结果**:

- [ ] 只触发一次保存操作
- [ ] 最终数据包含所有3个分类

**验证点**:

```javascript
// 监听保存调用次数
let saveCount = 0;
page.on('console', msg => {
  if (msg.text().includes('persistPack')) saveCount++;
});
// 执行快速操作后验证
expect(saveCount).toBe(1);
```

---

#### TC-P0-008: 分类创建

**前置条件**: 工作台已打开

**测试步骤**:

1. 点击"新分类"按钮
2. 输入分类名称"测试分类"
3. 确认创建

**预期结果**:

- [ ] 新分类显示在分类树中
- [ ] order字段自动分配
- [ ] 数据持久化成功

**验证点**:

```javascript
const pack = await page.evaluate(() => state.pack);
expect(pack.categories).toContainEqual(expect.objectContaining({ name: '测试分类' }));
```

---

#### TC-P0-009: 分类删除

**前置条件**: 存在可删除的分类

**测试步骤**:

1. 右键点击分类
2. 选择"删除"
3. 确认删除

**预期结果**:

- [ ] 分类从列表移除
- [ ] 关联条目处理正确（迁移或删除）
- [ ] 数据更新

**验证点**:

```javascript
const pack = await page.evaluate(() => state.pack);
expect(pack.categories.find(c => c.name === '被删分类')).toBeUndefined();
```

---

#### TC-P0-010: 条目创建

**前置条件**: 存在分类

**测试步骤**:

1. 点击"新增条目"按钮
2. 填写名称和内容
3. 保存

**预期结果**:

- [ ] 条目显示在主内容区
- [ ] 数据保存成功
- [ ] order字段正确

**验证点**:

```javascript
const pack = await page.evaluate(() => state.pack);
expect(pack.items).toContainEqual(expect.objectContaining({ name: '测试条目' }));
```

---

#### TC-P0-011: 条目执行（追加模式）

**前置条件**: 存在条目

**测试步骤**:

1. 点击条目卡片
2. 验证内容插入酒馆输入框

**预期结果**:

- [ ] 内容正确插入输入框
- [ ] 占位符正确解析
- [ ] 连接符正确插入

**验证点**:

```javascript
const inputValue = await page.evaluate(() => {
  const input = document.querySelector('#send_textarea');
  return input?.value || '';
});
expect(inputValue).toContain('条目内容');
```

---

### 6.2 P1 - 重要功能（建议90%覆盖）- 10个测试用例

#### TC-P1-001: 导入JSON

**前置条件**: 准备有效JSON文件

**测试步骤**:

1. 点击"导入"按钮
2. 选择JSON文件
3. 确认导入

**预期结果**:

- [ ] 文件解析成功
- [ ] 数据正确合并
- [ ] 导入成功提示

**验证点**:

```javascript
const pack = await page.evaluate(() => state.pack);
expect(pack.items.length).toBeGreaterThan(导入前数量);
```

---

#### TC-P1-002: 导出JSON

**前置条件**: 存在数据

**测试步骤**:

1. 点击"导出"按钮
2. 等待文件下载

**预期结果**:

- [ ] 文件下载触发
- [ ] JSON格式正确
- [ ] 包含完整数据

**验证点**:

```javascript
const download = await downloadPromise;
expect(download.suggestedFilename()).toMatch(/\.json$/);
```

---

#### TC-P1-003: 旧版QR格式转换

**前置条件**: 准备旧版QR格式文件

**测试步骤**:

1. 导入旧版格式文件
2. 验证自动转换

**预期结果**:

- [ ] 自动检测旧格式
- [ ] 数据正确迁移
- [ ] 结构完整

**验证点**:

```javascript
// 验证转换后的数据结构
const pack = await page.evaluate(() => state.pack);
expect(pack.version).toBe(1);
```

---

#### TC-P1-004: 分类拖拽排序

**前置条件**: 存在多个分类

**测试步骤**:

1. 拖拽分类A到分类B上方
2. 释放

**预期结果**:

- [ ] 视觉反馈正确（drop-before类）
- [ ] 排序更新
- [ ] order字段重新计算

**验证点**:

```javascript
// 拖拽后验证顺序
const categories = await page.evaluate(() => state.pack.categories);
expect(categories[0].name).toBe('分类B');
```

---

#### TC-P1-005: 条目拖拽排序

**前置条件**: 同一分类下多个条目

**测试步骤**:

1. 拖拽条目A到条目B前
2. 释放

**预期结果**:

- [ ] 条目顺序更新
- [ ] order字段更新

**验证点**:

```javascript
const items = await page.evaluate(() => state.pack.items.filter(i => i.categoryId === 'cat-1'));
expect(items[0].name).toBe('条目A');
```

---

#### TC-P1-006: 占位符解析

**前置条件**: 存在含占位符的条目

**测试步骤**:

1. 创建含占位符条目："你好{@角色名}"
2. 执行条目

**预期结果**:

- [ ] 占位符正确解析
- [ ] 插入解析后的内容

**验证点**:

```javascript
const inputValue = await page.evaluate(() => {
  return document.querySelector('#send_textarea')?.value;
});
expect(inputValue).not.toContain('{@角色名}');
expect(inputValue).toContain('实际角色名');
```

---

#### TC-P1-007: 角色切换检测

**前置条件**: 多角色环境

**测试步骤**:

1. 切换角色卡
2. 验证占位符映射更新

**预期结果**:

- [ ] 检测到角色切换
- [ ] 占位符映射重新加载

**验证点**:

```javascript
// 验证角色ID更新
const charId = await page.evaluate(() => state.activeCharacterId);
expect(charId).toBe('新角色ID');
```

---

#### TC-P1-008: 搜索过滤

**前置条件**: 存在多个条目

**测试步骤**:

1. 在搜索框输入关键词
2. 验证过滤结果

**预期结果**:

- [ ] 实时过滤
- [ ] 高亮匹配项
- [ ] 空结果提示

**验证点**:

```javascript
const visibleCards = await page.locator('.fp-card:visible').count();
expect(visibleCards).toBeLessThan(总条目数);
```

---

#### TC-P1-009: 收藏功能

**前置条件**: 存在条目

**测试步骤**:

1. 点击条目收藏按钮
2. 验证收藏状态

**预期结果**:

- [ ] 收藏状态切换
- [ ] 显示在收藏夹
- [ ] 数据同步

**验证点**:

```javascript
const pack = await page.evaluate(() => state.pack);
expect(pack.favorites).toContain('item-id');
```

---

#### TC-P1-010: 响应式布局切换

**前置条件**: 工作台已打开

**测试步骤**:

1. 调整窗口宽度到<760px
2. 验证布局切换

**预期结果**:

- [ ] 切换到紧凑模式
- [ ] 功能正常可用

**验证点**:

```javascript
await page.setViewportSize({ width: 700, height: 600 });
const isCompact = await page.locator('.fp-compact').isVisible();
expect(isCompact).toBe(true);
```

---

### 6.3 P2 - 次要功能（建议70%覆盖）- 11个测试用例

#### TC-P2-001 ~ TC-P2-011: [P2功能测试用例]

[连接符系统、预览令牌流、主题系统、右键菜单、键盘快捷键等功能]

---

### 6.4 P3 - 可选功能（建议50%覆盖）- 10个测试用例

#### TC-P3-001 ~ TC-P3-010: [P3功能测试用例]

[LLM集成、调试功能、世界书集成等功能]

---

## 7. 异常场景测试

### 7.1 必须测试的异常场景

根据子代理8（异常场景分析），以下场景必须包含在测试中：

#### 数据异常（5个场景）

- 损坏的localStorage数据 → 优雅降级到默认
- 空数据（首次使用） → 自动创建默认数据
- 过期数据格式 → 自动迁移
- 超大数据（>1MB条目） → 正常处理
- 并发数据写入 → 冲突检测

#### 网络异常（3个场景）

- API URL无效 → 错误提示
- 请求超时（>20s） → 中止并清理
- 网络断开 → 错误恢复

#### 用户操作异常（4个场景）

- 快速重复点击 → 防抖生效
- 未完成操作关闭 → 自动保存/提示
- 非法输入 → 验证拒绝
- 文件选择取消 → 无错误

#### 环境异常（4个场景）

- 脚本重复加载 → 跳过初始化
- 内存不足 → 自动截断
- iframe卸载 → 清理资源
- 浏览器不兼容 → 降级处理

#### 并发异常（3个场景）

- 同时多操作 → 排队处理
- 数据竞争 → 时间戳检测
- 状态不一致 → 自动修复

---

## 8. 成功标准

### 8.1 通过率要求

| 优先级 | 测试数量 | 通过率要求 |
| ------ | -------- | ---------- |
| P0     | 11       | 100%       |
| P1     | 10       | 90%        |
| P2     | 11       | 70%        |
| P3     | 10       | 50%        |

### 8.2 质量指标

- 控制台错误：0个
- 未捕获异常：0个
- 内存泄漏：无
- 数据丢失：无

### 8.3 文档产出

- [ ] 测试报告（含截图）
- [ ] Bug清单（含修复状态）
- [ ] 覆盖率报告
- [ ] 性能数据

---

## 9. 风险与缓解

| 风险                    | 概率 | 影响 | 缓解措施                    |
| ----------------------- | ---- | ---- | --------------------------- |
| 高风险Bug修复引入新问题 | 中   | 高   | 每修复一个Bug就进行回归测试 |
| iframe环境测试不稳定    | 中   | 中   | 增加重试机制和等待时间      |
| 测试数据准备耗时        | 中   | 中   | 使用Fixtures自动化数据准备  |
| LLM测试依赖外部API      | 高   | 低   | 使用Mock和离线模式测试      |

---

## 10. 附录

### 10.1 参考文档

- Playwright官方文档: https://playwright.dev
- 8个子代理分析报告: .sisyphus/drafts/
- 原始脚本分析: src/快速回复管理器/index.ts.original
- 重构后架构: src/快速回复管理器/

### 10.2 关键选择器速查

```javascript
// 主容器
'#fast-plot-workbench-overlay-v1';

// 按钮
('[data-close]', '[data-import]', '[data-export]', '[data-settings]');
('[data-new-cat]', '[data-new-item]', '[data-back]');

// 分类和条目
('[data-cat-id]', '[data-item-id]');

// 搜索
('.fp-side-search-input');

// 预览
('[data-clear-preview]', '[data-toggle-preview]');
```

### 10.3 预期错误消息清单

| 场景            | 预期错误消息        |
| --------------- | ------------------- |
| API URL为空     | "请先填写API URL"   |
| API URL格式错误 | "API URL格式不合法" |
| 数据未初始化    | "数据未初始化"      |
| 模型ID未配置    | "模型ID未配置"      |
| 复制失败        | "copy_failed"       |
| 没有可导出数据  | "没有可导出的数据"  |

---

_本计划基于8个子代理的全面分析生成，包含原始脚本功能清单（83个功能点）、重构后代码结构、UI交互细节、数据流分析、Playwright测试模式、Bug识别和异常场景识别。_

(End of skeleton - total XXX lines)
