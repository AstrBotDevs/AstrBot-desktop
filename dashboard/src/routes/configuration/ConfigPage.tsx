import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useBlocker } from 'react-router-dom';

import {
  createConfigProfile,
  deleteConfigProfile,
  getConfigProfile,
  listConfigProfiles,
  renameConfigProfile,
  updateConfigProfileContent,
} from '@/api/openapi';
import { type ConfigProfileDto, parseConfigProfile, parseConfigProfiles } from '@/api/domain';
import { decodeApiData } from '@/api/response';
import { DEFAULT_CONFIG_ID } from '@/config/defaults';
import { MetadataConfigEditor } from '@/components/config/DynamicConfigForm';
import { isConfigRecord, type ConfigRecord } from '@/components/config/configFormModel';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { Dialog, DialogClose } from '@/components/headless/Dialog';
import { confirmAction, toast } from '@/stores/feedback';
import { JsonConfigDialog, LoadingState } from './ConfigurationUi';
import { copiedConfigPayload, hasDuplicateConfigProfileName, normalizeConfigProfileName } from './configProfileModel';
import { errorMessage, parseJsonObject, prettyJson, recordId } from './model';

type ProfileOperation = { mode: 'copy' | 'rename'; profile: { id: string; name: string } };

export default function ConfigPage() {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<ConfigProfileDto[]>([]);
  const [selected, setSelected] = useState(DEFAULT_CONFIG_ID);
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
  const [profileOperation, setProfileOperation] = useState<ProfileOperation | null>(null);
  const [operationName, setOperationName] = useState('');
  const [operationSaving, setOperationSaving] = useState(false);
  const [pendingProfile, setPendingProfile] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);

  const loadProfiles = useCallback(async () => {
    setProfiles(decodeApiData(await listConfigProfiles(), parseConfigProfiles, 'config profile list'));
  }, []);

  const loadContent = useCallback(
    async (id: string) => {
      setLoading(true);
      setError('');
      try {
        const data = decodeApiData(
          await getConfigProfile({ path: { config_id: id } }),
          parseConfigProfile,
          'config profile',
        );
        const next = isConfigRecord(data.config) ? data.config : data;
        setConfig(next);
        setMetadata(isConfigRecord(data.metadata) ? data.metadata : {});
        setSaved(JSON.stringify(next));
      } catch (cause) {
        setError(errorMessage(cause, t('features.config.messages.loadError')));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void loadProfiles().catch((cause) => setError(errorMessage(cause, t('features.config.messages.loadError'))));
  }, [loadProfiles, t]);
  useEffect(() => {
    void loadContent(selected);
  }, [loadContent, selected]);

  const profileOptions = useMemo(() => {
    const items = profiles.map((profile, index) => ({
      id: recordId(profile, 'conf_id', 'id') || `profile-${index}`,
      name: String(profile.name || recordId(profile, 'conf_id', 'id') || `profile-${index}`),
    }));
    return items.some((profile) => profile.id === DEFAULT_CONFIG_ID)
      ? items
      : [{ id: DEFAULT_CONFIG_ID, name: DEFAULT_CONFIG_ID }, ...items];
  }, [profiles]);

  const dirty = JSON.stringify(config) !== saved;
  const blocker = useBlocker(dirty);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  useEffect(() => {
    if (blocker.state === 'blocked') setLeaveOpen(true);
  }, [blocker.state]);

  const save = async (): Promise<boolean> => {
    setSaving(true);
    try {
      await updateConfigProfileContent({ path: { config_id: selected }, body: config });
      setSaved(JSON.stringify(config));
      toast.success(t('features.config.messages.saveSuccess'));
      return true;
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.config.messages.saveError')));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const create = async () => {
    const name = normalizeConfigProfileName(newName);
    if (!name) return;
    if (hasDuplicateConfigProfileName(profileOptions, name)) {
      toast.error(t('features.config.configManagement.nameExists'));
      return;
    }
    try {
      const data = decodeApiData(
        await createConfigProfile({ body: { name, config: {} } }),
        parseConfigProfile,
        'created config profile',
      );
      await loadProfiles();
      setNewName('');
      setSelected(recordId(data, 'conf_id', 'id') || DEFAULT_CONFIG_ID);
      toast.success(t('features.config.messages.saveSuccess'));
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.config.configManagement.createFailed')));
    }
  };

  const remove = async (id: string) => {
    if (
      id === DEFAULT_CONFIG_ID ||
      !(await confirmAction({
        danger: true,
        title: t('features.config.configManagement.title'),
        message: t('features.config.configManagement.confirmDelete', { name: id }),
      }))
    )
      return;
    try {
      await deleteConfigProfile({ path: { config_id: id } });
      if (selected === id) setSelected(DEFAULT_CONFIG_ID);
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
    if (dirty) {
      setPendingProfile(id);
      setLeaveOpen(true);
      return;
    }
    setSelected(id);
  };

  const beginProfileOperation = (mode: ProfileOperation['mode'], profile: { id: string; name: string }) => {
    setProfileOperation({ mode, profile });
    setOperationName(mode === 'copy' ? `${profile.name}-copy` : profile.name);
  };

  const submitProfileOperation = async () => {
    if (!profileOperation) return;
    const name = normalizeConfigProfileName(operationName);
    if (!name) {
      toast.error(t('features.config.configManagement.pleaseEnterName'));
      return;
    }
    const duplicate = hasDuplicateConfigProfileName(
      profileOptions,
      name,
      profileOperation.mode === 'rename' ? profileOperation.profile.id : undefined,
    );
    if (duplicate) {
      toast.error(t('features.config.configManagement.nameExists'));
      return;
    }
    setOperationSaving(true);
    try {
      if (profileOperation.mode === 'rename') {
        await renameConfigProfile({ path: { config_id: profileOperation.profile.id }, body: { name } });
      } else {
        const source = decodeApiData(
          await getConfigProfile({ path: { config_id: profileOperation.profile.id } }),
          parseConfigProfile,
          'source config profile',
        );
        const sourceConfig = copiedConfigPayload(source);
        const created = decodeApiData(
          await createConfigProfile({ body: { name, config: sourceConfig } }),
          parseConfigProfile,
          'copied config profile',
        );
        const createdId = recordId(created, 'conf_id', 'id');
        if (createdId) setSelected(createdId);
      }
      await loadProfiles();
      setProfileOperation(null);
      toast.success(t('features.config.messages.saveSuccess'));
    } catch (cause) {
      toast.error(
        errorMessage(
          cause,
          t(`features.config.configManagement.${profileOperation.mode === 'copy' ? 'copyFailed' : 'updateFailed'}`),
        ),
      );
    } finally {
      setOperationSaving(false);
    }
  };

  const closeLeaveDialog = () => {
    setLeaveOpen(false);
    setPendingProfile(null);
    if (blocker.state === 'blocked') blocker.reset();
  };
  const completeLeave = () => {
    setLeaveOpen(false);
    if (pendingProfile) {
      const next = pendingProfile;
      setPendingProfile(null);
      setSelected(next);
    } else if (blocker.state === 'blocked') {
      blocker.proceed();
    }
  };
  const saveAndLeave = async () => {
    if (await save()) completeLeave();
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
  const floatingActions = !loading && !error && (
    <div className="visual-config-actions">
      <button
        aria-label={t('features.config.codeEditor.title')}
        className="visual-config-fab visual-config-fab--code"
        onClick={openEditor}
        title={t('features.config.codeEditor.title')}
        type="button"
      >
        <MdiIcon name="mdi-code-json" />
      </button>
      <button
        aria-label={t('features.config.actions.save')}
        className="visual-config-fab visual-config-fab--save"
        disabled={saving}
        onClick={() => void save()}
        title={t('features.config.actions.save')}
        type="button"
      >
        <MdiIcon name="mdi-content-save" />
      </button>
    </div>
  );

  return (
    <div className="visual-config-page">
      <div className="visual-config-panel">
        <div className="visual-config-toolbar">
          <label className="visual-config-profile">
            <span>{t('features.config.configSelection.selectConfig')}</span>
            <select
              aria-label={t('features.config.configSelection.selectConfig')}
              onChange={(event) => void chooseProfile(event.target.value)}
              value={selected}
            >
              {profileOptions.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
              <option value="__manage__">{t('features.config.configManagement.manageConfigs')}</option>
            </select>
          </label>
          <label className="visual-config-search">
            <MdiIcon name="mdi-magnify" />
            <input
              aria-label={t('features.config.search.placeholder')}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('features.config.search.placeholder')}
              value={search}
            />
          </label>
        </div>

        {dirty && (
          <div className="visual-config-unsaved" role="status">
            <span>
              <MdiIcon name="mdi-alert-circle-outline" />
              {t('features.config.messages.unsavedChangesNotice')}
            </span>
            <button onClick={() => setConfig(JSON.parse(saved) as ConfigRecord)} type="button">
              {t('core.actions.reset')}
            </button>
          </div>
        )}
        <LoadingState error={error} loading={loading} />
        {!loading && !error && (
          <MetadataConfigEditor metadata={metadata} onChange={setConfig} search={search} value={config} />
        )}
      </div>

      {typeof document !== 'undefined' && floatingActions && createPortal(floatingActions, document.body)}

      <Dialog
        description={t('features.config.configManagement.description')}
        onOpenChange={setManageOpen}
        open={manageOpen}
        title={t('features.config.configManagement.title')}
      >
        <div className="config-manager-create">
          <input
            onChange={(event) => setNewName(event.target.value)}
            placeholder={t('features.config.configManagement.fillConfigName')}
            value={newName}
          />
          <button className="button--primary" disabled={!newName.trim()} onClick={() => void create()} type="button">
            <MdiIcon name="mdi-plus" />
            {t('features.config.configManagement.newConfig')}
          </button>
        </div>
        <div className="config-manager-list">
          {profileOptions.map((profile) => (
            <div key={profile.id}>
              <button
                className={selected === profile.id ? 'is-active' : ''}
                onClick={() => {
                  void chooseProfile(profile.id);
                  setManageOpen(false);
                }}
                type="button"
              >
                {profile.name}
              </button>
              <button
                aria-label={t('features.config.configManagement.copyConfig')}
                onClick={() => beginProfileOperation('copy', profile)}
                title={t('features.config.configManagement.copyConfig')}
                type="button"
              >
                <MdiIcon name="mdi-content-copy" />
              </button>
              {profile.id !== DEFAULT_CONFIG_ID && (
                <>
                  <button
                    aria-label={t('features.config.configManagement.editConfig')}
                    onClick={() => beginProfileOperation('rename', profile)}
                    title={t('features.config.configManagement.editConfig')}
                    type="button"
                  >
                    <MdiIcon name="mdi-pencil" />
                  </button>
                  <button
                    aria-label={t('features.config.actions.delete')}
                    className="button--danger"
                    onClick={() => void remove(profile.id)}
                    title={t('features.config.actions.delete')}
                    type="button"
                  >
                    <MdiIcon name="mdi-delete" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="dialog-actions">
          <DialogClose asChild>
            <button type="button">{t('features.config.buttons.cancel')}</button>
          </DialogClose>
        </div>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) setProfileOperation(null);
        }}
        open={Boolean(profileOperation)}
        title={
          profileOperation?.mode === 'copy'
            ? t('features.config.configManagement.copyConfig')
            : t('features.config.configManagement.editConfig')
        }
      >
        <label className="config-operation-name">
          <span>{t('features.config.configManagement.configName')}</span>
          <input autoFocus onChange={(event) => setOperationName(event.target.value)} value={operationName} />
        </label>
        <div className="dialog-actions">
          <button onClick={() => setProfileOperation(null)} type="button">
            {t('features.config.buttons.cancel')}
          </button>
          <button
            className="button--primary"
            disabled={operationSaving || !operationName.trim()}
            onClick={() => void submitProfileOperation()}
            type="button"
          >
            {profileOperation?.mode === 'rename'
              ? t('features.config.buttons.update')
              : t('features.config.buttons.create')}
          </button>
        </div>
      </Dialog>

      <Dialog
        description={
          pendingProfile
            ? t('features.config.unsavedChangesWarning.switchConfig')
            : t('features.config.unsavedChangesWarning.leavePage')
        }
        onOpenChange={(open) => {
          if (!open) closeLeaveDialog();
        }}
        open={leaveOpen}
        title={t('features.config.unsavedChangesWarning.dialogTitle')}
      >
        <div className="dialog-actions">
          <button onClick={closeLeaveDialog} type="button">
            {t('features.config.unsavedChangesWarning.options.cancel')}
          </button>
          <button onClick={completeLeave} type="button">
            {t('features.config.unsavedChangesWarning.options.discardAndSwitch')}
          </button>
          <button className="button--primary" disabled={saving} onClick={() => void saveAndLeave()} type="button">
            {pendingProfile
              ? t('features.config.unsavedChangesWarning.options.saveAndSwitch')
              : t('features.config.unsavedChangesWarning.options.save')}
          </button>
        </div>
      </Dialog>

      <JsonConfigDialog
        jsonOnly
        onChange={setEditorSource}
        onOpenChange={setEditorOpen}
        onSave={applyEditor}
        open={editorOpen}
        title={t('features.config.codeEditor.title')}
        value={editorSource}
      />
    </div>
  );
}
