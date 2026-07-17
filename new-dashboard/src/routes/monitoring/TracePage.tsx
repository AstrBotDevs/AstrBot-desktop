import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getTraceSettings, updateTraceSettings } from '@/api/openapi';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { ExpandCollapse } from '@/components/motion/ExpandCollapse';
import { toast } from '@/stores/feedback';
import { unwrapData, type LogItem } from './model';
import { groupTraceEvents, type TraceEvent } from './traceModel';
import { useLogFeed } from './useLogFeed';

const initialVisibleRecords = 20;

export default function TracePage() {
  const { i18n, t } = useTranslation();
  const predicate = useCallback((item: LogItem) => item.type === 'trace', []);
  const [feedKey, setFeedKey] = useState(0);
  const { items } = useLogFeed(predicate, 2000, feedKey);
  const events = useMemo(() => groupTraceEvents(items), [items]);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set<string>());
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
  const [highlighted, setHighlighted] = useState(() => new Set<string>());
  const previousVersions = useRef(new Map<string, string>());
  const highlightTimers = useRef(new Map<string, number>());

  useEffect(() => {
    void getTraceSettings().then((response) => {
      const settings = unwrapData<{ enabled?: boolean; trace_enable?: boolean }>(response);
      setEnabled(settings?.trace_enable ?? settings?.enabled ?? true);
    }).catch(() => undefined);
  }, []);
  useEffect(() => {
    const versions = new Map<string, string>();
    const touched: string[] = [];
    events.forEach((event) => {
      const version = `${event.lastTime}:${event.records.length}`;
      versions.set(event.spanId, version);
      if (previousVersions.current.get(event.spanId) !== version) touched.push(event.spanId);
    });
    previousVersions.current = versions;
    if (!touched.length) return;
    setHighlighted((current) => new Set([...current, ...touched]));
    touched.forEach((spanId) => {
      const previous = highlightTimers.current.get(spanId);
      if (previous) window.clearTimeout(previous);
      const timer = window.setTimeout(() => {
        setHighlighted((current) => { const next = new Set(current); next.delete(spanId); return next; });
        highlightTimers.current.delete(spanId);
      }, 1200);
      highlightTimers.current.set(spanId, timer);
    });
  }, [events]);
  useEffect(() => () => { highlightTimers.current.forEach((timer) => window.clearTimeout(timer)); }, []);

  const setTraceEnabled = async (next: boolean) => {
    setEnabled(next);
    setSaving(true);
    try {
      await updateTraceSettings({ body: { trace_enable: next } });
      setFeedKey((current) => current + 1);
    } catch (cause) {
      setEnabled(!next);
      toast.error(cause instanceof Error ? cause.message : t('features.trace.updateFailed'));
    } finally { setSaving(false); }
  };
  const toggle = (span: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(span)) next.delete(span); else next.add(span);
    return next;
  });
  const showMore = (event: TraceEvent) => setVisibleCounts((current) => ({
    ...current,
    [event.spanId]: Math.min(event.records.length, (current[event.spanId] ?? initialVisibleRecords) + initialVisibleRecords),
  }));

  return (
    <div className="monitor-page trace-page">
      <header className="monitor-header trace-header-react"><div><h1>{t('features.trace.title')}</h1><p>{t('features.trace.hint')}</p></div><div className="monitor-actions trace-header-actions"><label className="trace-recording-switch"><span>{t(`features.trace.${enabled ? 'recording' : 'paused'}`)}</span><span className="dynamic-switch"><input checked={enabled} disabled={saving} onChange={(event) => void setTraceEnabled(event.target.checked)} type="checkbox" /><span className="dynamic-switch__track" /></span>{saving && <MdiIcon className="mdi-spin" name="mdi-loading" />}</label></div></header>
      <div className="trace-body-react">
        <div className="trace-table-react">
          <div className="trace-row-react trace-table-react__header"><div>{t('features.trace.columns.time')}</div><div>{t('features.trace.columns.eventId')}</div><div>{t('features.trace.columns.umo')}</div><div>{t('features.trace.columns.sender')}</div><div>{t('features.trace.columns.outline')}</div><div /></div>
          {events.map((event) => <TraceEventGroup event={event} expanded={expanded.has(event.spanId)} highlighted={highlighted.has(event.spanId)} key={event.spanId} locale={i18n.language} onShowMore={showMore} onToggle={toggle} visibleCount={visibleCounts[event.spanId] ?? initialVisibleRecords} />)}
          {events.length === 0 && <div className="trace-empty-react"><MdiIcon name="mdi-chart-timeline-variant-shimmer" /><strong>{t('features.trace.empty')}</strong></div>}
        </div>
      </div>
    </div>
  );
}

function TraceEventGroup({ event, expanded, highlighted, locale, onShowMore, onToggle, visibleCount }: { event: TraceEvent; expanded: boolean; highlighted: boolean; locale: string; onShowMore: (event: TraceEvent) => void; onToggle: (span: string) => void; visibleCount: number }) {
  const { t } = useTranslation();
  const visibleRecords = event.records.slice(0, visibleCount);
  return <section className={`trace-group-react${highlighted ? ' is-highlighted' : ''}`}>
    <div className="trace-row-react trace-event-react"><time>{formatTraceTimestamp(event.firstTime, locale)}</time><div className="trace-event-id" title={event.spanId}>{event.spanId.slice(0, 8)}</div><div title={event.umo || ''}>{event.umo || '—'}</div><div title={event.senderName || ''}>{event.senderName || '—'}</div><div className="trace-event-outline" title={event.messageOutline || ''}>{event.messageOutline || '—'}</div><div className="trace-event-controls"><button aria-expanded={expanded} onClick={() => onToggle(event.spanId)} type="button">{t(`features.trace.actions.${expanded ? 'collapse' : 'expand'}`)}{event.hasAgentPrepare && <span className="trace-agent-dot" title={t('features.trace.agentPrepared')} />}</button></div></div>
    <ExpandCollapse open={expanded}><div className="trace-records-react">{visibleRecords.map((record) => <div className="trace-record-react" key={record.key}><time>{formatTraceTimestamp(record.time, locale)}</time><strong>{record.action}</strong><pre>{record.fields == null ? '' : JSON.stringify(record.fields, null, 2)}</pre></div>)}{visibleCount < event.records.length && <div className="trace-show-more"><button onClick={() => onShowMore(event)} type="button"><MdiIcon name="mdi-chevron-down" />{t('features.trace.actions.showMore')}</button></div>}</div></ExpandCollapse>
  </section>;
}

function formatTraceTimestamp(value: number, locale: string) {
  if (!value) return '';
  const date = new Date(value < 10_000_000_000 ? value * 1000 : value);
  return `${date.toLocaleString(locale)}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}
