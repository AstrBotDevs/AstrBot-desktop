# Dashboard React 迁移说明

## 1. 目标与约束

Dashboard 将从 Vue 3 + Vuetify 迁移到 React。迁移过程遵循以下约束：

- 新工程固定放在 `new-dashboard/`，旧工程 `dashboard/` 保留，便于并行开发和回退。
- 当前迁移阶段以 Web 端功能完整、行为兼容为第一目标，沿用现有样式和静态资源，暂不进行 UI 重设计。
- 新旧版共用 `/api` 接口、浏览器存储键、hash 路由地址和桌面桥接协议。
- 在所有页面完成 React 原生改写前，发布版本必须保持旧版业务页面可用。
- `dashboard/` 在新版功能完全迁移前持续保留，主分支和正式流程仍以旧版为主；新版仅在开发分支推进。

## 2. 已确认的技术决策

| 项目 | 决策 |
| --- | --- |
| 样式 | React + Sass/CSS；弹窗、菜单等使用无默认外观的 headless 组件 |
| 状态管理 | Zustand |
| 路由 | React Router hash router；迁移期间允许跨运行时整页刷新 |
| 国际化 | react-i18next；继续使用现有 JSON 和翻译键 |
| 表单 | React Hook Form + Yup |
| 迁移粒度 | 按完整路由逐页迁移，不拆分为 Vue/React 混合组件 |
| 当前验收重点 | 优先保证 Web 端功能；框架和功能迁移完成后再统一重设计 UI |
| 旧版策略 | 旧版持续作为默认实现、功能基准和回退入口，直至完全迁移 |

## 3. 当前迁移阶段

当前完成的是第一阶段“React 兼容入口”：

```text
Tauri / 浏览器
  -> React + Vite（new-dashboard，端口 1420）
       -> 加载同源 /legacy/index.html
       -> 在当前窗口接管为 Vue + Vuetify 完整原页面
       -> /api 代理到 AstrBot（端口 6185）
```

开发态旧版兼容服务运行在 `1421`，React Vite 将 `/legacy` 反向代理到该服务。React 启动后在当前顶层窗口加载旧页面，不使用 iframe，因此原有 Tauri 桌面桥接仍挂载在同一个 `window` 上。生产构建会由仓库根目录脚本以 `/legacy/` base 构建旧版，再复制到 `new-dashboard/public/legacy`，最终生成一个可独立部署的 `new-dashboard/dist`。所有兼容参数均在 `new-dashboard/` 或根目录脚本中，`dashboard/` 不需要任何改动。

这不是“所有 Vue 组件已经改写完成”的声明。兼容入口的作用是建立可运行、可回退、无视觉跳变的迁移基线，后续可逐个路由替换为 React 页面。

## 4. 目录职责

| 路径 | 职责 |
| --- | --- |
| `dashboard/` | 只读保留的旧版 Vue Dashboard；迁移期间也是视觉和行为基准 |
| `new-dashboard/` | React + TypeScript + Vite 新工程 |
| `new-dashboard/src/App.tsx` | React 入口和兼容页面加载层 |
| `new-dashboard/public/legacy/` | 构建时生成的旧版嵌入产物，不手工维护 |
| `scripts/run-tauri-new.mjs` | 新版 Tauri 入口；通过配置覆盖选择新版开发与构建命令 |
| `scripts/run-dashboard-new.mjs` | 同时启动 React 入口和只读旧版兼容服务 |
| `scripts/prepare-webui-new.mjs` | 构建新版 WebUI 并同步到 `resources/webui` |

原有 `scripts/run-tauri.mjs`、`scripts/prepare-resources.mjs` 和 `scripts/prepare-resources/` 下的旧任务脚本保持不变。新版逻辑只存在于带 `-new` 后缀的增量脚本中。

## 5. 安装依赖

根目录、旧版和新版依赖分别安装：

```bash
pnpm install
pnpm run install:dashboard
pnpm run install:dashboard:new
```

现有 `make deps` 保持原行为，只安装根目录和旧版 Dashboard 依赖，不会隐式安装新版依赖。

## 6. 启动命令

只启动前端：

