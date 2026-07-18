import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  getConfigProfile,
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
import { fetchWithAuth } from '@/api/http';
import { type ProviderDto, parseChatSessions, parseProviders } from '@/api/domain';
import { decodeApiData, expectRecord } from '@/api/response';
import { Dialog } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { apiEndpoints } from '@/config/endpoints';
import { expandedChatProjectsPreference } from '@/config/preferences';
import { DEFAULT_CONFIG_ID } from '@/config/defaults';
import { useBrowserCapabilities } from '@/platform/BrowserCapabilitiesProvider';
import { useObjectUrlRegistry } from '@/platform/browserHooks';
import { errorMessage, isObject, JsonObject, objectList, recordId, responseData } from '@/routes/configuration/model';
import { providerTestResult } from '@/routes/configuration/providerPageModel';
import { confirmAction, toast } from '@/stores/feedback';
import { useLayoutStore } from '@/stores/layout';
import { acquireActionLock } from '@/utils/actionLock';
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
import { ChatDetailPanels, type ChatThread } from './ChatDetailPanels';
import { BoxIcon, ChatLogo, PanelLeftIcon, PencilIcon, PlusIcon, SquarePenIcon, TrashIcon } from './ChatIcons';
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
import { runChatStream } from './chatTransport';
import { useChatPreferences } from './useChatPreferences';
import {
  agentRunnerTypeFromProfile,
  appendStreamPayload,
  type ChatPart,
  type ChatRecord,
  type ChatSession,
  contextTokenCount,
  normalizeRecord,
  serializeChatParts,
  type StagedAttachmentType,
  stagedAttachmentType,
  usesLocalProviderOverride,
} from './model';
import { localeMetadata, localeRegistry } from '@/i18n/locales';

type ChatPageProps = { chatbox?: boolean };
type StagedFile = { attachment_id: string; filename: string; preview_url?: string; type: StagedAttachmentType };
type ProviderConfig = ProviderDto & { model: string };
type CommandSuggestion = JsonObject & {
  effective_command: string;
  description?: string;
  plugin_display_name?: string;
  enabled?: boolean;
  reserved?: boolean;
};

