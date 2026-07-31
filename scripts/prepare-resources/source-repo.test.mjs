import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ensureSourceRepo,
  getSourceRefInfo,
  normalizeSourceRepoConfig,
  resolveSourceDir,
} from './source-repo.mjs';

const runGit = (cwd, args) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
};

const createUpstreamFixture = async (root) => {
  const upstreamDir = path.join(root, 'upstream');
  await mkdir(path.join(upstreamDir, 'dashboard'), { recursive: true });
  await writeFile(path.join(upstreamDir, 'main.py'), '# AstrBot fixture\n');
  await writeFile(path.join(upstreamDir, 'dashboard', 'index.html'), 'legacy dashboard\n');
  runGit(upstreamDir, ['init']);
  runGit(upstreamDir, ['checkout', '-b', 'main']);
  runGit(upstreamDir, ['config', 'user.email', 'tests@example.com']);
  runGit(upstreamDir, ['config', 'user.name', 'AstrBot Tests']);
  runGit(upstreamDir, ['add', '.']);
  runGit(upstreamDir, ['commit', '-m', 'initial fixture']);
  return upstreamDir;
};

test('normalizeSourceRepoConfig normalizes GitHub tree URL and infers ref', () => {
  const { repoUrl, repoRef } = normalizeSourceRepoConfig(
    'https://github.com/AstrBotDevs/AstrBot/tree/release-1.2.3/dashboard',
    '',
  );

  assert.equal(repoUrl, 'https://github.com/AstrBotDevs/AstrBot.git');
  assert.equal(repoRef, 'release-1.2.3');
});

test('normalizeSourceRepoConfig preserves explicit ref over URL tree ref', () => {
  const { repoUrl, repoRef } = normalizeSourceRepoConfig(
    'https://github.com/AstrBotDevs/AstrBot/tree/main',
    'feature-x',
  );

  assert.equal(repoUrl, 'https://github.com/AstrBotDevs/AstrBot.git');
  assert.equal(repoRef, 'feature-x');
});

test('getSourceRefInfo detects commit sha and version tag', () => {
  const shaInfo = getSourceRefInfo('abcdef1234567890', '');
  assert.equal(shaInfo.ref, 'abcdef1234567890');
  assert.equal(shaInfo.isCommit, true);
  assert.equal(shaInfo.isVersionTag, false);

  const tagInfo = getSourceRefInfo('v1.8.0', '');
  assert.equal(tagInfo.isCommit, false);
  assert.equal(tagInfo.isVersionTag, true);
});

test('getSourceRefInfo respects explicit commit hint env flag', () => {
  const info = getSourceRefInfo('release-candidate', 'YES');
  assert.equal(info.isCommit, true);
});

test('resolveSourceDir honors override and default project layout', () => {
  const resolvedOverride = resolveSourceDir('/project/root', './vendor/custom', '/work');
  assert.equal(resolvedOverride, path.resolve('/work', 'vendor/custom'));

  const resolvedDefault = resolveSourceDir('/project/root', '', '/work');
  assert.equal(resolvedDefault, path.join('/project/root', 'vendor', 'AstrBot'));
});

test('ensureSourceRepo removes the upstream dashboard after clone and ref updates', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'astrbot-source-repo-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const upstreamDir = await createUpstreamFixture(root);
  const sourceDir = path.join(root, 'managed-source');
  const options = {
    isSourceRepoRefCommitSha: false,
    sourceDir,
    sourceDirOverrideRaw: '',
    sourceRepoRef: 'main',
    sourceRepoUrl: upstreamDir,
  };

  ensureSourceRepo(options);
  assert.equal(existsSync(path.join(sourceDir, 'main.py')), true);
  assert.equal(existsSync(path.join(sourceDir, 'dashboard')), false);

  await writeFile(path.join(upstreamDir, 'dashboard', 'index.html'), 'updated legacy dashboard\n');
  await writeFile(path.join(upstreamDir, 'updated.txt'), 'updated backend\n');
  runGit(upstreamDir, ['add', '.']);
  runGit(upstreamDir, ['commit', '-m', 'update fixture']);

  ensureSourceRepo(options);
  assert.equal(existsSync(path.join(sourceDir, 'updated.txt')), true);
  assert.equal(existsSync(path.join(sourceDir, 'dashboard')), false);
});

test('ensureSourceRepo does not modify an explicit source directory override', async (t) => {
  const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'astrbot-source-override-'));
  t.after(() => rm(sourceDir, { force: true, recursive: true }));
  await mkdir(path.join(sourceDir, 'dashboard'));
  await writeFile(path.join(sourceDir, 'main.py'), '# Local source fixture\n');
  await writeFile(path.join(sourceDir, 'dashboard', 'index.html'), 'local dashboard\n');

  ensureSourceRepo({
    isSourceRepoRefCommitSha: false,
    sourceDir,
    sourceDirOverrideRaw: sourceDir,
    sourceRepoRef: '',
    sourceRepoUrl: '',
  });

  assert.equal(existsSync(path.join(sourceDir, 'dashboard', 'index.html')), true);
});
