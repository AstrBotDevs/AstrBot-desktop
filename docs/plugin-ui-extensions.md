# 插件界面扩展

AstrBot Desktop 允许用户逐个授权插件，把插件提供的 JavaScript 加载到 Desktop 主窗口。该机制用于需要增强主界面的插件，不会改变 Core 的插件接口，也不会让扩展脚本在普通浏览器部署中自动生效。

## 1. 能力检测与脚本接口

Desktop 启动托管后端时会写入：

```text
ASTRBOT_DESKTOP_PLUGIN_UI_EXTENSIONS=1
```

开发态和打包态都会写入该变量。插件应据此判断当前 Desktop 是否支持界面扩展，不要根据 Core 或 Desktop 版本号猜测。

插件通过 Core 的鉴权扩展路由提供固定地址：

```text
GET /api/v1/plugins/extensions/{plugin_name}/desktop-ui-extension.js
```

插件名必须匹配：

```text
^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$
```

Desktop 使用当前登录令牌请求插件列表和脚本，并发送 `Cache-Control: no-store`。脚本响应必须满足：

- HTTP 状态为成功。
- `Content-Type` 包含 `javascript`，例如 `application/javascript; charset=utf-8`。
- 内容非空；流式读取时累计正文实际字节数，超过 `8 MiB` 立即取消读取，不信任 `Content-Length`。
- 从发出请求到读完内容不超过 `8` 秒；插件列表请求同样受此限制。

Core 在扩展路由不存在时也可能返回 HTTP 200 和 JSON 错误，因此插件必须返回正确的 JavaScript `Content-Type`，调用方也必须检查它。插件列表或脚本请求失败、超时、类型不符或内容不合格时，Desktop 只记录警告，不执行对应内容，也不阻断其他插件或原有桥接功能。

## 2. 用户授权与加载条件

总开关“允许插件界面扩展”默认开启，但持久授权名单默认为空，因此初始状态不会加载任何插件脚本。只有同时满足以下条件才会加载：

1. 托盘总开关开启。
2. 用户已在原生确认框中逐个授权该插件。
3. Core 插件列表中该插件的 `activated` 为 `true`。
4. 脚本接口通过上述响应检查。

授权名单保存在 `data/desktop_state.json` 的 `pluginUiExtensionGrants` 中，总开关保存在 `pluginUiExtensionsEnabled` 中。

- 拒绝或关闭确认框后，本次 Desktop 进程内不会再次询问同一插件；重启 Desktop 后可以重试。
- 关闭总开关不会删除授权名单，重新开启后仍可恢复。
- 托盘的“清除插件界面授权”会清空持久名单，但不改变总开关。
- 停用或撤销授权会完整刷新主窗口。已经执行的脚本无法安全地“反执行”，因此需要刷新才能使其失效。

授权成功后 Desktop 会重新检查总开关、持久名单和 Core 启用状态，再加载脚本。同一页面中，同一插件的脚本最多插入一次。

## 3. 设置页请求授权

插件设置页 iframe 可以向父页面发送以下消息：

```json
{
  "type": "astrbot-desktop:plugin-ui-extension-request",
  "requestId": "由本次请求生成的唯一 ID"
}
```

Desktop 在主文档中查找 `contentWindow === event.source` 的 iframe，并从该 iframe 的同源 `/api/v1/plugins/{plugin_name}/views/` 地址解析插件名。消息中自报的插件名或脚本内容不会被信任。

Desktop 只向原请求来源回复：

```json
{
  "type": "astrbot-desktop:plugin-ui-extension-response",
  "requestId": "与请求相同的 ID",
  "granted": true,
  "reason": "granted"
}
```

`reason` 可能为：

- `granted`：已授权，可以等待 Desktop 完成加载。
- `invalid`：未能识别合法插件身份。
- `disabled`：托盘总开关已关闭。
- `declined`：用户拒绝，或本次运行中已经拒绝过。
- `busy`：另一个授权确认框正在等待处理。
- `error`：原生任务或授权持久化失败。

设置页的 sandbox 不包含 `allow-same-origin`，其 origin 是 opaque origin，所以 Desktop 回复时使用 `targetOrigin: '*'`。响应只包含上述授权结果，不包含令牌或设置内容；插件仍应校验 `event.source`、消息类型和 `requestId`。

最小请求示例：

```js
function requestDesktopUiExtension() {
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    const timeout = setTimeout(() => {
      cleanup();
      resolve({ granted: false, reason: 'timeout' });
    }, 60_000);

    function cleanup() {
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
    }

    function onMessage(event) {
      if (event.source !== window.parent) return;
      const data = event.data;
      if (
        data?.type !== 'astrbot-desktop:plugin-ui-extension-response' ||
        data.requestId !== requestId
      ) {
        return;
      }
      cleanup();
      resolve({ granted: data.granted === true, reason: data.reason });
    }

    window.addEventListener('message', onMessage);
    window.parent.postMessage(
      {
        type: 'astrbot-desktop:plugin-ui-extension-request',
        requestId,
      },
      '*',
    );
  });
}
```

建议至少等待 60 秒，让用户有时间阅读原生确认框。超时、页面离开或开始新请求时应清理旧监听器；迟到响应不得覆盖新请求的状态。

## 4. 安全边界与安装目录

扩展脚本在已登录的 AstrBot 主页面中运行，拥有与当前登录 WebUI 相同的权限。插件本来就会在服务器端执行代码，但用户仍必须明确知道界面脚本的能力，只应授权信任的插件。

当 `ASTRBOT_DESKTOP_CLIENT=1` 时，插件不得修改 Desktop 安装目录中的 WebUI 或其他资源。界面扩展通过 Desktop 自身的桥接加载，不是绕过安装资源完整性校验的后门；首页、入口资源和清单校验保持原样。
