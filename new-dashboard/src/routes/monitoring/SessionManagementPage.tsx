import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { deleteSessionRules, listActiveUmos, listSessionGroups, listSessionRules, upsertSessionRule } from '@/api/openapi';
import { Dialog, DialogClose } from '@/components/headless/Dialog';
import { MonacoEditor } from '@/components/editor/MonacoEditor';
import { confirmAction, toast } from '@/stores/feedback';
import { unwrapData } from './model';

type SessionRule = {
  auto_name?: string;
  message_type?: string;
  platform?: string;
  rules?: Record<string, unknown>;
  session_id?: string;
  umo: string;
  user_alias?: string;
};
type SessionRulesData = { rules?: SessionRule[]; total?: number };
type SessionGroup = { id: string; name?: string; umo_count?: number; umos?: string[] };

export default function SessionManagementPage() {
  const { t } = useTranslation();
  const prefix = 'features.session-management';
  const [rules, setRules] = useState<SessionRule[]>([]);
  const [groups, setGroups] = useState<SessionGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(() => new Set<string>());
  const [detail, setDetail] = useState<SessionRule | null>(null);
  const [ruleJson, setRuleJson] = useState('{}');
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [availableUmos, setAvailableUmos] = useState<string[]>([]);
  const [newUmo, setNewUmo] = useState('');
  const [newRuleKey, setNewRuleKey] = useState('session_service_config');
  const [newRuleJson, setNewRuleJson] = useState('{}');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [ruleResponse, groupResponse] = await Promise.all([
        listSessionRules({ query: { page, page_size: pageSize, search: search.trim() || undefined } }),
        listSessionGroups(),
      ]);
      const data = unwrapData<SessionRulesData>(ruleResponse);
      const groupData = unwrapData<{ groups?: SessionGroup[] } | SessionGroup[]>(groupResponse);
      setRules(data?.rules ?? []); setTotal(data?.total ?? 0);
      setGroups(Array.isArray(groupData) ? groupData : groupData?.groups ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t(`${prefix}.messages.loadError`)); }
    finally { setLoading(false); }
  }, [page, pageSize, search, t]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 300); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    if (detail) setRuleJson(JSON.stringify(detail.rules ?? {}, null, 2));
  }, [detail]);

  const remove = async (umos: string[]) => {
    if (!umos.length || !await confirmAction({ danger: true, message: t(`${prefix}.batchDeleteConfirm.message`, { count: umos.length }), title: t(`${prefix}.deleteConfirm.title`) })) return;
    try {
      await deleteSessionRules({ body: { umos } });
      toast.success(t(`${prefix}.messages.batchDeleteSuccess`)); setSelected(new Set()); await load();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : t(`${prefix}.messages.batchDeleteError`)); }
  };
  const toggle = (umo: string) => setSelected((current) => { const next = new Set(current); if (next.has(umo)) next.delete(umo); else next.add(umo); return next; });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selectedRules = useMemo(() => rules.filter((rule) => selected.has(rule.umo)), [rules, selected]);

  const saveRules = async () => {
    if (!detail) return;
    let next: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(ruleJson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Rules must be a JSON object.');
      next = parsed as Record<string, unknown>;
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t(`${prefix}.messages.saveError`));
      return;
    }
    setSaving(true);
    try {
      await Promise.all(Object.entries(next).map(([ruleKey, ruleValue]) => upsertSessionRule({
        body: { rule_key: ruleKey, rule_value: ruleValue as Record<string, unknown>, umo: detail.umo },
      })));
      const removed = Object.keys(detail.rules ?? {}).filter((key) => !(key in next));
      await Promise.all(removed.map((ruleKey) => deleteSessionRules({ body: { rule_key: ruleKey, umo: detail.umo } })));
      toast.success(t(`${prefix}.messages.saveSuccess`));
      setDetail(null);
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t(`${prefix}.messages.saveError`));
    } finally { setSaving(false); }
  };
  const openAddRule = async () => {
    setAddOpen(true);
    try {
      const data = unwrapData<{ umos?: string[] }>(await listActiveUmos());
      const existing = new Set(rules.map((rule) => rule.umo));
      setAvailableUmos((data?.umos ?? []).filter((umo) => !existing.has(umo)));
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : t(`${prefix}.messages.loadError`)); }
  };
  const addRule = async () => {
    if (!newUmo || !newRuleKey.trim()) return;
    let value: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(newRuleJson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Rule value must be a JSON object.');
      value = parsed as Record<string, unknown>;
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : t(`${prefix}.messages.saveError`)); return; }
    setSaving(true);
    try {
      await upsertSessionRule({ body: { rule_key: newRuleKey.trim(), rule_value: value, umo: newUmo } });
      toast.success(t(`${prefix}.messages.saveSuccess`)); setAddOpen(false); setNewUmo(''); setNewRuleJson('{}'); await load();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : t(`${prefix}.messages.saveError`)); }
    finally { setSaving(false); }
  };

  return <div className="monitor-page data-page">
    <header className="monitor-header"><div><h1>{t(`${prefix}.title`)}</h1><p>{t(`${prefix}.subtitle`)}</p></div><div className="monitor-actions"><a href="https://docs.astrbot.app/use/custom-rules.html" rel="noreferrer" target="_blank">?</a><button onClick={() => void openAddRule()} type="button">{t(`${prefix}.buttons.addRule`)}</button><button disabled={loading} onClick={() => void load()} type="button">{t(`${prefix}.buttons.refresh`)}</button></div></header>
    <section className="route-card"><div className="monitor-toolbar"><h2>{t(`${prefix}.customRules.title`)} <small>{total} {t(`${prefix}.customRules.rulesCount`)}</small></h2><div className="data-filters"><input onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={t(`${prefix}.search.placeholder`)} value={search} />{selectedRules.length > 0 && <button className="button--danger" onClick={() => void remove(selectedRules.map((rule) => rule.umo))} type="button">{t(`${prefix}.buttons.batchDelete`)} ({selectedRules.length})</button>}</div></div>
      {error && <div className="monitor-error" role="alert">{error}</div>}
      <div className="monitor-table-wrap"><table className="monitor-table"><thead><tr><th /><th>{t(`${prefix}.table.headers.umoInfo`)}</th><th>{t(`${prefix}.table.headers.rulesOverview`)}</th><th>{t(`${prefix}.table.headers.actions`)}</th></tr></thead><tbody>{rules.map((rule) => <tr key={rule.umo}><td><input checked={selected.has(rule.umo)} onChange={() => toggle(rule.umo)} type="checkbox" /></td><td><strong>{rule.user_alias || rule.auto_name || rule.umo}</strong><small>{rule.platform || ''} {rule.message_type || ''} {rule.session_id || ''}</small></td><td><div className="rule-chips">{Object.keys(rule.rules ?? {}).map((key) => <span key={key}>{key}</span>)}</div></td><td><button onClick={() => setDetail(rule)} type="button">{t(`${prefix}.buttons.editRule`)}</button><button className="button--danger" onClick={() => void remove([rule.umo])} type="button">{t(`${prefix}.buttons.deleteAllRules`)}</button></td></tr>)}</tbody></table>{!loading && rules.length === 0 && <div className="monitor-empty">{t(`${prefix}.customRules.noRules`)}</div>}</div>
      <div className="pagination"><label><select onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }} value={pageSize}>{[10, 20, 50].map((size) => <option key={size}>{size}</option>)}</select></label><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} type="button">‹</button><span>{page}/{totalPages}</span><button disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)} type="button">›</button></div>
    </section>
    <section className="route-card"><h2>{t(`${prefix}.groups.title`)} <small>{t(`${prefix}.groups.count`, { count: groups.length })}</small></h2><div className="group-grid">{groups.map((group) => <article key={group.id}><strong>{group.name || group.id}</strong><span>{t(`${prefix}.groups.sessionsCount`, { count: group.umo_count ?? group.umos?.length ?? 0 })}</span></article>)}</div>{groups.length === 0 && <div className="monitor-empty">{t(`${prefix}.groups.empty`)}</div>}</section>
    <Dialog onOpenChange={setAddOpen} open={addOpen} title={t(`${prefix}.addRule.title`)}><div className="dialog-form"><label>{t(`${prefix}.addRule.selectUmo`)}<select onChange={(event) => setNewUmo(event.target.value)} value={newUmo}><option value="">—</option>{availableUmos.map((umo) => <option key={umo} value={umo}>{umo}</option>)}</select></label><label>Rule key<input onChange={(event) => setNewRuleKey(event.target.value)} value={newRuleKey} /></label><label>Rule value<textarea onChange={(event) => setNewRuleJson(event.target.value)} rows={8} value={newRuleJson} /></label><div className="dialog-actions"><DialogClose asChild><button type="button">{t(`${prefix}.buttons.cancel`)}</button></DialogClose><button className="button--primary" disabled={saving || !newUmo} onClick={() => void addRule()} type="button">{t(`${prefix}.buttons.save`)}</button></div></div></Dialog>
    <Dialog onOpenChange={(open) => !open && setDetail(null)} open={Boolean(detail)} title={detail?.user_alias || detail?.auto_name || detail?.umo || ''}>
      <div className="json-editor"><MonacoEditor language="json" onChange={setRuleJson} value={ruleJson} /></div>
      <div className="dialog-actions"><DialogClose asChild><button type="button">{t(`${prefix}.buttons.cancel`)}</button></DialogClose><button className="button--primary" disabled={saving} onClick={() => void saveRules()} type="button">{t(`${prefix}.buttons.save`)}</button></div>
    </Dialog>
  </div>;
}
