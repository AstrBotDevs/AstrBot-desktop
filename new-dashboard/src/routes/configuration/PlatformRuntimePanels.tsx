import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';

import { MdiIcon } from '@/components/icons/MdiIcon';
import { splitConsoleLog, type LogItem } from '@/routes/monitoring/model';
import { useLogFeed } from '@/routes/monitoring/useLogFeed';

export function PlatformLogConsole() {
  const { t } = useTranslation();
  const filter = useCallback((item: LogItem) => item.type !== 'trace', []);
  const { items, status } = useLogFeed(filter, 300);
  const terminal = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = terminal.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [items]);

  return (
    <section className="platform-console">
      <div className="platform-console__status">
        <MdiIcon name={status === 'live' ? 'mdi-check-circle' : status === 'connecting' ? 'mdi-loading' : 'mdi-alert-circle'} />
        {t(`features.console.connection.${status}`, { defaultValue: status })}
      </div>
      <div className="monitor-terminal platform-console__terminal" ref={terminal}>
        {items.map((item) => {
          const line = splitConsoleLog(item.data ?? item);
          return <pre className={`console-log-line console-log-line--${String(item.level || 'info').toLowerCase()}`} key={`${item.time}-${item.level}-${item.data}`}>{line.message}</pre>;
        })}
      </div>
    </section>
  );
}

export function QrCodeImage({ alt, value }: { alt: string; value: string }) {
  const [source, setSource] = useState('');

  useEffect(() => {
    let cancelled = false;
    const normalized = value.trim();
    const kind = qrCodeValueKind(normalized);
    if (kind === 'empty') {
      setSource('');
      return undefined;
    }
    if (kind === 'image') {
      setSource(normalized);
      return undefined;
    }
    void QRCode.toDataURL(normalized, {
      margin: 2,
      width: 260,
      errorCorrectionLevel: 'M',
    }).then((next) => {
      if (!cancelled) setSource(next);
    }).catch(() => {
      if (!cancelled) setSource('');
    });
    return () => { cancelled = true; };
  }, [value]);

  return source
    ? <img alt={alt} src={source} />
    : <div className="platform-qr-empty"><MdiIcon name="mdi-qrcode-remove" /></div>;
}

export function qrCodeValueKind(value: string) {
  const normalized = value.trim();
  if (!normalized) return 'empty';
  return normalized.startsWith('data:image/') ? 'image' : 'content';
}
