# AstrBot Desktop 架构说明

本文档描述当前桌面端（Tauri）运行时的子系统边界、共享状态和主要流程。
详细文件清单见 `docs/repository-structure.md`；本文只关注当前架构，不记录迁移历史。

## 1. 总体结构

系统由三层组成：

1. 桌面壳层（`src-tauri`，Tauri + Rust）
2. WebUI 资源层（`resources/webui`）
3. 后端运行时层（`resources/backend` + CPython runtime）

桌面壳层负责：

- 后端启动、探活、重启、停止
- 托盘、窗口和启动壳层行为
- WebView bridge 注入与 IPC 命令
- 日志、配置、退出和 updater 流程编排

## 2. Rust 子系统边界

当前 Rust 代码采用“子系统目录 + 顶层共享模块”的布局。

### 2.1 编排层

- `main.rs`
  - 进程入口与模块声明。
- `app_runtime.rs`
  - Tauri builder、插件、事件绑定和 invoke handler 编排。
- `app_runtime_events.rs`
  - 窗口、页面加载和退出事件的纯决策逻辑。

这一层负责把各子系统接起来，不承载具体业务细节。

### 2.2 backend 子系统

- `backend/`
  - 后端配置、PATH 组装、启动、HTTP 探测、readiness、restart 和进程生命周期。
- `launch_plan.rs`
  - custom / packaged / dev 三类启动计划解析。
- `runtime_paths.rs`
  - packaged root、resource 路径、开发态源码根目录探测。
- `process_control.rs`
  - graceful / force stop 与等待策略。
- `packaged_webui.rs`、`webui_paths.rs`
  - 打包 WebUI 与 fallback 资源路径决策。

backend 子系统对上提供统一的“后端可否管理、如何启动、何时算 ready”的运行时边界。

### 2.3 window / tray 子系统

- `window/`
  - 主窗口 show/hide/reload、startup loading 注入和窗口动作编排。
- `tray/`
  - 托盘菜单、文案刷新、重启事件和初始化。
- `shell_locale.rs`
  - 壳层 locale 归一化、托盘文案映射和 locale 缓存读写。
- `startup_mode.rs`
  - `loading` / `panel-update` 启动模式判定。

这一层负责桌面交互体验，不直接处理 backend 细节。

### 2.4 lifecycle 子系统

- `lifecycle/`
  - ExitRequested / Exit 分支、清理流程和退出状态包装。
- `exit_state.rs`
  - 退出状态机。
- `restart_backend_flow.rs`
  - bridge / tray 共用的重启任务入口与并发门禁。

这一层保证退出和重启流程串行、可追踪、可降级。

### 2.5 bridge 与 updater 子系统

- `bridge/desktop.rs`
  - bridge bootstrap 组装与注入执行。
- `bridge/origin_policy.rs`
  - bridge 注入来源判定。
- `bridge/commands.rs`
  - desktop bridge IPC 命令入口，收敛 backend、locale、updater 相关返回结构。
- `bridge/updater_messages.rs`
  - updater 不支持/手动下载原因文案，以及 manual-download 文案里的下载地址解析。
- `bridge/updater_mode.rs`
  - 当前运行时 updater 模式判定：`NativeUpdater`、`ManualDownload`、`Unsupported`。
- `bridge/updater_types.rs`
  - updater check / install / channel 的序列化返回结构。
- `update_channel.rs`
  - `stable` / `nightly` 通道解析、manifest endpoint 选择、版本比较和 `updateChannel` 持久化。
- `desktop_state.rs`
  - `desktop_state.json` 共享路径解析，供 locale / update channel 共用。

这一层对 WebUI 暴露稳定的桌面能力接口，并把平台差异和 updater 分支收敛在 Rust 侧。

### 2.6 共享支撑模块

- `logging.rs`
  - desktop/backend 日志路径、轮转和写入。
- `ui_dispatch.rs`
  - 主线程任务派发与 startup error 分发。
- `app_types.rs`
  - `BackendState`、`LaunchPlan`、bridge 返回结构等共享类型。
- `app_constants.rs`
  - timeout、日志、tray 和 startup 相关常量。
- `app_helpers.rs`
  - 日志写入、bridge 注入、路径覆写、debug command 等跨模块 helper。

## 3. 共享状态与配置边界

### 3.1 `desktop_state.json`

- 共享路径由 `desktop_state.rs` 统一解析。
- 路径优先级：`ASTRBOT_ROOT/data/desktop_state.json` -> 打包根目录下的 `data/desktop_state.json`。
- `shell_locale.rs` 维护 `locale` 字段。
- `update_channel.rs` 维护 `updateChannel` 字段，并保留其他 JSON 字段。

当前维护约定是：locale 和 update channel 共用同一个状态文件，但各模块只管理自己的字段。

### 3.2 updater endpoint 与模式解析

- `update_channel.rs` 先看环境变量覆盖，再读 `tauri.conf.json` 的 `plugins.updater.channelEndpoints`。
- stable 通道额外兼容 `plugins.updater.endpoints[0]`。
- `bridge/updater_mode.rs` 的当前策略是：
  - Windows / macOS：`NativeUpdater`
  - Linux AppImage 运行态：`NativeUpdater`
  - 其他 Linux 安装方式：`ManualDownload`
  - 其他平台：`Unsupported`

### 3.3 资源与根目录解析

