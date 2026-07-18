import { ApiError, fetchWithAuth, readApiErrorMessage, type RequestDependencies } from './http';
import { ApiPayloadError, isRecord, unwrapApiData, type UnknownRecord } from './response';

const ANNOUNCEMENT_URL = 'https://cloud.astrbot.app/api/v1/announcement';

type PublicRequestDependencies = Pick<RequestDependencies, 'fetch'>;

export type ConversationExportItem = {
  cid: string;
  user_id: string;
};

export class SystemConfigTwoFactorRequired extends ApiError {
  constructor(payload: unknown) {
    super('Two-factor authentication is required.', 401, payload);
    this.name = 'SystemConfigTwoFactorRequired';
  }
}

export const announcementApi = {
  async welcomeNotice(dependencies: PublicRequestDependencies = {}) {
    const fetchImpl = dependencies.fetch ?? fetch;
    const response = await fetchImpl(ANNOUNCEMENT_URL);
    const payload = await responsePayload(response);
    if (!response.ok) throw apiError(response, payload);
    const data = unwrapApiData(payload);
    if (!isRecord(data)) return null;
    const notice = isRecord(data.notice) ? data.notice : {};
    return notice.welcome_page ?? null;
  },
};

export const conversationFilesApi = {
  export: (conversations: ConversationExportItem[], dependencies: RequestDependencies = {}) => (
    requestBlob(
      '/api/v1/conversations/export',
      {
        body: JSON.stringify({ conversations }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      },
      dependencies,
    )
  ),
};

export const backupFilesApi = {
  download: (filename: string, dependencies: RequestDependencies = {}) => requestBlob(
    `/api/v1/backups/${encodeURIComponent(filename)}`,
    {},
    dependencies,
  ),
};

export const systemConfigApi = {
  async update(
    config: UnknownRecord,
    twoFactorCode?: string,
    dependencies: RequestDependencies = {},
  ) {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (twoFactorCode) headers.set('X-2FA-Code', twoFactorCode);
    const response = await fetchWithAuth(
      '/api/v1/system-config',
      { body: JSON.stringify(config), headers, method: 'PUT' },
      { ...dependencies, skipUnauthorizedHandling: true },
    );
    const payload = await responsePayload(response);
    if (response.status === 401 && hasTotpRequirement(payload)) {
      throw new SystemConfigTwoFactorRequired(payload);
    }
    if (!response.ok) throw apiError(response, payload);
    unwrapApiData(payload);
  },
};

export type PluginExtensionMethod = 'delete' | 'get' | 'patch' | 'post' | 'put';

export const pluginExtensionApi = {
  async request(
    pluginName: string,
    action: unknown,
    endpointValue: unknown,
    params?: UnknownRecord,
    body?: unknown,
    dependencies: RequestDependencies = {},
  ) {
    const method = pluginExtensionMethod(action);
    const endpoint = validPluginEndpoint(endpointValue);
    const query = queryString(params);
    const path = `/api/v1/plugins/extensions/${encodeURIComponent(pluginName)}/${endpoint}${query}`;
    const init: RequestInit = { method: method.toUpperCase() };
    if (body !== undefined && method !== 'get') {
      init.body = JSON.stringify(body);
      init.headers = { 'Content-Type': 'application/json' };
    }
    const response = await fetchWithAuth(path, init, dependencies);
    const payload = await responsePayload(response);
    if (!response.ok) throw apiError(response, payload);
    return unwrapApiData(payload);
  },
};

export function validPluginEndpoint(value: unknown) {
  if (typeof value !== 'string') throw new Error('Plugin endpoint must be a string.');
  const parts = value.trim().replace(/^\/+/, '').split('/');
  if (
    !parts.length
    || parts.some((part) => (
      !part || part === '.' || part === '..'
      || part.includes('\\') || part.includes('?') || part.includes('#')
    ))
  ) {
    throw new Error('Invalid plugin endpoint.');
  }
  return parts.map(encodeURIComponent).join('/');
}

function pluginExtensionMethod(action: unknown): PluginExtensionMethod {
  const method = typeof action === 'string' ? action.split(':')[1] : undefined;
  if (method === 'get' || method === 'post' || method === 'put' || method === 'patch' || method === 'delete') {
    return method;
  }
  throw new Error(`Unsupported plugin bridge action: ${String(action)}`);
}

function queryString(params?: UnknownRecord) {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      value.forEach((item) => search.append(key, String(item)));
    } else if (typeof value === 'object') {
      search.set(key, JSON.stringify(value));
    } else {
      search.set(key, String(value));
    }
  }
  const value = search.toString();
  return value ? `?${value}` : '';
}

async function requestBlob(
  path: string,
  init: RequestInit,
  dependencies: RequestDependencies,
) {
  const response = await fetchWithAuth(path, init, dependencies);
  if (!response.ok) {
    const payload = await responsePayload(response);
    throw apiError(response, payload);
  }
  const blob = await response.blob();
  if (!(blob instanceof Blob)) throw new ApiPayloadError('Expected API response to be a Blob.', blob);
  return blob;
}

async function responsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) return text;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function apiError(response: Response, payload: unknown) {
  return new ApiError(readApiErrorMessage(payload, response.statusText), response.status, payload);
}

function hasTotpRequirement(payload: unknown) {
  if (!isRecord(payload)) return false;
  const data = isRecord(payload.data) ? payload.data : {};
  return data.totp_required === true;
}
