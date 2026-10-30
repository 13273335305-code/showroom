import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../vendor/three/build/three.module.js';
import { applySurface, readSurface } from '../shared/material-data.js';

const source = await readFile(new URL('../entries/material-editor.js', import.meta.url), 'utf8');
const controllerSource = (await readFile(new URL('../vendor/three/addons/controls/OrbitControls.js', import.meta.url), 'utf8')).replace("from 'three'", "from '" + new URL('../vendor/three/build/three.module.js', import.meta.url).href + "'");
const { OrbitControls } = await import('data:text/javascript;base64,' + Buffer.from(controllerSource).toString('base64'));

test('sphere mode moves the real camera while lights and sphere stay fixed, then restores flat view', () => {
  const oldDocument = globalThis.document;
  globalThis.document = {addEventListener(){}, removeEventListener(){}};
  const dom = {style:{}, clientWidth:800, clientHeight:600, addEventListener(){}, removeEventListener(){}, setPointerCapture(){}, releasePointerCapture(){}, getRootNode(){return this;}, getBoundingClientRect(){return {left:0,top:0,width:800,height:600};}};
  const camera = new THREE.PerspectiveCamera(35, 4/3, .1, 2000); camera.position.set(8, 4, 120);
  const controls = new OrbitControls(camera, dom); controls.target.set(8,4,0); controls.update(); controls.enableDamping = true;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry()), sheenBall = new THREE.Mesh(new THREE.SphereGeometry(24));
  const scene = new THREE.Scene(), light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(80,150,150); scene.add(light, sheenBall);
  const elements = new Map(), buttons = ['flat','ball'].map(mode => ({dataset:{previewMode:mode}, setAttribute(key,value){this[key]=value;}}));
  const $ = id => { if (!elements.has(id)) elements.set(id, {setAttribute(key,value){this[key]=value;}}); return elements.get(id); };
  const selection = {querySelectorAll(){return buttons;}};
  const start = source.indexOf('  const setPreviewMode = ball => {'), end = source.indexOf("  document.querySelectorAll('[data-preview-mode]').forEach(button => { button.onclick", start);
  const setPreviewMode = new Function('THREE','camera','controls','plane','sheenBall','$','document', 'let sheenPreview=false,flatPreviewView=null;' + source.slice(start,end) + ';return setPreviewMode;')(THREE,camera,controls,plane,sheenBall,$,selection);
  const flat = camera.position.clone(), flatQuaternion = camera.quaternion.clone(), flatTarget = controls.target.clone(), lighting = light.matrixWorld.clone();
  try {
    setPreviewMode(true);
    assert.equal(controls.enableRotate, true); assert.equal(controls.enablePan, false);
    assert.equal(controls.touches.ONE, THREE.TOUCH.ROTATE); assert.equal(controls.touches.TWO, THREE.TOUCH.DOLLY_ROTATE);
    const before = camera.position.clone(), rotation = sheenBall.quaternion.clone();
    controls._onPointerDown({pointerId:1,pointerType:'mouse',button:0,clientX:300,clientY:200});
    controls._onPointerMove({pointerId:1,pointerType:'mouse',button:0,clientX:450,clientY:250});
    controls._onPointerUp({pointerId:1});
    assert.ok(camera.position.distanceTo(before)>1);
    assert.ok(controls.target.length()<1e-8); assert.ok(Math.abs(camera.position.length()-120)<1e-8);
    assert.deepEqual(sheenBall.quaternion.toArray(),rotation.toArray()); assert.deepEqual(light.matrixWorld.toArray(),lighting.toArray());
    const distance=camera.position.length();
    controls._onMouseWheel({preventDefault(){},deltaY:-100,deltaMode:0,clientX:400,clientY:300});
    assert.ok(camera.position.length()<distance);
    setPreviewMode(false);
    for(let i=0;i<90;i++)controls.update();
    assert.ok(camera.position.distanceTo(flat)<1e-8);
    assert.ok(1-Math.abs(camera.quaternion.dot(flatQuaternion))<1e-8);
    assert.ok(controls.target.distanceTo(flatTarget)<1e-8);
    assert.equal(controls.enableRotate,false); assert.equal(controls.enablePan,true);
    assert.equal(controls.mouseButtons.LEFT,THREE.MOUSE.PAN); assert.equal(controls.touches.ONE,THREE.TOUCH.PAN);
    assert.equal(plane.visible,true); assert.equal(sheenBall.visible,false);
    assert.equal(buttons[0]['aria-pressed'],'true'); assert.equal(buttons[1]['aria-pressed'],'false');
  } finally {controls.dispose(); globalThis.document=oldDocument;}
});

test('new editor materials use requested defaults and numeric controls preserve saved values', () => {
  const start=source.indexOf('const material = new THREE.MeshPhysicalMaterial('), end=source.indexOf('installRoughnessShader(material)',start);
  const material=new Function('THREE',source.slice(start,end)+'return material;')(THREE);
  assert.equal(material.roughness,.98);assert.equal(material.sheen,.1);assert.equal(material.sheenRoughness,.4);
  applySurface(material,{sheen:0,sheenRoughness:.56});
  assert.equal(readSurface(material).sheen,0);assert.equal(readSurface(material).sheenRoughness,.56);
  assert.ok(!source.includes("addSlider($('fabricSheenControls')"));
  const numericBlock=source.slice(source.indexOf('  for (const [id, title, max] of sheenParameters)'),source.indexOf('  for (const [key, title] of MATERIAL_MAPS)'));
  assert.ok(numericBlock.includes("type: 'number'")); assert.ok(!numericBlock.includes("type: 'range'"));
});
