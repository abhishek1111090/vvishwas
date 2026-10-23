import { createCloudSync, uploadsFor } from '../services/cloudSync';
import { createAuthService } from '../services/authService';
import * as apiClient from '../services/apiClient';
import { initStorage, __resetStorageCache } from '../utils/storage';

// Server backup of SOS data + server accounts. Network is faked; the
// server side has its own tests (server/api.test.js).

function store() {
  const data = {};
  return { read: (k, f) => (k in data ? JSON.parse(JSON.stringify(data[k])) : f), write: (k, v) => { data[k] = JSON.parse(JSON.stringify(v)); }, data };
}

function setup({ signedIn = true } = {}) {
  const s = store();
  const calls = [];
  const post = jest.fn(async (p, b) => { calls.push(['POST', p, b]); return {}; });
  const patch = jest.fn(async (p, b) => { calls.push(['PATCH', p, b]); return {}; });
  const upload = jest.fn(async (p, uri, type) => { calls.push(['UPLOAD', p, uri, type]); return {}; });
  let timer = null;
  const sync = createCloudSync({
    post, patch, upload, isSignedIn: () => signedIn, read: s.read, write: s.write,
    setTimer: (fn) => { timer = fn; return 1; }, clearTimer: () => {}, now: () => 1_000_000,
  });
  return { sync, calls, post, patch, upload, s, fireRetry: () => timer?.() };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const session = { id: 'sess-1', triggerSource: 'voice', startedAt: '2026-10-24T05:00:00.000Z' };
const recordings = {
  audio: { status: 'saved', uri: 'file:///d/a2.m4a', parts: [{ uri: 'file:///d/a1.m4a' }, { uri: 'file:///d/a2.m4a' }] },
  video: { status: 'saved', uri: 'file:///d/v1.mov', clips: [{ uri: 'file:///d/v1.mov' }], front: { status: 'saved', uri: 'file:///d/f1.mov' } },
  photos: [{ uri: 'file:///d/p1.jpg' }],
};

describe('cloudSync', () => {
  it('maps every saved file to a stable kind/part', () => {
    expect(uploadsFor('s', recordings).map((i) => [i.kind, i.part, i.uri])).toEqual([
      ['audio', 1, 'file:///d/a1.m4a'], ['audio', 2, 'file:///d/a2.m4a'],
      ['video', 1, 'file:///d/v1.mov'], ['video', 1001, 'file:///d/f1.mov'],
      ['photo', 1, 'file:///d/p1.jpg'],
    ]);
  });

  it('sends SOS → throttled locations → end → files, in order, and marks files backed up', async () => {
    const t = setup();
    t.sync.sosStarted(session, [{ id: 'c1', name: 'Maa', phoneNumber: '+919876543210' }]);
    t.sync.location('sess-1', { latitude: 26.9, longitude: 75.8, accuracy: 8, timestamp: 't1' });
    t.sync.location('sess-1', { latitude: 26.90001, longitude: 75.8, accuracy: 8, timestamp: 't2' }); // <50 m, <30 s → skipped
    t.sync.sosEnded({ clientId: 'sess-1', status: 'resolved', endedAt: 'x', alertSummary: [], recordings });
    await flush(); await flush(); await flush();
    expect(t.calls.map((c) => `${c[0]} ${c[1]}`)).toEqual([
      'POST /sos', 'POST /location', 'PATCH /sos/sess-1',
      'UPLOAD /recordings?sosClientId=sess-1&kind=audio&part=1',
      'UPLOAD /recordings?sosClientId=sess-1&kind=audio&part=2',
      'UPLOAD /recordings?sosClientId=sess-1&kind=video&part=1',
      'UPLOAD /recordings?sosClientId=sess-1&kind=video&part=1001',
      'UPLOAD /recordings?sosClientId=sess-1&kind=photo&part=1',
    ]);
    expect(t.calls[6][3]).toBe('video/quicktime');
    expect(t.calls[7][3]).toBe('image/jpeg');
    expect(t.sync.statusOf('file:///d/a1.m4a')).toBe('uploaded');
    expect(t.sync.pendingCount()).toBe(0);
  });

  it('keeps the queue through network failures and retries without losing order', async () => {
    const t = setup();
    t.post.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'NETWORK' }));
    t.sync.sosStarted(session, []);
    await flush();
    expect(t.sync.pendingCount()).toBe(1);
    expect(t.s.data['vishwas.cloud.queue.v1']).toHaveLength(1); // survives an app restart
    t.fireRetry();
    await flush(); await flush();
    expect(t.post).toHaveBeenCalledTimes(2);
    expect(t.sync.pendingCount()).toBe(0);
  });

  it('a permanently refused file is marked failed, not retried forever; the rest continue', async () => {
    const t = setup();
    t.upload.mockRejectedValueOnce(Object.assign(new Error('bad type'), { status: 415 }));
    t.sync.sosEnded({ clientId: 'sess-1', status: 'cancelled', endedAt: 'x', alertSummary: [], recordings: { audio: { status: 'saved', uri: 'file:///d/x.m4a' }, photos: [{ uri: 'file:///d/p.jpg' }] } });
    await flush(); await flush(); await flush();
    expect(t.sync.statusOf('file:///d/x.m4a')).toBe('failed');
    expect(t.sync.statusOf('file:///d/p.jpg')).toBe('uploaded');
  });

  it('does nothing for phone-only accounts (nothing leaves the phone)', async () => {
    const t = setup({ signedIn: false });
    t.sync.sosStarted(session, []);
    t.sync.sosEnded({ clientId: 'sess-1', status: 'resolved', endedAt: 'x', recordings });
    await flush();
    expect(t.calls).toEqual([]);
  });
});

