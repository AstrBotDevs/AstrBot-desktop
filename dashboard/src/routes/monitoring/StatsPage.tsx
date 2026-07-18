import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { getProviderTokenStats, getStats } from '@/api/openapi';
import { responseData } from '@/api/response';
import { MdiIcon } from '@/components/icons/MdiIcon';
import {
  aggregateProviderSeries,
  formatRunningTime,
  makeSparklinePoints,
  type BaseStats,
  type ProviderStats,
  type ProviderTrend,
  type TokenRange,
} from './statsModel';

const CHART_COLORS = ['#5f7e9b', '#708865', '#9a7557', '#786696', '#5d8985'];

export default function StatsPage() {
  const { i18n, t } = useTranslation();
  const prefix = 'features.stats';
  const text = (key: string, values?: Record<string, unknown>) => t(`${prefix}.${key}`, values);
  const [range, setRange] = useState<TokenRange>(1);
  const [base, setBase] = useState<BaseStats | null>(null);
  const [providers, setProviders] = useState<ProviderStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const initialLoad = useRef(true);
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);

  const refresh = useCallback(
    async (selectedRange: TokenRange, rangeChange = false) => {
      try {
        setError('');
        const [baseResponse, providerResponse] = await Promise.all([
          getStats({ query: { offset_sec: selectedRange * 86_400 } }),
          getProviderTokenStats({ query: { days: selectedRange } }),
        ]);
        setBase(responseData<BaseStats>(baseResponse) ?? null);
        setProviders(responseData<ProviderStats>(providerResponse) ?? null);
        setUpdatedAt(new Date());
      } catch {
        setError(text(rangeChange ? 'errors.rangeFailed' : 'errors.loadFailed'));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void refresh(range, !initialLoad.current);
    initialLoad.current = false;
  }, [range, refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => void refresh(range), 60_000);
    return () => window.clearInterval(timer);
  }, [range, refresh]);

  const compact = (value: number) => {
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
    return number.format(value);
  };
  const memory = (value: number) =>
    value >= 1024 ? `${(value / 1024).toFixed(1)} ${text('units.gb')}` : `${number.format(value)} ${text('units.mb')}`;
  const duration = (value = 0) =>
    !value
      ? '—'
      : value < 1000
        ? `${Math.round(value)} ${text('units.ms')}`
        : `${(value / 1000).toFixed(2)} ${text('units.secondsShort')}`;
  const rangeKey = range === 1 ? 'oneDay' : range === 3 ? 'threeDays' : 'oneWeek';
  const rangeLabel = text(`rangeLabels.${rangeKey}`);
  const startTime = base?.start_time
    ? new Date(base.start_time < 10_000_000_000 ? base.start_time * 1000 : base.start_time).toLocaleString(
        i18n.language,
        {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        },
      )
    : '—';
  const cards: Array<{ icon: `mdi-${string}`; label: string; note: string; value: string }> = [
    {
      icon: 'mdi-robot-outline',
      label: text('overviewCards.platformCount.label'),
      value: number.format(base?.platform_count ?? 0),
      note: text('overviewCards.platformCount.note'),
    },
    {
      icon: 'mdi-message-outline',
      label: text('overviewCards.messageCount.label'),
      value: number.format(base?.message_count ?? 0),
      note: text('overviewCards.messageCount.note'),
    },
    {
      icon: 'mdi-creation-outline',
      label: text('overviewCards.todayModelCalls.label'),
      value: compact(providers?.today_total_tokens ?? 0),
      note: text('overviewCards.todayModelCalls.note'),
    },
    {
      icon: 'mdi-chip',
      label: text('overviewCards.cpu.label'),
      value: `${base?.cpu_percent ?? 0}%`,
      note: text('overviewCards.cpu.note'),
    },
    {
      icon: 'mdi-memory',
      label: text('overviewCards.memory.label'),
      value: memory(base?.memory?.process ?? 0),
      note: text('overviewCards.memory.note', { systemMemory: memory(base?.memory?.system ?? 0) }),
    },
    {
      icon: 'mdi-timer-outline',
      label: text('overviewCards.uptime.label'),
      value: formatRunningTime(base?.running, {
        hours: text('units.hoursShort'),
        minutes: text('units.minutesShort'),
        seconds: text('units.secondsShort'),
      }),
      note: text('overviewCards.uptime.note', { startTime }),
    },
  ];
  const platformRanking = [...(base?.platform ?? [])].sort((left, right) => right.count - left.count).slice(0, 6);
  const providerSeries = aggregateProviderSeries(providers?.trend?.series ?? [], text('chart.others'));
  const successRate = providers?.range_total_calls ? `${((providers.range_success_rate ?? 0) * 100).toFixed(1)}%` : '—';

  return (
    <div className="stats-page-react">
      <div className="stats-page-react__inner">
        <header className="stats-header-react">
          <div>
            <h1>{text('header.title')}</h1>
            <p>{text('header.subtitle')}</p>
          </div>
          <div>
            <MdiIcon name="mdi-refresh" />
            <span>
              {updatedAt?.toLocaleTimeString(i18n.language, {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              }) ?? text('header.notUpdated')}
            </span>
          </div>
        </header>
        {error && (
          <div className="monitor-error" role="alert">
            {error}
          </div>
        )}
        {loading && !base ? (
          <div className="stats-loading">
            <MdiIcon className="mdi-spin" name="mdi-loading" />
          </div>
        ) : (
          <>
            <div className="stats-overview-react">
              {cards.map((card) => (
                <section className="stats-card-react stats-overview-card" key={card.label}>
                  <span className="stats-card-react__icon">
                    <MdiIcon name={card.icon} />
                  </span>
                  <span className="stats-card-react__label">{card.label}</span>
                  <strong>{card.value}</strong>
                  <small>{card.note}</small>
                </section>
              ))}
            </div>
            <StatsSectionHeader
              actions={<RangeSwitch range={range} setRange={setRange} text={text} />}
              subtitle={text('messageOverview.subtitle')}
              title={text('messageOverview.title')}
            />
            <div className="stats-panel-grid">
              <section className="stats-card-react stats-chart-card">
                <header>
                  <div>
                    <h2>{text('messageTrend.title')}</h2>
                    <p>{text('messageTrend.subtitle', { range: rangeLabel })}</p>
                  </div>
                  <div className="stats-chart-total">
                    <span>{text('messageTrend.totalMessages')}</span>
                    <strong>{number.format(base?.message_count ?? 0)}</strong>
                  </div>
                </header>
                <AreaChart
                  ariaLabel={text('messageTrend.title')}
                  emptyText="—"
                  locale={i18n.language}
                  series={base?.message_time_series ?? []}
                />
              </section>
              <RankingCard
                empty={text('empty.platformStats')}
                items={platformRanking.map((item) => [item.name, item.count])}
                number={number}
                subtitle={text('platformRanking.subtitle', { range: rangeLabel })}
                title={text('platformRanking.title')}
              />
            </div>
            <StatsSectionHeader subtitle={text('modelCalls.subtitle')} title={text('modelCalls.title')} />
            <div className="stats-token-grid">
              <section className="stats-card-react stats-chart-card stats-provider-chart">
                <header>
                  <div>
                    <h2>{text('modelTrend.title')}</h2>
                    <p>{text('modelTrend.subtitle')}</p>
                  </div>
                </header>
                <StackedBarChart compact={compact} locale={i18n.language} series={providerSeries} />
              </section>
              <div className="stats-token-side">
                <section className="stats-card-react stats-total-card">
                  <span className="stats-card-react__label">{text('modelTotal.title', { range: rangeLabel })}</span>
                  <strong>
                    {number.format(providers?.range_total_tokens ?? 0)} <small>{text('units.tokens')}</small>
                  </strong>
                  <p>{text('modelTotal.callCount', { count: number.format(providers?.range_total_calls ?? 0) })}</p>
                  <div>
                    <Metric label={text('modelTotal.avgTtft')} value={duration(providers?.range_avg_ttft_ms)} />
                    <Metric label={text('modelTotal.avgDuration')} value={duration(providers?.range_avg_duration_ms)} />
                    <Metric
                      label={text('modelTotal.avgTpm')}
                      value={
                        providers?.range_avg_tpm ? `${providers.range_avg_tpm.toFixed(0)} ${text('units.tpm')}` : '—'
                      }
                    />
                    <Metric label={text('modelTotal.successRate')} value={successRate} />
                  </div>
                </section>
                <RankingCard
                  empty={text('empty.modelCalls', { range: rangeLabel })}
                  items={(providers?.range_by_provider ?? []).map((item) => [item.provider_id, item.tokens])}
                  number={number}
                  scroll
                  subtitle={text('modelRanking.subtitle')}
                  title={text('modelRanking.title', { range: rangeLabel })}
                />
              </div>
            </div>
            <RankingCard
              empty={text('empty.sessionCalls', { range: rangeLabel })}
              items={(providers?.range_by_umo ?? []).slice(0, 10).map((item) => [item.umo, item.tokens])}
              number={number}
              subtitle={text('sessionRanking.subtitle')}
              title={text('sessionRanking.title', { range: rangeLabel })}
            />
          </>
        )}
      </div>
    </div>
  );
}

