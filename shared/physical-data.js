export const defaultPhysical = () => ({mode:'physical',widthCm:10,heightCm:10,angle:0,locked:true,initialized:false,sizeSource:'dpi',fallbackDpi:null});

export function readPhysical(value, legacy=false) {
  if (!value) return {...defaultPhysical(),mode:legacy?'legacy':'physical'};
  const result={...defaultPhysical(),...value,sizeSource:value.sizeSource||'manual'};
  if (!['dpi','manual'].includes(result.sizeSource)||!['physical','legacy'].includes(result.mode) ||
      ![result.widthCm,result.heightCm].every(n=>Number.isFinite(n)&&n>=.01&&n<=100000) ||
      !Number.isFinite(result.angle) || Math.abs(result.angle)>360) throw new Error('贴图物理尺寸无效');
  result.locked=!!result.locked;result.initialized=!!result.initialized;
  return result;
}
