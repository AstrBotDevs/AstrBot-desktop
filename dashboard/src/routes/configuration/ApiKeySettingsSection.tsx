import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createApiKey, deleteApiKey, listApiKeys, revokeApiKey } from '@/api/openapi';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { externalLinks } from '@/config/links';
import { useBrowserCapabilities } from '@/platform/BrowserCapabilitiesProvider';
import { confirmAction, toast } from '@/stores/feedback';
import { acquireActionLock } from '@/utils/actionLock';
import { errorMessage, type JsonObject, objectList, recordId, responseData } from './model';

type ApiScope =
  'bot' | 'provider' | 'persona' | 'im' | 'config' | 'chat' | 'data' | 'file' | 'plugin' | 'mcp' | 'skill';

const API_SCOPES: ApiScope[] = [
  'bot',
  'provider',
  'persona',
  'im',
  'config',
  'chat',
  'data',
  'file',
  'plugin',
  'mcp',
  'skill',
];

function nextScopes(current: ApiScope[], scope: ApiScope) {
  const selected = current.includes(scope);
  if (scope === 'config' && !selected) {
    const required = new Set([...current, 'config', 'bot', 'provider']);
    return API_SCOPES.filter((item) => required.has(item));
  }
  const next = selected ? current.filter((item) => item !== scope) : [...current, scope];
  return selected && (scope === 'bot' || scope === 'provider') ? next.filter((item) => item !== 'config') : next;
}

export function ApiKeySettingsSection() {
  const { copyText } = useBrowserCapabilities();
  const { t } = useTranslation();
  const prefix = 'features.settings.apiKey';
  const [keys, setKeys] = useState<JsonObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState<number | 'permanent'>(30);
  const [scopes, setScopes] = useState<ApiScope[]>(['bot', 'provider', 'im', 'config', 'chat', 'file']);
  const [createdKey, setCreatedKey] = useState('');
  const [creating, setCreating] = useState(false);
  const createLockRef = useRef({ current: false });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setKeys(objectList(responseData(await listApiKeys()), ['keys', 'api_keys', 'items']));
    } catch (cause) {
      const message = errorMessage(cause, t(`${prefix}.messages.loadFailed`));
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!name.trim() || !scopes.length) return;
    const release = acquireActionLock(createLockRef.current);
    if (!release) return;
    setCreating(true);
    try {
      const data = responseData<JsonObject>(
        await createApiKey({
          body: { name: name.trim(), scopes, ...(expiry === 'permanent' ? {} : { expires_in_days: expiry }) },
        }),
      );
      const secret = data?.key ?? data?.api_key ?? data?.token;
      setCreatedKey(typeof secret === 'string' ? secret : '');
      setName('');
      setExpiry(30);
      toast.success(t(`${prefix}.messages.createSuccess`));
      await load();
    } catch (cause) {
      toast.error(errorMessage(cause, t(`${prefix}.messages.createFailed`)));
    } finally {
      setCreating(false);
      release();
    }
  };

  const remove = async (item: JsonObject) => {
    const id = recordId(item, 'key_id', 'id');
    if (
      !id ||
      !(await confirmAction({
        danger: true,
        title: t(`${prefix}.delete`),
        message: `${t(`${prefix}.delete`)} ${String(item.name || id)}?`,
      }))
    )
      return;
    try {
      await deleteApiKey({ path: { key_id: id } });
      toast.success(t(`${prefix}.messages.deleteSuccess`));
      await load();
    } catch (cause) {
      toast.error(errorMessage(cause, t(`${prefix}.messages.deleteFailed`)));
    }
  };

  const revoke = async (item: JsonObject) => {
    const id = recordId(item, 'key_id', 'id');
    if (
      !id ||
      !(await confirmAction({
        danger: true,
        title: t(`${prefix}.revoke`),
        message: `${t(`${prefix}.revoke`)} ${String(item.name || id)}?`,
      }))
    )
      return;
    try {
      await revokeApiKey({ path: { key_id: id } });
      toast.success(t(`${prefix}.messages.revokeSuccess`));
      await load();
    } catch (cause) {
      toast.error(errorMessage(cause, t(`${prefix}.messages.revokeFailed`)));
    }
  };

  return (
    <section className="settings-list-card route-card">
      <header>
        <h2>
          {t(`${prefix}.manageTitle`)}{' '}
          <a aria-label={t(`${prefix}.docsLink`)} href={externalLinks.docs.openApi} rel="noreferrer" target="_blank">
            <MdiIcon name="mdi-help-circle-outline" />
          </a>
        </h2>
        <p>{t(`${prefix}.subtitle`)}</p>
      </header>
      {error && <div className="settings-alert settings-alert--error">{error}</div>}
      <div className="api-key-create">
        <input
          disabled={creating}
          onChange={(event) => setName(event.target.value)}
          placeholder={t(`${prefix}.name`)}
          value={name}
        />
        <select
          aria-label={t(`${prefix}.expiresInDays`)}
          disabled={creating}
          onChange={(event) => setExpiry(event.target.value === 'permanent' ? 'permanent' : Number(event.target.value))}
          value={expiry}
        >
          <option value={1}>{t(`${prefix}.expiryOptions.day1`)}</option>
          <option value={7}>{t(`${prefix}.expiryOptions.day7`)}</option>
          <option value={30}>{t(`${prefix}.expiryOptions.day30`)}</option>
          <option value={90}>{t(`${prefix}.expiryOptions.day90`)}</option>
          <option value="permanent">{t(`${prefix}.expiryOptions.permanent`)}</option>
        </select>
        <button disabled={creating || !name.trim() || !scopes.length} onClick={() => void create()} type="button">
          <MdiIcon className={creating ? 'mdi-spin' : ''} name={creating ? 'mdi-loading' : 'mdi-key-plus'} />
          {t(`${prefix}.create`)}
        </button>
      </div>
      {expiry === 'permanent' && (
        <div className="settings-alert settings-alert--warning">{t(`${prefix}.permanentWarning`)}</div>
      )}
      <div className="api-key-scopes">
        <span>{t(`${prefix}.scopes`)}</span>
        {API_SCOPES.map((scope) => (
          <label className={scopes.includes(scope) ? 'is-selected' : ''} key={scope}>
            <input
              checked={scopes.includes(scope)}
              disabled={creating}
              onChange={() => setScopes((current) => nextScopes(current, scope))}
              type="checkbox"
            />
            {scope}
          </label>
        ))}
      </div>
      {createdKey && (
        <div className="config-secret" role="status">
          <strong>{t(`${prefix}.plaintextHint`)}</strong>
          <code>{createdKey}</code>
          <button
            onClick={() =>
              void copyText(createdKey)
                .then(() => toast.success(t(`${prefix}.messages.copySuccess`)))
                .catch(() => toast.error(t(`${prefix}.messages.copyFailed`)))
            }
            type="button"
          >
            <MdiIcon name="mdi-content-copy" />
            {t(`${prefix}.copy`)}
          </button>
        </div>
      )}
      <ApiKeyTable items={keys} loading={loading} onDelete={remove} onRevoke={revoke} />
    </section>
  );
}

