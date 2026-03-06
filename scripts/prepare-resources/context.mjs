import {
  normalizeDesktopVersionOverride,
} from './version-sync.mjs';
import {
  DEFAULT_ASTRBOT_SOURCE_GIT_URL,
  getSourceRefInfo,
  normalizeSourceRepoConfig,
  resolveSourceDir,
} from './source-repo.mjs';

const TRUTHY_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);

const trimEnv = (env, key, fallback = '') => {
  const value = env[key];
  return typeof value === 'string' ? value.trim() : fallback;
};

export const createPrepareResourcesContext = ({ argv, env, projectRoot, cwd = process.cwd() }) => {
  const sourceRepoUrlRaw =
    trimEnv(env, 'ASTRBOT_SOURCE_GIT_URL') || DEFAULT_ASTRBOT_SOURCE_GIT_URL;
  const sourceRepoRefRaw = trimEnv(env, 'ASTRBOT_SOURCE_GIT_REF');
  const sourceRepoRefIsCommitRaw = trimEnv(env, 'ASTRBOT_SOURCE_GIT_REF_IS_COMMIT');
  const sourceDirOverrideRaw = trimEnv(env, 'ASTRBOT_SOURCE_DIR');
  const desktopVersionOverrideRaw = trimEnv(env, 'ASTRBOT_DESKTOP_VERSION');
  const pythonBuildStandaloneRelease = trimEnv(env, 'ASTRBOT_PBS_RELEASE', '20260211');
  const pythonBuildStandaloneVersion = trimEnv(env, 'ASTRBOT_PBS_VERSION', '3.12.12');
  const mode = argv[2] || 'all';

  const desktopVersionOverride = normalizeDesktopVersionOverride(desktopVersionOverrideRaw);
  const isDesktopBridgeExpectationStrict = TRUTHY_ENV_VALUES.has(
    trimEnv(env, 'ASTRBOT_DESKTOP_STRICT_BRIDGE_EXPECTATIONS').toLowerCase(),
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

  const sourceDir = resolveSourceDir(projectRoot, sourceDirOverrideRaw, cwd);

  return {
    mode,
    sourceRepoUrlRaw,
    sourceRepoRefRaw,
    sourceRepoRefIsCommitRaw,
    sourceDirOverrideRaw,
    desktopVersionOverrideRaw,
    pythonBuildStandaloneRelease,
    pythonBuildStandaloneVersion,
    desktopVersionOverride,
    isDesktopBridgeExpectationStrict,
    sourceRepoUrl,
    sourceRepoRefResolved,
    sourceRepoRef,
    isSourceRepoRefCommitSha,
    isSourceRepoRefVersionTag,
    sourceDir,
  };
};
