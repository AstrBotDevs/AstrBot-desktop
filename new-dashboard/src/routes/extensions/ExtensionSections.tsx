import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import {
  createMcpServer, deleteMcpServer, deleteNeoSkillCandidate, deleteNeoSkillRelease, deleteSkillByName,
  downloadSkillByName, evaluateNeoSkillCandidate, getNeoSkillPayload, getSkillFileByName, getSystemConfig,
  listCommands, listMcpServers, listNeoSkillCandidates, listNeoSkillReleases, listSkillFilesByName,
  listSkills, listTools, promoteNeoSkillCandidate, rollbackNeoSkillRelease, setMcpServerEnabled,
  setToolEnabled, setToolPermission, syncModelScopeMcpServers, syncNeoSkillRelease, testMcpServerByName,
  updateCommand, updateMcpServer, updateSkillByName, updateSkillFileByName, uploadSkillsBatch,
} from '@/api/openapi';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { Dialog } from '@/components/headless/Dialog';
import { MonacoEditor } from '@/components/editor/MonacoEditor';
import { confirmAction, toast } from '@/stores/feedback';
import { errorMessage, isObject, type JsonObject, objectList, parseJsonObject, prettyJson, recordId, responseData } from '@/routes/configuration/model';
import { useTranslation } from 'react-i18next';

function SectionState({ error, loading }: { error: string; loading: boolean }) {
  if (loading) return <div className="extension-state"><MdiIcon className="mdi-spin" name="mdi-loading" /></div>;
  if (error) return <div className="monitor-error">{error}</div>;
  return null;
}

