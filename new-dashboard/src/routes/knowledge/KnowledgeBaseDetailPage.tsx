import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { deleteKnowledgeDocument, getKnowledgeBase, getKnowledgeBaseStats, getKnowledgeTask, importKnowledgeDocumentFromUrl, listKnowledgeDocuments, listProviders, retrieveKnowledgeBase, updateKnowledgeBase, uploadKnowledgeDocument } from '@/api/openapi';
import { Dialog, DialogClose } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { confirmAction, toast } from '@/stores/feedback';
import { errorMessage, isObject, JsonObject, objectList, responseData } from '@/routes/configuration/model';
import { chunkCount, documentCount, documentId, documentName, formatFileSize, formatKnowledgeDate, retrievalPayload, scoreTone, taskIds } from './knowledgeModel';

type DetailTab = 'overview' | 'documents' | 'retrieval' | 'settings';
type Settings = { chunk_size: number; chunk_overlap: number; top_k_dense: number; top_k_sparse: number; top_m_final: number; rerank_provider_id: string };
const defaultSettings: Settings = { chunk_size: 512, chunk_overlap: 50, top_k_dense: 50, top_k_sparse: 50, top_m_final: 5, rerank_provider_id: '' };

export default function KnowledgeBaseDetailPage() {
  const { kbId = '' } = useParams();
  const { t, i18n } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) => t(`features.knowledge-base.detail.${key}`, options);
  const [kb, setKb] = useState<JsonObject>({});
  const [stats, setStats] = useState<JsonObject>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [active, setActive] = useState<DetailTab>('overview');

  const loadBase = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [baseResponse, statsResponse] = await Promise.all([getKnowledgeBase({ path: { kb_id: kbId } }), getKnowledgeBaseStats({ path: { kb_id: kbId } }).catch(() => null)]);
      setKb(responseData<JsonObject>(baseResponse) ?? {});
      setStats(responseData<JsonObject>(statsResponse) ?? {});
    } catch (cause) { setError(errorMessage(cause, k('title'))); }
    finally { setLoading(false); }
  }, [kbId, t]);
  useEffect(() => { void loadBase(); }, [loadBase]);

  const tabs: Array<{ icon: `mdi-${string}`; key: DetailTab; label: string }> = [
    { key: 'overview', icon: 'mdi-information-outline', label: k('tabs.overview') },
    { key: 'documents', icon: 'mdi-file-document-multiple', label: k('tabs.documents') },
    { key: 'retrieval', icon: 'mdi-text-box-search-outline', label: k('tabs.retrieval') },
    { key: 'settings', icon: 'mdi-cog-outline', label: k('tabs.settings') },
  ];

  return <div className="knowledge-detail-page">
    <header className="knowledge-detail-header"><Link aria-label={k('backToList')} to="/knowledge-base"><MdiIcon name="mdi-arrow-left" /></Link><span>{String(kb.emoji || '📚')}</span><div><h1>{String(kb.kb_name || kbId)}</h1><p>{String(kb.description || k('overview.notSet'))}</p></div></header>
    <nav className="knowledge-tabs">{tabs.map((tab) => <button aria-pressed={active === tab.key} key={tab.key} onClick={() => setActive(tab.key)} type="button"><MdiIcon name={tab.icon} />{tab.label}</button>)}</nav>
    {error && <div className="monitor-error" role="alert">{error}</div>}
    {loading && <div className="knowledge-loading"><MdiIcon className="mdi-spin" name="mdi-loading" /></div>}
    {!loading && !error && active === 'overview' && <Overview kb={kb} locale={i18n.language} stats={stats} t={k} />}
    {!loading && !error && active === 'documents' && <Documents kb={kb} kbId={kbId} onBaseRefresh={loadBase} t={k} />}
    {!loading && !error && active === 'retrieval' && <Retrieval kbId={kbId} t={k} />}
    {!loading && !error && active === 'settings' && <KnowledgeSettings kb={kb} kbId={kbId} onSaved={loadBase} t={k} />}
  </div>;
}

