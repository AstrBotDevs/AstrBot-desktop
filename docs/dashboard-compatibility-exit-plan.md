# React Dashboard 迁移兼容代码退出计划

## 目标版本与判定原则

迁移兼容层计划在 `dashboard 2.0.0` 移除。删除前必须同时满足：

1. 产品声明的最低 AstrBot Core 版本已经包含对应的 v1 API 或稳定数据契约。
2. 至少一个稳定发布周期内未收到旧分支命中报告，并完成旧 Core、升级中断和浏览器存储升级场景回归。
3. Vue Dashboard 回退窗口已经由维护者明确关闭。

当前仓库只声明兼容 AstrBot Core 4.x，没有更精确的后端最低版本合同。因此，表中的“Core 4.x
兼容基线”是继续保留兼容的最低版本，不代表可以立即删除；维护者提高产品最低 Core 版本时，必须在同一
PR 中填入已验证的精确版本并执行删除检查。

## 兼容项登记表

| ID | 位置与当前依赖 | 当前后端最低版本 | 移除条件 | 目标版本 |
| --- | --- | --- | --- | --- |
| `api-endpoint-fallback` | `dashboard/src/api/compat.ts`、`dashboard/src/api/auth.ts`：认证、版本、统计、更新与 pip 操作先请求 v1，只有 v1 返回 404 或历史 `Missing API key` 响应时请求 unversioned endpoint | Core 4.x 兼容基线 | 产品最低 Core 版本提供登记的全部 v1 endpoint；404/缺 key 回退连续一个稳定周期为零；认证、更新、重启回归通过 | dashboard 2.0.0 |
| `legacy-recovery` | `dashboard/src/api/compat.ts`、`dashboard/src/auth/upgradeRecovery.ts`：WebUI 已更新但 Core 进程未重启时，以 token 请求 `/api/stat/version`、`start-time`、`restart-core` | Core 4.x 兼容基线 | 更新流程保证 WebUI/Core 原子切换，或最低 Core 提供不依赖当前进程版本的 v1 恢复端点；升级中断测试通过 | dashboard 2.0.0 |
| `legacy-storage` | `dashboard/src/config/storageKeys.ts`、`preferences.ts`、`stores/layout.ts`：读取并双写 Vue 使用的 `uiTheme`；其他 `token`、`user`、聊天和代理 key 是新旧 Dashboard 的共享持久化合同，不是可直接删除的双写 | 不依赖后端 | `themeMode` 已随一个稳定版本写入用户浏览器；Vue 回退窗口关闭；删除 `uiTheme` 读取、双写和对应测试后，明暗/跟随系统主题回归通过 | dashboard 2.0.0 |
| `response-envelope` | `dashboard/src/api/response.ts`、`dashboard/src/desktop/DesktopProvider.tsx`：兼容 Axios 外层 `data`、API envelope 和桌面端历史嵌套 envelope | OpenAPI v1 合同，Core 4.x 兼容基线 | 所有启用 endpoint 和桌面桥使用单一生成类型；移除兼容分支后 API、桌面启动及错误 envelope 测试通过 | dashboard 2.0.0 |
| `legacy-chat-files` | `dashboard/src/config/endpoints.ts`、`dashboard/src/routes/chat/ChatMessageList.tsx`：聊天附件仍使用 `/api/chat/attachment` 与 `/api/chat/get_file`，当前没有双请求 | Core 4.x 兼容基线 | 后端提供并发布等价 v1 文件 endpoint，产品最低 Core 版本包含它；历史消息附件回归通过 | 后端 v1 文件 API 发布后的下一个 dashboard major |
| `persistence-envelope` | `dashboard/src/config/persistence.ts`：把未版本化 localStorage 值一次性迁移为 `{ data, version }` | 不依赖后端 | 所有受支持浏览器数据至少经历一个稳定迁移周期，且产品接受清除更旧的本地偏好 | dashboard 2.0.0 |

样式中的 `legacy-resource-*`、`legacy-fab-stack` 以及 Vue 迁移说明不承担运行时兼容职责，已在建立本计划时
改为领域命名；以后不允许以 `legacy` 或 `Vue` 注释代替明确的兼容登记。

## 回退触发合同

所有 v1→unversioned 双请求由 `src/api/compat.ts` 的 `compatibleRequest` 执行：

- HTTP 404：说明当前 Core 没有该 v1 route，可以回退。
- 历史 `Missing API key` 错误：说明旧 Core 的鉴权中间件误拦截 v1 route，可以回退。
- 401、403、5xx、网络错误、超时及其他业务错误：不得回退，必须向调用方暴露原错误，避免重复副作用。

页面、store 和组件不得自行发起双请求，也不得新增 unversioned endpoint 字面量。确需新增时，必须在
`compat.ts` 或 `config/endpoints.ts` 登记，并在本表补充最低版本、移除条件、目标版本和测试。

## 删除检查单

1. 将产品支持的最低 Core 版本更新为已验证的精确版本。
2. 删除 `compatibilityExitPlan` 中到期项及其 endpoint、旧 key、旧 envelope 分支。
3. 删除对应 fallback 测试，改为断言只发出一次 v1 请求。
4. 搜索 `legacy`、`uiTheme`、unversioned `/api/` 和 Vue 迁移注释，逐项确认没有孤立代码。
5. 验证登录/登出、首次设置、TOTP、账号修改、统计、更新、升级中断、主题迁移和历史聊天附件。
6. 运行 `pnpm quality`，并在发布说明中记录不再支持的 Core/浏览器存储版本。
