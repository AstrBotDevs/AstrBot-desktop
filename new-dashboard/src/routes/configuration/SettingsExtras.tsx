import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  abortBackupUpload,
  checkBackup,
  cleanupStorage,
  completeBackupUpload,
  createBackup,
  deleteBackup,
  getBackupProgress,
  getStorageStatus,
  importBackup,
  initBackupUpload,
  listBackups,
  renameBackup,
  uploadBackupChunk,
} from '@/api/openapi';
import { statsApi } from '@/api/compat';
import { backupFilesApi } from '@/api/services';
import { Dialog, DialogClose } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';
import {
  defaultNavigationItems,
  MORE_GROUP_KEY,
  readNavigationItems,
  type NavigationItem,
} from '@/layouts/full/navigation';
import { confirmAction, toast } from '@/stores/feedback';
import { errorMessage, isObject, objectList, responseData, type JsonObject } from './model';

const SIDEBAR_STORAGE_KEY = 'astrbot_sidebar_customization';
const GITHUB_PROXIES = [
  'https://edgeone.gh-proxy.com',
  'https://hk.gh-proxy.com',
  'https://gh-proxy.com',
  'https://gh.dpik.top',
];

function flatNavigation() {
  const main = defaultNavigationItems.filter((item) => item.title !== MORE_GROUP_KEY);
  const more = defaultNavigationItems.find((item) => item.title === MORE_GROUP_KEY)?.children ?? [];
  return { all: new Map([...main, ...more].map((item) => [item.title, item])), main, more };
}

function splitNavigation(items: NavigationItem[]) {
  return {
    main: items.filter((item) => item.title !== MORE_GROUP_KEY),
    more: items.find((item) => item.title === MORE_GROUP_KEY)?.children ?? [],
  };
}

export function SidebarCustomizer() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const initial = useMemo(() => splitNavigation(readNavigationItems()), [open]);
  const [main, setMain] = useState(initial.main);
  const [more, setMore] = useState(initial.more);
  const dragging = useRef<{ index: number; list: 'main' | 'more' } | null>(null);

  const show = () => {
    const next = splitNavigation(readNavigationItems());
    setMain(next.main);
    setMore(next.more);
    setOpen(true);
  };
  const move = (source: 'main' | 'more', index: number, target: 'main' | 'more', targetIndex?: number) => {
    const sourceList = source === 'main' ? main : more;
    const item = sourceList[index];
    if (!item) return;
    const nextMain = main.filter((_, itemIndex) => source !== 'main' || itemIndex !== index);
    const nextMore = more.filter((_, itemIndex) => source !== 'more' || itemIndex !== index);
    const targetList = target === 'main' ? nextMain : nextMore;
    targetList.splice(targetIndex ?? targetList.length, 0, item);
    setMain(nextMain);
    setMore(nextMore);
  };
  const drop = (event: DragEvent, target: 'main' | 'more', index?: number) => {
    event.preventDefault();
    if (dragging.current) move(dragging.current.list, dragging.current.index, target, index);
    dragging.current = null;
  };
  const save = () => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify({
      mainItems: main.map((item) => item.title),
      moreItems: more.map((item) => item.title),
    }));
    window.dispatchEvent(new CustomEvent('sidebar-customization-changed'));
    setOpen(false);
  };
  const reset = () => {
    localStorage.removeItem(SIDEBAR_STORAGE_KEY);
    const defaults = flatNavigation();
    setMain(defaults.main);
    setMore(defaults.more);
    window.dispatchEvent(new CustomEvent('sidebar-customization-changed'));
  };

  return <>
    <button onClick={show} type="button">{t('features.settings.sidebar.customize.title')}</button>
    <Dialog onOpenChange={setOpen} open={open} title={t('features.settings.sidebar.customize.title')}>
      <div className="sidebar-customizer">
        <p>{t('features.settings.sidebar.customize.subtitle')}</p>
        <div className="sidebar-customizer__columns">
          <SidebarItemList items={main} label={t('features.settings.sidebar.customize.mainItems')} list="main" move={move} onDragStart={(list, index) => { dragging.current = { list, index }; }} onDrop={drop} t={t} />
          <SidebarItemList items={more} label={t('features.settings.sidebar.customize.moreItems')} list="more" move={move} onDragStart={(list, index) => { dragging.current = { list, index }; }} onDrop={drop} t={t} />
        </div>
        <div className="dialog-actions"><button className="button--danger-text" onClick={reset} type="button">{t('features.settings.sidebar.customize.reset')}</button><span /><DialogClose asChild><button type="button">{t('core.common.cancel')}</button></DialogClose><button className="button--primary" onClick={save} type="button">{t('core.actions.save')}</button></div>
      </div>
    </Dialog>
  </>;
}

