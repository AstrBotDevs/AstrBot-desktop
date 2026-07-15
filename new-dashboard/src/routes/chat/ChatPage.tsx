import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  createChatProject,
  createChatSession,
  deleteChatSession,
  getChatSession,
  listChatConfigs,
  listChatProjects,
  listChatSessions,
  listProviders,
  stopChatSession,
  testProviderById,
  updateChatSession,
  uploadFile,
} from '@/api/openapi';
import { readAuthToken } from '@/auth/storage';
import { Markdown } from '@/components/content/Markdown';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { errorMessage, isObject, JsonObject, objectList, recordId, responseData } from '@/routes/configuration/model';
import { confirmAction, toast } from '@/stores/feedback';
import { useLayoutStore } from '@/stores/layout';
import { AudioRecorder } from './audioRecorder';
import { createStreamRenderScheduler } from './streamRenderScheduler';
import {
  appendStreamPayload,
  type ChatPart,
  type ChatRecord,
  type ChatSession,
  contextTokenCount,
  normalizeRecord,
  parseSseEvents,
  sessionList,
  type StagedAttachmentType,
  stagedAttachmentType,
} from './model';

type ChatPageProps = { chatbox?: boolean };
type StagedFile = { attachment_id: string; filename: string; type: StagedAttachmentType };
type ProviderConfig = JsonObject & { id: string; model: string };
type TransportMode = 'sse' | 'websocket';

const chatLanguageOptions = [
  { code: 'zh-CN', flag: 'CN', label: '简体中文' },
  { code: 'en-US', flag: 'US', label: 'English' },
  { code: 'ru-RU', flag: 'RU', label: 'Русский' },
] as const;