export function ComponentsSection() {
  const { t } = useTranslation(); const c = (key: string, options?: Record<string, unknown>) => t(`features.command.${key}`, options); const u = (key: string, options?: Record<string, unknown>) => t(`features.tooluse.${key}`, options); const e = (key: string) => t(`features.extension.${key}`);
  const [commands, setCommands] = useState<JsonObject[]>([]); const [tools, setTools] = useState<JsonObject[]>([]); const [summary, setSummary] = useState({ conflicts: 0, disabled: 0 });
  const [tab, setTab] = useState<'commands' | 'tools'>('commands'); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [commandSearch, setCommandSearch] = useState(''); const [toolSearch, setToolSearch] = useState(''); const [pluginFilter, setPluginFilter] = useState('all'); const [typeFilter, setTypeFilter] = useState('all'); const [permissionFilter, setPermissionFilter] = useState('all'); const [statusFilter, setStatusFilter] = useState('all'); const [showSystem, setShowSystem] = useState(false); const [showBuiltin, setShowBuiltin] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set()); const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set()); const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(10);
  const [rename, setRename] = useState<{ aliases: string[]; item: JsonObject; name: string; saving: boolean } | null>(null); const [details, setDetails] = useState<JsonObject | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      if (tab === 'commands') {
        const payload = responseData<unknown>(await listCommands());
        setCommands(objectList(payload, ['items', 'commands', 'data']));
        const data = isObject(payload) && isObject(payload.summary) ? payload.summary : {};
        setSummary({ conflicts: Number(data.conflicts || 0), disabled: Number(data.disabled || 0) });
      } else setTools(objectList(responseData(await listTools()), ['tools', 'items', 'data']));
    } catch (cause) { setError(errorMessage(cause, tab === 'commands' ? c('messages.loadFailed') : u('messages.getToolsError', { error: '' }))); } finally { setLoading(false); }
  }, [tab, t]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [tab, commandSearch, toolSearch, pluginFilter, typeFilter, permissionFilter, statusFilter, showSystem, showBuiltin, pageSize]);
  const hasSystemConflict = commands.some((item) => Boolean(item.has_conflict) && Boolean(item.reserved)); const effectiveShowSystem = showSystem || hasSystemConflict;
  const plugins = useMemo(() => Array.from(new Set(commands.filter((item) => effectiveShowSystem || !item.reserved).map((item) => String(item.plugin || '')).filter(Boolean))).sort(), [commands, effectiveShowSystem]);
  const commandMatches = (item: JsonObject, query: string) => {
    if (!effectiveShowSystem && item.reserved) return false;
    if (query && !`${item.effective_command || ''} ${item.description || ''} ${item.plugin || ''}`.toLowerCase().includes(query)) return false;
    if (pluginFilter !== 'all' && item.plugin !== pluginFilter) return false;
    if (typeFilter !== 'all' && item.type !== typeFilter) return false;
    if (permissionFilter === 'everyone' && !['everyone', 'member'].includes(String(item.permission))) return false;
    if (permissionFilter === 'admin' && item.permission !== 'admin') return false;
    if (statusFilter === 'enabled' && !item.enabled || statusFilter === 'disabled' && item.enabled || statusFilter === 'conflict' && !item.has_conflict) return false;
    return true;
  };
  const commandRows = useMemo(() => {
    const query = commandSearch.trim().toLowerCase(); const conflicts: JsonObject[] = []; const normal: JsonObject[] = [];
    const append = (item: JsonObject) => (item.has_conflict ? conflicts : normal).push(item);
    commands.forEach((item) => {
      if (item.is_group) {
        const children = Array.isArray(item.sub_commands) ? item.sub_commands.filter(isObject) : [];
        const matching = children.filter((child) => commandMatches(child, query));
        if (commandMatches(item, query) || matching.length) {
          append(item);
          if (expandedGroups.has(recordId(item, 'handler_full_name'))) (query ? matching : children).filter((child) => commandMatches(child, query)).forEach(append);
        }
      } else if (item.type !== 'sub_command' && commandMatches(item, query)) append(item);
    });
    conflicts.sort((a, b) => String(a.effective_command || '').localeCompare(String(b.effective_command || '')));
    return [...conflicts, ...normal];
  }, [commandSearch, commands, effectiveShowSystem, expandedGroups, permissionFilter, pluginFilter, statusFilter, typeFilter]);
  const toolRows = useMemo(() => tools.filter((item) => (showBuiltin || item.origin !== 'builtin') && (!toolSearch.trim() || `${item.name || ''} ${item.description || ''}`.toLowerCase().includes(toolSearch.trim().toLowerCase()))), [showBuiltin, toolSearch, tools]);
  const rows = tab === 'commands' ? commandRows : toolRows; const pages = Math.max(1, Math.ceil(rows.length / pageSize)); const visible = rows.slice((page - 1) * pageSize, page * pageSize);
  const toolSummary = { total: tools.length, active: tools.filter((item) => Boolean(item.active)).length, inactive: tools.filter((item) => !item.active).length };
  const toggleCommand = async (item: JsonObject) => { const id = recordId(item, 'handler_full_name'); try { await updateCommand({ path: { command_id: id }, body: { enabled: !item.enabled } }); toast.success(c('messages.toggleSuccess')); await load(); } catch (cause) { toast.error(errorMessage(cause, c('messages.toggleFailed'))); } };
  const commandPermission = async (item: JsonObject, value: 'admin' | 'member') => { try { await updateCommand({ path: { command_id: recordId(item, 'handler_full_name') }, body: { permission_group: value } }); toast.success(c('messages.updateSuccess')); await load(); } catch (cause) { toast.error(errorMessage(cause, c('messages.updateFailed'))); } };
  const saveRename = async () => { if (!rename?.name.trim()) return; setRename({ ...rename, saving: true }); try { await updateCommand({ path: { command_id: recordId(rename.item, 'handler_full_name') }, body: { alias: rename.name.trim(), aliases: rename.aliases.map((value) => value.trim()).filter(Boolean) } }); toast.success(c('messages.renameSuccess')); setRename(null); await load(); } catch (cause) { toast.error(errorMessage(cause, c('messages.renameFailed'))); setRename({ ...rename, saving: false }); } };
  const toggleTool = async (item: JsonObject) => { if (item.readonly) { toast.info(u('messages.toggleToolReadonly')); return; } try { await setToolEnabled({ path: { tool_id: recordId(item, 'name') }, body: { enabled: !item.active } }); toast.success(u('messages.toggleToolSuccess')); await load(); } catch (cause) { toast.error(errorMessage(cause, u('messages.toggleToolError', { error: '' }))); } };
  const toolPermission = async (item: JsonObject, value: 'admin' | 'member') => { if (item.origin === 'builtin') { toast.info(u('messages.updateToolPermissionBuiltin')); return; } try { await setToolPermission({ path: { tool_id: recordId(item, 'name') }, body: { permission: value } }); toast.success(u('messages.updateToolPermissionSuccess', { name: String(item.name) })); await load(); } catch (cause) { toast.error(errorMessage(cause, u('messages.updateToolPermissionFailed'))); } };
  const toggleSet = (setter: Dispatch<SetStateAction<Set<string>>>, id: string) => setter((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return <section className="extension-section component-panel">
    <header className="component-panel__title"><h2>{e('tabs.handlersOperation')}</h2></header>
    <nav className="component-panel__tabs"><button aria-pressed={tab === 'commands'} onClick={() => setTab('commands')} type="button"><MdiIcon name="mdi-console-line" />{c('type.command')}</button><button aria-pressed={tab === 'tools'} onClick={() => setTab('tools')} type="button"><MdiIcon name="mdi-function-variant" />{u('functionTools.title')}</button></nav>
    {tab === 'commands' ? <div className="component-panel__filters">
      <label><span>{c('filters.byPlugin')}</span><select onChange={(event) => setPluginFilter(event.target.value)} value={pluginFilter}><option value="all">{c('filters.all')}</option>{plugins.map((plugin) => <option key={plugin}>{plugin}</option>)}</select></label>
      <label><span>{c('filters.byType')}</span><select onChange={(event) => setTypeFilter(event.target.value)} value={typeFilter}><option value="all">{c('filters.all')}</option><option value="group">{c('type.group')}</option><option value="command">{c('type.command')}</option><option value="sub_command">{c('type.subCommand')}</option></select></label>
      <label><span>{c('filters.byPermission')}</span><select onChange={(event) => setPermissionFilter(event.target.value)} value={permissionFilter}><option value="all">{c('filters.all')}</option><option value="everyone">{c('permission.everyone')}</option><option value="admin">{c('permission.admin')}</option></select></label>
      <label><span>{c('filters.byStatus')}</span><select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}><option value="all">{c('filters.all')}</option><option value="enabled">{c('filters.enabled')}</option><option value="disabled">{c('filters.disabled')}</option><option value="conflict">{c('filters.conflict')}</option></select></label>
    </div> : null}
    <div className="component-panel__toolbar">
      <label><MdiIcon name="mdi-magnify" /><input onChange={(event) => tab === 'commands' ? setCommandSearch(event.target.value) : setToolSearch(event.target.value)} placeholder={tab === 'commands' ? c('search.placeholder') : u('functionTools.search')} value={tab === 'commands' ? commandSearch : toolSearch} /></label>
      <div className="component-panel__stats">{tab === 'commands' ? <><span className="is-primary"><MdiIcon name="mdi-console-line" />{c('summary.total')}: <strong>{commandRows.length}</strong></span><span className="is-error"><MdiIcon name="mdi-close-circle-outline" />{c('summary.disabled')}: <strong>{summary.disabled}</strong></span><label title={hasSystemConflict ? c('filters.systemPluginConflictHint') : undefined}><input checked={effectiveShowSystem} disabled={hasSystemConflict} onChange={(event) => setShowSystem(event.target.checked)} type="checkbox" />{c('filters.showSystemPlugins')}</label></> : <><span className="is-primary"><MdiIcon name="mdi-function-variant" />{u('functionTools.summary.total')}: <strong>{toolSummary.total}</strong></span><span className="is-success"><MdiIcon name="mdi-check-circle-outline" />{u('functionTools.summary.active')}: <strong>{toolSummary.active}</strong></span><span className="is-error"><MdiIcon name="mdi-close-circle-outline" />{u('functionTools.summary.inactive')}: <strong>{toolSummary.inactive}</strong></span><label><input checked={showBuiltin} onChange={(event) => setShowBuiltin(event.target.checked)} type="checkbox" />{u('functionTools.filter.showBuiltin')}</label></>}</div>
    </div>
    {tab === 'commands' && summary.conflicts > 0 && <div className="component-panel__conflict"><MdiIcon name="mdi-alert-circle" /><div><strong>{c('conflictAlert.title')}</strong><p>{c('conflictAlert.description', { count: summary.conflicts })}</p><small><MdiIcon name="mdi-lightbulb-outline" />{c('conflictAlert.hint')}</small></div></div>}
    <SectionState error={error} loading={loading} />
    {!loading && <div className="component-panel__table"><table><thead>{tab === 'commands' ? <tr><th>{c('table.headers.command')}</th><th>{c('table.headers.type')}</th><th>{c('table.headers.plugin')}</th><th>{c('table.headers.description')}</th><th>{c('table.headers.permission')}</th><th>{c('table.headers.status')}</th><th>{c('table.headers.actions')}</th></tr> : <tr><th aria-label={u('functionTools.expand')} /><th>{u('functionTools.title')}</th><th>{u('functionTools.description')}</th><th>{u('functionTools.table.origin')}</th><th>{u('functionTools.table.originName')}</th><th>{u('functionTools.table.permission')}</th><th>{u('functionTools.table.actions')}</th></tr>}</thead><tbody>
      {visible.map((item, index) => tab === 'commands'
        ? <CommandRow expanded={expandedGroups.has(recordId(item, 'handler_full_name'))} item={item} key={recordId(item, 'handler_full_name') || index} onDetails={setDetails} onPermission={commandPermission} onRename={(command) => setRename({ aliases: Array.isArray(command.aliases) ? command.aliases.map(String) : [], item: command, name: String(command.current_fragment || ''), saving: false })} onToggle={toggleCommand} onToggleExpand={(command) => toggleSet(setExpandedGroups, recordId(command, 'handler_full_name'))} t={c} />
        : <ToolRow expanded={expandedTools.has(recordId(item, 'name'))} item={item} key={recordId(item, 'name') || index} onPermission={toolPermission} onToggle={toggleTool} onToggleExpand={(tool) => toggleSet(setExpandedTools, recordId(tool, 'name'))} t={u} />)}
    </tbody></table>{!rows.length && <div className="component-panel__empty"><MdiIcon name={tab === 'commands' ? 'mdi-console-line' : 'mdi-function-variant'} /><h3>{tab === 'commands' ? c('empty.noCommands') : u('functionTools.empty')}</h3>{tab === 'commands' && <p>{c('empty.noCommandsDesc')}</p>}</div>}<footer><label>{t('core.common.itemsPerPage')}: <select onChange={(event) => setPageSize(Number(event.target.value))} value={pageSize}><option>10</option><option>25</option><option>50</option></select></label><span>{rows.length ? t('core.common.paginationRange', { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, rows.length), total: rows.length }) : t('core.common.paginationRange', { from: 0, to: 0, total: 0 })}</span><button disabled={page <= 1} onClick={() => setPage(1)} type="button"><MdiIcon name="mdi-page-first" /></button><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} type="button"><MdiIcon name="mdi-chevron-left" /></button><button disabled={page >= pages} onClick={() => setPage((value) => value + 1)} type="button"><MdiIcon name="mdi-chevron-right" /></button><button disabled={page >= pages} onClick={() => setPage(pages)} type="button"><MdiIcon name="mdi-page-last" /></button></footer></div>}
    <RenameCommandDialog onClose={() => setRename(null)} onSave={() => void saveRename()} rename={rename} setRename={setRename} t={c} />
    <CommandDetailsDialog closeLabel={t('core.actions.close')} item={details} onClose={() => setDetails(null)} t={c} />
  </section>;
}

type ModuleText = (key: string, options?: Record<string, unknown>) => string;

