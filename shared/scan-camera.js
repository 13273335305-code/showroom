// Device labels become available after permission is granted. Prefer a physical
// rear main/wide camera over the multi-lens or auxiliary cameras on phones.
export function preferredRearCamera(devices) {
  const rear = /back|rear|environment|后置|后摄|背面|arrière|rück/i;
  const front = /front|facetime|前置|前摄/i;
  const auxiliary = /ultra[\s-]*wide|超广|telephoto|\btele\b|长焦|望远|depth|景深|macro|微距/i;
  const score = device => {
    const label = device.label || '';
    return (/main|primary|主摄|主相机|主镜头/i.test(label) ? 80 : 0)
      + (/wide|广角/i.test(label) ? 30 : 0)
      + (/\b0\b/i.test(label) ? 10 : 0)
      - (auxiliary.test(label) ? 200 : 0)
      - (/dual|triple|双摄|三摄|virtual|logical|逻辑/i.test(label) ? 100 : 0);
  };
  return devices.filter(device => device.kind === 'videoinput' && device.deviceId && rear.test(device.label) && !front.test(device.label) && !auxiliary.test(device.label))
    .sort((a, b) => score(b) - score(a))[0] || null;
}

export async function openRearCamera(mediaDevices, isCurrent) {
  const stop = stream => stream?.getTracks().forEach(track => track.stop());
  const size = { width: { ideal: 720 }, height: { ideal: 720 } };
  const request = video => mediaDevices.getUserMedia({ audio: false, video: { ...size, ...video } });
  let stream;
  try {
    try { stream = await request({ facingMode: { exact: 'environment' } }); }
    catch (error) {
      if (!isCurrent()) return null;
      if (!['OverconstrainedError', 'NotFoundError'].includes(error.name)) throw error;
      stream = await request({ facingMode: { ideal: 'environment' } });
    }
    if (!isCurrent()) { stop(stream); return null; }
    const devices = await mediaDevices.enumerateDevices().catch(() => []);
    if (!isCurrent()) { stop(stream); return null; }
    const preferred = preferredRearCamera(devices);
    const originalId = stream.getVideoTracks()[0]?.getSettings().deviceId;
    if (preferred && preferred.deviceId !== originalId) {
      stop(stream); stream = null;
      try { stream = await request({ deviceId: { exact: preferred.deviceId } }); }
      catch (error) {
        if (!isCurrent()) return null;
        if (error.name === 'NotAllowedError') throw error;
        stream = await request(originalId ? { deviceId: { exact: originalId } } : { facingMode: { ideal: 'environment' } });
      }
    }
    if (!isCurrent()) { stop(stream); return null; }
    return stream;
  } catch (error) { stop(stream); throw error; }
}
