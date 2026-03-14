export const DESKTOP_TARGET_ARCH_ENV = 'ASTRBOT_DESKTOP_TARGET_ARCH';
export const WINDOWS_ARM_BACKEND_ARCH_ENV = 'ASTRBOT_DESKTOP_WINDOWS_ARM_BACKEND_ARCH';
export const BUNDLED_RUNTIME_ARCH_ENV = 'ASTRBOT_DESKTOP_BUNDLED_RUNTIME_ARCH';

const PROCESS_ARCH_MAP = {
  x64: 'amd64',
  arm64: 'arm64',
};

const hasNonEmptyEnvOverride = (env, key) => Boolean(String(env[key] ?? '').trim());

export const hasRuntimeArchOverride = (env = process.env) =>
  hasNonEmptyEnvOverride(env, BUNDLED_RUNTIME_ARCH_ENV) ||
  hasNonEmptyEnvOverride(env, DESKTOP_TARGET_ARCH_ENV);

export const normalizeDesktopArch = (rawArch, sourceName) => {
  const raw = String(rawArch ?? '').trim().toLowerCase();
  if (raw === 'amd64' || raw === 'x64') {
    return 'amd64';
  }
  if (raw === 'arm64' || raw === 'aarch64') {
    return 'arm64';
  }
  throw new Error(
    `Invalid ${sourceName} value "${raw}". Expected one of: amd64, x64, arm64, aarch64.`,
  );
};

export const resolveDesktopTargetArch = ({ arch = process.arch, env = process.env } = {}) => {
  const overrideRaw = env[DESKTOP_TARGET_ARCH_ENV];
  if (hasNonEmptyEnvOverride(env, DESKTOP_TARGET_ARCH_ENV)) {
    return normalizeDesktopArch(overrideRaw, DESKTOP_TARGET_ARCH_ENV);
  }

  const mappedArch = PROCESS_ARCH_MAP[arch];
  if (mappedArch) {
    return mappedArch;
  }

  throw new Error(`Unsupported process.arch for desktop target resolution: ${arch}`);
};

export const resolveBundledRuntimeArch = ({
  platform = process.platform,
  arch = process.arch,
  env = process.env,
} = {}) => {
  const explicitBundledRuntimeArch = env[BUNDLED_RUNTIME_ARCH_ENV];
  if (hasNonEmptyEnvOverride(env, BUNDLED_RUNTIME_ARCH_ENV)) {
    return normalizeDesktopArch(explicitBundledRuntimeArch, BUNDLED_RUNTIME_ARCH_ENV);
  }

  const targetArch = resolveDesktopTargetArch({ arch, env });
  if (platform !== 'win32' || targetArch !== 'arm64') {
    return targetArch;
  }

  const windowsArmBackendArch = env[WINDOWS_ARM_BACKEND_ARCH_ENV];
  if (!hasNonEmptyEnvOverride(env, WINDOWS_ARM_BACKEND_ARCH_ENV)) {
    return 'amd64';
  }

  return normalizeDesktopArch(windowsArmBackendArch, WINDOWS_ARM_BACKEND_ARCH_ENV);
};

export const isWindowsArm64BundledRuntime = ({
  platform = process.platform,
  arch = process.arch,
  env = process.env,
} = {}) => {
  if (platform !== 'win32') {
    return false;
  }

  if (!hasRuntimeArchOverride(env) && !PROCESS_ARCH_MAP[arch]) {
    return false;
  }

  return resolveBundledRuntimeArch({ platform, arch, env }) === 'arm64';
};
