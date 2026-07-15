import type { JsonObject } from './model';

export type ScheduleMode = 'once' | 'interval' | 'daily' | 'weekly' | 'monthly' | 'cron';
export type IntervalUnit = 'minutes' | 'hours' | 'days';

export type CronForm = {
  scheduleMode: ScheduleMode;
  name: string;
  note: string;
  cronExpression: string;
  runAt: string;
  intervalValue: number;
  intervalUnit: IntervalUnit;
  dailyTime: string;
  weeklyDay: number;
  weeklyTime: string;
  monthlyDay: number;
  monthlyTime: string;
  session: string;
  timezone: string;
  enabled: boolean;
};

export const EMPTY_CRON_FORM: CronForm = {
  scheduleMode: 'once',
  name: '',
  note: '',
  cronExpression: '',
  runAt: '',
  intervalValue: 1,
  intervalUnit: 'hours',
  dailyTime: '09:00',
  weeklyDay: 1,
  weeklyTime: '09:00',
  monthlyDay: 1,
  monthlyTime: '09:00',
  session: '',
  timezone: '',
  enabled: true,
};

const pad = (value: string | number) => String(value).padStart(2, '0');

function parseTime(value: string) {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value || '');
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? { hour, minute } : null;
}

function isCronTime(minute: number, hour: number) {
  return Number.isInteger(minute) && minute >= 0 && minute <= 59
    && Number.isInteger(hour) && hour >= 0 && hour <= 23;
}

export function jobSession(job: JsonObject) {
  const payload = job.payload && typeof job.payload === 'object' && !Array.isArray(job.payload)
    ? job.payload as JsonObject
    : {};
  return String(job.session || payload.session || '').trim();
}