function CommandRow({ expanded, item, onDetails, onPermission, onRename, onToggle, onToggleExpand, t }: {
  expanded: boolean; item: JsonObject; onDetails: (item: JsonObject) => void; onPermission: (item: JsonObject, value: 'admin' | 'member') => Promise<void>; onRename: (item: JsonObject) => void; onToggle: (item: JsonObject) => Promise<void>; onToggleExpand: (item: JsonObject) => void; t: ModuleText;
}) {
  const type = String(item.type || 'command'); const isGroup = Boolean(item.is_group); const subCommands = Array.isArray(item.sub_commands) ? item.sub_commands.filter(isObject) : [];
  const typeLabel = type === 'group' ? t('type.group') : type === 'sub_command' ? t('type.subCommand') : t('type.command');
  const typeIcon = type === 'group' ? 'mdi-folder-outline' : type === 'sub_command' ? 'mdi-subdirectory-arrow-right' : 'mdi-console-line';
  const status = item.has_conflict ? 'conflict' : item.enabled ? 'enabled' : 'disabled';
  return <tr className={`${item.has_conflict ? 'is-conflict ' : ''}${isGroup ? 'is-group ' : ''}${type === 'sub_command' ? 'is-subcommand' : ''}`}>
    <td><div className="component-command-name">{isGroup && subCommands.length ? <button onClick={() => onToggleExpand(item)} type="button"><MdiIcon name={expanded ? 'mdi-chevron-down' : 'mdi-chevron-right'} /></button> : type === 'sub_command' ? <span className="component-command-indent" /> : null}<code>{String(item.effective_command || item.current_fragment || item.original_command || '-')}</code></div></td>
    <td><span className={`component-chip is-${type}`}><MdiIcon name={typeIcon} />{typeLabel}{isGroup && subCommands.length ? ` (${subCommands.length})` : ''}</span></td>
    <td>{String(item.plugin_display_name || item.plugin || '-')}</td>
    <td><span className="component-ellipsis" title={String(item.description || '')}>{String(item.description || '-')}</span></td>
    <td><select className={`component-permission is-${item.permission === 'admin' ? 'admin' : 'member'}`} onChange={(event) => void onPermission(item, event.target.value as 'admin' | 'member')} value={item.permission === 'admin' ? 'admin' : 'member'}><option value="member">{t('permission.everyone')}</option><option value="admin">{t('permission.admin')}</option></select></td>
    <td><span className={`component-status is-${status}`}>{t(`status.${status}`)}</span></td>
    <td><div className="component-row-actions"><button aria-label={item.enabled ? t('tooltips.disable') : t('tooltips.enable')} className={item.enabled ? 'is-pause' : 'is-play'} onClick={() => void onToggle(item)} title={item.enabled ? t('tooltips.disable') : t('tooltips.enable')} type="button"><MdiIcon name={item.enabled ? 'mdi-pause' : 'mdi-play'} /></button><button aria-label={t('tooltips.rename')} className="is-edit" onClick={() => onRename(item)} title={t('tooltips.rename')} type="button"><MdiIcon name="mdi-pencil" /></button><button aria-label={t('tooltips.viewDetails')} onClick={() => onDetails(item)} title={t('tooltips.viewDetails')} type="button"><MdiIcon name="mdi-information" /></button></div></td>
  </tr>;
}

function ToolRow({ expanded, item, onPermission, onToggle, onToggleExpand, t }: {
  expanded: boolean; item: JsonObject; onPermission: (item: JsonObject, value: 'admin' | 'member') => Promise<void>; onToggle: (item: JsonObject) => Promise<void>; onToggleExpand: (item: JsonObject) => void; t: ModuleText;
}) {
  const id = recordId(item, 'name'); const parameters = isObject(item.parameters) && isObject(item.parameters.properties) ? Object.entries(item.parameters.properties) : [];
  const tags = Array.isArray(item.builtin_config_tags) ? item.builtin_config_tags.filter(isObject).filter((tag) => tag.enabled) : [];
  return <>
    <tr>
      <td><button className="component-expand" onClick={() => onToggleExpand(item)} type="button"><MdiIcon name={expanded ? 'mdi-chevron-up' : 'mdi-chevron-down'} /></button></td>
      <td><div className="component-tool-name"><strong>{id}</strong>{tags.map((tag, index) => <span className="component-config-tag" key={String(tag.conf_id || index)} title={toolConfigTooltip(tag, t)}>{String(tag.conf_name || '')}</span>)}</div></td>
      <td><span className="component-ellipsis" title={String(item.description || '')}>{String(item.description || '-')}</span></td>
      <td><span className="component-origin">{String(item.origin || '-')}</span></td>
      <td><span className="component-ellipsis" title={String(item.origin_name || '')}>{String(item.origin_name || '-')}</span></td>
      <td>{item.origin === 'builtin' ? <span className="component-permission-builtin">{t('functionTools.table.permissionBuiltin')}</span> : <select className={`component-permission is-${item.permission === 'admin' ? 'admin' : 'member'}`} onChange={(event) => void onPermission(item, event.target.value as 'admin' | 'member')} value={item.permission === 'admin' ? 'admin' : 'member'}><option value="member">{t('functionTools.table.permissionEveryone')}</option><option value="admin">{t('functionTools.table.permissionAdmin')}</option></select>}</td>
      <td>{item.readonly ? <span className="component-readonly">-</span> : <label className="component-tool-switch"><input checked={Boolean(item.active)} onChange={() => void onToggle(item)} type="checkbox" /><span /></label>}</td>
    </tr>
    {expanded && <tr className="component-tool-parameters"><td colSpan={7}><div><MdiIcon name="mdi-code-json" /><section><h4>{t('functionTools.parameters')}</h4>{parameters.length ? <table><thead><tr><th>{t('functionTools.table.paramName')}</th><th>{t('functionTools.table.type')}</th><th>{t('functionTools.table.description')}</th></tr></thead><tbody>{parameters.map(([name, raw]) => { const parameter = isObject(raw) ? raw : {}; return <tr key={name}><td><strong>{name}</strong></td><td><span className="component-chip is-command">{String(parameter.type || '-')}</span></td><td>{String(parameter.description || '-')}</td></tr>; })}</tbody></table> : <p>{t('functionTools.noParameters')}</p>}</section></div></td></tr>}
  </>;
}

function toolConfigTooltip(tag: JsonObject, t: ModuleText) {
  const formatValue = (value: unknown) => {
    if (Array.isArray(value)) return value.map(String).join(', ');
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (value === null || value === undefined || value === '') return '-';
    return String(value);
  };
  const conditions = Array.isArray(tag.matched_conditions) ? tag.matched_conditions.filter(isObject).map((condition) => {
    if (condition.message) return String(condition.message);
    const values = { actual: formatValue(condition.actual), expected: formatValue(condition.expected), key: String(condition.key || '-') };
    if (condition.operator === 'truthy') return t('functionTools.configTags.conditions.truthy', values);
    if (condition.operator === 'equals') return t('functionTools.configTags.conditions.equals', values);
    if (condition.operator === 'in') return t('functionTools.configTags.conditions.in', values);
    return t('functionTools.configTags.conditions.fallback', values);
  }) : [];
  return [t('functionTools.configTags.tooltipTitle', { config: String(tag.conf_name || '-') }), ...conditions].join('\n');
}

function RenameCommandDialog({ onClose, onSave, rename, setRename, t }: {
  onClose: () => void; onSave: () => void; rename: { aliases: string[]; item: JsonObject; name: string; saving: boolean } | null; setRename: Dispatch<SetStateAction<{ aliases: string[]; item: JsonObject; name: string; saving: boolean } | null>>; t: ModuleText;
}) {
  const [aliasesOpen, setAliasesOpen] = useState(false);
  useEffect(() => { if (rename) setAliasesOpen(rename.aliases.some((alias) => alias.trim())); }, [rename?.item]);
  return <Dialog onOpenChange={(open) => !open && onClose()} open={rename !== null} title={t('dialogs.rename.title')}><div className="component-rename"><label>{t('dialogs.rename.newName')}<input autoFocus onChange={(event) => rename && setRename({ ...rename, name: event.target.value })} value={rename?.name || ''} /></label><section><button onClick={() => setAliasesOpen((value) => !value)} type="button"><span>{t('dialogs.rename.aliases')}</span><MdiIcon name={aliasesOpen ? 'mdi-chevron-up' : 'mdi-chevron-down'} /></button>{aliasesOpen && <div>{rename?.aliases.map((alias, index) => <label key={index}><input onChange={(event) => rename && setRename({ ...rename, aliases: rename.aliases.map((value, aliasIndex) => aliasIndex === index ? event.target.value : value) })} value={alias} /><button aria-label={t('dialogs.rename.deleteAlias')} onClick={() => rename && setRename({ ...rename, aliases: rename.aliases.filter((_, aliasIndex) => aliasIndex !== index) })} type="button"><MdiIcon name="mdi-delete" /></button></label>)}<button onClick={() => rename && setRename({ ...rename, aliases: [...rename.aliases, ''] })} type="button"><MdiIcon name="mdi-plus" />{t('dialogs.rename.addAlias')}</button></div>}</section></div><div className="dialog-actions"><button onClick={onClose} type="button">{t('dialogs.rename.cancel')}</button><button className="button--primary" disabled={rename?.saving || !rename?.name.trim()} onClick={onSave} type="button">{t('dialogs.rename.confirm')}</button></div></Dialog>;
}

