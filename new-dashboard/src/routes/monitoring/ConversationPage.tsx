import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  batchDeleteConversations,
  deleteConversation,
  getConversation,
  listConversations,
  openApiAxiosClient,
  replaceConversationMessages,
  updateConversation,
} from '@/api/openapi';
import { Dialog, DialogClose } from '@/components/headless/Dialog';
import { MonacoEditor } from '@/components/editor/MonacoEditor';
import { confirmAction, toast } from '@/stores/feedback';
import { conversationKey, parseConversationHistory, parseUmo, type Conversation, type ConversationListData } from './conversationModel';
import { formatTimestamp, unwrapData } from './model';

export default function ConversationPage() {
  const { i18n, t } = useTranslation();
  const prefix = 'features/conversation';
  const [items, setItems] = useState<Conversation[]>([]);
  const [search, setSearch] = useState('');
  const [messageType, setMessageType] = useState('');
  const [platform, setPlatform] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(() => new Set<string>());
  const [detail, setDetail] = useState<Conversation | null>(null);
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([]);
  const [historyJson, setHistoryJson] = useState('[]');
  const [editingHistory, setEditingHistory] = useState(false);
  const [savingHistory, setSavingHistory] = useState(false);
  const [editing, setEditing] = useState<Conversation | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await listConversations({ query: {
        exclude_ids: 'astrbot', exclude_platforms: 'webchat',
        message_types: messageType || undefined, page, page_size: pageSize,
        platforms: platform.trim() || undefined,
        search: search.trim() || undefined,
      } });
      const data = unwrapData<ConversationListData>(response);
      setItems(data?.conversations ?? []);
      setTotal(data?.pagination?.total ?? 0);
      setTotalPages(data?.pagination?.total_pages ?? 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t(`${prefix}.messages.fetchError`)); }
    finally { setLoading(false); }
  }, [messageType, page, pageSize, platform, search, t]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 300); return () => window.clearTimeout(timer); }, [load]);

  const openDetail = async (item: Conversation) => {
    setLoading(true);
    try {
      const response = await getConversation({ path: { conversation_id: item.cid }, query: { user_id: item.user_id } });
      const data = unwrapData<Conversation>(response) ?? item;
      setDetail({ ...item, ...data });
      const nextHistory = parseConversationHistory(data.history);
      setHistory(nextHistory);
      setHistoryJson(JSON.stringify(nextHistory, null, 2));
      setEditingHistory(false);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : t(`${prefix}.messages.historyError`)); }
    finally { setLoading(false); }
  };
  const saveTitle = async () => {
    if (!editing) return;
    try {
      await updateConversation({ body: { title: editing.title }, path: { conversation_id: editing.cid }, query: { user_id: editing.user_id } });
      toast.success(t(`${prefix}.messages.saveSuccess`)); setEditing(null); await load();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : t(`${prefix}.messages.saveError`)); }
  };
  const remove = async (targets: Conversation[]) => {
    if (!await confirmAction({ danger: true, message: t(`${prefix}.dialogs.batchDelete.message`, { count: targets.length }), title: t(`${prefix}.dialogs.delete.title`) })) return;
    try {
      if (targets.length === 1) await deleteConversation({ path: { conversation_id: targets[0].cid }, query: { user_id: targets[0].user_id } });
      else await batchDeleteConversations({ body: { conversations: targets.map(({ cid, user_id }) => ({ cid, user_id })) } });
      setSelected(new Set()); toast.success(t(`${prefix}.messages.deleteSuccess`)); await load();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : t(`${prefix}.messages.deleteError`)); }
  };
  const selectedItems = useMemo(() => items.filter((item) => selected.has(conversationKey(item))), [items, selected]);
  const saveHistory = async () => {
    if (!detail) return;
    let parsed: Array<Record<string, unknown>>;
    try {
      const value: unknown = JSON.parse(historyJson);
      if (!Array.isArray(value)) throw new Error(t(`${prefix}.messages.invalidJson`));
      parsed = value as Array<Record<string, unknown>>;
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t(`${prefix}.messages.invalidJson`));
      return;
    }
    setSavingHistory(true);
    try {
      await replaceConversationMessages({ body: { history: parsed }, path: { conversation_id: detail.cid }, query: { user_id: detail.user_id } });
      setHistory(parsed); setEditingHistory(false); toast.success(t(`${prefix}.messages.historySaveSuccess`));
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : t(`${prefix}.messages.historySaveError`)); }
    finally { setSavingHistory(false); }
  };
  const exportSelected = async () => {
    try {
      const response = await openApiAxiosClient.post('/api/v1/conversations/export', { conversations: selectedItems.map(({ cid, user_id }) => ({ cid, user_id })) }, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data as Blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `conversations-${new Date().toISOString().slice(0, 10)}.jsonl`; anchor.click(); URL.revokeObjectURL(url);
      toast.success(t(`${prefix}.messages.exportSuccess`));
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : t(`${prefix}.messages.exportError`)); }
  };
  const toggle = (item: Conversation) => setSelected((current) => { const next = new Set(current); const key = conversationKey(item); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  return <div className="monitor-page data-page">
    <header className="monitor-header"><div><h1>{t(`${prefix}.title`)}</h1><p>{t(`${prefix}.subtitle`)}</p></div><div className="monitor-actions"><button disabled={loading} onClick={() => void load()} type="button">{t(`${prefix}.history.refresh`)}</button></div></header>
    <div className="monitor-toolbar data-filters"><input onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={t(`${prefix}.filters.search`)} value={search} /><input onChange={(event) => { setPlatform(event.target.value); setPage(1); }} placeholder={t(`${prefix}.filters.platform`)} value={platform} /><select onChange={(event) => { setMessageType(event.target.value); setPage(1); }} value={messageType}><option value="">{t(`${prefix}.filters.type`)}</option><option value="GroupMessage">{t(`${prefix}.messageTypes.group`)}</option><option value="FriendMessage">{t(`${prefix}.messageTypes.friend`)}</option></select>{selectedItems.length > 0 && <><button onClick={() => void exportSelected()} type="button">{t(`${prefix}.batch.exportSelected`, { count: selectedItems.length })}</button><button className="button--danger" onClick={() => void remove(selectedItems)} type="button">{t(`${prefix}.batch.deleteSelected`, { count: selectedItems.length })}</button></>}</div>
    {error && <div className="monitor-error" role="alert">{error}</div>}
    <div className="monitor-table-wrap"><table className="monitor-table"><thead><tr><th /><th>{t(`${prefix}.table.headers.title`)}</th><th>{t(`${prefix}.table.headers.umo`)}</th><th>{t(`${prefix}.table.headers.createdAt`)}</th><th>{t(`${prefix}.table.headers.updatedAt`)}</th><th>{t(`${prefix}.table.headers.actions`)}</th></tr></thead><tbody>{items.map((item) => { const umo = parseUmo(item.user_id); return <tr key={conversationKey(item)}><td><input checked={selected.has(conversationKey(item))} onChange={() => toggle(item)} type="checkbox" /></td><td><strong>{item.title || t(`${prefix}.status.noTitle`)}</strong><small>{item.cid}</small></td><td><span>{umo.platform}</span><small>{umo.messageType}:{umo.sessionId}</small></td><td>{formatTimestamp(item.created_at, i18n.language)}</td><td>{formatTimestamp(item.updated_at, i18n.language)}</td><td><button onClick={() => void openDetail(item)} type="button">{t(`${prefix}.actions.view`)}</button><button onClick={() => setEditing({ ...item })} type="button">{t(`${prefix}.actions.edit`)}</button><button className="button--danger" onClick={() => void remove([item])} type="button">{t(`${prefix}.actions.delete`)}</button></td></tr>; })}</tbody></table>{!loading && items.length === 0 && <div className="monitor-empty">{t(`${prefix}.status.noData`)}</div>}</div>
    <div className="pagination"><label>{t(`${prefix}.pagination.itemsPerPage`)} <select onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }} value={pageSize}>{[10, 20, 50, 100].map((size) => <option key={size}>{size}</option>)}</select></label><span>{total}</span><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} type="button">‹</button><span>{page}/{totalPages}</span><button disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)} type="button">›</button></div>
    <Dialog onOpenChange={(open) => !open && setDetail(null)} open={Boolean(detail)} title={detail?.title || t(`${prefix}.status.noTitle`)}>
      <div className="dialog-actions"><button onClick={() => setEditingHistory((value) => !value)} type="button">{t(`${prefix}.dialogs.view.${editingHistory ? 'previewMode' : 'editMode'}`)}</button>{editingHistory && <button className="button--primary" disabled={savingHistory} onClick={() => void saveHistory()} type="button">{t(`${prefix}.dialogs.view.saveChanges`)}</button>}</div>
      {editingHistory ? <div className="json-editor"><MonacoEditor language="json" onChange={setHistoryJson} value={historyJson} /></div> : history.length ? <div className="conversation-history">{history.map((message, index) => <article key={index}><strong>{String(message.role ?? 'message')}</strong><pre>{typeof message.content === 'string' ? message.content : JSON.stringify(message.content, null, 2)}</pre></article>)}</div> : <div className="monitor-empty">{t(`${prefix}.status.emptyContent`)}</div>}
      <DialogClose asChild><button type="button">{t(`${prefix}.dialogs.view.close`)}</button></DialogClose>
    </Dialog>
    <Dialog onOpenChange={(open) => !open && setEditing(null)} open={Boolean(editing)} title={t(`${prefix}.dialogs.edit.title`)}><div className="dialog-form"><label>{t(`${prefix}.dialogs.edit.titleLabel`)}<input onChange={(event) => setEditing((current) => current ? { ...current, title: event.target.value } : null)} value={editing?.title ?? ''} /></label><div className="dialog-actions"><DialogClose asChild><button type="button">{t(`${prefix}.dialogs.edit.cancel`)}</button></DialogClose><button className="button--primary" onClick={() => void saveTitle()} type="button">{t(`${prefix}.dialogs.edit.save`)}</button></div></div></Dialog>
  </div>;
}
