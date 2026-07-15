import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';

import {
  createPersona, createPersonaFolder, deletePersona, deletePersonaFolder, getPersonaTree,
  listPersonaFolders, listPersonas, listSkills, listTools, movePersonaItem, updatePersona,
  updatePersonaFolder,
} from '@/api/openapi';
import { Dialog } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { confirmAction, toast } from '@/stores/feedback';
import { errorMessage, type JsonObject, objectList, recordId, responseData } from './model';
import {
  emptyPersonaForm, filterFolderTree, findFolderPath, flattenFolders, formatPersonaDate, importPersonaRecords,
  normalizeFolderTree, personaFormValue, stringList, type PersonaFolderNode, type PersonaFormValue,
} from './personaModel';

type FolderDialog = { mode: 'create' | 'rename'; folder?: JsonObject; name: string; description: string } | null;
type MoveDialog = { type: 'persona' | 'folder'; item: JsonObject } | null;
type LocalPersonaKey = 'import' | 'importError' | 'importInvalid' | 'importPartial' | 'importSuccess' | 'selectSpecificTools';
const localPersonaText: Record<string, Record<LocalPersonaKey, string>> = {
  'zh-CN': { import: '导入人格', importError: '导入人格失败', importInvalid: '人格文件格式无效', importPartial: '{count} 个人格导入失败或已存在', importSuccess: '成功导入 {count} 个人格', selectSpecificTools: '选择指定函数工具' },
  'en-US': { import: 'Import Persona', importError: 'Failed to import personas', importInvalid: 'Invalid persona file format', importPartial: '{count} personas failed to import or already exist', importSuccess: 'Imported {count} personas successfully', selectSpecificTools: 'Select specific tools' },
  'ru-RU': { import: 'Импортировать персонажа', importError: 'Ошибка импорта персонажей', importInvalid: 'Неверный формат файла персонажа', importPartial: 'Не удалось импортировать или уже существует: {count}', importSuccess: 'Успешно импортировано персонажей: {count}', selectSpecificTools: 'Выбрать определенные инструменты' },
};

