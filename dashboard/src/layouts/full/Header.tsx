import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { MdiIcon } from '@/components/icons/MdiIcon';
import { useLayoutStore } from '@/stores/layout';

export function Header() {
  const { t } = useTranslation();
  const [mobile, setMobile] = useState(
    () => window.matchMedia?.('(max-width: 767px)').matches ?? window.innerWidth < 768,
  );
  const drawerOpen = useLayoutStore((state) => state.drawerOpen);
  const miniSidebar = useLayoutStore((state) => state.miniSidebar);
  const setDrawerOpen = useLayoutStore((state) => state.setDrawerOpen);
  const toggleDrawer = useLayoutStore((state) => state.toggleDrawer);
  const toggleMiniSidebar = useLayoutStore((state) => state.toggleMiniSidebar);

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

  return (
    <div className="app-header">
      <button
        aria-label={mobile ? t('core.header.buttons.openSidebar') : t('core.header.buttons.collapseSidebar')}
        aria-pressed={mobile ? drawerOpen : miniSidebar}
        className="app-header__icon-button"
        onClick={mobile ? toggleDrawer : toggleMiniSidebar}
        type="button"
      >
        <MdiIcon name="mdi-menu" />
      </button>
      <Link className="app-header__logo" to="/about">
        Astr<span>Bot</span>
      </Link>
      <div className="app-header__spacer" />
    </div>
  );
}
