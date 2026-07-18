import { describe, expect, it } from 'vitest';

import { normalizeT2iPreview } from './configSpecialEditorsModel';

describe('normalizeT2iPreview', () => {
  it('injects preview variables and the shiki runtime', () => {
    const result = normalizeT2iPreview(
      '<html><head></head><body>{{ text | safe }} {{ version }}</body></html>',
      'preview text',
      'v4.2.0',
    );

    expect(result).toContain('preview text v4.2.0');
    expect(result).toContain('astrbot-t2i-shiki-runtime');
  });

  it('does not inject the runtime twice', () => {
    const source = '<script id="astrbot-t2i-shiki-runtime" src="/t2i/shiki_runtime.iife.js"></script>';
    expect(normalizeT2iPreview(source, 'x', 'v1').match(/astrbot-t2i-shiki-runtime/g)).toHaveLength(1);
  });
});