function FolderTree({ currentId, nodes, onDelete, onMove, onNavigate, onRename, onDropPersona }: {
  currentId: string | null;
  nodes: PersonaFolderNode[];
  onDelete: (folder: JsonObject) => void;
  onMove: (folder: JsonObject) => void;
  onNavigate: (folderId: string | null) => void;
  onRename: (folder: JsonObject) => void;
  onDropPersona: (personaId: string, folderId: string | null) => void;
}) {
  const { t } = useTranslation();
  const k = (key: string) => t(`features.persona.${key}`);
  const render = (items: PersonaFolderNode[], depth = 0) => items.map((folder) => <li key={folder.folder_id}>
    <div className={`persona-tree__row${currentId === folder.folder_id ? ' is-active' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData('text/persona-id'); if (id) onDropPersona(id, folder.folder_id); }} style={{ paddingInlineStart: `${10 + depth * 18}px` }}>
      <button onClick={() => onNavigate(folder.folder_id)} type="button"><MdiIcon name="mdi-folder-outline" /><span>{folder.name}</span></button>
      <span className="persona-tree__actions"><button aria-label={k('folder.contextMenu.rename')} onClick={() => onRename(folder)} title={k('folder.contextMenu.rename')} type="button"><MdiIcon name="mdi-pencil-outline" /></button><button aria-label={k('folder.contextMenu.moveTo')} onClick={() => onMove(folder)} title={k('folder.contextMenu.moveTo')} type="button"><MdiIcon name="mdi-folder-move" /></button><button aria-label={k('folder.contextMenu.delete')} onClick={() => onDelete(folder)} title={k('folder.contextMenu.delete')} type="button"><MdiIcon name="mdi-delete-outline" /></button></span>
    </div>
    {folder.children.length > 0 && <ul>{render(folder.children, depth + 1)}</ul>}
  </li>);
  return <ul className="persona-tree">{render(nodes)}</ul>;
}

function ChoicePanel({ allLabel, description, items, label, onChange, specificLabel, value }: {
  allLabel: string; description: string; items: JsonObject[]; label: string; specificLabel: string;
  onChange: (value: string[] | null) => void; value: string[] | null;
}) {
  const names = items.map((item) => recordId(item, 'name', 'tool_name', 'skill_name', 'id')).filter(Boolean);
  return <fieldset className="persona-choice"><legend>{label}</legend><p>{description}</p>
    <label className="persona-choice__mode"><input checked={value === null} onChange={() => onChange(null)} type="radio" />{allLabel}</label>
    <label className="persona-choice__mode"><input checked={value !== null} onChange={() => onChange(value ?? [])} type="radio" />{specificLabel}</label>
    {value !== null && <div className="persona-choice__list">{names.map((name) => <label key={name}><input checked={value.includes(name)} onChange={() => onChange(value.includes(name) ? value.filter((item) => item !== name) : [...value, name])} type="checkbox" /><span>{name}</span></label>)}</div>}
  </fieldset>;
}

export default function PersonaPage() {
  const { i18n, t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) => t(`features.persona.${key}`, options);
  const l = (key: LocalPersonaKey, count?: number) => (localPersonaText[i18n.resolvedLanguage || i18n.language] || localPersonaText['zh-CN'])[key].replace('{count}', String(count ?? ''));
  const [tree, setTree] = useState<PersonaFolderNode[]>([]);
  const [folders, setFolders] = useState<JsonObject[]>([]);
  const [personas, setPersonas] = useState<JsonObject[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [folderSearch, setFolderSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<JsonObject | null>(null);
  const [form, setForm] = useState<PersonaFormValue>(emptyPersonaForm(null));
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState<JsonObject | null>(null);
  const [folderDialog, setFolderDialog] = useState<FolderDialog>(null);
  const [moveDialog, setMoveDialog] = useState<MoveDialog>(null);
  const [tools, setTools] = useState<JsonObject[]>([]);
  const [skills, setSkills] = useState<JsonObject[]>([]);
  const [importing, setImporting] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const query = currentFolderId ? { query: { folder_id: currentFolderId } } : undefined;
      const folderQuery = currentFolderId ? { query: { parent_id: currentFolderId } } : undefined;
      const [treeResponse, folderResponse, personaResponse] = await Promise.all([getPersonaTree(), listPersonaFolders(folderQuery), listPersonas(query)]);
      const treeData = responseData<unknown>(treeResponse);
      setTree(normalizeFolderTree(Array.isArray(treeData) ? treeData : objectList(treeData, ['tree', 'folders', 'items'])));
      setFolders(objectList(responseData(folderResponse), ['folders', 'items']));
      setPersonas(objectList(responseData(personaResponse), ['personas', 'items']));
    } catch (cause) { setError(errorMessage(cause, k('messages.loadError'))); }
    finally { setLoading(false); }
  }, [currentFolderId, t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void Promise.all([listTools(), listSkills()]).then(([toolResponse, skillResponse]) => {
      setTools(objectList(responseData(toolResponse), ['tools', 'items']));
      setSkills(objectList(responseData(skillResponse), ['skills', 'items']).filter((item) => item.active !== false));
    }).catch(() => { setTools([]); setSkills([]); });
  }, []);

  const breadcrumbs = useMemo(() => findFolderPath(tree, currentFolderId), [tree, currentFolderId]);
  const currentFolderName = breadcrumbs.at(-1)?.name || k('form.rootFolder');
  const moveTargets = useMemo(() => flattenFolders(tree, moveDialog?.type === 'folder' ? recordId(moveDialog.item, 'folder_id', 'id') : ''), [tree, moveDialog]);

  const openPersona = (item?: JsonObject) => {
    setEditing(item ?? {});
    setForm(item ? personaFormValue(item, currentFolderId) : emptyPersonaForm(currentFolderId));
  };
  const closePersona = () => { setEditing(null); setForm(emptyPersonaForm(currentFolderId)); };
  const savePersona = async () => {
    const originalId = recordId(editing ?? {}, 'persona_id', 'id');
    if (!form.persona_id.trim()) { toast.warning(k('validation.required')); return; }
    if (form.system_prompt.trim().length < 10) { toast.warning(k('validation.minLength', { min: 10 })); return; }
    const emptyDialogIndex = form.begin_dialogs.findIndex((item) => !item.trim());
    if (emptyDialogIndex >= 0) { toast.warning(k('validation.dialogRequired', { type: k(emptyDialogIndex % 2 ? 'form.assistantMessage' : 'form.userMessage') })); return; }
    if (!originalId && personas.some((item) => recordId(item, 'persona_id', 'id') === form.persona_id.trim())) { toast.warning(k('validation.personaIdExists')); return; }
    setSaving(true);
    try {
      const payload: JsonObject = { ...form, persona_id: form.persona_id.trim(), system_prompt: form.system_prompt.trim(), ...(form.folder_id ? {} : { folder_id: undefined }) };
      if (originalId) await updatePersona({ path: { persona_id: originalId }, body: { ...payload, persona_id: originalId, system_prompt: form.system_prompt.trim() } });
      else await createPersona({ body: { ...payload, persona_id: form.persona_id.trim(), system_prompt: form.system_prompt.trim() } });
      toast.success(k('messages.saveSuccess')); closePersona(); await load(); window.dispatchEvent(new Event('astrbot:persona-saved'));
    } catch (cause) { toast.error(errorMessage(cause, k('messages.saveError'))); }
    finally { setSaving(false); }
  };
  const removePersona = async (item: JsonObject) => {
    const id = recordId(item, 'persona_id', 'id');
    if (!id || !await confirmAction({ danger: true, title: k('buttons.delete'), message: k('messages.deleteConfirm', { id }) })) return;
    try { await deletePersona({ path: { persona_id: id } }); toast.success(k('messages.deleteSuccess')); setViewing(null); closePersona(); await load(); }
    catch (cause) { toast.error(errorMessage(cause, k('messages.deleteError'))); }
  };
  const saveFolder = async () => {
    if (!folderDialog?.name.trim()) { toast.warning(k('folder.validation.nameRequired')); return; }
    setSaving(true);
    try {
      if (folderDialog.mode === 'rename') {
        const id = recordId(folderDialog.folder ?? {}, 'folder_id', 'id');
        await updatePersonaFolder({ path: { folder_id: id }, body: { name: folderDialog.name.trim(), description: folderDialog.description } });
        toast.success(k('folder.messages.renameSuccess'));
      } else {
        await createPersonaFolder({ body: { name: folderDialog.name.trim(), description: folderDialog.description, ...(currentFolderId ? { parent_id: currentFolderId } : {}) } });
        toast.success(k('folder.messages.createSuccess'));
      }
      setFolderDialog(null); await load();
    } catch (cause) { toast.error(errorMessage(cause, k(folderDialog.mode === 'rename' ? 'folder.messages.renameError' : 'folder.messages.createError'))); }
    finally { setSaving(false); }
  };
  const removeFolder = async (folder: JsonObject) => {
    const id = recordId(folder, 'folder_id', 'id'); const name = String(folder.name || id);
    if (!id || !await confirmAction({ danger: true, title: k('folder.deleteDialog.title'), message: `${k('folder.deleteDialog.message', { name })}\n${k('folder.deleteDialog.warning')}` })) return;
    try { await deletePersonaFolder({ path: { folder_id: id } }); toast.success(k('folder.messages.deleteSuccess')); if (currentFolderId === id) setCurrentFolderId(null); else await load(); }
    catch (cause) { toast.error(errorMessage(cause, k('folder.messages.deleteError'))); }
  };
  const moveItem = async (targetId: string | null, dialog = moveDialog) => {
    if (!dialog) return;
    setSaving(true);
    try {
      if (dialog.type === 'persona') await movePersonaItem({ body: { persona_id: recordId(dialog.item, 'persona_id', 'id'), ...(targetId ? { folder_id: targetId } : {}) } });
      else {
        const parent: JsonObject = { parent_id: targetId };
        await updatePersonaFolder({ path: { folder_id: recordId(dialog.item, 'folder_id', 'id') }, body: { ...parent } });
      }
      toast.success(k('moveDialog.success')); setMoveDialog(null); await load();
    } catch (cause) { toast.error(errorMessage(cause, k('moveDialog.error'))); }
    finally { setSaving(false); }
  };
  const dropPersona = (personaId: string, folderId: string | null) => {
    const item = personas.find((persona) => recordId(persona, 'persona_id', 'id') === personaId) ?? { persona_id: personaId };
    void moveItem(folderId, { type: 'persona', item });
  };
  const dragPersona = (event: DragEvent, id: string) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/persona-id', id); };
  const importPersonas = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    setImporting(true);
    let imported = 0; let failed = 0;
    try {
      for (const file of files) {
        try {
          const records = importPersonaRecords(JSON.parse(await file.text()));
          if (!records.length) throw new Error(l('importInvalid'));
          for (const record of records) {
            const importedForm = personaFormValue(record, currentFolderId);
            if (!importedForm.persona_id.trim() || !importedForm.system_prompt.trim()) { failed += 1; continue; }
            const payload: JsonObject = { ...importedForm, folder_id: currentFolderId ?? undefined };
            try {
              await createPersona({ body: { ...payload, persona_id: importedForm.persona_id.trim(), system_prompt: importedForm.system_prompt } });
              imported += 1;
            } catch { failed += 1; }
          }
        } catch { failed += 1; }
      }
      if (imported) { toast.success(l('importSuccess', imported)); await load(); }
      if (failed) toast.warning(l('importPartial', failed));
    } catch (cause) { toast.error(errorMessage(cause, l('importError'))); }
    finally { setImporting(false); }
  };

  return <div className="persona-page">
    <header className="persona-page__header"><div><h1>{t('core.navigation.persona')}</h1><p>{k('page.description')}</p></div></header>
    <div className="persona-manager">
      <aside className="persona-sidebar"><header><h2>{k('folder.sidebarTitle')}</h2><button aria-label={k('folder.createButton')} onClick={() => setFolderDialog({ mode: 'create', name: '', description: '' })} title={k('folder.createButton')} type="button"><MdiIcon name="mdi-folder-plus" /></button></header><input aria-label={k('folder.searchPlaceholder')} onChange={(event) => setFolderSearch(event.target.value)} placeholder={k('folder.searchPlaceholder')} value={folderSearch} /><div className={`persona-tree__row${currentFolderId === null ? ' is-active' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData('text/persona-id'); if (id) dropPersona(id, null); }}><button onClick={() => setCurrentFolderId(null)} type="button"><MdiIcon name="mdi-home" /><span>{k('folder.rootFolder')}</span></button></div><FolderTree currentId={currentFolderId} nodes={filterFolderTree(tree, folderSearch)} onDelete={(folder) => void removeFolder(folder)} onDropPersona={dropPersona} onMove={(folder) => setMoveDialog({ type: 'folder', item: folder })} onNavigate={setCurrentFolderId} onRename={(folder) => setFolderDialog({ mode: 'rename', folder, name: String(folder.name || ''), description: String(folder.description || '') })} /></aside>
      <main className="persona-content">
        <div className="persona-toolbar"><nav><button onClick={() => setCurrentFolderId(null)} type="button">{k('form.rootFolder')}</button>{breadcrumbs.map((folder) => <span key={folder.folder_id}><MdiIcon name="mdi-chevron-right" /><button onClick={() => setCurrentFolderId(folder.folder_id)} type="button">{folder.name}</button></span>)}</nav><div><input accept="application/json,.json" hidden multiple onChange={(event) => void importPersonas(event)} ref={importInput} type="file" /><button disabled={importing} onClick={() => importInput.current?.click()} type="button"><MdiIcon name="mdi-file-upload" />{importing ? '…' : l('import')}</button><button className="button--primary" onClick={() => openPersona()} type="button"><MdiIcon name="mdi-plus" />{k('buttons.create')}</button><button onClick={() => setFolderDialog({ mode: 'create', name: '', description: '' })} type="button"><MdiIcon name="mdi-folder-plus" />{k('folder.createButton')}</button></div></div>
        {error && <div className="monitor-error" role="alert">{error}</div>}
        {loading && <div className="persona-loading" role="status"><MdiIcon className="mdi-spin" name="mdi-loading" /></div>}
        {!loading && folders.length > 0 && <section className="persona-section"><h2><MdiIcon name="mdi-folder" />{k('folder.foldersTitle')} ({folders.length})</h2><div className="persona-grid">{folders.map((folder) => { const id = recordId(folder, 'folder_id', 'id'); return <article className="persona-folder-card" key={id}><button className="persona-folder-card__main" onClick={() => setCurrentFolderId(id)} type="button"><MdiIcon name="mdi-folder-outline" /><span><strong>{String(folder.name || id)}</strong><small>{String(folder.description || '')}</small></span></button><div><button aria-label={k('folder.contextMenu.rename')} onClick={() => setFolderDialog({ mode: 'rename', folder, name: String(folder.name || ''), description: String(folder.description || '') })} type="button"><MdiIcon name="mdi-pencil-outline" /></button><button aria-label={k('folder.contextMenu.moveTo')} onClick={() => setMoveDialog({ type: 'folder', item: folder })} type="button"><MdiIcon name="mdi-folder-move" /></button><button aria-label={k('folder.contextMenu.delete')} onClick={() => void removeFolder(folder)} type="button"><MdiIcon name="mdi-delete-outline" /></button></div></article>; })}</div></section>}
        {!loading && personas.length > 0 && <section className="persona-section"><h2><MdiIcon name="mdi-account-heart" />{k('persona.personasTitle')} ({personas.length})</h2><div className="persona-grid">{personas.map((persona) => { const id = recordId(persona, 'persona_id', 'id'); const dialogs = stringList(persona.begin_dialogs); const selectedTools = persona.tools === null ? null : stringList(persona.tools); const selectedSkills = persona.skills === null ? null : stringList(persona.skills); return <article className="persona-card" draggable key={id} onDragStart={(event) => dragPersona(event, id)}><button className="persona-card__main" onClick={() => setViewing(persona)} type="button"><header><MdiIcon name="mdi-account-heart" /><strong>{id}</strong></header><p>{String(persona.system_prompt || '').slice(0, 140)}</p><div className="persona-card__chips">{dialogs.length > 0 && <span><MdiIcon name="mdi-chat" />{k('labels.presetDialogs', { count: dialogs.length / 2 })}</span>}<span><MdiIcon name="mdi-tools" />{selectedTools === null ? k('form.allToolsAvailable') : `${selectedTools.length} ${k('persona.toolsCount')}`}</span><span><MdiIcon name="mdi-lightning-bolt" />{selectedSkills === null ? k('form.allSkillsAvailable') : `${selectedSkills.length} ${k('persona.skillsCount')}`}</span></div><small>{k('labels.createdAt')}: {formatPersonaDate(persona.created_at)}</small></button><div className="persona-card__actions"><button onClick={() => openPersona(persona)} type="button">{k('buttons.edit')}</button><button onClick={() => setMoveDialog({ type: 'persona', item: persona })} type="button">{k('buttons.move')}</button><button className="button--danger" onClick={() => void removePersona(persona)} type="button">{k('buttons.delete')}</button></div></article>; })}</div></section>}
        {!loading && folders.length === 0 && personas.length === 0 && <div className="persona-empty"><MdiIcon name="mdi-folder-open-outline" /><h2>{k('empty.folderEmpty')}</h2><p>{k('empty.folderEmptyDescription')}</p><div><button onClick={() => importInput.current?.click()} type="button"><MdiIcon name="mdi-file-upload" />{l('import')}</button><button className="button--primary" onClick={() => openPersona()} type="button"><MdiIcon name="mdi-plus" />{k('buttons.create')}</button><button onClick={() => setFolderDialog({ mode: 'create', name: '', description: '' })} type="button"><MdiIcon name="mdi-folder-plus" />{k('folder.createButton')}</button></div></div>}
      </main>
    </div>

    <Dialog onOpenChange={(open) => !open && closePersona()} open={editing !== null} title={recordId(editing ?? {}, 'persona_id', 'id') ? k('dialog.edit.title') : k('dialog.create.title')}>
      <div className="persona-form">
        <p className="persona-form__folder"><MdiIcon name="mdi-folder-outline" />{k('form.createInFolder', { folder: currentFolderName })}</p>
        <div className="persona-form__columns">
          <div className="persona-form__basic">
            <label>{k('form.personaId')}<input autoFocus disabled={Boolean(recordId(editing ?? {}, 'persona_id', 'id'))} onChange={(event) => setForm({ ...form, persona_id: event.target.value })} value={form.persona_id} /></label>
            <label>{k('form.systemPrompt')}<textarea className="persona-form__prompt" onChange={(event) => setForm({ ...form, system_prompt: event.target.value })} value={form.system_prompt} /></label>
            <label>{k('form.customErrorMessage')}<textarea onChange={(event) => setForm({ ...form, custom_error_message: event.target.value })} rows={4} value={form.custom_error_message} /><small>{k('form.customErrorMessageHelp')}</small></label>
          </div>
          <div className="persona-form__options">
            <ChoicePanel allLabel={k('form.allToolsAvailable')} description={k('form.toolsHelp')} items={tools} label={k('form.tools')} onChange={(value) => setForm({ ...form, tools: value })} specificLabel={l('selectSpecificTools')} value={form.tools} />
            <ChoicePanel allLabel={k('form.allSkillsAvailable')} description={k('form.skillsHelp')} items={skills} label={k('form.skills')} onChange={(value) => setForm({ ...form, skills: value })} specificLabel={k('form.skillsSelectSpecific')} value={form.skills} />
            <section className="persona-dialog-pairs"><header><div><h3><MdiIcon name="mdi-chat" />{k('form.presetDialogs')}</h3><p>{k('form.presetDialogsHelp')}</p></div><button onClick={() => setForm({ ...form, begin_dialogs: [...form.begin_dialogs, '', ''] })} type="button"><MdiIcon name="mdi-plus" />{k('buttons.addDialogPair')}</button></header>{Array.from({ length: Math.ceil(form.begin_dialogs.length / 2) }, (_, index) => <div className="persona-dialog-pair" key={index}><label>{k('form.userMessage')}<textarea onChange={(event) => { const next = [...form.begin_dialogs]; next[index * 2] = event.target.value; setForm({ ...form, begin_dialogs: next }); }} rows={2} value={form.begin_dialogs[index * 2] || ''} /></label><label>{k('form.assistantMessage')}<textarea onChange={(event) => { const next = [...form.begin_dialogs]; next[index * 2 + 1] = event.target.value; setForm({ ...form, begin_dialogs: next }); }} rows={2} value={form.begin_dialogs[index * 2 + 1] || ''} /></label><button aria-label={k('buttons.delete')} onClick={() => setForm({ ...form, begin_dialogs: form.begin_dialogs.filter((_, itemIndex) => itemIndex !== index * 2 && itemIndex !== index * 2 + 1) })} type="button"><MdiIcon name="mdi-delete-outline" /></button></div>)}</section>
          </div>
        </div>
        <div className="dialog-actions persona-form__actions">{recordId(editing ?? {}, 'persona_id', 'id') && <button className="button--danger persona-form__delete" onClick={() => void removePersona(editing!)} type="button">{k('buttons.delete')}</button>}<button onClick={closePersona} type="button">{k('buttons.cancel')}</button><button className="button--primary" disabled={saving} onClick={() => void savePersona()} type="button">{saving ? '…' : k('buttons.save')}</button></div>
      </div>
    </Dialog>

    <Dialog onOpenChange={(open) => !open && setViewing(null)} open={viewing !== null} title={recordId(viewing ?? {}, 'persona_id', 'id')}><div className="persona-view">{viewing && <><section><h3>{k('form.systemPrompt')}</h3><pre>{String(viewing.system_prompt || '')}</pre></section>{viewing.custom_error_message && <section><h3>{k('form.customErrorMessage')}</h3><pre>{String(viewing.custom_error_message)}</pre></section>}<section><h3>{k('form.presetDialogs')}</h3>{stringList(viewing.begin_dialogs).map((dialog, index) => <div className="persona-view__dialog" key={index}><span>{k(index % 2 ? 'form.assistantMessage' : 'form.userMessage')}</span><p>{dialog}</p></div>)}</section><section><h3>{k('form.tools')}</h3><div className="persona-view__chips">{viewing.tools === null ? <span>{k('form.allToolsAvailable')}</span> : stringList(viewing.tools).map((name) => <span key={name}>{name}</span>)}</div></section><section><h3>{k('form.skills')}</h3><div className="persona-view__chips">{viewing.skills === null ? <span>{k('form.allSkillsAvailable')}</span> : stringList(viewing.skills).map((name) => <span key={name}>{name}</span>)}</div></section><small>{k('labels.createdAt')}: {formatPersonaDate(viewing.created_at)}<br />{k('labels.updatedAt')}: {formatPersonaDate(viewing.updated_at)}</small><div className="dialog-actions"><button onClick={() => setViewing(null)} type="button">{k('buttons.cancel')}</button><button className="button--primary" onClick={() => { const item = viewing; setViewing(null); openPersona(item); }} type="button"><MdiIcon name="mdi-pencil-outline" />{k('buttons.edit')}</button></div></>}</div></Dialog>

    <Dialog onOpenChange={(open) => !open && setFolderDialog(null)} open={folderDialog !== null} title={k(folderDialog?.mode === 'rename' ? 'folder.renameDialog.title' : 'folder.createDialog.title')}><div className="persona-folder-form"><label>{k('folder.form.name')}<input autoFocus onChange={(event) => folderDialog && setFolderDialog({ ...folderDialog, name: event.target.value })} value={folderDialog?.name || ''} /></label><label>{k('folder.form.description')}<textarea onChange={(event) => folderDialog && setFolderDialog({ ...folderDialog, description: event.target.value })} rows={3} value={folderDialog?.description || ''} /></label><div className="dialog-actions"><button onClick={() => setFolderDialog(null)} type="button">{k('buttons.cancel')}</button><button className="button--primary" disabled={saving} onClick={() => void saveFolder()} type="button">{saving ? '…' : k(folderDialog?.mode === 'rename' ? 'buttons.save' : 'folder.createDialog.createButton')}</button></div></div></Dialog>

    <Dialog description={k('moveDialog.description', { name: String(moveDialog?.item.name || moveDialog?.item.persona_id || '') })} onOpenChange={(open) => !open && setMoveDialog(null)} open={moveDialog !== null} title={k('moveDialog.title')}><div className="persona-move-list"><button onClick={() => void moveItem(null)} type="button"><MdiIcon name="mdi-home" />{k('folder.rootFolder')}</button>{moveTargets.map((folder) => <button key={folder.folder_id} onClick={() => void moveItem(folder.folder_id)} type="button"><MdiIcon name="mdi-folder-outline" />{folder.name}</button>)}</div><div className="dialog-actions"><button onClick={() => setMoveDialog(null)} type="button">{k('buttons.cancel')}</button></div></Dialog>
  </div>;
}
