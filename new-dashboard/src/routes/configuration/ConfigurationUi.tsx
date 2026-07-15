import { type ReactNode, useMemo, useState } from 'react';
import { RecordConfigForm } from '@/components/config/DynamicConfigForm';
import { MonacoEditor } from '@/components/editor/MonacoEditor';
import { Dialog, DialogClose } from '@/components/headless/Dialog';
import { isObject, prettyJson } from './model';

export function ConfigPageShell({ actions, children, description, title }: { actions?: ReactNode; children: ReactNode; description: string; title: string }) {
  return <div className="monitor-page config-page"><header className="monitor-header"><div><h1>{title}</h1><p>{description}</p></div><div className="monitor-actions">{actions}</div></header>{children}</div>;
}

export function JsonConfigDialog({ busy, initialMode = 'form', onChange, onOpenChange, onSave, open, title, value }: { busy?: boolean; initialMode?: 'form' | 'json'; onChange: (value: string) => void; onOpenChange: (open: boolean) => void; onSave: () => void; open: boolean; title: string; value: string }) {
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
    <nav className="config-tabs config-tabs--dialog"><button aria-pressed={mode === 'form'} onClick={() => setMode('form')} type="button">Form</button><button aria-pressed={mode === 'json'} onClick={() => setMode('json')} type="button">JSON</button></nav>
    {mode === 'form' && config && <div className="dynamic-config-dialog"><RecordConfigForm onChange={(next) => onChange(prettyJson(next))} value={config} /></div>}
    {mode === 'form' && !config && <div className="monitor-error">JSON is invalid. Switch to the JSON editor to correct it.</div>}
    {mode === 'json' && <div className="json-editor json-editor--dialog"><MonacoEditor ariaLabel={`${title} JSON`} language="json" onChange={onChange} value={value} /></div>}
    <div className="dialog-actions"><DialogClose asChild><button type="button">Cancel</button></DialogClose><button className="button--primary" disabled={busy} onClick={onSave} type="button">{busy ? 'Saving…' : 'Save'}</button></div>
  </Dialog>;
}

export function LoadingState({ error, loading }: { error: string; loading: boolean }) {
  if (loading) return <div className="monitor-loading" role="status">Loading…</div>;
  if (error) return <div className="monitor-error" role="alert">{error}</div>;
  return null;
}
