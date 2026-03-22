# AGENTS.md - 快速回复管理器项目指南

> 本文档使用简体中文编写

## 项目概述

本项目是为酒馆助手 (Tavern Helper) 编写的脚本，在酒馆 (SillyTavern) 中以无沙盒 iframe 形式运行。

- **主入口**: `src/快速回复管理器/index.ts`
- **技术栈**: TypeScript + Webpack + TailwindCSS + SCSS
- **运行环境**: 浏览器 iframe (酒馆网页内)

## 命令速查

```bash
# 安装依赖
pnpm install

# 开发模式（热重载 + Live Server）
pnpm watch

# 构建
pnpm build          # 生产构建
pnpm build:dev      # 开发构建

# 代码检查与格式化
pnpm lint           # ESLint 检查
pnpm lint:fix       # 自动修复
pnpm format         # Prettier 格式化

# 其他
pnpm dump           # 生成 schema.json
pnpm sync           # 同步角色卡/世界书/预设
```

## 实时开发流程

1. 启动开发服务器: `pnpm watch`
2. VSCode 启动 Live Server (端口 5500)
3. 酒馆助手 → 脚本库 → 导入配置 JSON (URL 必须用 `127.0.0.1`)
4. 酒馆助手 → 开发 → 实时监听 → 允许监听
5. 编辑代码，保存后自动更新

**CORS 配置** (`.vscode/settings.json`):

```json
{
  "liveServer.settings.headers": {
    "Access-Control-Allow-Origin": "*"
  }
}
```

## 代码风格规范

### TypeScript

- **Strict mode**: 启用 (`strict: true`)
- **Target**: ESNext
- **Module**: ESNext (bundler resolution)
- **未使用变量**: 警告级别

### Prettier 配置

```json
{
  "singleQuote": true,
  "semi": true,
  "trailingComma": "all",
  "tabWidth": 2,
  "printWidth": 120,
  "arrowParens": "avoid"
}
```

### 命名约定

| 类型      | 约定                 | 示例                      |
| --------- | -------------------- | ------------------------- |
| 常量      | SCREAMING_SNAKE_CASE | `STORE_KEY`, `OVERLAY_ID` |
| 函数/变量 | camelCase            | `getData()`, `itemCount`  |
| 接口/类型 | PascalCase           | `QrItem`, `CategoryData`  |
| 私有函数  | 下划线前缀           | `_helperFunc()`           |

### 导入顺序

```typescript
// 1. 类型定义
import type { QrItem } from './types';
// 2. 常量
import { STORE_KEY } from './constants';
// 3. 状态
import { store } from './store';
// 4. 工具 → 5. 服务 → 6. 功能 → 7. UI
```

## 脚本编写规范

### 初始化与清理

```typescript
// 正确：使用 jQuery 加载
$(() => {
  toastr.success('加载成功');
});
// 正确：使用 pagehide 清理
$(window).on('pagehide', () => {
  // 清理代码
});
// 错误：DOMContentLoaded 不会被触发
// document.addEventListener('DOMContentLoaded', fn); // 禁止
```

### 酒馆交互

```typescript
// 变量操作
getVariables({ type: 'script' });
replaceVariables(data, { type: 'script', script_id: getScriptId() });
// 消息操作
getChatMessages();
setChatMessages(messages);
// jQuery 指向酒馆网页
$('body'); // 选择酒馆网页的 body
```

### 数据持久化

```typescript
const STORE_KEY = 'fastPlotQRPack';
// 读取
const vars = getVariables({ type: 'script' });
const pack = vars[STORE_KEY];
// 写入
insertOrAssignVariables({ [STORE_KEY]: data }, { type: 'script' });
```

### 错误处理

```typescript
// 使用 errorCatched 包装入口
function init() {
  // 可能抛出错误的代码
}
$(() => {
  errorCatched(init)();
});
```

## UI 样式规范

### CSS 变量