export default function ChatPage({ chatbox = false }: ChatPageProps) {
  const { i18n, t } = useTranslation();
  const { conversationId = '' } = useParams();
  const navigate = useNavigate();
  const basePath = chatbox ? '/chatbox' : '/chat';
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [messages, setMessages] = useState<ChatRecord[]>([]);
  const [configs, setConfigs] = useState<JsonObject[]>([]);
  const [projects, setProjects] = useState<JsonObject[]>([]);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [providerMetadata, setProviderMetadata] = useState<Record<string, JsonObject>>({});
  const [providerSearch, setProviderSearch] = useState('');
  const [providersLoading, setProvidersLoading] = useState(false);
  const [testingProvider, setTestingProvider] = useState('');
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [error, setError] = useState('');
  const [chatboxSidebarOpen, setChatboxSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [configId, setConfigId] = useState('default');
  const [provider, setProvider] = useState(() => localStorage.getItem('selectedProvider') || '');
  const [model, setModel] = useState(() => localStorage.getItem('selectedProviderModel') || '');
  const [streaming, setStreaming] = useState(true);
  const [transportMode, setTransportMode] = useState<TransportMode>(() => localStorage.getItem('chat.transportMode') === 'websocket' ? 'websocket' : 'sse');
  const [settingsSubmenu, setSettingsSubmenu] = useState<'transport' | 'language' | null>(null);
  const layoutChatSidebarOpen = useLayoutStore((state) => state.chatSidebarOpen);
  const setLayoutChatSidebarOpen = useLayoutStore((state) => state.setChatSidebarOpen);
  const themeMode = useLayoutStore((state) => state.themeMode);
  const setThemeMode = useLayoutStore((state) => state.setThemeMode);
  const abortRef = useRef<AbortController | null>(null);
  const audioRecorderRef = useRef(new AudioRecorder());
  const activeSessionRef = useRef('');
  const pendingLocalSessionRef = useRef<string | null>(null);
  const modelMenuRef = useRef<HTMLDetailsElement>(null);
  const settingsMenuRef = useRef<HTMLDetailsElement>(null);
  const settingsSubmenuTimer = useRef<number | null>(null);
  const messageScrollFrame = useRef<number | null>(null);
  const messageEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const current = useMemo(() => sessions.find((item) => item.session_id === conversationId), [conversationId, sessions]);
  const currentConfig = useMemo(() => configs.find((config) => recordId(config, 'id', 'conf_id') === configId), [configId, configs]);
  const currentProvider = useMemo(() => providers.find((item) => item.id === provider) || providers[0], [provider, providers]);
  const currentLanguage = chatLanguageOptions.find((item) => item.code === i18n.language) || chatLanguageOptions[0];
  const isDark = themeMode === 'dark' || (themeMode === 'system' && document.documentElement.dataset.theme === 'dark');
  const filteredProviders = useMemo(() => {
    const query = providerSearch.trim().toLowerCase();
    return query ? providers.filter((item) => item.id.toLowerCase().includes(query) || item.model.toLowerCase().includes(query)) : providers;
  }, [providerSearch, providers]);
  const tokenUsage = useMemo(() => {
    const latestStats = [...messages].reverse().find((message) => message.content.type !== 'user' && message.content.agentStats)?.content.agentStats;
    const used = contextTokenCount(latestStats);
    const metadata = providerMetadata[currentProvider?.model || model];
    const limit = contextLimit(currentProvider, metadata);
    if (used <= 0 || limit <= 0) return null;
    const rawPercent = (used / limit) * 100;
    const percent = Math.min(100, Math.max(0, rawPercent));
    return {
      percent,
      tooltip: t('features.chat.tokenUsage.tooltip', {
        used: formatTokenCount(used),
        limit: formatTokenCount(limit),
        percent: formatUsagePercent(rawPercent),
      }),
    };
  }, [currentProvider, messages, model, providerMetadata, t]);
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

  const loadProjects = useCallback(async () => {
    try {
      const data = unwrap<unknown>(await listChatProjects());
      setProjects(objectList(data, ['projects', 'items']));
    } catch {
      setProjects([]);
    }
  }, []);

  const loadProviders = useCallback(async () => {
    setProvidersLoading(true);
    try {
      const data = responseData<unknown>(await listProviders({ query: { capability: 'chat', enabled: true } }));
      const envelope = isObject(data) ? data : {};
      const items = objectList(data, ['providers', 'data'])
        .filter((item) => (item.enable ?? item.enabled) !== false)
        .map((item) => ({ ...item, id: recordId(item, 'id', 'provider_id'), model: String(item.model || '') }))
        .filter((item): item is ProviderConfig => Boolean(item.id));
      setProviders(items);
      setProviderMetadata(isObject(envelope.model_metadata) ? envelope.model_metadata as Record<string, JsonObject> : {});
      const selected = items.find((item) => item.id === provider);
      if (selected?.model) setModel(selected.model);
    } catch (cause) {
      toast.error(errorMessage(cause, 'Failed to load models.'));
    } finally {
      setProvidersLoading(false);
    }
  }, [provider]);

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
    void loadProjects();
    void loadProviders();
    void listChatConfigs()
      .then((response) => setConfigs(objectList(unwrap(response), ['configs', 'items'])))
      .catch(() => undefined);
  }, [loadProjects, loadProviders, loadSessions]);

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

  useEffect(() => () => {
    abortRef.current?.abort();
    audioRecorderRef.current.cancel();
    if (settingsSubmenuTimer.current != null) window.clearTimeout(settingsSubmenuTimer.current);
    if (messageScrollFrame.current != null) window.cancelAnimationFrame(messageScrollFrame.current);
  }, []);
  useEffect(() => {
    if (messageScrollFrame.current != null) return;
    messageScrollFrame.current = window.requestAnimationFrame(() => {
      messageScrollFrame.current = null;
      messageEnd.current?.scrollIntoView({ behavior: sending ? 'auto' : 'smooth', block: 'end' });
    });
  }, [messages, sending]);
  useEffect(() => { localStorage.setItem('selectedProvider', provider); }, [provider]);
  useEffect(() => { localStorage.setItem('selectedProviderModel', model); }, [model]);
  useEffect(() => { localStorage.setItem('chat.transportMode', transportMode); }, [transportMode]);
  useEffect(() => {
    if (!draft && inputRef.current) inputRef.current.style.height = 'auto';
  }, [draft]);
  useEffect(() => {
    const closeSettings = (event: PointerEvent) => {
      if (!settingsMenuRef.current?.contains(event.target as Node)) {
        settingsMenuRef.current?.removeAttribute('open');
        setSettingsSubmenu(null);
      }
    };
    document.addEventListener('pointerdown', closeSettings);
    return () => document.removeEventListener('pointerdown', closeSettings);
  }, []);

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
    audioRecorderRef.current.cancel();
    activeSessionRef.current = '';
    pendingLocalSessionRef.current = null;
    setMessages([]);
    setFiles([]);
    setRecording(false);
    setSending(false);
    navigate(basePath);
    setSidebarOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const openSettingsSubmenu = (submenu: 'transport' | 'language') => {
    if (settingsSubmenuTimer.current != null) window.clearTimeout(settingsSubmenuTimer.current);
    settingsSubmenuTimer.current = null;
    setSettingsSubmenu(submenu);
  };

  const scheduleSettingsSubmenuClose = () => {
    if (settingsSubmenuTimer.current != null) window.clearTimeout(settingsSubmenuTimer.current);
    settingsSubmenuTimer.current = window.setTimeout(() => {
      setSettingsSubmenu(null);
      settingsSubmenuTimer.current = null;
    }, 120);
  };

  const toggleTheme = () => setThemeMode(isDark ? 'light' : 'dark');

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

  const createProject = async () => {
    const title = window.prompt(t('features.chat.project.name'))?.trim();
    if (!title) return;
    try {
      await createChatProject({ body: { title, workspace_type: 'session' } });
      await loadProjects();
    } catch (cause) {
      toast.error(errorMessage(cause, 'Failed to create project.'));
    }
  };

  const selectProvider = (item: ProviderConfig) => {
    setProvider(item.id);
    setModel(item.model);
    modelMenuRef.current?.removeAttribute('open');
  };

  const testProvider = async (item: ProviderConfig) => {
    if (testingProvider) return;
    setTestingProvider(item.id);
    const startedAt = performance.now();
    try {
      const data = responseData<unknown>(await testProviderById({ body: { provider_id: item.id } }));
      if (isObject(data) && data.error) throw new Error(String(data.error));
      toast.success(t('features.provider.models.testSuccessWithLatency', { id: item.id, latency: Math.max(0, Math.round(performance.now() - startedAt)) }));
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.provider.models.testError')));
    } finally {
      setTestingProvider('');
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
        type: stagedAttachmentType(data.type, file.type),
      }]);
    } catch (cause) {
      toast.error(errorMessage(cause, 'Failed to upload file.'));
    } finally {
      setUploading(false);
    }
  };

  const toggleRecording = async () => {
    if (recordingBusy || sending || uploading) return;
    setRecordingBusy(true);
    try {
      if (recording) {
        setRecording(false);
        const audioFile = await audioRecorderRef.current.stop();
        await upload(audioFile);
      } else {
        await audioRecorderRef.current.start();
        setRecording(true);
      }
    } catch (cause) {
      setRecording(false);
      audioRecorderRef.current.cancel();
      toast.error(errorMessage(cause, t('features.chat.voice.error')));
    } finally {
      setRecordingBusy(false);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if ((!text && !files.length) || sending || recording) return;
    setSending(true);
    setError('');
    let sessionId = conversationId;
    let bot: ChatRecord | null = null;
    let abort: AbortController | null = null;
    let streamRender: ReturnType<typeof createStreamRenderScheduler> | null = null;
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
      const messagePayload = outgoing.map((part) => ({
        type: part.type,
        text: part.text,
        attachment_id: part.attachment_id,
        filename: part.filename,
      }));
      const applyPayloads = (payloads: unknown[]) => {
        if (!bot) return;
        let changed = false;
        payloads.forEach((payload) => { changed = appendStreamPayload(bot!, payload) || changed; });
        if (changed) streamRender?.schedule();
      };
      streamRender = createStreamRenderScheduler(() => {
        setMessages((items) => bot && items.includes(bot) ? [...items] : items);
      });

      if (transportMode === 'websocket') {
        await readWebSocketChat({
          abort: abort.signal,
          configId,
          enableStreaming: streaming,
          message: messagePayload,
          messageId,
          onPayload: (payload) => applyPayloads([payload]),
          selectedModel: model,
          selectedProvider: provider,
          sessionId,
          token,
        });
      } else {
        const response = await fetch('/api/v1/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(locale ? { 'Accept-Language': locale } : {}),
          },
          body: JSON.stringify({
            session_id: sessionId,
            message: messagePayload,
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
      }
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
        if (streamRender) {
          streamRender.schedule();
          streamRender.flush();
        } else {
          setMessages((items) => items.includes(bot!) ? [...items] : items);
        }
      }
      if (!abort || abortRef.current === abort) abortRef.current = null;
      if (!sessionId || activeSessionRef.current === sessionId) activeSessionRef.current = '';
      setSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const regenerate = async (target: ChatRecord, selectedProvider = provider, selectedModel = model) => {
    if (!conversationId || target.id == null || sending) return;
    const targetId = String(target.id);
    const index = messages.findIndex((item) => item === target || String(item.id) === targetId);
    if (index < 0) return;
    const regenerated: ChatRecord = {
      ...target,
      id: `local-regenerate-${Date.now()}`,
      created_at: new Date().toISOString(),
      content: { type: 'bot', message: [], reasoning: '', isLoading: true },
    };
    setMessages((items) => items.map((item, itemIndex) => itemIndex === index ? regenerated : item));
    setSending(true);
    setError('');
    const abort = new AbortController();
    const streamRender = createStreamRenderScheduler(() => {
      setMessages((items) => items.includes(regenerated) ? [...items] : items);
    });
    abortRef.current = abort;
    activeSessionRef.current = conversationId;
    try {
      const token = readAuthToken(localStorage);
      const locale = localStorage.getItem('astrbot-locale');
      const response = await fetch(`/api/v1/chat/sessions/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(targetId)}/regenerate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(locale ? { 'Accept-Language': locale } : {}),
        },
        body: JSON.stringify({ selected_provider: selectedProvider || undefined, selected_model: selectedModel || undefined, enable_streaming: streaming }),
        signal: abort.signal,
      });
      if (!response.ok || !response.body) throw new Error(`Regenerate failed: ${response.status}`);
      if (!(response.headers.get('content-type') || '').includes('text/event-stream')) {
        const payload = await response.json().catch(() => null) as JsonObject | null;
        throw new Error(String(payload?.message || 'Regenerate failed.'));
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const applyPayloads = (payloads: unknown[]) => {
        let changed = false;
        payloads.forEach((payload) => { changed = appendStreamPayload(regenerated, payload) || changed; });
        if (changed) streamRender.schedule();
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
        const message = errorMessage(cause, 'Failed to regenerate message.');
        setError(message);
        toast.error(message);
      }
    } finally {
      regenerated.content.isLoading = false;
      streamRender.schedule();
      streamRender.flush();
      if (abortRef.current === abort) abortRef.current = null;
      if (activeSessionRef.current === conversationId) activeSessionRef.current = '';
      setSending(false);
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
  const modelTitle = provider || 'Default model';
  const modelMeta = currentProvider?.model || model;
  const configTitle = String(currentConfig?.name || configId || 'default');
  const emptyChat = !loading && !messages.length;

  return <div className={`chat-shell ${chatbox ? 'chat-shell--box' : ''} ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''}`}>
    <aside className={`chat-sessions ${sidebarOpen ? 'is-open' : ''}`}>
      <div className="chat-sessions__brand">
        <div className="chat-sessions__brand-title"><ChatLogo /><span><strong>AstrBot</strong><small>ChatUI</small></span></div>
        <button aria-label="Toggle sidebar" className="chat-sessions__collapse" onClick={() => setSidebarCollapsed((value) => !value)} title="Toggle sidebar" type="button"><span className="chat-sessions__collapse-normal"><PanelLeftIcon /></span><span className="chat-sessions__rail-stack"><ChatLogo /><PanelLeftIcon /></span></button>
        <button aria-label="Close conversations" className="chat-sessions__close" onClick={() => setSidebarOpen(false)} type="button"><MdiIcon name="mdi-close" /></button>
      </div>
      <nav className="chat-sessions__actions">
        <Link title={t('features.chat.actions.providerConfig')} to="/providers"><BoxIcon /><span>{t('features.chat.actions.providerConfig')}</span></Link>
        <button onClick={newChat} title={t('features.chat.actions.newChat')} type="button"><SquarePenIcon /><span>{t('features.chat.actions.newChat')}</span></button>
      </nav>
      <div className="chat-sessions__content">
        <section className="chat-project-list">
          <div className="chat-section-header"><span>{t('features.chat.project.title')}</span><button aria-label={t('features.chat.project.create')} onClick={() => void createProject()} title={t('features.chat.project.create')} type="button"><PlusIcon /></button></div>
          {projects.map((project, index) => <div className="chat-project-row" key={recordId(project, 'project_id', 'id') || `project-${index}`}><span>{String(project.emoji || '📁')}</span><strong>{String(project.title || t('features.chat.project.title'))}</strong></div>)}
        </section>
        <div className="chat-session-list">
          <div className="chat-session-list__label">{t('features.chat.conversation.title')}</div>
          {sessions.map((session) => <div className={session.session_id === conversationId ? 'is-active' : ''} key={session.session_id}>
            <button onClick={() => { navigate(`${basePath}/${encodeURIComponent(session.session_id)}`); setSidebarOpen(false); }} type="button"><span>{session.display_name || session.session_id}</span></button>
            <div><button aria-label={t('features.chat.conversation.editDisplayName')} onClick={() => void renameSession(session)} title={t('features.chat.conversation.editDisplayName')} type="button"><PencilIcon /></button><button aria-label={t('features.chat.actions.deleteChat')} onClick={() => void removeSession(session)} title={t('features.chat.actions.deleteChat')} type="button"><TrashIcon /></button></div>
          </div>)}
        </div>
      </div>
      <div className="chat-sessions__footer">
        <details className="chat-settings-menu" onToggle={(event) => { if (!event.currentTarget.open) setSettingsSubmenu(null); }} ref={settingsMenuRef}>
          <summary className="chat-sessions__settings"><MdiIcon name="mdi-cog-outline" /><span className="chat-sessions__settings-label">{t('core.common.settings')}</span></summary>
          <div className="chat-settings-menu__panel">
            <div className="chat-settings-menu__item-wrap" onMouseEnter={() => openSettingsSubmenu('transport')} onMouseLeave={scheduleSettingsSubmenuClose}>
              <button className={settingsSubmenu === 'transport' ? 'is-active' : ''} onClick={() => setSettingsSubmenu((value) => value === 'transport' ? null : 'transport')} type="button"><MdiIcon name="mdi-connection" /><span>{t('features.chat.transport.title')}</span><small>{t(`features.chat.transport.${transportMode}`)}</small><MdiIcon name="mdi-chevron-right" /></button>
              {settingsSubmenu === 'transport' && <div className="chat-settings-submenu" onMouseEnter={() => openSettingsSubmenu('transport')} onMouseLeave={scheduleSettingsSubmenuClose}>
                {(['sse', 'websocket'] as const).map((mode) => <button className={transportMode === mode ? 'is-active' : ''} key={mode} onClick={() => { setTransportMode(mode); setSettingsSubmenu(null); }} type="button"><span>{t(`features.chat.transport.${mode}`)}</span>{transportMode === mode && <MdiIcon name="mdi-check" />}</button>)}
              </div>}
            </div>
            <div className="chat-settings-menu__item-wrap" onMouseEnter={() => openSettingsSubmenu('language')} onMouseLeave={scheduleSettingsSubmenuClose}>
              <button className={settingsSubmenu === 'language' ? 'is-active' : ''} onClick={() => setSettingsSubmenu((value) => value === 'language' ? null : 'language')} type="button"><MdiIcon name="mdi-translate" /><span>{t('core.common.language')}</span><small>{currentLanguage.label}</small><MdiIcon name="mdi-chevron-right" /></button>
              {settingsSubmenu === 'language' && <div className="chat-settings-submenu chat-settings-submenu--language" onMouseEnter={() => openSettingsSubmenu('language')} onMouseLeave={scheduleSettingsSubmenuClose}>
                {chatLanguageOptions.map((language) => <button className={i18n.language === language.code ? 'is-active' : ''} key={language.code} onClick={() => { void i18n.changeLanguage(language.code); setSettingsSubmenu(null); }} type="button"><small>{language.flag}</small><span>{language.label}</span>{i18n.language === language.code && <MdiIcon name="mdi-check" />}</button>)}
              </div>}
            </div>
            <button onClick={toggleTheme} type="button"><MdiIcon name={isDark ? 'mdi-white-balance-sunny' : 'mdi-weather-night'} /><span>{t(`features.chat.modes.${isDark ? 'lightMode' : 'darkMode'}`)}</span></button>
          </div>
        </details>
      </div>
    </aside>
    {sidebarOpen && <button aria-label="Close conversations" className="chat-sidebar-backdrop" onClick={() => setSidebarOpen(false)} type="button" />}
    <main className={`chat-main ${emptyChat ? 'is-empty-chat' : ''}`}>
      <header className="chat-toolbar">
        <button aria-label="Open conversations" className="chat-toolbar__sidebar-open" onClick={() => setSidebarOpen(true)} type="button"><MdiIcon name="mdi-menu" /></button>
        <details className="chat-model-menu" onToggle={(event) => { if (event.currentTarget.open) void loadProviders(); }} ref={modelMenuRef}>
          <summary><span><strong>{modelTitle}</strong>{modelMeta && modelMeta !== modelTitle && <em>{modelMeta}</em>}<MdiIcon name="mdi-chevron-down" /></span><small>{sessionTitle}</small></summary>
          <div className="chat-model-menu__panel">
            <label className="chat-model-search"><MdiIcon name="mdi-magnify" /><input aria-label="Search models" onChange={(event) => setProviderSearch(event.target.value)} placeholder="Search models" value={providerSearch} /></label>
            <div className="chat-model-list">
              {filteredProviders.map((item) => {
                const selected = item.id === provider;
                const metadata = providerMetadata[item.model];
                return <div className={selected ? 'is-selected' : ''} key={item.id}>
                  <button className="chat-model-list__copy" onClick={() => selectProvider(item)} type="button"><strong>{item.id}</strong><small><span>{item.model}</span><span className="chat-model-badges">{providerCapabilityBadges(item, metadata).map((badge) => <span className={badge.enabled ? '' : 'is-disabled'} key={badge.key} title={t(`features.provider.models.metadata.${badge.enabled ? 'enabled' : 'supportedDisabled'}`, { capability: t(`features.provider.models.metadata.${badge.key}`) })}><MdiIcon name={badge.icon} /></span>)}{formatContextLimit(item, metadata) && <b title={t('features.provider.models.metadata.context', { tokens: formatContextLimit(item, metadata) })}>{formatContextLimit(item, metadata)}</b>}</span></small></button>
                  <span className="chat-model-list__actions"><button aria-label={t('features.provider.models.testButton')} className={testingProvider === item.id ? 'is-loading' : ''} disabled={Boolean(testingProvider)} onClick={() => void testProvider(item)} title={t('features.provider.models.testButton')} type="button"><MdiIcon name="mdi-connection" /></button>{selected && <MdiIcon name="mdi-check" />}</span>
                </div>;
              })}
              {providersLoading && <div className="chat-model-list__empty">Loading models…</div>}
              {!providersLoading && !filteredProviders.length && <div className="chat-model-list__empty">No available models</div>}
            </div>
          </div>
        </details>
      </header>
      <section aria-live="polite" className="chat-messages">
        {loading && <div className="monitor-loading">Loading…</div>}
        {emptyChat && <div className="chat-empty"><h1>{t('features.chat.welcome.title')}</h1></div>}
        {messages.map((message, index) => <Message canRegenerate={!sending && message.content.type !== 'user' && index === messages.length - 1 && message.id != null && !String(message.id).startsWith('local-') && Boolean(message.llm_checkpoint_id)} isStreaming={sending && message.content.type !== 'user' && index === messages.length - 1} key={String(message.id || index)} message={message} onRegenerate={(selectedProvider, selectedModel) => void regenerate(message, selectedProvider, selectedModel)} providerMetadata={providerMetadata} providers={providers} selectedModel={model} selectedProvider={provider} />)}
        {error && <div className="monitor-error">{error}</div>}
        <div ref={messageEnd} />
      </section>
      <footer className="chat-composer">
        {files.length > 0 && <div className="chat-files">{files.map((file) => <span key={file.attachment_id}>{file.type === 'record' && <MdiIcon name="mdi-microphone" />}{file.type === 'record' ? t('features.chat.voice.recording') : file.filename}<button aria-label={t('features.chat.input.clear')} onClick={() => setFiles((items) => items.filter((item) => item.attachment_id !== file.attachment_id))} type="button">×</button></span>)}</div>}
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
          {tokenUsage && <span aria-label={tokenUsage.tooltip} className="chat-token-usage" data-tooltip={tokenUsage.tooltip} role="img" style={{ '--chat-token-percent': `${tokenUsage.percent * 3.6}deg` } as CSSProperties} tabIndex={0} />}
          <button aria-label={recording ? t('features.chat.voice.stop') : t('features.chat.voice.startRecording')} aria-pressed={recording} className={`chat-record ${recording ? 'is-recording' : ''}`} disabled={recordingBusy || uploading || sending} onClick={() => void toggleRecording()} title={recording ? t('features.chat.voice.stop') : t('features.chat.voice.startRecording')} type="button"><MdiIcon name={recording ? 'mdi-stop-circle' : 'mdi-microphone'} /></button>
          {sending ? <button aria-label={t('features.chat.input.stopGenerating')} className="chat-send" onClick={() => void stop()} type="button"><MdiIcon name="mdi-stop" /></button> : <button aria-label={t('features.chat.input.send')} className="chat-send" disabled={recording || (!draft.trim() && !files.length)} onClick={() => void send()} type="button"><MdiIcon name="mdi-arrow-up" /></button>}
        </div>
      </footer>
    </main>
  </div>;
}

type WebSocketChatOptions = {
  abort: AbortSignal;
  configId: string;
  enableStreaming: boolean;
  message: Array<{ attachment_id?: string; filename?: string; text?: string; type: string }>;
  messageId: string;
  onPayload: (payload: unknown) => void;
  selectedModel: string;
  selectedProvider: string;
  sessionId: string;
  token: string | null;
};

function readWebSocketChat(options: WebSocketChatOptions) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/api/v1/unified-chat/ws?token=${encodeURIComponent(options.token || '')}`;
  const socket = new WebSocket(url);
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const abortError = () => new DOMException('The chat request was aborted.', 'AbortError');
    const finish = (error?: Error | DOMException) => {
      if (settled) return;
      settled = true;
      options.abort.removeEventListener('abort', handleAbort);
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
      if (error) reject(error);
      else resolve();
    };
    const handleAbort = () => finish(abortError());

    if (options.abort.aborted) {
      finish(abortError());
      return;
    }
    options.abort.addEventListener('abort', handleAbort, { once: true });
    socket.onopen = () => socket.send(JSON.stringify({
      ct: 'chat',
      t: 'send',
      session_id: options.sessionId,
      message_id: options.messageId,
      message: options.message,
      config_id: options.configId || undefined,
      enable_streaming: options.enableStreaming,
      selected_provider: options.selectedProvider || undefined,
      selected_model: options.selectedModel || undefined,
    }));
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as JsonObject;
        options.onPayload(payload);
        if (payload.type === 'end' || payload.t === 'end') finish();
      } catch {
        // Ignore non-JSON keepalive frames.
      }
    };
    socket.onerror = () => finish(new Error('WebSocket connection failed.'));
    socket.onclose = () => finish(options.abort.aborted ? abortError() : new Error('WebSocket connection closed.'));
  });
}