```bash
# 新版 React 入口（同时启动 1421 旧版兼容服务）
pnpm run dev:dashboard:new

# 旧版 Vue Dashboard
pnpm run dev:dashboard
```

启动完整 Tauri 桌面应用：

```bash
# 新版 Dashboard
pnpm run dev:new

# 旧版 Dashboard
pnpm run dev
```

为保持现有开发习惯，原命令 `pnpm run dev` 和 `pnpm run dev:dashboard` 未被修改，仍启动旧版。新版必须使用带 `:new` 或 `new` 后缀的独立命令；当前没有通过环境变量切换版本的机制。

## 7. 构建命令

```bash
# 使用 React 入口打包桌面应用
pnpm run build:new

# 使用旧版 Vue Dashboard 打包
pnpm run build
```

原有 `pnpm run build` 未被修改，继续构建旧版。新版 WebUI 构建流程为：

1. 只读校验旧版桌面桥接实现。
2. 根目录构建脚本通过命令行参数使用 `/legacy/` base 构建 `dashboard/`，不修改旧工程配置。
3. 将产物同步到 `new-dashboard/public/legacy/`。
4. 类型检查并构建 `new-dashboard/`。
5. 将 `new-dashboard/dist` 同步到 `resources/webui`。
6. 继续准备后端资源并执行 Tauri 打包。

只准备新版 WebUI 或新版完整资源时，可以分别运行：

```bash
pnpm run prepare:webui:new
pnpm run prepare:resources:new
```

单独检查新版类型：

```bash
pnpm run typecheck:dashboard:new
```

## 8. 后续逐页迁移规范

建议按低耦合到高耦合的顺序迁移：认证页、欢迎页/关于页、统计与只读列表、配置编辑页、扩展与知识库、聊天与 Monaco 编辑器。

每迁移一个路由：

1. 在 `new-dashboard/src` 中实现 React 页面，并保持原 hash 路径不变。
2. 复用旧版主题 token、字体和静态资源，保持页面可用且不存在明显布局回归；像素级一致不作为当前功能迁移的阻塞条件。
3. API 请求与旧版使用相同的 URL、请求体、错误处理和鉴权存储键。
4. 优先在 Web 端对照旧版验证功能、路由和数据状态。
5. 覆盖中文/英文、空数据、加载和错误状态；主题与多尺寸视觉精修安排在 UI 重设计阶段。
6. 验收通过后，才从兼容路由中移除对应旧页面。

通用能力依次抽成 React 模块：Sass/CSS token、Zustand stores、react-i18next、HTTP 客户端、认证状态、React Hook Form/Yup、Toast/Confirm、桌面桥接和路由加载状态。业务页不应直接重新定义这些协议。

## 9. 当前验收标准

当前阶段以 Web 功能验收为主：

- 路由、刷新、深链接和权限重定向与旧版一致。
- API、鉴权、本地存储和错误处理与旧版兼容。
- 页面主要操作、数据状态和业务流程可用。
- 中文和英文内容正确，页面不存在阻断使用的布局问题。
- headless 组件具备键盘操作、焦点管理和必要的无障碍语义。

React 框架和全部功能完成迁移后，再启动独立的 UI 重设计阶段，届时重新制定视觉规范、响应式范围和截图基线。桌面端专项验证也安排在 Web 功能稳定之后。

## 10. 回退方式

如果新版入口出现问题，无需删除代码或回滚资源：开发时改回原命令 `pnpm run dev`，构建时改回 `pnpm run build` 即可。新旧工程使用各自的 `dist` 目录；资源准备时，最后执行的版本会覆盖 `resources/webui`。

`dashboard/` 不会因为单个页面完成迁移而删除。只有全部路由、通用能力、Web 功能和后续桌面验证完成，并经过单独评审后，才能开始旧版下线工作。

## 11. 实现提交

当前迁移基线由三笔独立提交组成：

1. `cb70c8e`：创建 `new-dashboard/` React + TypeScript + Vite 工程。
2. `b0b8912`：增加新版命令入口，并从原 `run-tauri.mjs` 复制出隔离的 `run-tauri-new.mjs`。
3. `241078b`：只在新版脚本中实现 React 开发服务、Tauri 配置覆盖和新版 WebUI 构建流程。
