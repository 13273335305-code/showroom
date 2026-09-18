import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'three/addons/libs/fflate.module.js';
import { slotMaterial, assignMaterial, rebuildMaterialUsage, serializeAssignments, restoreAssignments } from './material-assignments.js';
import { defaultPhysical, readPhysical, preparePhysicalUV, setPhysicalTransform } from './physical-textures.js';
import { readImageDensity, physicalSizeFromDensity } from './image-density.js';
import { revealMaterial } from './material-reveal.js';
const $=id=>document.getElementById(id);
let physicalModel={cmPerUnit:1,fbxCmPerUnit:1,rawSize:[1,1,1],unitKnown:false,calibrated:false};
const MAPS=[['map','基础颜色','BASE COLOR',true],['normalMap','法线','NORMAL',false],['roughnessMap','粗糙度','ROUGHNESS',false],['metalnessMap','金属度','METALLIC',false],['aoMap','环境遮蔽','AO',false],['bumpMap','凹凸高度','BUMP',false],['emissiveMap','自发光','EMISSIVE',true]];
const DEFAULTS={preset:'studio',backgroundColor:'#e8edf2',exposure:1.1,environment:.7,keyLight:3,lightAngle:45,lightColor:'#fff4e6',fillLight:1.5,shadows:true,reflection:true,floorVisible:true,grid:false,rotation:0,scale:1,renderMode:'pbr',autoRotate:false};
let state={...DEFAULTS},renderer,scene,camera,controls,floor,reflector,stage,ring,grid,key,fill,hemi,model,entries=[],selected=null;
let modelSource=null,modelGeneration=0,currentLoad=0,loadingModel=false,toastTimer;
let draggedMaterial=null, assignmentHistory=[],materialPreviewTimer=null;
let materialHoldTimer=null, materialHoverTimer=null, previewAnimation=null, activeReveal=null, suppressMaterialClick=false, materialPulse=null;
let inspectorViewOffset=new THREE.Vector3(), inspectorOffsetApplied=false;
let patterns=[],selectedPattern=null,patternAssets={image:null,normal:null,roughness:null},patternPlaceMode=false,patternDrag=null;
setInterval(()=>{for(const item of patterns){const m=item.entry?.material;if(m&&m.transparent){m.transparent=false;m.opacity=1;m.alphaTest=0;m.depthWrite=true;m.needsUpdate=true;}if(m?.userData?.patternShader){m.onBeforeCompile=null;m.userData.patternShader=null;m.needsUpdate=true;}}},250);
const MATERIAL_DRAG_TYPE='application/x-form-material';
function notify(message,duration=3500){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),duration);}
function busy(title,detail='请稍候…'){endMaterialDrag();$('loadingTitle').textContent=title;$('loadingDetail').textContent=detail;$('loading').hidden=false;}
function hideBusy(){$('loading').hidden=true;}
function yieldFrame(){return new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function formatCount(n){return n>=10000?(n/10000).toFixed(1)+' 万':n.toLocaleString();}
function imageData(texture,maxSize=128,quality=.8){try{if(!texture?.image?.width)return null;const c=document.createElement('canvas'),scale=Math.min(1,maxSize/Math.max(texture.image.width,texture.image.height));c.width=Math.max(1,Math.round(texture.image.width*scale));c.height=Math.max(1,Math.round(texture.image.height*scale));const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(texture.image,0,0,c.width,c.height);return c.toDataURL('image/jpeg',quality);}catch{return null;}}
function init(){
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
 renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});bindEvents();buildSlots();loadExample();
}
function resize(){if(!renderer)return;const {width,height}=$('viewport').getBoundingClientRect();renderer.setSize(width,height,false);camera.aspect=width/Math.max(height,1);camera.updateProjectionMatrix();syncInspectorFraming();}
function fit(direction='perspective'){
 if(!model)return;model.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(model),sphere=box.getBoundingSphere(new THREE.Sphere());if(!Number.isFinite(sphere.radius)||sphere.radius===0)return;
 const vfov=THREE.MathUtils.degToRad(camera.fov),hfov=2*Math.atan(Math.tan(vfov/2)*camera.aspect),distance=sphere.radius/Math.sin(Math.min(vfov,hfov)/2)*1.18;
 const dir=direction==='top'?new THREE.Vector3(0,1,.001):direction==='front'?new THREE.Vector3(0,.14,1):new THREE.Vector3(1.15,.68,1.35);controls.target.copy(sphere.center);camera.position.copy(sphere.center).addScaledVector(dir.normalize(),distance);controls.minDistance=Math.max(.08,sphere.radius*.15);controls.maxDistance=Math.max(20,distance*5);camera.far=Math.max(100,distance*10);camera.updateProjectionMatrix();inspectorOffsetApplied=false;syncInspectorFraming();controls.update();
}
function syncInspectorFraming(){
 if(!camera||!controls)return;
 const open=!document.querySelector('.workspace')?.classList.contains('inspector-collapsed')&&innerWidth>760;
 if(open===inspectorOffsetApplied)return;
 if(open){const distance=camera.position.distanceTo(controls.target),hfov=2*Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov)/2)*camera.aspect),amount=Math.max(.08,distance*Math.tan(hfov/2)*.16);inspectorViewOffset.set(1,0,0).applyQuaternion(camera.quaternion).normalize().multiplyScalar(amount);controls.target.add(inspectorViewOffset);}else{controls.target.sub(inspectorViewOffset);inspectorViewOffset.set(0,0,0);}
 inspectorOffsetApplied=open;controls.update();
}
function applyScene(){
 scene.background.set(state.backgroundColor);scene.fog.color.set(state.backgroundColor);const bgLight=scene.background.getHSL({}).l;document.body.classList.toggle('dark-stage',state.preset==='night'||bgLight<.42);renderer.toneMappingExposure=state.exposure;scene.environmentIntensity=state.environment;
 key.intensity=state.keyLight;key.color.set(state.lightColor);const a=THREE.MathUtils.degToRad(state.lightAngle);key.position.set(Math.sin(a)*7,8,Math.cos(a)*7);key.target.position.set(0,.5,0);fill.intensity=state.fillLight;
 key.castShadow=state.shadows;floor.receiveShadow=state.shadows;stage.children.forEach(o=>{if(o.material?.isShadowMaterial)o.visible=state.shadows;});stage.visible=state.floorVisible;reflector.visible=state.reflection;grid.visible=state.grid;controls.autoRotate=state.autoRotate;
 const dark=state.preset==='night';floor.material.color.set(dark?0x202c3c:0xe3e8ed);hemi.intensity=dark?.35:1;reflector.material.uniforms.color.value.set(dark?0x253449:0xcdd7e1);
 if(model){model.rotation.y=THREE.MathUtils.degToRad(state.rotation);model.scale.setScalar(state.scale);}
 for(const entry of entries){entry.material.wireframe=state.renderMode==='wire';if(entry.material.flatShading!==(state.renderMode==='flat')){entry.material.flatShading=state.renderMode==='flat';entry.material.needsUpdate=true;}}
 $('renderInfo').textContent=state.renderMode==='wire'?'WIREFRAME':'PBR';
 for(const[k,v]of Object.entries(state)){const el=$(k);if(!el)continue;if(el.type==='checkbox')el.checked=v;else if(el.tagName==='INPUT'||el.tagName==='SELECT')el.value=v;if($(k+'Value'))$(k+'Value').textContent=k==='rotation'||k==='lightAngle'?v+'°':Number(v).toFixed(2);}
 $('autoRotate').setAttribute('aria-pressed',state.autoRotate);$('toggleGrid').setAttribute('aria-pressed',state.grid);document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('active',b.dataset.preset===state.preset));
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
 for(const[key,,,color]of MAPS){if(!source[key])continue;const original=source[key];if(original.image?.src===placeholder)continue;material[key]=original.clone();material[key].colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;material[key].needsUpdate=true;}
 if(source.alphaMap){material.alphaMap=source.alphaMap.clone();material.alphaMap.needsUpdate=true;}if(source.normalScale)material.normalScale.copy(source.normalScale);if(source.emissive)material.emissive.copy(source.emissive);material.emissiveIntensity=source.emissiveIntensity??1;material.bumpScale=source.bumpMap?Math.min(.2,source.bumpScale??.02):.02;
 const index=result.length,entry={id:index,name:source.name||'未命名材质 '+(index+1),material,meshes:new Set([o]),uploads:{},mapTokens:{},repeat:[1,1],physical:defaultPhysical(),pendingDpi:{},densityInfo:null,flip:false,baseline:material.clone(),thumbnails:{},previews:{}};
 for(const[key]of MAPS)if(material[key]){entry.thumbnails[key]=imageData(material[key]);entry.previews[key]=imageData(material[key],2048,.92);}result.push(entry);converted.set(source.uuid,entry);return material;
 });o.material=Array.isArray(o.material)?next:next[0];});
 if(!meshCount)throw new Error('该 FBX 不包含可显示的网格');return {entries:result,meshCount,triangles:Math.round(triangles),uvMissing:[...geometries].filter(g=>!g.attributes.uv).length};
}
function disposeObject(object,list=[]){if(!object)return;const gs=new Set(),ms=new Set(),ts=new Set();object.traverse(o=>{if(o.geometry)gs.add(o.geometry);for(const m of(Array.isArray(o.material)?o.material:[o.material]))if(m)ms.add(m);});for(const e of list){ms.add(e.material);ms.add(e.baseline);Object.values(e.uploads).forEach(u=>{if(u.preview)URL.revokeObjectURL(u.preview);});}ms.forEach(m=>{for(const v of Object.values(m))if(v?.isTexture)ts.add(v);m.dispose();});gs.forEach(g=>g.dispose());ts.forEach(t=>t.dispose());}
async function loadModel(buffer,name,files=[],{restore=null}={}){
 const request=++currentLoad;patterns=[];selectedPattern=null;loadingModel=true;busy('正在载入 '+name,'解析几何、材质和纹理…');await yieldFrame();let parsed;
 try{parsed=await parseFBX(buffer,files);if(request!==currentLoad){disposeObject(parsed.object);return;}
 const info=convertMaterials(parsed.object),box=new THREE.Box3().setFromObject(parsed.object),size=box.getSize(new THREE.Vector3()),max=Math.max(size.x,size.y,size.z);if(!Number.isFinite(max)||max<1e-10)throw new Error('模型尺寸无效');
 const unit=Number(parsed.object.userData.unitScaleFactor);
 const nextPhysicalModel={cmPerUnit:Number.isFinite(unit)&&unit>0?unit:1,fbxCmPerUnit:Number.isFinite(unit)&&unit>0?unit:1,rawSize:size.toArray(),unitKnown:Number.isFinite(unit)&&unit>0,calibrated:false};
 busy('正在标定贴图尺寸','根据模型实际尺寸与原有 UV 计算铺贴比例…');await yieldFrame();preparePhysicalUV(parsed.object);
 const center=box.getCenter(new THREE.Vector3()),s=4.2/max,normalizer=new THREE.Group(),root=new THREE.Group();normalizer.add(parsed.object);normalizer.scale.setScalar(s);normalizer.position.set(-center.x*s,-box.min.y*s+.014,-center.z*s);root.add(normalizer);
 if(model){scene.remove(model);disposeObject(model,entries);}model=root;physicalModel=nextPhysicalModel;updateModelDimensions();modelGeneration++;assignmentHistory=[];$('undoMaterial').disabled=true;entries=info.entries;selected=null;modelSource={buffer:buffer.slice(0),name,files};scene.add(model);state.rotation=0;state.scale=1;$('isolate').checked=false;applyScene();fit();
 $('modelName').textContent=name;$('modelName').title=name;$('modelStats').textContent=`${info.meshCount} 网格 · ${formatCount(info.triangles)} 三角面`;$('materialCount').textContent=String(entries.length).padStart(2,'0');selectEntry(entries[0]);renderMaterials();if(restore)await restore(entries);if(request!==currentLoad)return;hideBusy();notify(`已载入 ${entries.length} 个独立材质`+(parsed.missing.length?'；缺少 '+parsed.missing.length+' 个外部纹理，可在右侧补充':'')+(info.uvMissing?'；部分网格没有 UV，无法显示贴图':''),6000);
 }catch(error){console.error(error);if(request===currentLoad){hideBusy();notify('载入失败：'+error.message,8000);if(!model){$('modelName').textContent='请导入 FBX 模型';$('modelStats').textContent='点击右侧 ＋ 选择文件';}}}finally{if(request===currentLoad)loadingModel=false;}
}
async function loadExample(){try{const r=await fetch('./MM06-展厅版.fbx');if(!r.ok)throw new Error('找不到示例 FBX');await loadModel(await r.arrayBuffer(),'MM06-展厅版.fbx');}catch(e){hideBusy();$('modelName').textContent='导入你的 FBX';notify('示例模型未找到，请点击 ＋ 导入自己的 FBX。',6000);}}
async function importFiles(files){if(loadingModel)return notify('请等待当前模型加载完成');const list=[...files],fbx=list.find(f=>/\.fbx$/i.test(f.name));if(!fbx)return notify('请选择一个 .fbx 文件，可同时附带纹理图片');if(fbx.size>512*1024*1024)return notify('模型文件过大，请使用小于 512 MB 的 FBX');await loadModel(await fbx.arrayBuffer(),fbx.name,list.filter(f=>f!==fbx));}
function renderMaterials(){const host=$('materialList');host.replaceChildren();for(const entry of entries){const button=document.createElement('button');button.className='material-item'+(entry===selected?' active':'');button.setAttribute('aria-pressed',String(entry===selected));button.title=entry.name+' · 拖到模型表面替换材质；双击查看应用部件';button.draggable=false;button.dataset.entryId=entry.id;button.addEventListener('pointerdown',event=>startMaterialDrag(event,entry));button.addEventListener('dblclick',event=>{event.preventDefault();event.stopPropagation();endMaterialDrag();pulseMaterialUsage(entry);});button.setAttribute('aria-label','选择材质 '+entry.name);const swatch=document.createElement('div');swatch.className='material-thumb';decorateSwatch(swatch,entry);const name=document.createElement('strong');name.textContent=entry.name;const meta=document.createElement('small');meta.textContent=String(entry.id+1).padStart(2,'0')+' / '+MAPS.filter(([k])=>entry.material[k]).length+' 张贴图 · '+entry.meshes.size+' 网格';button.append(swatch,name,meta);button.onclick=()=>{if(suppressMaterialClick){suppressMaterialClick=false;return;}selectEntry(entry);showPanel('material');};host.append(button);}}
function stopMaterialPulse(){if(!materialPulse)return;cancelAnimationFrame(materialPulse.frame);for(const item of materialPulse.items){if(Array.isArray(item.mesh.material))item.mesh.material=item.original;else item.mesh.material=item.original;item.highlight.dispose();}materialPulse=null;}
function pulseMaterialUsage(entry){
 stopMaterialPulse();
 const items=[];
 for(const mesh of entry.meshes){
  const original=mesh.material,slots=Array.isArray(original)?original.slice():[original],highlighted=false;
  const next=slots.map(material=>{if(material!==entry.material)return material;const clone=material.clone();if('emissive' in clone){clone.emissive.set(0x78b7ff);clone.emissiveMap=null;clone.emissiveIntensity=0;clone.needsUpdate=true;}items.push({mesh,original,highlight:clone});return clone;});
  if(items.some(item=>item.mesh===mesh))mesh.material=Array.isArray(original)?next:next[0];
 }
 if(!items.length){notify('该材质当前没有应用到模型部件');return;}
 const pulse={items,started:performance.now(),frame:0};materialPulse=pulse;
 const tick=now=>{if(materialPulse!==pulse)return;const t=Math.min(1,(now-pulse.started)/2200);const wave=Math.pow((Math.sin(t*Math.PI*6-Math.PI/2)+1)/2,1.65);for(const item of items)item.highlight.emissiveIntensity=.15+2.4*wave;if(t<1)pulse.frame=requestAnimationFrame(tick);else stopMaterialPulse();};
 pulse.frame=requestAnimationFrame(tick);
 notify('正在高亮显示「'+entry.name+'」应用的模型部件',2200);
}
function decorateSwatch(el,entry){el.replaceChildren();const color='#'+entry.material.color.getHexString();el.style.background=`radial-gradient(circle at 30% 25%,#ffffff85,transparent 48%),linear-gradient(145deg,${color},${color})`;const src=entry.material.map&&(entry.uploads.map?.preview||entry.thumbnails.map);if(src){const img=new Image();img.src=src;img.alt='';img.draggable=false;el.append(img);}}
function selectEntry(entry){if(!entry)return;selected=entry;$('materialName').value=entry.name;$('materialUsage').textContent=`材质 ${String(entry.id+1).padStart(2,'0')} · 应用于 ${entry.meshes.size} 个网格`;decorateSwatch($('selectedSwatch'),entry);$('baseColor').value='#'+entry.material.color.getHexString();const vals={roughness:entry.material.roughness,metalness:entry.material.metalness,normalStrength:Math.abs(entry.material.normalScale.x),aoStrength:entry.material.aoMapIntensity,emissiveStrength:entry.material.emissiveIntensity,bumpStrength:entry.material.bumpScale};for(const[id,v]of Object.entries(vals)){$(id).value=v;$(id+'Value').textContent=Number(v).toFixed(id==='bumpStrength'?3:2);}$('repeatU').value=entry.repeat[0];$('repeatV').value=entry.repeat[1];updatePhysicalPanel(entry);$('flipNormal').checked=entry.flip;updateSlots();renderMaterials();applyIsolation();}
function buildSlots(){for(const[key,label,english]of MAPS){const wrap=document.createElement('div');wrap.className='texture-slot';wrap.id='slot-'+key;const upload=document.createElement('button');upload.className='texture-upload';upload.setAttribute('aria-label','上传'+label+'贴图');const span=document.createElement('span');const plus=document.createElement('strong');plus.textContent='＋';span.append(plus,document.createTextNode(label));upload.append(span);const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/webp,image/bmp';input.id='texture-'+key;input.onchange=async()=>{const entry=selected,file=input.files[0];input.value='';if(entry&&file){try{await uploadTexture(entry,key,file);}catch{}}};upload.onclick=()=>{if(!selected)return notify('请先导入模型');input.click();};const remove=document.createElement('button');remove.className='remove-texture';remove.textContent='×';remove.title='移除'+label+'贴图';remove.setAttribute('aria-label','移除'+label+'贴图');remove.onclick=()=>removeTexture(selected,key);wrap.append(upload,input,remove);wrap.title=label+' / '+english;$('textureSlots').append(wrap);}}
function updateSlots(){for(const[key,label]of MAPS){const wrap=$('slot-'+key);const has=!!selected?.material[key];wrap.classList.toggle('has-image',has);wrap.querySelectorAll('img').forEach(i=>i.remove());const src=selected?.uploads[key]?.preview||selected?.thumbnails[key];if(has&&src){const img=new Image();img.src=src;img.alt=label+'预览';wrap.prepend(img);}wrap.querySelector('strong').textContent=has?'✓':'＋';wrap.querySelector('.remove-texture').hidden=!has;wrap.title=selected?.uploads[key]?.file.name||label+(has?' · FBX 内置贴图':' · 点击上传');}}
function configureTexture(entry,texture,key){texture.colorSpace=MAPS.find(([k])=>k===key)[3]?THREE.SRGBColorSpace:THREE.NoColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;if(entry.physical.mode==='physical'){const measured=entry.physical.sizeSource==='dpi'?texture.userData.density:null;setPhysicalTransform(texture,measured?{...entry.physical,...measured}:entry.physical,physicalModel.cmPerUnit);}else{texture.channel=0;texture.matrixAutoUpdate=true;texture.center.set(0,0);texture.rotation=0;texture.repeat.set(...entry.repeat);texture.updateMatrix();}texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());texture.needsUpdate=true;}
async function uploadTexture(entry,key,file,quiet=false){
 if(file.size>64*1024*1024){notify('单张贴图请小于 64 MB');return;}
 const generation=modelGeneration,token=(entry.mapTokens[key]||0)+1;entry.mapTokens[key]=token;
 const url=URL.createObjectURL(file);let texture;
 try{
  const meta=readImageDensity(await file.arrayBuffer());texture=await new THREE.TextureLoader().loadAsync(url);
  if(generation!==modelGeneration||entry.mapTokens[key]!==token){texture.dispose();URL.revokeObjectURL(url);return;}
  if(texture.image.width>renderer.capabilities.maxTextureSize||texture.image.height>renderer.capabilities.maxTextureSize)throw new Error('图片尺寸超过显卡支持范围');
  const density=physicalSizeFromDensity(meta,texture.image.width,texture.image.height,entry.physical.fallbackDpi);
  if(entry.physical.mode==='physical'&&entry.physical.sizeSource==='dpi'&&!density){
   entry.pendingDpi[key]=file;texture.dispose();URL.revokeObjectURL(url);
   if(entry===selected)updatePhysicalPanel(entry);
   if(quiet)throw new Error(file.name+' 未记录 DPI，请为此文件指定 DPI');
   notify(file.name+' 未记录有效 DPI；请在右侧填写 DPI 后应用，原贴图保持不变',6500);return;
  }
  if(density){texture.userData.density=density;entry.densityInfo={...density,name:file.name};if(entry.physical.sizeSource==='dpi'){entry.physical.widthCm=density.widthCm;entry.physical.heightCm=density.heightCm;entry.physical.initialized=true;}}
  if(!entry.physical.initialized&&entry.physical.sizeSource!=='dpi'){entry.physical.heightCm=entry.physical.widthCm*texture.image.height/texture.image.width;entry.physical.initialized=true;}
  const old=entry.material[key];if(old&&old!==entry.baseline[key])old.dispose();if(entry.uploads[key])URL.revokeObjectURL(entry.uploads[key].preview);
  delete entry.pendingDpi[key];texture.userData.formUpload=true;configureTexture(entry,texture,key);entry.material[key]=texture;entry.uploads[key]={file,preview:url};
  if(key==='map')entry.material.color.set(0xffffff);if(key==='roughnessMap')entry.material.roughness=1;if(key==='metalnessMap')entry.material.metalness=1;if(key==='emissiveMap')entry.material.emissive.set(0xffffff);
  entry.material.needsUpdate=true;if(entry===selected)selectEntry(entry);else renderMaterials();
  if(!quiet)notify(density&&entry.physical.sizeSource==='dpi'?file.name+' · '+density.dpiX.toFixed(2)+' × '+density.dpiY.toFixed(2)+' DPI → '+density.widthCm.toFixed(2)+' × '+density.heightCm.toFixed(2)+' cm':file.name+' 已应用于 '+entry.name);
 }catch(e){texture?.dispose();URL.revokeObjectURL(url);notify('贴图载入失败：'+e.message,5000);throw e;}
}
function removeTexture(entry,key){if(!entry)return;entry.mapTokens[key]=(entry.mapTokens[key]||0)+1;const old=entry.material[key];if(old&&old!==entry.baseline[key])old.dispose();entry.material[key]=null;if(entry.uploads[key]){URL.revokeObjectURL(entry.uploads[key].preview);delete entry.uploads[key];}delete entry.pendingDpi[key];if(!Object.keys(entry.uploads).length)entry.densityInfo=null;entry.material.needsUpdate=true;selectEntry(entry);}
function applyIsolation(){for(const entry of entries)entry.material.visible=!$('isolate').checked||entry===selected;}
function resetMaterial(){if(!selected)return;const e=selected;for(const[key]of MAPS){e.mapTokens[key]=(e.mapTokens[key]||0)+1;if(e.material[key]&&e.material[key]!==e.baseline[key])e.material[key].dispose();}Object.values(e.uploads).forEach(u=>URL.revokeObjectURL(u.preview));e.uploads={};e.material.copy(e.baseline);e.repeat=[1,1];e.physical=defaultPhysical();e.pendingDpi={};e.densityInfo=null;e.flip=false;e.name=e.baseline.name||'未命名材质 '+(e.id+1);applyScene();selectEntry(e);notify('已恢复该材质的 FBX 初始设置');}
function showPanel(tab){for(const name of ['material','scene']){$(name+'Panel').hidden=name!==tab;$(name+'Tab').classList.toggle('active',name===tab);$(name+'Tab').setAttribute('aria-selected',name===tab);}if(innerWidth<=760)$('inspector').classList.add('open');}
function pickModelMaterial(clientX,clientY){
 if(!model||loadingModel)return null;
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
 preview.style.borderRadius='50%';
 preview.style.transform=`translate3d(${event.clientX-27}px,${event.clientY-27}px,0) scale(.18)`;
 draggedMaterial.phase='dragging';
 const hoverKey=hit?hit.mesh.uuid+':'+hit.slot:'';
 if(hoverKey!==draggedMaterial.hoverKey){
  clearTimeout(materialHoverTimer);preview.classList.remove('jelly-ready');draggedMaterial.hoverKey=hoverKey;
  if(hoverKey)materialHoverTimer=setTimeout(()=>{if(draggedMaterial?.hoverKey===hoverKey)preview.classList.add('jelly-ready');},1000);
 }
 preview.classList.add('following');
 $('materialDropHint').hidden=!hit;
 $('materialDropHint').textContent=hit?'松开替换「'+hit.entry.name+'」':'';
}
function startMaterialDrag(event,entry){
 if(event.button!==0||loadingModel||!$('loading').hidden)return;
 endMaterialDrag();clearTimeout(materialPreviewTimer);suppressMaterialClick=false;
 const element=event.currentTarget,rect=element.querySelector('.material-thumb').getBoundingClientRect();
 draggedMaterial={entry,generation:modelGeneration,element,sourceRect:rect,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,phase:'pressed'};
 element.setPointerCapture(event.pointerId);
 const preview=$('materialPreview'),image=preview.querySelector('.material-preview-image'),label=preview.querySelector('.material-preview-label');
 document.body.append(preview);previewAnimation?.cancel();preview.className='material-preview active';
 const source=entry.uploads.map?.preview||entry.previews.map||entry.thumbnails.map||imageData(entry.material.map,2048,.92);
 image.style.backgroundImage=source?`url("${source}")`:'none';
 image.style.backgroundColor='#'+entry.material.color.getHexString();
 const density=entry.material.map?.userData.density,p=entry.physical;
 const physical=p.mode==='physical'&&(p.initialized||density);
 const w=p.sizeSource==='dpi'&&density?density.widthCm:p.widthCm,h=p.sizeSource==='dpi'&&density?density.heightCm:p.heightCm;
 // The model keeps physical tiling; the inspection window shows one full,
 // native-resolution sample so the weave/detail is not reduced to tiny repeats.
 image.style.backgroundRepeat='no-repeat';
 image.style.backgroundSize='cover';
 image.style.imageRendering='auto';
 image.style.setProperty('--preview-angle',(p.angle||0)+'deg');
 label.textContent=entry.name+(physical?' · 150 × 150 cm':'');
 preview.style.transform=`translate3d(${rect.left}px,${rect.top}px,0) scale(${rect.width/300})`;preview.style.opacity='0';preview.style.borderRadius='50%';
 materialHoldTimer=setTimeout(()=>centerMaterialPreview(entry),220);
 controls.enabled=false;controls.autoRotate=false;
}
function endMaterialDrag(success=false){
 const session=draggedMaterial;if(!session)return;
 draggedMaterial=null;clearTimeout(materialHoldTimer);
 clearTimeout(materialHoverTimer);materialHoverTimer=null;$('materialPreview').classList.remove('jelly-ready');
 if(session.element.hasPointerCapture(session.pointerId))session.element.releasePointerCapture(session.pointerId);
 controls.enabled=true;controls.autoRotate=state.autoRotate;
 session.element.classList.remove('dragging');$('materialDropHint').hidden=true;$('viewport').classList.remove('material-drag-active');
 const preview=$('materialPreview'),r=session.sourceRect;
 if(success===true){const p=preview.getBoundingClientRect();animatePreview(p.left+p.width/2,p.top+p.height/2,10,40,0,220);}
 else animatePreview(r.left+r.width/2,r.top+r.height/2,r.width,150,0,380);
 clearTimeout(materialPreviewTimer);materialPreviewTimer=setTimeout(()=>{preview.className='material-preview';},400);
}
function finishReveal(){if(activeReveal){cancelAnimationFrame(activeReveal.frame);activeReveal.effect.dispose();activeReveal=null;}}
function playMaterialReveal(hit,previous){
 finishReveal();
 if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const effect=revealMaterial(scene,hit.mesh,hit.slot,previous,hit.point),started=performance.now();
 const session={effect,frame:0};activeReveal=session;
 const tick=now=>{const p=Math.min(1,(now-started)/1050);const eased=p*p*(3-2*p);effect.update(eased);if(p<1)session.frame=requestAnimationFrame(tick);else finishReveal();};
 session.frame=requestAnimationFrame(tick);
}
function replaceHitMaterial(hit,source){
 if(hit.entry===source){notify('该部位已经使用这个材质');return;}
 const previous=slotMaterial(hit.mesh,hit.slot);
 if(!assignMaterial(hit.mesh,hit.slot,source.material))return;
 playMaterialReveal(hit,previous);
 assignmentHistory.push({mesh:hit.mesh,slot:hit.slot,previous});if(assignmentHistory.length>30)assignmentHistory.shift();
 $('undoMaterial').disabled=false;rebuildMaterialUsage(model,entries);selectEntry(source);
 notify('已将「'+hit.entry.name+'」所在部位替换为「'+source.name+'」');
}
function undoMaterialAssignment(){
 finishReveal();
 if(loadingModel)return;
 const action=assignmentHistory.pop();if(!action)return;
 assignMaterial(action.mesh,action.slot,action.previous);rebuildMaterialUsage(model,entries);
 selectEntry(entries.find(entry=>entry.material===action.previous)||selected);
 $('undoMaterial').disabled=assignmentHistory.length===0;notify('已撤销上一次材质替换');
}
function bindMaterialDrop(){
 document.addEventListener('pointermove',event=>{
  const s=draggedMaterial;if(!s||s.pointerId!==event.pointerId)return;
  if(s.phase!=='dragging'&&Math.hypot(event.clientX-s.startX,event.clientY-s.startY)<8)return;
  clearTimeout(materialHoldTimer);suppressMaterialClick=true;s.element.classList.add('dragging');
  $('viewport').classList.add('material-drag-active');
  moveMaterialPreview(event,pickModelMaterial(event.clientX,event.clientY));
 });
 document.addEventListener('pointerup',event=>{
  const s=draggedMaterial;if(!s||s.pointerId!==event.pointerId)return;
  const hit=s.phase==='dragging'&&s.generation===modelGeneration?pickModelMaterial(event.clientX,event.clientY):null;
  endMaterialDrag(!!hit);if(hit)replaceHitMaterial(hit,s.entry);
 });
 document.addEventListener('pointercancel',()=>endMaterialDrag());
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
function patternTexture(file,key){if(!file)return;const url=URL.createObjectURL(file);new THREE.TextureLoader().load(url,texture=>{texture.colorSpace=key==='image'?THREE.SRGBColorSpace:THREE.NoColorSpace;texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;patternAssets[key]=texture;URL.revokeObjectURL(url);$('patternPlace').disabled=!patternAssets.image;notify(key==='image'?'图案已载入，点击模型表面放置':'图案'+(key==='normal'?'法线':'粗糙度')+'已载入');},undefined,()=>{URL.revokeObjectURL(url);notify('图案贴图载入失败');});}
function surfaceHit(x,y){if(!model)return null;const rect=$('canvas').getBoundingClientRect(),p=new THREE.Vector2((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1),ray=new THREE.Raycaster();ray.setFromCamera(p,camera);const meshes=[];model.traverseVisible(o=>{if(o.isMesh)meshes.push(o);});const hit=ray.intersectObjects(meshes,false)[0];if(!hit||!hit.face)return null;const slot=Array.isArray(hit.object.material)?hit.face.materialIndex:0,material=slotMaterial(hit.object,slot),entry=entries.find(item=>item.material===material),normal=hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();return {...hit,slot,material,entry,normal};}
function placePattern(hit){attachUvPattern(hit.entry,hit.uv);const material=new THREE.MeshStandardMaterial({transparent:true,opacity:0,depthWrite:false});const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1,1),material);mesh.visible=false;const group=new THREE.Group(),localNormal=hit.normal.clone().transformDirection(new THREE.Matrix4().copy(hit.object.matrixWorld).invert()).normalize();group.position.copy(hit.object.worldToLocal(hit.point.clone()));group.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),localNormal);group.add(mesh);hit.object.add(group);const item={group,mesh,host:hit.object,material,entry:hit.entry,widthCm:10,heightCm:10};patterns.push(item);selectedPattern=item;$('patternPlace').textContent='点击模型放置图案';for(const id of ['patternWidth','patternHeight','patternLock','patternRotation','patternDelete'])$(id).disabled=false;updatePatternSize();notify('图案已按模型 UV 贴合，可继续拖动编辑');}
function patternWorldPerCm(){if(!model)return .01;model.updateMatrixWorld(true);const size=new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()),world=Math.max(size.x,size.y,size.z),cm=Math.max(...physicalModel.rawSize.map((v,i)=>v*physicalModel.cmPerUnit),.01);return world/cm;}
function attachUvPattern(entry,uv){if(!entry?.material||!patternAssets.image||!uv)return;const m=entry.material,state=m.userData.uvPattern||{map:patternAssets.image,center:new THREE.Vector2(uv.x,uv.y),size:new THREE.Vector2(.18,.18)};m.userData.uvPattern=state;state.map=patternAssets.image;state.center.set(uv.x,uv.y);if(m.userData.patternShader){m.userData.patternShader.uniforms.patternMap.value=state.map;m.userData.patternShader.uniforms.patternCenter.value=state.center;return;}m.onBeforeCompile=shader=>{shader.uniforms.patternMap={value:state.map};shader.uniforms.patternCenter={value:state.center};shader.uniforms.patternSize={value:state.size};m.userData.patternShader=shader;shader.fragmentShader=shader.fragmentShader.replace('#include <map_pars_fragment>','#include <map_pars_fragment>\nuniform sampler2D patternMap; uniform vec2 patternCenter; uniform vec2 patternSize;').replace('#include <map_fragment>','#include <map_fragment>\nvec2 patternUv=(vMapUv-patternCenter)/patternSize+0.5;float patternInside=step(0.0,patternUv.x)*step(patternUv.x,1.0)*step(0.0,patternUv.y)*step(patternUv.y,1.0);vec4 patternSample=texture2D(patternMap,patternUv);diffuseColor.rgb=mix(diffuseColor.rgb,patternSample.rgb,patternSample.a*patternInside);');};m.needsUpdate=true;}
function updatePatternSize(){if(!selectedPattern)return;const w=Math.max(.1,Number($('patternWidth').value)||10),h=Math.max(.1,Number($('patternHeight').value)||10);selectedPattern.widthCm=w;selectedPattern.heightCm=h;const unit=patternWorldPerCm();selectedPattern.group.scale.set(w*unit,h*unit,1);const state=selectedPattern.entry?.material.userData.uvPattern;if(state){state.size.set(w/Math.max(physicalModel.rawSize[0]*physicalModel.cmPerUnit,.01),h/Math.max(physicalModel.rawSize[1]*physicalModel.cmPerUnit,.01));if(selectedPattern.entry.material.userData.patternShader)selectedPattern.entry.material.userData.patternShader.uniforms.patternSize.value=state.size;}}
function bindEvents(){
 $('patternTab').onclick=()=>{showPanel('material');$('materialPanel').hidden=true;$('patternPanel').hidden=false;$('scenePanel').hidden=true;$('materialTab').classList.remove('active');$('patternTab').classList.add('active');$('sceneTab').classList.remove('active');};
 for(const [id,key,label] of [['patternImage','image','图案透明底图'],['patternNormal','normal','图案法线'],['patternRoughness','roughness','图案粗糙度']]){const input=$(id),wrap=input.closest('.pattern-upload');wrap.addEventListener('click',event=>{if(event.target!==input){event.preventDefault();input.click();}});input.onchange=event=>{const file=event.target.files?.[0];if(file){patternTexture(file,key);wrap.classList.add('has-image');wrap.querySelector('span').textContent='✓ '+label;}event.target.value='';};}
 $('patternPlace').onclick=()=>{patternPlaceMode=!!patternAssets.image;$('patternPlace').textContent=patternPlaceMode?'请点击模型表面…':'点击模型放置图案';};
 $('patternWidth').oninput=()=>{if($('patternLock').checked&&selectedPattern){const ratio=selectedPattern.heightCm/selectedPattern.widthCm;$('patternHeight').value=(Number($('patternWidth').value)*ratio).toFixed(1);}updatePatternSize();};$('patternHeight').oninput=()=>{if($('patternLock').checked&&selectedPattern){const ratio=selectedPattern.widthCm/selectedPattern.heightCm;$('patternWidth').value=(Number($('patternHeight').value)*ratio).toFixed(1);}updatePatternSize();};
 $('patternRotation').oninput=e=>{if(selectedPattern){selectedPattern.mesh.rotation.z=THREE.MathUtils.degToRad(Number(e.target.value));$('patternRotationValue').textContent=e.target.value+'°';}};
 $('patternDelete').onclick=()=>{if(!selectedPattern)return;selectedPattern.host.remove(selectedPattern.group);selectedPattern.mesh.geometry.dispose();selectedPattern.material.dispose();patterns=patterns.filter(p=>p!==selectedPattern);selectedPattern=null;$('patternDelete').disabled=true;$('patternWidth').disabled=true;$('patternHeight').disabled=true;$('patternLock').disabled=true;$('patternRotation').disabled=true;};
 const activatePanel=tab=>{for(const name of ['material','pattern','scene']){$(name+'Panel').hidden=name!==tab;$(name+'Tab').classList.toggle('active',name===tab);$(name+'Tab').setAttribute('aria-selected',String(name===tab));}};
 $('materialTab').onclick=()=>activatePanel('material');$('sceneTab').onclick=()=>activatePanel('scene');
 $('canvas').addEventListener('click',e=>{if(patternPlaceMode){const hit=surfaceHit(e.clientX,e.clientY);if(hit)placePattern(hit);}});
 $('canvas').addEventListener('pointerdown',e=>{if(patternPlaceMode||!patterns.length)return;const rect=$('canvas').getBoundingClientRect(),p=new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),ray=new THREE.Raycaster();ray.setFromCamera(p,camera);const found=ray.intersectObjects(patterns.map(x=>x.mesh),true)[0];if(found){selectedPattern=patterns.find(x=>x.mesh===found.object);patternDrag=selectedPattern;controls.enabled=false;$('canvas').setPointerCapture(e.pointerId);}});
 $('canvas').addEventListener('pointermove',e=>{if(!patternDrag)return;const hit=surfaceHit(e.clientX,e.clientY);if(hit&&hit.object===patternDrag.host){patternDrag.group.position.copy(patternDrag.host.worldToLocal(hit.point.clone()));const localNormal=hit.normal.clone().transformDirection(new THREE.Matrix4().copy(patternDrag.host.matrixWorld).invert()).normalize();patternDrag.group.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),localNormal);const state=patternDrag.entry?.material.userData.uvPattern;if(state&&hit.uv){state.center.set(hit.uv.x,hit.uv.y);if(patternDrag.entry.material.userData.patternShader)patternDrag.entry.material.userData.patternShader.uniforms.patternCenter.value=state.center;}}});
 $('canvas').addEventListener('pointerup',e=>{if(patternDrag){patternDrag=null;controls.enabled=true;if($('canvas').hasPointerCapture(e.pointerId))$('canvas').releasePointerCapture(e.pointerId);}});
 const workspace=document.querySelector('.workspace'),inspector=$('inspector');
 const setInspectorCollapsed=collapsed=>{workspace.classList.toggle('inspector-collapsed',collapsed);$('restoreInspector').hidden=!collapsed;inspector.setAttribute('aria-hidden',String(collapsed));inspectorOffsetApplied=collapsed;syncInspectorFraming();};
 $('collapseInspector').onclick=()=>setInspectorCollapsed(true);$('restoreInspector').onclick=()=>setInspectorCollapsed(false);
 $('materialTab').onclick=()=>showPanel('material');$('sceneTab').onclick=()=>showPanel('scene');$('inspectorToggle').onclick=()=>$('inspector').classList.toggle('open');$('closeInspector').onclick=()=>$('inspector').classList.remove('open');
 $('importModel').onclick=$('importSecondary').onclick=()=>$('modelFile').click();$('modelFile').onchange=()=>{importFiles($('modelFile').files);$('modelFile').value='';};
 bindMaterialDrop();bindPhysicalControls();
 $('undoMaterial').onclick=undoMaterialAssignment;
 $('fitView').onclick=()=>fit();$('frontView').onclick=()=>fit('front');$('topView').onclick=()=>fit('top');$('autoRotate').onclick=()=>{state.autoRotate=!state.autoRotate;applyScene();};$('toggleGrid').onclick=()=>{state.grid=!state.grid;applyScene();};$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{notify('此浏览器不支持全屏，请使用浏览器的 F11。');}};
 $('scrollLeft').onclick=()=>$('materialList').scrollBy({left:-300,behavior:'smooth'});$('scrollRight').onclick=()=>$('materialList').scrollBy({left:300,behavior:'smooth'});
 document.addEventListener('keydown',e=>{if(e.target.matches('input,select,textarea'))return;if(e.key.toLowerCase()==='f'){e.preventDefault();fit();}if(e.key==='Escape')$('inspector').classList.remove('open');});
 $('materialName').onchange=()=>{if(selected){selected.name=$('materialName').value.trim()||'未命名材质';selected.material.name=selected.name;renderMaterials();}};$('isolate').onchange=applyIsolation;$('resetMaterial').onclick=resetMaterial;
 $('baseColor').oninput=()=>{if(selected){selected.material.color.set($('baseColor').value);decorateSwatch($('selectedSwatch'),selected);renderMaterials();}};
 for(const id of ['roughness','metalness','normalStrength','aoStrength','emissiveStrength','bumpStrength'])$(id).oninput=()=>{if(!selected)return;const v=Number($(id).value),m=selected.material;$(id+'Value').textContent=v.toFixed(id==='bumpStrength'?3:2);if(id==='normalStrength')m.normalScale.set(v,selected.flip?-v:v);else m[({aoStrength:'aoMapIntensity',emissiveStrength:'emissiveIntensity',bumpStrength:'bumpScale'})[id]||id]=v;};
 $('flipNormal').onchange=()=>{if(!selected)return;selected.flip=$('flipNormal').checked;selected.material.normalScale.y=Math.abs(selected.material.normalScale.x)*(selected.flip?-1:1);};
 for(const id of ['repeatU','repeatV'])$(id).onchange=()=>{if(!selected)return;const values=[$('repeatU').valueAsNumber,$('repeatV').valueAsNumber];if(values.some(v=>!Number.isFinite(v)||v<.01||v>100)){notify('UV 重复范围为 0.01–100');selectEntry(selected);return;}selected.repeat=values;for(const[key]of MAPS){const tex=selected.material[key];if(!tex)continue;if(tex===selected.baseline[key])selected.material[key]=tex.clone();configureTexture(selected,selected.material[key],key);}};
 for(const[id,value]of Object.entries(DEFAULTS)){if(!$(id)||id==='autoRotate')continue;$(id).addEventListener('input',()=>{state[id]=typeof value==='boolean'?$(id).checked:typeof value==='number'?Number($(id).value):$(id).value;applyScene();});}
 document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>{state.preset=b.dataset.preset;Object.assign(state,state.preset==='night'?{backgroundColor:'#172232',exposure:1.05,keyLight:4,fillLight:.7,lightColor:'#dde8ff'}:state.preset==='daylight'?{backgroundColor:'#e5edf3',exposure:1.2,keyLight:4.5,fillLight:1.8,lightColor:'#ffedd4'}:{backgroundColor:DEFAULTS.backgroundColor,exposure:1.1,keyLight:3,fillLight:1.5,lightColor:DEFAULTS.lightColor});applyScene();});$('resetScene').onclick=()=>{state={...DEFAULTS};applyScene();fit();};
 $('canvas').addEventListener('dblclick',event=>{const hit=pickModelMaterial(event.clientX,event.clientY);if(!hit)return;selectEntry(hit.entry);showPanel('material');$('materialList').children[hit.entry.id].scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});});
 $('snapshot').onclick=()=>{renderer.render(scene,camera);$('canvas').toBlob(blob=>{if(blob){download(blob,'FORM-'+new Date().toISOString().slice(0,10)+'.png');notify('已导出当前视角 PNG 图片');}},'image/png');};
 $('saveProject').onclick=saveProject;$('openProject').onclick=()=>$('projectFile').click();$('projectFile').onchange=()=>{const f=$('projectFile').files[0];$('projectFile').value='';if(f)openProject(f);};
}
function snapshotEntry(e){const m=e.material;return {id:e.id,name:e.name,color:m.color.getHexString(),roughness:m.roughness,metalness:m.metalness,normalStrength:Math.abs(m.normalScale.x),aoStrength:m.aoMapIntensity,emissive:m.emissive.getHexString(),emissiveStrength:m.emissiveIntensity,bumpStrength:m.bumpScale,repeat:e.repeat,physical:{...e.physical},flip:e.flip,maps:Object.fromEntries(MAPS.map(([k])=>[k,m[k]?(e.uploads[k]?'upload':'original'):null]))};}
async function saveProject(){
 if(!modelSource||loadingModel)return notify('请先完成模型载入');if(entries.some(e=>Object.keys(e.pendingDpi||{}).length))return notify('还有贴图等待指定 DPI，请先应用后再保存项目');busy('正在保存项目','打包 FBX、所有上传贴图与场景设置');await yieldFrame();
 try{const archive={'model.fbx':new Uint8Array(modelSource.buffer)},config={format:'FORM',version:1,name:modelSource.name,scene:{...state},camera:{position:camera.position.toArray(),target:controls.target.toArray()},selected:selected?.id||0,materials:entries.map(snapshotEntry),assignments:serializeAssignments(model,entries),physicalModel:{...physicalModel},resources:[]};
 for(let i=0;i<modelSource.files.length;i++){const f=modelSource.files[i],path='resources/'+i;archive[path]=new Uint8Array(await f.arrayBuffer());config.resources.push({path,name:f.name,type:f.type});}
 for(const e of entries)for(const[key,u]of Object.entries(e.uploads)){const path='textures/'+e.id+'/'+key;archive[path]=new Uint8Array(await u.file.arrayBuffer());config.materials[e.id].maps[key]={path,name:u.file.name,type:u.file.type};}
 archive['project.json']=strToU8(JSON.stringify(config));download(new Blob([zipSync(archive,{level:0})],{type:'application/zip'}),(modelSource.name.replace(/\.fbx$/i,'')||'FORM')+'.form');notify('已保存完整项目，包含模型与上传贴图');
 }catch(e){console.error(e);notify('保存失败：'+e.message,6000);}finally{hideBusy();}
}
async function openProject(file){
 if(loadingModel)return notify('请等待当前载入完成');if(file.size>768*1024*1024)return notify('项目过大，请使用小于 768 MB 的文件');busy('正在打开项目','恢复模型、贴图与灯光设置');await yieldFrame();
 try{let expanded=0;const archive=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:item=>{expanded+=item.originalSize;if(expanded>1024*1024*1024)throw new Error('项目解压后超过 1 GB');return true;}});const config=JSON.parse(strFromU8(archive['project.json']));if(config.format!=='FORM'||config.version!==1||!archive['model.fbx'])throw new Error('这不是有效的 FORM 项目');
 const resources=(config.resources||[]).map(r=>{if(!archive[r.path])throw new Error('项目缺少资源');return new File([archive[r.path]],r.name,{type:r.type});});
 await loadModel(archive['model.fbx'].slice().buffer,config.name,resources,{restore:async()=>{
 if(config.physicalModel){const unit=config.physicalModel.cmPerUnit;if(!Number.isFinite(unit)||unit<=0||unit>1e9)throw new Error('模型单位无效');physicalModel.cmPerUnit=unit;physicalModel.calibrated=!!config.physicalModel.calibrated;updateModelDimensions();}
 for(const data of config.materials||[]){const entry=entries[data.id];if(!entry)continue;entry.physical=readPhysical(data.physical,true);entry.repeat=data.repeat||[1,1];for(const[key]of MAPS){const map=data.maps?.[key];if(map===null)removeTexture(entry,key);else if(map?.path){if(!archive[map.path])throw new Error('项目缺少贴图 '+map.name);await uploadTexture(entry,key,new File([archive[map.path]],map.name,{type:map.type}),true);}}
 entry.name=String(data.name);entry.material.name=entry.name;entry.material.color.set('#'+data.color);entry.material.roughness=data.roughness;entry.material.metalness=data.metalness;entry.material.normalScale.set(data.normalStrength,data.normalStrength*(data.flip?-1:1));entry.material.aoMapIntensity=data.aoStrength;entry.material.emissive.set('#'+data.emissive);entry.material.emissiveIntensity=data.emissiveStrength;entry.material.bumpScale=data.bumpStrength;entry.flip=!!data.flip;entry.repeat=data.repeat||[1,1];for(const[key]of MAPS)if(entry.material[key]&&(entry.uploads[key]||entry.physical.mode==='legacy')){if(entry.material[key]===entry.baseline[key])entry.material[key]=entry.material[key].clone();configureTexture(entry,entry.material[key],key);}
 }
 restoreAssignments(model,entries,config.assignments);
 const restored={...DEFAULTS};for(const[k,v]of Object.entries(DEFAULTS))if(typeof config.scene?.[k]===typeof v)restored[k]=config.scene[k];state=restored;applyScene();if(config.camera?.position?.length===3&&config.camera?.target?.length===3){camera.position.fromArray(config.camera.position);controls.target.fromArray(config.camera.target);controls.update();}selectEntry(entries[config.selected]||entries[0]);
 }});
 }catch(e){console.error(e);hideBusy();notify('打开项目失败：'+e.message,7000);}
}
try{init();}catch(e){console.error(e);$('loadingTitle').textContent='无法初始化 3D 渲染';$('loadingDetail').textContent='请使用支持 WebGL 2 的 Edge / Chrome，并启用浏览器硬件加速。';}