function CommandDetailsDialog({ closeLabel, item, onClose, t }: { closeLabel: string; item: JsonObject | null; onClose: () => void; t: ModuleText }) {
  const aliases = item && Array.isArray(item.aliases) ? item.aliases.map(String) : []; const children = item && Array.isArray(item.sub_commands) ? item.sub_commands.filter(isObject) : [];
  const rows: Array<[string, unknown]> = item ? [[t('dialogs.details.handler'), item.handler_name], [t('dialogs.details.module'), item.module_path], [t('dialogs.details.originalCommand'), item.original_command], [t('dialogs.details.effectiveCommand'), item.effective_command], ...(item.parent_signature ? [[t('dialogs.details.parentGroup'), item.parent_signature] as [string, unknown]] : [])] : [];
  const type = String(item?.type || 'command');
  const typeInfo = type === 'group'
    ? { icon: 'mdi-folder-outline' as const, label: t('type.group') }
    : type === 'sub_command'
      ? { icon: 'mdi-subdirectory-arrow-right' as const, label: t('type.subCommand') }
      : { icon: 'mdi-console-line' as const, label: t('type.command') };
  return <Dialog onOpenChange={(open) => !open && onClose()} open={item !== null} title={t('dialogs.details.title')}><dl className="component-details"><div><dt>{t('dialogs.details.type')}</dt><dd><span className={`component-type is-${type}`}><MdiIcon name={typeInfo.icon} />{typeInfo.label}</span></dd></div>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd><code>{String(value || '-')}</code></dd></div>)}{aliases.length > 0 && <div><dt>{t('dialogs.details.aliases')}</dt><dd>{aliases.map((alias) => <span className="component-chip" key={alias}>{alias}</span>)}</dd></div>}{children.length > 0 && <div><dt>{t('dialogs.details.subCommands')}</dt><dd>{children.map((child, index) => <span className="component-chip" key={recordId(child, 'handler_full_name') || index}>{String(child.current_fragment || child.effective_command || '-')}</span>)}</dd></div>}<div><dt>{t('dialogs.details.permission')}</dt><dd><span className={`component-permission-builtin is-${item?.permission === 'admin' ? 'admin' : 'member'}`}>{item?.permission === 'admin' ? t('permission.admin') : t('permission.everyone')}</span></dd></div>{Boolean(item?.has_conflict) && <div><dt>{t('dialogs.details.conflictStatus')}</dt><dd><span className="component-status is-conflict">{t('status.conflict')}</span></dd></div>}</dl><div className="dialog-actions"><button onClick={onClose} type="button">{closeLabel}</button></div></Dialog>;
}

export function McpSection() {
  const { t } = useTranslation(); const m = (key: string, options?: Record<string, unknown>) => t(`features.tooluse.${key}`, options);
  const [items, setItems] = useState<JsonObject[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ active: boolean; name: string; oldName: string; source: string } | null>(null); const [saving, setSaving] = useState(false); const [dialogMessage, setDialogMessage] = useState(''); const [tools, setTools] = useState<{ name: string; tools: string[] } | null>(null); const [updating, setUpdating] = useState<Set<string>>(new Set()); const [syncOpen, setSyncOpen] = useState(false); const [syncToken, setSyncToken] = useState('');
  const load = useCallback(async (quiet = false) => { if (!quiet) setLoading(true); setError(''); try { const response = await listMcpServers(); ensureApiSuccess(response, m('messages.getServersError', { error: '' })); setItems(objectList(responseData(response), ['servers', 'items', 'data'])); } catch (cause) { setError(errorMessage(cause, m('messages.getServersError', { error: '' }))); } finally { if (!quiet) setLoading(false); } }, [t]);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(true), 30000); return () => window.clearInterval(timer); }, [load]);
  const open = (item?: JsonObject) => {
    if (!item) { setEditing({ active: true, name: '', oldName: '', source: '' }); setDialogMessage(''); return; }
    const config = { ...item }; delete config.name; delete config.server_name; delete config.active; delete config.enabled; delete config.tools; delete config.errlogs;
    setEditing({ active: (item.active ?? item.enabled) !== false, name: recordId(item, 'name', 'server_name'), oldName: recordId(item, 'name', 'server_name'), source: prettyJson(config) }); setDialogMessage('');
  };
  const setTemplate = (type: 'stdio' | 'streamable_http' | 'sse') => setEditing((current) => current ? { ...current, source: prettyJson(type === 'stdio' ? { command: 'python', args: ['-m', 'your_module'] } : { transport: type, url: 'your mcp server url', headers: {}, timeout: 5, sse_read_timeout: 300 }) } : current);
  const readConfig = () => { if (!editing?.source.trim()) throw new Error(m('dialogs.addServer.errors.configEmpty')); return parseJsonObject(editing.source); };
  const testDraft = async () => {
    if (!editing) return; let config: JsonObject; try { config = readConfig(); } catch (cause) { toast.error(errorMessage(cause, m('dialogs.addServer.errors.jsonParse', { error: '' }))); return; }
    setSaving(true); setDialogMessage('');
    try {
      const response = await testMcpServerByName({ body: { server_name: editing.name || 'draft', mcp_server_config: config } });
      const envelope = apiEnvelope(response); if (envelope.status === 'error') throw new Error(String(envelope.message || m('messages.testError', { error: '' })));
      const count = Array.isArray(envelope.data) ? envelope.data.length : envelope.data; setDialogMessage(`${String(envelope.message || m('dialogs.addServer.buttons.testConnection'))} (tools: ${String(count ?? 0)})`);
    } catch (cause) { toast.error(errorMessage(cause, m('messages.testError', { error: '' }))); } finally { setSaving(false); }
  };
  const save = async () => {
    if (!editing?.name.trim()) { toast.warning(m('dialogs.addServer.fields.nameRequired')); return; } let config: JsonObject;
    try { config = readConfig(); } catch (cause) { toast.error(errorMessage(cause, m('dialogs.addServer.errors.jsonParse', { error: '' }))); return; }
    setSaving(true);
    try {
      const response = editing.oldName
        ? await updateMcpServer({ path: { server_name: editing.oldName }, body: { ...config, name: editing.name.trim(), active: editing.active } })
        : await createMcpServer({ body: { ...config, name: editing.name.trim(), active: editing.active } });
      ensureApiSuccess(response, m('messages.saveError', { error: '' })); toast.success(String(apiEnvelope(response).message || m('messages.saveSuccess'))); setEditing(null); await load();
    } catch (cause) { toast.error(errorMessage(cause, m('messages.saveError', { error: '' }))); } finally { setSaving(false); }
  };
  const toggle = async (item: JsonObject) => {
    const name = recordId(item, 'name', 'server_name'); if (!name || updating.has(name)) return; setUpdating((current) => new Set(current).add(name));
    try { const response = await setMcpServerEnabled({ path: { server_name: name }, body: { enabled: !(item.active ?? item.enabled) } }); ensureApiSuccess(response, m('messages.updateError', { error: '' })); toast.success(String(apiEnvelope(response).message || m('messages.updateSuccess'))); await load(true); }
    catch (cause) { toast.error(errorMessage(cause, m('messages.updateError', { error: '' }))); } finally { setUpdating((current) => { const next = new Set(current); next.delete(name); return next; }); }
  };
  const remove = async (item: JsonObject) => { const name = recordId(item, 'name', 'server_name'); if (!name || !await confirmAction({ danger: true, title: m('dialogs.confirmDelete', { name }), message: m('dialogs.confirmDelete', { name }) })) return; try { const response = await deleteMcpServer({ path: { server_name: name } }); ensureApiSuccess(response, m('messages.deleteError', { error: '' })); toast.success(String(apiEnvelope(response).message || m('messages.deleteSuccess'))); await load(); } catch (cause) { toast.error(errorMessage(cause, m('messages.deleteError', { error: '' }))); } };
  const sync = async () => {
    if (!syncToken.trim()) { toast.warning(m('dialogs.syncProvider.status.enterToken')); return; } setSaving(true);
    try { const response = await syncModelScopeMcpServers({ body: { access_token: syncToken.trim() } }); ensureApiSuccess(response, m('dialogs.syncProvider.messages.syncError', { error: '' })); toast.success(String(apiEnvelope(response).message || m('dialogs.syncProvider.messages.syncSuccess'))); setSyncOpen(false); setSyncToken(''); await load(); }
    catch (cause) { toast.error(errorMessage(cause, m('dialogs.syncProvider.messages.syncError', { error: '' }))); } finally { setSaving(false); }
  };
  return <section className="extension-section legacy-resource-page">
    <SectionState error={error} loading={loading} />
    {!loading && !items.length && <div className="legacy-resource-empty"><MdiIcon name="mdi-server-off" /><p>{m('mcpServers.empty')}</p></div>}
    <div className="legacy-resource-list">{items.map((item, index) => {
      const name = recordId(item, 'name', 'server_name') || `server-${index}`; const itemTools = Array.isArray(item.tools) ? item.tools.map(String) : []; const active = (item.active ?? item.enabled) !== false; const transport = String(item.transport || '').toLowerCase(); const summary = item.transport ? String(item.transport) : item.command ? `${String(item.command)} ${Array.isArray(item.args) ? item.args.map(String).join(' ') : ''}`.trim() : m('mcpServers.status.noConfig');
      return <article className="legacy-resource-item" key={name} onClick={() => open(item)}><div className="legacy-resource-item__content"><h3>{name}</h3><p title={summary}><MdiIcon name={transport === 'streamable_http' ? 'mdi-web' : transport === 'sse' ? 'mdi-broadcast' : item.command ? 'mdi-console-line' : 'mdi-file-code-outline'} />{summary}</p>{itemTools.length ? <button className="legacy-resource-item__tools" onClick={(event) => { event.stopPropagation(); setTools({ name, tools: itemTools }); }} type="button"><MdiIcon name="mdi-tools" />{m('mcpServers.status.availableTools', { count: itemTools.length })} ({itemTools.length})</button> : <small className="is-warning"><MdiIcon name="mdi-alert-circle" />{m('mcpServers.status.noTools')}</small>}</div><div className="legacy-resource-item__actions"><button aria-label={m('mcpServers.buttons.delete')} onClick={(event) => { event.stopPropagation(); void remove(item); }} type="button"><MdiIcon name="mdi-delete-outline" /></button><label className="config-toggle" onClick={(event) => event.stopPropagation()}><input checked={active} disabled={updating.has(name)} onChange={() => void toggle(item)} type="checkbox" /></label></div></article>;
    })}</div>
    <div className="legacy-fab-stack"><button aria-label={m('mcpServers.buttons.sync')} onClick={() => setSyncOpen(true)} title={m('mcpServers.buttons.sync')} type="button"><MdiIcon name="mdi-sync" /></button><button aria-label={m('mcpServers.buttons.add')} onClick={() => open()} title={m('mcpServers.buttons.add')} type="button"><MdiIcon name="mdi-plus" /></button></div>
    <Dialog onOpenChange={(openValue) => !openValue && setEditing(null)} open={editing !== null} title={editing?.oldName ? m('dialogs.addServer.editTitle') : m('dialogs.addServer.title')}><div className="mcp-editor"><label>{m('dialogs.addServer.fields.name')}<input onChange={(event) => editing && setEditing({ ...editing, name: event.target.value })} value={editing?.name || ''} /></label><header><strong>{m('dialogs.addServer.fields.config')}</strong><div><button onClick={() => setTemplate('stdio')} type="button">{m('mcpServers.buttons.useTemplateStdio')}</button><button onClick={() => setTemplate('streamable_http')} type="button">{m('mcpServers.buttons.useTemplateStreamableHttp')}</button><button onClick={() => setTemplate('sse')} type="button">{m('mcpServers.buttons.useTemplateSse')}</button></div></header><small>*{m('dialogs.addServer.tips.timeoutConfig')}</small><div className="extension-warning is-info"><MdiIcon name="mdi-information-outline" />{m('dialogs.addServer.tips.transportRecommendation')}</div><MonacoEditor language="json" onChange={(value) => editing && setEditing({ ...editing, source: value })} value={editing?.source || ''} />{dialogMessage && <p className="mcp-editor__message">{dialogMessage}</p>}</div><div className="dialog-actions"><button disabled={saving} onClick={() => setEditing(null)} type="button">{m('dialogs.addServer.buttons.cancel')}</button><button disabled={saving} onClick={() => void testDraft()} type="button">{m('dialogs.addServer.buttons.testConnection')}</button><button className="button--primary" disabled={saving || !editing?.name.trim()} onClick={() => void save()} type="button">{m('dialogs.addServer.buttons.save')}</button></div></Dialog>
    <Dialog onOpenChange={(openValue) => !openValue && setTools(null)} open={tools !== null} title={m('mcpServers.status.availableTools')}><ul className="mcp-tools-list">{tools?.tools.map((tool) => <li key={tool}>{tool}</li>)}</ul><div className="dialog-actions"><button onClick={() => setTools(null)} type="button">{t('core.actions.close')}</button></div></Dialog>
    <Dialog onOpenChange={setSyncOpen} open={syncOpen} title={m('dialogs.syncProvider.title')}><div className="mcp-sync"><label>{m('dialogs.syncProvider.fields.provider')}<select value="modelscope"><option value="modelscope">{m('dialogs.syncProvider.providers.modelscope')}</option></select></label><ol><li><strong>{m('dialogs.syncProvider.steps.selectProvider')}</strong><p><a href="https://www.modelscope.cn/mcp" rel="noreferrer" target="_blank">ModelScope</a> — {m('dialogs.syncProvider.providers.description')}</p></li><li><strong>{m('dialogs.syncProvider.steps.configureAuth')}</strong><p><a href="https://modelscope.cn/my/myaccesstoken" rel="noreferrer" target="_blank">{m('dialogs.syncProvider.buttons.getToken')}</a></p></li><li><strong>{m('dialogs.syncProvider.steps.syncServers')}</strong><input aria-label={m('dialogs.syncProvider.fields.accessToken')} onChange={(event) => setSyncToken(event.target.value)} placeholder={m('dialogs.syncProvider.fields.tokenHint')} type="password" value={syncToken} /></li></ol></div><div className="dialog-actions"><button disabled={saving} onClick={() => setSyncOpen(false)} type="button">{m('dialogs.syncProvider.buttons.cancel')}</button><button className="button--primary" disabled={saving} onClick={() => void sync()} type="button">{m('dialogs.syncProvider.buttons.sync')}</button></div></Dialog>
  </section>;
}