function StatsSectionHeader({ actions, subtitle, title }: { actions?: ReactNode; subtitle: string; title: string }) {
  return (
    <div className="stats-section-head">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {actions}
    </div>
  );
}

function RangeSwitch({
  range,
  setRange,
  text,
}: {
  range: TokenRange;
  setRange: (range: TokenRange) => void;
  text: (key: string) => string;
}) {
  return (
    <div className="stats-range-switch">
      {([1, 3, 7] as TokenRange[]).map((value) => (
        <button aria-pressed={range === value} key={value} onClick={() => setRange(value)} type="button">
          {text(`ranges.${value === 1 ? 'oneDay' : value === 3 ? 'threeDays' : 'oneWeek'}`)}
        </button>
      ))}
    </div>
  );
}

function AreaChart({
  ariaLabel,
  emptyText,
  locale,
  series,
}: {
  ariaLabel: string;
  emptyText: string;
  locale: string;
  series: Array<[number, number]>;
}) {
  const points = makeSparklinePoints(series, 720, 260, 18);
  if (!points) return <div className="stats-chart-empty">{emptyText}</div>;
  const values = series.map((item) => item[1]);
  const max = Math.max(...values, 0);
  const area = `18,242 ${points} 702,242`;
  return (
    <div className="stats-svg-chart">
      <svg aria-label={ariaLabel} preserveAspectRatio="none" role="img" viewBox="0 0 720 260">
        <defs>
          <linearGradient id="stats-area-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity=".22" />
            <stop offset="1" stopColor="currentColor" stopOpacity=".02" />
          </linearGradient>
        </defs>
        {[18, 74, 130, 186, 242].map((y) => (
          <line className="stats-chart-grid" key={y} x1="18" x2="702" y1={y} y2={y} />
        ))}
        <polygon fill="url(#stats-area-fill)" points={area} />
        <polyline
          fill="none"
          points={points}
          stroke="currentColor"
          strokeWidth="2.4"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="stats-chart-axis">
        <span>
          {chartDate(series[0]?.[0]).toLocaleString(locale, { month: '2-digit', day: '2-digit', hour: '2-digit' })}
        </span>
        <strong>{max.toLocaleString(locale)}</strong>
        <span>
          {chartDate(series.at(-1)?.[0]).toLocaleString(locale, { month: '2-digit', day: '2-digit', hour: '2-digit' })}
        </span>
      </div>
    </div>
  );
}

