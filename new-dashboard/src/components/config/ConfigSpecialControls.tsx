import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  listKnowledgeBases,
  listPersonas,
  listPlugins,
  listProviders,
  listSkills,
  listTools,
} from '@/api/openapi';
import { Dialog } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';

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
    <Dialog onOpenChange={setOpen} open={open} title={text('dialogTitle')}>
      <div className="config-selector-dialog">
        {loading && <div className="config-selector-dialog__loading"><MdiIcon name="mdi-loading" />{text('loading')}</div>}
        {!loading && <div className="config-selector-dialog__list">
          {!multiple && <button className={draft[0] === '' ? 'is-active' : ''} onClick={() => setDraft([''])} type="button">
            <span><strong>{text('clearSelection')}</strong><small>{text('clearSelectionSubtitle')}</small></span>
            {draft[0] === '' && <MdiIcon name="mdi-check-circle" />}
          </button>}
          {kind === 'persona' && <button className={draft.includes('default') ? 'is-active' : ''} onClick={() => toggle('default')} type="button">
            <span><strong>{text('defaultPersona')}</strong><small>You are a helpful and friendly assistant.</small></span>
            {draft.includes('default') && <MdiIcon name="mdi-check-circle" />}
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
          {!items.length && <div className="dynamic-editor-empty"><MdiIcon name="mdi-database-off-outline" /><p>{text(kind === 'provider' ? 'noProviders' : kind === 'persona' ? 'noPersonas' : kind === 'knowledge' ? 'noKnowledgeBases' : 'noPlugins')}</p></div>}
        </div>}
        <div className="dialog-actions"><button onClick={() => { setDraft(selected); setOpen(false); }} type="button">{text('cancelSelection')}</button><button className="button--primary" onClick={confirm} type="button">{text('confirmSelection')}</button></div>
      </div>
    </Dialog>
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
