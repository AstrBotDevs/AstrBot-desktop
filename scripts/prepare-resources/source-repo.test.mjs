import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getSourceRefInfo,
  normalizeSourceRepoConfig,
  resolveSourceDir,
} from './source-repo.mjs';

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
  assert.equal(resolvedOverride, '/work/vendor/custom');

  const resolvedDefault = resolveSourceDir('/project/root', '', '/work');
  assert.equal(resolvedDefault, '/project/root/vendor/AstrBot');
});
