import { describe, expect, it } from 'vitest';

import { recordingFilename, supportedRecordingMimeType } from './audioRecorder';

describe('chat audio recorder', () => {
  it('prefers an Opus WebM recording when supported', () => {
    const recorderType = {
      isTypeSupported: (mimeType: string) => mimeType === 'audio/webm;codecs=opus',
    } as Pick<typeof MediaRecorder, 'isTypeSupported'>;
    expect(supportedRecordingMimeType(recorderType)).toBe('audio/webm;codecs=opus');
  });

  it('falls back to the browser default when no candidate is supported', () => {
    const recorderType = { isTypeSupported: () => false } as Pick<typeof MediaRecorder, 'isTypeSupported'>;
    expect(supportedRecordingMimeType(recorderType)).toBe('');
  });

  it('uses an extension matching the recorded MIME type', () => {
    expect(recordingFilename('audio/ogg;codecs=opus', 'voice-id')).toBe('voice-id.ogg');
    expect(recordingFilename('audio/mp4', 'voice-id')).toBe('voice-id.m4a');
  });
});