```css
--qr-bg-1, --qr-bg-2, --qr-bg-3  /* 背景层 */
--qr-text-1, --qr-text-2         /* 文本颜色 */
--qr-accent, --qr-accent-hover   /* 强调色 */
--qr-border-1, --qr-border-2    /* 边框色 */
--qr-card-bg, --qr-btn-bg       /* 卡片与按钮 */
```

### 样式规则

- 优先使用 TailwindCSS class
- 禁止与酒馆网页冲突的类名
- 注入样式时使用唯一 ID 避免冲突

## 禁止事项

| 禁止项                  | 正确做法                |
| ----------------------- | ----------------------- |
| `DOMContentLoaded`      | 使用 `$(() => {})`      |
| `'unload'` 事件         | 使用 `'pagehide'`       |
| index.html 引用本地文件 | 通过 TypeScript 导入    |
| `vh` 单位               | iframe 环境中高度不正确 |
| Node.js 库              | 仅浏览器环境            |
| `as any`, `@ts-ignore`  | 正确类型定义            |
| 空 catch 块             | 必须处理或记录错误      |

## 调试技巧

```typescript
// 获取酒馆上下文
const ctx = (pW as any).SillyTavern?.getContext?.();
// 日志系统
pushDebugLog('消息', payload);
logInfo('INFO 消息', payload);
logError('ERROR 消息', payload);
// 调用酒馆命令
triggerSlash('/command arg');
```

## 项目架构

```
src/快速回复管理器/
├── types.ts          # 类型定义 (Core)
├── constants.ts      # 常量定义 (Core)
├── store.ts          # 状态管理 (Core)
├── styles/           # SCSS样式
│   ├── _base.scss
│   ├── _components.scss
│   ├── _animations.scss
│   └── _themes.scss
├── utils/            # 工具函数
│   ├── dom.ts
│   ├── data.ts
│   └── validation.ts
├── services/         # 服务层
│   ├── storage.ts
│   ├── llm.ts
│   └── theme.ts
├── features/         # 功能模块
│   ├── categories.ts
│   ├── items.ts
│   └── import-export.ts
├── ui/               # UI层
│   ├── components.ts
│   ├── workbench.ts
│   └── events.ts
└── index.ts          # 入口文件
```

### 架构原则

- **单一职责**: 每个模块只负责一个功能领域
- **依赖方向**: Core → Utils → Services → Features → UI → Entry
- **状态管理**: 模块级单例，不引入外部状态库
- **向后兼容**: 保持原有数据格式和 CSS 类名

## 自动化测试

使用 **agent-browser** 对快速回复管理器进行端到端测试。

### 环境准备

安装 agent-browser:

```bash
npm install -g agent-browser
```

Windows 用户需先启动 Chrome（带远程调试端口）：

```bash
# 在另一个终端启动 Chrome（Git Bash）
chrome --remote-debugging-port=9222 --no-sandbox --headless=new &

# 验证调试端口是否可用
curl http://127.0.0.1:9222/json/version
```

**注意**：`--headless=new` 参数表示使用新的 headless 模式，如果需要可视化界面可以去掉此参数。

### 测试流程

#### 1. 连接酒馆网页

```bash
# 连接到已运行的 Chrome
agent-browser connect 9222

# 导航到酒馆
agent-browser navigate http://localhost:8000
```

#### 2. 打开快速回复管理器

```bash
# 获取页面快照查看元素引用
agent-browser snapshot --interactive

# 点击快速回复管理器按钮（根据实际 ref 调整）
agent-browser click @e22
```

#### 3. 常用测试操作

**点击元素**:

```bash
agent-browser click @e5
```

**填写表单**:

```bash
agent-browser fill @e10 "测试内容"
```

**截图对比**:

```bash
agent-browser screenshot result.png --full
```

**执行 JavaScript**:

```bash
agent-browser eval "document.title"
```

#### 4. 测试示例：完整测试流程

