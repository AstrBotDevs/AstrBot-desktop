import { memo } from 'react';
import { cjk } from '@streamdown/cjk';
import { code } from '@streamdown/code';
import { createMathPlugin } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import { Streamdown } from 'streamdown';

import 'katex/dist/katex.min.css';
import 'streamdown/styles.css';
import './content.scss';

type MarkdownProps = {
  className?: string;
  content: string;
  streaming?: boolean;
};

const math = createMathPlugin({ singleDollarTextMath: true });
const plugins = { cjk, code, math, mermaid };
const streamingPlugins = { cjk };

function MarkdownComponent({ className = '', content, streaming = false }: MarkdownProps) {
  const rootClassName = [
    'markdown-body',
    streaming ? 'markdown-body--streaming' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <Streamdown
      animated
      caret="block"
      className={rootClassName}
      controls={streaming ? false : undefined}
      dir="auto"
      isAnimating={streaming}
      lineNumbers={!streaming}
      mermaid={{ config: { securityLevel: 'strict', theme: 'neutral' } }}
      mode={streaming ? 'streaming' : 'static'}
      parseIncompleteMarkdown={streaming}
      plugins={streaming ? streamingPlugins : plugins}
      skipHtml
    >
      {content}
    </Streamdown>
  );
}

export const Markdown = memo(MarkdownComponent);
