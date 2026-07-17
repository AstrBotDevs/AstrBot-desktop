import { describe, expect, it } from 'vitest';

import { qrCodeValueKind } from './PlatformRuntimePanels';

describe('platform runtime panels', () => {
  it('distinguishes ready-made QR images from raw login content', () => {
    expect(qrCodeValueKind(' data:image/png;base64,abc ')).toBe('image');
    expect(qrCodeValueKind('https://login.example/scan?id=1')).toBe('content');
    expect(qrCodeValueKind('  ')).toBe('empty');
  });
});