export function SkillsSection() {
  const { t } = useTranslation(); const e = (key: string, options?: Record<string, unknown>) => t(`features.extension.${key}`, options);
  const input = useRef<HTMLInputElement>(null); const [items, setItems] = useState<JsonObject[]>([]); const [runtime, setRuntime] = useState('local'); const [sandboxReady, setSandboxReady] = useState(true); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [busy, setBusy] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'local' | 'neo'>('local'); const [neoEnabled, setNeoEnabled] = useState(false); const [uploadOpen, setUploadOpen] = useState(false); const [uploading, setUploading] = useState(false); const [uploadItems, setUploadItems] = useState<SkillUploadItem[]>([]); const [dragging, setDragging] = useState(false); const uploadId = useRef(0); const [editor, setEditor] = useState<SkillEditorState | null>(null);
  const [neoCandidates, setNeoCandidates] = useState<JsonObject[]>([]); const [neoReleases, setNeoReleases] = useState<JsonObject[]>([]); const [neoLoading, setNeoLoading] = useState(false); const [neoFilters, setNeoFilters] = useState({ skillKey: '', stage: '', status: '' }); const [payload, setPayload] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await listSkills(); ensureApiSuccess(response, e('skills.loadFailed')); const payloadData = responseData<unknown>(response); const data = isObject(payloadData) ? payloadData : {}; setItems(Array.isArray(payloadData) ? payloadData.filter(isObject) : objectList(data, ['skills', 'items', 'data'])); setRuntime(String(data.runtime || 'local')); const cache = isObject(data.sandbox_cache) ? data.sandbox_cache : {}; setSandboxReady(Boolean(cache.ready));
    } catch (cause) { setError(errorMessage(cause, e('skills.loadFailed'))); } finally { setLoading(false); }
  }, [t]);
  const loadNeoAvailability = useCallback(async () => {
    try { const payloadData = responseData<unknown>(await getSystemConfig()); const config = isObject(payloadData) && isObject(payloadData.config) ? payloadData.config : isObject(payloadData) ? payloadData : {}; const settings = isObject(config.provider_settings) ? config.provider_settings : {}; const sandbox = isObject(settings.sandbox) ? settings.sandbox : {}; setNeoEnabled(settings.computer_use_runtime === 'sandbox' && sandbox.booter === 'shipyard_neo'); }
    catch { setNeoEnabled(false); }
  }, []);
  const loadNeo = useCallback(async () => {
    setNeoLoading(true);
    try { const [candidateResponse, releaseResponse] = await Promise.all([listNeoSkillCandidates({ query: { skill_key: neoFilters.skillKey || undefined, status: neoFilters.status || undefined } }), listNeoSkillReleases({ query: { skill_key: neoFilters.skillKey || undefined, stage: neoFilters.stage || undefined } })]); setNeoCandidates(objectList(responseData(candidateResponse), ['items', 'candidates', 'data'])); setNeoReleases(objectList(responseData(releaseResponse), ['items', 'releases', 'data']).map((item) => ({ ...item, is_active: item.is_active ?? item.active ?? false }))); }
    catch (cause) { toast.error(errorMessage(cause, e('skills.neoLoadFailed'))); } finally { setNeoLoading(false); }
  }, [neoFilters, t]);
  useEffect(() => { void Promise.all([load(), loadNeoAvailability()]); }, [load, loadNeoAvailability]); useEffect(() => { if (mode === 'neo' && neoEnabled) void loadNeo(); }, [loadNeo, mode, neoEnabled]);
  const setItemBusy = (name: string, active: boolean) => setBusy((current) => { const next = new Set(current); if (active) next.add(name); else next.delete(name); return next; });
  const sourceType = (item: JsonObject) => String(item.source_type || 'local_only'); const readonly = (item: JsonObject) => ['sandbox_only', 'plugin'].includes(sourceType(item)); const sourceLabel = (item: JsonObject) => sourceType(item) === 'plugin' ? e('skills.sourcePlugin', { plugin: String(item.source_label || item.plugin_name || '') }) : sourceType(item) === 'sandbox_only' ? e('skills.sourceSandboxOnly') : sourceType(item) === 'both' ? e('skills.sourceBoth') : e('skills.sourceLocalOnly');
  const toggle = async (item: JsonObject) => {
    const name = recordId(item, 'name', 'skill_name', 'id'); if (sourceType(item) === 'sandbox_only') { toast.warning(e('skills.sandboxPresetReadonly')); return; } setItemBusy(name, true);
    try { const next = !(item.active ?? item.enabled); const response = await updateSkillByName({ body: { skill_name: name, enabled: next, active: next } }); ensureApiSuccess(response, e('skills.updateFailed')); toast.success(e('skills.updateSuccess')); await load(); } catch (cause) { toast.error(errorMessage(cause, e('skills.updateFailed'))); } finally { setItemBusy(name, false); }
  };
  const remove = async (item: JsonObject) => {
    const name = recordId(item, 'name', 'skill_name', 'id'); if (readonly(item)) { toast.warning(e(sourceType(item) === 'plugin' ? 'skills.pluginReadonly' : 'skills.sandboxPresetReadonly')); return; } if (!await confirmAction({ danger: true, title: e('skills.deleteTitle'), message: e('skills.deleteMessage') })) return; setItemBusy(name, true);
    try { const response = await deleteSkillByName({ query: { skill_name: name } }); ensureApiSuccess(response, e('skills.deleteFailed')); toast.success(e('skills.deleteSuccess')); await load(); } catch (cause) { toast.error(errorMessage(cause, e('skills.deleteFailed'))); } finally { setItemBusy(name, false); }
  };
  const download = async (item: JsonObject) => {
    const name = recordId(item, 'name', 'skill_name', 'id'); if (readonly(item)) { toast.warning(e(sourceType(item) === 'plugin' ? 'skills.pluginReadonly' : 'skills.sandboxPresetReadonly')); return; } setItemBusy(name, true);
    try { const response = await downloadSkillByName({ query: { skill_name: name }, responseType: 'blob' }); if (!(response.data instanceof Blob)) throw new Error(e('skills.downloadFailed')); const url = URL.createObjectURL(response.data); const link = document.createElement('a'); link.href = url; link.download = `${name}.zip`; link.click(); URL.revokeObjectURL(url); toast.success(e('skills.downloadSuccess')); } catch (cause) { toast.error(errorMessage(cause, e('skills.downloadFailed'))); } finally { setItemBusy(name, false); }
  };
  const addFiles = (files: File[]) => {
    const names = new Set(uploadItems.map((item) => item.key)); const next = files.filter((file) => file.name).map((file) => { const key = file.name.trim().toLowerCase(); const duplicate = names.has(key); names.add(key); const zip = /\.zip$/i.test(file.name); return { file, id: `upload-${uploadId.current++}`, key, message: duplicate ? e('skills.validationDuplicate') : zip ? e('skills.validationReady') : e('skills.validationZipOnly'), status: duplicate || !zip ? 'skipped' : 'waiting' } satisfies SkillUploadItem; }); setUploadItems((current) => [...current, ...next]);
  };
  const upload = async () => {
    const attempted = uploadItems.filter((item) => item.status === 'waiting' || item.status === 'error'); if (!attempted.length) return; setUploading(true); setUploadItems((current) => current.map((item) => attempted.includes(item) ? { ...item, status: 'uploading', message: e('skills.validationUploading') } : item));
    try {
      const response = await uploadSkillsBatch({ body: { files: attempted.map((item) => item.file) } }); const envelope = apiEnvelope(response); const data = isObject(envelope.data) ? envelope.data : {}; const maps = ['succeeded', 'failed', 'skipped'].reduce<Record<string, Map<string, JsonObject[]>>>((result, field) => { const map = new Map<string, JsonObject[]>(); objectList(data, [field]).forEach((entry) => { const key = String(entry.filename || '').toLowerCase(); map.set(key, [...(map.get(key) || []), entry]); }); result[field] = map; return result; }, {});
      setUploadItems((current) => current.map((item) => { if (!attempted.includes(item)) return item; for (const [field, status] of [['succeeded', 'success'], ['skipped', 'skipped'], ['failed', 'error']] as const) { const match = maps[field].get(item.key)?.shift(); if (match) return { ...item, status, message: field === 'succeeded' ? e('skills.validationUploadedAs', { name: String(match.name || item.file.name) }) : String(match.error || e(field === 'skipped' ? 'skills.validationDuplicate' : 'skills.validationUploadFailed')) }; } return { ...item, status: 'error', message: e('skills.validationNoResult') }; }));
      toast[envelope.status === 'error' ? 'error' : objectList(data, ['failed']).length ? 'warning' : 'success'](String(envelope.message || e('skills.uploadSuccess'))); if (objectList(data, ['succeeded']).length) await load();
    } catch (cause) { setUploadItems((current) => current.map((item) => attempted.includes(item) ? { ...item, status: 'error', message: e('skills.validationUploadFailed') } : item)); toast.error(errorMessage(cause, e('skills.uploadFailed'))); } finally { setUploading(false); }
  };
  const loadDir = async (skillName: string, path = '', current?: SkillEditorState) => {
    const base = current || editor || emptySkillEditor(skillName); setEditor({ ...base, loading: true, error: '' });
    try { const response = await listSkillFilesByName({ query: { skill_name: skillName, path: path || undefined } }); const data = responseData<unknown>(response); const payloadData = isObject(data) ? data : {}; const next = { ...base, currentDir: String(payloadData.path || ''), entries: objectList(payloadData, ['entries', 'items', 'data']), loading: false }; setEditor(next); return next; } catch (cause) { setEditor({ ...base, loading: false, error: errorMessage(cause, e('skills.editorLoadFailed')) }); return null; }
  };
  const loadFile = async (state: SkillEditorState, path: string) => {
    if (state.dirty && !window.confirm(e('skills.discardChanges'))) return; setEditor({ ...state, loading: true, error: '' });
    try { const response = await getSkillFileByName({ query: { skill_name: state.skillName, path } }); const raw = response.data; const data = typeof raw === 'string' ? { content: raw, path } : responseData<unknown>(response); const payloadData = isObject(data) ? data : {}; setEditor({ ...state, content: String(payloadData.content || ''), dirty: false, editable: payloadData.editable !== false, filePath: String(payloadData.path || path), loading: false }); } catch (cause) { setEditor({ ...state, loading: false, error: errorMessage(cause, e('skills.editorLoadFailed')) }); }
  };
  const openEditor = async (item: JsonObject) => {
    if (sourceType(item) === 'sandbox_only') { toast.warning(e('skills.sandboxPresetReadonly')); return; } const name = recordId(item, 'name', 'skill_name'); const initial = emptySkillEditor(name); setEditor(initial); const next = await loadDir(name, '', initial); const skillMd = next?.entries.find((entry) => entry.path === 'SKILL.md'); if (next && skillMd?.editable) await loadFile(next, 'SKILL.md');
  };
  const closeEditor = () => { if (editor?.dirty && !window.confirm(e('skills.discardChanges'))) return; setEditor(null); };
  const saveFile = async () => { if (!editor?.filePath || !editor.editable) return; setEditor({ ...editor, saving: true, error: '' }); try { const response = await updateSkillFileByName({ body: { skill_name: editor.skillName, path: editor.filePath, content: editor.content } }); ensureApiSuccess(response, e('skills.editorSaveFailed')); setEditor({ ...editor, dirty: false, saving: false }); toast.success(e('skills.editorSaveSuccess')); await load(); } catch (cause) { setEditor({ ...editor, saving: false, error: errorMessage(cause, e('skills.editorSaveFailed')) }); toast.error(errorMessage(cause, e('skills.editorSaveFailed'))); } };
  const neoAction = async (action: () => Promise<unknown>, success: string, failure: string, refreshLocal = false) => { try { const response = await action(); ensureApiSuccess(response, e(failure)); toast.success(e(success)); await loadNeo(); if (refreshLocal) await load(); } catch (cause) { toast.error(errorMessage(cause, e(failure))); } };
  return <section className="extension-section legacy-resource-page skills-page-react">
    {neoEnabled && <nav className="skills-mode"><button aria-pressed={mode === 'local'} onClick={() => setMode('local')} type="button">{e('skills.modeLocal')}</button><button aria-pressed={mode === 'neo'} onClick={() => setMode('neo')} type="button">{e('skills.modeNeo')}</button></nav>}
    {mode === 'local' ? <>{runtime === 'sandbox' && !sandboxReady && <div className="extension-warning is-info"><MdiIcon name="mdi-information-outline" />{e('skills.sandboxDiscoveryPending')}</div>}<SectionState error={error} loading={loading} />{!loading && !items.length && <div className="legacy-resource-empty"><MdiIcon name="mdi-folder-open" /><p>{e('skills.empty')}</p><small>{e('skills.emptyHint')}</small></div>}<div className="legacy-resource-list">{items.map((item, index) => { const name = recordId(item, 'name', 'skill_name', 'id') || `skill-${index}`; const active = (item.active ?? item.enabled) !== false; return <article className="legacy-resource-item" key={name} onClick={() => void openEditor(item)}><div className="legacy-resource-item__content"><header><h3>{name}</h3><span className={`skill-source is-${sourceType(item)}`}>{sourceLabel(item)}</span></header><p>{String(item.description || e('skills.noDescription'))}</p><small><MdiIcon name="mdi-file-document" />{e('skills.path')}: {String(item.path || '')}</small></div><div className="legacy-resource-item__actions"><button aria-label={e('skills.download')} disabled={busy.has(name) || readonly(item)} onClick={(event) => { event.stopPropagation(); void download(item); }} type="button"><MdiIcon name="mdi-download-outline" /></button><button aria-label={t('core.common.itemCard.delete')} disabled={busy.has(name) || readonly(item)} onClick={(event) => { event.stopPropagation(); void remove(item); }} type="button"><MdiIcon name="mdi-delete-outline" /></button><label className="config-toggle" onClick={(event) => event.stopPropagation()}><input checked={active} disabled={busy.has(name) || sourceType(item) === 'sandbox_only'} onChange={() => void toggle(item)} type="checkbox" /></label></div></article>; })}</div></> : <NeoSkills candidates={neoCandidates} filters={neoFilters} loading={neoLoading} onCandidateDelete={(item) => void neoAction(() => deleteNeoSkillCandidate({ body: { candidate_id: String(item.id), reason: 'deleted_from_webui' } }), 'skills.neoDeleteSuccess', 'skills.neoDeleteFailed')} onEvaluate={(item, passed) => void neoAction(() => evaluateNeoSkillCandidate({ body: { candidate_id: String(item.id), passed, score: passed ? 1 : 0, report: passed ? 'approved_from_webui' : 'rejected_from_webui' } }), 'skills.neoEvaluateSuccess', 'skills.neoEvaluateFailed')} onFilters={setNeoFilters} onPayload={async (item) => { try { const response = await getNeoSkillPayload({ query: { payload_ref: String(item.payload_ref) } }); setPayload(JSON.stringify(responseData(response), null, 2)); } catch (cause) { toast.error(errorMessage(cause, e('skills.neoPayloadFailed'))); } }} onPromote={(item, stage) => void neoAction(() => promoteNeoSkillCandidate({ body: { candidate_id: String(item.id), stage, sync_to_local: true } }), 'skills.neoPromoteSuccess', 'skills.neoPromoteFailed', stage === 'stable')} onReleaseDelete={(item) => void neoAction(() => deleteNeoSkillRelease({ body: { release_id: String(item.id), reason: 'deleted_from_webui' } }), 'skills.neoDeleteSuccess', 'skills.neoDeleteFailed')} onReleaseLifecycle={(item) => void neoAction(() => rollbackNeoSkillRelease({ body: { release_id: String(item.id) } }), item.is_active ? 'skills.neoDeactivateSuccess' : 'skills.neoRollbackSuccess', item.is_active ? 'skills.neoDeactivateFailed' : 'skills.neoRollbackFailed')} onSync={(item) => void neoAction(() => syncNeoSkillRelease({ body: { release_id: String(item.id) } }), 'skills.neoSyncSuccess', 'skills.neoSyncFailed', true)} releases={neoReleases} t={e} />}
    <div className="legacy-fab-stack"><button aria-label={e('skills.refresh')} onClick={() => void (mode === 'neo' ? loadNeo() : load())} title={e('skills.refresh')} type="button"><MdiIcon name="mdi-refresh" /></button>{mode === 'local' && <button aria-label={e('skills.upload')} onClick={() => setUploadOpen(true)} title={e('skills.upload')} type="button"><MdiIcon name="mdi-upload" /></button>}</div>
    <Dialog onOpenChange={(openValue) => { if (!uploading) { setUploadOpen(openValue); if (!openValue) setUploadItems([]); } }} open={uploadOpen} title={e('skills.uploadDialogTitle')}><div className="skills-upload"><p>{e('skills.uploadHint')}</p><div className="skills-upload__note"><MdiIcon name="mdi-information-outline" />{e('skills.structureRequirement')}</div><div className="skills-upload__abilities"><span><MdiIcon name="mdi-layers-outline" />{e('skills.abilityMultiple')}</span><span><MdiIcon name="mdi-shield-check-outline" />{e('skills.abilityValidate')}</span><span><MdiIcon name="mdi-skip-next-circle-outline" />{e('skills.abilitySkip')}</span></div><div className={`skills-dropzone-react ${dragging ? 'is-dragging' : ''}`} onClick={() => input.current?.click()} onDragLeave={() => setDragging(false)} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(Array.from(event.dataTransfer.files)); }} role="button" tabIndex={0}><MdiIcon name="mdi-folder-zip-outline" /><strong>{e('skills.dropzoneTitle')}</strong><span>{e('skills.dropzoneAction')}</span><small>{e('skills.dropzoneHint')}</small><input accept=".zip" hidden multiple onChange={(event: ChangeEvent<HTMLInputElement>) => { addFiles(Array.from(event.target.files || [])); event.target.value = ''; }} ref={input} type="file" /></div><SkillUploadList items={uploadItems} onRemove={(id) => setUploadItems((current) => current.filter((item) => item.id !== id))} t={e} uploading={uploading} /></div><div className="dialog-actions"><button disabled={uploading} onClick={() => setUploadOpen(false)} type="button">{e('skills.cancel')}</button><button className="button--primary" disabled={uploading || !uploadItems.some((item) => item.status === 'waiting' || item.status === 'error')} onClick={() => void upload()} type="button">{e('skills.confirmUpload')}</button></div></Dialog>
    <SkillEditor editor={editor} onClose={closeEditor} onOpenDir={(path) => editor && void loadDir(editor.skillName, path, editor)} onOpenFile={(path) => editor && void loadFile(editor, path)} onSave={() => void saveFile()} setEditor={setEditor} t={e} />
    <Dialog onOpenChange={(openValue) => !openValue && setPayload('')} open={Boolean(payload)} title={e('skills.neoPayloadTitle')}><pre className="skills-payload">{payload}</pre><div className="dialog-actions"><button onClick={() => setPayload('')} type="button">{e('skills.cancel')}</button></div></Dialog>
  </section>;
}