function StackedBarChart({
  compact,
  locale,
  series,
}: {
  compact: (value: number) => string;
  locale: string;
  series: ProviderTrend[];
}) {
  const timestamps = series[0]?.data.map((item) => item[0]) ?? [];
  const totals = timestamps.map((_, index) => series.reduce((sum, item) => sum + (item.data[index]?.[1] ?? 0), 0));
  const max = Math.max(...totals, 1);
  if (!series.length || !timestamps.length) return <div className="stats-chart-empty">—</div>;
  return (
    <div className="stats-stacked-chart">
      <div className="stats-chart-legend">
        {series.map((item, index) => (
          <span key={item.name}>
            <i style={{ background: CHART_COLORS[index] }} />
            {item.name}
          </span>
        ))}
      </div>
      <div className="stats-bars">
        {timestamps.map((timestamp, pointIndex) => (
          <div className="stats-bar-column" key={`${timestamp}-${pointIndex}`}>
            <div>
              {series.map((item, seriesIndex) => {
                const value = item.data[pointIndex]?.[1] ?? 0;
                return (
                  <span
                    key={item.name}
                    style={{ background: CHART_COLORS[seriesIndex], height: `${(value / max) * 100}%` }}
                    title={`${item.name}: ${value.toLocaleString(locale)}`}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="stats-chart-axis">
        <span>{chartDate(timestamps[0]).toLocaleDateString(locale, { month: '2-digit', day: '2-digit' })}</span>
        <strong>{compact(max)}</strong>
        <span>{chartDate(timestamps.at(-1)).toLocaleDateString(locale, { month: '2-digit', day: '2-digit' })}</span>
      </div>
    </div>
  );
}

function chartDate(timestamp?: number) {
  const value = timestamp ?? 0;
  return new Date(value < 10_000_000_000 ? value * 1000 : value);
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="stats-metric-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RankingCard({
  empty,
  items,
  number,
  scroll,
  subtitle,
  title,
}: {
  empty: string;
  items: Array<[string, number]>;
  number: Intl.NumberFormat;
  scroll?: boolean;
  subtitle: string;
  title: string;
}) {
  return (
    <section className="stats-card-react stats-ranking-card">
      <header>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </header>
      {items.length ? (
        <div className={scroll ? 'is-scrollable' : ''}>
          {items.map(([name, value]) => (
            <div className="stats-ranking-row" key={name}>
              <span title={name}>{name}</span>
              <strong>{number.format(value)}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="stats-empty-text">{empty}</p>
      )}
    </section>
  );
}
