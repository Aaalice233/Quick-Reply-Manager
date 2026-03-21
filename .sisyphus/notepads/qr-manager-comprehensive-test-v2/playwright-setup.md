# Playwright 测试框架状态检查报告

**检查时间**: 2026-03-21
**检查项目**: Playwright 测试框架需求

---

## 1. 当前状态

### package.json 依赖检查
- [x] 检查 @playwright/test
  - **状态**: 未安装
  - **说明**: devDependencies 和 dependencies 中均未发现 @playwright/test

### 配置文件检查
- [x] 检查 playwright.config.ts
  - **状态**: 不存在
- [x] 检查 playwright.config.js
  - **状态**: 不存在

### 测试目录检查
- [x] 检查 tests/ 目录
  - **状态**: 不存在

### 测试文件检查
- [x] 检查 *.spec.ts 文件
  - **状态**: 未发现
- [x] 检查 *.test.ts 文件
  - **状态**: 未发现

---

## 2. 需要安装/创建的组件清单

### 必需安装

| 组件 | 安装命令 | 优先级 |
|------|----------|--------|
| @playwright/test | `pnpm add -D @playwright/test` | 高 |
| Playwright browsers | `pnpm exec playwright install` | 高 |

### 必需创建

| 文件/目录 | 路径 | 说明 | 优先级 |
|-----------|------|------|--------|
| Playwright 配置 | `./playwright.config.ts` | 测试框架主配置 | 高 |
| 测试目录 | `./tests/` | 存放所有测试文件 | 高 |
| 示例测试 | `./tests/example.spec.ts` | 示例测试文件 | 中 |
| 全局设置 | `./tests/global-setup.ts` | 全局测试设置 | 中 |
| 页面模型 | `./tests/pages/` | Page Object Models | 低 |
| 测试工具 | `./tests/utils/` | 测试辅助工具 | 低 |

---

## 3. 推荐配置内容

### playwright.config.ts 建议配置

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:5500',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
  webServer: {
    command: 'pnpm watch',
    url: 'http://127.0.0.1:5500',
    reuseExistingServer: !process.env.CI,
  },
});
```

### package.json scripts 建议添加

```json
{
  "scripts": {
    "test": "playwright test",
    "test:ui": "playwright test --ui",
    "test:debug": "playwright test --debug",
    "test:report": "playwright show-report"
  }
}
```

---

## 4. 项目适配注意事项

本项目是为酒馆助手 (Tavern Helper) 编写的脚本，在酒馆 (SillyTavern) 中以无沙盒 iframe 形式运行。测试时需要：

1. **模拟酒馆环境**: 测试需要在模拟的酒馆助手环境中运行
2. **iframe 测试**: 可能需要测试 iframe 内的行为
3. **外部依赖**: 依赖酒馆助手提供的全局接口
4. **热重载**: 开发时使用 Live Server (端口 5500)

---

## 5. 下一步行动

1. [ ] 安装 @playwright/test: `pnpm add -D @playwright/test`
2. [ ] 安装浏览器: `pnpm exec playwright install`
3. [ ] 创建 playwright.config.ts 配置文件
4. [ ] 创建 tests/ 目录结构
5. [ ] 编写第一个示例测试
6. [ ] 更新 package.json 添加测试脚本
