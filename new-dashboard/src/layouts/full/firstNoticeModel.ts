import type { JsonObject } from '@/routes/configuration/model';

export function firstNoticeContent(data: JsonObject | undefined) {
  return typeof data?.content === 'string' ? data.content.trim() : '';
}
