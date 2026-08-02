import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import { MdiIcon } from '@/components/icons/MdiIcon';
import CronPage from '@/routes/configuration/CronPage';
import PersonaPage from '@/routes/configuration/PersonaPage';
import SubagentPage from '@/routes/configuration/SubagentPage';
import ExtensionPage from '@/routes/extensions/ExtensionPage';
import KnowledgeBaseListPage from '@/routes/knowledge/KnowledgeBaseListPage';
import { isExtensionCapabilityTab, resolveCapabilityTab, type CapabilityTab } from './capabilityCenterModel';

const capabilityTabs: Array<{
  icon: `mdi-${string}`;
  id: CapabilityTab;
  label: string;
}> = [
  { id: 'installed', icon: 'mdi-puzzle', label: 'features.extension.tabs.installedPlugins' },
  { id: 'market', icon: 'mdi-store', label: 'features.extension.tabs.market' },
  { id: 'components', icon: 'mdi-tune-variant', label: 'features.extension.tabs.handlersOperation' },
  { id: 'mcp', icon: 'mdi-server', label: 'features.extension.tabs.installedMcpServers' },
  { id: 'skills', icon: 'mdi-lightning-bolt', label: 'features.extension.tabs.skills' },
  { id: 'knowledge-base', icon: 'mdi-book-open-variant', label: 'core.navigation.knowledgeBase' },
  { id: 'persona', icon: 'mdi-heart', label: 'core.navigation.persona' },
  { id: 'subagent', icon: 'mdi-vector-link', label: 'core.navigation.subagent' },
  { id: 'cron', icon: 'mdi-clock-outline', label: 'core.navigation.cron' },
];

export default function CapabilityCenterPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = resolveCapabilityTab(location.hash);

  return (
    <div className="capability-center-page">
      <nav aria-label={t('core.navigation.capabilityCenter')} className="capability-center-tabs">
        {capabilityTabs.map((tab) => (
          <button
            aria-pressed={activeTab === tab.id}
            key={tab.id}
            onClick={() => void navigate(`/capabilities#${tab.id}`)}
            type="button"
          >
            <MdiIcon name={tab.icon} />
            {t(tab.label)}
          </button>
        ))}
      </nav>
      <section className="capability-center-content">
        {isExtensionCapabilityTab(activeTab) && <ExtensionPage embedded />}
        {activeTab === 'knowledge-base' && <KnowledgeBaseListPage />}
        {activeTab === 'persona' && <PersonaPage />}
        {activeTab === 'subagent' && <SubagentPage />}
        {activeTab === 'cron' && <CronPage />}
      </section>
    </div>
  );
}
