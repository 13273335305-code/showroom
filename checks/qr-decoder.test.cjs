const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const base = process.env.FORM_BASE_URL || 'http://127.0.0.1:4186';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage();
    await page.route('**/__qr_decoder_test__.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>QR decoder regression</title>' }));
    await page.goto(base + '/__qr_decoder_test__.html');
    const results = await page.evaluate(async () => {
      const { fabricQrSvg } = await import('./shared/fabric-label.js');
      const { createQrDecoder } = await import('./shared/qr-decoder.js');
      const ids = ['08d840e1-ef74-4c95-9c7f-eec75fa18f6c', '12345678-abcd-4321-8765-123456789abc'];
      const images = await Promise.all(ids.map(async id => {
        const image = new Image();
        image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(fabricQrSvg(id));
        await image.decode();
        return image;
      }));
      const results = [];
      for (const mode of ['unavailable', 'empty', 'throws']) {
        let nativeCalls = 0;
        Object.defineProperty(window, 'BarcodeDetector', { configurable: true, value: mode === 'unavailable' ? undefined : class {
          static async getSupportedFormats() { return ['qr_code']; }
          async detect() { nativeCalls++; if (mode === 'throws') throw new Error('Native detection failed'); return []; }
        } });
        const decoder = await createQrDecoder();
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const blank = size => { canvas.width = canvas.height = size; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size); };
        try {
          blank(480);
          results.push({ mode, frame: 'initial blank', expected: null, actual: await decoder.decode(canvas) });
          ctx.drawImage(images[0], 92, 92, 296, 296);
          results.push({ mode, frame: 'first label', expected: ids[0], actual: await decoder.decode(canvas) });
          blank(320);
          results.push({ mode, frame: 'resized blank', expected: null, actual: await decoder.decode(canvas) });
          ctx.drawImage(images[1], 12, 12, 296, 296);
          results.push({ mode, frame: 'resized second label', expected: ids[1], actual: await decoder.decode(canvas) });
          results.push({ mode, frame: 'image after canvas', expected: ids[0], actual: await decoder.decode(images[0]) });
          if (mode === 'throws') results.push({ mode, frame: 'failed native detector disabled', expected: 1, actual: nativeCalls });
        } finally { decoder.reset(); }
      }
      return results;
    });
    for (const { mode, frame, expected, actual } of results) assert.equal(actual, expected, mode + ': ' + frame);
    console.log('PASS: QR canvas frames, blank frames, resize, changing labels, image input and native empty/error fallback');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
