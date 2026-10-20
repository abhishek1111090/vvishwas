import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRecordingService } from './recordingService';

class FakeTrack {
  constructor() { this.stopped = false; this.onended = null; }
  stop() { this.stopped = true; }
}

class FakeStream {
  constructor() { this.tracks = [new FakeTrack()]; }
  getTracks() { return this.tracks; }
}

class FakeMediaRecorder {
  static isTypeSupported(t) { return t === 'audio/webm' || t === 'video/webm'; }
  static instances = [];
  constructor(stream, opts) {
    this.stream = stream;
    this.mimeType = opts?.mimeType ?? '';
    this.state = 'inactive';
    FakeMediaRecorder.instances.push(this);
  }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['chunk-data'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

function memoryWriterFactory(outcome = 'saved') {
  const writers = [];
  const create = vi.fn(({ kind, mime }) => {
    const w = {
      bytes: 0,
      append: vi.fn((blob) => { w.bytes += blob.size; return Promise.resolve(); }),
      finalize: vi.fn(async () =>
        outcome === 'saved'
          ? { status: 'saved', path: `recordings/s/${kind}.webm`, bytes: w.bytes, mime }
          : { status: 'error', error: 'Disk full', bytes: 0 }),
    };
    writers.push(w);
    return w;
  });
  return { create, writers };
}

describe('recordingService', () => {
  let getUserMedia;

  beforeEach(() => {
    FakeMediaRecorder.instances = [];
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    getUserMedia = vi.fn(async () => new FakeStream());
    vi.stubGlobal('navigator', { ...globalThis.navigator, mediaDevices: { getUserMedia } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('records audio and reports saved only after the file is written', async () => {
    const { create } = memoryWriterFactory('saved');
    const svc = createRecordingService({ createWriter: create });
    const res = await svc.startAudio('s1');
    expect(res.success).toBe(true);
    expect(svc.getSnapshot().audio.status).toBe('recording');
    expect(create).toHaveBeenCalledWith({ sessionId: 's1', kind: 'audio', mime: 'audio/webm' });

    const { audio } = await svc.stopAll();
    expect(audio.status).toBe('saved');
    expect(audio.path).toBe('recordings/s/audio.webm');
    expect(audio.bytes).toBeGreaterThan(0);
  });

  it('releases the microphone tracks when stopped (resource cleanup)', async () => {
    const svc = createRecordingService({ createWriter: memoryWriterFactory().create });
    await svc.startAudio('s1');
    const stream = FakeMediaRecorder.instances[0].stream;
    await svc.stopAll();
    expect(stream.getTracks().every((t) => t.stopped)).toBe(true);
  });

  it('refuses a duplicate start while recording', async () => {
    const svc = createRecordingService({ createWriter: memoryWriterFactory().create });
    await svc.startVideo('s1');
    const second = await svc.startVideo('s1');
    expect(second.success).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('reports permission denial without claiming to record', async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    const svc = createRecordingService({ createWriter: memoryWriterFactory().create });
    const res = await svc.startVideo('s1');
    expect(res.success).toBe(false);
    expect(svc.getSnapshot().video.status).toBe('error');
    expect(svc.getSnapshot().video.error).toBe('Camera permission denied.');
  });

  it('reports missing hardware', async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('none'), { name: 'NotFoundError' }));
    const svc = createRecordingService({ createWriter: memoryWriterFactory().create });
    await svc.startAudio('s1');
    expect(svc.getSnapshot().audio.error).toMatch(/No microphone/);
  });

  it('reports a failed save as an error, not as saved', async () => {
    const svc = createRecordingService({ createWriter: memoryWriterFactory('error').create });
    await svc.startAudio('s1');
    const { audio } = await svc.stopAll();
    expect(audio.status).toBe('error');
    expect(audio.error).toBe('Disk full');
  });

  it('marks a recording interrupted when the OS ends the track, and still finalizes it', async () => {
    const svc = createRecordingService({ createWriter: memoryWriterFactory().create });
    await svc.startVideo('s1');
    const track = FakeMediaRecorder.instances[0].stream.getTracks()[0];
    track.onended();
    await vi.waitFor(() => expect(svc.getSnapshot().video.status).toBe('saved'));
    expect(svc.getSnapshot().video.interrupted).toBe(true);
  });

  it('stopAll with nothing running is harmless', async () => {
    const svc = createRecordingService({ createWriter: memoryWriterFactory().create });
    const res = await svc.stopAll();
    expect(res.audio.status).toBe('idle');
    expect(res.video.status).toBe('idle');
  });

  it('is unsupported (with an error) when MediaRecorder is missing', async () => {
    vi.stubGlobal('MediaRecorder', undefined);
    const svc = createRecordingService({ createWriter: memoryWriterFactory().create });
    const res = await svc.startAudio('s1');
    expect(res.success).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
