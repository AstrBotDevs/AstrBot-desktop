import { ApiPayloadError, expectRecord, isRecord } from '@/api/response';

export const FOLLOW_CONFIG_VALUE = '__astrbot_follow_config__';

export type ProviderOption = { id: string; model?: string; name?: string };
export type PersonaOption = { id?: string; name: string };
export type PluginOption = { display_name?: string; name: string };
export type KnowledgeOption = { emoji?: string; kb_id: string; kb_name: string };
export type UmoInfo = {
  auto_name?: string;
  display_name?: string;
  message_type?: string;
  platform?: string;
  session_id?: string;
  umo: string;
  user_alias?: string;
};
export type ServiceConfig = {
  custom_name?: string;
  llm_enabled: boolean;
  persona_id?: string | null;
  session_enabled: boolean;
  tts_enabled: boolean;
};
export type PluginConfig = { disabled_plugins: string[]; enabled_plugins: string[] };
export type KnowledgeConfig = { enable_rerank: boolean; kb_ids: string[]; top_k: number };
export type SessionRule = UmoInfo & { rules: Record<string, unknown> };
export type SessionRulesData = {
  available_chat_providers?: ProviderOption[];
  available_kbs?: KnowledgeOption[];
  available_personas?: PersonaOption[];
  available_plugins?: PluginOption[];
  available_stt_providers?: ProviderOption[];
  available_tts_providers?: ProviderOption[];
  rules?: SessionRule[];
  total?: number;
};
export type SessionGroup = { id: string; name?: string; umo_count?: number; umos?: string[] };
export type ActiveUmoData = { umo_infos?: UmoInfo[]; umos?: string[] };
export type BatchScope = 'selected' | 'all' | 'group' | 'private' | `custom_group:${string}`;
export type EditorState = {
  kb: KnowledgeConfig;
  plugin: PluginConfig;
  providers: {
    chat_completion: string;
    speech_to_text: string;
    text_to_speech: string;
  };
  service: ServiceConfig;
};

export function sessionRecordValue(value: unknown) {
  return isRecord(value) ? value : {};
}

export function parseSessionRulesData(value: unknown): SessionRulesData {
  const payload = expectRecord(value, 'session rules');
  return {
    available_chat_providers: parseProviderOptions(payload.available_chat_providers),
    available_kbs: parseKnowledgeOptions(payload.available_kbs),
    available_personas: parsePersonaOptions(payload.available_personas),
    available_plugins: parsePluginOptions(payload.available_plugins),
    available_stt_providers: parseProviderOptions(payload.available_stt_providers),
    available_tts_providers: parseProviderOptions(payload.available_tts_providers),
    rules: arrayValue(payload.rules, 'session rules').map((item, index) => {
      const rule = expectRecord(item, `session rules[${index}]`);
      const umo = requiredText(rule.umo, `session rules[${index}].umo`);
      return {
        ...rule,
        ...parseUmo(umo),
        rules: isRecord(rule.rules) ? rule.rules : {},
        umo,
      };
    }),
    total: numberValue(payload.total) ?? 0,
  };
}

export function parseSessionGroups(value: unknown): SessionGroup[] {
  const payload = Array.isArray(value) ? value : expectRecord(value, 'session groups').groups;
  return arrayValue(payload, 'session groups').map((item, index) => {
    const group = expectRecord(item, `session groups[${index}]`);
    return {
      id: requiredText(group.id, `session groups[${index}].id`),
      name: typeof group.name === 'string' ? group.name : undefined,
      umo_count: numberValue(group.umo_count),
      umos: stringList(group.umos),
    };
  });
}

export function parseActiveUmos(value: unknown): ActiveUmoData {
  const payload = expectRecord(value, 'active UMO data');
  return {
    umos: stringList(payload.umos),
    umo_infos: arrayValue(payload.umo_infos, 'active UMO infos').map((item, index) => {
      const info = expectRecord(item, `active UMO infos[${index}]`);
      const umo = requiredText(info.umo, `active UMO infos[${index}].umo`);
      const parsed = parseUmo(umo);
      return {
        ...parsed,
        auto_name: textValue(info.auto_name),
        display_name: textValue(info.display_name) ?? parsed.display_name,
        message_type: textValue(info.message_type) ?? parsed.message_type,
        platform: textValue(info.platform) ?? parsed.platform,
        session_id: textValue(info.session_id) ?? parsed.session_id,
        umo,
        user_alias: textValue(info.user_alias),
      };
    }),
  };
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function arrayValue(value: unknown, field: string) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new ApiPayloadError(`Expected ${field} to be an array.`, value);
  return value;
}

