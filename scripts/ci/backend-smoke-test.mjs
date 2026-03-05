import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const defaultBackendDir = path.resolve('resources', 'backend');
const defaultWebuiDir = path.resolve('resources', 'webui');

const usageMessage = () => `
Usage: node scripts/ci/backend-smoke-test.mjs [options]

Options:
  --backend-dir <path>         Backend resources directory (default: resources/backend)
  --webui-dir <path>           WebUI resources directory (default: resources/webui)
  --startup-timeout-ms <ms>    Startup timeout in milliseconds (default: 45000)
  --poll-interval-ms <ms>      Readiness poll interval in milliseconds (default: 500)
  --label <name>               Optional log label
  -h, --help                   Show this message
`.trim();

const parseCliOptions = (argv) => {
  const parsed = {
    backendDir: defaultBackendDir,
    webuiDir: defaultWebuiDir,
    startupTimeoutMs: 45_000,
    pollIntervalMs: 500,
    label: '',
    showHelp: false,
  };

  const requireValue = (flag, index) => {
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      throw new Error(`Missing value for ${flag}.\n\n${usageMessage()}`);
    }
    return next;
  };

  const parsePositiveNumber = (flag, rawValue) => {
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Invalid numeric value for ${flag}: ${rawValue}\n\n${usageMessage()}`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      parsed.showHelp = true;
    } else if (arg === '--backend-dir') {
      const raw = requireValue(arg, i).trim();
      if (!raw) {
        throw new Error(`Empty value for ${arg}.\n\n${usageMessage()}`);
      }
      parsed.backendDir = path.resolve(raw);
      i += 1;
    } else if (arg === '--webui-dir') {
      const raw = requireValue(arg, i).trim();
      if (!raw) {
        throw new Error(`Empty value for ${arg}.\n\n${usageMessage()}`);
      }
      parsed.webuiDir = path.resolve(raw);
      i += 1;
    } else if (arg === '--startup-timeout-ms') {
      const raw = requireValue(arg, i);
      parsed.startupTimeoutMs = parsePositiveNumber(arg, raw);
      i += 1;
    } else if (arg === '--poll-interval-ms') {
      const raw = requireValue(arg, i);
      parsed.pollIntervalMs = parsePositiveNumber(arg, raw);
      i += 1;
    } else if (arg === '--label') {
      parsed.label = requireValue(arg, i);
      i += 1;
    } else {
      throw new Error(`Unsupported argument: ${arg}\n\n${usageMessage()}`);
    }
  }

  return parsed;
};

const getTracePrefix = (options) =>
  options.label ? `[backend-smoke:${options.label}]` : '[backend-smoke]';

const assertPathExists = (fsLike, targetPath, description) => {
  if (!fsLike.existsSync(targetPath)) {
    throw new Error(`${description} not found: ${targetPath}`);
  }
};

const reserveLoopbackPort = async () =>
  new Promise((resolve, reject) => {
    // NOTE: this reserve-then-bind pattern has a small race window by design.
    // If CI flakes with EADDRINUSE, prefer adding bind-retry logic in main().
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address !== 'object') {
        server.close(() => reject(new Error('Failed to reserve loopback port.')));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });

const fallbackFetch = async (url, options = {}) =>
  new Promise((resolve, reject) => {
    const urlObject = new URL(url);
    const client = urlObject.protocol === 'https:' ? https : http;
    const request = client.request(
      urlObject,
      {
        method: options.method || 'GET',
      },
      (response) => {
        response.resume();
        const status = response.statusCode || 0;
        resolve({
          status,
          ok: status >= 200 && status < 300,
        });
      },
    );

    request.on('error', reject);
    if (options.signal) {
      const onAbort = () => {
        request.destroy(new Error('Request aborted'));
      };
      if (options.signal.aborted) {
        onAbort();
      } else {
        options.signal.addEventListener('abort', onAbort, { once: true });
        request.on('close', () => options.signal?.removeEventListener('abort', onAbort));
      }
    }
    request.end();
  });

const getFetchImplementation = () => {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis);
  }
  return fallbackFetch;
};

const fetchWithTimeout = async (url, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fetchImpl = getFetchImplementation();
  try {
    return await fetchImpl(url, { method: 'GET', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const terminateChild = async (child, timeoutMs = 4_000) => {
  if (!child || child.exitCode !== null) {
    return;
  }
  child.kill();
  const start = Date.now();
  while (child.exitCode === null && Date.now() - start < timeoutMs) {
    await sleep(100);
  }
  if (child.exitCode === null) {
    if (process.platform === 'win32') {
      child.kill();
    } else {
      child.kill('SIGKILL');
    }
  }
};

const createMainRuntime = (overrides = {}) => ({
  fs,
  spawn,
  reserveLoopbackPort,
  fetchWithTimeout,
  terminateChild,
  sleep,
  now: () => Date.now(),
  mkdtempSync: (prefix) => fs.mkdtempSync(prefix),
  rmSync: (targetPath, options) => fs.rmSync(targetPath, options),
  tmpdir: () => os.tmpdir(),
  ...overrides,
});

const main = async (options, runtime = createMainRuntime()) => {
  const tracePrefix = getTracePrefix(options);
  const backendDir = options.backendDir;
  const webuiDir = options.webuiDir;
  const manifestPath = path.join(backendDir, 'runtime-manifest.json');
  const launcherPath = path.join(backendDir, 'launch_backend.py');
  const appMainPath = path.join(backendDir, 'app', 'main.py');

  assertPathExists(runtime.fs, backendDir, 'Backend directory');
  assertPathExists(runtime.fs, webuiDir, 'WebUI directory');
  assertPathExists(runtime.fs, manifestPath, 'Backend runtime manifest');
  assertPathExists(runtime.fs, launcherPath, 'Backend launcher');
  assertPathExists(runtime.fs, appMainPath, 'Backend app main.py');

  const manifest = JSON.parse(runtime.fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.python || typeof manifest.python !== 'string') {
    throw new Error(`Invalid runtime manifest python entry: ${manifestPath}`);
  }
  const pythonPath = path.join(backendDir, manifest.python);
  assertPathExists(runtime.fs, pythonPath, 'Runtime python executable');

  const dashboardPort = await runtime.reserveLoopbackPort();
  const backendRoot = runtime.mkdtempSync(
    path.join(runtime.tmpdir(), 'astrbot-backend-smoke-'),
  );
  const backendUrl = `http://127.0.0.1:${dashboardPort}/`;
  const childLogs = [];
  const maxLogLines = 200;
  const appendLog = (kind, chunk) => {
    const lines = String(chunk)
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);
    for (const line of lines) {
      childLogs.push(`${kind}: ${line}`);
      if (childLogs.length > maxLogLines) {
        childLogs.shift();
      }
    }
  };
  let spawnError = null;

  const child = runtime.spawn(
    pythonPath,
    [launcherPath, '--webui-dir', webuiDir],
    {
      cwd: backendRoot,
      env: {
        ...process.env,
        ASTRBOT_ROOT: backendRoot,
        ASTRBOT_DESKTOP_CLIENT: '1',
        ASTRBOT_WEBUI_DIR: webuiDir,
        DASHBOARD_HOST: '127.0.0.1',
        DASHBOARD_PORT: String(dashboardPort),
        PYTHONUNBUFFERED: '1',
        PYTHONUTF8: process.env.PYTHONUTF8 || '1',
        PYTHONIOENCODING: process.env.PYTHONIOENCODING || 'utf-8',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  child.stdout?.on('data', (chunk) => appendLog('stdout', chunk));
  child.stderr?.on('data', (chunk) => appendLog('stderr', chunk));
  child.on('error', (error) => {
    const message = error instanceof Error ? error.message : String(error);
    spawnError = error instanceof Error ? error : new Error(message);
    appendLog('spawn-error', message);
  });

  console.log(
    `${tracePrefix} started backend pid=${child.pid} url=${backendUrl} root=${backendRoot}`,
  );

  const deadline = runtime.now() + options.startupTimeoutMs;
  let ready = false;
  let lastProbeError = '';

  try {
    while (runtime.now() < deadline) {
      if (spawnError) {
        throw new Error(`Failed to spawn backend process: ${spawnError.message}`);
      }
      if (child.exitCode !== null) {
        throw new Error(
          `Backend exited before readiness check passed (exit=${child.exitCode}).`,
        );
      }

      try {
        const response = await runtime.fetchWithTimeout(backendUrl, 1_200);
        if (response.ok) {
          ready = true;
          break;
        }
        lastProbeError = `HTTP ${response.status}`;
      } catch (error) {
        lastProbeError = error instanceof Error ? error.message : String(error);
      }
      await runtime.sleep(options.pollIntervalMs);
    }

    if (!ready) {
      throw new Error(
        `Backend did not become HTTP-reachable within ${options.startupTimeoutMs}ms (${lastProbeError || 'no response'}).`,
      );
    }

    // Keep the process alive for a short extra window to catch immediate crash loops.
    await runtime.sleep(1_200);
    if (child.exitCode !== null) {
      throw new Error(`Backend crashed after readiness (exit=${child.exitCode}).`);
    }
    console.log(`${tracePrefix} backend startup smoke test passed.`);
  } catch (error) {
    const details = childLogs.length
      ? `\n${tracePrefix} recent backend logs:\n${childLogs.join('\n')}`
      : '';
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${tracePrefix} ${reason}${details}`);
  } finally {
    await runtime.terminateChild(child);
    runtime.rmSync(backendRoot, { recursive: true, force: true });
  }
};

const runCli = async (argv = process.argv.slice(2), runtime = {}) => {
  const executeMain = runtime.executeMain || main;
  const log = runtime.log || console.log;
  const logError = runtime.logError || console.error;
  const addrInUseRetries = Number.isInteger(runtime.addrInUseRetries)
    ? runtime.addrInUseRetries
    : 1;
  const isAddressInUseError = (message) => /EADDRINUSE|address already in use/i.test(message);

  let options;
  try {
    options = parseCliOptions(argv);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logError(`[backend-smoke] FAILED: ${reason}`);
    return 1;
  }

  if (options.showHelp) {
    log(usageMessage());
    return 0;
  }

  const tracePrefix = getTracePrefix(options);
  let lastError = null;
  for (let attempt = 0; attempt <= addrInUseRetries; attempt += 1) {
    try {
      await executeMain(options);
      return 0;
    } catch (error) {
      lastError = error;
      const reason = error instanceof Error ? error.message : String(error);
      if (attempt < addrInUseRetries && isAddressInUseError(reason)) {
        log(`${tracePrefix} detected EADDRINUSE, retrying startup (${attempt + 1}/${addrInUseRetries}).`);
        continue;
      }
      if (reason.startsWith(tracePrefix)) {
        logError(reason);
      } else {
        logError(`${tracePrefix} FAILED: ${reason}`);
      }
      return 1;
    }
  }

  const fallbackReason = lastError instanceof Error ? lastError.message : String(lastError);
  logError(`${tracePrefix} FAILED: ${fallbackReason}`);
  return 1;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitCode = await runCli();
  process.exit(exitCode);
}

export { createMainRuntime, main, parseCliOptions, runCli, usageMessage };