function ApiKeyTable({
  items,
  loading,
  onDelete,
  onRevoke,
}: {
  items: JsonObject[];
  loading: boolean;
  onDelete: (item: JsonObject) => Promise<void>;
  onRevoke: (item: JsonObject) => Promise<void>;
}) {
  const { t } = useTranslation();
  const prefix = 'features.settings.apiKey';
  if (loading) {
    return (
      <div className="monitor-table-wrap">
        <div className="monitor-empty">
          <MdiIcon className="mdi-spin" name="mdi-loading" />
        </div>
      </div>
    );
  }
  return (
    <div className="monitor-table-wrap">
      <table className="monitor-table">
        <thead>
          <tr>
            <th>{t(`${prefix}.table.name`)}</th>
            <th>{t(`${prefix}.table.scopes`)}</th>
            <th>{t(`${prefix}.table.status`)}</th>
            <th>{t(`${prefix}.table.lastUsed`)}</th>
            <th>{t(`${prefix}.table.createdAt`)}</th>
            <th>{t(`${prefix}.table.actions`)}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => {
            const id = recordId(item, 'key_id', 'id') || `key-${index}`;
            const inactive = Boolean(item.is_revoked || item.is_expired);
            return (
              <tr key={id}>
                <td>
                  <strong>{String(item.name || id)}</strong>
                  <small>{String(item.key_prefix || '')}</small>
                </td>
                <td>{Array.isArray(item.scopes) ? item.scopes.join(', ') : '—'}</td>
                <td>
                  <span className={`status-chip status-chip--${inactive ? 'error' : 'success'}`}>
                    {t(`${prefix}.status.${inactive ? 'inactive' : 'active'}`)}
                  </span>
                </td>
                <td>{item.last_used_at ? new Date(String(item.last_used_at)).toLocaleString() : '—'}</td>
                <td>{item.created_at ? new Date(String(item.created_at)).toLocaleString() : '—'}</td>
                <td>
                  <div className="api-key-actions">
                    {!inactive && (
                      <button onClick={() => void onRevoke(item)} type="button">
                        {t(`${prefix}.revoke`)}
                      </button>
                    )}
                    <button className="button--danger" onClick={() => void onDelete(item)} type="button">
                      {t(`${prefix}.delete`)}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!items.length && <div className="monitor-empty">{t(`${prefix}.empty`)}</div>}
    </div>
  );
}
