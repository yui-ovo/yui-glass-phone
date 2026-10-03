// Observe only the extension manager's close action; leave host save/close handling intact.
export function installUpdateRefresh({ document: doc = document, fetch: fetchFile = window.fetch.bind(window), reload = () => window.location.reload(), version, manifestUrl }) {
  const watched = new WeakSet();
  let checking = false;
  let reloading = false;
  async function checkAfterClose(dialog) {
    if (dialog.open || checking || reloading) return;
    checking = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const url = new URL(manifestUrl);
      url.searchParams.set('check', String(Date.now()));
      const response = await fetchFile(url.href, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) return;
      const manifest = await response.json();
      if (manifest.homePage !== 'https://github.com/yui-ovo/yui-glass-phone' || typeof manifest.version !== 'string') return;
      if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || manifest.version === version || dialog.open) return;
      reloading = true;
      reload();
    } catch {
      // Offline, deleted, or failed updates must not trigger a reload.
    } finally {
      clearTimeout(timeout);
      checking = false;
    }
  }
  function onClick(event) {
    const button = event.target.closest?.('.popup-button-ok');
    const dialog = button?.closest('dialog.popup');
    if (!dialog?.querySelector('.extensions_info') || watched.has(dialog)) return;
    watched.add(dialog);
    dialog.addEventListener('close', () => {
      // Host onClosing has already finished saving before the native close event.
      setTimeout(() => { void checkAfterClose(dialog); }, 0);
    });
  }
  doc.addEventListener('click', onClick, true);
  return () => doc.removeEventListener('click', onClick, true);
}
