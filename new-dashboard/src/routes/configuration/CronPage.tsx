import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  createCronJob,
  deleteCronJob,
  listActiveUmos,
  listBotStats,
  listCronJobs,
  runCronJob,
  updateCronJob,
} from '@/api/openapi';
import { Dialog, DialogClose } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { Menu, MenuItem } from '@/components/headless/Menu';
import { toast } from '@/stores/feedback';
import {
  buildCronExpression,
  cronFormFromJob,
  cronPayload,
  EMPTY_CRON_FORM,
  jobSession,
  scheduleDescriptor,
  timeValue,
  type CronForm,
  type IntervalUnit,
  type ScheduleMode,
} from './cronModel';
import { errorMessage, isObject, type JsonObject, objectList, recordId, responseData } from './model';

type UmoInfo = {
  umo: string;
  platform?: string;
  message_type?: string;
  session_id?: string;
  auto_name?: string;
  user_alias?: string;
  display_name?: string;
};

type ProactivePlatform = { id: string; name: string; displayName?: string };

const NO_DELIVERY_TARGET = '__astrbot_no_delivery_target__';

function parseUmo(umo: string): UmoInfo {
  const [platform = '', messageType = '', ...sessionParts] = umo.split(':');
  return { umo, platform, message_type: messageType, session_id: sessionParts.join(':') || umo, display_name: umo };
}

function umoName(info: UmoInfo) {
  if (info.user_alias && info.auto_name && info.user_alias !== info.auto_name) {
    return `${info.user_alias}（${info.auto_name}）`;
  }
  return info.user_alias || info.auto_name || info.display_name || info.umo;
}

function UmoSummary({ info }: { info: UmoInfo }) {
  return <span className="cron-umo-summary">
    <strong>{umoName(info)}</strong>
    {info.platform && <em>{info.platform}</em>}
    <small>{info.session_id || info.umo}</small>
  </span>;
}