type MessageProps = {
  canRegenerate: boolean;
  isStreaming: boolean;
  message: ChatRecord;
  onRegenerate: (provider: string, model: string) => void;
  providerMetadata: Record<string, JsonObject>;
  providers: ProviderConfig[];
  selectedModel: string;
  selectedProvider: string;
};

function Message({ canRegenerate, isStreaming, message, onRegenerate, providerMetadata, providers, selectedModel, selectedProvider }: MessageProps) {
  const { t } = useTranslation();
  const user = message.content.type === 'user';
  const time = messageTime(message.created_at);
  const stats = message.content.agentStats;
  const copy = () => navigator.clipboard?.writeText(message.content.message.map((part) => part.text || '').join('\n'));
  return <article className={`chat-message ${user ? 'chat-message--user' : 'chat-message--bot'}`}>
    {!user && <div className="chat-message__avatar"><ChatLogo /></div>}
    <div className="chat-message__stack">
      <div className="chat-message__body">{message.content.reasoning && <details><summary>{t('features.chat.reasoning.thinking')}</summary><pre>{message.content.reasoning}</pre></details>}{message.content.message.map((part, index) => <MessagePart key={`${part.type}-${index}`} part={part} streaming={isStreaming} user={user} />)}{message.content.isLoading && !message.content.message.length && <span className="chat-typing">{t('features.chat.message.loading')}</span>}</div>
      {!isStreaming && !message.content.isLoading && <div className="chat-message__meta">
        {time && <span>{time}</span>}
        {canRegenerate && <details className="chat-regenerate-menu">
          <summary aria-label={t('features.chat.actions.retry')} title={t('features.chat.actions.retry')}><MdiIcon name="mdi-refresh" /></summary>
          <div className="chat-message-action-panel">
            <button onClick={() => onRegenerate(selectedProvider, selectedModel)} type="button"><MdiIcon name="mdi-refresh" /><span>{t('features.chat.actions.retry')}</span></button>
            <div className="chat-regenerate-submenu">
              <button type="button"><MdiIcon name="mdi-creation" /><span>{t('features.chat.actions.retryWithModel')}</span><MdiIcon name="mdi-chevron-right" /></button>
              <div className="chat-regenerate-models">{providers.map((item) => <button key={item.id} onClick={() => onRegenerate(item.id, item.model)} type="button"><span><strong>{item.id}</strong><small>{item.model}</small></span><span className="chat-model-badges">{providerCapabilityBadges(item, providerMetadata[item.model]).map((badge) => <MdiIcon className={badge.enabled ? '' : 'is-disabled'} key={badge.key} name={badge.icon} />)}{formatContextLimit(item, providerMetadata[item.model]) && <b>{formatContextLimit(item, providerMetadata[item.model])}</b>}</span></button>)}{!providers.length && <div>{t('features.chat.actions.noAvailableModels')}</div>}</div>
            </div>
          </div>
        </details>}
        {!user && <button aria-label={t('features.chat.actions.copy')} onClick={() => void copy()} title={t('features.chat.actions.copy')} type="button"><MdiIcon name="mdi-content-copy" /></button>}
        {!user && stats && <details className="chat-message-stats">
          <summary aria-label={t('features.chat.stats.tokens')} title={t('features.chat.stats.tokens')}><MdiIcon name="mdi-information-outline" /></summary>
          <div className="chat-stats-card">
            {cachedInputTokens(stats) > 0 && <div><span>{t('features.chat.stats.cachedTokens')}</span><strong>{cachedInputTokens(stats)}</strong></div>}
            <div><span>{t('features.chat.stats.inputTokens')}</span><strong>{inputTokens(stats)}</strong></div>
            <div><span>{t('features.chat.stats.outputTokens')}</span><strong>{outputTokens(stats)}</strong></div>
            {agentTtft(stats) && <div><span>{t('features.chat.stats.ttft')}</span><strong>{agentTtft(stats)}</strong></div>}
            <div><span>{t('features.chat.stats.duration')}</span><strong>{agentDuration(stats)}</strong></div>
          </div>
        </details>}
      </div>}
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
  if (part.type === 'record' && url) return <audio className="chat-audio" controls preload="metadata" src={url} />;
  return <a className="chat-file" href={url || undefined} rel="noreferrer" target="_blank">📎 {filename}</a>;
}

