import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readAstrbotVersionFromPyproject,
  syncDesktopVersionFiles,
  validateAstrbotRuntimeVersion,
} from './prepare-resources/version-sync.mjs';
import {
  ensureSourceRepo,
  resolveSourceRepoCommit,
} from './prepare-resources/source-repo.mjs';
import {
  ensureStartupShellAssets,
} from './prepare-resources/mode-tasks.mjs';
import { runModeTasks } from './prepare-resources/mode-dispatch.mjs';
import { createPrepareResourcesContext } from './prepare-resources/context.mjs';
import { requiresDesktopCoreMatch } from './prepare-resources/resource-identity.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const prepareAstrbotVersionSync = async ({ context }) => {
  const {
    mode,
    projectRoot,
    sourceDir,
    sourceRepoUrl,
    sourceRepoRef,
    isSourceRepoRefCommitSha,
    sourceDirOverrideInput,
    desktopVersionInput,
    desktopVersionOverride,
  } = context;
  const needsSourceRepo = mode !== 'version' || !desktopVersionOverride;

  ensureStartupShellAssets(projectRoot);

  if (!needsSourceRepo) {
    console.log(
      '[prepare-resources] Skip source repo sync in version-only mode because ASTRBOT_DESKTOP_VERSION is set.',
    );
    return {
      desktopVersion: desktopVersionOverride,
      coreVersion: '',
      sourceRepoCommit: '',
    };
  }

  ensureSourceRepo({
    sourceDir,
    sourceRepoUrl,
    sourceRepoRef,
    isSourceRepoRefCommitSha,
    sourceDirOverrideRaw: sourceDirOverrideInput,
  });

  const coreVersion = await readAstrbotVersionFromPyproject({ sourceDir });
  const desktopVersion = desktopVersionOverride || coreVersion;
  await validateAstrbotRuntimeVersion({
    sourceDir,
    expectedVersion: coreVersion,
  });

  if (requiresDesktopCoreMatch(desktopVersion) && desktopVersion !== coreVersion) {
    throw new Error(
      `Stable bundle version mismatch: Desktop is ${desktopVersion}, but Core is ${coreVersion}.`,
    );
  }

  if (desktopVersionOverride) {
    if (coreVersion !== desktopVersionOverride) {
      console.warn(
        `[prepare-resources] Version override drift detected: ASTRBOT_DESKTOP_VERSION=${desktopVersionInput} (normalized=${desktopVersionOverride}), source pyproject version=${coreVersion} (${sourceDir})`,
      );
    }
  }

  return {
    desktopVersion,
    coreVersion,
    sourceRepoCommit: resolveSourceRepoCommit(sourceDir),
  };
};

const main = async () => {
  const context = createPrepareResourcesContext({
    argv: process.argv,
    env: process.env,
    projectRoot,
  });
  const {
    mode,
    desktopVersionInput,
    desktopVersionOverride,
  } = context;
  await mkdir(path.join(projectRoot, 'resources'), { recursive: true });

  if (desktopVersionInput && desktopVersionInput !== desktopVersionOverride) {
    console.log(
      `[prepare-resources] Normalized ASTRBOT_DESKTOP_VERSION from ${desktopVersionInput} to ${desktopVersionOverride}`,
    );
  }

  const { desktopVersion, coreVersion, sourceRepoCommit } =
    await prepareAstrbotVersionSync({ context });

  await syncDesktopVersionFiles({ projectRoot, version: desktopVersion });
  if (desktopVersionOverride) {
    console.log(
      `[prepare-resources] Synced desktop version to override ${desktopVersion} (ASTRBOT_DESKTOP_VERSION)`,
    );
  } else {
    console.log(`[prepare-resources] Synced desktop version to AstrBot ${desktopVersion}`);
  }

  await runModeTasks(mode, {
    ...context,
    desktopVersion,
    coreVersion,
    sourceRepoCommit,
  });
};

main().catch((error) => {
  if (error instanceof Error) {
    console.error(error.stack || error.message);
  } else {
    console.error(String(error));
  }
  process.exit(1);
});
