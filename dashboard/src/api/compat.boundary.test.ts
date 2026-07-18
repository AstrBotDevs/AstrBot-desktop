import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const sourceRoot = join(process.cwd(), 'src');
const allowedLegacyEndpointFiles = new Set(['api/auth.ts', 'api/compat.ts', 'api/http.ts', 'config/endpoints.ts']);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (name === 'generated') return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !name.includes('.test.') ? [path] : [];
  });
}

describe('migration compatibility boundary', () => {
  it('keeps unversioned endpoint literals inside the compatibility boundary', () => {
    const violations = sourceFiles(sourceRoot)
      .filter((path) => /['"`]\/api\/(?!v1\/)/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(sourceRoot, path).replace(/\\/g, '/'))
      .filter((path) => !allowedLegacyEndpointFiles.has(path));

    expect(violations).toEqual([]);
  });

  it('does not add Vue migration markers to runtime source', () => {
    const violations = sourceFiles(sourceRoot)
      .filter((path) => /\bported from (?:the )?Vue\b|Vue's .* equivalent/i.test(readFileSync(path, 'utf8')))
      .map((path) => relative(sourceRoot, path).replace(/\\/g, '/'));

    expect(violations).toEqual([]);
  });
});