function Overview({ kb, locale, stats, t }: { kb: JsonObject; locale: string; stats: JsonObject; t: (key: string, options?: Record<string, unknown>) => string }) {
  const docTotal = documentCount(stats) || documentCount(kb);
  const chunks = chunkCount(stats) || chunkCount(kb);
  return <div className="knowledge-overview">
    <section className="knowledge-overview__stats"><article><MdiIcon name="mdi-file-document-multiple" /><strong>{docTotal}</strong><span>{t('overview.docCount')}</span></article><article><MdiIcon name="mdi-text-box-outline" /><strong>{chunks}</strong><span>{t('overview.chunkCount')}</span></article></section>
    <div className="knowledge-overview__grid"><section><h2>{t('overview.title')}</h2><dl><div><dt>{t('overview.name')}</dt><dd>{String(kb.kb_name || t('overview.notSet'))}</dd></div><div><dt>{t('overview.description')}</dt><dd>{String(kb.description || t('overview.noDescription'))}</dd></div><div><dt>{t('overview.createdAt')}</dt><dd>{formatKnowledgeDate(kb.created_at, locale, t('overview.notSet'))}</dd></div><div><dt>{t('overview.updatedAt')}</dt><dd>{formatKnowledgeDate(kb.updated_at, locale, t('overview.notSet'))}</dd></div></dl></section><section><h2>{t('overview.embeddingModel')}</h2><dl><div><dt>{t('overview.embeddingModel')}</dt><dd>{String(kb.embedding_provider_id || t('overview.notSet'))}</dd></div><div><dt>{t('overview.rerankModel')}</dt><dd>{String(kb.rerank_provider_id || t('overview.notSet'))}</dd></div></dl></section></div>
  </div>;
}

