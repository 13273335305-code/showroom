import { createProjectCloud } from '../shared/project-cloud.js';
import { retainProjectSources } from '../shared/project-manifest.js';

const userId = '11111111-1111-1111-1111-111111111111';
async function request(route, options = {}) {
  const response = await fetch('/__cloud_test/' + route, options);
  if (!response.ok) throw new Error('Fixture request failed');
  return response;
}
export const client = {
  from(table) {
    const filters = {}; let query = {}, operation = 'select';
    const builder = {
      select(fields) { query.fields = fields; return this; },
      eq(key, value) { filters[key] = value; return this; },
      order() { return this; }, range(start, end) { query.start = start; query.end = end; return this; },
      maybeSingle() { query.single = true; return this; },
      delete() { operation = 'delete'; return this; },
      upsert(row) { query.row = row; operation = 'upsert'; return this; },
      then(resolve, reject) { return request('query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ table, filters, query, operation }) }).then(response => response.json()).then(resolve, reject); },
    }; return builder;
  },
  rpc(name, args) { return request('rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, args, userId }) }).then(response => response.json()); },
  storage: { from() { return {
    async upload(path, file) { await request('objects/' + path, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file }); return { data: { path } }; },
    async download(path) { return { data: await (await request('objects/' + path)).blob() }; },
    async createSignedUrls(paths) { return { data: paths.map(path => ({ path, signedUrl: '/__cloud_test/objects/' + path })) }; },
  }; } },
};
const cloud = createProjectCloud(async () => ({ client, userId }));
export const listProjects = () => cloud.list();
export const getProject = id => cloud.read(id);
export const saveProject = project => { if (project.manifest) retainProjectSources(project.manifest); return cloud.save(project); };
export const deleteProject = id => cloud.remove(id);
export const saveProjectFolder = folder => cloud.save({ ...folder, kind: 'folder' });
export const renameProject = (id, name) => cloud.update(id, { name });
export const moveProject = (id, parentId) => cloud.update(id, { parentId });
export const setProjectVisibility = (id, isPublic) => cloud.visibility(id, isPublic);
export const uploadProjectResource = file => cloud.upload(file);
export const downloadProjectResource = reference => cloud.download(reference);
export const fixtureAccess = async () => ({ client, userId });
