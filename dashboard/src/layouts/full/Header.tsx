import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { MdiIcon } from '@/components/icons/MdiIcon';
import { useLayoutStore } from '@/stores/layout';
import { getModeSwitchTarget, LAST_BOT_ROUTE_KEY, LAST_CHAT_ROUTE_KEY } from './headerModel';

export function Header() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobile, setMobile] = useState(
    () => window.matchMedia?.('(max-width: 767px)').matches ?? window.innerWidth < 768,
  );
  const drawerOpen = useLayoutStore((state) => state.drawerOpen);
  const chatSidebarOpen = useLayoutStore((state) => state.chatSidebarOpen);
  const miniSidebar = useLayoutStore((state) => state.miniSidebar);
  const setDrawerOpen = useLayoutStore((state) => state.setDrawerOpen);
  const toggleDrawer = useLayoutStore((state) => state.toggleDrawer);
  const toggleChatSidebar = useLayoutStore((state) => state.toggleChatSidebar);
  const toggleMiniSidebar = useLayoutStore((state) => state.toggleMiniSidebar);
  const isChat = location.pathname === '/chat' || location.pathname.startsWith('/chat/');

  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 767px)');
    const updateViewport = (nextMobile: boolean) => {
      setMobile((wasMobile) => {
        if (wasMobile !== nextMobile) setDrawerOpen(!nextMobile);
        return nextMobile;
      });
    };
    if (media) {
      const handleChange = (event: MediaQueryListEvent) => updateViewport(event.matches);
      updateViewport(media.matches);
      media.addEventListener('change', handleChange);
      return () => media.removeEventListener('change', handleChange);
    }
    const handleResize = () => updateViewport(window.innerWidth < 768);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [setDrawerOpen]);

  useEffect(() => {
    if (isChat) {
      const conversationId = location.pathname.split('/')[2];
      if (conversationId) sessionStorage.setItem(LAST_CHAT_ROUTE_KEY, conversationId);
    } else {
      sessionStorage.setItem(LAST_BOT_ROUTE_KEY, `${location.pathname}${location.search}${location.hash}`);
    }
  }, [isChat, location.hash, location.pathname, location.search]);

  return (
    <div className={`app-header${isChat ? ' app-header--chat' : ''}`}>
      {!isChat && (
        <button
          aria-label={mobile ? t('core.header.buttons.openSidebar') : t('core.header.buttons.collapseSidebar')}
          aria-pressed={mobile ? drawerOpen : miniSidebar}
          className="app-header__icon-button"
          onClick={mobile ? toggleDrawer : toggleMiniSidebar}
          type="button"
        >
          <MdiIcon name="mdi-menu" />
        </button>
      )}
      {!isChat && (
        <Link className="app-header__logo" to="/about">
          Astr<span>Bot</span>
        </Link>
      )}
      {isChat && mobile && (
        <button
          aria-label={t('core.header.buttons.openSidebar')}
          aria-pressed={chatSidebarOpen}
          className="app-header__icon-button"
          onClick={toggleChatSidebar}
          type="button"
        >
          <MdiIcon name={chatSidebarOpen ? 'mdi-chevron-left' : 'mdi-chevron-right'} />
        </button>
      )}
      <div className="app-header__spacer" />
      <button
        className="app-header__mode-switch"
        onClick={() => navigate(getModeSwitchTarget(location.pathname, sessionStorage))}
        type="button"
      >
        <MdiIcon name={isChat ? 'mdi-robot' : 'mdi-chat'} />
        {isChat ? 'Bot' : 'Chat'}
      </button>
    </div>
  );
}
