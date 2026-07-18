import { isRecord, type UnknownRecord } from '@/api/response';

export type JsonObject = UnknownRecord;

export { responseData } from '@/api/response';

export function objectList(data: unknown, keys: string[]): JsonObject[] {
  if (Array.isArray(data)) return data.filter(isObject);
  if (!isObject(data)) return [];
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) return value.filter(isObject);
  }
  return [];
}

export function isObject(value: unknown): value is JsonObject {
  return isRecord(value);
}

export function parseJsonObject(source: string): JsonObject {
  const parsed: unknown = JSON.parse(source);
  if (!isObject(parsed)) throw new Error('JSON root must be an object.');
  return parsed;
}

export function prettyJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

export function recordId(record: JsonObject, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

export function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
