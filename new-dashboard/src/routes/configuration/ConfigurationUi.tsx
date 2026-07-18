import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RecordConfigForm } from '@/components/config/DynamicConfigForm';
import { MonacoEditor } from '@/components/editor/MonacoEditor';
import { Dialog } from '@/components/headless/Dialog';
import { Button, DialogCancel } from '@/components/ui/Button';
import { DialogActions } from '@/components/ui/DialogActions';
import { isObject, prettyJson } from './model';

export function ConfigPageShell({ actions, children, description, title }: { actions?: ReactNode; children: ReactNode; description: string; title: string }) {
  return <div className="monitor-page config-page"><header className="monitor-header"><div><h1>{title}</h1><p>{description}</p></div><div className="monitor-actions">{actions}</div></header>{children}</div>;
}

export function JsonConfigDialog({ busy, initialMode = 'form', jsonOnly = false, onChange, onOpenChange, onSave, open, title, value }: { busy?: boolean; initialMode?: 'form' | 'json'; jsonOnly?: boolean; onChange: (value: string) => void; onOpenChange: (open: boolean) => void; onSave: () => void; open: boolean; title: string; value: string }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'form' | 'json'>(initialMode);
  const config = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(value);
      return isObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }, [value]);
  return <Dialog onOpenChange={onOpenChange} open={open} title={title}>
    {!jsonOnly && <nav className="config-tabs config-tabs--dialog"><button aria-pressed={mode === 'form'} onClick={() => setMode('form')} type="button">{t('features.config.editor.visual')}</button><button aria-pressed={mode === 'json'} onClick={() => setMode('json')} type="button">JSON</button></nav>}
    {!jsonOnly && mode === 'form' && config && <div className="dynamic-config-dialog"><RecordConfigForm onChange={(next) => onChange(prettyJson(next))} value={config} /></div>}
    {!jsonOnly && mode === 'form' && !config && <div className="monitor-error">{t('features.config.messages.invalidJson')}</div>}
    {(jsonOnly || mode === 'json') && <div className="json-editor json-editor--dialog"><MonacoEditor ariaLabel={`${title} JSON`} language="json" onChange={onChange} value={value} /></div>}
    <DialogActions><DialogCancel>{t('core.common.cancel')}</DialogCancel><Button disabled={busy} onClick={onSave} variant="primary">{busy ? t('core.common.saving') : t('core.common.save')}</Button></DialogActions>
  </Dialog>;
}

export function LoadingState({ error, loading }: { error: string; loading: boolean }) {
  const { t } = useTranslation();
  if (loading) return <div className="monitor-loading" role="status">{t('core.common.loading')}</div>;
  if (error) return <div className="monitor-error" role="alert">{error}</div>;
  return null;
}
