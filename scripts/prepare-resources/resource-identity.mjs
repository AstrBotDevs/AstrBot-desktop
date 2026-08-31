import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { requiredRuntimeRelativePath } from '../backend/runtime-manifest.mjs';

const VERSION_PREFIX_PATTERN = /^v/i;
const LOCAL_ENTRY_PATTERN = /\.(?:css|js)$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SEMVER_CORE_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const SEMVER_IDENTIFIER_PATTERN = /^[0-9A-Za-z-]+$/;

const sha256 = (content) => createHash('sha256').update(content).digest('hex');

export const normalizeResourceVersion = (version) => {
  const normalized = typeof version === 'string' ? version.trim().replace(VERSION_PREFIX_PATTERN, '') : '';
  if (!normalized) {
    throw new Error('Resource version must not be empty.');
  }
  return normalized;
};

export const formatWebuiVersion = (coreVersion) =>
  `v${normalizeResourceVersion(coreVersion)}`;

export const requiresDesktopCoreMatch = (desktopVersion) => {
  const normalized = normalizeResourceVersion(desktopVersion);
  const buildParts = normalized.split('+');
  if (
    buildParts.length > 2 ||
    (buildParts.length === 2 &&
      (!buildParts[1] ||
        !buildParts[1].split('.').every((part) => SEMVER_IDENTIFIER_PATTERN.test(part))))
  ) {
    return true;
  }
  const versionWithoutBuild = buildParts[0];
  const prereleaseSeparator = versionWithoutBuild.indexOf('-');
  const core = prereleaseSeparator < 0
    ? versionWithoutBuild
    : versionWithoutBuild.slice(0, prereleaseSeparator);
  if (!SEMVER_CORE_PATTERN.test(core)) {
    return true;
  }
  if (prereleaseSeparator < 0) {
    return true;
  }
  const prerelease = versionWithoutBuild.slice(prereleaseSeparator + 1);
  const identifiers = prerelease.split('.');
  const validPrerelease = identifiers.every(
    (identifier) =>
      SEMVER_IDENTIFIER_PATTERN.test(identifier) &&
      (!/^\d+$/.test(identifier) || identifier === '0' || !identifier.startsWith('0')),
  );
  // Match semver::Version on the Rust side: invalid versions fail closed as
  // stable, and build metadata alone does not make a release a prerelease.
  return !validPrerelease;
};

