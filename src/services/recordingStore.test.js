import { describe, it, expect, vi } from 'vitest';
import { createRecordingWriter, extensionForMime } from './recordingStore';

function fakeFs() {
  return {
    writeFile: vi.fn(async () => ({ uri: 'file://x' })),
    appendFile: vi.fn(async () => {}),
    deleteFile: vi.fn(async () => {}),
  };
}

describe('recordingStore', () => {
  it('maps mime types to file extensions', () => {
    expect(extensionForMime('audio/mp4')).toBe('m4a');
    expect(extensionForMime('video/mp4;codecs=avc1')).toBe('mp4');
    expect(extensionForMime('video/webm;codecs=vp8')).toBe('webm');
    expect(extensionForMime('')).toBe('bin');
  });

  it('native writer creates the file with the first chunk, then appends, in app-private storage', async () => {
    const fs = fakeFs();
    const w = createRecordingWriter({ sessionId: 's1', kind: 'audio', mime: 'audio/webm', native: true, fs });
    await w.append(new Blob(['aa']));
    await w.append(new Blob(['bbb']));
    const res = await w.finalize();
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    expect(fs.writeFile.mock.calls[0][0]).toMatchObject({ directory: 'DATA', recursive: true });
    expect(fs.writeFile.mock.calls[0][0].path).toMatch(/^recordings\/s1\/audio-\d+\.webm$/);
    expect(fs.appendFile).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ status: 'saved', bytes: 5, directory: 'DATA' });
  });

  it('native writer reports an error when a write fails', async () => {
    const fs = fakeFs();
    fs.appendFile.mockRejectedValueOnce(new Error('No space left'));
    const w = createRecordingWriter({ sessionId: 's1', kind: 'video', mime: 'video/webm', native: true, fs });
    await w.append(new Blob(['aa']));
    await w.append(new Blob(['bb']));
    const res = await w.finalize();
    expect(res.status).toBe('error');
    expect(res.error).toMatch(/No space left/);
  });

  it('native writer reports an error when nothing was captured', async () => {
    const w = createRecordingWriter({ sessionId: 's1', kind: 'audio', mime: 'audio/webm', native: true, fs: fakeFs() });
    expect((await w.finalize()).status).toBe('error');
  });

  it('browser writer returns a downloadable URL with status "ready", never "saved"', async () => {
    const createObjectURL = vi.fn(() => 'blob:abc');
    vi.stubGlobal('URL', { ...URL, createObjectURL });
    const w = createRecordingWriter({ sessionId: 's1', kind: 'audio', mime: 'audio/webm', native: false });
    await w.append(new Blob(['abc']));
    const res = await w.finalize();
    expect(res).toMatchObject({ status: 'ready', url: 'blob:abc', bytes: 3 });
    vi.unstubAllGlobals();
  });
});
