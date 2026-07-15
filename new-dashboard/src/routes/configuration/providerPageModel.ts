import type { JsonObject } from './model';

export type ProviderType = 'chat_completion' | 'agent_runner' | 'speech_to_text' | 'text_to_speech' | 'embedding' | 'rerank';
export type ProviderCapability = 'chat' | 'agent' | 'stt' | 'tts' | 'embedding' | 'rerank';

export const PROVIDER_TABS: Array<{
  capability: ProviderCapability;
  icon: `mdi-${string}`;
  translation: string;
  type: ProviderType;
}> = [
  { type: 'chat_completion', capability: 'chat', icon: 'mdi-message-text', translation: 'chatCompletion' },
  { type: 'agent_runner', capability: 'agent', icon: 'mdi-robot', translation: 'agentRunner' },
  { type: 'speech_to_text', capability: 'stt', icon: 'mdi-microphone-message', translation: 'speechToText' },
  { type: 'text_to_speech', capability: 'tts', icon: 'mdi-volume-high', translation: 'textToSpeech' },
  { type: 'embedding', capability: 'embedding', icon: 'mdi-code-json', translation: 'embedding' },
  { type: 'rerank', capability: 'rerank', icon: 'mdi-compare-vertical', translation: 'rerank' },
];

const LEGACY_PROVIDER_TYPES: Record<string, ProviderType> = {
  openai_chat_completion: 'chat_completion',
  anthropic_chat_completion: 'chat_completion',
  googlegenai_chat_completion: 'chat_completion',
  zhipu_chat_completion: 'chat_completion',
  dashscope: 'chat_completion',
  dify: 'agent_runner',
  coze: 'agent_runner',
  openai_whisper_api: 'speech_to_text',
  mimo_stt_api: 'speech_to_text',
  openai_whisper_selfhost: 'speech_to_text',
  sensevoice_stt_selfhost: 'speech_to_text',
  openai_tts_api: 'text_to_speech',
  mimo_tts_api: 'text_to_speech',
  edge_tts: 'text_to_speech',
  gsvi_tts_api: 'text_to_speech',
  fishaudio_tts_api: 'text_to_speech',
  dashscope_tts: 'text_to_speech',
  azure_tts: 'text_to_speech',
  minimax_tts_api: 'text_to_speech',
  volcengine_tts: 'text_to_speech',
};

const CAPABILITY_TYPES: Record<ProviderCapability, ProviderType> = {
  chat: 'chat_completion',
  agent: 'agent_runner',
  stt: 'speech_to_text',
  tts: 'text_to_speech',
  embedding: 'embedding',
  rerank: 'rerank',
};

export function providerTypeOf(item: JsonObject): ProviderType | undefined {
  const explicit = stringValue(item.provider_type);
  if (PROVIDER_TABS.some((tab) => tab.type === explicit)) return explicit as ProviderType;

  const capability = stringValue(item.capability) as ProviderCapability;
  if (capability in CAPABILITY_TYPES) return CAPABILITY_TYPES[capability];

  const legacy = stringValue(item.type);
  return LEGACY_PROVIDER_TYPES[legacy]
    ?? PROVIDER_TABS.find((tab) => legacy.includes(tab.type))?.type;
}

export function recordsForType(items: JsonObject[], type: ProviderType) {
  return items.filter((item) => providerTypeOf(item) === type);
}

export function providerSchemaData(payload: JsonObject) {
  const configSchema = objectValue(payload.config_schema);
  const providerSchema = objectValue(configSchema.provider);
  return {
    modelMetadata: objectValue(payload.model_metadata),
    providerSources: objectArray(payload.provider_sources),
    providers: objectArray(payload.providers),
    templates: objectValue(providerSchema.config_template),
  };
}

export function sourceTemplatesForType(templates: JsonObject, type: ProviderType) {
  return Object.entries(templates)
    .filter(([, template]) => isObject(template) && providerTypeOf(template) === type)
    .map(([key, template]) => ({ key, template: template as JsonObject }));
}

