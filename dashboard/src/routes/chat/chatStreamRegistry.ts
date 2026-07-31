import type { ChatRecord } from './model';

type StreamListener = () => void;

const activeStreams = new Map<string, AbortController>();
const messageCache: Record<string, ChatRecord[]> = {};
const listeners = new Map<string, Set<StreamListener>>();

export const chatStreamRegistry = {
  activeStreams,
  messageCache,

  notify(sessionId: string) {
    listeners.get(sessionId)?.forEach((listener) => listener());
  },

  subscribe(sessionId: string, listener: StreamListener) {
    const sessionListeners = listeners.get(sessionId) ?? new Set<StreamListener>();
    sessionListeners.add(listener);
    listeners.set(sessionId, sessionListeners);
    listener();
    return () => {
      sessionListeners.delete(listener);
      if (!sessionListeners.size) listeners.delete(sessionId);
    };
  },
};

export function resetChatStreamRegistry() {
  activeStreams.forEach((controller) => controller.abort());
  activeStreams.clear();
  Object.keys(messageCache).forEach((sessionId) => delete messageCache[sessionId]);
  listeners.clear();
}
