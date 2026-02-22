# AstrBot Desktop 架构说明

本文档描述当前桌面端（Tauri）运行时架构、关键模块边界和主要流程。

## 1. 总体架构

系统由三层组成：

1. 桌面壳层（Tauri + Rust）
2. WebUI 资源层（`resources/webui`）
3. 后端运行时层（`resources/backend` + CPython runtime）

桌面壳层负责：

- 进程生命周期管理（拉起、探活、重启、停止）
- 托盘与窗口行为
- 前端桥接注入与 IPC 命令
- 配置解析、日志落盘、退出流程协调

## 2. Rust 模块边界

### 2.1 `src-tauri/src/main.rs`

入口与编排层，主要保留：

- Tauri app 构建与事件挂载
- 托盘菜单事件分发
- 后端生命周期调度
- 模块调用编排（不承载重逻辑纯函数）

### 2.2 `src-tauri/src/backend_config.rs`

后端配置解析模块：

- ready path 解析
- timeout clamp 与默认值策略
- readiness config 聚合

### 2.3 `src-tauri/src/logging.rs`

日志模块：

- 日志轮转
- 日志路径解析（desktop/backend）
- 日志落盘
- 日志分类：`startup/runtime/restart/shutdown`

### 2.4 `src-tauri/src/startup_mode.rs`

启动模式纯逻辑：

- 环境变量到启动模式映射
- WebUI 文件存在性到启动模式映射

### 2.5 `src-tauri/src/backend_path.rs`

后端 PATH 覆盖逻辑：

- 平台特定路径候选
- 去重与合并
- 诊断日志输出

### 2.6 `src-tauri/src/webui_paths.rs`

打包模式 WebUI 回退路径逻辑：

- fallback 探测目录
- fallback 可用性判断
- 诊断展示路径生成

### 2.7 `src-tauri/src/exit_state.rs`

退出状态机：

- 状态：`Running` / `QuittingRequested` / `CleanupInProgress` / `ReadyToExit` / `Exiting`
- 能力：开始清理、放行下次退出请求、状态读取

### 2.8 `src-tauri/src/http_response.rs`

HTTP 响应解析模块：

- 状态码提取（status line）
- chunked body 解码
- JSON 响应提取（2xx 门禁）
- 后端 `start_time` 字段解析

### 2.9 `src-tauri/src/process_control.rs`

进程停止控制模块：

- 子进程退出等待
- graceful stop / force stop 命令编排
- 跟随等待时间计算与失败降级策略

### 2.10 `src-tauri/src/origin_policy.rs`

桥接注入来源策略模块：

- URL 同源判定
- loopback host 判定
- tray bridge 注入来源决策

## 3. 关键流程

### 3.1 启动流程

1. Tauri 启动并初始化托盘与窗口事件。
2. 异步 worker 执行后端就绪检查与必要拉起。
3. 成功后导航主窗口；失败时进入 startup error 路径。
4. 页面加载阶段按规则注入 desktop bridge。

### 3.2 重启流程

1. 触发源：托盘菜单或 bridge IPC。
2. 统一进入 `run_restart_backend_task`。
3. 原子门禁阻止并发重启/拉起。
4. 按策略执行 graceful 或 fallback 重启。

### 3.3 退出流程

1. `ExitRequested` 阶段先 `prevent_exit`。
2. 退出状态机尝试进入清理态。
3. 异步执行 `stop_backend`。
4. 清理完成后放行下一次退出请求并 `exit(0)`。
5. `Exit` 分支作为 fallback 清理路径。

## 4. 脚本架构（prepare-resources）

入口：`scripts/prepare-resources.mjs`（编排层）

子模块：

- `source-repo.mjs`：源码仓库 URL/ref 解析与同步
- `version-sync.mjs`：版本读取与三处文件同步
- `backend-runtime.mjs`：CPython runtime 解析/准备
- `mode-tasks.mjs`：`webui/backend/all` 任务实现
- `desktop-bridge-checks.mjs`：bridge 工件校验

## 5. 测试与门禁

本地：

- `make lint`
- `make test`

CI：

- `check-rust.yml`：fmt/clippy/check + 关键 Rust 单测
- `check-scripts.yml`：Node/Python 语法 + Node 行为测试

## 6. 演进建议

- 继续把 `main.rs` 中仍偏纯函数的工具逻辑按职责下沉。
- 为退出/重启链路补充更贴近事件流的集成测试。
- 维持“编排层薄、模块层厚”的边界纪律。
