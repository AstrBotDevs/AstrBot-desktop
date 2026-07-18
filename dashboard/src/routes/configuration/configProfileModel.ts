import { isConfigRecord, type ConfigRecord } from '@/components/config/configFormModel';

export type ConfigProfileOption = { id: string; name: string };

export function normalizeConfigProfileName(value: string) {
  return value.trim();
}

export function hasDuplicateConfigProfileName(options: ConfigProfileOption[], name: string, excludeId?: string) {
  const normalized = normalizeConfigProfileName(name).toLocaleLowerCase();
  return options.some(
    (option) => option.id !== excludeId && normalizeConfigProfileName(option.name).toLocaleLowerCase() === normalized,
  );
}

export function copiedConfigPayload(source: Record<string, unknown>): ConfigRecord {
  return isConfigRecord(source.config) ? source.config : source;
}
