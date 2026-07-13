import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const projectEnvPath = fileURLToPath(new URL('../.env', import.meta.url));

export const loadProjectEnv = () => {
  if (!existsSync(projectEnvPath)) {
    return false;
  }
  if (typeof process.loadEnvFile !== 'function') {
    throw new Error('Loading .env requires Node.js 20.12 or newer.');
  }
  process.loadEnvFile(projectEnvPath);
  return true;
};
