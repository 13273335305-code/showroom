const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

exports.installProjectFixture = async context => {
  const projects = new Map(), resources = new Map(), objects = new Map();
  await context.route('**/shared/project-store.js', async route => route.fulfill({ status: 200, contentType: 'text/javascript', body: await fs.readFile(path.join(__dirname, 'project-cloud-fixture.js'), 'utf8') }));
  await context.route('**/__cloud_test/**', async route => {
    const request = route.request(), pathname = new URL(request.url()).pathname.slice('/__cloud_test/'.length);
    if (pathname.startsWith('objects/')) {
      const key = decodeURIComponent(pathname.slice('objects/'.length));
      if (request.method() === 'PUT') { const body = request.postDataBuffer(); objects.set(key, { body, type: request.headers()['content-type'] }); await route.fulfill({ json: { data: { path: key } } }); }
      else { const object = objects.get(key); if (!object) return route.fulfill({ status: 404 }); await route.fulfill({ body: object.body, contentType: object.type || 'application/octet-stream' }); }
      return;
    }
    const payload = request.postDataJSON(), collection = payload.table === 'spenic_projects' ? projects : resources;
    if (pathname === 'query') {
      if (payload.operation === 'upsert') { collection.set(payload.query.row.hash, payload.query.row); return route.fulfill({ json: { data: null } }); }
      const rows = [...collection.values()].filter(row => Object.entries(payload.filters).every(([key, value]) => row[key] === value));
      if (payload.operation === 'delete') rows.forEach(row => collection.delete(row.id));
      const data = payload.query.single ? rows[0] || null : rows.slice(payload.query.start || 0, (payload.query.end ?? 199) + 1);
      return route.fulfill({ json: { data } });
    }
    if (pathname === 'rpc') {
      if (payload.name === 'spenic_set_project_visibility') {
        const row = projects.get(payload.args.project_id);
        if (!row) return route.fulfill({ json: { error: { code: '42501', message: 'Project owner required' } } });
        row.visibility = payload.args.make_public ? 'public' : 'personal';
        return route.fulfill({ json: { data: null } });
      }
      const row = payload.args.project_data, old = projects.get(row.id);
      if (old && payload.args.expected_revision !== old.updated_at) return route.fulfill({ json: { error: { code: '40001', message: 'Project changed' } } });
      const next = { ...row, owner_id: payload.userId, created_at: old?.created_at || new Date().toISOString(), updated_at: new Date(Date.now() + projects.size).toISOString() };
      projects.set(row.id, next);
      return route.fulfill({ json: { data: next } });
    }
    await route.fulfill({ status: 404 });
  });
  return { projects, resources, objects };
};
