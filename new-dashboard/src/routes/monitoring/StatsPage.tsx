import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getProviderTokenStats, getStats } from '@/api/openapi';
import { formatTimestamp, unwrapData } from './model';
import { formatRunningTime, makeSparklinePoints, type BaseStats, type ProviderStats, type TokenRange } from './statsModel';

export default function StatsPage() {
  const { i18n, t } = useTranslation();
  const [range, setRange] = useState<TokenRange>(1);
  const [base, setBase] = useState<BaseStats | null>(null);
  const [providers, setProviders] = useState<ProviderStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const prefix = 'features.stats';
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);

  const refresh = useCallback(async (selectedRange: TokenRange) => {
    try {
      setError('');
      const [baseResponse, providerResponse] = await Promise.all([
        getStats({ query: { offset_sec: selectedRange * 86_400 } }),
        getProviderTokenStats({ query: { days: selectedRange } }),
      ]);
      setBase(unwrapData<BaseStats>(baseResponse) ?? null);
      setProviders(unwrapData<ProviderStats>(providerResponse) ?? null);
      setUpdatedAt(new Date());
    } catch {
      setError(t(`${prefix}.errors.loadFailed`));
    } finally { setLoading(false); }
  }, [t]);
  useEffect(() => {
    void refresh(range);
    const timer = window.setInterval(() => void refresh(range), 60_000);
    return () => window.clearInterval(timer);
  }, [range, refresh]);

  const cards = [
    [t(`${prefix}.overviewCards.platformCount.label`), number.format(base?.platform_count ?? 0), t(`${prefix}.overviewCards.platformCount.note`)],
    [t(`${prefix}.overviewCards.messageCount.label`), number.format(base?.message_count ?? 0), t(`${prefix}.overviewCards.messageCount.note`)],
    [t(`${prefix}.overviewCards.todayModelCalls.label`), number.format(providers?.today_total_tokens ?? 0), t(`${prefix}.overviewCards.todayModelCalls.note`)],
    [t(`${prefix}.overviewCards.cpu.label`), `${base?.cpu_percent ?? 0}%`, t(`${prefix}.overviewCards.cpu.note`)],
    [t(`${prefix}.overviewCards.memory.label`), `${number.format(base?.memory?.process ?? 0)} MB`, t(`${prefix}.overviewCards.memory.note`, { systemMemory: `${number.format(base?.memory?.system ?? 0)} MB` })],
    [t(`${prefix}.overviewCards.uptime.label`), formatRunningTime(base?.running), t(`${prefix}.overviewCards.uptime.note`, { startTime: formatTimestamp(base?.start_time, i18n.language) })],
  ];
  const rangeLabel = t(`${prefix}.rangeLabels.${range === 1 ? 'oneDay' : range === 3 ? 'threeDays' : 'oneWeek'}`);
  return (
    <div className="monitor-page stats-page">
      <header className="monitor-header"><div><h1>{t(`${prefix}.header.title`)}</h1><p>{t(`${prefix}.header.subtitle`)}</p></div><div className="monitor-actions"><span>{updatedAt?.toLocaleTimeString(i18n.language) ?? t(`${prefix}.header.notUpdated`)}</span><button disabled={loading} onClick={() => void refresh(range)} type="button">↻</button></div></header>
      {error && <div className="monitor-error" role="alert">{error}</div>}
      {loading && !base ? <div className="monitor-loading">Loading…</div> : <>
        <div className="stats-overview">{cards.map(([label, value, note]) => <section className="stats-card" key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></section>)}</div>
        <div className="monitor-toolbar"><div><h2>{t(`${prefix}.messageOverview.title`)}</h2><p>{t(`${prefix}.messageOverview.subtitle`)}</p></div><div className="range-switch">{([1, 3, 7] as TokenRange[]).map((value) => <button aria-pressed={range === value} key={value} onClick={() => setRange(value)} type="button">{t(`${prefix}.ranges.${value === 1 ? 'oneDay' : value === 3 ? 'threeDays' : 'oneWeek'}`)}</button>)}</div></div>
        <div className="stats-grid"><SparklineCard points={makeSparklinePoints(base?.message_time_series ?? [])} title={t(`${prefix}.messageTrend.title`)} total={number.format(base?.message_count ?? 0)} /><Ranking items={(base?.platform ?? []).sort((a, b) => b.count - a.count).map((item) => [item.name, item.count])} title={t(`${prefix}.platformRanking.title`)} /></div>
        <div className="monitor-toolbar"><div><h2>{t(`${prefix}.modelCalls.title`)}</h2><p>{t(`${prefix}.modelCalls.subtitle`)}</p></div></div>
        <div className="stats-grid"><SparklineCard points={makeSparklinePoints(providers?.trend?.total_series ?? [])} title={t(`${prefix}.modelTrend.title`)} total={`${number.format(providers?.range_total_tokens ?? 0)} ${t(`${prefix}.units.tokens`)}`} /><section className="stats-card stats-metrics"><h3>{t(`${prefix}.modelTotal.title`, { range: rangeLabel })}</h3><strong>{number.format(providers?.range_total_tokens ?? 0)}</strong><span>{t(`${prefix}.modelTotal.callCount`, { count: number.format(providers?.range_total_calls ?? 0) })}</span><span>TTFT: {providers?.range_avg_ttft_ms?.toFixed(0) ?? '—'} ms</span><span>TPM: {providers?.range_avg_tpm?.toFixed(0) ?? '—'}</span><span>{t(`${prefix}.modelTotal.successRate`)}: {providers?.range_success_rate != null ? `${(providers.range_success_rate * (providers.range_success_rate <= 1 ? 100 : 1)).toFixed(1)}%` : '—'}</span></section></div>
        <div className="stats-grid"><Ranking items={(providers?.range_by_provider ?? []).map((item) => [item.provider_id, item.tokens])} title={t(`${prefix}.modelRanking.title`, { range: rangeLabel })} /><Ranking items={(providers?.range_by_umo ?? []).map((item) => [item.umo, item.tokens])} title={t(`${prefix}.sessionRanking.title`, { range: rangeLabel })} /></div>
      </>}
    </div>
  );
}

function SparklineCard({ points, title, total }: { points: string; title: string; total: string }) {
  return <section className="stats-card stats-chart"><div><h3>{title}</h3><strong>{total}</strong></div>{points ? <svg aria-label={title} preserveAspectRatio="none" role="img" viewBox="0 0 600 180"><polyline fill="none" points={points} stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" /></svg> : <div className="monitor-empty">—</div>}</section>;
}

function Ranking({ items, title }: { items: Array<[string, number]>; title: string }) {
  return <section className="stats-card stats-ranking"><h3>{title}</h3>{items.length ? items.slice(0, 10).map(([name, value]) => <div key={name}><span title={name}>{name}</span><strong>{value.toLocaleString()}</strong></div>) : <div className="monitor-empty">—</div>}</section>;
}
