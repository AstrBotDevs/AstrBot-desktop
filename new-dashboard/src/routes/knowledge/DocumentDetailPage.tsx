import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { deleteKnowledgeChunk, getKnowledgeDocument, listKnowledgeChunks } from '@/api/openapi';
import {
  type KnowledgeChunkDto,
  type KnowledgeDocumentDto,
  parseKnowledgeChunkPage,
  parseKnowledgeDocument,
} from '@/api/domain';
import { decodeApiData } from '@/api/response';
import { paginationDefaults } from '@/config/defaults';
import { Dialog } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { DialogCancel } from '@/components/ui/Button';
import { DialogActions } from '@/components/ui/DialogActions';
import { confirmAction, toast } from '@/stores/feedback';
import { errorMessage, recordId } from '@/routes/configuration/model';
import { chunkCount, documentName, formatFileSize, formatKnowledgeDate } from './knowledgeModel';

export default function DocumentDetailPage() {
  const { kbId = '', docId = '' } = useParams();
  const { t, i18n } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) => t(`features.knowledge-base.document.${key}`, options);
  const [document, setDocument] = useState<KnowledgeDocumentDto>({});
  const [chunks, setChunks] = useState<KnowledgeChunkDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(paginationDefaults.compactPageSize);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<KnowledgeChunkDto | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [docResponse, chunksResponse] = await Promise.all([
        getKnowledgeDocument({ path: { kb_id: kbId, document_id: docId } }),
        listKnowledgeChunks({ path: { kb_id: kbId }, query: { document_id: docId, page, page_size: pageSize } }),
      ]);
      const data = decodeApiData(chunksResponse, parseKnowledgeChunkPage, 'knowledge chunk list');
      setDocument(decodeApiData(docResponse, parseKnowledgeDocument, 'knowledge document'));
      setChunks(data.items);
      setTotal(data.total);
    } catch (cause) {
      setError(errorMessage(cause, k('title')));
    } finally {
      setLoading(false);
    }
  }, [docId, kbId, page, pageSize, t]);
  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (chunk: KnowledgeChunkDto) => {
    const id = recordId(chunk, 'chunk_id', 'id');
    if (
      !id ||
      !(await confirmAction({
        danger: true,
        title: k('delete.title'),
        message: `${k('delete.confirmText')}\n${k('delete.warning')}`,
      }))
    )
      return;
    try {
      await deleteKnowledgeChunk({ path: { kb_id: kbId, chunk_id: id }, query: { document_id: docId } });
      toast.success(k('delete.deleteSuccess'));
      await load();
    } catch (cause) {
      toast.error(errorMessage(cause, k('delete.deleteFailed')));
    }
  };
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query
      ? chunks.filter((chunk) =>
          String(chunk.content || chunk.text || '')
            .toLocaleLowerCase()
            .includes(query),
        )
      : chunks;
  }, [chunks, search]);
  const name = documentName(document) || docId;

  return (
    <div className="knowledge-document-page">
      <header className="knowledge-detail-header">
        <Link aria-label={k('backToKB')} to={`/knowledge-base/${encodeURIComponent(kbId)}`}>
          <MdiIcon name="mdi-arrow-left" />
        </Link>
        <span className="knowledge-document-icon">
          <MdiIcon name={fileIcon(String(document.file_type || name))} />
        </span>
        <div>
          <h1>{name}</h1>
          <p>{k('title')}</p>
        </div>
        <button disabled={loading} onClick={() => void load()} type="button">
          <MdiIcon className={loading ? 'mdi-spin' : ''} name="mdi-refresh" />
        </button>
      </header>
      {error && (
        <div className="monitor-error" role="alert">
          {error}
        </div>
      )}
      <section className="knowledge-document-info">
        <h2>{k('info.title')}</h2>
        <div>
          <Info icon="mdi-label" label={k('info.name')} value={name || k('info.notSet')} />
          <Info
            icon={fileIcon(String(document.file_type || name))}
            label={k('info.type')}
            value={String(document.file_type || k('info.unknownType'))}
          />
          <Info
            icon="mdi-file-chart"
            label={k('info.size')}
            value={formatFileSize(document.file_size ?? document.size, k('info.notSet'))}
          />
          <Info
            icon="mdi-text-box-outline"
            label={k('info.chunkCount')}
            value={String(chunkCount(document) || total)}
          />
          <Info
            icon="mdi-calendar"
            label={k('info.createdAt')}
            value={formatKnowledgeDate(document.created_at, i18n.language, k('info.notSet'))}
          />
        </div>
      </section>
      <section className="knowledge-chunks">
        <header>
          <div>
            <h2>{k('chunks.title')}</h2>
            <span>{total}</span>
          </div>
          <label>
            <MdiIcon name="mdi-magnify" />
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder={k('chunks.searchPlaceholder')}
              value={search}
            />
          </label>
        </header>
        <div className="knowledge-table">
          <table>
            <thead>
              <tr>
                <th>{k('chunks.index')}</th>
                <th>{k('chunks.content')}</th>
                <th>{k('chunks.charCount')}</th>
                <th>{k('chunks.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((chunk, index) => {
                const id = recordId(chunk, 'chunk_id', 'id') || `chunk-${index}`;
                const content = String(chunk.content || chunk.text || '');
                return (
                  <tr key={id}>
                    <td>
                      <span className="knowledge-chunk-index">
                        #{Number(chunk.chunk_index ?? (page - 1) * pageSize + index) + 1}
                      </span>
                    </td>
                    <td>
                      <p className="knowledge-chunk-preview">{content}</p>
                    </td>
                    <td>{String(chunk.char_count ?? content.length)}</td>
                    <td>
                      <div className="knowledge-row-actions">
                        <button
                          aria-label={k('chunks.view')}
                          onClick={() => setSelected(chunk)}
                          title={k('chunks.view')}
                          type="button"
                        >
                          <MdiIcon name="mdi-eye" />
                        </button>
                        <button
                          aria-label={k('chunks.delete')}
                          className="button--danger"
                          onClick={() => void remove(chunk)}
                          title={k('chunks.delete')}
                          type="button"
                        >
                          <MdiIcon name="mdi-delete-outline" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {loading && (
            <div className="knowledge-table__state">
              <MdiIcon className="mdi-spin" name="mdi-loading" />
            </div>
          )}
          {!loading && !visible.length && (
            <div className="knowledge-table__state">
              <MdiIcon name="mdi-text-box-outline" />
              <span>{k('chunks.empty')}</span>
            </div>
          )}
        </div>
        {!search && total > 0 && (
          <div className="knowledge-pagination">
            <span>
              {k('chunks.showing')} {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} / {total}
            </span>
            <div>
              <select
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
                value={pageSize}
              >
                {[10, 25, 50, 100].map((size) => (
                  <option key={size}>{size}</option>
                ))}
              </select>
              <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} type="button">
                ‹
              </button>
              <span>
                {page}/{Math.max(1, Math.ceil(total / pageSize))}
              </span>
              <button disabled={page * pageSize >= total} onClick={() => setPage((value) => value + 1)} type="button">
                ›
              </button>
            </div>
          </div>
        )}
      </section>
      <Dialog onOpenChange={(open) => !open && setSelected(null)} open={Boolean(selected)} title={k('view.title')}>
        <div className="knowledge-chunk-dialog">
          <dl>
            <div>
              <dt>{k('view.index')}</dt>
              <dd>#{Number(selected?.chunk_index ?? 0) + 1}</dd>
            </div>
            <div>
              <dt>{k('view.charCount')}</dt>
              <dd>{String(selected?.char_count ?? String(selected?.content || '').length)}</dd>
            </div>
            <div>
              <dt>{k('view.vecDocId')}</dt>
              <dd>{recordId(selected ?? {}, 'chunk_id', 'id') || k('info.notSet')}</dd>
            </div>
          </dl>
          <h3>{k('view.content')}</h3>
          <pre>{String(selected?.content || selected?.text || '')}</pre>
          <DialogActions>
            <DialogCancel>{k('view.close')}</DialogCancel>
          </DialogActions>
        </div>
      </Dialog>
    </div>
  );
}

function Info({ icon, label, value }: { icon: `mdi-${string}`; label: string; value: string }) {
  return (
    <article>
      <MdiIcon name={icon} />
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
    </article>
  );
}

function fileIcon(file: string): `mdi-${string}` {
  const type = file.toLowerCase();
  if (type.includes('pdf')) return 'mdi-file-pdf-box';
  if (type.includes('epub')) return 'mdi-book-open-page-variant';
  if (type.includes('.md') || type.includes('markdown')) return 'mdi-language-markdown-outline';
  if (type.includes('xls')) return 'mdi-file-excel-box';
  return 'mdi-file-document-outline';
}
