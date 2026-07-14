import { spawn } from 'node:child_process';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');

const spawnPnpm = (args) => spawn('pnpm', args, {
  cwd: projectRoot,
  env: process.env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

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
