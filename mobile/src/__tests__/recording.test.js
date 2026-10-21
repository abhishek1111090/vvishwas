import { createRecordingService } from '../services/recordingService';
import { saveRecording } from '../services/recordingStore';

function fakeRecorder() {
  let listener = null;
  return {
    uri: 'file:///cache/rec.m4a',
    prepareToRecordAsync: jest.fn(async () => {}),
    record: jest.fn(),
    stop: jest.fn(async () => {}),
    addListener: jest.fn((_e, l) => { listener = l; return { remove: jest.fn() }; }),
    emit: (status) => listener(status),
  };
}

function fakeCamera() {
  let resolve;
  return {
    recordAsync: jest.fn(() => new Promise((r) => { resolve = r; })),
    stopRecording: jest.fn(() => resolve({ uri: 'file:///cache/video.mov' })),
    finishOnItsOwn: () => resolve({ uri: 'file:///cache/video.mov' }),
  };
}

function svc({ granted = true, save } = {}) {
  return createRecordingService({
    save: save ?? jest.fn(async ({ kind }) => ({ status: 'saved', uri: `file:///docs/recordings/s/${kind}`, bytes: 1000 })),
    audioMode: jest.fn(async () => {}),
    micPermission: {
      get: jest.fn(async () => ({ granted, canAskAgain: false })),
      request: jest.fn(async () => ({ granted })),
    },
  });
}

describe('recordingService', () => {
  it('records audio and reports saved only after the file is moved', async () => {
    const save = jest.fn(async () => ({ status: 'saved', uri: 'file:///docs/a.m4a', bytes: 2048 }));
    const s = svc({ save });
    const rec = fakeRecorder();
    s.attachAudioRecorder(rec);
    expect((await s.startAudio('s1')).success).toBe(true);
    expect(rec.prepareToRecordAsync).toHaveBeenCalled();
    expect(s.getSnapshot().audio.status).toBe('recording');
    const { audio } = await s.stopAll();
    expect(save).toHaveBeenCalledWith({ uri: 'file:///cache/rec.m4a', sessionId: 's1', kind: 'audio' });
    expect(audio).toMatchObject({ status: 'saved', uri: 'file:///docs/a.m4a', bytes: 2048 });
  });

  it('microphone denial never reports recording', async () => {
    const s = svc({ granted: false });
    s.attachAudioRecorder(fakeRecorder());
    const res = await s.startAudio('s1');
    expect(res.success).toBe(false);
    expect(s.getSnapshot().audio).toMatchObject({ status: 'error', error: 'Microphone permission denied.' });
  });

  it('refuses a duplicate audio start', async () => {
    const s = svc();
    const rec = fakeRecorder();
    s.attachAudioRecorder(rec);
    await s.startAudio('s1');
    expect((await s.startAudio('s1')).duplicate).toBe(true);
    expect(rec.record).toHaveBeenCalledTimes(1);
  });

  it('video needs a ready camera', async () => {
    const s = svc();
    const res = await s.startVideo('s1');
    expect(res.success).toBe(false);
    expect(s.getSnapshot().video.error).toBe('Camera is not ready.');
  });

  it('records video, stops it, and saves the file', async () => {
    const s = svc();
    const cam = fakeCamera();
    s.attachCamera(cam);
    await s.startVideo('s1');
    expect(cam.recordAsync).toHaveBeenCalledWith({ maxDuration: 3600 });
    expect((await s.startVideo('s1')).duplicate).toBe(true);
    const { video } = await s.stopAll();
    expect(cam.stopRecording).toHaveBeenCalled();
    expect(video).toMatchObject({ status: 'saved', interrupted: false });
  });

  it('a video stopped by the system is still saved and marked interrupted', async () => {
    const s = svc();
    const cam = fakeCamera();
    s.attachCamera(cam);
    await s.startVideo('s1');
    cam.finishOnItsOwn();
    await new Promise((r) => setTimeout(r, 0)); // let the service notice before the user ends the SOS
    const { video } = await s.stopAll();
    expect(video).toMatchObject({ status: 'saved', interrupted: true });
  });

  it('a failed save is an error, not saved', async () => {
    const s = svc({ save: jest.fn(async () => ({ status: 'error', error: 'Disk full', bytes: 0 })) });
    s.attachAudioRecorder(fakeRecorder());
    await s.startAudio('s1');
    const { audio } = await s.stopAll();
    expect(audio).toMatchObject({ status: 'error', error: 'Disk full' });
  });

  it('a recorder error during recording is surfaced', async () => {
    const s = svc();
    const rec = fakeRecorder();
    s.attachAudioRecorder(rec);
    await s.startAudio('s1');
    rec.emit({ hasError: true, error: 'Interrupted by call' });
    expect(s.getSnapshot().audio).toMatchObject({ error: 'Interrupted by call', interrupted: true });
  });
});

describe('saveRecording', () => {
  function fakeFs({ exists = true, size = 500, moveFails = false } = {}) {
    class File {
      constructor(...parts) {
        this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
        this.exists = exists;
        this.size = size;
        this.extension = '.m4a';
      }
      async move(dest) {
        if (moveFails) throw new Error('No space left');
        this.uri = dest.uri;
      }
    }
    class Directory {
      constructor(...parts) {
        this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
        this.exists = false;
      }
      create() { this.exists = true; }
    }
    return { File, Directory, Paths: { document: { uri: 'file:///docs' } } };
  }

  it('moves the file into private Documents/recordings/<session>', async () => {
    const res = await saveRecording({ uri: 'file:///cache/x.m4a', sessionId: 's1', kind: 'audio', fs: fakeFs() });
    expect(res.status).toBe('saved');
    expect(res.uri).toMatch(/^file:\/\/\/docs\/recordings\/s1\/audio-\d+\.m4a$/);
    expect(res.bytes).toBe(500);
  });

  it('reports missing, empty, or unmovable files as errors', async () => {
    expect((await saveRecording({ uri: null, sessionId: 's', kind: 'audio', fs: fakeFs() })).status).toBe('error');
    expect((await saveRecording({ uri: 'f', sessionId: 's', kind: 'audio', fs: fakeFs({ exists: false }) })).status).toBe('error');
    expect((await saveRecording({ uri: 'f', sessionId: 's', kind: 'audio', fs: fakeFs({ size: 0 }) })).status).toBe('error');
    const failed = await saveRecording({ uri: 'f', sessionId: 's', kind: 'video', fs: fakeFs({ moveFails: true }) });
    expect(failed).toMatchObject({ status: 'error' });
    expect(failed.error).toMatch(/No space left/);
  });
});
