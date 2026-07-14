import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPrepareResourcesContext } from './prepare-resources/context.mjs';
import { ensureSourceRepo } from './prepare-resources/source-repo.mjs';

export const ensureDevSource = () => {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const context = createPrepareResourcesContext({
    argv: ['node', 'scripts/ensure-dev-source.mjs', 'backend'],
    env: process.env,
    projectRoot,
  });

  ensureSourceRepo({
    sourceDir: context.sourceDir,
    sourceRepoUrl: context.sourceRepoUrl,
    sourceRepoRef: context.sourceRepoRef,
    isSourceRepoRefCommitSha: context.isSourceRepoRefCommitSha,
    sourceDirOverrideRaw: context.sourceDirOverrideInput,
  });
  console.log(`[dev] AstrBot backend source ready: ${context.sourceDir}`);
  return context.sourceDir;
};