function Documents({ kb, kbId, onBaseRefresh, t }: { kb: JsonObject; kbId: string; onBaseRefresh: () => Promise<void>; t: (key: string, options?: Record<string, unknown>) => string }) {
  const [items, setItems] = useState<JsonObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [mode, setMode] = useState<'file' | 'url'>('file');
  const [files, setFiles] = useState<File[]>([]);
  const [url, setUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const [dragging, setDragging] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = responseData<JsonObject>(await listKnowledgeDocuments({ path: { kb_id: kbId }, query: { page, page_size: pageSize, search: search.trim() || undefined } })) ?? {};
      const rows = objectList(data, ['items', 'documents']); setItems(rows); setTotal(typeof data.total === 'number' ? data.total : rows.length);
    } catch (cause) { toast.error(errorMessage(cause, t('documents.uploadFailed'))); }
    finally { setLoading(false); }
  }, [kbId, page, pageSize, search, t]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 180); return () => window.clearTimeout(timer); }, [load]);

  const addFiles = (incoming: File[]) => {
    const accepted = incoming.filter((file) => file.size <= 128 * 1024 * 1024).slice(0, Math.max(0, 10 - files.length));
    setFiles((current) => [...current, ...accepted].slice(0, 10));
  };
  const waitForTasks = async (ids: string[]) => {
    if (!ids.length) return;
    const remaining = new Set(ids);
    for (let attempt = 0; attempt < 240 && remaining.size; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      await Promise.all([...remaining].map(async (id) => {
        try {
          const data = responseData<JsonObject>(await getKnowledgeTask({ path: { task_id: id } })) ?? {};
          const status = String(data.status || 'processing'); const taskProgress = isObject(data.progress) ? data.progress : {};
          setProgress(`${String(taskProgress.stage || status)}${taskProgress.current ? ` · ${taskProgress.current}/${taskProgress.total || '?'}` : ''}`);
          if (status === 'completed') remaining.delete(id);
          if (status === 'failed') { remaining.delete(id); toast.error(String(data.error || t('documents.uploadFailed'))); }
        } catch { /* transient polling failures are retried */ }
      }));
    }
  };
  const upload = async () => {
    if (mode === 'file' && !files.length) { toast.warning(t('upload.fileRequired')); return; }
    if (mode === 'url' && !url.trim()) { toast.warning(t('upload.urlRequired')); return; }
    setUploading(true); setProgress(t('documents.uploading'));
    try {
      const responses = mode === 'file'
        ? await Promise.all(files.map((file) => uploadKnowledgeDocument({ path: { kb_id: kbId }, body: { file } })))
        : [await importKnowledgeDocumentFromUrl({ path: { kb_id: kbId }, body: { url: url.trim() } })];
      const ids = responses.flatMap((response) => taskIds(responseData(response)));
      setUploadOpen(false); setFiles([]); setUrl('');
      await waitForTasks(ids); await Promise.all([load(), onBaseRefresh()]);
      toast.success(t('documents.uploadSuccess'));
    } catch (cause) { toast.error(errorMessage(cause, t('documents.uploadFailed'))); }
    finally { setUploading(false); setProgress(''); }
  };
  const remove = async (item: JsonObject) => {
    const id = documentId(item); const name = documentName(item);
    if (!id || !await confirmAction({ danger: true, title: t('documents.delete'), message: `${t('documents.deleteConfirm', { name })}\n${t('documents.deleteWarning')}` })) return;
    try { await deleteKnowledgeDocument({ path: { kb_id: kbId, document_id: id } }); toast.success(t('documents.deleteSuccess')); await Promise.all([load(), onBaseRefresh()]); }
    catch (cause) { toast.error(errorMessage(cause, t('documents.deleteFailed'))); }
  };

  return <section className="knowledge-documents">
    <div className="knowledge-documents__toolbar"><button className="button--primary" onClick={() => setUploadOpen(true)} type="button"><MdiIcon name="mdi-cloud-upload" />{t('documents.upload')}</button><label><MdiIcon name="mdi-magnify" /><input onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={t('documents.title')} value={search} /></label></div>
    {progress && <div className="knowledge-upload-progress"><MdiIcon className="mdi-spin" name="mdi-loading" /><span>{progress}</span></div>}
    <div className="knowledge-table"><table><thead><tr><th>{t('documents.name')}</th><th>{t('documents.type')}</th><th>{t('documents.size')}</th><th>{t('documents.chunks')}</th><th>{t('documents.createdAt')}</th><th /></tr></thead><tbody>{items.map((item) => { const id = documentId(item); return <tr key={id}><td><Link to={`/knowledge-base/${encodeURIComponent(kbId)}/document/${encodeURIComponent(id)}`}><MdiIcon name={fileIcon(String(item.file_type || documentName(item)))} /><span>{documentName(item)}</span></Link></td><td>{String(item.file_type || t('documents.unknownType'))}</td><td>{formatFileSize(item.file_size ?? item.size, t('overview.notSet'))}</td><td>{chunkCount(item)}</td><td>{formatKnowledgeDate(item.created_at, undefined, t('overview.notSet'))}</td><td><button aria-label={t('documents.delete')} className="button--danger" onClick={() => void remove(item)} title={t('documents.delete')} type="button"><MdiIcon name="mdi-delete-outline" /></button></td></tr>; })}</tbody></table>{loading && <div className="knowledge-table__state"><MdiIcon className="mdi-spin" name="mdi-loading" /></div>}{!loading && !items.length && <div className="knowledge-table__state"><MdiIcon name="mdi-file-document-outline" /><span>{t('documents.empty')}</span></div>}</div>
    {total > pageSize && <div className="pagination"><select onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }} value={pageSize}>{[10, 20, 50].map((size) => <option key={size}>{size}</option>)}</select><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} type="button">‹</button><span>{page}/{Math.ceil(total / pageSize)}</span><button disabled={page * pageSize >= total} onClick={() => setPage((value) => value + 1)} type="button">›</button></div>}
    <Dialog onOpenChange={setUploadOpen} open={uploadOpen} title={t('upload.title')}><div className="knowledge-upload"><nav><button aria-pressed={mode === 'file'} onClick={() => setMode('file')} type="button">{t('upload.fileUpload')}</button><button aria-pressed={mode === 'url'} onClick={() => setMode('url')} type="button">{t('upload.fromUrl')} <small>{t('upload.beta')}</small></button></nav>{mode === 'file' ? <><button className={`knowledge-dropzone${dragging ? ' is-dragging' : ''}`} onClick={() => document.getElementById('knowledge-file-input')?.click()} onDragLeave={() => setDragging(false)} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(Array.from(event.dataTransfer.files)); }} type="button"><MdiIcon name="mdi-cloud-upload" /><strong>{t('upload.dropzone')}</strong><span>{t('upload.supportedFormats')}</span><span>{t('upload.maxSize')}</span></button><input hidden id="knowledge-file-input" multiple onChange={(event) => addFiles(Array.from(event.target.files ?? []))} type="file" /><div className="knowledge-selected-files">{files.map((file, index) => <div key={`${file.name}-${index}`}><MdiIcon name={fileIcon(file.name)} /><span><strong>{file.name}</strong><small>{formatFileSize(file.size)}</small></span><button onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button"><MdiIcon name="mdi-close" /></button></div>)}</div></> : <label className="knowledge-url-field">{t('upload.urlPlaceholder')}<input onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/article" type="url" value={url} /><small>{t('upload.urlHint', { supported: 'HTML' })}</small></label>}<div className="knowledge-upload__settings"><h3>{t('upload.chunkSettings')}</h3><span>{t('upload.chunkSize')}: {String(kb.chunk_size || 512)}</span><span>{t('upload.chunkOverlap')}: {String(kb.chunk_overlap || 50)}</span></div><div className="dialog-actions"><DialogClose asChild><button disabled={uploading} type="button">{t('upload.cancel')}</button></DialogClose><button className="button--primary" disabled={uploading || (mode === 'file' ? !files.length : !url.trim())} onClick={() => void upload()} type="button">{uploading ? t('documents.uploading') : t('upload.submit')}</button></div></div></Dialog>
  </section>;
}

