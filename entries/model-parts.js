import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getAsset, saveAsset } from '../shared/asset-store.js';
const $=id=>document.getElementById(id),assetId=new URLSearchParams(location.search).get('asset');
let asset,root,balls=[],selected=-1,assignments={},highlighted=[],slotLookup=new Map(),controls,allowPick=false,pointerStart=null,randomColorMode=false,viewportOffset=0;
let developerOpen=false,savedCameraView={azimuth:40,elevation:26,framing:1.18,offset:[0,0,0]};
const formatNumber=value=>Number(value).toLocaleString('zh-CN',{maximumFractionDigits:2});
const formatBytes=bytes=>{if(!Number.isFinite(bytes)||bytes<0)return '--';if(bytes<1024)return `${bytes} B`;const units=['KB','MB','GB'];let value=bytes/1024,index=0;while(value>=1024&&index<units.length-1){value/=1024;index++;}return `${value.toLocaleString('zh-CN',{maximumFractionDigits:2})} ${units[index]}`;};
const modelFormat=model=>{const name=model.file?.name||model.name||'';const match=name.match(/\.([a-z0-9]+)$/i);return match?match[1].toUpperCase():'--';};
function modelFaceCount(modelRoot){let count=0;modelRoot.traverse(object=>{if(!object.isMesh||!object.geometry)return;const index=object.geometry.getIndex?.();const position=object.geometry.getAttribute?.('position');count+=Math.floor((index?.count||position?.count||0)/3);});return count;}
function modelDimensions(modelRoot){const box=new THREE.Box3().setFromObject(modelRoot),size=box.getSize(new THREE.Vector3());return `${Math.round(size.x).toLocaleString('zh-CN')} × ${Math.round(size.y).toLocaleString('zh-CN')} × ${Math.round(size.z).toLocaleString('zh-CN')}`;}
function renderModelInfo(modelRoot){$('modelFaceCount').textContent=formatNumber(modelFaceCount(modelRoot));$('modelFormat').textContent=modelFormat(asset);$('modelDimensions').textContent=modelDimensions(modelRoot);$('modelFileSize').textContent=formatBytes(asset.file?.size);}
const scene=new THREE.Scene();scene.background=new THREE.Color(0xf2f5f8);
const camera=new THREE.PerspectiveCamera(35,1,.01,100),renderer=new THREE.WebGLRenderer({canvas:$('partsCanvas'),antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.75;scene.add(new THREE.HemisphereLight(0xdbe4ef,0x4e5865,.9));const key=new THREE.DirectionalLight(0xfff4e6,1.4);key.position.set(4,7,5);scene.add(key);
function alignToViewport(){if(!root||!controls)return;const canvasRect=$('partsCanvas').getBoundingClientRect(),panel=$('.parts-panel');if(!panel)return;const panelRect=panel.getBoundingClientRect(),canvasCenterX=canvasRect.left+canvasRect.width/2,usableCenterX=panelRect.width>=canvasRect.width*.8?canvasCenterX:canvasRect.left+(panelRect.left-canvasRect.left)/2,dx=usableCenterX-canvasCenterX,delta=dx-viewportOffset;if(Math.abs(delta)<.01)return;const distance=camera.position.distanceTo(controls.target),worldPerPixel=2*distance*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/Math.max(1,canvasRect.height),right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion).normalize();controls.target.addScaledVector(right,-delta*worldPerPixel);controls.update();viewportOffset=dx;}
function readCurrentCameraView(){if(!root||!controls)return null;const offset=camera.position.clone().sub(controls.target),distance=offset.length();if(!Number.isFinite(distance)||distance<1e-6)return null;const azimuth=THREE.MathUtils.radToDeg(Math.atan2(offset.x,offset.z)),elevation=THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(offset.y/distance,-1,1))),box=new THREE.Box3().setFromObject(root),sphere=box.getBoundingSphere(new THREE.Sphere()),vfov=THREE.MathUtils.degToRad(camera.fov),hfov=2*Math.atan(Math.tan(vfov/2)*camera.aspect),framing=sphere.radius>1e-6?distance*Math.sin(Math.min(vfov,hfov)/2)/sphere.radius:1.18,targetOffset=controls.target.clone().sub(sphere.center);return {azimuth,elevation,framing,distance,offset:targetOffset.toArray()};}
function validateCameraView(value){
 if(!value||value.format!=='SPENIC-MODEL-VIEW'||value.version!==1)throw new Error('不是有效的默认视角文件');
 const view=value.view;
 if(!view||!Number.isFinite(view.azimuth)||view.azimuth<-180||view.azimuth>180||!Number.isFinite(view.elevation)||view.elevation<0||view.elevation>90||!Number.isFinite(view.framing)||view.framing<=0||view.framing>1000||!Array.isArray(view.offset)||view.offset.length!==3||!view.offset.every(Number.isFinite)||view.offset.some(number=>Math.abs(number)>1000))throw new Error('视角参数超出范围');
 return {azimuth:view.azimuth,elevation:view.elevation,framing:view.framing,offset:[...view.offset]};
}
function applyCameraView(view){
 if(!root||!controls)throw new Error('模型载入完成后才能读取视角');
 root.updateMatrixWorld(true);
 const sphere=new THREE.Box3().setFromObject(root).getBoundingSphere(new THREE.Sphere()),vfov=THREE.MathUtils.degToRad(camera.fov),hfov=2*Math.atan(Math.tan(vfov/2)*camera.aspect),distance=sphere.radius/Math.sin(Math.min(vfov,hfov)/2)*view.framing;
 const azimuth=THREE.MathUtils.degToRad(view.azimuth),elevation=THREE.MathUtils.degToRad(view.elevation),direction=new THREE.Vector3(Math.sin(azimuth)*Math.cos(elevation),Math.sin(elevation),Math.cos(azimuth)*Math.cos(elevation)),target=sphere.center.clone().add(new THREE.Vector3().fromArray(view.offset));
 // Flush any remaining orbit motion before assigning the saved position.
 const damping=controls.enableDamping;controls.enableDamping=false;controls.update();
 camera.position.copy(target).addScaledVector(direction,distance);controls.target.copy(target);controls.update();controls.enableDamping=damping;
 camera.far=Math.max(100,distance+sphere.radius*2);camera.updateProjectionMatrix();syncDeveloperCamera();
}
async function saveDefaultCameraView(){
 const button=$('partsSaveDefaultView');button.disabled=true;
 try{
  const view=readCurrentCameraView();if(!view)throw new Error('模型载入完成后才能保存视角');
  const value={format:'SPENIC-MODEL-VIEW',version:1,view:{azimuth:view.azimuth,elevation:view.elevation,framing:view.framing,offset:view.offset}};validateCameraView(value);
  const response=await fetch('./__form_parts_view',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}),result=await response.json().catch(()=>null);
  if(!response.ok||result?.saved!==true)throw new Error('本地文件未能保存，请确认已启动最新版本地服务');
  savedCameraView=validateCameraView(value);
  $('partsViewStatus').textContent='已保存到 parts-default-view.json';
 }catch(error){$('partsViewStatus').textContent='保存失败：'+error.message;}
 finally{button.disabled=false;}
}
async function loadSavedCameraView(){
 try{
  const response=await fetch('./__form_parts_view',{cache:'no-store'});if(!response.ok)throw new Error('请确认已启动最新版本地服务');
  const value=await response.json();if(!value)return false;
  savedCameraView=validateCameraView(value);applyCameraView(savedCameraView);$('partsViewStatus').textContent='已自动读取本地默认视角';return true;
 }catch(error){$('partsViewStatus').textContent='默认视角读取失败：'+error.message;return false;}
}
function fit(){if(!root)return;root.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(root),sphere=box.getBoundingSphere(new THREE.Sphere()),vfov=THREE.MathUtils.degToRad(camera.fov),hfov=2*Math.atan(Math.tan(vfov/2)*camera.aspect),view={azimuth:40,elevation:26,framing:1.18},distance=sphere.radius/Math.sin(Math.min(vfov,hfov)/2)*view.framing,azimuth=THREE.MathUtils.degToRad(view.azimuth),elevation=THREE.MathUtils.degToRad(view.elevation),direction=new THREE.Vector3(Math.sin(azimuth)*Math.cos(elevation),Math.sin(elevation),Math.cos(azimuth)*Math.cos(elevation)),target=sphere.center.clone();camera.position.copy(target).addScaledVector(direction.normalize(),distance);controls.target.copy(target);controls.update();viewportOffset=0;alignToViewport();}
function clearHighlight(){for(const item of highlighted){item.mesh.material=item.original;item.clones.forEach(material=>material.dispose());}highlighted=[];}
function highlight(ball){clearHighlight();const byMesh=new Map();for(const slot of ball.slots){let item=byMesh.get(slot.mesh);if(!item){item={mesh:slot.mesh,original:slot.mesh.material,materials:Array.isArray(slot.mesh.material)?slot.mesh.material.slice():[slot.mesh.material],clones:[]};byMesh.set(slot.mesh,item);}const clone=item.materials[slot.slot].clone();if(clone.emissive){clone.emissive.set(0x4c9aff);clone.emissiveIntensity=.8;}item.materials[slot.slot]=clone;item.clones.push(clone);}for(const item of byMesh.values()){item.mesh.material=Array.isArray(item.original)?item.materials:item.materials[0];highlighted.push(item);}}
function updateMaterialSwatches(){balls.forEach(ball=>{if(ball.swatch&&ball.material.color)ball.swatch.style.setProperty('--swatch','#'+ball.material.color.getHexString());});}
function setRandomColorMode(enabled){randomColorMode=enabled;clearHighlight();const startHue=Math.random();balls.forEach((ball,index)=>{if(!ball.material.color)return;if(enabled)ball.material.color.setHSL((startHue+index*.61803398875)%1,.84,.5);else ball.material.color.set(0x9ca3aa);});updateMaterialSwatches();if(selected>=0)highlight(balls[selected]);}
function selectedCategory(ball){const value=assignments[ball.key];return Array.isArray(value)?value[0]||'':typeof value==='string'?value:'';}
function setCategory(ball,value){if(value)assignments[ball.key]=[value];else delete assignments[ball.key];}
function clearSelection(){selected=-1;clearHighlight();document.querySelectorAll('.parts-list-item').forEach(item=>item.classList.remove('active'));}
function select(index){selected=index;const ball=balls[index];if(!ball){clearSelection();return;}highlight(ball);document.querySelectorAll('.parts-list-item').forEach(item=>item.classList.toggle('active',Number(item.dataset.index)===index));}
function enumerateMaterials(){const byMaterial=new Map();slotLookup=new Map();root.traverse(mesh=>{if(!mesh.isMesh)return;const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];materials.forEach((material,slot)=>{if(!material)return;let ball=byMaterial.get(material);if(!ball){const key=String(byMaterial.size);ball={key,name:material.name||`材质球 ${Number(key)+1}`,material,slots:[]};byMaterial.set(material,ball);balls.push(ball);}ball.slots.push({mesh,slot});slotLookup.set(mesh.uuid+':'+slot,ball);});});const list=$('partsList');list.replaceChildren();balls.forEach((ball,index)=>{const item=document.createElement('div');item.className='parts-list-item';item.dataset.index=index;const button=document.createElement('button');button.className='material-row-button';button.type='button';const swatch=document.createElement('span');swatch.className='part-swatch';swatch.style.setProperty('--swatch','#'+(ball.material.color?.getHexString?.()||'ffffff'));ball.swatch=swatch;const name=document.createElement('span');name.textContent=ball.name;button.append(swatch,name);button.onclick=()=>select(index);const category=document.createElement('select');category.className='part-category-select';category.setAttribute('aria-label',ball.name+' 部件分类');[['',''],['面布','面布'],['边布','边布'],['包边条','包边条'],['其他','其他']].forEach(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;category.append(option);});category.value=selectedCategory(ball);category.onchange=event=>{event.stopPropagation();setCategory(ball,category.value);};category.onclick=event=>event.stopPropagation();item.append(button,category);list.append(item);});}
function resize(){const rect=$('partsCanvas').getBoundingClientRect();renderer.setSize(rect.width,rect.height,false);camera.aspect=rect.width/Math.max(1,rect.height);camera.updateProjectionMatrix();alignToViewport();}new ResizeObserver(resize).observe($('partsCanvas'));
function formatVector(value){return value.map(number=>Number(number).toFixed(3)).join(' , ');}
function syncDeveloperCamera(){const view=readCurrentCameraView();if(!view){$('partsCameraPosition').textContent='等待模型';$('partsCameraTarget').textContent='等待模型';$('partsCameraAngles').textContent='等待模型';$('partsCameraDistance').textContent='等待模型';return;}$('partsCameraPosition').textContent=formatVector(camera.position.toArray());$('partsCameraTarget').textContent=formatVector(controls.target.toArray());$('partsCameraAngles').textContent=`水平 ${Math.round(view.azimuth)}° · 俯视 ${Math.round(view.elevation)}°`;$('partsCameraDistance').textContent=`距离 ${view.distance.toFixed(3)} · 构图 ${view.framing.toFixed(3)}×`;}
function setDeveloperOpen(value){const panel=$('partsDeveloperPanel'),toggle=$('partsDeveloperToggle');developerOpen=value;panel.hidden=!value;toggle.setAttribute('aria-expanded',String(value));toggle.setAttribute('aria-pressed',String(value));document.body.classList.toggle('developer-open',value);if(value){syncDeveloperCamera();$('partsDeveloperClose').focus({preventScroll:true});}else if(!toggle.hidden)toggle.focus({preventScroll:true});}
function initDeveloperPanel(){const toggle=$('partsDeveloperToggle'),close=$('partsDeveloperClose'),brand=document.querySelector('.brand-logo');let sequence='',lastKey=0;
  const cameraSection=$('partsCameraDistance')?.closest('.dev-section');
  if(cameraSection&&!$('partsSaveDefaultView')){const actions=document.createElement('div');actions.className='dev-file-actions parts-view-file-actions';actions.innerHTML='<button id="partsSaveDefaultView" type="button" class="dev-primary">保存默认视角</button>';const status=document.createElement('p');status.id='partsViewStatus';status.className='dev-note';status.setAttribute('role','status');cameraSection.append(actions,status);}
  // Keep the logo as the visual hint for the shortcut, but accept the sequence
  // from anywhere on the page. Requiring the pointer to stay over the logo made
  // the shortcut unreliable when the user moved to the keyboard.
  brand?.addEventListener('pointerenter',()=>{sequence='';});
  brand?.addEventListener('pointerleave',()=>{sequence='';});
  const resetSequence=()=>{sequence='';lastKey=0;};
  window.addEventListener('blur',resetSequence);
  document.addEventListener('compositionstart',resetSequence);
  window.addEventListener('keydown',event=>{
    const target=event.target instanceof Element?event.target:null;
    const typing=target?.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
    if(event.ctrlKey||event.altKey||event.metaKey||event.repeat||event.isComposing||typing){resetSequence();return;}
    const now=performance.now();
    if(now-lastKey>2000)sequence='';
    lastKey=now;
    const key=event.key.toLowerCase();
    if(key.length!==1){sequence='';return;}
    sequence=(sequence+key).slice(-5);
    if(sequence==='admin'){
      resetSequence();
      event.preventDefault();
      if(!toggle.hidden){setDeveloperOpen(false);toggle.hidden=true;}
      else toggle.hidden=false;
    }
  },true);
  toggle.onclick=()=>setDeveloperOpen(!developerOpen);close.onclick=()=>setDeveloperOpen(false);$('partsSaveDefaultView').onclick=saveDefaultCameraView;$('partsDeveloperPanel').addEventListener('keydown',event=>{if(event.key==='Escape')setDeveloperOpen(false);});setInterval(()=>{if(developerOpen)syncDeveloperCamera();},250);}
