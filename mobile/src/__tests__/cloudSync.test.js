import { createCloudSync, uploadsFor, newShareToken } from '../services/cloudSync';
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

  it('gives each SOS its own unguessable emergency link and sends only the token to the server', async () => {
    const t = setup();
    const a = t.sync.sosStarted(session, []);
    const b = t.sync.sosStarted({ ...session, id: 'sess-2' }, []);
    await flush(); await flush();
    const token = (r) => r.shareUrl.split('/share/')[1];
    expect(token(a)).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes, base64url
    expect(token(a)).not.toBe(token(b));
    expect(t.calls[0][2].shareToken).toBe(token(a));
    expect(t.calls[1][2].shareToken).toBe(token(b));
    expect(newShareToken(() => new Uint8Array(32).fill(255))).toBe('_'.repeat(42) + '8');
  });

  it('no link for phone-only accounts (nothing would ever reach the server)', () => {
    expect(setup({ signedIn: false }).sync.sosStarted(session, [])).toBeNull();
  });

  it('sends SOS → throttled locations → end, files in their own lane after the SOS, and marks files backed up', async () => {
    const t = setup();
    t.sync.sosStarted(session, [{ id: 'c1', name: 'Maa', phoneNumber: '+919876543210' }]);
    t.sync.location('sess-1', { latitude: 26.9, longitude: 75.8, accuracy: 8, timestamp: 't1' });
    t.sync.location('sess-1', { latitude: 26.90001, longitude: 75.8, accuracy: 8, timestamp: 't2' }); // <50 m, <30 s → skipped
    t.sync.sosEnded({ clientId: 'sess-1', status: 'resolved', endedAt: 'x', alertSummary: [], recordings });
    for (let i = 0; i < 6; i += 1) await flush();
    const lines = t.calls.map((c) => `${c[0]} ${c[1]}`);
    expect(lines[0]).toBe('POST /sos'); // nothing (not even a file) before the SOS exists on the server
    expect(lines.filter((l) => !l.startsWith('UPLOAD'))).toEqual(['POST /sos', 'POST /location', 'PATCH /sos/sess-1']);
    expect(lines.filter((l) => l.startsWith('UPLOAD'))).toEqual([
      'UPLOAD /recordings?sosClientId=sess-1&kind=audio&part=1',
      'UPLOAD /recordings?sosClientId=sess-1&kind=audio&part=2',
      'UPLOAD /recordings?sosClientId=sess-1&kind=video&part=1',
      'UPLOAD /recordings?sosClientId=sess-1&kind=video&part=1001',
      'UPLOAD /recordings?sosClientId=sess-1&kind=photo&part=1',
    ]);
    const typeOf = (uri) => t.calls.find((c) => c[2] === uri)[3];
    expect(typeOf('file:///d/f1.mov')).toBe('video/quicktime');
    expect(typeOf('file:///d/p1.jpg')).toBe('image/jpeg');
    expect(t.sync.statusOf('file:///d/a1.m4a')).toBe('uploaded');
    expect(t.sync.pendingCount()).toBe(0);
  });

  it('a slow video upload never holds up live location', async () => {
    const t = setup();
    let finishVideo;
    t.upload.mockImplementationOnce((p, uri) => { t.calls.push(['UPLOAD', p, uri]); return new Promise((r) => { finishVideo = r; }); });
    t.sync.sosStarted(session, []);
    t.sync.filesSaved('sess-1', { video: { clips: [{ uri: 'file:///d/big.mov' }] } });
    await flush(); await flush();
    t.sync.location('sess-1', { latitude: 26.9, longitude: 75.8, accuracy: 8, timestamp: 't1' });
    await flush(); await flush();
    expect(t.calls.map((c) => `${c[0]} ${c[1]}`)).toEqual(['POST /sos', 'UPLOAD /recordings?sosClientId=sess-1&kind=video&part=1', 'POST /location']);
    finishVideo({});
    await flush(); await flush();
    expect(t.sync.statusOf('file:///d/big.mov')).toBe('uploaded');
  });

  it('uploads each part during the SOS once; the end only sends what is new', async () => {
    const t = setup();
    t.sync.sosStarted(session, []);
    t.sync.filesSaved('sess-1', { audio: { parts: [{ uri: 'file:///d/a1.m4a' }] }, video: { clips: [{ uri: 'file:///d/v1.mov' }] } });
    t.sync.filesSaved('sess-1', { audio: { parts: [{ uri: 'file:///d/a1.m4a' }] }, video: { clips: [{ uri: 'file:///d/v1.mov' }] } }); // same parts again
    for (let i = 0; i < 6; i += 1) await flush();
    t.sync.sosEnded({ clientId: 'sess-1', status: 'resolved', endedAt: 'x', alertSummary: [], recordings });
    for (let i = 0; i < 6; i += 1) await flush();
    const uploads = t.calls.filter((c) => c[0] === 'UPLOAD').map((c) => c[2]);
    expect(uploads).toEqual(['file:///d/a1.m4a', 'file:///d/v1.mov', 'file:///d/a2.m4a', 'file:///d/f1.mov', 'file:///d/p1.jpg']);
  });

  it('uploads past SOS events from this phone once (event, last location, outcome, files)', async () => {
    const t = setup();
    const old = {
      id: 'old-1', startedAt: '2026-10-20T10:00:00.000Z', endedAt: '2026-10-20T10:05:00.000Z', status: 'resolved', triggerSource: 'button',
      location: { latitude: 26.9, longitude: 75.8, accuracy: 10, timestamp: '2026-10-20T10:00:05.000Z' },
      alerts: { recipients: [{ contactId: 'c1', name: 'Maa', phoneNumber: '+919876543210', status: 'sentByUser' }] },
      recordings: { audio: { status: 'saved', uri: 'file:///d/old.m4a' }, video: { status: 'saved', uri: 'file:///d/old.mov' } },
    };
    expect(t.sync.backfillHistory([old, { ...old, id: 'live', status: 'active' }])).toBe(1);
    expect(t.sync.backfillHistory([old])).toBe(0); // only once
    for (let i = 0; i < 6; i += 1) await flush();
    const sos = t.calls.find((c) => c[1] === '/sos');
    expect(sos[2]).toMatchObject({ clientId: 'old-1', startedAt: old.startedAt, location: { latitude: 26.9, longitude: 75.8 }, contacts: [{ id: 'c1', name: 'Maa', phoneNumber: '+919876543210' }] });
    expect(t.calls.find((c) => c[0] === 'PATCH')[2]).toMatchObject({ status: 'resolved', endedAt: old.endedAt, alertSummary: [{ contactId: 'c1', status: 'sentByUser', whatsapp: null }] });
    expect(t.calls.filter((c) => c[0] === 'UPLOAD').map((c) => c[2])).toEqual(['file:///d/old.m4a', 'file:///d/old.mov']);
  });

  it('backs up app data only when it changed', async () => {
    const t = setup();
    const doc = { contacts: [{ id: 'c1', name: 'Maa' }], settings: { voiceActivation: { enabled: false, phrase: '' } } };
    t.sync.backupAppData(doc);
    await flush(); await flush();
    t.sync.backupAppData({ ...doc }); // same content
    await flush(); await flush();
    t.sync.backupAppData({ ...doc, contacts: [] });
    await flush(); await flush();
    expect(t.calls.filter((c) => c[1] === '/backup').map((c) => c[2].contacts.length)).toEqual([1, 0]);
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

  it('a phone-only account is moved to the server the next time it signs in', async () => {
    const local = createAuthService({ hashIterations: 10, serverMode: () => false });
    await local.signUp({ fullName: 'Anshu', email: 'anshu@example.com', password: 'long-enough-pw' });
    const post = jest.spyOn(apiClient, 'apiPost').mockImplementation(async (p) => {
      if (p === '/auth/login') throw Object.assign(new Error('Incorrect email or password.'), { status: 401 });
      return { user: { id: 'srv-1', fullName: 'Anshu', email: 'anshu@example.com', createdAt: 'x' }, token: 'tok_abcdefghijklmnopqrstuvwxyz' };
    });
    const auth = createAuthService({ hashIterations: 10, serverMode: () => true });
    const user = await auth.signIn({ email: 'anshu@example.com', password: 'long-enough-pw' });
    expect(post).toHaveBeenCalledWith('/auth/register', { fullName: 'Anshu', email: 'anshu@example.com', password: 'long-enough-pw' }, expect.anything());
    expect(user).toMatchObject({ id: 'srv-1', authProvider: 'server' });
    expect(apiClient.hasAuthToken()).toBe(true);
    // Wrong password: never sent to the server for a move.
    post.mockClear();
    await expect(auth.signIn({ email: 'anshu@example.com', password: 'wrong-password' })).rejects.toThrow('Incorrect email or password.');
    expect(post.mock.calls.filter((c) => c[0] === '/auth/register')).toHaveLength(0);
    post.mockRestore();
  });

  it('a phone-only account still signs in when the server can’t take it (offline / email taken)', async () => {
    const local = createAuthService({ hashIterations: 10, serverMode: () => false });
    await local.signUp({ fullName: 'Anshu', email: 'riya@example.com', password: 'long-enough-pw' });
    const post = jest.spyOn(apiClient, 'apiPost').mockImplementation(async (p) => {
      throw Object.assign(new Error(p === '/auth/login' ? 'nope' : 'taken'), { status: p === '/auth/login' ? 401 : 409 });
    });
    const user = await createAuthService({ hashIterations: 10, serverMode: () => true }).signIn({ email: 'riya@example.com', password: 'long-enough-pw' });
    expect(user.authProvider).toBe('email');
    expect(apiClient.hasAuthToken()).toBe(false);
    post.mockRestore();
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
