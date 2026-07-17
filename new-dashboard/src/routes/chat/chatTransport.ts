import type { JsonObject } from '@/routes/configuration/model';

export type WebSocketChatOptions = {
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

export function readWebSocketChat(options: WebSocketChatOptions) {
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
