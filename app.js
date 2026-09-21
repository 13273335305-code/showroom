import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'three/addons/libs/fflate.module.js';
import { slotMaterial, assignMaterial, rebuildMaterialUsage, serializeAssignments, restoreAssignments } from './material-assignments.js';
import { defaultPhysical, readPhysical, preparePhysicalUV, setPhysicalTransform, measureUVMetric } from './physical-textures.js';
import { readImageDensity, physicalSizeFromDensity } from './image-density.js';
import { uvPatternGeometry } from './uv-pattern.js';
import { surfacePatternGeometry } from './surface-pattern.js';
import { revealMaterial, fadeMaterial, revealPattern, REVEAL_DURATION } from './material-reveal.js';
import { getAsset, listAssets, saveAsset } from './shared/asset-store.js';
import { MATERIAL_MAPS, readSurface, applySurface, readLegacyUV, applyLegacyUV } from './shared/material-data.js';
import { createDesignWorkspace } from './design-workspace.js';
import { materialType, readPlacement, applyPlacement } from './shared/material-placement.js';
import { packMaterial, unpackMaterial } from './shared/material-package.js';
import { ENVIRONMENT_DEFAULTS, packScene, unpackScene, sceneName, sceneFilename } from './shared/scene-file.js';
import { createSceneCycle, sceneAppearance } from './shared/scene-cycle.js';
import { installRoughnessShader } from './shared/roughness-map.js';
import { configureTextureSampling } from './shared/texture-sampling.js';
import { prepareAnnotationPicking, AnnotationOcclusion } from './shared/annotation-visibility.js';
import { createCameraMotion, INTRO_DURATION, INTRO_DISTANCE_RATIO, introFocusBlur } from './shared/camera-motion.js';
import { createShowroom } from './shared/showroom.js';
import { createDeveloperPanel } from './shared/developer-panel.js';
import { loadDeveloperSettings, defaultDeveloperSettings } from './shared/developer-settings.js';
let developerPanel = null, developerSettings = defaultDeveloperSettings();
let showroom = null;
let daylightCycle=null;
let designUI, patternSources=[], selectedDesignPattern=null;
const $=id=>document.getElementById(id);
let physicalModel={cmPerUnit:1,fbxCmPerUnit:1,rawSize:[1,1,1],unitKnown:false,calibrated:false};
const MAPS=MATERIAL_MAPS;
const DEFAULTS={...ENVIRONMENT_DEFAULTS,rotation:0,scale:1.2,renderMode:'pbr',autoRotate:false};
let state={...DEFAULTS},renderer,scene,camera,controls,floor,reflector,stage,ring,grid,key,fill,hemi,model,entries=[],selected=null;
let modelSource=null,modelGeneration=0,currentLoad=0,loadingModel=false,toastTimer;
let partAssignments=new Map();
let draggedMaterial=null, assignmentHistory=[],materialPreviewTimer=null;
let materialHoldTimer=null, materialHoverTimer=null, previewAnimation=null, activeReveal=null, suppressMaterialClick=false, materialPulse=null;
import { createInspectorTransition, inspectorMorph } from './shared/inspector-transition.js';
let inspectorTransition=null,inspectorOrigin=null;
let cameraTween=null,annotationMode=false,selectedAnnotation=null,annotations=[],annotationMoving=false,annotationIdleTimer=null;
let patterns=[],selectedPattern=null,patternAsset=null,patternPlaceMode=false,patternUploadToken=0;
let activeFabric='其他';
function fabricCategory(entry){return entry.category||(/包边|滚边|piping|binding/i.test(entry.name)?'包边条':/边布|侧布|side/i.test(entry.name)?'边布':'面布');}
const PART_TYPES=['面布','边布','包边条'];
function restorePartAssignments(raw){partAssignments=new Map();if(!raw||typeof raw!=='object')return;for(const [key,value] of Object.entries(raw)){const types=Array.isArray(value)?value:value?.types;if(!Number.isInteger(Number(key))||!Array.isArray(types))continue;const valid=types.filter(type=>PART_TYPES.includes(type));if(valid.length)partAssignments.set(Number(key),new Set(valid));}}
function serializePartAssignments(){const out={};for(const [index,types] of partAssignments)out[index]=[...types];return out;}
function partTypesForMaterial(material){if(material?.userData?.partTypes instanceof Set)return material.userData.partTypes;const entry=entries.find(candidate=>candidate.material===material);return partAssignments.get(entry?.id)||new Set();}
function materialSlotsForPartType(type){const result=[];model?.traverse(o=>{if(!o.isMesh)return;const materials=Array.isArray(o.material)?o.material:[o.material];materials.forEach((material,slot)=>{if(partTypesForMaterial(material).has(type))result.push({mesh:o,slot,material});});});return result;}
const MATERIAL_DRAG_TYPE='application/x-form-material';
function notify(message,duration=3500){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),duration);}
function busy(title,detail='请稍候…'){endMaterialDrag();$('loadingTitle').textContent=title;$('loadingDetail').textContent=detail;$('loading').hidden=false;}
function hideBusy(){$('loading').hidden=true;}
function yieldFrame(){return new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function formatCount(n){return n>=10000?(n/10000).toFixed(1)+' 万':n.toLocaleString();}
function imageData(texture,maxSize=128,quality=.8){try{if(!texture?.image?.width)return null;const c=document.createElement('canvas'),scale=Math.min(1,maxSize/Math.max(texture.image.width,texture.image.height));c.width=Math.max(1,Math.round(texture.image.width*scale));c.height=Math.max(1,Math.round(texture.image.height*scale));const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(texture.image,0,0,c.width,c.height);return c.toDataURL('image/jpeg',quality);}catch{return null;}}
function init(){
 try{developerSettings=loadDeveloperSettings(localStorage);}catch(error){notify('开发者配置未能读取，已使用默认设置：'+error.message,6000);}
 renderer=new THREE.WebGLRenderer({canvas:$('canvas'),antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 scene=new THREE.Scene();scene.background=new THREE.Color(state.backgroundColor);scene.fog=new THREE.Fog(state.backgroundColor,18,48);
 camera=new THREE.PerspectiveCamera(36,1,.02,100);camera.position.set(6,3.7,7);
 controls=new OrbitControls(camera,$('canvas'));controls.enableDamping=true;controls.dampingFactor=.07;controls.minDistance=.3;controls.maxDistance=35;controls.maxPolarAngle=Math.PI*.49;controls.autoRotateSpeed=.6;
 controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.PAN,RIGHT:THREE.MOUSE.PAN};controls.screenSpacePanning=true;controls.enablePan=true;
 $('canvas').addEventListener('pointerdown',e=>{if(e.button===1)e.preventDefault();});$('canvas').addEventListener('auxclick',e=>{if(e.button===1)e.preventDefault();});
 const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();scene.environment=pmrem.fromScene(room,.04).texture;room.dispose();pmrem.dispose();
 hemi=new THREE.HemisphereLight(0xeaf3ff,0x6d6e74,1);scene.add(hemi);
 key=new THREE.DirectionalLight(0xfff4e6,3);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-7,right:7,top:7,bottom:-7,near:.1,far:30});key.shadow.normalBias=.035;key.shadow.bias=-.00015;key.shadow.radius=4;scene.add(key);scene.add(key.target);
 fill=new THREE.DirectionalLight(0xe2edff,1.5);fill.position.set(-6,4,2);scene.add(fill);const rim=new THREE.DirectionalLight(0xffffff,2);rim.position.set(1,5,-7);scene.add(rim);
 floor=new THREE.Mesh(new THREE.PlaneGeometry(160,160),new THREE.MeshStandardMaterial({color:0xe3e8ed,roughness:.48,metalness:.12}));floor.rotation.x=-Math.PI/2;floor.position.y=-.17;floor.receiveShadow=true;scene.add(floor);
 stage=new THREE.Group();scene.add(stage);const base=new THREE.Mesh(new THREE.CylinderGeometry(4.9,5,.12,128),new THREE.MeshStandardMaterial({color:0xd9e0e7,roughness:.3,metalness:.18}));base.position.y=-.08;base.receiveShadow=true;stage.add(base);
 reflector=new Reflector(new THREE.CircleGeometry(4.88,128),{textureWidth:768,textureHeight:768,color:0xcdd7e1,clipBias:.002});reflector.rotation.x=-Math.PI/2;reflector.position.y=-.016;
 // A very low-contrast reflection reads as fine frosted glass instead of a second sharp model.
 reflector.material.fragmentShader=reflector.material.fragmentShader.replace('gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );','gl_FragColor = vec4( mix( color, blendOverlay( base.rgb, color ), 0.08 ), 1.0 );');stage.add(reflector);
 const shadow=new THREE.Mesh(new THREE.CircleGeometry(4.88,128),new THREE.ShadowMaterial({opacity:.20}));shadow.rotation.x=-Math.PI/2;shadow.position.y=-.008;shadow.receiveShadow=true;stage.add(shadow);
 ring=new THREE.Mesh(new THREE.TorusGeometry(4.92,.011,8,160),new THREE.MeshBasicMaterial({color:0xffffff}));ring.rotation.x=Math.PI/2;ring.position.y=-.007;stage.add(ring);
 grid=new THREE.GridHelper(14,28,0x9eb3ca,0xcbd5e1);grid.position.y=.002;grid.material.transparent=true;grid.material.opacity=.5;scene.add(grid);
 new ResizeObserver(resize).observe($('viewport'));resize();applyScene();
 $('canvas').addEventListener('webglcontextlost',e=>{e.preventDefault();busy('显卡渲染上下文已暂停','请刷新页面，或关闭其他占用显卡的窗口后重新打开。');});
 developerPanel=createDeveloperPanel({renderer,read:()=>state,apply:next=>{Object.assign(state,next);applyScene();},cycle:()=>daylightCycle,showroom:()=>showroom,status:()=>({loading:loadingModel,ready:!!model,name:$('modelName').textContent}),getSettings:()=>developerSettings,setSettings:value=>{developerSettings=value;},notify,download});
 renderer.setAnimationLoop(()=>{developerPanel.beginFrame();try{if(cameraTween?.update)cameraTween.update();else controls.update();syncPatterns();updateAnnotations(false);renderer.render(scene,camera);}finally{developerPanel.endFrame();}});bindEvents();buildSlots();showPanel('scene');
 createSceneCycle({button:$('dayCycle'),read:()=>state,apply:(next,appearance)=>{Object.assign(state,next);applyScene(appearance);},name:value=>{$('sceneName').value=value;},notify,savedPresets:developerSettings.presets}).then(cycle=>{daylightCycle=cycle;loadExample();});
}
function resize(){invalidateAnnotations();if(!renderer)return;const {width,height}=$('viewport').getBoundingClientRect();renderer.setSize(width,height,false);camera.aspect=width/Math.max(height,1);camera.updateProjectionMatrix();syncInspectorFraming();}
function fit(direction='perspective',{intro=false,immediate=false}={}){
 cancelDraftAnnotation();
 if(!model)return;model.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(model),sphere=box.getBoundingSphere(new THREE.Sphere());if(!Number.isFinite(sphere.radius)||sphere.radius===0)return;
 const vfov=THREE.MathUtils.degToRad(camera.fov),hfov=2*Math.atan(Math.tan(vfov/2)*camera.aspect),distance=sphere.radius/Math.sin(Math.min(vfov,hfov)/2)*1.18;
 const dir=direction==='top'?new THREE.Vector3(0,1,.001):direction==='front'?new THREE.Vector3(0,.14,1):direction==='left'?new THREE.Vector3(-1,.14,0):direction==='right'?new THREE.Vector3(1,.14,0):direction==='back'?new THREE.Vector3(0,.14,-1):new THREE.Vector3(1.15,.68,1.35);
 const target=sphere.center.clone(),position=target.clone().addScaledVector(dir.normalize(),distance);
 cameraTween?.cancel();invalidateAnnotations();
 controls.minDistance=Math.max(.08,sphere.radius*.15);controls.maxDistance=Math.max(20,distance*5);camera.far=Math.max(100,distance*10);camera.updateProjectionMatrix();syncInspectorFraming();
 const damping=controls.enableDamping;controls.enableDamping=false;controls.autoRotate=false;controls.update();
 const startP=intro?target.clone().lerp(position,INTRO_DISTANCE_RATIO):camera.position.clone(),startT=intro?target.clone():controls.target.clone();
 const duration=immediate||matchMedia('(prefers-reduced-motion: reduce)').matches?0:intro?INTRO_DURATION:520;
 const session=createCameraMotion({duration,render:e=>{camera.position.lerpVectors(startP,position,e);controls.target.lerpVectors(startT,target,e);controls.update();if(intro){const blur=introFocusBlur(e);$('canvas').style.filter=blur>0.01?`blur(${blur.toFixed(2)}px)`:'';}},finish:()=>{if(cameraTween!==session)return;cameraTween=null;controls.enableDamping=damping;$('canvas').style.filter='';$('viewport').dataset.cameraMotion='idle';syncAutoRotate();setAnnotationMoving(false);}});
 cameraTween=session;$('viewport').dataset.cameraMotion=intro?'intro':'fit';session.update();
}
function syncInspectorFraming(){
 if(!camera||!renderer)return;
 const progress=inspectorTransition?.progress||0,viewport=$('viewport');
 const width=viewport.clientWidth,height=viewport.clientHeight;
 const shift=innerWidth>760?$('inspector').offsetWidth*.5*progress:0;
 if(shift>0)camera.setViewOffset(width,height,shift,0,width,height);else camera.clearViewOffset();
 invalidateAnnotations();
}
function renderInspectorProgress(progress){
 const workspace=document.querySelector('.workspace'),panel=$('inspector'),button=$('restoreInspector');
 workspace.style.setProperty('--inspector-progress',String(progress));
 workspace.style.setProperty('--inspector-button-space',(button.offsetWidth+parseFloat(getComputedStyle(button.parentElement).gap))+'px');
 const destination={x:panel.offsetLeft,y:panel.offsetTop,width:panel.offsetWidth,height:panel.offsetHeight};
 const origin=inspectorOrigin||button.getBoundingClientRect(),rect=inspectorMorph(origin,destination,progress);
 const sx=rect.width/destination.width,sy=rect.height/destination.height;
 panel.style.visibility=progress===0?'hidden':'visible';panel.style.opacity='1';
 // Keep the outgoing annotation content until the closing shell is hidden.
 if(progress===0&&!annotationMode&&!$('annotationPanel').hidden)showPanel('scene');
 panel.style.transformOrigin='0 0';
 panel.style.transform='translate('+(rect.x-destination.x)+'px,'+(rect.y-destination.y)+'px) scale('+sx+','+sy+')';
 panel.style.borderRadius=(rect.radius/sx)+'px / '+(rect.radius/sy)+'px';
 panel.style.setProperty('--inspector-content-opacity',String(Math.max(0,Math.min(1,(progress-.22)/.48))));
 panel.style.setProperty('--inspector-icon-opacity',String(Math.max(0,1-progress/.22)));
 panel.style.setProperty('--inspector-icon-scale',(1/sx)+','+(1/sy));
 button.style.opacity=progress===0?'1':'0';button.style.pointerEvents=progress===0?'':'none';
 button.inert=progress>0;
 syncInspectorFraming();
}
function setInspectorCollapsed(collapsed){
 if(showroom?.active&&!collapsed)return;
 const workspace=document.querySelector('.workspace'),panel=$('inspector'),button=$('restoreInspector');
 if(!collapsed&&!annotationMode&&!$('annotationPanel').hidden)showPanel('scene');
 if(!inspectorTransition?.active){const rect=button.getBoundingClientRect(),p=inspectorTransition?.progress||0;inspectorOrigin={x:rect.x+(innerWidth>760?350*p:0),y:rect.y,width:rect.width,height:rect.height};}
 workspace.classList.toggle('inspector-collapsed',collapsed);panel.classList.toggle('open',!collapsed);
 panel.setAttribute('aria-hidden',String(collapsed));panel.inert=collapsed;
 button.hidden=false;button.setAttribute('aria-expanded',String(!collapsed));
 button.setAttribute('aria-label',collapsed?'展开属性编辑器':'折叠属性编辑器');
 if(!inspectorTransition)inspectorTransition=createInspectorTransition({render:renderInspectorProgress});
 inspectorTransition.set(!collapsed);
}
const annotationCameraPosition=new THREE.Vector3(),annotationCameraRotation=new THREE.Quaternion();
const annotationModelMatrix=new THREE.Matrix4(),annotationProjection=new THREE.Matrix4();
const annotationWorld=new THREE.Vector3(),annotationView=new THREE.Vector3(),annotationNdc=new THREE.Vector3();
const annotationOcclusion=new AnnotationOcclusion();
let annotationPointerActive=false,annotationDirty=true,annotationJob=null,annotationFocus=null;
function invalidateAnnotations(){annotationDirty=true;annotationJob=null;}
function updateAnnotations(){
 if(!camera)return;
 model?.updateWorldMatrix(true,false);
 const changed=camera.position.distanceToSquared(annotationCameraPosition)>1e-8||1-Math.abs(camera.quaternion.dot(annotationCameraRotation))>1e-9||!camera.projectionMatrix.equals(annotationProjection)||(model&&!model.matrixWorld.equals(annotationModelMatrix));
 if(changed||annotationPointerActive||cameraTween)invalidateAnnotations();
 annotationCameraPosition.copy(camera.position);annotationCameraRotation.copy(camera.quaternion);annotationProjection.copy(camera.projectionMatrix);if(model)annotationModelMatrix.copy(model.matrixWorld);
 annotationMoving=annotationPointerActive||!!cameraTween||!!(controls?.autoRotate&&controls.enabled);
 const layer=$('annotationLayer');
 if(annotationMoving){if(!layer.hidden)layer.hidden=true;return;}
 if(layer.hidden)layer.hidden=false;
 if(!annotations.length){if(layer.hidden)layer.hidden=false;annotationDirty=false;return;}
 if(!annotationDirty)return;
 if(!annotationJob){
  camera.updateMatrixWorld();model?.updateMatrixWorld(true);
  const meshes=[];model?.traverseVisible(o=>{if(o.isMesh)meshes.push(o);});
  const rect=$('viewport').getBoundingClientRect();annotationJob={meshes,width:rect.width,height:rect.height,index:0};
 }
 // Restore markers on pointer release, including during OrbitControls damping.
 // Refresh projection and occlusion as the camera coasts without hiding the layer.
 const deadline=performance.now()+4,job=annotationJob;
 while(job.index<annotations.length){
  const a=annotations[job.index++];annotationWorld.copy(a.point).applyMatrix4(a.host.matrixWorld);
  annotationView.copy(annotationWorld).applyMatrix4(camera.matrixWorldInverse);annotationNdc.copy(annotationWorld).project(camera);
  let visible=annotationView.z<0&&annotationNdc.z>=-1&&annotationNdc.z<=1&&Math.abs(annotationNdc.x)<1&&Math.abs(annotationNdc.y)<1;
  for(let o=a.host;visible&&o;o=o.parent)if(!o.visible)visible=false;
  if(visible)visible=!annotationOcclusion.isOccluded(annotationWorld,camera,job.meshes);
  a.el.hidden=!visible;a.window.inert=!visible;
  if(visible){
   const x=(annotationNdc.x*.5+.5)*job.width,y=(-annotationNdc.y*.5+.5)*job.height;
   a.el.style.transform='translate('+x.toFixed(2)+'px,'+y.toFixed(2)+'px)';
   const shift=Math.max(116-x,Math.min(0,job.width-116-x));a.window.style.setProperty('--annotation-shift',shift.toFixed(2)+'px');
  }
  if(performance.now()>=deadline)return;
 }
 annotationDirty=false;annotationJob=null;layer.hidden=false;
 if(annotationFocus){const a=annotationFocus;annotationFocus=null;if(annotations.includes(a)&&!a.el.hidden)focusAnnotationDraft(a);}
}
function setAnnotationMoving(moving){if(moving)cancelDraftAnnotation();annotationPointerActive=moving;invalidateAnnotations();updateAnnotations();}
function syncAutoRotate(){
 controls.autoRotate=state.autoRotate&&!annotationMode&&!draggedMaterial&&!cameraTween;
 $('autoRotate').setAttribute('aria-pressed',String(controls.autoRotate));
 $('autoRotate').title=state.autoRotate&&annotationMode?'自动旋转（标记模式中暂停）':'自动旋转';
}
function setAnnotationMode(active,{keepInspector=false}={}){
 const wasActive=annotationMode;
 if(!active)cancelDraftAnnotation();
 if(active){endMaterialDrag();setPatternMode(false);designUI?.exitRemoval();cameraTween?.cancel();}
 annotationMode=active;
 $('annotationMode').classList.toggle('active',active);$('annotationMode').setAttribute('aria-pressed',String(active));
 $('canvas').style.cursor=active?'crosshair':'';syncAutoRotate();
 if(active){syncAnnotationPanel();showPanel('annotation');}
 else if(wasActive&&!keepInspector)setInspectorCollapsed(true);
}
const ANNOTATION_CONFIRM_ICON='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.2"/><path d="m8 12 2.6 2.7 5.4-5.4"/></svg>';
function saveAnnotation(a,value){
 const text=value.trim();
 if(!text){notify('请输入标记信息');return false;}
 a.text=text.slice(0,300);a.saved=true;a.editing=false;a.draft=a.text;
 renderAnnotation(a);syncAnnotationPanel();return true;
}
function cancelDraftAnnotation(){
 const index=annotations.findIndex(a=>!a.saved);if(index<0)return false;
 const a=annotations[index];a.el.remove();annotations.splice(index,1);
 // Preserve the other rows so the outside click can still activate its target.
 $('annotationList').children[index]?.remove();
 if(selectedAnnotation===a)selectedAnnotation=null;
 if(annotationFocus===a)annotationFocus=null;
 $('annotationEmpty').hidden=!!annotations.length;invalidateAnnotations();return true;
}
function deleteAnnotation(a){
 const index=annotations.indexOf(a);if(index<0)return;
 a.el.remove();annotations.splice(index,1);invalidateAnnotations();
 if(selectedAnnotation===a)selectedAnnotation=annotations[Math.min(index,annotations.length-1)]||null;
 syncAnnotationPanel();
}
function focusAnnotationDraft(a){
 if(!annotations.includes(a))return;
 if($('annotationLayer').hidden||a.el.hidden){annotationFocus=a;return;}
 const input=a.window.querySelector('input');input?.focus({preventScroll:true});
}
function renderAnnotation(a){
 invalidateAnnotations();a.window.replaceChildren();a.el.classList.toggle('draft',!a.saved);
 if(a.saved){const label=document.createElement('span');label.className='annotation-label';label.textContent=a.text||'未填写标记';a.window.append(label);return;}
 const input=document.createElement('input');input.className='annotation-draft-input';input.placeholder='输入标记信息';input.setAttribute('aria-label','新标记信息');input.maxLength=300;input.value=a.draft;
 const save=document.createElement('button');save.className='annotation-confirm';save.innerHTML=ANNOTATION_CONFIRM_ICON;save.setAttribute('aria-label','保存新标记');save.title='保存标记（Enter）';
 input.oninput=()=>{a.draft=input.value;};
 input.onkeydown=event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();if(!saveAnnotation(a,input.value))input.focus();}};
 save.onclick=()=>{if(!saveAnnotation(a,input.value))input.focus();};a.window.append(input,save);
}
function syncAnnotationPanel(){
 const list=$('annotationList');list.replaceChildren();
 annotations.forEach((a,i)=>{
  a.el.classList.toggle('selected',a===selectedAnnotation);a.el.querySelector('.annotation-dot').setAttribute('aria-pressed',String(a===selectedAnnotation));
  const row=document.createElement('li');row.className='annotation-row'+(a===selectedAnnotation?' selected':'');
  const number=document.createElement('span');number.className='annotation-number';number.textContent=String(i+1).padStart(2,'0');row.append(number);
  if(a.saved&&a.editing){
   const input=document.createElement('input');input.className='annotation-row-input';input.maxLength=300;input.value=a.draft;input.setAttribute('aria-label','编辑标记 '+(i+1));
   input.oninput=()=>{a.draft=input.value;};input.onkeydown=event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();saveAnnotation(a,input.value);}else if(event.key==='Escape'){event.stopPropagation();a.editing=false;a.draft=a.text;syncAnnotationPanel();}};
   const save=document.createElement('button');save.className='annotation-confirm';save.innerHTML=ANNOTATION_CONFIRM_ICON;save.setAttribute('aria-label','保存标记 '+(i+1));save.onclick=()=>saveAnnotation(a,input.value);row.append(input,save);
  }else{
   const text=document.createElement('button');text.className='annotation-row-text';text.textContent=a.saved?(a.text||'未填写标记'):'待输入…';text.title=a.saved?a.text:'请在模型标记框中输入信息';
   text.onclick=()=>{selectAnnotation(a);if(!a.saved)focusAnnotationDraft(a);};row.append(text);
   if(a.saved){const edit=document.createElement('button');edit.className='annotation-edit';edit.setAttribute('aria-label','编辑标记 '+(i+1));edit.title='编辑标记';edit.innerHTML='<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m15 5 4 4M4 20l5-1L20 8a2.8 2.8 0 0 0-4-4L5 15z"/></svg>';edit.onclick=()=>{setAnnotationMode(true);selectedAnnotation=a;a.editing=true;a.draft=a.text;syncAnnotationPanel();list.children[i].querySelector('input').focus();};row.append(edit);}
  }
  const remove=document.createElement('button');remove.className='annotation-row-delete';remove.textContent='×';remove.setAttribute('aria-label','删除标记 '+(i+1));remove.title='删除标记';remove.onclick=()=>deleteAnnotation(a);row.append(remove);list.append(row);
 });
 $('annotationEmpty').hidden=!!annotations.length;
}
function selectAnnotation(a){
 selectedAnnotation=a;syncAnnotationPanel();showPanel('annotation');
}
function addAnnotation(hit,text='',select=true){
 const pending=select&&annotations.find(a=>!a.saved);
 if(pending){selectAnnotation(pending);focusAnnotationDraft(pending);return pending;}
 const el=document.createElement('div');el.className='annotation-card';
 el.innerHTML='<button class="annotation-dot" aria-label="查看标记信息"></button><div class="annotation-window"></div>';
 const a={el,text:String(text).slice(0,300),draft:'',saved:!select,editing:false,window:el.querySelector('.annotation-window'),host:hit.object,point:hit.object.worldToLocal(hit.point.clone()),occluded:false};
 renderAnnotation(a);$('annotationLayer').append(el);annotations.push(a);
 el.querySelector('.annotation-dot').onclick=()=>{setAnnotationMode(true);selectAnnotation(a);if(!a.saved)focusAnnotationDraft(a);};
 annotationPointerActive=false;updateAnnotations();
 if(select){selectAnnotation(a);setTimeout(()=>{updateAnnotations();focusAnnotationDraft(a);},0);}
 return a;
}
function applyScene(appearance=daylightCycle?.appearance||sceneAppearance(state)){
 invalidateAnnotations();
 scene.background.set(state.backgroundColor);scene.fog.color.set(state.backgroundColor);const bgLight=scene.background.getHSL({}).l;document.body.classList.toggle('dark-stage',bgLight<.42);renderer.toneMappingExposure=state.exposure;scene.environmentIntensity=state.environment;
 key.intensity=state.keyLight;key.color.set(state.lightColor);const a=THREE.MathUtils.degToRad(state.lightAngle);key.position.set(Math.sin(a)*7,8,Math.cos(a)*7);key.target.position.set(0,.5,0);fill.intensity=state.fillLight;
 key.shadow.intensity=appearance.shadow;floor.receiveShadow=true;stage.children.forEach(o=>{if(o.material?.isShadowMaterial)o.visible=appearance.shadow>0;});stage.visible=state.floorVisible;reflector.visible=state.reflection;grid.visible=state.grid;syncAutoRotate();
 floor.material.color.set(appearance.floorColor);hemi.intensity=appearance.hemi;reflector.material.uniforms.color.value.set(appearance.reflectorColor);
 if(model){model.rotation.y=THREE.MathUtils.degToRad(state.rotation);model.scale.setScalar(state.scale);}
 for(const entry of entries){entry.material.wireframe=state.renderMode==='wire';if(entry.material.flatShading!==(state.renderMode==='flat')){entry.material.flatShading=state.renderMode==='flat';entry.material.needsUpdate=true;}}
 $('renderInfo').textContent=state.renderMode==='wire'?'WIREFRAME':'PBR';
 for(const[k,v]of Object.entries(state)){const el=$(k);if(!el)continue;if(el.type==='checkbox')el.checked=v;else if(el.tagName==='INPUT'||el.tagName==='SELECT')el.value=v;if($(k+'Value'))$(k+'Value').textContent=k==='rotation'||k==='lightAngle'?Math.round(v)+'°':Number(v).toFixed(2);}
 document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('active',b.dataset.preset===state.preset));
 daylightCycle?.sync();
}
const placeholder='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+Xf6QAAAAAElFTkSuQmCC';
async function parseFBX(buffer,files=[]){
 const urls=[],missing=new Set(),resources=new Map();for(const f of files)resources.set(f.name.split(/[\\/]/).pop().toLowerCase(),f);
 const manager=new THREE.LoadingManager();manager.setURLModifier(url=>{if(url.startsWith('data:')||url.startsWith('blob:')){if(url.startsWith('blob:'))urls.push(url);return url;}const name=decodeURIComponent(url.replace(/\\/g,'/').split('/').pop()).toLowerCase();const file=resources.get(name);if(file){const u=URL.createObjectURL(file);urls.push(u);return u;}missing.add(name);return placeholder;});
 let finish;const ready=new Promise(r=>finish=r);manager.onLoad=()=>finish();manager.itemStart('parse');let object;
 try{object=new FBXLoader(manager).parse(buffer,'');}finally{manager.itemEnd('parse');}
 await ready;urls.forEach(u=>URL.revokeObjectURL(u));return {object,missing:[...missing]};
}
function convertMaterials(object){
 const converted=new Map(),result=[],geometries=new Set();let meshCount=0,triangles=0;
 object.traverse(o=>{if(o.isLight||o.isCamera){o.visible=false;return;}if(!o.isMesh)return;meshCount++;o.castShadow=true;o.receiveShadow=true;
 if(o.geometry){triangles+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3;geometries.add(o.geometry);}
 const list=Array.isArray(o.material)?o.material:[o.material];const next=list.map(source=>{
 if(!source)source=new THREE.MeshStandardMaterial();if(converted.has(source.uuid)){const entry=converted.get(source.uuid);entry.meshes.add(o);return entry.material;}
 const material=new THREE.MeshStandardMaterial({name:source.name,color:source.color?.clone()||new THREE.Color(0xffffff),roughness:source.roughness??.65,metalness:source.metalness??0,side:source.side,opacity:source.opacity??1,transparent:source.transparent||false,alphaTest:source.alphaTest||0});
 installRoughnessShader(material);
 for(const[key,,,color]of MAPS){if(!source[key])continue;const original=source[key];if(original.image?.src===placeholder)continue;material[key]=original.clone();material[key].colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;configureTextureSampling(material[key],renderer);}
 if(source.alphaMap){material.alphaMap=source.alphaMap.clone();configureTextureSampling(material.alphaMap,renderer);}if(source.normalScale)material.normalScale.copy(source.normalScale);if(source.emissive)material.emissive.copy(source.emissive);material.emissiveIntensity=source.emissiveIntensity??1;material.bumpScale=source.bumpMap?Math.min(.2,source.bumpScale??.02):.02;
 const index=result.length,entry={id:index,category:'其他',name:source.name||'未命名材质 '+(index+1),material,meshes:new Set([o]),uploads:{},mapTokens:{},repeat:[1,1],physical:defaultPhysical(),pendingDpi:{},densityInfo:null,flip:false,baseline:material.clone(),thumbnails:{},previews:{}};
 for(const[key]of MAPS)if(material[key]){entry.thumbnails[key]=imageData(material[key]);entry.previews[key]=imageData(material[key],2048,.92);}result.push(entry);converted.set(source.uuid,entry);return material;
 });o.material=Array.isArray(o.material)?next:next[0];});
 if(!meshCount)throw new Error('该 FBX 不包含可显示的网格');return {entries:result,meshCount,triangles:Math.round(triangles),uvMissing:[...geometries].filter(g=>!g.attributes.uv).length};
}
function disposeObject(object,list=[]){if(!object)return;const gs=new Set(),ms=new Set(),ts=new Set();object.traverse(o=>{if(o.geometry)gs.add(o.geometry);for(const m of(Array.isArray(o.material)?o.material:[o.material]))if(m)ms.add(m);});for(const e of list){ms.add(e.material);ms.add(e.baseline);Object.values(e.uploads).forEach(u=>{if(u.preview)URL.revokeObjectURL(u.preview);});}ms.forEach(m=>{for(const v of Object.values(m))if(v?.isTexture)ts.add(v);m.dispose();});gs.forEach(g=>g.dispose());ts.forEach(t=>t.dispose());}
async function loadModel(buffer,name,files=[],{restore=null,parts=null}={}){
 showroom?.exit();cameraTween?.cancel();$('showroomMode').disabled=true;setAnnotationMode(false);designUI?.exitRemoval();const request=++currentLoad;loadingModel=true;busy('正在载入 '+name,'解析几何、材质和纹理…');await yieldFrame();let parsed;
 try{parsed=await parseFBX(buffer,files);if(request!==currentLoad){disposeObject(parsed.object);return;}
 const info=convertMaterials(parsed.object),box=new THREE.Box3().setFromObject(parsed.object),size=box.getSize(new THREE.Vector3()),max=Math.max(size.x,size.y,size.z);if(!Number.isFinite(max)||max<1e-10)throw new Error('模型尺寸无效');
 const unit=Number(parsed.object.userData.unitScaleFactor);
 const nextPhysicalModel={cmPerUnit:Number.isFinite(unit)&&unit>0?unit:1,fbxCmPerUnit:Number.isFinite(unit)&&unit>0?unit:1,rawSize:size.toArray(),unitKnown:Number.isFinite(unit)&&unit>0,calibrated:false};
 busy('正在优化模型拾取','为标记与材质选择建立空间索引…');await yieldFrame();prepareAnnotationPicking(parsed.object);
 busy('正在标定贴图尺寸','根据模型实际尺寸与原有 UV 计算铺贴比例…');await yieldFrame();preparePhysicalUV(parsed.object);
 const center=box.getCenter(new THREE.Vector3()),s=4.2/max,normalizer=new THREE.Group(),root=new THREE.Group();normalizer.add(parsed.object);normalizer.scale.setScalar(s);normalizer.position.set(-center.x*s,-box.min.y*s+.014,-center.z*s);root.add(normalizer);
 if(model){for(const a of annotations)a.el.remove();annotations=[];selectedAnnotation=null;syncAnnotationPanel();clearPatterns();scene.remove(model);disposeObject(model,entries);clearPatternSources();}model=root;restorePartAssignments(parts);physicalModel=nextPhysicalModel;updateModelDimensions();modelGeneration++;assignmentHistory=[];$('undoMaterial').disabled=true;entries=info.entries;for(const entry of entries)entry.material.userData.partTypes=partAssignments.get(entry.id)||new Set();selected=null;modelSource={buffer:buffer.slice(0),name,files};scene.add(model);state.rotation=0;state.scale=DEFAULTS.scale;$('isolate').checked=false;applyScene();fit('perspective',{immediate:true});
 $('modelName').textContent=name;$('modelName').title=name;$('modelStats').textContent=`${info.meshCount} 网格 · ${formatCount(info.triangles)} 三角面`;$('materialCount').textContent=String(entries.length).padStart(2,'0');selectEntry(entries[0]);renderMaterials();if(restore)await restore(entries);if(request!==currentLoad)return;showPanel('scene');
 await renderer.compileAsync(scene,camera);if(request!==currentLoad)return;renderer.render(scene,camera);
 if(!restore)fit('perspective',{intro:true});
 hideBusy();notify(`已载入 ${entries.length} 个独立材质`+(parsed.missing.length?'；缺少 '+parsed.missing.length+' 个外部纹理，可在右侧补充':'')+(info.uvMissing?'；部分网格没有 UV，无法显示贴图':''),6000);
 }catch(error){console.error(error);if(request===currentLoad){hideBusy();notify('载入失败：'+error.message,8000);if(!model){$('modelName').textContent='请导入 FBX 模型';$('modelStats').textContent='点击右侧 ＋ 选择文件';}}}finally{if(request===currentLoad){loadingModel=false;$('showroomMode').disabled=!model||!daylightCycle;}}
}
async function loadExample(){
 const assetId=new URLSearchParams(location.search).get('asset');let asset=null,assetError=null;
 if(assetId)try{asset=await getAsset(assetId);if(!asset)throw new Error('资产不存在，可能已被删除');}catch(error){assetError=error;}
 try{
  if(asset?.kind==='model'){await importFiles([asset.file,...(asset.resources||[])],asset.partAssignments);return;}
  const r=await fetch('./MM06-展厅版.fbx');if(!r.ok)throw new Error('找不到示例 FBX');await loadModel(await r.arrayBuffer(),'MM06-展厅版.fbx');
  if(asset?.kind==='material')await addDesignAsset(asset);
  if(assetError)notify('打开资产失败：'+assetError.message,6000);
 }catch(e){hideBusy();notify('载入失败：'+e.message+'；可使用“选择 FBX 与配套纹理”导入模型。',6000);}
}

