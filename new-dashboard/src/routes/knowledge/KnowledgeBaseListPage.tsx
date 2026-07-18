import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  listKnowledgeBases,
  listProviders,
  updateKnowledgeBase,
} from '@/api/openapi';
import { type KnowledgeBaseDto, type ProviderDto, parseKnowledgeBasePage, parseProviders } from '@/api/domain';
import { decodeApiData } from '@/api/response';
import { Dialog, DialogClose } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { AsyncState } from '@/components/ui/AsyncState';
import { Button, DialogCancel } from '@/components/ui/Button';
import { DialogActions } from '@/components/ui/DialogActions';
import { IconButton } from '@/components/ui/IconButton';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { confirmDestructiveAction } from '@/components/ui/confirm';
import { toast } from '@/stores/feedback';
import { errorMessage } from '@/routes/configuration/model';
import { knowledgeBaseId, chunkCount, documentCount } from './knowledgeModel';

type Form = {
  kb_name: string;
  description: string;
  emoji: string;
  embedding_provider_id: string;
  rerank_provider_id: string;
};
const emptyForm: Form = {
  kb_name: '',
  description: '',
  emoji: '📚',
  embedding_provider_id: '',
  rerank_provider_id: '',
};
const emojiGroups = [
  ['books', ['📚', '📖', '📕', '📗', '📘', '📙', '📓', '📑', '🗂️', '📂', '🗃️']],
  ['emotions', ['😀', '😃', '😄', '😁', '😊', '🥰', '😍', '🤓', '🧐']],
  ['objects', ['💡', '🔬', '🔭', '🏆', '🎯', '🎓', '🔑', '🔒', '🛠️', '⚙️']],
  ['symbols', ['❤️', '🧡', '💛', '💚', '💙', '💜', '⭐', '✨', '⚡', '🔥']],
] as const;

type ProviderSelectProps = {
  disabled?: boolean;
  emptyLabel?: string;
  onChange: (value: string) => void;
  placeholder: string;
  providers: ProviderDto[];
  subtitle: (provider: ProviderDto) => string;
  title: (provider: ProviderDto) => string;
  value: string;
};

