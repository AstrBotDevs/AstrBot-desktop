// @vitest-environment jsdom

import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MonacoEditor } from './MonacoEditor';

const editorMock = vi.hoisted(() => {
  const state: { listener?: () => void; value: string } = { value: '' };
  const instance = {
    dispose: vi.fn(),
    getModel: vi.fn(() => ({ id: 'model' })),
    getValue: vi.fn(() => state.value),
    layout: vi.fn(),
    onDidChangeModelContent: vi.fn((listener: () => void) => {
      state.listener = listener;
      return { dispose: vi.fn() };
    }),
    setValue: vi.fn((value: string) => {
      state.value = value;
    }),
  };
  const monaco = {
    editor: {
      create: vi.fn((_container: HTMLElement, options: { value: string }) => {
        state.value = options.value;
        return instance;
      }),
      setModelLanguage: vi.fn(),
      setTheme: vi.fn(),
    },
  };
  return { instance, monaco, state };
});

vi.mock('./monacoRuntime', () => ({ monaco: editorMock.monaco }));

describe('MonacoEditor', () => {
  it('synchronizes props and disposes the editor lifecycle', async () => {
    const onChange = vi.fn();
    const { rerender, unmount } = render(
      <MonacoEditor ariaLabel="JSON editor" language="json" onChange={onChange} theme="vs" value="initial" />,
    );

    await waitFor(() => expect(editorMock.monaco.editor.create).toHaveBeenCalledOnce());
    expect(editorMock.monaco.editor.create).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ automaticLayout: true, language: 'json', theme: 'vs', value: 'initial' }),
    );

    act(() => {
      editorMock.state.value = 'from editor';
      editorMock.state.listener?.();
    });
    expect(onChange).toHaveBeenCalledWith('from editor');

    rerender(<MonacoEditor language="yaml" onChange={onChange} theme="vs-dark" value="from props" />);
    await waitFor(() => {
      expect(editorMock.instance.setValue).toHaveBeenCalledWith('from props');
      expect(editorMock.monaco.editor.setModelLanguage).toHaveBeenCalledWith({ id: 'model' }, 'yaml');
    });

    unmount();
    expect(editorMock.instance.dispose).toHaveBeenCalledOnce();
  });
});
