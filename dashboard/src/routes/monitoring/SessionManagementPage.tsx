import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  batchUpdateSessionProvider,
  batchUpdateSessionService,
  createSessionGroup,
  deleteSessionGroup,
  deleteSessionRules,
  listActiveUmos,
  listSessionGroups,
  listSessionRules,
  updateSessionGroup,
  upsertSessionRule,
} from '@/api/openapi';
import { decodeApiData } from '@/api/response';
import { externalLinks } from '@/config/links';
import { paginationDefaults } from '@/config/defaults';
import { Dialog, DialogClose } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { confirmAction, toast } from '@/stores/feedback';
import { EditorSection, MultiSelect, ProviderSelect, TransferList, UmoDisplay } from './SessionManagementControls';
import {
  FOLLOW_CONFIG_VALUE,
  initialSessionEditor as initialEditor,
  parseUmo,
  parseActiveUmos,
  parseSessionGroups,
  parseSessionRulesData,
  sessionRecordValue as recordValue,
  sessionDisplayName as displayName,
  type BatchScope,
  type EditorState,
  type KnowledgeOption,
  type PersonaOption,
  type PluginOption,
  type ProviderOption,
  type SessionGroup,
  type SessionRule,
  type UmoInfo,
} from './sessionManagementModel';
import { useSessionGroupEditorState } from './useSessionGroupEditorState';

