export function albumPhotoName(modelName, captured = new Date()) {
  const model = String(modelName || '').trim().replace(/\.(?:fbx|glb|gltf|spmodel)$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '') || '模型';
  const date = [captured.getFullYear(), String(captured.getMonth() + 1).padStart(2, '0'), String(captured.getDate()).padStart(2, '0')].join('');
  return model.slice(0, 171) + '-' + date;
}

export function albumPhotoTitle(name) {
  return String(name || '').replace(/\.png$/i, '');
}

export function albumDownloadName(name) {
  return albumPhotoTitle(name) + '.png';
}

export function albumPhotoBadge(photo) {
  const source = photo.source || (/^AI-\d{4}-\d{2}-\d{2}-\d{6}-\d{3}(?:-[\w.-]+)?(?:\.png)?$/i.test(photo.name || '') ? 'ai' : 'capture');
  if (source === 'ai') return 'AI';
  return '';
}