function createLibraryEntry(id,name='库中材质'){
 const material=new THREE.MeshStandardMaterial({name,color:0xffffff,roughness:.65,bumpScale:.02});
 installRoughnessShader(material);
 return {id,name,material,meshes:new Set(),uploads:{},mapTokens:{},repeat:[1,1],physical:defaultPhysical(),pendingDpi:{},densityInfo:null,flip:false,baseline:material.clone(),thumbnails:{},previews:{}};
}
async function refreshLibrary(){
 const select=$('libraryMaterial'),value=select.value;
 try{const assets=await listAssets();select.replaceChildren(new Option('选择已保存材质',''));for(const asset of assets.filter(a=>a.kind==='material').sort((a,b)=>b.updatedAt-a.updatedAt))select.add(new Option(asset.name,asset.id));select.value=value;}
 catch(error){notify('读取资产库失败：'+error.message,6000);}
}
async function addMaterialAsset(asset){
 if(materialType(asset)==='pattern')return addPatternSource(asset);
 if(!model||loadingModel)return notify('请先完成模型载入');
 if(asset?.kind!=='material')throw new Error('请选择有效的材质资产');
 const generation=modelGeneration,entry=createLibraryEntry(entries.length,asset.name);
 entry.category=asset.category||'面布';const savedPhysical=readPhysical(asset.physical,true);entry.physical={...savedPhysical,sizeSource:'manual'};entry.repeat=asset.repeat||[1,1];entry.legacyMaps=asset.legacyMaps||{};
 try{
  for(const[key]of MAPS){if(!asset.maps?.[key])continue;await uploadTexture(entry,key,asset.maps[key],true);if(generation!==modelGeneration)throw new Error('模型已经切换，请重新添加材质');if(!entry.material[key])throw new Error('贴图未能载入：'+key);if(asset.density?.[key]){entry.material[key].userData.density=asset.density[key];configureTexture(entry,entry.material[key],key);}}
  entry.physical=savedPhysical;for(const[key]of MAPS)if(entry.material[key])configureTexture(entry,entry.material[key],key);
  applySurface(entry.material,asset.surface);entry.flip=!!asset.surface.flip;
  entries.push(entry);entry.baseline.dispose();entry.baseline=entry.material.clone();
  $('materialCount').textContent=String(entries.length).padStart(2,'0');selectEntry(entry);showPanel('material');
  notify('已添加「'+entry.name+'」，拖动底部材质球到模型表面即可应用');
 }catch(error){for(const[key]of MAPS)entry.material[key]?.dispose();Object.values(entry.uploads).forEach(u=>URL.revokeObjectURL(u.preview));entry.material.dispose();entry.baseline.dispose();throw error;}
}
async function saveSelectedToLibrary(){
 const entry=selected;if(!entry||loadingModel)return notify('请先完成模型载入并选择材质');
 if(Object.keys(entry.pendingDpi).length)return notify('请先处理等待 DPI 的贴图');
 const asset={kind:'material',name:entry.name,category:fabricCategory(entry),surface:readSurface(entry.material),physical:{...entry.physical},repeat:[...entry.repeat],maps:{},density:{},legacyMaps:{...entry.legacyMaps}};
 const button=$('saveToLibrary');button.disabled=true;
 try{
  for(const[key]of MAPS){const texture=entry.material[key];if(!texture)continue;asset.density[key]=texture.userData.density||null;
   if(entry.uploads[key])asset.maps[key]=entry.uploads[key].file;
   else{const canvas=document.createElement('canvas');if(!texture.image?.width)throw new Error('无法读取内置贴图 '+key);canvas.width=texture.image.width;canvas.height=texture.image.height;canvas.getContext('2d').drawImage(texture.image,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('无法导出内置贴图 '+key);asset.maps[key]=new File([blob],key+'.png',{type:'image/png'});asset.legacyMaps[key]=readLegacyUV(texture);}
  }
  await saveAsset(asset);await refreshLibrary();notify('已保存「'+asset.name+'」到资产库');
 }catch(error){notify('保存资产失败：'+error.message,6000);}finally{button.disabled=false;}
}
async function importFiles(files,parts=null){if(loadingModel)return notify('请等待当前模型加载完成');const list=[...files],fbx=list.find(f=>/\.fbx$/i.test(f.name));if(!fbx)return notify('请选择一个 .fbx 文件，可同时附带纹理图片');if(fbx.size>512*1024*1024)return notify('模型文件过大，请使用小于 512 MB 的 FBX');await loadModel(await fbx.arrayBuffer(),fbx.name,list.filter(f=>f!==fbx),{parts});}
function renderMaterials(){const host=$('materialList');host.replaceChildren();document.querySelectorAll('[data-fabric]').forEach(b=>{b.classList.toggle('active',b.dataset.fabric===activeFabric);b.setAttribute('aria-pressed',String(b.dataset.fabric===activeFabric));});for(const entry of entries.filter(e=>!e.removed&&fabricCategory(e)===activeFabric)){const button=document.createElement('button');button.className='material-item'+(entry===selected?' active':'');button.setAttribute('aria-pressed',String(entry===selected));button.title=entry.name+' · 单击替换已配置的'+activeFabric+'部件；拖到模型表面替换单个部位';button.draggable=false;button.dataset.entryId=entry.id;button.addEventListener('pointerdown',event=>startMaterialDrag(event,entry));button.addEventListener('dblclick',event=>{event.preventDefault();event.stopPropagation();endMaterialDrag();pulseMaterialUsage(entry);});button.setAttribute('aria-label','选择材质 '+entry.name);const swatch=document.createElement('div');swatch.className='material-thumb';decorateSwatch(swatch,entry);const name=document.createElement('strong');name.textContent=entry.name;button.append(swatch,name);button.onclick=()=>{if(suppressMaterialClick){suppressMaterialClick=false;return;}setPatternMode(false);designUI?.setType('fabric');if(!replaceCategoryMaterials(entry,activeFabric)){selectEntry(entry);showPanel('material');}};designUI?.bindDockItem(button,{kind:'fabric',entry});host.append(button);}designUI?.syncDock();$('materialCount').textContent=String(entries.filter(e=>!e.removed).length).padStart(2,'0');}
function stopMaterialPulse(){if(!materialPulse)return;cancelAnimationFrame(materialPulse.frame);for(const item of materialPulse.items){if(Array.isArray(item.mesh.material))item.mesh.material=item.original;else item.mesh.material=item.original;item.highlight.dispose();}materialPulse=null;}
function pulseMaterialUsage(entry){
 stopMaterialPulse();
 const items=[];
 for(const mesh of entry.meshes){
  const original=mesh.material,slots=Array.isArray(original)?original.slice():[original],highlighted=false;
  const next=slots.map(material=>{if(material!==entry.material)return material;const clone=material.clone();installRoughnessShader(clone);if('emissive' in clone){clone.emissive.set(0x78b7ff);clone.emissiveMap=null;clone.emissiveIntensity=0;clone.needsUpdate=true;}items.push({mesh,original,highlight:clone});return clone;});
  if(items.some(item=>item.mesh===mesh))mesh.material=Array.isArray(original)?next:next[0];
 }
 if(!items.length){notify('该材质当前没有应用到模型部件');return;}
 const pulse={items,started:performance.now(),frame:0};materialPulse=pulse;
 const tick=now=>{if(materialPulse!==pulse)return;const t=Math.min(1,(now-pulse.started)/2200);const wave=Math.pow((Math.sin(t*Math.PI*6-Math.PI/2)+1)/2,1.65);for(const item of items)item.highlight.emissiveIntensity=.15+2.4*wave;if(t<1)pulse.frame=requestAnimationFrame(tick);else stopMaterialPulse();};
 pulse.frame=requestAnimationFrame(tick);
 notify('正在高亮显示「'+entry.name+'」应用的模型部件',2200);
}
function decorateSwatch(el,entry){el.replaceChildren();const color='#'+entry.material.color.getHexString();el.style.background=`radial-gradient(circle at 30% 25%,#ffffff85,transparent 48%),linear-gradient(145deg,${color},${color})`;const src=entry.material.map&&(entry.uploads.map?.preview||entry.thumbnails.map);if(src){const img=new Image();img.src=src;img.alt='';img.draggable=false;el.append(img);}}
function selectEntry(entry){if(!entry||entry.removed)return;selected=entry;activeFabric=fabricCategory(entry);$('fabricCategory').value=activeFabric;$('materialName').value=entry.name;$('materialUsage').textContent=`材质 ${String(entry.id+1).padStart(2,'0')} · 应用于 ${entry.meshes.size} 个网格`;decorateSwatch($('selectedSwatch'),entry);$('baseColor').value='#'+entry.material.color.getHexString();const vals={roughness:entry.material.roughness,metalness:entry.material.metalness,normalStrength:Math.abs(entry.material.normalScale.x),aoStrength:entry.material.aoMapIntensity,emissiveStrength:entry.material.emissiveIntensity,bumpStrength:entry.material.bumpScale};for(const[id,v]of Object.entries(vals)){$(id).value=v;$(id+'Value').textContent=Number(v).toFixed(id==='bumpStrength'?3:2);}$('repeatU').value=entry.repeat[0];$('repeatV').value=entry.repeat[1];updatePhysicalPanel(entry);$('flipNormal').checked=entry.flip;updateSlots();renderMaterials();applyIsolation();designUI?.select({kind:'fabric',entry});}
function buildSlots(){for(const[key,label,english]of MAPS){const wrap=document.createElement('div');wrap.className='texture-slot';wrap.id='slot-'+key;const upload=document.createElement('button');upload.className='texture-upload';upload.setAttribute('aria-label','上传'+label+'贴图');const span=document.createElement('span');const plus=document.createElement('strong');plus.textContent='＋';span.append(plus,document.createTextNode(label));upload.append(span);const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/webp,image/bmp';input.id='texture-'+key;input.onchange=async()=>{const entry=selected,file=input.files[0];input.value='';if(entry&&file){try{await uploadTexture(entry,key,file);}catch{}}};upload.onclick=()=>{if(!selected)return notify('请先导入模型');input.click();};const remove=document.createElement('button');remove.className='remove-texture';remove.textContent='×';remove.title='移除'+label+'贴图';remove.setAttribute('aria-label','移除'+label+'贴图');remove.onclick=()=>removeTexture(selected,key);wrap.append(upload,input,remove);wrap.title=label+' / '+english;$('textureSlots').append(wrap);}}
function updateSlots(){for(const[key,label]of MAPS){const wrap=$('slot-'+key);const has=!!selected?.material[key];wrap.classList.toggle('has-image',has);wrap.querySelectorAll('img').forEach(i=>i.remove());const src=selected?.uploads[key]?.preview||selected?.thumbnails[key];if(has&&src){const img=new Image();img.src=src;img.alt=label+'预览';wrap.prepend(img);}wrap.querySelector('strong').textContent=has?'✓':'＋';wrap.querySelector('.remove-texture').hidden=!has;wrap.title=selected?.uploads[key]?.file.name||label+(has?' · FBX 内置贴图':' · 点击上传');}}
function configureTexture(entry,texture,key){texture.colorSpace=MAPS.find(([k])=>k===key)[3]?THREE.SRGBColorSpace:THREE.NoColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;if(entry.legacyMaps?.[key])applyLegacyUV(texture,entry.legacyMaps[key]);else if(entry.physical.mode==='physical'){const measured=entry.physical.sizeSource==='dpi'?texture.userData.density:null;setPhysicalTransform(texture,measured?{...entry.physical,...measured}:entry.physical,physicalModel.cmPerUnit);}else{texture.channel=0;texture.matrixAutoUpdate=true;texture.center.set(0,0);texture.offset.set(0,0);texture.rotation=0;texture.repeat.set(...entry.repeat);texture.updateMatrix();}if(entry.placement)applyPlacement(texture,entry.placement);configureTextureSampling(texture,renderer);}
async function uploadTexture(entry,key,file,quiet=false){
 if(file.size>64*1024*1024){notify('单张贴图请小于 64 MB');return;}
 const generation=modelGeneration,token=(entry.mapTokens[key]||0)+1;entry.mapTokens[key]=token;
 const url=URL.createObjectURL(file);let texture;
 try{
  const meta=readImageDensity(await file.arrayBuffer());texture=await new THREE.TextureLoader().loadAsync(url);
  if(generation!==modelGeneration||entry.mapTokens[key]!==token){texture.dispose();URL.revokeObjectURL(url);return;}
  if(texture.image.width>renderer.capabilities.maxTextureSize||texture.image.height>renderer.capabilities.maxTextureSize)throw new Error('图片尺寸超过显卡支持范围');
  const density=physicalSizeFromDensity(meta,texture.image.width,texture.image.height,entry.physical.fallbackDpi);
  if(entry.physical.mode==='physical'&&entry.physical.sizeSource==='dpi'&&!density&&!(quiet&&entry.legacyMaps?.[key])){
   entry.pendingDpi[key]=file;texture.dispose();URL.revokeObjectURL(url);
   if(entry===selected)updatePhysicalPanel(entry);
   if(quiet)throw new Error(file.name+' 未记录 DPI，请为此文件指定 DPI');
   notify(file.name+' 未记录有效 DPI；请在右侧填写 DPI 后应用，原贴图保持不变',6500);return;
  }
  if(density){texture.userData.density=density;entry.densityInfo={...density,name:file.name};if(entry.physical.sizeSource==='dpi'){entry.physical.widthCm=density.widthCm;entry.physical.heightCm=density.heightCm;entry.physical.initialized=true;}}
  if(!entry.physical.initialized&&entry.physical.sizeSource!=='dpi'){entry.physical.heightCm=entry.physical.widthCm*texture.image.height/texture.image.width;entry.physical.initialized=true;}
  const old=entry.material[key];if(old&&old!==entry.baseline[key])old.dispose();if(entry.uploads[key])URL.revokeObjectURL(entry.uploads[key].preview);
  delete entry.pendingDpi[key];if(!quiet&&entry.legacyMaps)delete entry.legacyMaps[key];texture.userData.formUpload=true;configureTexture(entry,texture,key);entry.material[key]=texture;entry.uploads[key]={file,preview:url};
  if(key==='map')entry.material.color.set(0xffffff);if(key==='roughnessMap')entry.material.roughness=1;if(key==='metalnessMap')entry.material.metalness=1;if(key==='emissiveMap')entry.material.emissive.set(0xffffff);
  entry.material.needsUpdate=true;if(entry===selected)selectEntry(entry);else renderMaterials();
  if(!quiet)notify(density&&entry.physical.sizeSource==='dpi'?file.name+' · '+density.dpiX.toFixed(2)+' × '+density.dpiY.toFixed(2)+' DPI → '+density.widthCm.toFixed(2)+' × '+density.heightCm.toFixed(2)+' cm':file.name+' 已应用于 '+entry.name);
 }catch(e){texture?.dispose();URL.revokeObjectURL(url);notify('贴图载入失败：'+e.message,5000);throw e;}
}
function removeTexture(entry,key){if(!entry)return;entry.mapTokens[key]=(entry.mapTokens[key]||0)+1;const old=entry.material[key];if(old&&old!==entry.baseline[key])old.dispose();entry.material[key]=null;if(entry.uploads[key]){URL.revokeObjectURL(entry.uploads[key].preview);delete entry.uploads[key];}delete entry.pendingDpi[key];if(!Object.keys(entry.uploads).length)entry.densityInfo=null;entry.material.needsUpdate=true;selectEntry(entry);}
function applyIsolation(){invalidateAnnotations();for(const entry of entries)entry.material.visible=!$('isolate').checked||entry===selected;}
function resetMaterial(){if(!selected)return;const e=selected;for(const[key]of MAPS){e.mapTokens[key]=(e.mapTokens[key]||0)+1;if(e.material[key]&&e.material[key]!==e.baseline[key])e.material[key].dispose();}Object.values(e.uploads).forEach(u=>URL.revokeObjectURL(u.preview));e.uploads={};e.material.copy(e.baseline);installRoughnessShader(e.material);e.material.needsUpdate=true;e.repeat=[1,1];e.physical=defaultPhysical();e.pendingDpi={};e.densityInfo=null;e.flip=false;e.name=e.baseline.name||'未命名材质 '+(e.id+1);applyScene();selectEntry(e);notify('已恢复该材质的 FBX 初始设置');}
function showPanel(tab){
 if(showroom?.active)return;
 const marking=tab==='annotation',material=tab==='material'||tab==='pattern';
 if(!marking&&annotationMode)setAnnotationMode(false,{keepInspector:true});
 $('annotationPanel').hidden=!marking;
 for(const name of ['material','pattern','scene']){$(name+'Panel').hidden=name!=='scene'||tab!=='scene';$(name+'Tab').setAttribute('aria-selected',String(name===tab));}
 $('compactMaterialPanel').hidden=!material;$('backToScene').hidden=!material;$('inspectorHeading').textContent=marking?'标记属性':material?'材质栏':'属性编辑器';
 if(material||marking)setInspectorCollapsed(false);
}

function pickModelMaterial(clientX,clientY){
 if(!model||loadingModel||showroom?.active)return null;
 const rect=$('canvas').getBoundingClientRect();
 if(clientX<rect.left||clientX>rect.right||clientY<rect.top||clientY>rect.bottom)return null;
 model.updateMatrixWorld(true);camera.updateMatrixWorld();
 const pointer=new THREE.Vector2((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1);
 const ray=new THREE.Raycaster();ray.setFromCamera(pointer,camera);
 const meshes=[];model.traverseVisible(object=>{if(object.isMesh)meshes.push(object);});
 for(const hit of ray.intersectObjects(meshes,false)){
  const slot=Array.isArray(hit.object.material)?hit.face?.materialIndex:0;
  const material=slotMaterial(hit.object,slot);if(!material?.visible)continue;
  const entry=entries.find(candidate=>candidate.material===material);
  if(entry)return {mesh:hit.object,slot,entry,point:hit.point.clone()};
 }
 return null;
}
function animatePreview(x,y,size,round=8,opacity=1,duration=400){
 const preview=$('materialPreview'),rect=preview.getBoundingClientRect();
 previewAnimation?.cancel();
 const from={transform:`translate3d(${rect.left}px,${rect.top}px,0) scale(${rect.width/300})`,opacity:getComputedStyle(preview).opacity,borderRadius:getComputedStyle(preview).borderRadius};
 const to={transform:`translate3d(${x-size/2}px,${y-size/2}px,0) scale(${size/300})`,opacity,borderRadius:round+'px'};
 Object.assign(preview.style,to);
 previewAnimation=preview.animate([from,to],{duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:duration,easing:'cubic-bezier(.2,.8,.2,1)'});
}
function centerMaterialPreview(entry){
 if(!draggedMaterial||draggedMaterial.phase!=='pressed')return;
 draggedMaterial.phase='preview';suppressMaterialClick=true;
 const r=$('canvas').getBoundingClientRect(),size=Math.min(680,r.width*.9,r.height*.84);
 animatePreview(r.left+r.width/2,r.top+r.height/2,size);
}
function moveMaterialPreview(event,hit){
 if(!draggedMaterial)return;
 const preview=$('materialPreview');
 // Once the hold preview becomes a drag, keep one small, stable texture ball
 // under the pointer. Direct transforms avoid restarting an animation per event.
 previewAnimation?.cancel();
 preview.style.opacity='1';
 preview.style.borderRadius=draggedMaterial.patternTarget?'12px':'50%';
 preview.style.transform=`translate3d(${event.clientX-27}px,${event.clientY-27}px,0) scale(.18)`;
 draggedMaterial.phase='dragging';
 const hoverKey=hit?hit.mesh.uuid+':'+hit.slot:'';
 if(hoverKey!==draggedMaterial.hoverKey){
  clearTimeout(materialHoverTimer);preview.classList.remove('jelly-ready');draggedMaterial.hoverKey=hoverKey;
  if(hoverKey)materialHoverTimer=setTimeout(()=>{if(draggedMaterial?.hoverKey===hoverKey)preview.classList.add('jelly-ready');},1000);
 }
 preview.classList.add('following');
 $('materialDropHint').hidden=!hit;
 $('materialDropHint').textContent=hit?(draggedMaterial.patternTarget?'松开'+(draggedMaterial.patternTarget.source?'放置':'移动')+'图案':'松开替换「'+hit.entry.name+'」'):'';
}
function startMaterialDrag(event,entry,patternTarget=null){
 if(event.button!==0||loadingModel||!$('loading').hidden)return;
 endMaterialDrag();setPatternMode(false);clearTimeout(materialPreviewTimer);suppressMaterialClick=false;
 const element=event.currentTarget,rect=element.querySelector('.material-thumb').getBoundingClientRect();
 draggedMaterial={entry,patternTarget,generation:modelGeneration,element,sourceRect:rect,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,phase:'pressed'};
 element.setPointerCapture(event.pointerId);
 const preview=$('materialPreview'),image=preview.querySelector('.material-preview-image'),label=preview.querySelector('.material-preview-label');
 document.body.append(preview);previewAnimation?.cancel();preview.className='material-preview active';
 const source=entry.uploads.map?.preview||entry.previews.map||entry.thumbnails.map||imageData(entry.material.map,2048,.92);
 image.style.backgroundImage=source?`url("${source}")`:'none';
 image.style.backgroundColor=patternTarget?'transparent':'#'+entry.material.color.getHexString();
 const density=entry.material.map?.userData.density,p=entry.physical;
 const physical=p.mode==='physical'&&(p.initialized||density);
 const w=p.sizeSource==='dpi'&&density?density.widthCm:p.widthCm,h=p.sizeSource==='dpi'&&density?density.heightCm:p.heightCm;
 // The model keeps physical tiling; the inspection window shows one full,
 // native-resolution sample so the weave/detail is not reduced to tiny repeats.
 image.style.backgroundRepeat='no-repeat';
 image.style.backgroundSize=patternTarget?'contain':'cover';
 image.style.imageRendering='auto';
 image.style.setProperty('--preview-angle',(p.angle||0)+'deg');
 label.textContent=entry.name+(patternTarget?' · 拖到模型放置':physical?' · 150 × 150 cm':'');
 preview.style.transform=`translate3d(${rect.left}px,${rect.top}px,0) scale(${rect.width/300})`;preview.style.opacity='0';preview.style.borderRadius='50%';
 materialHoldTimer=setTimeout(()=>centerMaterialPreview(entry),220);
 controls.enabled=false;controls.autoRotate=false;
}
function endMaterialDrag(success=false){
 const session=draggedMaterial;if(!session)return;
 draggedMaterial=null;clearTimeout(materialHoldTimer);
 document.querySelector('.dock-delete-tools').classList.remove('drop-ready','drop-blocked');
 clearTimeout(materialHoverTimer);materialHoverTimer=null;$('materialPreview').classList.remove('jelly-ready');
 if(session.element.hasPointerCapture(session.pointerId))session.element.releasePointerCapture(session.pointerId);
 controls.enabled=true;syncAutoRotate();
 session.element.classList.remove('dragging');$('materialDropHint').hidden=true;$('viewport').classList.remove('material-drag-active');
 const preview=$('materialPreview'),r=session.sourceRect;
 if(success===true){const p=preview.getBoundingClientRect();animatePreview(p.left+p.width/2,p.top+p.height/2,10,40,0,220);}
 else animatePreview(r.left+r.width/2,r.top+r.height/2,r.width,150,0,380);
 clearTimeout(materialPreviewTimer);materialPreviewTimer=setTimeout(()=>{preview.className='material-preview';},400);
}
function finishReveal(){if(activeReveal){cancelAnimationFrame(activeReveal.frame);for(const effect of activeReveal.effects||[activeReveal.effect])effect.dispose();activeReveal=null;}}
function playMaterialReveal(hit,previous){
 finishReveal();
 if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const effect=revealMaterial(scene,hit.mesh,hit.slot,previous,hit.point),started=performance.now();
 const session={effects:[effect],frame:0};activeReveal=session;
 const tick=now=>{const p=Math.min(1,(now-started)/REVEAL_DURATION);const eased=p*p*(3-2*p);effect.update(eased);if(p<1)session.frame=requestAnimationFrame(tick);else finishReveal();};
 session.frame=requestAnimationFrame(tick);
}
function playMaterialRevealBatch(items){
 finishReveal();if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const effects=items.map(item=>fadeMaterial(scene,item.mesh,item.slot,item.previous)),started=performance.now(),session={effects,frame:0};activeReveal=session;
 const tick=now=>{const p=Math.min(1,(now-started)/REVEAL_DURATION),eased=p*p*(3-2*p);effects.forEach(effect=>effect.update(eased));if(p<1)session.frame=requestAnimationFrame(tick);else finishReveal();};session.frame=requestAnimationFrame(tick);
}
function replaceHitMaterial(hit,source){
 if(hit.entry===source){notify('该部位已经使用这个材质');return;}
 const previous=slotMaterial(hit.mesh,hit.slot);
 if(!assignMaterial(hit.mesh,hit.slot,source.material))return;
 playMaterialReveal(hit,previous);
 assignmentHistory.push({mesh:hit.mesh,slot:hit.slot,previous});if(assignmentHistory.length>30)assignmentHistory.shift();
 $('undoMaterial').disabled=false;rebuildMaterialUsage(model,entries);selectEntry(source);
 // 材质替换保持静默，避免在模型底部遮挡视图。
}
function replaceCategoryMaterials(source,type=activeFabric){
 const slots=materialSlotsForPartType(type),items=[],changed=[];
 for(const {mesh,slot,material} of slots){const entry=entries.find(candidate=>candidate.material===material);if(!entry||entry===source)continue;const previous=slotMaterial(mesh,slot);if(assignMaterial(mesh,slot,source.material)){items.push({mesh,slot,previous});changed.push({mesh,slot,previous});}}
 if(!slots.length){notify('当前模型尚未配置“'+type+'”材质球，请先点击齿轮进行配置');return false;}
 if(!changed.length){notify('“'+type+'”部件已经使用这个材质');return false;}
 const sourceTypes=source.material.userData.partTypes instanceof Set?source.material.userData.partTypes:new Set();source.material.userData.partTypes=new Set([...sourceTypes,type]);
 playMaterialRevealBatch(items);assignmentHistory.push({batch:changed});if(assignmentHistory.length>30)assignmentHistory.shift();$('undoMaterial').disabled=false;rebuildMaterialUsage(model,entries);selectEntry(source);return true;
}
function undoMaterialAssignment(){
 finishReveal();
 if(loadingModel)return;
 const action=assignmentHistory.pop();if(!action)return;
 const changes=action.batch||[action];for(const item of changes)assignMaterial(item.mesh,item.slot,item.previous);rebuildMaterialUsage(model,entries);
 selectEntry(entries.find(entry=>entry.material===changes[0].previous)||selected);
 $('undoMaterial').disabled=assignmentHistory.length===0;notify('已撤销上一次材质替换');
}
function overDockTrash(event){
 const rect=document.querySelector('.dock-delete-tools').getBoundingClientRect();
 return event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom;
}
function draggedDockItem(session){return session.patternTarget||{kind:'fabric',entry:session.entry};}
function bindMaterialDrop(){
 document.addEventListener('pointermove',event=>{
  const s=draggedMaterial;if(!s||s.pointerId!==event.pointerId)return;
  if(s.phase!=='dragging'&&Math.hypot(event.clientX-s.startX,event.clientY-s.startY)<8)return;
  clearTimeout(materialHoldTimer);suppressMaterialClick=true;s.element.classList.add('dragging');
  $('viewport').classList.add('material-drag-active');
  const overTrash=overDockTrash(event),allowed=overTrash&&canRemoveDockItem(draggedDockItem(s)),trash=document.querySelector('.dock-delete-tools');
  trash.classList.toggle('drop-ready',allowed);trash.classList.toggle('drop-blocked',overTrash&&!allowed);
  moveMaterialPreview(event,overTrash?null:pickModelMaterial(event.clientX,event.clientY));
  if(overTrash){$('materialDropHint').hidden=false;$('materialDropHint').textContent=allowed?'松开删除':'正在使用的面料不可删除';}
 });
 document.addEventListener('pointerup',event=>{
  const s=draggedMaterial;if(!s||s.pointerId!==event.pointerId)return;
  if(s.phase==='dragging'&&s.generation===modelGeneration&&overDockTrash(event)){
   const item=draggedDockItem(s),allowed=canRemoveDockItem(item);endMaterialDrag(allowed);suppressMaterialClick=true;
   if(allowed){removeUnusedDockItems([item]);notify('已移除'+(item.entry?'材质':'图案'));}else notify('正在使用的面料不可删除');
   return;
  }
  const hit=s.phase==='dragging'&&s.generation===modelGeneration&&document.elementFromPoint(event.clientX,event.clientY)===$('canvas')?pickModelMaterial(event.clientX,event.clientY):null;
  endMaterialDrag(!!hit);if(hit){if(s.patternTarget){try{dropDesignPattern(s.patternTarget,event);}catch(error){notify('图案放置失败：'+error.message);}}else replaceHitMaterial(hit,s.entry);}
 });
 document.addEventListener('pointercancel',()=>endMaterialDrag());
 document.addEventListener('keydown',e=>{if(e.key==='Escape')endMaterialDrag();});
 window.addEventListener('blur',()=>endMaterialDrag());
 const viewport=$('viewport'),overlay=$('dropOverlay'),hint=$('materialDropHint');let lastPick=0,lastValid=false;
 const isMaterial=event=>!!draggedMaterial&&Array.from(event.dataTransfer.types).includes(MATERIAL_DRAG_TYPE);
 const isFiles=event=>Array.from(event.dataTransfer.types).includes('Files');
 viewport.addEventListener('dragenter',event=>{
  if(isMaterial(event)){event.preventDefault();lastPick=0;return;}
  if(isFiles(event)){event.preventDefault();overlay.classList.add('show');}
 });
 viewport.addEventListener('dragover',event=>{
  if(isMaterial(event)){
   event.preventDefault();overlay.classList.remove('show');
   if(performance.now()-lastPick<75){event.dataTransfer.dropEffect=lastValid?'copy':'none';return;}lastPick=performance.now();
   const hit=pickModelMaterial(event.clientX,event.clientY);moveMaterialPreview(event,hit);
   lastValid=!!hit;event.dataTransfer.dropEffect=hit?'copy':'none';hint.hidden=false;hint.classList.toggle('valid-target',!!hit);
   hint.textContent=hit?'松开：将「'+hit.entry.name+'」所在部位替换为「'+draggedMaterial.entry.name+'」':'拖到模型表面，松开鼠标替换材质';
  }else if(isFiles(event)){event.preventDefault();event.dataTransfer.dropEffect='copy';}
 });
 viewport.addEventListener('dragleave',event=>{if(!viewport.contains(event.relatedTarget)){overlay.classList.remove('show');hint.hidden=true;}});
 viewport.addEventListener('drop',event=>{
  overlay.classList.remove('show');
  if(isMaterial(event)){
   event.preventDefault();const source=draggedMaterial;
   const hit=source.generation===modelGeneration?pickModelMaterial(event.clientX,event.clientY):null;
   if(hit){replaceHitMaterial(hit,source.entry);endMaterialDrag(true);}else{endMaterialDrag(false);notify('请把材质球拖到模型表面');}
  }else if(isFiles(event)){event.preventDefault();importFiles(event.dataTransfer.files);}
 });
 document.addEventListener('dragend',()=>{endMaterialDrag();overlay.classList.remove('show');});
 document.addEventListener('drop',()=>{endMaterialDrag();overlay.classList.remove('show');});
 document.addEventListener('keydown',event=>{if(event.key==='Escape')endMaterialDrag();});
 window.addEventListener('blur',endMaterialDrag);
}
function updateModelDimensions(){
 const dimensions=physicalModel.rawSize.map(value=>value*physicalModel.cmPerUnit);
 $('modelDimensions').textContent='宽 X '+dimensions[0].toFixed(2)+' × 高 Y '+dimensions[1].toFixed(2)+' × 深 Z '+dimensions[2].toFixed(2)+' cm';
 $('modelRealSize').value=Number(Math.max(...dimensions).toFixed(3));
 $('modelUnitSource').textContent=physicalModel.calibrated?'已按实测最长边校准。视图缩放不改变实物尺寸。':physicalModel.unitKnown?'已读取 FBX 单位：1 模型单位 = '+physicalModel.cmPerUnit+' cm。请核对尺寸。':'FBX 未提供有效单位，暂按厘米处理；请填写已知实物尺寸校准。';
}
function updatePhysicalPanel(entry){
 const p=entry.physical;
 $('sizeSource').value=p.sizeSource||'manual';const auto=p.sizeSource==='dpi';
 $('textureWidth').readOnly=auto;$('textureHeight').readOnly=auto;$('textureLock').disabled=auto;
 if(auto&&!p.initialized){$('textureWidth').value='';$('textureHeight').value='';}
 $('dpiInfo').textContent=entry.densityInfo?entry.densityInfo.name+' · '+entry.densityInfo.pixelWidth+' × '+entry.densityInfo.pixelHeight+' px · '+entry.densityInfo.dpiX.toFixed(2)+' × '+entry.densityInfo.dpiY.toFixed(2)+' DPI · '+entry.densityInfo.source+(entry.densityInfo.conflict?'（EXIF 与 JFIF 不同，采用 EXIF）':''):'上传后从文件元数据读取像素和 DPI，不使用浏览器默认 DPI。';
 const pending=Object.values(entry.pendingDpi||{});$('missingDpi').hidden=!pending.length;
 $('pendingDpiNames').textContent=pending.map(file=>file.name).join('、')+'：未记录有效 DPI，等待指定后应用。';
 $('textureSizing').value=p.mode;$('physicalInputs').hidden=p.mode!=='physical';$('legacyInputs').hidden=p.mode!=='legacy';
 $('textureWidth').value=auto&&!p.initialized?'':Number(p.widthCm.toFixed(4));$('textureHeight').value=auto&&!p.initialized?'':Number(p.heightCm.toFixed(4));
 $('textureLock').checked=p.locked;$('textureAngle').value=p.angle;$('textureAngleValue').textContent=p.angle+'°';
 let missing=false,distorted=false;
 for(const mesh of entry.meshes){
  const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
  materials.forEach((material,slot)=>{if(material!==entry.material)return;const metric=mesh.userData.physicalUV?.slots?.[slot];if(!metric?.valid)missing=true;else if(metric.distorted)distorted=true;});
 }
 $('physicalStatus').textContent=missing?'此材质有部位缺少有效 UV，无法按实物尺寸铺贴。':distorted?'检测到 UV 尺度不均或拉伸：按表面平均比例标定。要获得严格尺寸，请使用等比例、无拉伸 UV。':entry.meshes.size?'沿原有 UV 铺贴，已按模型尺寸标定。':'拖到模型后，将按目标部位的真实尺寸铺贴。';
 $('physicalStatus').classList.toggle('warning',missing||distorted);
}
function refreshPhysicalTextures(entry){
 for(const [key] of MAPS){
  const texture=entry.material[key];if(!texture||!entry.uploads[key])continue;
  configureTexture(entry,texture,key);
 }
 entry.material.needsUpdate=true;
}
function bindPhysicalControls(){
 $('sizeSource').onchange=async()=>{
  if(!selected)return;const entry=selected;entry.physical.sizeSource=$('sizeSource').value;
  if(entry.physical.sizeSource==='dpi'){
   for(const[key,u]of Object.entries(entry.uploads)){try{await uploadTexture(entry,key,u.file);}catch{}}
  }else{refreshPhysicalTextures(entry);for(const[key,file]of Object.entries(entry.pendingDpi)){try{await uploadTexture(entry,key,file);}catch{}}}
  updatePhysicalPanel(entry);
 };
 $('applyDpi').onclick=async()=>{
  if(!selected)return;const entry=selected,x=$('dpiX').valueAsNumber,y=$('dpiY').valueAsNumber;
  if(![x,y].every(n=>Number.isFinite(n)&&n>0&&n<=100000)){notify('请输入有效的水平和垂直 DPI');return;}
  entry.physical.fallbackDpi={x,y};
  for(const[key,file]of Object.entries(entry.pendingDpi)){try{await uploadTexture(entry,key,file);}catch{}}
  updatePhysicalPanel(entry);
 };

 $('textureSizing').onchange=()=>{if(!selected)return;selected.physical.mode=$('textureSizing').value;refreshPhysicalTextures(selected);updatePhysicalPanel(selected);};
 for(const [id,field,other] of [['textureWidth','widthCm','heightCm'],['textureHeight','heightCm','widthCm']]){
  const updateSize=event=>{
   if(!selected)return;const p=selected.physical,value=$(id).valueAsNumber;
   const next={...p,[field]:value,initialized:true,sizeSource:'manual'};if(p.locked)next[other]=p[other]*value/p[field];
   try{selected.physical=readPhysical(next);}catch{if(event.type==='change'){notify('宽高须在 0.01–100000 cm 之间');updatePhysicalPanel(selected);}return;}
   refreshPhysicalTextures(selected);
   $(id==='textureWidth'?'textureHeight':'textureWidth').value=Number(next[other].toFixed(4));
  };
  $(id).oninput=updateSize;$(id).onchange=updateSize;
 }
 $('textureLock').onchange=()=>{if(selected)selected.physical.locked=$('textureLock').checked;};
 $('textureAngle').oninput=()=>{if(!selected)return;selected.physical.angle=Number($('textureAngle').value);$('textureAngleValue').textContent=selected.physical.angle+'°';refreshPhysicalTextures(selected);};
 $('calibrateModel').onclick=()=>{
  if(!model)return;const longest=$('modelRealSize').valueAsNumber;
  if(!Number.isFinite(longest)||longest<.01||longest>1000000){notify('请输入有效的模型最长边尺寸');updateModelDimensions();return;}
  physicalModel.cmPerUnit=longest/Math.max(...physicalModel.rawSize);physicalModel.calibrated=true;
  updateModelDimensions();entries.forEach(refreshPhysicalTextures);notify('模型单位已校准，所有物理尺寸贴图已同步更新');
 };
 $('resetModelUnits').onclick=()=>{physicalModel.cmPerUnit=physicalModel.fbxCmPerUnit;physicalModel.calibrated=false;updateModelDimensions();entries.forEach(refreshPhysicalTextures);};
}
function patternUnit(){return 4.2/Math.max(...physicalModel.rawSize)/physicalModel.cmPerUnit*state.scale;}
function syncPatterns(){for(const p of patterns){p.host.updateWorldMatrix(true,false);p.mesh.matrix.copy(p.host.matrixWorld);p.mesh.visible=p.host.visible&&slotMaterial(p.host,p.slot)?.visible!==false;}}
function selectPattern(p){selectedPattern=p;$('patternLayers').value=p?String(patterns.indexOf(p)):'';if(p){$('patternWidth').value=p.width;$('patternHeight').value=p.height;$('patternRotation').value=p.angle;$('patternRotationValue').textContent=p.angle+'°';} $('patternDelete').disabled=!p;$('patternMove').disabled=!p;drawPatternUV();syncPatternPbr();}
function renderPatternList(){const list=$('patternLayers');list.replaceChildren();patterns.forEach((p,i)=>{const o=document.createElement('option');o.value=i;o.textContent=(i+1)+'. '+p.name;list.append(o);});selectPattern(selectedPattern);}
function clearPatterns(){finishPatternReveals();for(const p of patterns){scene.remove(p.mesh);p.mesh.geometry.dispose();p.mesh.material.dispose();disposePatternMaps(p);}patterns=[];selectedPattern=null;patternPlaceMode=false;controls.enabled=true;renderPatternList();}
function rebuildPattern(p){
 p.host.updateWorldMatrix(true,false);const point=p.point.clone().applyMatrix4(p.host.matrixWorld),normal=p.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(p.host.matrixWorld)).normalize();
 const geometry=p.uv&&!p.singlePlacement?uvPatternGeometry(p.host,p.slot,p.uv,p.width,p.height,THREE.MathUtils.degToRad(p.angle),patternUnit()):surfacePatternGeometry(p.host,p.slot,point,normal,p.width*patternUnit(),p.height*patternUnit(),THREE.MathUtils.degToRad(p.angle));
 if(!geometry.attributes.position.count){geometry.dispose();throw new Error('该位置无法贴合，请缩小图案或换一个位置');}
 if(p.singlePlacement){geometry.setAttribute('uv2',geometry.attributes.uv.clone());}
 p.mesh.geometry.dispose();p.mesh.geometry=geometry;syncPatterns();drawPatternUV();
}
function patternHit(event){
 if(!model||loadingModel)return null;model.updateMatrixWorld(true);camera.updateMatrixWorld();const r=$('canvas').getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((event.clientX-r.left)/r.width*2-1,1-(event.clientY-r.top)/r.height*2),camera);
 const meshes=[];model.traverseVisible(o=>{if(o.isMesh)meshes.push(o);});
 for(const hit of ray.intersectObjects(meshes,false)){const slot=Array.isArray(hit.object.material)?hit.face.materialIndex:0;if(slotMaterial(hit.object,slot)?.visible)return {uv:hit.uv?.toArray(),host:hit.object,slot,point:hit.object.worldToLocal(hit.point.clone()),normal:hit.face.normal.clone()};}return null;
}
function setPatternMode(mode){patternPlaceMode=mode;controls.enabled=!mode;$('patternPlace').textContent=mode==='new'?'请点击模型（Esc 取消）':'点击模型放置图片';$('patternMove').textContent=mode==='move'?'请点击新的位置':'重新放置选中图案';$('canvas').style.cursor=mode||annotationMode?'crosshair':'';}
let uvBounds=null;
function drawPatternUV(){
 const canvas=$('patternUV');if(!canvas)return;const ctx=canvas.getContext('2d'),p=selectedPattern;ctx.fillStyle='#202a38';ctx.fillRect(0,0,320,250);uvBounds=null;if(!p?.uv)return;
 const g=p.host.geometry,uv=g.attributes.uv,ranges=Array.isArray(p.host.material)?g.groups.filter(r=>r.materialIndex===p.slot):[{start:0,count:g.index?g.index.count:uv.count}];let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const r of ranges)for(let i=r.start;i<r.start+r.count;i++){const k=g.index?g.index.getX(i):i;minX=Math.min(minX,uv.getX(k));maxX=Math.max(maxX,uv.getX(k));minY=Math.min(minY,uv.getY(k));maxY=Math.max(maxY,uv.getY(k));}
 const scale=Math.min(290/Math.max(.001,maxX-minX),220/Math.max(.001,maxY-minY)),ox=(320-(maxX-minX)*scale)/2,oy=(250-(maxY-minY)*scale)/2;uvBounds={minX,maxY,scale,ox,oy};ctx.strokeStyle='#94b3d433';ctx.lineWidth=.5;ctx.beginPath();
 for(const r of ranges){const stride=Math.max(1,Math.ceil(r.count/12000))*3;for(let i=r.start;i<r.start+r.count;i+=stride){for(let j=0;j<3;j++){const k=g.index?g.index.getX(i+j):i+j,x=ox+(uv.getX(k)-minX)*scale,y=oy+(maxY-uv.getY(k))*scale;if(j===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.closePath();}}ctx.stroke();
 const x=ox+(p.uv[0]-minX)*scale,y=oy+(maxY-p.uv[1])*scale;
 const range=ranges[0],metric=range&&measureUVMetric(g,p.host.matrixWorld,range.start,range.count);if(metric){ctx.save();ctx.translate(x,y);ctx.scale(patternUnit()/metric.u*scale,patternUnit()/metric.v*scale);ctx.rotate(-THREE.MathUtils.degToRad(p.angle));ctx.drawImage(p.mesh.material.map.image,-p.width/2,-p.height/2,p.width,p.height);ctx.restore();}
 ctx.strokeStyle='#68aeff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,7,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#fff';ctx.fillRect(x-2,y-2,4,4);
}
const PATTERN_PBR=[['normalMap','法线'],['roughnessMap','粗糙度'],['metalnessMap','金属度']];
function disposePatternMaps(p){for(const [key] of MAPS)p.mesh.material[key]?.dispose();}
function syncPatternPbr(){
 const p=selectedPattern,m=p?.mesh.material;
 for(const [key,label] of PATTERN_PBR){const input=$('pattern-'+key);if(!input)continue;input.disabled=!p;$('pattern-'+key+'-status').textContent=p?.pbrFiles?.[key]?.name||'未上传';$('pattern-'+key+'-remove').disabled=!m?.[key];}
 for(const [id,prop] of [['Normal','normalScale'],['Roughness','roughness'],['Metalness','metalness']]){const control=$('pattern'+id+'Strength');control.disabled=!p;control.value=m?(id==='Normal'?Math.abs(m.normalScale.x):m[prop]):id==='Normal'?1:id==='Roughness'?.8:0;$('pattern'+id+'Value').textContent=Number(control.value).toFixed(2);}
 $('patternNormalFlip').disabled=!p;$('patternNormalFlip').checked=!!m&&m.normalScale.y<0;
}
function bindPatternPbr(){
 for(const [key,label] of PATTERN_PBR){const row=document.createElement('div');row.className='pattern-pbr-row';const upload=document.createElement('label');upload.className='button';upload.textContent='上传'+label;const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/webp';input.hidden=true;input.id='pattern-'+key;upload.append(input);const status=document.createElement('span');status.id='pattern-'+key+'-status';const remove=document.createElement('button');remove.id='pattern-'+key+'-remove';remove.className='text-button';remove.textContent='移除';row.append(upload,status,remove);$('patternPbrSlots').append(row);
 input.onchange=async()=>{const p=selectedPattern,file=input.files[0];input.value='';if(!p||!file)return;const tokens=p.pbrTokens||=( {} ),token=(tokens[key]||0)+1;tokens[key]=token;const url=URL.createObjectURL(file);let texture;
 try{if(file.size>64*1024*1024)throw new Error('图片不能超过 64 MB');texture=await new THREE.TextureLoader().loadAsync(url);if(tokens[key]!==token||!patterns.includes(p)){texture.dispose();return;}if(Math.max(texture.image.width,texture.image.height)>renderer.capabilities.maxTextureSize)throw new Error('图片尺寸超出显卡限制');texture.colorSpace=THREE.NoColorSpace;configureTextureSampling(texture,renderer);const m=p.mesh.material;m[key]?.dispose();m[key]=texture;(p.pbrFiles||={})[key]=file;if(key==='roughnessMap')m.roughness=1;if(key==='metalnessMap')m.metalness=1;m.needsUpdate=true;if(p===selectedPattern)syncPatternPbr();notify(label+'贴图已应用于「'+p.name+'」');}catch(e){texture?.dispose();notify('贴图载入失败：'+e.message);}finally{URL.revokeObjectURL(url);}};
 remove.onclick=()=>{const p=selectedPattern;if(!p)return;p.pbrTokens||={};p.pbrTokens[key]=(p.pbrTokens[key]||0)+1;p.mesh.material[key]?.dispose();p.mesh.material[key]=null;delete p.pbrFiles?.[key];p.mesh.material.needsUpdate=true;syncPatternPbr();};
 }
 for(const [id,prop] of [['Normal','normalScale'],['Roughness','roughness'],['Metalness','metalness']])$('pattern'+id+'Strength').oninput=e=>{if(!selectedPattern)return;const m=selectedPattern.mesh.material,v=Number(e.target.value);if(id==='Normal')m.normalScale.set(v,$('patternNormalFlip').checked?-v:v);else m[prop]=v;$('pattern'+id+'Value').textContent=v.toFixed(2);};
 $('patternNormalFlip').onchange=()=>{if(selectedPattern){const m=selectedPattern.mesh.material;m.normalScale.y=Math.abs(m.normalScale.x)*($('patternNormalFlip').checked?-1:1);}};
 syncPatternPbr();
}
function bindPatterns(){
 bindPatternPbr();
 let draggingUV=false,uvFrame=0;
 const moveUV=e=>{if(!draggingUV||!selectedPattern||!uvBounds)return;const r=$('patternUV').getBoundingClientRect(),b=uvBounds;selectedPattern.uv=[b.minX+((e.clientX-r.left)*320/r.width-b.ox)/b.scale,b.maxY-((e.clientY-r.top)*250/r.height-b.oy)/b.scale];cancelAnimationFrame(uvFrame);uvFrame=requestAnimationFrame(()=>{try{rebuildPattern(selectedPattern);}catch(error){$('patternStatus').textContent=error.message;}});};
 $('patternUV').onpointerdown=e=>{if(!selectedPattern)return;draggingUV=true;$('patternUV').setPointerCapture(e.pointerId);moveUV(e);};$('patternUV').onpointermove=moveUV;$('patternUV').onpointerup=$('patternUV').onpointercancel=()=>{draggingUV=false;};

 $('patternTab').onclick=()=>showPanel('pattern');
 $('patternImage').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;const token=++patternUploadToken,url=URL.createObjectURL(file);$('patternStatus').textContent='正在读取图片…';
 try{if(file.size>64*1024*1024)throw new Error('图片不能超过 64 MB');const texture=await new THREE.TextureLoader().loadAsync(url);if(token!==patternUploadToken){texture.dispose();return;}if(Math.max(texture.image.width,texture.image.height)>renderer.capabilities.maxTextureSize){texture.dispose();throw new Error('图片超过显卡支持的尺寸');}texture.colorSpace=THREE.SRGBColorSpace;configureTextureSampling(texture,renderer);if(patternAsset){patternAsset.texture.dispose();URL.revokeObjectURL(patternAsset.url);}patternAsset={texture,file};$('patternThumbnail').src=url;patternAsset.url=url;$('patternThumbnail').hidden=false;$('patternStatus').textContent=file.name+' · '+texture.image.width+' × '+texture.image.height+' px';$('patternHeight').value=(Number($('patternWidth').value)*texture.image.height/texture.image.width).toFixed(2);$('patternPlace').disabled=false;
 }catch(error){URL.revokeObjectURL(url);$('patternStatus').textContent='读取失败：'+error.message;}};
 $('patternPlace').onclick=()=>{if(patternAsset&&model)setPatternMode('new');};$('patternMove').onclick=()=>{if(selectedPattern)setPatternMode('move');};
 $('patternLayers').onchange=()=>selectPattern(patterns[Number($('patternLayers').value)]);
 for(const id of ['patternWidth','patternHeight','patternRotation'])$(id).onchange=()=>{const width=Number($('patternWidth').value),height=Number($('patternHeight').value),angle=Number($('patternRotation').value);if(![width,height].every(v=>Number.isFinite(v)&&v>=.1&&v<=1000))return notify('尺寸范围为 0.1–1000 cm');$('patternRotationValue').textContent=angle+'°';if(selectedPattern&&!patternPlaceMode){Object.assign(selectedPattern,{width,height,angle});try{rebuildPattern(selectedPattern);}catch(e){notify(e.message);}}};
 $('patternDelete').onclick=()=>{if(!selectedPattern)return;const p=selectedPattern;scene.remove(p.mesh);p.mesh.geometry.dispose();disposePatternMaps(p);p.mesh.material.dispose();patterns=patterns.filter(x=>x!==p);selectedPattern=patterns.at(-1)||null;setPatternMode(false);renderPatternList();};
 $('canvas').addEventListener('pointerdown',e=>{if(!patternPlaceMode||e.button!==0)return;e.preventDefault();e.stopImmediatePropagation();const hit=patternHit(e);if(!hit)return notify('请点击模型表面');try{
 if(patternPlaceMode==='move'){Object.assign(selectedPattern,hit);rebuildPattern(selectedPattern);}else{
 const texture=patternAsset.texture.clone();texture.needsUpdate=true;const material=new THREE.MeshStandardMaterial({map:texture,transparent:true,alphaTest:.01,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4,roughness:.8,metalness:0});installRoughnessShader(material);
 const mesh=new THREE.Mesh(new THREE.BufferGeometry(),material);mesh.matrixAutoUpdate=false;mesh.renderOrder=2;mesh.receiveShadow=true;
 if(!hit.uv)throw new Error('该部件缺少 UV');const p={...hit,mesh,width:Number($('patternWidth').value),height:Number($('patternHeight').value),angle:Number($('patternRotation').value),name:patternAsset.file.name,file:patternAsset.file};
 if(![p.width,p.height].every(v=>Number.isFinite(v)&&v>=.1&&v<=1000))throw new Error('请输入有效厘米尺寸');rebuildPattern(p);patterns.push(p);scene.add(mesh);selectedPattern=p;syncPatterns();
 }setPatternMode(false);renderPatternList();notify('图片已贴合曲面');}catch(error){notify('放置失败：'+error.message);}},true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape')setPatternMode(false);});
}
function bindEvents(){
 bindDesignWorkspace();
 const leaveAnnotationsForMaterials=event=>{if(annotationMode)setAnnotationMode(false,{keepInspector:!!event.target.closest('.material-item')});};
 const materialDock=document.querySelector('.material-dock');
 materialDock.addEventListener('pointerdown',leaveAnnotationsForMaterials,true);
 materialDock.addEventListener('click',leaveAnnotationsForMaterials,true);
 let dismissedDraftPointer=null;
 document.addEventListener('pointerdown',event=>{
  dismissedDraftPointer=null;
  const draft=annotations.find(a=>!a.saved);
  if(draft&&!draft.window.contains(event.target)&&cancelDraftAnnotation())dismissedDraftPointer=event.pointerId;
 },true);
 document.addEventListener('wheel',event=>{const draft=annotations.find(a=>!a.saved);if(draft&&!draft.window.contains(event.target))cancelDraftAnnotation();},{capture:true,passive:true});
 document.addEventListener('focusin',event=>{const draft=annotations.find(a=>!a.saved);if(draft&&!draft.window.contains(event.target))cancelDraftAnnotation();});
 $('saveToLibrary').onclick=saveSelectedToLibrary;
 $('refreshLibrary').onclick=refreshLibrary;
 $('addLibraryMaterial').onclick=async()=>{const button=$('addLibraryMaterial'),id=$('libraryMaterial').value;if(!id)return notify('请先选择资产库中的材质');button.disabled=true;try{await addMaterialAsset(await getAsset(id));}catch(error){notify('添加材质失败：'+error.message,6000);}finally{button.disabled=false;}};
 window.addEventListener('focus',refreshLibrary);refreshLibrary();
 $('annotationMode').onclick=()=>{setAnnotationMode(!annotationMode);if(annotationMode)notify('标记模式已开启，点击模型添加标记；Esc 退出');};
 let annotationStart=null;
 $('canvas').addEventListener('pointerdown',event=>{annotationStart=annotationMode&&event.button===0&&dismissedDraftPointer!==event.pointerId?{x:event.clientX,y:event.clientY}:null;},true);
 $('canvas').addEventListener('pointerup',event=>{const start=annotationStart;annotationStart=null;if(!annotationMode||!start||Math.hypot(event.clientX-start.x,event.clientY-start.y)>5)return;const hit=pickModelMaterial(event.clientX,event.clientY);if(hit)addAnnotation({object:hit.mesh,point:hit.point});},true);
 $('canvas').addEventListener('pointercancel',()=>{annotationStart=null;});
 document.addEventListener('keydown',event=>{if(event.key==='Escape')setAnnotationMode(false);});
 controls.addEventListener('start',()=>{cameraTween?.cancel();setAnnotationMoving(true);});controls.addEventListener('end',()=>setAnnotationMoving(false));
 document.querySelectorAll('[data-fabric]').forEach(b=>b.onclick=()=>{activeFabric=b.dataset.fabric;$('materialList').scrollLeft=0;renderMaterials();});
 $('fabricCategory').onchange=()=>{if(selected){selected.category=$('fabricCategory').value;activeFabric=selected.category;renderMaterials();}};
 bindPatterns();
 const workspace=document.querySelector('.workspace'),inspector=$('inspector');
 inspectorTransition=createInspectorTransition({render:renderInspectorProgress});renderInspectorProgress(0);inspector.inert=true;
 showroom=createShowroom({button:$('showroomMode'),ready:()=>!!model&&!loadingModel,cycle:()=>daylightCycle,notify,timing:()=>developerSettings.timing,
  capture:()=>({state:{...state},appearance:daylightCycle?.appearance||sceneAppearance(state),name:$('sceneName').value,inspectorCollapsed:workspace.classList.contains('inspector-collapsed'),annotationMode}),
  enter:()=>{if($('viewport').dataset.cameraMotion==='intro')fit('perspective',{immediate:true});else cameraTween?.cancel();endMaterialDrag();setPatternMode(false);setAnnotationMode(false);designUI?.exitRemoval();setInspectorCollapsed(true);$('toast').classList.remove('show');state.autoRotate=true;applyScene();},
  restore:snapshot=>{state={...snapshot.state};applyScene(snapshot.appearance);$('sceneName').value=snapshot.name;setAnnotationMode(snapshot.annotationMode);setInspectorCollapsed(snapshot.inspectorCollapsed);}
 });
 $('collapseInspector').onclick=()=>setInspectorCollapsed(true);$('restoreInspector').onclick=()=>setInspectorCollapsed(!workspace.classList.contains('inspector-collapsed'));
 $('materialTab').onclick=()=>showPanel('material');$('sceneTab').onclick=()=>showPanel('scene');$('inspectorToggle').onclick=()=>setInspectorCollapsed(!workspace.classList.contains('inspector-collapsed'));$('closeInspector').onclick=()=>setInspectorCollapsed(true);
 $('importModel').onclick=$('importSecondary').onclick=()=>$('modelFile').click();$('modelFile').onchange=()=>{importFiles($('modelFile').files);$('modelFile').value='';};
 bindMaterialDrop();bindPhysicalControls();
 $('undoMaterial').onclick=undoMaterialAssignment;
 $('fitView').onclick=()=>fit();$('autoRotate').onclick=()=>{state.autoRotate=!state.autoRotate;applyScene();};$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{notify('此浏览器不支持全屏，请使用浏览器的 F11。');}};

 document.addEventListener('keydown',e=>{if(e.target.matches('input,select,textarea'))return;if(e.key==='2')fit('front');else if(e.key==='4')fit('left');else if(e.key==='6')fit('right');else if(e.key==='8')fit('back');else if(e.key==='5')fit('top');else if(e.key.toLowerCase()==='f'){e.preventDefault();fit();}if(e.key==='Escape'&&innerWidth<=760)setInspectorCollapsed(true);});
 $('materialName').onchange=()=>{if(selected){selected.name=$('materialName').value.trim()||'未命名材质';selected.material.name=selected.name;renderMaterials();}};$('isolate').onchange=applyIsolation;$('resetMaterial').onclick=resetMaterial;
 $('baseColor').oninput=()=>{if(selected){selected.material.color.set($('baseColor').value);decorateSwatch($('selectedSwatch'),selected);renderMaterials();}};
 for(const id of ['roughness','metalness','normalStrength','aoStrength','emissiveStrength','bumpStrength'])$(id).oninput=()=>{if(!selected)return;const v=Number($(id).value),m=selected.material;$(id+'Value').textContent=v.toFixed(id==='bumpStrength'?3:2);if(id==='normalStrength')m.normalScale.set(v,selected.flip?-v:v);else m[({aoStrength:'aoMapIntensity',emissiveStrength:'emissiveIntensity',bumpStrength:'bumpScale'})[id]||id]=v;};
 $('flipNormal').onchange=()=>{if(!selected)return;selected.flip=$('flipNormal').checked;selected.material.normalScale.y=Math.abs(selected.material.normalScale.x)*(selected.flip?-1:1);};
 for(const id of ['repeatU','repeatV'])$(id).onchange=()=>{if(!selected)return;const values=[$('repeatU').valueAsNumber,$('repeatV').valueAsNumber];if(values.some(v=>!Number.isFinite(v)||v<.01||v>100)){notify('UV 重复范围为 0.01–100');selectEntry(selected);return;}selected.repeat=values;for(const[key]of MAPS){const tex=selected.material[key];if(!tex)continue;if(tex===selected.baseline[key])selected.material[key]=tex.clone();configureTexture(selected,selected.material[key],key);}};
 for(const[id,value]of Object.entries(DEFAULTS)){if(!$(id)||id==='autoRotate')continue;$(id).addEventListener('input',()=>{daylightCycle?.cancel();state[id]=typeof value==='boolean'?$(id).checked:typeof value==='number'?Number($(id).value):$(id).value;applyScene();});}
 document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>{daylightCycle?.cancel();state.preset=b.dataset.preset;Object.assign(state,state.preset==='night'?{backgroundColor:'#172232',exposure:1.05,keyLight:4,fillLight:.7,lightColor:'#dde8ff'}:state.preset==='daylight'?{backgroundColor:'#e5edf3',exposure:1.2,keyLight:4.5,fillLight:1.8,lightColor:'#ffedd4'}:{backgroundColor:DEFAULTS.backgroundColor,exposure:1.1,keyLight:3,fillLight:1.5,lightColor:DEFAULTS.lightColor});applyScene();});$('resetScene').onclick=()=>{daylightCycle?.cancel();state={...DEFAULTS};applyScene();fit();};
 $('canvas').addEventListener('dblclick',event=>{if(annotationMode)return;const hit=pickModelMaterial(event.clientX,event.clientY);if(!hit)return;selectEntry(hit.entry);showPanel('material');$('materialList').querySelector('[data-entry-id="'+hit.entry.id+'"]')?.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});});
 $('snapshot').onclick=()=>{renderer.render(scene,camera);$('canvas').toBlob(blob=>{if(blob){download(blob,'FORM-'+new Date().toISOString().slice(0,10)+'.png');notify('已导出当前视角 PNG 图片');}},'image/png');};
 $('saveProject').onclick=saveProject;$('openProject').onclick=()=>$('projectFile').click();$('projectFile').onchange=()=>{const f=$('projectFile').files[0];$('projectFile').value='';if(f)openProject(f);};
 $('saveScene').onclick=()=>{try{const name=sceneName($('sceneName').value);download(packScene(state,name),sceneFilename(name));$('sceneName').value=name;notify('已保存场景：'+name);}catch(error){notify('保存场景失败：'+error.message,6000);}};
 $('openScene').onclick=()=>$('sceneFile').click();
 $('sceneFile').onchange=async()=>{
  const file=$('sceneFile').files[0];$('sceneFile').value='';if(!file)return;
  if(loadingModel)return notify('请等待当前模型或项目载入完成后再载入场景');
  $('openScene').disabled=true;$('saveScene').disabled=true;
  try{const saved=await unpackScene(file);if(loadingModel)return notify('请等待当前模型或项目载入完成后再载入场景');daylightCycle?.cancel();Object.assign(state,saved.scene);applyScene();$('sceneName').value=saved.name;notify('已载入场景：'+saved.name);}
  catch(error){notify('载入场景失败：'+error.message,6000);}
  finally{$('openScene').disabled=false;$('saveScene').disabled=false;}
 };
}
function snapshotEntry(e){const m=e.material;return {id:e.id,removed:!!e.removed,name:e.name,category:fabricCategory(e),color:m.color.getHexString(),roughness:m.roughness,metalness:m.metalness,normalStrength:Math.abs(m.normalScale.x),aoStrength:m.aoMapIntensity,emissive:m.emissive.getHexString(),emissiveStrength:m.emissiveIntensity,bumpStrength:m.bumpScale,repeat:e.repeat,physical:{...e.physical},flip:e.flip,maps:Object.fromEntries(MAPS.map(([k])=>[k,m[k]?(e.uploads[k]?'upload':'original'):null]))};}
async function saveProject(){
 if(annotations.some(a=>!a.saved||a.editing))return notify('请先点击 √ 或按回车保存正在输入的标记');
 finishPatternReveals();
 if(!modelSource||loadingModel)return notify('请先完成模型载入');if(entries.some(e=>Object.keys(e.pendingDpi||{}).length))return notify('还有贴图等待指定 DPI，请先应用后再保存项目');busy('正在保存项目','打包 FBX、所有上传贴图与场景设置');await yieldFrame();
 try{const archive={'model.fbx':new Uint8Array(modelSource.buffer)},config={format:'FORM',version:1,name:modelSource.name,scene:{...state},camera:{position:camera.position.toArray(),target:controls.target.toArray()},selected:selected?.id||0,materials:entries.map(e=>({...snapshotEntry(e),surface:readSurface(e.material),legacyMaps:e.legacyMaps,placement:e.placement})),assignments:serializeAssignments(model,entries),partAssignments:serializePartAssignments(),physicalModel:{...physicalModel},resources:[]};
 for(let i=0;i<modelSource.files.length;i++){const f=modelSource.files[i],path='resources/'+i;archive[path]=new Uint8Array(await f.arrayBuffer());config.resources.push({path,name:f.name,type:f.type});}
 for(const e of entries)for(const[key,u]of Object.entries(e.uploads)){const path='textures/'+e.id+'/'+key;archive[path]=new Uint8Array(await u.file.arrayBuffer());config.materials[e.id].maps[key]={path,name:u.file.name,type:u.file.type};}
 const hosts=[];model.traverse(o=>{if(o.isMesh)hosts.push(o);});config.annotations=annotations.map(a=>({host:hosts.indexOf(a.host),point:a.point.toArray(),text:a.text}));config.patterns=[];
 for(let i=0;i<patterns.length;i++){const p=patterns[i],path='patterns/'+i;archive[path]=new Uint8Array(await p.file.arrayBuffer());const maps={};for(const [key,file] of Object.entries(p.pbrFiles||{})){const mapPath=path+'-'+key;archive[mapPath]=new Uint8Array(await file.arrayBuffer());maps[key]={path:mapPath,name:file.name,type:file.type};}const m=p.mesh.material;config.patterns.push({path,sourceKey:p.sourceKey,name:p.name,type:p.file.type,host:hosts.indexOf(p.host),slot:p.slot,singlePlacement:!!p.singlePlacement,placement:p.placement,surface:readSurface(m),point:p.point.toArray(),normal:p.normal.toArray(),uv:p.uv,width:p.width,height:p.height,angle:p.angle,pbr:{maps,roughness:m.roughness,metalness:m.metalness,normalScale:m.normalScale.toArray()}});}
 config.patternSources=[];for(let i=0;i<patternSources.length;i++){const source=patternSources[i],path='pattern-sources/'+i;archive[path]=new Uint8Array(await (await packMaterial(patternSourceAsset(source))).arrayBuffer());config.patternSources.push({path,key:source.key});}
 archive['project.json']=strToU8(JSON.stringify(config));download(new Blob([zipSync(archive,{level:0})],{type:'application/zip'}),(modelSource.name.replace(/\.fbx$/i,'')||'FORM')+'.form');notify('已保存完整项目，包含模型与上传贴图');
 }catch(e){console.error(e);notify('保存失败：'+e.message,6000);}finally{hideBusy();}
}
async function openProject(file){
 if(loadingModel)return notify('请等待当前载入完成');if(file.size>768*1024*1024)return notify('项目过大，请使用小于 768 MB 的文件');busy('正在打开项目','恢复模型、贴图与灯光设置');await yieldFrame();
 try{let expanded=0;const archive=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:item=>{expanded+=item.originalSize;if(expanded>1024*1024*1024)throw new Error('项目解压后超过 1 GB');return true;}});const config=JSON.parse(strFromU8(archive['project.json']));if(config.format!=='FORM'||config.version!==1||!archive['model.fbx'])throw new Error('这不是有效的 FORM 项目');
 const resources=(config.resources||[]).map(r=>{if(!archive[r.path])throw new Error('项目缺少资源');return new File([archive[r.path]],r.name,{type:r.type});});
 await loadModel(archive['model.fbx'].slice().buffer,config.name,resources,{parts:config.partAssignments,restore:async()=>{
 if((config.materials||[]).length>1000)throw new Error('项目材质数量超过 1000');
 for(const data of config.materials||[]){if(data.id<entries.length)continue;if(data.id!==entries.length)throw new Error('项目材质编号无效');entries.push(createLibraryEntry(data.id,String(data.name)));}
 for(const data of config.materials||[])if(entries[data.id]){entries[data.id].legacyMaps=data.legacyMaps||{};entries[data.id].placement=readPlacement(data.placement);}
 if(config.physicalModel){const unit=config.physicalModel.cmPerUnit;if(!Number.isFinite(unit)||unit<=0||unit>1e9)throw new Error('模型单位无效');physicalModel.cmPerUnit=unit;physicalModel.calibrated=!!config.physicalModel.calibrated;updateModelDimensions();}
 for(const data of config.materials||[]){const entry=entries[data.id];if(!entry)continue;entry.physical=readPhysical(data.physical,true);entry.repeat=data.repeat||[1,1];for(const[key]of MAPS){const map=data.maps?.[key];if(map===null)removeTexture(entry,key);else if(map?.path){if(!archive[map.path])throw new Error('项目缺少贴图 '+map.name);await uploadTexture(entry,key,new File([archive[map.path]],map.name,{type:map.type}),true);}}
 entry.name=String(data.name);entry.category=['面布','边布','包边条','其他'].includes(data.category)?data.category:fabricCategory(entry);entry.material.name=entry.name;entry.material.color.set('#'+data.color);entry.material.roughness=data.roughness;entry.material.metalness=data.metalness;entry.material.normalScale.set(data.normalStrength,data.normalStrength*(data.flip?-1:1));entry.material.aoMapIntensity=data.aoStrength;entry.material.emissive.set('#'+data.emissive);entry.material.emissiveIntensity=data.emissiveStrength;entry.material.bumpScale=data.bumpStrength;entry.flip=!!data.flip;entry.repeat=data.repeat||[1,1];for(const[key]of MAPS)if(entry.material[key]&&(entry.uploads[key]||entry.physical.mode==='legacy')){if(entry.material[key]===entry.baseline[key])entry.material[key]=entry.material[key].clone();configureTexture(entry,entry.material[key],key);}
 }
 for(const data of config.materials||[]){const entry=entries[data.id];if(entry&&data.surface)applySurface(entry.material,data.surface);}
 restoreAssignments(model,entries,config.assignments);
 for(const data of config.materials||[]){const entry=entries[data.id];if(entry)entry.removed=!!data.removed&&entry.meshes.size===0;}
 const restored={...DEFAULTS};for(const[k,v]of Object.entries(DEFAULTS))if(typeof config.scene?.[k]===typeof v)restored[k]=config.scene[k];daylightCycle?.cancel();state=restored;applyScene();if(config.camera?.position?.length===3&&config.camera?.target?.length===3){camera.position.fromArray(config.camera.position);controls.target.fromArray(config.camera.target);controls.update();}selectEntry(entries.find(e=>e.id===config.selected&&!e.removed)||entries.find(e=>!e.removed));
 const hosts=[];model.traverse(o=>{if(o.isMesh)hosts.push(o);});
 for(const data of config.annotations||[]){if(!hosts[data.host]||!Array.isArray(data.point)||data.point.length!==3||!data.point.every(Number.isFinite))throw new Error('标记数据无效');const host=hosts[data.host];host.updateWorldMatrix(true,false);addAnnotation({object:host,point:host.localToWorld(new THREE.Vector3().fromArray(data.point))},data.text||'',false);}
 selectedAnnotation=annotations[0]||null;syncAnnotationPanel();
 for(const data of config.patterns||[]){if(!hosts[data.host]||!archive[data.path]||![data.width,data.height].every(v=>Number.isFinite(v)&&v>=.1&&v<=1000)||![...data.point,...data.normal,data.angle].every(Number.isFinite))throw new Error('图案数据无效');
 const file=new File([archive[data.path]],data.name,{type:data.type}),url=URL.createObjectURL(file);let texture;try{texture=await new THREE.TextureLoader().loadAsync(url);}finally{URL.revokeObjectURL(url);}texture.colorSpace=THREE.SRGBColorSpace;
 const material=new THREE.MeshStandardMaterial({map:texture,transparent:true,alphaTest:.01,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4,roughness:.8});installRoughnessShader(material);configureTextureSampling(texture,renderer);const mesh=new THREE.Mesh(new THREE.BufferGeometry(),material);mesh.matrixAutoUpdate=false;mesh.renderOrder=2;mesh.receiveShadow=true;
 const p={...data,host:hosts[data.host],point:new THREE.Vector3().fromArray(data.point),normal:new THREE.Vector3().fromArray(data.normal),file,mesh};p.pbrFiles={};
 for(const [key,,,color] of MAPS){if(key==='map')continue;const meta=data.pbr?.maps?.[key];if(!meta)continue;if(!archive[meta.path])throw new Error('项目缺少图案贴图');const file=new File([archive[meta.path]],meta.name,{type:meta.type}),url=URL.createObjectURL(file);try{material[key]=await new THREE.TextureLoader().loadAsync(url);material[key].colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;configureTextureSampling(material[key],renderer);p.pbrFiles[key]=file;}finally{URL.revokeObjectURL(url);}}
 if(data.surface)applySurface(material,data.surface);if(data.singlePlacement){material.transparent=true;material.alphaTest=Math.max(.01,material.alphaTest);p.placement=readPlacement(data.placement);for(const[key]of MAPS)if(material[key]){material[key].wrapS=material[key].wrapT=THREE.ClampToEdgeWrapping;}}
 if(data.pbr){for(const key of ['roughness','metalness'])if(Number.isFinite(data.pbr[key]))material[key]=THREE.MathUtils.clamp(data.pbr[key],0,1);if(data.pbr.normalScale?.length===2&&data.pbr.normalScale.every(Number.isFinite))material.normalScale.fromArray(data.pbr.normalScale);}material.needsUpdate=true;
 rebuildPattern(p);patterns.push(p);scene.add(mesh);selectedPattern=p;}
 syncPatterns();renderPatternList();
 for(const meta of config.patternSources||[]){if(!archive[meta.path])throw new Error('项目缺少图案资产');await addPatternSource(await unpackMaterial(new File([archive[meta.path]],'pattern.formmat')),false,meta.key);}
 renderDesignPatterns();

 }});
 }catch(e){console.error(e);hideBusy();notify('打开项目失败：'+e.message,7000);}
}

