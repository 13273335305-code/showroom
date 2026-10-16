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
    assert.ok(!html.includes('auth-intro-hello'), file + ': no login greeting during workspace verification');
    assert.ok(html.includes('aria-label="正在验证登录..."></div>'), file + ': session cover contains no greeting');
    assert.ok(guard.includes('background: var(--auth-boot-background)'), file + ': cover follows the workspace theme');
    assert.doesNotMatch(guard, /html\.auth-pending::after/, file + ': no separate pseudo-element greeting');
    assert.ok(head.indexOf('<style>') < head.indexOf('<link'), file + ': guard precedes external styles');
    assert.match(html, /href="login\.css(?:\?[^\"]*)?"/, file + ': overlay stylesheet exists');
  }
});

test('the login page Hello uses identical plain typography and a reduced-motion-aware thinking wave', () => {
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
  const sharedSweep = properties(block(css, '.auth-intro-hello > span'));
  const waveform = source => source.slice(source.indexOf('@keyframes auth-hello-thinking'), source.indexOf('@keyframes auth-hello-thinking') + 180).match(/@keyframes auth-hello-thinking\s*\{[\s\S]*?\n\s*\}/)?.[0].replace(/\s+/g, ' ');
  assert.equal(sharedSweep.animation, 'auth-hello-thinking 1.8s linear infinite');
  assert.equal(sharedSweep.opacity, '.45');
  for (const file of ['login.html']) {
    const html = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    const initialType = properties(block(html, '.auth-intro-hello'));
    for (const key of ['position', 'top', 'left', 'transform', 'font', 'letter-spacing', 'color', 'background']) {
      assert.equal(initialType[key], sharedType[key], file + ': ' + key + ' stays unchanged during handoff');
    }
    assert.deepEqual(properties(block(html, '.auth-intro-hello > span')), sharedSweep, file + ': thinking wave uses the same styles');
    for (let letter = 2; letter <= 5; letter++) {
      const selector = '.auth-intro-hello > span:nth-child(' + letter + ')';
      assert.deepEqual(properties(block(html, selector)), properties(block(css, selector)), file + ': letter timing matches');
    }
    assert.equal(waveform(html), waveform(css), file + ': waveform stays unchanged');
    assert.match(html, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.auth-intro-hello > span\s*\{\s*animation: none;/);
    assert.doesNotMatch(block(html, '.auth-intro-hello'), /text-shadow|text-stroke|linear-gradient/);
    assert.doesNotMatch(html, /auth-hello-sweep|\.auth-intro-hello::after|clip-path: polygon/);
  }
  assert.match(auth, /class="auth-intro-hello"[^>]*><span>H<\/span><span>e<\/span><span>l<\/span><span>l<\/span><span>o<\/span><\/div>/);
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
