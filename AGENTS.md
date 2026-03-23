# AGENTS.md - 快速回复管理器协作指南

> 适用范围：`c:\Claude3\Quick-Reply-Manager`  
> 文档语言：简体中文

## 1. 项目定位

快速回复管理器是运行在酒馆助手（Tavern Helper）中的前端脚本，以**无沙盒 iframe**方式挂载在 SillyTavern 页面。

- 主入口：`src/快速回复管理器/index.ts`
- 技术栈：TypeScript + Webpack + TailwindCSS + SCSS
- 运行环境：浏览器（非 Node 运行时）

## 2. 一键上手（最短路径）

```bash
pnpm install
pnpm watch
```

随后在 VSCode 启动 Live Server（默认 5500），并在酒馆助手中导入本地配置（URL 请使用 `127.0.0.1`）。

建议流程：

1. `pnpm watch`
2. 启动 SillyTavern：`..\SillyTavern\UpdateAndStart.bat`
3. 酒馆助手开启实时监听
4. 保存代码并在页面验证

## 3. 常用命令

```bash
# 开发
pnpm watch

# 构建
pnpm build
pnpm build:dev

# 质量保障
pnpm lint
pnpm lint:fix
pnpm format

# 辅助
pnpm dump
pnpm sync
```

## 4. 必须遵守的运行时规则

### 4.1 生命周期与清理

- 允许：`$(() => { ... })`
- 允许：`$(window).on('pagehide', () => { ... })`
- 禁止：`DOMContentLoaded`
- 禁止：`unload`

原因：iframe + 酒馆注入场景下，`DOMContentLoaded`/`unload`可靠性不足。

### 4.2 浏览器环境约束

- 禁止依赖 Node.js 专属库
- 禁止在 `index.html` 直接引用本地脚本文件（应走 TypeScript import）
- 谨慎使用视口高度单位，避免 `vh` 在 iframe 中导致布局偏差

### 4.3 类型与错误处理

- 禁止：`as any`、`@ts-ignore`
- 禁止：空 `catch {}`
- 入口函数统一用 `errorCatched` 包装

示例：

```typescript
function init() {
  // ...
}

$(() => {
  errorCatched(init)();
});
```

## 5. 代码规范

### 5.1 TypeScript 约定

- `strict: true`
- `target: ESNext`
- `module: ESNext`（bundler）

### 5.2 Prettier 约定

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

### 5.3 命名规范

- 常量：`SCREAMING_SNAKE_CASE`
- 函数/变量：`camelCase`
- 类型/接口：`PascalCase`
- 私有函数：`_leadingUnderscore`

### 5.4 推荐导入顺序

1. 类型
2. 常量
3. 状态
4. 工具
5. 服务
6. 功能
7. UI

## 6. 与酒馆交互的标准方式

### 6.1 变量读写

```typescript
const vars = getVariables({ type: 'script' });
const pack = vars[STORE_KEY];

insertOrAssignVariables({ [STORE_KEY]: data }, { type: 'script' });
```

### 6.2 聊天消息

```typescript
const messages = getChatMessages();
setChatMessages(messages);
```

### 6.3 上下文与命令

```typescript
const ctx = (pW as any).SillyTavern?.getContext?.();
triggerSlash('/command arg');
```

## 7. UI 与样式约束

- 优先 TailwindCSS class
- 样式类名避免与酒馆页面冲突
- 注入样式必须使用唯一 ID

推荐主题变量：

```css
--qr-bg-1; --qr-bg-2; --qr-bg-3;
--qr-text-1; --qr-text-2;
--qr-accent; --qr-accent-hover;
--qr-border-1; --qr-border-2;
--qr-card-bg; --qr-btn-bg;
```

## 8. 目录与分层

```text
src/快速回复管理器/
├── types.ts
├── constants.ts
├── store.ts
├── styles/
├── utils/
├── services/
├── features/
├── ui/
└── index.ts
```

