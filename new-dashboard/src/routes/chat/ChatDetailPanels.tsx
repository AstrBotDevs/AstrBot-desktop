import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { isObject, type JsonObject } from '@/routes/configuration/model';
import { ChatMessageList } from './ChatMessageList';
import type { ChatPart, ChatRecord } from './model';

export type ChatThread = JsonObject & {
  thread_id: string;
  parent_message_id?: string | number;
  selected_text?: string;
  messages?: ChatRecord[];
};

type ImagePreview = { name: string; url: string };

type ChatDetailPanelsProps = {
  activeThread: ChatThread | null;
  imagePreview: ImagePreview | null;
  onCloseImage: () => void;
  onCloseReasoning: () => void;
  onCloseReferences: () => void;
  onCloseThread: () => void;
  onDeleteThread: () => void;
  onDownload: (part: ChatPart) => void;
  onOpenImage: (url: string, part: ChatPart) => void;
  onSendThread: () => void;
  reasoningTarget: ChatRecord | null;
  referenceData: JsonObject | null;
  resolvePartUrl: (part: ChatPart) => string;
  threadDeleting: boolean;
  threadDraft: string;
  threadMessagesRef: RefObject<HTMLDivElement | null>;
  threadSending: boolean;
  onThreadDraftChange: (value: string) => void;
};

export function ChatDetailPanels({
  activeThread,
  imagePreview,
  onCloseImage,
  onCloseReasoning,
  onCloseReferences,
  onCloseThread,
  onDeleteThread,
  onDownload,
  onOpenImage,
  onSendThread,
  reasoningTarget,
  referenceData,
  resolvePartUrl,
  threadDeleting,
  threadDraft,
  threadMessagesRef,
  threadSending,
  onThreadDraftChange,
}: ChatDetailPanelsProps) {
  const { t } = useTranslation();
  const references: unknown[] = referenceData && Array.isArray(referenceData.used) ? referenceData.used : [];

  return (
    <>
      {reasoningTarget && (
        <aside className="chat-detail-panel">
          <header>
            <strong>{t('features.chat.reasoning.thinking')}</strong>
            <button aria-label={t('core.common.close')} onClick={onCloseReasoning} type="button">
              <MdiIcon name="mdi-close" />
            </button>
          </header>
          <div className="chat-detail-panel__body chat-side-dialog-content">
            <pre>
              {reasoningTarget.content.reasoning ||
                reasoningTarget.content.message
                  .filter((part) => ['think', 'reasoning'].includes(part.type))
                  .map((part) => part.think || part.text || '')
                  .join('\n')}
            </pre>
          </div>
        </aside>
      )}
      {referenceData && (
        <aside className="chat-detail-panel">
          <header>
            <strong>{t('features.chat.refs.title')}</strong>
            <button aria-label={t('core.common.close')} onClick={onCloseReferences} type="button">
              <MdiIcon name="mdi-close" />
            </button>
          </header>
          <div className="chat-detail-panel__body chat-reference-list">
            {references.map((reference, index) => {
              const item = isObject(reference) ? reference : {};
              return (
                <article
                  key={String(item.id || item.url || index)}
                  onClick={() => item.url && window.open(String(item.url), '_blank')}
                >
                  <strong>
                    {Boolean(item.favicon) && <img alt="" src={String(item.favicon)} />}
                    {String(item.title || item.url || t('features.chat.refs.title'))}
                  </strong>
                  {Boolean(item.snippet || item.text || item.content) && (
                    <p>{String(item.snippet || item.text || item.content)}</p>
                  )}
                  {Boolean(item.url) && <small>{referenceHost(String(item.url))}</small>}
                </article>
              );
            })}
          </div>
        </aside>
      )}
      <Dialog
        onOpenChange={(open) => !open && onCloseImage()}
        open={imagePreview !== null}
        title={imagePreview?.name || t('features.chat.attachment.image')}
      >
        {imagePreview && (
          <div className="chat-image-preview">
            <img alt={imagePreview.name} src={imagePreview.url} />
          </div>
        )}
      </Dialog>
      {activeThread && (
        <aside className="chat-detail-panel chat-thread-panel">
          <header>
            <strong>{t('features.chat.thread.title')}</strong>
            <span>
              <button
                aria-label={t('features.chat.thread.delete')}
                disabled={threadDeleting || threadSending}
                onClick={onDeleteThread}
                type="button"
              >
                <MdiIcon name="mdi-delete-outline" />
              </button>
              <button aria-label={t('core.common.close')} onClick={onCloseThread} type="button">
                <MdiIcon name="mdi-close" />
              </button>
            </span>
          </header>
          <div className="chat-thread-dialog">
            {activeThread.selected_text && <blockquote>{activeThread.selected_text}</blockquote>}
            <div className="chat-thread-messages" ref={threadMessagesRef}>
              <ChatMessageList
                enableEdit={false}
                enableRetry={false}
                messages={activeThread.messages || []}
                onDownload={onDownload}
                onOpenImage={onOpenImage}
                resolvePartUrl={resolvePartUrl}
                streaming={threadSending}
              />
            </div>
            <div className="chat-thread-composer">
              <textarea
                disabled={threadSending}
                onChange={(event) => onThreadDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    onSendThread();
                  }
                }}
                placeholder={t('features.chat.thread.placeholder')}
                rows={2}
                value={threadDraft}
              />
              <button
                className="button--primary"
                disabled={threadSending || !threadDraft.trim()}
                onClick={onSendThread}
                type="button"
              >
                {t('features.chat.input.send')}
              </button>
            </div>
          </div>
        </aside>
      )}
    </>
  );
}

function referenceHost(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}
