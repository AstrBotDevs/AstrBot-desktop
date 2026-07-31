import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('./_motion-transitions.scss', import.meta.url), 'utf8');

describe('shared motion transitions', () => {
  it('releases layout transforms after entrance animations finish', () => {
    expect(styles).toContain('animation: motion-page-in 0.26s ease-out backwards');
    expect(styles).toContain('animation: motion-content-in 0.22s ease-out backwards');
    expect(styles).not.toMatch(/motion-(?:page|content)-in[^;]*\bboth\b/);
  });
});
