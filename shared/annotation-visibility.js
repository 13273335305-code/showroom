import { BufferGeometry, Mesh, Raycaster, Vector3 } from '../vendor/three/build/three.module.js';
import { acceleratedRaycast, computeBoundsTree } from '../vendor/three-mesh-bvh/index.module.js';

const geometries = new WeakMap(), proxies = new WeakMap();
// BVH sorts triangle indices within each material group. Give it a private
// index buffer while sharing vertex attributes; rendering and decals stay intact.
export function prepareAnnotationPicking(model) {
  model.traverse(mesh => {
    if (!mesh.isMesh || mesh.isSkinnedMesh || Object.keys(mesh.geometry.morphAttributes).length) return;
    const geometry = mesh.geometry;
    if (!geometries.has(geometry)) {
      const proxy = new BufferGeometry();
      proxy.attributes = { ...geometry.attributes };
      proxy.index = geometry.index?.clone() || null;
      proxy.groups = geometry.groups.map(group => ({ ...group }));
      proxy.drawRange = { ...geometry.drawRange };
      computeBoundsTree.call(proxy);
      geometries.set(geometry, proxy);
      geometry.addEventListener('dispose', () => { proxy.boundsTree = null; proxy.dispose(); geometries.delete(geometry); });
    }
    const proxy = new Mesh(geometries.get(geometry), mesh.material);
    proxy.matrixAutoUpdate = false; proxy.raycast = acceleratedRaycast;
    proxies.set(mesh, proxy);
  });
}

export class AnnotationOcclusion {
  constructor() {
    this.ray = new Raycaster();
    this.direction = new Vector3();
    this.hits = [];
  }
  isOccluded(point, camera, meshes) {
    this.direction.copy(point).sub(camera.position);
    const distance = this.direction.length();
    this.ray.set(camera.position, this.direction.normalize());
    this.ray.far = distance - Math.max(.003, distance * .0003);
    this.hits.length = 0;
    // Keep all hits per mesh: an invisible material slot must not hide a
    // visible occluder behind it in another slot of the same mesh.
    for (const mesh of meshes) {
      const proxy = proxies.get(mesh) || mesh;
      if (proxy !== mesh) { proxy.material = mesh.material; proxy.matrixWorld.copy(mesh.matrixWorld); }
      this.ray.intersectObject(proxy, false, this.hits);
    }
    return this.hits.some(hit => {
      const material = Array.isArray(hit.object.material) ? hit.object.material[hit.face.materialIndex] : hit.object.material;
      return material?.visible;
    });
  }
}
