const RECORDING_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4',
  'audio/wav',
] as const;

type MediaRecorderSupport = Pick<typeof MediaRecorder, 'isTypeSupported'>;

export function supportedRecordingMimeType(recorderType: MediaRecorderSupport | undefined = globalThis.MediaRecorder) {
  if (!recorderType?.isTypeSupported) return '';
  return RECORDING_MIME_TYPES.find((mimeType) => recorderType.isTypeSupported(mimeType)) || '';
}

export function recordingFilename(mimeType: string, id: string = globalThis.crypto?.randomUUID?.() || `${Date.now()}`) {
  const normalized = mimeType.toLowerCase();
  const extensions: Record<string, string> = {
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/ogg;codecs=opus': 'ogg',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'audio/webm;codecs=opus': 'webm',
  };
  const extension = extensions[normalized] || normalized.split('/')[1]?.split(';')[0] || 'webm';
  return `${id}.${extension}`;
}

export class AudioRecorder {
  private chunks: Blob[] = [];
  private recorder: MediaRecorder | null = null;

  get active() {
    return this.recorder?.state === 'recording';
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new Error('Audio recording is not supported in this browser.');
    }

    this.cancel();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = supportedRecordingMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (cause) {
      stream.getTracks().forEach((track) => track.stop());
      throw cause;
    }
    this.chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };

    try {
      recorder.start();
      this.recorder = recorder;
    } catch (cause) {
      stream.getTracks().forEach((track) => track.stop());
      throw cause;
    }
  }

  async stop() {
    const recorder = this.recorder;
    if (!recorder || recorder.state === 'inactive') throw new Error('No active audio recording.');

    return new Promise<File>((resolve, reject) => {
      const cleanup = () => {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;
        recorder.stream.getTracks().forEach((track) => track.stop());
        if (this.recorder === recorder) this.recorder = null;
      };

      recorder.onstop = () => {
        const mimeType = this.chunks.find((chunk) => chunk.type)?.type || recorder.mimeType || 'audio/webm';
        const blob = new Blob(this.chunks, { type: mimeType });
        this.chunks = [];
        cleanup();
        if (!blob.size) {
          reject(new Error('Audio recording is empty.'));
          return;
        }
        resolve(new File([blob], recordingFilename(mimeType), { type: mimeType, lastModified: Date.now() }));
      };
      recorder.onerror = () => {
        this.chunks = [];
        cleanup();
        reject(new Error('Audio recording failed.'));
      };

      try {
        recorder.stop();
      } catch (cause) {
        cleanup();
        reject(cause);
      }
    });
  }

  cancel() {
    const recorder = this.recorder;
    if (!recorder) return;
    recorder.ondataavailable = null;
    recorder.onstop = null;
    recorder.onerror = null;
    if (recorder.state !== 'inactive') recorder.stop();
    recorder.stream.getTracks().forEach((track) => track.stop());
    this.chunks = [];
    this.recorder = null;
  }
}
