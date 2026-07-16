import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { createKnowledgeBase, deleteKnowledgeBase, listKnowledgeBases, listProviders, updateKnowledgeBase } from '@/api/openapi';
import { Dialog, DialogClose } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { confirmAction, toast } from '@/stores/feedback';
import { errorMessage, JsonObject, objectList, responseData } from '@/routes/configuration/model';
import { knowledgeBaseId, chunkCount, documentCount } from './knowledgeModel';

type Form = { kb_name: string; description: string; emoji: string; embedding_provider_id: string; rerank_provider_id: string };
const emptyForm: Form = { kb_name: '', description: '', emoji: '📚', embedding_provider_id: '', rerank_provider_id: '' };
const emojiGroups = [
  ['books', ['📚', '📖', '📕', '📗', '📘', '📙', '📓', '📑', '🗂️', '📂', '🗃️']],
  ['emotions', ['😀', '😃', '😄', '😁', '😊', '🥰', '😍', '🤓', '🧐']],
  ['objects', ['💡', '🔬', '🔭', '🏆', '🎯', '🎓', '🔑', '🔒', '🛠️', '⚙️']],
  ['symbols', ['❤️', '🧡', '💛', '💚', '💙', '💜', '⭐', '✨', '⚡', '🔥']],
] as const;