依赖方向：`Core -> Utils -> Services -> Features -> UI -> Entry`

分层原则：

- 单一职责
- 依赖单向
- 状态集中（模块级单例）
- 保持数据格式与 CSS 类名向后兼容

## 9. 调试建议

推荐日志方法：

```typescript
pushDebugLog('消息', payload);
logInfo('INFO 消息', payload);
logError('ERROR 消息', payload);
```

排查顺序：

1. 先看脚本是否加载与初始化
2. 再看变量读写是否成功
3. 最后看 UI 事件绑定与样式覆盖

## 10. 自动化测试（agent-browser）

### 10.1 环境准备

```bash
npm install -g agent-browser
pnpm watch
```

启动 SillyTavern 后端（项目同级目录）：

```powershell
..\SillyTavern\UpdateAndStart.bat
```

启动后确认可用：

```powershell
curl http://127.0.0.1:8000
```

如需连接本地 Chrome 远程调试：

```bash
chrome --remote-debugging-port=9222 --no-sandbox --headless=new &
curl http://127.0.0.1:9222/json/version
```

### 10.2 最小测试流程

```bash
agent-browser connect 9222
agent-browser open http://127.0.0.1:8000
agent-browser snapshot --interactive
agent-browser click '@eXX'
agent-browser screenshot test/screenshots/agent-browser/result.png --full
agent-browser close
```

说明：`@eXX` 需按当前快照中的实际元素 ref 替换。

### 10.3 常用命令

- `agent-browser connect 9222`
- `agent-browser open <url>`
- `agent-browser snapshot --interactive`
- `agent-browser click '@e<N>'`（PowerShell 推荐）
- `agent-browser fill '@e<N>' "文本"`（PowerShell 推荐）
- `agent-browser screenshot test/screenshots/agent-browser/<name>.png --full`
- `agent-browser eval "document.title"`
- `agent-browser close`

### 10.4 回归检查清单

- [ ] 面板正常打开/关闭
- [ ] 分类与条目渲染正确
- [ ] 新建/编辑/删除可用
- [ ] 拖拽排序生效
- [ ] 导入/导出可用
- [ ] 设置保存并可恢复
- [ ] 主题切换正确

### 10.5 测试截图规范（必须遵守）

- 所有自动化测试截图统一存放在：`test/screenshots/agent-browser/`
- 禁止把测试截图放在项目根目录或业务源码目录（如 `src/`）
- 命名格式：`YYYYMMDD-HHmm-<case>-<step>.png`
- 例如：`20260323-1105-open-panel-after-click.png`
- 提交前应删除无意义临时截图（如 `tmp.png`、`test.png`）

推荐命令：

```bash
agent-browser screenshot test/screenshots/agent-browser/20260323-1105-open-panel-after-click.png --full
```

## 11. 测试辅助模块

测试辅助位于：`src/快速回复管理器/test-automation.ts`

常用函数：

- `clickQrmButton()`
- `clickItem(idOrName)`
- `clickConnector(type)`
- `openSettingsPanel()`
- `switchSettingsTab(name)`
- `closePanel(target)`
- `getInputBoxContent()`
- `isPanelOpen()`
- `captureScreenshot(opts)`
- `runTestWorkflow(name, steps)`

## 12. 明确禁止项（速查）

- 禁止使用 `DOMContentLoaded`
- 禁止使用 `unload`
- 禁止 `as any` 与 `@ts-ignore`
- 禁止空 `catch` 块
- 禁止依赖 Node-only API
- 禁止直接在 HTML 引本地脚本

## 13. 参考路径

- `@types/`：酒馆助手接口类型
- `util/`：通用工具
- `slash_command.txt`：STScript 命令参考
- `.cursor/rules/`：Cursor 规则

---

维护建议：新增规则时优先补充“必须遵守”与“禁止项”，避免把 AGENTS.md 变成长篇教程。
