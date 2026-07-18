import {
  ApiPayloadError,
  expectRecord,
  isRecord,
  type UnknownRecord,
} from './response';

export interface ProviderDto extends UnknownRecord {
  capability?: string;
  enable?: boolean;
  enabled?: boolean;
  id: string;
  model?: string;
  provider_source_id?: string;
  provider_type?: string;
  type?: string;
}

export interface ProviderSourceDto extends UnknownRecord {
  id: string;
  provider?: string;
  provider_type?: string;
  type?: string;
}

export interface ProviderSchemaDto {
  modelMetadata: UnknownRecord;
  providerSourceSchema: UnknownRecord;
  providerSources: ProviderSourceDto[];
  providerTemplates: UnknownRecord;
  providers: ProviderDto[];
}

export interface PluginDto extends UnknownRecord {
  activated?: boolean;
  author?: unknown;
  desc?: string;
  description?: string;
  display_name?: string;
  enabled?: boolean;
  id?: string;
  name?: string;
  plugin_id?: string;
  repo?: string;
  version?: string;
}

export interface ChatSessionDto extends UnknownRecord {
  display_name?: string;
  session_id: string;
  updated_at?: string;
}

export interface KnowledgeBaseDto extends UnknownRecord {
  description?: string;
  document_count?: number;
  emoji?: string;
  embedding_provider_id?: string | null;
  id?: string;
  kb_id?: string;
  kb_name?: string;
  rerank_provider_id?: string | null;
}

export interface KnowledgeDocumentDto extends UnknownRecord {
  doc_id?: string;
  doc_name?: string;
  document_id?: string;
  file_name?: string;
  id?: string;
  name?: string;
}

export interface KnowledgeChunkDto extends UnknownRecord {
  chunk_id?: string;
  content?: string;
  id?: string;
  text?: string;
}

export interface ConfigProfileDto extends UnknownRecord {
  conf_id?: string;
  config?: UnknownRecord;
  id?: string;
  metadata?: UnknownRecord;
  name?: string;
}

export type PageDto<T> = {
  items: T[];
  page?: number;
  pageSize?: number;
  total: number;
};

export function parseProviderSchema(value: unknown): ProviderSchemaDto {
  const payload = expectRecord(value, 'provider schema');
  const schema = recordOrEmpty(payload.config_schema);
  const providerSchema = recordOrEmpty(schema.provider);
  return {
    modelMetadata: recordOrEmpty(payload.model_metadata),
    providerSources: parseProviderSources(payload.provider_sources),
    providers: parseProviders(payload.providers),
    providerSourceSchema: providerSchema,
    providerTemplates: recordOrEmpty(providerSchema.config_template),
  };
}

export function parseProviders(value: unknown): ProviderDto[] {
  const list = locateArray(value, ['providers', 'items', 'data']);
  return list.map((item, index) => {
    const record = expectRecord(item, `providers[${index}]`);
    const id = requiredString(record.id, `providers[${index}].id`);
    return { ...record, id };
  });
}

export function parseProviderSources(value: unknown): ProviderSourceDto[] {
  const list = locateArray(value, ['provider_sources', 'sources', 'items', 'data']);
  return list.map((item, index) => {
    const record = expectRecord(item, `provider_sources[${index}]`);
    const id = requiredString(record.id, `provider_sources[${index}].id`);
    return { ...record, id };
  });
}

export function parsePlugins(value: unknown): PluginDto[] {
  return locateArray(value, ['plugins', 'items', 'data', 'results'])
    .map((item, index) => ({ ...expectRecord(item, `plugins[${index}]`) }));
}

export function parsePlugin(value: unknown): PluginDto {
  return { ...expectRecord(value, 'plugin') };
}

export function parseChatSessions(value: unknown): ChatSessionDto[] {
  return locateArray(value, ['sessions', 'items', 'data']).map((item, index) => {
    const record = expectRecord(item, `sessions[${index}]`);
    return {
      ...record,
      session_id: requiredString(record.session_id, `sessions[${index}].session_id`),
    };
  });
}

export function parseKnowledgeBasePage(value: unknown): PageDto<KnowledgeBaseDto> {
  const payload = expectRecord(value, 'knowledge base page');
  const items = locateArray(payload, ['items', 'knowledge_bases']).map((item, index) => ({
    ...expectRecord(item, `knowledge_bases[${index}]`),
  }));
  return {
    items,
    page: optionalNumber(payload.page),
    pageSize: optionalNumber(payload.page_size),
    total: optionalNumber(payload.total) ?? items.length,
  };
}

export function parseKnowledgeBase(value: unknown): KnowledgeBaseDto {
  return { ...expectRecord(value, 'knowledge base') };
}

export function parseKnowledgeDocumentPage(value: unknown): PageDto<KnowledgeDocumentDto> {
  const payload = expectRecord(value, 'knowledge document page');
  const items = locateArray(payload, ['items', 'documents']).map((item, index) => ({
    ...expectRecord(item, `knowledge_documents[${index}]`),
  }));
  return {
    items,
    page: optionalNumber(payload.page),
    pageSize: optionalNumber(payload.page_size),
    total: optionalNumber(payload.total) ?? items.length,
  };
}

export function parseKnowledgeDocument(value: unknown): KnowledgeDocumentDto {
  return { ...expectRecord(value, 'knowledge document') };
}

export function parseKnowledgeChunkPage(value: unknown): PageDto<KnowledgeChunkDto> {
  const payload = expectRecord(value, 'knowledge chunk page');
  const items = locateArray(payload, ['items', 'chunks']).map((item, index) => ({
    ...expectRecord(item, `knowledge_chunks[${index}]`),
  }));
  return {
    items,
    page: optionalNumber(payload.page),
    pageSize: optionalNumber(payload.page_size),
    total: optionalNumber(payload.total) ?? items.length,
  };
}

export function parseConfigProfiles(value: unknown): ConfigProfileDto[] {
  return locateArray(value, ['info_list', 'configs', 'profiles']).map((item, index) => ({
    ...expectRecord(item, `config_profiles[${index}]`),
  }));
}

export function parseConfigProfile(value: unknown): ConfigProfileDto {
  return { ...expectRecord(value, 'config profile') };
}

function locateArray(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  const payload = expectRecord(value, 'list response');
  for (const key of keys) {
    const candidate = payload[key];
    if (Array.isArray(candidate)) return candidate;
  }
  throw new ApiPayloadError(`Expected one of ${keys.join(', ')} to contain a list.`, value);
}

function recordOrEmpty(value: unknown) {
  return isRecord(value) ? value : {};
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value) throw new ApiPayloadError(`Expected ${field} to be a non-empty string.`, value);
  return value;
}

function optionalNumber(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}
