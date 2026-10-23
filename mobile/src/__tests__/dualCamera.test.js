import { createRecordingService } from '../services/recordingService';

// Front + back at once (custom iPhone build). The native view is faked; this
// checks the app side: both files saved, honest errors, interruptions kept.

function svc() {
  let n = 0;
  const save = jest.fn(async ({ uri }) => { n += 1; return { status: 'saved', uri: `file:///docs/recordings/s/video-${n}`, bytes: 1000 * n, from: uri }; });
  const rec = createRecordingService({ save, audioMode: jest.fn(async () => {}), micPermission: { get: jest.fn(), request: jest.fn() } });
  return { rec, save };
}

function fakeDual(result = { back: { uri: 'file:///tmp/back.mov' }, front: { uri: 'file:///tmp/front.mov' } }) {
  return {
    startRecording: jest.fn(async () => {}),
    stopRecording: jest.fn(async () => result),
    takePicture: jest.fn(async () => ({ uri: 'file:///tmp/p.jpg' })),
  };
}

describe('dual camera recording', () => {
  it('records front and back together and saves both', async () => {
    const { rec, save } = svc();
    const dual = fakeDual();
    rec.attachDualCamera(dual);
    expect(rec.isCameraAttached()).toBe(true);
    await rec.startVideo('s');
    expect(dual.startRecording).toHaveBeenCalled();
    expect(rec.getSnapshot().video.status).toBe('recording');
    const v = await rec.stopVideo();
    expect(save.mock.calls.map((c) => c[0].uri)).toEqual(['file:///tmp/back.mov', 'file:///tmp/front.mov']);
    expect(v).toMatchObject({ status: 'saved', uri: 'file:///docs/recordings/s/video-1', front: { status: 'saved', uri: 'file:///docs/recordings/s/video-2' } });
  });

  it('reports a missing front file honestly and still keeps the back video', async () => {
    const { rec } = svc();
    rec.attachDualCamera(fakeDual({ back: { uri: 'file:///tmp/back.mov' }, front: { error: 'Camera in use by another app' } }));
    await rec.startVideo('s');
    const v = await rec.stopVideo();
    expect(v.status).toBe('saved');
    expect(v.front).toMatchObject({ status: 'error', error: 'Camera in use by another app' });
  });

  it('a start failure is an error, never "recording"', async () => {
    const { rec } = svc();
    const dual = fakeDual();
    dual.startRecording.mockRejectedValue(new Error('The cameras are not ready yet.'));
    rec.attachDualCamera(dual);
    await rec.startVideo('s');
    expect(rec.getSnapshot().video).toMatchObject({ status: 'error', error: 'The cameras are not ready yet.' });
  });

  it('an interruption saves what was captured', async () => {
    const { rec } = svc();
    rec.attachDualCamera(fakeDual());
    await rec.startVideo('s');
    await rec.onDualInterrupted();
    expect(rec.getSnapshot().video).toMatchObject({ status: 'saved', interrupted: true });
  });

  it('photos come from the dual camera', async () => {
    const { rec } = svc();
    const dual = fakeDual();
    rec.attachDualCamera(dual);
    expect((await rec.takePhoto('s')).status).toBe('saved');
    expect(dual.takePicture).toHaveBeenCalled();
  });
});