const normalizeLocalAssetReference = (reference) => {
  const trimmed = reference.trim();
  if (
    !trimmed ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('//') ||
    /^[a-z][a-z\d+.-]*:/i.test(trimmed)
  ) {
    return null;
  }

  const withoutQuery = trimmed.split(/[?#]/, 1)[0];
  let decoded;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    throw new Error(`WebUI index contains an invalid asset URL: ${reference}`);
  }

  const relative = decoded.replace(/^\/+/, '').replace(/^\.\//, '');
  if (!relative || !LOCAL_ENTRY_PATTERN.test(relative)) {
    return null;
  }

  const normalized = path.normalize(relative);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`) || path.isAbsolute(normalized)) {
    throw new Error(`WebUI index asset escapes the WebUI directory: ${reference}`);
  }
  return normalized;
};

export const extractWebuiEntryAssets = (indexHtml) => {
  const entries = new Set();
  const attributePattern = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  for (const match of indexHtml.matchAll(attributePattern)) {
    const entry = normalizeLocalAssetReference(match[1]);
    if (entry) {
      entries.add(entry);
    }
  }
  return [...entries].sort();
};

export const writeWebuiVersionMarker = async ({ webuiDir, coreVersion }) => {
  const assetsDir = path.join(webuiDir, 'assets');
  await mkdir(assetsDir, { recursive: true });
  await writeFile(
    path.join(assetsDir, 'version'),
    `${formatWebuiVersion(coreVersion)}\n`,
    'utf8',
  );
};

export const validateWebuiResources = async ({ webuiDir, expectedCoreVersion }) => {
  const indexPath = path.join(webuiDir, 'index.html');
  if (!existsSync(indexPath)) {
    throw new Error(`WebUI index is missing: ${indexPath}`);
  }

  const markerPath = path.join(webuiDir, 'assets', 'version');
  if (!existsSync(markerPath)) {
    throw new Error(`WebUI version marker is missing: ${markerPath}`);
  }

  const [indexContent, marker] = await Promise.all([
    readFile(indexPath),
    readFile(markerPath, 'utf8'),
  ]);
  const indexHtml = indexContent.toString('utf8');
  const webuiVersion = normalizeResourceVersion(marker);
  const coreVersion = normalizeResourceVersion(expectedCoreVersion);
  if (webuiVersion !== coreVersion) {
    throw new Error(
      `WebUI version mismatch: assets/version has ${marker.trim()}, expected v${coreVersion}.`,
    );
  }

  const entryAssets = extractWebuiEntryAssets(indexHtml);
  if (!entryAssets.some((entry) => entry.toLowerCase().endsWith('.js'))) {
    throw new Error(`WebUI index does not reference a JavaScript entry: ${indexPath}`);
  }
  const entryDigests = [];
  for (const entry of entryAssets) {
    const entryPath = path.join(webuiDir, entry);
    if (!existsSync(entryPath)) {
      throw new Error(`WebUI index references a missing entry asset: ${entryPath}`);
    }
    entryDigests.push({
      path: entry.split(path.sep).join('/'),
      sha256: sha256(await readFile(entryPath)),
    });
  }

  return {
    webuiVersion,
    indexSha256: sha256(indexContent),
    entryAssets,
    entryDigests,
  };
};

const expectedWebuiAttestation = (webui) => ({
  version: webui.webuiVersion,
  indexSha256: webui.indexSha256,
  entryAssets: webui.entryDigests,
});

const normalizeWebuiAttestation = (attestation) => {
  if (!attestation || typeof attestation !== 'object' || Array.isArray(attestation)) {
    throw new Error('Backend runtime manifest is missing the WebUI bundle attestation.');
  }
  const version = normalizeResourceVersion(attestation.version);
  const indexSha256 = typeof attestation.indexSha256 === 'string'
    ? attestation.indexSha256.trim().toLowerCase()
    : '';
  if (!SHA256_PATTERN.test(indexSha256)) {
    throw new Error('Backend runtime manifest WebUI indexSha256 must be a SHA-256 digest.');
  }
  if (!Array.isArray(attestation.entryAssets)) {
    throw new Error('Backend runtime manifest WebUI entryAssets must be an array.');
  }
  const entryAssets = attestation.entryAssets.map((entry) => {
    const entryPath = typeof entry?.path === 'string' ? entry.path.trim() : '';
    const entrySha256 = typeof entry?.sha256 === 'string'
      ? entry.sha256.trim().toLowerCase()
      : '';
    if (!entryPath || !SHA256_PATTERN.test(entrySha256)) {
      throw new Error('Backend runtime manifest contains an invalid WebUI entry digest.');
    }
    return { path: entryPath, sha256: entrySha256 };
  });
  return { version, indexSha256, entryAssets };
};

const validateWebuiAttestation = ({ manifest, webui, required }) => {
  if (manifest.webui === undefined && !required) {
    return;
  }
  const actual = normalizeWebuiAttestation(manifest.webui);
  const expected = expectedWebuiAttestation(webui);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('Backend runtime manifest WebUI bundle attestation does not match the prepared WebUI.');
  }
};

const validateRuntimeFileContainment = async ({ backendDir, relativePath, field }) => {
  let backendRoot;
  let resolvedFile;
  try {
    [backendRoot, resolvedFile] = await Promise.all([
      realpath(backendDir),
      realpath(path.resolve(backendDir, relativePath)),
    ]);
  } catch (error) {
    throw new Error(
      `Backend runtime manifest ${field} file is missing or unreadable: ${relativePath} (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const relativeToBackend = path.relative(backendRoot, resolvedFile);
  if (
    !relativeToBackend ||
    path.isAbsolute(relativeToBackend) ||
    relativeToBackend === '..' ||
    relativeToBackend.startsWith(`..${path.sep}`)
  ) {
    throw new Error(
      `Backend runtime manifest ${field} resolves outside the backend directory: ${relativePath}`,
    );
  }
  if (!(await stat(resolvedFile)).isFile()) {
    throw new Error(`Backend runtime manifest ${field} is not a file: ${relativePath}`);
  }
};

export const validateBackendRuntimeIdentity = async ({
  backendDir,
  expectedDesktopVersion = '',
  expectedCoreVersion,
  expectedSourceRef = '',
  expectedSourceCommit = '',
}) => {
  const manifestPath = path.join(backendDir, 'runtime-manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Backend runtime manifest is missing: ${manifestPath}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Backend runtime manifest is invalid: ${manifestPath} (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const manifestCoreVersion = normalizeResourceVersion(manifest.coreVersion);
  const runtimePython = requiredRuntimeRelativePath(manifest.python, 'python');
  const runtimeEntrypoint = requiredRuntimeRelativePath(manifest.entrypoint, 'entrypoint');
  await Promise.all([
    validateRuntimeFileContainment({
      backendDir,
      relativePath: runtimePython,
      field: 'python',
    }),
    validateRuntimeFileContainment({
      backendDir,
      relativePath: runtimeEntrypoint,
      field: 'entrypoint',
    }),
  ]);
  const coreVersion = normalizeResourceVersion(expectedCoreVersion);
  if (manifestCoreVersion !== coreVersion) {
    throw new Error(
      `Backend core version mismatch: runtime-manifest.json has ${manifest.coreVersion}, expected ${coreVersion}.`,
    );
  }
  if (expectedDesktopVersion) {
    const manifestDesktopVersion = normalizeResourceVersion(manifest.desktopVersion);
    const desktopVersion = normalizeResourceVersion(expectedDesktopVersion);
    if (manifestDesktopVersion !== desktopVersion) {
      throw new Error(
        `Backend Desktop version mismatch: runtime-manifest.json has ${manifest.desktopVersion}, expected ${desktopVersion}.`,
      );
    }
  }
  for (const field of ['sourceRef', 'sourceCommit']) {
    if (
      !(field in manifest) ||
      (manifest[field] !== null &&
        (typeof manifest[field] !== 'string' || !manifest[field].trim()))
    ) {
      throw new Error(`Backend runtime manifest field ${field} must be a string or null.`);
    }
  }
  if (expectedSourceRef && manifest.sourceRef !== expectedSourceRef) {
    throw new Error(
      `Backend source ref mismatch: runtime-manifest.json has ${manifest.sourceRef}, expected ${expectedSourceRef}.`,
    );
  }
  if (expectedSourceCommit && manifest.sourceCommit !== expectedSourceCommit) {
    throw new Error(
      `Backend source commit mismatch: runtime-manifest.json has ${manifest.sourceCommit}, expected ${expectedSourceCommit}.`,
    );
  }
  if (manifest.sourceCommit && !/^[0-9a-f]{40,64}$/i.test(manifest.sourceCommit)) {
    throw new Error('Backend runtime manifest sourceCommit must be a full Git commit hash.');
  }

  return manifest;
};

export const validatePreparedResourceBundle = async ({
  projectRoot,
  desktopVersion,
  coreVersion,
  sourceRepoRef = '',
  sourceRepoCommit = '',
  requireWebuiAttestation = false,
}) => {
  const normalizedDesktopVersion = normalizeResourceVersion(desktopVersion);
  const normalizedCoreVersion = normalizeResourceVersion(coreVersion);
  const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  const packageVersion = normalizeResourceVersion(packageJson.version);

  if (packageVersion !== normalizedDesktopVersion) {
    throw new Error(
      `Desktop version mismatch: package.json has ${packageJson.version}, expected ${normalizedDesktopVersion}.`,
    );
  }
  if (
    requiresDesktopCoreMatch(normalizedDesktopVersion) &&
    normalizedDesktopVersion !== normalizedCoreVersion
  ) {
    throw new Error(
      `Stable bundle version mismatch: Desktop is ${normalizedDesktopVersion}, but Core is ${normalizedCoreVersion}.`,
    );
  }

  const webui = await validateWebuiResources({
    webuiDir: path.join(projectRoot, 'resources', 'webui'),
    expectedCoreVersion: normalizedCoreVersion,
  });
  const backend = await validateBackendRuntimeIdentity({
    backendDir: path.join(projectRoot, 'resources', 'backend'),
    expectedDesktopVersion: normalizedDesktopVersion,
    expectedCoreVersion: normalizedCoreVersion,
    expectedSourceRef: sourceRepoRef,
    expectedSourceCommit: sourceRepoCommit,
  });
  validateWebuiAttestation({
    manifest: backend,
    webui,
    required: requireWebuiAttestation,
  });

  console.log(
    `[prepare-resources] Verified resource identity: Desktop ${normalizedDesktopVersion}, Core ${normalizedCoreVersion}, WebUI v${webui.webuiVersion}.`,
  );
  return { desktopVersion: normalizedDesktopVersion, coreVersion: normalizedCoreVersion, webui, backend };
};

export const attestPreparedResourceBundle = async (options) => {
  const identity = await validatePreparedResourceBundle({
    ...options,
    requireWebuiAttestation: false,
  });
  const manifestPath = path.join(options.projectRoot, 'resources', 'backend', 'runtime-manifest.json');
  const manifest = {
    ...identity.backend,
    webui: expectedWebuiAttestation(identity.webui),
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return validatePreparedResourceBundle({
    ...options,
    requireWebuiAttestation: true,
  });
};
