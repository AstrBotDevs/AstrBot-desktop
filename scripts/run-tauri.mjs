import { spawnSync } from 'node:child_process';

import { loadProjectEnv } from './project-env.mjs';

const subcommand = process.argv[2];
if (!['dev', 'build'].includes(subcommand)) {
  throw new Error('Expected a Tauri subcommand: dev or build.');
}

loadProjectEnv();
if (subcommand === 'dev') {
  const { ensureDevSource } = await import('./ensure-dev-source.mjs');
  process.env.ASTRBOT_SOURCE_DIR = ensureDevSource();
  process.env.ASTRBOT_BACKEND_TIMEOUT_MS ??= '120000';
}

const tauriArgs = ['tauri', subcommand];
if (subcommand === 'build' && !process.env.TAURI_SIGNING_PRIVATE_KEY?.trim()) {
  console.warn(
    '[build] TAURI_SIGNING_PRIVATE_KEY is not set; building installers without signed updater artifacts.',
  );
  tauriArgs.push(
    '--config',
    JSON.stringify({ bundle: { createUpdaterArtifacts: false } }),
  );
}

const result = spawnSync('cargo', tauriArgs, {
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