function requiredText(value: unknown, field: string) {
  if (typeof value !== 'string' || !value) throw new ApiPayloadError(`Expected ${field} to be a non-empty string.`, value);
  return value;
}

function textValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function parseProviderOptions(value: unknown): ProviderOption[] {
  return arrayValue(value, 'provider options').map((item, index) => {
    const provider = expectRecord(item, `provider options[${index}]`);
    return {
      id: requiredText(provider.id, `provider options[${index}].id`),
      model: textValue(provider.model),
      name: textValue(provider.name),
    };
  });
}

function parsePersonaOptions(value: unknown): PersonaOption[] {
  return arrayValue(value, 'persona options').map((item, index) => {
    const persona = expectRecord(item, `persona options[${index}]`);
    return { id: textValue(persona.id), name: requiredText(persona.name, `persona options[${index}].name`) };
  });
}

function parsePluginOptions(value: unknown): PluginOption[] {
  return arrayValue(value, 'plugin options').map((item, index) => {
    const plugin = expectRecord(item, `plugin options[${index}]`);
    return {
      display_name: textValue(plugin.display_name),
      name: requiredText(plugin.name, `plugin options[${index}].name`),
    };
  });
}

function parseKnowledgeOptions(value: unknown): KnowledgeOption[] {
  return arrayValue(value, 'knowledge options').map((item, index) => {
    const knowledge = expectRecord(item, `knowledge options[${index}]`);
    return {
      emoji: textValue(knowledge.emoji),
      kb_id: requiredText(knowledge.kb_id, `knowledge options[${index}].kb_id`),
      kb_name: requiredText(knowledge.kb_name, `knowledge options[${index}].kb_name`),
    };
  });
}

export function parseUmo(umo: string): UmoInfo {
  const [platform = '', messageType = '', ...sessionParts] = umo.split(':');
  return {
    display_name: umo,
    message_type: messageType,
    platform,
    session_id: sessionParts.join(':') || umo,
    umo,
  };
}

export function sessionDisplayName(item: UmoInfo, customName?: string) {
  const alias = item.user_alias || customName || '';
  const automatic = item.auto_name || '';
  if (alias && automatic && alias !== automatic) return `${alias}（${automatic}）`;
  return alias || automatic || item.umo;
}

export function initialSessionEditor(item: SessionRule): EditorState {
  const service = sessionRecordValue(item.rules.session_service_config);
  const plugin = sessionRecordValue(item.rules.session_plugin_config);
  const kb = sessionRecordValue(item.rules.kb_config);
  return {
    service: {
      custom_name: typeof service.custom_name === 'string' ? service.custom_name : '',
      llm_enabled: service.llm_enabled !== false,
      persona_id: typeof service.persona_id === 'string' ? service.persona_id : null,
      session_enabled: service.session_enabled !== false,
      tts_enabled: service.tts_enabled !== false,
    },
    providers: {
      chat_completion: typeof item.rules.provider_perf_chat_completion === 'string'
        ? item.rules.provider_perf_chat_completion : FOLLOW_CONFIG_VALUE,
      speech_to_text: typeof item.rules.provider_perf_speech_to_text === 'string'
        ? item.rules.provider_perf_speech_to_text : FOLLOW_CONFIG_VALUE,
      text_to_speech: typeof item.rules.provider_perf_text_to_speech === 'string'
        ? item.rules.provider_perf_text_to_speech : FOLLOW_CONFIG_VALUE,
    },
    plugin: {
      disabled_plugins: stringList(plugin.disabled_plugins),
      enabled_plugins: stringList(plugin.enabled_plugins),
    },
    kb: {
      enable_rerank: kb.enable_rerank !== false,
      kb_ids: stringList(kb.kb_ids),
      top_k: typeof kb.top_k === 'number' ? kb.top_k : 5,
    },
  };
}
