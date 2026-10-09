const assert = require('node:assert/strict');
exports.saveOnlineProject = async page => {
  let downloads = 0; const onDownload = () => downloads++; page.on('download', onDownload);
  try {
    await page.locator('#saveProject').click();
    await page.waitForFunction(() => document.getElementById('loading').hidden && document.getElementById('toast').textContent === '已保存到项目库', null, { timeout: 120000 });
    assert.equal(downloads, 0);
    return page.evaluate(async () => {
      const store = await import('./shared/project-store.js');
      const projects = (await store.listProjects()).filter(item => item.kind === 'project').sort((a,b) => b.updatedAt - a.updatedAt);
      return store.getProject(projects[0].id);
    });
  } finally { page.off('download', onDownload); }
};
exports.openOnlineProject = async (page, project) => {
  await page.goto(new URL('design.html?project=' + encodeURIComponent(project.id), page.url()).href);
  await page.waitForFunction(() => document.getElementById('loading').hidden, null, { timeout: 120000 });
};
