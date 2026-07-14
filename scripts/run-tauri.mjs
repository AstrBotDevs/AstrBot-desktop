import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { resolveCargoCommand } from './cargo-command.mjs';
import { assertSupportedNodeVersion } from './node-version.mjs';
import { loadProjectEnv } from './project-env.mjs';

const subcommand = process.argv[2];
if (!['dev', 'build'].includes(subcommand)) {
  throw new Error('Expected a Tauri subcommand: dev or build.');
}

assertSupportedNodeVersion();
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

const { command: cargoCommand, defaultCargoPath } = resolveCargoCommand();
const cargoEnv = { ...process.env };
if (path.isAbsolute(cargoCommand)) {
  const pathEnvKey = Object.keys(cargoEnv).find(
    (key) => key.toLowerCase() === 'path',
  ) ?? 'PATH';
  cargoEnv[pathEnvKey] = [
    path.dirname(cargoCommand),
    cargoEnv[pathEnvKey],
  ].filter(Boolean).join(path.delimiter);
}
const result = spawnSync(cargoCommand, tauriArgs, {
  env: cargoEnv,
  stdio: 'inherit',
});

if (result.error) {
  if (result.error.code === 'ENOENT') {
    throw new Error(
      `Cargo was not found. Install the Rust toolchain, add Cargo to PATH, or set CARGO to the executable path. Checked the rustup default path: ${defaultCargoPath}`,
      { cause: result.error },
    );
  }
  throw result.error;
}
process.exit(result.status ?? 1);
