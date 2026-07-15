import type { JsonObject } from './model';

export type PlatformRuntime = {
  config: JsonObject;
  metadata: JsonObject;
  translations?: Record<string, JsonObject>;
};

export function readPlatformRuntime(value: unknown): PlatformRuntime {
  const data = isRecord(value) ? value : {};
  return {
    config: isRecord(data.config) ? data.config : {},
    metadata: isRecord(data.metadata) ? data.metadata : {},
    translations: isRecord(data.platform_i18n_translations)
      ? data.platform_i18n_translations as Record<string, JsonObject>
      : undefined,
  };
}

export function platformTemplates(metadata: JsonObject) {
  const group = isRecord(metadata.platform_group) ? metadata.platform_group : {};
  const groupMetadata = isRecord(group.metadata) ? group.metadata : {};
  const platform = isRecord(groupMetadata.platform) ? groupMetadata.platform : {};
  return isRecord(platform.config_template) ? platform.config_template as Record<string, JsonObject> : {};
}

export function platformFormMetadata(metadata: JsonObject) {
  const group = isRecord(metadata.platform_group) ? metadata.platform_group : {};
  const groupMetadata = isRecord(group.metadata) ? group.metadata : {};
  return isRecord(groupMetadata.platform) ? groupMetadata.platform : {};
}

export function mergePlatformTemplate(source: JsonObject, template?: JsonObject): JsonObject {
  if (!template) return clone(source);
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(template)) {
    result[key] = key in source ? mergeValue(source[key], value) : cloneValue(value);
  }
  for (const [key, value] of Object.entries(source)) {
    if (!(key in result)) result[key] = cloneValue(value);
  }
  return result;
}

export function platformQrPayload(stat?: JsonObject) {
  if (!stat) return null;
  const candidates = [stat.weixin_oc, ...Object.values(stat)];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const payload = candidate.qrcode_img_content || candidate.qrcode;
    if (typeof payload === 'string' && payload) return { payload, status: String(candidate.qr_status || '') };
  }
  return null;
}

export function webhookUrl(config: JsonObject, uuid: string) {
  const configured = typeof config.callback_api_base === 'string' ? config.callback_api_base.trim() : '';
  const base = (configured || 'http(s)://<your-domain-or-ip>').replace(/\/$/, '');
  return `${base}/api/v1/webhooks/platforms/${uuid}`;
}

export function isValidPlatformId(id: string) {
  return Boolean(id) && !/[!:\s]/.test(id);
}

function mergeValue(source: unknown, template: unknown): unknown {
  if (isRecord(template) && isRecord(source)) return mergePlatformTemplate(source, template);
  return cloneValue(source);
}

function clone(value: JsonObject) {
  return cloneValue(value) as JsonObject;
}

function cloneValue<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