export function toDatetimeLocal(value: unknown) {
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function buildCronExpression(form: CronForm) {
  if (form.scheduleMode === 'interval') {
    const value = Math.max(1, Number(form.intervalValue || 1));
    if (form.intervalUnit === 'minutes') return `*/${Math.min(value, 59)} * * * *`;
    if (form.intervalUnit === 'hours') return `0 */${Math.min(value, 23)} * * *`;
    return `0 0 */${Math.min(value, 31)} * *`;
  }
  if (form.scheduleMode === 'daily') {
    const time = parseTime(form.dailyTime);
    return time ? `${time.minute} ${time.hour} * * *` : '';
  }
  if (form.scheduleMode === 'weekly') {
    const time = parseTime(form.weeklyTime);
    const weekday = Math.min(Math.max(Number(form.weeklyDay), 0), 6);
    return time ? `${time.minute} ${time.hour} * * ${weekday}` : '';
  }
  if (form.scheduleMode === 'monthly') {
    const time = parseTime(form.monthlyTime);
    const day = Math.min(Math.max(Number(form.monthlyDay || 1), 1), 31);
    return time ? `${time.minute} ${time.hour} ${day} * *` : '';
  }
  return form.cronExpression.trim();
}

export function readSchedule(job: JsonObject): Pick<CronForm, 'scheduleMode' | 'cronExpression' | 'intervalValue' | 'intervalUnit' | 'dailyTime' | 'weeklyDay' | 'weeklyTime' | 'monthlyDay' | 'monthlyTime'> {
  const cronExpression = String(job.cron_expression || '');
  const fallback = {
    scheduleMode: 'cron' as ScheduleMode,
    cronExpression,
    intervalValue: 1,
    intervalUnit: 'hours' as IntervalUnit,
    dailyTime: '09:00',
    weeklyDay: 1,
    weeklyTime: '09:00',
    monthlyDay: 1,
    monthlyTime: '09:00',
  };
  if (job.run_once) return { ...fallback, scheduleMode: 'once' };
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cronExpression.trim().split(/\s+/);
  if ([minute, hour, dayOfMonth, month, dayOfWeek].some((part) => part == null)) return fallback;

  const minuteInterval = /^\*\/(\d+)$/.exec(minute);
  if (minuteInterval && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return { ...fallback, scheduleMode: 'interval', intervalValue: Number(minuteInterval[1]), intervalUnit: 'minutes' };
  }
  const hourInterval = /^\*\/(\d+)$/.exec(hour);
  if (minute === '0' && hourInterval && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return { ...fallback, scheduleMode: 'interval', intervalValue: Number(hourInterval[1]), intervalUnit: 'hours' };
  }
  const dayInterval = /^\*\/(\d+)$/.exec(dayOfMonth);
  if (minute === '0' && hour === '0' && dayInterval && month === '*' && dayOfWeek === '*') {
    return { ...fallback, scheduleMode: 'interval', intervalValue: Number(dayInterval[1]), intervalUnit: 'days' };
  }

  const minuteNumber = Number(minute);
  const hourNumber = Number(hour);
  if (!isCronTime(minuteNumber, hourNumber)) return fallback;
  const time = `${pad(hourNumber)}:${pad(minuteNumber)}`;
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') return { ...fallback, scheduleMode: 'daily', dailyTime: time };
  const weekday = Number(dayOfWeek);
  if (dayOfMonth === '*' && month === '*' && Number.isInteger(weekday) && weekday >= 0 && weekday <= 6) {
    return { ...fallback, scheduleMode: 'weekly', weeklyDay: weekday, weeklyTime: time };
  }
  const monthDay = Number(dayOfMonth);
  if (Number.isInteger(monthDay) && monthDay >= 1 && monthDay <= 31 && month === '*' && dayOfWeek === '*') {
    return { ...fallback, scheduleMode: 'monthly', monthlyDay: monthDay, monthlyTime: time };
  }
  return fallback;
}

export function cronFormFromJob(job: JsonObject): CronForm {
  return {
    ...EMPTY_CRON_FORM,
    ...readSchedule(job),
    name: String(job.name || ''),
    note: String(job.note || job.description || ''),
    runAt: toDatetimeLocal(job.run_at),
    session: jobSession(job),
    timezone: String(job.timezone || ''),
    enabled: job.enabled !== false,
  };
}

export function cronPayload(form: CronForm) {
  const runOnce = form.scheduleMode === 'once';
  const runAtDate = runOnce && form.runAt ? new Date(form.runAt) : null;
  return {
    run_once: runOnce,
    name: form.name.trim(),
    note: form.note.trim(),
    cron_expression: runOnce ? '' : buildCronExpression(form),
    run_at: runAtDate && !Number.isNaN(runAtDate.getTime()) ? runAtDate.toISOString() : '',
    session: form.session.trim(),
    timezone: form.timezone.trim(),
    enabled: form.enabled,
  };
}

export type ScheduleKind = 'once' | 'minutes' | 'hours' | 'days' | 'daily' | 'weekly' | 'monthly' | 'cron';

export function scheduleDescriptor(job: JsonObject): { kind: ScheduleKind; values: Record<string, string | number> } {
  if (job.run_once) return { kind: 'once', values: { time: String(job.run_at || '') } };
  const cron = String(job.cron_expression || '').trim();
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.split(/\s+/);
  const minuteInterval = /^\*\/(\d+)$/.exec(minute);
  if (minuteInterval && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') return { kind: 'minutes', values: { count: Number(minuteInterval[1]) } };
  const hourInterval = /^\*\/(\d+)$/.exec(hour);
  if (minute === '0' && hourInterval && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') return { kind: 'hours', values: { count: Number(hourInterval[1]) } };
  const dayInterval = /^\*\/(\d+)$/.exec(dayOfMonth);
  if (minute === '0' && hour === '0' && dayInterval && month === '*' && dayOfWeek === '*') return { kind: 'days', values: { count: Number(dayInterval[1]) } };
  const minuteNumber = Number(minute);
  const hourNumber = Number(hour);
  if (!isCronTime(minuteNumber, hourNumber)) return { kind: 'cron', values: { cron } };
  const time = `${pad(hourNumber)}:${pad(minuteNumber)}`;
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') return { kind: 'daily', values: { time } };
  const weekday = Number(dayOfWeek);
  if (dayOfMonth === '*' && month === '*' && Number.isInteger(weekday) && weekday >= 0 && weekday <= 6) return { kind: 'weekly', values: { day: weekday, time } };
  const monthDay = Number(dayOfMonth);
  if (Number.isInteger(monthDay) && monthDay >= 1 && monthDay <= 31 && month === '*' && dayOfWeek === '*') return { kind: 'monthly', values: { day: monthDay, time } };
  return { kind: 'cron', values: { cron } };
}

export function timeValue(value: unknown) {
  const time = value ? new Date(String(value)).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}