export default function SessionManagementPage() {
  const { t } = useTranslation();
  const prefix = 'features.session-management';
  const text = useCallback((key: string, options?: Record<string, unknown>) => t(`${prefix}.${key}`, options), [t]);
  const [rules, setRules] = useState<SessionRule[]>([]);
  const [groups, setGroups] = useState<SessionGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(paginationDefaults.compactPageSize);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(() => new Set<string>());
  const [availablePersonas, setAvailablePersonas] = useState<PersonaOption[]>([]);
  const [chatProviders, setChatProviders] = useState<ProviderOption[]>([]);
  const [sttProviders, setSttProviders] = useState<ProviderOption[]>([]);
  const [ttsProviders, setTtsProviders] = useState<ProviderOption[]>([]);
  const [plugins, setPlugins] = useState<PluginOption[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeOption[]>([]);
  const [umoInfoMap, setUmoInfoMap] = useState<Record<string, UmoInfo>>({});
  const [allUmos, setAllUmos] = useState<string[]>([]);
  const [loadingUmos, setLoadingUmos] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [newUmo, setNewUmo] = useState('');
  const [editorItem, setEditorItem] = useState<SessionRule | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [savingSection, setSavingSection] = useState('');
  const [nameItem, setNameItem] = useState<SessionRule | null>(null);
  const [nameValue, setNameValue] = useState('');

  const [batchScope, setBatchScope] = useState<BatchScope>('selected');
  const [batchLlm, setBatchLlm] = useState('');
  const [batchTts, setBatchTts] = useState('');
  const [batchChatProvider, setBatchChatProvider] = useState('');
  const [batchUpdating, setBatchUpdating] = useState(false);

  const {
    availableSearch,
    editingGroup,
    groupMode,
    groupOpen,
    savingGroup,
    selectedSearch,
    setAvailableSearch,
    setEditingGroup,
    setGroupMode,
    setGroupOpen,
    setSavingGroup,
    setSelectedSearch,
  } = useSessionGroupEditorState();

  const mergeUmoInfos = useCallback((infos: UmoInfo[]) => {
    setUmoInfoMap((current) => {
      const next = { ...current };
      infos.forEach((info) => {
        if (info?.umo) next[info.umo] = { ...(next[info.umo] ?? {}), ...info };
      });
      return next;
    });
  }, []);

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = decodeApiData(
        await listSessionRules({
          query: { page, page_size: pageSize, search: search.trim() || undefined },
        }),
        parseSessionRulesData,
        'session rules',
      );
      const nextRules = (data.rules ?? []).map((item) => ({ ...item, rules: item.rules ?? {} }));
      setRules(nextRules);
      setTotal(data.total ?? 0);
      setAvailablePersonas(data.available_personas ?? []);
      setChatProviders(data.available_chat_providers ?? []);
      setSttProviders(data.available_stt_providers ?? []);
      setTtsProviders(data.available_tts_providers ?? []);
      setPlugins(data.available_plugins ?? []);
      setKnowledgeBases(data.available_kbs ?? []);
      mergeUmoInfos(nextRules);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text('messages.loadError'));
    } finally {
      setLoading(false);
    }
  }, [mergeUmoInfos, page, pageSize, search, text]);

  const loadGroups = useCallback(async () => {
    try {
      setGroups(decodeApiData(await listSessionGroups(), parseSessionGroups, 'session groups'));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : text('messages.loadError'));
    }
  }, [text]);

  const loadUmos = useCallback(async () => {
    setLoadingUmos(true);
    try {
      const data = decodeApiData(await listActiveUmos(), parseActiveUmos, 'active sessions');
      setAllUmos(data.umos ?? []);
      mergeUmoInfos(data.umo_infos ?? []);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : text('messages.loadError'));
    } finally {
      setLoadingUmos(false);
    }
  }, [mergeUmoInfos, text]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRules(), 300);
    return () => window.clearTimeout(timer);
  }, [loadRules]);
  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const selectedRules = useMemo(() => rules.filter((rule) => selected.has(rule.umo)), [rules, selected]);
  const allPageSelected = rules.length > 0 && rules.every((rule) => selected.has(rule.umo));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const infoFor = useCallback((umo: string) => umoInfoMap[umo] ?? parseUmo(umo), [umoInfoMap]);

  const availableNewUmos = useMemo(() => {
    const existing = new Set(rules.map((rule) => rule.umo));
    return allUmos.filter((umo) => !existing.has(umo));
  }, [allUmos, rules]);
  const selectedGroupUmos = editingGroup.umos ?? [];
  const unselectedGroupUmos = useMemo(() => {
    const chosen = new Set(selectedGroupUmos);
    const query = availableSearch.trim().toLowerCase();
    return allUmos.filter(
      (umo) =>
        !chosen.has(umo) &&
        (!query || displayName(infoFor(umo)).toLowerCase().includes(query) || umo.toLowerCase().includes(query)),
    );
  }, [allUmos, availableSearch, infoFor, selectedGroupUmos]);
  const filteredSelectedGroupUmos = useMemo(() => {
    const query = selectedSearch.trim().toLowerCase();
    return selectedGroupUmos.filter(
      (umo) => !query || displayName(infoFor(umo)).toLowerCase().includes(query) || umo.toLowerCase().includes(query),
    );
  }, [infoFor, selectedGroupUmos, selectedSearch]);

  const providerLabel = (provider: ProviderOption) =>
    provider.model ? `${provider.name || provider.id} (${provider.model})` : provider.name || provider.id;
  const openEditor = (item: SessionRule) => {
    setEditorItem(item);
    setEditor(initialEditor(item));
  };
  const updateEditor = <K extends keyof EditorState>(key: K, value: EditorState[K]) => {
    setEditor((current) => (current ? { ...current, [key]: value } : current));
  };
  const updateLocalRule = (umo: string, key: string, value?: unknown) => {
    setRules((current) => {
      const found = current.find((item) => item.umo === umo);
      if (!found && value !== undefined) return [...current, { ...infoFor(umo), rules: { [key]: value }, umo }];
      return current.map((item) => {
        if (item.umo !== umo) return item;
        const nextRules = { ...item.rules };
        if (value === undefined) delete nextRules[key];
        else nextRules[key] = value;
        return { ...item, rules: nextRules };
      });
    });
    setEditorItem((current) => {
      if (!current || current.umo !== umo) return current;
      const nextRules = { ...current.rules };
      if (value === undefined) delete nextRules[key];
      else nextRules[key] = value;
      return { ...current, rules: nextRules };
    });
  };
  const upsert = async (umo: string, ruleKey: string, ruleValue: unknown) => {
    await upsertSessionRule({ body: { rule_key: ruleKey, rule_value: ruleValue as never, umo } });
    updateLocalRule(umo, ruleKey, ruleValue);
  };
  const removeRuleKey = async (umo: string, ruleKey: string) => {
    await deleteSessionRules({ body: { rule_key: ruleKey, umo } });
    updateLocalRule(umo, ruleKey);
  };

  const removeRules = async (items: SessionRule[]) => {
    if (
      !items.length ||
      !(await confirmAction({
        danger: true,
        message:
          items.length === 1
            ? text('deleteConfirm.message')
            : text('batchDeleteConfirm.message', { count: items.length }),
        title: items.length === 1 ? text('deleteConfirm.title') : text('batchDeleteConfirm.title'),
      }))
    )
      return;
    try {
      await deleteSessionRules({
        body: items.length === 1 ? { umo: items[0].umo } : { umos: items.map((item) => item.umo) },
      });
      toast.success(text(items.length === 1 ? 'messages.deleteSuccess' : 'messages.batchDeleteSuccess'));
      setSelected(new Set());
      await loadRules();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : text('messages.deleteError'));
    }
  };

  const saveService = async () => {
    if (!editorItem || !editor) return;
    setSavingSection('service');
    try {
      const config: Record<string, unknown> = {
        llm_enabled: editor.service.llm_enabled,
        session_enabled: editor.service.session_enabled,
        tts_enabled: editor.service.tts_enabled,
      };
      if (editor.service.custom_name) config.custom_name = editor.service.custom_name;
      if (editor.service.persona_id) config.persona_id = editor.service.persona_id;
      await upsert(editorItem.umo, 'session_service_config', config);
      toast.success(text('messages.saveSuccess'));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : text('messages.saveError'));
    } finally {
      setSavingSection('');
    }
  };
  const saveProviders = async () => {
    if (!editorItem || !editor) return;
    setSavingSection('providers');
    try {
      const types = ['chat_completion', 'speech_to_text', 'text_to_speech'] as const;
      await Promise.all(
        types.map(async (type) => {
          const key = `provider_perf_${type}`;
          const value = editor.providers[type];
          if (value && value !== FOLLOW_CONFIG_VALUE) await upsert(editorItem.umo, key, value);
          else if (editorItem.rules[key] !== undefined) await removeRuleKey(editorItem.umo, key);
        }),
      );
      toast.success(text('messages.saveSuccess'));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : text('messages.saveError'));
    } finally {
      setSavingSection('');
    }
  };
  const savePlugins = async () => {
    if (!editorItem || !editor) return;
    setSavingSection('plugins');
    try {
      if (!editor.plugin.enabled_plugins.length && !editor.plugin.disabled_plugins.length) {
        if (editorItem.rules.session_plugin_config !== undefined)
          await removeRuleKey(editorItem.umo, 'session_plugin_config');
      } else await upsert(editorItem.umo, 'session_plugin_config', editor.plugin);
      toast.success(text('messages.saveSuccess'));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : text('messages.saveError'));
    } finally {
      setSavingSection('');
    }
  };
  const saveKnowledge = async () => {
    if (!editorItem || !editor) return;
    setSavingSection('knowledge');
    try {
      if (!editor.kb.kb_ids.length) {
        if (editorItem.rules.kb_config !== undefined) await removeRuleKey(editorItem.umo, 'kb_config');
      } else await upsert(editorItem.umo, 'kb_config', editor.kb);
      toast.success(text('messages.saveSuccess'));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : text('messages.saveError'));
    } finally {
      setSavingSection('');
    }
  };

  const saveQuickName = async () => {
    if (!nameItem) return;
    setSavingSection('name');
    try {
      const current = recordValue(nameItem.rules.session_service_config);
      const config: Record<string, unknown> = {
        llm_enabled: current.llm_enabled !== false,
        session_enabled: current.session_enabled !== false,
        tts_enabled: current.tts_enabled !== false,
        ...current,
      };
      if (nameValue.trim()) config.custom_name = nameValue.trim();
      else delete config.custom_name;
      await upsert(nameItem.umo, 'session_service_config', config);
      toast.success(text('messages.saveSuccess'));
      setNameItem(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : text('messages.saveError'));
    } finally {
      setSavingSection('');
    }
  };

  const applyBatch = async () => {
    const hasChanges = batchLlm !== '' || batchTts !== '' || batchChatProvider !== '';
    if (!hasChanges) return toast.error(text('messages.selectAtLeastOneConfig'));
    const umos = batchScope === 'selected' ? [...selected] : [];
    if (batchScope === 'selected' && !umos.length) return toast.error(text('messages.selectSessionsFirst'));
    setBatchUpdating(true);
    try {
      const isCustom = batchScope.startsWith('custom_group:');
      let scope: 'all' | 'group' | 'private' | 'custom_group' | undefined;
      if (isCustom) scope = 'custom_group';
      else if (batchScope !== 'selected') scope = batchScope as 'all' | 'group' | 'private';
      const common = {
        ...(scope ? { scope } : {}),
        ...(isCustom ? { group_id: batchScope.slice('custom_group:'.length) } : {}),
        ...(umos.length ? { umos } : {}),
      };
      const tasks: Promise<unknown>[] = [];
      if (batchLlm !== '' || batchTts !== '')
        tasks.push(
          batchUpdateSessionService({
            body: {
              ...common,
              ...(batchLlm !== '' ? { llm_enabled: batchLlm === 'true' } : {}),
              ...(batchTts !== '' ? { tts_enabled: batchTts === 'true' } : {}),
            },
          }),
        );
      if (batchChatProvider) {
        if (batchChatProvider === FOLLOW_CONFIG_VALUE) {
          tasks.push(deleteSessionRules({ body: { ...common, rule_key: 'provider_perf_chat_completion' } }));
        } else {
          tasks.push(
            batchUpdateSessionProvider({
              body: { ...common, provider_id: batchChatProvider, provider_type: 'chat_completion' },
            }),
          );
        }
      }
      await Promise.all(tasks);
      toast.success(text('messages.batchUpdateSuccess'));
      setBatchLlm('');
      setBatchTts('');
      setBatchChatProvider('');
      await loadRules();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : text('messages.batchUpdateError'));
    } finally {
      setBatchUpdating(false);
    }
  };

  const openGroupEditor = async (group?: SessionGroup) => {
    setGroupMode(group ? 'edit' : 'create');
    setEditingGroup(group ? { ...group, umos: [...(group.umos ?? [])] } : { id: '', name: '', umos: [] });
    setAvailableSearch('');
    setSelectedSearch('');
    setGroupOpen(true);
    await loadUmos();
  };
  const saveGroup = async () => {
    if (!editingGroup.name?.trim()) return toast.error(text('messages.groupNameRequired'));
    setSavingGroup(true);
    try {
      if (groupMode === 'create') {
        await createSessionGroup({ body: { name: editingGroup.name.trim(), umos: editingGroup.umos ?? [] } });
      } else {
        await updateSessionGroup({
          body: { name: editingGroup.name.trim(), umos: editingGroup.umos ?? [] },
          path: { group_id: editingGroup.id },
        });
      }
      toast.success(text('messages.saveSuccess'));
      setGroupOpen(false);
      await loadGroups();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : text('messages.saveGroupError'));
    } finally {
      setSavingGroup(false);
    }
  };
  const removeGroup = async (group: SessionGroup) => {
    if (
      !(await confirmAction({
        danger: true,
        message: text('groups.deleteConfirm', { name: group.name }),
        title: text('deleteConfirm.title'),
      }))
    )
      return;
    try {
      await deleteSessionGroup({ path: { group_id: group.id } });
      toast.success(text('messages.deleteSuccess'));
      await loadGroups();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : text('messages.deleteGroupError'));
    }
  };
  const addSelectedToGroup = async (groupId: string) => {
    if (!selected.size) return toast.error(text('messages.selectSessionsToAddFirst'));
    try {
      await updateSessionGroup({ body: { add_umos: [...selected] }, path: { group_id: groupId } });
      toast.success(text('messages.addToGroupSuccess', { count: selected.size }));
      await loadGroups();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : text('messages.addToGroupError'));
    }
  };

  return (
    <div className="session-rules-page">
      <section className="session-rules-card session-rules-card--table">
        <header className="session-rules-toolbar">
          <div className="session-rules-toolbar__title">
            <h1>{text('customRules.title')}</h1>
            <a aria-label={text('title')} href={externalLinks.docs.customRules} rel="noreferrer" target="_blank">
              <MdiIcon name="mdi-information-outline" />
            </a>
            <span>
              {total} {text('customRules.rulesCount')}
            </span>
          </div>
          <label className="session-rules-search">
            <MdiIcon name="mdi-magnify" />
            <input
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder={text('search.placeholder')}
              value={search}
            />
          </label>
          <div className="session-rules-toolbar__actions">
            {selectedRules.length > 0 && (
              <button className="is-danger" onClick={() => void removeRules(selectedRules)} type="button">
                <MdiIcon name="mdi-delete-outline" />
                {text('buttons.batchDelete')} ({selectedRules.length})
              </button>
            )}
            <button
              className="is-success"
              onClick={() => {
                setAddOpen(true);
                setNewUmo('');
                void loadUmos();
              }}
              type="button"
            >
              <MdiIcon name="mdi-plus" />
              {text('buttons.addRule')}
            </button>
            <button
              className="is-primary"
              disabled={loading}
              onClick={() => void loadRules().then(() => toast.success(text('messages.refreshSuccess')))}
              type="button"
            >
              <MdiIcon className={loading ? 'mdi-spin' : ''} name="mdi-refresh" />
              {text('buttons.refresh')}
            </button>
          </div>
        </header>
        {error && (
          <div className="monitor-error" role="alert">
            {error}
          </div>
        )}
        <div className="session-rules-table-wrap">
          <table className="session-rules-table">
            <thead>
              <tr>
                <th>
                  <input
                    aria-label={text('table.headers.umoInfo')}
                    checked={allPageSelected}
                    onChange={() =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (allPageSelected) rules.forEach((rule) => next.delete(rule.umo));
                        else rules.forEach((rule) => next.add(rule.umo));
                        return next;
                      })
                    }
                    type="checkbox"
                  />
                </th>
                <th>{text('table.headers.umoInfo')}</th>
                <th>{text('table.headers.rulesOverview')}</th>
                <th>{text('table.headers.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => {
                const service = recordValue(rule.rules.session_service_config);
                const hasProvider =
                  rule.rules.provider_config !== undefined ||
                  ['chat_completion', 'speech_to_text', 'text_to_speech'].some(
                    (type) => rule.rules[`provider_perf_${type}`] !== undefined,
                  );
                return (
                  <tr key={rule.umo}>
                    <td>
                      <input
                        checked={selected.has(rule.umo)}
                        onChange={() =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (next.has(rule.umo)) next.delete(rule.umo);
                            else next.add(rule.umo);
                            return next;
                          })
                        }
                        type="checkbox"
                      />
                    </td>
                    <td>
                      <UmoDisplay
                        customName={typeof service.custom_name === 'string' ? service.custom_name : ''}
                        info={rule}
                        onEdit={() => {
                          setNameItem(rule);
                          setNameValue(typeof service.custom_name === 'string' ? service.custom_name : '');
                        }}
                      />
                    </td>
                    <td>
                      <div className="session-rule-chips">
                        {rule.rules.session_service_config !== undefined && (
                          <span className="is-primary">{text('customRules.serviceConfig')}</span>
                        )}
                        {rule.rules.session_plugin_config !== undefined && (
                          <span className="is-secondary">{text('customRules.pluginConfig')}</span>
                        )}
                        {rule.rules.kb_config !== undefined && (
                          <span className="is-info">{text('customRules.kbConfig')}</span>
                        )}
                        {hasProvider && <span className="is-warning">{text('customRules.providerConfig')}</span>}
                      </div>
                    </td>
                    <td>
                      <div className="session-rule-actions">
                        <button
                          className="is-primary"
                          onClick={() => openEditor(rule)}
                          title={text('buttons.editRule')}
                          type="button"
                        >
                          <MdiIcon name="mdi-pencil" />
                        </button>
                        <button
                          className="is-danger"
                          onClick={() => void removeRules([rule])}
                          title={text('buttons.deleteAllRules')}
                          type="button"
                        >
                          <MdiIcon name="mdi-delete" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && rules.length === 0 && (
            <div className="session-rules-empty">
              <MdiIcon name="mdi-file-document-edit-outline" />
              <strong>{text('customRules.noRules')}</strong>
              <span>{text('customRules.noRulesDesc')}</span>
              <button
                onClick={() => {
                  setAddOpen(true);
                  void loadUmos();
                }}
                type="button"
              >
                <MdiIcon name="mdi-plus" />
                {text('buttons.addRule')}
              </button>
            </div>
          )}
        </div>
        <footer className="session-rules-pagination">
          <label>
            {t('core.common.itemsPerPage')}:{' '}
            <select
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              value={pageSize}
            >
              {[10, 20, 50].map((size) => (
                <option key={size}>{size}</option>
              ))}
            </select>
          </label>
          <span>
            {t('core.common.paginationRange', {
              from: total ? (page - 1) * pageSize + 1 : 0,
              to: total ? Math.min(page * pageSize, total) : 0,
              total,
            })}
          </span>
          <button disabled={page <= 1} onClick={() => setPage(1)} type="button">
            <MdiIcon name="mdi-page-first" />
          </button>
          <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} type="button">
            <MdiIcon name="mdi-chevron-left" />
          </button>
          <button disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)} type="button">
            <MdiIcon name="mdi-chevron-right" />
          </button>
          <button disabled={page >= totalPages} onClick={() => setPage(totalPages)} type="button">
            <MdiIcon name="mdi-page-last" />
          </button>
        </footer>
      </section>

      <section className="session-rules-card">
        <header className="session-rules-section-title">
          <h2>{text('batchOperations.title')}</h2>
          <span>{text('batchOperations.hint')}</span>
        </header>
        <div className="session-batch-grid">
          <label>
            <span>{text('batchOperations.scope')}</span>
            <select onChange={(event) => setBatchScope(event.target.value as BatchScope)} value={batchScope}>
              <option value="selected">{text('batchOperations.scopeSelected')}</option>
              <option value="all">{text('batchOperations.scopeAll')}</option>
              <option value="group">{text('batchOperations.scopeGroup')}</option>
              <option value="private">{text('batchOperations.scopePrivate')}</option>
              {groups.map((group) => (
                <option key={group.id} value={`custom_group:${group.id}`}>
                  {text('groups.customGroupOption', {
                    count: group.umo_count ?? group.umos?.length ?? 0,
                    name: group.name,
                  })}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{text('batchOperations.llmStatus')}</span>
            <select onChange={(event) => setBatchLlm(event.target.value)} value={batchLlm}>
              <option value="">{text('batchOperations.llmStatus')}</option>
              <option value="true">{text('status.enabled')}</option>
              <option value="false">{text('status.disabled')}</option>
            </select>
          </label>
          <label>
            <span>{text('batchOperations.ttsStatus')}</span>
            <select onChange={(event) => setBatchTts(event.target.value)} value={batchTts}>
              <option value="">{text('batchOperations.ttsStatus')}</option>
              <option value="true">{text('status.enabled')}</option>
              <option value="false">{text('status.disabled')}</option>
            </select>
          </label>
          <label>
            <span>{text('batchOperations.chatProvider')}</span>
            <select onChange={(event) => setBatchChatProvider(event.target.value)} value={batchChatProvider}>
              <option value="">{text('batchOperations.chatProvider')}</option>
              <option value={FOLLOW_CONFIG_VALUE}>{text('provider.followConfig')}</option>
              {chatProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {providerLabel(provider)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="session-batch-actions">
          <button
            disabled={batchUpdating || (batchScope === 'selected' && !selected.size)}
            onClick={() => void applyBatch()}
            type="button"
          >
            <MdiIcon name="mdi-check-all" />
            {text('batchOperations.apply')}
          </button>
        </div>
      </section>

      <section className="session-rules-card">
        <header className="session-rules-section-title session-rules-section-title--actions">
          <div>
            <h2>{text('groups.title')}</h2>
            <span>{text('groups.count', { count: groups.length })}</span>
          </div>
          <div>
            {selected.size > 0 && groups.length > 0 && (
              <label className="session-group-add">
                <MdiIcon name="mdi-folder-plus" />
                <select
                  onChange={(event) => {
                    if (event.target.value) void addSelectedToGroup(event.target.value);
                    event.target.value = '';
                  }}
                  value=""
                >
                  <option value="">{text('groups.addToGroup')}</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {text('groups.groupOption', {
                        count: group.umo_count ?? group.umos?.length ?? 0,
                        name: group.name,
                      })}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button onClick={() => void openGroupEditor()} type="button">
              <MdiIcon name="mdi-folder-plus" />
              {text('groups.create')}
            </button>
          </div>
        </header>
        {groups.length ? (
          <div className="session-group-grid">
            {groups.map((group) => (
              <article key={group.id}>
                <div>
                  <strong>{group.name || group.id}</strong>
                  <span>{text('groups.sessionsCount', { count: group.umo_count ?? group.umos?.length ?? 0 })}</span>
                </div>
                <div>
                  <button onClick={() => void openGroupEditor(group)} title={text('groups.edit')} type="button">
                    <MdiIcon name="mdi-pencil" />
                  </button>
                  <button
                    className="is-danger"
                    onClick={() => void removeGroup(group)}
                    title={text('buttons.delete')}
                    type="button"
                  >
                    <MdiIcon name="mdi-delete" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="session-groups-empty">{text('groups.empty')}</div>
        )}
      </section>

      <Dialog onOpenChange={setAddOpen} open={addOpen} title={text('addRule.title')}>
        <div className="session-add-rule">
          <DialogClose asChild>
            <button className="session-dialog-close" aria-label={text('buttons.cancel')} type="button">
              <MdiIcon name="mdi-close" />
            </button>
          </DialogClose>
          <div className="session-rule-alert">
            <MdiIcon name="mdi-information-outline" />
            <span>{text('addRule.description')}</span>
          </div>
          <label>
            <span>{text('addRule.selectUmo')}</span>
            <select disabled={loadingUmos} onChange={(event) => setNewUmo(event.target.value)} value={newUmo}>
              <option value="">{loadingUmos ? '…' : text('addRule.noUmos')}</option>
              {availableNewUmos.map((umo) => (
                <option key={umo} value={umo}>
                  {displayName(infoFor(umo))} · {umo}
                </option>
              ))}
            </select>
          </label>
          <div className="dialog-actions">
            <DialogClose asChild>
              <button type="button">{text('buttons.cancel')}</button>
            </DialogClose>
            <button
              className="button--primary"
              disabled={!newUmo}
              onClick={() => {
                const item = { ...infoFor(newUmo), rules: {}, umo: newUmo };
                setAddOpen(false);
                openEditor(item);
              }}
              type="button"
            >
              {text('buttons.next')}
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setEditorItem(null);
            setEditor(null);
          }
        }}
        open={Boolean(editorItem && editor)}
        title={text('ruleEditor.title')}
      >
        {editorItem && editor && (
          <div className="session-rule-editor">
            <DialogClose asChild>
              <button className="session-dialog-close" aria-label={text('buttons.cancel')} type="button">
                <MdiIcon name="mdi-close" />
              </button>
            </DialogClose>
            <code className="session-rule-editor__umo">{editorItem.umo}</code>
            <EditorSection
              onSave={saveService}
              saving={savingSection === 'service'}
              title={text('ruleEditor.serviceConfig.title')}
              saveText={text('buttons.save')}
            >
              <label className="session-check">
                <input
                  checked={editor.service.session_enabled}
                  onChange={(event) =>
                    updateEditor('service', { ...editor.service, session_enabled: event.target.checked })
                  }
                  type="checkbox"
                />
                {text('ruleEditor.serviceConfig.sessionEnabled')}
              </label>
              <div className="session-editor-columns">
                <label className="session-check">
                  <input
                    checked={editor.service.llm_enabled}
                    onChange={(event) =>
                      updateEditor('service', { ...editor.service, llm_enabled: event.target.checked })
                    }
                    type="checkbox"
                  />
                  {text('ruleEditor.serviceConfig.llmEnabled')}
                </label>
                <label className="session-check">
                  <input
                    checked={editor.service.tts_enabled}
                    onChange={(event) =>
                      updateEditor('service', { ...editor.service, tts_enabled: event.target.checked })
                    }
                    type="checkbox"
                  />
                  {text('ruleEditor.serviceConfig.ttsEnabled')}
                </label>
              </div>
              <label>
                <span>{text('ruleEditor.serviceConfig.customName')}</span>
                <input
                  onChange={(event) => updateEditor('service', { ...editor.service, custom_name: event.target.value })}
                  value={editor.service.custom_name ?? ''}
                />
              </label>
            </EditorSection>
            <EditorSection
              onSave={saveProviders}
              saving={savingSection === 'providers'}
              title={text('ruleEditor.providerConfig.title')}
              saveText={text('buttons.save')}
            >
              <ProviderSelect
                label={text('ruleEditor.providerConfig.chatProvider')}
                onChange={(value) => updateEditor('providers', { ...editor.providers, chat_completion: value })}
                options={chatProviders}
                value={editor.providers.chat_completion}
                followText={text('provider.followConfig')}
              />
              <ProviderSelect
                disabled={!sttProviders.length}
                label={text('ruleEditor.providerConfig.sttProvider')}
                onChange={(value) => updateEditor('providers', { ...editor.providers, speech_to_text: value })}
                options={sttProviders}
                value={editor.providers.speech_to_text}
                followText={text('provider.followConfig')}
              />
              <ProviderSelect
                disabled={!ttsProviders.length}
                label={text('ruleEditor.providerConfig.ttsProvider')}
                onChange={(value) => updateEditor('providers', { ...editor.providers, text_to_speech: value })}
                options={ttsProviders}
                value={editor.providers.text_to_speech}
                followText={text('provider.followConfig')}
              />
            </EditorSection>
            <EditorSection
              onSave={saveService}
              saving={savingSection === 'service'}
              title={text('ruleEditor.personaConfig.title')}
              saveText={text('buttons.save')}
            >
              <label>
                <span>{text('ruleEditor.personaConfig.selectPersona')}</span>
                <select
                  onChange={(event) =>
                    updateEditor('service', { ...editor.service, persona_id: event.target.value || null })
                  }
                  value={editor.service.persona_id ?? ''}
                >
                  <option value="">{text('persona.none')}</option>
                  {availablePersonas.map((persona) => (
                    <option key={persona.id || persona.name} value={persona.name}>
                      {persona.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="session-rule-alert">
                <MdiIcon name="mdi-information-outline" />
                {text('ruleEditor.personaConfig.hint')}
              </div>
            </EditorSection>
            <EditorSection
              onSave={savePlugins}
              saving={savingSection === 'plugins'}
              title={text('ruleEditor.pluginConfig.title')}
              saveText={text('buttons.save')}
            >
              <MultiSelect
                label={text('ruleEditor.pluginConfig.disabledPlugins')}
                onChange={(value) => updateEditor('plugin', { ...editor.plugin, disabled_plugins: value })}
                options={plugins.map((plugin) => ({ label: plugin.display_name || plugin.name, value: plugin.name }))}
                value={editor.plugin.disabled_plugins}
              />
              <div className="session-rule-alert">
                <MdiIcon name="mdi-information-outline" />
                {text('ruleEditor.pluginConfig.hint')}
              </div>
            </EditorSection>
            <EditorSection
              onSave={saveKnowledge}
              saving={savingSection === 'knowledge'}
              title={text('ruleEditor.kbConfig.title')}
              saveText={text('buttons.save')}
            >
              <MultiSelect
                disabled={!knowledgeBases.length}
                label={text('ruleEditor.kbConfig.selectKbs')}
                onChange={(value) => updateEditor('kb', { ...editor.kb, kb_ids: value })}
                options={knowledgeBases.map((kb) => ({ label: `${kb.emoji || '📚'} ${kb.kb_name}`, value: kb.kb_id }))}
                value={editor.kb.kb_ids}
              />
              <div className="session-editor-columns">
                <label>
                  <span>{text('ruleEditor.kbConfig.topK')}</span>
                  <input
                    max={20}
                    min={1}
                    onChange={(event) => updateEditor('kb', { ...editor.kb, top_k: Number(event.target.value) || 1 })}
                    type="number"
                    value={editor.kb.top_k}
                  />
                </label>
                <label className="session-check session-check--bottom">
                  <input
                    checked={editor.kb.enable_rerank}
                    onChange={(event) => updateEditor('kb', { ...editor.kb, enable_rerank: event.target.checked })}
                    type="checkbox"
                  />
                  {text('ruleEditor.kbConfig.enableRerank')}
                </label>
              </div>
            </EditorSection>
          </div>
        )}
      </Dialog>

      <Dialog
        onOpenChange={(open) => !open && setNameItem(null)}
        open={Boolean(nameItem)}
        title={text('quickEditName.title')}
      >
        <div className="session-quick-name">
          <label>
            <span>{text('ruleEditor.serviceConfig.customName')}</span>
            <input
              autoFocus
              onChange={(event) => setNameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void saveQuickName();
              }}
              value={nameValue}
            />
          </label>
          <div className="dialog-actions">
            <DialogClose asChild>
              <button type="button">{text('buttons.cancel')}</button>
            </DialogClose>
            <button
              className="button--primary"
              disabled={savingSection === 'name'}
              onClick={() => void saveQuickName()}
              type="button"
            >
              {text('buttons.save')}
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog
        onOpenChange={setGroupOpen}
        open={groupOpen}
        title={text(groupMode === 'create' ? 'groups.create' : 'groups.edit')}
      >
        <div className="session-group-editor">
          <label>
            <span>{text('groups.name')}</span>
            <input
              onChange={(event) => setEditingGroup((current) => ({ ...current, name: event.target.value }))}
              value={editingGroup.name ?? ''}
            />
          </label>
          <div className="session-transfer">
            <TransferList
              emptyText={text('groups.noMatch')}
              items={unselectedGroupUmos}
              label={text('groups.availableSessions', { count: allUmos.length - selectedGroupUmos.length })}
              onItem={(umo) => setEditingGroup((current) => ({ ...current, umos: [...(current.umos ?? []), umo] }))}
              onSearch={setAvailableSearch}
              search={availableSearch}
              infoFor={infoFor}
              icon="mdi-plus"
            />
            <div className="session-transfer__actions">
              <button
                disabled={!unselectedGroupUmos.length}
                onClick={() =>
                  setEditingGroup((current) => ({
                    ...current,
                    umos: [...new Set([...(current.umos ?? []), ...unselectedGroupUmos])],
                  }))
                }
                type="button"
              >
                <MdiIcon name="mdi-chevron-double-right" />
              </button>
              <button
                disabled={!selectedGroupUmos.length}
                onClick={() => setEditingGroup((current) => ({ ...current, umos: [] }))}
                type="button"
              >
                <MdiIcon name="mdi-chevron-double-left" />
              </button>
            </div>
            <TransferList
              danger
              emptyText={text('groups.noMembers')}
              items={filteredSelectedGroupUmos}
              label={text('groups.selectedSessions', { count: selectedGroupUmos.length })}
              onItem={(umo) =>
                setEditingGroup((current) => ({
                  ...current,
                  umos: (current.umos ?? []).filter((item) => item !== umo),
                }))
              }
              onSearch={setSelectedSearch}
              search={selectedSearch}
              infoFor={infoFor}
              icon="mdi-minus"
            />
          </div>
          <div className="dialog-actions">
            <DialogClose asChild>
              <button type="button">{text('buttons.cancel')}</button>
            </DialogClose>
            <button className="button--primary" disabled={savingGroup} onClick={() => void saveGroup()} type="button">
              {text('buttons.save')}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
