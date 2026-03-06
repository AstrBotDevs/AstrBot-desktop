# Release Updater Artifacts Design

## Context

GitHub Actions 的 `Publish GitHub Release` job 在生成 `latest.json` 时失败，因为发布阶段拿到的构建产物里没有 updater 签名文件。进一步检查表明：

- Windows build 只上传了 `.exe`，没有上传对应的 `.exe.sig`
- macOS build 只上传了手工打包的 `.zip`，没有上传 Tauri updater 真实需要的 `.app.tar.gz` 与 `.app.tar.gz.sig`
- 发布脚本的文件名匹配仍停留在旧格式，和当前规范化后的命名不一致

## Approaches

### A. 只补上传规则

只在 workflow 里把 `.sig` 补上传。

- 优点：改动最少
- 缺点：`latest.json` 生成脚本仍无法识别当前命名；macOS 仍缺少正确的 updater bundle

### B. 补上传规则 + 同步脚本命名规则（推荐）

同时修复 workflow 和发布脚本：

- Windows 上传 `.exe.sig`
- macOS 上传带架构信息的 `.app.tar.gz` / `.app.tar.gz.sig`
- 规范化脚本同步处理 updater bundle 与 `.sig`
- `latest.json` 生成脚本支持当前 canonical 名称

优点：直接修掉这次失败，并让发布链路和当前 Tauri updater 产物保持一致。

### C. 重做发布阶段脚本

单独重写 release job 的产物收集与 metadata 生成逻辑。

- 优点：可彻底重整流程
- 缺点：改动面太大，不适合当前这个 CI bugfix

## Approved Direction

采用方案 B：最小范围修复 workflow 与脚本，并增加回归测试覆盖发布产物规范化和 `latest.json` 生成链路。
