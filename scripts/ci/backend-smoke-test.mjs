import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const defaultBackendDir = path.resolve('resources', 'backend');
const defaultWebuiDir = path.resolve('resources', 'webui');
const versionsPath = '/api/v1/stats/versions';
const webuiIndexPath = '/index.html';
const maxVersionsResponseBytes = 64 * 1024;
const maxIndexResponseBytes = 4 * 1024 * 1024;
// Keep this in sync with MAX_BACKEND_HTTP_BODY_BYTES in src-tauri/src/backend/http.rs
// so a resource accepted by release smoke checks cannot fail runtime identity verification.
const maxEntryResponseBytes = 32 * 1024 * 1024;
const sha256Pattern = /^[0-9a-f]{64}$/;

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

const sha256 = (content) => createHash('sha256').update(content).digest('hex');

const normalizeVersion = (value, field) => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  const normalized = trimmed.replace(/^v/i, '');
  if (!normalized) {
    throw new Error(`Backend runtime manifest ${field} must not be empty.`);
  }
  return normalized;
};

const normalizeSha256 = (value, field) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!sha256Pattern.test(normalized)) {
    throw new Error(`Backend runtime manifest ${field} must be a SHA-256 digest.`);
  }
  return normalized;
};

const normalizeEntryPath = (value) => {
  const raw = typeof value === 'string' ? value.trim() : '';
  const portable = raw.replaceAll('\\', '/');
  const segments = portable.split('/');
  if (
    !portable ||
    raw.includes('\0') ||
    path.posix.isAbsolute(portable) ||
    path.win32.parse(raw).root ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(
      'Backend runtime manifest webui.entryAssets[].path must be a canonical relative path.',
    );
  }
  const extension = path.posix.extname(portable).toLowerCase();
  if (extension !== '.js' && extension !== '.css') {
    throw new Error(
      `Backend runtime manifest contains unsupported WebUI entry asset: ${raw}`,
    );
  }
  return portable;
};

const parseRuntimeIdentityManifest = (manifest, manifestPath) => {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`Invalid backend runtime manifest: ${manifestPath}`);
  }
  const coreVersion = normalizeVersion(manifest.coreVersion, 'coreVersion');
  const attestation = manifest.webui;
  if (!attestation || typeof attestation !== 'object' || Array.isArray(attestation)) {
    throw new Error(
      `Backend runtime manifest is missing the WebUI bundle attestation: ${manifestPath}`,
    );
  }
  const webuiVersion = normalizeVersion(attestation.version, 'webui.version');
  if (webuiVersion !== coreVersion) {
    throw new Error(
      `Backend runtime manifest Core/WebUI version mismatch: Core is ${coreVersion}, WebUI is ${webuiVersion}.`,
    );
  }
  const indexSha256 = normalizeSha256(attestation.indexSha256, 'webui.indexSha256');
  if (!Array.isArray(attestation.entryAssets)) {
    throw new Error('Backend runtime manifest webui.entryAssets must be an array.');
  }

  const seenPaths = new Set();
  let hasJavascriptEntry = false;
  const entryAssets = attestation.entryAssets.map((entry) => {
    const entryPath = normalizeEntryPath(entry?.path);
    if (seenPaths.has(entryPath)) {
      throw new Error(
        `Backend runtime manifest contains duplicate WebUI entry asset: ${entryPath}`,
      );
    }
    seenPaths.add(entryPath);
    hasJavascriptEntry ||= entryPath.toLowerCase().endsWith('.js');
    return {
      path: entryPath,
      sha256: normalizeSha256(entry?.sha256, 'webui.entryAssets[].sha256'),
    };
  });
  if (!hasJavascriptEntry) {
    throw new Error('Backend runtime manifest WebUI attestation has no JavaScript entry asset.');
  }

  return { coreVersion, indexSha256, entryAssets };
};

