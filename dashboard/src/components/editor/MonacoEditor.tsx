import { useEffect, useRef, useState } from 'react';
import type { editor } from 'monaco-editor';

type MonacoEditorProps = {
  ariaLabel?: string;
  className?: string;
  language?: string;
  onChange?: (value: string) => void;
  options?: editor.IStandaloneEditorConstructionOptions;
  theme?: string;
  value: string;
};

export function MonacoEditor({
  ariaLabel = 'Code editor',
  className = '',
  language = 'json',
  onChange,
  options,
  theme = 'vs',
  value,
}: MonacoEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  const [error, setError] = useState<string | null>(null);
  onChangeRef.current = onChange;
  valueRef.current = value;

  useEffect(() => {
    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;
    let resizeFrame: number | undefined;
    let previousWidth = -1;
    let previousHeight = -1;
    let cleanup = () => {};
    void import('./monacoRuntime')
      .then(({ monaco }) => {
        if (disposed || !containerRef.current) return;
        const instance = monaco.editor.create(containerRef.current, {
          automaticLayout: typeof ResizeObserver === 'undefined',
          language,
          minimap: { enabled: false },
          theme,
          value: valueRef.current,
          ...options,
        });
        editorRef.current = instance;
        const subscription = instance.onDidChangeModelContent(() => onChangeRef.current?.(instance.getValue()));
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(([entry]) => {
            const width = Math.round(entry.contentRect.width);
            const height = Math.round(entry.contentRect.height);
            if (width === previousWidth && height === previousHeight) return;
            previousWidth = width;
            previousHeight = height;
            if (resizeFrame !== undefined) window.cancelAnimationFrame(resizeFrame);
            resizeFrame = window.requestAnimationFrame(() => {
              resizeFrame = undefined;
              instance.layout({ width, height });
            });
          });
          resizeObserver.observe(containerRef.current);
        }
        cleanup = () => {
          resizeObserver?.disconnect();
          if (resizeFrame !== undefined) window.cancelAnimationFrame(resizeFrame);
          subscription.dispose();
          instance.dispose();
          editorRef.current = null;
        };
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
    return () => {
      disposed = true;
      cleanup();
    };
    // Construction-only options are intentionally applied when the editor mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const instance = editorRef.current;
    if (instance && instance.getValue() !== value) instance.setValue(value);
  }, [value]);

  useEffect(() => {
    void import('./monacoRuntime').then(({ monaco }) => {
      const model = editorRef.current?.getModel();
      if (model) monaco.editor.setModelLanguage(model, language);
    });
  }, [language]);

  useEffect(() => {
    void import('./monacoRuntime').then(({ monaco }) => monaco.editor.setTheme(theme));
  }, [theme]);

  if (error)
    return (
      <div className="monaco-editor-error" role="alert">
        {error}
      </div>
    );
  return <div aria-label={ariaLabel} className={`monaco-editor-host ${className}`.trim()} ref={containerRef} />;
}
