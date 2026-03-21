## 2026-03-21 - UI组件提取完成

### 完成的工作

- 创建了 `src/快速回复管理器/ui/components.ts` 文件
- 从原 `index.ts` 中提取了6个核心UI组件

### 提取的组件

1. **iconSvg(name: string): string**
   - 位置：原文件第3571-3603行
   - 功能：返回SVG图标字符串
   - 包含28个预定义图标映射

2. **renderTopButton(opts?: TopButtonOptions): string**
   - 位置：原文件第3605-3611行
   - 功能：创建顶部工具栏按钮HTML
   - 支持图标、标签、数据属性等选项

3. **showModal(contentFactory, opts?): void**
   - 位置：原文件第4623-4639行
   - 功能：显示模态对话框
   - 支持内容替换和关闭回调

4. **toast(message: string): void**
   - 位置：原文件第2616-2629行
   - 功能：显示Toast通知
   - 支持配置最大堆叠数和超时时间

5. **createButton(text, onClick?, className?): HTMLButtonElement**
   - 新增通用组件
   - 功能：创建通用按钮元素

6. **createCard(title, content): HTMLElement**
   - 新增通用组件
   - 功能：创建卡片组件

### 依赖关系

```typescript
import { TOAST_CONTAINER_ID, OVERLAY_ID } from '../constants';
import { resolveHostWindow } from '../utils/dom';
import { logInfo } from '../services/debug';
```

### 适配工作

在提取过程中进行了以下适配：

1. **showModal适配**：原函数依赖 `invalidateEditGeneration` 和局部 `pD` 变量
   - 新增 `registerModalCloseCallback` 机制替代直接的 `invalidateEditGeneration` 调用
   - 使用 `resolveHostWindow().document` 动态获取宿主文档

2. **toast适配**：原函数依赖局部 `state` 变量获取配置
   - 新增 `setToastConfig` / `resetToastConfig` API 供外部注入配置
   - 使用默认值确保独立运行

### 类型定义

新增了以下类型接口：

- `ModalOptions`: 模态框选项
- `ModalContentFactory`: 模态框内容工厂类型
- `TopButtonOptions`: 顶部按钮选项
- `ToastConfig`: Toast配置

### 验证结果

- TypeScript编译无错误
- 文件路径正确
- 所有组件函数已正确导出