describe('server accounts', () => {
  beforeEach(async () => {
    __resetStorageCache();
    await initStorage();
    require('expo-secure-store').__store.clear();
    apiClient.setAuthToken(null);
  });

  it('sign up stores the token securely and sends it on later requests', async () => {
    const spy = jest.spyOn(apiClient, 'apiPost').mockResolvedValue({ user: { id: 'u1', fullName: 'Anshu', email: 'anshu@example.com', createdAt: 'x' }, token: 'tok_abcdefghijklmnopqrstuvwxyz' });
    const auth = createAuthService({ hashIterations: 10, serverMode: () => true });
    const user = await auth.signUp({ fullName: 'Anshu', email: 'Anshu@Example.com', password: 'long-enough-pw' });
    expect(spy).toHaveBeenCalledWith('/auth/register', { fullName: 'Anshu', email: 'anshu@example.com', password: 'long-enough-pw' });
    expect(user.authProvider).toBe('server');
    expect(apiClient.hasAuthToken()).toBe(true);
    const saved = JSON.parse(require('expo-secure-store').__store.get('vishwas.server.session.v1'));
    expect(saved.token).toBe('tok_abcdefghijklmnopqrstuvwxyz');
    spy.mockRestore();
  });

  it('restores offline (SOS keeps working) but signs out when the server says the session expired', async () => {
    require('expo-secure-store').__store.set('vishwas.server.session.v1', JSON.stringify({ token: 'tok_x', user: { id: 'u1', fullName: 'Anshu', authProvider: 'server' } }));
    const get = jest.spyOn(apiClient, 'apiGet').mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'NETWORK' }));
    const auth = createAuthService({ serverMode: () => true });
    expect((await auth.restoreSession()).fullName).toBe('Anshu');
    get.mockRejectedValueOnce(Object.assign(new Error('expired'), { status: 401 }));
    expect(await auth.restoreSession()).toBeNull();
    expect(apiClient.hasAuthToken()).toBe(false);
    get.mockRestore();
  });

  it('server errors become plain messages', async () => {
    const spy = jest.spyOn(apiClient, 'apiPost').mockRejectedValue(Object.assign(new Error('x'), { code: 'NETWORK' }));
    const auth = createAuthService({ serverMode: () => true });
    await expect(auth.signIn({ email: 'a@example.com', password: 'whatever1' })).rejects.toThrow(/Can’t reach the VISHWAS server/);
    spy.mockRestore();
  });
});
