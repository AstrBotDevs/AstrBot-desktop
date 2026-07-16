import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import {
  createMcpServer, deleteMcpServer, deleteSkillByName, listCommands,
  listMcpServers, listSkills, listTools, setMcpServerEnabled, setToolEnabled, setToolPermission,
  testMcpServer, updateCommand, updateMcpServer, updateSkillByName, uploadSkillsBatch,
} from '@/api/openapi';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { Dialog } from '@/components/headless/Dialog';
import { confirmAction, toast } from '@/stores/feedback';
import { errorMessage, isObject, type JsonObject, objectList, parseJsonObject, prettyJson, recordId, responseData } from '@/routes/configuration/model';
import { JsonConfigDialog } from '@/routes/configuration/ConfigurationUi';
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
    {!loading && <div className="component-panel__table"><table><thead>{tab === 'commands' ? <tr><th>{c('table.headers.command')}</th><th>{c('table.headers.type')}</th><th>{c('table.headers.plugin')}</th><th>{c('table.headers.description')}</th><th>{c('table.headers.permission')}</th><th>{c('table.headers.status')}</th><th>{c('table.headers.actions')}</th></tr> : <tr><th aria-label="expand" /><th>{u('functionTools.title')}</th><th>{u('functionTools.description')}</th><th>{u('functionTools.table.origin')}</th><th>{u('functionTools.table.originName')}</th><th>{u('functionTools.table.permission')}</th><th>{u('functionTools.table.actions')}</th></tr>}</thead><tbody>
      {visible.map((item, index) => tab === 'commands'
        ? <CommandRow expanded={expandedGroups.has(recordId(item, 'handler_full_name'))} item={item} key={recordId(item, 'handler_full_name') || index} onDetails={setDetails} onPermission={commandPermission} onRename={(command) => setRename({ aliases: Array.isArray(command.aliases) ? command.aliases.map(String) : [], item: command, name: String(command.current_fragment || ''), saving: false })} onToggle={toggleCommand} onToggleExpand={(command) => toggleSet(setExpandedGroups, recordId(command, 'handler_full_name'))} t={c} />
        : <ToolRow expanded={expandedTools.has(recordId(item, 'name'))} item={item} key={recordId(item, 'name') || index} onPermission={toolPermission} onToggle={toggleTool} onToggleExpand={(tool) => toggleSet(setExpandedTools, recordId(tool, 'name'))} t={u} />)}
    </tbody></table>{!rows.length && <div className="component-panel__empty"><MdiIcon name={tab === 'commands' ? 'mdi-console-line' : 'mdi-function-variant'} /><h3>{tab === 'commands' ? c('empty.noCommands') : u('functionTools.empty')}</h3>{tab === 'commands' && <p>{c('empty.noCommandsDesc')}</p>}</div>}<footer><label>Items per page: <select onChange={(event) => setPageSize(Number(event.target.value))} value={pageSize}><option>10</option><option>25</option><option>50</option></select></label><span>{rows.length ? `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, rows.length)} of ${rows.length}` : '0-0 of 0'}</span><button disabled={page <= 1} onClick={() => setPage(1)} type="button"><MdiIcon name="mdi-page-first" /></button><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} type="button"><MdiIcon name="mdi-chevron-left" /></button><button disabled={page >= pages} onClick={() => setPage((value) => value + 1)} type="button"><MdiIcon name="mdi-chevron-right" /></button><button disabled={page >= pages} onClick={() => setPage(pages)} type="button"><MdiIcon name="mdi-page-last" /></button></footer></div>}
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
  return <Dialog onOpenChange={(open) => !open && onClose()} open={rename !== null} title={t('dialogs.rename.title')}><div className="component-rename"><label>{t('dialogs.rename.newName')}<input autoFocus onChange={(event) => rename && setRename({ ...rename, name: event.target.value })} value={rename?.name || ''} /></label><section><button onClick={() => setAliasesOpen((value) => !value)} type="button"><span>{t('dialogs.rename.aliases')}</span><MdiIcon name={aliasesOpen ? 'mdi-chevron-up' : 'mdi-chevron-down'} /></button>{aliasesOpen && <div>{rename?.aliases.map((alias, index) => <label key={index}><input onChange={(event) => rename && setRename({ ...rename, aliases: rename.aliases.map((value, aliasIndex) => aliasIndex === index ? event.target.value : value) })} value={alias} /><button aria-label="delete" onClick={() => rename && setRename({ ...rename, aliases: rename.aliases.filter((_, aliasIndex) => aliasIndex !== index) })} type="button"><MdiIcon name="mdi-delete" /></button></label>)}<button onClick={() => rename && setRename({ ...rename, aliases: [...rename.aliases, ''] })} type="button"><MdiIcon name="mdi-plus" />{t('dialogs.rename.addAlias')}</button></div>}</section></div><div className="dialog-actions"><button onClick={onClose} type="button">{t('dialogs.rename.cancel')}</button><button className="button--primary" disabled={rename?.saving || !rename?.name.trim()} onClick={onSave} type="button">{t('dialogs.rename.confirm')}</button></div></Dialog>;
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
  const { t } = useTranslation(); const e = (key: string) => t(`features.extension.${key}`); const m = (key: string) => t(`features.tooluse.${key}`);
  const [items, setItems] = useState<JsonObject[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [editing, setEditing] = useState<JsonObject | null>(null); const [source, setSource] = useState('{}'); const [saving, setSaving] = useState(false); const [testing, setTesting] = useState('');
  const load = useCallback(async () => { setLoading(true); setError(''); try { setItems(objectList(responseData(await listMcpServers()), ['servers', 'items', 'data'])); } catch (cause) { setError(errorMessage(cause, e('messages.operationFailed'))); } finally { setLoading(false); } }, [t]);
  useEffect(() => { void load(); }, [load]);
  const open = (item?: JsonObject) => { setEditing(item ?? {}); setSource(prettyJson(item ?? { name: '', enabled: true, transport: 'stdio', command: '', args: [] })); };
  const save = async () => { let config: JsonObject; try { config = parseJsonObject(source); } catch (cause) { toast.error(errorMessage(cause, 'Invalid JSON')); return; } const oldName = recordId(editing ?? {}, 'name', 'server_name'); const name = recordId(config, 'name', 'server_name'); if (!name) { toast.warning('Server name is required'); return; } setSaving(true); try { if (oldName) await updateMcpServer({ path: { server_name: oldName }, body: { ...config, name } }); else await createMcpServer({ body: { ...config, name } }); toast.success(e('messages.saveSuccess')); setEditing(null); await load(); } catch (cause) { toast.error(errorMessage(cause, e('messages.operationFailed'))); } finally { setSaving(false); } };
  const toggle = async (item: JsonObject) => { const name = recordId(item, 'name', 'server_name'); try { await setMcpServerEnabled({ path: { server_name: name }, body: { enabled: item.enabled === false } }); await load(); } catch (cause) { toast.error(errorMessage(cause, e('messages.operationFailed'))); } };
  const test = async (item: JsonObject) => { const name = recordId(item, 'name', 'server_name'); setTesting(name); try { await testMcpServer({ path: { server_name: name } }); toast.success(e('messages.pluginValidateSuccess')); } catch (cause) { toast.error(errorMessage(cause, e('messages.operationFailed'))); } finally { setTesting(''); } };
  const remove = async (item: JsonObject) => { const name = recordId(item, 'name', 'server_name'); if (!name || !await confirmAction({ danger: true, title: e('buttons.deleteSource'), message: name })) return; try { await deleteMcpServer({ path: { server_name: name } }); toast.success(e('messages.deleteSuccess')); await load(); } catch (cause) { toast.error(errorMessage(cause, e('messages.operationFailed'))); } };
  return <section className="extension-section"><header className="extension-section__header"><div><h2>{e('tabs.installedMcpServers')}</h2><p>{m('mcpServers.description')}</p></div><div><button onClick={() => void load()} type="button"><MdiIcon name="mdi-refresh" />{e('buttons.refresh')}</button><button className="button--primary" onClick={() => open()} type="button"><MdiIcon name="mdi-plus" />{e('buttons.install')}</button></div></header><SectionState error={error} loading={loading} /><div className="extension-card-grid">{items.map((item, index) => { const name = recordId(item, 'name', 'server_name') || `server-${index}`; return <article className="extension-resource-card" key={name}><header><MdiIcon name="mdi-server" /><div><h3>{name}</h3><p>{String(item.transport || 'stdio')} · {String(item.url || item.command || '—')}</p></div><label className="config-toggle"><input checked={item.enabled !== false} onChange={() => void toggle(item)} type="checkbox" /></label></header><div><button disabled={testing === name} onClick={() => void test(item)} type="button">{testing === name ? '…' : 'Test'}</button><button onClick={() => open(item)} type="button">{e('buttons.configure')}</button><button className="button--danger" onClick={() => void remove(item)} type="button">{e('buttons.uninstall')}</button></div></article>; })}</div>{!loading && !items.length && <div className="monitor-empty">{e('empty.noPlugins')}</div>}<JsonConfigDialog busy={saving} initialMode="json" onChange={setSource} onOpenChange={(openValue) => !openValue && setEditing(null)} onSave={() => void save()} open={editing !== null} title={editing && recordId(editing, 'name', 'server_name') ? e('buttons.configure') : e('buttons.install')} value={source} /></section>;
}

