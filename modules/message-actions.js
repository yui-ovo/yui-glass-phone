import { conversationId } from './messages.js';
import { kindOf } from './rich-messages.js';

const menuIcons = {
  '复制': 'M8 8h12v13H8z M16 8V3H3v13h5',
  '编辑': 'm14 5 5 5 M4 20l5-1L21 7l-5-5L4 14z',
  '引用': 'M9 6H3v7h6V6Zm12 0h-6v7h6V6ZM9 13c0 4-2 6-5 6m17-6c0 4-2 6-5 6',
  '删除': 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
  '多选': 'M9 6h12M9 12h12M9 18h12M2 6l1 1 3-3M2 12l1 1 3-3M2 18l1 1 3-3',
};

// Menus are built from text nodes and stable message IDs. Nothing from a message
// is evaluated as markup, and no selection is shared across conversations.
export function createMessageActions({ wrap, scroll, person, messenger, el, button, repaint }) {
  const doc = wrap.ownerDocument, win = doc.defaultView, life = new AbortController();
  const layer = el('div', 'message-action-layer'), bar = el('div', 'message-selection-bar'); layer.hidden = true; bar.hidden = true;
  wrap.append(bar, layer);
  let selecting = false, selected = new Set(), timer, pointer, suppressUntil = 0, panelKind = '', previousChange = false;
  const currentMessage = id => messenger.history()?.messages.find(m => m.messageId === id && m.conversationId === conversationId(person.id));
  function closeMenu() { if (panelKind === 'menu' || panelKind === 'delete') { layer.hidden = true; layer.replaceChildren(); panelKind = ''; } }
  function stopPress() { clearTimeout(timer); pointer = undefined; }
  function panel(title, kind) {
    panelKind = kind; layer.dataset.kind = kind; layer.replaceChildren(); layer.hidden = false;
    const box = el('section', 'message-action-card'); box.dataset.kind = kind; box.tabIndex = -1; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', title);
    if (kind !== 'menu') box.append(el('h2', '', title));
    layer.append(box);
    queueMicrotask(() => { if (box.isConnected) (box.querySelector('textarea, button:not(:disabled)') || box).focus({preventScroll:true}); }); return box;
  }
  function attempt(work, status) { try { work(); } catch (e) { status.textContent = e.message; } }
  function confirmDelete(ids) {
    const box = panel('删除消息', 'delete'), status = el('p', 'profile-status');
    box.append(el('p', 'profile-help', `确认永久删除这 ${ids.length} 条手机消息？保存后无法恢复，后续手机 AI 不再读取这些原消息；已关联的当前正文补记也会同步删除。千千结已有摘要不会自动清除。`),
      button('确认删除消息', () => attempt(() => { messenger.deleteMessages(person.id, ids); }, status), 'profile-action danger'),
      button('取消删除', closeMenu), status);
  }
  function openMenu(id) {
    if (!currentMessage(id) || messenger.status().change || messenger.draft(person.id).editing) return;
    const box = panel('消息操作', 'menu'), status = el('p', 'profile-status');
    const row = [...scroll.querySelectorAll('[data-message-id]')].find(node => node.dataset.messageId === id);
    const anchor = row?.querySelector('.sp-message-bubble-cv2');
    if (!anchor) { closeMenu(); return; }
    function placeMenu() {
      if (!box.isConnected || layer.firstElementChild !== box) return;
      const bounds = anchor.getBoundingClientRect(), container = wrap.getBoundingClientRect();
      // Work in CSS pixels even when the host scales the phone shell.
      const sx = container.width / wrap.offsetWidth || 1, sy = container.height / wrap.offsetHeight || 1;
      const width = box.offsetWidth, height = box.offsetHeight, gap = 9;
      const top = (bounds.top - container.top) / sy, bottom = (bounds.bottom - container.top) / sy;
      const center = (bounds.left + bounds.width / 2 - container.left) / sx;
      const above = top >= height + gap + 8;
      const left = Math.max(8, Math.min(wrap.clientWidth - width - 8, center - width / 2));
      box.style.left = `${left}px`;
      box.style.top = `${Math.max(8, Math.min(wrap.clientHeight - height - 8, above ? top - height - gap : bottom + gap))}px`;
      box.dataset.side = above ? 'above' : 'below';
      box.style.setProperty('--menu-tip', `${Math.max(16, Math.min(width - 16, center - left))}px`);
    }
    function action(label, handler) {
      const item = button(label, handler, 'message-menu-action');
      const icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'), path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true'); path.setAttribute('d', menuIcons[label]); icon.append(path);
      item.replaceChildren(icon, el('span', '', label)); return item;
    }
    box.append(action('复制', async () => {
      try { const value = currentMessage(id)?.text; if (value === undefined) throw Error(); await win.navigator.clipboard.writeText(value); if (life.signal.aborted || layer.firstElementChild !== box) return; closeMenu(); }
      catch { if (!life.signal.aborted && layer.firstElementChild === box) { status.textContent = '无法复制，可在编辑框中选择文字'; placeMenu(); } }
    }), action('编辑', () => attempt(() => { closeMenu(); messenger.beginEdit(person.id, id); }, status)),
    action('引用', () => attempt(() => { closeMenu(); messenger.quote(person.id, id); wrap.querySelector('.text-composer textarea')?.focus(); }, status)),
    action('删除', () => confirmDelete([id])),
    action('多选', () => { closeMenu(); suppressUntil = 0; selecting = true; selected = new Set([id]); repaint(); }), status);
    if (kindOf(currentMessage(id)) !== 'text') [...box.querySelectorAll('button')].find(b => b.textContent === '编辑')?.remove();
    placeMenu();
  }
  function decorate(row, message) {
    if (!selecting) return;
    row.classList.add('message-selectable'); row.classList.toggle('message-selected', selected.has(message.messageId));
    const check = el('input', 'message-selector'); check.type = 'checkbox'; check.checked = selected.has(message.messageId); check.setAttribute('aria-label', `选择消息：${message.text.slice(0,30)}`);
    check.disabled = !!messenger.status().change; check.dataset.selectMessage = message.messageId; row.prepend(check);
  }
  function paint() {
    // A rerender can move or remove the anchor. Never leave a detached menu behind.
    if (panelKind === 'menu') closeMenu();
    const change = messenger.status().change, own = change?.value.personId === person.id, editing = messenger.draft(person.id).editing;
    if (previousChange && !change) { selected.clear(); selecting = false; panelKind = ''; layer.hidden = true; layer.replaceChildren(); }
    previousChange = own;
    selected = new Set([...selected].filter(currentMessage)); bar.hidden = !selecting; bar.replaceChildren();
    if (selecting) {
      bar.append(el('span', '', `已选 ${selected.size} 条`), button('全选当前显示', () => { selected = new Set([...scroll.querySelectorAll('[data-message-id]:not(.pending-message)')].map(row=>row.dataset.messageId)); repaint(); }, 'selection-button'),
        button(`删除所选 ${selected.size} 条`, () => { if (selected.size) confirmDelete([...selected]); }, 'selection-button danger'), button('退出多选', () => { selecting = false; selected.clear(); repaint(); }, 'selection-button'));
      for (const b of bar.querySelectorAll('button')) b.disabled = !!change;
    }
    if (own) {
      const box = panel('消息修改', 'saving'); box.append(el('p', 'profile-status', change.busy ? '正在保存修改…' : change.error));
      if (!change.busy) box.append(button('核对并重试修改', () => void messenger.retryChange()), button('结束核对并重新读取', () => { if (win.confirm('结束核对会放弃此处尚未保存的修改，已写入的结果不会撤回。继续？')) void messenger.endChange(); }));
    } else if (editing) {
      if (panelKind === 'edit' && layer.querySelector('textarea')?.dataset.messageId === editing.messageId) return;
      const box = panel('编辑消息', 'edit'), input = el('textarea', 'message-edit-input'), status = el('p', 'profile-status'); input.setAttribute('aria-label', '编辑消息内容'); input.value = editing.text; input.dataset.messageId = editing.messageId; input.rows = 6;
      input.oninput = () => { messenger.editInput(person.id, input.value); status.textContent = ''; };
      box.append(input, status, button('保存消息修改', () => attempt(() => messenger.saveEdit(person.id), status), 'profile-action primary'), button('取消编辑', () => { panelKind = ''; layer.hidden = true; layer.replaceChildren(); messenger.cancelEdit(person.id); }));
    } else if (panelKind === 'edit' || panelKind === 'saving') { panelKind = ''; layer.hidden = true; layer.replaceChildren(); }
  }
  scroll.addEventListener('pointerdown', event => {
    if (selecting || event.button !== 0 || !event.isPrimary) return;
    const bubble = event.target.closest('.sp-message-bubble-cv2'), row = bubble?.closest('[data-message-id]'); if (!row || row.classList.contains('pending-message')) return;
    stopPress(); pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    timer = setTimeout(() => { suppressUntil = Date.now() + 900; openMenu(row.dataset.messageId); pointer = undefined; }, 500);
  }, { signal: life.signal });
  scroll.addEventListener('pointermove', event => { if (pointer && (event.pointerId !== pointer.id || Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>10)) stopPress(); }, { signal: life.signal });
  for (const name of ['pointerup','pointercancel','scroll']) scroll.addEventListener(name, stopPress, { signal: life.signal });
  const dismissPopup = () => { if (panelKind === 'menu') closeMenu(); };
  scroll.addEventListener('scroll', dismissPopup, { signal: life.signal });
  win.addEventListener('resize', dismissPopup, { signal: life.signal });
  win.visualViewport?.addEventListener('resize', dismissPopup, { signal: life.signal });
  win.visualViewport?.addEventListener('scroll', dismissPopup, { signal: life.signal });
  scroll.addEventListener('contextmenu', event => { const row = event.target.closest('[data-message-id]'); if (!row || row.classList.contains('pending-message')) return; event.preventDefault(); stopPress(); if (!selecting) openMenu(row.dataset.messageId); }, { signal: life.signal });
  scroll.addEventListener('click', event => {
    if (Date.now() < suppressUntil) { event.preventDefault(); event.stopPropagation(); return; }
    if (!selecting || messenger.status().change) return;
    const row = event.target.closest('[data-message-id]'); if (!row || !currentMessage(row.dataset.messageId)) return;
    const id = row.dataset.messageId; selected.has(id) ? selected.delete(id) : selected.add(id); repaint();
  }, { signal: life.signal });
  layer.addEventListener('click', event => { if (event.target === layer) closeMenu(); }, { signal: life.signal });
  wrap.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !layer.hidden) { event.preventDefault(); event.stopPropagation(); if (panelKind === 'edit') { messenger.cancelEdit(person.id); } else closeMenu(); }
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { const row = event.target.closest('[data-message-id]'); if (row) { event.preventDefault(); openMenu(row.dataset.messageId); } }
  }, { signal: life.signal });
  return { decorate, paint, canTap: () => !selecting && Date.now() >= suppressUntil && layer.hidden, dispose() { stopPress(); life.abort(); layer.remove(); bar.remove(); } };
}