const patternReveals=new Map();
function finishPatternReveals(){for(const [mesh,session]of patternReveals){cancelAnimationFrame(session.frame);session.effect.dispose();delete mesh.userData.revealOriginal;}patternReveals.clear();}
function playPatternReveal(p){
 if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const mesh=p.mesh;mesh.userData.revealOriginal=mesh.material;
 const effect=revealPattern(mesh),started=performance.now(),session={effect,frame:0};patternReveals.set(mesh,session);
 const tick=now=>{const t=Math.min(1,(now-started)/REVEAL_DURATION);effect.update(t*t*(3-2*t));if(t<1)session.frame=requestAnimationFrame(tick);else{effect.dispose();delete mesh.userData.revealOriginal;patternReveals.delete(mesh);}};
 session.frame=requestAnimationFrame(tick);
}
function startDesignPatternDrag(event,target){
 finishPatternReveals();const item=target.source||target.pattern,m=designMaterial(target),placement=designPlacement(target);
 startMaterialDrag(event,{name:item.name,material:m,uploads:{},previews:{map:designPreview(m.map)},thumbnails:{},physical:{mode:'legacy',angle:placement.angle}},target);
}
function dropDesignPattern(target,event){
 const hit=patternHit(event);if(!hit)return;
 if(target.source){placeDesignPattern(target.source,hit);return;}
 const p=target.pattern,previous={host:p.host,slot:p.slot,point:p.point,normal:p.normal,uv:p.uv,placement:p.placement};
 Object.assign(p,hit);p.placement={offset:[0,0],angle:p.angle};
 try{rebuildPattern(p);}catch(error){Object.assign(p,previous);throw error;}
 selectDesignPattern({kind:'pattern',pattern:p});playPatternReveal(p);
}

