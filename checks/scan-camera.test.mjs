import test from 'node:test';
import assert from 'node:assert/strict';
import { preferredRearCamera, openRearCamera } from '../shared/scan-camera.js';

const camera = (deviceId, label) => ({ kind: 'videoinput', deviceId, label });
const stream = deviceId => {
  const track = { stopped: false, stop() { this.stopped = true; }, getSettings: () => ({ deviceId }) };
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
};
test('prefers a rear main/wide physical camera over front, ultra-wide, telephoto and virtual devices', () => {
  for (const devices of [
    [camera('front', 'Front Camera'), camera('ultra', 'Back Ultra Wide Camera'), camera('tele', 'Back Telephoto'), camera('virtual', 'Back Triple Camera'), camera('main', 'Back Wide Angle Camera')],
    [camera('front', '前置主摄'), camera('ultra', '后置超广角'), camera('tele', '后置长焦'), camera('main', '后置主摄')],
    [camera('other', 'camera2 2, facing back'), camera('main', 'camera2 0, facing back')]
  ]) assert.equal(preferredRearCamera(devices).deviceId, 'main');
  assert.equal(preferredRearCamera([camera('front', 'Front Main'), camera('unknown', ''), camera('aux', 'Back Ultra Wide')]), null);
});
test('requests rear first, then switches to the labelled main camera and releases the original stream', async () => {
  const original = stream('ultra'), main = stream('main'), requests = [];
  const result = await openRearCamera({
    async getUserMedia(constraints) { requests.push(constraints); return requests.length === 1 ? original : main; },
    async enumerateDevices() { return [camera('ultra', 'Back Ultra Wide'), camera('main', 'Back Main')]; }
  }, () => true);
  assert.deepEqual(requests[0].video.facingMode, { exact: 'environment' });
  assert.deepEqual(requests[1].video.deviceId, { exact: 'main' });
  assert.equal(original.track.stopped, true); assert.equal(result, main);
});
test('desktop cameras fall back when strict rear selection is unavailable', async () => {
  const available = stream('desktop'), requests = [];
  const result = await openRearCamera({
    async getUserMedia(constraints) {
      requests.push(constraints);
      if (requests.length === 1) throw Object.assign(new Error(), { name: 'OverconstrainedError' });
      return available;
    }, async enumerateDevices() { return [camera('desktop', 'USB Camera')]; }
  }, () => true);
  assert.equal(result, available); assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].video.facingMode, { ideal: 'environment' });
});
test('permission denial is reported without repeated permission requests', async () => {
  let calls = 0;
  await assert.rejects(openRearCamera({ async getUserMedia() { calls++; throw Object.assign(new Error(), { name: 'NotAllowedError' }); } }, () => true), { name: 'NotAllowedError' });
  assert.equal(calls, 1);
});
test('closing during acquisition releases the late stream', async () => {
  let current = true; const late = stream('late');
  const result = await openRearCamera({ async getUserMedia() { current = false; return late; } }, () => current);
  assert.equal(result, null); assert.equal(late.track.stopped, true);
});
test('closing while switching to the main lens releases both camera streams', async () => {
  let current = true, calls = 0; const original = stream('ultra'), late = stream('main');
  const result = await openRearCamera({
    async getUserMedia() { if (++calls === 1) return original; current = false; return late; },
    async enumerateDevices() { return [camera('main', 'Back Main')]; }
  }, () => current);
  assert.equal(result, null); assert.equal(original.track.stopped, true); assert.equal(late.track.stopped, true);
});
test('a main lens that cannot open falls back to the original camera', async () => {
  const original = stream('rear'), fallback = stream('rear'); let calls = 0;
  const result = await openRearCamera({
    async getUserMedia() { calls++; if (calls === 2) throw Object.assign(new Error(), { name: 'NotReadableError' }); return calls === 1 ? original : fallback; },
    async enumerateDevices() { return [camera('main', 'Back Main')]; }
  }, () => true);
  assert.equal(result, fallback); assert.equal(original.track.stopped, true);
});
