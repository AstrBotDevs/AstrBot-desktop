import { spawnSync } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertSupportedNodeVersion } from './node-version.mjs';
import { loadProjectEnv } from './project-env.mjs';
import {
  patchMonacoCssNestingWarnings,
  verifyDesktopBridgeArtifacts,
} from './prepare-resources/desktop-bridge-checks.mjs';

const syncDirectory = async (source, target) => {
  await rm(target, { recursive: true, force: true });
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
};

export const prepareWebuiNew = async ({
  projectRoot = path.resolve(import.meta.dirname, '..'),
  spawnCommandSync = spawnSync,
  pathExists = existsSync,
  sync = syncDirectory,
  patchMonaco = patchMonacoCssNestingWarnings,
  verifyDesktopBridge = verifyDesktopBridgeArtifacts,
  assertNodeVersion = assertSupportedNodeVersion,
  loadEnv = loadProjectEnv,
  env = process.env,
  platform = process.platform,
  logger = console,
} = {}) => {
  const legacyDashboardDir = path.join(projectRoot, 'dashboard');
  const reactDashboardDir = path.join(projectRoot, 'new-dashboard');

  assertNodeVersion();
  loadEnv();

  const runChecked = (command, args, cwd, envExtra = {}) => {
    const result = spawnCommandSync(command, args, {
      cwd,
      stdio: 'inherit',
      env: { ...env, ...envExtra },
      shell: platform === 'win32' && command === 'pnpm',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Command failed: ${command} ${args.join(' ')}`);
    }
  };

  const runPnpm = (args, cwd, envExtra) =>
    runChecked('pnpm', args, cwd, envExtra);

  const ensureInstalled = (directory, label) => {
    if (pathExists(path.join(directory, 'node_modules'))) return;
    logger.log(`[prepare-webui:new] Installing ${label} dependencies ...`);
    const args = ['--dir', directory, 'install'];
    if (pathExists(path.join(directory, 'pnpm-lock.yaml'))) {
      args.push('--frozen-lockfile');
    }
    runPnpm(args, directory);
  };

  const releaseBaseUrl =
    env.ASTRBOT_DESKTOP_RELEASE_BASE_URL?.trim() ||
    'https://github.com/AstrBotDevs/AstrBot-desktop/releases';
  const releaseEnv = { VITE_ASTRBOT_RELEASE_BASE_URL: releaseBaseUrl };
  const strictBridgeChecks = new Set(['1', 'true', 'yes', 'on']).has(
    env.ASTRBOT_DESKTOP_STRICT_BRIDGE_EXPECTATIONS?.trim().toLowerCase(),
  );

  ensureInstalled(legacyDashboardDir, 'legacy Dashboard');
  ensureInstalled(reactDashboardDir, 'React Dashboard');

  await patchMonaco({
    dashboardDir: legacyDashboardDir,
    projectRoot,
  });
  await verifyDesktopBridge({
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

  await sync(
    path.join(legacyDashboardDir, 'dist'),
    path.join(reactDashboardDir, 'public', 'legacy'),
  );
  runPnpm(['--dir', reactDashboardDir, 'build'], reactDashboardDir, releaseEnv);

  const reactDist = path.join(reactDashboardDir, 'dist');
  if (!pathExists(path.join(reactDist, 'index.html'))) {
    throw new Error(`React WebUI build output missing: ${reactDist}`);
  }
  await sync(reactDist, path.join(projectRoot, 'resources', 'webui'));
};

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  prepareWebuiNew().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
