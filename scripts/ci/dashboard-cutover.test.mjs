import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const readProjectFile = (relativePath) =>
  readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

test('default package scripts use the React dashboard only', async () => {
  const packageJson = JSON.parse(await readProjectFile('package.json'));
  const scripts = packageJson.scripts;

  assert.equal(scripts['install:dashboard'], 'pnpm --dir dashboard install --frozen-lockfile');
  assert.equal(scripts['dev:dashboard'], 'pnpm --dir dashboard dev');
  assert.equal(scripts['typecheck:dashboard'], 'pnpm --dir dashboard typecheck');
  assert.equal(scripts['prepare:webui'], 'node scripts/prepare-resources.mjs webui');
  assert.equal(scripts.dev, 'node scripts/run-tauri.mjs dev');
  assert.equal(scripts.build, 'node scripts/run-tauri.mjs build');

  const serializedScripts = JSON.stringify(scripts);
  assert.doesNotMatch(serializedScripts, /new-dashboard|legacy-dashboard|:new|run-tauri-new/);
});

test('dashboard quality workflow targets the React dashboard directory', async () => {
  const workflow = await readProjectFile('.github/workflows/check-dashboard.yml');

  assert.match(workflow, /working-directory: dashboard/);
  assert.match(workflow, /node-cache-dependency-path: dashboard\/pnpm-lock\.yaml/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.doesNotMatch(workflow, /new-dashboard|legacy-dashboard/);
});

test('desktop build configuration cannot reference the legacy dashboard', async () => {
  const files = await Promise.all([
    readProjectFile('src-tauri/tauri.conf.json'),
    readProjectFile('Makefile'),
    readProjectFile('.github/workflows/build-desktop-tauri.yml'),
    readProjectFile('.github/actions/setup-desktop-build/action.yml'),
  ]);
  const buildConfiguration = files.join('\n');

  assert.match(buildConfiguration, /pnpm run prepare:resources/);
  assert.doesNotMatch(buildConfiguration, /new-dashboard|legacy-dashboard/);
});
