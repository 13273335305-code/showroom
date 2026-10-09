import { createProjectCloud } from './project-cloud.js';
import { validateProjectManifest, retainProjectSources } from './project-manifest.js';

const cloud = createProjectCloud(async () => (await import('./auth.js')).workspaceClient());
export const listProjects = () => cloud.list();
export const getProject = id => cloud.read(id);
export const deleteProject = id => cloud.remove(id);
export const uploadProjectResource = file => cloud.upload(file);
export const downloadProjectResource = reference => cloud.download(reference);
export async function saveProject(project) {
  if (project.manifest) {
    // Preserve original cloud maps as well as runtime maps for saved designs.
    validateProjectManifest(retainProjectSources(project.manifest));
  }
  return cloud.save(project);
}
export const saveProjectFolder = folder => cloud.save({ ...folder, kind: 'folder' });
export const renameProject = (id, name) => cloud.update(id, { name });
export const moveProject = (id, parentId) => cloud.update(id, { parentId: parentId || null });
export const setProjectVisibility = (id, isPublic) => cloud.visibility(id, isPublic);