export function sourceFromTemplate(template: JsonObject, existingSources: JsonObject[]) {
  const excluded = new Set(['id', 'enable', 'model', 'provider_source_id', 'modalities', 'custom_extra_body']);
  const source: JsonObject = {};
  for (const [key, value] of Object.entries(template)) {
    if (!excluded.has(key)) source[key] = cloneValue(value);
  }

  const baseId = stringValue(template.id) || stringValue(template.provider) || 'provider';
  source.id = uniqueSourceId(baseId, existingSources);
  source.type = template.type;
  source.provider_type = template.provider_type;
  source.provider = template.provider;
  source.enable = true;
  return source;
}

export function buildModelProvider(sourceId: string, modelName: string, metadata?: JsonObject): JsonObject {
  const modalities = ['text'];
  const metadataModalities = objectValue(metadata?.modalities);
  const inputs = Array.isArray(metadataModalities.input) ? metadataModalities.input.map(String) : [];
  if (inputs.includes('image')) modalities.push('image');
  if (inputs.includes('audio')) modalities.push('audio');
  if (metadata?.tool_call) modalities.push('tool_use');

  const context = Number(objectValue(metadata?.limit).context || 0);
  return {
    id: `${sourceId}/${modelName}`,
    enable: true,
    provider_source_id: sourceId,
    model: modelName,
    modalities,
    custom_extra_body: {},
    max_context_tokens: Number.isFinite(context) && context > 0 ? context : 0,
    reasoning: Boolean(metadata?.reasoning),
  };
}

export function formatContextLimit(provider: JsonObject, metadata?: JsonObject) {
  const context = Number(objectValue(metadata?.limit).context || provider.max_context_tokens || 0);
  if (!Number.isFinite(context) || context <= 0) return '';
  if (context >= 1_000_000) return `${compact(context / 1_000_000)}M`;
  if (context >= 1_000) return `${compact(context / 1_000)}K`;
  return String(Math.round(context));
}

export function capabilityBadges(provider: JsonObject, metadata?: JsonObject) {
  const metadataModalities = objectValue(metadata?.modalities);
  const supportedInputs = Array.isArray(metadataModalities.input) ? metadataModalities.input.map(String) : [];
  const enabled = Array.isArray(provider.modalities) ? provider.modalities.map(String) : [];
  const definitions: Array<{ enabled: boolean; icon: `mdi-${string}`; key: string; supported: boolean }> = [
    { key: 'image', icon: 'mdi-image-outline', supported: supportedInputs.includes('image'), enabled: enabled.includes('image') },
    { key: 'audio', icon: 'mdi-music-note-outline', supported: supportedInputs.includes('audio'), enabled: enabled.includes('audio') },
    { key: 'toolUse', icon: 'mdi-wrench-outline', supported: Boolean(metadata?.tool_call), enabled: enabled.includes('tool_use') },
    { key: 'reasoning', icon: 'mdi-brain', supported: Boolean(metadata?.reasoning), enabled: Boolean(provider.reasoning) },
  ];
  return definitions.filter((item) => item.supported || item.enabled).map((item) => ({
    ...item,
    enabled: !metadata || item.enabled,
  }));
}

function uniqueSourceId(baseId: string, existingSources: JsonObject[]) {
  const ids = new Set(existingSources.map((source) => stringValue(source.id)).filter(Boolean));
  if (!ids.has(baseId)) return baseId;
  let suffix = 1;
  while (ids.has(`${baseId}_${suffix}`)) suffix += 1;
  return `${baseId}_${suffix}`;
}

function objectArray(value: unknown) {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function objectValue(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function cloneValue<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function compact(value: number) {
  return String(Math.abs(value) >= 10 ? Math.round(value) : Math.round(value * 10) / 10).replace(/\.0$/, '');
}
