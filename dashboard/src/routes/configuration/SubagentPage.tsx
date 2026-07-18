import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getSubagentConfig, updateSubagentConfig } from '@/api/openapi';
import { ConfigSpecialSelector, PersonaQuickPreview } from '@/components/config/ConfigSpecialControls';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { ExpandCollapse } from '@/components/motion/ExpandCollapse';
import { useUnsavedChangesGuard } from '@/components/ui/useUnsavedChangesGuard';
import { toast } from '@/stores/feedback';
import {
  EMPTY_SUBAGENT_CONFIG,
  newSubagent,
  normalizeSubagentConfig,
  serializeSubagentConfig,
  subagentPayload,
  validateSubagentConfig,
  type SubagentConfig,
  type SubagentItem,
} from './subagentModel';
import { errorMessage, responseData } from './model';

export default function SubagentPage() {
  const { t } = useTranslation();
  const prefix = 'features.subagent';
  const k = (key: string, values?: Record<string, unknown>) => t(`${prefix}.${key}`, values);
  const keyCounter = useRef(0);
  const createKey = useCallback(() => `${Date.now()}_${keyCounter.current++}`, []);
  const [config, setConfig] = useState<SubagentConfig>(EMPTY_SUBAGENT_CONFIG);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set<string>());

  const snapshot = useMemo(() => serializeSubagentConfig(config), [config]);
  const hasUnsavedChanges = loaded && snapshot !== savedSnapshot;
  const confirmDiscard = useUnsavedChangesGuard(hasUnsavedChanges, {
    title: k('page.title'),
    message: k('messages.unsavedChangesLeaveConfirm'),
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const configResponse = await getSubagentConfig();
      const next = normalizeSubagentConfig(responseData(configResponse), createKey);
      setConfig(next);
      setSavedSnapshot(serializeSubagentConfig(next));
      setExpanded(new Set());
      setLoaded(true);
    } catch (cause) {
      toast.error(errorMessage(cause, k('messages.loadConfigFailed')));
    } finally {
      setLoading(false);
    }
  }, [createKey, t]);

  useEffect(() => {
    void load();
  }, [load]);
  const reload = async () => {
    if (!(await confirmDiscard())) return;
    await load();
  };
  const save = async () => {
    const validation = validateSubagentConfig(config);
    if (validation) {
      toast.warning(k(`messages.${validation.key}`, validation.values));
      return;
    }
    setSaving(true);
    try {
      await updateSubagentConfig({ body: subagentPayload(config) });
      setSavedSnapshot(serializeSubagentConfig(config));
      setLoaded(true);
      toast.success(k('messages.saveSuccess'));
    } catch (cause) {
      toast.error(errorMessage(cause, k('messages.saveFailed')));
    } finally {
      setSaving(false);
    }
  };
  const addAgent = () => {
    const agent = newSubagent(createKey());
    setConfig((current) => ({ ...current, agents: [...current.agents, agent] }));
    setExpanded((current) => {
      const next = new Set(current);
      next.delete(agent.key);
      return next;
    });
  };
  const updateAgent = <Key extends keyof SubagentItem>(index: number, key: Key, value: SubagentItem[Key]) => {
    setConfig((current) => ({
      ...current,
      agents: current.agents.map((agent, agentIndex) => (agentIndex === index ? { ...agent, [key]: value } : agent)),
    }));
  };
  const removeAgent = (index: number) => {
    const removed = config.agents[index];
    setConfig((current) => ({ ...current, agents: current.agents.filter((_, agentIndex) => agentIndex !== index) }));
    if (removed)
      setExpanded((current) => {
        const next = new Set(current);
        next.delete(removed.key);
        return next;
      });
  };
  const toggleExpanded = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="subagent-page-react">
      <div className="subagent-page-react__inner">
        <header className="subagent-header">
          <div>
            <div>
              <h1>{k('page.title')}</h1>
              <span>{k('page.beta')}</span>
            </div>
            <p>{k('page.subtitle')}</p>
          </div>
          <div>
            <button disabled={loading} onClick={() => void reload()} type="button">
              <MdiIcon className={loading ? 'mdi-spin' : ''} name="mdi-refresh" />
              {k('actions.refresh')}
            </button>
            <button className="button--primary" disabled={saving} onClick={() => void save()} type="button">
              <MdiIcon className={saving ? 'mdi-spin' : ''} name={saving ? 'mdi-loading' : 'mdi-content-save'} />
              {k('actions.save')}
            </button>
          </div>
        </header>
        {hasUnsavedChanges && (
          <div className="subagent-unsaved" role="status">
            <MdiIcon name="mdi-alert-circle-outline" />
            {k('messages.unsavedChangesNotice')}
          </div>
        )}
        <section className="subagent-section-head">
          <div>
            <h2>{k('section.globalSettings')}</h2>
            <p>{k(config.mainEnable ? 'description.enabled' : 'description.disabled')}</p>
          </div>
        </section>
        <div className="subagent-global-grid">
          <SettingCard
            checked={config.mainEnable}
            description={k('switches.enableHint')}
            onChange={(checked) => setConfig((current) => ({ ...current, mainEnable: checked }))}
            title={k('switches.enable')}
          />
          <SettingCard
            checked={config.removeMainDuplicateTools}
            description={k('switches.dedupeHint')}
            disabled={!config.mainEnable}
            onChange={(checked) => setConfig((current) => ({ ...current, removeMainDuplicateTools: checked }))}
            title={k('switches.dedupe')}
          />
        </div>
        <section className="subagent-section-head subagent-section-head--agents">
          <div>
            <h2>{k('section.title')}</h2>
            <p>{k('section.subtitle')}</p>
          </div>
          <div>
            <span>
              <MdiIcon name="mdi-robot-outline" />
              {config.agents.length}
            </span>
            <button className="button--primary" onClick={addAgent} type="button">
              <MdiIcon name="mdi-plus" />
              {k('actions.add')}
            </button>
          </div>
        </section>
        {config.agents.length === 0 ? (
          <section className="subagent-empty">
            <MdiIcon name="mdi-robot-off" />
            <h2>{k('empty.title')}</h2>
            <p>{k('empty.subtitle')}</p>
            <button className="button--primary" onClick={addAgent} type="button">
              {k('empty.action')}
            </button>
          </section>
        ) : (
          <div className="subagent-list-react">
            {config.agents.map((agent, index) => {
              const isExpanded = expanded.has(agent.key);
              return (
                <article className="subagent-card" key={agent.key}>
                  <header>
                    <div className="subagent-card__summary">
                      <span className={agent.enabled ? 'is-enabled' : ''} />
                      <div>
                        <div>
                          <h2>{agent.name || k('cards.unnamed')}</h2>
                          <em className={agent.enabled ? 'is-enabled' : ''}>
                            {k(agent.enabled ? 'cards.statusEnabled' : 'cards.statusDisabled')}
                          </em>
                        </div>
                        <p>{agent.publicDescription || k('cards.noDescription')}</p>
                      </div>
                    </div>
                    <div className="subagent-card__actions">
                      <button aria-expanded={isExpanded} onClick={() => toggleExpanded(agent.key)} type="button">
                        {k(isExpanded ? 'actions.collapse' : 'actions.expand')}
                        <MdiIcon name="mdi-chevron-down" />
                      </button>
                      <label className="cron-switch" title={k('cards.switchLabel')}>
                        <input
                          checked={agent.enabled}
                          onChange={(event) => updateAgent(index, 'enabled', event.target.checked)}
                          type="checkbox"
                        />
                        <span />
                      </label>
                      <button
                        className="button--danger"
                        onClick={() => removeAgent(index)}
                        title={k('actions.delete')}
                        type="button"
                      >
                        <MdiIcon name="mdi-delete-outline" />
                      </button>
                    </div>
                  </header>
                  <ExpandCollapse className="subagent-card__editor-motion" open={isExpanded}>
                    <div className="subagent-card__editor">
                      <section>
                        <h3>{k('section.agentSetup')}</h3>
                        <div className="subagent-form">
                          <label className="subagent-outlined-field">
                            <span>{k('form.nameLabel')}</span>
                            <input
                              aria-invalid={Boolean(agent.name && !/^[a-z][a-z0-9_]{0,63}$/.test(agent.name))}
                              onChange={(event) => updateAgent(index, 'name', event.target.value)}
                              value={agent.name}
                            />
                          </label>
                          <div className="subagent-selector-wrap">
                            <span>{k('form.providerLabel')}</span>
                            <div>
                              <ConfigSpecialSelector
                                onChange={(value) =>
                                  updateAgent(
                                    index,
                                    'providerId',
                                    typeof value === 'string' && value ? value : undefined,
                                  )
                                }
                                special="select_provider"
                                value={agent.providerId || ''}
                              />
                            </div>
                          </div>
                          <div className="subagent-selector-wrap">
                            <span>{k('form.personaLabel')}</span>
                            <div>
                              <ConfigSpecialSelector
                                onChange={(value) =>
                                  updateAgent(index, 'personaId', typeof value === 'string' ? value : '')
                                }
                                special="select_persona"
                                value={agent.personaId}
                              />
                            </div>
                          </div>
                          <label className="subagent-outlined-field">
                            <span>{k('form.descriptionLabel')}</span>
                            <textarea
                              onChange={(event) => updateAgent(index, 'publicDescription', event.target.value)}
                              rows={4}
                              value={agent.publicDescription}
                            />
                          </label>
                        </div>
                      </section>
                      <section className="subagent-persona-preview">
                        <h3>{k('cards.personaPreview')}</h3>
                        <p>{k('cards.previewHint')}</p>
                        <div className="subagent-persona-preview__body">
                          <PersonaQuickPreview personaId={agent.personaId} />
                        </div>
                      </section>
                    </div>
                  </ExpandCollapse>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SettingCard({
  checked,
  description,
  disabled,
  onChange,
  title,
}: {
  checked: boolean;
  description: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  title: string;
}) {
  return (
    <section className={disabled ? 'is-disabled' : ''}>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <label className="cron-switch">
        <input
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
        <span />
      </label>
    </section>
  );
}
