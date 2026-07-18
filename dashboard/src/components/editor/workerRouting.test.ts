import { describe, expect, it } from 'vitest';

import { resolveMonacoWorkerKind } from './workerRouting';

describe('Monaco worker routing', () => {
  it('routes language services to their dedicated workers', () => {
    expect(resolveMonacoWorkerKind('json')).toBe('json');
    expect(resolveMonacoWorkerKind('scss')).toBe('css');
    expect(resolveMonacoWorkerKind('html')).toBe('html');
    expect(resolveMonacoWorkerKind('typescript')).toBe('typescript');
  });

  it('uses the editor worker for other labels', () => {
    expect(resolveMonacoWorkerKind('yaml')).toBe('editor');
  });
});
