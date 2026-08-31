import path from 'node:path';

const requiredString = (value, field) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error(`Backend runtime manifest field ${field} must not be empty.`);
  }
  return normalized;
};

export const requiredRuntimeRelativePath = (value, field) => {
  const normalized = requiredString(value, field);
  const portablePath = normalized.replaceAll('\\', '/');
  const segments = portablePath.split('/');
  if (
    normalized.includes('\0') ||
    path.posix.isAbsolute(portablePath) ||
    path.win32.parse(normalized).root ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(
      `Backend runtime manifest field ${field} must be a canonical relative path inside the backend directory.`,
    );
  }
  return normalized;
};

const optionalString = (value) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
};

export const createRuntimeManifest = ({
  python,
  entrypoint,
  app,
  desktopVersion,
  coreVersion,
  sourceRef,
  sourceCommit,
}) => ({
  mode: 'cpython-runtime',
  python: requiredRuntimeRelativePath(python, 'python'),
  entrypoint: requiredRuntimeRelativePath(entrypoint, 'entrypoint'),
  app: requiredString(app, 'app'),
  desktopVersion: requiredString(desktopVersion, 'desktopVersion').replace(/^v/i, ''),
  coreVersion: requiredString(coreVersion, 'coreVersion').replace(/^v/i, ''),
  sourceRef: optionalString(sourceRef),
  sourceCommit: optionalString(sourceCommit),
});
