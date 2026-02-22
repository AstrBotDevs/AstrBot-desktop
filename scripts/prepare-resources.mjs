import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeDesktopVersionOverride,
  readAstrbotVersionFromPyproject,
  syncDesktopVersionFiles,
} from './prepare-resources/version-sync.mjs';
import {
  DEFAULT_ASTRBOT_SOURCE_GIT_URL,
  ensureSourceRepo,
  getSourceRefInfo,
  normalizeSourceRepoConfig,
  resolveSourceDir,
} from './prepare-resources/source-repo.mjs';
import {
  ensureStartupShellAssets,
  prepareBackend,
  prepareWebui,
} from './prepare-resources/mode-tasks.mjs';

const sourceRepoUrlRaw =
  process.env.ASTRBOT_SOURCE_GIT_URL?.trim() || DEFAULT_ASTRBOT_SOURCE_GIT_URL;
const sourceRepoRefRaw = process.env.ASTRBOT_SOURCE_GIT_REF?.trim() || '';
const sourceRepoRefIsCommitRaw = process.env.ASTRBOT_SOURCE_GIT_REF_IS_COMMIT?.trim() || '';
const sourceDirOverrideRaw = process.env.ASTRBOT_SOURCE_DIR?.trim() || '';
const desktopVersionOverrideRaw = process.env.ASTRBOT_DESKTOP_VERSION?.trim() || '';
const pythonBuildStandaloneRelease = process.env.ASTRBOT_PBS_RELEASE?.trim() || '20260211';
const pythonBuildStandaloneVersion = process.env.ASTRBOT_PBS_VERSION?.trim() || '3.12.12';
const mode = process.argv[2] || 'all';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const desktopVersionOverride = normalizeDesktopVersionOverride(desktopVersionOverrideRaw);
const TRUTHY_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);
const isDesktopBridgeExpectationStrict = TRUTHY_ENV_VALUES.has(
  String(process.env.ASTRBOT_DESKTOP_STRICT_BRIDGE_EXPECTATIONS || '')
    .trim()
    .toLowerCase(),
);

const { repoUrl: sourceRepoUrl, repoRef: sourceRepoRefResolved } = normalizeSourceRepoConfig(
  sourceRepoUrlRaw,
  sourceRepoRefRaw,
);

const {
  ref: sourceRepoRef,
  isCommit: isSourceRepoRefCommitSha,
  isVersionTag: isSourceRepoRefVersionTag,
} = getSourceRefInfo(sourceRepoRefResolved, sourceRepoRefIsCommitRaw);

const runModeTasks = async (currentMode, sourceDir) => {
  if (currentMode === 'version') {
    return;
  }

  if (currentMode === 'webui') {
    await prepareWebui({
      sourceDir,
      projectRoot,
      sourceRepoRef,
      isSourceRepoRefVersionTag,
      isDesktopBridgeExpectationStrict,
    });
    return;
  }

  if (currentMode === 'backend') {
    await prepareBackend({
      sourceDir,
      projectRoot,
      pythonBuildStandaloneRelease,
      pythonBuildStandaloneVersion,
    });
    return;
  }

  if (currentMode === 'all') {
    await prepareWebui({
      sourceDir,
      projectRoot,
      sourceRepoRef,
      isSourceRepoRefVersionTag,
      isDesktopBridgeExpectationStrict,
    });
    await prepareBackend({
      sourceDir,
      projectRoot,
      pythonBuildStandaloneRelease,
      pythonBuildStandaloneVersion,
    });
    return;
  }

  throw new Error(`Unsupported mode: ${currentMode}. Expected version/webui/backend/all.`);
};

const main = async () => {
  const sourceDir = resolveSourceDir(projectRoot, sourceDirOverrideRaw);
  const needsSourceRepo = mode !== 'version' || !desktopVersionOverride;
  await mkdir(path.join(projectRoot, 'resources'), { recursive: true });

  if (desktopVersionOverrideRaw && desktopVersionOverrideRaw !== desktopVersionOverride) {
    console.log(
      `[prepare-resources] Normalized ASTRBOT_DESKTOP_VERSION from ${desktopVersionOverrideRaw} to ${desktopVersionOverride}`,
    );
  }

  if (needsSourceRepo) {
    ensureSourceRepo({
      sourceDir,
      sourceRepoUrl,
      sourceRepoRef,
      isSourceRepoRefCommitSha,
      sourceDirOverrideRaw,
    });
  } else {
    console.log(
      '[prepare-resources] Skip source repo sync in version-only mode because ASTRBOT_DESKTOP_VERSION is set.',
    );
  }

  ensureStartupShellAssets(projectRoot);
  const astrbotVersion =
    desktopVersionOverride || (await readAstrbotVersionFromPyproject({ sourceDir }));

  if (desktopVersionOverride && needsSourceRepo) {
    const sourceVersion = await readAstrbotVersionFromPyproject({ sourceDir });
    if (sourceVersion !== desktopVersionOverride) {
      console.warn(
        `[prepare-resources] Version override drift detected: ASTRBOT_DESKTOP_VERSION=${desktopVersionOverrideRaw} (normalized=${desktopVersionOverride}), source pyproject version=${sourceVersion} (${sourceDir})`,
      );
    }
  }

  await syncDesktopVersionFiles({ projectRoot, version: astrbotVersion });
  if (desktopVersionOverride) {
    console.log(
      `[prepare-resources] Synced desktop version to override ${astrbotVersion} (ASTRBOT_DESKTOP_VERSION)`,
    );
  } else {
    console.log(`[prepare-resources] Synced desktop version to AstrBot ${astrbotVersion}`);
  }

  await runModeTasks(mode, sourceDir);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
