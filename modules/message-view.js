import {historyRange} from './history-range.js';
import {phoneSyncStatus} from './sync-events.js';
import { forPerson, MAX_TEXT, quotedMessage, conversationId } from './messages.js';
import { createMessageActions } from './message-actions.js';
import { createAttachments } from './attachment-view.js';
import { kindOf, summary, money, transferState } from './rich-messages.js';

// Gray glass cv2 markup comes from the user's original regex/chat skin.
// Every name and message is a text node, never executable regex output/HTML.
export function mountConversation({ wrap, scroll, person, self, messenger, el, button, avatar, icon, onReplyState }) {
  scroll.classList.add('chat-scroll', 'real-messages');
  const quoteDraft = el('div', 'message-quote-preview'); quoteDraft.hidden = true;
  const feedback = el('p', 'message-feedback'); feedback.setAttribute('role', 'status');
  const composer = el('div', 'composer text-composer'), input = el('textarea'); input.rows = 1;
  input.placeholder = '⟡小如思念送達中······ ♡⟡'; input.setAttribute('aria-label', '消息输入框');
  input.title = `每条最多 ${MAX_TEXT} 个字符；Enter 换行，点击飞机发送。消息保存在本机`;
  const count = el('span', 'message-count');
  let composing = false, active = true, visibleCount=50, loadingEarlier=false;
  const extra = button('', () => attachments.open(), 'composer-button');
  extra.setAttribute('aria-label', '添加附件');
  extra.append(el('span', 'sp-fake-input-left-cv2'));
  const send = button('', () => {
    if (composing) return;
    try {
      if (messenger.status().generating === person.id) messenger.cancelReply(person.id);
      else if (messenger.draft(person.id).text.trim()) messenger.submit(person.id);
      else if (Date.now() < messenger.draft(person.id).replyAfter) feedback.textContent = '消息已发送，稍后再点飞机让对方回复';
      else void messenger.requestReply(person.id);
    } catch (e) { feedback.textContent = e.message; }
  }, 'composer-button send-button');
  send.innerHTML = icon('send');
  function resizeInput() {
    if (!active || !input.isConnected) return;
    const top = input.scrollTop;
    input.style.height = '0px';
    input.style.height = `${Math.max(22, input.scrollHeight)}px`;
    input.scrollTop = top;
    wrap.style.setProperty('--attachment-bottom', `${composer.offsetHeight + 10}px`);
  }
  function controls() {
    const state = messenger.draft(person.id), size = [...state.text].length;
    const status = messenger.status();
    const generating = status.generating === person.id;
    send.disabled = !generating && (composing || size > MAX_TEXT || !!state.operation || !!status.change || !!state.editing || !messenger.history() || status.reading || !!status.generating);
    const label = generating ? '停止回复' : state.text.trim() ? '发送' : '让对方回复';
    send.innerHTML = icon(generating ? 'stop' : 'send');
    send.setAttribute('aria-label', label); send.title = label; send.classList.toggle('is-generating', generating);
    onReplyState?.(generating ? () => messenger.cancelReply(person.id) : undefined, state.aiError);
    count.textContent = `${size} / ${MAX_TEXT}`;
    count.hidden = size < MAX_TEXT * .9 || size > MAX_TEXT;
    if (size > MAX_TEXT) feedback.textContent = `每条消息最多 ${MAX_TEXT} 个字符，请缩短后发送`;
    resizeInput();
  }
  input.addEventListener('input', () => { messenger.input(person.id, input.value); feedback.textContent = ''; controls(); });
  input.addEventListener('compositionstart', () => { composing = true; messenger.input(person.id, input.value); controls(); });
  input.addEventListener('compositionend', () => { composing = false; messenger.input(person.id, input.value); controls(); });
  // No Enter handler: native textarea behavior preserves newline/IME composition.
  composer.append(extra, input, send); wrap.append(quoteDraft, count, feedback, composer);
  const observer = new ResizeObserver(resizeInput); observer.observe(wrap);
  function bubble(message, pending) {
    const outgoing = message.sender.kind === 'self', suffix = outgoing ? ' self' : '';
    const row = el('div', 'sp-message-cv2' + suffix), main = el('div', 'sp-message-main-cv2' + suffix);
    row.dataset.messageId = message.messageId; if (pending) row.classList.add('pending-message');
    const line = el('div', 'sp-message-row-cv2' + suffix), text = el('div', 'sp-message-bubble-cv2' + suffix, message.text);
    if (kindOf(message) === 'sticker') {
      text.classList.add('sticker-bubble'); text.replaceChildren();
      const img = el('img', 'message-sticker'); img.alt = message.sticker.description; img.loading = 'lazy'; text.append(img);
      const fallback = el('span','sticker-missing',message.sticker.description);text.append(fallback);
      messenger.library().get(message.sticker.assetId).then(asset=>{if(!active||!img.isConnected)return;if(asset){img.onload=()=>fallback.remove();img.onerror=()=>{img.remove();fallback.textContent='图片无法显示 · '+message.sticker.description;};img.src=asset.data;}else{img.remove();fallback.textContent='本机缺少图片 · '+message.sticker.description;}}).catch(()=>{if(active&&img.isConnected){img.remove();fallback.textContent='图片暂不可读取 · '+message.sticker.description;}});
    } else if (kindOf(message) === 'transfer') {
      text.classList.add('transfer-bubble');text.replaceChildren(el('span','transfer-caption','转账'),el('strong','transfer-amount',`¥${money(message.transfer.amountMinor)}`),el('span','transfer-note',message.transfer.note),el('span','transfer-state',transferState(message.transfer.state)));
      if(!pending){text.setAttribute('role','button');text.setAttribute('aria-label',`转账详情：${money(message.transfer.amountMinor)}元，${transferState(message.transfer.state)}`);text.addEventListener('click',()=>{if(actions.canTap())attachments.inspectTransfer(message.messageId);});text.addEventListener('keydown',e=>{if(e.key==='Enter'&&actions.canTap()){e.preventDefault();attachments.inspectTransfer(message.messageId);}});}
    }
    if (!pending) { text.tabIndex = 0; text.title = '长按或右键打开消息菜单'; }
    line.append(text); main.append(line);
    if (message.replyTo) {
      const original = quotedMessage(messenger.history(), message);
      const quote = el('div', 'message-quote', original ? `${original.sender.kind === 'self' ? self.name : person.name}：${summary(original)}` : '原消息已删除');
      quote.title = quote.textContent; quote.setAttribute('aria-label', `引用：${quote.textContent}`);
      main.append(quote);
    }
    row.setAttribute('aria-label', outgoing ? `我方消息，${self.name}` : `AI 回复，${person.name}`);
    const time = el('time', 'message-saved-time', pending ? '尚未确认保存' : message.storyTime?.text || new Date(message.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
    time.title = message.storyTime ? '发送时的剧情时间'+(message.storyTime.status==='carried'?' · 沿用此前时间':'') : '设备记录时间，不代表剧情时间'; if(!message.storyTime)time.dateTime = message.createdAt; main.append(time);
    if (outgoing) row.append(main, avatar(self)); else row.append(avatar(person), main);
    if (!pending) actions.decorate(row, message); return row;
  }
  function paint() {
    if (!active) return;
    const history = messenger.history(), state = messenger.draft(person.id), status = messenger.status();
    const nearEnd = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 60, previousTop = scroll.scrollTop,previousHeight=scroll.scrollHeight,growing=loadingEarlier;loadingEarlier=false;
    actions.paint(); attachments.paint();
    scroll.replaceChildren();
    if (history) {
      const messages = forPerson(history, person.id);
      if (!messages.length) scroll.append(el('p', 'directory-empty', '暂无消息'));
      const range=historyRange(wrap.ownerDocument.defaultView,history,person),sync=phoneSyncStatus(wrap.ownerDocument.defaultView),info=el('details','chat-history-info');
      info.append(el('summary','',sync.error?'补记同步待核对':range.nearCapacity?'聊天记录接近容量上限':range.long?'长聊提示 · 查看回复范围':`回复参考 · 最近 ${range.shown} 条`));
      info.append(el('p','',`本次手机回复带最近 ${range.shown} 条原始对话，较早 ${range.omitted} 条不作为原始聊天发送。显示条数与发送条数分开。`));
      info.append(el('p','',range.sharing?`尚未补进正文：${range.pending} 条；已同步记录不会重复追加。`:'此人物未开启正文分享。'));
      info.append(el('p','','千千结总结状态未确认。长聊后可回正文推进剧情；较早内容能否被记住取决于记忆配置与摘要结果。'));
      if(sync.error){info.append(el('p','',sync.error),button('核对补记修改',()=>void messenger.syncStory(),'history-more'));}
      if(range.nearCapacity)info.append(el('p','',`当前存档已保存 ${range.stored}/${range.max} 条，文字总容量也有限制。达到上限会停止新增，不自动删除旧消息。`));
      scroll.append(info);
      if(messages.length>visibleCount)scroll.append(button(`查看更早消息（还有 ${messages.length-visibleCount} 条）`,()=>{visibleCount+=50;loadingEarlier=true;paint();},'history-more'));
      for (const message of messages.slice(-visibleCount)) scroll.append(bubble(message));
    }
    if (status.error) {
      scroll.append(el('p', 'profile-help', status.error), button('重新读取消息', () => { void messenger.refresh(); }));
    }
    const op = state.operation;
    if (op) {
      for (const message of op.delivery?.messages || [op.message]) if (message && !history?.messages.some(m => m.messageId === message.messageId)) scroll.append(bubble(message, true));
      const panel = el('div', 'message-pending-status'); panel.append(el('p', 'profile-help', op.busy ? '正在保存…' : op.error));
      if (!op.busy) panel.append(button('核对并重试', () => { void messenger.retry(person.id); }), button('重新读取消息', () => { void messenger.refresh(); }), button('结束消息核对', () => {
        if (wrap.ownerDocument.defaultView.confirm('停止重试并重新读取？当前输入会保留，未保存的 AI 回复会被放弃，已经保存的消息不会删除。')) void messenger.endSend(person.id);
      }));
      scroll.append(panel);
    }
    // Version counter in the controller decides whether submitted input may be cleared.
    if (input.value !== state.text) input.value = state.text;
    quoteDraft.replaceChildren(); quoteDraft.hidden = !state.quoteId;
    if (state.quoteId) {
      const original = history?.messages.find(m => m.messageId === state.quoteId && m.conversationId === conversationId(person.id));
      const cancel = button('×', () => messenger.quote(person.id, undefined), 'quote-cancel'); cancel.setAttribute('aria-label', '取消引用');
      quoteDraft.append(el('span', '', original ? `引用：${original.text}` : '引用：原消息已删除'), cancel);
    }
    feedback.textContent = ''; controls(); const targetTop=growing?previousTop+scroll.scrollHeight-previousHeight:nearEnd?scroll.scrollHeight:previousTop;scroll.scrollTop=targetTop;
    queueMicrotask(() => { if (active && scroll.isConnected) scroll.scrollTop = targetTop; });
  }
  const actions = createMessageActions({wrap, scroll, person, messenger, el, button, repaint: paint});
  const attachments = createAttachments({wrap, person, messenger, el, button});
  const unsubscribe = messenger.subscribe(paint); paint();
  return () => { active = false; observer.disconnect(); unsubscribe(); actions.dispose(); attachments.dispose(); messenger.cancelReply(person.id); onReplyState?.(); };
}
