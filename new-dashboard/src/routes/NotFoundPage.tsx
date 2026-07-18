import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <main className="not-found">
      <p className="not-found__code">404</p>
      <h1>{t('core.common.notFound')}</h1>
      <Link to="/dashboard/default">{t('core.common.backHome')}</Link>
    </main>
  );
}
