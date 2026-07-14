import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const legacyDashboardDir = path.join(projectRoot, 'dashboard');
const reactDashboardDir = path.join(projectRoot, 'new-dashboard');

const runChecked = (command, args, cwd) => {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32' && command === 'pnpm',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
};

const hasVite = (directory) => {
  const executable = process.platform === 'win32' ? 'vite.CMD' : 'vite';
  return existsSync(path.join(directory, 'node_modules', '.bin', executable));
};

const ensureInstalled = (directory, label) => {
  if (hasVite(directory)) return;

  console.log(`[dashboard:new] Installing ${label} dependencies ...`);
  const args = ['--dir', directory, 'install'];
  if (existsSync(path.join(directory, 'pnpm-lock.yaml'))) {
    args.push('--frozen-lockfile');
  }
  runChecked('pnpm', args, directory);
};

const spawnPnpm = (args) => spawn('pnpm', args, {
  cwd: projectRoot,
  env: process.env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

try {
  ensureInstalled(legacyDashboardDir, 'legacy Dashboard');
  ensureInstalled(reactDashboardDir, 'React Dashboard');

  console.log('[dashboard:new] Generating legacy MDI font subset ...');
  runChecked(
    process.execPath,
    [path.join(legacyDashboardDir, 'scripts', 'subset-mdi-font.mjs')],
    legacyDashboardDir,
  );
} catch (error) {
  console.error(
    '[dashboard:new] Failed to prepare development dependencies.',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
}

console.log('[dashboard:new] React entry: http://localhost:1420');
console.log('[dashboard:new] Read-only legacy compatibility server: http://localhost:1421/legacy/');

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
  process.exit(exitCode);
};

for (const child of children) {
  child.on('error', (error) => {
    console.error(error);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`[dashboard:new] A development server stopped (${signal || code}).`);
    stop(code ?? 1);
  });
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