function Retrieval({ kbId, t }: { kbId: string; t: (key: string, options?: Record<string, unknown>) => string }) {
  const [query, setQuery] = useState(''); const [topK, setTopK] = useState(5); const [threshold, setThreshold] = useState(0); const [loading, setLoading] = useState(false); const [searched, setSearched] = useState(false); const [results, setResults] = useState<JsonObject[]>([]); const [visualization, setVisualization] = useState('');
  const retrieve = async () => {
    if (!query.trim()) { toast.warning(t('retrieval.queryRequired')); return; }
    setLoading(true); setSearched(false);
    try { const normalized = retrievalPayload(responseData(await retrieveKnowledgeBase({ path: { kb_id: kbId }, body: { query: query.trim(), top_k: topK, score_threshold: threshold || undefined } }))); setResults(normalized.results); setVisualization(normalized.visualization); setSearched(true); toast.success(t('retrieval.searchSuccess', { count: normalized.results.length })); }
    catch (cause) { toast.error(errorMessage(cause, t('retrieval.searchFailed'))); }
    finally { setLoading(false); }
  };
  return <section className="knowledge-retrieval-panel"><header><h2>{t('retrieval.title')}</h2><p>{t('retrieval.subtitle')}</p></header><div className="knowledge-retrieval-form"><label>{t('retrieval.query')}<textarea onChange={(event) => setQuery(event.target.value)} placeholder={t('retrieval.queryPlaceholder')} rows={4} value={query} /></label><aside><label>{t('retrieval.topK')}<input min={1} onChange={(event) => setTopK(Number(event.target.value))} type="number" value={topK} /></label><label>{t('retrieval.scoreThreshold')}<input max={1} min={0} onChange={(event) => setThreshold(Number(event.target.value))} step="0.05" type="number" value={threshold} /></label></aside></div><button className="button--primary knowledge-retrieve-button" disabled={loading || !query.trim()} onClick={() => void retrieve()} type="button"><MdiIcon className={loading ? 'mdi-spin' : ''} name={loading ? 'mdi-loading' : 'mdi-magnify'} />{loading ? t('retrieval.searching') : t('retrieval.search')}</button>{visualization && <img alt="t-SNE" className="knowledge-retrieval-visualization" src={`data:image/png;base64,${visualization}`} />}{searched && <div className="knowledge-results"><h3>{t('retrieval.results')} <span>{results.length}</span></h3>{results.map((result, index) => <article key={String(result.chunk_id || index)}><header><span>#{index + 1}</span><strong>{t('retrieval.chunk', { index: Number(result.chunk_index ?? index) + 1 })}</strong><small>{String(result.doc_name || result.document_name || '')}</small><b className={`is-${scoreTone(result.score)}`}>{t('retrieval.score')}: {Number(result.score || 0).toFixed(4)}</b></header><p>{String(result.content || result.text || '')}</p></article>)}{!results.length && <div className="knowledge-empty knowledge-empty--compact"><MdiIcon name="mdi-text-box-search-outline" /><h3>{t('retrieval.noResults')}</h3><p>{t('retrieval.tryDifferentQuery')}</p></div>}</div>}</section>;
}

function KnowledgeSettings({ kb, kbId, onSaved, t }: { kb: JsonObject; kbId: string; onSaved: () => Promise<void>; t: (key: string, options?: Record<string, unknown>) => string }) {
  const initial = useMemo<Settings>(() => ({ chunk_size: Number(kb.chunk_size || 512), chunk_overlap: Number(kb.chunk_overlap || 50), top_k_dense: Number(kb.top_k_dense || 50), top_k_sparse: Number(kb.top_k_sparse || 50), top_m_final: Number(kb.top_m_final || 5), rerank_provider_id: String(kb.rerank_provider_id || '') }), [kb]);
  const [form, setForm] = useState(initial); const [providers, setProviders] = useState<JsonObject[]>([]); const [saving, setSaving] = useState(false);
  useEffect(() => setForm(initial), [initial]);
  useEffect(() => { void listProviders({ query: { capability: 'rerank', enabled: true } }).then((response) => setProviders(objectList(responseData(response), ['providers', 'items', 'data']))).catch(() => undefined); }, []);
  const save = async () => { setSaving(true); try { await updateKnowledgeBase({ path: { kb_id: kbId }, body: { ...form, rerank_provider_id: form.rerank_provider_id || null } }); toast.success(t('settings.saveSuccess')); await onSaved(); } catch (cause) { toast.error(errorMessage(cause, t('settings.saveFailed'))); } finally { setSaving(false); } };
  return <section className="knowledge-settings"><header><h2>{t('settings.title')}</h2><p>{t('settings.tips')}</p></header><div className="knowledge-settings__group"><h3>{t('settings.basic')}</h3><div><NumberField field="chunk_size" form={form} label={t('settings.chunkSize')} setForm={setForm} /><NumberField field="chunk_overlap" form={form} label={t('settings.chunkOverlap')} setForm={setForm} /></div></div><div className="knowledge-settings__group"><h3>{t('settings.retrieval')}</h3><div><NumberField field="top_k_dense" form={form} label={t('settings.topKDense')} setForm={setForm} /><NumberField field="top_k_sparse" form={form} label={t('settings.topKSparse')} setForm={setForm} /><NumberField field="top_m_final" form={form} label={t('settings.topMFinal')} setForm={setForm} /><label>{t('settings.rerankProvider')}<select onChange={(event) => setForm({ ...form, rerank_provider_id: event.target.value })} value={form.rerank_provider_id}><option value="">{t('overview.notSet')}</option>{providers.map((provider) => <option key={String(provider.id)} value={String(provider.id)}>{String(provider.rerank_model || provider.model || provider.id)}</option>)}</select></label></div></div><div className="knowledge-settings__embedding"><MdiIcon name="mdi-vector-point" /><span><strong>{t('settings.embeddingProvider')}</strong><small>{String(kb.embedding_provider_id || t('overview.notSet'))}</small></span></div><button className="button--primary knowledge-settings__save" disabled={saving} onClick={() => void save()} type="button"><MdiIcon name="mdi-content-save" />{t('settings.save')}</button></section>;
}

function NumberField({ field, form, label, setForm }: { field: keyof Omit<Settings, 'rerank_provider_id'>; form: Settings; label: string; setForm: (form: Settings) => void }) {
  return <label>{label}<input min={0} onChange={(event) => setForm({ ...form, [field]: Number(event.target.value) })} type="number" value={form[field]} /></label>;
}

function fileIcon(file: string): `mdi-${string}` {
  const type = file.toLowerCase();
  if (type.includes('pdf')) return 'mdi-file-pdf-box';
  if (type.includes('epub')) return 'mdi-book-open-page-variant';
  if (type.includes('.md') || type.includes('markdown')) return 'mdi-language-markdown-outline';
  if (type.includes('xls')) return 'mdi-file-excel-box';
  return 'mdi-file-document-outline';
}
