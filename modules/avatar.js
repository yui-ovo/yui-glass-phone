// Raster validation/re-encoding adapted from yui-pocket readDecoration.
import { validateAvatarUrl } from './contacts.js';
export async function readAvatar(file, document) {
  if (file.size > 2 * 1024 * 1024) throw Error('图片请小于 2 MB');
  const data = new Uint8Array(await file.arrayBuffer());
  const png = data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71;
  const jpeg = data[0] === 255 && data[1] === 216 && data[2] === 255;
  const webp = String.fromCharCode(...data.slice(0, 4)) === 'RIFF' && String.fromCharCode(...data.slice(8, 12)) === 'WEBP';
  if (!png && !jpeg && !webp) throw Error('请选择 PNG、JPEG 或 WebP 图片');
  const url = URL.createObjectURL(file);
  try {
    const image = document.createElement('img'); image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 4096 || image.naturalHeight > 4096) throw Error('图片尺寸请不超过 4096×4096');
    const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d'); if (!ctx) throw Error('当前浏览器无法处理图片');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/webp', .9);
    if (result.length > 380000 || !/^data:image\/(png|jpeg|webp);base64,/.test(result)) throw Error('处理后的图片仍然过大，请换一张较小图片');
    return result;
  } finally { URL.revokeObjectURL(url); }
}
export function loadAvatarUrl(value, document, signal) {
  const url = validateAvatarUrl(value);
  return new Promise((resolve, reject) => {
    const image = document.createElement('img'); image.referrerPolicy = 'no-referrer';
    const finish = (error) => { clearTimeout(timer); signal.removeEventListener('abort', abort); image.onload = image.onerror = null; if (error) { image.removeAttribute('src'); reject(error); } else resolve(url); };
    const abort = () => finish(Error('图片操作已取消'));
    const timer = setTimeout(() => finish(Error('图片加载超时，保留原头像')), 15000);
    image.onload = () => finish(!image.naturalWidth || image.naturalWidth > 4096 || image.naturalHeight > 4096 ? Error('图片尺寸请不超过 4096×4096') : null);
    image.onerror = () => finish(Error('图片加载失败，保留原头像'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort(); else image.src = url;
  });
}