function SidebarItemList({ items, label, list, move, onDragStart, onDrop, t }: {
  items: NavigationItem[];
  label: string;
  list: 'main' | 'more';
  move: (source: 'main' | 'more', index: number, target: 'main' | 'more', targetIndex?: number) => void;
  onDragStart: (list: 'main' | 'more', index: number) => void;
  onDrop: (event: DragEvent, list: 'main' | 'more', index?: number) => void;
  t: (key: string) => string;
}) {
  const target = list === 'main' ? 'more' : 'main';
  return <section><h3>{label}</h3><div className="sidebar-customizer__list" onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDrop(event, list)}>
    {items.map((item, index) => <article draggable key={item.title} onDragStart={() => onDragStart(list, index)} onDrop={(event) => { event.stopPropagation(); onDrop(event, list, index); }}>
      <MdiIcon name={item.icon} /><span>{t(item.title)}</span><button aria-label={t(target === 'more' ? 'features.settings.sidebar.customize.moreItems' : 'features.settings.sidebar.customize.mainItems')} onClick={() => move(list, index, target)} type="button"><MdiIcon name={target === 'more' ? 'mdi-arrow-right' : 'mdi-arrow-left'} /></button>
    </article>)}
  </div></section>;
}

type ProxyStatus = { available: boolean; latency: number };

export function ProxySelector() {
  const { t } = useTranslation();
  const prefix = 'features.settings.network.proxySelector';
  const [enabled, setEnabled] = useState(() => localStorage.getItem('githubProxyRadioValue') === '1');
  const [control, setControl] = useState(() => localStorage.getItem('githubProxyRadioControl') || '0');
  const [custom, setCustom] = useState(() => localStorage.getItem('selectedGitHubProxy') || '');
  const [statuses, setStatuses] = useState<Record<number, ProxyStatus>>({});
  const [testing, setTesting] = useState(false);

  const persist = (nextEnabled: boolean, nextControl = control, nextCustom = custom) => {
    const selected = !nextEnabled ? '' : nextControl === '-1' ? nextCustom : GITHUB_PROXIES[Number(nextControl)] || '';
    localStorage.setItem('githubProxyRadioValue', nextEnabled ? '1' : '0');
    localStorage.setItem('githubProxyRadioControl', nextControl);
    localStorage.setItem('selectedGitHubProxy', selected);
  };
  const selectMode = (next: boolean) => { setEnabled(next); persist(next); };
  const selectProxy = (next: string) => { setControl(next); persist(enabled, next); };
  const changeCustom = (value: string) => { setCustom(value); persist(enabled, '-1', value); };
  const test = async () => {
    setTesting(true);
    const results = await Promise.all(GITHUB_PROXIES.map(async (proxy, index) => {
      try {
        const data = responseData<JsonObject>(await statsApi.testGhproxy({ proxy_url: proxy }));
        return [index, { available: true, latency: Math.round(Number(data?.latency || 0)) }] as const;
      } catch {
        return [index, { available: false, latency: 0 }] as const;
      }
    }));
    setStatuses(Object.fromEntries(results));
    setTesting(false);
  };

  return <div className="proxy-selector-react"><h3>{t(`${prefix}.title`)}</h3>
    <label><input checked={!enabled} name="github-proxy-mode" onChange={() => selectMode(false)} type="radio" />{t(`${prefix}.noProxy`)}</label>
    <label><input checked={enabled} name="github-proxy-mode" onChange={() => selectMode(true)} type="radio" />{t(`${prefix}.useProxy`)}{enabled && <button disabled={testing} onClick={() => void test()} type="button">{testing && <MdiIcon className="mdi-spin" name="mdi-loading" />}{t(`${prefix}.testConnection`)}</button>}</label>
    {enabled && <div className="proxy-selector-react__list">
      {GITHUB_PROXIES.map((proxy, index) => <label key={proxy}><input checked={control === String(index)} name="github-proxy" onChange={() => selectProxy(String(index))} type="radio" /><span>{proxy}</span>{statuses[index] && <small className={statuses[index].available ? 'is-success' : 'is-error'}>{t(`${prefix}.${statuses[index].available ? 'available' : 'unavailable'}`)}{statuses[index].available ? ` · ${statuses[index].latency}ms` : ''}</small>}</label>)}
      <label><input checked={control === '-1'} name="github-proxy" onChange={() => selectProxy('-1')} type="radio" />{t(`${prefix}.custom`)}</label>
      {control === '-1' && <input onChange={(event) => changeCustom(event.target.value)} placeholder="https://..." value={custom} />}
    </div>}
  </div>;
}

