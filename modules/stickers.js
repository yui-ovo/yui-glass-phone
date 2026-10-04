// Owned browser assets, scoped to the current host account. Never touches StickerDB.
export const STICKER_DB = 'yui-glass-phone.assets.v1';
const MAX_FILE = 2 * 1024 * 1024, MAX_TOTAL = 20 * 1024 * 1024, MAX_ASSETS = 120;
const MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const checkSignal = signal => { if (signal?.aborted) throw Error('图片操作已取消'); };
export async function readSticker(blob, win, signal) {
  checkSignal(signal);
  if (!MIME.includes(blob.type) || !blob.size || blob.size > MAX_FILE) throw Error('请选择 2 MB 内的 PNG、JPEG、WebP 或 GIF 图片');
  const data = await new Promise((resolve, reject) => { const reader = new win.FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error('图片读取失败')); reader.readAsDataURL(blob); });
  checkSignal(signal);
  await new Promise((resolve, reject) => {
    const img = new win.Image(), timer = setTimeout(() => done(Error('图片解码超时')), 10000);
    const abort = () => done(Error('图片操作已取消'));
    function done(error) { clearTimeout(timer); signal?.removeEventListener('abort', abort); img.onload = img.onerror = null; img.src = ''; error ? reject(error) : resolve(); }
    img.onload = () => done(!img.naturalWidth || img.naturalWidth > 4096 || img.naturalHeight > 4096 ? Error('图片长宽不能超过 4096 像素') : null);
    img.onerror = () => done(Error('图片无法解码')); signal?.addEventListener('abort', abort, { once: true }); img.src = data;
  });
  checkSignal(signal); return data;
}
export async function fetchSticker(address, win, signal) {
  let url; try { url = new URL(address); } catch { throw Error('请输入完整图片链接'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('图片链接仅支持 HTTP(S)，不能包含账号密码');
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  const timer = setTimeout(abort, 15000);
  try {
    const response = await win.fetch(url.href, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store' });
    if (!response.ok) throw Error('图片链接读取失败');
    const type = (response.headers.get('content-type') || '').split(';')[0].trim();
    if (!MIME.includes(type) || Number(response.headers.get('content-length')) > MAX_FILE || !response.body?.getReader) throw Error('链接不是支持的图片或文件超过 2 MB');
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_FILE) throw Error('图片超过 2 MB'); chunks.push(value); } }
    finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    return await readSticker(new win.Blob(chunks, { type }), win, controller.signal);
  } catch (e) { if (controller.signal.aborted) throw Error('图片读取已取消或超时'); throw e; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
function validAsset(item, account) {
  if (!item || item.version !== 1 || item.account !== account || typeof item.id !== 'string' || !item.id || item.id.length > 128 || item.key !== `${account}:${item.id}` || typeof item.description !== 'string' || !item.description.trim() || item.description.length > 256 || typeof item.category !== 'string' || item.category.length > 40 || typeof item.allowedAI !== 'boolean' || typeof item.hidden !== 'boolean' || typeof item.data !== 'string' || !/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(item.data) || item.data.length > MAX_FILE * 1.4) throw Error('表情包库格式无法读取，已停止修改');
  return item;
}
export function createStickerLibrary(win, account) {
  async function database() {
    if (!win.indexedDB) throw Error('当前环境无法保存表情包素材');
    return new Promise((resolve, reject) => { const req = win.indexedDB.open(STICKER_DB, 1);
      req.onupgradeneeded = () => { const store = req.result.createObjectStore('assets', { keyPath: 'key' }); store.createIndex('account', 'account'); };
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(Error('表情包库打开失败')); req.onblocked = () => reject(Error('请关闭其他旧手机窗口后重试'));
    });
  }
  async function transaction(mode, run, signal) {
    checkSignal(signal); const db = await database();
    try { checkSignal(signal); return await new Promise((resolve, reject) => {
      const tx = db.transaction('assets', mode); let value, error;
      const abort = () => { try { tx.abort(); } catch {} }; signal?.addEventListener('abort', abort, { once: true });
      const clean = () => signal?.removeEventListener('abort', abort);
      tx.oncomplete = () => { clean(); resolve(value); }; tx.onabort = tx.onerror = () => { clean(); reject(error || Error('素材保存未完成，请检查本机容量并重试')); };
      try { run(tx.objectStore('assets'), result => { value = result; }, failure => { error = failure; abort(); }); } catch (e) { error = e; abort(); }
    }); } finally { db.close(); }
  }
  const list = () => transaction('readonly', (store, done, fail) => { const r = store.index('account').getAll(account); r.onsuccess = () => { try { done(r.result.map(a => validAsset(a, account))); } catch (e) { fail(e); } }; });
  return {
    list,
    async get(id) { const items = await list(); return items.find(a => a.id === id); },
    async addBatch(items, signal) {
      if (!items.length || items.length > 12) throw Error('每批请选择 1–12 张图片');
      const assets = items.map(item => { const id = crypto.randomUUID(); return validAsset({ ...item, id, key: `${account}:${id}`, account, version: 1, hidden: false }, account); });
      return transaction('readwrite', (store, done, fail) => { const r = store.index('account').getAll(account); r.onsuccess = () => { try {
        const old = r.result.map(a => validAsset(a, account));
        if (old.length + assets.length > MAX_ASSETS || [...old, ...assets].reduce((n, a) => n + a.data.length, 0) > MAX_TOTAL) throw Error('素材库已达 120 张或 20 MB 上限，未删除历史图片');
        for (const asset of assets) store.add(asset); done(assets);
      } catch (e) { fail(e); } }; }, signal);
    },
    update(id, patch, signal) { return transaction('readwrite', (store, done, fail) => { const r = store.get(`${account}:${id}`); r.onsuccess = () => { try {
      const item = validAsset(r.result, account), next = validAsset({ ...item, description: patch.description ?? item.description, category: patch.category ?? item.category, allowedAI: patch.allowedAI ?? item.allowedAI, hidden: patch.hidden ?? item.hidden }, account);
      store.put(next); done(next);
    } catch (e) { fail(e); } }; }, signal); },
  };
}
