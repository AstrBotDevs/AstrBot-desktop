import type { PropsWithChildren, ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import ChatPage from '@/routes/chat/ChatPage';
import { Header } from './Header';
import { FirstNoticeDialog } from './FirstNoticeDialog';
import { Footer } from './Footer';
import { SettingsDialog } from './SettingsDialog';
import { Sidebar } from './Sidebar';

type FullLayoutProps = PropsWithChildren<{
  footer?: ReactNode;
  header?: ReactNode;
  sidebar?: ReactNode;
  workspace?: ReactNode;
}>;

export type FullLayoutMode = {
  isPluginPageRoute: boolean;
  isFullScreenRoute: boolean;
  isWorkspaceRoute: boolean;
};

export function getFullLayoutMode(pathname: string): FullLayoutMode {
  const isWorkspaceRoute = pathname === '/chat' || pathname.startsWith('/chat/');
  const isPluginPageRoute = pathname.startsWith('/plugin-page/');

  return {
    isPluginPageRoute,
    isFullScreenRoute: isWorkspaceRoute || isPluginPageRoute,
    isWorkspaceRoute,
  };
}

export function FullLayout({
  children,
  footer = <Footer />,
  header = <Header />,
  sidebar = <Sidebar />,
  workspace = <ChatPage layoutManaged />,
}: FullLayoutProps) {
  const { pathname } = useLocation();
  const mode = getFullLayoutMode(pathname);
  const flushTop = pathname === '/capabilities' || pathname === '/extension' || pathname === '/extension-marketplace';
  const showSidebar = sidebar != null;
  const layoutClassName = [
    'full-layout',
    !showSidebar && 'full-layout--without-sidebar',
  ]
    .filter(Boolean)
    .join(' ');
  const pageClassName = [
    'full-layout__page',
    mode.isFullScreenRoute && 'full-layout__page--fullscreen',
    mode.isPluginPageRoute && 'full-layout__page--plugin',
    flushTop && 'full-layout__page--flush-top',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={layoutClassName}
      data-layout="full"
      data-layout-mode={mode.isPluginPageRoute ? 'plugin' : mode.isWorkspaceRoute ? 'workspace' : 'standard'}
    >
      {header != null && <header className="full-layout__header">{header}</header>}
      {showSidebar && <aside className="full-layout__sidebar">{sidebar}</aside>}
      <main className="full-layout__main">
        <div className={pageClassName}>{children ?? <Outlet />}</div>
      </main>
      {footer != null && <footer className="full-layout__footer">{footer}</footer>}
      <SettingsDialog />
      <FirstNoticeDialog />
      {workspace}
    </div>
  );
}