function CronUmoSelect({
  emptyText,
  infoMap,
  label,
  loading,
  onChange,
  onOpen,
  options,
  value,
}: {
  emptyText: string;
  infoMap: Record<string, UmoInfo>;
  label: string;
  loading: boolean;
  onChange: (value: string) => void;
  onOpen: () => void;
  options: string[];
  value: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = value ? (infoMap[value] ?? parseUmo(value)) : null;
  const filtered = options.filter((umo) => {
    const search = query.trim().toLowerCase();
    if (!search) return true;
    const info = infoMap[umo] ?? parseUmo(umo);
    return umo.toLowerCase().includes(search) || umoName(info).toLowerCase().includes(search);
  });

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  return <div className="cron-form__field">
    <span>{label}</span>
    <div className="cron-umo-select" ref={rootRef}>
      <button aria-expanded={open} aria-haspopup="listbox" className="cron-umo-select__control" onClick={() => {
        setOpen((current) => !current);
        setQuery('');
        onOpen();
      }} type="button">
        {selected ? <UmoSummary info={selected} /> : <span>{loading ? '…' : emptyText}</span>}
        <MdiIcon name={open ? 'mdi-chevron-up' : 'mdi-chevron-down'} />
      </button>
      {value && <button aria-label={t('features.cron.actions.clear')} className="cron-umo-select__clear" onClick={() => onChange('')} type="button"><MdiIcon name="mdi-close" /></button>}
      {open && <div className="cron-umo-select__menu">
        <label><MdiIcon name="mdi-magnify" /><input autoFocus onChange={(event) => setQuery(event.target.value)} value={query} /></label>
        <div role="listbox">
          {filtered.map((umo) => <button aria-selected={umo === value} key={umo} onClick={() => { onChange(umo); setOpen(false); }} role="option" type="button"><UmoSummary info={infoMap[umo] ?? parseUmo(umo)} />{umo === value && <MdiIcon name="mdi-check" />}</button>)}
          {!loading && filtered.length === 0 && <p>{emptyText}</p>}
        </div>
      </div>}
    </div>
  </div>;
}

export default function CronPage() {
  const { i18n, t } = useTranslation();
  const prefix = 'features.cron';
  const k = (key: string, values?: Record<string, unknown>) => t(`${prefix}.${key}`, values);
  const [jobs, setJobs] = useState<JsonObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [targetFilter, setTargetFilter] = useState('');
  const [editingId, setEditingId] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<CronForm>({ ...EMPTY_CRON_FORM });
  const [saving, setSaving] = useState(false);
  const [runningIds, setRunningIds] = useState(() => new Set<string>());
  const [availableUmos, setAvailableUmos] = useState<string[]>([]);
  const [umoInfo, setUmoInfo] = useState<Record<string, UmoInfo>>({});
  const [loadingUmos, setLoadingUmos] = useState(false);
  const [platforms, setPlatforms] = useState<ProactivePlatform[]>([]);
  const [platformDialog, setPlatformDialog] = useState(false);

  const mergeUmoInfo = useCallback((infos: UmoInfo[]) => {
    setUmoInfo((current) => {
      const next = { ...current };
      infos.forEach((info) => { if (info.umo) next[info.umo] = { ...(next[info.umo] ?? {}), ...info }; });
      return next;
    });
  }, []);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = objectList(responseData(await listCronJobs()), ['jobs', 'cron_jobs', 'items']).map((job) => ({
        ...job,
        session: jobSession(job),
      }));
      setJobs(next);
      mergeUmoInfo(next.map(jobSession).filter(Boolean).map(parseUmo));
    } catch (cause) {
      setError(errorMessage(cause, k('messages.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [mergeUmoInfo, t]);

  const loadPlatforms = useCallback(async () => {
    try {
      const next = objectList(responseData(await listBotStats()), ['platforms']).flatMap((platform) => {
        const meta = isObject(platform.meta) ? platform.meta : {};
        if (!meta.support_proactive_message) return [];
        return [{
          id: String(platform.id || meta.id || 'unknown'),
          name: String(meta.name || platform.type || ''),
          displayName: String(meta.display_name || platform.display_name || ''),
        }];
      });
      setPlatforms(next);
    } catch { /* Platform support is supplementary. */ }
  }, []);

  const loadUmos = useCallback(async (force = false) => {
    if (loadingUmos || (!force && availableUmos.length)) return;
    setLoadingUmos(true);
    try {
      const data = responseData<{ umos?: string[]; umo_infos?: UmoInfo[] }>(await listActiveUmos());
      const loaded = Array.isArray(data?.umos) ? data.umos : [];
      setAvailableUmos((current) => Array.from(new Set([...current, ...loaded])));
      mergeUmoInfo(Array.isArray(data?.umo_infos) ? data.umo_infos : []);
    } catch { /* The delivery target remains manually editable. */ }
    finally { setLoadingUmos(false); }
  }, [availableUmos.length, loadingUmos, mergeUmoInfo]);

  useEffect(() => { void loadJobs(); void loadPlatforms(); }, [loadJobs, loadPlatforms]);

  const targets = useMemo(() => Array.from(new Set(jobs.map(jobSession).filter(Boolean))).sort(), [jobs]);
  const visibleJobs = useMemo(() => {
    const query = search.trim().toLowerCase();
    return jobs.filter((job) => {
      const target = jobSession(job);
      if (targetFilter === NO_DELIVERY_TARGET && target) return false;
      if (targetFilter && targetFilter !== NO_DELIVERY_TARGET && target !== targetFilter) return false;
      if (!query) return true;
      return String(job.name || '').toLowerCase().includes(query)
        || String(job.note || job.description || '').toLowerCase().includes(query);
    }).sort((left, right) => {
      if ((left.enabled !== false) !== (right.enabled !== false)) return left.enabled === false ? 1 : -1;
      const leftTime = timeValue(left.next_run_time || left.run_at);
      const rightTime = timeValue(right.next_run_time || right.run_at);
      if (leftTime !== rightTime) {
        if (!leftTime) return 1;
        if (!rightTime) return -1;
        return leftTime - rightTime;
      }
      return String(left.name || '').localeCompare(String(right.name || ''));
    });
  }, [jobs, search, targetFilter]);

  const formatTime = (value: unknown, fallback = k('table.notAvailable')) => {
    if (!value) return fallback;
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString(i18n.language);
  };
  const weekday = (value: number) => k(`form.weekdays.${['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][value]}`);
  const scheduleLabel = (job: JsonObject) => {
    const descriptor = scheduleDescriptor(job);
    if (descriptor.kind === 'once') return k('card.onceAt', { time: formatTime(descriptor.values.time) });
    if (descriptor.kind === 'minutes') return k('card.everyMinutes', descriptor.values);
    if (descriptor.kind === 'hours') return k('card.everyHours', descriptor.values);
    if (descriptor.kind === 'days') return k('card.everyDays', descriptor.values);
    if (descriptor.kind === 'daily') return k('card.dailyAt', descriptor.values);
    if (descriptor.kind === 'weekly') return k('card.weeklyAt', { ...descriptor.values, day: weekday(Number(descriptor.values.day)) });
    if (descriptor.kind === 'monthly') return k('card.monthlyAt', descriptor.values);
    return k('card.customCron', descriptor.values);
  };
  const taskPreview = (job: JsonObject) => {
    const value = String(job.note || job.description || '').trim();
    if (!value) return recordId(job, 'job_id', 'id') || k('table.notAvailable');
    return value.length > 86 ? `${value.slice(0, 86)}...` : value;
  };

  const openCreate = () => {
    setEditingId('');
    setForm({ ...EMPTY_CRON_FORM });
    setFormOpen(true);
    void loadUmos();
  };
  const openEdit = (job: JsonObject) => {
    const id = recordId(job, 'job_id', 'id');
    const target = jobSession(job);
    setEditingId(id);
    setForm(cronFormFromJob(job));
    if (target) {
      setAvailableUmos((current) => current.includes(target) ? current : [target, ...current]);
      mergeUmoInfo([parseUmo(target)]);
    }
    setFormOpen(true);
    void loadUmos(true);
  };
  const updateForm = <Key extends keyof CronForm>(key: Key, value: CronForm[Key]) => setForm((current) => ({ ...current, [key]: value }));

  const validate = () => {
    if (!form.name.trim()) return k('messages.nameRequired');
    if (!form.note.trim()) return k('messages.noteRequired');
    if (form.scheduleMode === 'once' && !form.runAt) return k('messages.runAtRequired');
    if (form.scheduleMode === 'interval' && (!Number.isInteger(Number(form.intervalValue)) || Number(form.intervalValue) < 1)) return k('messages.intervalRequired');
    if (form.scheduleMode === 'daily' && !buildCronExpression(form)) return k('messages.dailyTimeRequired');
    if (form.scheduleMode === 'weekly' && !buildCronExpression(form)) return k('messages.weeklyTimeRequired');
    if (form.scheduleMode === 'monthly' && (!buildCronExpression(form) || form.monthlyDay < 1 || form.monthlyDay > 31)) return k('messages.monthlyTimeRequired');
    if (form.scheduleMode === 'cron' && !form.cronExpression.trim()) return k('messages.cronRequired');
    return '';
  };

  const save = async () => {
    const validationError = validate();
    if (validationError) { toast.warning(validationError); return; }
    setSaving(true);
    try {
      const payload = cronPayload(form);
      if (editingId) await updateCronJob({ path: { job_id: editingId }, body: { ...payload, description: form.note } });
      else await createCronJob({ body: payload });
      toast.success(k(editingId ? 'messages.updateSuccess' : 'messages.createSuccess'));
      setFormOpen(false);
      setEditingId('');
      await loadJobs();
    } catch (cause) {
      toast.error(errorMessage(cause, k(editingId ? 'messages.updateFailed' : 'messages.createFailed')));
    } finally { setSaving(false); }
  };

  const toggleJob = async (job: JsonObject) => {
    const id = recordId(job, 'job_id', 'id');
    if (!id) return;
    setJobs((current) => current.map((item) => recordId(item, 'job_id', 'id') === id ? { ...item, enabled: job.enabled === false } : item));
    try { await updateCronJob({ path: { job_id: id }, body: { enabled: job.enabled === false } }); }
    catch (cause) { toast.error(errorMessage(cause, k('messages.updateFailed'))); await loadJobs(); }
  };
  const runNow = async (job: JsonObject) => {
    const id = recordId(job, 'job_id', 'id');
    if (!id || runningIds.has(id)) return;
    setRunningIds((current) => new Set(current).add(id));
    try { await runCronJob({ path: { job_id: id } }); toast.success(k('messages.runStarted')); await loadJobs(); }
    catch (cause) { toast.error(errorMessage(cause, k('messages.runFailed'))); }
    finally { setRunningIds((current) => { const next = new Set(current); next.delete(id); return next; }); }
  };
  const remove = async (job: JsonObject) => {
    const id = recordId(job, 'job_id', 'id');
    if (!id) return;
    try { await deleteCronJob({ path: { job_id: id } }); setJobs((current) => current.filter((item) => recordId(item, 'job_id', 'id') !== id)); toast.success(k('messages.deleteSuccess')); }
    catch (cause) { toast.error(errorMessage(cause, k('messages.deleteFailed'))); }
  };

  return <div className="cron-page-react">
    <div className="cron-page-react__inner">
      <header className="cron-header-react"><div><h1>{k('page.title')}</h1><p>{k('page.subtitle')} <button onClick={() => setPlatformDialog(true)} type="button">{k('page.proactive.link')}</button></p></div><div><button disabled={loading} onClick={() => void loadJobs()} type="button"><MdiIcon className={loading ? 'mdi-spin' : ''} name="mdi-refresh" />{k('actions.refresh')}</button><button className="button--primary" onClick={openCreate} type="button"><MdiIcon name="mdi-plus" />{k('actions.create')}</button></div></header>

      <section className="cron-task-surface">
        {jobs.length > 0 && <div className="cron-filters"><label><MdiIcon name="mdi-magnify" /><input onChange={(event) => setSearch(event.target.value)} placeholder={k('filters.search')} value={search} /></label><label><MdiIcon name="mdi-send-outline" /><select onChange={(event) => setTargetFilter(event.target.value)} value={targetFilter}><option value="">{k('filters.umo')}</option>{jobs.some((job) => !jobSession(job)) && <option value={NO_DELIVERY_TARGET}>{k('filters.noDeliveryTarget')}</option>}{targets.map((target) => <option key={target} value={target}>{target}</option>)}</select></label></div>}
        {error && <div className="monitor-error" role="alert">{error}</div>}
        {loading && jobs.length === 0 ? <div className="cron-loading"><span /></div> : jobs.length === 0 ? <div className="cron-empty"><MdiIcon name="mdi-calendar-blank-outline" /><p>{k('table.empty')}</p></div> : visibleJobs.length === 0 ? <div className="cron-empty"><MdiIcon name="mdi-file-search-outline" /><p>{k('filters.noMatches')}</p></div> : <div className="cron-task-list">{visibleJobs.map((job, index) => {
          const id = recordId(job, 'job_id', 'id') || `job-${index}`;
          const target = jobSession(job);
          const runLabel = job.run_once ? k('card.runAt', { time: formatTime(job.run_at) }) : k('card.nextRun', { time: formatTime(job.next_run_time) });
          return <article className={`cron-task${job.enabled === false ? ' is-disabled' : ''}`} key={id} onClick={() => openEdit(job)}><div className="cron-task__body"><header><h2>{String(job.name || k('table.notAvailable'))}</h2><span className={job.run_once ? 'is-once' : ''}>{scheduleLabel(job)}</span></header><p>{taskPreview(job)}</p><footer><span title={target}><MdiIcon name="mdi-send-outline" />{target || k('card.noDeliveryTarget')}</span><span title={`${k('table.headers.lastRun')}: ${formatTime(job.last_run_at)}${job.last_error ? ` · ${String(job.last_error)}` : ''}`}><MdiIcon name="mdi-clock-time-four-outline" />{runLabel}</span></footer></div><div className="cron-task__controls" onClick={(event) => event.stopPropagation()}><Menu className="cron-action-menu" label={k('actions.more')} trigger={(props) => <button {...props} aria-label={k('actions.more')} className="cron-action-menu__trigger" title={k('actions.more')} type="button"><MdiIcon name="mdi-dots-horizontal" /></button>}><MenuItem onSelect={() => openEdit(job)}><span className="headless-menu__item-label"><MdiIcon name="mdi-pencil-outline" />{k('actions.edit')}</span></MenuItem><MenuItem disabled={runningIds.has(id)} onSelect={() => void runNow(job)}><span className="headless-menu__item-label"><MdiIcon className={runningIds.has(id) ? 'mdi-spin' : ''} name={runningIds.has(id) ? 'mdi-loading' : 'mdi-play-circle-outline'} />{k('actions.runNow')}</span></MenuItem><MenuItem onSelect={() => void remove(job)}><span className="headless-menu__item-label cron-action-menu__danger"><MdiIcon name="mdi-delete-outline" />{k('actions.delete')}</span></MenuItem></Menu><label className="cron-switch" title={k('form.enabled')}><input checked={job.enabled !== false} onChange={() => void toggleJob(job)} type="checkbox" /><span /></label></div></article>;
        })}</div>}
      </section>
    </div>

    <Dialog onOpenChange={setPlatformDialog} open={platformDialog} title={k('platformDialog.title')}><div className="cron-platform-dialog"><p>{k('platformDialog.description')}</p>{platforms.length ? <div>{platforms.map((platform) => <article key={platform.id}><strong>{platform.displayName || platform.name || platform.id}</strong><span>{platform.id}</span></article>)}</div> : <div className="monitor-empty">{k('page.proactive.unsupported')}</div>}<div className="dialog-actions"><DialogClose asChild><button type="button">{k('actions.close')}</button></DialogClose></div></div></Dialog>

    <Dialog onOpenChange={(open) => { setFormOpen(open); if (!open) setEditingId(''); }} open={formOpen} title={k(editingId ? 'form.editTitle' : 'form.title')}><form className="cron-form" onSubmit={(event) => { event.preventDefault(); void save(); }}><label><span>{k('form.name')}</span><input autoFocus onChange={(event) => updateForm('name', event.target.value)} value={form.name} /></label><label><span>{k('form.note')}</span><textarea onChange={(event) => updateForm('note', event.target.value)} rows={5} value={form.note} /></label><div className="cron-form__schedule"><label><span>{k('form.scheduleMode')}</span><select onChange={(event) => updateForm('scheduleMode', event.target.value as ScheduleMode)} value={form.scheduleMode}>{(['once', 'interval', 'daily', 'weekly', 'monthly', 'cron'] as ScheduleMode[]).map((mode) => <option key={mode} value={mode}>{k(`form.scheduleModes.${mode}`)}</option>)}</select></label><ScheduleFields form={form} k={k} updateForm={updateForm} /></div><CronUmoSelect emptyText={k('form.noUmos')} infoMap={umoInfo} label={k('form.session')} loading={loadingUmos} onChange={(value) => updateForm('session', value)} onOpen={() => void loadUmos()} options={availableUmos} value={form.session} /><div className="dialog-actions"><DialogClose asChild><button type="button">{k('actions.cancel')}</button></DialogClose><button className="button--primary" disabled={saving} type="submit">{k(editingId ? 'actions.save' : 'actions.submit')}</button></div></form></Dialog>
  </div>;
}

type ScheduleFieldsProps = {
  form: CronForm;
  k: (key: string, values?: Record<string, unknown>) => string;
  updateForm: <Key extends keyof CronForm>(key: Key, value: CronForm[Key]) => void;
};

function ScheduleFields({ form, k, updateForm }: ScheduleFieldsProps) {
  if (form.scheduleMode === 'once') return <label><span>{k('form.runAt')}</span><input onChange={(event) => updateForm('runAt', event.target.value)} type="datetime-local" value={form.runAt} /></label>;
  if (form.scheduleMode === 'interval') return <div className="cron-form__inline"><label><span>{k('form.intervalEvery')}</span><input min={1} onChange={(event) => updateForm('intervalValue', Number(event.target.value))} type="number" value={form.intervalValue} /></label><label><span>{k('form.intervalUnit')}</span><select onChange={(event) => updateForm('intervalUnit', event.target.value as IntervalUnit)} value={form.intervalUnit}>{(['minutes', 'hours', 'days'] as IntervalUnit[]).map((unit) => <option key={unit} value={unit}>{k(`form.intervalUnits.${unit}`)}</option>)}</select></label></div>;
  if (form.scheduleMode === 'daily') return <label><span>{k('form.dailyTime')}</span><input onChange={(event) => updateForm('dailyTime', event.target.value)} type="time" value={form.dailyTime} /></label>;
  if (form.scheduleMode === 'weekly') return <div className="cron-form__inline"><label><span>{k('form.weeklyDay')}</span><select onChange={(event) => updateForm('weeklyDay', Number(event.target.value))} value={form.weeklyDay}>{['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map((day, index) => <option key={day} value={index}>{k(`form.weekdays.${day}`)}</option>)}</select></label><label><span>{k('form.weeklyTime')}</span><input onChange={(event) => updateForm('weeklyTime', event.target.value)} type="time" value={form.weeklyTime} /></label></div>;
  if (form.scheduleMode === 'monthly') return <div className="cron-form__inline"><label><span>{k('form.monthlyDay')}</span><input max={31} min={1} onChange={(event) => updateForm('monthlyDay', Number(event.target.value))} type="number" value={form.monthlyDay} /></label><label><span>{k('form.monthlyTime')}</span><input onChange={(event) => updateForm('monthlyTime', event.target.value)} type="time" value={form.monthlyTime} /></label></div>;
  return <label><span>{k('form.cron')}</span><input onChange={(event) => updateForm('cronExpression', event.target.value)} placeholder={k('form.cronPlaceholder')} value={form.cronExpression} /></label>;
}
