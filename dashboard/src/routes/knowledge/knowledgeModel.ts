import type { JsonObject } from '@/routes/configuration/model';

export type KnowledgeImportSettings = {
  batch_size: number;
  chunk_overlap: number;
  chunk_size: number;
  cleaning_provider_id: string;
  enable_cleaning: boolean;
  max_retries: number;
  tasks_limit: number;
};

export function knowledgeFileUploadBody(files: Array<Blob | File>, settings: KnowledgeImportSettings) {
  return Object.fromEntries([
    ...files.map((file, index) => [`file${index}`, file] as const),
    ['chunk_size', settings.chunk_size],
    ['chunk_overlap', settings.chunk_overlap],
    ['batch_size', settings.batch_size],
    ['tasks_limit', settings.tasks_limit],
    ['max_retries', settings.max_retries],
  ]);
}

export function knowledgeUrlImportBody(url: string, settings: KnowledgeImportSettings) {
  return {
    url: url.trim(),
    chunk_size: settings.chunk_size,
    chunk_overlap: settings.chunk_overlap,
    batch_size: settings.batch_size,
    tasks_limit: settings.tasks_limit,
    max_retries: settings.max_retries,
    ...(settings.enable_cleaning ? { enable_cleaning: true, cleaning_provider_id: settings.cleaning_provider_id } : {}),
  };
}

export function validKnowledgeImportSettings(settings: KnowledgeImportSettings) {
  return (
    settings.chunk_size > 0 &&
    settings.chunk_overlap >= 0 &&
    settings.chunk_overlap < settings.chunk_size &&
    settings.batch_size > 0 &&
    settings.tasks_limit > 0 &&
    settings.max_retries >= 0
  );
}

export function knowledgeBaseId(item: JsonObject) {
  return stringField(item, 'kb_id', 'id');
}

export function documentId(item: JsonObject) {
  return stringField(item, 'doc_id', 'document_id', 'id');
}

export function documentName(item: JsonObject) {
  return stringField(item, 'doc_name', 'file_name', 'name') || documentId(item);
}

export function documentCount(item: JsonObject) {
  return numberField(item, 'doc_count', 'document_count', 'documents_count');
}

export function chunkCount(item: JsonObject) {
  return numberField(item, 'chunk_count', 'chunks_count');
}

export function formatFileSize(value: unknown, fallback = '') {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return fallback;
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(2)} ${units[unit]}`;
}

export function formatKnowledgeDate(value: unknown, locale?: string, fallback = '') {
  if (typeof value !== 'string' || !value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString(locale);
}

export function retrievalPayload(value: unknown) {
  if (Array.isArray(value)) return { results: value.filter(isObject), visualization: '' };
  if (!isObject(value)) return { results: [], visualization: '' };
  const results = Array.isArray(value.results) ? value.results.filter(isObject) : [];
  return { results, visualization: typeof value.visualization === 'string' ? value.visualization : '' };
}

export function taskIds(value: unknown) {
  if (!isObject(value)) return [];
  const ids = Array.isArray(value.task_ids) ? value.task_ids : [value.task_id];
  return ids.filter((id): id is string => typeof id === 'string' && Boolean(id));
}

export function scoreTone(score: unknown) {
  const value = Number(score);
  if (value >= 0.8) return 'success';
  if (value >= 0.6) return 'info';
  if (value >= 0.4) return 'warning';
  return 'error';
}

function stringField(item: JsonObject, ...keys: string[]) {
  for (const key of keys) if (typeof item[key] === 'string' && item[key]) return item[key] as string;
  return '';
}

function numberField(item: JsonObject, ...keys: string[]) {
  for (const key of keys) {
    if (item[key] == null || item[key] === '') continue;
    const value = Number(item[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
