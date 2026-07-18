import { type PointerEvent as ReactPointerEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';

import { MdiIcon } from '@/components/icons/MdiIcon';
import { ExpandCollapse } from '@/components/motion/ExpandCollapse';
import { listPlugins } from '@/api/openapi';
import { objectList, responseData } from '@/routes/configuration/model';
import { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, useLayoutStore } from '@/stores/layout';
import {
  buildPluginNavigation,
  mergePluginNavigation,
  navigationItemActive,
  navigationTargetActive,
  PLUGIN_SIDEBAR_CHANGED_EVENT,
  readNavigationItems,
  type NavigationItem,
} from './navigation';

function NavigationEntry({ item, mini }: { item: NavigationItem; mini: boolean }) {
  const { t } = useTranslation();
  const location = useLocation();
  const openedGroups = useLayoutStore((state) => state.openedGroups);
  const setOpenedGroups = useLayoutStore((state) => state.setOpenedGroups);
  const closeDrawer = useLayoutStore((state) => state.closeDrawer);
  const active = navigationTargetActive(item.to, location.pathname, location.hash);
  const groupActive = navigationItemActive(item, location.pathname, location.hash);
  const open = openedGroups.includes(item.title) || groupActive;

  if (item.children?.length) {
    return (
      <li className="sidebar-nav__group">
        <button
          aria-expanded={open}
          className={`sidebar-nav__item sidebar-nav__group-button${groupActive ? ' sidebar-nav__item--active' : ''}`}
          onClick={() =>
            setOpenedGroups(open ? openedGroups.filter((key) => key !== item.title) : [...openedGroups, item.title])
          }
          title={mini ? t(item.title) : undefined}
          type="button"
        >
          <span className="sidebar-nav__icon">
            <MdiIcon name={item.icon} />
          </span>
          {!mini && <span>{t(item.title)}</span>}
          {!mini && <MdiIcon className="sidebar-nav__chevron" name="mdi-chevron-down" />}
        </button>
        {!mini && (
          <ExpandCollapse className="sidebar-nav__children-motion" open={open}>
            <ul className="sidebar-nav__children">
              {item.children.map((child) => (
                <NavigationEntry item={child} key={child.title} mini={false} />
              ))}
            </ul>
          </ExpandCollapse>
        )}
      </li>
    );
  }

  return (
    <li>
      <Link
        aria-current={active ? 'page' : undefined}
        className={`sidebar-nav__item${active ? ' sidebar-nav__item--active' : ''}`}
        onClick={() => {
          if (window.innerWidth < 768) closeDrawer();
        }}
        title={mini ? t(item.title) : undefined}
        to={item.to ?? '/'}
      >
        <span className="sidebar-nav__icon">
          <MdiIcon name={item.icon} />
        </span>
        {!mini && <span>{t(item.title)}</span>}
      </Link>
    </li>
  );
}

export function Sidebar() {
  const { t } = useTranslation();
  const location = useLocation();
  const drawerOpen = useLayoutStore((state) => state.drawerOpen);
  const mini = useLayoutStore((state) => state.miniSidebar);
  const sidebarWidth = useLayoutStore((state) => state.sidebarWidth);
  const setSidebarWidth = useLayoutStore((state) => state.setSidebarWidth);
  const closeDrawer = useLayoutStore((state) => state.closeDrawer);
  const [baseItems, setBaseItems] = useState(readNavigationItems);
  const [pluginItem, setPluginItem] = useState<NavigationItem | null>(null);
  const [resizing, setResizing] = useState(false);
  const items = mergePluginNavigation(baseItems, pluginItem);

  useEffect(() => {
    const refresh = () => setBaseItems(readNavigationItems());
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'astrbot_sidebar_customization') refresh();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('sidebar-customization-changed', refresh);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('sidebar-customization-changed', refresh);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const apply = (items: unknown[]) => {
      if (active) setPluginItem(buildPluginNavigation(items));
    };
    const load = () => {
      void listPlugins({ query: { include_reserved: true } })
        .then((response) => apply(objectList(responseData(response), ['plugins', 'items', 'data', 'results'])))
        .catch(() => apply([]));
    };
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<unknown[]>).detail;
      if (Array.isArray(detail)) apply(detail);
      else load();
    };
    load();
    window.addEventListener(PLUGIN_SIDEBAR_CHANGED_EVENT, onChanged);
    return () => {
      active = false;
      window.removeEventListener(PLUGIN_SIDEBAR_CHANGED_EVENT, onChanged);
    };
  }, []);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    setResizing(true);
    document.body.classList.add('is-resizing-sidebar');
    const move = (pointerEvent: PointerEvent) => setSidebarWidth(startWidth + pointerEvent.clientX - startX);
    const stop = () => {
      setResizing(false);
      document.body.classList.remove('is-resizing-sidebar');
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', stop);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', stop);
  };

  if (!drawerOpen) return null;
  const width = mini ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;

  return (
    <>
      <button aria-label={t('core.common.close')} className="sidebar-backdrop" onClick={closeDrawer} type="button" />
      <nav
        aria-label={t('core.navigation.title')}
        className={`sidebar${mini ? ' sidebar--mini' : ''}`}
        style={{ width }}
      >
        <ul className="sidebar-nav">
          {items.map((item) => (
            <NavigationEntry item={item} key={item.title} mini={mini} />
          ))}
        </ul>
        {!mini && (
          <div className="sidebar-footer">
            <Link
              aria-current={location.pathname === '/settings' ? 'page' : undefined}
              className={location.pathname === '/settings' ? 'sidebar-nav__item--active' : undefined}
              to="/settings"
            >
              <MdiIcon name="mdi-cog" />
              {t('core.navigation.settings')}
            </Link>
          </div>
        )}
        {!mini && (
          <div
            aria-label={t('core.navigation.resize')}
            aria-orientation="vertical"
            aria-valuemax={SIDEBAR_MAX_WIDTH}
            aria-valuemin={SIDEBAR_MIN_WIDTH}
            aria-valuenow={sidebarWidth}
            className={`sidebar-resize-handle${resizing ? ' sidebar-resize-handle--active' : ''}`}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') setSidebarWidth(sidebarWidth - 10);
              else if (event.key === 'ArrowRight') setSidebarWidth(sidebarWidth + 10);
              else if (event.key === 'Home') setSidebarWidth(SIDEBAR_MIN_WIDTH);
              else if (event.key === 'End') setSidebarWidth(SIDEBAR_MAX_WIDTH);
            }}
            onPointerDown={startResize}
            role="separator"
            tabIndex={0}
          />
        )}
      </nav>
    </>
  );
}
