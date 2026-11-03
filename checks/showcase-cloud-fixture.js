import { client as projectClient } from './project-cloud-fixture.js';
async function request(route, input) {
  const response = await fetch('/__showcase_browser/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  return response.json();
}
export const client = {
  from(table) {
    if (!/spenic_showcase|spenic_project_comments|spenic_album_photos/.test(table)) return projectClient.from(table);
    const filters = {}, query = {}; let operation = 'select';
    return {
      select(fields) { query.fields = fields; return this; }, eq(k, v) { filters[k] = v; return this; }, order() { return this; },
      range(start, end) { query.start = start; query.end = end; return this; }, maybeSingle() { query.single = true; return this; }, single() { query.single = true; return this; },
      delete() { operation = 'delete'; return this; }, insert(row) { operation = 'insert'; query.row = row; return this; },
      then(resolve, reject) { return request('query', { table, filters, query, operation }).then(resolve, reject); },
    };
  },
  rpc(name, args) { return name.startsWith('spenic_save_project') ? projectClient.rpc(name, args) : request('rpc', { name, args }); },
  storage: { from(bucket) {
    if (bucket !== 'spenic-album-photos') return projectClient.storage.from(bucket);
    return {
      async upload(path, file) { const response = await fetch('/__showcase_browser/object/' + path, { method: 'PUT', body: file }); return response.json(); },
      async download(path) { const response = await fetch('/__showcase_browser/object/' + path); return { data: await response.blob() }; },
      async createSignedUrls(paths) { return { data: paths.map(path => ({ path, signedUrl: '/__showcase_browser/object/' + path })) }; },
      async remove() { return { data: [] }; },
    };
  } },
};
