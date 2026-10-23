import { createEvidenceService, contentTypeFor } from '../services/evidenceService';
import { createRecordingService } from '../services/recordingService';
import { createAlertService, buildAlertPayload } from '../services/alertService';

// SOS → WhatsApp: location text at once, then audio/video clips every 30 s.

describe('evidence on WhatsApp', () => {
  function setup() {
    const logs = [];
    let tickFn = null;
    const recording = { rotate: jest.fn(async () => ({ audio: { uri: 'file:///d/audio-1.m4a' }, video: { uri: 'file:///d/video-1.mov' }, front: null })) };
    const upload = jest.fn(async () => ({ sentTo: 2 }));
    const svc = createEvidenceService({
      recording, upload, log: (m, l) => logs.push([m, l]),
      setTimer: (fn) => { tickFn = fn; return 1; }, clearTimer: jest.fn(), sleep: async () => {},
    });
    return { svc, recording, upload, logs, tick: () => tickFn() };
  }

  it('every 30 s saves the recording so far and sends audio + video clips', async () => {
    const t = setup();
    t.svc.start('sess-1');
    await t.tick();
    await t.svc.finish({ audio: { uri: 'file:///d/audio-2.m4a' }, video: { uri: 'file:///d/video-2.mov' } });
    expect(t.upload.mock.calls.map((c) => [c[0], c[2]])).toEqual([
      ['/alerts/sess-1/media?kind=audio&part=1', 'audio/mp4'],
      ['/alerts/sess-1/media?kind=video&part=1', 'video/quicktime'],
      ['/alerts/sess-1/media?kind=audio&part=2', 'audio/mp4'],
      ['/alerts/sess-1/media?kind=video&part=2', 'video/quicktime'],
    ]);
    expect(t.logs.map((l) => l[0])).toContain('🎙 Audio clip 1 sent on WhatsApp to 2 contacts');
  });

  it('retries network failures, gives up on permanent errors, and logs honestly', async () => {
    const t = setup();
    t.upload
      .mockRejectedValueOnce(Object.assign(new Error('No internet'), { code: 'NETWORK' }))
      .mockResolvedValueOnce({ sentTo: 1 })
      .mockRejectedValueOnce(Object.assign(new Error('WhatsApp is not configured on the server.'), { status: 409 }));
    t.svc.start('s');
    await t.tick();
    await t.svc.finish({});
    expect(t.upload).toHaveBeenCalledTimes(3);
    const msgs = t.logs.map((l) => l[0]).join('\n');
    expect(msgs).toMatch(/Audio clip 1 sent on WhatsApp to 1 contact\b/);
    expect(msgs).toMatch(/Video clip 1 not sent: WhatsApp is not configured/);
  });

  it('content types match the files', () => {
    expect(contentTypeFor('file:///a/x.m4a', 'audio')).toBe('audio/mp4');
    expect(contentTypeFor('file:///a/x.mov', 'video')).toBe('video/quicktime');
    expect(contentTypeFor('file:///a/x.mp4', 'video')).toBe('video/mp4');
  });
});

describe('recording rotation', () => {
  it('saves audio so far and keeps recording, without losing earlier parts', async () => {
    let n = 0;
    const save = jest.fn(async ({ kind }) => { n += 1; return { status: 'saved', uri: `file:///docs/${kind}-${n}.m4a`, bytes: 100 }; });
    const rec = createRecordingService({
      save, audioMode: jest.fn(async () => {}),
      micPermission: { get: jest.fn(async () => ({ granted: true })), request: jest.fn() },
    });
    const recorder = { uri: 'file:///cache/rec.m4a', prepareToRecordAsync: jest.fn(async () => {}), record: jest.fn(), stop: jest.fn(async () => {}), addListener: jest.fn(() => ({ remove: jest.fn() })) };
    rec.attachAudioRecorder(recorder);
    await rec.startAudio('s');
    const parts = await rec.rotate('s');
    expect(parts.audio).toEqual({ uri: 'file:///docs/audio-1.m4a', bytes: 100 });
    expect(recorder.record).toHaveBeenCalledTimes(2);
    expect(rec.getSnapshot().audio.status).toBe('recording');
    const end = await rec.stopAudio();
    expect(end.parts.map((p) => p.uri)).toEqual(['file:///docs/audio-1.m4a', 'file:///docs/audio-2.m4a']);
  });
});

describe('alert result knows WhatsApp is on', () => {
  it('passes the server channels through', async () => {
    const payload = buildAlertPayload({ session: { id: 's', startedAt: '2026-10-22T05:00:00.000Z', triggerSource: 'button' }, location: null, contacts: [{ id: 'c1', name: 'Asha', phoneNumber: '+919876543210' }], user: null });
    const post = jest.fn(async () => ({ channels: { sms: false, whatsapp: true }, recipients: [{ contactId: 'c1', status: 'sent', whatsapp: { status: 'sent', error: null } }] }));
    const res = await createAlertService({ post, apiConfigured: () => true }).sendAutomatic(payload);
    expect(res.whatsapp).toBe(true);
    expect(res.recipients[0].whatsapp).toEqual({ status: 'sent', error: null });
  });
});
