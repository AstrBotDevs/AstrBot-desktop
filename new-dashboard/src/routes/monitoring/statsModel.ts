export type TokenRange = 1 | 3 | 7;
export type RunningStats = { hours: number; minutes: number; seconds: number };
export type ProviderTrend = {
  data: Array<[number, number]>;
  name: string;
  total_tokens: number;
};
export type BaseStats = {
  cpu_percent?: number;
  memory?: { process?: number; system?: number };
  message_count?: number;
  message_time_series?: Array<[number, number]>;
  platform?: Array<{ count: number; name: string; timestamp?: number }>;
  platform_count?: number;
  running?: RunningStats;
  start_time?: number;
};
export type ProviderStats = {
  range_avg_duration_ms?: number;
  range_avg_tpm?: number;
  range_avg_ttft_ms?: number;
  range_by_provider?: Array<{ provider_id: string; tokens: number }>;
  range_by_umo?: Array<{ tokens: number; umo: string }>;
  range_success_rate?: number;
  range_total_calls?: number;
  range_total_tokens?: number;
  today_total_calls?: number;
  today_total_tokens?: number;
  trend?: { series?: ProviderTrend[]; total_series?: Array<[number, number]> };
};

export function makeSparklinePoints(series: Array<[number, number]>, width = 600, height = 180, padding = 8) {
  if (!series.length) return '';
  const values = series.map((point) => point[1]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  return series.map((point, index) => {
    const x = series.length === 1 ? width / 2 : padding + index * chartWidth / (series.length - 1);
    const y = padding + chartHeight - ((point[1] - min) / range) * chartHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

export function aggregateProviderSeries(series: ProviderTrend[], othersLabel: string) {
  if (series.length <= 5) return series;
  const leading = series.slice(0, 4);
  const overflow = series.slice(4);
  const timestamps = overflow[0]?.data ?? [];
  return [...leading, {
    name: othersLabel,
    data: timestamps.map(([timestamp], index) => [
      timestamp,
      overflow.reduce((sum, item) => sum + (item.data[index]?.[1] ?? 0), 0),
    ] as [number, number]),
    total_tokens: overflow.reduce((sum, item) => sum + item.total_tokens, 0),
  }];
}

export function formatRunningTime(running: RunningStats | undefined, units = { hours: 'h', minutes: 'm', seconds: 's' }) {
  if (!running) return '—';
  return [
    running.hours > 0 ? `${running.hours}${units.hours}` : '',
    running.minutes > 0 || running.hours > 0 ? `${running.minutes}${units.minutes}` : '',
    `${running.seconds}${units.seconds}`,
  ].filter(Boolean).join(' ');
}
