// Read density from file bytes, never browser-assumed 96 DPI or CSS dimensions.
export function readImageDensity(buffer) {
 const v=new DataView(buffer),n=v.byteLength;
 const text=(p,len)=>{let s='';for(let i=0;i<len&&p+i<n;i++)s+=String.fromCharCode(v.getUint8(p+i));return s;};
 const valid=(x,y,source)=>Number.isFinite(x)&&Number.isFinite(y)&&x>0&&y>0?{dpiX:x,dpiY:y,source}:null;
 function exif(start,end){
  try{
   if(text(start,6)==='Exif\0\0')start+=6;
   const le=text(start,2)==='II';if(!le&&text(start,2)!=='MM')return null;
   const u16=p=>{if(p<start||p+2>end)throw Error();return v.getUint16(p,le);};
   const u32=p=>{if(p<start||p+4>end)throw Error();return v.getUint32(p,le);};
   if(u16(start+2)!==42)return null;const ifd=start+u32(start+4),count=u16(ifd);let x,y,unit=2,orientation=1;
   for(let i=0;i<count;i++){const p=ifd+2+i*12;if(p+12>end)break;const tag=u16(p),type=u16(p+2);if(u32(p+4)!==1)continue;
    if((tag===282||tag===283)&&type===5){const q=start+u32(p+8),d=u32(q+4),r=d?u32(q)/d:NaN;if(tag===282)x=r;else y=r;}
    if(tag===296&&type===3)unit=u16(p+8);if(tag===274&&type===3)orientation=u16(p+8);
   }
   const r=unit===2?valid(x,y,'EXIF / inch'):unit===3?valid(x*2.54,y*2.54,'EXIF / cm'):null;
   return r?{...r,orientation}:null;
  }catch{return null;}
 }
 try{
  if(n>=24&&v.getUint32(0)===0x89504e47&&v.getUint32(4)===0x0d0a1a0a){
   let density=null,ex=null;const width=v.getUint32(16),height=v.getUint32(20);
   for(let p=8;p+12<=n;){const len=v.getUint32(p),end=p+12+len;if(end>n)break;const type=text(p+4,4);
    if(type==='pHYs'&&len===9&&v.getUint8(p+16)===1)density=valid(v.getUint32(p+8)*.0254,v.getUint32(p+12)*.0254,'PNG pHYs');
    if(type==='eXIf')ex=exif(p+8,p+8+len);if(type==='IEND')break;p=end;
   }
   return {width,height,...(density||ex||{}),format:'PNG'};
  }
  if(n>=4&&v.getUint16(0)===0xffd8){
   let p=2,jfif=null,ex=null,width,height;
   while(p+4<=n){if(v.getUint8(p++)!==255)break;while(p<n&&v.getUint8(p)===255)p++;const marker=v.getUint8(p++);if(marker===0xda||marker===0xd9)break;if(marker===1||(marker>=0xd0&&marker<=0xd7))continue;
    const len=v.getUint16(p),end=p+len;if(len<2||end>n)break;const data=p+2;
    if(marker===0xe0&&len>=16&&text(data,5)==='JFIF\0'){const unit=v.getUint8(data+7),x=v.getUint16(data+8),y=v.getUint16(data+10);jfif=unit===1?valid(x,y,'JPEG JFIF / inch'):unit===2?valid(x*2.54,y*2.54,'JPEG JFIF / cm'):null;}
    if(marker===0xe1&&text(data,6)==='Exif\0\0')ex=exif(data,end)||ex;
    if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&len>=8){height=v.getUint16(data+1);width=v.getUint16(data+3);}
    p=end;
   }
   const density=ex||jfif;return {width,height,...(density||{}),format:'JPEG',conflict:!!(ex&&jfif&&(Math.abs(ex.dpiX-jfif.dpiX)>1||Math.abs(ex.dpiY-jfif.dpiY)>1))};
  }
  if(n>=54&&text(0,2)==='BM'&&v.getUint32(14,true)>=40)return {format:'BMP',width:Math.abs(v.getInt32(18,true)),height:Math.abs(v.getInt32(22,true)),...valid(v.getInt32(38,true)*.0254,v.getInt32(42,true)*.0254,'BMP pixels/m')};
  if(n>=12&&text(0,4)==='RIFF'&&text(8,4)==='WEBP'){
   for(let p=12;p+8<=n;){const len=v.getUint32(p+4,true),end=p+8+len;if(end>n)break;if(text(p,4)==='EXIF')return {format:'WebP',...exif(p+8,end)};p=end+(len%2);}
  }
 }catch{/* Truncated or invalid metadata is not a density value. */}
 return {};
}

export function physicalSizeFromDensity(meta,pixelWidth,pixelHeight,override=null){
 let dpiX=meta.dpiX,dpiY=meta.dpiY,source=meta.source;
 if(!(dpiX>0&&dpiY>0)&&override){dpiX=override.x;dpiY=override.y;source='手动指定 DPI（文件未记录）';}
 if(![dpiX,dpiY,pixelWidth,pixelHeight].every(x=>Number.isFinite(x)&&x>0))return null;
 let width=meta.width||pixelWidth,height=meta.height||pixelHeight;
 // Browser decoders apply EXIF orientation. Swap both pixel axes and densities.
 if(meta.orientation>=5&&meta.orientation<=8){[width,height]=[height,width];[dpiX,dpiY]=[dpiY,dpiX];}
 return {widthCm:width/dpiX*2.54,heightCm:height/dpiY*2.54,pixelWidth:width,pixelHeight:height,dpiX,dpiY,source,conflict:!!meta.conflict};
}
