import { sessionStorageKeys } from '@/config/storageKeys';

export const LAST_BOT_ROUTE_KEY = sessionStorageKeys.lastBotRoute;
export const LAST_CHAT_ROUTE_KEY = sessionStorageKeys.lastChatRoute;

export function headerUpdateRuntime(isDesktop: boolean) {
  return isDesktop ? 'desktop' : 'web';
}

export async function runHeaderUpdateAction(
  isDesktop: boolean,
  desktopAction: () => Promise<unknown>,
  webAction: () => Promise<unknown>,
) {
  return headerUpdateRuntime(isDesktop) === 'desktop' ? desktopAction() : webAction();
}

export function getModeSwitchTarget(pathname: string, storage: Pick<Storage, 'getItem'>) {
  if (pathname === '/chat' || pathname.startsWith('/chat/')) {
    const lastBotRoute = storage.getItem(LAST_BOT_ROUTE_KEY) || '/';
    return lastBotRoute.startsWith('/chat') ? '/' : lastBotRoute;
  }
  const lastChatId = storage.getItem(LAST_CHAT_ROUTE_KEY);
  return lastChatId ? `/chat/${lastChatId}` : '/chat';
}
