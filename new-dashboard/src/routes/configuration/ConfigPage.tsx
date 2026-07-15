import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createConfigProfile, deleteConfigProfile, getConfigProfile, listConfigProfiles, updateConfigProfileContent } from '@/api/openapi';
import { MetadataConfigEditor } from '@/components/config/DynamicConfigForm';
import { isConfigRecord, type ConfigRecord } from '@/components/config/configFormModel';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { confirmAction, toast } from '@/stores/feedback';
import { ConfigPageShell, LoadingState } from './ConfigurationUi';
import { errorMessage, JsonObject, objectList, recordId, responseData } from './model';

type Profile = JsonObject & { conf_id?: string; id?: string; name?: string };

export default function ConfigPage() {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selected, setSelected] = useState('default');
  const [config, setConfig] = useState<ConfigRecord>({});
  const [metadata, setMetadata] = useState<ConfigRecord>({});
  const [saved, setSaved] = useState('{}');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');

  const loadProfiles = useCallback(async () => {
    const data = responseData(await listConfigProfiles());
    setProfiles(objectList(data, ['info_list', 'configs', 'profiles']) as Profile[]);
  }, []);

  const loadContent = useCallback(async (id: string) => {
    setLoading(true);
    setError('');
    try {
      const data = responseData<JsonObject>(await getConfigProfile({ path: { config_id: id } })) ?? {};
      const next = isConfigRecord(data.config) ? data.config : data;
      setConfig(next);
      setMetadata(isConfigRecord(data.metadata) ? data.metadata : {});
      setSaved(JSON.stringify(next));
    } catch (cause) {
      setError(errorMessage(cause, 'Failed to load configuration.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadProfiles().catch((cause) => setError(errorMessage(cause, 'Failed to load profiles.'))); }, [loadProfiles]);
  useEffect(() => { void loadContent(selected); }, [loadContent, selected]);

  const save = async () => {
    setSaving(true);
    try {
      await updateConfigProfileContent({ path: { config_id: selected }, body: config });
      setSaved(JSON.stringify(config));
      toast.success('Configuration saved.');
    } catch (cause) {
      toast.error(errorMessage(cause, 'Failed to save configuration.'));
    } finally {
      setSaving(false);
    }
  };

  const create = async () => {
    if (!newName.trim()) return;
    try {
      const data = responseData<JsonObject>(await createConfigProfile({ body: { name: newName.trim(), config: {} } }));
      await loadProfiles();
      setNewName('');
      setSelected(recordId(data, 'conf_id', 'id') || 'default');
      toast.success('Configuration profile created.');
    } catch (cause) {
      toast.error(errorMessage(cause, 'Failed to create profile.'));
    }
  };

  const remove = async () => {
    if (selected === 'default' || !await confirmAction({ danger: true, title: 'Delete profile', message: `Delete configuration profile ${selected}?` })) return;
    try {
      await deleteConfigProfile({ path: { config_id: selected } });
      setSelected('default');
      await loadProfiles();
      toast.success('Profile deleted.');
    } catch (cause) {
      toast.error(errorMessage(cause, 'Failed to delete profile.'));
    }
  };

  const dirty = JSON.stringify(config) !== saved;
  return <ConfigPageShell actions={<><button disabled={loading || !dirty} onClick={() => setConfig(JSON.parse(saved) as ConfigRecord)} type="button">{t('core.actions.reset')}</button><button className="button--primary" disabled={loading || saving || !dirty} onClick={() => void save()} type="button"><MdiIcon name="mdi-content-save" />{saving ? '…' : t('features.config.actions.save')}</button></>} description={t('features.config.subtitle')} title={t('features.config.title')}><div className="config-workspace config-workspace--visual"><aside className="route-card config-profile-list">{profiles.map((profile, index) => { const id = recordId(profile, 'conf_id', 'id') || `profile-${index}`; return <button className={selected === id ? 'is-active' : ''} key={id} onClick={() => setSelected(id)} type="button">{String(profile.name || id)}</button>; })}<div className="config-inline-form"><input onChange={(event) => setNewName(event.target.value)} placeholder={t('features.config.configManagement.fillConfigName')} value={newName} /><button disabled={!newName.trim()} onClick={() => void create()} type="button">{t('features.config.actions.add')}</button></div>{selected !== 'default' && <button className="button--danger" onClick={() => void remove()} type="button">{t('features.config.actions.delete')}</button>}</aside><section className="config-visual-panel"><LoadingState error={error} loading={loading} />{!loading && <MetadataConfigEditor metadata={metadata} onChange={setConfig} value={config} />}</section></div></ConfigPageShell>;
}
