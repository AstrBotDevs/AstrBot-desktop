import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptsDir = path.join(projectRoot, 'scripts');

const collectTests = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectTests(entryPath);
    }
    return entry.isFile() && entry.name.endsWith('.test.mjs') ? [entryPath] : [];
  }));
  return nested.flat();
};

const testFiles = (await collectTests(scriptsDir)).sort();
if (testFiles.length === 0) {
  console.log('No Node script tests found.');
  process.exit(0);
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: projectRoot,
  stdio: 'inherit',
});
if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
