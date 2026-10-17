// Browser-only test transport; production uses workspaceClient from auth.js.
async function request(route, body) {
  const response = await fetch('/__album_test/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, userId: window.albumTestUser }) });
  return response.json();
}
export const client = {
  from(table) {
    const filters = {}, query = {}; let operation = 'select';
    return {
      select(fields) { query.fields = fields; return this; },
      eq(key, value) { filters[key] = value; return this; },
      order() { return this; },
      range(start, end) { query.start = start; query.end = end; return this; },
      maybeSingle() { query.single = true; return this; },
      single() { query.single = true; return this; },
      insert(row) { operation = 'insert'; query.row = row; return this; },
      delete() { operation = 'delete'; return this; },
      then(resolve, reject) { return request('query', { table, filters, query, operation }).then(resolve, reject); },
    };
  },
  storage: { from(bucket) { return {
    async upload(path, file) {
      const response = await fetch('/__album_test/object/' + bucket + '/' + path, { method: 'PUT', headers: { 'Content-Type': file.type, 'X-Test-User': window.albumTestUser }, body: file });
      return response.json();
    },
    async download(path) {
      const response = await fetch('/__album_test/object/' + bucket + '/' + path, { headers: { 'X-Test-User': window.albumTestUser } });
      return response.ok ? { data: await response.blob() } : { error: { message: 'Denied' } };
    },
    createSignedUrls(paths, expires) { return request('sign', { bucket, paths, expires }); },
    remove(paths) { return request('remove', { bucket, paths }); },
  }; } },
};
