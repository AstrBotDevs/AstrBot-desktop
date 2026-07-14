import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { resolveCargoCommand } from './cargo-command.mjs';

test('prefers an explicitly configured Cargo executable', () => {
  const result = resolveCargoCommand({
    env: { CARGO: 'D:\\Rust\\cargo.exe' },
    platform: 'win32',
    homeDirectory: 'C:\\Users\\test',
    pathExists: () => true,
  });

  assert.equal(result.command, 'D:\\Rust\\cargo.exe');
});

test('uses the rustup default Cargo path when it exists', () => {
  const homeDirectory = path.win32.join('C:', 'Users', 'test');
  const expected = path.win32.join(homeDirectory, '.cargo', 'bin', 'cargo.exe');
  const result = resolveCargoCommand({
    env: {},
    platform: 'win32',
    homeDirectory,
    pathExists: (candidate) => candidate === expected,
  });

  assert.equal(result.command, expected);
});

test('falls back to PATH lookup when no default executable exists', () => {
  const result = resolveCargoCommand({
    env: {},
    platform: 'linux',
    homeDirectory: '/home/test',
    pathExists: () => false,
  });

  assert.equal(result.command, 'cargo');
  assert.equal(result.defaultCargoPath, '/home/test/.cargo/bin/cargo');
});
