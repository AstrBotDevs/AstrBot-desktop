import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getPersonaTree,
  listKnowledgeBases,
  listPersonas,
  listPlugins,
  listProviders,
  listSkills,
  listTools,
} from '@/api/openapi';
import { Dialog } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { findFolderPath, normalizeFolderTree, type PersonaFolderNode } from '@/routes/configuration/personaModel';

type Item = Record<string, unknown>;
type SpecialControlProps = {
  disabled?: boolean;
  onChange: (value: unknown) => void;
  special: string;
  value: unknown;
};

function responseData(response: unknown): unknown {
  const outer = (response as { data?: unknown } | null)?.data;
  if (outer && typeof outer === 'object' && 'data' in outer) return (outer as { data: unknown }).data;
  return outer;
}

function records(data: unknown, keys: string[]) {
  if (Array.isArray(data)) return data.filter((item): item is Item => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
  if (!data || typeof data !== 'object') return [];
  for (const key of keys) {
    const value = (data as Item)[key];
    if (Array.isArray(value)) return value.filter((item): item is Item => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
  }
  return [];
}

function stringId(item: Item, ...keys: string[]) {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

function specialParts(special: string) {
  const [name, ...subtype] = special.split(':');
  return { name, subtype: subtype.join(':') };
}

function selectorKind(special: string) {
  const { name } = specialParts(special);
  if (['select_provider', 'select_provider_stt', 'select_provider_tts', 'select_providers', 'provider_pool', 'select_agent_runner_provider'].includes(name)) return 'provider';
  if (['select_persona', 'persona_pool'].includes(name)) return 'persona';
  if (name === 'select_knowledgebase') return 'knowledge';
  if (name === 'select_plugin_set') return 'plugin';
  return '';
}

function findFolder(tree: PersonaFolderNode[], folderId: string | null): PersonaFolderNode | null {
  if (!folderId) return null;
  for (const folder of tree) {
    if (folder.folder_id === folderId) return folder;
    const nested = findFolder(folder.children, folderId);
    if (nested) return nested;
  }
  return null;
}

function PersonaFolderTree({ currentFolderId, folders, onNavigate }: {
  currentFolderId: string | null;
  folders: PersonaFolderNode[];
  onNavigate: (folderId: string) => void;
}) {
  const renderFolders = (nodes: PersonaFolderNode[], depth = 0) => nodes.map((folder) => <li key={folder.folder_id}>
    <button
      className={currentFolderId === folder.folder_id ? 'is-active' : ''}
      onClick={() => onNavigate(folder.folder_id)}
      style={{ paddingInlineStart: `${14 + depth * 18}px` }}
      type="button"
    >
      <MdiIcon name="mdi-folder-outline" />
      <span>{folder.name}</span>
    </button>
    {folder.children.length > 0 && <ul>{renderFolders(folder.children, depth + 1)}</ul>}
  </li>);
  return <ul className="config-persona-selector__tree">{renderFolders(folders)}</ul>;
}

function PersonaSelectorDialog({ draft, onCancel, onConfirm, onDraftChange, open, setOpen, text }: {
  draft: string[];
  onCancel: () => void;
  onConfirm: () => void;
  onDraftChange: (value: string[]) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  text: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [tree, setTree] = useState<PersonaFolderNode[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);

  const loadPersonas = async (folderId: string | null) => {
    setItemsLoading(true);
    try {
      const options = folderId ? { query: { folder_id: folderId } } : undefined;
      setItems(records(responseData(await listPersonas(options)), ['personas', 'items', 'data']));
    } catch {
      setItems([]);
    } finally {
      setItemsLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setCurrentFolderId(null);
    setTreeLoading(true);
    void Promise.all([
      getPersonaTree().then((response) => {
        const data = responseData(response);
        setTree(normalizeFolderTree(Array.isArray(data) ? data : records(data, ['tree', 'folders', 'items'])));
      }).catch(() => setTree([])).finally(() => setTreeLoading(false)),
      loadPersonas(null),
    ]);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const reload = () => void loadPersonas(currentFolderId);
    window.addEventListener('astrbot:persona-saved', reload);
    return () => window.removeEventListener('astrbot:persona-saved', reload);
  }, [currentFolderId, open]);

  const navigate = (folderId: string | null) => {
    setCurrentFolderId(folderId);
    void loadPersonas(folderId);
  };
  const breadcrumbs = findFolderPath(tree, currentFolderId);
  const subfolders = currentFolderId ? findFolder(tree, currentFolderId)?.children ?? [] : tree;
  const openPersonaManager = () => {
    setOpen(false);
    window.location.hash = '/persona';
  };
  const selectPersona = (id: string) => onDraftChange([id]);

  return <Dialog onOpenChange={(nextOpen) => {
    if (nextOpen) setOpen(true);
    else onCancel();
  }} open={open} title={text('dialogTitle')}>
    <div className="config-persona-selector">
      <aside className="config-persona-selector__sidebar">
        <header><MdiIcon name="mdi-folder-multiple" />{text('folders')}</header>
        <nav>
          <button className={currentFolderId === null ? 'is-active' : ''} onClick={() => navigate(null)} type="button">
            <MdiIcon name="mdi-home" /><span>{text('rootFolder')}</span>
          </button>
          {treeLoading
            ? <div className="config-persona-selector__state"><MdiIcon className="mdi-spin" name="mdi-loading" /></div>
            : <PersonaFolderTree currentFolderId={currentFolderId} folders={tree} onNavigate={navigate} />}
        </nav>
      </aside>
      <section className="config-persona-selector__content">
        <nav className="config-persona-selector__breadcrumbs">
          <button onClick={() => navigate(null)} type="button"><MdiIcon name="mdi-home" />{text('rootFolder')}</button>
          {breadcrumbs.map((folder) => <span key={folder.folder_id}>
            <MdiIcon name="mdi-chevron-right" />
            <button onClick={() => navigate(folder.folder_id)} type="button">{folder.name}</button>
          </span>)}
        </nav>
        <div className="config-persona-selector__list">
          {itemsLoading && <div className="config-persona-selector__state"><MdiIcon className="mdi-spin" name="mdi-loading" />{text('loading')}</div>}
          {!itemsLoading && subfolders.length > 0 && <section>
            <h3>{text('subfolders')}</h3>
            {subfolders.map((folder) => <button className="config-persona-selector__folder" key={folder.folder_id} onClick={() => navigate(folder.folder_id)} type="button">
              <MdiIcon name="mdi-folder" />
              <span><strong>{folder.name}</strong><small>{String(folder.description || '')}</small></span>
              <MdiIcon name="mdi-chevron-right" />
            </button>)}
          </section>}
          {!itemsLoading && (currentFolderId === null || items.length > 0) && <section>
            <h3>{text('availableItems')}</h3>
            {currentFolderId === null && <button className={`config-persona-selector__persona${draft.includes('default') ? ' is-active' : ''}`} onClick={() => selectPersona('default')} type="button">
              <MdiIcon name="mdi-account" />
              <span><strong>{text('defaultPersona')}</strong><small>You are a helpful and friendly assistant.</small></span>
              {draft.includes('default') && <MdiIcon name="mdi-check-circle" />}
            </button>}
            {items.map((item) => {
              const id = stringId(item, 'persona_id', 'id');
              if (!id) return null;
              return <button className={`config-persona-selector__persona${draft.includes(id) ? ' is-active' : ''}`} key={id} onClick={() => selectPersona(id)} type="button">
                <MdiIcon name="mdi-account" />
                <span><strong>{id}</strong>{String(item.system_prompt || '') && <small>{String(item.system_prompt)}</small>}</span>
                <span className="config-persona-selector__item-actions">
                  <span aria-label={text('editPersona')} onClick={(event) => { event.stopPropagation(); openPersonaManager(); }} role="button" tabIndex={0} title={text('editPersona')}><MdiIcon name="mdi-pencil" /></span>
                  {draft.includes(id) && <MdiIcon name="mdi-check-circle" />}
                </span>
              </button>;
            })}
          </section>}
          {!itemsLoading && subfolders.length === 0 && items.length === 0 && currentFolderId !== null && <div className="dynamic-editor-empty">
            <MdiIcon name="mdi-folder-open-outline" /><p>{text('emptyFolder')}</p>
          </div>}
        </div>
      </section>
      <footer>
        <button className="config-persona-selector__create" onClick={openPersonaManager} type="button"><MdiIcon name="mdi-plus" />{text('createPersona')}</button>
        <span />
        <button onClick={onCancel} type="button">{text('cancelSelection')}</button>
        <button className="button--primary" disabled={!draft[0]} onClick={onConfirm} type="button">{text('confirmSelection')}</button>
      </footer>
    </div>
  </Dialog>;
}

export function isConfigSelectorSpecial(special: unknown) {
  return typeof special === 'string' && Boolean(selectorKind(special));
}

export function ConfigSpecialSelector({ disabled, onChange, special, value }: SpecialControlProps) {
  const { t } = useTranslation();
  const kind = selectorKind(special);
  const { name, subtype } = specialParts(special);
  const multiple = Array.isArray(value) || ['select_providers', 'select_knowledgebase', 'select_plugin_set'].includes(name);
  const selected = useMemo(() => multiple
    ? (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
    : [typeof value === 'string' ? value : ''], [multiple, value]);
  const [draft, setDraft] = useState<string[]>(selected);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const namespace = kind === 'provider' ? 'providerSelector'
    : kind === 'persona' ? 'personaSelector'
      : kind === 'knowledge' ? 'knowledgeBaseSelector'
        : 'pluginSetSelector';
  const text = (key: string, options?: Record<string, unknown>) => t(`core.shared.${namespace}.${key}`, options);

  useEffect(() => setDraft(selected), [selected]);
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const load = async () => {
      if (kind === 'provider') {
        const capability = name === 'select_provider_stt' ? 'stt'
          : name === 'select_provider_tts' ? 'tts'
            : name === 'select_agent_runner_provider' ? 'agent' : 'chat';
        const result = records(responseData(await listProviders({ query: { capability } })), ['providers', 'items', 'data']);
        setItems(subtype ? result.filter((item) => String(item.type || item.provider_type || '').includes(subtype)) : result);
      } else if (kind === 'persona') {
        setItems(records(responseData(await listPersonas()), ['personas', 'items', 'data']));
      } else if (kind === 'knowledge') {
        setItems(records(responseData(await listKnowledgeBases({ query: { page: 1, page_size: 100 } })), ['knowledge_bases', 'items', 'data']));
      } else if (kind === 'plugin') {
        setItems(records(responseData(await listPlugins({ query: { enabled: true } })), ['plugins', 'items', 'data']));
      }
    };
    void load().catch(() => setItems([])).finally(() => setLoading(false));
  }, [kind, name, open, subtype]);

  if (!kind) return null;

  const itemId = (item: Item) => kind === 'provider'
    ? stringId(item, 'id', 'provider_id')
    : kind === 'persona'
      ? stringId(item, 'persona_id', 'id')
      : kind === 'knowledge'
        ? stringId(item, 'kb_id', 'id')
        : stringId(item, 'name', 'plugin_id', 'id', 'module_name');
  const itemDescription = (item: Item) => String(item.description || item.desc || item.system_prompt || item.type || item.provider_type || '');
  const displayValue = !selected.filter(Boolean).length
    ? text('notSelected')
    : kind === 'persona' && selected[0] === 'default'
      ? text('defaultPersona')
      : multiple
        ? text('selectedCount', { count: selected.length })
        : selected[0];
  const buttonText = name === 'provider_pool' ? text('selectProviderPool')
    : name === 'persona_pool' ? text('selectPersonaPool')
      : text('buttonText');

  const toggle = (id: string) => {
    if (!multiple) {
      setDraft([id]);
      return;
    }
    setDraft((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };
  const confirm = () => {
    onChange(multiple ? draft : draft[0] ?? '');
    setOpen(false);
  };

  return <div className="config-special-selector">
    <div className="config-special-selector__summary">
      <span className={!selected.filter(Boolean).length ? 'is-empty' : ''}>{displayValue}</span>
      <button className="button--primary-soft" disabled={disabled} onClick={() => setOpen(true)} type="button">{buttonText}</button>
    </div>
    {multiple && selected.length > 0 && <div className="config-special-selector__chips">{selected.map((id) => <span key={id}>{id}</span>)}</div>}
    {kind === 'persona' ? <PersonaSelectorDialog
      draft={draft}
      onCancel={() => { setDraft(selected); setOpen(false); }}
      onConfirm={confirm}
      onDraftChange={setDraft}
      open={open}
      setOpen={setOpen}
      text={text}
    /> : <Dialog onOpenChange={setOpen} open={open} title={text('dialogTitle')}>
      <div className="config-selector-dialog">
        {loading && <div className="config-selector-dialog__loading"><MdiIcon name="mdi-loading" />{text('loading')}</div>}
        {!loading && <div className="config-selector-dialog__list">
          {!multiple && <button className={draft[0] === '' ? 'is-active' : ''} onClick={() => setDraft([''])} type="button">
            <span><strong>{text('clearSelection')}</strong><small>{text('clearSelectionSubtitle')}</small></span>
            {draft[0] === '' && <MdiIcon name="mdi-check-circle" />}
          </button>}
          {kind === 'plugin' && <button className={draft.includes('*') ? 'is-active' : ''} onClick={() => setDraft(['*'])} type="button">
            <span><strong>{text('allPlugins')}</strong></span>
            {draft.includes('*') && <MdiIcon name="mdi-check-circle" />}
          </button>}
          {items.map((item) => {
            const id = itemId(item);
            if (!id) return null;
            const active = draft.includes(id);
            return <button className={active ? 'is-active' : ''} key={id} onClick={() => toggle(id)} type="button">
              <span><strong>{id}</strong>{itemDescription(item) && <small>{itemDescription(item)}</small>}</span>
              {active && <MdiIcon name="mdi-check-circle" />}
            </button>;
          })}
          {!items.length && <div className="dynamic-editor-empty"><MdiIcon name="mdi-database-off-outline" /><p>{text(kind === 'provider' ? 'noProviders' : kind === 'knowledge' ? 'noKnowledgeBases' : 'noPlugins')}</p></div>}
        </div>}
        <div className="dialog-actions"><button onClick={() => { setDraft(selected); setOpen(false); }} type="button">{text('cancelSelection')}</button><button className="button--primary" onClick={confirm} type="button">{text('confirmSelection')}</button></div>
      </div>
    </Dialog>}
  </div>;
}

export function PersonaQuickPreview({ personaId }: { personaId: string }) {
  const { t } = useTranslation();
  const text = (key: string, options?: Record<string, unknown>) => t(`core.shared.personaQuickPreview.${key}`, options);
  const [persona, setPersona] = useState<Item | null>(null);
  const [loading, setLoading] = useState(false);
  const [toolCount, setToolCount] = useState(0);
  const [skillCount, setSkillCount] = useState(0);

  useEffect(() => {
    void Promise.all([listTools(), listSkills()]).then(([toolResponse, skillResponse]) => {
      setToolCount(records(responseData(toolResponse), ['tools', 'items', 'data']).filter((item) => item.origin !== 'builtin').length);
      setSkillCount(records(responseData(skillResponse), ['skills', 'items', 'data']).filter((item) => item.active !== false).length);
    }).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!personaId) { setPersona(null); return; }
    if (personaId === 'default') {
      setPersona({ persona_id: 'default', system_prompt: 'You are a helpful and friendly assistant.', tools: null, skills: null });
      return;
    }
    setLoading(true);
    void listPersonas().then((response) => {
      setPersona(records(responseData(response), ['personas', 'items', 'data']).find((item) => stringId(item, 'persona_id', 'id') === personaId) ?? null);
    }).catch(() => setPersona(null)).finally(() => setLoading(false));
  }, [personaId]);

  const tools = Array.isArray(persona?.tools) ? (persona?.tools as unknown[]).map(String) : null;
  const skills = Array.isArray(persona?.skills) ? (persona?.skills as unknown[]).map(String) : null;
  return <div className="persona-quick-preview">
    <small>{text('title')}</small>
    {loading ? <p>{text('loading')}</p> : !personaId ? <p>{text('noPersonaSelected')}</p> : !persona ? <p>{text('personaNotFound')}</p> : <>
      <label>{text('systemPromptLabel')}</label>
      <pre>{String(persona.system_prompt || '')}</pre>
      <label>{text('toolsLabel')}</label>
      <div>{tools === null ? <span className="is-all">{text('allToolsWithCount', { count: toolCount })}</span> : tools.length ? tools.map((item) => <span key={item}>{item}</span>) : <small>{text('noTools')}</small>}</div>
      <label>{text('skillsLabel')}</label>
      <div>{skills === null ? <span className="is-all">{text('allSkillsWithCount', { count: skillCount })}</span> : skills.length ? skills.map((item) => <span key={item}>{item}</span>) : <small>{text('noSkills')}</small>}</div>
    </>}
  </div>;
}
