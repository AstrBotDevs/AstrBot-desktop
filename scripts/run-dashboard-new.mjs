import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const runDashboardNew = ({
  projectRoot = path.resolve(import.meta.dirname, '..'),
  spawnCommand = spawn,
  spawnCommandSync = spawnSync,
  pathExists = existsSync,
  processLike = process,
  logger = console,
} = {}) => {
  const legacyDashboardDir = path.join(projectRoot, 'dashboard');
  const reactDashboardDir = path.join(projectRoot, 'new-dashboard');

  const runChecked = (command, args, cwd) => {
    const result = spawnCommandSync(command, args, {
      cwd,
      env: processLike.env,
      stdio: 'inherit',
      shell: processLike.platform === 'win32' && command === 'pnpm',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Command failed: ${command} ${args.join(' ')}`);
    }
  };

  const hasVite = (directory) => {
    const executable = processLike.platform === 'win32' ? 'vite.CMD' : 'vite';
    return pathExists(path.join(directory, 'node_modules', '.bin', executable));
  };

  const ensureInstalled = (directory, label) => {
    if (hasVite(directory)) return;

    logger.log(`[dashboard:new] Installing ${label} dependencies ...`);
    const args = ['--dir', directory, 'install'];
    if (pathExists(path.join(directory, 'pnpm-lock.yaml'))) {
      args.push('--frozen-lockfile');
    }
    runChecked('pnpm', args, directory);
  };

  const spawnPnpm = (args) => spawnCommand('pnpm', args, {
    cwd: projectRoot,
    env: processLike.env,
    stdio: 'inherit',
    shell: processLike.platform === 'win32',
  });

  try {
    ensureInstalled(legacyDashboardDir, 'legacy Dashboard');
    ensureInstalled(reactDashboardDir, 'React Dashboard');

    logger.log('[dashboard:new] Generating legacy MDI font subset ...');
    runChecked(
      processLike.execPath,
      [path.join(legacyDashboardDir, 'scripts', 'subset-mdi-font.mjs')],
      legacyDashboardDir,
    );
  } catch (error) {
    logger.error(
      '[dashboard:new] Failed to prepare development dependencies.',
      error instanceof Error ? error.message : error,
    );
    processLike.exit(1);
    return null;
  }

  logger.log('[dashboard:new] React entry: http://localhost:1420');
  logger.log('[dashboard:new] Read-only legacy compatibility server: http://localhost:1421/legacy/');

  const children = [
    spawnPnpm([
      '--dir',
      'dashboard',
      'exec',
      'vite',
      '--host',
      '--port',
      '1421',
      '--base=/legacy/',
    ]),
    spawnPnpm(['--dir', 'new-dashboard', 'dev']),
  ];

  let stopping = false;
  const stop = (exitCode = 0) => {
    if (stopping) return;
    stopping = true;
    for (const child of children) {
      if (!child.killed) child.kill();
    }
    processLike.exit(exitCode);
  };

  for (const child of children) {
    child.on('error', (error) => {
      logger.error(error);
      stop(1);
    });
    child.on('exit', (code, signal) => {
      if (stopping) return;
      logger.error(`[dashboard:new] A development server stopped (${signal || code}).`);
      stop(code ?? 1);
    });
  }

  processLike.on('SIGINT', () => stop(0));
  processLike.on('SIGTERM', () => stop(0));

  return { children, stop };
};

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) runDashboardNew();
