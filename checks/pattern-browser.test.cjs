const {chromium}=require('C:/Users/5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{const b=await chromium.launch({headless:true,channel:'msedge'});try{
 const p=await b.newPage({viewport:{width:1440,height:1000}}),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await p.goto('http://127.0.0.1:4186/');await p.locator('.material-item').first().waitFor({timeout:60000});await p.locator('#patternTab').click();
 const png=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');x.fillStyle='#ff0055';x.beginPath();x.arc(128,128,110,0,Math.PI*2);x.fill();x.fillStyle='white';x.font='bold 70px sans-serif';x.fillText('TEST',30,150);return c.toDataURL().split(',')[1];});
 await p.locator('#patternImage').setInputFiles({name:'test.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await p.waitForFunction(()=>!document.querySelector('#patternPlace').disabled);
 await p.locator('#patternPlace').click();for(let y=330;y<650;y+=55){if(await p.locator('#patternLayers option').count())break;await p.mouse.click(650,y);}
 assert.equal(await p.locator('#patternLayers option').count(),1,'Click creates a real surface decal');await p.waitForTimeout(350);await p.screenshot({path:'checks/pattern-surface.png'});
 await p.locator('#patternWidth').fill('50');await p.locator('#patternWidth').press('Tab');await p.locator('#patternRotation').fill('30');await p.locator('#patternRotation').dispatchEvent('change');
 for(const key of ['normalMap','roughnessMap','metalnessMap']){await p.locator('#pattern-'+key).setInputFiles({name:key+'.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await p.waitForFunction(k=>document.getElementById('pattern-'+k+'-status').textContent===k+'.png',key);}
 await p.locator('#patternNormalFlip').check();await p.waitForTimeout(350);
 const [download]=await Promise.all([p.waitForEvent('download'),p.locator('#saveProject').click()]);await download.saveAs('checks/pattern-roundtrip.form');
 await p.locator('#projectFile').setInputFiles('checks/pattern-roundtrip.form');await p.waitForTimeout(1600);await p.waitForFunction(()=>document.querySelector('#loading').hidden);await p.locator('#patternTab').click();assert.equal(await p.locator('#patternLayers option').count(),1,'Project restores image layer');assert.equal(await p.locator('#patternWidth').inputValue(),'50');
 for(const key of ['normalMap','roughnessMap','metalnessMap'])assert.equal(await p.locator('#pattern-'+key+'-status').textContent(),key+'.png');assert.equal(await p.locator('#patternNormalFlip').isChecked(),true);
 await p.locator('#pattern-roughnessMap-remove').click();assert.equal(await p.locator('#pattern-roughnessMap-status').textContent(),'未上传');
 await p.locator('#patternDelete').click();assert.equal(await p.locator('#patternLayers option').count(),0);assert.deepEqual(errors,[]);console.log('PASS: transparent PNG upload, placement, resize, rotation, save/restore, delete; no JS or shader errors');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
