import type { PropsWithChildren, ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { Header } from './Header';
import { FirstNoticeDialog } from './FirstNoticeDialog';
import { Sidebar } from './Sidebar';

type FullLayoutProps = PropsWithChildren<{
  header?: ReactNode;
  sidebar?: ReactNode;
}>;

export type FullLayoutMode = {
  isChatRoute: boolean;
  isConsoleRoute: boolean;
  isPluginPageRoute: boolean;
  isFullScreenRoute: boolean;
};

export function getFullLayoutMode(pathname: string): FullLayoutMode {
  const isChatRoute = pathname === '/chat' || pathname.startsWith('/chat/');
  const isConsoleRoute = pathname === '/console';
  const isPluginPageRoute = pathname.startsWith('/plugin-page/');

  return {
    isChatRoute,
    isConsoleRoute,
    isPluginPageRoute,
    isFullScreenRoute: isChatRoute || isPluginPageRoute,
  };
}

export function FullLayout({ children, header = <Header />, sidebar = <Sidebar /> }: FullLayoutProps) {
  const { pathname } = useLocation();
  const mode = getFullLayoutMode(pathname);
  const isVisualConfigRoute = pathname === '/config';
  const showSidebar = !mode.isChatRoute && sidebar != null;
  const layoutClassName = [
    'full-layout',
    !showSidebar && 'full-layout--without-sidebar',
    mode.isChatRoute && 'full-layout--chat',
    mode.isConsoleRoute && 'full-layout--console',
    isVisualConfigRoute && 'full-layout--visual-config',
  ]
    .filter(Boolean)
    .join(' ');
  const pageClassName = [
    'full-layout__page',
    mode.isFullScreenRoute && 'full-layout__page--fullscreen',
    mode.isConsoleRoute && 'full-layout__page--console',
    mode.isPluginPageRoute && 'full-layout__page--plugin',
    isVisualConfigRoute && 'full-layout__page--visual-config',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={layoutClassName}
      data-layout="full"
      data-layout-mode={
        mode.isChatRoute ? 'chat' : mode.isConsoleRoute ? 'console' : mode.isPluginPageRoute ? 'plugin' : 'standard'
      }
    >
      {header != null && <header className="full-layout__header">{header}</header>}
      {showSidebar && <aside className="full-layout__sidebar">{sidebar}</aside>}
      <main className="full-layout__main">
        <div className={pageClassName}>{children ?? <Outlet />}</div>
      </main>
      <FirstNoticeDialog />
    </div>
  );
}
