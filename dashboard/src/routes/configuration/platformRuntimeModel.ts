export type QrCodeValueKind = 'content' | 'empty' | 'image';

export function qrCodeValueKind(value: string): QrCodeValueKind {
  const normalized = value.trim();
  if (!normalized) return 'empty';
  return normalized.startsWith('data:image/') ? 'image' : 'content';
}
