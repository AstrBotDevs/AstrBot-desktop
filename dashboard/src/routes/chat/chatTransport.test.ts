import { describe, expect, it, vi } from 'vitest';

import { ChatTransportError, type ChatStreamAction, runChatStream } from './chatTransport';

const encoder = new TextEncoder();

function streamResponse(chunks: string[], contentType = 'text/event-stream') {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    }),
    {
      headers: { 'Content-Type': contentType },
    },
  );
}

function storage(values: Record<string, string>): Storage {
  return {
    get length() {
      return Object.keys(values).length;
    },
    clear: () => undefined,
    getItem: (key) => values[key] ?? null,
    key: (index) => Object.keys(values)[index] ?? null,
    removeItem: (key) => {
      delete values[key];
    },
    setItem: (key, value) => {
      values[key] = value;
    },
  };
}

const sendAction: ChatStreamAction = {
  kind: 'send',
  configId: 'default',
  enableStreaming: true,
  message: [{ type: 'plain', text: 'hello' }],
  messageId: 'message-1',
  selectedModel: 'model-1',
  selectedProvider: 'provider-1',
  sessionId: 'session-1',
  transport: 'sse',
};

describe('chat transport', () => {
  it('parses split SSE frames and flushes a final frame without a delimiter', async () => {
    const payloads: unknown[] = [];
    const onComplete = vi.fn();
    let capturedEndpoint = '';
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedEndpoint = String(input);
      capturedInit = init;
      return streamResponse(['data: {"type":"plain","data":"hel', 'lo"}\r\n\r\ndata: {"type":"end"}']);
    });

    await runChatStream(
      sendAction,
      new AbortController().signal,
      {
        onComplete,
        onPayload: (payload) => payloads.push(payload),
      },
      {
        fetch: fetchMock as typeof fetch,
        storage: storage({ 'astrbot-locale': 'zh-CN', token: 'secret' }),
      },
    );

    expect(payloads).toEqual([{ type: 'plain', data: 'hello' }, { type: 'end' }]);
    expect(onComplete).toHaveBeenCalledOnce();
    expect(capturedEndpoint).toBe('/api/v1/chat');
    expect(new Headers(capturedInit?.headers).get('Authorization')).toBe('Bearer secret');
    expect(new Headers(capturedInit?.headers).get('Accept-Language')).toBe('zh-CN');
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
      config_id: 'default',
      enable_streaming: true,
      session_id: 'session-1',
    });
  });

  it('maps every SSE action to the shared executor without mixing concurrent payloads', async () => {
    const requests: Array<{ endpoint: string; body: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const endpoint = String(input);
      requests.push({ endpoint, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return streamResponse([`data: ${JSON.stringify({ endpoint })}\n\n`]);
    });
    const controller = new AbortController();
    const regenerated: unknown[] = [];
    const continued: unknown[] = [];
    const threaded: unknown[] = [];

    await Promise.all([
      runChatStream(
        {
          kind: 'regenerate',
          enableStreaming: false,
          sessionId: 'session / 2',
          targetMessageId: 'message / 2',
        },
        controller.signal,
        { onPayload: (payload) => regenerated.push(payload) },
        { fetch: fetchMock as typeof fetch },
      ),
      runChatStream(
        {
          kind: 'continue',
          configId: 'profile',
          enableStreaming: true,
          llmCheckpointId: 'checkpoint',
          message: [{ type: 'plain', text: 'continue' }],
          sessionId: 'session-3',
        },
        controller.signal,
        { onPayload: (payload) => continued.push(payload) },
        { fetch: fetchMock as typeof fetch },
      ),
      runChatStream(
        {
          kind: 'thread',
          enableStreaming: true,
          message: [{ type: 'plain', text: 'thread' }],
          threadId: 'thread / 4',
        },
        controller.signal,
        { onPayload: (payload) => threaded.push(payload) },
        { fetch: fetchMock as typeof fetch },
      ),
    ]);

    expect(requests.map((request) => request.endpoint)).toEqual(
      expect.arrayContaining([
        '/api/v1/chat/sessions/session%20%2F%202/messages/message%20%2F%202/regenerate',
        '/api/v1/chat',
        '/api/v1/chat/threads/thread%20%2F%204/messages',
      ]),
    );
    expect(requests.find((request) => request.body._skip_user_history)?.body).toMatchObject({
      _llm_checkpoint_id: 'checkpoint',
      config_id: 'profile',
      session_id: 'session-3',
    });
    expect(regenerated).toHaveLength(1);
    expect(continued).toHaveLength(1);
    expect(threaded).toHaveLength(1);
  });

  it('maps non-SSE responses to a transport error and emits the error event', async () => {
    const onError = vi.fn();
    const response = new Response(JSON.stringify({ message: 'stream unavailable' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 503,
    });

    await expect(
      runChatStream(
        sendAction,
        new AbortController().signal,
        {
          onError,
          onPayload: vi.fn(),
        },
        {
          fetch: vi.fn(async () => response) as typeof fetch,
        },
      ),
    ).rejects.toMatchObject({
      message: 'stream unavailable',
      status: 503,
    });
    expect(onError).toHaveBeenCalledWith(expect.any(ChatTransportError));
  });

  it('cancels an active reader and emits abort without reporting an error', async () => {
    let streamCancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          streamCancelled = true;
        },
      }),
      {
        headers: { 'Content-Type': 'text/event-stream' },
      },
    );
    const controller = new AbortController();
    const onAbort = vi.fn();
    const onError = vi.fn();
    const running = runChatStream(
      sendAction,
      controller.signal,
      {
        onAbort,
        onError,
        onPayload: vi.fn(),
      },
      {
        fetch: vi.fn(async () => response) as typeof fetch,
      },
    );

    await Promise.resolve();
    await Promise.resolve();
    controller.abort();

    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(streamCancelled).toBe(true);
    expect(onAbort).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports an interrupted response stream through the shared error event', async () => {
    const onError = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error('connection reset'));
        },
      }),
      {
        headers: { 'Content-Type': 'text/event-stream' },
      },
    );

    await expect(
      runChatStream(
        sendAction,
        new AbortController().signal,
        {
          onError,
          onPayload: vi.fn(),
        },
        {
          fetch: vi.fn(async () => response) as typeof fetch,
        },
      ),
    ).rejects.toThrow('connection reset');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'connection reset' }));
  });

  it('builds the authenticated WebSocket URL and emits payload and completion events', async () => {
    let socketUrl = '';
    let sent = '';
    let socket: {
      close: () => void;
      onclose: ((event: CloseEvent) => void) | null;
      onerror: ((event: Event) => void) | null;
      onmessage: ((event: MessageEvent) => void) | null;
      onopen: ((event: Event) => void) | null;
      readyState: number;
      send: (data: string) => void;
    };
    const payloads: unknown[] = [];
    const onComplete = vi.fn();

    await runChatStream(
      { ...sendAction, transport: 'websocket' },
      new AbortController().signal,
      {
        onComplete,
        onPayload: (payload) => payloads.push(payload),
      },
      {
        location: { host: 'astrbot.local', protocol: 'https:' },
        storage: storage({ token: 'secret token' }),
        webSocket: (url) => {
          socketUrl = url;
          socket = {
            close: vi.fn(),
            onclose: null,
            onerror: null,
            onmessage: null,
            onopen: null,
            readyState: 0,
            send: (data) => {
              sent = data;
            },
          };
          queueMicrotask(() => {
            socket.readyState = 1;
            socket.onopen?.(new Event('open'));
            socket.onmessage?.(new MessageEvent('message', { data: '{"type":"plain","data":"ok"}' }));
            socket.onmessage?.(new MessageEvent('message', { data: '{"type":"end"}' }));
          });
          return socket;
        },
      },
    );

    expect(socketUrl).toBe('wss://astrbot.local/api/v1/unified-chat/ws?token=secret%20token');
    expect(JSON.parse(sent)).toMatchObject({
      message_id: 'message-1',
      session_id: 'session-1',
      t: 'send',
    });
    expect(payloads).toEqual([{ type: 'plain', data: 'ok' }, { type: 'end' }]);
    expect(onComplete).toHaveBeenCalledOnce();
  });
});
