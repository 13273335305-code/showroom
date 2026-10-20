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
  const ensureReader = async () => {
    if (!reader) { const library = await zxing(); reader = new library.BrowserQRCodeReader(); }
    return reader;
  };
  return {
    async decode(source) {
      if (native) {
        try {
          const value = (await native.detect(source)).find(result => result?.rawValue)?.rawValue;
          if (value) return value;
        } catch { native = null; }
      }
      await ensureReader();
      const library = globalThis.ZXing;
      // BrowserQRCodeReader only captures image/video elements; camera crops
      // are canvases and must be read directly to preserve their dimensions.
      const bitmap = source instanceof HTMLCanvasElement
        ? new library.BinaryBitmap(new library.HybridBinarizer(new library.HTMLCanvasElementLuminanceSource(source)))
        : reader.createBinaryBitmap(source);
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