export default function KnowledgeBaseListPage() {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) => t(`features.knowledge-base.index.${key}`, options);
  const [items, setItems] = useState<JsonObject[]>([]);
  const [providers, setProviders] = useState<JsonObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [editing, setEditing] = useState<JsonObject | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setLoading(true); setError('');
    try {
      const data = responseData<JsonObject>(await listKnowledgeBases({ query: { page, page_size: 20, refresh_stats: refresh } })) ?? {};
      const rows = objectList(data, ['items', 'knowledge_bases']);
      setItems(rows); setTotal(typeof data.total === 'number' ? data.total : rows.length);
    } catch (cause) { setError(errorMessage(cause, k('messages.loadError'))); }
    finally { setLoading(false); }
  }, [page, t]);

  useEffect(() => { void load(true); }, [load]);
  useEffect(() => {
    void Promise.all([listProviders({ query: { capability: 'embedding', enabled: true } }), listProviders({ query: { capability: 'rerank', enabled: true } })])
      .then((responses) => setProviders(responses.flatMap((response) => objectList(responseData(response), ['providers', 'items', 'data']))))
      .catch(() => setProviders([]));
  }, []);

  const embeddingProviders = useMemo(() => providers.filter((item) => String(item.provider_type || item.capability).includes('embedding')), [providers]);
  const rerankProviders = useMemo(() => providers.filter((item) => String(item.provider_type || item.capability).includes('rerank')), [providers]);
  const open = (item?: JsonObject) => {
    setEditing(item ?? {});
    setForm(item ? { kb_name: String(item.kb_name || ''), description: String(item.description || ''), emoji: String(item.emoji || '📚'), embedding_provider_id: String(item.embedding_provider_id || ''), rerank_provider_id: String(item.rerank_provider_id || '') } : emptyForm);
  };
  const close = () => { setEditing(null); setForm(emptyForm); };
  const save = async () => {
    const id = knowledgeBaseId(editing ?? {});
    if (!form.kb_name.trim()) { toast.warning(k('create.nameRequired')); return; }
    if (!id && !form.embedding_provider_id) { toast.warning(k('create.embeddingModelLabel')); return; }
    setSaving(true);
    try {
      const body = { ...form, kb_name: form.kb_name.trim(), embedding_provider_id: form.embedding_provider_id || null, rerank_provider_id: form.rerank_provider_id || null };
      if (id) await updateKnowledgeBase({ path: { kb_id: id }, body });
      else await createKnowledgeBase({ body: { ...body, embedding_provider_id: form.embedding_provider_id } });
      toast.success(k(id ? 'messages.updateSuccess' : 'messages.createSuccess'));
      close(); await load(true);
    } catch (cause) { toast.error(errorMessage(cause, k(id ? 'messages.updateFailed' : 'messages.createFailed'))); }
    finally { setSaving(false); }
  };
  const remove = async (item: JsonObject) => {
    const id = knowledgeBaseId(item); const name = String(item.kb_name || id);
    if (!id || !await confirmAction({ danger: true, title: k('delete.title'), message: `${k('delete.confirmText', { name })}\n${k('delete.warning')}` })) return;
    try { await deleteKnowledgeBase({ path: { kb_id: id } }); toast.success(k('messages.deleteSuccess')); if (items.length === 1 && page > 1) setPage((value) => value - 1); else await load(true); }
    catch (cause) { toast.error(errorMessage(cause, k('messages.deleteFailed'))); }
  };

  return <div className="knowledge-list-page">
    <header className="knowledge-page-header"><div><div><h1>{k('title')}</h1><p>{k('subtitle')}</p></div></div><a aria-label={t('core.navigation.documentation')} className="knowledge-page-header__docs" href="https://docs.astrbot.app/use/knowledge-base.html" rel="noreferrer" target="_blank" title={t('core.navigation.documentation')}><MdiIcon name="mdi-information-outline" /></a></header>
    {error && <div className="monitor-error" role="alert">{error}</div>}
    {loading && !items.length && <div className="knowledge-loading" role="status"><MdiIcon className="mdi-spin" name="mdi-loading" />{k('list.loading')}</div>}
    <section className="knowledge-list">{items.map((item) => { const id = knowledgeBaseId(item); const initError = String(item.init_error || ''); return <article className={`knowledge-list-item${initError ? ' is-error' : ''}`} key={id}>
      <Link aria-disabled={Boolean(initError)} className="knowledge-list-item__main" onClick={(event) => initError && event.preventDefault()} to={`/knowledge-base/${encodeURIComponent(id)}`}><span className="knowledge-list-item__emoji">{String(item.emoji || '📚')}</span><div><header><h2>{String(item.kb_name || id)}</h2>{initError && <span>{k('list.initError')}</span>}</header>{initError ? <div className="knowledge-list-item__error-panel"><strong><MdiIcon name="mdi-close-circle" />{k('list.initError')}</strong><p title={initError}>{initError}</p></div> : <><p>{String(item.description || k('list.noDescription'))}</p><div className="knowledge-list-item__stats"><span><MdiIcon name="mdi-file-document-outline" />{documentCount(item)} {k('list.documents')}</span><span><MdiIcon name="mdi-text-box-outline" />{chunkCount(item)} {k('list.chunks')}</span></div></>}</div></Link>
      <div className="knowledge-list-item__actions">{!initError && <button aria-label={k('card.edit')} onClick={() => open(item)} title={k('card.edit')} type="button"><MdiIcon name="mdi-pencil-outline" /></button>}<button aria-label={k('card.delete')} className="button--danger" onClick={() => void remove(item)} title={k('card.delete')} type="button"><MdiIcon name="mdi-delete-outline" /></button></div>
    </article>; })}</section>
    {!loading && !items.length && <div className="knowledge-empty"><MdiIcon name="mdi-book-open-page-variant" /><h2>{k('list.empty')}</h2><button className="button--primary" onClick={() => open()} type="button"><MdiIcon name="mdi-plus" />{k('list.create')}</button></div>}
    {total > 20 && <div className="pagination"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} type="button">‹</button><span>{page} / {Math.ceil(total / 20)}</span><button disabled={page * 20 >= total} onClick={() => setPage((value) => value + 1)} type="button">›</button></div>}
    <div className="knowledge-fab-stack">
      <button aria-label={k('list.refresh')} className="knowledge-fab" disabled={loading} onClick={() => void load()} title={k('list.refresh')} type="button"><MdiIcon className={loading ? 'mdi-spin' : ''} name="mdi-refresh" /></button>
      <button aria-label={k('list.create')} className="knowledge-fab" onClick={() => open()} title={k('list.create')} type="button"><MdiIcon name="mdi-plus" /></button>
    </div>
    <Dialog onOpenChange={(openValue) => !openValue && close()} open={editing !== null} title={knowledgeBaseId(editing ?? {}) ? k('edit.title') : k('create.title')}>
      <DialogClose asChild><button aria-label={t('core.common.close')} className="knowledge-form__close" type="button"><MdiIcon name="mdi-close" /></button></DialogClose>
      <div className="knowledge-form">
        <div className="knowledge-form__emoji"><button className="knowledge-emoji-button" onClick={() => setEmojiOpen(true)} title={k('create.emojiLabel')} type="button">{form.emoji}</button><small>{k('create.emojiLabel')}</small></div>
        <label>{k('create.nameLabel')}<input autoFocus onChange={(event) => setForm({ ...form, kb_name: event.target.value })} placeholder={k('create.namePlaceholder')} value={form.kb_name} /><small>{k('create.nameHint')}</small></label>
        <label>{k('create.descriptionLabel')}<textarea onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder={k('create.descriptionPlaceholder')} rows={3} value={form.description} /></label>
        <label>{k('create.embeddingModelLabel')}<select disabled={Boolean(knowledgeBaseId(editing ?? {}))} onChange={(event) => setForm({ ...form, embedding_provider_id: event.target.value })} value={form.embedding_provider_id}><option disabled value="">{k('create.embeddingModelPlaceholder')}</option>{embeddingProviders.map((provider) => <option key={String(provider.id)} value={String(provider.id)}>{String(provider.embedding_model || provider.model || provider.id)}</option>)}</select><small>{k('create.embeddingModelHint')}</small></label>
        <label>{k('create.rerankModelLabel')}<select onChange={(event) => setForm({ ...form, rerank_provider_id: event.target.value })} value={form.rerank_provider_id}><option value="">{k('create.noRerankModel')}</option>{rerankProviders.map((provider) => <option key={String(provider.id)} value={String(provider.id)}>{String(provider.rerank_model || provider.model || provider.id)}</option>)}</select></label>
        <div className="dialog-actions"><DialogClose asChild><button type="button">{k('create.cancel')}</button></DialogClose><button className="button--primary-soft" disabled={saving} onClick={() => void save()} type="button">{saving ? k('create.saving') : k(knowledgeBaseId(editing ?? {}) ? 'edit.submit' : 'create.submit')}</button></div>
      </div>
    </Dialog>
    <Dialog onOpenChange={setEmojiOpen} open={emojiOpen} title={k('emoji.title')}><div className="knowledge-emoji-picker">{emojiGroups.map(([group, emojis]) => <section key={group}><h3>{k(`emoji.categories.${group}`)}</h3><div>{emojis.map((emoji) => <button key={emoji} onClick={() => { setForm({ ...form, emoji }); setEmojiOpen(false); }} type="button">{emoji}</button>)}</div></section>)}</div><div className="dialog-actions"><DialogClose asChild><button type="button">{k('emoji.close')}</button></DialogClose></div></Dialog>
  </div>;
}
