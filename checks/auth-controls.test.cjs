const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const entries = ['login.html', 'index.html', 'design.html', 'material-editor.html', 'asset-library.html', 'project-library.html', 'model-parts.html'];

(async () => {
  const auth = await fs.readFile(path.join(root, 'shared/auth.js'), 'utf8');
  const quote = String.fromCharCode(96);
  const begin = auth.indexOf('overlay.innerHTML = ' + quote) + ('overlay.innerHTML = ' + quote).length;
  const markup = auth.slice(begin, auth.indexOf(quote + ';', begin));
  const fixtures = await Promise.all(entries.map(async file => {
    const html = await fs.readFile(path.join(root, file), 'utf8');
    const quote = String.fromCharCode(34); const links = html.split('<link ').slice(1).map(tag => tag.split('>')[0]).filter(tag => tag.includes('rel=' + quote + 'stylesheet' + quote)).map(tag => tag.split('href=' + quote)[1].split(quote)[0]);
    assert.ok(links.length, file + ': stylesheet links exist');
    const css = await Promise.all(links.map(href => fs.readFile(path.join(root, href.split('?')[0]), 'utf8')));
    const body = html.split('<body')[1].split('>')[0]; return { file, css: css.join(String.fromCharCode(10)), bodyClass: body.includes('class=' + quote) ? body.split('class=' + quote)[1].split(quote)[0] : '' };
  }));
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      await page.route('**/*', route => route.abort());
      let baseline;
      for (const fixture of fixtures) {
        await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>' + fixture.css + '</style></head><body class="' + fixture.bodyClass + '"><div class="auth-overlay">' + markup + '</div></body></html>');
        await page.locator('#authTabs').evaluate(element => { element.hidden = false; });
        const styles = await page.evaluate(() => {
          const properties = ['appearance', 'display', 'borderRadius', 'borderBottomWidth', 'borderBottomStyle', 'borderBottomColor', 'padding', 'margin', 'backgroundColor', 'color', 'boxShadow', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'height'];
          const snapshot = element => {
            const style = getComputedStyle(element);
            return Object.fromEntries(properties.map(property => [property, style[property]]));
          };
          const login = document.querySelector('#authLoginTab'), register = document.querySelector('#authRegisterTab');
          const initial = [snapshot(login), snapshot(register)];
          login.setAttribute('aria-selected', 'false');
          register.setAttribute('aria-selected', 'true');
          return { initial, switched: [snapshot(login), snapshot(register)], motion: snapshot(document.querySelector('.auth-motion-toggle')) };
        });
        assert.equal(styles.initial[0].borderRadius, '0px', fixture.file + ': straight active underline');
        assert.equal(styles.switched[1].borderRadius, '0px', fixture.file + ': straight registration underline');
        assert.equal(styles.motion.backgroundColor, 'rgba(12, 16, 25, 0.5)', fixture.file + ': dark background control');
        if (baseline) assert.deepEqual(styles, baseline, fixture.file + ': controls match standalone login');
        else baseline = styles;
        console.log('PASS ' + width + 'px ' + fixture.file + ': tab underlines and motion control match');
      }
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
