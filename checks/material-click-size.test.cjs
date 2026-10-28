const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: true, reducedMotion: 'no-preference' });
    await require('./project-test-server.cjs').installProjectFixture(context);
    await context.route('**/shared/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export async function requireAuth(){document.documentElement.classList.remove("auth-pending");document.getElementById("authBootLoading")?.remove();} export const authState=()=>({id:"11111111-1111-1111-1111-111111111111"}); export const workspaceClient=async()=>(await import("./project-store.js")).fixtureAccess();' }));
    await context.route('**/app.js', async route => route.fulfill({ contentType: 'text/javascript', body: await fs.readFile(path.join(__dirname, '../app.js'), 'utf8') + `
      window.prepareClickFixture=()=>{entries[0].material.userData.partTypes=new Set(['面布']);configuredMaterialSlots=captureConfiguredMaterialSlots(model,partTypesForMaterial);};
      window.holdApplications=[];
      const originalReplaceCategoryMaterials=replaceCategoryMaterials;
      replaceCategoryMaterials=async(...args)=>{holdApplications.push(performance.now());if(window.failNextHold){window.failNextHold=false;throw new Error('test hold failure');}return originalReplaceCategoryMaterials(...args);};
      window.readClickState=()=>({history:assignmentHistory.length,applying:!!materialApplying,selected:selected?.name,calls:holdApplications.length,starts:holdApplications,holdStarted:draggedMaterial?.hold?.started,phase:draggedMaterial?.phase,transform:document.querySelector('.material-hold-progress')?.style.transform,holdStroke:document.querySelector('.material-hold-value')?.style.strokeWidth,holdInset:document.querySelector('.material-hold-progress')?.style.inset,holdRadius:document.querySelector('.material-hold-value')?.getAttribute('r'),holdDash:document.querySelector('.material-hold-value')?.style.strokeDasharray,holdDashOffset:document.querySelector('.material-hold-value')?.style.strokeDashoffset,holdOpacity:document.querySelector('.material-hold-progress')?.style.opacity,loading:!!document.querySelector('.material-ball.apply-loading'),slots:materialSlotsForPartType('面布').map(({mesh,slot})=>entries.find(entry=>entry.material===slotMaterial(mesh,slot))?.name)});
    ` }));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(new URL('design.html', process.env.FORM_BASE_URL || 'http://127.0.0.1:4186').href);
    await page.waitForFunction(() => document.getElementById('loading').hidden, null, { timeout: 60000 });
    await page.evaluate(async () => {
      prepareClickFixture();
      const { saveAsset } = await import('./shared/asset-store.js');
      const image = await (await fetch('./checks/fabric-no-dpi.png')).blob();
      for (const [name, color] of [['点击测试 A', '#cc3344'], ['点击测试 B', '#3355cc']]) {
        await saveAsset({ kind: 'material', materialType: 'fabric', name, category: '面布', surface: { color, roughness: .6 }, physical: { mode: 'physical', sizeSource: 'manual', widthCm: 30, heightCm: 30, angle: 0, initialized: true }, maps: { map: new File([image], 'fabric.png', { type: 'image/png' }) }, preview: image });
      }
    });
    await page.locator('#addDockAsset').click();
    await page.locator('.picker-card').first().waitFor();
    for (const card of await page.locator('.picker-card').all()) await card.click();
    await page.locator('#confirmAssetPicker').click();
    await page.locator('#assetPicker').waitFor({ state: 'hidden' });
    const material = name => page.locator('#materialList .material-item').filter({ has: page.locator('strong', { hasText: name }) });
    const first = material('点击测试 A'), second = material('点击测试 B');
    const read = () => page.evaluate(() => readClickState());
    const ring = page.locator('.material-hold-progress');
    async function press(button) { await button.locator('.material-thumb').hover(); await page.waitForTimeout(220); await page.mouse.down(); }
    async function release() { await page.mouse.up(); assert.equal(await ring.count(), 0, 'Release clears the hold progress'); }
    await first.locator('.material-thumb').click();
    assert.equal((await read()).calls, 0, 'Short clicks only select the fabric');
    assert.equal((await read()).selected, '点击测试 A');
    assert.equal((await read()).history, 0);
    await page.evaluate(() => {
      window.shortClickRings = 0;
      window.shortClickObserver = new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node.nodeType === 1 && (node.matches('.material-hold-progress') || node.querySelector('.material-hold-progress'))) shortClickRings++;
        }
      });
      shortClickObserver.observe(document.getElementById('materialList'), { childList: true, subtree: true });
    });
    await press(first);
    assert.equal(await ring.count(), 0, 'The click guard starts without mounting a progress ring');
    await page.waitForTimeout(120);
    assert.equal(await ring.count(), 0, 'A selection click stays free of progress during the guard');
    await release();
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => { shortClickObserver.disconnect(); return shortClickRings; }), 0, 'Short clicks never flash a ring or leave a delayed ring');
    assert.equal((await read()).calls, 0, 'A click within the guard only selects');
    await press(first);
    await page.waitForTimeout(400);
    const initialProgress = Number(await ring.getAttribute('aria-valuenow'));
    assert.match(await ring.evaluate(el => getComputedStyle(el).transform), /matrix\(0, -0\.7, 0\.7, 0/, 'The countdown ring stays at seventy percent size');
    assert.ok(initialProgress > 10 && initialProgress < 75, 'Holding shows partial progress before one second');
    assert.equal((await read()).calls, 0, 'Partial hold does not apply');
    assert.equal(await ring.evaluate(el => getComputedStyle(el).transform), 'matrix(0, -0.7, 0.7, 0, 0, 0)', 'The clockwise circle starts at twelve o’clock at seventy percent size');
    const initialOffset = await ring.locator('.material-hold-value').evaluate(el => Number(el.style.strokeDashoffset));
    await page.waitForTimeout(160);
    assert.ok(Number(await ring.getAttribute('aria-valuenow')) > initialProgress, 'Hold progress increases');
    assert.ok(await ring.locator('.material-hold-value').evaluate(el => Number(el.style.strokeDashoffset)) < initialOffset, 'The visible arc grows clockwise');
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'mm06-material-hold.png'), clip: { x: 0, y: 790, width: 650, height: 210 } });
    await ring.evaluate(el => {
      window.holdResetSamples = [];
      window.holdResetObserver = new MutationObserver(records => {
        for (const record of records) if (record.attributeName === 'aria-valuenow') holdResetSamples.push(Number(record.target.getAttribute('aria-valuenow')));
      });
      holdResetObserver.observe(el, { attributes: true, attributeFilter: ['aria-valuenow'] });
    });
    await page.mouse.up();
    assert.equal(await ring.count(), 1, 'Releasing an incomplete hold keeps the ring for its reset animation');
    const resetOffset = await ring.locator('.material-hold-value').evaluate(el => Number(el.style.strokeDashoffset));
    const resetProgress = Number(await ring.getAttribute('aria-valuenow'));
    await page.waitForFunction(() => !document.querySelector('.material-hold-progress'));
    const resetSamples = await page.evaluate(() => { holdResetObserver.disconnect(); return holdResetSamples; });
    assert.ok(resetSamples.some(progress => progress < resetProgress), 'Accessible progress decreases during reset');
    assert.equal(resetSamples.at(-1), 0, 'Reset animation reaches zero before removal');
    assert.ok(resetOffset < 100, 'The released ring had made visible progress');
    await page.waitForTimeout(700);
    assert.equal((await read()).calls, 0, 'Early release cancels the application timer');
    await press(first); await page.waitForTimeout(450); await page.mouse.up();
    assert.equal(await ring.count(), 1, 'Partial progress starts resetting');
    await page.mouse.down();
    assert.equal(await ring.count(), 0, 'Pressing again immediately clears the previous reset ring');
    await page.waitForTimeout(120);
    assert.equal(await ring.count(), 0, 'A new press retains its own click protection');
    await release(); await page.waitForTimeout(350);
    assert.equal(await ring.count(), 0, 'Rapid release and repress leave no ring behind');
    assert.equal((await read()).calls, 0, 'Rapid repress does not accumulate hold time or apply');
    await press(first);
    const completedStarted = (await read()).holdStarted;
    await page.waitForFunction(() => readClickState().phase === 'applied');
    assert.equal(await ring.count(), 1, 'The completed countdown remains visible during the handoff');
    const handoffStart = await read();
    await ring.evaluate(el => { window.handoffRing = el; });
    assert.match(handoffStart.transform, /scale\(0\.7/, 'Handoff begins from the compact ring size');
    assert.ok(Number(handoffStart.holdStroke) >= 5 && Number(handoffStart.holdStroke) < 6);
    assert.ok(Number.parseFloat(handoffStart.holdInset) >= -6.1 && Number.parseFloat(handoffStart.holdInset) < -5.8);
    assert.ok(Number(handoffStart.holdRadius) <= 46 && Number(handoffStart.holdRadius) > 45.7);
    assert.equal(handoffStart.holdOpacity, '', 'The ring does not fade out during the handoff');
    assert.equal(handoffStart.loading, false, 'The loading ring waits for the progress-ring expansion');
    assert.ok(Number(handoffStart.holdDashOffset) < 2, 'The handoff begins with the completed ring tail at its origin');
    assert.equal(await page.locator('.material-ball .material-apply-progress').count(), 0, 'Handoff does not add a second SVG ring');
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'mm06-material-handoff.png'), clip: { x: 0, y: 790, width: 650, height: 210 } });
    const handoffMiddle = await read();
    assert.ok(handoffMiddle.transform !== handoffStart.transform, 'The completed ring expands during handoff');
    assert.ok(Number.parseFloat(handoffMiddle.holdDash) < Number.parseFloat(handoffStart.holdDash), 'The blue arc contracts during handoff');
    assert.ok(Number(handoffMiddle.holdStroke) > 3 && Number(handoffMiddle.holdStroke) < 8, 'Ring stroke grows toward loading-ring thickness');
    assert.ok(Number(handoffMiddle.holdDashOffset) < Number(handoffStart.holdDashOffset), 'The shrinking arc advances clockwise toward its fixed tail');
    assert.ok(Number.parseFloat(handoffMiddle.holdOpacity || '1') > .99, 'The same ring stays fully visible throughout the handoff');
    assert.equal(await page.locator('.material-ball .material-hold-progress').count(), 1, 'The original countdown ring remains mounted while expanding');
    await page.waitForFunction(() => readClickState().loading);
    const handedOff = await ring.count() === 0;
    assert.equal(handedOff, true, 'The expanded progress ring hands off to the rotating loader');
    const handoffLoader = await page.locator('.material-ball .material-apply-progress').evaluate(el => ({ width: getComputedStyle(el).width, height: getComputedStyle(el).height, opacity: getComputedStyle(el).opacity, animation: getComputedStyle(el).animationName, box: el.getBoundingClientRect().toJSON(), value: { radius: el.querySelector('.material-apply-value').getAttribute('r'), dash: getComputedStyle(el.querySelector('.material-apply-value')).strokeDasharray, dashOffset: getComputedStyle(el.querySelector('.material-apply-value')).strokeDashoffset, width: getComputedStyle(el.querySelector('.material-apply-value')).strokeWidth, color: getComputedStyle(el.querySelector('.material-apply-value')).stroke } }));
    assert.equal(handoffLoader.animation, 'materialApplySpin');
    assert.equal(handoffLoader.opacity, '1');
    assert.ok(handoffLoader.box.width > 80 && handoffLoader.box.height > 80, 'The spinning loader remains visible around the sphere');
    assert.equal(handoffLoader.value.radius, '42', 'Conversion restores the loader circle radius');
    assert.equal(handoffLoader.value.dash, '40px, 60px', 'The loading arc preserves the contracted path-length geometry');
    assert.equal(handoffLoader.value.dashOffset, '-60px', 'The loading arc keeps its tail aligned through the rotation handoff');
    assert.equal(handoffLoader.value.width, '8px', 'The loader keeps its full stroke width');
    await page.waitForFunction(() => readClickState().calls === 1);
    assert.ok((await read()).starts[0] - completedStarted >= 995, 'Application waits for a full second');
    assert.equal(await ring.count(), 0, 'Completed hold removes the countdown ring');
    assert.equal((await read()).loading, true, 'The loading ring appears as the full-size countdown ring hands off');
    assert.equal(await page.locator('.material-ball .material-apply-progress').count(), 1, 'The expanded countdown SVG becomes the single loading ring');
    assert.equal(await page.locator('.material-ball .material-apply-progress').evaluate(el => el === handoffRing), true, 'The loading ring reuses the original countdown node');
    assert.equal(await page.locator('.material-ball .material-apply-progress').evaluate(el => getComputedStyle(el).animationName), 'materialApplySpin', 'Rotation starts on the expanded ring without replacing it');
    assert.equal((await read()).phase, 'applied', 'Completed hold remains consumed until release');
    await page.waitForFunction(() => !readClickState().applying && readClickState().slots.every(name => name === '点击测试 A'));
    await page.waitForTimeout(1100);
    assert.equal((await read()).calls, 1, 'Keeping the pointer down applies only once');
    await release();
    assert.equal((await read()).calls, 1, 'Releasing after completion does not apply again');
    assert.equal((await read()).history, 1, 'A completed hold applies to configured model parts');

    async function clickWithoutResize(button, label, hold = false) {
      const thumb = button.locator('.material-thumb');
      await thumb.hover(); await page.waitForTimeout(300);
      await thumb.evaluate(el => {
        window.originalClickThumb = el; window.originalClickButton = el.closest('.material-item');
        window.clickSizes = []; window.sampleClick = true;
        const sample = () => {
          const current = document.querySelector(`[data-entry-id="${originalClickButton.dataset.entryId}"] .material-thumb`);
          if (current) clickSizes.push(current.getBoundingClientRect().width);
          if (sampleClick) requestAnimationFrame(sample);
        }; sample();
      });
      const calls = (await read()).calls;
      if (hold) { await page.mouse.down(); await page.waitForFunction(previous => readClickState().calls === previous + 1, calls); await release(); }
      else await thumb.click();
      await page.waitForFunction(() => !readClickState().applying);
      await page.waitForTimeout(350);
      const result = await page.evaluate(() => {
        sampleClick = false;
        return { buttonPreserved: originalClickButton.isConnected, thumbPreserved: originalClickThumb.isConnected, min: Math.min(...clickSizes), max: Math.max(...clickSizes), frames: clickSizes.length };
      });
      assert.equal(result.buttonPreserved, true, label + ': preserve the material button');
      assert.equal(result.thumbPreserved, true, label + ': preserve the hovered sphere');
      assert.ok(result.frames > 2 && result.max - result.min < .5, label + ': no shrink/regrow across animation frames: ' + JSON.stringify(result));
      assert.equal((await read()).calls, calls + Number(hold), label + ': expected application count');
    }

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (let attempt = 0; attempt < 2; attempt++) await clickWithoutResize(first, width + 'px applied-material click ' + attempt);
      await clickWithoutResize(first, width + 'px applied-material hold', true);
      assert.equal((await page.evaluate(() => readClickState())).history, width === 1440 ? 1 : 3, 'Repeated clicks do not add an assignment');
      await clickWithoutResize(second, width + 'px switch to another material');
      assert.ok((await read()).slots.every(name => name === '点击测试 A'), 'Selecting another material does not apply it');
      await clickWithoutResize(second, width + 'px hold another material', true);
      assert.ok((await page.evaluate(() => readClickState())).slots.every(name => name === '点击测试 B'));
      await clickWithoutResize(first, width + 'px hold the first material again', true);
      assert.ok((await page.evaluate(() => readClickState())).slots.every(name => name === '点击测试 A'));
    }
    await page.locator('#headerUndo').click();
    await page.waitForFunction(() => readClickState().slots.every(name => name === '点击测试 B'));
    assert.equal(await first.getAttribute('aria-pressed'), 'false');
    assert.equal(await second.getAttribute('aria-pressed'), 'true');
    for (const cancel of ['Escape', 'blur', 'pointercancel', 'capture', 'category', 'tab']) {
      const calls = (await read()).calls;
      await press(first); await page.waitForTimeout(350);
      assert.equal(await ring.count(), 1);
      if (cancel === 'Escape') await page.keyboard.press('Escape');
      else if (cancel === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      else if (cancel === 'pointercancel') await first.dispatchEvent('pointercancel', { pointerId: 1 });
      else if (cancel === 'capture') await first.evaluate(el => el.releasePointerCapture(1));
      else if (cancel === 'category') await page.locator('[data-fabric="边布"]').evaluate(el => el.click());
      else await page.locator('#patternDockTab').evaluate(el => el.click());
      await page.waitForFunction(() => !document.querySelector('.material-hold-progress'));
      await page.waitForTimeout(900); await release();
      assert.equal((await read()).calls, calls, cancel + ' cancels pending application');
      assert.ok((await read()).slots.every(name => name === '点击测试 B'));
      if (cancel === 'category') await page.locator('[data-fabric="面布"]').click();
      if (cancel === 'tab') await page.locator('#fabricDockTab').click();
    }
    await page.evaluate(() => { window.failNextHold = true; });
    const failureCalls = (await read()).calls;
    await press(first);
    await page.waitForFunction(previous => readClickState().calls === previous + 1 && !readClickState().applying, failureCalls);
    await release();
    assert.equal(await page.locator('.material-ball.apply-loading').count(), 0, 'A failed application clears the loading state');
    assert.ok((await read()).slots.every(name => name === '点击测试 B'), 'A failed hold does not change model assignments');
    await clickWithoutResize(first, 'Retry after failure', true);
    assert.ok((await read()).slots.every(name => name === '点击测试 A'));

    const touch = await context.newCDPSession(page);
    await second.scrollIntoViewIfNeeded();
    const box = await second.locator('.material-thumb').boundingBox(), point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const touchCalls = (await read()).calls;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.waitForTimeout(120);
    assert.equal(await ring.count(), 0, 'A short touch also respects the click guard');
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(350);
    assert.equal(await ring.count(), 0, 'Releasing a short touch cancels delayed progress');
    assert.equal((await read()).calls, touchCalls, 'A short touch does not apply');
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.waitForTimeout(450);
    await ring.evaluate(el => {
      window.touchResetSamples = [];
      window.touchResetObserver = new MutationObserver(records => {
        for (const record of records) if (record.attributeName === 'aria-valuenow') touchResetSamples.push(Number(record.target.getAttribute('aria-valuenow')));
      });
      touchResetObserver.observe(el, { attributes: true, attributeFilter: ['aria-valuenow'] });
    });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.equal(await ring.count(), 1, 'Touch release also animates partial progress back to zero');
    await page.waitForFunction(() => !document.querySelector('.material-hold-progress'));
    const touchSamples = await page.evaluate(() => { touchResetObserver.disconnect(); return touchResetSamples; });
    assert.ok(touchSamples.some(progress => progress < 50), 'Touch progress reverses after release');
    assert.equal(touchSamples.at(-1), 0, 'Touch reset reaches zero before removal');
    assert.equal((await read()).calls, touchCalls, 'Reset animation does not apply the fabric');
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.waitForTimeout(300);
    assert.equal(await ring.count(), 1, 'Real touch displays hold progress');
    assert.equal((await read()).calls, touchCalls, 'Touch does not apply early');
    await page.waitForFunction(previous => readClickState().calls === previous + 1, touchCalls);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => !readClickState().applying && readClickState().slots.every(name => name === '点击测试 B'));
    assert.equal((await read()).calls, touchCalls + 1, 'Real touch hold applies exactly once');
    assert.equal(await ring.count(), 0);
    assert.equal(await page.locator('#materialPreview').evaluate(el => getComputedStyle(el).opacity), '0', 'Holding never opens the removed large preview');
    await second.locator('.material-thumb').evaluate(el => { window.updatedClickThumb = el; });
    await page.locator('#compactColor').fill('#33aa55');
    assert.equal(await second.locator('.material-thumb').evaluate(el => el === updatedClickThumb && el.style.backgroundColor === 'rgb(51, 170, 85)'), true, 'Color changes update the existing sphere');
    await page.locator('[data-fabric="边布"]').click();
    assert.equal(await page.locator('#materialList .material-item').count(), 0);
    await page.locator('[data-fabric="面布"]').click();
    assert.equal(await page.locator('#materialList .material-item').count(), 2);
    await page.locator('#dockTrash').click();
    assert.equal(await second.isDisabled(), true, 'The applied fabric stays protected from deletion');
    await first.locator('.material-thumb').click();
    assert.equal(await page.locator('#dockDeleteCount').textContent(), '1', 'Reused buttons bind selection handlers only once');
    await first.locator('.material-thumb').click();
    assert.equal(await page.locator('#dockDeleteSelected').isDisabled(), true, 'A second click clears the deletion selection');
    await page.locator('#dockCancelDelete').click();
    assert.equal(await second.getAttribute('aria-pressed'), 'true', 'Leaving removal mode restores current selection');
    await page.locator('#dockTrash').click();
    await first.locator('.material-thumb').click();
    await page.locator('#dockDeleteSelected').click();
    assert.equal(await first.count(), 0);
    assert.equal(await second.count(), 1);
    assert.deepEqual(errors, []);
    console.log('PASS: one-second mouse/touch hold with clockwise progress, selection-only clicks, early-release/Escape/blur/pointercancel/capture/category/tab cancellation, once-per-hold application, failure/retry, stable nodes and frame sizes at 1440/390px, material switching, undo, color updates, deletion and no browser errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