function messageTime(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function inputTokens(stats: JsonObject) {
  return isObject(stats.token_usage) ? readTokenCount(stats.token_usage.input_other) : 0;
}

function outputTokens(stats: JsonObject) {
  return isObject(stats.token_usage) ? readTokenCount(stats.token_usage.output) : 0;
}

function cachedInputTokens(stats: JsonObject) {
  return isObject(stats.token_usage) ? readTokenCount(stats.token_usage.input_cached) : 0;
}

function readTokenCount(value: unknown) {
  const count = Number(value || 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function contextLimit(provider?: ProviderConfig, metadata?: JsonObject) {
  const metadataLimit = metadata?.limit;
  const limit = isObject(metadataLimit) ? Number(metadataLimit.context) : 0;
  const value = limit || Number(provider?.max_context_tokens || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function formatTokenCount(value: number) {
  if (!Number.isFinite(value)) return '';
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${compactNumber(value / 1_000_000)}M`;
  if (absolute >= 1_000) return `${compactNumber(value / 1_000)}K`;
  return String(Math.round(value));
}

function formatUsagePercent(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 10) return String(Math.round(value));
  if (value >= 1) return String(Math.round(value * 10) / 10);
  return String(Math.round(value * 100) / 100);
}

function agentDuration(stats: JsonObject) {
  const direct = positiveNumber(stats, ['duration', 'total_duration']);
  if (direct !== null) return formatDuration(direct);
  const start = positiveNumber(stats, ['start_time']);
  const end = positiveNumber(stats, ['end_time']);
  return start === null || end === null || end < start ? '—' : formatDuration(end - start);
}

function agentTtft(stats: JsonObject) {
  const value = positiveNumber(stats, ['time_to_first_token', 'ttft', 'first_token_latency']);
  return value === null ? '' : formatDuration(value);
}

function positiveNumber(source: JsonObject, keys: string[]) {
  for (const key of keys) {
    const value = Number(source[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function formatDuration(seconds: number) {
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function providerCapabilityBadges(provider: ProviderConfig, metadata?: JsonObject) {
  const modalities = metadata?.modalities;
  const metadataModalities = isObject(modalities) && Array.isArray(modalities.input) ? modalities.input.map(String) : [];
  const enabledModalities = Array.isArray(provider.modalities) ? provider.modalities.map(String) : [];
  const definitions: Array<{ key: string; icon: `mdi-${string}`; supported: boolean; enabled: boolean }> = [
    { key: 'image', icon: 'mdi-image-outline', supported: metadataModalities.includes('image'), enabled: enabledModalities.includes('image') },
    { key: 'audio', icon: 'mdi-music-note-outline', supported: metadataModalities.includes('audio'), enabled: enabledModalities.includes('audio') },
    { key: 'toolUse', icon: 'mdi-wrench-outline', supported: Boolean(metadata?.tool_call), enabled: enabledModalities.includes('tool_use') },
    { key: 'reasoning', icon: 'mdi-brain', supported: Boolean(metadata?.reasoning), enabled: Boolean(provider.reasoning) },
  ];
  return definitions.filter((item) => item.supported || item.enabled).map((item) => ({ ...item, enabled: !metadata || item.enabled }));
}

function formatContextLimit(provider: ProviderConfig, metadata?: JsonObject) {
  const metadataLimit = metadata?.limit;
  const limit = isObject(metadataLimit) ? Number(metadataLimit.context) : 0;
  const tokens = limit || Number(provider.max_context_tokens || 0);
  if (!Number.isFinite(tokens) || tokens <= 0) return '';
  if (tokens >= 1_000_000) return `${compactNumber(tokens / 1_000_000)}M`;
  if (tokens >= 1_000) return `${compactNumber(tokens / 1_000)}K`;
  return String(Math.round(tokens));
}

function compactNumber(value: number) {
  return String(Math.abs(value) >= 10 ? Math.round(value) : Math.round(value * 10) / 10).replace(/\.0$/, '');
}

function ChatLogo() {
  return <svg aria-hidden="true" className="chat-logo" focusable="false" viewBox="0 0 24 24"><path d="M11.96 2.6c.22-.53.97-.53 1.19 0l.76 1.84a7.05 7.05 0 0 0 3.72 3.77l1.75.78c.53.23.53 1 0 1.23l-1.81.8a6.86 6.86 0 0 0-3.66 3.68l-.76 1.75c-.22.52-.97.52-1.19 0l-.75-1.75a6.86 6.86 0 0 0-3.66-3.68l-1.81-.8a.67.67 0 0 1 0-1.23l1.75-.78a7.05 7.05 0 0 0 3.72-3.77l.75-1.84Z" fill="currentColor"/><path d="M18.72 15.2c.12-.3.54-.3.67 0l.3.73c.4.96 1.15 1.72 2.1 2.14l.63.28c.3.13.3.56 0 .69l-.67.3a3.5 3.5 0 0 0-2.06 2.06l-.3.68c-.13.3-.55.3-.68 0l-.3-.68a3.5 3.5 0 0 0-2.05-2.06l-.68-.3a.38.38 0 0 1 0-.69l.64-.28a3.7 3.7 0 0 0 2.1-2.14l.3-.73Z" fill="currentColor"/></svg>;
}

function SidebarIcon({ children }: { children: ReactNode }) {
  return <svg aria-hidden="true" className="chat-sidebar-icon" fill="none" focusable="false" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">{children}</svg>;
}

function PanelLeftIcon() {
  return <SidebarIcon><rect height="18" rx="2" width="18" x="3" y="3"/><path d="M9 3v18"/></SidebarIcon>;
}

function BoxIcon() {
  return <SidebarIcon><path d="m21 8-9 5-9-5"/><path d="m3 8 9-5 9 5v8l-9 5-9-5Z"/><path d="M12 13v8"/></SidebarIcon>;
}

function SquarePenIcon() {
  return <SidebarIcon><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/></SidebarIcon>;
}

function PencilIcon() {
  return <SidebarIcon><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></SidebarIcon>;
}

function TrashIcon() {
  return <SidebarIcon><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></SidebarIcon>;
}

function PlusIcon() {
  return <SidebarIcon><path d="M12 5v14M5 12h14"/></SidebarIcon>;
}
