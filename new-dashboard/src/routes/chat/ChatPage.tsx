import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  createChatSession,
  deleteChatSession,
  getChatSession,
  listChatConfigs,
  listChatSessions,
  stopChatSession,
  updateChatSession,
  uploadFile,
} from '@/api/openapi';
import { readAuthToken } from '@/auth/storage';
import { Markdown } from '@/components/content/Markdown';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { errorMessage, JsonObject, objectList, recordId, responseData } from '@/routes/configuration/model';
import { confirmAction, toast } from '@/stores/feedback';
import { useLayoutStore } from '@/stores/layout';
import {
  appendStreamPayload,
  type ChatPart,
  type ChatRecord,
  type ChatSession,
  normalizeRecord,
  parseSseEvents,
  sessionList,
} from './model';

type ChatPageProps = { chatbox?: boolean };
type StagedFile = { attachment_id: string; filename: string; type: 'image' | 'file' };

export default function ChatPage({ chatbox = false }: ChatPageProps) {
  const { t } = useTranslation();
  const { conversationId = '' } = useParams();
  const navigate = useNavigate();
  const basePath = chatbox ? '/chatbox' : '/chat';
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [messages, setMessages] = useState<ChatRecord[]>([]);
  const [configs, setConfigs] = useState<JsonObject[]>([]);
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [chatboxSidebarOpen, setChatboxSidebarOpen] = useState(false);
  const [configId, setConfigId] = useState('default');
  const [provider, setProvider] = useState(() => localStorage.getItem('selectedProvider') || '');
  const [model, setModel] = useState(() => localStorage.getItem('selectedProviderModel') || '');
  const [streaming, setStreaming] = useState(true);
  const layoutChatSidebarOpen = useLayoutStore((state) => state.chatSidebarOpen);
  const setLayoutChatSidebarOpen = useLayoutStore((state) => state.setChatSidebarOpen);
  const abortRef = useRef<AbortController | null>(null);
  const activeSessionRef = useRef('');
  const pendingLocalSessionRef = useRef<string | null>(null);
  const messageEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const current = useMemo(() => sessions.find((item) => item.session_id === conversationId), [conversationId, sessions]);
  const currentConfig = useMemo(() => configs.find((config) => recordId(config, 'id', 'conf_id') === configId), [configId, configs]);
  const sidebarOpen = chatbox ? chatboxSidebarOpen : layoutChatSidebarOpen;
  const setSidebarOpen = useCallback((open: boolean) => {
    if (chatbox) setChatboxSidebarOpen(open);
    else setLayoutChatSidebarOpen(open);
  }, [chatbox, setLayoutChatSidebarOpen]);
  const unwrap = <T,>(response: unknown) => responseData<T>(response);

  const loadSessions = useCallback(async () => {
    try {
      const data = unwrap<unknown>(await listChatSessions({ query: { page: 1, page_size: 200 } }));
      setSessions(sessionList(data));
    } catch (cause) {
      setError(errorMessage(cause, 'Failed to load conversations.'));
    }
  }, []);

  const loadMessages = useCallback(async () => {
    if (!conversationId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = unwrap<JsonObject>(await getChatSession({ path: { session_id: conversationId } }));
      const history = Array.isArray(data?.history) ? data.history : Array.isArray(data?.messages) ? data.messages : [];
      setMessages(history.map(normalizeRecord));
    } catch (cause) {
      setError(errorMessage(cause, 'Failed to load conversation.'));
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void loadSessions();
    void listChatConfigs()
      .then((response) => setConfigs(objectList(unwrap(response), ['configs', 'items'])))
      .catch(() => undefined);
  }, [loadSessions]);

  useEffect(() => {
    if (pendingLocalSessionRef.current === conversationId) {
      pendingLocalSessionRef.current = null;
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    activeSessionRef.current = '';
    void loadMessages();
  }, [conversationId, loadMessages]);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => { messageEnd.current?.scrollIntoView({ behavior: sending ? 'auto' : 'smooth' }); }, [messages, sending]);
  useEffect(() => { localStorage.setItem('selectedProvider', provider); }, [provider]);
  useEffect(() => { localStorage.setItem('selectedProviderModel', model); }, [model]);
  useEffect(() => {
    if (!draft && inputRef.current) inputRef.current.style.height = 'auto';
  }, [draft]);

  const createSession = async () => {
    const data = unwrap<JsonObject>(await createChatSession());
    const id = recordId(data, 'session_id', 'id');
    if (!id) throw new Error('The server did not return a session ID.');
    await loadSessions();
    pendingLocalSessionRef.current = id;
    navigate(`${basePath}/${encodeURIComponent(id)}`);
    return id;
  };

  const newChat = () => {
    abortRef.current?.abort();
    activeSessionRef.current = '';
    pendingLocalSessionRef.current = null;
    setMessages([]);
    setFiles([]);
    setSending(false);
    navigate(basePath);
    setSidebarOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const removeSession = async (session: ChatSession) => {
    if (!await confirmAction({ danger: true, title: 'Delete conversation', message: `Delete ${session.display_name || session.session_id}?` })) return;
    try {
      await deleteChatSession({ path: { session_id: session.session_id } });
      if (conversationId === session.session_id) newChat();
      await loadSessions();
    } catch (cause) {
      toast.error(errorMessage(cause, 'Failed to delete conversation.'));
    }
  };

  const renameSession = async (session: ChatSession) => {
    const title = window.prompt('Conversation title', session.display_name || '');
    if (title == null) return;
    try {
      await updateChatSession({ path: { session_id: session.session_id }, body: { display_name: title.trim() } });
      await loadSessions();
    } catch (cause) {
      toast.error(errorMessage(cause, 'Failed to rename conversation.'));
    }
  };

  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const data = unwrap<JsonObject>(await uploadFile({ body: { file } }));
      const id = recordId(data, 'attachment_id', 'id');
      if (!id) throw new Error('Upload did not return an attachment ID.');
      setFiles((currentFiles) => [...currentFiles, {
        attachment_id: id,
        filename: String(data.filename || data.original_name || file.name),
        type: file.type.startsWith('image/') ? 'image' : 'file',
      }]);
    } catch (cause) {
      toast.error(errorMessage(cause, 'Failed to upload file.'));
    } finally {
      setUploading(false);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if ((!text && !files.length) || sending) return;
    setSending(true);
    setError('');
    let sessionId = conversationId;
    let bot: ChatRecord | null = null;
    let abort: AbortController | null = null;
    try {
      if (!sessionId) sessionId = await createSession();
      const outgoing: ChatPart[] = [
        ...(text ? [{ type: 'plain', text }] : []),
        ...files.map((file) => ({ type: file.type, attachment_id: file.attachment_id, filename: file.filename })),
      ];
      const messageId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      const createdAt = new Date().toISOString();
      const user: ChatRecord = { id: `local-user-${messageId}`, created_at: createdAt, content: { type: 'user', message: outgoing } };
      bot = { id: `local-bot-${messageId}`, created_at: createdAt, content: { type: 'bot', message: [], isLoading: true } };
      setMessages((items) => [...items, user, bot!]);
      setDraft('');
      setFiles([]);

      if (!current?.display_name && text) {
        void updateChatSession({ path: { session_id: sessionId }, body: { display_name: text.slice(0, 40) } })
          .then(loadSessions)
          .catch(() => undefined);
      }

      abort = new AbortController();
      abortRef.current = abort;
      activeSessionRef.current = sessionId;
      const token = readAuthToken(localStorage);
      const locale = localStorage.getItem('astrbot-locale');
      const response = await fetch('/api/v1/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(locale ? { 'Accept-Language': locale } : {}),
        },
        body: JSON.stringify({
          session_id: sessionId,
          message: outgoing.map((part) => ({
            type: part.type,
            text: part.text,
            attachment_id: part.attachment_id,
            filename: part.filename,
          })),
          config_id: configId || undefined,
          selected_provider: provider || undefined,
          selected_model: model || undefined,
          enable_streaming: streaming,
        }),
        signal: abort.signal,
      });
      if (!response.ok || !response.body) throw new Error(`Chat request failed: ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const applyPayloads = (payloads: unknown[]) => {
        if (!bot) return;
        let changed = false;
        payloads.forEach((payload) => { changed = appendStreamPayload(bot!, payload) || changed; });
        if (changed) setMessages((items) => [...items]);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseEvents(buffer);
        buffer = parsed.remainder;
        applyPayloads(parsed.payloads);
      }
      buffer += decoder.decode();
      applyPayloads(parseSseEvents(buffer, true).payloads);
      await loadSessions();
    } catch (cause) {
      if ((cause as Error)?.name !== 'AbortError') {
        const message = errorMessage(cause, 'Failed to send message.');
        setError(message);
        toast.error(message);
      }
    } finally {
      if (bot) {
        bot.content.isLoading = false;
        setMessages((items) => [...items]);
      }
      if (!abort || abortRef.current === abort) abortRef.current = null;
      if (!sessionId || activeSessionRef.current === sessionId) activeSessionRef.current = '';
      setSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const stop = async () => {
    abortRef.current?.abort();
    const sessionId = activeSessionRef.current || conversationId;
    if (sessionId) await stopChatSession({ path: { session_id: sessionId } }).catch(() => undefined);
    setSending(false);
  };

  const keyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  const sessionTitle = current?.display_name || t('features.chat.conversation.newConversation');
  const modelTitle = model || provider || 'Default model';
  const configTitle = String(currentConfig?.name || configId || 'default');

  return <div className={`chat-shell ${chatbox ? 'chat-shell--box' : ''}`}>
    <aside className={`chat-sessions ${sidebarOpen ? 'is-open' : ''}`}>
      <div className="chat-sessions__brand">
        <div className="chat-sessions__brand-title"><ChatLogo /><span><strong>AstrBot</strong><small>ChatUI</small></span></div>
        <button aria-label="Close conversations" className="chat-sessions__close" onClick={() => setSidebarOpen(false)} type="button"><MdiIcon name="mdi-close" /></button>
      </div>
      <nav className="chat-sessions__actions">
        <Link to="/providers"><MdiIcon name="mdi-creation" /><span>{t('features.chat.actions.providerConfig')}</span></Link>
        <button onClick={newChat} type="button"><MdiIcon name="mdi-pencil-outline" /><span>{t('features.chat.actions.newChat')}</span></button>
      </nav>
      <div className="chat-session-list">
        <div className="chat-session-list__label">{t('features.chat.conversation.title')}</div>
        {sessions.map((session) => <div className={session.session_id === conversationId ? 'is-active' : ''} key={session.session_id}>
          <button onClick={() => { navigate(`${basePath}/${encodeURIComponent(session.session_id)}`); setSidebarOpen(false); }} type="button"><span>{session.display_name || session.session_id}</span></button>
          <div><button aria-label={t('features.chat.conversation.editDisplayName')} onClick={() => void renameSession(session)} type="button"><MdiIcon name="mdi-pencil-outline" /></button><button aria-label={t('features.chat.actions.deleteChat')} onClick={() => void removeSession(session)} type="button"><MdiIcon name="mdi-delete-outline" /></button></div>
        </div>)}
      </div>
      {!chatbox && <Link className="chat-sessions__settings" to="/settings"><MdiIcon name="mdi-cog-outline" /><span>{t('core.common.settings')}</span></Link>}
    </aside>
    {sidebarOpen && <button aria-label="Close conversations" className="chat-sidebar-backdrop" onClick={() => setSidebarOpen(false)} type="button" />}
    <main className="chat-main">
      <header className="chat-toolbar">
        <button aria-label="Open conversations" className="chat-toolbar__sidebar-open" onClick={() => setSidebarOpen(true)} type="button"><MdiIcon name="mdi-menu" /></button>
        <details className="chat-model-menu">
          <summary><span>{modelTitle}<MdiIcon name="mdi-chevron-down" /></span><small>{sessionTitle}</small></summary>
          <div className="chat-model-menu__panel">
            <label><span>Provider ID</span><input onChange={(event) => setProvider(event.target.value)} placeholder="Default provider" value={provider} /></label>
            <label><span>Model</span><input onChange={(event) => setModel(event.target.value)} placeholder="Default model" value={model} /></label>
          </div>
        </details>
      </header>
      <section aria-live="polite" className="chat-messages">
        {loading && <div className="monitor-loading">Loading…</div>}
        {!loading && !messages.length && <div className="chat-empty"><h1>{t('features.chat.welcome.title')}</h1><p>{t('features.chat.welcome.subtitle')}</p></div>}
        {messages.map((message, index) => <Message isStreaming={sending && message.content.type !== 'user' && index === messages.length - 1} key={String(message.id || index)} message={message} />)}
        {error && <div className="monitor-error">{error}</div>}
        <div ref={messageEnd} />
      </section>
      <footer className="chat-composer">
        {files.length > 0 && <div className="chat-files">{files.map((file) => <span key={file.attachment_id}>{file.filename}<button onClick={() => setFiles((items) => items.filter((item) => item.attachment_id !== file.attachment_id))} type="button">×</button></span>)}</div>}
        <div className="chat-input-row">
          <details className="chat-composer-menu">
            <summary aria-label={t('features.chat.input.upload')}><MdiIcon name="mdi-plus" /></summary>
            <div className="chat-composer-menu__panel">
              <label className="chat-composer-menu__upload"><MdiIcon name="mdi-file-upload" /><span>{t('features.chat.input.upload')}</span><input disabled={uploading || sending} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ''; }} type="file" /></label>
              <label className="chat-composer-menu__config"><span>{t('features.chat.config.title')}</span><select aria-label={t('features.chat.config.title')} onChange={(event) => setConfigId(event.target.value)} value={configId}><option value="default">Default</option>{configs.map((config, index) => { const id = recordId(config, 'id', 'conf_id') || `config-${index}`; return id === 'default' ? null : <option key={id} value={id}>{String(config.name || id)}</option>; })}</select><small>{configTitle}</small></label>
              <button aria-pressed={streaming} onClick={() => setStreaming((value) => !value)} type="button"><MdiIcon name="mdi-lightning-bolt" /><span>{t(`features.chat.streaming.${streaming ? 'enabled' : 'disabled'}`)}</span></button>
            </div>
          </details>
          <textarea aria-label={t('features.chat.input.placeholder')} disabled={sending} onChange={(event) => setDraft(event.target.value)} onInput={(event) => { const target = event.currentTarget; target.style.height = 'auto'; target.style.height = `${Math.min(target.scrollHeight, 160)}px`; }} onKeyDown={keyDown} placeholder={t('features.chat.input.placeholder')} ref={inputRef} rows={1} value={draft} />
          <button aria-label={streaming ? t('features.chat.streaming.enabled') : t('features.chat.streaming.disabled')} aria-pressed={streaming} className={`chat-stream-indicator ${streaming ? 'is-active' : ''}`} onClick={() => setStreaming((value) => !value)} title={streaming ? t('features.chat.streaming.enabled') : t('features.chat.streaming.disabled')} type="button"><span /></button>
          {sending ? <button aria-label={t('features.chat.input.stopGenerating')} className="chat-send" onClick={() => void stop()} type="button"><MdiIcon name="mdi-stop" /></button> : <button aria-label={t('features.chat.input.send')} className="chat-send" disabled={!draft.trim() && !files.length} onClick={() => void send()} type="button"><MdiIcon name="mdi-arrow-up" /></button>}
        </div>
      </footer>
    </main>
  </div>;
}

function Message({ isStreaming, message }: { isStreaming: boolean; message: ChatRecord }) {
  const { t } = useTranslation();
  const user = message.content.type === 'user';
  const time = messageTime(message.created_at);
  const copy = () => navigator.clipboard?.writeText(message.content.message.map((part) => part.text || '').join('\n'));
  return <article className={`chat-message ${user ? 'chat-message--user' : 'chat-message--bot'}`}>
    {!user && <div className="chat-message__avatar"><ChatLogo /></div>}
    <div className="chat-message__stack">
      <div className="chat-message__body">{message.content.reasoning && <details><summary>{t('features.chat.reasoning.thinking')}</summary><pre>{message.content.reasoning}</pre></details>}{message.content.message.map((part, index) => <MessagePart key={`${part.type}-${index}`} part={part} streaming={isStreaming} user={user} />)}{message.content.isLoading && !message.content.message.length && <span className="chat-typing">{t('features.chat.message.loading')}</span>}</div>
      <div className="chat-message__meta">{time && <span>{time}</span>}{!user && <button aria-label={t('features.chat.actions.copy')} onClick={() => void copy()} type="button"><MdiIcon name="mdi-content-copy" /></button>}</div>
    </div>
  </article>;
}

function MessagePart({ part, streaming, user }: { part: ChatPart; streaming: boolean; user: boolean }) {
  if (part.type === 'think') return null;
  if (part.type === 'plain' || part.type === 'text') return user ? <p className="chat-user-text">{part.text}</p> : <Markdown content={part.text || ''} streaming={streaming} />;
  const id = part.attachment_id;
  const filename = part.filename || part.stored_filename || 'attachment';
  const url = id ? `/api/v1/files/${encodeURIComponent(id)}/content` : part.stored_filename ? `/api/v1/files/content?filename=${encodeURIComponent(part.stored_filename)}` : '';
  if (part.type === 'image' && url) return <a href={url} rel="noreferrer" target="_blank"><img alt={filename} className="chat-image" src={url} /></a>;
  return <a className="chat-file" href={url || undefined} rel="noreferrer" target="_blank">📎 {filename}</a>;
}

function messageTime(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function ChatLogo() {
  return <svg aria-hidden="true" className="chat-logo" focusable="false" viewBox="0 0 24 24"><path d="M11.96 2.6c.22-.53.97-.53 1.19 0l.76 1.84a7.05 7.05 0 0 0 3.72 3.77l1.75.78c.53.23.53 1 0 1.23l-1.81.8a6.86 6.86 0 0 0-3.66 3.68l-.76 1.75c-.22.52-.97.52-1.19 0l-.75-1.75a6.86 6.86 0 0 0-3.66-3.68l-1.81-.8a.67.67 0 0 1 0-1.23l1.75-.78a7.05 7.05 0 0 0 3.72-3.77l.75-1.84Z" fill="currentColor"/><path d="M18.72 15.2c.12-.3.54-.3.67 0l.3.73c.4.96 1.15 1.72 2.1 2.14l.63.28c.3.13.3.56 0 .69l-.67.3a3.5 3.5 0 0 0-2.06 2.06l-.3.68c-.13.3-.55.3-.68 0l-.3-.68a3.5 3.5 0 0 0-2.05-2.06l-.68-.3a.38.38 0 0 1 0-.69l.64-.28a3.7 3.7 0 0 0 2.1-2.14l.3-.73Z" fill="currentColor"/></svg>;
}