type StorageStatus = {
  cache?: { file_count?: number; size_bytes?: number };
  logs?: { file_count?: number; size_bytes?: number };
  total_bytes?: number;
};

export function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatBackupDate(value: unknown) {
  if (value == null || value === '') return '—';
  const numeric = typeof value === 'number' ? value : Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

export function StorageCleanupPanel() {
  const { t } = useTranslation();
  const prefix = 'features.settings.system.cleanup';
  const [status, setStatus] = useState<StorageStatus>({});
  const [open, setOpen] = useState(false);
  const [cleaning, setCleaning] = useState('');
  const load = useCallback(async () => {
    try { setStatus(responseData<StorageStatus>(await getStorageStatus()) ?? {}); }
    catch (cause) { toast.error(errorMessage(cause, t(`${prefix}.messages.statusFailed`))); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);
  const clean = async (target: 'cache' | 'logs' | 'all') => {
    if (!await confirmAction(t(`${prefix}.confirm`, { target: t(`${prefix}.targetNames.${target}`) }))) return;
    setCleaning(target);
    setOpen(false);
    try {
      const data = responseData<JsonObject>(await cleanupStorage({ body: { target } }));
      if (isObject(data.status)) setStatus(data.status as StorageStatus);
      else await load();
      toast.success(t(`${prefix}.messages.cleanupSuccess`, { count: Number(data.processed_files || 0), size: formatBytes(Number(data.removed_bytes || 0)) }));
    } catch (cause) { toast.error(errorMessage(cause, t(`${prefix}.messages.cleanupFailed`))); }
    finally { setCleaning(''); }
  };
  return <div className="storage-cleanup-react"><div><strong>{t(`${prefix}.title`)}</strong><p>{t(`${prefix}.panel.subtitle`, { size: formatBytes(Number(status.total_bytes || 0)) })}</p></div><div><span>{formatBytes(Number(status.total_bytes || 0))}</span><div className="storage-cleanup-react__menu"><button disabled={Boolean(cleaning)} onClick={() => setOpen((value) => !value)} type="button"><MdiIcon name={cleaning ? 'mdi-loading' : 'mdi-broom'} className={cleaning ? 'mdi-spin' : ''} />{t(`${prefix}.clean`)}</button>{open && <div>{(['cache', 'logs'] as const).map((target) => <button key={target} onClick={() => void clean(target)} type="button"><MdiIcon name={target === 'cache' ? 'mdi-database-refresh-outline' : 'mdi-file-document-outline'} /><span>{t(`${prefix}.targets.${target}.button`)}<small>{formatBytes(Number(status[target]?.size_bytes || 0))}</small></span></button>)}<button onClick={() => void clean('all')} type="button"><MdiIcon name="mdi-delete-sweep-outline" /><span>{t(`${prefix}.cleanAll`)}<small>{formatBytes(Number(status.total_bytes || 0))}</small></span></button></div>}</div></div></div>;
}

type BackupTab = 'export' | 'import' | 'list';
type TaskState = 'idle' | 'processing' | 'completed' | 'failed';
type ImportState = 'idle' | 'uploading' | 'confirm' | 'processing' | 'completed' | 'failed';

export function BackupDialog({ onRestart, open, restarting = false, setOpen }: { onRestart: () => Promise<void>; open: boolean; restarting?: boolean; setOpen: (open: boolean) => void }) {
  const { t } = useTranslation();
  const prefix = 'features.settings.backup';
  const [tab, setTab] = useState<BackupTab>('export');
  const [backups, setBackups] = useState<JsonObject[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [exportState, setExportState] = useState<TaskState>('idle');
  const [exportMessage, setExportMessage] = useState('');
  const [exportResult, setExportResult] = useState<JsonObject | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [importState, setImportState] = useState<ImportState>('idle');
  const [importMessage, setImportMessage] = useState('');
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadedFilename, setUploadedFilename] = useState('');
  const [check, setCheck] = useState<JsonObject | null>(null);
  const [renameState, setRenameState] = useState<{ error: string; filename: string; name: string; saving: boolean } | null>(null);
  const pollTimer = useRef<number | null>(null);
  const pollGeneration = useRef(0);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const loadList = useCallback(async () => {
    setListLoading(true);
    try { setBackups(objectList(responseData(await listBackups()), ['items', 'backups'])); }
    catch (cause) { toast.error(errorMessage(cause, t(`${prefix}.list.empty`))); }
    finally { setListLoading(false); }
  }, [t]);
  const stopPolling = useCallback(() => {
    pollGeneration.current += 1;
    if (pollTimer.current != null) window.clearTimeout(pollTimer.current);
    pollTimer.current = null;
  }, []);
  const resetAll = useCallback(() => {
    stopPolling();
    setTab('export');
    setExportState('idle');
    setExportMessage('');
    setExportResult(null);
    setFile(null);
    setImportState('idle');
    setImportMessage('');
    setUploadPercent(0);
    setUploadedFilename('');
    setCheck(null);
    setRenameState(null);
    if (fileInput.current) fileInput.current.value = '';
  }, [stopPolling]);
  useEffect(() => {
    if (open) void loadList();
    else resetAll();
    return stopPolling;
  }, [loadList, open, resetAll, stopPolling]);

  const pollTask = async (taskId: string, kind: 'export' | 'import', generation: number) => {
    try {
      const data = responseData<JsonObject>(await getBackupProgress({ path: { task_id: taskId } }));
      if (generation !== pollGeneration.current) return;
      const progress = isObject(data.progress) ? data.progress : {};
      const message = String(progress.message || '');
      if (kind === 'export') setExportMessage(message); else setImportMessage(message);
      if (data.status === 'completed') {
        if (kind === 'export') { setExportState('completed'); setExportResult(isObject(data.result) ? data.result : {}); void loadList(); }
        else setImportState('completed');
      } else if (data.status === 'failed') {
        if (kind === 'export') setExportState('failed'); else setImportState('failed');
        if (kind === 'export') setExportMessage(String(data.error || '')); else setImportMessage(String(data.error || ''));
      } else pollTimer.current = window.setTimeout(() => void pollTask(taskId, kind, generation), 1000);
    } catch (cause) {
      if (generation !== pollGeneration.current) return;
      if (kind === 'export') { setExportState('failed'); setExportMessage(errorMessage(cause, t(`${prefix}.export.failed`))); }
      else { setImportState('failed'); setImportMessage(errorMessage(cause, t(`${prefix}.import.failed`))); }
    }
  };
  const startExport = async () => {
    stopPolling();
    const generation = pollGeneration.current;
    setExportState('processing');
    setExportMessage('');
    try {
      const data = responseData<JsonObject>(await createBackup());
      if (generation === pollGeneration.current) await pollTask(String(data.task_id), 'export', generation);
    } catch (cause) { setExportState('failed'); setExportMessage(errorMessage(cause, t(`${prefix}.export.failed`))); }
  };
  const upload = async () => {
    if (!file) return;
    setImportState('uploading');
    setImportMessage(t(`${prefix}.import.uploadInit`));
    let uploadId = '';
    try {
      const init = responseData<JsonObject>(await initBackupUpload({ body: { filename: file.name, total_size: file.size } }));
      uploadId = String(init.upload_id);
      const chunkSize = Number(init.chunk_size);
      const totalChunks = Number(init.total_chunks);
      let nextIndex = 0;
      let uploaded = 0;
      setImportMessage(t(`${prefix}.import.uploadingChunks`));
      const worker = async () => {
        while (nextIndex < totalChunks) {
          const index = nextIndex++;
          const start = index * chunkSize;
          const chunk = file.slice(start, Math.min(start + chunkSize, file.size));
          await uploadBackupChunk({ body: { upload_id: uploadId, chunk_index: index, chunk } });
          uploaded += chunk.size;
          setUploadPercent(Math.round(uploaded / file.size * 100));
        }
      };
      await Promise.all(Array.from({ length: Math.min(5, totalChunks) }, worker));
      setImportMessage(t(`${prefix}.import.uploadComplete`));
      const completed = responseData<JsonObject>(await completeBackupUpload({ body: { upload_id: uploadId } }));
      const filename = String(completed.filename);
      setUploadedFilename(filename);
      setImportMessage(t(`${prefix}.import.checking`));
      const result = responseData<JsonObject>(await checkBackup({ path: { filename } }));
      if (!result.valid) throw new Error(String(result.error || t(`${prefix}.import.invalidBackup`)));
      setCheck(result);
      setImportState('confirm');
    } catch (cause) {
      if (uploadId) void abortBackupUpload({ body: { upload_id: uploadId } }).catch(() => undefined);
      setImportState('failed');
      setImportMessage(errorMessage(cause, t(`${prefix}.import.failed`)));
    }
  };
  const beginImport = async () => {
    stopPolling();
    const generation = pollGeneration.current;
    setImportState('processing');
    try {
      const data = responseData<JsonObject>(await importBackup({ body: { confirmed: true }, path: { filename: uploadedFilename } }));
      if (generation === pollGeneration.current) await pollTask(String(data.task_id), 'import', generation);
    } catch (cause) { setImportState('failed'); setImportMessage(errorMessage(cause, t(`${prefix}.import.failed`))); }
  };
  const restore = async (filename: string) => {
    try {
      const result = responseData<JsonObject>(await checkBackup({ path: { filename } }));
      if (!result.valid) throw new Error(String(result.error || t(`${prefix}.import.invalidBackup`)));
      setUploadedFilename(filename); setCheck(result); setImportState('confirm'); setTab('import');
    } catch (cause) { toast.error(errorMessage(cause, t(`${prefix}.import.invalidBackup`))); }
  };
  const remove = async (filename: string) => {
    if (!await confirmAction({ danger: true, message: t(`${prefix}.list.confirmDelete`) })) return;
    try { await deleteBackup({ path: { filename } }); await loadList(); } catch (cause) { toast.error(errorMessage(cause, t(`${prefix}.list.empty`))); }
  };
  const rename = async () => {
    if (!renameState || renameState.saving) return;
    const next = renameState.name.trim().replace(/\.zip$/i, '');
    if (!next) { setRenameState({ ...renameState, error: t(`${prefix}.list.renameRequired`) }); return; }
    if (/[\\/:*?"<>|]/.test(next) || next.includes('..')) { setRenameState({ ...renameState, error: t(`${prefix}.list.renameInvalidChars`) }); return; }
    setRenameState({ ...renameState, error: '', saving: true });
    try { await renameBackup({ body: { new_name: next }, path: { filename: renameState.filename } }); setRenameState(null); await loadList(); }
    catch (cause) { setRenameState({ ...renameState, error: errorMessage(cause, t(`${prefix}.list.renameFailed`)), saving: false }); }
  };
  const download = async (filename: string) => {
    try {
      const blob = await backupFilesApi.download(filename);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
      URL.revokeObjectURL(url);
    } catch (cause) { toast.error(errorMessage(cause, filename)); }
  };
  const resetImport = () => { setFile(null); if (fileInput.current) fileInput.current.value = ''; setImportState('idle'); setImportMessage(''); setUploadPercent(0); setUploadedFilename(''); setCheck(null); };
  const versionStatus = String(check?.version_status || 'match');
  const canImport = Boolean(check?.can_import);
  const backupSummaryCandidate = check?.backup_summary;
  const backupSummary = isObject(backupSummaryCandidate) ? backupSummaryCandidate : {};
  const summaryTables = Array.isArray(backupSummary.tables) ? backupSummary.tables : [];
  const summaryDirectories = Array.isArray(backupSummary.directories) ? backupSummary.directories : [];
  const checkWarningsCandidate = check?.warnings;
  const checkWarnings = Array.isArray(checkWarningsCandidate) ? checkWarningsCandidate : [];

  return <><Dialog onOpenChange={(next) => { if (exportState !== 'processing' && importState !== 'uploading' && importState !== 'processing') setOpen(next); }} open={open} title={<span className="backup-dialog-title"><MdiIcon name="mdi-backup-restore" />{t(`${prefix}.dialog.title`)}</span>}>
    <div className="backup-dialog-react">
      <nav>{(['export', 'import', 'list'] as BackupTab[]).map((item) => <button aria-pressed={tab === item} key={item} onClick={() => { setTab(item); if (item === 'list') void loadList(); }} type="button"><MdiIcon name={item === 'export' ? 'mdi-export' : item === 'import' ? 'mdi-import' : 'mdi-format-list-bulleted'} />{t(`${prefix}.tabs.${item}`)}</button>)}</nav>
      <div className="backup-dialog-react__body">
        {tab === 'export' && <BackupState state={exportState} icon={exportState === 'completed' ? 'mdi-check-circle' : exportState === 'failed' ? 'mdi-alert-circle' : 'mdi-cloud-upload'} message={exportMessage || t(`${prefix}.export.${exportState === 'processing' ? 'wait' : 'description'}`)} title={t(`${prefix}.export.${exportState === 'idle' ? 'title' : exportState}`)}>
          {exportState === 'idle' && <><div className="backup-alert backup-alert--info"><MdiIcon name="mdi-information" /><span>{t(`${prefix}.export.includes`)}</span></div><button className="backup-button backup-button--primary" onClick={() => void startExport()} type="button"><MdiIcon name="mdi-export" />{t(`${prefix}.export.button`)}</button></>}
          {exportState === 'completed' && <><strong className="backup-result-name">{String(exportResult?.filename || '')}</strong><div className="backup-state__actions"><button className="backup-button backup-button--primary" onClick={() => void download(String(exportResult?.filename || ''))} type="button"><MdiIcon name="mdi-download" />{t(`${prefix}.export.download`)}</button><button className="backup-button backup-button--secondary" onClick={() => setExportState('idle')} type="button"><MdiIcon name="mdi-backup-restore" />{t(`${prefix}.export.another`)}</button></div></>}
          {exportState === 'failed' && <button className="backup-button backup-button--secondary" onClick={() => setExportState('idle')} type="button"><MdiIcon name="mdi-refresh" />{t(`${prefix}.export.retry`)}</button>}
        </BackupState>}
        {tab === 'import' && <BackupState state={importState === 'uploading' || importState === 'processing' ? 'processing' : importState === 'completed' || importState === 'failed' ? importState : 'idle'} icon={importState === 'completed' ? 'mdi-check-circle' : importState === 'failed' ? 'mdi-alert-circle' : 'mdi-cloud-upload'} message={importMessage} title={t(`${prefix}.import.${importState === 'idle' ? 'title' : importState === 'confirm' ? 'confirmImport' : importState}`)}>
          {importState === 'idle' && <><div className="backup-alert backup-alert--warning"><MdiIcon name="mdi-alert" /><span>{String(t(`${prefix}.import.warning`)).replace(/^⚠️\s*/, '')}</span></div><input accept=".zip" hidden onChange={(event) => setFile(event.target.files?.[0] ?? null)} ref={fileInput} type="file" /><button className="backup-file-picker" onClick={() => fileInput.current?.click()} type="button"><MdiIcon name="mdi-file-upload" /><span><strong>{file?.name || t(`${prefix}.import.selectFile`)}</strong>{file && <small>{formatBytes(file.size)}</small>}</span></button><button className="backup-button backup-button--primary" disabled={!file} onClick={() => void upload()} type="button"><MdiIcon name="mdi-upload" />{t(`${prefix}.import.uploadAndCheck`)}</button></>}
          {importState === 'uploading' && <progress max={100} value={uploadPercent} />}
          {importState === 'confirm' && <><div className={`backup-alert backup-alert--${versionStatus === 'major_diff' ? 'error' : versionStatus === 'minor_diff' ? 'warning' : 'info'}`}><MdiIcon name={versionStatus === 'major_diff' ? 'mdi-alert-octagon' : versionStatus === 'minor_diff' ? 'mdi-alert' : 'mdi-information'} /><span><strong>{t(`${prefix}.import.version.${versionStatus === 'major_diff' ? 'majorDiffTitle' : versionStatus === 'minor_diff' ? 'minorDiffTitle' : 'matchTitle'}`)}</strong><p>{t(`${prefix}.import.version.backupVersion`)}: {String(check?.backup_version || '—')}<br />{t(`${prefix}.import.version.currentVersion`)}: {String(check?.current_version || '—')}<br />{t(`${prefix}.import.version.backupTime`)}: {formatBackupDate(check?.backup_time)}</p><p>{t(`${prefix}.import.version.${versionStatus === 'major_diff' ? 'majorDiffMessage' : versionStatus === 'minor_diff' ? 'minorDiffMessage' : 'matchMessage'}`)}</p></span></div>{check?.error && <div className="backup-alert backup-alert--error"><MdiIcon name="mdi-alert-circle" /><span>{String(check.error)}</span></div>}{checkWarnings.length > 0 && <div className="backup-alert backup-alert--warning"><MdiIcon name="mdi-alert" /><span>{checkWarnings.map(String).join('\n')}</span></div>}<section className="backup-summary"><strong>{t(`${prefix}.import.backupContents`)}</strong><div>{summaryTables.length > 0 && <span>{summaryTables.length} {t(`${prefix}.import.tables`)}</span>}{Boolean(backupSummary.has_knowledge_bases) && <span>{t(`${prefix}.import.knowledgeBases`)}</span>}{Boolean(backupSummary.has_config) && <span>{t(`${prefix}.import.configFiles`)}</span>}{summaryDirectories.map((directory) => <span key={String(directory)}>{String(directory)}</span>)}</div></section><div className="backup-state__actions"><button className="backup-button backup-button--secondary" onClick={resetImport} type="button">{t('core.common.cancel')}</button>{canImport && <button className="backup-button backup-button--danger" onClick={() => void beginImport()} type="button"><MdiIcon name="mdi-database-import" />{t(`${prefix}.import.confirmImport`)}</button>}</div></>}
          {importState === 'completed' && <><div className="backup-alert backup-alert--info"><MdiIcon name="mdi-information" /><span>{t(`${prefix}.import.restartRequired`)}</span></div><button className="backup-button backup-button--primary" disabled={restarting} onClick={() => void onRestart()} type="button"><MdiIcon className={restarting ? 'mdi-spin' : ''} name={restarting ? 'mdi-loading' : 'mdi-restart'} />{restarting ? t('core.common.restart.waiting') : t(`${prefix}.import.restartNow`)}</button></>}
          {importState === 'failed' && <button className="backup-button backup-button--secondary" onClick={resetImport} type="button"><MdiIcon name="mdi-refresh" />{t(`${prefix}.import.retry`)}</button>}
        </BackupState>}
        {tab === 'list' && <div className="backup-list-react">{listLoading ? <div className="backup-list-empty"><MdiIcon className="mdi-spin" name="mdi-loading" /></div> : !backups.length ? <div className="backup-list-empty"><MdiIcon name="mdi-folder-open-outline" /><p>{t(`${prefix}.list.empty`)}</p></div> : backups.map((backup) => { const filename = String(backup.filename || ''); return <article key={filename}><MdiIcon name={backup.type === 'uploaded' ? 'mdi-upload' : 'mdi-zip-box'} /><span><strong>{filename}</strong><small>{formatBytes(Number(backup.size || 0))} · {formatBackupDate(backup.created_at)}{backup.astrbot_version ? ` · v${String(backup.astrbot_version)}` : ''}{backup.type === 'uploaded' ? ` · ${t(`${prefix}.list.uploaded`)}` : ''}</small></span><div><button aria-label={t(`${prefix}.list.restore`)} title={t(`${prefix}.list.restore`)} onClick={() => void restore(filename)} type="button"><MdiIcon name="mdi-restore" /></button><button aria-label={t(`${prefix}.list.rename`)} title={t(`${prefix}.list.rename`)} onClick={() => setRenameState({ error: '', filename, name: filename.replace(/\.zip$/i, ''), saving: false })} type="button"><MdiIcon name="mdi-pencil" /></button><button aria-label={t(`${prefix}.export.download`)} title={t(`${prefix}.export.download`)} onClick={() => void download(filename)} type="button"><MdiIcon name="mdi-download" /></button><button aria-label={t('core.common.delete')} className="backup-list-action--danger" title={t('core.common.delete')} onClick={() => void remove(filename)} type="button"><MdiIcon name="mdi-delete" /></button></div></article>; })}<button className="backup-button backup-button--text" onClick={() => void loadList()} type="button"><MdiIcon name="mdi-refresh" />{t(`${prefix}.list.refresh`)}</button><p className="backup-list-hint"><MdiIcon name="mdi-information-outline" /><span>{t(`${prefix}.list.ftpHint`)}</span></p></div>}
      </div>
      <div className="dialog-actions"><span /><DialogClose asChild><button className="backup-button backup-button--text" disabled={exportState === 'processing' || importState === 'uploading' || importState === 'processing'} type="button">{t('core.common.close')}</button></DialogClose></div>
    </div>
  </Dialog><Dialog onOpenChange={(next) => { if (!next && !renameState?.saving) setRenameState(null); }} open={renameState !== null} title={<span className="backup-dialog-title backup-dialog-title--small"><MdiIcon name="mdi-pencil" />{t(`${prefix}.list.renameTitle`)}</span>}>
    <div className="backup-rename-dialog">
      <label><span>{t(`${prefix}.list.newName`)}</span><div><input autoFocus disabled={renameState?.saving} onChange={(event) => renameState && setRenameState({ ...renameState, error: '', name: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') void rename(); }} value={renameState?.name || ''} /><em>.zip</em></div><small>{t(`${prefix}.list.renameHint`)}</small></label>
      {renameState?.error && <div className="backup-alert backup-alert--error"><MdiIcon name="mdi-alert-circle" /><span>{renameState.error}</span></div>}
      <div className="dialog-actions"><button className="backup-button backup-button--secondary" disabled={renameState?.saving} onClick={() => setRenameState(null)} type="button">{t('core.common.cancel')}</button><button className="backup-button backup-button--primary" disabled={renameState?.saving} onClick={() => void rename()} type="button">{renameState?.saving ? <MdiIcon className="mdi-spin" name="mdi-loading" /> : <MdiIcon name="mdi-check" />}{t('core.common.confirm')}</button></div>
    </div>
  </Dialog></>;
}

function BackupState({ children, icon, message, state, title }: { children: ReactNode; icon: `mdi-${string}`; message: string; state: TaskState; title: string }) {
  return <div className={`backup-state backup-state--${state}`}><MdiIcon className={state === 'processing' ? 'mdi-spin' : ''} name={state === 'processing' ? 'mdi-loading' : icon} /><h3>{title}</h3>{message && <p>{message}</p>}{children}</div>;
}
