import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const permission = source.slice(source.indexOf('function canRemoveDockItem('), source.indexOf('function prepareRemoval('));
const removal = source.slice(source.indexOf('function removeUnusedDockItems('), source.indexOf('function bindDesignWorkspace('));

function fixture() {
  const used = { material: {}, meshes: new Set([{}]) }, unused = { material: {}, meshes: new Set() };
  const origin = {}, disposed = [], detached = [];
  const placed = { mesh: { geometry: { dispose: () => disposed.push('geometry') }, material: { dispose: () => disposed.push('material') } } };
  const entries = [used, unused], patterns = [placed], sources = [origin];
  const controller = new Function('entries', 'patterns', 'patternSources', 'selectedPattern', 'disposed', 'detached', `
    const loadingModel=false,model={},scene={remove:mesh=>detached.push(mesh)};
    let selected=entries[0],selectedDesignPattern={pattern:selectedPattern};
    let assignmentHistory=[{previous:entries[1].material},{previous:entries[0].material}];
    const prepareRemoval=()=>{},disposeSource=s=>disposed.push(s),disposePatternMaps=p=>disposed.push('maps');
    const $=()=>({}),selectEntry=e=>{selected=e;},showPanel=()=>{},renderMaterials=()=>{},renderDesignPatterns=()=>{},renderPatternList=()=>{};
    ${permission}\n${removal}
    return {canRemove:canRemoveDockItem,remove:removeUnusedDockItems,state:()=>({patterns,patternSources,selectedPattern,selectedDesignPattern,assignmentHistory})};
  `)(entries, patterns, sources, placed, disposed, detached);
  return { controller, used, unused, origin, placed, disposed, detached };
}

test('applied fabric is protected, while both pattern sources and placed patterns can be deleted', () => {
  const f=fixture();
  assert.equal(f.controller.canRemove({entry:f.used}),false);
  assert.equal(f.controller.canRemove({entry:f.unused}),true);
  assert.equal(f.controller.canRemove({source:f.origin}),true);
  assert.equal(f.controller.canRemove({pattern:f.placed}),true);
  assert.equal(f.controller.remove([{entry:f.used},{pattern:f.placed},{pattern:f.placed}]),1);
  assert.deepEqual(f.detached,[f.placed.mesh]);
  assert.deepEqual(f.disposed,['geometry','maps','material']);
  assert.equal(f.controller.state().patterns.length,0);
  assert.equal(f.controller.state().selectedPattern,null);
  assert.equal(f.controller.state().selectedDesignPattern,null);
  assert.equal(f.used.removed,undefined);
  assert.equal(f.controller.state().patternSources.length,1);
});

test('deleting a source preserves placed copies and deleting unused fabric trims unsafe undo history', () => {
  const f=fixture();
  assert.equal(f.controller.remove([{source:f.origin},{entry:f.unused}]),2);
  assert.equal(f.unused.removed,true);
  assert.deepEqual(f.controller.state().patterns,[f.placed]);
  assert.equal(f.controller.state().patternSources.length,0);
  assert.deepEqual(f.controller.state().assignmentHistory,[{previous:f.used.material}]);
  assert.deepEqual(f.detached,[]);
});

test('pointer drops on the deletion area remove eligible items and reject applied fabric', () => {
  const start=source.indexOf(" document.addEventListener('pointerup',event=>{",source.indexOf('function bindMaterialDrop()'));
  const end=source.indexOf(" document.addEventListener('pointercancel'",start);
  const pointerHandler=source.slice(start,end);
  const hitTest=source.slice(source.indexOf('function overDockTrash('),source.indexOf('function bindMaterialDrop('));
  for(const kind of ['unused','applied','source','placed']){
    const f=fixture(),messages=[],events={};
    const entry=kind==='applied'?f.used:f.unused;
    const patternTarget=kind==='source'?{source:f.origin}:kind==='placed'?{pattern:f.placed}:null;
    const doc={addEventListener:(name,fn)=>{events[name]=fn;},querySelector:()=>({getBoundingClientRect:()=>({left:1000,right:1066,top:500,bottom:650})})};
    const result=new Function('document','entry','patternTarget','canRemoveDockItem','removeUnusedDockItems','notify',`
      let draggedMaterial={entry,patternTarget,pointerId:1,phase:'dragging',generation:3},suppressMaterialClick=false;
      const modelGeneration=3,endMaterialDrag=()=>{draggedMaterial=null;};
      ${hitTest}\n${pointerHandler}
      return ()=>({draggedMaterial,suppressMaterialClick});
    `)(doc,entry,patternTarget,f.controller.canRemove,f.controller.remove,m=>messages.push(m));
    events.pointerup({pointerId:1,clientX:1030,clientY:560});
    assert.equal(result().draggedMaterial,null);
    assert.equal(result().suppressMaterialClick,true);
    if(kind==='applied')assert.equal(f.used.removed,undefined);
    if(kind==='unused')assert.equal(f.unused.removed,true);
    if(kind==='source')assert.equal(f.controller.state().patternSources.length,0);
    if(kind==='placed')assert.equal(f.controller.state().patterns.length,0);
    assert.equal(messages.length,1);
  }
});
