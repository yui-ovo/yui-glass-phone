import { forPerson, MAX_TEXT } from './messages.js';

// Gray glass cv2 markup comes from the user's original regex/chat skin.
// Every name and message is a text node, never executable regex output/HTML.
export function mountConversation({ wrap, scroll, person, self, messenger, el, button, avatar, icon }) {
  scroll.classList.add('chat-scroll', 'real-messages');
  const hint = el('p', 'message-local-note', '消息保存在本机，AI 回复尚未接入');
  const feedback = el('p', 'message-feedback'); feedback.setAttribute('role', 'status');
  const composer = el('div', 'composer text-composer'), input = el('textarea'); input.rows = 1;
  input.placeholder = '⟡小如思念送達中······ ♡⟡'; input.setAttribute('aria-label', '消息输入框');
  input.title = `每条最多 ${MAX_TEXT} 个字符；Enter 换行，点击箭头发送。消息保存在本机，AI 回复尚未接入`;
  const count = el('span', 'message-count');
  let composing = false, active = true;
  const extra = button('', () => { feedback.textContent = '目前支持文字消息，附件还未接入'; }, 'composer-button');
  extra.setAttribute('aria-label', '添加附件');
  extra.append(el('span', 'sp-fake-input-left-cv2'));
  const send = button('', () => { if (composing) return; try { messenger.submit(person.id); } catch (e) { feedback.textContent = e.message; } }, 'composer-button send-button');
  send.setAttribute('aria-label', '发送'); send.append(el('span', 'sp-fake-input-right-cv2'));
  function resizeInput() {
    if (!active || !input.isConnected) return;
    const top = input.scrollTop;
    input.style.height = '0px';
    input.style.height = `${Math.max(22, input.scrollHeight)}px`;
    input.scrollTop = top;
  }
  function controls() {
    const state = messenger.draft(person.id), size = [...state.text].length;
    const status = messenger.status();
    send.disabled = composing || !state.text.trim() || size > MAX_TEXT || !!state.operation || !messenger.history() || status.reading;
    count.textContent = `${size} / ${MAX_TEXT}`;
    count.hidden = size < MAX_TEXT * .9 || size > MAX_TEXT;
    if (size > MAX_TEXT) feedback.textContent = `每条消息最多 ${MAX_TEXT} 个字符，请缩短后发送`;
    resizeInput();
  }
  input.addEventListener('input', () => { messenger.input(person.id, input.value); feedback.textContent = ''; controls(); });
  input.addEventListener('compositionstart', () => { composing = true; messenger.input(person.id, input.value); controls(); });
  input.addEventListener('compositionend', () => { composing = false; messenger.input(person.id, input.value); controls(); });
  // No Enter handler: native textarea behavior preserves newline/IME composition.
  composer.append(extra, input, send); wrap.append(hint, count, feedback, composer);
  const observer = new ResizeObserver(resizeInput); observer.observe(wrap);
  function bubble(message, pending) {
    const row = el('div', 'sp-message-cv2 self'), main = el('div', 'sp-message-main-cv2 self');
    row.dataset.messageId = message.messageId; if (pending) row.classList.add('pending-message');
    const line = el('div', 'sp-message-row-cv2 self'), text = el('div', 'sp-message-bubble-cv2 self', message.text);
    line.append(text); main.append(el('div', 'sp-message-sender-cv2 self', self.name), line);
    const time = el('time', 'message-saved-time', pending ? '尚未确认保存' : new Date(message.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
    time.title = '设备记录时间，不代表剧情时间'; time.dateTime = message.createdAt; main.append(time);
    row.append(main, avatar(self)); return row;
  }
  function paint() {
    if (!active) return;
    const history = messenger.history(), state = messenger.draft(person.id), status = messenger.status();
    scroll.replaceChildren();
    if (history) {
      const messages = forPerson(history, person.id);
      if (!messages.length) scroll.append(el('p', 'directory-empty', '暂无消息'));
      for (const message of messages) scroll.append(bubble(message));
    }
    if (status.error) {
      scroll.append(el('p', 'profile-help', status.error), button('重新读取消息', () => { void messenger.refresh(); }));
    }
    const op = state.operation;
    if (op) {
      if (!history?.messages.some(m => m.messageId === op.message.messageId)) scroll.append(bubble(op.message, true));
      const panel = el('div', 'message-pending-status'); panel.append(el('p', 'profile-help', op.busy ? '正在保存…' : op.error));
      if (!op.busy) panel.append(button('核对并重试', () => { void messenger.retry(person.id); }), button('重新读取消息', () => { void messenger.refresh(); }));
      scroll.append(panel);
    }
    // Version counter in the controller decides whether submitted input may be cleared.
    if (input.value !== state.text) input.value = state.text;
    controls(); scroll.scrollTop = scroll.scrollHeight;
    queueMicrotask(() => { if (active && scroll.isConnected) scroll.scrollTop = scroll.scrollHeight; });
  }
  const unsubscribe = messenger.subscribe(paint); paint();
  return () => { active = false; observer.disconnect(); unsubscribe(); };
}
