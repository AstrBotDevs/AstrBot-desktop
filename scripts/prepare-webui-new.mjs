import { spawnSync } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { assertSupportedNodeVersion } from './node-version.mjs';
import { loadProjectEnv } from './project-env.mjs';
import {
  patchMonacoCssNestingWarnings,
  verifyDesktopBridgeArtifacts,
} from './prepare-resources/desktop-bridge-checks.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');
const legacyDashboardDir = path.join(projectRoot, 'dashboard');
const reactDashboardDir = path.join(projectRoot, 'new-dashboard');

assertSupportedNodeVersion();
loadProjectEnv();

const runChecked = (command, args, cwd, envExtra = {}) => {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...envExtra },
    shell: process.platform === 'win32' && command === 'pnpm',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
};

const runPnpm = (args, cwd, envExtra) =>
  runChecked('pnpm', args, cwd, envExtra);

const ensureInstalled = (directory, label) => {
  if (existsSync(path.join(directory, 'node_modules'))) return;
  console.log(`[prepare-webui:new] Installing ${label} dependencies ...`);
  const args = ['--dir', directory, 'install'];
  if (existsSync(path.join(directory, 'pnpm-lock.yaml'))) {
    args.push('--frozen-lockfile');
  }
  runPnpm(args, directory);
};

const syncDirectory = async (source, target) => {
  await rm(target, { recursive: true, force: true });
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
};

const releaseBaseUrl =
  process.env.ASTRBOT_DESKTOP_RELEASE_BASE_URL?.trim() ||
  'https://github.com/AstrBotDevs/AstrBot-desktop/releases';
const releaseEnv = { VITE_ASTRBOT_RELEASE_BASE_URL: releaseBaseUrl };
const strictBridgeChecks = new Set(['1', 'true', 'yes', 'on']).has(
  process.env.ASTRBOT_DESKTOP_STRICT_BRIDGE_EXPECTATIONS?.trim().toLowerCase(),
);

const main = async () => {
  ensureInstalled(legacyDashboardDir, 'legacy Dashboard');
  ensureInstalled(reactDashboardDir, 'React Dashboard');

  await patchMonacoCssNestingWarnings({
    dashboardDir: legacyDashboardDir,
    projectRoot,
  });
  await verifyDesktopBridgeArtifacts({
    dashboardDir: legacyDashboardDir,
    projectRoot,
    isDesktopBridgeExpectationStrict: strictBridgeChecks,
  });

  runChecked(
    'node',
    [path.join(legacyDashboardDir, 'scripts', 'subset-mdi-font.mjs')],
    legacyDashboardDir,
    releaseEnv,
  );
  runPnpm(
    ['--dir', legacyDashboardDir, 'exec', 'vue-tsc', '--noEmit'],
    legacyDashboardDir,
    releaseEnv,
  );
  runPnpm(
    ['--dir', legacyDashboardDir, 'exec', 'vite', 'build', '--base=/legacy/'],
    legacyDashboardDir,
    releaseEnv,
  );

  await syncDirectory(
    path.join(legacyDashboardDir, 'dist'),
    path.join(reactDashboardDir, 'public', 'legacy'),
  );
  runPnpm(['--dir', reactDashboardDir, 'build'], reactDashboardDir, releaseEnv);

  const reactDist = path.join(reactDashboardDir, 'dist');
  if (!existsSync(path.join(reactDist, 'index.html'))) {
    throw new Error(`React WebUI build output missing: ${reactDist}`);
  }
  await syncDirectory(reactDist, path.join(projectRoot, 'resources', 'webui'));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
