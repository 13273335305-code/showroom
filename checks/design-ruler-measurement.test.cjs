const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const origin = 'http://127.0.0.1:4186';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.route(origin + '/**', async route => {
      const name = decodeURIComponent(new URL(route.request().url()).pathname).slice(1);
      try {
        await route.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }[path.extname(name)] || 'application/octet-stream', body: await fs.readFile(path.join(root, name)) });
      } catch { await route.fulfill({ status: 404, body: '' }); }
    });
    await require('./project-test-server.cjs').installProjectFixture(context);
    await context.route('**/shared/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export async function requireAuth(){document.documentElement.classList.remove("auth-pending");document.getElementById("authBootLoading")?.remove();} export const authState=()=>({id:"11111111-1111-1111-1111-111111111111"}); export const workspaceClient=async()=>(await import("./project-store.js")).fixtureAccess();' }));
    await context.route('**/app.js', async route => route.fulfill({ contentType: 'text/javascript', body: await fs.readFile(path.join(root, 'app.js'), 'utf8') + `
      window.rulerFixture = {
        read() {
          const rulerMeasurePoints = currentRulerMeasurement()?.points || [];
          const metrics = rulerMeasurementMetrics();
          const point = rulerMeasurePoints[0];
          const projected = point ? rulerMeasurePointWorld(point, 0).clone().project(camera) : null;
          const projectedB = metrics?.second.clone().project(camera);
          const rect = $('viewport').getBoundingClientRect();
          return { groups: rulerMeasurements.map(group => { const metrics = rulerMeasurementMetrics(group); return { id: group.id, note: group.note || '', count: group.points.length, axis: metrics?.axis, deltas: metrics?.physicalDelta.toArray(), distance: metrics?.distance }; }), historyCount: rulerUndoHistory.length, count: rulerMeasurePoints.length, enabled: controls.enabled, materialUndoCount: assignmentHistory.length, undoMaterial: rulerFixture.undoMesh && slotMaterial(rulerFixture.undoMesh,0).uuid, camera: camera.position.toArray(), zoomDistance: camera.position.distanceTo(controls.target), distance: metrics?.distance, axis: metrics?.axis, deltas: metrics?.physicalDelta.toArray(), projected: projected && { x: (projected.x*.5+.5)*rect.width, y: (-projected.y*.5+.5)*rect.height }, projectedB: projectedB && { x: (projectedB.x*.5+.5)*rect.width, y: (-projectedB.y*.5+.5)*rect.height } };
        },
        reset() { clearRulerMeasurement({ silent: true }); },
        seedMaterialUndo() {
          const mesh = rulerFixture.undoMesh || (rulerFixture.undoMesh = [...entries[0].meshes][0]);
          const previous = slotMaterial(mesh,0), replacement = entries.find(entry => entry.material !== previous).material;
          assignMaterial(mesh,0,replacement); rebuildMaterialUsage(model,entries);
          assignmentHistory.push({ mesh, slot: 0, previous }); $('undoMaterial').disabled = false;
          return { previous: previous.uuid, replacement: replacement.uuid };
        },
        setPair(delta) {
          clearRulerMeasurement({ silent: true });
          const mesh = rulerFixture.mesh || (rulerFixture.mesh = [...entries[0].meshes][0]);
          mesh.updateWorldMatrix(true, false);
          const first = mesh.localToWorld(new THREE.Vector3());
          addRulerMeasurementPoint({ mesh, point: first });
          addRulerMeasurementPoint({ mesh, point: first.clone().add(new THREE.Vector3(...delta)) });
        },
        guideEnds() {
          const box = new THREE.Box3().setFromObject(model);
          const first = rulerMeasurePointWorld(currentRulerMeasurement().points[0], 0).clone();
          const rect = $('viewport').getBoundingClientRect();
          return ['x', 'y', 'z'].flatMap(axis => [1, -1].map(direction => {
            const end = first.clone(); end[axis] = direction > 0 ? box.max[axis] : box.min[axis];
            end.project(camera);
            return { axis, direction, x: (end.x*.5+.5)*rect.width, y: (-end.y*.5+.5)*rect.height };
          }));
        },
        targets() {
          const rect = $('canvas').getBoundingClientRect(), result = [];
          for (let y = rect.height*.3; y < rect.height-250; y += 35) {
            for (let x = rect.width*.25; x < rect.width-430; x += 40) {
              if (document.elementFromPoint(x,y) === $('canvas') && pickModelMaterial(x,y)) result.push({x,y});
            }
          }
          return result;
        }
      };
    ` }));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/design.html');
    await page.waitForFunction(() => document.getElementById('loading').hidden && !document.getElementById('dayCycle').disabled, null, { timeout: 60000 });
    await page.locator('#fitView').click();
    await page.locator('#rulerPanel').waitFor({ state: 'visible' });
    const read = () => page.evaluate(() => rulerFixture.read());
    const targets = () => page.evaluate(() => rulerFixture.targets());
    const guides = page.locator('.ruler-guides');
    const recordedPoints = () => page.locator('.ruler-point-badge').evaluateAll(badges => badges.map(badge => badge.dataset.recorded));
    const guideAnimationCount = () => guides.evaluate(el => el.getAnimations({ subtree: true }).length);
    async function assertGuideOrigin() {
      const positions = await page.evaluate(() => {
        const expected = rulerFixture.read().projected;
        return [...document.querySelectorAll('.ruler-guides [data-guide-direction]')].map(ray => {
          const matrix = ray.transform.baseVal.consolidate().matrix;
          return { x: matrix.e, y: matrix.f, expected };
        });
      });
      for (const point of positions) assert.ok(Math.abs(point.x-point.expected.x) < 1 && Math.abs(point.y-point.expected.y) < 1, 'All guide rays originate at hotspot A');
    }
    async function assertGuideBounds() {
      const ends = await page.evaluate(() => rulerFixture.guideEnds());
      const rays = await guides.locator('[data-guide-direction]').evaluateAll(elements => elements.map(ray => {
        const line = ray.querySelector('line'), matrix = ray.transform.baseVal.consolidate().matrix;
        const length = Number(line.getAttribute('x2'));
        return { axis: ray.parentElement.dataset.guideAxis, direction: Number(ray.dataset.guideDirection), x: matrix.e+matrix.a*length, y: matrix.f+matrix.b*length, dash: getComputedStyle(line).strokeDasharray };
      }));
      for (const ray of rays) {
        const expected = ends.find(end => end.axis === ray.axis && end.direction === ray.direction);
        assert.ok(Math.hypot(ray.x-expected.x, ray.y-expected.y) < 1, 'Both directions extend to the model boundary on '+ray.axis);
        assert.equal(ray.dash, '5px, 5px', 'Both directions use the same dashed line');
      }
    }
    async function assertDistanceLabel() {
      const drawn = await page.locator('.ruler-measure-distance').evaluate(label => {
        const line = label.parentElement.querySelector('.ruler-measure-line');
        return { x: Number(label.getAttribute('x')), y: Number(label.getAttribute('y')), midX: (Number(line.getAttribute('x1'))+Number(line.getAttribute('x2')))/2, midY: (Number(line.getAttribute('y1'))+Number(line.getAttribute('y2')))/2, text: label.textContent, expected: rulerFixture.read().distance.toFixed(1)+' cm' };
      });
      assert.ok(Math.hypot(drawn.x-drawn.midX,drawn.y-drawn.midY) < .2, 'Distance stays centered on the measurement line');
      assert.equal(drawn.text, drawn.expected, 'The measurement line displays the current physical distance');
      assert.equal(await page.locator('.ruler-card-distance').textContent(),drawn.expected,'The card distance follows the same measurement and Shift constraint');
    }
    assert.equal((await read()).enabled, true, 'Ruler mode keeps OrbitControls enabled');
    assert.equal(await page.locator('#rulerPanel .section-heading > span').count(),0,'The displacement subtitle is removed');
    assert.equal(await page.locator('#rulerMeasureHint').count(),0,'The helper text is removed');
    const axesToggle=page.locator('#rulerAxesToggle');
    assert.equal(await axesToggle.getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('.ruler-line:not([hidden]), .ruler-label:not([hidden]), .ruler-origin:not([hidden])').count(),7,'XYZ ruler lines, labels and origin are visible by default');
    await axesToggle.click();
    assert.equal(await axesToggle.getAttribute('aria-pressed'),'false');
    assert.equal(await page.locator('.ruler-line:not([hidden]), .ruler-label:not([hidden]), .ruler-origin:not([hidden])').count(),0,'The switch hides the XYZ ruler');
    await axesToggle.click();
    assert.equal(await axesToggle.getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('.ruler-line:not([hidden]), .ruler-label:not([hidden]), .ruler-origin:not([hidden])').count(),7);
    assert.equal(await page.locator('#rulerDistanceCard, #rulerDistanceLabel, #rulerDistance').count(), 0, 'The distance stays on the measurement line');
    assert.deepEqual(await recordedPoints(), ['false', 'false']);
    assert.equal(await page.locator('.ruler-point-status-a, .ruler-point-status-b, .ruler-measure-number').count(),0,'Cards omit recording messages and group numbers');
    assert.deepEqual(await page.locator('.ruler-point-badge text').allTextContents(), ['A','B']);
    assert.equal(await page.locator('.ruler-measure-card .ruler-components').count(), 1, 'Point states and deltas share one card');
    assert.deepEqual(await page.locator('.ruler-components b').allTextContents(), ['—', '—', '—']);
    assert.equal(await page.locator('.ruler-card-distance').textContent(),'—');
    assert.equal(await page.locator('.ruler-measure-note').isDisabled(),true,'Empty cards do not accept notes');
    assert.equal(await page.locator('.ruler-delete').isDisabled(), true, 'There is no empty group to delete');
    assert.equal(await page.locator('#rulerUndo, #rulerClear').count(), 0, 'The measurement panel has no undo or clear buttons');
    assert.equal(await page.locator('#headerUndo').isDisabled(), true);
    await page.keyboard.down('Shift');
    assert.equal(await guides.isVisible(), false, 'Shift alone does not show guides without point A');
    await page.keyboard.up('Shift');
    const initialTargets = await targets();
    assert.ok(initialTargets.length > 1, 'Real model surfaces are available for clicking');
    const first = initialTargets[Math.floor(initialTargets.length / 2)];
    await page.mouse.click(first.x, first.y);
    assert.equal((await read()).count, 1);
    assert.deepEqual(await recordedPoints(), ['true', 'false']);
    assert.equal(await page.locator('.ruler-measure-point:not([hidden])').count(), 1);
    const hotspot = page.locator('.ruler-measure-point-a');
    assert.equal(await hotspot.isVisible(), true, 'First click leaves a visible hotspot');
    assert.ok(Number(await hotspot.getAttribute('r')) > 0, 'Hotspot has a visible radius');
    assert.equal(await page.locator('.ruler-measure-point-b').isVisible(), false);
    assert.equal(await page.locator('.ruler-measure-line').isVisible(), false);
    assert.equal(await page.locator('.ruler-measure-distance').isVisible(), false, 'Distance appears only after selecting both points');
    assert.equal(await page.locator('.ruler-card-distance').textContent(),'—');
    assert.equal(await page.locator('.ruler-measure-note').isEnabled(),true,'Notes can be entered after selecting the first point');
    assert.equal(await page.locator('#headerUndo').isDisabled(), false);
    assert.match(await page.locator('#headerUndo').getAttribute('aria-label'), /撤销测量/);
    await page.locator('#headerUndo').click();
    assert.equal((await read()).count, 0, 'The header undo button removes point A in ruler mode');
    assert.deepEqual(await recordedPoints(), ['false', 'false']);
    assert.equal(await hotspot.isVisible(), false);
    assert.equal(await page.locator('#headerUndo').isDisabled(), true);
    await page.mouse.click(first.x, first.y);
    await page.keyboard.press('Control+z');
    assert.equal((await read()).count, 0, 'Ctrl+Z removes point A');
    await page.keyboard.press('Control+z');
    assert.equal((await read()).count, 0, 'Undo with empty history leaves the scene unchanged');
    await page.mouse.click(first.x, first.y);
    await page.keyboard.press('Control+Shift+z');
    assert.equal((await read()).count, 1, 'The redo shortcut does not undo points');
    await page.evaluate(() => {
      const input = document.createElement('input'); input.id = 'rulerUndoInput';
      input.style.cssText = 'position:fixed;left:20px;top:220px;z-index:100';
      document.body.append(input); input.focus();
    });
    await page.keyboard.type('draft'); await page.keyboard.press('Control+z');
    assert.notEqual(await page.locator('#rulerUndoInput').inputValue(), 'draft', 'Text fields retain native text undo');
    assert.equal((await read()).count, 1, 'Text undo does not remove a measurement point');
    await page.evaluate(() => {
      document.getElementById('rulerUndoInput').remove();
      const editor = document.createElement('div'); editor.id = 'rulerUndoEditor'; editor.contentEditable = 'true';
      editor.style.cssText = 'position:fixed;left:20px;top:220px;z-index:100';
      document.body.append(editor); editor.focus();
    });
    await page.keyboard.type('draft'); await page.keyboard.press('Control+z');
    assert.equal((await read()).count, 1, 'Editable content retains native text undo');
    await page.evaluate(() => document.getElementById('rulerUndoEditor').remove());
    await page.keyboard.down('Shift');
    assert.equal(await guides.isVisible(), true, 'Shift shows axes after selecting the first point');
    assert.equal(await guides.locator('[data-guide-axis]').count(), 3);
    assert.equal(await guides.locator('line').count(), 6, 'Each axis extends in both directions');
    assert.equal(await guides.locator('text, polyline').count(), 0, 'Guide axes have no labels or arrowheads');
    assert.equal(await guideAnimationCount(), 0, 'Reduced motion shows guides immediately');
    await assertGuideOrigin();
    await assertGuideBounds();
    assert.equal((await read()).count, 1);
    assert.equal((await read()).enabled, true);
    await fs.mkdir(path.join(root, '.codex-project-check'), { recursive: true });
    await page.screenshot({ path: path.join(root, '.codex-project-check/ruler-a-guides.png') });
    await page.keyboard.up('Shift');
    assert.equal(await guides.isVisible(), false, 'Releasing Shift hides the first-point guides');
    const original = await read();
    await page.mouse.move(first.x, first.y); await page.mouse.down();
    await page.mouse.move(first.x + 85, first.y + 25, { steps: 12 }); await page.mouse.up();
    await page.waitForTimeout(350);
    const rotated = await read();
    assert.notDeepEqual(rotated.camera, original.camera, 'Dragging rotates the view after recording a point');
    assert.equal(rotated.count, 1, 'Rotation does not record another point');
    await page.keyboard.down('Shift');
    await assertGuideOrigin();
    await page.mouse.move(first.x, first.y); await page.mouse.down();
    await page.mouse.move(first.x+30, first.y+12, { steps: 6 }); await page.mouse.up();
    assert.equal((await read()).enabled, true, 'Showing axes keeps camera interaction enabled');
    assert.notDeepEqual((await read()).camera, rotated.camera, 'Shift-drag can still move the camera');
    assert.equal((await read()).count, 1);
    await assertGuideOrigin();
    await assertGuideBounds();
    await page.keyboard.up('Shift');
    const beforeZoom = await read();
    await page.mouse.move(first.x, first.y); await page.mouse.wheel(0, -180);
    await page.waitForTimeout(350);
    const zoomed = await read();
    assert.ok(Math.abs(zoomed.zoomDistance-beforeZoom.zoomDistance) > .01, 'Wheel zoom remains enabled');
    assert.equal(zoomed.count, 1);
    await page.waitForFunction(() => {
      const expected = rulerFixture.read().projected, point = document.querySelector('.ruler-measure-point-a');
      return Math.abs(Number(point.getAttribute('cx'))-expected.x) < 1 && Math.abs(Number(point.getAttribute('cy'))-expected.y) < 1;
    });
    assert.ok(Math.hypot(zoomed.projected.x-original.projected.x, zoomed.projected.y-original.projected.y) > 1, 'Hotspot follows the model when the camera moves');
    await page.mouse.move(first.x, first.y); await page.mouse.down();
    await page.mouse.move(first.x+70, first.y, { steps: 8 });
    await page.mouse.move(first.x, first.y, { steps: 8 }); await page.mouse.up();
    assert.equal((await read()).count, 1, 'Dragging away and back is not a measurement click');
    const nextTargets = await targets(), second = nextTargets[0];
    assert.ok(second);
    await page.mouse.click(second.x, second.y);
    assert.equal((await read()).count, 2);
    assert.deepEqual(await recordedPoints(), ['true', 'true']);
    assert.equal(await page.locator('.ruler-measure-point:not([hidden])').count(), 2);
    assert.equal(await page.locator('.ruler-measure-line').isVisible(), true);
    assert.equal(await page.locator('.ruler-measure-distance').isVisible(), true);
    await assertDistanceLabel();
    const measured = await read(); assert.ok(measured.distance > 0);
    const noteInput=page.locator('.ruler-measure-note');
    await noteInput.fill('床垫长边');
    await noteInput.press('End');await noteInput.pressSequentially(' draft');
    await noteInput.press('Control+z');
    assert.notEqual(await noteInput.inputValue(),'床垫长边 draft','Note fields retain native text undo');
    assert.equal((await read()).count,2,'Text undo does not remove measurement points');
    await noteInput.fill('床垫长边');await page.locator('.ruler-card-distance').click();
    const axes = ['x', 'y', 'z'];
    async function assertAxisMeasurement(axis, free) {
      const result = await read(), main = axes.indexOf(axis);
      assert.equal(result.axis, axis);
      assert.deepEqual(await recordedPoints(), ['true', 'true']);
      for (let i = 0; i < 3; i++) assert.ok(Math.abs(result.deltas[i]-(i === main ? free.deltas[i] : 0)) < 1e-8, 'Only the dominant signed displacement remains');
      assert.ok(Math.abs(result.distance-Math.abs(free.deltas[main])) < 1e-8);
      assert.equal(await page.locator('.ruler-measure-distance').getAttribute('aria-label'), axis.toUpperCase()+' 轴长度 '+result.distance.toFixed(1)+' cm');
      await assertDistanceLabel();
      assert.equal(await page.locator('.ruler-measurement').getAttribute('data-axis'), axis);
      const drawn = await page.evaluate(() => {
        const point = document.querySelector('.ruler-measure-point-b'), line = document.querySelector('.ruler-measure-line');
        return { point: { x: Number(point.getAttribute('cx')), y: Number(point.getAttribute('cy')) }, line: { x: Number(line.getAttribute('x2')), y: Number(line.getAttribute('y2')) }, expected: rulerFixture.read().projectedB };
      });
      assert.ok(Math.abs(drawn.point.x-drawn.expected.x) < 1 && Math.abs(drawn.point.y-drawn.expected.y) < 1, 'B hotspot uses the constrained position');
      assert.deepEqual(drawn.line, drawn.point, 'Line and hotspot use the same measurement endpoint');
    }
    const dominant = axes[measured.deltas.map(Math.abs).indexOf(Math.max(...measured.deltas.map(Math.abs)))];
    await page.keyboard.down('Shift');
    await assertAxisMeasurement(dominant, measured);
    await page.keyboard.up('Shift');
    assert.equal((await read()).axis, null, 'Releasing Shift restores a free measurement');
    assert.deepEqual(await recordedPoints(), ['true', 'true']);
    assert.equal(await noteInput.inputValue(),'床垫长边','Shift updates preserve custom notes');
    assert.ok(Math.abs((await read()).distance-measured.distance) < 1e-8);
    await page.mouse.wheel(0, 160); await page.waitForTimeout(300);
    assert.ok(Math.abs((await read()).distance-measured.distance) < 1e-6, 'Changing the view preserves the physical distance');
    assert.equal((await read()).count, 2);
    await assertDistanceLabel();
    await fs.mkdir(path.join(root, '.codex-project-check'), { recursive: true });
    await page.screenshot({ path: path.join(root, '.codex-project-check/ruler-hotspots.png') });
    await page.evaluate(() => rulerFixture.reset());
    assert.equal((await read()).count, 0);
    assert.equal(await hotspot.isVisible(), false);
    assert.equal(await page.locator('.ruler-measure-line').isVisible(), false);
    for (const delta of [[1,.03,.02], [.02,-1,.03], [.03,.02,-1], [0,0,0]]) {
      await page.evaluate(delta => rulerFixture.setPair(delta), delta);
      const free = await read();
      const expected = axes[delta.map(Math.abs).indexOf(Math.max(...delta.map(Math.abs)))];
      await page.keyboard.down('Shift');
      await assertAxisMeasurement(expected, free);
      for (let i = 0; i < 3; i++) if (axes[i] !== expected) assert.equal(await page.locator('[data-ruler-delta='+axes[i]+']').textContent(), '+0.00 cm');
      await page.keyboard.up('Shift');
      assert.equal((await read()).axis, null);
      assert.ok(Math.abs((await read()).distance-free.distance) < 1e-8);
    }
    await page.evaluate(() => rulerFixture.setPair([1,.03,.02]));
    const beforeBlur = await read();
    await page.keyboard.down('Shift');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal((await read()).axis, null, 'Leaving the window clears the temporary Shift constraint');
    assert.ok(Math.abs((await read()).distance-beforeBlur.distance) < 1e-8);
    await page.keyboard.up('Shift');
    await page.evaluate(() => rulerFixture.reset());
    const clickTargets = await targets();
    assert.ok(clickTargets.length > 1);
    const startPoint = clickTargets[Math.floor(clickTargets.length / 2)], endPoint = clickTargets[0];
    await page.mouse.click(startPoint.x, startPoint.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(endPoint.x, endPoint.y);
    const locked = await read();
    assert.ok(axes.includes(locked.axis), 'Shift-click on B commits the axis constraint');
    assert.equal(await guides.isVisible(), false, 'Completing the second point hides the construction guides');
    await page.keyboard.up('Shift');
    assert.equal((await read()).axis, locked.axis, 'Shift-click measurement stays constrained after releasing Shift');
    assert.ok(Math.abs((await read()).distance-locked.distance) < 1e-8);
    assert.equal((await read()).enabled, true);
    await page.screenshot({ path: path.join(root, '.codex-project-check/ruler-axis-constraint.png') });
    await page.mouse.click(startPoint.x, startPoint.y);
    assert.equal((await read()).count, 1, 'A third click starts a new measurement');
    assert.equal((await read()).groups.length, 2, 'Starting the next group preserves the previous measurement');
    assert.equal((await read()).groups[0].distance, locked.distance);
    assert.equal(await page.locator('.ruler-measure-point:not([hidden])').count(), 3);
    assert.equal(await page.locator('.ruler-measure-card').count(), 2);
    await page.keyboard.press('Control+z');
    assert.equal((await read()).count, 2, 'Undo restores the preceding pair after starting another measurement');
    assert.equal((await read()).axis, locked.axis, 'Restoring a pair also restores its committed axis');
    assert.ok(Math.abs((await read()).distance-locked.distance) < 1e-6);
    await page.keyboard.down('Shift');
    await page.locator('#headerUndo').click();
    assert.equal((await read()).count, 1, 'Undo removes B while retaining A');
    assert.deepEqual(await recordedPoints(), ['true', 'false']);
    assert.equal(await page.locator('.ruler-measure-distance').isVisible(), false);
    assert.deepEqual(await page.locator('.ruler-components b').allTextContents(), ['—', '—', '—'], 'Undoing B clears the displayed deltas');
    assert.equal(await guides.isVisible(), true, 'Undoing B with Shift held restores the first-point guides');
    await page.keyboard.up('Shift');
    await page.keyboard.press('Control+z');
    assert.equal((await read()).count, 0, 'The next undo removes A');
    assert.equal(await page.locator('#headerUndo').isDisabled(), true);
    await page.evaluate(() => rulerFixture.reset());
    assert.equal((await read()).count, 0);
    assert.equal(await page.locator('.ruler-measure-distance').isVisible(), false);
    const groupTargets = await targets();
    const noteTexts=['床垫长边','床垫短边','侧边高度','结构距离','轴向长度 📏'];
    for (let i = 0; i < 5; i++) {
      const a = groupTargets[Math.floor(groupTargets.length*(i+1)/7)], b = groupTargets[Math.floor(groupTargets.length*(6-i)/7)];
      await page.mouse.click(a.x,a.y);
      assert.equal((await read()).groups.length, i+1);
      assert.equal((await read()).count, 1);
      if(i===4)await page.keyboard.down('Shift');
      await page.mouse.click(b.x,b.y);
      if(i===4)await page.keyboard.up('Shift');
      assert.equal((await read()).count, 2, 'The fifth group can still record its second point');
      await page.locator('.ruler-measure-note').nth(i).fill(noteTexts[i]);
      await page.locator('.ruler-card-distance').nth(i).click();
    }
    const fiveGroups = (await read()).groups;
    assert.equal(fiveGroups.length, 5);
    assert.equal(await page.locator('.ruler-measure-card').count(), 5);
    assert.equal(await page.locator('.ruler-measure-line:not([hidden])').count(), 5);
    assert.equal(await page.locator('.ruler-measure-distance:not([hidden])').count(), 5);
    assert.equal(await page.locator('.ruler-measure-point:not([hidden])').count(), 10);
    assert.deepEqual(await page.locator('.ruler-measure-point-label').allTextContents(), [...'ABCDEFGHIJ']);
    assert.deepEqual(await page.locator('.ruler-point-badge text').allTextContents(), [...'ABCDEFGHIJ'],'Inspector and model use the same sequential letters');
    const badges=await page.locator('.ruler-point-badge').evaluateAll(elements=>elements.map(badge=>{
      const circle=badge.querySelector('circle'),text=badge.querySelector('text');
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=getComputedStyle(text).font;
      const ink=ctx.measureText(text.textContent),rect=badge.getBoundingClientRect();
      const box=badge.viewBox.baseVal,cx=Number(circle.getAttribute('cx')),cy=Number(circle.getAttribute('cy')),r=Number(circle.getAttribute('r'));
      const head=badge.closest('.ruler-measure-card-head').getBoundingClientRect();
      return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,dx:Number(text.getAttribute('x'))-ink.width/2+(ink.actualBoundingBoxRight-ink.actualBoundingBoxLeft)/2-cx,dy:Number(text.getAttribute('y'))+(ink.actualBoundingBoxDescent-ink.actualBoundingBoxAscent)/2-cy,room:Math.min(cx-r-box.x,cy-r-box.y,box.x+box.width-cx-r,box.y+box.height-cy-r),overflow:getComputedStyle(badge).overflow,inside:rect.left>=head.left&&rect.right<=head.right&&rect.top>=head.top&&rect.bottom<=head.bottom};
    }));
    for(let i=0;i<badges.length;i++){
      assert.ok(Math.abs(badges[i].dx)<.5&&Math.abs(badges[i].dy)<.5,'Letter '+String.fromCharCode(65+i)+' ink is visually centered inside the circle: '+JSON.stringify(badges[i]));
      assert.ok(Math.abs(badges[i].width-badges[i].height)<.1,'Point badges remain circular');
      assert.ok(badges[i].room>=1,'Circles have space inside the SVG viewport for edge antialiasing');
      assert.equal(badges[i].overflow,'visible','Badge edges can render without being clipped');
      assert.equal(badges[i].inside,true,'The card does not clip the badges');
      if(i%2===0){assert.ok(Math.abs(badges[i].y-badges[i+1].y)<.1,'Each pair is arranged horizontally');assert.ok(badges[i+1].x>badges[i].x+badges[i].width);}
    }
    assert.deepEqual(await page.locator('.ruler-measure-distance').allTextContents(),fiveGroups.map(group=>group.distance.toFixed(1)+' cm'),'Each group displays its own distance');
    assert.deepEqual(await page.locator('.ruler-card-distance').allTextContents(),fiveGroups.map(group=>group.distance.toFixed(1)+' cm'),'Each card displays its own distance');
    assert.deepEqual(fiveGroups.map(group=>group.note),noteTexts,'Each note belongs to its measurement group');
    const heads=await page.locator('.ruler-measure-card-head').evaluateAll(elements=>elements.map(head=>{
      const points=head.querySelector('.ruler-point-list').getBoundingClientRect(),distance=head.querySelector('.ruler-card-distance').getBoundingClientRect(),note=head.querySelector('.ruler-measure-note').getBoundingClientRect(),remove=head.querySelector('.ruler-delete').getBoundingClientRect();
      return {ordered:points.right<note.left&&note.right<distance.left&&distance.right<remove.left,noteWidth:note.width,removeRight:remove.right,headRight:head.getBoundingClientRect().right,overflow:head.scrollWidth>head.clientWidth+1};
    }));
    for(const head of heads){assert.equal(head.ordered,true,'Points, distance, note and delete button appear in order without overlap');assert.ok(head.noteWidth>=60,'Notes have enough room to edit');assert.ok(Math.abs(head.removeRight-head.headRight+12)<1,'Delete buttons stay aligned to the card right edge');assert.equal(head.overflow,false);}
    assert.ok(new Set(heads.map(head=>head.noteWidth.toFixed(2))).size===1,'All measurement notes use the same fixed width');
    const bottom=await page.locator('.ruler-measure-card').last().evaluate(card=>({card:card.getBoundingClientRect().bottom,panel:card.closest('.panel-scroll').getBoundingClientRect().bottom}));
    assert.ok(bottom.card<=bottom.panel+1,'A newly added group is scrolled into view');
    const rows = await page.locator('.ruler-components').evaluateAll(elements => elements.map(row => {
      const cells=[...row.children].map(cell=>cell.getBoundingClientRect());
      const value=row.querySelector('b').getBoundingClientRect(), label=row.firstElementChild.getBoundingClientRect();
      return { tops: cells.map(cell=>cell.top), inline: value.left>label.left+10, overflow: row.scrollWidth>row.clientWidth+1 };
    }));
    for(const row of rows){
      assert.ok(Math.max(...row.tops)-Math.min(...row.tops)<1, 'All three deltas stay on one row');
      assert.equal(row.inline,true, 'Each delta value sits beside its label');
      assert.equal(row.overflow,false, 'The delta row fits the inspector');
    }
    const fullHistory=(await read()).historyCount;
    await page.mouse.click(groupTargets[0].x,groupTargets[0].y);
    assert.deepEqual((await read()).groups,fiveGroups,'The sixth group does not replace an existing group');
    assert.equal((await read()).historyCount,fullHistory,'Rejected clicks do not consume undo steps');
    await page.keyboard.press('Control+z');
    assert.equal((await read()).groups.length,5);
    assert.equal((await read()).count,1,'Undo at the limit removes only the fifth B point');
    assert.equal(await page.locator('.ruler-measure-note').last().inputValue(),noteTexts[4],'Undoing a point preserves the note');
    const finalB=groupTargets[Math.floor(groupTargets.length*2/7)];
    await page.keyboard.down('Shift');await page.mouse.click(finalB.x,finalB.y);await page.keyboard.up('Shift');
    assert.equal((await read()).count,2);
    await page.screenshot({path:path.join(root,'.codex-project-check/ruler-five-groups.png')});
    const beforeDelete=(await read()).groups;
    const deletedId=beforeDelete[1].id;
    await page.locator('.ruler-measure-card').nth(1).locator('.ruler-delete').click();
    assert.deepEqual((await read()).groups,beforeDelete.filter(group=>group.id!==deletedId),'Deleting a middle group preserves the remaining measurements');
    assert.deepEqual(await page.locator('.ruler-point-badge text').allTextContents(), [...'ABCDEFGH']);
    assert.deepEqual(await page.locator('.ruler-measure-point-label').allTextContents(), [...'ABCDEFGH'],'Letters stay synchronized after deleting a pair');
    assert.equal(await page.locator('.ruler-measure-point:not([hidden])').count(),8);
    assert.equal(await page.locator('.ruler-measurement[data-measurement-id="'+deletedId+'"]').count(),0,'Deleting a card also removes its hotspots and line');
    await page.keyboard.press('Control+z');
    assert.deepEqual((await read()).groups,beforeDelete,'Ctrl+Z restores the deleted group in its original position');
    assert.deepEqual(await page.locator('.ruler-measure-note').evaluateAll(inputs=>inputs.map(input=>input.value)),noteTexts,'Restoring a deleted group restores its note');
    assert.deepEqual(await page.locator('.ruler-measure-point-label').allTextContents(), [...'ABCDEFGHIJ']);
    assert.equal(await page.locator('.ruler-measure-line:not([hidden])').count(),5);
    await page.locator('.ruler-measure-card').nth(1).locator('.ruler-delete').click();
    await page.mouse.click(groupTargets[0].x,groupTargets[0].y);
    await page.keyboard.down('Shift');
    assert.equal(await guides.isVisible(),true,'A new group gets its own first-point guides');
    assert.equal((await read()).groups.length,5,'Deleting a group frees a slot');
    const pending=(await read()).groups;
    await page.locator('.ruler-measure-card').last().locator('.ruler-delete').click();
    assert.equal(await guides.isVisible(),false,'Deleting an unfinished group hides its guides');
    assert.equal((await read()).groups.length,4);
    await page.keyboard.up('Shift');
    await page.keyboard.press('Control+z');
    await page.keyboard.down('Shift');
    assert.deepEqual((await read()).groups,pending,'Undo restores an unfinished deleted group');
    assert.equal(await guides.isVisible(),true);
    await page.mouse.click(groupTargets[groupTargets.length-1].x,groupTargets[groupTargets.length-1].y);
    await page.keyboard.up('Shift');
    assert.equal((await read()).groups.length,5);
    assert.equal((await read()).count,2,'The replacement group can be completed');
    const beforeTemporaryShift=(await read()).groups;
    await page.keyboard.down('Shift');
    assert.deepEqual((await read()).groups.slice(0,-1),beforeTemporaryShift.slice(0,-1),'Temporary Shift measurements leave earlier groups unchanged');
    await page.keyboard.up('Shift');
    await page.locator('#fitView').click();await page.locator('#fitView').click();
    assert.equal(await page.locator('.ruler-measure-line:not([hidden])').count(),5,'All groups remain after toggling ruler mode');
    for(let i=0;i<5;i++)await page.locator('.ruler-measure-card').first().locator('.ruler-delete').click();
    assert.equal((await read()).groups.length,0);
    assert.equal(await page.locator('.ruler-measurement').count(),0);
    assert.equal(await page.locator('.ruler-delete').isDisabled(),true);
    await page.keyboard.press('Control+z');
    assert.equal((await read()).groups.length,1,'Deleting the final group can also be undone');
    await page.evaluate(() => rulerFixture.reset());
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const finalTargets = await targets(), finalPoint = finalTargets[Math.floor(finalTargets.length / 2)];
    assert.ok(finalPoint);
    await page.mouse.click(finalPoint.x, finalPoint.y);
    await page.keyboard.down('Shift');
    assert.equal(await guides.isVisible(), true);
    const animation = await guides.evaluate(el => {
      const animations = el.getAnimations({ subtree: true });
      const stroke = animations.find(animation => animation.effect.target.classList.contains('ruler-guide-stroke'));
      for (const animation of animations) { animation.pause(); animation.currentTime = 40; }
      return { count: animations.length, duration: stroke?.effect.getTiming().duration, frames: stroke?.effect.getKeyframes().map(frame => frame.clipPath) };
    });
    assert.equal(animation.count, 6, 'Six guide rays reveal from point A');
    assert.equal(animation.duration, 160);
    assert.notEqual(animation.frames[0], animation.frames[1], 'Axis strokes reveal outward through a clip');
    await page.screenshot({ path: path.join(root, '.codex-project-check/ruler-a-guides-growing.png') });
    await page.keyboard.up('Shift');
    assert.equal(await guides.isVisible(), false);
    assert.equal(await guideAnimationCount(), 0, 'Releasing Shift cancels the in-progress reveal');
    await page.keyboard.down('Shift');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal(await guides.isVisible(), false, 'Leaving the window hides first-point axes');
    assert.equal(await guideAnimationCount(), 0);
    await page.keyboard.up('Shift');
    await page.keyboard.down('Shift'); await page.locator('#fitView').click();
    assert.equal(await guides.isVisible(), false, 'Exiting ruler mode immediately hides the guide axes');
    assert.equal(await guideAnimationCount(), 0);
    await page.keyboard.up('Shift');
    await page.evaluate(() => rulerFixture.reset());
    const materialAction = await page.evaluate(() => rulerFixture.seedMaterialUndo());
    await page.waitForFunction(() => !document.getElementById('headerUndo').disabled);
    await page.locator('#fitView').click();
    assert.equal(await page.locator('#headerUndo').isDisabled(), true, 'Ruler mode uses its own history even when a material undo exists');
    const lastTargets = await targets(), lastPoint = lastTargets[Math.floor(lastTargets.length / 2)];
    await page.mouse.click(lastPoint.x, lastPoint.y);
    await page.keyboard.press('Meta+z');
    assert.equal((await read()).count, 0, 'Command+Z also undoes measurement points');
    assert.equal((await read()).materialUndoCount, 1, 'Point undo preserves material history');
    assert.equal((await read()).undoMaterial, materialAction.replacement);
    assert.equal(await page.locator('#headerUndo').isDisabled(), true);
    await page.mouse.click(lastPoint.x, lastPoint.y);
    await page.evaluate(() => rulerFixture.reset());
    assert.equal(await page.locator('#headerUndo').isDisabled(), true, 'A model reset discards measurement history');
    await page.keyboard.press('Control+z');
    assert.equal((await read()).count, 0);
    assert.equal((await read()).materialUndoCount, 1, 'An empty ruler history never falls through to material undo');
    await page.locator('#fitView').click();
    assert.equal(await page.locator('#headerUndo').isDisabled(), false, 'Leaving ruler mode restores the material undo button');
    await page.locator('#headerUndo').click();
    assert.equal((await read()).materialUndoCount, 0);
    assert.equal((await read()).undoMaterial, materialAction.previous, 'Material undo retains its original behavior');
    assert.deepEqual(errors, []);
    console.log('PASS: unclipped letter badges, card distances and editable notes, five measurement groups, deletion and undo, Shift constraints, camera interaction and guides');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