function pick(event){const rect=$('partsCanvas').getBoundingClientRect(),pointer=new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2),ray=new THREE.Raycaster();ray.setFromCamera(pointer,camera);const hit=ray.intersectObjects(root?root.children:[],true)[0];if(!hit)return false;const slot=Array.isArray(hit.object.material)?(hit.face?.materialIndex??0):0,ball=slotLookup.get(hit.object.uuid+':'+slot);if(!ball)return false;select(balls.indexOf(ball));return true;}
$('partsCanvas').addEventListener('pointerdown',event=>{pointerStart={x:event.clientX,y:event.clientY};allowPick=false;});$('partsCanvas').addEventListener('pointerup',event=>{allowPick=!!pointerStart&&Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)<5;pointerStart=null;});$('partsCanvas').addEventListener('click',event=>{if(allowPick&&!pick(event))clearSelection();allowPick=false;});
document.querySelectorAll('[data-edit-target]').forEach(button=>button.onclick=()=>$(button.dataset.editTarget)?.focus());
$('randomColorToggle').onchange=event=>setRandomColorMode(event.target.checked);
async function captureModelPreview(){
 if(!root||!controls)throw new Error('请等待模型载入完成');
 const frame=document.querySelector('.parts-viewfinder'),canvasRect=$('partsCanvas').getBoundingClientRect(),frameRect=frame?.getBoundingClientRect();
 if(!frameRect||canvasRect.width<=0||canvasRect.height<=0||frameRect.height<=0)throw new Error('取景框不可用');
 const width=frameRect.height*4/3,height=frameRect.height,left=frameRect.left+(frameRect.width-width)/2,top=frameRect.top;
 const previewCamera=camera.clone(),sphere=new THREE.Box3().setFromObject(root).getBoundingSphere(new THREE.Sphere()),view=savedCameraView;
 const vfov=THREE.MathUtils.degToRad(previewCamera.fov),hfov=2*Math.atan(Math.tan(vfov/2)*previewCamera.aspect),distance=sphere.radius/Math.sin(Math.min(vfov,hfov)/2)*view.framing;
 const azimuth=THREE.MathUtils.degToRad(view.azimuth),elevation=THREE.MathUtils.degToRad(view.elevation),direction=new THREE.Vector3(Math.sin(azimuth)*Math.cos(elevation),Math.sin(elevation),Math.cos(azimuth)*Math.cos(elevation)),target=sphere.center.clone().add(new THREE.Vector3().fromArray(view.offset));
 previewCamera.position.copy(target).addScaledVector(direction,distance);previewCamera.lookAt(target);previewCamera.far=Math.max(100,distance+sphere.radius*2);
 // Render the same camera projection cropped to the guide, including on small screens.
 previewCamera.setViewOffset(canvasRect.width,canvasRect.height,left-canvasRect.left,top-canvasRect.top,width,height);
 $('randomColorToggle').checked=true;if(!randomColorMode)setRandomColorMode(true);clearHighlight();
 let previewRenderer;
 try{
  previewRenderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
  previewRenderer.setSize(400,300,false);previewRenderer.outputColorSpace=renderer.outputColorSpace;previewRenderer.toneMapping=renderer.toneMapping;previewRenderer.toneMappingExposure=renderer.toneMappingExposure;
  previewRenderer.render(scene,previewCamera);
  const blob=await new Promise(resolve=>previewRenderer.domElement.toBlob(resolve,'image/png'));if(!blob)throw new Error('无法生成模型预览图');return blob;
 }finally{previewRenderer?.dispose();previewRenderer?.forceContextLoss();if(selected>=0)highlight(balls[selected]);}
}
$('saveParts').onclick=async()=>{
 if(!asset||!root||!controls)return;
 const name=$('modelNameInput').value.trim();if(!name){$('partsStatus').textContent='模型名称不能为空';$('modelNameInput').focus();return;}
 const button=$('saveParts');button.disabled=true;
 try{
  const preview=await captureModelPreview(),next={...asset,name,category:$('modelCategoryInput').value.trim(),partAssignments:assignments,preview,thumbnail:preview};
  asset=await saveAsset(next);$('partsStatus').textContent='已保存模型配置和预览图';
 }catch(error){$('partsStatus').textContent='保存失败：'+error.message;}
 finally{button.disabled=false;}
};
async function loadAssetModel(asset){
 const urls=new Set(),resources=new Map((asset.resources||[]).map(file=>[file.name.split(/[\\/]/).pop().toLowerCase(),file]));
 const manager=new THREE.LoadingManager();
 manager.setURLModifier(url=>{
  if(url.includes('/vendor/three/addons/libs/basis/')||url.startsWith('./vendor/three/addons/libs/basis/'))return url;
  if(url.startsWith('data:'))return url;
  if(url.startsWith('blob:')){urls.add(url);return url;}
  const name=decodeURIComponent(url.replace(/[?#].*$/,'').replace(/\\/g,'/').split('/').pop()).toLowerCase(),file=resources.get(name);
  if(!file)return url;
  const blobUrl=URL.createObjectURL(file);urls.add(blobUrl);return blobUrl;
 });
 let ktx2Loader;
 try{
  if(/\.glb$/i.test(asset.file?.name||asset.name||'')){
   const buffer=await asset.file.arrayBuffer();
   ktx2Loader=new KTX2Loader(manager).setTranscoderPath('./vendor/three/addons/libs/basis/').detectSupport(renderer);
   const gltf=await new Promise((resolve,reject)=>new GLTFLoader(manager).setKTX2Loader(ktx2Loader).parse(buffer,'',resolve,reject));
   return gltf.scene||gltf.scenes?.[0]||(()=>{throw new Error('该 GLB 不包含可显示的场景');})();
  }
  const modelUrl=URL.createObjectURL(asset.file);urls.add(modelUrl);
  const ready=new Promise(resolve=>{manager.onLoad=resolve;});
  const object=await new FBXLoader(manager).loadAsync(modelUrl);
  await ready;
  return object;
 }finally{
  if(ktx2Loader?.transcoderPending)ktx2Loader.dispose();
  urls.forEach(url=>URL.revokeObjectURL(url));
 }
}
async function init(){try{initDeveloperPanel();asset=await getAsset(assetId);if(!asset||asset.kind!=='model')throw new Error('模型资产不存在');$('modelNameInput').value=asset.name||'';$('modelCategoryInput').value=asset.category||'';assignments=asset.partAssignments&&typeof asset.partAssignments==='object'?JSON.parse(JSON.stringify(asset.partAssignments)):{};root=await loadAssetModel(asset);renderModelInfo(root);root.traverse(mesh=>{if(mesh.isMesh){mesh.castShadow=true;mesh.receiveShadow=true;const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];materials.forEach(material=>{if(material?.color)material.color.set(0x9ca3aa);});}});scene.add(root);controls=new OrbitControls(camera,$('partsCanvas'));controls.enableDamping=true;controls.dampingFactor=.075;controls.autoRotate=false;controls.maxPolarAngle=Math.PI*.49;controls.screenSpacePanning=true;controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.PAN,RIGHT:THREE.MOUSE.PAN};const box=new THREE.Box3().setFromObject(root),size=box.getSize(new THREE.Vector3()),scale=5.25/Math.max(...size),center=box.getCenter(new THREE.Vector3());root.scale.setScalar(scale);root.position.set(-center.x*scale,-box.min.y*scale,-center.z*scale);enumerateMaterials();resize();fit();await loadSavedCameraView();$('partsLoading').hidden=true;renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});}catch(error){$('partsLoading').textContent='载入失败：'+error.message;}}
init();
