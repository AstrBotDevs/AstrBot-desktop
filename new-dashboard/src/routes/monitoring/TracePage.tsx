import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getTraceSettings, updateTraceSettings } from '@/api/openapi';
import { toast } from '@/stores/feedback';
import { formatTimestamp, unwrapData } from './model';
import { groupTraceEvents } from './traceModel';
import { useLogFeed } from './useLogFeed';

export default function TracePage() {
  const { i18n, t } = useTranslation();
  const predicate = useCallback((item: { type?: string }) => item.type === 'trace', []);
  const { items, status } = useLogFeed(predicate, 2000);
  const events = useMemo(() => groupTraceEvents(items), [items]);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set<string>());

  useEffect(() => {
    void getTraceSettings().then((response) => {
      const settings = unwrapData<{ enabled?: boolean; trace_enable?: boolean }>(response);
      setEnabled(settings?.enabled ?? settings?.trace_enable ?? true);
    }).catch(() => undefined);
  }, []);

  const setTraceEnabled = async (next: boolean) => {
    setEnabled(next);
    setSaving(true);
    try {
      await updateTraceSettings({ body: { enabled: next, trace_enable: next } });
    } catch (cause) {
      setEnabled(!next);
      toast.error(cause instanceof Error ? cause.message : 'Unable to update trace settings.');
    } finally { setSaving(false); }
  };
  const toggle = (span: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(span)) next.delete(span); else next.add(span);
    return next;
  });
  return (
    <div className="monitor-page trace-page">
      <header className="monitor-header"><div><h1>{t('features/trace.title')}</h1><p>{t('features/trace.hint')}</p></div><div className="monitor-actions"><span className={`stream-status stream-status--${status}`}>{status}</span><label><input checked={enabled} disabled={saving} onChange={(event) => void setTraceEnabled(event.target.checked)} type="checkbox" /> {t(`features/trace.${enabled ? 'recording' : 'paused'}`)}</label></div></header>
      <div className="monitor-table-wrap"><table className="monitor-table trace-table"><thead><tr><th>Time</th><th>Event ID</th><th>UMO</th><th>Sender</th><th>Outline</th><th /></tr></thead><tbody>
        {events.map((event) => <FragmentEvent event={event} expanded={expanded.has(event.spanId)} key={event.spanId} locale={i18n.language} toggle={toggle} />)}
      </tbody></table>{events.length === 0 && <div className="monitor-empty">No trace data yet.</div>}</div>
    </div>
  );
}

function FragmentEvent({ event, expanded, locale, toggle }: { event: ReturnType<typeof groupTraceEvents>[number]; expanded: boolean; locale: string; toggle: (span: string) => void }) {
  return <>
    <tr><td>{formatTimestamp(event.firstTime, locale)}</td><td title={event.spanId}>{event.spanId.slice(0, 8)}</td><td>{event.umo || '—'}</td><td>{event.senderName || '—'}</td><td>{event.messageOutline || '—'}</td><td><button onClick={() => toggle(event.spanId)} type="button">{expanded ? 'Collapse' : 'Expand'}</button></td></tr>
    {expanded && <tr className="trace-record-row"><td colSpan={6}><div className="trace-records">{event.records.map((record) => <div className="trace-record" key={record.key}><time>{formatTimestamp(record.time, locale)}</time><strong>{record.action}</strong><pre>{record.fields == null ? '' : JSON.stringify(record.fields, null, 2)}</pre></div>)}</div></td></tr>}
  </>;
}
