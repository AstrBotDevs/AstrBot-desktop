import { useTranslation } from 'react-i18next';

import { externalLinks } from '@/config/links';
import { useDesktop } from '@/desktop/DesktopProvider';

export default function AboutPage() {
  const { t } = useTranslation();
  const { openExternalUrl } = useDesktop();
  const prefix = 'features.about.hero';
  return (
    <div className="about-page route-page">
      <section className="about-hero">
        <h1>{t(`${prefix}.title`)}</h1>
        <p>{t(`${prefix}.subtitle`)}</p>
        <div className="about-hero__actions">
          <button
            className="button--primary"
            onClick={() => void openExternalUrl(externalLinks.project.repository)}
            type="button"
          >
            {t(`${prefix}.starButton`)}
          </button>
          <button onClick={() => void openExternalUrl(externalLinks.project.issues)} type="button">
            {t(`${prefix}.issueButton`)}
          </button>
        </div>
      </section>
    </div>
  );
}