function ProviderSelect({
  disabled,
  emptyLabel,
  onChange,
  placeholder,
  providers,
  subtitle,
  title,
  value,
}: ProviderSelectProps) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = providers.find((provider) => String(provider.id) === value);

  useEffect(() => {
    if (!open) return undefined;
    const positionMenu = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuStyle({ left: rect.left, top: rect.bottom + 4, width: rect.width });
    };
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    positionMenu();
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => {
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
      document.removeEventListener('mousedown', closeOnOutsideClick);
    };
  }, [open]);

  const choose = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
  };

  return (
    <>
      <button
        aria-expanded={open}
        className={`knowledge-provider-select__trigger${open ? ' is-open' : ''}`}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <span>
          <strong>{selected ? title(selected) : value === '' && emptyLabel ? emptyLabel : placeholder}</strong>
          {selected && <small>{subtitle(selected)}</small>}
        </span>
        <MdiIcon name="mdi-chevron-down" />
      </button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="knowledge-provider-select__menu" ref={menuRef} role="listbox" style={menuStyle}>
            {emptyLabel && (
              <button
                aria-selected={!value}
                className={!value ? 'is-selected' : ''}
                onClick={() => choose('')}
                role="option"
                type="button"
              >
                <strong>{emptyLabel}</strong>
              </button>
            )}
            {providers.map((provider) => {
              const providerId = String(provider.id);
              return (
                <button
                  aria-selected={providerId === value}
                  className={providerId === value ? 'is-selected' : ''}
                  key={providerId}
                  onClick={() => choose(providerId)}
                  role="option"
                  type="button"
                >
                  <strong>{title(provider)}</strong>
                  <small>{subtitle(provider)}</small>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

export default function KnowledgeBaseListPage() {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) => t(`features.knowledge-base.index.${key}`, options);
  const [items, setItems] = useState<KnowledgeBaseDto[]>([]);
  const [providers, setProviders] = useState<ProviderDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [editing, setEditing] = useState<KnowledgeBaseDto | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError('');
      try {
        const data = decodeApiData(
          await listKnowledgeBases({ query: { page, page_size: 20, refresh_stats: refresh } }),
          parseKnowledgeBasePage,
          'knowledge base list',
        );
        setItems(data.items);
        setTotal(data.total);
      } catch (cause) {
        setError(errorMessage(cause, k('messages.loadError')));
      } finally {
        setLoading(false);
      }
    },
    [page, t],
  );

  useEffect(() => {
    void load(true);
  }, [load]);
  useEffect(() => {
    void Promise.all([
      listProviders({ query: { capability: 'embedding', enabled: true } }),
      listProviders({ query: { capability: 'rerank', enabled: true } }),
    ])
      .then((responses) =>
        setProviders(responses.flatMap((response) => decodeApiData(response, parseProviders, 'provider list'))),
      )
      .catch(() => setProviders([]));
  }, []);

  const embeddingProviders = useMemo(
    () => providers.filter((item) => String(item.provider_type || item.capability).includes('embedding')),
    [providers],
  );
  const rerankProviders = useMemo(
    () => providers.filter((item) => String(item.provider_type || item.capability).includes('rerank')),
    [providers],
  );
  const open = (item?: KnowledgeBaseDto) => {
    setEditing(item ?? {});
    setForm(
      item
        ? {
            kb_name: String(item.kb_name || ''),
            description: String(item.description || ''),
            emoji: String(item.emoji || '📚'),
            embedding_provider_id: String(item.embedding_provider_id || ''),
            rerank_provider_id: String(item.rerank_provider_id || ''),
          }
        : emptyForm,
    );
  };
  const close = () => {
    setEditing(null);
    setForm(emptyForm);
  };
  const save = async () => {
    const id = knowledgeBaseId(editing ?? {});
    if (!form.kb_name.trim()) {
      toast.warning(k('create.nameRequired'));
      return;
    }
    if (!id && !form.embedding_provider_id) {
      toast.warning(k('create.embeddingModelLabel'));
      return;
    }
    setSaving(true);
    try {
      const body = {
        ...form,
        kb_name: form.kb_name.trim(),
        embedding_provider_id: form.embedding_provider_id || null,
        rerank_provider_id: form.rerank_provider_id || null,
      };
      if (id) await updateKnowledgeBase({ path: { kb_id: id }, body });
      else await createKnowledgeBase({ body: { ...body, embedding_provider_id: form.embedding_provider_id } });
      toast.success(k(id ? 'messages.updateSuccess' : 'messages.createSuccess'));
      close();
      await load(true);
    } catch (cause) {
      toast.error(errorMessage(cause, k(id ? 'messages.updateFailed' : 'messages.createFailed')));
    } finally {
      setSaving(false);
    }
  };
  const remove = async (item: KnowledgeBaseDto) => {
    const id = knowledgeBaseId(item);
    const name = String(item.kb_name || id);
    if (
      !id ||
      !(await confirmDestructiveAction({
        title: k('delete.title'),
        message: `${k('delete.confirmText', { name })}\n${k('delete.warning')}`,
      }))
    )
      return;
    try {
      await deleteKnowledgeBase({ path: { kb_id: id } });
      toast.success(k('messages.deleteSuccess'));
      if (items.length === 1 && page > 1) setPage((value) => value - 1);
      else await load(true);
    } catch (cause) {
      toast.error(errorMessage(cause, k('messages.deleteFailed')));
    }
  };

  return (
    <div className="knowledge-list-page">
      <PageHeader
        actions={
          <a
            aria-label={t('core.navigation.documentation')}
            className="knowledge-page-header__docs"
            href={externalLinks.docs.knowledgeBase}
            rel="noreferrer"
            target="_blank"
            title={t('core.navigation.documentation')}
          >
            <MdiIcon name="mdi-information-outline" />
          </a>
        }
        className="knowledge-page-header"
        description={k('subtitle')}
        title={k('title')}
      />
      {error && (
        <div className="monitor-error" role="alert">
          {error}
        </div>
      )}
      <AsyncState
        className={items.length === 0 ? 'knowledge-empty' : ''}
        empty={
          !loading && items.length === 0
            ? {
                action: (
                  <Button icon={<MdiIcon name="mdi-plus" />} onClick={() => open()} variant="primary">
                    {k('list.create')}
                  </Button>
                ),
                icon: <MdiIcon name="mdi-book-open-page-variant" />,
                title: k('list.empty'),
              }
            : undefined
        }
        loading={loading && items.length === 0}
        loadingLabel={k('list.loading')}
      >
        <section className="knowledge-list">
          {items.map((item) => {
            const id = knowledgeBaseId(item);
            const initError = String(item.init_error || '');
            return (
              <article className={`knowledge-list-item${initError ? ' is-error' : ''}`} key={id}>
                <Link
                  aria-disabled={Boolean(initError)}
                  className="knowledge-list-item__main"
                  onClick={(event) => initError && event.preventDefault()}
                  to={`/knowledge-base/${encodeURIComponent(id)}`}
                >
                  <span className="knowledge-list-item__emoji">{String(item.emoji || '📚')}</span>
                  <div>
                    <header>
                      <h2>{String(item.kb_name || id)}</h2>
                      {initError && <span>{k('list.initError')}</span>}
                    </header>
                    {initError ? (
                      <div className="knowledge-list-item__error-panel">
                        <strong>
                          <MdiIcon name="mdi-close-circle" />
                          {k('list.initError')}
                        </strong>
                        <p title={initError}>{initError}</p>
                      </div>
                    ) : (
                      <>
                        <p>{String(item.description || k('list.noDescription'))}</p>
                        <div className="knowledge-list-item__stats">
                          <span>
                            <MdiIcon name="mdi-file-document-outline" />
                            {documentCount(item)} {k('list.documents')}
                          </span>
                          <span>
                            <MdiIcon name="mdi-text-box-outline" />
                            {chunkCount(item)} {k('list.chunks')}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </Link>
                <div className="knowledge-list-item__actions">
                  {!initError && (
                    <IconButton
                      icon={<MdiIcon name="mdi-pencil-outline" />}
                      label={k('card.edit')}
                      onClick={() => open(item)}
                      variant="text"
                    />
                  )}
                  <IconButton
                    icon={<MdiIcon name="mdi-delete-outline" />}
                    label={k('card.delete')}
                    onClick={() => void remove(item)}
                    variant="danger"
                  />
                </div>
              </article>
            );
          })}
        </section>
      </AsyncState>
      {total > 20 && (
        <Pagination
          className="pagination"
          labels={{
            navigation: t('core.common.pagination'),
            next: t('core.common.nextPage'),
            previous: t('core.common.previousPage'),
          }}
          onPageChange={setPage}
          page={page}
          pageSize={20}
          totalItems={total}
        />
      )}
      {typeof document !== 'undefined' &&
        createPortal(
          <div className="knowledge-fab-stack">
            <button
              aria-label={k('list.refresh')}
              className="knowledge-fab"
              disabled={loading}
              onClick={() => void load()}
              title={k('list.refresh')}
              type="button"
            >
              <MdiIcon className={loading ? 'mdi-spin' : ''} name="mdi-refresh" />
            </button>
            <button
              aria-label={k('list.create')}
              className="knowledge-fab"
              onClick={() => open()}
              title={k('list.create')}
              type="button"
            >
              <MdiIcon name="mdi-plus" />
            </button>
          </div>,
          document.body,
        )}
      <Dialog
        onOpenChange={(openValue) => !openValue && close()}
        open={editing !== null}
        title={knowledgeBaseId(editing ?? {}) ? k('edit.title') : k('create.title')}
      >
        <DialogClose asChild>
          <button aria-label={t('core.common.close')} className="knowledge-form__close" type="button">
            <MdiIcon name="mdi-close" />
          </button>
        </DialogClose>
        <div className="knowledge-form">
          <div className="knowledge-form__emoji">
            <button
              className="knowledge-emoji-button"
              onClick={() => setEmojiOpen(true)}
              title={k('create.emojiLabel')}
              type="button"
            >
              {form.emoji}
            </button>
            <small>{k('create.emojiLabel')}</small>
          </div>
          <label>
            {k('create.nameLabel')}
            <input
              autoFocus
              onChange={(event) => setForm({ ...form, kb_name: event.target.value })}
              placeholder={k('create.namePlaceholder')}
              value={form.kb_name}
            />
            <small>{k('create.nameHint')}</small>
          </label>
          <label>
            {k('create.descriptionLabel')}
            <textarea
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder={k('create.descriptionPlaceholder')}
              rows={3}
              value={form.description}
            />
          </label>
          <label>
            {k('create.embeddingModelLabel')}
            <ProviderSelect
              disabled={Boolean(knowledgeBaseId(editing ?? {}))}
              onChange={(embedding_provider_id) => setForm({ ...form, embedding_provider_id })}
              placeholder={k('create.embeddingModelPlaceholder')}
              providers={embeddingProviders}
              subtitle={(provider) =>
                k('create.providerInfo', {
                  id: String(provider.id),
                  dimensions: provider.embedding_dimensions || 'N/A',
                })
              }
              title={(provider) => String(provider.embedding_model || provider.model || provider.id)}
              value={form.embedding_provider_id}
            />
            <small>{k('create.embeddingModelHint')}</small>
          </label>
          <label>
            {k('create.rerankModelLabel')}
            <ProviderSelect
              emptyLabel={k('create.noRerankModel')}
              onChange={(rerank_provider_id) => setForm({ ...form, rerank_provider_id })}
              placeholder={k('create.noRerankModel')}
              providers={rerankProviders}
              subtitle={(provider) => k('create.rerankProviderInfo', { id: String(provider.id) })}
              title={(provider) => String(provider.rerank_model || provider.model || provider.id)}
              value={form.rerank_provider_id}
            />
          </label>
          <DialogActions>
            <DialogCancel>{k('create.cancel')}</DialogCancel>
            <Button disabled={saving} onClick={() => void save()} variant="primary">
              {saving ? k('create.saving') : k(knowledgeBaseId(editing ?? {}) ? 'edit.submit' : 'create.submit')}
            </Button>
          </DialogActions>
        </div>
      </Dialog>
      <Dialog onOpenChange={setEmojiOpen} open={emojiOpen} title={k('emoji.title')}>
        <div className="knowledge-emoji-picker">
          {emojiGroups.map(([group, emojis]) => (
            <section key={group}>
              <h3>{k(`emoji.categories.${group}`)}</h3>
              <div>
                {emojis.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => {
                      setForm({ ...form, emoji });
                      setEmojiOpen(false);
                    }}
                    type="button"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
        <DialogActions>
          <DialogCancel>{k('emoji.close')}</DialogCancel>
        </DialogActions>
      </Dialog>
    </div>
  );
}
import { externalLinks } from '@/config/links';
