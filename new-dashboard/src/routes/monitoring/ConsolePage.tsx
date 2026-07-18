import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { updatesApi } from '@/api/compat';
import { consoleAutoScrollPreference } from '@/config/preferences';
import { Dialog, DialogClose } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { toast } from '@/stores/feedback';
import { splitConsoleLog, type LogItem } from './model';
import { useLogFeed } from './useLogFeed';

const levels = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'] as const;
const levelClass = (level = '') => `console-log-line console-log-line--${level.toLowerCase()}`;

export default function ConsolePage() {
  const { t } = useTranslation();
  const filter = useCallback((item: LogItem) => item.type !== 'trace', []);
  const { items } = useLogFeed(filter, 500);
  const [selected, setSelected] = useState(() => new Set<string>(levels));
  const [autoScroll, setAutoScroll] = useState(() => consoleAutoScrollPreference.read());
  const [fullscreen, setFullscreen] = useState(false);
  const [pipOpen, setPipOpen] = useState(false);
  const [pipPackage, setPipPackage] = useState('');
  const [mirror, setMirror] = useState('');
  const [installing, setInstalling] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const visible = useMemo(() => items.filter((item) => selected.has(item.level ?? 'INFO')), [items, selected]);

  useEffect(() => {
    consoleAutoScrollPreference.write(autoScroll);
  }, [autoScroll]);
  useEffect(() => {
    if (!autoScroll || !terminalRef.current) return;
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const terminal = terminalRef.current;
      if (terminal) terminal.scrollTop = terminal.scrollHeight;
    });
    return () => {
      if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    };
  }, [autoScroll, visible]);
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === wrapperRef.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggleLevel = (level: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await wrapperRef.current?.requestFullscreen();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('features.console.fullscreen.failed'));
    }
  };
  const install = async () => {
    if (!pipPackage.trim()) return;
    setInstalling(true);
    try {
      const response = await updatesApi.installPip({ package: pipPackage.trim(), mirror: mirror.trim() || undefined });
      const result = response.data as { message?: string; status?: string } | undefined;
      if (result?.status && result.status !== 'ok')
        throw new Error(result.message || t('features.console.pipInstall.installFailed'));
      toast.success(result?.message || t('features.console.pipInstall.installSuccess'));
      setPipOpen(false);
      setPipPackage('');
      setMirror('');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('features.console.pipInstall.installFailed'));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="monitor-page console-page">
      <header className="monitor-header console-header-react">
        <div>
          <h1>{t('features.console.title')}</h1>
          <p>{t('features.console.debugHint.text')}</p>
        </div>
        <div className="monitor-actions console-header-actions">
          <label className="console-auto-scroll">
            <span>{t(`features.console.autoScroll.${autoScroll ? 'enabled' : 'disabled'}`)}</span>
            <span className="dynamic-switch">
              <input checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} type="checkbox" />
              <span className="dynamic-switch__track" />
            </span>
          </label>
          <button className="console-pip-button" onClick={() => setPipOpen(true)} type="button">
            <MdiIcon name="mdi-package-variant-plus" />
            {t('features.console.pipInstall.button')}
          </button>
        </div>
      </header>
      <div className={`console-displayer-react${fullscreen ? ' is-fullscreen' : ''}`} ref={wrapperRef}>
        <div className="console-filter-controls">
          <div>
            {levels.map((level) => (
              <button
                aria-pressed={selected.has(level)}
                className={`console-level-chip console-level-chip--${level.toLowerCase()}`}
                key={level}
                onClick={() => toggleLevel(level)}
                type="button"
              >
                <MdiIcon name={selected.has(level) ? 'mdi-check' : 'mdi-plus'} />
                {level}
              </button>
            ))}
          </div>
          <button
            aria-label={t(`features.console.fullscreen.${fullscreen ? 'exit' : 'enter'}`)}
            className="console-fullscreen-button"
            onClick={() => void toggleFullscreen()}
            title={t(`features.console.fullscreen.${fullscreen ? 'exit' : 'enter'}`)}
            type="button"
          >
            <MdiIcon name={fullscreen ? 'mdi-fullscreen-exit' : 'mdi-fullscreen'} />
          </button>
        </div>
        <div className="monitor-terminal" ref={terminalRef}>
          {visible.map((item) => (
            <ConsoleLogLine item={item} key={`${item.time}-${item.level}-${item.data}`} />
          ))}
        </div>
      </div>
      <Dialog
        onOpenChange={setPipOpen}
        open={pipOpen}
        title={
          <span className="monitor-dialog-title">
            <MdiIcon name="mdi-package-variant-plus" />
            {t('features.console.pipInstall.dialogTitle')}
          </span>
        }
      >
        <div className="dialog-form console-pip-dialog">
          <label>
            <span>{t('features.console.pipInstall.packageLabel')}</span>
            <input
              autoFocus
              onChange={(event) => setPipPackage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void install();
              }}
              value={pipPackage}
            />
          </label>
          <label>
            <span>{t('features.console.pipInstall.mirrorLabel')}</span>
            <input onChange={(event) => setMirror(event.target.value)} value={mirror} />
          </label>
          <small>
            <MdiIcon name="mdi-information-outline" />
            {t('features.console.pipInstall.mirrorHint')}
          </small>
          <div className="dialog-actions">
            <DialogClose asChild>
              <button className="monitor-button monitor-button--text" disabled={installing} type="button">
                {t('core.common.cancel')}
              </button>
            </DialogClose>
            <button
              className="monitor-button monitor-button--primary"
              disabled={installing || !pipPackage.trim()}
              onClick={() => void install()}
              type="button"
            >
              {installing ? <MdiIcon className="mdi-spin" name="mdi-loading" /> : <MdiIcon name="mdi-download" />}
              {t('features.console.pipInstall.installButton')}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function ConsoleLogLine({ item }: { item: LogItem }) {
  const line = splitConsoleLog(item.data ?? item);
  const structured = Boolean(line.level);
  return (
    <pre className={`${levelClass(item.level)}${structured ? ' console-log-line--structured' : ''}`}>
      {structured ? (
        <>
          <span className="console-log-prefix">{line.prefix}</span>
          <span className="console-log-level">{line.level}</span>
          <span className="console-log-message">{line.message}</span>
        </>
      ) : (
        line.message
      )}
    </pre>
  );
}
