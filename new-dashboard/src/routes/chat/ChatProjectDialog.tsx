import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog } from '@/components/headless/Dialog';
import { Button } from '@/components/ui/Button';
import { DialogActions } from '@/components/ui/DialogActions';

export type ChatProjectForm = {
  description: string;
  emoji: string;
  title: string;
  workspace_path: string;
  workspace_type: 'custom' | 'project' | 'session';
};

const emptyProjectForm = (): ChatProjectForm => ({
  description: '',
  emoji: '📁',
  title: '',
  workspace_path: '',
  workspace_type: 'project',
});

export function ChatProjectDialog({ error, onOpenChange, onSave, open, project, saving }: {
  error?: string;
  onOpenChange: (open: boolean) => void;
  onSave: (value: ChatProjectForm) => void;
  open: boolean;
  project?: ChatProjectForm | null;
  saving?: boolean;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<ChatProjectForm>(emptyProjectForm);
  const canSave = useMemo(() => Boolean(
    form.title.trim()
    && (form.workspace_type !== 'custom' || form.workspace_path.trim()),
  ), [form]);

  useEffect(() => {
    if (open) setForm(project ? { ...project } : emptyProjectForm());
  }, [open, project]);

  const set = <Key extends keyof ChatProjectForm>(key: Key, value: ChatProjectForm[Key]) => {
    setForm((current) => ({
      ...current,
      [key]: value,
      ...(key === 'workspace_type' && value !== 'custom' ? { workspace_path: '' } : {}),
    }));
  };
  const save = () => {
    if (!canSave || saving) return;
    onSave({
      ...form,
      description: form.description.trim(),
      title: form.title.trim(),
      workspace_path: form.workspace_path.trim(),
    });
  };

  return <Dialog onOpenChange={(next) => { if (!saving) onOpenChange(next); }} open={open} title={t(`features.chat.project.${project ? 'edit' : 'create'}`)}>
    <form className="chat-project-dialog" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <label className="chat-project-field">
        <span>{t('features.chat.project.emoji')}</span>
        <input aria-label={t('features.chat.project.emoji')} maxLength={16} onChange={(event) => set('emoji', event.target.value)} value={form.emoji} />
      </label>
      <label className="chat-project-field">
        <span>{t('features.chat.project.name')}</span>
        <input aria-label={t('features.chat.project.name')} autoFocus onChange={(event) => set('title', event.target.value)} value={form.title} />
      </label>
      <label className="chat-project-field chat-project-field--textarea">
        <span>{t('features.chat.project.description')}</span>
        <textarea aria-label={t('features.chat.project.description')} onChange={(event) => set('description', event.target.value)} rows={3} value={form.description} />
      </label>
      <div className="chat-project-dialog__divider" />
      <label className="chat-project-field">
        <span>{t('features.chat.project.workspace.type')}</span>
        <select aria-label={t('features.chat.project.workspace.type')} onChange={(event) => set('workspace_type', event.target.value as ChatProjectForm['workspace_type'])} value={form.workspace_type}>
          <option value="project">{t('features.chat.project.workspace.project')}</option>
          <option value="session">{t('features.chat.project.workspace.session')}</option>
          <option value="custom">{t('features.chat.project.workspace.custom')}</option>
        </select>
      </label>
      {form.workspace_type === 'custom' && <label className="chat-project-field">
        <span>{t('features.chat.project.workspace.path')}</span>
        <input aria-label={t('features.chat.project.workspace.path')} onChange={(event) => set('workspace_path', event.target.value)} value={form.workspace_path} />
      </label>}
      {error && <div className="chat-project-dialog__error" role="alert">{error}</div>}
      <DialogActions>
        <Button disabled={saving} onClick={() => onOpenChange(false)}>{t('core.common.cancel')}</Button>
        <Button disabled={!canSave || saving} type="submit" variant="primary">{t('core.common.save')}</Button>
      </DialogActions>
    </form>
  </Dialog>;
}