export default function ChatPage({ chatbox = false }: ChatPageProps) {
  const { downloadBlob } = useBrowserCapabilities();
  const { create: createObjectUrl, revoke: revokeObjectUrl } = useObjectUrlRegistry();
  const { i18n, t } = useTranslation();
  const { conversationId = '' } = useParams();
  const navigate = useNavigate();
  const basePath = chatbox ? '/chatbox' : '/chat';
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [messages, setMessages] = useState<ChatRecord[]>([]);
  const [configs, setConfigs] = useState<JsonObject[]>([]);
  const [projects, setProjects] = useState<JsonObject[]>([]);
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(
    () => new Set(expandedChatProjectsPreference.read()),
  );
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
  const [agentRunnerType, setAgentRunnerType] = useState('local');
  const [agentRunnerLoading, setAgentRunnerLoading] = useState(true);
  const [commands, setCommands] = useState<CommandSuggestion[]>([]);
  const [wakePrefixes, setWakePrefixes] = useState<string[]>(['/']);
  const {
    model,
    provider,
    setModel,
    setProvider,
    setSettingsSubmenu,
    setStreaming,
    setTransportMode,
    settingsSubmenu,
    streaming,
    transportMode,
  } = useChatPreferences();
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
  const [threadSelection, setThreadSelection] = useState<{
    message: ChatRecord;
    text: string;
    left: number;
    top: number;
  } | null>(null);
  const [renamingSession, setRenamingSession] = useState<ChatSession | null>(null);
  const [sessionTitleDraft, setSessionTitleDraft] = useState('');
  const [sessionTitleSaving, setSessionTitleSaving] = useState(false);
  const [, setMediaVersion] = useState(0);
  const layoutChatSidebarOpen = useLayoutStore((state) => state.chatSidebarOpen);
  const setLayoutChatSidebarOpen = useLayoutStore((state) => state.setChatSidebarOpen);
  const themeMode = useLayoutStore((state) => state.themeMode);
  const setThemeMode = useLayoutStore((state) => state.setThemeMode);
  const abortRef = useRef<AbortController | null>(null);
  const configSaveLockRef = useRef({ current: false });
  const configIdRef = useRef(configId);
  const agentRunnerCacheRef = useRef(new Map<string, string>());
  const agentRunnerRequestsRef = useRef(new Map<string, Promise<string>>());
  const agentRunnerRequestIdRef = useRef(0);
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
    () =>
      sessions.find((item) => item.session_id === conversationId) ||
      Object.values(projectSessions)
        .flat()
        .find((item) => item.session_id === conversationId),
    [conversationId, projectSessions, sessions],
  );
  const isProviderWorkspace = conversationId === 'models';
  const selectedProject = useMemo(
    () => projects.find((project) => recordId(project, 'project_id', 'id') === selectedProjectId),
    [projects, selectedProjectId],
  );
  const currentProvider = useMemo(
    () => providers.find((item) => item.id === provider) || providers[0],
    [provider, providers],
  );
  const providerOverrideEnabled = !agentRunnerLoading && usesLocalProviderOverride(agentRunnerType);
  const currentLanguage = localeMetadata(i18n.language);
  const editingProjectForm = useMemo<ChatProjectForm | null>(
    () =>
      editingProject
        ? {
            description: String(editingProject.description || ''),
            emoji: String(editingProject.emoji || '📁'),
            title: String(editingProject.title || ''),
            workspace_path: String(editingProject.workspace_path || ''),
            workspace_type: (['custom', 'project', 'session'].includes(String(editingProject.workspace_type))
              ? editingProject.workspace_type
              : 'session') as ChatProjectForm['workspace_type'],
          }
        : null,
    [editingProject],
  );
  const isDark = themeMode === 'dark' || (themeMode === 'system' && document.documentElement.dataset.theme === 'dark');
  const filteredProviders = useMemo(() => {
    const query = providerSearch.trim().toLowerCase();
    return query
      ? providers.filter((item) => item.id.toLowerCase().includes(query) || item.model.toLowerCase().includes(query))
      : providers;
  }, [providerSearch, providers]);
  const tokenUsage = useMemo(() => {
    if (!providerOverrideEnabled) return null;
    const latestStats = [...messages]
      .reverse()
      .find((message) => message.content.type !== 'user' && message.content.agentStats)?.content.agentStats;
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
  }, [currentProvider, messages, model, providerMetadata, providerOverrideEnabled, t]);
  const sending = pendingSessionSending || Boolean(conversationId && runningSessionIds.has(conversationId));
  const sidebarOpen = chatbox ? chatboxSidebarOpen : layoutChatSidebarOpen;
  const setSidebarOpen = useCallback(
    (open: boolean) => {
      if (chatbox) setChatboxSidebarOpen(open);
      else setLayoutChatSidebarOpen(open);
    },
    [chatbox, setLayoutChatSidebarOpen],
  );
  const unwrap = <T,>(response: unknown) => responseData<T>(response);
  const sessionUmo = useCallback(
    (sessionId: string, session?: ChatSession) =>
      buildWebchatUmo(sessionId, String(session?.platform_id || 'webchat'), Boolean(session?.is_group)),
    [],
  );

  const resolveAgentRunnerType = useCallback((nextConfigId: string) => {
    const normalized = nextConfigId || DEFAULT_CONFIG_ID;
    const cached = agentRunnerCacheRef.current.get(normalized);
    if (cached) return Promise.resolve(cached);
    const pending = agentRunnerRequestsRef.current.get(normalized);
    if (pending) return pending;
    const request = getConfigProfile({ path: { config_id: normalized } })
      .then((response) => {
        const type = agentRunnerTypeFromProfile(responseData<JsonObject>(response));
        agentRunnerCacheRef.current.set(normalized, type);
        return type;
      })
      .catch((cause) => {
        console.error(`Failed to load agent runner type for config "${normalized}".`, cause);
        return 'local';
      })
      .finally(() => agentRunnerRequestsRef.current.delete(normalized));
    agentRunnerRequestsRef.current.set(normalized, request);
    return request;
  }, []);

  const loadAgentRunnerType = useCallback(
    async (nextConfigId: string) => {
      const requestId = ++agentRunnerRequestIdRef.current;
      setAgentRunnerLoading(true);
      try {
        const runnerType = await resolveAgentRunnerType(nextConfigId);
        if (requestId === agentRunnerRequestIdRef.current) setAgentRunnerType(runnerType);
        return runnerType;
      } finally {
        if (requestId === agentRunnerRequestIdRef.current) setAgentRunnerLoading(false);
      }
    },
    [resolveAgentRunnerType],
  );

  const applyConfig = useCallback(
    async (nextConfigId: string, sessionId = conversationId) => {
      const releaseLock = acquireActionLock(configSaveLockRef.current);
      if (!releaseLock) return false;
      const normalized = nextConfigId || DEFAULT_CONFIG_ID;
      const previous = configIdRef.current;
      configIdRef.current = normalized;
      setConfigId(normalized);
      storeChatConfigId(normalized);
      setConfigSaving(true);
      try {
        const runnerTypeRequest = loadAgentRunnerType(normalized);
        if (sessionId) {
          const session =
            sessions.find((item) => item.session_id === sessionId) ||
            Object.values(projectSessions)
              .flat()
              .find((item) => item.session_id === sessionId);
          const umo = sessionUmo(sessionId, session);
          await Promise.all([upsertConfigRoute({ path: { umo }, body: { config_id: normalized } }), runnerTypeRequest]);
          setConfigRoutes((entries) => [
            ...entries.filter((entry) => entry.pattern !== umo),
            ...(normalized === DEFAULT_CONFIG_ID ? [] : [{ pattern: umo, configId: normalized }]),
          ]);
        }
        await runnerTypeRequest;
        return true;
      } catch (cause) {
        configIdRef.current = previous;
        setConfigId(previous);
        storeChatConfigId(previous);
        toast.error(errorMessage(cause, t('features.chat.config.applyFailed')));
        return false;
      } finally {
        releaseLock();
        setConfigSaving(false);
      }
    },
    [conversationId, loadAgentRunnerType, projectSessions, sessionUmo, sessions, t],
  );
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
      setSessions(
        decodeApiData(
          await listChatSessions({ query: { page: 1, page_size: 200 } }),
          parseChatSessions,
          'chat session list',
        ),
      );
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

  const loadProjectSessions = useCallback(
    async (projectId: string) => {
      setLoadingProjectIds((current) => new Set(current).add(projectId));
      try {
        const sessions = decodeApiData(
          await listChatProjectSessions({ path: { project_id: projectId } }),
          parseChatSessions,
          'project chat session list',
        );
        setProjectSessions((current) => ({ ...current, [projectId]: sessions }));
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
    },
    [t],
  );

  const loadProviders = useCallback(async () => {
    setProvidersLoading(true);
    try {
      const envelope = decodeApiData(
        await listProviders({ query: { capability: 'chat', enabled: true } }),
        (value) => expectRecord(value, 'provider list'),
        'provider list',
      );
      const items = parseProviders(envelope)
        .filter((item) => (item.enable ?? item.enabled) !== false)
        .map((item) => ({ ...item, model: typeof item.model === 'string' ? item.model : '' }));
      setProviders(items);
      setProviderMetadata(
        isObject(envelope.model_metadata) ? (envelope.model_metadata as Record<string, JsonObject>) : {},
      );
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
    const session =
      sessions.find((item) => item.session_id === conversationId) ||
      Object.values(projectSessions)
        .flat()
        .find((item) => item.session_id === conversationId);
    const resolved = resolveChatConfigId(configRoutes, sessionUmo(conversationId, session));
    configIdRef.current = resolved;
    setConfigId(resolved);
    storeChatConfigId(resolved);
  }, [configRoutes, conversationId, projectSessions, sessionUmo, sessions]);
  useEffect(() => {
    void loadAgentRunnerType(configId);
  }, [configId, loadAgentRunnerType]);
  useEffect(() => {
    void listCommands({ query: { config_id: configId === DEFAULT_CONFIG_ID ? undefined : configId } })
      .then((response) => {
        const payload = unwrap<JsonObject>(response);
        setWakePrefixes(
          Array.isArray(payload.wake_prefix) && payload.wake_prefix.length ? payload.wake_prefix.map(String) : ['/'],
        );
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

  useEffect(
    () => () => {
      activeStreamsRef.current.forEach((controller) => controller.abort());
      activeStreamsRef.current.clear();
      audioRecorderRef.current.cancel();
      if (settingsSubmenuTimer.current != null) window.clearTimeout(settingsSubmenuTimer.current);
      if (messageScrollFrame.current != null) window.cancelAnimationFrame(messageScrollFrame.current);
      Object.values(mediaUrlsRef.current).forEach(revokeObjectUrl);
      mediaUrlsRef.current = {};
    },
    [revokeObjectUrl],
  );
  useEffect(() => {
    const records = activeThread?.messages ? [...messages, ...activeThread.messages] : messages;
    records
      .flatMap((message) => message.content.message)
      .forEach((part) => {
        if (!['image', 'record', 'audio', 'video', 'file'].includes(part.type)) return;
        const key = mediaPartKey(part);
        if (!key || mediaUrlsRef.current[key]) return;
        const url = part.attachment_id
          ? apiEndpoints.fileById(part.attachment_id)
          : part.stored_filename
            ? apiEndpoints.fileByName(part.stored_filename)
            : '';
        if (!url) return;
        mediaUrlsRef.current[key] = '';
        void fetchWithAuth(url)
          .then((response) => {
            if (!response.ok) throw new Error(String(response.status));
            return response.blob();
          })
          .then((blob) => {
            mediaUrlsRef.current[key] = createObjectUrl(blob);
            setMediaVersion((version) => version + 1);
          })
          .catch(() => {
            delete mediaUrlsRef.current[key];
          });
      });
  }, [activeThread?.messages, createObjectUrl, messages]);
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
    if (selectedConfig !== DEFAULT_CONFIG_ID) {
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
    void navigate(`${basePath}/${encodeURIComponent(id)}`);
    return id;
  };

  const newChat = () => {
    audioRecorderRef.current.cancel();
    pendingLocalSessionRef.current = null;
    messageLoadRequestRef.current += 1;
    setSelectedProjectId('');
    setMessages([]);
    files.forEach((file) => revokeObjectUrl(file.preview_url));
    setFiles([]);
    setRecording(false);
    setPendingSessionSending(false);
    setReplyTarget(null);
    void navigate(basePath);
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
    if (
      !(await confirmAction({
        confirmLabel: t('features.chat.batch.delete'),
        danger: true,
        message: t('features.chat.conversation.confirmDelete', { name }),
        title: t('features.chat.actions.deleteChat'),
      }))
    )
      return;
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
      toast.error(errorMessage(cause, t('features.chat.conversation.renameFailed')));
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
    if (
      !(await confirmAction({
        confirmLabel: t('core.common.delete'),
        danger: true,
        message: t('features.chat.project.confirmDelete', { title }),
        title: t('core.common.delete'),
      }))
    )
      return;
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
        expandedChatProjectsPreference.write([...next]);
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
      expandedChatProjectsPreference.write([...next]);
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
    files.forEach((file) => revokeObjectUrl(file.preview_url));
    setFiles([]);
    setRecording(false);
    setPendingSessionSending(false);
    setReplyTarget(null);
    void navigate(basePath);
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
    void navigate(`${basePath}/${encodeURIComponent(sessionId)}`);
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
      const result = providerTestResult(data);
      if (result.status !== 'available' || result.error) {
        throw new Error(result.error || t('features.provider.models.testError'));
      }
      toast.success(
        t('features.provider.models.testSuccessWithLatency', {
          id: item.id,
          latency: Math.max(0, Math.round(performance.now() - startedAt)),
        }),
      );
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
      setFiles((currentFiles) => [
        ...currentFiles,
        {
          attachment_id: id,
          filename: String(data.filename || data.original_name || file.name),
          preview_url: file.type.startsWith('image/') ? createObjectUrl(file) : undefined,
          type: stagedAttachmentType(data.type, file.type),
        },
      ]);
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
      const user: ChatRecord = {
        id: `local-user-${messageId}`,
        created_at: createdAt,
        content: { type: 'user', message: outgoing },
      };
      bot = {
        id: `local-bot-${messageId}`,
        created_at: createdAt,
        content: { type: 'bot', message: [], isLoading: true },
      };
      shouldStickToBottomRef.current = true;
      setMessages((items) => {
        const next = [...items, user, bot!];
        messageCacheRef.current[sessionId] = next;
        return next;
      });
      setDraft('');
      files.forEach((file) => revokeObjectUrl(file.preview_url));
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
      const messagePayload = serializeChatParts(outgoing);
      const applyPayloads = (payloads: unknown[]) => {
        if (!bot) return;
        let changed = false;
        payloads.forEach((payload) => {
          changed = appendStreamPayload(bot!, payload, user) || changed;
        });
        if (changed) streamRender?.schedule();
      };
      streamRender = createStreamRenderScheduler(() => {
        const cached = messageCacheRef.current[sessionId];
        if (activeConversationRef.current === sessionId && cached?.includes(bot!)) setMessages([...cached]);
      });
      await runChatStream(
        {
          kind: 'send',
          configId,
          enableStreaming: streaming,
          message: messagePayload,
          messageId,
          selectedModel: providerOverrideEnabled ? model : '',
          selectedProvider: providerOverrideEnabled ? provider : '',
          sessionId,
          transport: transportMode,
        },
        abort.signal,
        {
          onPayload: (payload) => applyPayloads([payload]),
        },
      );
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
      if (!sessionId || activeConversationRef.current === sessionId)
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
    setMessages((items) => {
      const next = items.map((item, itemIndex) => (itemIndex === index ? regenerated : item));
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
      await runChatStream(
        {
          kind: 'regenerate',
          enableStreaming: streaming,
          selectedModel: providerOverrideEnabled ? selectedModel : '',
          selectedProvider: providerOverrideEnabled ? selectedProvider : '',
          sessionId: conversationId,
          targetMessageId: targetId,
        },
        abort.signal,
        {
          onPayload: (payload) => {
            if (appendStreamPayload(regenerated, payload)) streamRender.schedule();
          },
        },
      );
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
    setEditingDraft(
      message.content.message
        .filter((part) => part.type === 'plain')
        .map((part) => part.text || '')
        .join('\n'),
    );
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
      await runChatStream(
        {
          kind: 'continue',
          configId,
          enableStreaming: streaming,
          llmCheckpointId: String(source.llm_checkpoint_id || ''),
          message: serializeChatParts(source.content.message),
          selectedModel: providerOverrideEnabled ? model : '',
          selectedProvider: providerOverrideEnabled ? provider : '',
          sessionId: conversationId,
        },
        abort.signal,
        {
          onPayload: (payload) => {
            if (appendStreamPayload(bot, payload)) scheduler.schedule();
          },
        },
      );
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
      message: target.content.message.map((part) =>
        part.type === 'plain' ? { ...part, text: editingDraft.trim() } : part,
      ),
    };
    setSavingMessageEdit(true);
    try {
      const payload = unwrap<JsonObject>(
        await updateChatMessage({
          path: { session_id: conversationId, message_id: String(target.id) },
          body: { content },
        }),
      );
      const updated = payload.message ? normalizeRecord(payload.message) : { ...target, content };
      const truncated = Boolean(payload.truncated_after_message);
      const next = truncated
        ? [...messages.slice(0, originalIndex), updated]
        : messages.map((message, index) => (index === originalIndex ? updated : message));
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
      toast.error(errorMessage(cause, t('features.chat.message.editFailed')));
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
      const thread = unwrap<ChatThread>(
        await createChatThread({
          body: {
            session_id: conversationId,
            parent_message_id: threadSelection.message.id,
            selected_text: threadSelection.text,
          },
        }),
      );
      const existing = Array.isArray(threadSelection.message.threads) ? threadSelection.message.threads : [];
      threadSelection.message.threads = [...existing, thread];
      messageCacheRef.current[conversationId] = [...messages];
      setMessages([...messages]);
      setReasoningTarget(null);
      setSelectedRefs(null);
      setActiveThread(thread);
      window.getSelection()?.removeAllRanges();
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.chat.thread.createFailed')));
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
      setActiveThread((currentThread) =>
        currentThread?.thread_id === thread.thread_id
          ? { ...currentThread, ...payload, messages: history }
          : currentThread,
      );
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.chat.thread.loadFailed')));
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
    setActiveThread((thread) => (thread ? { ...thread, messages: [...(thread.messages || []), user, bot] } : thread));
    setThreadDraft('');
    setThreadSending(true);
    const abort = new AbortController();
    try {
      await runChatStream(
        {
          kind: 'thread',
          enableStreaming: streaming,
          message: [{ type: 'plain', text }],
          selectedModel: providerOverrideEnabled ? model : '',
          selectedProvider: providerOverrideEnabled ? provider : '',
          threadId,
        },
        abort.signal,
        {
          onPayload: (payload) => {
            if (appendStreamPayload(bot, payload, user)) {
              setActiveThread((thread) => (thread ? { ...thread, messages: [...(thread.messages || [])] } : thread));
            }
          },
        },
      );
    } catch (cause) {
      const message = errorMessage(cause, t('features.chat.thread.sendFailed'));
      bot.content.message.push({ type: 'plain', text: message });
      toast.error(message);
    } finally {
      bot.content.isLoading = false;
      setActiveThread((thread) => (thread ? { ...thread, messages: [...(thread.messages || [])] } : thread));
      setThreadSending(false);
    }
  };

  const removeThread = async () => {
    if (!activeThread || threadDeleting) return;
    if (
      !(await confirmAction({
        confirmLabel: t('core.common.delete'),
        danger: true,
        message: t('features.chat.thread.confirmDelete'),
        title: t('features.chat.thread.delete'),
      }))
    )
      return;
    setThreadDeleting(true);
    try {
      await deleteChatThread({ path: { thread_id: activeThread.thread_id } });
      messages.forEach((message) => {
        if (Array.isArray(message.threads)) {
          message.threads = message.threads.filter(
            (thread) => String((thread as JsonObject).thread_id) !== activeThread.thread_id,
          );
        }
      });
      if (conversationId) messageCacheRef.current[conversationId] = [...messages];
      setMessages([...messages]);
      setActiveThread(null);
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.chat.thread.deleteFailed')));
    } finally {
      setThreadDeleting(false);
    }
  };

  const scrollToMessage = (messageId: string | number) => {
    document.getElementById(`chat-message-${messageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const downloadMessagePart = async (part: ChatPart) => {
    const endpoint = part.attachment_id
      ? apiEndpoints.fileById(String(part.attachment_id))
      : part.stored_filename
        ? apiEndpoints.fileByName(String(part.stored_filename))
        : '';
    if (!endpoint) return;
    const response = await fetchWithAuth(endpoint).catch(() => null);
    if (!response?.ok) {
      toast.error(t('features.chat.attachment.downloadFailed'));
      return;
    }
    await downloadBlob(await response.blob(), String(part.filename || part.stored_filename || 'attachment'));
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
    const label =
      type === 'custom' ? t('features.chat.project.workspace.custom') : t('features.chat.project.workspace.project');
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
    { id: DEFAULT_CONFIG_ID, name: 'Default' },
    ...configs.flatMap((config, index) => {
      const id = recordId(config, 'id', 'conf_id') || `config-${index}`;
      return id === DEFAULT_CONFIG_ID
        ? []
        : [{ id, name: String(config.name || id), description: String(config.description || '') }];
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
  const sessionTitle =
    current?.display_name ||
    (selectedProject
      ? String(selectedProject.title || t('features.chat.project.title'))
      : t('features.chat.conversation.newConversation'));
  const modelTitle = provider || t('features.chat.models.default');
  const modelMeta = currentProvider?.model || model;
  const runnerConfigTitle = composerConfigs.find((config) => config.id === configId)?.name || configId;
  const emptyChat = !selectedProject && !loading && !messages.length;
  const composerNode = (
    <ChatComposer
      attachments={composerAttachments}
      commands={composerCommands}
      commandSuggestionsLabel={t('features.chat.commandSuggestion.label')}
      configs={composerConfigs}
      configId={configId}
      busy={uploading || configSaving || agentRunnerLoading}
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
      onRemoveAttachment={(attachment) =>
        setFiles((items) => {
          const removed = items.find((item) => item.attachment_id === attachment.id);
          revokeObjectUrl(removed?.preview_url);
          return items.filter((item) => item.attachment_id !== attachment.id);
        })
      }
      onSend={() => void send()}
      onStartRecording={() => void toggleRecording()}
      onStop={() => void stop()}
      onStopRecording={() => void toggleRecording()}
      onToggleStreaming={() => setStreaming((value) => !value)}
      placeholder={t('features.chat.input.placeholder')}
      ref={inputRef}
      replyTo={
        replyTarget?.id == null
          ? null
          : {
              messageId: replyTarget.id,
              selectedText: plainMessageText(replyTarget).slice(0, 80),
            }
      }
      sendShortcut="enter"
      streaming={streaming}
      tokenUsage={tokenUsage}
      value={draft}
      wakePrefixes={wakePrefixes}
    />
  );

  return (
    <div className={`chat-shell ${chatbox ? 'chat-shell--box' : ''} ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''}`}>
      <aside className={`chat-sessions ${sidebarOpen ? 'is-open' : ''}`}>
        <div className="chat-sessions__brand">
          <div className="chat-sessions__brand-title">
            <ChatLogo />
            <span>
              <strong>AstrBot</strong>
              <small>ChatUI</small>
            </span>
          </div>
          <button
            aria-label={t('features.chat.accessibility.toggleSidebar')}
            className="chat-sessions__collapse"
            onClick={() => setSidebarCollapsed((value) => !value)}
            title={t('features.chat.accessibility.toggleSidebar')}
            type="button"
          >
            <span className="chat-sessions__collapse-normal">
              <PanelLeftIcon />
            </span>
            <span className="chat-sessions__rail-stack">
              <ChatLogo />
              <PanelLeftIcon />
            </span>
          </button>
          <button
            aria-label={t('features.chat.accessibility.closeConversations')}
            className="chat-sessions__close"
            onClick={() => setSidebarOpen(false)}
            type="button"
          >
            <MdiIcon name="mdi-close" />
          </button>
        </div>
        <nav className="chat-sessions__actions">
          <Link title={t('features.chat.actions.providerConfig')} to={`${basePath}/models`}>
            <BoxIcon />
            <span>{t('features.chat.actions.providerConfig')}</span>
          </Link>
          <button onClick={newChat} title={t('features.chat.actions.newChat')} type="button">
            <SquarePenIcon />
            <span>{t('features.chat.actions.newChat')}</span>
          </button>
        </nav>
        <div className="chat-sessions__content">
          <section className="chat-project-list">
            <div className="chat-section-header">
              <span>{t('features.chat.project.title')}</span>
              <button
                aria-label={t('features.chat.project.create')}
                onClick={openCreateProject}
                title={t('features.chat.project.create')}
                type="button"
              >
                <PlusIcon />
              </button>
            </div>
            {projects.map((project, index) => {
              const projectId = recordId(project, 'project_id', 'id');
              const expanded = expandedProjectIds.has(projectId);
              return (
                <div className="chat-project-group" key={projectId || `project-${index}`}>
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
                      <button
                        aria-label={t('features.chat.project.edit')}
                        onClick={() => openEditProject(project)}
                        title={t('features.chat.project.edit')}
                        type="button"
                      >
                        <PencilIcon />
                      </button>
                      <button
                        aria-label={t('core.common.delete')}
                        disabled={!projectId || deletingProjectId === projectId}
                        onClick={() => void removeProject(project)}
                        title={t('core.common.delete')}
                        type="button"
                      >
                        <TrashIcon />
                      </button>
                    </span>
                  </div>
                  {expanded && (
                    <div className="chat-project-session-list">
                      {loadingProjectIds.has(projectId) ? (
                        <div className="chat-project-session-empty">{t('features.chat.project.loadingSessions')}</div>
                      ) : projectSessions[projectId]?.length ? (
                        projectSessions[projectId].map((session) => (
                          <div
                            className={`chat-project-session-row ${session.session_id === conversationId ? 'is-active' : ''}`}
                            key={session.session_id}
                          >
                            <button onClick={() => selectSession(session.session_id)} type="button">
                              {session.display_name?.trim() || t('features.chat.conversation.newConversation')}
                            </button>
                            <span onClick={(event) => event.stopPropagation()}>
                              <button
                                aria-label={t('features.chat.conversation.editDisplayName')}
                                onClick={() => void renameSession(session)}
                                title={t('features.chat.conversation.editDisplayName')}
                                type="button"
                              >
                                <PencilIcon />
                              </button>
                              <button
                                aria-label={t('features.chat.actions.deleteChat')}
                                onClick={() => void removeSession(session)}
                                title={t('features.chat.actions.deleteChat')}
                                type="button"
                              >
                                <TrashIcon />
                              </button>
                            </span>
                            {runningSessionIds.has(session.session_id) && (
                              <MdiIcon className="chat-project-session-progress" name="mdi-loading" />
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="chat-project-session-empty">{t('features.chat.project.noSessions')}</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
          <div className="chat-session-list">
            <div className="chat-session-list__label">{t('features.chat.conversation.title')}</div>
            {sessions.map((session) => (
              <div className={session.session_id === conversationId ? 'is-active' : ''} key={session.session_id}>
                <button onClick={() => selectSession(session.session_id)} type="button">
                  <span>{session.display_name || session.session_id}</span>
                  {runningSessionIds.has(session.session_id) && (
                    <MdiIcon className="chat-session-progress" name="mdi-loading" />
                  )}
                </button>
                <div>
                  <button
                    aria-label={t('features.chat.conversation.editDisplayName')}
                    onClick={() => void renameSession(session)}
                    title={t('features.chat.conversation.editDisplayName')}
                    type="button"
                  >
                    <PencilIcon />
                  </button>
                  <button
                    aria-label={t('features.chat.actions.deleteChat')}
                    onClick={() => void removeSession(session)}
                    title={t('features.chat.actions.deleteChat')}
                    type="button"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="chat-sessions__footer">
          <details
            className="chat-settings-menu"
            onToggle={(event) => {
              if (!event.currentTarget.open) setSettingsSubmenu(null);
            }}
            ref={settingsMenuRef}
          >
            <summary className="chat-sessions__settings">
              <MdiIcon name="mdi-cog-outline" />
              <span className="chat-sessions__settings-label">{t('core.common.settings')}</span>
            </summary>
            <div className="chat-settings-menu__panel">
              <div
                className="chat-settings-menu__item-wrap"
                onMouseEnter={() => openSettingsSubmenu('transport')}
                onMouseLeave={scheduleSettingsSubmenuClose}
              >
                <button
                  className={settingsSubmenu === 'transport' ? 'is-active' : ''}
                  onClick={() => setSettingsSubmenu((value) => (value === 'transport' ? null : 'transport'))}
                  type="button"
                >
                  <MdiIcon name="mdi-connection" />
                  <span>{t('features.chat.transport.title')}</span>
                  <small>{t(`features.chat.transport.${transportMode}`)}</small>
                  <MdiIcon name="mdi-chevron-right" />
                </button>
                {settingsSubmenu === 'transport' && (
                  <div
                    className="chat-settings-submenu"
                    onMouseEnter={() => openSettingsSubmenu('transport')}
                    onMouseLeave={scheduleSettingsSubmenuClose}
                  >
                    {(['sse', 'websocket'] as const).map((mode) => (
                      <button
                        className={transportMode === mode ? 'is-active' : ''}
                        key={mode}
                        onClick={() => {
                          setTransportMode(mode);
                          setSettingsSubmenu(null);
                        }}
                        type="button"
                      >
                        <span>{t(`features.chat.transport.${mode}`)}</span>
                        {transportMode === mode && <MdiIcon name="mdi-check" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div
                className="chat-settings-menu__item-wrap"
                onMouseEnter={() => openSettingsSubmenu('language')}
                onMouseLeave={scheduleSettingsSubmenuClose}
              >
                <button
                  className={settingsSubmenu === 'language' ? 'is-active' : ''}
                  onClick={() => setSettingsSubmenu((value) => (value === 'language' ? null : 'language'))}
                  type="button"
                >
                  <MdiIcon name="mdi-translate" />
                  <span>{t('core.common.language')}</span>
                  <small>{currentLanguage.label}</small>
                  <MdiIcon name="mdi-chevron-right" />
                </button>
                {settingsSubmenu === 'language' && (
                  <div
                    className="chat-settings-submenu chat-settings-submenu--language"
                    onMouseEnter={() => openSettingsSubmenu('language')}
                    onMouseLeave={scheduleSettingsSubmenuClose}
                  >
                    {localeRegistry.map((language) => (
                      <button
                        className={i18n.language === language.code ? 'is-active' : ''}
                        key={language.code}
                        onClick={() => {
                          void i18n.changeLanguage(language.code);
                          setSettingsSubmenu(null);
                        }}
                        type="button"
                      >
                        <small>{language.flag}</small>
                        <span>{language.label}</span>
                        {i18n.language === language.code && <MdiIcon name="mdi-check" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={toggleTheme} type="button">
                <MdiIcon name={isDark ? 'mdi-white-balance-sunny' : 'mdi-weather-night'} />
                <span>{t(`features.chat.modes.${isDark ? 'lightMode' : 'darkMode'}`)}</span>
              </button>
            </div>
          </details>
        </div>
      </aside>
      {sidebarOpen && (
        <button
          aria-label={t('features.chat.accessibility.closeConversations')}
          className="chat-sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          type="button"
        />
      )}
      <main
        className={`chat-main ${emptyChat && !isProviderWorkspace ? 'is-empty-chat' : ''} ${selectedProject ? 'is-project-workspace' : ''} ${isProviderWorkspace ? 'is-provider-workspace' : ''} ${reasoningTarget || selectedRefs || activeThread ? 'has-detail-panel' : ''}`}
      >
        <header className="chat-toolbar">
          <button
            aria-label={t('features.chat.accessibility.openConversations')}
            className="chat-toolbar__sidebar-open"
            onClick={() => setSidebarOpen(true)}
            type="button"
          >
            <MdiIcon name="mdi-menu" />
          </button>
          {providerOverrideEnabled ? (
            <details
              className="chat-model-menu"
              onToggle={(event) => {
                if (event.currentTarget.open) void loadProviders();
              }}
              ref={modelMenuRef}
            >
              <summary>
                <span>
                  <strong>{modelTitle}</strong>
                  {modelMeta && modelMeta !== modelTitle && <em>{modelMeta}</em>}
                  <MdiIcon name="mdi-chevron-down" />
                </span>
                <small>{sessionTitle}</small>
              </summary>
              <div className="chat-model-menu__panel">
                <label className="chat-model-search">
                  <MdiIcon name="mdi-magnify" />
                  <input
                    aria-label={t('features.chat.accessibility.searchModels')}
                    onChange={(event) => setProviderSearch(event.target.value)}
                    placeholder={t('features.chat.accessibility.searchModels')}
                    value={providerSearch}
                  />
                </label>
                <div className="chat-model-list">
                  {filteredProviders.map((item) => {
                    const selected = item.id === provider;
                    const metadata = providerMetadata[item.model];
                    return (
                      <div className={selected ? 'is-selected' : ''} key={item.id}>
                        <button className="chat-model-list__copy" onClick={() => selectProvider(item)} type="button">
                          <strong>{item.id}</strong>
                          <small>
                            <span>{item.model}</span>
                            <span className="chat-model-badges">
                              {providerCapabilityBadges(item, metadata).map((badge) => (
                                <span
                                  className={badge.enabled ? '' : 'is-disabled'}
                                  key={badge.key}
                                  title={t(
                                    `features.provider.models.metadata.${badge.enabled ? 'enabled' : 'supportedDisabled'}`,
                                    { capability: t(`features.provider.models.metadata.${badge.key}`) },
                                  )}
                                >
                                  <MdiIcon name={badge.icon} />
                                </span>
                              ))}
                              {formatContextLimit(item, metadata) && (
                                <b
                                  title={t('features.provider.models.metadata.context', {
                                    tokens: formatContextLimit(item, metadata),
                                  })}
                                >
                                  {formatContextLimit(item, metadata)}
                                </b>
                              )}
                            </span>
                          </small>
                        </button>
                        <span className="chat-model-list__actions">
                          <button
                            aria-label={t('features.provider.models.testButton')}
                            className={testingProvider === item.id ? 'is-loading' : ''}
                            disabled={Boolean(testingProvider)}
                            onClick={() => void testProvider(item)}
                            title={t('features.provider.models.testButton')}
                            type="button"
                          >
                            <MdiIcon name="mdi-connection" />
                          </button>
                          {selected && <MdiIcon name="mdi-check" />}
                        </span>
                      </div>
                    );
                  })}
                  {providersLoading && (
                    <div className="chat-model-list__empty">{t('features.chat.models.loading')}</div>
                  )}
                  {!providersLoading && !filteredProviders.length && (
                    <div className="chat-model-list__empty">{t('features.chat.actions.noAvailableModels')}</div>
                  )}
                </div>
              </div>
            </details>
          ) : (
            <div className="chat-model-menu chat-model-menu--runner">
              <span>
                <strong>{runnerConfigTitle}</strong>
              </span>
              <small>{sessionTitle}</small>
            </div>
          )}
        </header>
        {isProviderWorkspace ? (
          <section className="chat-provider-workspace">
            <ProviderPage />
          </section>
        ) : (
          <>
            <section
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
              {selectedProject && (
                <div className="chat-project-workspace">
                  <header className="chat-project-workspace__header">
                    <h1>
                      <span>{String(selectedProject.emoji || '📁')}</span>
                      {String(selectedProject.title || t('features.chat.project.title'))}
                    </h1>
                    {Boolean(selectedProject.description) && <p>{String(selectedProject.description)}</p>}
                    <small>
                      <MdiIcon name="mdi-folder-cog-outline" />
                      {selectedProjectWorkspace}
                    </small>
                  </header>
                  <div className="chat-project-composer">{composerNode}</div>
                  <div className="chat-project-workspace__sessions">
                    {loadingProjectIds.has(selectedProjectId) ? (
                      <div className="chat-project-workspace__empty">{t('features.chat.project.loadingSessions')}</div>
                    ) : selectedProjectSessions.length ? (
                      selectedProjectSessions.map((session) => (
                        <article className="chat-project-workspace__session" key={session.session_id}>
                          <button onClick={() => selectSession(session.session_id)} type="button">
                            <strong>
                              {session.display_name?.trim() || t('features.chat.conversation.newConversation')}
                            </strong>
                            <small>
                              {formatProjectSessionDate(session.updated_at || session.created_at, i18n.language)}
                            </small>
                          </button>
                          <div>
                            <button
                              aria-label={t('features.chat.conversation.editDisplayName')}
                              onClick={() => void renameSession(session)}
                              title={t('features.chat.conversation.editDisplayName')}
                              type="button"
                            >
                              <PencilIcon />
                            </button>
                            <button
                              aria-label={t('features.chat.actions.deleteChat')}
                              onClick={() => void removeSession(session)}
                              title={t('features.chat.actions.deleteChat')}
                              type="button"
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="chat-project-workspace__empty">
                        <MdiIcon name="mdi-message-outline" />
                        <span>{t('features.chat.project.noSessions')}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {emptyChat && !error && (
                <div className="chat-empty">
                  <h1>{t('features.chat.welcome.title')}</h1>
                </div>
              )}
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
                }}
                onEdit={openMessageEdit}
                onEditValueChange={setEditingDraft}
                onCancelEdit={() => setEditingMessage(null)}
                onDownload={(part) => downloadMessagePart(part)}
                onOpenImage={(url, part) =>
                  url &&
                  setImagePreview({
                    name: String(part.filename || part.stored_filename || t('features.chat.attachment.image')),
                    url,
                  })
                }
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
              {error && (
                <div className="monitor-error" role="alert">
                  {error}
                </div>
              )}
              <div ref={messageEnd} />
            </section>
            {!selectedProject && <footer className="chat-composer chat-composer--v2">{composerNode}</footer>}
          </>
        )}
        {threadSelection && (
          <button
            className="chat-thread-selection"
            onClick={() => void createThreadFromSelection()}
            style={{ left: threadSelection.left, top: threadSelection.top }}
            type="button"
          >
            {t('features.chat.thread.askInThread')}
          </button>
        )}
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
              >
                {t('core.common.cancel')}
              </button>
              <button
                className="button--primary"
                disabled={sessionTitleSaving || !sessionTitleDraft.trim()}
                onClick={() => void saveSessionTitle()}
                type="button"
              >
                {t('core.common.save')}
              </button>
            </div>
          </div>
        </Dialog>
        <ChatDetailPanels
          activeThread={activeThread}
          imagePreview={imagePreview}
          onCloseImage={() => setImagePreview(null)}
          onCloseReasoning={() => setReasoningTarget(null)}
          onCloseReferences={() => setSelectedRefs(null)}
          onCloseThread={() => setActiveThread(null)}
          onDeleteThread={() => void removeThread()}
          onDownload={(part) => downloadMessagePart(part)}
          onOpenImage={(url, part) =>
            url &&
            setImagePreview({
              name: String(part.filename || part.stored_filename || t('features.chat.attachment.image')),
              url,
            })
          }
          onSendThread={() => void sendThreadMessage()}
          onThreadDraftChange={setThreadDraft}
          reasoningTarget={reasoningTarget}
          referenceData={selectedRefs}
          resolvePartUrl={(part) => mediaUrlsRef.current[mediaPartKey(part)] || ''}
          threadDeleting={threadDeleting}
          threadDraft={threadDraft}
          threadMessagesRef={threadMessagesRef}
          threadSending={threadSending}
        />
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
    </div>
  );
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

function formatProjectSessionDate(value: unknown, locale: string) {
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
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
  const metadataModalities =
    isObject(modalities) && Array.isArray(modalities.input) ? modalities.input.map(String) : [];
  const enabledModalities = Array.isArray(provider.modalities) ? provider.modalities.map(String) : [];
  const definitions: Array<{ key: string; icon: `mdi-${string}`; supported: boolean; enabled: boolean }> = [
    {
      key: 'image',
      icon: 'mdi-image-outline',
      supported: metadataModalities.includes('image'),
      enabled: enabledModalities.includes('image'),
    },
    {
      key: 'audio',
      icon: 'mdi-music-note-outline',
      supported: metadataModalities.includes('audio'),
      enabled: enabledModalities.includes('audio'),
    },
    {
      key: 'toolUse',
      icon: 'mdi-wrench-outline',
      supported: Boolean(metadata?.tool_call),
      enabled: enabledModalities.includes('tool_use'),
    },
    {
      key: 'reasoning',
      icon: 'mdi-brain',
      supported: Boolean(metadata?.reasoning),
      enabled: Boolean(provider.reasoning),
    },
  ];
  return definitions
    .filter((item) => item.supported || item.enabled)
    .map((item) => ({ ...item, enabled: !metadata || item.enabled }));
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
    aliases
      .map(String)
      .filter(Boolean)
      .forEach((alias) => {
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
