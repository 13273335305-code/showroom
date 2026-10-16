import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const auth = fs.readFileSync(new URL('../shared/auth.js', import.meta.url), 'utf8');
const files = ['index.html', 'design.html', 'material-editor.html', 'asset-library.html', 'project-library.html', 'model-parts.html'];

test('all protected pages block their initial content before external styles or modules load', () => {
  for (const file of files) {
    const html = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    assert.match(html, /<html[^>]*class="[^"]*\bauth-pending\b/, file);
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
    const guard = head.slice(head.indexOf('<style>'), head.indexOf('</style>'));
    assert.match(guard, /html\.auth-pending body > :not\(#authOverlay\):not\(#authBootLoading\)\s*\{\s*display: none !important;/, file);
    assert.match(html, /id="authBootLoading"[^>]*>[\s\S]*?<span class="auth-intro-hello"[^>]*>Hello<\/span>/, file);
    assert.doesNotMatch(guard, /html\.auth-pending::after/, file + ': no separate pseudo-element greeting');
    assert.ok(head.indexOf('<style>') < head.indexOf('<link'), file + ': guard precedes external styles');
    assert.match(html, /href="login\.css(?:\?[^\"]*)?"/, file + ': overlay stylesheet exists');
  }
});

test('every initial Hello uses identical plain typography and a reduced-motion-aware sweep', () => {
  const css = fs.readFileSync(new URL('../login.css', import.meta.url), 'utf8');
  const block = (source, selector) => {
    const begin = source.indexOf(selector + ' {');
    assert.ok(begin >= 0, selector + ' exists');
    return source.slice(begin + selector.length + 2, source.indexOf('}', begin));
  };
  const properties = source => Object.fromEntries(source.trim().split(';').filter(value => value.trim()).map(value => {
    const colon = value.indexOf(':');
    return [value.slice(0, colon).trim(), value.slice(colon + 1).replace(/\s+/g, ' ').trim()];
  }));
  const sharedType = properties(block(css, '.auth-intro-hello'));
  const sharedSweep = properties(block(css, '.auth-intro-hello::after'));
  for (const file of ['login.html', ...files]) {
    const html = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    const initialType = properties(block(html, '.auth-intro-hello'));
    for (const key of ['position', 'top', 'left', 'transform', 'font', 'letter-spacing', 'color', 'background']) {
      assert.equal(initialType[key], sharedType[key], file + ': ' + key + ' stays unchanged during handoff');
    }
    assert.deepEqual(properties(block(html, '.auth-intro-hello::after')), sharedSweep, file + ': sweep uses the same styles');
    assert.match(html, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.auth-intro-hello::after\s*\{\s*animation: none;/);
    assert.doesNotMatch(block(html, '.auth-intro-hello'), /text-shadow|text-stroke|linear-gradient/);
  }
});

test('starting auth keeps protected content hidden and does not cover a verified session', async () => {
  const begin = auth.indexOf('export async function requireAuth()');
  const end = auth.indexOf('// Hide protected content', begin);
  const factory = new Function('isLoginPage', 'currentIdentity', 'document', 'mountOverlay', 'wireOverlay',
    'let authPromise = null; ' + auth.slice(begin, end).replace('export ', '') + '\nreturn requireAuth;');
  for (const [login, identity, hidden] of [[false, null, true], [true, null, false], [false, {}, false]]) {
    const classes = new Set(); let mounted = 0;
    const requireAuth = factory(login, identity, { documentElement: { classList: { add: key => classes.add(key) } } },
      () => { mounted++; return {}; }, (_, resolve) => resolve('ready'));
    assert.equal(await requireAuth(), 'ready');
    assert.equal(classes.has('auth-pending'), hidden);
    await requireAuth(); assert.equal(mounted, 1, 'Repeated calls reuse the overlay');
  }
});

test('redirects and page snapshots hide protected content before navigation or restore', () => {
  const begin = auth.indexOf('function returnToLogin()');
  const end = auth.indexOf('\nfunction onSessionEvent', begin);
  const events = [], url = new URL('https://example.com/app/login.html');
  const location = { pathname: '/app/design.html', search: '?new=1', hash: '', replace: value => events.push(['replace', value]) };
  new Function('document', 'URL', 'loginUrl', 'isLoginPage', 'location', auth.slice(begin, end) + '\nreturnToLogin();')(
    { documentElement: { classList: { add: key => events.push(['guard', key]) } } }, URL, url, false, location);
  assert.equal(events[0][0], 'guard');
  assert.equal(new URL(events[1][1]).searchParams.get('next'), '/app/design.html?new=1');
  const start = auth.indexOf("window.addEventListener('pagehide'");
  const stop = auth.indexOf('function showVerificationRetry()', start);
  const handlers = new Map(); let guarded = false, reloaded = false;
  new Function('window', 'document', 'isLoginPage', 'location', auth.slice(start, stop))(
    { addEventListener: (key, callback) => handlers.set(key, callback) },
    { documentElement: { classList: { add: () => { guarded = true; } } } }, false,
    { reload: () => { reloaded = true; } });
  handlers.get('pagehide')(); assert.equal(guarded, true);
  handlers.get('pageshow')({ persisted: true }); assert.equal(reloaded, true);
});
