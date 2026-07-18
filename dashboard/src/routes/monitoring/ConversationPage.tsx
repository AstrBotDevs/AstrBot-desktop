import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  batchDeleteConversations,
  deleteConversation,
  getConversation,
  listConversations,
  replaceConversationMessages,
  updateConversation,
} from '@/api/openapi';
import { decodeApiData, isRecord } from '@/api/response';
import { conversationFilesApi } from '@/api/services';
import { paginationDefaults } from '@/config/defaults';
import { useBrowserCapabilities } from '@/platform/BrowserCapabilitiesProvider';
import { Dialog, DialogClose } from '@/components/headless/Dialog';
import { MonacoEditor } from '@/components/editor/MonacoEditor';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { Button, DialogCancel } from '@/components/ui/Button';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { DialogActions } from '@/components/ui/DialogActions';
import { Pagination } from '@/components/ui/Pagination';
import { SearchField } from '@/components/ui/SearchField';
import { confirmDestructiveAction } from '@/components/ui/confirm';
import { toast } from '@/stores/feedback';
import {
  conversationKey,
  parseConversation,
  parseConversationHistory,
  parseConversationList,
  parseUmo,
  type Conversation,
} from './conversationModel';
import { formatTimestamp } from './model';

export default function ConversationPage() {
  const { copyText, downloadBlob } = useBrowserCapabilities();
  const { i18n, t } = useTranslation();
  const prefix = 'features.conversation';
  const [items, setItems] = useState<Conversation[]>([]);
  const [search, setSearch] = useState('');
  const [messageType, setMessageType] = useState('');
  const [platform, setPlatform] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(paginationDefaults.pageSize);
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
  const [umoDisplay, setUmoDisplay] = useState<'parsed' | 'raw'>('parsed');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await listConversations({
        query: {
          exclude_ids: 'astrbot',
          exclude_platforms: 'webchat',
          message_types: messageType || undefined,
          page,
          page_size: pageSize,
          platforms: platform.trim() || undefined,
          search: search.trim() || undefined,
        },
      });
      const data = decodeApiData(response, parseConversationList, 'conversation list');
      setItems(data?.conversations ?? []);
      setTotal(data?.pagination?.total ?? 0);
      setTotalPages(data?.pagination?.total_pages ?? 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t(`${prefix}.messages.fetchError`));
    } finally {
      setLoading(false);
    }
  }, [messageType, page, pageSize, platform, search, t]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 300);
    return () => window.clearTimeout(timer);
  }, [load]);

  const openDetail = async (item: Conversation) => {
    setLoading(true);
    try {
      const response = await getConversation({ path: { conversation_id: item.cid }, query: { user_id: item.user_id } });
      const data = decodeApiData(response, parseConversation, 'conversation');
      setDetail({ ...item, ...data });
      const nextHistory = parseConversationHistory(data.history);
      setHistory(nextHistory);
      setHistoryJson(JSON.stringify(nextHistory, null, 2));
      setEditingHistory(false);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t(`${prefix}.messages.historyError`));
    } finally {
      setLoading(false);
    }
  };
  const saveTitle = async () => {
    if (!editing) return;
    try {
      await updateConversation({
        body: { title: editing.title },
        path: { conversation_id: editing.cid },
        query: { user_id: editing.user_id },
      });
      toast.success(t(`${prefix}.messages.saveSuccess`));
      setEditing(null);
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t(`${prefix}.messages.saveError`));
    }
  };
  const remove = async (targets: Conversation[]) => {
    if (
      !(await confirmDestructiveAction({
        message: t(`${prefix}.dialogs.batchDelete.message`, { count: targets.length }),
        title: t(`${prefix}.dialogs.delete.title`),
      }))
    )
      return;
    try {
      if (targets.length === 1)
        await deleteConversation({ path: { conversation_id: targets[0].cid }, query: { user_id: targets[0].user_id } });
      else
        await batchDeleteConversations({
          body: { conversations: targets.map(({ cid, user_id }) => ({ cid, user_id })) },
        });
      setSelected(new Set());
      toast.success(t(`${prefix}.messages.deleteSuccess`));
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t(`${prefix}.messages.deleteError`));
    }
  };
  const selectedItems = useMemo(() => items.filter((item) => selected.has(conversationKey(item))), [items, selected]);
  const saveHistory = async () => {
    if (!detail) return;
    let parsed: Array<Record<string, unknown>>;
    try {
      const value: unknown = JSON.parse(historyJson);
      if (!Array.isArray(value) || !value.every(isRecord)) throw new Error(t(`${prefix}.messages.invalidJson`));
      parsed = value;
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t(`${prefix}.messages.invalidJson`));
      return;
    }
    setSavingHistory(true);
    try {
      await replaceConversationMessages({
        body: { history: parsed },
        path: { conversation_id: detail.cid },
        query: { user_id: detail.user_id },
      });
      setHistory(parsed);
      setEditingHistory(false);
      toast.success(t(`${prefix}.messages.historySaveSuccess`));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t(`${prefix}.messages.historySaveError`));
    } finally {
      setSavingHistory(false);
    }
  };
  const exportSelected = async () => {
    try {
      const blob = await conversationFilesApi.export(selectedItems.map(({ cid, user_id }) => ({ cid, user_id })));
      await downloadBlob(blob, `conversations-${new Date().toISOString().slice(0, 10)}.jsonl`);
      toast.success(t(`${prefix}.messages.exportSuccess`));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t(`${prefix}.messages.exportError`));
    }
  };
  const toggle = (item: Conversation) =>
    setSelected((current) => {
      const next = new Set(current);
      const key = conversationKey(item);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const allSelected = items.length > 0 && items.every((item) => selected.has(conversationKey(item)));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map(conversationKey)));
  const copyUmo = async (value: string) => {
    try {
      await copyText(value);
      toast.success(t(`${prefix}.messages.copySuccess`));
    } catch {
      toast.error(t(`${prefix}.messages.copyError`));
    }
  };
  const rangeStart = total ? (page - 1) * pageSize + 1 : 0;
  const rangeEnd = Math.min(page * pageSize, total);
  const columns: DataTableColumn<Conversation>[] = [
    {
      header: t(`${prefix}.table.headers.title`),
      id: 'title',
      render: (item) => (
        <div className="conversation-title-cell">
          <span>
            <strong>{item.title || t(`${prefix}.status.noTitle`)}</strong>
            <button onClick={() => setEditing({ ...item })} title={t(`${prefix}.actions.edit`)} type="button">
              <MdiIcon name="mdi-pencil-outline" />
            </button>
          </span>
          <small title={item.cid}>{item.cid}</small>
        </div>
      ),
    },
    {
      header: (
        <div className="conversation-umo-header">
          <span>{t(`${prefix}.table.headers.umo`)}</span>
          <div>
            <button aria-pressed={umoDisplay === 'parsed'} onClick={() => setUmoDisplay('parsed')} type="button">
              {t(`${prefix}.table.umoDisplay.parsed`)}
            </button>
            <button aria-pressed={umoDisplay === 'raw'} onClick={() => setUmoDisplay('raw')} type="button">
              {t(`${prefix}.table.umoDisplay.raw`)}
            </button>
          </div>
        </div>
      ),
      id: 'umo',
      render: (item) => {
        const umo = parseUmo(item.user_id);
        return (
          <div className="conversation-umo-cell">
            {umoDisplay === 'raw' ? (
              <code title={item.user_id}>{item.user_id}</code>
            ) : (
              <div>
                <span>{umo.platform || t(`${prefix}.status.unknown`)}</span>
                <span>
                  {umo.messageType === 'GroupMessage'
                    ? t(`${prefix}.messageTypes.group`)
                    : umo.messageType === 'FriendMessage'
                      ? t(`${prefix}.messageTypes.friend`)
                      : umo.messageType}
                </span>
                <code title={umo.sessionId}>{umo.sessionId}</code>
              </div>
            )}
            <button
              onClick={() => void copyUmo(item.user_id)}
              title={t(`${prefix}.messages.copySuccess`)}
              type="button"
            >
              <MdiIcon name="mdi-content-copy" />
            </button>
          </div>
        );
      },
    },
    {
      header: t(`${prefix}.table.headers.createdAt`),
      id: 'created',
      render: (item) => formatTimestamp(item.created_at, i18n.language),
    },
    {
      header: t(`${prefix}.table.headers.updatedAt`),
      id: 'updated',
      render: (item) => formatTimestamp(item.updated_at, i18n.language),
    },
    {
      header: t(`${prefix}.table.headers.actions`),
      id: 'actions',
      render: (item) => (
        <div className="conversation-row-actions">
          <button onClick={() => void openDetail(item)} title={t(`${prefix}.actions.view`)} type="button">
            <MdiIcon name="mdi-eye" />
          </button>
          <button
            className="button--danger"
            onClick={() => void remove([item])}
            title={t(`${prefix}.actions.delete`)}
            type="button"
          >
            <MdiIcon name="mdi-delete-outline" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="monitor-page data-page conversation-page-react">
      <section className="conversation-panel">
        <header className="conversation-panel__toolbar">
          <div className="conversation-panel__title">
            <h1>{t(`${prefix}.history.title`)}</h1>
            <span>{total}</span>
          </div>
          <div className="conversation-filters">
            <input
              onChange={(event) => {
                setPlatform(event.target.value);
                setPage(1);
              }}
              placeholder={t(`${prefix}.filters.platform`)}
              value={platform}
            />
            <select
              onChange={(event) => {
                setMessageType(event.target.value);
                setPage(1);
              }}
              value={messageType}
            >
              <option value="">{t(`${prefix}.filters.type`)}</option>
              <option value="GroupMessage">{t(`${prefix}.messageTypes.group`)}</option>
              <option value="FriendMessage">{t(`${prefix}.messageTypes.friend`)}</option>
            </select>
            <SearchField
              label={t(`${prefix}.filters.search`)}
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              placeholder={t(`${prefix}.filters.search`)}
              value={search}
            />
          </div>
          <div className="conversation-panel__actions">
            <button disabled={loading} onClick={() => void load()} type="button">
              <MdiIcon className={loading ? 'mdi-spin' : ''} name="mdi-refresh" />
              {t(`${prefix}.history.refresh`)}
            </button>
            {selectedItems.length > 0 && (
              <>
                <button onClick={() => void exportSelected()} type="button">
                  <MdiIcon name="mdi-download" />
                  {t(`${prefix}.batch.exportSelected`, { count: selectedItems.length })}
                </button>
                <button className="button--danger" onClick={() => void remove(selectedItems)} type="button">
                  <MdiIcon name="mdi-delete-outline" />
                  {t(`${prefix}.batch.deleteSelected`, { count: selectedItems.length })}
                </button>
              </>
            )}
          </div>
        </header>
        {error && (
          <div className="monitor-error" role="alert">
            {error}
          </div>
        )}
        <DataTable
          className="monitor-table-wrap"
          columns={columns}
          empty={{
            icon: <MdiIcon name="mdi-chat-remove" />,
            title: t(`${prefix}.status.noData`),
          }}
          getRowKey={conversationKey}
          loading={loading}
          loadingLabel={t('core.common.loading')}
          rows={items}
          selection={{
            allSelected,
            headerLabel: t(`${prefix}.table.headers.title`),
            isSelected: (item) => selected.has(conversationKey(item)),
            onToggle: toggle,
            onToggleAll: toggleAll,
            rowLabel: (item) => item.title || item.cid,
          }}
          tableClassName="monitor-table conversation-table"
        />
        <Pagination
          className="conversation-pagination"
          labels={{
            navigation: t('core.common.pagination'),
            next: t('core.common.nextPage'),
            pageSize: t(`${prefix}.pagination.itemsPerPage`),
            previous: t('core.common.previousPage'),
            range: t(`${prefix}.pagination.showingItems`, { start: rangeStart, end: rangeEnd, total }),
          }}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          page={page}
          pageSize={pageSize}
          totalItems={total}
          totalPages={totalPages}
        />
      </section>
      <Dialog
        onOpenChange={(open) => !open && setDetail(null)}
        open={Boolean(detail)}
        title={detail?.title || t(`${prefix}.status.noTitle`)}
      >
        <DialogActions>
          <Button onClick={() => setEditingHistory((value) => !value)}>
            {t(`${prefix}.dialogs.view.${editingHistory ? 'previewMode' : 'editMode'}`)}
          </Button>
          {editingHistory && (
            <Button disabled={savingHistory} onClick={() => void saveHistory()} variant="primary">
              {t(`${prefix}.dialogs.view.saveChanges`)}
            </Button>
          )}
        </DialogActions>
        {editingHistory ? (
          <div className="json-editor">
            <MonacoEditor language="json" onChange={setHistoryJson} value={historyJson} />
          </div>
        ) : history.length ? (
          <div className="conversation-history">
            {history.map((message, index) => {
              const role = String(message.role ?? 'message');
              return (
                <article className={`conversation-history__message conversation-history__message--${role}`} key={index}>
                  <strong>{role}</strong>
                  <pre>
                    {typeof message.content === 'string' ? message.content : JSON.stringify(message.content, null, 2)}
                  </pre>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="monitor-empty">{t(`${prefix}.status.emptyContent`)}</div>
        )}
        <DialogClose asChild>
          <button type="button">{t(`${prefix}.dialogs.view.close`)}</button>
        </DialogClose>
      </Dialog>
      <Dialog
        onOpenChange={(open) => !open && setEditing(null)}
        open={Boolean(editing)}
        title={t(`${prefix}.dialogs.edit.title`)}
      >
        <div className="dialog-form">
          <label>
            {t(`${prefix}.dialogs.edit.titleLabel`)}
            <input
              onChange={(event) =>
                setEditing((current) => (current ? { ...current, title: event.target.value } : null))
              }
              value={editing?.title ?? ''}
            />
          </label>
          <DialogActions>
            <DialogCancel>{t(`${prefix}.dialogs.edit.cancel`)}</DialogCancel>
            <Button onClick={() => void saveTitle()} variant="primary">
              {t(`${prefix}.dialogs.edit.save`)}
            </Button>
          </DialogActions>
        </div>
      </Dialog>
    </div>
  );
}
