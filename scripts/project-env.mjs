import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { assertSupportedNodeVersion } from './node-version.mjs';

const projectEnvPath = fileURLToPath(new URL('../.env', import.meta.url));

export const loadProjectEnv = () => {
  assertSupportedNodeVersion();
  if (!existsSync(projectEnvPath)) {
    return false;
  }
  process.loadEnvFile(projectEnvPath);
  return true;
};