function designPreview(texture){try{if(!texture?.image?.width)return null;const c=document.createElement('canvas'),scale=Math.min(1,512/Math.max(texture.image.width,texture.image.height));c.width=Math.round(texture.image.width*scale);c.height=Math.round(texture.image.height*scale);c.getContext('2d').drawImage(texture.image,0,0,c.width,c.height);return c.toDataURL('image/png');}catch{return null;}}
function designMaterial(t){return t.kind==='fabric'?t.entry.material:t.source?.material||t.pattern.mesh.userData.revealOriginal||t.pattern.mesh.material;}
function designPlacement(t){const item=t.entry||t.source||t.pattern;return readPlacement(item.placement||{angle:t.pattern?.angle||0});}
function patternSourceUsed(source){
 return patterns.some(p=>p.sourceKey===source.key||p.file===source.asset.maps.map||(!p.sourceKey&&p.name===source.name&&p.file.size===source.asset.maps.map.size));
}
function canRemoveDockItem(t){
 if(loadingModel||!model)return false;
 if(t.entry)return entries.includes(t.entry)&&!t.entry.removed&&t.entry.meshes.size===0;
 return t.source?patternSources.includes(t.source):!!t.pattern&&patterns.includes(t.pattern);
}
function prepareRemoval(){
 endMaterialDrag();finishReveal();finishPatternReveals();stopMaterialPulse();setPatternMode(false);setAnnotationMode(false);
 if(model)rebuildMaterialUsage(model,entries);
}
function removeUnusedDockItems(items){
 prepareRemoval();
 const removable=[...new Map(items.map(t=>[t.entry||t.source||t.pattern,t])).values()].filter(canRemoveDockItem);
 const deletedMaterials=new Set(removable.filter(t=>t.entry).map(t=>t.entry.material));
 // Keep stable FBX material IDs so project assignments continue to resolve after reload.
 for(const t of removable){
  if(t.entry)t.entry.removed=true;
  else if(t.source){patternSources=patternSources.filter(source=>source!==t.source);disposeSource(t.source);}
  else{const p=t.pattern;patterns=patterns.filter(item=>item!==p);scene.remove(p.mesh);p.mesh.geometry.dispose();disposePatternMaps(p);p.mesh.material.dispose();if(selectedPattern===p)selectedPattern=null;}
 }
 // Preserve only the newer undo steps that cannot restore a deleted material.
 const lastDeleted=assignmentHistory.findLastIndex(action=>action.batch?.some(item=>deletedMaterials.has(item.previous))||deletedMaterials.has(action.previous));
 if(lastDeleted>=0)assignmentHistory=assignmentHistory.slice(lastDeleted+1);
 $('undoMaterial').disabled=assignmentHistory.length===0;
 const removedTarget=selected?.removed||removable.some(t=>(t.source&&selectedDesignPattern?.source===t.source)||(t.pattern&&selectedDesignPattern?.pattern===t.pattern));
 if(removedTarget){selectedDesignPattern=null;selectEntry(entries.find(e=>!e.removed));showPanel('scene');}
 renderMaterials();renderDesignPatterns();renderPatternList();
 return removable.length;
}
function bindDesignWorkspace(){
 designUI=createDesignWorkspace({notify,canRemove:canRemoveDockItem,prepareRemoval,removeUnused:removeUnusedDockItems,undo:undoMaterialAssignment,cancelPlacement:()=>setPatternMode(false),showScene:()=>{setPatternMode(false);showPanel('scene');},add:addDesignAsset,
  read:t=>({name:(t.entry||t.source||t.pattern).name,color:'#'+designMaterial(t).color.getHexString(),...designPlacement(t)}),
  preview:(el,t)=>{const m=designMaterial(t);decorateSwatch(el,{material:m,uploads:{},thumbnails:{map:designPreview(m.map)}});},
  color:(t,color)=>{finishPatternReveals();designMaterial(t).color.set(color);if(t.kind==='fabric')renderMaterials();else renderDesignPatterns();},
  transform:(t,value)=>{finishPatternReveals();const placement=readPlacement(value);if(t.kind==='fabric'){const entry=t.entry;entry.placement=placement;for(const[key]of MAPS){let texture=entry.material[key];if(!texture)continue;if(texture===entry.baseline[key]){entry.material[key]=texture=texture.clone();if(!entry.uploads[key]){entry.legacyMaps||={};entry.legacyMaps[key]||=readLegacyUV(entry.baseline[key]);}}configureTexture(entry,texture,key);}}else if(t.source)t.source.placement=placement;else moveDesignPattern(t.pattern,placement);},
 });
 let clickStart=null;
 $('canvas').addEventListener('pointerdown',e=>{clickStart=e.button===0&&!patternPlaceMode&&!annotationMode?{x:e.clientX,y:e.clientY}:null;});
 $('canvas').addEventListener('pointerup',e=>{const start=clickStart;clickStart=null;if(designUI?.removing||!start||Math.hypot(e.clientX-start.x,e.clientY-start.y)>5||patternPlaceMode||annotationMode)return;const rect=$('canvas').getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),camera);const hit=pickModelMaterial(e.clientX,e.clientY),ph=ray.intersectObjects(patterns.map(p=>p.mesh),false)[0];if(ph&&(!hit||ph.distance<=camera.position.distanceTo(hit.point)+.02))selectDesignPattern({kind:'pattern',pattern:patterns.find(p=>p.mesh===ph.object)});else if(hit){designUI.setType('fabric');selectEntry(hit.entry);showPanel('material');}else showPanel('scene');});
 renderDesignPatterns();
}
async function addDesignAsset(asset){if(!model||loadingModel)throw new Error('请等待模型载入完成');if(materialType(asset)==='pattern')return addPatternSource(asset);designUI.setType('fabric');return addMaterialAsset(asset);}
function disposeSource(source){for(const[key]of MAPS)source.material[key]?.dispose();source.material.dispose();}
function clearPatternSources(){finishPatternReveals();patternSources.forEach(disposeSource);patternSources=[];selectedDesignPattern=null;renderDesignPatterns();}
async function addPatternSource(asset,select=true,sourceKey=crypto.randomUUID()){
 if(!asset.maps?.map)throw new Error('图案需要基础颜色图片，请先在材质编辑器中添加');
 const generation=modelGeneration,material=new THREE.MeshStandardMaterial(),physical=readPhysical(asset.physical,true);
 const source={key:sourceKey,name:asset.name,material,asset,placement:readPlacement(asset.placement||{angle:physical.angle}),width:Math.min(1000,Math.max(.1,physical.widthCm)),height:Math.min(1000,Math.max(.1,physical.heightCm))};
 try{applySurface(material,asset.surface||{});material.transparent=true;material.alphaTest=Math.max(.01,material.alphaTest);material.depthWrite=false;material.polygonOffset=true;material.polygonOffsetFactor=-4;material.polygonOffsetUnits=-4;
  for(const[key,,,color]of MAPS){const file=asset.maps[key];if(!file)continue;if(file.size>64*1024*1024)throw new Error('单张贴图不能超过 64 MB');const url=URL.createObjectURL(file);try{const texture=await new THREE.TextureLoader().loadAsync(url);material[key]=texture;if(Math.max(texture.image.width,texture.image.height)>renderer.capabilities.maxTextureSize)throw new Error('图案超过显卡支持尺寸');texture.colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;texture.channel=key==='aoMap'?2:0;configureTextureSampling(texture,renderer);}finally{URL.revokeObjectURL(url);}}
  if(generation!==modelGeneration)throw new Error('模型已切换，请重新添加图案');patternSources.push(source);renderDesignPatterns();if(select){selectDesignPattern({kind:'pattern',source});notify('已添加图案，拖动底栏图案到模型表面即可放置');}
 }catch(error){disposeSource(source);throw error;}
}
function patternSourceAsset(source){return {...source.asset,materialType:'pattern',placement:source.placement,surface:readSurface(source.material),physical:{...source.asset.physical,widthCm:source.width,heightCm:source.height,angle:source.placement.angle}};}
function selectDesignPattern(target){selectedDesignPattern=target;setPatternMode(false);designUI.setType('pattern');designUI.select(target);showPanel('material');renderDesignPatterns();}
function renderDesignPatterns(){const host=$('patternDock');if(!host)return;host.replaceChildren();const items=[...patternSources.map(source=>({kind:'pattern',source})),...patterns.map(pattern=>({kind:'pattern',pattern}))];
 for(const t of items){const item=t.source||t.pattern,b=document.createElement('button');b.className='material-item pattern-item';b.dataset.patternKind=t.source?'source':'placed';b.classList.toggle('active',!!selectedDesignPattern&&(t.source?selectedDesignPattern.source===t.source:selectedDesignPattern.pattern===t.pattern));b.setAttribute('aria-label','选择图案 '+item.name);const art=document.createElement('div');art.className='material-thumb';const m=designMaterial(t);decorateSwatch(art,{material:m,uploads:{},thumbnails:{map:designPreview(m.map)}});const name=document.createElement('strong');name.textContent=item.name;const badge=document.createElement('small');badge.textContent=t.source?(patternSourceUsed(t.source)?'已应用':'待放置'):'已贴合';b.append(art,name,badge);b.title=t.source?'拖到模型表面放置图案；单击编辑':'拖到模型表面移动图案；单击编辑';b.onpointerdown=event=>startDesignPatternDrag(event,t);b.onclick=()=>{if(suppressMaterialClick){suppressMaterialClick=false;return;}selectDesignPattern(t);};designUI?.bindDockItem(b,t);host.append(b);}
 designUI?.syncDock();$('dockPatternPlace').disabled=!selectedDesignPattern;$('dockPatternPlace').textContent=selectedDesignPattern?.pattern?'重新放置':'放置图案';
}
function placeDesignPattern(source,hit){const material=source.material.clone();installRoughnessShader(material);for(const[key]of MAPS)if(material[key]){material[key]=material[key].clone();material[key].needsUpdate=true;}const mesh=new THREE.Mesh(new THREE.BufferGeometry(),material);mesh.matrixAutoUpdate=false;mesh.renderOrder=2;mesh.receiveShadow=true;const p={...hit,mesh,sourceKey:source.key,name:source.name,file:source.asset.maps.map,pbrFiles:Object.fromEntries(Object.entries(source.asset.maps).filter(([key])=>key!=='map')),width:source.width,height:source.height,angle:source.placement.angle,placement:{offset:[0,0],angle:source.placement.angle},singlePlacement:true};try{moveDesignPattern(p,readPlacement(source.placement));patterns.push(p);scene.add(mesh);syncPatterns();selectedPattern=p;selectDesignPattern({kind:'pattern',pattern:p});playPatternReveal(p);return p;}catch(error){mesh.geometry.dispose();disposePatternMaps(p);material.dispose();throw error;}}
function moveDesignPattern(p,placement){const previous={point:p.point.clone(),uv:p.uv?.slice(),angle:p.angle,placement:p.placement},old=readPlacement(p.placement||{angle:p.angle});if(p.singlePlacement){p.host.updateWorldMatrix(true,false);const normal=p.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(p.host.matrixWorld)).normalize(),orientation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),normal),unit=patternUnit();const delta=new THREE.Vector3((placement.offset[0]-old.offset[0])*p.width*unit,(placement.offset[1]-old.offset[1])*p.height*unit,0).applyQuaternion(orientation);p.point.copy(p.host.worldToLocal(p.point.clone().applyMatrix4(p.host.matrixWorld).add(delta)));}else if(p.uv)p.uv=[p.uv[0]+placement.offset[0]-old.offset[0],p.uv[1]+placement.offset[1]-old.offset[1]];p.angle=placement.angle;p.placement=placement;try{rebuildPattern(p);}catch(error){Object.assign(p,previous);throw error;}}
export function startDesign(){try{init();}catch(e){console.error(e);$('loadingTitle').textContent='无法初始化 3D 渲染';$('loadingDetail').textContent='请使用支持 WebGL 2 的 Edge / Chrome，并启用浏览器硬件加速。';}}
