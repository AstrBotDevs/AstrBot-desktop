# Dashboard React 迁移说明

## 当前状态

Dashboard 的启用路由已从 Vue 3 + Vuetify 迁移到 React。React 工程现位于
`dashboard/`，并且是本地开发、桌面打包和 CI 的唯一默认 WebUI。

旧版 Vue 工程移动到 `legacy-dashboard/`，仅用于人工行为与视觉对照。它不参与：

- `pnpm run dev`、`pnpm run build` 或 `make` 默认命令；
- `resources/webui` 资源准备；
- Tauri 的 `beforeDevCommand`、`beforeBuildCommand`；
- Dashboard 质量检查和桌面发布 CI。

## 目录职责

| 路径 | 职责 |
| --- | --- |
| `dashboard/` | React + TypeScript + Vite 当前工程 |
| `dashboard/src/app/AppRouter.tsx` | React 路由入口和鉴权装配 |
| `legacy-dashboard/` | 只读保留的旧版 Vue 工程，不参与自动化流程 |
| `scripts/run-tauri.mjs` | 唯一 Tauri 开发和构建入口 |
| `scripts/prepare-resources.mjs` | WebUI、后端和版本资源准备入口 |

## 常用命令

```bash
pnpm install
pnpm run install:dashboard
pnpm run dev:dashboard
pnpm run dev
pnpm run typecheck:dashboard
pnpm run prepare:webui
pnpm run prepare:resources
pnpm run build
```

生产构建会：

1. 使用 `dashboard/pnpm-lock.yaml` 安装缺失依赖。
2. 类型检查并构建 `dashboard/`。
3. 将 `dashboard/dist` 同步到 `resources/webui`。
4. 拉取或使用指定 AstrBot 后端源码并准备 `resources/backend`。
5. 执行 Tauri 打包。

## CI

`.github/workflows/check-dashboard.yml` 对 `dashboard/` 执行类型检查、TypeScript/React
lint、样式 lint、格式检查、覆盖率测试和生产构建。

`.github/workflows/build-desktop-tauri.yml` 通过 Tauri 默认
`beforeBuildCommand = pnpm run prepare:resources` 构建 React Dashboard；Linux、Windows
和 macOS 产物均使用同步到 `resources/webui` 的 React bundle。

## 维护约束

1. 新功能和修复只进入 `dashboard/`。
2. 不得在 CI、Makefile、Tauri 配置或默认 package scripts 中引用 `legacy-dashboard/`。
3. 不再新增 `:new`、`-new` 等并行构建入口。
4. 新增路由时保持既有 hash 路径、API、存储 key 和桌面桥协议兼容。
5. `legacy-dashboard/` 删除应作为独立任务处理，不影响当前默认构建链路。
