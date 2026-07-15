import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Markdown } from './Markdown';

describe('Streamdown Markdown renderer', () => {
  it('repairs incomplete Markdown while streaming', () => {
    const html = renderToStaticMarkup(<Markdown content="A **streaming response" streaming />);

    expect(html).toContain('data-streamdown="strong"');
    expect(html).toContain('>streaming</span>');
    expect(html).toContain('>response</span>');
    expect(html).toContain('data-sd-animate="true"');
    expect(html).toContain('--streamdown-caret');
    expect(html).toContain('markdown-body--streaming');
  });

  it('renders static GFM without allowing raw HTML', () => {
    const html = renderToStaticMarkup(<Markdown content={'~~done~~\n\n<script>alert(1)</script>'} />);

    expect(html).toContain('<del>done</del>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('data-sd-animate');
    expect(html).not.toContain('--streamdown-caret');
    expect(html).not.toContain('markdown-body--streaming');
  });

  it('defers rich controls while content is still streaming', () => {
    const html = renderToStaticMarkup(<Markdown content={'```ts\nconst value = 1;\n```'} streaming />);

    expect(html).toContain('const value = 1;');
    expect(html).not.toContain('data-streamdown="code-block-actions"');
  });

  it('keeps the interactive Streamdown table and code structure', () => {
    const html = renderToStaticMarkup(<Markdown content={'```ts\nconst value = 1;\n```\n\n| Name | Value |\n| --- | --- |\n| Streamdown | 1 |'} />);

    expect(html).toContain('data-streamdown="code-block"');
    expect(html).toContain('data-streamdown="code-block-actions"');
    expect(html).toContain('data-streamdown="table-wrapper"');
    expect(html).toContain('title="Copy table"');
    expect(html).toContain('title="Download table"');
    expect(html).toContain('title="View fullscreen"');
  });
});
