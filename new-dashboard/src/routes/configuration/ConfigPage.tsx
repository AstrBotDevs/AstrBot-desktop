import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { createConfigProfile, deleteConfigProfile, getConfigProfile, listConfigProfiles, updateConfigProfileContent } from '@/api/openapi';
import { MetadataConfigEditor } from '@/components/config/DynamicConfigForm';
import { isConfigRecord, type ConfigRecord } from '@/components/config/configFormModel';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { Dialog, DialogClose } from '@/components/headless/Dialog';
import { confirmAction, toast } from '@/stores/feedback';
import { JsonConfigDialog, LoadingState } from './ConfigurationUi';
import { errorMessage, JsonObject, objectList, parseJsonObject, prettyJson, recordId, responseData } from './model';

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
  const [search, setSearch] = useState('');
  const [manageOpen, setManageOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSource, setEditorSource] = useState('{}');

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
      setError(errorMessage(cause, t('features.config.messages.loadError')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void loadProfiles().catch((cause) => setError(errorMessage(cause, t('features.config.messages.loadError')))); }, [loadProfiles, t]);
  useEffect(() => { void loadContent(selected); }, [loadContent, selected]);

  const profileOptions = useMemo(() => {
    const items = profiles.map((profile, index) => ({
      id: recordId(profile, 'conf_id', 'id') || `profile-${index}`,
      name: String(profile.name || recordId(profile, 'conf_id', 'id') || `profile-${index}`),
    }));
    return items.some((profile) => profile.id === 'default') ? items : [{ id: 'default', name: 'default' }, ...items];
  }, [profiles]);

  const dirty = JSON.stringify(config) !== saved;

  const save = async () => {
    setSaving(true);
    try {
      await updateConfigProfileContent({ path: { config_id: selected }, body: config });
      setSaved(JSON.stringify(config));
      toast.success(t('features.config.messages.saveSuccess'));
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.config.messages.saveError')));
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
      toast.success(t('features.config.messages.saveSuccess'));
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.config.configManagement.createFailed')));
    }
  };

  const remove = async (id: string) => {
    if (id === 'default' || !await confirmAction({ danger: true, title: t('features.config.configManagement.title'), message: t('features.config.configManagement.confirmDelete', { name: id }) })) return;
    try {
      await deleteConfigProfile({ path: { config_id: id } });
      if (selected === id) setSelected('default');
      await loadProfiles();
      toast.success(t('features.config.messages.deleteSuccess'));
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.config.configManagement.deleteFailed')));
    }
  };

  const chooseProfile = async (id: string) => {
    if (id === '__manage__') {
      setManageOpen(true);
      return;
    }
    if (id === selected) return;
    if (dirty && !await confirmAction({
      title: t('features.config.unsavedChangesWarning.dialogTitle'),
      message: t('features.config.unsavedChangesWarning.switchConfig'),
    })) return;
    setSelected(id);
  };

  const openEditor = () => {
    setEditorSource(prettyJson(config));
    setEditorOpen(true);
  };

  const applyEditor = () => {
    try {
      setConfig(parseJsonObject(editorSource));
      setEditorOpen(false);
      toast.success(t('features.config.messages.configApplied'));
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.config.messages.configApplyError')));
    }
  };
  const floatingActions = !loading && !error && <div className="visual-config-actions">
    <button aria-label={t('features.config.codeEditor.title')} className="visual-config-fab visual-config-fab--code" onClick={openEditor} title={t('features.config.codeEditor.title')} type="button"><MdiIcon name="mdi-code-json" /></button>
    <button aria-label={t('features.config.actions.save')} className="visual-config-fab visual-config-fab--save" disabled={saving} onClick={() => void save()} title={t('features.config.actions.save')} type="button"><MdiIcon name="mdi-content-save" /></button>
  </div>;

  return <div className="visual-config-page">
    <div className="visual-config-panel">
      <div className="visual-config-toolbar">
        <label className="visual-config-profile">
          <span>{t('features.config.configSelection.selectConfig')}</span>
          <select aria-label={t('features.config.configSelection.selectConfig')} onChange={(event) => void chooseProfile(event.target.value)} value={selected}>
            {profileOptions.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            <option value="__manage__">{t('features.config.configManagement.manageConfigs')}</option>
          </select>
        </label>
        <label className="visual-config-search">
          <MdiIcon name="mdi-magnify" />
          <input aria-label={t('features.config.search.placeholder')} onChange={(event) => setSearch(event.target.value)} placeholder={t('features.config.search.placeholder')} value={search} />
        </label>
      </div>

      {dirty && <div className="visual-config-unsaved" role="status"><span><MdiIcon name="mdi-alert-circle-outline" />{t('features.config.messages.unsavedChangesNotice')}</span><button onClick={() => setConfig(JSON.parse(saved) as ConfigRecord)} type="button">{t('core.actions.reset')}</button></div>}
      <LoadingState error={error} loading={loading} />
      {!loading && !error && <MetadataConfigEditor metadata={metadata} onChange={setConfig} search={search} value={config} />}
    </div>

    {typeof document !== 'undefined' && floatingActions && createPortal(floatingActions, document.body)}

    <Dialog description={t('features.config.configManagement.description')} onOpenChange={setManageOpen} open={manageOpen} title={t('features.config.configManagement.title')}>
      <div className="config-manager-create"><input onChange={(event) => setNewName(event.target.value)} placeholder={t('features.config.configManagement.fillConfigName')} value={newName} /><button className="button--primary" disabled={!newName.trim()} onClick={() => void create()} type="button"><MdiIcon name="mdi-plus" />{t('features.config.configManagement.newConfig')}</button></div>
      <div className="config-manager-list">{profileOptions.map((profile) => <div key={profile.id}><button className={selected === profile.id ? 'is-active' : ''} onClick={() => { void chooseProfile(profile.id); setManageOpen(false); }} type="button">{profile.name}</button>{profile.id !== 'default' && <button aria-label={t('features.config.actions.delete')} className="button--danger" onClick={() => void remove(profile.id)} title={t('features.config.actions.delete')} type="button"><MdiIcon name="mdi-delete" /></button>}</div>)}</div>
      <div className="dialog-actions"><DialogClose asChild><button type="button">{t('features.config.buttons.cancel')}</button></DialogClose></div>
    </Dialog>

    <JsonConfigDialog initialMode="json" onChange={setEditorSource} onOpenChange={setEditorOpen} onSave={applyEditor} open={editorOpen} title={t('features.config.codeEditor.title')} value={editorSource} />
  </div>;
}
