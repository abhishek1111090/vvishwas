import { Buffer } from 'node:buffer';
import { apiUploadFileChunked } from '../services/apiClient';

// Big recordings go up in pieces the server reassembles (see server-php upload_chunk).

function fakeFs(bytes) {
  const pieces = {};
  return {
    pieces,
    getInfoAsync: jest.fn(async () => ({ exists: true, size: bytes.length })),
    readAsStringAsync: jest.fn(async (_uri, { position, length }) => Buffer.from(bytes.subarray(position, position + length)).toString('base64')),
    writeAsStringAsync: jest.fn(async (uri, b64) => { pieces[uri] = Buffer.from(b64, 'base64'); }),
    deleteAsync: jest.fn(async () => {}),
    cacheDirectory: 'file:///cache/',
  };
}

/** A server that keeps what it received, like upload_chunk. */
function fakeServer(total, { dropAfter = Infinity } = {}) {
  const got = [];
  let calls = 0;
  return {
    got,
    upload: jest.fn(async (path, uri, type, fs) => {
      calls += 1;
      if (calls > dropAfter) throw Object.assign(new Error('Server error (524).'), { status: 524 });
      const offset = Number(/offset=(\d+)/.exec(path)[1]);
      const have = got.reduce((n, b) => n + b.length, 0);
      if (offset !== have) return { received: have };
      got.push(fs.pieces[uri]);
      const now = have + fs.pieces[uri].length;
      return now === total ? { recording: { id: 'r1', sizeBytes: total } } : { received: now };
    }),
  };
}

describe('chunked upload', () => {
  const bytes = Buffer.from(Array.from({ length: 2500 }, (_, i) => i % 251));

  it('sends a big file in pieces and the server gets exactly the file', async () => {
    const fs = fakeFs(bytes);
    const server = fakeServer(bytes.length);
    const res = await apiUploadFileChunked('/recordings?kind=video&part=1', 'file:///d/v.mov', 'video/quicktime', {
      chunkBytes: 1000, fs, uploadFile: (p, u, t) => server.upload(p, u, t, fs),
    });
    expect(res.recording.sizeBytes).toBe(2500);
    expect(server.upload.mock.calls.map((c) => c[0])).toEqual([
      '/recordings?kind=video&part=1&offset=0&total=2500',
      '/recordings?kind=video&part=1&offset=1000&total=2500',
      '/recordings?kind=video&part=1&offset=2000&total=2500',
    ]);
    expect(Buffer.concat(server.got).equals(bytes)).toBe(true);
    expect(fs.deleteAsync).toHaveBeenCalled(); // temp piece cleaned up
  });

  it('after an interruption it continues where the server stopped', async () => {
    const fs = fakeFs(bytes);
    const server = fakeServer(bytes.length, { dropAfter: 1 });
    const opts = { chunkBytes: 1000, fs, uploadFile: (p, u, t) => server.upload(p, u, t, fs) };
    await expect(apiUploadFileChunked('/recordings?kind=video&part=1', 'file:///d/v.mov', 'video/quicktime', opts)).rejects.toMatchObject({ status: 524 });
    server.upload.mockClear();
    const resumed = fakeServer(bytes.length);
    resumed.got.push(...server.got); // what the server already has
    const res = await apiUploadFileChunked('/recordings?kind=video&part=1', 'file:///d/v.mov', 'video/quicktime', { ...opts, uploadFile: (p, u, t) => resumed.upload(p, u, t, fs) });
    expect(res.recording.sizeBytes).toBe(2500);
    expect(resumed.upload.mock.calls.map((c) => /offset=(\d+)/.exec(c[0])[1])).toEqual(['0', '1000', '2000']); // told 1000, then went on
    expect(Buffer.concat(resumed.got).equals(bytes)).toBe(true);
  });

  it('small files go in one request; a missing file is a permanent error', async () => {
    const fs = fakeFs(bytes.subarray(0, 10));
    const uploadFile = jest.fn(async () => ({ recording: { id: 'r' } }));
    await apiUploadFileChunked('/recordings?kind=audio&part=1', 'file:///d/a.m4a', 'audio/mp4', { chunkBytes: 1000, fs, uploadFile });
    expect(uploadFile).toHaveBeenCalledWith('/recordings?kind=audio&part=1', 'file:///d/a.m4a', 'audio/mp4');
    fs.getInfoAsync.mockResolvedValueOnce({ exists: false });
    await expect(apiUploadFileChunked('/x?kind=audio&part=1', 'file:///gone', 'audio/mp4', { fs, uploadFile })).rejects.toMatchObject({ status: 410 });
  });
});
