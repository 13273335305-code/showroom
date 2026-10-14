export function gltfCentimetersPerUnit(gltf){
 const sources=[gltf?.userData,gltf?.asset?.extras,gltf?.scene?.userData];
 for(const source of sources){
  if(!source||typeof source!=='object')continue;
  for(const key of ['cmPerUnit','centimetersPerUnit','unitScaleFactor']){const value=Number(source[key]);if(Number.isFinite(value)&&value>0)return value;}
  const meters=Number(source.metersPerUnit);if(Number.isFinite(meters)&&meters>0)return meters*100;
  const unit=String(source.unit||source.units||'').toLowerCase();if(/^(cm|centimeter|centimeters)$/.test(unit))return 1;if(/^(m|meter|meters)$/.test(unit))return 100;if(/^(mm|millimeter|millimeters)$/.test(unit))return .1;
 }
 return null;
}
