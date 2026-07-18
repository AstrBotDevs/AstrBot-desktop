import { Fragment, type MouseEvent, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Markdown } from '@/components/content/Markdown';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { apiEndpoints } from '@/config/endpoints';
import type { JsonObject } from '@/routes/configuration/model';
import type { ChatPart, ChatRecord } from './model';
import './ChatMessageList.scss';

export type ChatThread = JsonObject & {
  thread_id: string;
  selected_text?: string;
};

export type ChatReference = JsonObject & {
  id?: string | number;
  title?: string;
  text?: string;
  url?: string;
};

export type ChatToolCall = JsonObject & {
  id?: string;
  name?: string;
  arguments?: unknown;
  result?: unknown;
  finished_ts?: unknown;
  status?: string;
};

export type ChatMessageLabels = {
  assistant: string;
  copy: string;
  edit: string;
  retry: string;
  references: string;
  threads: string;
  reasoning: string;
  running: string;
  completed: string;
  download: string;
  replyTo: string;
  cachedTokens: string;
  inputTokens: string;
  outputTokens: string;
  ttft: string;
  duration: string;
  cancel: string;
  save: string;
};

export type ChatMessageListProps = {
  messages: ChatRecord[];
  className?: string;
  streaming?: boolean;
  streamingMessageId?: string | number | null;
  enableCopy?: boolean;
  enableEdit?: boolean;
  enableRetry?: boolean;
  enableThreadSelection?: boolean;
  editingMessageId?: string | number | null;
  editingValue?: string;
  editSaving?: boolean;
  retryModels?: Array<{ providerId: string; model: string }>;
  labels?: Partial<ChatMessageLabels>;
  resolvePartUrl?: (part: ChatPart, message: ChatRecord) => string;
  renderMarkdown?: (content: string, options: { message: ChatRecord; streaming: boolean }) => ReactNode;
  onCopy?: (message: ChatRecord, text: string) => void | Promise<void>;
  onEdit?: (message: ChatRecord) => void;
  onEditValueChange?: (value: string) => void;
  onCancelEdit?: () => void;
  onSaveEdit?: () => void;
  onRetry?: (message: ChatRecord) => void;
  onRetryWithModel?: (message: ChatRecord, providerId: string, model: string) => void;
  onReplyClick?: (messageId: string | number, message: ChatRecord) => void;
  onDownload?: (part: ChatPart, message: ChatRecord) => void | Promise<void>;
  onOpenImage?: (url: string, part: ChatPart, message: ChatRecord) => void;
  onOpenReasoning?: (message: ChatRecord, reasoning: string) => void;
  onOpenRefs?: (references: ChatReference[], message: ChatRecord) => void;
  onOpenThread?: (thread: ChatThread, message: ChatRecord) => void;
  onSelectText?: (selection: string, message: ChatRecord, event: MouseEvent<HTMLDivElement>) => void;
};

