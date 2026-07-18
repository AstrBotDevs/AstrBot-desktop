import { describe, expect, it } from 'vitest';

import { firstNoticeContent } from './firstNoticeModel';

describe('first notice model', () => {
  it('shows only non-empty Markdown content', () => {
    expect(firstNoticeContent({ content: '  # Notice  ' })).toBe('# Notice');
    expect(firstNoticeContent({ content: '   ' })).toBe('');
    expect(firstNoticeContent({ content: null })).toBe('');
    expect(firstNoticeContent(undefined)).toBe('');
  });
});
