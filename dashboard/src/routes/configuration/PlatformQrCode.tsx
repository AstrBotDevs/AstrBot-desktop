import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

import { MdiIcon } from '@/components/icons/MdiIcon';
import { qrCodeValueKind } from './platformRuntimeModel';

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
    })
      .then((next) => {
        if (!cancelled) setSource(next);
      })
      .catch(() => {
        if (!cancelled) setSource('');
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  return source ? (
    <img alt={alt} src={source} />
  ) : (
    <div className="platform-qr-empty">
      <MdiIcon name="mdi-qrcode-remove" />
    </div>
  );
}