export function ChatMessageList({
  messages,
  className = '',
  streaming = false,
  streamingMessageId = null,
  enableCopy = true,
  enableEdit = true,
  enableRetry = true,
  enableThreadSelection = true,
  editingMessageId = null,
  editingValue = '',
  editSaving = false,
  retryModels = [],
  labels: customLabels,
  resolvePartUrl = defaultPartUrl,
  renderMarkdown,
  onCopy,
  onEdit,
  onEditValueChange,
  onCancelEdit,
  onSaveEdit,
  onRetry,
  onRetryWithModel,
  onReplyClick,
  onDownload,
  onOpenImage,
  onOpenReasoning,
  onOpenRefs,
  onOpenThread,
  onSelectText,
}: ChatMessageListProps) {
  const { t } = useTranslation();
  const labels = useMemo<ChatMessageLabels>(
    () => ({
      assistant: t('features.chat.message.assistant'),
      cachedTokens: t('features.chat.stats.cachedTokens'),
      cancel: t('core.common.cancel'),
      completed: t('core.status.completed'),
      copy: t('features.chat.actions.copy'),
      download: t('features.chat.input.download'),
      duration: t('features.chat.stats.duration'),
      edit: t('core.common.edit'),
      inputTokens: t('features.chat.stats.inputTokens'),
      outputTokens: t('features.chat.stats.outputTokens'),
      reasoning: t('features.chat.reasoning.thinking'),
      references: t('features.chat.refs.title'),
      replyTo: t('features.chat.reply.replyTo'),
      retry: t('features.chat.actions.retry'),
      running: t('features.chat.toolStatus.running'),
      save: t('core.common.save'),
      threads: t('features.chat.thread.title'),
      ttft: t('features.chat.stats.ttft'),
      ...customLabels,
    }),
    [customLabels, t],
  );
  const messageById = useMemo(() => new Map(messages.map((message) => [String(message.id), message])), [messages]);
  const latestEditableUserIndex = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (isUserMessage(message) && message.id != null && !String(message.id).startsWith('local-')) return index;
    }
    return -1;
  }, [messages]);

  return (
    <div className={`ab-chat-message-list ${className}`.trim()}>
      {messages.map((message, index) => {
        const user = isUserMessage(message);
        const activeStreaming =
          !user &&
          streaming &&
          (streamingMessageId == null
            ? index === messages.length - 1
            : String(message.id) === String(streamingMessageId));
        const parts = messageParts(message);
        const attachments = user ? parts.filter(isAttachmentPart) : [];
        const bubbleParts = user ? parts.filter((part) => !isAttachmentPart(part)) : parts;
        const refs = messageReferences(message);
        const threads = messageThreads(message);
        const text = plainText(message);
        const key = message.id ?? `${index}-${String(message.created_at || '')}`;
        const isEditing =
          editingMessageId != null && message.id != null && String(editingMessageId) === String(message.id);
        const showMeta = !activeStreaming && !message.content.isLoading;
        const canEdit = user && enableEdit && Boolean(onEdit) && index === latestEditableUserIndex;
        const canRetry =
          !user &&
          enableRetry &&
          Boolean(onRetry) &&
          index === messages.length - 1 &&
          !activeStreaming &&
          Boolean(message.llm_checkpoint_id);

        return (
          <div
            className={`ab-chat-message-row ${user ? 'is-user' : 'is-bot'}`}
            data-message-id={message.id == null ? undefined : String(message.id)}
            id={message.id == null ? undefined : `chat-message-${message.id}`}
            key={key}
          >
            {!user && (
              <div
                className={`ab-chat-message-avatar ${activeStreaming ? 'is-streaming' : ''}`}
                title={labels.assistant}
              >
                {activeStreaming ? <span className="ab-chat-message-spinner" /> : <AstrBotMark />}
              </div>
            )}

            <div className="ab-chat-message-stack">
              {attachments.length > 0 && (
                <div
                  className={`ab-chat-sent-attachments ${attachments.every((part) => part.type === 'image') ? 'is-images-only' : ''}`}
                >
                  {attachments.map((part, partIndex) => (
                    <AttachmentPart
                      key={`${part.type}-${partIndex}`}
                      labels={labels}
                      message={message}
                      onDownload={onDownload}
                      onOpenImage={onOpenImage}
                      part={part}
                      resolvePartUrl={resolvePartUrl}
                      sent
                    />
                  ))}
                </div>
              )}

              {(bubbleParts.length > 0 || message.content.isLoading) && (
                <div
                  className={`ab-chat-message-bubble ${user ? 'is-user' : 'is-bot'}`}
                  onMouseUp={(event) => {
                    if (!enableThreadSelection || user || !onSelectText) return;
                    const selection = window.getSelection()?.toString().trim() || '';
                    if (selection) onSelectText(selection, message, event);
                  }}
                >
                  {isEditing ? (
                    <div className="ab-chat-inline-edit">
                      <textarea
                        autoFocus
                        disabled={editSaving}
                        onChange={(event) => onEditValueChange?.(event.target.value)}
                        onKeyDown={(event) => {
                          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') onSaveEdit?.();
                          if (event.key === 'Escape') onCancelEdit?.();
                        }}
                        rows={Math.max(3, editingValue.split('\n').length)}
                        value={editingValue}
                      />
                      <div>
                        <button disabled={editSaving} onClick={onCancelEdit} type="button">
                          {labels.cancel}
                        </button>
                        <button
                          className="is-primary"
                          disabled={editSaving || !editingValue.trim()}
                          onClick={onSaveEdit}
                          type="button"
                        >
                          {labels.save}
                        </button>
                      </div>
                    </div>
                  ) : message.content.isLoading && bubbleParts.length === 0 ? (
                    <span className="ab-chat-message-loading">
                      <span className="ab-chat-message-spinner" /> {labels.running}
                    </span>
                  ) : (
                    bubbleParts.map((part, partIndex) => (
                      <MessagePart
                        key={`${part.type}-${partIndex}`}
                        labels={labels}
                        message={message}
                        messageById={messageById}
                        onDownload={onDownload}
                        onOpenImage={onOpenImage}
                        onOpenReasoning={onOpenReasoning}
                        onReplyClick={onReplyClick}
                        part={part}
                        renderMarkdown={renderMarkdown}
                        resolvePartUrl={resolvePartUrl}
                        streaming={activeStreaming}
                        user={user}
                      />
                    ))
                  )}
                </div>
              )}

              {showMeta && !isEditing && (
                <div className="ab-chat-message-meta">
                  {message.created_at ? (
                    <time dateTime={String(message.created_at)}>{formatTime(message.created_at)}</time>
                  ) : null}
                  {canEdit ? (
                    <IconButton icon="mdi-pencil-outline" label={labels.edit} onClick={() => onEdit?.(message)} />
                  ) : null}
                  {canRetry ? (
                    <RetryMenu
                      labels={labels}
                      message={message}
                      models={retryModels}
                      onRetry={onRetry}
                      onRetryWithModel={onRetryWithModel}
                    />
                  ) : null}
                  {!user && enableCopy && text ? (
                    <IconButton
                      icon="mdi-content-copy"
                      label={labels.copy}
                      onClick={() => copyMessage(message, text, onCopy)}
                    />
                  ) : null}
                  {!user && message.content.agentStats ? (
                    <StatsMenu labels={labels} stats={message.content.agentStats} />
                  ) : null}
                  {threads.length > 0 ? (
                    <ThreadMenu labels={labels} message={message} onOpenThread={onOpenThread} threads={threads} />
                  ) : null}
                  {refs.length > 0 ? (
                    <button className="ab-chat-meta-chip" onClick={() => onOpenRefs?.(refs, message)} type="button">
                      <MdiIcon name="mdi-book-open-page-variant-outline" size={15} />
                      {labels.references} {refs.length}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AstrBotMark() {
  return (
    <svg aria-hidden="true" className="ab-chat-astrbot-mark" viewBox="0 0 24 24">
      <path d="M12 1.8c.6 0 1.1.35 1.34.9l1.16 2.82a7.7 7.7 0 0 0 4.05 4.17l2.42 1.08c1.14.5 1.14 2.13 0 2.64l-2.5 1.1a7.7 7.7 0 0 0-4 4.05l-1.13 2.62a1.46 1.46 0 0 1-2.68 0l-1.13-2.62a7.7 7.7 0 0 0-4-4.05l-2.5-1.1a1.45 1.45 0 0 1 0-2.64l2.42-1.08A7.7 7.7 0 0 0 9.5 5.52l1.16-2.82c.23-.55.74-.9 1.34-.9Z" />
      <path d="M19.4 1.7c.28 0 .52.17.63.42l.35.84c.2.48.58.87 1.06 1.08l.82.36c.53.24.53 1 0 1.24l-.84.37c-.47.21-.84.59-1.05 1.06l-.34.8a.69.69 0 0 1-1.26 0l-.35-.8a2 2 0 0 0-1.04-1.06l-.85-.37a.68.68 0 0 1 0-1.24l.82-.36c.48-.21.86-.6 1.06-1.08l.36-.84c.1-.25.35-.42.63-.42Z" />
    </svg>
  );
}

function StatsMenu({ labels, stats }: { labels: ChatMessageLabels; stats: JsonObject }) {
  const cached = statNumber(stats, ['token_usage.input_cached', 'token_usage.cached_tokens', 'cached_tokens']);
  const input = statNumber(stats, [
    'token_usage.input_other',
    'token_usage.input_tokens',
    'input_tokens',
    'prompt_tokens',
  ]);
  const output = statNumber(stats, [
    'token_usage.output',
    'token_usage.output_tokens',
    'output_tokens',
    'completion_tokens',
  ]);
  const start = statNumber(stats, ['start_time']);
  const end = statNumber(stats, ['end_time']);
  const duration =
    statNumber(stats, ['duration', 'total_duration', 'agent_duration']) || (start && end ? end - start : 0);
  const ttft = statNumber(stats, ['ttft', 'time_to_first_token', 'first_token_time']);
  return (
    <details className="ab-chat-stats-menu">
      <summary>
        <MdiIcon name="mdi-information-outline" size={17} />
      </summary>
      <div className="ab-chat-stats-popover">
        {cached > 0 && (
          <div>
            <span>{labels.cachedTokens}</span>
            <strong>{formatCount(cached)}</strong>
          </div>
        )}
        <div>
          <span>{labels.inputTokens}</span>
          <strong>{formatCount(input)}</strong>
        </div>
        <div>
          <span>{labels.outputTokens}</span>
          <strong>{formatCount(output)}</strong>
        </div>
        {ttft > 0 && (
          <div>
            <span>{labels.ttft}</span>
            <strong>{formatSeconds(ttft)}</strong>
          </div>
        )}
        <div>
          <span>{labels.duration}</span>
          <strong>{formatSeconds(duration)}</strong>
        </div>
      </div>
    </details>
  );
}

type MessagePartProps = {
  labels: ChatMessageLabels;
  message: ChatRecord;
  messageById: Map<string, ChatRecord>;
  part: ChatPart;
  user: boolean;
  streaming: boolean;
  resolvePartUrl: NonNullable<ChatMessageListProps['resolvePartUrl']>;
  renderMarkdown?: ChatMessageListProps['renderMarkdown'];
  onReplyClick?: ChatMessageListProps['onReplyClick'];
  onDownload?: ChatMessageListProps['onDownload'];
  onOpenImage?: ChatMessageListProps['onOpenImage'];
  onOpenReasoning?: ChatMessageListProps['onOpenReasoning'];
};

function MessagePart(props: MessagePartProps) {
  const { part, message, user, streaming, renderMarkdown, labels, messageById } = props;

  if (part.type === 'plain') {
    const content = String(part.text || '');
    if (user) return <div className="ab-chat-plain-content">{content}</div>;
    return (
      <Fragment>
        {renderMarkdown?.(content, { message, streaming }) ?? <Markdown content={content} streaming={streaming} />}
      </Fragment>
    );
  }
  if (part.type === 'think' || part.type === 'reasoning') {
    const reasoning = String(part.think || part.text || '');
    return (
      <ReasoningPart
        labels={labels}
        message={message}
        onOpen={props.onOpenReasoning}
        reasoning={reasoning}
        streaming={streaming}
      />
    );
  }
  if (part.type === 'reply') {
    const messageId = readId(part.message_id);
    const target = messageId == null ? undefined : messageById.get(String(messageId));
    const preview = truncate(String(part.selected_text || (target ? plainText(target) : '') || labels.replyTo), 100);
    return (
      <button
        className="ab-chat-reply-quote"
        disabled={messageId == null}
        onClick={() => messageId != null && props.onReplyClick?.(messageId, message)}
        type="button"
      >
        <MdiIcon name="mdi-reply" size={16} />
        <span>{preview}</span>
      </button>
    );
  }
  if (isAttachmentPart(part)) return <AttachmentPart {...props} sent={false} />;
  if (part.type === 'tool_call') return <ToolCallPart labels={labels} part={part} />;

  return <pre className="ab-chat-unknown-part">{safeJson(part)}</pre>;
}

function ReasoningPart({
  labels,
  message,
  reasoning,
  streaming,
  onOpen,
}: {
  labels: ChatMessageLabels;
  message: ChatRecord;
  reasoning: string;
  streaming: boolean;
  onOpen?: ChatMessageListProps['onOpenReasoning'];
}) {
  if (!reasoning) return null;
  return (
    <details className="ab-chat-reasoning" open={streaming}>
      <summary>
        <MdiIcon name="mdi-brain" size={17} />
        <span>{labels.reasoning}</span>
        <span className="ab-chat-reasoning-status">{streaming ? labels.running : labels.completed}</span>
        {onOpen ? (
          <button
            className="ab-chat-reasoning-open"
            onClick={(event) => {
              event.preventDefault();
              onOpen(message, reasoning);
            }}
            type="button"
          >
            <MdiIcon name="mdi-open-in-new" size={15} />
          </button>
        ) : null}
      </summary>
      <div className="ab-chat-reasoning-content">{reasoning}</div>
    </details>
  );
}

function ToolCallPart({ labels, part }: { labels: ChatMessageLabels; part: ChatPart }) {
  const calls = toolCalls(part);
  return (
    <div className="ab-chat-tool-calls">
      {calls.map((tool, index) => {
        const finished =
          Boolean(tool.finished_ts) ||
          ['done', 'completed', 'success'].includes(String(tool.status || '').toLowerCase());
        return (
          <details
            className={`ab-chat-tool-call ${finished ? 'is-complete' : 'is-running'}`}
            key={tool.id || `${tool.name}-${index}`}
          >
            <summary>
              <span className="ab-chat-tool-icon">
                <MdiIcon name={isCodeTool(tool.name) ? 'mdi-code-json' : 'mdi-hammer-wrench'} size={17} />
              </span>
              <span className="ab-chat-tool-name">{String(tool.name || 'tool')}</span>
              <span className="ab-chat-tool-status">{finished ? labels.completed : labels.running}</span>
              <MdiIcon className="ab-chat-tool-chevron" name="mdi-chevron-down" size={18} />
            </summary>
            <ToolValue label="Arguments" value={tool.arguments ?? tool.args ?? tool.parameters} />
            <ToolValue label="Result" value={tool.result ?? tool.output ?? tool.content} />
          </details>
        );
      })}
    </div>
  );
}

function ToolValue({ label, value }: { label: string; value: unknown }) {
  if (value == null || value === '') return null;
  return (
    <div className="ab-chat-tool-value">
      <strong>{label}</strong>
      <pre>{typeof value === 'string' ? value : safeJson(value)}</pre>
    </div>
  );
}

type AttachmentPartProps = Pick<
  MessagePartProps,
  'labels' | 'message' | 'part' | 'resolvePartUrl' | 'onDownload' | 'onOpenImage'
> & { sent: boolean };

function AttachmentPart({ labels, message, part, resolvePartUrl, onDownload, onOpenImage, sent }: AttachmentPartProps) {
  const url = resolvePartUrl(part, message);
  const name = attachmentName(part);
  if (part.type === 'image') {
    return (
      <button
        className={`ab-chat-image-part ${sent ? 'is-sent' : ''}`}
        onClick={() => onOpenImage?.(url, part, message)}
        type="button"
      >
        <img alt={name} src={url} />
      </button>
    );
  }
  if (part.type === 'record' || part.type === 'audio')
    return <audio className="ab-chat-audio-part" controls src={url} />;
  if (part.type === 'video') return <video className="ab-chat-video-part" controls src={url} />;
  return (
    <div className={`ab-chat-file-part ${sent ? 'is-sent' : ''}`}>
      <span className="ab-chat-file-icon">
        <MdiIcon name={attachmentIcon(name)} size={25} />
      </span>
      <span className="ab-chat-file-meta">
        <strong title={name}>{name}</strong>
        <small>{attachmentExtension(name)}</small>
      </span>
      {onDownload ? (
        <IconButton icon="mdi-download" label={labels.download} onClick={() => onDownload(part, message)} />
      ) : null}
    </div>
  );
}

function RetryMenu({
  labels,
  message,
  models,
  onRetry,
  onRetryWithModel,
}: {
  labels: ChatMessageLabels;
  message: ChatRecord;
  models: Array<{ providerId: string; model: string }>;
  onRetry?: ChatMessageListProps['onRetry'];
  onRetryWithModel?: ChatMessageListProps['onRetryWithModel'];
}) {
  return (
    <details className="ab-chat-retry-menu">
      <summary aria-label={labels.retry} title={labels.retry}>
        <MdiIcon name="mdi-refresh" size={17} />
      </summary>
      <div className="ab-chat-retry-popover">
        <button onClick={() => onRetry?.(message)} type="button">
          <MdiIcon name="mdi-refresh" size={16} />
          {labels.retry}
        </button>
        {onRetryWithModel &&
          models.map((item) => (
            <button
              key={`${item.providerId}:${item.model}`}
              onClick={() => onRetryWithModel(message, item.providerId, item.model)}
              type="button"
            >
              <MdiIcon name="mdi-creation" size={16} />
              <span>
                <strong>{item.providerId}</strong>
                <small>{item.model}</small>
              </span>
            </button>
          ))}
      </div>
    </details>
  );
}

function ThreadMenu({
  labels,
  message,
  onOpenThread,
  threads,
}: {
  labels: ChatMessageLabels;
  message: ChatRecord;
  onOpenThread?: ChatMessageListProps['onOpenThread'];
  threads: ChatThread[];
}) {
  return (
    <details className="ab-chat-thread-menu">
      <summary className="ab-chat-meta-chip">
        <MdiIcon name="mdi-source-branch" size={15} />
        {labels.threads} {threads.length}
      </summary>
      <div className="ab-chat-thread-popover">
        {threads.map((thread) => (
          <button key={thread.thread_id} onClick={() => onOpenThread?.(thread, message)} type="button">
            <MdiIcon name="mdi-source-branch" size={15} />
            {truncate(String(thread.selected_text || labels.threads), 48)}
          </button>
        ))}
      </div>
    </details>
  );
}

function IconButton({ icon, label, onClick }: { icon: `mdi-${string}`; label: string; onClick: () => void }) {
  return (
    <button aria-label={label} className="ab-chat-icon-button" onClick={onClick} title={label} type="button">
      <MdiIcon name={icon} size={17} />
    </button>
  );
}

async function copyMessage(message: ChatRecord, text: string, callback?: ChatMessageListProps['onCopy']) {
  if (callback) await callback(message, text);
  else await navigator.clipboard.writeText(text);
}

function messageParts(message: ChatRecord): ChatPart[] {
  const parts = Array.isArray(message.content?.message) ? message.content.message : [];
  return message.content?.reasoning && !parts.some((part) => part.type === 'think' || part.type === 'reasoning')
    ? [{ type: 'think', think: message.content.reasoning }, ...parts]
    : parts;
}

function isUserMessage(message: ChatRecord) {
  return message.content?.type === 'user';
}

function isAttachmentPart(part: ChatPart) {
  return ['image', 'record', 'audio', 'video', 'file'].includes(part.type);
}

function plainText(message: ChatRecord) {
  return messageParts(message)
    .filter((part) => part.type === 'plain')
    .map((part) => String(part.text || ''))
    .join('\n')
    .trim();
}

function messageThreads(message: ChatRecord): ChatThread[] {
  const value = message.threads;
  return Array.isArray(value)
    ? value.filter((thread): thread is ChatThread =>
        Boolean(thread && typeof thread === 'object' && typeof (thread as JsonObject).thread_id === 'string'),
      )
    : [];
}

function messageReferences(message: ChatRecord): ChatReference[] {
  const raw = (message.content as typeof message.content & JsonObject)?.refs;
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as JsonObject).used : raw;
  return Array.isArray(value)
    ? value.filter((item): item is ChatReference => Boolean(item && typeof item === 'object'))
    : [];
}

function toolCalls(part: ChatPart): ChatToolCall[] {
  const raw = Array.isArray(part.tool_calls) ? part.tool_calls : part.tool_call ? [part.tool_call] : [part];
  return raw.filter((item): item is ChatToolCall => Boolean(item && typeof item === 'object'));
}

function defaultPartUrl(part: ChatPart) {
  const embedded = part.embedded_file;
  if (typeof part.embedded_url === 'string') return part.embedded_url;
  if (embedded && typeof embedded === 'object' && typeof (embedded as JsonObject).url === 'string')
    return String((embedded as JsonObject).url);
  if (typeof part.url === 'string') return part.url;
  if (part.attachment_id) return apiEndpoints.legacyChatAttachment(String(part.attachment_id));
  return apiEndpoints.legacyChatFile(String(part.stored_filename || part.filename || ''));
}

function attachmentName(part: ChatPart) {
  return String(part.filename || part.stored_filename || 'attachment');
}

function attachmentExtension(name: string) {
  const extension = name.includes('.') ? name.split('.').pop() || 'FILE' : 'FILE';
  return extension.slice(0, 8).toUpperCase();
}

function attachmentIcon(name: string): `mdi-${string}` {
  const extension = attachmentExtension(name).toLowerCase();
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension)) return 'mdi-folder-zip-outline';
  if (['pdf'].includes(extension)) return 'mdi-file-pdf-box';
  if (['doc', 'docx', 'txt', 'md'].includes(extension)) return 'mdi-file-document-outline';
  if (['xls', 'xlsx', 'csv'].includes(extension)) return 'mdi-file-table-outline';
  return 'mdi-file-outline';
}

function isCodeTool(name: unknown) {
  return /python|code|shell|terminal|execute/i.test(String(name || ''));
}

function formatTime(value: unknown) {
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function statNumber(source: JsonObject, paths: string[]) {
  for (const path of paths) {
    const value = path
      .split('.')
      .reduce<unknown>(
        (current, key) =>
          current && typeof current === 'object' && !Array.isArray(current) ? (current as JsonObject)[key] : undefined,
        source,
      );
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
}

function formatCount(value: number) {
  return new Intl.NumberFormat().format(Math.round(value));
}

function formatSeconds(value: number) {
  if (!value) return '0s';
  const seconds = value > 10_000 ? value / 1000 : value;
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function readId(value: unknown): string | number | null {
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default ChatMessageList;
