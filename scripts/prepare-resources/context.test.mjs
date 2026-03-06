import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPrepareResourcesContext } from './context.mjs';

test('createPrepareResourcesContext applies defaults and normalizes empty env values', () => {
  const context = createPrepareResourcesContext({
    argv: ['node', 'scripts/prepare-resources.mjs'],
    env: {},
    projectRoot: '/project/root',
  });

  assert.equal(context.mode, 'all');
  assert.equal(context.sourceRepoUrl, 'https://github.com/AstrBotDevs/AstrBot.git');
  assert.equal(context.sourceRepoRef, '');
  assert.equal(context.isSourceRepoRefCommitSha, false);
  assert.equal(context.isSourceRepoRefVersionTag, false);
  assert.equal(context.isDesktopBridgeExpectationStrict, false);
  assert.equal(context.desktopVersionOverride, '');
  assert.equal(context.pythonBuildStandaloneRelease, '20260211');
  assert.equal(context.pythonBuildStandaloneVersion, '3.12.12');
  assert.equal(context.sourceDir, '/project/root/vendor/AstrBot');
});

test('createPrepareResourcesContext normalizes source config and strict bridge env', () => {
  const context = createPrepareResourcesContext({
    argv: ['node', 'scripts/prepare-resources.mjs', 'backend'],
    env: {
      ASTRBOT_SOURCE_GIT_URL: 'https://github.com/AstrBotDevs/AstrBot/tree/release-1.2.3/dashboard',
      ASTRBOT_SOURCE_GIT_REF: ' v4.19.2 ',
      ASTRBOT_SOURCE_GIT_REF_IS_COMMIT: 'yes',
      ASTRBOT_SOURCE_DIR: ' custom/source ',
      ASTRBOT_DESKTOP_VERSION: ' v9.9.9 ',
      ASTRBOT_DESKTOP_STRICT_BRIDGE_EXPECTATIONS: 'On',
      ASTRBOT_PBS_RELEASE: '20250101',
      ASTRBOT_PBS_VERSION: '3.12.1',
    },
    projectRoot: '/project/root',
    cwd: '/workspace',
  });

  assert.equal(context.mode, 'backend');
  assert.equal(context.sourceRepoUrl, 'https://github.com/AstrBotDevs/AstrBot.git');
  assert.equal(context.sourceRepoRef, 'v4.19.2');
  assert.equal(context.isSourceRepoRefCommitSha, true);
  assert.equal(context.isSourceRepoRefVersionTag, true);
  assert.equal(context.desktopVersionOverride, '9.9.9');
  assert.equal(context.isDesktopBridgeExpectationStrict, true);
  assert.equal(context.pythonBuildStandaloneRelease, '20250101');
  assert.equal(context.pythonBuildStandaloneVersion, '3.12.1');
  assert.equal(context.sourceDir, '/workspace/custom/source');
});