```bash
# 1. 连接浏览器（确保 Chrome 已启动）
agent-browser connect 9222

# 2. 导航到酒馆
agent-browser navigate http://localhost:8000

# 3. 查找快速回复管理器按钮
agent-browser snapshot --interactive | grep "快速回复管理器"
# 输出: - button "💌快速回复管理器" [ref=e22]

# 4. 点击打开管理器
agent-browser click @e22

# 5. 点击分类（如剧情编排）
agent-browser click @e10

# 6. 进入子分类（如时间推进）
agent-browser click @e11

# 7. 点击条目（如推进到晚上）
agent-browser click @e9

# 8. 点击连接符按钮
agent-browser click @e2  # "然后"

# 9. 截图验证
agent-browser screenshot test_result.png --full

# 10. 关闭浏览器
agent-browser close
```

#### 5. 常用命令速查

| 命令                                       | 说明                  |
| ------------------------------------------ | --------------------- |
| `agent-browser connect 9222`               | 连接到已运行的 Chrome |
| `agent-browser navigate <url>`             | 导航到指定网址        |
| `agent-browser snapshot`                   | 获取完整页面快照      |
| `agent-browser snapshot --interactive`     | 获取交互元素列表      |
| `agent-browser click @e<N>`                | 点击指定元素          |
| `agent-browser fill @e<N> "文本"`          | 填写输入框            |
| `agent-browser screenshot file.png --full` | 全页截图              |
| `agent-browser eval "JS代码"`              | 执行 JavaScript       |
| `agent-browser close`                      | 关闭浏览器            |

**提示**：使用 `agent-browser snapshot --interactive | grep "关键词"` 可以快速查找元素引用。

### 测试检查清单

- [ ] 管理器窗口正常打开/关闭
- [ ] 分类列表正确显示
- [ ] 新建/编辑/删除快速回复
- [ ] 拖拽排序功能正常
- [ ] 导入/导出功能正常
- [ ] 设置项保存生效
- [ ] 主题切换正确应用

### 自动化测试辅助模块

项目提供了专用的测试辅助模块：`src/快速回复管理器/test-automation.ts`

**导出函数**：

| 函数                           | 用途                                          |
| ------------------------------ | --------------------------------------------- |
| `clickQrmButton()`             | 点击快速回复管理器按钮                        |
| `clickItem(idOrName)`          | 点击指定条目                                  |
| `clickConnector(type)`         | 点击连接符（then/simultaneous/direct/custom） |
| `openSettingsPanel()`          | 打开设置面板                                  |
| `switchSettingsTab(name)`      | 切换设置标签                                  |
| `closePanel(target)`           | 关闭面板                                      |
| `getInputBoxContent()`         | 获取输入框内容                                |
| `isPanelOpen()`                | 检查面板是否打开                              |
| `captureScreenshot(opts)`      | 截图并记录日志                                |
| `runTestWorkflow(name, steps)` | 执行完整测试流程                              |

**使用示例**：

```typescript
import { clickQrmButton, clickItem, clickConnector } from './test-automation';

// 执行测试
clickQrmButton();
clickItem('打招呼');
clickConnector('then');
```

### Agent-Browser 优势

agent-browser 是 Vercel Labs 开发的浏览器自动化 CLI 工具：

| 特性       | Playwright MCP         | Agent-Browser              |
| ---------- | ---------------------- | -------------------------- |
| 上下文使用 | 完整 DOM               | Snapshot + Refs (减少 93%) |
| 架构       | MCP Server             | Rust CLI + Node.js Daemon  |
| 速度       | 中等                   | 更快 (原生 Rust)           |
| 安装       | npx playwright install | npm i -g agent-browser     |
| 配置复杂度 | 需 MCP 配置            | 零配置                     |
| 适用场景   | CI/CD、复杂测试        | 本地开发、快速调试         |

**推荐使用 agent-browser 进行本地开发和快速测试**。

## 参考文件

| 路径                | 说明                 |
| ------------------- | -------------------- |
| `@types/`           | 酒馆助手接口类型定义 |
| `util/`             | 工具函数             |
| `slash_command.txt` | STScript 命令列表    |
| `.cursor/rules/`    | Cursor 编写规则      |
