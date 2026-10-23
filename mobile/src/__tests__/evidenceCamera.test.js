import { createRecordingService } from '../services/recordingService';
import { createEmergencyManager } from '../services/emergencyManager';
import { createEmergencyController } from '../services/emergencyController';
import { memoryStorage, fakeLocation, fakeAlerts, fakeNotifications, fakePermissions, noHaptics } from '../test/fakes';

// Evidence camera: flip / lens switching keeps every video clip; silent photos.

function fakeCamera() {
  let resolve;
  let n = 0;
  return {
    recordAsync: jest.fn(() => new Promise((r) => { resolve = r; })),
    stopRecording: jest.fn(() => { n += 1; resolve({ uri: `file:///cache/clip${n}.mov` }); }),
    takePictureAsync: jest.fn(async () => ({ uri: 'file:///cache/photo.jpg' })),
  };
}

function svc() {
  let n = 0;
  const save = jest.fn(async ({ kind }) => { n += 1; return { status: 'saved', uri: `file:///docs/recordings/s/${kind}-${n}`, bytes: 1000 * n }; });
  return { save, rec: createRecordingService({ save, audioMode: jest.fn(async () => {}), micPermission: { get: jest.fn(async () => ({ granted: true })), request: jest.fn() } }) };
}

describe('evidence camera', () => {
  it('switching camera saves the clip and the next clip starts on the new camera; all clips are kept', async () => {
    const { rec } = svc();
    const cam = fakeCamera();
    rec.attachCamera(cam);
    await rec.startVideo('s');
    const first = await rec.cutVideoClip();
    expect(first.status).toBe('saved');
    rec.setFacing('front');
    await rec.startVideo('s');
    expect(rec.getSnapshot().video.status).toBe('recording');
    const end = await rec.stopAll();
    expect(end.video.clips.map((c) => c.facing)).toEqual(['back', 'front']);
    expect(end.video.clips).toHaveLength(2);
  });

  it('takes a silent photo and saves it privately', async () => {
    const { rec, save } = svc();
    const cam = fakeCamera();
    rec.attachCamera(cam);
    rec.setFacing('front');
    const res = await rec.takePhoto('s');
    expect(cam.takePictureAsync).toHaveBeenCalledWith({ quality: 0.85, shutterSound: false });
    expect(save).toHaveBeenCalledWith({ uri: 'file:///cache/photo.jpg', sessionId: 's', kind: 'photo' });
    expect(res).toMatchObject({ status: 'saved', facing: 'front' });
    expect(rec.getSnapshot().photos).toHaveLength(1);
  });

  it('reports a failed photo instead of pretending', async () => {
    const { rec } = svc();
    expect(await rec.takePhoto('s')).toEqual({ status: 'error', error: 'Camera is not ready.' });
    const cam = fakeCamera();
    cam.takePictureAsync.mockRejectedValue(new Error('Camera is busy'));
    rec.attachCamera(cam);
    expect(await rec.takePhoto('s')).toEqual({ status: 'error', error: 'Camera is busy' });
  });

  it('controller: switch → clip saved and logged; photos stored in the session when it ends', async () => {
    const { rec } = svc();
    const cam = fakeCamera();
    const manager = createEmergencyManager({ storage: memoryStorage() });
    const controller = createEmergencyController({
      manager, recording: rec, location: fakeLocation({ fix: null }), alerts: fakeAlerts(), notifications: fakeNotifications(),
      permissions: fakePermissions(), haptics: noHaptics, platform: 'android',
    });
    controller.setContext({ contacts: [], user: null });
    controller.startEmergency('button');
    rec.attachCamera(cam);
    controller.onCameraReady();
    await Promise.resolve();
    const apply = jest.fn(() => rec.setFacing('front'));
    await controller.changeCamera(apply, 'front camera');
    expect(apply).toHaveBeenCalled();
    expect(manager.getSnapshot().log.map((e) => e.message).join('\n')).toMatch(/Switching to front camera — video continues/);
    controller.onCameraReady();
    await controller.takePhoto();
    const ended = await controller.endEmergency('resolve');
    const r = ended?.recordings ?? manager.getSnapshot().history[0].recordings;
    expect(r.video.clips).toHaveLength(2);
    expect(r.photos).toHaveLength(1);
  });
});
