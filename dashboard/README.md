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

## 环境变量

- `VITE_ASTRBOT_RELEASE_BASE_URL`（可选）
  - 默认值：`https://github.com/AstrBotDevs/AstrBot/releases`
  - 用途：管理面板内“更新到最新版本”外部跳转所使用的 release 基地址。集成方可按需覆盖（例如 Desktop 指向其自身发布页）。
  - 建议传入仓库的 `.../releases` 基地址（不带 `/latest`）。