const fetchIdentityBytesWithTimeout = async (url, timeoutMs, maxResponseBytes) =>
  new Promise((resolve, reject) => {
    const urlObject = new URL(url);
    const client = urlObject.protocol === 'https:' ? https : http;
    let settled = false;
    let timer = null;
    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const request = client.request(
      urlObject,
      {
        method: 'GET',
        headers: {
          Accept: '*/*',
          'Accept-Encoding': 'identity',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      },
      (response) => {
        const contentEncoding = String(response.headers['content-encoding'] || '')
          .trim()
          .toLowerCase();
        if (contentEncoding && contentEncoding !== 'identity') {
          finish(reject, new Error(`Unexpected Content-Encoding: ${contentEncoding}`));
          response.destroy();
          return;
        }
        const declaredLength = Number(response.headers['content-length']);
        if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
          finish(
            reject,
            new Error(
              `Response exceeds ${maxResponseBytes} bytes (Content-Length: ${declaredLength}).`,
            ),
          );
          response.destroy();
          return;
        }

        const chunks = [];
        let receivedBytes = 0;
        response.on('data', (chunk) => {
          receivedBytes += chunk.length;
          if (receivedBytes > maxResponseBytes) {
            finish(
              reject,
              new Error(`Response exceeds ${maxResponseBytes} bytes while streaming.`),
            );
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          finish(resolve, {
            status: response.statusCode || 0,
            ok: Boolean(
              response.statusCode &&
                response.statusCode >= 200 &&
                response.statusCode < 300,
            ),
            body: Buffer.concat(chunks),
          });
        });
        response.on('aborted', () => {
          finish(reject, new Error('Response ended before the complete body was received.'));
        });
        response.on('close', () => {
          if (!response.complete) {
            finish(reject, new Error('Response closed before the complete body was received.'));
          }
        });
        response.on('error', (error) => finish(reject, error));
      },
    );
    timer = setTimeout(() => {
      request.destroy(new Error(`Request timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    request.on('error', (error) => finish(reject, error));
    request.end();
  });

const requestIdentityResource = async ({
  backendUrl,
  requestPath,
  description,
  timeoutMs,
  maxResponseBytes,
  notFoundMessage = '',
  runtime,
}) => {
  const url = new URL(requestPath, backendUrl).href;
  let response;
  try {
    response = await runtime.fetchIdentityBytesWithTimeout(
      url,
      timeoutMs,
      maxResponseBytes,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot fetch ${description} at ${requestPath}: ${reason}`);
  }
  if (!response.ok) {
    if (response.status === 404 && notFoundMessage) {
      throw new Error(notFoundMessage);
    }
    throw new Error(
      `Cannot fetch ${description} at ${requestPath}: HTTP ${response.status}.`,
    );
  }
  return response.body;
};

const normalizeRunningVersion = (value, field) => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  const normalized = trimmed.replace(/^v/i, '');
  if (!normalized) {
    throw new Error(`Running backend version field ${field} is missing or empty.`);
  }
  return normalized;
};

const verifyRunningResourceIdentity = async ({
  backendUrl,
  expectedIdentity,
  timeoutMs,
  runtime,
}) => {
  const deadline = Date.now() + timeoutMs;
  const remainingTimeoutMs = () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`Running resource identity check timed out after ${timeoutMs}ms.`);
    }
    return remaining;
  };
  const versionsBody = await requestIdentityResource({
    backendUrl,
    requestPath: versionsPath,
    description: 'running AstrBot resource versions',
    timeoutMs: remainingTimeoutMs(),
    maxResponseBytes: maxVersionsResponseBytes,
    runtime,
  });
  let versionsPayload;
  try {
    versionsPayload = JSON.parse(versionsBody.toString('utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Running AstrBot resource versions response is invalid JSON: ${reason}`);
  }
  if (versionsPayload?.status !== 'ok' || !versionsPayload.data) {
    throw new Error(
      'Running AstrBot resource versions endpoint did not return status=ok with data.',
    );
  }
  const runningVersions = {
    core: normalizeRunningVersion(
      versionsPayload.data.astrbot_version,
      'astrbot_version',
    ),
    code: normalizeRunningVersion(
      versionsPayload.data.astrbot_code_version,
      'astrbot_code_version',
    ),
    webui: normalizeRunningVersion(
      versionsPayload.data.webui_version,
      'webui_version',
    ),
  };
  if (
    runningVersions.core !== expectedIdentity.coreVersion ||
    runningVersions.code !== expectedIdentity.coreVersion ||
    runningVersions.webui !== expectedIdentity.coreVersion
  ) {
    throw new Error(
      `Running Core/WebUI version mismatch: expected ${expectedIdentity.coreVersion}, got Core ${runningVersions.core}, code ${runningVersions.code}, WebUI ${runningVersions.webui}.`,
    );
  }

  const indexBody = await requestIdentityResource({
    backendUrl,
    requestPath: webuiIndexPath,
    description: 'running WebUI index',
    timeoutMs: remainingTimeoutMs(),
    maxResponseBytes: maxIndexResponseBytes,
    runtime,
  });
  const runningIndexSha256 = sha256(indexBody);
  if (runningIndexSha256 !== expectedIdentity.indexSha256) {
    throw new Error(
      `Running WebUI index SHA-256 mismatch: expected ${expectedIdentity.indexSha256}, got ${runningIndexSha256}.`,
    );
  }

  for (const entry of expectedIdentity.entryAssets) {
    const requestPath = `/${entry.path
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')}`;
    const entryBody = await requestIdentityResource({
      backendUrl,
      requestPath,
      description: `running WebUI entry ${entry.path}`,
      timeoutMs: remainingTimeoutMs(),
      maxResponseBytes: maxEntryResponseBytes,
      notFoundMessage: `Running WebUI entry is missing: ${entry.path}.`,
      runtime,
    });
    const runningEntrySha256 = sha256(entryBody);
    if (runningEntrySha256 !== entry.sha256) {
      throw new Error(
        `Running WebUI entry SHA-256 mismatch for ${entry.path}: expected ${entry.sha256}, got ${runningEntrySha256}.`,
      );
    }
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
  fetchIdentityBytesWithTimeout,
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

  let manifest;
  try {
    manifest = JSON.parse(runtime.fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid backend runtime manifest: ${manifestPath} (${reason})`);
  }
  if (!manifest.python || typeof manifest.python !== 'string') {
    throw new Error(`Invalid runtime manifest python entry: ${manifestPath}`);
  }
  const expectedIdentity = parseRuntimeIdentityManifest(manifest, manifestPath);
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
    const identityTimeoutMs = Math.min(
      10_000,
      Math.max(1_200, options.startupTimeoutMs),
    );
    await verifyRunningResourceIdentity({
      backendUrl,
      expectedIdentity,
      timeoutMs: identityTimeoutMs,
      runtime,
    });
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

export {
  createMainRuntime,
  fetchIdentityBytesWithTimeout,
  main,
  parseCliOptions,
  parseRuntimeIdentityManifest,
  runCli,
  usageMessage,
  verifyRunningResourceIdentity,
};
