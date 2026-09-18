const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'C:/Users/5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:4186/');
  await page.locator('.material-item').first().waitFor({timeout:60000});
  const swatch=await page.locator('.material-thumb').first().boundingBox();
  await page.mouse.move(swatch.x+30,swatch.y+30);await page.mouse.down();await page.waitForTimeout(720);
  const preview=await page.locator('#materialPreview').boundingBox();assert.ok(preview.width>250,'Hold expands preview');
  await page.screenshot({path:'checks/motion-hold.png'});
  await page.mouse.up();await page.waitForTimeout(500);assert.equal(await page.locator('#materialPreview').evaluate(el=>getComputedStyle(el).opacity),'0');
  await page.mouse.move(swatch.x+30,swatch.y+30);await page.mouse.down();await page.mouse.move(500,400,{steps:15});await page.waitForTimeout(300);
  assert.ok((await page.locator('#materialPreview').boundingBox()).width<80,'Drag contracts preview');
  let target=null;
  for(let y=250;y<630&&!target;y+=45)for(let x=340;x<800&&!target;x+=45){await page.mouse.move(x,y);if(await page.locator('#materialDropHint').isVisible())target={x,y};}
  assert.ok(target,'Model is rendered and raycastable');
  await page.screenshot({path:'checks/motion-drag.png'});await page.mouse.up();await page.waitForTimeout(150);
  await page.screenshot({path:'checks/motion-reveal.png'});await page.waitForTimeout(1000);
  assert.equal(await page.locator('#undoMaterial').isDisabled(),false,'Drop replaces material');
  await page.locator('#undoMaterial').click();
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);
  const mobile=await page.locator('.material-thumb').first().boundingBox();await page.mouse.move(mobile.x+30,mobile.y+30);await page.mouse.down();await page.waitForTimeout(750);
  const mr=await page.locator('#materialPreview').boundingBox();assert.ok(mr.x>=0&&mr.x+mr.width<=390,'Mobile preview stays on screen');
  await page.screenshot({path:'checks/motion-mobile.png'});await page.mouse.up();
  const pixels=await page.locator('#canvas').evaluate(canvas=>{const copy=document.createElement('canvas');copy.width=32;copy.height=32;const ctx=copy.getContext('2d');ctx.drawImage(canvas,0,0,32,32);return new Set(ctx.getImageData(0,0,32,32).data).size;});
  assert.ok(pixels>30,'Canvas contains rendered pixels');assert.deepEqual(errors,[]);
  console.log('PASS: hold, release, drag, model drop, undo, mobile framing, canvas pixels, no browser errors');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
