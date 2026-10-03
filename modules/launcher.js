// Only the floating button's appearance position is stored here, never chat data.
const KEY = 'yui-glass-phone.launcher.v1';
const SIZE = 44;
const clamp = (n, low, high) => Math.min(Math.max(n, low), Math.max(low, high));

export function installLauncher({ button, open, frame, window: win }) {
  const life = new win.AbortController();
  const on = (target, name, fn, options = {}) => target?.addEventListener(name, fn, { ...options, signal: life.signal });
  let position, gesture, timer, suppressUntil = 0;
  try {
    const saved = JSON.parse(win.localStorage.getItem(KEY));
    if (saved?.version === 1 && [saved.x, saved.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1) && ['left', 'right', null].includes(saved.dock)) position = saved;
  } catch { /* A blocked settings store must not prevent opening the phone. */ }
  function bounds() {
    const f = frame();
    return { left: f.left, top: f.top, width: Math.max(SIZE, f.width), height: Math.max(SIZE, f.height) };
  }
  function paint(x, y, dock) {
    button.style.left = `${x}px`; button.style.top = `${y}px`;
    button.style.right = 'auto'; button.style.bottom = 'auto';
    button.dataset.dock = dock || '';
  }
  function resize() {
    if (gesture) cancel();
    const f = bounds();
    if (!position) position = { version: 1, x: 1, y: clamp((f.height - 154) / Math.max(1, f.height - SIZE), 0, 1), dock: null };
    const x = position.dock === 'left' ? f.left - SIZE / 2 : position.dock === 'right' ? f.left + f.width - SIZE / 2 : f.left + position.x * Math.max(0, f.width - SIZE - 12);
    paint(x, f.top + position.y * (f.height - SIZE), position.dock);
  }
  function release() {
    clearTimeout(timer);
    button.removeAttribute('data-dragging');
    const previous = gesture; gesture = null;
    if (previous && button.hasPointerCapture(previous.id)) button.releasePointerCapture(previous.id);
  }
  function cancel() {
    if (!gesture) return;
    suppressUntil = Date.now() + 700; release(); resize();
  }
  function beginDrag() {
    if (!gesture) return;
    gesture.dragging = true;
    button.setAttribute('data-dragging', '');
  }
  on(button, 'pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || gesture) return;
    suppressUntil = 0;
    const rect = button.getBoundingClientRect();
    gesture = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: rect.x, y: rect.y, dragging: false, moved: false };
    button.setPointerCapture(event.pointerId);
    timer = setTimeout(beginDrag, 350);
  });
  on(button, 'pointermove', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.startX, dy = event.clientY - gesture.startY;
    if (!gesture.dragging && Math.hypot(dx, dy) > 8) {
      clearTimeout(timer); gesture.moved = true;
      if (event.pointerType === 'mouse') beginDrag();
    }
    if (!gesture.dragging) return;
    event.preventDefault();
    const f = bounds();
    paint(clamp(gesture.x + dx, f.left, f.left + f.width - SIZE), clamp(gesture.y + dy, f.top, f.top + f.height - SIZE), null);
  });
  on(button, 'pointerup', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const { dragging, moved } = gesture;
    if (dragging) {
      const f = bounds(), r = button.getBoundingClientRect();
      const dock = r.left <= f.left + 24 ? 'left' : r.right >= f.left + f.width - 24 ? 'right' : null;
      position = { version: 1, x: clamp((r.left - f.left) / Math.max(1, f.width - SIZE - 12), 0, 1), y: clamp((r.top - f.top) / Math.max(1, f.height - SIZE), 0, 1), dock };
      try { win.localStorage.setItem(KEY, JSON.stringify(position)); } catch { /* Keep the position for this session. */ }
    }
    if (dragging || moved) suppressUntil = Date.now() + 700;
    release(); resize();
  });
  on(button, 'pointercancel', cancel);
  on(button, 'lostpointercapture', cancel);
  on(button, 'contextmenu', event => event.preventDefault());
  on(button, 'click', event => {
    if (event.detail && Date.now() < suppressUntil) { event.preventDefault(); event.stopPropagation(); return; }
    open();
  });
  on(win, 'blur', cancel);
  on(win, 'resize', resize);
  on(win.visualViewport, 'resize', resize);
  on(win.visualViewport, 'scroll', resize);
  resize();
  return { resize, dispose() { release(); life.abort(); } };
}
