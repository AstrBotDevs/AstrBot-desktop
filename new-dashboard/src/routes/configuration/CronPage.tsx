import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { confirmAction, toast } from '@/stores/feedback';
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
    if (!id || !await confirmAction({ danger: true, title: k('actions.delete'), message: `${k('actions.delete')} ${String(job.name || id)}?` })) return;
    try { await deleteCronJob({ path: { job_id: id } }); setJobs((current) => current.filter((item) => recordId(item, 'job_id', 'id') !== id)); toast.success(k('messages.deleteSuccess')); }
    catch (cause) { toast.error(errorMessage(cause, k('messages.deleteFailed'))); }
  };

  const selectedUmoInfo = form.session ? (umoInfo[form.session] ?? parseUmo(form.session)) : null;

  return <div className="cron-page-react">
    <div className="cron-page-react__inner">
      <header className="cron-header-react"><div><h1>{k('page.title')}</h1><p>{k('page.subtitle')} <button onClick={() => setPlatformDialog(true)} type="button">{k('page.proactive.link')}</button></p></div><div><button disabled={loading} onClick={() => void loadJobs()} type="button"><MdiIcon className={loading ? 'mdi-spin' : ''} name="mdi-refresh" />{k('actions.refresh')}</button><button className="button--primary" onClick={openCreate} type="button"><MdiIcon name="mdi-plus" />{k('actions.create')}</button></div></header>

      <section className="cron-task-surface">
        {jobs.length > 0 && <div className="cron-filters"><label><MdiIcon name="mdi-magnify" /><input onChange={(event) => setSearch(event.target.value)} placeholder={k('filters.search')} value={search} /></label><label><MdiIcon name="mdi-send-outline" /><select onChange={(event) => setTargetFilter(event.target.value)} value={targetFilter}><option value="">{k('filters.umo')}</option>{jobs.some((job) => !jobSession(job)) && <option value={NO_DELIVERY_TARGET}>{k('filters.noDeliveryTarget')}</option>}{targets.map((target) => <option key={target} value={target}>{target}</option>)}</select></label></div>}
        {error && <div className="monitor-error" role="alert">{error}</div>}
        {loading && jobs.length === 0 ? <div className="monitor-loading"><MdiIcon className="mdi-spin" name="mdi-loading" /></div> : jobs.length === 0 ? <div className="cron-empty"><MdiIcon name="mdi-calendar-blank-outline" /><p>{k('table.empty')}</p><button className="button--primary" onClick={openCreate} type="button"><MdiIcon name="mdi-plus" />{k('actions.create')}</button></div> : visibleJobs.length === 0 ? <div className="cron-empty"><MdiIcon name="mdi-file-search-outline" /><p>{k('filters.noMatches')}</p></div> : <div className="cron-task-list">{visibleJobs.map((job, index) => {
          const id = recordId(job, 'job_id', 'id') || `job-${index}`;
          const target = jobSession(job);
          const runLabel = job.run_once ? k('card.runAt', { time: formatTime(job.run_at) }) : k('card.nextRun', { time: formatTime(job.next_run_time) });
          return <article className={`cron-task${job.enabled === false ? ' is-disabled' : ''}`} key={id} onClick={() => openEdit(job)}><div className="cron-task__body"><header><h2>{String(job.name || k('table.notAvailable'))}</h2><span className={job.run_once ? 'is-once' : ''}>{scheduleLabel(job)}</span></header><p>{String(job.note || job.description || id)}</p><footer><span title={target}><MdiIcon name="mdi-send-outline" />{target || k('card.noDeliveryTarget')}</span><span title={`${k('table.headers.lastRun')}: ${formatTime(job.last_run_at)}${job.last_error ? ` · ${String(job.last_error)}` : ''}`}><MdiIcon name="mdi-clock-time-four-outline" />{runLabel}</span></footer></div><div className="cron-task__controls" onClick={(event) => event.stopPropagation()}><label className="cron-switch" title={k('form.enabled')}><input checked={job.enabled !== false} onChange={() => void toggleJob(job)} type="checkbox" /><span /></label><details className="cron-action-menu"><summary aria-label={k('actions.more')} title={k('actions.more')}><MdiIcon name="mdi-dots-horizontal" /></summary><div><button onClick={() => openEdit(job)} type="button"><MdiIcon name="mdi-pencil-outline" />{k('actions.edit')}</button><button disabled={runningIds.has(id)} onClick={() => void runNow(job)} type="button"><MdiIcon className={runningIds.has(id) ? 'mdi-spin' : ''} name={runningIds.has(id) ? 'mdi-loading' : 'mdi-play-circle-outline'} />{k('actions.runNow')}</button><button className="button--danger" onClick={() => void remove(job)} type="button"><MdiIcon name="mdi-delete-outline" />{k('actions.delete')}</button></div></details></div></article>;
        })}</div>}
      </section>
    </div>

    <Dialog onOpenChange={setPlatformDialog} open={platformDialog} title={k('platformDialog.title')}><div className="cron-platform-dialog"><p>{k('platformDialog.description')}</p>{platforms.length ? <div>{platforms.map((platform) => <article key={platform.id}><strong>{platform.displayName || platform.name || platform.id}</strong><span>{platform.id}</span></article>)}</div> : <div className="monitor-empty">{k('page.proactive.unsupported')}</div>}<div className="dialog-actions"><DialogClose asChild><button type="button">{k('actions.close')}</button></DialogClose></div></div></Dialog>

    <Dialog onOpenChange={(open) => { setFormOpen(open); if (!open) setEditingId(''); }} open={formOpen} title={k(editingId ? 'form.editTitle' : 'form.title')}><form className="cron-form" onSubmit={(event) => { event.preventDefault(); void save(); }}><p className="cron-form__hint"><MdiIcon name="mdi-information-outline" />{k('form.chatHint')}</p><label><span>{k('form.name')}</span><input autoFocus onChange={(event) => updateForm('name', event.target.value)} value={form.name} /></label><label><span>{k('form.note')}</span><textarea onChange={(event) => updateForm('note', event.target.value)} rows={4} value={form.note} /></label><div className="cron-form__schedule"><label><span>{k('form.scheduleMode')}</span><select onChange={(event) => updateForm('scheduleMode', event.target.value as ScheduleMode)} value={form.scheduleMode}>{(['once', 'interval', 'daily', 'weekly', 'monthly', 'cron'] as ScheduleMode[]).map((mode) => <option key={mode} value={mode}>{k(`form.scheduleModes.${mode}`)}</option>)}</select></label><ScheduleFields form={form} k={k} updateForm={updateForm} /></div><label><span>{k('form.session')}</span><input list="cron-umo-options" onFocus={() => void loadUmos()} onChange={(event) => updateForm('session', event.target.value)} placeholder={loadingUmos ? k('actions.refresh') : k('form.noUmos')} value={form.session} /><datalist id="cron-umo-options">{availableUmos.map((umo) => <option key={umo} value={umo}>{umoInfo[umo]?.user_alias || umoInfo[umo]?.auto_name || umo}</option>)}</datalist>{selectedUmoInfo && <small><span>{selectedUmoInfo.platform || k('table.notAvailable')}</span>{selectedUmoInfo.user_alias || selectedUmoInfo.auto_name || selectedUmoInfo.session_id || form.session}</small>}</label><label><span>{k('form.timezone')}</span><input onChange={(event) => updateForm('timezone', event.target.value)} placeholder="Asia/Shanghai" value={form.timezone} /></label><label className="cron-form__enabled"><span>{k('form.enabled')}</span><span className="cron-switch"><input checked={form.enabled} onChange={(event) => updateForm('enabled', event.target.checked)} type="checkbox" /><span /></span></label><div className="dialog-actions"><DialogClose asChild><button type="button">{k('actions.cancel')}</button></DialogClose><button className="button--primary" disabled={saving} type="submit">{k(editingId ? 'actions.save' : 'actions.submit')}</button></div></form></Dialog>
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
