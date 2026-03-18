CLAUDE.md

# 酒馆助手脚本开发

## 实时开发流程

### 首次配置（仅需一次）
1. 确保 `.vscode/settings.json` 已配置 Live Server CORS 头：
   ```json
   "liveServer.settings.headers": {
     "Access-Control-Allow-Origin": "*"
   }
   ```
2. 实时修改脚本配置文件中的 URL 必须使用 `127.0.0.1`（不能用 `localhost`），否则会触发 CORS 跨域错误
   - 正确：`"content": "import 'http://127.0.0.1:5500/dist/快速情节编排/index.js'"`
   - 错误：`"content": "import 'http://localhost:5500/dist/快速情节编排/index.js'"`

### 启动流程
1. `pnpm watch`（首次需先 `pnpm install`）
2. VSCode 点击右下角「Go Live」启动 Live Server（端口 5500）
3. 酒馆助手 → 脚本库 → 导入实时修改脚本配置 JSON
4. 酒馆助手 → 开发 → 实时监听 → 允许监听
5. 编辑 `src/项目名/index.ts`，保存后自动更新到酒馆
6. 完成后 `pnpm build` 打包最终版本

### 常见问题
- **CORS 跨域错误**：`Access-Control-Allow-Origin` 相关错误
  - 原因：酒馆运行在 `127.0.0.1:8000`，脚本 URL 使用了 `localhost:5500`，浏览器认为是跨域
  - 解决：统一使用 `127.0.0.1`，并确保 Live Server 配置了 CORS 头
- **Live Server 未启动**：脚本加载失败，检查 VSCode 右下角是否有端口号显示
- **依赖未安装**：`webpack is not recognized` → 先执行 `pnpm install`

## 重要路径
- 参考脚本示例：`参考脚本示例`文件夹

## 参考文档
- https://stagedog.github.io/青空莉/工具经验/实时编写前端界面或脚本/
- SillyTavern 官方文档