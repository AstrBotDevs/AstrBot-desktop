import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';

import { MdiIcon } from '@/components/icons/MdiIcon';

export function Footer() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const consoleActive = pathname === '/console';
  const consoleLabel = t('core.navigation.console');

  return (
    <div className="app-footer__items">
      <Link
        aria-label={consoleLabel}
        aria-current={consoleActive ? 'page' : undefined}
        className={`app-footer__item${consoleActive ? ' app-footer__item--active' : ''}`}
        data-tooltip={consoleLabel}
        to="/console"
      >
        <MdiIcon name="mdi-console" />
      </Link>
    </div>
  );
}
