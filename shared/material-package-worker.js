import { unpackMaterial } from './material-package.js';
self.onmessage = async ({ data: file }) => {
  try { self.postMessage({ asset: await unpackMaterial(file) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
