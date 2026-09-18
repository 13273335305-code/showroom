import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {readImageDensity,physicalSizeFromDensity} from '../image-density.js';
const near=(x,y)=>assert.ok(Math.abs(x-y)<1e-5,`${x} != ${y}`);
const ab=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const png=(x=11811,y=11811,unit=1)=>{const b=Buffer.alloc(66);Buffer.from('89504e470d0a1a0a','hex').copy(b);b.writeUInt32BE(13,8);b.write('IHDR',12);b.writeUInt32BE(3000,16);b.writeUInt32BE(1500,20);b.writeUInt32BE(9,33);b.write('pHYs',37);b.writeUInt32BE(x,41);b.writeUInt32BE(y,45);b[49]=unit;return b;};
let m=readImageDensity(ab(png()));near(m.dpiX,299.9994);let size=physicalSizeFromDensity(m,3000,1500);assert.ok(Math.abs(size.widthCm-25.4)<.0001);assert.ok(Math.abs(size.heightCm-12.7)<.0001);
assert.equal(physicalSizeFromDensity(readImageDensity(ab(png(1,1,0))),3000,1500),null);
assert.equal(physicalSizeFromDensity(readImageDensity(ab(png(0,0))),3000,1500),null);
size=physicalSizeFromDensity({},3000,1500,{x:300,y:150});near(size.widthCm,25.4);near(size.heightCm,25.4);
// JPEG JFIF, with pixels/cm rather than pixels/inch.
const jpeg=Buffer.from([255,216,255,224,0,16,74,70,73,70,0,1,2,2,0,100,0,50,0,0,255,192,0,11,8,5,220,11,184,1,1,17,0,255,217]);
m=readImageDensity(ab(jpeg));near(m.dpiX,254);near(m.dpiY,127);size=physicalSizeFromDensity(m,3000,1500);near(size.widthCm,30);near(size.heightCm,30);
// TIFF EXIF rational density, both byte orders and orientation.
function exif(le){const b=Buffer.alloc(78);b.write(le?'II':'MM');const u16=(v,p)=>le?b.writeUInt16LE(v,p):b.writeUInt16BE(v,p);const u32=(v,p)=>le?b.writeUInt32LE(v,p):b.writeUInt32BE(v,p);u16(42,2);u32(8,4);u16(4,8);[[282,5,62],[283,5,70],[296,3,2],[274,3,6]].forEach(([tag,type,value],i)=>{const p=10+i*12;u16(tag,p);u16(type,p+2);u32(1,p+4);if(type===3)u16(value,p+8);else u32(value,p+8);});u32(300,62);u32(1,66);u32(150,70);u32(1,74);return b;}
for(const le of [true,false]){const e=exif(le),segment=Buffer.alloc(10);segment[0]=255;segment[1]=225;segment.writeUInt16BE(e.length+8,2);segment.write('Exif\0\0',4);const file=Buffer.concat([jpeg.subarray(0,20),segment,e,jpeg.subarray(20)]);m=readImageDensity(ab(file));near(m.dpiX,300);near(m.dpiY,150);assert.equal(m.conflict,true);size=physicalSizeFromDensity(m,1500,3000);near(size.widthCm,25.4);near(size.heightCm,25.4);assert.equal(size.pixelWidth,1500);}
const bmp=Buffer.alloc(54);bmp.write('BM');bmp.writeUInt32LE(40,14);bmp.writeInt32LE(1000,18);bmp.writeInt32LE(-500,22);bmp.writeInt32LE(10000,38);bmp.writeInt32LE(5000,42);m=readImageDensity(ab(bmp));near(m.dpiX,254);near(m.dpiY,127);
const web=Buffer.alloc(20);web.write('RIFF');web.write('WEBP',8);web.write('EXIF',12);web.writeUInt32LE(78,16);near(readImageDensity(ab(Buffer.concat([web,exif(true)]))).dpiX,300);
for(let i=0;i<jpeg.length;i++)assert.doesNotThrow(()=>readImageDensity(ab(jpeg.subarray(0,i))));
assert.equal(physicalSizeFromDensity({},500,500),null);
// Produce a valid browser fixture by inserting a CRC-checked pHYs chunk.
let crc=(buf)=>{let c=0xffffffff;for(const b of buf){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
const base=readFileSync(new URL('./blue-fabric-test.png',import.meta.url));let chunks=[base.subarray(0,33)];for(let p=33;p+12<=base.length;){const len=base.readUInt32BE(p),next=p+len+12;if(base.toString('ascii',p+4,p+8)!=='pHYs')chunks.push(base.subarray(p,next));p=next;}
const phys=Buffer.alloc(21);phys.writeUInt32BE(9);phys.write('pHYs',4);phys.writeUInt32BE(11811,8);phys.writeUInt32BE(11811,12);phys[16]=1;phys.writeUInt32BE(crc(phys.subarray(4,17)),17);chunks.splice(1,0,phys);writeFileSync(new URL('./fabric-300dpi.png',import.meta.url),Buffer.concat(chunks));
console.log('PASS: PNG pHYs, JPEG JFIF/EXIF precedence, both TIFF byte orders, cm units, EXIF rotation, BMP, WebP, missing/zero/truncated data and explicit DPI fallback');
