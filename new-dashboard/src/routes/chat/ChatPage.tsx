import { type MouseEvent as ReactMouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  addChatProjectSession,
  createChatProject,
  createChatSession,
  createChatThread,
  deleteChatThread,
  deleteChatProject,
  deleteChatSession,
  getChatThread,
  getChatSession,
  listChatConfigs,
  listCommands,
  listConfigRoutes,
  listChatProjectSessions,
  listChatProjects,
  listChatSessions,
  listProviders,
  stopChatSession,
  testProviderById,
  updateChatMessage,
  updateChatSession,
  updateChatProject,
  upsertConfigRoute,
  uploadFile,
} from '@/api/openapi';
import { readAuthToken } from '@/auth/storage';
import { Dialog } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { errorMessage, isObject, JsonObject, objectList, recordId, responseData } from '@/routes/configuration/model';
import { confirmAction, toast } from '@/stores/feedback';
import { useLayoutStore } from '@/stores/layout';
import ProviderPage from '@/routes/configuration/ProviderPage';
import { AudioRecorder } from './audioRecorder';
import {
  ChatComposer,
  type ChatComposerAttachment,
  type ChatComposerCommand,
  type ChatComposerConfig,
  type ChatComposerHandle,
} from './ChatComposer';
import { ChatMessageList } from './ChatMessageList';
import { ChatProjectDialog, type ChatProjectForm } from './ChatProjectDialog';
import {
  buildWebchatUmo,
  configRouteEntries,
  resolveChatConfigId,
  storeChatConfigId,
  storedChatConfigId,
  type ConfigRouteEntry,
} from './configBinding';
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
type StagedFile = { attachment_id: string; filename: string; preview_url?: string; type: StagedAttachmentType };
type ProviderConfig = JsonObject & { id: string; model: string };
type TransportMode = 'sse' | 'websocket';
type ChatThread = JsonObject & {
  thread_id: string;
  parent_message_id?: string | number;
  selected_text?: string;
  messages?: ChatRecord[];
};
type CommandSuggestion = JsonObject & {
  effective_command: string;
  description?: string;
  plugin_display_name?: string;
  enabled?: boolean;
  reserved?: boolean;
};

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
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(() => {
    try {
      const value = JSON.parse(localStorage.getItem('chat.projectExpandedIds') || '[]');
      return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item)) : []);
    } catch {
      return new Set();
    }
  });
  const [projectSessions, setProjectSessions] = useState<Record<string, ChatSession[]>>({});
  const [loadingProjectIds, setLoadingProjectIds] = useState<Set<string>>(new Set());
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<JsonObject | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState('');
  const [projectError, setProjectError] = useState('');
  const [projectSaving, setProjectSaving] = useState(false);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [providerMetadata, setProviderMetadata] = useState<Record<string, JsonObject>>({});
  const [providerSearch, setProviderSearch] = useState('');
  const [providersLoading, setProvidersLoading] = useState(false);
  const [testingProvider, setTestingProvider] = useState('');
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingSessionSending, setPendingSessionSending] = useState(false);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [error, setError] = useState('');
  const [chatboxSidebarOpen, setChatboxSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [configId, setConfigId] = useState(storedChatConfigId);
  const [configRoutes, setConfigRoutes] = useState<ConfigRouteEntry[]>([]);
  const [configSaving, setConfigSaving] = useState(false);
  const [commands, setCommands] = useState<CommandSuggestion[]>([]);
  const [wakePrefixes, setWakePrefixes] = useState<string[]>(['/']);
  const [provider, setProvider] = useState(() => localStorage.getItem('selectedProvider') || '');
  const [model, setModel] = useState(() => localStorage.getItem('selectedProviderModel') || '');
  const [streaming, setStreaming] = useState(true);
  const [transportMode, setTransportMode] = useState<TransportMode>(() => localStorage.getItem('chat.transportMode') === 'websocket' ? 'websocket' : 'sse');
  const [settingsSubmenu, setSettingsSubmenu] = useState<'transport' | 'language' | null>(null);
  const [replyTarget, setReplyTarget] = useState<ChatRecord | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatRecord | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [savingMessageEdit, setSavingMessageEdit] = useState(false);
  const [selectedRefs, setSelectedRefs] = useState<JsonObject | null>(null);
  const [imagePreview, setImagePreview] = useState<{ name: string; url: string } | null>(null);
  const [reasoningTarget, setReasoningTarget] = useState<ChatRecord | null>(null);
  const [activeThread, setActiveThread] = useState<ChatThread | null>(null);
  const [threadDeleting, setThreadDeleting] = useState(false);
  const [threadDraft, setThreadDraft] = useState('');
  const [threadSending, setThreadSending] = useState(false);
  const [threadSelection, setThreadSelection] = useState<{ message: ChatRecord; text: string; left: number; top: number } | null>(null);
  const [renamingSession, setRenamingSession] = useState<ChatSession | null>(null);
  const [sessionTitleDraft, setSessionTitleDraft] = useState('');
  const [sessionTitleSaving, setSessionTitleSaving] = useState(false);
  const [, setMediaVersion] = useState(0);
  const layoutChatSidebarOpen = useLayoutStore((state) => state.chatSidebarOpen);
  const setLayoutChatSidebarOpen = useLayoutStore((state) => state.setChatSidebarOpen);
  const themeMode = useLayoutStore((state) => state.themeMode);
  const setThemeMode = useLayoutStore((state) => state.setThemeMode);
  const abortRef = useRef<AbortController | null>(null);
  const activeStreamsRef = useRef<Map<string, AbortController>>(new Map());
  const messageCacheRef = useRef<Record<string, ChatRecord[]>>({});
  const activeConversationRef = useRef(conversationId);
  const audioRecorderRef = useRef(new AudioRecorder());
  const activeSessionRef = useRef('');
  const pendingLocalSessionRef = useRef<string | null>(null);
  const modelMenuRef = useRef<HTMLDetailsElement>(null);
  const settingsMenuRef = useRef<HTMLDetailsElement>(null);
  const settingsSubmenuTimer = useRef<number | null>(null);
  const messageScrollFrame = useRef<number | null>(null);
  const messageLoadRequestRef = useRef(0);
  const messageEnd = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLElement>(null);
  const threadMessagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<ChatComposerHandle>(null);
  const shouldStickToBottomRef = useRef(true);
  const mediaUrlsRef = useRef<Record<string, string>>({});
  const current = useMemo(
    () => sessions.find((item) => item.session_id === conversationId)
      || Object.values(projectSessions).flat().find((item) => item.session_id === conversationId),
    [conversationId, projectSessions, sessions],
  );
  const isProviderWorkspace = conversationId === 'models';
  const selectedProject = useMemo(
    () => projects.find((project) => recordId(project, 'project_id', 'id') === selectedProjectId),
    [projects, selectedProjectId],
  );
  const currentProvider = useMemo(() => providers.find((item) => item.id === provider) || providers[0], [provider, providers]);
  const currentLanguage = chatLanguageOptions.find((item) => item.code === i18n.language) || chatLanguageOptions[0];
  const editingProjectForm = useMemo<ChatProjectForm | null>(() => editingProject ? {
    description: String(editingProject.description || ''),
    emoji: String(editingProject.emoji || '📁'),
    title: String(editingProject.title || ''),
    workspace_path: String(editingProject.workspace_path || ''),
    workspace_type: (['custom', 'project', 'session'].includes(String(editingProject.workspace_type))
      ? editingProject.workspace_type
      : 'session') as ChatProjectForm['workspace_type'],
  } : null, [editingProject]);
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
  const sending = pendingSessionSending || Boolean(conversationId && runningSessionIds.has(conversationId));
  const sidebarOpen = chatbox ? chatboxSidebarOpen : layoutChatSidebarOpen;
  const setSidebarOpen = useCallback((open: boolean) => {
    if (chatbox) setChatboxSidebarOpen(open);
    else setLayoutChatSidebarOpen(open);
  }, [chatbox, setLayoutChatSidebarOpen]);
  const unwrap = <T,>(response: unknown) => responseData<T>(response);
  const sessionUmo = useCallback((sessionId: string, session?: ChatSession) => buildWebchatUmo(
    sessionId,
    String(session?.platform_id || 'webchat'),
    Boolean(session?.is_group),
  ), []);

  const applyConfig = useCallback(async (nextConfigId: string, sessionId = conversationId) => {
    const normalized = nextConfigId || 'default';
    const previous = configId;
    setConfigId(normalized);
    storeChatConfigId(normalized);
    if (!sessionId) return true;
    setConfigSaving(true);
    try {
      const session = sessions.find((item) => item.session_id === sessionId)
        || Object.values(projectSessions).flat().find((item) => item.session_id === sessionId);
      const umo = sessionUmo(sessionId, session);
      await upsertConfigRoute({ path: { umo }, body: { config_id: normalized } });
      setConfigRoutes((entries) => [
        ...entries.filter((entry) => entry.pattern !== umo),
        ...(normalized === 'default' ? [] : [{ pattern: umo, configId: normalized }]),
      ]);
      return true;
    } catch (cause) {
      setConfigId(previous);
      storeChatConfigId(previous);
      toast.error(errorMessage(cause, t('features.chat.config.applyFailed', 'Failed to apply configuration.')));
      return false;
    } finally {
      setConfigSaving(false);
    }
  }, [configId, conversationId, projectSessions, sessionUmo, sessions, t]);
  const markSessionRunning = useCallback((sessionId: string, running: boolean) => {
    setRunningSessionIds((currentIds) => {
      const next = new Set(currentIds);
      if (running) next.add(sessionId);
      else next.delete(sessionId);
      return next;
    });
  }, []);

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

  const loadProjectSessions = useCallback(async (projectId: string) => {
    setLoadingProjectIds((current) => new Set(current).add(projectId));
    try {
      const data = unwrap<unknown>(await listChatProjectSessions({ path: { project_id: projectId } }));
      setProjectSessions((current) => ({ ...current, [projectId]: sessionList(data) }));
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.chat.project.loadFailed')));
      setProjectSessions((current) => ({ ...current, [projectId]: [] }));
    } finally {
      setLoadingProjectIds((current) => {
        const next = new Set(current);
        next.delete(projectId);
        return next;
      });
    }
  }, [t]);

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
    const requestId = ++messageLoadRequestRef.current;
    if (!conversationId || conversationId === 'models') {
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    const cached = messageCacheRef.current[conversationId];
    if (cached && activeStreamsRef.current.has(conversationId)) {
      setMessages([...cached]);
      setLoading(false);
      return;
    }
    try {
      const data = unwrap<JsonObject>(await getChatSession({ path: { session_id: conversationId } }));
      const history = Array.isArray(data?.history) ? data.history : Array.isArray(data?.messages) ? data.messages : [];
      const normalized = history.map(normalizeRecord);
      const threads = Array.isArray(data?.threads) ? data.threads.filter(isObject) : [];
      normalized.forEach((message) => {
        message.threads = threads.filter((thread) => String(thread.parent_message_id) === String(message.id));
      });
      messageCacheRef.current[conversationId] = normalized;
      if (requestId === messageLoadRequestRef.current) setMessages(normalized);
    } catch (cause) {
      if (requestId === messageLoadRequestRef.current) {
        setError(errorMessage(cause, 'Failed to load conversation.'));
        setMessages([]);
      }
    } finally {
      if (requestId === messageLoadRequestRef.current) setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void loadSessions();
    void loadProjects();
    void loadProviders();
    void listChatConfigs()
      .then((response) => setConfigs(objectList(unwrap(response), ['info_list', 'configs', 'items'])))
      .catch(() => undefined);
    void listConfigRoutes()
      .then((response) => setConfigRoutes(configRouteEntries(unwrap<JsonObject>(response))))
      .catch(() => setConfigRoutes([]));
  }, [loadProjects, loadProviders, loadSessions]);
  useEffect(() => {
    const validIds = new Set(projects.map((project) => recordId(project, 'project_id', 'id')).filter(Boolean));
    expandedProjectIds.forEach((projectId) => {
      if (validIds.has(projectId) && !projectSessions[projectId] && !loadingProjectIds.has(projectId)) {
        void loadProjectSessions(projectId);
      }
    });
  }, [expandedProjectIds, loadProjectSessions, loadingProjectIds, projectSessions, projects]);
  useEffect(() => {
    if (!conversationId) return;
    const session = sessions.find((item) => item.session_id === conversationId)
      || Object.values(projectSessions).flat().find((item) => item.session_id === conversationId);
    const resolved = resolveChatConfigId(configRoutes, sessionUmo(conversationId, session));
    setConfigId(resolved);
    storeChatConfigId(resolved);
  }, [configRoutes, conversationId, projectSessions, sessionUmo, sessions]);
  useEffect(() => {
    void listCommands({ query: { config_id: configId === 'default' ? undefined : configId } })
      .then((response) => {
        const payload = unwrap<JsonObject>(response);
        setWakePrefixes(Array.isArray(payload.wake_prefix) && payload.wake_prefix.length
          ? payload.wake_prefix.map(String)
          : ['/']);
        setCommands(flattenCommandSuggestions(objectList(payload, ['items', 'commands', 'data'])));
      })
      .catch(() => {
        setCommands([]);
        setWakePrefixes(['/']);
      });
  }, [configId]);

  useEffect(() => {
    activeConversationRef.current = conversationId;
    setEditingMessage(null);
    setReasoningTarget(null);
    setSelectedRefs(null);
    setActiveThread(null);
    setThreadSelection(null);
    if (conversationId) setSelectedProjectId('');
    if (pendingLocalSessionRef.current === conversationId) {
      pendingLocalSessionRef.current = null;
      setLoading(false);
      return;
    }
    void loadMessages();
  }, [conversationId, loadMessages]);

  useEffect(() => () => {
    activeStreamsRef.current.forEach((controller) => controller.abort());
    activeStreamsRef.current.clear();
    audioRecorderRef.current.cancel();
    if (settingsSubmenuTimer.current != null) window.clearTimeout(settingsSubmenuTimer.current);
    if (messageScrollFrame.current != null) window.cancelAnimationFrame(messageScrollFrame.current);
    Object.values(mediaUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    mediaUrlsRef.current = {};
  }, []);
  useEffect(() => {
    const token = readAuthToken(localStorage);
    const records = activeThread?.messages ? [...messages, ...activeThread.messages] : messages;
    records.flatMap((message) => message.content.message).forEach((part) => {
      if (!['image', 'record', 'audio', 'video', 'file'].includes(part.type)) return;
      const key = mediaPartKey(part);
      if (!key || mediaUrlsRef.current[key]) return;
      const url = part.attachment_id
        ? `/api/v1/files/${encodeURIComponent(part.attachment_id)}/content`
        : part.stored_filename
          ? `/api/v1/files/content?filename=${encodeURIComponent(part.stored_filename)}`
          : '';
      if (!url) return;
      mediaUrlsRef.current[key] = '';
      void fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined })
        .then((response) => {
          if (!response.ok) throw new Error(String(response.status));
          return response.blob();
        })
        .then((blob) => {
          mediaUrlsRef.current[key] = URL.createObjectURL(blob);
          setMediaVersion((version) => version + 1);
        })
        .catch(() => {
          delete mediaUrlsRef.current[key];
        });
    });
  }, [activeThread?.messages, messages]);
  useEffect(() => {
    if (!shouldStickToBottomRef.current) return;
    if (messageScrollFrame.current != null) return;
    messageScrollFrame.current = window.requestAnimationFrame(() => {
      messageScrollFrame.current = null;
      messageEnd.current?.scrollIntoView({ behavior: sending ? 'auto' : 'smooth', block: 'end' });
    });
  }, [messages, sending]);
  useEffect(() => {
    const container = threadMessagesRef.current;
    if (!container) return;
    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeThread?.messages, threadSending]);
  useEffect(() => { localStorage.setItem('selectedProvider', provider); }, [provider]);
  useEffect(() => { localStorage.setItem('selectedProviderModel', model); }, [model]);
  useEffect(() => { localStorage.setItem('chat.transportMode', transportMode); }, [transportMode]);
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

  const createSession = async (projectId = '') => {
    const data = unwrap<JsonObject>(await createChatSession());
    const id = recordId(data, 'session_id', 'id');
    if (!id) throw new Error('The server did not return a session ID.');
    const selectedConfig = storedChatConfigId();
    if (selectedConfig !== 'default') {
      const umo = sessionUmo(id);
      await upsertConfigRoute({ path: { umo }, body: { config_id: selectedConfig } });
      setConfigRoutes((entries) => [
        ...entries.filter((entry) => entry.pattern !== umo),
        { pattern: umo, configId: selectedConfig },
      ]);
    }
    if (projectId) {
      await addChatProjectSession({ path: { project_id: projectId, session_id: id } });
      await loadProjectSessions(projectId);
    }
    await loadSessions();
    setSelectedProjectId('');
    pendingLocalSessionRef.current = id;
    navigate(`${basePath}/${encodeURIComponent(id)}`);
    return id;
  };

  const newChat = () => {
    audioRecorderRef.current.cancel();
    pendingLocalSessionRef.current = null;
    messageLoadRequestRef.current += 1;
    setSelectedProjectId('');
    setMessages([]);
    files.forEach((file) => file.preview_url && URL.revokeObjectURL(file.preview_url));
    setFiles([]);
    setRecording(false);
    setPendingSessionSending(false);
    setReplyTarget(null);
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
    const name = session.display_name || session.session_id;
    if (!await confirmAction({
      confirmLabel: t('features.chat.batch.delete'),
      danger: true,
      message: t('features.chat.conversation.confirmDelete', { name }),
      title: t('features.chat.actions.deleteChat'),
    })) return;
    try {
      await deleteChatSession({ path: { session_id: session.session_id } });
      if (conversationId === session.session_id) newChat();
      await loadSessions();
      await Promise.all(Object.keys(projectSessions).map((projectId) => loadProjectSessions(projectId)));
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.chat.batch.requestFailed')));
    }
  };

  const renameSession = (session: ChatSession) => {
    setRenamingSession(session);
    setSessionTitleDraft(session.display_name || '');
  };

  const saveSessionTitle = async () => {
    if (!renamingSession || sessionTitleSaving) return;
    const title = sessionTitleDraft.trim();
    setSessionTitleSaving(true);
    try {
      await updateChatSession({ path: { session_id: renamingSession.session_id }, body: { display_name: title } });
      await loadSessions();
      await Promise.all(Object.keys(projectSessions).map((projectId) => loadProjectSessions(projectId)));
      setRenamingSession(null);
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.chat.conversation.renameFailed', 'Failed to rename conversation.')));
    } finally {
      setSessionTitleSaving(false);
    }
  };

  const saveProject = async (form: ChatProjectForm) => {
    setProjectSaving(true);
    setProjectError('');
    try {
      const body = {
        description: form.description || undefined,
        emoji: form.emoji || '📁',
        title: form.title,
        workspace_type: form.workspace_type,
        workspace_path: form.workspace_type === 'custom' ? form.workspace_path : undefined,
      };
      const projectId = editingProject ? recordId(editingProject, 'project_id', 'id') : '';
      if (projectId) await updateChatProject({ path: { project_id: projectId }, body });
      else await createChatProject({ body });
      await loadProjects();
      setProjectDialogOpen(false);
      setEditingProject(null);
    } catch (cause) {
      const message = errorMessage(cause, t('features.chat.project.saveFailed'));
      setProjectError(message);
      toast.error(message);
    } finally {
      setProjectSaving(false);
    }
  };

  const removeProject = async (project: JsonObject) => {
    const projectId = recordId(project, 'project_id', 'id');
    if (!projectId || deletingProjectId) return;
    const title = String(project.title || t('features.chat.project.title'));
    if (!await confirmAction({
      confirmLabel: t('core.common.delete'),
      danger: true,
      message: t('features.chat.project.confirmDelete', { title }),
      title: t('core.common.delete'),
    })) return;
    setDeletingProjectId(projectId);
    try {
      await deleteChatProject({ path: { project_id: projectId } });
      setProjects((items) => items.filter((item) => recordId(item, 'project_id', 'id') !== projectId));
      setProjectSessions((current) => {
        const next = { ...current };
        delete next[projectId];
        return next;
      });
      setExpandedProjectIds((current) => {
        const next = new Set(current);
        next.delete(projectId);
        localStorage.setItem('chat.projectExpandedIds', JSON.stringify([...next]));
        return next;
      });
      if (selectedProjectId === projectId) newChat();
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.chat.project.deleteFailed')));
    } finally {
      setDeletingProjectId('');
    }
  };

  const openCreateProject = () => {
    setEditingProject(null);
    setProjectError('');
    setProjectDialogOpen(true);
  };

  const openEditProject = (project: JsonObject) => {
    setEditingProject(project);
    setProjectError('');
    setProjectDialogOpen(true);
  };

  const toggleProject = (projectId: string) => {
    if (!projectId) return;
    setExpandedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      localStorage.setItem('chat.projectExpandedIds', JSON.stringify([...next]));
      return next;
    });
  };

  const selectProject = (projectId: string) => {
    if (!projectId) return;
    audioRecorderRef.current.cancel();
    pendingLocalSessionRef.current = null;
    messageLoadRequestRef.current += 1;
    setSelectedProjectId(projectId);
    setMessages([]);
    setLoading(false);
    files.forEach((file) => file.preview_url && URL.revokeObjectURL(file.preview_url));
    setFiles([]);
    setRecording(false);
    setPendingSessionSending(false);
    setReplyTarget(null);
    navigate(basePath);
    if (!projectSessions[projectId] && !loadingProjectIds.has(projectId)) void loadProjectSessions(projectId);
    setSidebarOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const selectProjectRow = (projectId: string) => {
    toggleProject(projectId);
    selectProject(projectId);
  };

  const selectSession = (sessionId: string) => {
    setSelectedProjectId('');
    navigate(`${basePath}/${encodeURIComponent(sessionId)}`);
    setSidebarOpen(false);
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
        preview_url: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
        type: stagedAttachmentType(data.type, file.type),
      }]);
    } catch (cause) {
      toast.error(errorMessage(cause, 'Failed to upload file.'));
    } finally {
      setUploading(false);
    }
  };
  const uploadFiles = async (selectedFiles: File[]) => {
    for (const file of selectedFiles) await upload(file);
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
    setPendingSessionSending(true);
    setError('');
    let sessionId = conversationId;
    const targetProjectId = selectedProjectId;
    let bot: ChatRecord | null = null;
    let abort: AbortController | null = null;
    let streamRender: ReturnType<typeof createStreamRenderScheduler> | null = null;
    try {
      if (!sessionId) sessionId = await createSession(targetProjectId);
      const outgoing: ChatPart[] = [
        ...(replyTarget?.id != null ? [{ type: 'reply', message_id: replyTarget.id, selected_text: '' }] : []),
        ...(text ? [{ type: 'plain', text }] : []),
        ...files.map((file) => ({ type: file.type, attachment_id: file.attachment_id, filename: file.filename })),
      ];
      const messageId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      const createdAt = new Date().toISOString();
      const user: ChatRecord = { id: `local-user-${messageId}`, created_at: createdAt, content: { type: 'user', message: outgoing } };
      bot = { id: `local-bot-${messageId}`, created_at: createdAt, content: { type: 'bot', message: [], isLoading: true } };
      shouldStickToBottomRef.current = true;
      setMessages((items) => {
        const next = [...items, user, bot!];
        messageCacheRef.current[sessionId] = next;
        return next;
      });
      setDraft('');
      files.forEach((file) => file.preview_url && URL.revokeObjectURL(file.preview_url));
      setFiles([]);
      setReplyTarget(null);
      markSessionRunning(sessionId, true);
      setPendingSessionSending(false);

      if (!current?.display_name && text) {
        void updateChatSession({ path: { session_id: sessionId }, body: { display_name: text.slice(0, 40) } })
          .then(async () => {
            await loadSessions();
            if (targetProjectId) await loadProjectSessions(targetProjectId);
          })
          .catch(() => undefined);
      }

      abort = new AbortController();
      abortRef.current = abort;
      activeStreamsRef.current.set(sessionId, abort);
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
        const cached = messageCacheRef.current[sessionId];
        if (activeConversationRef.current === sessionId && cached?.includes(bot!)) setMessages([...cached]);
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
      if (targetProjectId) await loadProjectSessions(targetProjectId);
    } catch (cause) {
      if ((cause as Error)?.name !== 'AbortError') {
        const message = errorMessage(cause, 'Failed to send message.');
        setError(message);
        toast.error(message);
        if (bot && !bot.content.message.length) bot.content.message.push({ type: 'plain', text: message });
      }
    } finally {
      if (bot) {
        bot.content.isLoading = false;
        if (streamRender) {
          streamRender.schedule();
          streamRender.flush();
        } else {
          const cached = messageCacheRef.current[sessionId];
          if (activeConversationRef.current === sessionId && cached?.includes(bot)) setMessages([...cached]);
        }
      }
      if (!abort || abortRef.current === abort) abortRef.current = null;
      if (sessionId) activeStreamsRef.current.delete(sessionId);
      if (!sessionId || activeSessionRef.current === sessionId) activeSessionRef.current = '';
      if (sessionId) markSessionRunning(sessionId, false);
      setPendingSessionSending(false);
      if (!sessionId || activeConversationRef.current === sessionId) requestAnimationFrame(() => inputRef.current?.focus());
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
    setMessages((items) => {
      const next = items.map((item, itemIndex) => itemIndex === index ? regenerated : item);
      messageCacheRef.current[conversationId] = next;
      return next;
    });
    markSessionRunning(conversationId, true);
    setError('');
    const abort = new AbortController();
    const streamRender = createStreamRenderScheduler(() => {
      const cached = messageCacheRef.current[conversationId];
      if (activeConversationRef.current === conversationId && cached?.includes(regenerated)) setMessages([...cached]);
    });
    abortRef.current = abort;
    activeStreamsRef.current.set(conversationId, abort);
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
        if (!regenerated.content.message.length) regenerated.content.message.push({ type: 'plain', text: message });
      }
    } finally {
      regenerated.content.isLoading = false;
      streamRender.schedule();
      streamRender.flush();
      if (abortRef.current === abort) abortRef.current = null;
      activeStreamsRef.current.delete(conversationId);
      if (activeSessionRef.current === conversationId) activeSessionRef.current = '';
      markSessionRunning(conversationId, false);
    }
  };

  const openMessageEdit = (message: ChatRecord) => {
    setEditingMessage(message);
    setEditingDraft(message.content.message.filter((part) => part.type === 'plain').map((part) => part.text || '').join('\n'));
  };

  const continueAfterEdit = async (source: ChatRecord, baseMessages: ChatRecord[]) => {
    if (!conversationId) return;
    const messageId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    const bot: ChatRecord = {
      id: `local-edited-bot-${messageId}`,
      created_at: new Date().toISOString(),
      content: { type: 'bot', message: [], reasoning: '', isLoading: true },
    };
    const nextMessages = [...baseMessages, bot];
    messageCacheRef.current[conversationId] = nextMessages;
    setMessages(nextMessages);
    markSessionRunning(conversationId, true);
    const abort = new AbortController();
    activeStreamsRef.current.set(conversationId, abort);
    const scheduler = createStreamRenderScheduler(() => {
      if (activeConversationRef.current === conversationId) setMessages([...messageCacheRef.current[conversationId]]);
    });
    try {
      const token = readAuthToken(localStorage);
      const response = await fetch('/api/v1/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          session_id: conversationId,
          message: source.content.message.map((part) => ({
            type: part.type,
            text: part.text,
            attachment_id: part.attachment_id,
            filename: part.filename,
            message_id: part.message_id,
          })),
          config_id: configId || undefined,
          selected_provider: provider || undefined,
          selected_model: model || undefined,
          enable_streaming: streaming,
          _skip_user_history: true,
          _llm_checkpoint_id: source.llm_checkpoint_id || undefined,
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
        if (parsed.payloads.some((payload) => appendStreamPayload(bot, payload))) scheduler.schedule();
      }
      buffer += decoder.decode();
      if (parseSseEvents(buffer, true).payloads.some((payload) => appendStreamPayload(bot, payload))) scheduler.schedule();
    } catch (cause) {
      if ((cause as Error)?.name !== 'AbortError') {
        const message = errorMessage(cause, 'Failed to continue edited message.');
        bot.content.message.push({ type: 'plain', text: message });
        toast.error(message);
      }
    } finally {
      bot.content.isLoading = false;
      scheduler.schedule();
      scheduler.flush();
      activeStreamsRef.current.delete(conversationId);
      markSessionRunning(conversationId, false);
    }
  };

  const saveMessageEdit = async () => {
    if (!conversationId || !editingMessage?.id || savingMessageEdit) return;
    const target = editingMessage;
    const originalIndex = messages.findIndex((message) => String(message.id) === String(target.id));
    if (originalIndex < 0) return;
    const content = {
      ...target.content,
      message: target.content.message.map((part) => part.type === 'plain' ? { ...part, text: editingDraft.trim() } : part),
    };
    setSavingMessageEdit(true);
    try {
      const payload = unwrap<JsonObject>(await updateChatMessage({
        path: { session_id: conversationId, message_id: String(target.id) },
        body: { content },
      }));
      const updated = payload.message ? normalizeRecord(payload.message) : { ...target, content };
      const truncated = Boolean(payload.truncated_after_message);
      const next = truncated
        ? [...messages.slice(0, originalIndex), updated]
        : messages.map((message, index) => index === originalIndex ? updated : message);
      messageCacheRef.current[conversationId] = next;
      setMessages(next);
      setEditingMessage(null);
      if (payload.needs_regenerate) {
        if (truncated) void continueAfterEdit(updated, next);
        else {
          const nextBot = messages.slice(originalIndex + 1).find((message) => message.content.type !== 'user');
          if (nextBot) void regenerate(nextBot);
        }
      }
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.chat.message.editFailed', 'Failed to edit message.')));
    } finally {
      setSavingMessageEdit(false);
    }
  };

  const selectMessageText = (text: string, message: ChatRecord, event: ReactMouseEvent<HTMLDivElement>) => {
    if (message.id == null || String(message.id).startsWith('local-')) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    setThreadSelection({
      message,
      text,
      left: Math.min(window.innerWidth - 180, Math.max(12, rect.left + rect.width / 2 - 70)),
      top: Math.max(12, rect.top - 42),
    });
    event.stopPropagation();
  };

  const createThreadFromSelection = async () => {
    if (!conversationId || !threadSelection?.message.id) return;
    try {
      const thread = unwrap<ChatThread>(await createChatThread({
        body: {
          session_id: conversationId,
          parent_message_id: threadSelection.message.id,
          selected_text: threadSelection.text,
        },
      }));
      const existing = Array.isArray(threadSelection.message.threads) ? threadSelection.message.threads : [];
      threadSelection.message.threads = [...existing, thread];
      messageCacheRef.current[conversationId] = [...messages];
      setMessages([...messages]);
      setReasoningTarget(null);
      setSelectedRefs(null);
      setActiveThread(thread);
      window.getSelection()?.removeAllRanges();
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.chat.thread.createFailed', 'Failed to create thread.')));
    } finally {
      setThreadSelection(null);
    }
  };

  const openThread = async (thread: ChatThread) => {
    setReasoningTarget(null);
    setSelectedRefs(null);
    setActiveThread(thread);
    setThreadDraft('');
    try {
      const payload = unwrap<JsonObject>(await getChatThread({ path: { thread_id: thread.thread_id } }));
      const history = Array.isArray(payload.history) ? payload.history.map(normalizeRecord) : [];
      setActiveThread((currentThread) => currentThread?.thread_id === thread.thread_id
        ? { ...currentThread, ...payload, messages: history }
        : currentThread);
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.chat.thread.loadFailed', 'Failed to load thread.')));
    }
  };

  const sendThreadMessage = async () => {
    const text = threadDraft.trim();
    if (!activeThread || !text || threadSending) return;
    const threadId = activeThread.thread_id;
    const user: ChatRecord = {
      id: `local-thread-user-${Date.now()}`,
      created_at: new Date().toISOString(),
      content: { type: 'user', message: [{ type: 'plain', text }] },
    };
    const bot: ChatRecord = {
      id: `local-thread-bot-${Date.now()}`,
      created_at: new Date().toISOString(),
      content: { type: 'bot', message: [], isLoading: true },
    };
    setActiveThread((thread) => thread ? { ...thread, messages: [...(thread.messages || []), user, bot] } : thread);
    setThreadDraft('');
    setThreadSending(true);
    try {
      const token = readAuthToken(localStorage);
      const response = await fetch(`/api/v1/chat/threads/${encodeURIComponent(threadId)}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: [{ type: 'plain', text }],
          selected_provider: provider || undefined,
          selected_model: model || undefined,
          enable_streaming: streaming,
        }),
      });
      if (!response.ok || !response.body) throw new Error(`Thread request failed: ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const render = (payloads: unknown[]) => {
        if (payloads.some((payload) => appendStreamPayload(bot, payload))) {
          setActiveThread((thread) => thread ? { ...thread, messages: [...(thread.messages || [])] } : thread);
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseEvents(buffer);
        buffer = parsed.remainder;
        render(parsed.payloads);
      }
      buffer += decoder.decode();
      render(parseSseEvents(buffer, true).payloads);
    } catch (cause) {
      const message = errorMessage(cause, t('features.chat.thread.sendFailed', 'Failed to send thread message.'));
      bot.content.message.push({ type: 'plain', text: message });
      toast.error(message);
    } finally {
      bot.content.isLoading = false;
      setActiveThread((thread) => thread ? { ...thread, messages: [...(thread.messages || [])] } : thread);
      setThreadSending(false);
    }
  };

  const removeThread = async () => {
    if (!activeThread || threadDeleting) return;
    if (!await confirmAction({
      confirmLabel: t('core.common.delete'),
      danger: true,
      message: t('features.chat.thread.confirmDelete'),
      title: t('features.chat.thread.delete'),
    })) return;
    setThreadDeleting(true);
    try {
      await deleteChatThread({ path: { thread_id: activeThread.thread_id } });
      messages.forEach((message) => {
        if (Array.isArray(message.threads)) {
          message.threads = message.threads.filter((thread) => String((thread as JsonObject).thread_id) !== activeThread.thread_id);
        }
      });
      if (conversationId) messageCacheRef.current[conversationId] = [...messages];
      setMessages([...messages]);
      setActiveThread(null);
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.chat.thread.deleteFailed', 'Failed to delete thread.')));
    } finally {
      setThreadDeleting(false);
    }
  };

  const scrollToMessage = (messageId: string | number) => {
    document.getElementById(`chat-message-${messageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const downloadMessagePart = async (part: ChatPart) => {
    let url = mediaUrlsRef.current[mediaPartKey(part)];
    let temporaryUrl = false;
    if (!url) {
      const endpoint = part.attachment_id
        ? `/api/v1/files/${encodeURIComponent(String(part.attachment_id))}/content`
        : part.stored_filename
          ? `/api/v1/files/content?filename=${encodeURIComponent(String(part.stored_filename))}`
          : '';
      if (!endpoint) return;
      const token = readAuthToken(localStorage);
      const response = await fetch(endpoint, { headers: token ? { Authorization: `Bearer ${token}` } : undefined }).catch(() => null);
      if (!response?.ok) {
        toast.error(t('features.chat.attachment.downloadFailed', 'Failed to download attachment.'));
        return;
      }
      url = URL.createObjectURL(await response.blob());
      temporaryUrl = true;
    }
    const link = document.createElement('a');
    link.href = url;
    link.download = String(part.filename || part.stored_filename || 'attachment');
    document.body.appendChild(link);
    link.click();
    link.remove();
    if (temporaryUrl) window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const stop = async () => {
    const sessionId = conversationId || activeSessionRef.current;
    activeStreamsRef.current.get(sessionId)?.abort();
    if (sessionId) await stopChatSession({ path: { session_id: sessionId } }).catch(() => undefined);
    if (sessionId) {
      activeStreamsRef.current.delete(sessionId);
      markSessionRunning(sessionId, false);
    }
    setPendingSessionSending(false);
  };

  const selectedProjectWorkspace = useMemo(() => {
    if (!selectedProject) return '';
    const type = String(selectedProject.workspace_type || 'session');
    if (type === 'session') return t('features.chat.project.workspace.session');
    const path = String(selectedProject.resolved_workspace_path || selectedProject.workspace_path || '').trim();
    const label = type === 'custom'
      ? t('features.chat.project.workspace.custom')
      : t('features.chat.project.workspace.project');
    return path ? `${label} · ${path}` : label;
  }, [selectedProject, t]);
  const selectedProjectSessions = selectedProjectId ? projectSessions[selectedProjectId] || [] : [];
  const composerAttachments: ChatComposerAttachment[] = files.map((file) => ({
    id: file.attachment_id,
    name: file.filename,
    kind: file.type === 'record' ? 'audio' : file.type,
    previewUrl: file.preview_url,
  }));
  const composerConfigs: ChatComposerConfig[] = [
    { id: 'default', name: 'Default' },
    ...configs.flatMap((config, index) => {
      const id = recordId(config, 'id', 'conf_id') || `config-${index}`;
      return id === 'default' ? [] : [{ id, name: String(config.name || id), description: String(config.description || '') }];
    }),
  ];
  const composerCommands: ChatComposerCommand[] = commands.map((command) => ({
    aliases: Array.isArray(command.aliases) ? command.aliases.map(String) : undefined,
    command: command.effective_command,
    description: command.description,
    disabled: command.enabled === false,
    pluginName: command.plugin_display_name ? String(command.plugin_display_name) : undefined,
    reserved: Boolean(command.reserved),
  }));
  const sessionTitle = current?.display_name || (selectedProject ? String(selectedProject.title || t('features.chat.project.title')) : t('features.chat.conversation.newConversation'));
  const modelTitle = provider || t('features.chat.models.default');
  const modelMeta = currentProvider?.model || model;
  const emptyChat = !selectedProject && !loading && !messages.length;
  const selectedReferenceItems: unknown[] = selectedRefs && Array.isArray(selectedRefs.used) ? selectedRefs.used : [];
  const composerNode = <ChatComposer
    attachments={composerAttachments}
    commands={composerCommands}
    commandSuggestionsLabel={t('features.chat.commandSuggestion.label')}
    configs={composerConfigs}
    configId={configId}
    disabled={uploading || configSaving}
    isRecording={recording}
    isRunning={sending}
    labels={{
      clear: t('features.chat.input.clear'),
      config: t('features.chat.config.title'),
      dropToUpload: t('features.chat.input.dropToUpload'),
      recording: t('features.chat.voice.recording'),
      send: t('features.chat.input.send'),
      startRecording: t('features.chat.voice.startRecording'),
      stopGenerating: t('features.chat.input.stopGenerating'),
      stopRecording: t('features.chat.voice.stop'),
      streamingDisabled: t('features.chat.streaming.disabled'),
      streamingEnabled: t('features.chat.streaming.enabled'),
      upload: t('features.chat.input.upload'),
    }}
    onChange={setDraft}
    onClearReply={() => setReplyTarget(null)}
    onConfigChange={(nextConfigId) => void applyConfig(nextConfigId)}
    onFiles={(selectedFiles) => void uploadFiles(selectedFiles)}
    onRemoveAttachment={(attachment) => setFiles((items) => {
      const removed = items.find((item) => item.attachment_id === attachment.id);
      if (removed?.preview_url) URL.revokeObjectURL(removed.preview_url);
      return items.filter((item) => item.attachment_id !== attachment.id);
    })}
    onSend={() => void send()}
    onStartRecording={() => void toggleRecording()}
    onStop={() => void stop()}
    onStopRecording={() => void toggleRecording()}
    onToggleStreaming={() => setStreaming((value) => !value)}
    placeholder={t('features.chat.input.placeholder')}
    ref={inputRef}
    replyTo={replyTarget?.id == null ? null : {
      messageId: replyTarget.id,
      selectedText: plainMessageText(replyTarget).slice(0, 80),
    }}
    sendShortcut="enter"
    streaming={streaming}
    tokenUsage={tokenUsage}
    value={draft}
    wakePrefixes={wakePrefixes}
  />;

  return <div className={`chat-shell ${chatbox ? 'chat-shell--box' : ''} ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''}`}>
    <aside className={`chat-sessions ${sidebarOpen ? 'is-open' : ''}`}>
      <div className="chat-sessions__brand">
        <div className="chat-sessions__brand-title"><ChatLogo /><span><strong>AstrBot</strong><small>ChatUI</small></span></div>
        <button aria-label={t('features.chat.accessibility.toggleSidebar')} className="chat-sessions__collapse" onClick={() => setSidebarCollapsed((value) => !value)} title={t('features.chat.accessibility.toggleSidebar')} type="button"><span className="chat-sessions__collapse-normal"><PanelLeftIcon /></span><span className="chat-sessions__rail-stack"><ChatLogo /><PanelLeftIcon /></span></button>
        <button aria-label={t('features.chat.accessibility.closeConversations')} className="chat-sessions__close" onClick={() => setSidebarOpen(false)} type="button"><MdiIcon name="mdi-close" /></button>
      </div>
      <nav className="chat-sessions__actions">
        <Link title={t('features.chat.actions.providerConfig')} to={`${basePath}/models`}><BoxIcon /><span>{t('features.chat.actions.providerConfig')}</span></Link>
        <button onClick={newChat} title={t('features.chat.actions.newChat')} type="button"><SquarePenIcon /><span>{t('features.chat.actions.newChat')}</span></button>
      </nav>
      <div className="chat-sessions__content">
        <section className="chat-project-list">
          <div className="chat-section-header"><span>{t('features.chat.project.title')}</span><button aria-label={t('features.chat.project.create')} onClick={openCreateProject} title={t('features.chat.project.create')} type="button"><PlusIcon /></button></div>
          {projects.map((project, index) => {
            const projectId = recordId(project, 'project_id', 'id');
            const expanded = expandedProjectIds.has(projectId);
            return <div className="chat-project-group" key={projectId || `project-${index}`}>
              <div
                aria-expanded={expanded}
                className={`chat-project-row ${selectedProjectId === projectId ? 'is-active' : ''}`}
                onClick={() => selectProjectRow(projectId)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    selectProjectRow(projectId);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <span>{String(project.emoji || '📁')}</span>
                <span className="chat-project-row__title">
                  <strong>{String(project.title || t('features.chat.project.title'))}</strong>
                  <MdiIcon name={expanded ? 'mdi-chevron-down' : 'mdi-chevron-right'} />
                </span>
                <span className="chat-project-row__actions" onClick={(event) => event.stopPropagation()}>
                  <button aria-label={t('features.chat.project.edit')} onClick={() => openEditProject(project)} title={t('features.chat.project.edit')} type="button"><PencilIcon /></button>
                  <button aria-label={t('core.common.delete')} disabled={!projectId || deletingProjectId === projectId} onClick={() => void removeProject(project)} title={t('core.common.delete')} type="button"><TrashIcon /></button>
                </span>
              </div>
              {expanded && <div className="chat-project-session-list">
                {loadingProjectIds.has(projectId)
                  ? <div className="chat-project-session-empty">{t('features.chat.project.loadingSessions')}</div>
                  : projectSessions[projectId]?.length
                    ? projectSessions[projectId].map((session) => <div
                        className={`chat-project-session-row ${session.session_id === conversationId ? 'is-active' : ''}`}
                        key={session.session_id}
                      >
                        <button onClick={() => selectSession(session.session_id)} type="button">{session.display_name?.trim() || t('features.chat.conversation.newConversation')}</button>
                        <span onClick={(event) => event.stopPropagation()}>
                          <button aria-label={t('features.chat.conversation.editDisplayName')} onClick={() => void renameSession(session)} title={t('features.chat.conversation.editDisplayName')} type="button"><PencilIcon /></button>
                          <button aria-label={t('features.chat.actions.deleteChat')} onClick={() => void removeSession(session)} title={t('features.chat.actions.deleteChat')} type="button"><TrashIcon /></button>
                        </span>
                        {runningSessionIds.has(session.session_id) && <MdiIcon className="chat-project-session-progress" name="mdi-loading" />}
                      </div>)
                    : <div className="chat-project-session-empty">{t('features.chat.project.noSessions')}</div>}
              </div>}
            </div>;
          })}
        </section>
        <div className="chat-session-list">
          <div className="chat-session-list__label">{t('features.chat.conversation.title')}</div>
          {sessions.map((session) => <div className={session.session_id === conversationId ? 'is-active' : ''} key={session.session_id}>
            <button onClick={() => selectSession(session.session_id)} type="button"><span>{session.display_name || session.session_id}</span>{runningSessionIds.has(session.session_id) && <MdiIcon className="chat-session-progress" name="mdi-loading" />}</button>
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
    {sidebarOpen && <button aria-label={t('features.chat.accessibility.closeConversations')} className="chat-sidebar-backdrop" onClick={() => setSidebarOpen(false)} type="button" />}
    <main className={`chat-main ${emptyChat && !isProviderWorkspace ? 'is-empty-chat' : ''} ${selectedProject ? 'is-project-workspace' : ''} ${isProviderWorkspace ? 'is-provider-workspace' : ''} ${reasoningTarget || selectedRefs || activeThread ? 'has-detail-panel' : ''}`}>
      <header className="chat-toolbar">
        <button aria-label={t('features.chat.accessibility.openConversations')} className="chat-toolbar__sidebar-open" onClick={() => setSidebarOpen(true)} type="button"><MdiIcon name="mdi-menu" /></button>
        <details className="chat-model-menu" onToggle={(event) => { if (event.currentTarget.open) void loadProviders(); }} ref={modelMenuRef}>
          <summary><span><strong>{modelTitle}</strong>{modelMeta && modelMeta !== modelTitle && <em>{modelMeta}</em>}<MdiIcon name="mdi-chevron-down" /></span><small>{sessionTitle}</small></summary>
          <div className="chat-model-menu__panel">
            <label className="chat-model-search"><MdiIcon name="mdi-magnify" /><input aria-label={t('features.chat.accessibility.searchModels')} onChange={(event) => setProviderSearch(event.target.value)} placeholder={t('features.chat.accessibility.searchModels')} value={providerSearch} /></label>
            <div className="chat-model-list">
              {filteredProviders.map((item) => {
                const selected = item.id === provider;
                const metadata = providerMetadata[item.model];
                return <div className={selected ? 'is-selected' : ''} key={item.id}>
                  <button className="chat-model-list__copy" onClick={() => selectProvider(item)} type="button"><strong>{item.id}</strong><small><span>{item.model}</span><span className="chat-model-badges">{providerCapabilityBadges(item, metadata).map((badge) => <span className={badge.enabled ? '' : 'is-disabled'} key={badge.key} title={t(`features.provider.models.metadata.${badge.enabled ? 'enabled' : 'supportedDisabled'}`, { capability: t(`features.provider.models.metadata.${badge.key}`) })}><MdiIcon name={badge.icon} /></span>)}{formatContextLimit(item, metadata) && <b title={t('features.provider.models.metadata.context', { tokens: formatContextLimit(item, metadata) })}>{formatContextLimit(item, metadata)}</b>}</span></small></button>
                  <span className="chat-model-list__actions"><button aria-label={t('features.provider.models.testButton')} className={testingProvider === item.id ? 'is-loading' : ''} disabled={Boolean(testingProvider)} onClick={() => void testProvider(item)} title={t('features.provider.models.testButton')} type="button"><MdiIcon name="mdi-connection" /></button>{selected && <MdiIcon name="mdi-check" />}</span>
                </div>;
              })}
              {providersLoading && <div className="chat-model-list__empty">{t('features.chat.models.loading')}</div>}
              {!providersLoading && !filteredProviders.length && <div className="chat-model-list__empty">{t('features.chat.actions.noAvailableModels')}</div>}
            </div>
          </div>
        </details>
      </header>
      {isProviderWorkspace ? <section className="chat-provider-workspace"><ProviderPage /></section> : <><section
        aria-live="polite"
        className="chat-messages"
        onScroll={(event) => {
          const target = event.currentTarget;
          shouldStickToBottomRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 80;
          setThreadSelection(null);
        }}
        ref={messagesRef}
      >
        {loading && <div className="monitor-loading">{t('core.common.loading')}</div>}
        {selectedProject && <div className="chat-project-workspace">
          <header className="chat-project-workspace__header">
            <h1><span>{String(selectedProject.emoji || '📁')}</span>{String(selectedProject.title || t('features.chat.project.title'))}</h1>
            {Boolean(selectedProject.description) && <p>{String(selectedProject.description)}</p>}
            <small><MdiIcon name="mdi-folder-cog-outline" />{selectedProjectWorkspace}</small>
          </header>
          <div className="chat-project-composer">{composerNode}</div>
          <div className="chat-project-workspace__sessions">
            {loadingProjectIds.has(selectedProjectId)
              ? <div className="chat-project-workspace__empty">{t('features.chat.project.loadingSessions')}</div>
              : selectedProjectSessions.length
                ? selectedProjectSessions.map((session) => <article className="chat-project-workspace__session" key={session.session_id}>
                    <button onClick={() => selectSession(session.session_id)} type="button">
                      <strong>{session.display_name?.trim() || t('features.chat.conversation.newConversation')}</strong>
                      <small>{formatProjectSessionDate(session.updated_at || session.created_at, i18n.language)}</small>
                    </button>
                    <div>
                      <button aria-label={t('features.chat.conversation.editDisplayName')} onClick={() => void renameSession(session)} title={t('features.chat.conversation.editDisplayName')} type="button"><PencilIcon /></button>
                      <button aria-label={t('features.chat.actions.deleteChat')} onClick={() => void removeSession(session)} title={t('features.chat.actions.deleteChat')} type="button"><TrashIcon /></button>
                    </div>
                  </article>)
                : <div className="chat-project-workspace__empty"><MdiIcon name="mdi-message-outline" /><span>{t('features.chat.project.noSessions')}</span></div>}
          </div>
        </div>}
        {emptyChat && !error && <div className="chat-empty"><h1>{t('features.chat.welcome.title')}</h1></div>}
        <ChatMessageList
          enableEdit={!sending}
          enableRetry={!sending}
          editingMessageId={editingMessage?.id ?? null}
          editingValue={editingDraft}
          editSaving={savingMessageEdit}
          messages={messages}
          labels={{
            assistant: t('features.chat.message.assistant'),
            cachedTokens: t('features.chat.stats.cachedTokens'),
            cancel: t('core.common.cancel'),
            completed: t('core.status.completed'),
            copy: t('features.chat.actions.copy'),
            download: t('features.chat.input.download', 'Download'),
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
          }}
          onEdit={openMessageEdit}
          onEditValueChange={setEditingDraft}
          onCancelEdit={() => setEditingMessage(null)}
          onDownload={(part) => downloadMessagePart(part)}
          onOpenImage={(url, part) => url && setImagePreview({
            name: String(part.filename || part.stored_filename || t('features.chat.attachment.image', 'Image')),
            url,
          })}
          onOpenReasoning={(message) => {
            setSelectedRefs(null);
            setActiveThread(null);
            setReasoningTarget(message);
          }}
          onOpenRefs={(refs) => {
            setReasoningTarget(null);
            setActiveThread(null);
            setSelectedRefs({ used: refs });
          }}
          onOpenThread={(thread) => void openThread(thread as ChatThread)}
          onReplyClick={(messageId) => scrollToMessage(messageId)}
          onRetry={(message) => void regenerate(message)}
          onRetryWithModel={(message, providerId, modelName) => void regenerate(message, providerId, modelName)}
          onSaveEdit={() => void saveMessageEdit()}
          onSelectText={selectMessageText}
          resolvePartUrl={(part) => mediaUrlsRef.current[mediaPartKey(part)] || ''}
          retryModels={providers.map((item) => ({ providerId: item.id, model: item.model }))}
          streaming={sending}
        />
        {error && <div className="monitor-error">{error}</div>}
        <div ref={messageEnd} />
      </section>
      {!selectedProject && <footer className="chat-composer chat-composer--v2">{composerNode}</footer>}</>}
      {threadSelection && <button
        className="chat-thread-selection"
        onClick={() => void createThreadFromSelection()}
        style={{ left: threadSelection.left, top: threadSelection.top }}
        type="button"
      >{t('features.chat.thread.askInThread', 'Ask in thread')}</button>}
      <Dialog
        onOpenChange={(open) => {
          if (!open && !sessionTitleSaving) {
            setRenamingSession(null);
            setSessionTitleDraft('');
          }
        }}
        open={renamingSession !== null}
        title={t('features.chat.conversation.editDisplayName')}
      >
        <div className="chat-session-rename-dialog">
          <input
            autoFocus
            onChange={(event) => setSessionTitleDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void saveSessionTitle();
              }
            }}
            placeholder={t('features.chat.conversation.displayName')}
            value={sessionTitleDraft}
          />
          <div className="dialog-actions">
            <button
              disabled={sessionTitleSaving}
              onClick={() => {
                setRenamingSession(null);
                setSessionTitleDraft('');
              }}
              type="button"
            >{t('core.common.cancel')}</button>
            <button
              className="button--primary"
              disabled={sessionTitleSaving || !sessionTitleDraft.trim()}
              onClick={() => void saveSessionTitle()}
              type="button"
            >{t('core.common.save')}</button>
          </div>
        </div>
      </Dialog>
      {reasoningTarget && <aside className="chat-detail-panel">
        <header><strong>{t('features.chat.reasoning.thinking')}</strong><button aria-label={t('core.common.close')} onClick={() => setReasoningTarget(null)} type="button"><MdiIcon name="mdi-close" /></button></header>
        <div className="chat-detail-panel__body chat-side-dialog-content">
          <pre>{reasoningTarget.content.reasoning || reasoningTarget.content.message.filter((part) => ['think', 'reasoning'].includes(part.type)).map((part) => part.think || part.text || '').join('\n')}</pre>
        </div>
      </aside>}
      {selectedRefs && <aside className="chat-detail-panel">
        <header><strong>{t('features.chat.refs.title')}</strong><button aria-label={t('core.common.close')} onClick={() => setSelectedRefs(null)} type="button"><MdiIcon name="mdi-close" /></button></header>
        <div className="chat-detail-panel__body chat-reference-list">
          {selectedReferenceItems.map((reference, index) => {
            const item = isObject(reference) ? reference : {};
            return <article key={String(item.id || item.url || index)} onClick={() => item.url && window.open(String(item.url), '_blank')}>
              <strong>{Boolean(item.favicon) && <img alt="" src={String(item.favicon)} />}{String(item.title || item.url || t('features.chat.refs.title'))}</strong>
              {Boolean(item.snippet || item.text || item.content) && <p>{String(item.snippet || item.text || item.content)}</p>}
              {Boolean(item.url) && <small>{referenceHost(String(item.url))}</small>}
            </article>;
          })}
        </div>
      </aside>}
      <Dialog onOpenChange={(open) => !open && setImagePreview(null)} open={imagePreview !== null} title={imagePreview?.name || t('features.chat.attachment.image', 'Image')}>
        {imagePreview && <div className="chat-image-preview"><img alt={imagePreview.name} src={imagePreview.url} /></div>}
      </Dialog>
      {activeThread && <aside className="chat-detail-panel chat-thread-panel">
        <header>
          <strong>{t('features.chat.thread.title')}</strong>
          <span>
            <button aria-label={t('features.chat.thread.delete')} disabled={threadDeleting || threadSending} onClick={() => void removeThread()} type="button"><MdiIcon name="mdi-delete-outline" /></button>
            <button aria-label={t('core.common.close')} onClick={() => setActiveThread(null)} type="button"><MdiIcon name="mdi-close" /></button>
          </span>
        </header>
        <div className="chat-thread-dialog">
          {activeThread?.selected_text && <blockquote>{activeThread.selected_text}</blockquote>}
          <div className="chat-thread-messages" ref={threadMessagesRef}>
            <ChatMessageList
              enableEdit={false}
              enableRetry={false}
              messages={activeThread?.messages || []}
              onDownload={(part) => downloadMessagePart(part)}
              onOpenImage={(url, part) => url && setImagePreview({
                name: String(part.filename || part.stored_filename || t('features.chat.attachment.image', 'Image')),
                url,
              })}
              resolvePartUrl={(part) => mediaUrlsRef.current[mediaPartKey(part)] || ''}
              streaming={threadSending}
            />
          </div>
          <div className="chat-thread-composer">
            <textarea
              disabled={threadSending}
              onChange={(event) => setThreadDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void sendThreadMessage();
                }
              }}
              placeholder={t('features.chat.thread.placeholder')}
              rows={2}
              value={threadDraft}
            />
            <button className="button--primary" disabled={threadSending || !threadDraft.trim()} onClick={() => void sendThreadMessage()} type="button">{t('features.chat.input.send')}</button>
          </div>
        </div>
      </aside>}
      <ChatProjectDialog
        error={projectError}
        onOpenChange={(open) => {
          setProjectDialogOpen(open);
          if (!open) {
            setProjectError('');
            setEditingProject(null);
          }
        }}
        onSave={(form) => void saveProject(form)}
        open={projectDialogOpen}
        project={editingProjectForm}
        saving={projectSaving}
      />
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

function plainMessageText(message: ChatRecord) {
  return message.content.message
    .filter((part) => part.type === 'plain' || part.type === 'text')
    .map((part) => part.text || '')
    .join('\n');
}

function mediaPartKey(part: ChatPart) {
  return String(part.attachment_id || part.stored_filename || part.filename || '');
}

function referenceHost(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

function formatProjectSessionDate(value: unknown, locale: string) {
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
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

function flattenCommandSuggestions(items: JsonObject[]) {
  const result: CommandSuggestion[] = [];
  const seen = new Set<string>();
  const append = (item: JsonObject, parent = '') => {
    const children = Array.isArray(item.sub_commands) ? item.sub_commands.filter(isObject) : [];
    const effective = String(item.effective_command || item.command || item.name || '').trim();
    if (children.length) {
      children.forEach((child) => append(child, effective || parent));
      return;
    }
    if (item.enabled === false || !effective) return;
    const command = parent && !effective.startsWith(parent) ? `${parent} ${effective}` : effective;
    if (!seen.has(command)) {
      seen.add(command);
      result.push({ ...item, effective_command: command } as CommandSuggestion);
    }
    const aliases = Array.isArray(item.aliases) ? item.aliases : item.alias ? [item.alias] : [];
    aliases.map(String).filter(Boolean).forEach((alias) => {
      const aliasCommand = parent ? `${parent} ${alias}` : alias;
      if (!seen.has(aliasCommand)) {
        seen.add(aliasCommand);
        result.push({ ...item, effective_command: aliasCommand } as CommandSuggestion);
      }
    });
  };
  items.forEach((item) => append(item));
  return result.sort((left, right) => Number(Boolean(right.reserved)) - Number(Boolean(left.reserved)));
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