function apiEnvelope(response: unknown): JsonObject {
  const data = (response as { data?: unknown } | null)?.data;
  return isObject(data) ? data : {};
}

function ensureApiSuccess(response: unknown, fallback: string) {
  const envelope = apiEnvelope(response);
  if (envelope.status === 'error') throw new Error(String(envelope.message || fallback));
}

type SkillUploadStatus = 'waiting' | 'uploading' | 'success' | 'error' | 'skipped';
type SkillUploadItem = { file: File; id: string; key: string; message: string; status: SkillUploadStatus };
type SkillEditorState = { content: string; currentDir: string; dirty: boolean; editable: boolean; entries: JsonObject[]; error: string; filePath: string; loading: boolean; saving: boolean; skillName: string };

function emptySkillEditor(skillName: string): SkillEditorState {
  return { content: '', currentDir: '', dirty: false, editable: false, entries: [], error: '', filePath: '', loading: false, saving: false, skillName };
}

function SkillUploadList({ items, onRemove, t, uploading }: { items: SkillUploadItem[]; onRemove: (id: string) => void; t: ModuleText; uploading: boolean }) {
  const count = (status: SkillUploadStatus) => items.filter((item) => item.status === status).length;
  return <>{items.length ? <><div className="skills-upload__summary"><span>{t('skills.summaryTotal', { count: items.length })}</span><span>{t('skills.summaryReady', { count: count('waiting') + count('uploading') })}</span><span className="is-success">{t('skills.summarySuccess', { count: count('success') })}</span><span className="is-error">{t('skills.summaryFailed', { count: count('error') })}</span><span>{t('skills.summarySkipped', { count: count('skipped') })}</span></div><div className="skills-upload__list"><strong>{t('skills.fileListTitle')}</strong>{items.map((item) => <article key={item.id}><div><b>{item.file.name}</b><small>{formatFileSize(item.file.size)}</small><p>{item.message}</p></div><span className={`is-${item.status}`}>{t(`skills.status${item.status[0].toUpperCase()}${item.status.slice(1)}`)}</span><button disabled={uploading || item.status === 'uploading'} onClick={() => onRemove(item.id)} type="button"><MdiIcon name="mdi-close" /></button></article>)}</div></> : <div className="skills-upload__empty">{t('skills.fileListEmpty')}</div>}</>;
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function SkillEditor({ editor, onClose, onOpenDir, onOpenFile, onSave, setEditor, t }: { editor: SkillEditorState | null; onClose: () => void; onOpenDir: (path: string) => void; onOpenFile: (path: string) => void; onSave: () => void; setEditor: Dispatch<SetStateAction<SkillEditorState | null>>; t: ModuleText }) {
  const parent = editor?.currentDir.split('/').filter(Boolean).slice(0, -1).join('/') || '';
  const language = skillLanguage(editor?.filePath || '');
  return <Dialog onOpenChange={(openValue) => !openValue && onClose()} open={editor !== null} title={editor?.skillName || t('skills.editorTitle')}><div className="skill-editor-react"><aside><header><button disabled={!editor?.currentDir || editor.loading} onClick={() => onOpenDir(parent)} type="button"><MdiIcon name="mdi-arrow-up" /></button><span>{editor?.currentDir || '/'}</span></header><div>{editor?.entries.map((entry, index) => <button className={editor.filePath === entry.path ? 'is-active' : ''} key={`${String(entry.type)}:${String(entry.path || index)}`} onClick={() => entry.type === 'directory' ? onOpenDir(String(entry.path)) : onOpenFile(String(entry.path))} type="button"><MdiIcon name={entry.type === 'directory' ? 'mdi-folder-outline' : 'mdi-file-document-outline'} /><span>{String(entry.name || entry.path)}</span>{entry.type === 'file' && entry.editable === false && <small>{t('skills.readonly')}</small>}</button>)}</div></aside><section><header><span>{editor?.filePath || t('skills.noFileSelected')}</span>{editor?.dirty && <em>{t('skills.unsaved')}</em>}</header>{editor?.error && <div className="monitor-error">{editor.error}</div>}<MonacoEditor language={language} onChange={(content) => editor && setEditor({ ...editor, content, dirty: true })} options={{ readOnly: !editor?.editable || editor?.loading, wordWrap: 'on' }} value={editor?.content || ''} /></section></div><div className="dialog-actions"><button disabled={editor?.saving} onClick={onClose} type="button">{t('skills.cancel')}</button><button className="button--primary" disabled={editor?.saving || !editor?.filePath || !editor.editable || !editor.dirty} onClick={onSave} type="button">{t('skills.saveFile')}</button></div></Dialog>;
}

function skillLanguage(path: string) {
  const ext = path.toLowerCase().split('.').pop();
  return ({ json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini', py: 'python', js: 'javascript', ts: 'typescript', html: 'html', css: 'css', sh: 'shell', md: 'markdown', txt: 'markdown' } as Record<string, string>)[ext || ''] || 'plaintext';
}

function NeoSkills({ candidates, filters, loading, onCandidateDelete, onEvaluate, onFilters, onPayload, onPromote, onReleaseDelete, onReleaseLifecycle, onSync, releases, t }: { candidates: JsonObject[]; filters: { skillKey: string; stage: string; status: string }; loading: boolean; onCandidateDelete: (item: JsonObject) => void; onEvaluate: (item: JsonObject, passed: boolean) => void; onFilters: Dispatch<SetStateAction<{ skillKey: string; stage: string; status: string }>>; onPayload: (item: JsonObject) => void; onPromote: (item: JsonObject, stage: string) => void; onReleaseDelete: (item: JsonObject) => void; onReleaseLifecycle: (item: JsonObject) => void; onSync: (item: JsonObject) => void; releases: JsonObject[]; t: ModuleText }) {
  return <div className="neo-skills"><section className="neo-skills__filters"><header><strong>Neo Skills</strong><small>{t('skills.neoFilterHint')}</small></header><label>{t('skills.neoSkillKey')}<input onChange={(event) => onFilters((current) => ({ ...current, skillKey: event.target.value }))} value={filters.skillKey} /></label><label>{t('skills.neoStatus')}<select onChange={(event) => onFilters((current) => ({ ...current, status: event.target.value }))} value={filters.status}><option value="">{t('skills.neoAll')}</option>{['draft', 'evaluating', 'promoted', 'promoted_canary', 'promoted_stable', 'rejected', 'rolled_back'].map((value) => <option key={value}>{value}</option>)}</select></label><label>{t('skills.neoStage')}<select onChange={(event) => onFilters((current) => ({ ...current, stage: event.target.value }))} value={filters.stage}><option value="">{t('skills.neoAll')}</option><option>canary</option><option>stable</option></select></label></section>{loading && <SectionState error="" loading />}<div className="neo-skills__stats"><span>{t('skills.neoCandidates')}: {candidates.length}</span><span>{t('skills.neoReleases')}: {releases.length}</span><span>{t('skills.neoActive')}: {releases.filter((item) => item.is_active).length}</span></div><NeoTable items={candidates} kind="candidate" onDelete={onCandidateDelete} onEvaluate={onEvaluate} onPayload={onPayload} onPromote={onPromote} t={t} /><NeoTable items={releases} kind="release" onDelete={onReleaseDelete} onLifecycle={onReleaseLifecycle} onSync={onSync} t={t} /></div>;
}

function NeoTable({ items, kind, onDelete, onEvaluate, onLifecycle, onPayload, onPromote, onSync, t }: { items: JsonObject[]; kind: 'candidate' | 'release'; onDelete: (item: JsonObject) => void; onEvaluate?: (item: JsonObject, passed: boolean) => void; onLifecycle?: (item: JsonObject) => void; onPayload?: (item: JsonObject) => void; onPromote?: (item: JsonObject, stage: string) => void; onSync?: (item: JsonObject) => void; t: ModuleText }) {
  return <section className="neo-skills__table"><h3>{t(kind === 'candidate' ? 'skills.neoCandidates' : 'skills.neoReleases')}</h3><div><table><thead><tr><th>ID</th><th>skill_key</th>{kind === 'candidate' ? <><th>{t('skills.neoStatusColumn')}</th><th>{t('skills.neoScore')}</th></> : <><th>{t('skills.neoStageColumn')}</th><th>{t('skills.neoVersion')}</th><th>{t('skills.neoActive')}</th></>}<th>{t('skills.actions')}</th></tr></thead><tbody>{items.map((item, index) => <tr key={String(item.id || index)}><td>{String(item.id || '-')}</td><td>{String(item.skill_key || '-')}</td>{kind === 'candidate' ? <><td>{String(item.status || '-')}</td><td>{String(item.latest_score ?? '-')}</td></> : <><td>{String(item.stage || '-')}</td><td>{String(item.version || '-')}</td><td><span className={item.is_active ? 'is-active' : ''}>{t(item.is_active ? 'skills.neoActiveState' : 'skills.neoInactiveState')}</span></td></>}<td><div className="neo-skills__actions">{kind === 'candidate' ? <><button onClick={() => onEvaluate?.(item, true)} type="button">{t('skills.neoPass')}</button><button onClick={() => onEvaluate?.(item, false)} type="button">{t('skills.neoReject')}</button><button onClick={() => onPromote?.(item, 'canary')} type="button">{t('skills.neoCanary')}</button><button onClick={() => onPromote?.(item, 'stable')} type="button">{t('skills.neoStable')}</button><button disabled={!item.payload_ref} onClick={() => onPayload?.(item)} type="button">{t('skills.neoPayload')}</button></> : <><button onClick={() => onLifecycle?.(item)} type="button">{t(item.is_active ? 'skills.neoDeactivate' : 'skills.neoRollback')}</button><button onClick={() => onSync?.(item)} type="button">{t('skills.neoSync')}</button></>}<button className="button--danger" onClick={() => onDelete(item)} type="button">{t('skills.neoDelete')}</button></div></td></tr>)}</tbody></table></div></section>;
}
