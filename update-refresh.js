// Observe only the extension manager's close action; leave host save/close handling intact.
export function installUpdateRefresh({ document: doc = document, fetch: fetchFile = window.fetch.bind(window), reload = () => window.location.reload(), version, manifestUrl, canReload = () => true, onDeferred = () => {} }) {
  const watched = new Map(), timers = new Set();
  let dead = false, pending;
  let checking = false;
  let reloading = false;
  async function checkAfterClose(dialog) {
    if (dead || dialog.open || checking || reloading) return;
    checking = true;
    const controller = new AbortController();
    pending = controller;
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const url = new URL(manifestUrl);
      url.searchParams.set('check', String(Date.now()));
      const response = await fetchFile(url.href, { cache: 'no-store', signal: controller.signal });
      if (!response.ok || dead) return;
      const manifest = await response.json();
      if (dead || manifest.homePage !== 'https://github.com/yui-ovo/yui-glass-phone' || typeof manifest.version !== 'string') return;
      if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || manifest.version === version || dialog.open) return;
      if (!canReload()) { onDeferred(); return; }
      reloading = true;
      reload();
    } catch {
      // Offline, deleted, or failed updates must not trigger a reload.
    } finally {
      clearTimeout(timeout);
      checking = false;
      pending = undefined;
    }
  }
  function onClick(event) {
    const button = event.target.closest?.('.popup-button-ok');
    const dialog = button?.closest('dialog.popup');
    if (!dialog?.querySelector('.extensions_info') || watched.has(dialog)) return;
    const closed = () => {
      // Host onClosing has already finished saving before the native close event.
      const timer = setTimeout(() => { timers.delete(timer); void checkAfterClose(dialog); }, 0); timers.add(timer);
    };
    watched.set(dialog, closed); dialog.addEventListener('close', closed);
  }
  doc.addEventListener('click', onClick, true);
  return () => { dead = true; pending?.abort(); doc.removeEventListener('click', onClick, true); for (const [dialog, fn] of watched) dialog.removeEventListener('close', fn); watched.clear(); for (const timer of timers) clearTimeout(timer); timers.clear(); };
}
