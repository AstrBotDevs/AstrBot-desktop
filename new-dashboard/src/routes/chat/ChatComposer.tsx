import {
  forwardRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import { MdiIcon } from '@/components/icons/MdiIcon';

import './ChatComposer.scss';

export type ChatComposerAttachment = {
  /** Stable server id or a caller-generated local id. */
  id: string;
  name: string;
  kind: 'audio' | 'file' | 'image';
  /** Image thumbnail/object URL. The owner remains responsible for revoking object URLs. */
  previewUrl?: string;
};

export type ChatComposerReply = {
  messageId: string | number;
  selectedText?: string;
};

export type ChatComposerCommand = {
  aliases?: string[];
  command: string;
  description?: string;
  disabled?: boolean;
  pluginName?: string;
  reserved?: boolean;
};

export type ChatComposerConfig = {
  description?: string;
  id: string;
  name: string;
};

export type ChatComposerTokenUsage = {
  percent: number;
  tooltip: string;
};

export type ChatComposerLabels = Partial<{
  clear: string;
  config: string;
  dropToUpload: string;
  recording: string;
  send: string;
  startRecording: string;
  stopGenerating: string;
  stopRecording: string;
  streamingDisabled: string;
  streamingEnabled: string;
  upload: string;
}>;

export type ChatComposerProps = {
  attachments?: ChatComposerAttachment[];
  commands?: ChatComposerCommand[];
  commandSuggestionsLabel: string;
  configs?: ChatComposerConfig[];
  configId?: string;
  disabled?: boolean;
  isRecording?: boolean;
  isRunning?: boolean;
  labels?: ChatComposerLabels;
  maxRowsHeight?: number;
  onChange: (value: string) => void;
  onClearReply?: () => void;
  onConfigChange?: (configId: string) => void;
  onFiles?: (files: File[]) => void;
  onRemoveAttachment?: (attachment: ChatComposerAttachment, index: number) => void;
  onSend: () => void;
  onStartRecording?: () => void;
  onStop?: () => void;
  onStopRecording?: () => void;
  onToggleStreaming?: () => void;
  placeholder?: string;
  replyTo?: ChatComposerReply | null;
  sendShortcut?: 'enter' | 'shift_enter';
  streaming?: boolean;
  tokenUsage?: ChatComposerTokenUsage | null;
  value: string;
  wakePrefixes?: string[];
};

export type ChatComposerHandle = {
  focus: () => void;
  openFilePicker: () => void;
};

const defaultLabels: Required<ChatComposerLabels> = {
  clear: 'Clear',
  config: 'Configuration',
  dropToUpload: 'Drop files to upload',
  recording: 'Recording',
  send: 'Send',
  startRecording: 'Start recording',
  stopGenerating: 'Stop generating',
  stopRecording: 'Stop recording',
  streamingDisabled: 'Streaming disabled',
  streamingEnabled: 'Streaming enabled',
  upload: 'Upload files',
};

/**
 * Controlled ChatUI composer.
 *
 * Uploading, recording, configuration persistence and sending stay in the
 * parent. This component owns only input interaction and presentation.
 */
export const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(function ChatComposer({
  attachments = [],
  commands = [],
  commandSuggestionsLabel,
  configs = [],
  configId = 'default',
  disabled = false,
  isRecording = false,
  isRunning = false,
  labels: labelsOverride,
  maxRowsHeight = 420,
  onChange,
  onClearReply,
  onConfigChange,
  onFiles,
  onRemoveAttachment,
  onSend,
  onStartRecording,
  onStop,
  onStopRecording,
  onToggleStreaming,
  placeholder = '',
  replyTo = null,
  sendShortcut = 'enter',
  streaming = true,
  tokenUsage = null,
  value,
  wakePrefixes = ['/'],
}, ref) {
  const labels = { ...defaultLabels, ...labelsOverride };
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const lastCompositionEndRef = useRef(0);
  const dragDepthRef = useRef(0);
  const recordTimerRef = useRef<number | null>(null);
  const ctrlBRecordingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [multiline, setMultiline] = useState(false);
  const [selectedCommand, setSelectedCommand] = useState(0);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);

  const canSend = !disabled && !isRecording && Boolean(value.trim() || attachments.length);
  const normalizedPrefixes = wakePrefixes.filter(Boolean);

  const suggestions = useMemo(() => {
    const prefix = normalizedPrefixes.find((candidate) => value.startsWith(candidate));
    if (!prefix) return [];
    const query = value.slice(prefix.length).trim().toLocaleLowerCase();
    const expanded: Array<ChatComposerCommand & { displayCommand: string }> = [];
    const seen = new Set<string>();
    const add = (item: ChatComposerCommand, command: string) => {
      const displayCommand = normalizedPrefixes.some((candidate) => command.startsWith(candidate))
        ? command
        : `${normalizedPrefixes[0] || '/'}${command}`;
      if (!item.disabled && !seen.has(displayCommand)) {
        seen.add(displayCommand);
        expanded.push({ ...item, displayCommand });
      }
    };
    commands.forEach((item) => {
      add(item, item.command);
      item.aliases?.forEach((alias) => add(item, alias));
    });
    const score = (item: ChatComposerCommand & { displayCommand: string }) => {
      const command = item.displayCommand.slice(prefix.length).toLocaleLowerCase();
      if (!query) return item.reserved ? 0 : 1;
      if (command.startsWith(query)) return item.reserved ? 0 : 1;
      if (`${command} ${item.pluginName || ''} ${item.description || ''}`.toLocaleLowerCase().includes(query)) return item.reserved ? 2 : 3;
      return 10;
    };
    return expanded.filter((item) => score(item) < 10).sort((a, b) => score(a) - score(b));
  }, [commands, normalizedPrefixes, value]);

  const resize = useCallback(() => {
    const field = textareaRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, maxRowsHeight)}px`;
    setMultiline(value.includes('\n') || field.scrollHeight > 44);
  }, [maxRowsHeight, value]);

  useEffect(resize, [resize, value]);
  useEffect(() => setSelectedCommand(0), [suggestions.length, value]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (menuOpen && !menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  useEffect(() => () => {
    if (recordTimerRef.current != null) window.clearTimeout(recordTimerRef.current);
  }, []);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    openFilePicker: () => fileInputRef.current?.click(),
  }), []);

  const chooseCommand = useCallback((command: string) => {
    onChange(`${command} `);
    setSelectedCommand(0);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [onChange]);

  const submit = useCallback(() => {
    if (canSend) onSend();
  }, [canSend, onSend]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (composingRef.current || event.nativeEvent.isComposing || Date.now() - lastCompositionEndRef.current < 40) return;
    if (!suggestionsDismissed && suggestions.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        setSelectedCommand((current) => (current + delta + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setSuggestionsDismissed(true);
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        chooseCommand(suggestions[selectedCommand]?.displayCommand || suggestions[0].displayCommand);
        return;
      }
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'b' && !event.repeat && !isRecording) {
      event.preventDefault();
      recordTimerRef.current = window.setTimeout(() => {
        ctrlBRecordingRef.current = true;
        onStartRecording?.();
      }, 300);
      return;
    }
    if (event.key !== 'Enter') return;
    const modifierSend = event.ctrlKey || event.metaKey;
    const shortcutSend = sendShortcut === 'enter' ? !event.shiftKey : event.shiftKey;
    if (modifierSend || shortcutSend) {
      event.preventDefault();
      submit();
    }
  };

  const handleKeyUp = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key.toLocaleLowerCase() !== 'b') return;
    if (recordTimerRef.current != null) {
      window.clearTimeout(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (ctrlBRecordingRef.current) {
      ctrlBRecordingRef.current = false;
      onStopRecording?.();
    }
  };

  const forwardFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length) onFiles?.(list);
  };

  const handlePaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const images = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (images.length) onFiles?.(images);
  };

  const dragEnter = (event: ReactDragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragging(true);
  };
  const dragLeave = (event: ReactDragEvent) => {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (!dragDepthRef.current) setDragging(false);
  };
  const drop = (event: ReactDragEvent) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragging(false);
    forwardFiles(event.dataTransfer.files);
  };

  return <footer
    className="chat-composer-v2"
    onDragEnter={dragEnter}
    onDragLeave={dragLeave}
    onDragOver={(event) => event.preventDefault()}
    onDrop={drop}
    ref={rootRef}
  >
    <div className={`chat-composer-v2__surface${multiline ? ' is-multiline' : ''}${attachments.length ? ' has-attachments' : ''}`}>
      {dragging && <div className="chat-composer-v2__drop"><MdiIcon name="mdi-cloud-upload-outline" /><strong>{labels.dropToUpload}</strong></div>}
      {replyTo && <div className="chat-composer-v2__reply">
        <span><MdiIcon name="mdi-reply" /><q>{replyTo.selectedText || ''}</q></span>
        <button aria-label={labels.clear} className="chat-composer-v2__icon-button" onClick={onClearReply} type="button"><MdiIcon name="mdi-close" /></button>
      </div>}
      {attachments.length > 0 && <div className="chat-composer-v2__attachments">
        {attachments.map((attachment, index) => <div className={`chat-composer-v2__attachment${attachment.kind === 'image' ? ' is-image' : ''}`} key={attachment.id}>
          {attachment.kind === 'image' && attachment.previewUrl
            ? <img alt={attachment.name} src={attachment.previewUrl} />
            : <span className="chat-composer-v2__attachment-icon"><MdiIcon name={attachment.kind === 'audio' ? 'mdi-microphone' : 'mdi-file-outline'} /></span>}
          {attachment.kind !== 'image' && <span>{attachment.kind === 'audio' ? labels.recording : attachment.name}</span>}
          <button aria-label={`${labels.clear} ${attachment.name}`} className="chat-composer-v2__remove" onClick={() => onRemoveAttachment?.(attachment, index)} type="button"><MdiIcon name="mdi-close" /></button>
        </div>)}
      </div>}
      {!suggestionsDismissed && suggestions.length > 0 && <ul aria-label={commandSuggestionsLabel} className="chat-composer-v2__suggestions" role="listbox">
        {suggestions.map((command, index) => <li key={`${command.command}-${command.displayCommand}`}>
          <button
            aria-selected={index === selectedCommand}
            className={index === selectedCommand ? 'is-selected' : ''}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => chooseCommand(command.displayCommand)}
            role="option"
            type="button"
          >
            <strong>{command.displayCommand}</strong>
            <span>{command.description || command.pluginName || ''}</span>
          </button>
        </li>)}
      </ul>}
      <div className="chat-composer-v2__row">
        <div className="chat-composer-v2__left" ref={menuRef}>
          <button aria-expanded={menuOpen} aria-haspopup="menu" aria-label={labels.upload} className="chat-composer-v2__icon-button" onClick={() => setMenuOpen((open) => !open)} type="button"><MdiIcon name="mdi-plus" /></button>
          {menuOpen && <div className="chat-composer-v2__menu" role="menu">
            <button disabled={disabled} onClick={() => { fileInputRef.current?.click(); setMenuOpen(false); }} role="menuitem" type="button"><MdiIcon name="mdi-file-upload-outline" />{labels.upload}</button>
            {onConfigChange && <label className="chat-composer-v2__config">
              <MdiIcon name="mdi-tune" /><span>{labels.config}</span>
              <select aria-label={labels.config} onChange={(event) => onConfigChange(event.target.value)} value={configId}>
                {configs.map((config) => <option key={config.id} value={config.id}>{config.name}</option>)}
              </select>
              {configs.find((config) => config.id === configId)?.description && <small>{configs.find((config) => config.id === configId)?.description}</small>}
            </label>}
            {onToggleStreaming && <button aria-pressed={streaming} onClick={onToggleStreaming} role="menuitem" type="button"><MdiIcon name="mdi-lightning-bolt" />{streaming ? labels.streamingEnabled : labels.streamingDisabled}</button>}
          </div>}
          <input
            hidden
            multiple
            onChange={(event) => {
              if (event.target.files) forwardFiles(event.target.files);
              event.target.value = '';
            }}
            ref={fileInputRef}
            type="file"
          />
        </div>
        <div className="chat-composer-v2__field">
          <textarea
            aria-label={placeholder}
            disabled={disabled}
            onChange={(event) => {
              if (!composingRef.current) {
                setSuggestionsDismissed(false);
                onChange(event.target.value);
              }
            }}
            onCompositionEnd={(event) => {
              composingRef.current = false;
              lastCompositionEndRef.current = Date.now();
              onChange(event.currentTarget.value);
            }}
            onCompositionStart={() => { composingRef.current = true; }}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            onPaste={handlePaste}
            placeholder={placeholder}
            ref={textareaRef}
            rows={1}
            value={value}
          />
        </div>
        <div className="chat-composer-v2__right">
          {tokenUsage && <span
            aria-label={tokenUsage.tooltip}
            className="chat-composer-v2__token"
            role="img"
            style={{ '--chat-token-percent': `${Math.max(0, Math.min(100, tokenUsage.percent)) * 3.6}deg` } as CSSProperties}
            tabIndex={0}
            title={tokenUsage.tooltip}
          />}
          {(onStartRecording || onStopRecording) && <button
            aria-label={isRecording ? labels.stopRecording : labels.startRecording}
            aria-pressed={isRecording}
            className={`chat-composer-v2__icon-button chat-composer-v2__record${isRecording ? ' is-recording' : ''}`}
            disabled={disabled}
            onClick={isRecording ? onStopRecording : onStartRecording}
            title={isRecording ? labels.stopRecording : labels.startRecording}
            type="button"
          ><MdiIcon name={isRecording ? 'mdi-stop-circle' : 'mdi-microphone'} /></button>}
          {isRunning
            ? <button aria-label={labels.stopGenerating} className="chat-composer-v2__icon-button chat-composer-v2__send" onClick={onStop} title={labels.stopGenerating} type="button"><MdiIcon name="mdi-stop" /></button>
            : <button aria-label={labels.send} className="chat-composer-v2__icon-button chat-composer-v2__send" disabled={!canSend} onClick={submit} title={labels.send} type="button"><MdiIcon name="mdi-arrow-up" /></button>}
        </div>
      </div>
    </div>
  </footer>;
});
