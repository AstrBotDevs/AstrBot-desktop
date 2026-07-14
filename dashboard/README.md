# AstrBot Desktop 管理面板

此目录由 AstrBot Desktop 仓库直接维护，基于 CodedThemes/Berry 模板开发。生产构建输出到 `dist/`，随后由桌面资源准备脚本同步到 `resources/webui/`。

## 本地开发

```bash
pnpm install
pnpm dev
pnpm build
pnpm typecheck
```

从仓库根目录启动完整桌面开发模式时，Tauri 会通过 `pnpm run dev:dashboard` 自动启动此处的 Vite 服务。

OpenAPI 快照位于 `openapi/openapi-v1.yaml`，更新后可运行 `pnpm generate:api`。T2I Shiki 浏览器运行时由 `pnpm build:t2i-shiki-runtime` 生成到 `public/t2i/`，二者都不依赖本地 AstrBot 源码目录。
