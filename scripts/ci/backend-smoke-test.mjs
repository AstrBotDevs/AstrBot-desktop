import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
const defaultBackendDir = path.resolve('resources', 'backend');
const defaultWebuiDir = path.resolve('resources', 'webui');

const options = {
  backendDir: defaultBackendDir,
  webuiDir: defaultWebuiDir,
  startupTimeoutMs: 45_000,
  pollIntervalMs: 500,
  label: '',
};

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--backend-dir') {
    options.backendDir = path.resolve(args[++i] ?? '');
  } else if (arg === '--webui-dir') {
    options.webuiDir = path.resolve(args[++i] ?? '');
  } else if (arg === '--startup-timeout-ms') {
    options.startupTimeoutMs = Number(args[++i] ?? options.startupTimeoutMs);
  } else if (arg === '--poll-interval-ms') {
    options.pollIntervalMs = Number(args[++i] ?? options.pollIntervalMs);
  } else if (arg === '--label') {
    options.label = args[++i] ?? '';
  } else {
    throw new Error(`Unsupported argument: ${arg}`);
  }
}

const tracePrefix = options.label ? `[backend-smoke:${options.label}]` : '[backend-smoke]';

const assertPathExists = (targetPath, description) => {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`${description} not found: ${targetPath}`);
  }
};

const reserveLoopbackPort = async () =>
  new Promise((resolve, reject) => {
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

const fetchWithTimeout = async (url, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { method: 'GET', signal: controller.signal });
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
    child.kill('SIGKILL');
  }
};

const main = async () => {
  const backendDir = options.backendDir;
  const webuiDir = options.webuiDir;
  const manifestPath = path.join(backendDir, 'runtime-manifest.json');
  const launcherPath = path.join(backendDir, 'launch_backend.py');
  const appMainPath = path.join(backendDir, 'app', 'main.py');

  assertPathExists(backendDir, 'Backend directory');
  assertPathExists(webuiDir, 'WebUI directory');
  assertPathExists(manifestPath, 'Backend runtime manifest');
  assertPathExists(launcherPath, 'Backend launcher');
  assertPathExists(appMainPath, 'Backend app main.py');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.python || typeof manifest.python !== 'string') {
    throw new Error(`Invalid runtime manifest python entry: ${manifestPath}`);
  }
  const pythonPath = path.join(backendDir, manifest.python);
  assertPathExists(pythonPath, 'Runtime python executable');

  const dashboardPort = await reserveLoopbackPort();
  const backendRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'astrbot-backend-smoke-'));
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

  const child = spawn(
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

  console.log(
    `${tracePrefix} started backend pid=${child.pid} url=${backendUrl} root=${backendRoot}`,
  );

  const deadline = Date.now() + options.startupTimeoutMs;
  let ready = false;
  let lastProbeError = '';

  try {
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(
          `Backend exited before readiness check passed (exit=${child.exitCode}).`,
        );
      }

      try {
        const response = await fetchWithTimeout(backendUrl, 1_200);
        if (response.status >= 200 && response.status < 500) {
          ready = true;
          break;
        }
        lastProbeError = `HTTP ${response.status}`;
      } catch (error) {
        lastProbeError = error instanceof Error ? error.message : String(error);
      }
      await sleep(options.pollIntervalMs);
    }

    if (!ready) {
      throw new Error(
        `Backend did not become HTTP-reachable within ${options.startupTimeoutMs}ms (${lastProbeError || 'no response'}).`,
      );
    }

    // Keep the process alive for a short extra window to catch immediate crash loops.
    await sleep(1_200);
    if (child.exitCode !== null) {
      throw new Error(`Backend crashed after readiness (exit=${child.exitCode}).`);
    }
    console.log(`${tracePrefix} backend startup smoke test passed.`);
  } catch (error) {
    const details = childLogs.length
      ? `\n${tracePrefix} recent backend logs:\n${childLogs.join('\n')}`
      : '';
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${reason}${details}`);
  } finally {
    await terminateChild(child);
    fs.rmSync(backendRoot, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(`${tracePrefix} FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
