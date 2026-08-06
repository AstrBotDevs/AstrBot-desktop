import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  extractWorkflowJobSteps,
  findStep,
  findStepIndex,
  readWorkflowObject,
} from './workflow-test-utils.mjs';

const WORKFLOW_FILE = 'build-desktop-tauri.yml';
const BUILD_LINUX_JOB = 'build-linux';
const BUILD_MACOS_JOB = 'build-macos';
const RELEASE_JOB = 'release';
const PREPARE_RESOURCES_RUN = /pnpm run prepare:resources/;
const PRESIGN_BACKEND_RUN = /codesign-macos-nested\.sh\s+"resources\/backend"/;
const BUILD_APP_BUNDLE_RUN = /pnpm exec tauri build --verbose --target/;

test('desktop build setup uses the prebuilt package-manager Tauri CLI', async () => {
  const [setupAction, packageJson] = await Promise.all([
    readFile('.github/actions/setup-desktop-build/action.yml', 'utf8'),
    readFile('package.json', 'utf8').then(JSON.parse),
  ]);

  assert.equal(packageJson.devDependencies['@tauri-apps/cli'], '2.10.0');
  assert.doesNotMatch(setupAction, /cargo install tauri-cli/);
});

test('findStep supports predicate and regex matching', () => {
  const steps = [
    { name: 'Prepare desktop resources (macOS) [unsigned-compatible]', run: 'pnpm run prepare:resources' },
    { name: 'Build desktop app bundle (macOS) release artifacts', run: 'pnpm exec tauri build --verbose --target x86_64-apple-darwin' },
  ];

  assert.equal(findStep(steps, 'prepare resources run', (step) => PREPARE_RESOURCES_RUN.test(step.run ?? '')), steps[0]);
  assert.equal(findStep(steps, /Build desktop app bundle/, (step) => BUILD_APP_BUNDLE_RUN.test(step.run ?? '')), steps[1]);
});

test('macOS workflow exposes structured build-macos steps', async () => {
  const workflowObject = await readWorkflowObject(WORKFLOW_FILE);
  const steps = extractWorkflowJobSteps(workflowObject, BUILD_MACOS_JOB);

  assert.ok(findStep(steps, 'prepare resources step', (step) => PREPARE_RESOURCES_RUN.test(step.run ?? '')));
  assert.ok(findStep(steps, 'pre-sign resources step', (step) => PRESIGN_BACKEND_RUN.test(step.run ?? '')));
  assert.ok(findStep(steps, 'build app bundle step', (step) => BUILD_APP_BUNDLE_RUN.test(step.run ?? '')));
});

test('macOS workflow prepares resources before optional pre-signing', async () => {
  const workflowObject = await readWorkflowObject(WORKFLOW_FILE);
  const steps = extractWorkflowJobSteps(workflowObject, BUILD_MACOS_JOB);
  const prepareStepIndex = findStepIndex(
    steps,
    (step) => PREPARE_RESOURCES_RUN.test(step.run ?? ''),
    'prepare resources step',
  );
  const preSignStepIndex = findStepIndex(
    steps,
    (step) => PRESIGN_BACKEND_RUN.test(step.run ?? ''),
    'pre-sign resources step',
  );
  const buildStepIndex = findStepIndex(
    steps,
    (step) => BUILD_APP_BUNDLE_RUN.test(step.run ?? ''),
    'build app bundle step',
  );
  const prepareStep = steps[prepareStepIndex];
  const preSignStep = steps[preSignStepIndex];
  const buildStep = steps[buildStepIndex];

  assert.equal(prepareStep.if, undefined);
  assert.match(prepareStep.run, /pnpm run prepare:resources/);
  assert.match(prepareStep.run, /resources\/backend not found after prepare:resources/);

  assert.match(preSignStep.if ?? '', /import_apple_certificate\.outputs\.signing_identity/);
  assert.doesNotMatch(preSignStep.run, /pnpm run prepare:resources/);

  assert.ok(prepareStepIndex < preSignStepIndex);
  assert.ok(preSignStepIndex < buildStepIndex);
  assert.match(
    buildStep.run,
    /Resources are already prepared/,
  );
});

test('Linux workflow publishes signed AppImage updater artifacts', async () => {
  const workflowObject = await readWorkflowObject(WORKFLOW_FILE);
  const steps = extractWorkflowJobSteps(workflowObject, BUILD_LINUX_JOB);
  const buildStep = findStep(
    steps,
    'Build desktop installers (Linux)',
    (step) => step.name === 'Build desktop installers (Linux)',
  );
  const verifyStep = findStep(
    steps,
    'Verify Linux AppImage updater artifacts',
    (step) => step.name === 'Verify Linux AppImage updater artifacts',
  );
  const uploadStep = findStep(
    steps,
    'Linux artifact upload',
    (step) => step.name === 'Upload artifacts' && /^actions\/upload-artifact@/.test(step.uses ?? ''),
  );

  assert.match(buildStep.run, /--bundles deb,rpm,appimage/);
  assert.match(verifyStep.run, /\.AppImage/);
  assert.match(verifyStep.run, /updater_signature="\$\{appimages\[0\]\}\.sig"/);
  assert.match(uploadStep.with?.path ?? '', /appimage\/\*\.AppImage/);
  assert.match(uploadStep.with?.path ?? '', /appimage\/\*\.AppImage\.sig/);
});

