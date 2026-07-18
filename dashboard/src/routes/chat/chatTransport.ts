import { fetchWithAuth } from '@/api/http';
import { readAuthToken } from '@/auth/storage';
import { apiEndpoints } from '@/config/endpoints';
import type { JsonObject } from '@/routes/configuration/model';

import type { ChatPart } from './model';

export type ChatTransportMode = 'sse' | 'websocket';

type ProviderSelection = {
  enableStreaming: boolean;
  selectedModel?: string;
  selectedProvider?: string;
};

export type ChatStreamAction =
  | (ProviderSelection & {
      configId?: string;
      kind: 'send';
      message: ChatPart[];
      messageId: string;
      sessionId: string;
      transport: ChatTransportMode;
    })
  | (ProviderSelection & {
      kind: 'regenerate';
      sessionId: string;
      targetMessageId: string;
    })
  | (ProviderSelection & {
      configId?: string;
      kind: 'continue';
      llmCheckpointId?: string;
      message: ChatPart[];
      sessionId: string;
    })
  | (ProviderSelection & {
      kind: 'thread';
      message: ChatPart[];
      threadId: string;
    });

export type ChatStreamCallbacks = {
  onAbort?: () => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
  onPayload: (payload: unknown) => void;
};

type WebSocketLike = {
  close: () => void;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onopen: ((event: Event) => void) | null;
  readyState: number;
  send: (data: string) => void;
};

const WEB_SOCKET_CONNECTING = 0;
const WEB_SOCKET_OPEN = 1;

export type ChatTransportDependencies = {
  fetch?: typeof fetch;
  location?: Pick<Location, 'host' | 'protocol'>;
  storage?: Storage | null;
  webSocket?: (url: string) => WebSocketLike;
};

export class ChatTransportError extends Error {
  readonly payload: unknown;
  readonly status: number;

  constructor(message: string, status: number, payload: unknown = null) {
    super(message);
    this.name = 'ChatTransportError';
    this.payload = payload;
    this.status = status;
  }
}

export function parseSseEvents(buffer: string, flush = false) {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const blocks = normalized.split('\n\n');
  const remainder = flush ? '' : blocks.pop() || '';
  const payloads: unknown[] = [];

  for (const block of blocks) {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) continue;
    try {
      payloads.push(JSON.parse(data));
    } catch {
      // Ignore non-JSON keepalive events.
    }
  }
  return { payloads, remainder };
}

export async function runChatStream(
  action: ChatStreamAction,
  signal: AbortSignal,
  callbacks: ChatStreamCallbacks,
  dependencies: ChatTransportDependencies = {},
) {
  try {
    if (action.kind === 'send' && action.transport === 'websocket') {
      await readWebSocketStream(action, signal, callbacks.onPayload, dependencies);
    } else {
      await readSseStream(action, signal, callbacks.onPayload, dependencies);
    }
    callbacks.onComplete?.();
  } catch (cause) {
    const error = normalizeError(cause);
    if (isAbort(error, signal)) callbacks.onAbort?.();
    else callbacks.onError?.(error);
    throw error;
  }
}

async function readSseStream(
  action: ChatStreamAction,
  signal: AbortSignal,
  onPayload: (payload: unknown) => void,
  dependencies: ChatTransportDependencies,
) {
  const request = sseRequest(action);
  const response = await fetchWithAuth(
    request.endpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.body),
      signal,
    },
    {
      fetch: dependencies.fetch,
      storage: dependencies.storage,
    },
  );

  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !response.body || !contentType.includes('text/event-stream')) {
    const payload = await readErrorPayload(response);
    const fallback = !response.ok
      ? `Chat stream request failed: ${response.status}`
      : 'Expected a text/event-stream response.';
    throw new ChatTransportError(errorPayloadMessage(payload, fallback), response.status, payload);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const cancelReader = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', cancelReader, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseEvents(buffer);
      buffer = parsed.remainder;
      parsed.payloads.forEach(onPayload);
    }
    if (signal.aborted) throw abortError();
    buffer += decoder.decode();
    parseSseEvents(buffer, true).payloads.forEach(onPayload);
  } finally {
    signal.removeEventListener('abort', cancelReader);
    reader.releaseLock();
  }
}

function sseRequest(action: ChatStreamAction) {
  const selection = {
    selected_provider: action.selectedProvider || undefined,
    selected_model: action.selectedModel || undefined,
    enable_streaming: action.enableStreaming,
  };
  switch (action.kind) {
    case 'send':
      return {
        endpoint: apiEndpoints.chat,
        body: {
          session_id: action.sessionId,
          message: action.message,
          config_id: action.configId || undefined,
          ...selection,
        },
      };
    case 'regenerate':
      return {
        endpoint: apiEndpoints.regenerateChatMessage(action.sessionId, action.targetMessageId),
        body: selection,
      };
    case 'continue':
      return {
        endpoint: apiEndpoints.chat,
        body: {
          session_id: action.sessionId,
          message: action.message,
          config_id: action.configId || undefined,
          ...selection,
          _skip_user_history: true,
          _llm_checkpoint_id: action.llmCheckpointId || undefined,
        },
      };
    case 'thread':
      return {
        endpoint: apiEndpoints.threadMessages(action.threadId),
        body: {
          message: action.message,
          ...selection,
        },
      };
  }
}

async function readWebSocketStream(
  action: Extract<ChatStreamAction, { kind: 'send' }>,
  signal: AbortSignal,
  onPayload: (payload: unknown) => void,
  dependencies: ChatTransportDependencies,
) {
  const storage =
    dependencies.storage === undefined
      ? typeof window === 'undefined'
        ? null
        : window.localStorage
      : dependencies.storage;
  const location = dependencies.location ?? window.location;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = readAuthToken(storage);
  const url = `${protocol}//${location.host}${apiEndpoints.unifiedChatWebSocket}?token=${encodeURIComponent(token || '')}`;
  const createSocket = dependencies.webSocket ?? ((socketUrl: string) => new WebSocket(socketUrl));
  const socket = createSocket(url);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', handleAbort);
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (socket.readyState === WEB_SOCKET_OPEN || socket.readyState === WEB_SOCKET_CONNECTING) socket.close();
      if (error) reject(error);
      else resolve();
    };
    const handleAbort = () => finish(abortError());

    if (signal.aborted) {
      finish(abortError());
      return;
    }
    signal.addEventListener('abort', handleAbort, { once: true });
    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          ct: 'chat',
          t: 'send',
          session_id: action.sessionId,
          message_id: action.messageId,
          message: action.message,
          config_id: action.configId || undefined,
          enable_streaming: action.enableStreaming,
          selected_provider: action.selectedProvider || undefined,
          selected_model: action.selectedModel || undefined,
        }),
      );
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as JsonObject;
        onPayload(payload);
        if (payload.type === 'end' || payload.t === 'end') finish();
      } catch {
        // Ignore non-JSON keepalive frames.
      }
    };
    socket.onerror = () => finish(new Error('WebSocket connection failed.'));
    socket.onclose = () => finish(signal.aborted ? abortError() : new Error('WebSocket connection closed.'));
  });
}

async function readErrorPayload(response: Response) {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorPayloadMessage(payload: unknown, fallback: string) {
  if (typeof payload === 'string' && payload) return payload;
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}

function abortError() {
  return new DOMException('The chat request was aborted.', 'AbortError');
}

function normalizeError(cause: unknown) {
  return cause instanceof Error ? cause : new Error(String(cause));
}

function isAbort(error: Error, signal: AbortSignal) {
  return signal.aborted || error.name === 'AbortError';
}
