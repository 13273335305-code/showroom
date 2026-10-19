// A replacement applies to the hit mesh's material slot, not every mesh
// that happens to share its previous material.
export function slotMaterial(mesh, slot = 0) {
  return Array.isArray(mesh.material) ? mesh.material[slot] : mesh.material;
}

export function assignMaterial(mesh, slot, material) {
  if (!mesh?.isMesh || !material?.isMaterial) return false;
  if (Array.isArray(mesh.material)) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= mesh.material.length) return false;
    mesh.material = mesh.material.slice();
    mesh.material[slot] = material;
  } else {
    if (slot !== 0) return false;
    mesh.material = material;
  }
  return true;
}

function meshesIn(model) {
  const meshes = [];
  model.traverse(object => { if (object.isMesh) meshes.push(object); });
  return meshes;
}

// Part types belong to the model's configured slots, even after a user swaps
// the material occupying one of those slots in the design workspace.
export function captureConfiguredMaterialSlots(model, getPartTypes) {
  const configured = new WeakMap();
  for (const mesh of meshesIn(model)) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    configured.set(mesh, materials.map(material => new Set(getPartTypes(material) || [])));
  }
  return configured;
}

export function materialSlotsForPartType(model, type, configured, getPartTypes) {
  const result = [];
  for (const mesh of meshesIn(model)) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const originalTypes = configured?.get(mesh);
    materials.forEach((material, slot) => {
      const types = originalTypes?.[slot] ?? getPartTypes(material);
      if (types?.has(type)) result.push({ mesh, slot, material });
    });
  }
  return result;
}

export function rebuildMaterialUsage(model, entries) {
  const owners = new Map(entries.map(entry => [entry.material, entry]));
  entries.forEach(entry => entry.meshes.clear());
  for (const mesh of meshesIn(model)) {
    for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
      owners.get(material)?.meshes.add(mesh);
    }
  }
}

export function serializeAssignments(model, entries) {
  const ids = new Map(entries.map(entry => [entry.material, entry.id]));
  return meshesIn(model).map(mesh =>
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => ids.get(material))
  );
}

export function restoreAssignments(model, entries, assignments) {
  if (assignments === undefined) return; // Projects made before drag-and-drop.
  const meshes = meshesIn(model);
  const materials = new Map(entries.map(entry => [entry.id, entry.material]));
  if (!Array.isArray(assignments) || assignments.length !== meshes.length) throw new Error('模型材质分配不匹配');
  // Validate the complete assignment before changing any mesh.
  assignments.forEach((slots, i) => {
    const count = Array.isArray(meshes[i].material) ? meshes[i].material.length : 1;
    if (!Array.isArray(slots) || slots.length !== count || slots.some(id => !Number.isInteger(id) || !materials.has(id))) {
      throw new Error('项目包含无效的材质槽');
    }
  });
  assignments.forEach((slots, i) => slots.forEach((id, slot) => assignMaterial(meshes[i], slot, materials.get(id))));
  rebuildMaterialUsage(model, entries);
}
