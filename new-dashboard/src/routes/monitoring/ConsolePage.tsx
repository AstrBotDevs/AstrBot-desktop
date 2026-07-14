import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { installPipPackage } from '@/api/openapi';
import { Dialog, DialogClose } from '@/components/headless/Dialog';
import { toast } from '@/stores/feedback';
import { useLogFeed } from './useLogFeed';

const levels = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];
const levelClass = (level = '') => `monitor-log monitor-log--${level.toLowerCase()}`;

export default function ConsolePage() {
  const { t } = useTranslation();
  const filter = useCallback(() => true, []);
  const { items, status } = useLogFeed(filter, 500);
  const [selected, setSelected] = useState(() => new Set(levels));
  const [autoScroll, setAutoScroll] = useState(() => localStorage.getItem('console_auto_scroll') !== 'false');
  const [pipOpen, setPipOpen] = useState(false);
  const [pipPackage, setPipPackage] = useState('');
  const [mirror, setMirror] = useState('');
  const [installing, setInstalling] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => items.filter((item) => selected.has(item.level ?? 'INFO')), [items, selected]);

  useEffect(() => {
    localStorage.setItem('console_auto_scroll', String(autoScroll));
  }, [autoScroll]);
  useEffect(() => {
    if (autoScroll && terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [autoScroll, visible]);

  const toggleLevel = (level: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(level)) next.delete(level); else next.add(level);
    return next;
  });
  const install = async () => {
    if (!pipPackage.trim()) return;
    setInstalling(true);
    try {
      await installPipPackage({ body: { package: pipPackage.trim(), mirror: mirror.trim() || undefined } });
      toast.success(t('features/console.pipInstall.installSuccess'));
      setPipOpen(false);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('features/console.pipInstall.installFailed'));
    } finally { setInstalling(false); }
  };

  return (
    <div className="monitor-page console-page">
      <header className="monitor-header"><div><h1>{t('features/console.title')}</h1><p>{t('features/console.debugHint.text')}</p></div><div className="monitor-actions">
        <span className={`stream-status stream-status--${status}`}>{status}</span>
        <label><input checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} type="checkbox" /> {t(`features/console.autoScroll.${autoScroll ? 'enabled' : 'disabled'}`)}</label>
        <button onClick={() => setPipOpen(true)} type="button">{t('features/console.pipInstall.button')}</button>
      </div></header>
      <div className="monitor-filters">{levels.map((level) => <button aria-pressed={selected.has(level)} key={level} onClick={() => toggleLevel(level)} type="button">{level}</button>)}</div>
      <div className="monitor-terminal" ref={terminalRef}>{visible.map((item) => <pre className={levelClass(item.level)} key={`${item.time}-${item.data}`}>{item.data ?? JSON.stringify(item)}</pre>)}</div>
      <Dialog onOpenChange={setPipOpen} open={pipOpen} title={t('features/console.pipInstall.dialogTitle')}>
        <div className="dialog-form"><label>{t('features/console.pipInstall.packageLabel')}<input onChange={(event) => setPipPackage(event.target.value)} value={pipPackage} /></label><label>{t('features/console.pipInstall.mirrorLabel')}<input onChange={(event) => setMirror(event.target.value)} value={mirror} /></label><small>{t('features/console.pipInstall.mirrorHint')}</small><div className="dialog-actions"><DialogClose asChild><button type="button">×</button></DialogClose><button className="button--primary" disabled={installing || !pipPackage.trim()} onClick={() => void install()} type="button">{t('features/console.pipInstall.installButton')}</button></div></div>
      </Dialog>
    </div>
  );
}
