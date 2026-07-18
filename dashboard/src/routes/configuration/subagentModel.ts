import { isObject, type JsonObject } from './model';

export type SubagentItem = {
  key: string;
  name: string;
  personaId: string;
  publicDescription: string;
  enabled: boolean;
  providerId?: string;
};

export type SubagentConfig = {
  mainEnable: boolean;
  removeMainDuplicateTools: boolean;
  agents: SubagentItem[];
};

export type SubagentValidation = {
  key: 'nameMissing' | 'nameInvalid' | 'nameDuplicate' | 'personaMissing';
  values?: { name: string };
};

export const EMPTY_SUBAGENT_CONFIG: SubagentConfig = {
  mainEnable: false,
  removeMainDuplicateTools: false,
  agents: [],
};

export function newSubagent(key: string): SubagentItem {
  return { key, name: '', personaId: '', publicDescription: '', enabled: true };
}

export function normalizeSubagentConfig(value: unknown, createKey: () => string): SubagentConfig {
  const raw = isObject(value) ? value : {};
  const agents = Array.isArray(raw.agents)
    ? raw.agents.filter(isObject).map((agent) => ({
        key: createKey(),
        name: String(agent.name ?? ''),
        personaId: String(agent.persona_id ?? ''),
        publicDescription: String(agent.public_description ?? ''),
        enabled: agent.enabled !== false,
        providerId: agent.provider_id == null ? undefined : String(agent.provider_id),
      }))
    : [];
  return {
    mainEnable: Boolean(raw.main_enable),
    removeMainDuplicateTools: Boolean(raw.remove_main_duplicate_tools),
    agents,
  };
}

export function subagentPayload(config: SubagentConfig): JsonObject {
  return {
    main_enable: config.mainEnable,
    remove_main_duplicate_tools: config.removeMainDuplicateTools,
    agents: config.agents.map((agent) => ({
      name: agent.name.trim(),
      persona_id: agent.personaId,
      public_description: agent.publicDescription,
      enabled: agent.enabled,
      ...(agent.providerId ? { provider_id: agent.providerId } : {}),
    })),
  };
}

export function serializeSubagentConfig(config: SubagentConfig) {
  return JSON.stringify(subagentPayload(config));
}

export function validateSubagentConfig(config: SubagentConfig): SubagentValidation | null {
  const namePattern = /^[a-z][a-z0-9_]{0,63}$/;
  const seen = new Set<string>();
  for (const agent of config.agents) {
    const name = agent.name.trim();
    if (!name) return { key: 'nameMissing' };
    if (!namePattern.test(name)) return { key: 'nameInvalid' };
    if (seen.has(name)) return { key: 'nameDuplicate', values: { name } };
    seen.add(name);
    if (!agent.personaId) return { key: 'personaMissing', values: { name } };
  }
  return null;
}