- `runtime_paths.rs` 负责 packaged root、workspace root 和资源路径探测。
- Tauri 资源路径支持直接资源路径和 `_up_/resources` 候选；`launch_plan.rs` 会把每个候选视为完整的 backend/WebUI 根，不跨根混用资源。
- 正式构建会把最终 `runtime-manifest.json` 的 SHA-256 编入可执行文件；打包态只接受 manifest 摘要与当前可执行文件一致的候选。
- `launch_plan.rs` 校验 Desktop/Core/WebUI 版本、manifest 路径、WebUI marker、index 和入口摘要，再决定 backend cwd、root_dir 和 webui_dir。
- packaged Core 最低要求为 `4.26.0`，因为打包态 readiness 必须通过 `/api/v1/stats/versions` 核对实际运行的 Core/code/WebUI。该限制不应用于 debug/dev 启动计划或显式外部 backend。

## 4. 主要流程

### 4.1 打包资源生成与身份绑定

1. `scripts/prepare-resources.mjs all` 从同一个 AstrBot checkout 依次准备 WebUI 和 backend，避免两次任务之间 source ref 漂移。
2. `resource-identity.mjs` 要求 Core `>=4.26.0`，写入 WebUI `assets/version`，并校验 index 及其本地 JavaScript/CSS 入口。
3. `runtime-manifest.mjs` 生成 backend manifest；最终 attestation 加入 Desktop/Core/source 信息以及 WebUI marker/index/入口摘要。
4. `src-tauri/build.rs` 对最终 manifest 原始字节计算 SHA-256 并编入可执行文件；release 构建缺少 manifest 时直接失败。

### 4.2 启动流程

1. `app_runtime.rs` 初始化 Tauri 插件、窗口事件、页面加载事件和托盘。
2. `startup_task.rs` 异步解析启动计划；打包态从 direct / `_up_/resources` 中选取与可执行文件绑定的完整资源根，开发态仍使用独立的 dev/custom 计划。
3. backend readiness 在接受已运行或刚拉起的打包 backend 前，校验 `/api/v1/stats/versions`，并核对实际送出的 index 和 manifest 声明的入口摘要。
4. backend ready 后用 manifest 摘要生成的 `astrbot_bundle` 查询参数导航主窗口；失败时进入可见的 startup error 路径。
5. 页面加载过程中按来源策略注入 desktop bridge，并在需要时注入 startup loading mode。

### 4.3 bridge 注入与桌面交互流程

1. `bridge/origin_policy.rs` 判断当前页面是否允许注入 desktop bridge。
2. `bridge/desktop.rs` 把 bootstrap 脚本注入 WebView。
3. WebUI 通过 `bridge/commands.rs` 调用 desktop IPC。
4. tray / window 子系统根据当前 locale 和窗口状态刷新文案与可见性。

### 4.4 更新检查/安装流程

1. `bridge/commands.rs` 先用 `bridge/updater_mode.rs` 判定当前 updater 模式。
2. `ManualDownload` / `Unsupported` 直接短路，复用 `bridge/updater_messages.rs` 和 `bridge/updater_types.rs` 返回统一结果。
3. `NativeUpdater` 路径下，`update_channel.rs` 先读缓存的 `updateChannel`，未命中时按当前版本推断通道。
4. updater manifest endpoint 优先取 `ASTRBOT_DESKTOP_UPDATER_STABLE_ENDPOINT` / `ASTRBOT_DESKTOP_UPDATER_NIGHTLY_ENDPOINT`，否则回退到 `tauri.conf.json`。
5. 版本比较仍由 `update_channel.rs` 统一控制 stable / nightly 跨通道规则。

### 4.5 重启流程

1. 触发源来自 tray 菜单或 bridge IPC。
2. `restart_backend_flow.rs` 统一处理并发门禁。
3. `backend/restart.rs` 和 `backend/restart_strategy.rs` 决定 graceful 或 fallback 路径。
4. 完成后刷新 bridge / tray 侧可观察状态。

### 4.6 退出流程

1. `lifecycle/events.rs` 在 `ExitRequested` 阶段先阻止直接退出。
2. `exit_state.rs` 尝试进入清理态。
3. `lifecycle/cleanup.rs` 异步停止 backend 并完成清理。
4. 清理完成后放行退出；`Exit` 分支保留 fallback 清理路径。

## 5. 脚本与校验面

- `scripts/prepare-resources.mjs`
  - 资源准备编排入口。
- `scripts/prepare-resources/source-repo.mjs`
  - 源码仓库 URL/ref、clone/fetch/checkout。
- `scripts/prepare-resources/version-sync.mjs`
  - 桌面版本同步。
- `scripts/prepare-resources/resource-identity.mjs`
  - packaged Core 最低能力门禁、WebUI marker/index/入口校验，以及最终 Core/WebUI attestation。
- `scripts/prepare-resources/backend-runtime.mjs`
  - CPython runtime 准备。
- `scripts/prepare-resources/mode-tasks.mjs`
  - WebUI / backend 资源准备任务。
- `scripts/prepare-resources/desktop-bridge-checks.mjs`
  - bridge 工件校验。
- `scripts/backend/runtime-manifest.mjs`
  - backend runtime manifest 字段、相对路径和 source identity 生成规则。

当前本地和 CI 主要通过 `make lint`、`make test`、`check-rust.yml`、`check-scripts.yml` 维持这些边界。
