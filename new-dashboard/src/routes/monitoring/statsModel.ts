export type TokenRange = 1 | 3 | 7;
export type BaseStats = {
  cpu_percent?: number;
  memory?: { process?: number; system?: number };
  message_count?: number;
  message_time_series?: Array<[number, number]>;
  platform?: Array<{ count: number; name: string; timestamp?: number }>;
  platform_count?: number;
  running?: { hours: number; minutes: number; seconds: number };
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
  today_total_tokens?: number;
  trend?: { total_series?: Array<[number, number]> };
};

export function makeSparklinePoints(series: Array<[number, number]>, width = 600, height = 180) {
  if (!series.length) return '';
  const values = series.map((point) => point[1]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return series.map((point, index) => {
    const x = series.length === 1 ? width / 2 : index * width / (series.length - 1);
    const y = height - ((point[1] - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

export function formatRunningTime(running?: BaseStats['running']) {
  if (!running) return '—';
  return `${running.hours}h ${running.minutes}m ${running.seconds}s`;
}
