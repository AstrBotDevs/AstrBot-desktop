import {
  prepareBackend,
  prepareWebui,
  validatePreparedResources,
} from './mode-tasks.mjs';
import { validatePackagedCoreVersion } from './resource-identity.mjs';

const VALID_MODES = new Set(['version', 'webui', 'backend', 'all']);

const defaultTaskRunner = {
  prepareWebui,
  prepareBackend,
  validatePreparedResources,
};

export const runModeTasks = async (
  mode,
  context,
  taskRunner = defaultTaskRunner,
) => {
  const {
    sourceDir,
    projectRoot,
    desktopVersion,
    coreVersion,
    sourceRepoCommit,
    sourceRepoRef,
    isSourceRepoRefVersionTag,
    isDesktopBridgeExpectationStrict,
    pythonBuildStandaloneRelease,
    pythonBuildStandaloneVersion,
  } = context;

  if (!VALID_MODES.has(mode)) {
    throw new Error(`Unsupported mode: ${mode}. Expected version/webui/backend/all.`);
  }

  if (mode === 'version') {
    return;
  }

  validatePackagedCoreVersion(coreVersion);

  if (mode === 'webui' || mode === 'all') {
    await taskRunner.prepareWebui({
      sourceDir,
      projectRoot,
      coreVersion,
      sourceRepoRef,
      isSourceRepoRefVersionTag,
      isDesktopBridgeExpectationStrict,
    });
  }

  if (mode === 'backend' || mode === 'all') {
    await taskRunner.prepareBackend({
      sourceDir,
      projectRoot,
      desktopVersion,
      coreVersion,
      sourceRepoRef,
      sourceRepoCommit,
      pythonBuildStandaloneRelease,
      pythonBuildStandaloneVersion,
    });
  }

  if (mode === 'all') {
    await taskRunner.validatePreparedResources({
      projectRoot,
      desktopVersion,
      coreVersion,
      sourceRepoRef,
      sourceRepoCommit,
    });
  }
};
