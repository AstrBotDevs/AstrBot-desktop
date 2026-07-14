import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const resolveCargoCommand = ({
  env = process.env,
  platform = process.platform,
  homeDirectory = homedir(),
  pathExists = existsSync,
} = {}) => {
  const configuredCargo = env.CARGO?.trim();
  const platformPath = platform === 'win32' ? path.win32 : path.posix;
  const defaultCargoPath = platformPath.join(
    homeDirectory,
    '.cargo',
    'bin',
    platform === 'win32' ? 'cargo.exe' : 'cargo',
  );

  if (configuredCargo) {
    return { command: configuredCargo, defaultCargoPath };
  }
  if (pathExists(defaultCargoPath)) {
    return { command: defaultCargoPath, defaultCargoPath };
  }
  return { command: 'cargo', defaultCargoPath };
};
