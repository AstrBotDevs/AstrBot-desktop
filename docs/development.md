# AstrBot Desktop 开发与构建说明

本文档面向维护者与贡献者，集中说明本地构建、常用维护命令、版本同步和发布相关约定。

如果你只是想下载安装和使用桌面端，请优先阅读仓库根目录的 [`README.md`](../README.md)。

## 1. 开发环境

建议先准备以下工具：

- Node.js
- `pnpm`
- Rust toolchain
- Tauri 所需系统依赖

可先运行下面的命令检查本机工具链：

```bash
make doctor
```

## 2. 快速开始

推荐直接使用 Makefile：

```bash
make deps
make prepare
make dev
make build
```

常见含义：

- `make deps`：安装前端/脚本依赖。
- `make prepare`：准备 WebUI 与后端运行时资源。
- `make dev`：启动 Tauri 开发模式。
- `make build`：执行正式构建。

构建产物默认位于：

```text
src-tauri/target/release/bundle/
```

## 3. 常用维护命令

```bash
make help
make lint
make test
make doctor
make clean
make prune
```

- `make lint`
  - 执行 `cargo fmt --check`
  - 执行 `cargo clippy -- -D warnings`
- `make test`
  - 执行 Rust 全量单元测试（`cargo test --locked`）
  - 若本机有 `pnpm`，执行资源准备脚本行为测试（`pnpm run test:prepare-resources`）
- `make prune`
  - 清理较大的本地 runtime / vendor 缓存，便于回收磁盘空间

## 4. 版本同步

- `make update`
  - 从上游 AstrBot 同步版本信息，适合日常更新。
- `make sync-version`
  - 从当前解析到的 AstrBot 源码同步版本。
- `make build`
  - 默认使用当前 `package.json` 的版本，可通过环境变量覆盖。

桌面端版本会同步到：

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

## 5. 常用环境变量

常见变量包括：

- `ASTRBOT_SOURCE_GIT_URL` / `ASTRBOT_SOURCE_GIT_REF`
- `ASTRBOT_SOURCE_DIR`
- `ASTRBOT_BUILD_SOURCE_DIR`
- `ASTRBOT_DESKTOP_VERSION`

完整环境变量清单请查看：

- [`docs/environment-variables.md`](./environment-variables.md)

示例：

```bash
make update
make update ASTRBOT_SOURCE_GIT_REF=v4.26.0
make build ASTRBOT_SOURCE_GIT_REF=v4.26.0 ASTRBOT_DESKTOP_VERSION=v4.26.0
make build ASTRBOT_BUILD_SOURCE_DIR=/path/to/AstrBot
```

正式打包要求 AstrBot Core `>=4.26.0`。这是 `/api/v1/stats/versions` 首次可用于 Desktop 启动期 Core/code/WebUI 身份核对的版本；更早的 Core 会在 packaged resource 准备开始时明确失败。`make dev` 的开发启动计划和显式配置的外部 backend 不使用这条 packaged identity 门禁。

如果需要清理构建相关环境变量：

```bash
make clean-env
source .astrbot-reset-env.sh
```

## 6. 构建与资源准备流程

`src-tauri/tauri.conf.json` 配置了：

```text
beforeBuildCommand = pnpm run prepare:resources
```

构建时会自动完成以下步骤：

1. 拉取或更新 AstrBot 源码。
2. 校验 packaged Core 至少为 `4.26.0`。
3. 从同一个 source checkout 构建并同步 `resources/webui`，写入 `assets/version`，校验 index 与本地 JavaScript/CSS 入口。
4. 准备 `resources/backend`（包括运行时与启动脚本），生成包含 Desktop/Core/source identity 的 `runtime-manifest.json`。
5. 把 WebUI version/index/入口摘要写入最终 manifest，并再次校验整套资源。
6. `src-tauri/build.rs` 把最终 manifest 的 SHA-256 编入可执行文件；release 构建缺少 manifest 时失败。
7. 执行 Tauri 打包。

运行时不会把 direct 与 `_up_/resources` 下的 backend/WebUI 混用。打包启动计划只接受 manifest 摘要与当前可执行文件一致的完整资源根，并在导航前核对运行中 backend 的公开版本、served index 和入口资产。主窗口 URL 使用该 manifest 摘要作为 `astrbot_bundle` 缓存身份。

补充说明：主窗口当前显式设置了 `backgroundThrottling = "disabled"`，用于缓解 macOS 上窗口隐藏或转入后台后 `WKWebView` 被系统节流/挂起导致的前端假死问题。根据当前 Tauri 2 配置能力，该选项在 macOS 14+ 上生效；更早版本的 macOS 会回退到系统默认后台策略。

## 7. CI 与发布说明

- stable（`tag-poll`）只选择 `vMAJOR.MINOR.PATCH` 格式的正式版本标签，忽略 beta、alpha、rc、dev、nightly 等预发布标签及其他非正式标签；没有正式标签时任务明确失败，不回退到预发布版本。
- 手动 `tag-poll` 的 `source_git_ref` 也只接受正式版本标签。需要打包预发布标签、分支或 commit 时使用 `custom`，不会更新 stable 通道。
- 定时构建（`schedule`）检测到上游新 tag 时，会先自动同步版本文件并提交，再继续构建。
- 手动触发（`workflow_dispatch`）默认只构建，不自动回写版本文件。
- Desktop 使用独立 updater manifest，不复用 AstrBot Core 的 `api.soulter.top/releases` 更新索引。
- stable/nightly 的更新入口分别为 `https://releases.astrbot.app/desktop/channels/stable/latest.json` 和 `https://github.com/AstrBotDevs/AstrBot-desktop/releases/download/nightly/latest-nightly.json`。
- GitHub Actions 会把完整安装包继续发布到 GitHub Releases，仅 stable（`tag-poll`）将 updater 产物上传到 Cloudflare R2：先上传并校验不可变的版本目录，再更新 GitHub Release，最后原子提升通道 manifest。
- nightly 的更新清单与更新包仅发布到 GitHub Releases，不上传 R2。
- R2 bucket、repository variables/secrets 和对象目录约定见 [`docs/environment-variables.md`](./environment-variables.md#4-发布ci-github-actions)。
- 发布与 updater 相关行为依赖 `src-tauri/tauri.conf.json`、GitHub Actions workflow 以及 `scripts/ci/generate_tauri_latest_json.py`、`scripts/ci/publish_r2_release.py` 共同完成。

## 8. 相关文档

- [`docs/architecture.md`](./architecture.md)：当前架构边界与主要流程。
- [`docs/repository-structure.md`](./repository-structure.md)：仓库目录职责总览。
- [`docs/environment-variables.md`](./environment-variables.md)：环境变量单一来源文档。
- [`docs/data-migration.md`](./data-migration.md)：桌面端与源码部署之间的数据迁移说明。
