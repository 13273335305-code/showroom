let fallbackPromise;
async function zxing() {
  if (!fallbackPromise) fallbackPromise = import('../vendor/zxing/index.min.js').then(() => globalThis.ZXing).catch(error => { fallbackPromise = null; throw error; });
  return fallbackPromise;
}
export async function createQrDecoder() {
  let native;
  try {
    if (globalThis.BarcodeDetector && (await BarcodeDetector.getSupportedFormats()).includes('qr_code')) native = new BarcodeDetector({ formats: ['qr_code'] });
  } catch {}
  let reader;
  if (!native) { const library = await zxing(); reader = new library.BrowserQRCodeReader(); }
  return {
    async decode(source) {
      if (native) {
        try { return (await native.detect(source))[0]?.rawValue || null; }
        catch { native = null; const library = await zxing(); reader = new library.BrowserQRCodeReader(); }
      }
      const library = globalThis.ZXing;
      const bitmap = reader.createBinaryBitmap(source);
      try { return reader.decodeBitmap(bitmap).getText(); }
      catch (error) {
        if (error instanceof library.NotFoundException || error instanceof library.ChecksumException || error instanceof library.FormatException) {
          // A front-facing printed label can be read directly if automatic
          // alignment selected a data pattern instead of the alignment mark.
          try { return new library.QRCodeReader().decode(bitmap, new Map([[library.DecodeHintType.PURE_BARCODE, true]])).getText(); }
          catch (retry) {
            if (retry instanceof library.NotFoundException || retry instanceof library.ChecksumException || retry instanceof library.FormatException) return null;
            throw retry;
          }
        }
        throw error;
      }
    },
    reset() { reader?.reset(); },
  };
}
