# AstrBot React Dashboard

这是 AstrBot Dashboard 的 React + TypeScript 实现。所有启用路由均由 React 提供，新版开发和构建流程不再启动、构建或复制 Vue Dashboard。

旧版 `dashboard/` 仍作为只读的行为与样式参考保留，不属于新版运行时依赖。

请从仓库根目录使用统一命令启动或构建，详见 [`../docs/dashboard-react-migration.md`](../docs/dashboard-react-migration.md)。
迁移期 endpoint、存储和响应兼容层的删除条件见
[`../docs/dashboard-compatibility-exit-plan.md`](../docs/dashboard-compatibility-exit-plan.md)。

## 外部服务与链接配置

部署可变项统一通过 Vite 环境变量配置，完整示例见 [`.env.example`](./.env.example)：

- `VITE_ASTRBOT_ANNOUNCEMENT_ENABLED=false` 可供离线、自托管或隐私敏感环境完全关闭公告请求。
- 公告默认超时 3500ms、最多重试 1 次，并在 `sessionStorage` 缓存 6 小时；请求失败时使用已有缓存或返回空，不阻塞欢迎页。
- 公告请求不携带 Cookie、Authorization 或 referrer，也不会附加用户、实例和版本标识。
- `VITE_ASTRBOT_DOCS_URL` 与 `VITE_ASTRBOT_GITHUB_URL` 用于替换文档和项目地址；非法或非 HTTP(S) 配置会回退到官方地址。

稳定产品外链集中在 `src/config/links.ts`，远端运行时服务集中在
`src/config/externalServices.ts` 和 `src/services/announcementService.ts`。新增外链或服务时不要直接在页面中写 URL。

## 测试约定

测试默认与被测代码就近放置，便于功能迁移、重命名或删除时一起维护。文件名应准确表达测试层级：

- `Component.test.tsx` 必须渲染对应组件并验证用户可观察的交互或无障碍语义。
- 纯函数从大型组件抽到 `*Model.ts`，测试使用同名的 `*Model.test.ts`，不再伪装成组件测试。
- 跨路由、兼容退出条件等模块边界约束使用 `*.contract.test.ts`。
- HTTP 响应、Storage、i18n 和渲染 Provider 等共享夹具统一放在 `src/test`，页面测试不得重复声明或散布强制类型断言。

本地单元与 jsdom 交互测试使用 Node 20 执行：

```shell
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm quality
```

真实浏览器/E2E 属于后续独立测试层，不混入当前 Vitest 套件。
