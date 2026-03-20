# AGENTS.md - 快速回复管理器项目指南

## 项目概述

本项目是为酒馆助手 (Tavern
Helper) 编写的脚本，在酒馆 (SillyTavern) 中以无沙盒 iframe 形式运行。主入口：`src/快速回复管理器/index.ts`

## Build/Lint/Test 命令

```bash
# 安装依赖
pnpm install

# 开发模式（热重载 + Live Server）
pnpm watch

# 构建
pnpm build          # 生产构建
pnpm build:dev      # 开发构建

# 代码检查
pnpm lint           # 运行 ESLint
pnpm lint:fix       # 自动修复 lint 问题

# 格式化
pnpm format         # Prettier 格式化 src 下所有文件

# 其他
pnpm dump           # 生成 schema.json
pnpm sync           # 同步角色卡/世界书/预设
```

## 实时开发流程

1. `pnpm watch` 启动开发服务器
2. VSCode 启动 Live Server (端口 5500)
3. 酒馆助手 → 脚本库 → 导入配置 JSON (URL 必须用 `127.0.0.1`，不能用 `localhost`)
4. 酒馆助手 → 开发 → 实时监听 → 允许监听
5. 编辑代码，保存后自动更新

**注意**: Live Server 需配置 CORS 头，`.vscode/settings.json`:

```json
"liveServer.settings.headers": { "Access-Control-Allow-Origin": "*" }
```

## 代码风格规范

### TypeScript 配置

- **Strict mode**: 启用 (`strict: true`)
- **Target**: ESNext
- **Module**: ESNext (bundler resolution)
- **JSX**: react-jsx
- **未使用变量**: 警告 (`noUnusedLocals`, `noUnusedParameters`)

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

- **常量**: `SCREAMING_SNAKE_CASE` (如 `STORE_KEY`, `OVERLAY_ID`)
- **函数/变量**: `camelCase`
- **接口/类型**: `PascalCase`
- **私有函数**: 可用下划线前缀 `_funcName`

### 导入风格

```typescript
// 第三方库 (全局可用，无需导入)
// $, _, toastr, YAML, z (zod) 直接使用

// 工具函数路径别名
import { xxx } from '@util/script';
import { xxx } from '@/快速回复管理器/utils';

// 文件内容导入
import htmlContent from './file.html?raw'; // 原始内容
import cssContent from './style.scss?raw'; // 打包后的 CSS
```

## 脚本编写规范

### 初始化与清理

```typescript
// 正确：使用 jQuery 加载
$(() => {
  // 初始化代码
  toastr.success('加载成功');
});

// 正确：使用 pagehide 清理
$(window).on('pagehide', () => {
  // 清理代码
});

// 错误：DOMContentLoaded 不会被触发
document.addEventListener('DOMContentLoaded', fn); // 禁止
```

### 全局变量与酒馆交互

```typescript
// 酒馆助手接口直接可用
getVariables({ type: 'script' });
replaceVariables(data, { type: 'script', script_id: getScriptId() });
getChatMessages();
setChatMessages(messages);

// jQuery 指向酒馆网页 (window.parent.$)
$('body'); // 选择酒馆网页的 body
```

### 数据持久化

```typescript
// 脚本变量存储
const STORE_KEY = 'fastPlotQRPack';

// 读取
const vars = getVariables({ type: 'script' }) as Record<string, unknown>;
const pack = vars[STORE_KEY];

// 写入
insertOrAssignVariables({ [STORE_KEY]: data }, { type: 'script' });

// 备用 localStorage
pW.localStorage.setItem(`__${STORE_KEY}__`, JSON.stringify(data));
```

### 错误处理

```typescript
// 使用 errorCatched 包装入口函数
function init() {
  // 可能抛出错误的代码
}

$(() => {
  errorCatched(init)();
});

// 日志记录
console.info('[INFO] 消息');
console.warn('[WARN] 警告');
console.error('[ERROR] 错误');
throw new Error('致命错误');
```

## UI 样式规范

### 主题变量系统

项目使用 CSS 变量实现多主题：

```css
/* 核心变量 */
--qr-bg-1, --qr-bg-2, --qr-bg-3  /* 背景层 */
--qr-text-1, --qr-text-2         /* 文本颜色 */
--qr-accent, --qr-accent-hover   /* 强调色 */
--qr-border-1, --qr-border-2    /* 边框色 */
--qr-card-bg, --qr-card-border  /* 卡片样式 */
--qr-btn-bg, --qr-btn-border    /* 按钮样式 */
```

### Tailwindcss

- 优先使用 tailwindcss class
- 禁止使用与酒馆网页冲突的类名（向酒馆挂载组件时）

### 样式注入

```typescript
// 脚本中向酒馆网页注入样式
const style = pD.createElement('style');
style.id = STYLE_ID;
style.textContent = `...`;
pD.head.appendChild(style);
```

## 禁止事项

1. **禁止使用 `DOMContentLoaded`** - 使用 `$(() => {})`
2. **禁止使用 `'unload'` 事件** - 使用 `'pagehide'`
3. **禁止在 index.html 中引用本地文件** - 通过 TypeScript 导入
4. **禁止使用 `vh` 单位** - iframe 环境中高度不正确
5. **禁止使用 Node.js 库** - 仅浏览器环境
6. **禁止类型断言绕过** - 不用 `as any`, `@ts-ignore`
7. **禁止空 catch 块** - 必须处理或记录错误

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

## 参考文件

- `@types/` - 酒馆助手接口类型定义
- `util/` - 工具函数
- `slash_command.txt` - STScript 命令列表
- `.cursor/rules/` - Cursor 编写规则
