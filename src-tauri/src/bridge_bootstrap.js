(() => {
  if (typeof window === 'undefined') return;

  // Desktop windows use an overlay title bar, so the web UI has to reserve room
  // for native window controls: traffic lights top-left on macOS, and the
  // min/max/close caption buttons top-right on Windows.
  const ua = window.navigator?.userAgent || '';
  if (/Mac OS X|Macintosh/i.test(ua)) {
    document.documentElement.dataset.astrbotDesktopPlatform = 'macos';
  } else if (/Windows/i.test(ua)) {
    document.documentElement.dataset.astrbotDesktopPlatform = 'windows';
  } else if (/Linux/i.test(ua)) {
    document.documentElement.dataset.astrbotDesktopPlatform = 'linux';
  }

  const invoke = window.__TAURI_INTERNALS__?.invoke;
  const transformCallback = window.__TAURI_INTERNALS__?.transformCallback;
  const tauriEvent = window.__TAURI_INTERNALS__?.event ?? window.__TAURI__?.event;
  if (typeof invoke !== 'function') return;

  const BRIDGE_COMMANDS = Object.freeze({
    IS_DESKTOP_RUNTIME: 'desktop_bridge_is_desktop_runtime',
    GET_BACKEND_STATE: 'desktop_bridge_get_backend_state',
    GET_AUTH_TOKEN: 'desktop_bridge_get_auth_token',
    SET_AUTH_TOKEN: 'desktop_bridge_set_auth_token',
    SET_SHELL_LOCALE: 'desktop_bridge_set_shell_locale',
    GET_APP_UPDATE_CHANNEL: 'desktop_bridge_get_app_update_channel',
    SET_APP_UPDATE_CHANNEL: 'desktop_bridge_set_app_update_channel',
    RESTART_BACKEND: 'desktop_bridge_restart_backend',
    STOP_BACKEND: 'desktop_bridge_stop_backend',
    PICK_DIRECTORY: 'desktop_bridge_pick_directory',
    GET_PLUGIN_UI_EXTENSIONS: 'desktop_bridge_get_plugin_ui_extensions',
    REQUEST_PLUGIN_UI_EXTENSION: 'desktop_bridge_request_plugin_ui_extension',
    OPEN_EXTERNAL_URL: 'desktop_bridge_open_external_url',
    OPEN_REPAIR_INSTALL: 'desktop_bridge_open_repair_install',
    CHECK_APP_UPDATE: 'desktop_bridge_check_app_update',
    INSTALL_APP_UPDATE: 'desktop_bridge_install_app_update',
    SET_WINDOW_THEME: 'desktop_bridge_set_window_theme',
    MINIMIZE_WINDOW: 'desktop_bridge_minimize_window',
    TOGGLE_MAXIMIZE_WINDOW: 'desktop_bridge_toggle_maximize_window',
    CLOSE_WINDOW: 'desktop_bridge_close_window',
  });
  const PLUGIN_UI_EXTENSION_STATE_KEY = '__astrbotDesktopPluginUiExtensionState';

  function triggerPluginUiExtensions(force = false) {
    const load = window[PLUGIN_UI_EXTENSION_STATE_KEY]?.load;
    if (typeof load === 'function') {
      void load({ force });
    }
  }

  function initializePluginUiExtensions() {
    const state =
      window[PLUGIN_UI_EXTENSION_STATE_KEY] ||
      (window[PLUGIN_UI_EXTENSION_STATE_KEY] = {
        listenerInstalled: false,
        loadedPlugins: new Set(),
        pendingPlugins: new Map(),
        discoveryPromise: null,
        discoveryToken: null,
        discoveryQueued: false,
        completedToken: null,
        load: null,
      });
    const pluginNamePattern = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
    const requestType = 'astrbot-desktop:plugin-ui-extension-request';
    const responseType = 'astrbot-desktop:plugin-ui-extension-response';
    const fetchTimeoutMs = 8000;
    const maxScriptBytes = 8 * 1024 * 1024;

    const warn = (message, error) => {
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn(`[astrbotDesktop] ${message}`, error ?? '');
      }
    };
    const readToken = () => {
      try {
        const token = window.localStorage?.getItem('token');
        return typeof token === 'string' && token ? token : null;
      } catch {
        return null;
      }
    };
    const invokePluginCommand = async (command, payload = {}) => {
      try {
        return await invoke(command, payload);
      } catch (error) {
        warn(`${command} failed`, error);
        return null;
      }
    };
    // The timeout stays armed until readResponse finishes, so a body that stalls
    // after its headers is aborted as well.
    const fetchWithTimeout = async (url, token, readResponse) => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), fetchTimeoutMs);
      try {
        const response = await window.fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            'Cache-Control': 'no-store',
          },
          signal: controller.signal,
        });
        return await readResponse(response);
      } finally {
        window.clearTimeout(timeout);
      }
    };

    const loadPlugin = (plugin, token) => {
      if (state.loadedPlugins.has(plugin)) return Promise.resolve();
      if (state.pendingPlugins.has(plugin)) return state.pendingPlugins.get(plugin);

      const pending = (async () => {
        const source = await fetchWithTimeout(
          `/api/v1/plugins/extensions/${encodeURIComponent(plugin)}/desktop-ui-extension.js`,
          token,
          async (response) => {
            if (!response.ok) throw new Error(`script request returned HTTP ${response.status}`);
            const contentType = response.headers.get('content-type') || '';
            if (!contentType.toLowerCase().includes('javascript')) {
              throw new Error(`unexpected script Content-Type: ${contentType || 'missing'}`);
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let bytes = 0;
            let source = '';
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                bytes += value.byteLength;
                if (bytes > maxScriptBytes) {
                  await reader.cancel();
                  throw new Error('script exceeds 8 MiB');
                }
                source += decoder.decode(value, { stream: true });
              }
              return source + decoder.decode();
            } finally {
              reader.releaseLock();
            }
          },
        );
        if (!source.trim()) throw new Error('script is empty');
        if (state.loadedPlugins.has(plugin)) return;

        const script = document.createElement('script');
        script.textContent = source;
        script.setAttribute('data-astrbot-plugin-ui-extension', plugin);
        document.head.appendChild(script);
        state.loadedPlugins.add(plugin);
      })()
        .catch((error) => {
          warn(`plugin UI extension failed for ${plugin}`, error);
        })
        .finally(() => {
          state.pendingPlugins.delete(plugin);
        });
      state.pendingPlugins.set(plugin, pending);
      return pending;
    };

    const loadPluginUiExtensions = ({ force = false } = {}) => {
      const token = readToken();
      if (token && !force && state.completedToken === token) return Promise.resolve();
      if (state.discoveryPromise) {
        if (force || state.discoveryToken !== token) state.discoveryQueued = true;
        return state.discoveryPromise;
      }

      const promise = (async () => {
        const settings = await invokePluginCommand(BRIDGE_COMMANDS.GET_PLUGIN_UI_EXTENSIONS);
        if (settings?.enabled === false) {
          if (token) state.completedToken = token;
          return;
        }
        if (settings?.enabled !== true || !Array.isArray(settings.plugins)) {
          throw new Error('invalid plugin UI extension settings response');
        }
        if (settings.plugins.length === 0) {
          if (token) state.completedToken = token;
          return;
        }
        if (!token) return;

        const payload = await fetchWithTimeout('/api/v1/plugins', token, (response) => {
          if (!response.ok) throw new Error(`plugin list returned HTTP ${response.status}`);
          return response.json();
        });
        if (!Array.isArray(payload?.data)) throw new Error('invalid plugin list response');
        const grants = new Set(
          settings.plugins.filter(
            (plugin) => typeof plugin === 'string' && pluginNamePattern.test(plugin),
          ),
        );
        const targets = new Set();
        for (const item of payload.data) {
          const plugin = item?.name;
          if (
            item?.activated === true &&
            typeof plugin === 'string' &&
            pluginNamePattern.test(plugin) &&
            grants.has(plugin)
          ) {
            targets.add(plugin);
          }
        }
        await Promise.all([...targets].map((plugin) => loadPlugin(plugin, token)));
        state.completedToken = token;
      })()
        .catch((error) => {
          warn('plugin UI extension discovery failed', error);
        })
        .finally(() => {
          if (state.discoveryPromise === promise) state.discoveryPromise = null;
          if (state.discoveryQueued) {
            state.discoveryQueued = false;
            void loadPluginUiExtensions({ force: true });
          }
        });
      state.discoveryToken = token;
      state.discoveryPromise = promise;
      return promise;
    };
    state.load = loadPluginUiExtensions;

    const handleMessage = async (event) => {
      const data = event?.data;
      if (!data || data.type !== requestType) return;
      if (typeof document.querySelectorAll !== 'function') return;
      const frame = [...document.querySelectorAll('iframe')].find(
        (candidate) => candidate.contentWindow === event.source,
      );
      if (!frame) return;

      let plugin;
      try {
        const url = new URL(frame.src, window.location.href);
        if (url.origin !== window.location.origin) return;
        const match = /^\/api\/v1\/plugins\/([^/]+)\/views\//.exec(url.pathname);
        if (!match) return;
        plugin = decodeURIComponent(match[1]);
      } catch {
        return;
      }
      if (!pluginNamePattern.test(plugin)) return;

      const result = await invokePluginCommand(BRIDGE_COMMANDS.REQUEST_PLUGIN_UI_EXTENSION, {
        plugin,
      });
      const granted = result?.granted === true;
      const reason = typeof result?.reason === 'string' ? result.reason : 'error';
      event.source.postMessage(
        {
          type: responseType,
          requestId: data.requestId,
          granted,
          reason,
        },
        '*',
      );
      if (granted) void loadPluginUiExtensions({ force: true });
    };

    if (!state.listenerInstalled && typeof window.addEventListener === 'function') {
      window.addEventListener('message', (event) => {
        void handleMessage(event).catch((error) => {
          warn('plugin UI extension authorization response failed', error);
        });
      });
      state.listenerInstalled = true;
    }
    void loadPluginUiExtensions();
  }

  initializePluginUiExtensions();

  const existingTrayRestartState = window.__astrbotDesktopTrayRestartState;
  if (
    window.astrbotDesktop &&
    window.astrbotDesktop.__tauriBridge === true &&
    typeof window.astrbotDesktop.onTrayRestartBackend === 'function' &&
    typeof existingTrayRestartState?.unlistenTrayRestartBackendEvent === 'function'
  ) {
    return;
  }
  const TRAY_RESTART_BACKEND_EVENT = '{TRAY_RESTART_BACKEND_EVENT}';

  const invokeBridge = async (command, payload = {}) => {
    try {
      return await invoke(command, payload);
    } catch (error) {
      return { ok: false, reason: String(error) };
    }
  };

  const createLegacyEventListener = async (eventName, handler) => {
    if (typeof transformCallback !== 'function') {
      throw new Error(
        'No supported Tauri event listener API: expected tauriEvent.listen or __TAURI_INTERNALS__.invoke + transformCallback'
      );
    }

    let eventId;
    try {
      eventId = await invoke('plugin:event|listen', {
        event: eventName,
        target: { kind: 'Any' },
        handler: transformCallback(handler),
      });
    } catch (error) {
      throw new Error(`plugin:event|listen failed: ${String(error)}`);
    }

    return async () => {
      try {
        window.__TAURI_EVENT_PLUGIN_INTERNALS__?.unregisterListener?.(eventName, eventId);
      } catch {}
      try {
        await invoke('plugin:event|unlisten', {
          event: eventName,
          eventId,
        });
      } catch {}
    };
  };

  const createEventListener = async (eventName, handler) => {
    if (typeof tauriEvent?.listen === 'function') {
      return tauriEvent.listen(eventName, handler);
    }
    return createLegacyEventListener(eventName, handler);
  };

  const trayRestartState =
    window.__astrbotDesktopTrayRestartState ||
    (window.__astrbotDesktopTrayRestartState = {
      handlers: new Set(),
      pending: 0,
      lastToken: 0,
      unlistenTrayRestartBackendEvent: null
    });
  if (
    typeof trayRestartState.lastToken !== 'number' ||
    !Number.isFinite(trayRestartState.lastToken)
  ) {
    trayRestartState.lastToken = 0;
  }
  if (typeof trayRestartState.unlistenTrayRestartBackendEvent === 'undefined') {
    trayRestartState.unlistenTrayRestartBackendEvent = null;
  }

  const shouldEmitForToken = (token) => {
    const numericToken = Number(token);
    if (Number.isFinite(numericToken) && numericToken > 0) {
      if (numericToken <= trayRestartState.lastToken) return false;
      trayRestartState.lastToken = numericToken;
      return true;
    } else {
      trayRestartState.lastToken += 1;
      return true;
    }
  };

  const emitTrayRestart = (token = null) => {
    if (!shouldEmitForToken(token)) return;

    if (trayRestartState.handlers.size === 0) {
      trayRestartState.pending = Number(trayRestartState.pending || 0) + 1;
      return;
    }
    for (const handler of trayRestartState.handlers) {
      try {
        handler();
      } catch {}
    }
  };

  const onTrayRestartBackend = (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = () => callback();
    trayRestartState.handlers.add(handler);
    while (trayRestartState.pending > 0) {
      trayRestartState.pending -= 1;
      handler();
    }
    return () => {
      trayRestartState.handlers.delete(handler);
    };
  };

  const listenToTrayRestartBackendEvent = async () => {
    if (typeof trayRestartState.unlistenTrayRestartBackendEvent === 'function') return;
    try {
      const unlisten = await createEventListener(TRAY_RESTART_BACKEND_EVENT, (event) => {
        emitTrayRestart(event?.payload);
      });
      if (typeof unlisten === 'function') {
        trayRestartState.unlistenTrayRestartBackendEvent = unlisten;
      }
    } catch (error) {
      console.warn('Failed to listen for tray restart backend event', error);
    }
  };

  const TOKEN_STORAGE_KEY = 'token';
  const USER_STORAGE_KEY = 'user';
  const SHELL_LOCALE_STORAGE_KEY = 'astrbot-locale';
  const DESKTOP_AUTH_BOOTSTRAP_RELOAD_KEY =
    'astrbot:desktop-auth-bootstrap-reloaded:v1';
  const DESKTOP_AUTH_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
  // Values are injected from the shared desktop bridge transport contract.
  const CHAT_TRANSPORT = Object.freeze({
    STORAGE_KEY: '{CHAT_TRANSPORT_MODE_STORAGE_KEY}',
    WEBSOCKET: '{CHAT_TRANSPORT_MODE_WEBSOCKET}',
  });
  const STORAGE_SYNC_PATCHED_FLAG = '__astrbotDesktopStorageSyncPatched';
  const LEGACY_TOKEN_SYNC_PATCHED_FLAG = '__astrbotDesktopTokenSyncPatched';

  const normalizeStoredValue = (value) =>
    typeof value === 'string' && value ? value : null;

  const getStoredValue = (storageKey) => {
    try {
      return normalizeStoredValue(window.localStorage?.getItem(storageKey));
    } catch {
      return null;
    }
  };

  const getStoredAuthToken = () => getStoredValue(TOKEN_STORAGE_KEY);

  const syncAuthToken = (value = getStoredAuthToken()) =>
    invokeBridge(BRIDGE_COMMANDS.SET_AUTH_TOKEN, {
      authToken: value,
    });
  const syncShellLocale = (value = getStoredValue(SHELL_LOCALE_STORAGE_KEY)) =>
    invokeBridge(BRIDGE_COMMANDS.SET_SHELL_LOCALE, {
      locale: value,
    });

  const shouldReloadAfterDesktopAuthBootstrap = () => {
    try {
      const storage = window.sessionStorage;
      if (!storage) return false;
      if (storage.getItem(DESKTOP_AUTH_BOOTSTRAP_RELOAD_KEY) === 'true') {
        return false;
      }
      storage.setItem(DESKTOP_AUTH_BOOTSTRAP_RELOAD_KEY, 'true');
      return true;
    } catch {
      return false;
    }
  };

  let desktopAuthRefreshPromise = null;
  const refreshDesktopAuthSession = () => {
    if (desktopAuthRefreshPromise) {
      return desktopAuthRefreshPromise;
    }

    desktopAuthRefreshPromise = (async () => {
      const result = await invokeBridge(BRIDGE_COMMANDS.GET_AUTH_TOKEN);
      const token = normalizeStoredValue(result?.token);
      const username = normalizeStoredValue(result?.username);
      if (!result?.ok || !token || !username) {
        devWarn(
          'astrbotDesktop: desktop passwordless authentication unavailable',
          result?.reason,
        );
        return result;
      }

      try {
        window.localStorage?.setItem(USER_STORAGE_KEY, username);
        window.localStorage?.setItem(TOKEN_STORAGE_KEY, token);
        window.localStorage?.removeItem('change_pwd_hint');
        window.localStorage?.removeItem('md5_pwd_hint');
        window.localStorage?.removeItem('password_upgrade_required');
      } catch (error) {
        devWarn('astrbotDesktop: failed to persist desktop authentication', error);
        return { ok: false, reason: 'Unable to persist desktop authentication.' };
      }

      await syncAuthToken(token);
      triggerPluginUiExtensions();
      // The dashboard waits for its initial router navigation before mounting Vue.
      // Changing the auth hash while that navigation is still in flight can leave
      // #app empty in WKWebView. Reload once after persisting the desktop session
      // so the dashboard starts with a stable token instead.
      if (shouldReloadAfterDesktopAuthBootstrap()) {
        window.location.reload();
        return result;
      }
      if (
        document.getElementById('app')?.hasChildNodes() &&
        /^#\/auth\/(?:login|setup)(?:[/?]|$)/.test(window.location.hash || '')
      ) {
        window.location.hash = '/welcome';
      }
      return result;
    })()
      .catch((error) => {
        devWarn('astrbotDesktop: failed to refresh desktop authentication', error);
        return { ok: false, reason: 'Unable to refresh desktop authentication.' };
      })
      .finally(() => {
        desktopAuthRefreshPromise = null;
      });

    return desktopAuthRefreshPromise;
  };

  const IS_DEV =
    (typeof process !== 'undefined' &&
      process.env &&
      process.env.NODE_ENV !== 'production') ||
    (typeof __DEV__ !== 'undefined' && __DEV__ === true);
  const devWarn = (...args) => {
    if (!IS_DEV) return;
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn(...args);
    }
  };
  const safePatch = (label, patchFn) => {
    try {
      patchFn();
    } catch (error) {
      if (!(error instanceof TypeError)) {
        throw error;
      }
      devWarn(`astrbotDesktop: failed to patch ${label}`, error);
    }
  };
  const warnExternalUrlBridgeError = (phase, url, error) => {
    devWarn('[astrbotDesktop] openExternalUrl bridge failure', {
      phase,
      url,
      error,
    });
  };
  const warnDefaultChatTransportModeError = (phase, error) => {
    devWarn('[astrbotDesktop] failed to seed default chat transport mode', {
      phase,
      error,
    });
  };

  const normalizeExternalHttpUrl = (rawUrl) => {
    if (rawUrl instanceof URL) {
      if (rawUrl.protocol !== 'http:' && rawUrl.protocol !== 'https:') return null;
      return rawUrl;
    }

    if (typeof rawUrl !== 'string') return null;

    const normalized = rawUrl.trim();
    if (!normalized) return null;

    try {
      const url = new URL(normalized, window.location.href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      return url;
    } catch {
      return null;
    }
  };

  const openExternalUrl = (rawUrl) => {
    const url = normalizeExternalHttpUrl(rawUrl);
    if (!url) return false;
    if (url.origin === window.location.origin) {
      return false;
    }

    const bridgeOpenExternalUrl =
      typeof window.astrbotDesktop?.openExternalUrl === 'function'
        ? window.astrbotDesktop.openExternalUrl.bind(window.astrbotDesktop)
        : null;
    if (!bridgeOpenExternalUrl) return false;
    const href = url.toString();
    const isBridgeFailureResult = (result) =>
      !!result &&
      typeof result === 'object' &&
      Object.prototype.hasOwnProperty.call(result, 'ok') &&
      result.ok === false;

    try {
      const bridgeResult = bridgeOpenExternalUrl(href);
      if (bridgeResult && typeof bridgeResult.then === 'function') {
        Promise.resolve(bridgeResult)
          .then((result) => {
            if (isBridgeFailureResult(result)) {
              warnExternalUrlBridgeError('result', href, result.reason ?? result);
            }
          })
          .catch((error) => {
            warnExternalUrlBridgeError('async', href, error);
          });
        return true;
      }
      if (isBridgeFailureResult(bridgeResult)) {
        warnExternalUrlBridgeError('result', href, bridgeResult.reason ?? bridgeResult);
        return false;
      }
      return true;
    } catch (error) {
      warnExternalUrlBridgeError('sync', href, error);
      return false;
    }
  };

  const findAnchorFromEvent = (event) => {
    const target = event.target;
    if (target instanceof Element && typeof target.closest === 'function') {
      const direct = target.closest('a[href]');
      if (direct instanceof HTMLAnchorElement) return direct;
    }
    // Support anchors inside shadow DOM by walking the composed event path.
    if (typeof event.composedPath === 'function') {
      for (const node of event.composedPath()) {
        if (node instanceof HTMLAnchorElement && node.hasAttribute('href')) {
          return node;
        }
      }
    }
    return null;
  };
  const patchLocationHref = (locationObject) => {
    const descriptor =
      Object.getOwnPropertyDescriptor(locationObject, 'href') ||
      Object.getOwnPropertyDescriptor(window.Location?.prototype ?? {}, 'href');
    const nativeHrefGetter =
      descriptor && typeof descriptor.get === 'function'
        ? descriptor.get.bind(locationObject)
        : null;
    const nativeHrefSetter =
      descriptor && typeof descriptor.set === 'function'
        ? descriptor.set.bind(locationObject)
        : null;
    if (!nativeHrefSetter) return;

    safePatch('location.href', () => {
      Object.defineProperty(locationObject, 'href', {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get() {
          if (nativeHrefGetter) {
            return nativeHrefGetter();
          }
          return locationObject.toString();
        },
        set(url) {
          if (openExternalUrl(url)) {
            return;
          }
          nativeHrefSetter(url);
        },
      });
    });
  };

  // Best-effort fake Window-like handle for callers that only check `closed` and `location.href`.
  const createWindowOpenHandle = (url) => {
    let closed = false;
    const locationProxy = {
      href: String(url ?? ''),
    };
    return {
      get closed() {
        return closed;
      },
      set closed(value) {
        closed = !!value;
      },
      close: () => {
        closed = true;
      },
      focus: () => {},
      location: locationProxy,
      opener: null,
    };
  };

  const installExternalAnchorInterceptor = () => {
    document.addEventListener(
      'click',
      (event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }

        const anchor = findAnchorFromEvent(event);
        if (!anchor) return;
        if (anchor.hasAttribute('download')) return;
        const rawHref = anchor.getAttribute('href') || anchor.href || '';
        if (!openExternalUrl(rawHref)) return;

        event.preventDefault();
      },
      true,
    );
  };

  const installWindowOpenBridge = () => {
    const nativeWindowOpen =
      typeof window.open === 'function' ? window.open.bind(window) : null;

    const bridgeWindowOpen = (url, target, features) => {
      if (target === '_self' || target === '_top' || target === '_parent') {
        if (nativeWindowOpen) {
          return nativeWindowOpen(url, target, features);
        }
        return null;
      }

      if (openExternalUrl(url)) {
        // Lightweight window-like handle for callers that only check basic fields.
        return createWindowOpenHandle(url);
      }

      if (nativeWindowOpen) {
        return nativeWindowOpen(url, target, features);
      }
      return null;
    };

    if (nativeWindowOpen) {
      safePatch('window.__astrbotNativeWindowOpen', () => {
        Object.defineProperty(window, '__astrbotNativeWindowOpen', {
          configurable: true,
          writable: false,
          enumerable: false,
          value: nativeWindowOpen,
        });
      });
    }

    safePatch('window.open', () => {
      window.open = bridgeWindowOpen;
    });
  };

  const installLocationNavigationBridge = () => {
    const locationObject = window.location;
    const nativeAssign =
      typeof locationObject.assign === 'function'
        ? locationObject.assign.bind(locationObject)
        : null;
    const nativeReplace =
      typeof locationObject.replace === 'function'
        ? locationObject.replace.bind(locationObject)
        : null;

    if (nativeAssign) {
      safePatch('location.assign', () => {
        locationObject.assign = (url) => {
          if (openExternalUrl(url)) {
            return;
          }
          nativeAssign(url);
        };
      });
    }

    if (nativeReplace) {
      safePatch('location.replace', () => {
        locationObject.replace = (url) => {
          if (openExternalUrl(url)) {
            return;
          }
          nativeReplace(url);
        };
      });
    }

    patchLocationHref(locationObject);
  };
  let navigationBridgesInstalled = false;
  const installNavigationBridges = () => {
    if (navigationBridgesInstalled) return;
    navigationBridgesInstalled = true;
    installWindowOpenBridge();
    installExternalAnchorInterceptor();
    installLocationNavigationBridge();
  };

  const RUNTIME_BRIDGE_DETAIL_MAX_LENGTH = 240;
  const RUNTIME_BRIDGE_DETAIL_MAX_ITEMS = 8;
  const RUNTIME_BRIDGE_TRUE_STRINGS = new Set(['1', 'true', 'yes', 'on']);
  const RUNTIME_BRIDGE_FALSE_STRINGS = new Set(['0', 'false', 'no', 'off']);
  const RUNTIME_BRIDGE_SENSITIVE_KEY_PATTERN =
    /(token|secret|password|passwd|authorization|cookie|api[_-]?key|access[_-]?key|refresh[_-]?token|credential)/i;

  const truncateRuntimeBridgeDetail = (value) => {
    if (typeof value !== 'string') {
      return value;
    }
    if (value.length <= RUNTIME_BRIDGE_DETAIL_MAX_LENGTH) {
      return value;
    }
    return `${value.slice(0, RUNTIME_BRIDGE_DETAIL_MAX_LENGTH)}...`;
  };

  const isSensitiveRuntimeBridgeKey = (key) =>
    typeof key === 'string' && RUNTIME_BRIDGE_SENSITIVE_KEY_PATTERN.test(key);

  const summarizeRuntimeBridgeValue = (value, depth = 0) => {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value;
    }

    if (value instanceof Error) {
      return truncateRuntimeBridgeDetail(`${value.name}: ${value.message}`);
    }

    if (typeof value === 'undefined') {
      return '[undefined]';
    }

    if (typeof value === 'function') {
      return '[function]';
    }

    if (typeof value !== 'object') {
      return `[${typeof value}]`;
    }

    if (depth >= 1) {
      return Array.isArray(value) ? `[array:${value.length}]` : '[object]';
    }

    if (Array.isArray(value)) {
      const sample = value
        .slice(0, RUNTIME_BRIDGE_DETAIL_MAX_ITEMS)
        .map((item) => summarizeRuntimeBridgeValue(item, depth + 1));
      if (value.length > sample.length) {
        sample.push(`[+${value.length - sample.length} items]`);
      }
      return sample;
    }

    const keys = Object.keys(value);
    const sampledKeys = keys.slice(0, RUNTIME_BRIDGE_DETAIL_MAX_ITEMS);
    const sampled = {};
    for (const key of sampledKeys) {
      if (isSensitiveRuntimeBridgeKey(key)) {
        sampled[key] = '[redacted]';
        continue;
      }
      sampled[key] = summarizeRuntimeBridgeValue(value[key], depth + 1);
    }
    if (keys.length > sampledKeys.length) {
      sampled.__omittedKeys = keys.length - sampledKeys.length;
    }
    return sampled;
  };

  const stringifyRuntimeBridgeDetail = (value) => {
    if (!value || typeof value !== 'object') {
      return `type=${Object.prototype.toString.call(value)}`;
    }

    try {
      return truncateRuntimeBridgeDetail(
        JSON.stringify(summarizeRuntimeBridgeValue(value)),
      );
    } catch {
      return `type=${Object.prototype.toString.call(value)}`;
    }
  };

  const sanitizeRuntimeBridgeDetail = (detail) => {
    if (detail instanceof Error) {
      return truncateRuntimeBridgeDetail(`${detail.name}: ${detail.message}`);
    }

    if (typeof detail === 'string') {
      return truncateRuntimeBridgeDetail(detail);
    }

    if (typeof detail === 'number' || typeof detail === 'boolean') {
      return String(detail);
    }

    if (detail && typeof detail === 'object') {
      const hasReason = typeof detail.reason === 'string' && detail.reason;
      const hasOk = typeof detail.ok === 'boolean';
      if (hasReason || hasOk) {
        const summary = [];
        if (hasOk) {
          summary.push(`ok=${detail.ok}`);
        }
        if (hasReason) {
          summary.push(`reason=${detail.reason}`);
        }
        return truncateRuntimeBridgeDetail(summary.join(' '));
      }
      return stringifyRuntimeBridgeDetail(detail);
    }

    return String(detail);
  };

  const logRuntimeBridgeFallback = (command, fallbackValue, detail) => {
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      const sanitizedDetail = sanitizeRuntimeBridgeDetail(detail);
      console.warn(
        `[astrbotDesktop] ${command} fallback to ${fallbackValue}`,
        sanitizedDetail,
      );
    }
  };

  const getStrictBooleanFallback = (command, fallbackValue) => {
    if (typeof fallbackValue === 'boolean') {
      return fallbackValue;
    }
    if (typeof fallbackValue === 'undefined') {
      return false;
    }
    if (fallbackValue === null) {
      return false;
    }
    if (typeof fallbackValue === 'number') {
      if (fallbackValue === 1) {
        return true;
      }
      if (fallbackValue === 0) {
        return false;
      }
      logRuntimeBridgeFallback(
        command,
        false,
        `invalid numeric fallback (${fallbackValue}), force false`,
      );
      return false;
    }
    if (typeof fallbackValue === 'string') {
      const normalized = fallbackValue.trim().toLowerCase();
      if (RUNTIME_BRIDGE_TRUE_STRINGS.has(normalized)) {
        return true;
      }
      if (RUNTIME_BRIDGE_FALSE_STRINGS.has(normalized)) {
        return false;
      }
      logRuntimeBridgeFallback(
        command,
        false,
        `invalid string fallback (${truncateRuntimeBridgeDetail(fallbackValue)}), force false`,
      );
      return false;
    }

    logRuntimeBridgeFallback(
      command,
      false,
      `invalid fallback type (${typeof fallbackValue}), force false`,
    );
    return false;
  };

  const isRuntimeBridgeEnabled = async (command, fallbackValue) => {
    const normalizedFallback = getStrictBooleanFallback(command, fallbackValue);

    try {
      const result = await invokeBridge(command);
      if (typeof result === 'boolean') {
        return result;
      }
      logRuntimeBridgeFallback(
        command,
        normalizedFallback,
        `non-boolean result: ${String(result)}`,
      );
    } catch (error) {
      logRuntimeBridgeFallback(command, normalizedFallback, error);
    }

    return normalizedFallback;
  };

  const patchLocalStorageBridgeSync = () => {
    if (window[STORAGE_SYNC_PATCHED_FLAG]) {
      return;
    }
    // Legacy compatibility: migrate the old guard flag to the new canonical flag.
    if (window[LEGACY_TOKEN_SYNC_PATCHED_FLAG]) {
      window[STORAGE_SYNC_PATCHED_FLAG] = true;
      return;
    }
    try {
      const storage = window.localStorage;
      if (!storage) return;
      window[STORAGE_SYNC_PATCHED_FLAG] = true;
      window[LEGACY_TOKEN_SYNC_PATCHED_FLAG] = true;

      const rawSetItem = storage.setItem?.bind(storage);
      const rawRemoveItem = storage.removeItem?.bind(storage);
      const rawClear = storage.clear?.bind(storage);

      if (typeof rawSetItem === 'function') {
        storage.setItem = (key, value) => {
          rawSetItem(key, value);
          if (key === TOKEN_STORAGE_KEY) {
            void syncAuthToken(getStoredValue(TOKEN_STORAGE_KEY));
            triggerPluginUiExtensions();
          } else if (key === SHELL_LOCALE_STORAGE_KEY) {
            void syncShellLocale(getStoredValue(SHELL_LOCALE_STORAGE_KEY));
          }
        };
      }
      if (typeof rawRemoveItem === 'function') {
        storage.removeItem = (key) => {
          rawRemoveItem(key);
          if (key === TOKEN_STORAGE_KEY) {
            void syncAuthToken(null);
            void refreshDesktopAuthSession();
          } else if (key === SHELL_LOCALE_STORAGE_KEY) {
            void syncShellLocale(null);
          }
        };
      }
      if (typeof rawClear === 'function') {
        storage.clear = () => {
          rawClear();
          void syncAuthToken(null);
          void syncShellLocale(null);
          void refreshDesktopAuthSession();
        };
      }
    } catch {}
  };

  const ensureDefaultChatTransportMode = () => {
    let storage;
    try {
      storage = window.localStorage;
    } catch (error) {
      warnDefaultChatTransportModeError('storage', error);
      return;
    }
    if (!storage) return;

    let existingTransportMode;
    try {
      existingTransportMode = storage.getItem(CHAT_TRANSPORT.STORAGE_KEY);
    } catch (error) {
      warnDefaultChatTransportModeError('read', error);
      return;
    }
    if (existingTransportMode !== null) return;

    try {
      storage.setItem(CHAT_TRANSPORT.STORAGE_KEY, CHAT_TRANSPORT.WEBSOCKET);
    } catch (error) {
      warnDefaultChatTransportModeError('write', error);
    }
  };

  window.astrbotDesktop = {
    __tauriBridge: true,
    isDesktop: true,
    isDesktopRuntime: () =>
      isRuntimeBridgeEnabled(BRIDGE_COMMANDS.IS_DESKTOP_RUNTIME, true),
    getBackendState: () => invokeBridge(BRIDGE_COMMANDS.GET_BACKEND_STATE),
    refreshAuthSession: refreshDesktopAuthSession,
    restartBackend: async (authToken = null) => {
      const normalizedToken =
        typeof authToken === 'string' && authToken ? authToken : getStoredAuthToken();
      await syncAuthToken(normalizedToken);
      return invokeBridge(BRIDGE_COMMANDS.RESTART_BACKEND, {
        authToken: normalizedToken
      });
    },
    stopBackend: () => invokeBridge(BRIDGE_COMMANDS.STOP_BACKEND),
    setWindowTheme: (theme) =>
      invokeBridge(BRIDGE_COMMANDS.SET_WINDOW_THEME, {
        theme: typeof theme === 'string' ? theme : null,
      }),
    minimizeWindow: () => invokeBridge(BRIDGE_COMMANDS.MINIMIZE_WINDOW),
    toggleMaximizeWindow: () => invokeBridge(BRIDGE_COMMANDS.TOGGLE_MAXIMIZE_WINDOW),
    closeWindow: () => invokeBridge(BRIDGE_COMMANDS.CLOSE_WINDOW),
    pickDirectory: async (defaultPath = null) => {
      const result = await invokeBridge(BRIDGE_COMMANDS.PICK_DIRECTORY, {
        defaultPath: typeof defaultPath === 'string' ? defaultPath : null,
      });
      return typeof result === 'string' ? result : null;
    },
    openExternalUrl: (url) => {
      const rawUrl = typeof url === 'string' ? url : String(url ?? '');
      if (!rawUrl.trim()) {
        return Promise.resolve({
          ok: true,
          reason: null,
        });
      }
      return invokeBridge(BRIDGE_COMMANDS.OPEN_EXTERNAL_URL, {
        url: rawUrl,
      });
    },
    openRepairInstall: () => invokeBridge(BRIDGE_COMMANDS.OPEN_REPAIR_INSTALL),
    onTrayRestartBackend,
  };

  window.astrbotAppUpdater = {
    getUpdateChannel: () => invokeBridge(BRIDGE_COMMANDS.GET_APP_UPDATE_CHANNEL),
    setUpdateChannel: (channel) =>
      invokeBridge(BRIDGE_COMMANDS.SET_APP_UPDATE_CHANNEL, {
        channel: typeof channel === 'string' ? channel : String(channel ?? ''),
      }),
    checkForAppUpdate: () => invokeBridge(BRIDGE_COMMANDS.CHECK_APP_UPDATE),
    installAppUpdate: async (onProgress) => {
      let unlisten;
      try {
        if (typeof onProgress === 'function') {
          try {
            // Subscribe before invoking so the first download event is not lost.
            unlisten = await createEventListener('astrbot://app-update-progress', (event) => {
              try { onProgress(event?.payload); } catch {}
            });
          } catch (error) {
            console.warn('Failed to listen for app update progress', error);
          }
        }
        return await invokeBridge(BRIDGE_COMMANDS.INSTALL_APP_UPDATE);
      } finally {
        if (typeof unlisten === 'function') {
          try { await unlisten(); } catch {}
        }
      }
    },
  };

  installNavigationBridges();
  void listenToTrayRestartBackendEvent();
  patchLocalStorageBridgeSync();
  ensureDefaultChatTransportMode();
  void syncAuthToken();
  void syncShellLocale();
  void refreshDesktopAuthSession();
  window.setInterval(refreshDesktopAuthSession, DESKTOP_AUTH_REFRESH_INTERVAL_MS);
})();