test('macOS workflow packages a drag-to-Applications DMG alongside updater archives', async () => {
  const workflowObject = await readWorkflowObject(WORKFLOW_FILE);
  const steps = extractWorkflowJobSteps(workflowObject, BUILD_MACOS_JOB);
  const buildStep = findStep(
    steps,
    'Build desktop app bundle (macOS)',
    (step) => step.name === 'Build desktop app bundle (macOS)',
  );
  const collectStep = findStep(
    steps,
    'Collect macOS release artifacts',
    (step) => step.name === 'Collect macOS release artifacts',
  );
  const uploadStep = findStep(
    steps,
    'macOS artifact upload',
    (step) => step.name === 'Upload artifacts' && /^actions\/upload-artifact@/.test(step.uses ?? ''),
  );

  assert.match(buildStep.run, /--bundles app(?:\s|$)/);
  assert.doesNotMatch(buildStep.run, /--bundles app,dmg/);
  assert.match(collectStep.run, /ln -s \/Applications/);
  assert.match(collectStep.run, /hdiutil create/);
  assert.match(collectStep.run, /-srcfolder/);
  assert.match(collectStep.run, /-format UDZO/);
  assert.match(collectStep.run, /hdiutil verify/);
  assert.match(collectStep.run, /AstrBot_\$\{ASTRBOT_VERSION\}_macos_\$\{\{ matrix\.arch \}\}\.dmg/);
  assert.match(uploadStep.with?.path ?? '', /release-artifacts\/\*\.dmg/);
});

test('release workflow disables generated release notes for nightly builds', async () => {
  const workflowObject = await readWorkflowObject(WORKFLOW_FILE);
  const steps = extractWorkflowJobSteps(workflowObject, RELEASE_JOB);
  const releaseStep = findStep(
    steps,
    'Create or update release',
    (step) => step.name === 'Create or update release' && /^softprops\/action-gh-release@/.test(step.uses ?? ''),
  );

  assert.equal(
    releaseStep.with?.generate_release_notes,
    "${{ needs.resolve_build_context.outputs.build_mode != 'nightly' }}",
  );
});

test('release workflow publishes immutable R2 objects before promoting the channel manifest', async () => {
  const workflowObject = await readWorkflowObject(WORKFLOW_FILE);
  const steps = extractWorkflowJobSteps(workflowObject, RELEASE_JOB);
  const immutableUploadIndex = findStepIndex(
    steps,
    (step) => step.name === 'Upload immutable release objects to Cloudflare R2',
    'immutable R2 upload step',
  );
  const publicObjectVerificationIndex = findStepIndex(
    steps,
    (step) => step.name === 'Verify immutable R2 updater objects on public origin',
    'public R2 object verification step',
  );
  const githubReleaseIndex = findStepIndex(
    steps,
    (step) => step.name === 'Create or update release',
    'GitHub release step',
  );
  const channelPromotionIndex = findStepIndex(
    steps,
    (step) => step.name === 'Promote Cloudflare R2 updater channel',
    'R2 channel promotion step',
  );

  assert.ok(immutableUploadIndex < publicObjectVerificationIndex);
  assert.ok(publicObjectVerificationIndex < githubReleaseIndex);
  assert.ok(githubReleaseIndex < channelPromotionIndex);
  assert.match(steps[immutableUploadIndex].run, /--phase artifacts/);
  assert.match(steps[publicObjectVerificationIndex].run, /urlsplit\(url\)/);
  assert.match(steps[publicObjectVerificationIndex].run, /--retry-max-time 300/);
  assert.match(steps[channelPromotionIndex].run, /--phase channel/);
  assert.match(steps[channelPromotionIndex].run, /--retry-max-time 300/);
  assert.match(
    steps[channelPromotionIndex].run,
    /desktop\/channels\/\$\{UPDATER_CHANNEL\}\/latest\.json/,
  );
});

test('updater manifest generation points release artifacts at the R2 public origin', async () => {
  const workflowObject = await readWorkflowObject(WORKFLOW_FILE);
  const steps = extractWorkflowJobSteps(workflowObject, RELEASE_JOB);
  const manifestStep = findStep(
    steps,
    'Generate Tauri updater manifest',
    (step) => step.name === 'Generate Tauri updater manifest',
  );

  assert.equal(manifestStep.id, 'updater_manifest');
  assert.match(
    manifestStep.run,
    /--asset-base-url "\$\{R2_PUBLIC_BASE_URL%\/\}\/desktop\/releases\/\$\{RELEASE_VERSION\}\/\$\{R2_RELEASE_ID\}"/,
  );
  assert.equal(manifestStep.env?.R2_RELEASE_ID, '${{ github.run_id }}-${{ github.run_attempt }}');
});
