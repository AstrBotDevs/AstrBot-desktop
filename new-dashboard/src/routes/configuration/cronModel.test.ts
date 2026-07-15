import { describe, expect, it } from 'vitest';

import { buildCronExpression, cronFormFromJob, cronPayload, EMPTY_CRON_FORM, scheduleDescriptor } from './cronModel';

describe('cron model', () => {
  it('builds product schedules as cron expressions', () => {
    expect(buildCronExpression({ ...EMPTY_CRON_FORM, scheduleMode: 'interval', intervalValue: 3, intervalUnit: 'hours' })).toBe('0 */3 * * *');
    expect(buildCronExpression({ ...EMPTY_CRON_FORM, scheduleMode: 'weekly', weeklyDay: 5, weeklyTime: '18:30' })).toBe('30 18 * * 5');
    expect(buildCronExpression({ ...EMPTY_CRON_FORM, scheduleMode: 'monthly', monthlyDay: 12, monthlyTime: '07:05' })).toBe('5 7 12 * *');
  });

  it('recognizes product schedules when editing', () => {
    expect(cronFormFromJob({ cron_expression: '0 9 * * *', name: 'daily' }).scheduleMode).toBe('daily');
    expect(cronFormFromJob({ cron_expression: '15 10 * * 2', name: 'weekly' })).toMatchObject({ scheduleMode: 'weekly', weeklyDay: 2, weeklyTime: '10:15' });
    expect(scheduleDescriptor({ cron_expression: '*/10 * * * *' })).toEqual({ kind: 'minutes', values: { count: 10 } });
  });

  it('builds one-off API payloads with ISO timestamps', () => {
    const payload = cronPayload({ ...EMPTY_CRON_FORM, name: 'once', note: 'task', runAt: '2026-07-16T09:30' });
    expect(payload).toMatchObject({ run_once: true, name: 'once', note: 'task', cron_expression: '' });
    expect(payload.run_at).toMatch(/^2026-07-16T/);
  });
});