export function SkillsSection() {
  const { t } = useTranslation(); const e = (key: string, options?: Record<string, unknown>) => t(`features.extension.${key}`, options);
  const input = useRef<HTMLInputElement>(null); const [items, setItems] = useState<JsonObject[]>([]); const [loading, setLoading] = useState(true); const [uploading, setUploading] = useState(false); const [error, setError] = useState('');
  const load = useCallback(async () => { setLoading(true); setError(''); try { setItems(objectList(responseData(await listSkills()), ['skills', 'items', 'data'])); } catch (cause) { setError(errorMessage(cause, e('messages.operationFailed'))); } finally { setLoading(false); } }, [t]);
  useEffect(() => { void load(); }, [load]);
  const upload = async (event: ChangeEvent<HTMLInputElement>) => { const files = Array.from(event.target.files || []); event.target.value = ''; if (!files.length) return; setUploading(true); try { await uploadSkillsBatch({ body: { files } }); toast.success(e('skills.batchResultSummary', { total: files.length, success: files.length })); await load(); } catch (cause) { toast.error(errorMessage(cause, e('messages.operationFailed'))); } finally { setUploading(false); } };
  const toggle = async (item: JsonObject) => { const name = recordId(item, 'name', 'skill_name', 'id'); try { await updateSkillByName({ body: { skill_name: name, enabled: item.enabled === false, active: item.enabled === false } }); await load(); } catch (cause) { toast.error(errorMessage(cause, e('messages.operationFailed'))); } };
  const remove = async (item: JsonObject) => { const name = recordId(item, 'name', 'skill_name', 'id'); if (!name || !await confirmAction({ danger: true, title: e('buttons.uninstall'), message: name })) return; try { await deleteSkillByName({ query: { skill_name: name } }); toast.success(e('messages.deleteSuccess')); await load(); } catch (cause) { toast.error(errorMessage(cause, e('messages.operationFailed'))); } };
  return <section className="extension-section"><header className="extension-section__header"><div><h2>{e('tabs.skills')}</h2><p>{e('skills.runtimeHint')}</p></div><div><button onClick={() => void load()} type="button"><MdiIcon name="mdi-refresh" />{e('skills.refresh')}</button><input accept=".zip,application/zip" hidden multiple onChange={(event) => void upload(event)} ref={input} type="file" /><button className="button--primary" disabled={uploading} onClick={() => input.current?.click()} type="button"><MdiIcon name="mdi-upload" />{uploading ? e('skills.uploading') : e('skills.upload')}</button></div></header><SectionState error={error} loading={loading} /><div className="extension-card-grid">{items.map((item, index) => { const name = recordId(item, 'name', 'skill_name', 'id') || `skill-${index}`; return <article className="extension-resource-card" key={name}><header><MdiIcon name="mdi-lightning-bolt" /><div><h3>{String(item.display_name || name)}</h3><p>{String(item.description || item.source || '')}</p></div><label className="config-toggle"><input checked={(item.enabled ?? item.active) !== false} onChange={() => void toggle(item)} type="checkbox" /></label></header><div><button className="button--danger" onClick={() => void remove(item)} type="button">{e('buttons.uninstall')}</button></div></article>; })}</div>{!loading && !items.length && <div className="monitor-empty"><h3>{e('skills.empty')}</h3><p>{e('skills.emptyHint')}</p></div>}</section>;
}
