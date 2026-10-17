import { requireAuth } from '../shared/auth.js';
import { listPhotos, downloadPhoto, removePhoto } from '../shared/album-store.js';
import { downloadFile } from '../shared/navigation.js';
import { albumPhotoTitle, albumDownloadName, albumPhotoBadge } from '../shared/album-name.js';
import { createAlbumDownloadHandler } from '../shared/album-download.js';

await requireAuth({ feature: 'album' });

const $ = id => document.getElementById(id);
const grid = $('albumGrid'), empty = $('albumEmpty'), error = $('albumError');
let loading = false;
let previewUrl = null, previewFile = null, previewRequest = 0;
let previewPhoto = null, previewCard = null, previewDeleting = false;

function showError(message = '') {
  error.hidden = !message;
  error.textContent = message;
  $('albumRetry').hidden = !message;
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
}

function render(photos) {
  grid.replaceChildren();
  empty.hidden = photos.length > 0;
  const cards = document.createDocumentFragment();
  for (const photo of photos) {
    const title = albumPhotoTitle(photo.name);
    const card = document.createElement('article');
    card.className = 'asset-card album-card';
    card.innerHTML = '<button class="album-download album-preview-download" type="button"><span class="album-download-visual album-download-icon" aria-hidden="true"></span><span class="album-download-visual album-download-spinner" aria-hidden="true"></span><svg class="album-download-visual album-download-success" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="13" fill="currentColor"/><path d="m7.5 13 3.5 3.5 7.5-7.5" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="sr-only album-download-status" role="status" aria-live="polite">下载原图</span></button><button type="button" class="asset-art album-preview"><img width="400" height="300" loading="lazy" decoding="async"><span class="album-badge"></span></button><div class="asset-info album-card-body"><div class="album-card-meta"><strong></strong></div></div>';
    const image = card.querySelector('.album-preview img');
    image.alt = title;
    if (photo.thumbnailUrl) image.src = photo.thumbnailUrl;
    const badge = card.querySelector('.album-badge'), label = albumPhotoBadge(photo);
    badge.textContent = label; badge.hidden = !label;
    card.querySelector('.album-card-meta strong').textContent = title;
    card.querySelector('.album-card-meta strong').title = title;
    const preview = card.querySelector('.album-preview');
    const download = card.querySelector('.album-download');
    card.addEventListener('click', () => openPreview(photo, card));
    preview.setAttribute('aria-label', '预览原图：' + title);
    download.addEventListener('click', event => event.stopPropagation());
    download.addEventListener('click', createAlbumDownloadHandler(download, {
      title,
      download: async () => { const file = await downloadPhoto(photo.id); downloadFile(file.blob, albumDownloadName(file.name)); },
      onStart: () => showError(),
      onError: cause => showError(cause.message || '下载失败，请重试'),
    }));
    cards.append(card);
  }
  grid.append(cards);
}

async function openPreview(photo, card = null) {
  const dialog = $('albumPreviewDialog'), image = $('albumOriginalImage'), status = $('albumPreviewStatus'), button = $('albumOriginalDownload');
  if (dialog.open) return;
  const request = ++previewRequest;
  previewPhoto = photo; previewCard = card;
  $('albumPreviewDelete').disabled = false;
  $('albumPreviewError').hidden = true; $('albumPreviewError').textContent = '';
  $('albumPreviewTitle').textContent = albumPhotoTitle(photo.name);
  $('albumPreviewMeta').textContent = photo.width + ' × ' + photo.height + ' px · ' + formatDate(photo.createdAt);
  dialog.showModal(); image.removeAttribute('src'); image.alt = albumPhotoTitle(photo.name); button.disabled = true; status.hidden = false; status.textContent = '正在读取原图…'; $('albumPreviewStage').setAttribute('aria-busy', 'true');
  try {
    const file = await downloadPhoto(photo.id);
    if (!dialog.open || request !== previewRequest) return;
    previewUrl = URL.createObjectURL(file.blob); image.src = previewUrl;
    await image.decode();
    if (!dialog.open || request !== previewRequest) return;
    previewFile = file; status.hidden = true; button.disabled = previewDeleting;
  } catch (cause) {
    if (!dialog.open || request !== previewRequest) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null; image.removeAttribute('src');
    status.textContent = cause.message || '原图读取失败，请关闭后重试';
  } finally { if (request === previewRequest) $('albumPreviewStage').setAttribute('aria-busy', 'false'); }
}

async function deletePreviewPhoto() {
  if (!previewPhoto || previewDeleting || !$('albumPreviewDialog').open) return;
  if (!window.confirm('确定删除这张云端图片吗？')) return;
  const photo = previewPhoto, card = previewCard;
  previewDeleting = true;
  $('albumPreviewDelete').disabled = $('albumOriginalDownload').disabled = $('albumPreviewClose').disabled = true;
  $('albumPreviewDelete').setAttribute('aria-busy', 'true');
  $('albumPreviewDeleteLabel').textContent = '正在删除…';
  $('albumPreviewError').hidden = true;
  try {
    await removePhoto(photo.id);
    card?.remove();
    empty.hidden = grid.childElementCount > 0;
    previewDeleting = false;
    closePreview();
  } catch (cause) {
    $('albumPreviewError').textContent = cause.message || '删除失败，请重试';
    $('albumPreviewError').hidden = false;
  } finally {
    previewDeleting = false;
    $('albumPreviewClose').disabled = false;
    $('albumPreviewDelete').disabled = !previewPhoto;
    $('albumOriginalDownload').disabled = !previewFile;
    $('albumPreviewDelete').setAttribute('aria-busy', 'false');
    $('albumPreviewDeleteLabel').textContent = '删除';
  }
}

function resetPreview() {
  ++previewRequest;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null; previewFile = null; $('albumOriginalImage').removeAttribute('src'); $('albumOriginalDownload').disabled = true;
  previewPhoto = null; previewCard = null; $('albumPreviewDelete').disabled = true;
  $('albumPreviewError').hidden = true;
  $('albumPreviewStage').setAttribute('aria-busy', 'false');
}

function closePreview() {
  if (previewDeleting) return;
  resetPreview();
  if ($('albumPreviewDialog').open) $('albumPreviewDialog').close();
}

async function load() {
  if (loading || $('albumPreviewDialog').open) return;
  loading = true; showError(); empty.hidden = true;
  grid.setAttribute('aria-busy', 'true');
  try { render(await listPhotos()); }
  catch (cause) { grid.replaceChildren(); showError(cause.message || '云端图册暂时无法加载'); }
  finally { loading = false; grid.setAttribute('aria-busy', 'false'); }
}

$('albumRetry').addEventListener('click', load);
$('albumPreviewClose').addEventListener('click', closePreview);
$('albumPreviewDelete').addEventListener('click', deletePreviewPhoto);
$('albumPreviewDialog').addEventListener('cancel', event => { event.preventDefault(); closePreview(); });
$('albumPreviewDialog').addEventListener('click', event => {
  if (event.target !== $('albumPreviewDialog')) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closePreview();
});
$('albumOriginalDownload').addEventListener('click', () => { if (previewFile) downloadFile(previewFile.blob, albumDownloadName(previewFile.name)); });
$('albumPreviewDialog').addEventListener('close', () => { if (!$('albumPreviewDialog').open) resetPreview(); });
load();

