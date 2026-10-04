// The phone's own island; no host status bar or native iOS APIs.
export function createReplyIsland(button, notify) {
  let stop, error = '', seen = '', timer;
  function paint() {
    button.classList.toggle('is-generating', !!stop); button.classList.toggle('has-error', !!error && !stop);
    button.disabled = !stop && !error;
    button.setAttribute('aria-label', stop ? '灵动岛：停止回复' : error ? '灵动岛：查看回复提示' : '灵动岛');
    button.title = stop ? '点击停止本次回复' : error ? '点击查看回复提示' : '';
  }
  const click = () => { if (stop) stop(); else if (error) notify(error); };
  button.addEventListener('click', click); paint();
  return {
    update(cancel, message = '') {
      stop = cancel; clearTimeout(timer);
      if (cancel || !message || message === '已停止回复') { error = ''; if (cancel || !message) seen = ''; }
      else { error = message; if (seen !== message) { seen = message; notify(message); } timer = setTimeout(() => { error = ''; paint(); }, 8000); }
      paint();
    },
    dispose() { clearTimeout(timer); button.removeEventListener('click', click); },
  };
}
