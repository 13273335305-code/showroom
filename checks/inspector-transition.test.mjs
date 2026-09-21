import test from 'node:test';
import assert from 'node:assert/strict';
import { createInspectorTransition, inspectorMorph } from '../shared/inspector-transition.js';

test('panel morph begins at the actual button bounds and ends at the page bounds', () => {
  const icon={x:1180,y:88,width:48,height:41},page={x:900,y:78,width:352,height:520};
  assert.deepEqual(inspectorMorph(icon,page,0),{...icon,radius:9});
  assert.deepEqual(inspectorMorph(icon,page,1),{...page,radius:16});
  assert.deepEqual(inspectorMorph(icon,page,.5),{x:1040,y:83,width:200,height:280.5,radius:12.5});
});

test('panel and framing share continuous progress, including interrupted opening', () => {
  let time=0,callback=null;const frames=[];
  const transition=createInspectorTransition({render:p=>frames.push(p),now:()=>time,requestFrame:fn=>{callback=fn;return 1;},cancelFrame:()=>{callback=null;},reducedMotion:()=>false});
  transition.set(true);time=100;callback(time);
  const intermediate=transition.progress;assert.ok(intermediate>0&&intermediate<1);
  transition.set(false);assert.equal(transition.progress,intermediate);
  time=140;callback(time);assert.ok(transition.progress<intermediate&&transition.progress>0);
  time=900;callback(time);assert.equal(transition.progress,0);assert.equal(transition.active,false);
  transition.set(true);time=1460;callback(time);assert.equal(transition.progress,1);
  assert.ok(frames.every(p=>p>=0&&p<=1));
});
test('reduced motion completes panel and framing together without scheduling frames', () => {
  const values=[];const transition=createInspectorTransition({render:p=>values.push(p),cancelFrame:()=>{},requestFrame:()=>{throw Error('Unexpected animation');},reducedMotion:()=>true});
  transition.set(true);transition.set(false);assert.deepEqual(values,[1,0]);
});
