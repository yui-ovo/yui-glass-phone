import { createMessageStore } from './message-host.js';
import { createMessage, createReply, createChange, conversationId, createDelivery, applyDelivery, changeFingerprint } from './messages.js';
import { kindOf, parseReply, stickerPayload, transferPayload, ACTION_PROTOCOL } from './rich-messages.js';
import { createStickerLibrary } from './stickers.js';
import { sameJson } from './contacts.js';
import { readConfig, replyContext, buildPrompt, apiRequest } from './ai.js';

// In-memory drafts are scoped to the active archive; only confirmed records enter history.
export function createMessenger(win, profiles) {
  let epoch = 0, store, history, error = '', reading = false, session, sessionSignal, job, change, library;
  const drafts = new Map(), listeners = new Set();
  const emit = () => { for (const fn of [...listeners]) fn(); };
  const draft = id => { if (!drafts.has(id)) drafts.set(id, { text: '', edit: 0, operation: null, aiError: '', replyAfter: 0, quoteId: undefined, editing: undefined }); return drafts.get(id); };
  function cancelReply(id) {
    if (job && (!id || job.id === id)) { const cancelled = job; job = undefined; cancelled.controller.abort(); draft(cancelled.id).aiError = '已停止回复'; emit(); }
  }
  async function refresh(rebase = false) {
    const ticket = epoch, captured = store; reading = true; emit();
    try {
      const value = await captured.read();
      if (ticket !== epoch) return;
      history = value; error = '';
      if (rebase) for (const state of drafts.values()) {
        const op = state.operation;
        if (op && !op.delivery && !op.busy && !value.messages.some(m => m.messageId === op.message.messageId)) {
          op.revision = value.revision; op.message.sequence = (value.messages.at(-1)?.sequence || 0) + 1;
        }
      }
    } catch (e) { if (ticket === epoch) { history = undefined; error = e.message || '消息读取失败，未覆盖历史'; } }
    finally { if (ticket === epoch) { reading = false; emit(); } }
  }
  async function execute(id) {
    const state = draft(id), op = state.operation;
    if (!op || op.busy) return;
    const ticket = epoch, captured = store; op.busy = true; op.error = ''; emit();
    try {
      const saved = op.delivery ? await captured.deliver(op.delivery) : await captured.send(op.message, op.revision);
      if (ticket !== epoch) return;
      history = saved;
      if (!op.delivery && op.message.source === 'phone-manual' && state.edit === op.edit) { state.text = ''; state.quoteId = undefined; state.edit++; }
      if (op.delivery ? !op.delivery.incoming : op.message.source === 'phone-manual') state.replyAfter = Date.now() + 800;
      if (op.clearAttachment && state.attachment && state.attachment.edit === op.clearAttachment.edit) { state.attachment.amount = ''; state.attachment.note = ''; state.attachment.edit++; }
      state.operation = null;
    } catch (e) { if (ticket === epoch) op.error = `${e.message || '保存未确认'}。可核对并重试，消息可能已写入。`; }
    finally { if (ticket === epoch) { op.busy = false; emit(); } }
  }
  function ensureMutable() {
    if (!history || reading) throw Error('请等待消息读取完成');
    if (change || [...drafts.values()].some(d => d.operation)) throw Error('请先处理未确认保存的消息或修改');
  }
  async function executeChange() {
    const op = change; if (!op || op.busy) return;
    const ticket = epoch, captured = store; op.busy = true; op.error = ''; emit();
    try {
      const saved = await captured.change(op.value); if (ticket !== epoch || change !== op) return;
      history = saved; const state = draft(op.value.personId); state.editing = undefined; change = undefined;
    } catch (e) { if (ticket === epoch && change === op) op.error = `${e.message || '保存未确认'}。修改可能已写入，可核对并重试。`; }
    finally { if (ticket === epoch) { op.busy = false; emit(); } }
  }
  function mutate(id, kind, ids, text, expectedRevision) {
    ensureMutable(); cancelReply();
    const value = createChange(history, id, kind, ids, text); if (expectedRevision !== undefined) value.expectedRevision = expectedRevision;
    change = { value, busy: false, error: '' }; void executeChange();
  }
  async function requestReply(id) {
    const state = draft(id);
    if (!history || reading || job || state.text.trim() || Date.now() < state.replyAfter) return;
    if (change || state.editing || state.quoteId) { state.aiError = '请先保存或取消编辑，并处理输入框中的引用'; emit(); return; }
    if ([...drafts.values()].some(d => d.operation)) { state.aiError = '还有未确认保存的消息，请先回到对应会话核对并重试'; emit(); return; }
    const ticket = epoch, captured = session, signal = sessionSignal;
    const controller = new AbortController(), task = { id, controller }; job = task; state.aiError = ''; emit();
    const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
    const current = () => ticket === epoch && job === task && !controller.signal.aborted;
    try {
      profiles.assertSession(captured, signal);
      const config = readConfig(win), fresh = await profiles.load(signal);
      if (!current()) return;
      if (fresh.book.id !== captured.book.id || fresh.account !== captured.account) throw Error('存档身份已变化');
      const person = fresh.book.people.find(p => p.id === id && p.relation.friend && !p.deletedAt);
      if (!person) throw Error('对方不在当前存档好友中');
      const context = replyContext(win, fresh.book, person), initial = await store.read();
      if (!current()) return;
      const catalog = win.indexedDB ? await library.available(captured.book.id, id) : [];
      if (!current()) return;
      const prompt = buildPrompt(context, initial, id, config.historyCount, config.prompt);
      prompt.push({ role: 'system', content: ACTION_PROTOCOL });
      prompt.push({ role: 'user', content: JSON.stringify({ availableStickers: catalog.map(({id,description,category}) => ({id,description,category})), pendingTransfers: initial.messages.filter(m => m.conversationId === conversationId(id) && kindOf(m) === 'transfer' && m.transfer.state === 'pending' && m.sender.kind === 'self').map(m => ({messageId:m.messageId, ...m.transfer})) }) });
      if (JSON.stringify(prompt).length > 180000) throw Error('参考内容过长，请减少表情包授权或历史条数');
      const text = await apiRequest(win, config, 'reply', prompt, controller.signal);
      if (!current()) return;
      const parsed = parseReply(text, catalog);
      profiles.assertSession(captured, signal);
      const latest = await profiles.load(signal); if (!current()) return;
      const now = latest.book.people.find(p => p.id === id && p.relation.friend && !p.deletedAt);
      if (!now || latest.book.id !== captured.book.id || latest.account !== captured.account || !sameJson(replyContext(win, latest.book, now), context)) throw Error('人物资料或当前人设已变化，本次回复已取消');
      const latestHistory = await store.read(); if (!current()) return;
      if (!sameJson(initial, latestHistory)) throw Error('请求期间手机消息已变化，本次回复未保存，请重新读取后再请求');
      history = latestHistory;
      if (parsed.settlements.length || parsed.messages.some(m => m.kind !== 'text') || parsed.messages.length !== 1) {
        const currentAssets = win.indexedDB ? await library.available(captured.book.id, id) : []; if (!current()) return;
        for (const m of parsed.messages) if (m.kind === 'sticker' && !currentAssets.some(a => a.id === m.sticker.assetId && a.allowedAI && !a.hidden && a.description === m.sticker.description)) throw Error('表情包授权或描述已变化，本次回复未保存');
        const delivery = createDelivery(history, id, parsed.messages, parsed.settlements, true);
        // Validate before showing a pending operation. Invalid AI output cannot poison retries.
        applyDelivery(history, delivery, await changeFingerprint(delivery)); if (!current()) return;
        state.operation = { delivery, message: delivery.messages[0], busy: false, error: '' };
      } else state.operation = { message: createReply(history.archiveId, id, parsed.messages[0].text, (history.messages.at(-1)?.sequence || 0) + 1), revision: history.revision, busy: false, error: '' };
      job = undefined;
      await execute(id); // Saving retries reuse this reply, never call AI again.
    } catch (e) { if (current()) state.aiError = e.message || '回复失败，请重试'; }
    finally { signal.removeEventListener('abort', abort); if (job === task) job = undefined; if (ticket === epoch) emit(); }
  }
  function deliver(id, payloads, settlements = [], clearAttachment) {
    ensureMutable(); if (job) throw Error('请先停止正在生成的回复');
    const state = draft(id); if (state.editing) throw Error('请先处理文字编辑');
    const delivery = createDelivery(history, id, payloads, settlements);
    state.operation = { delivery, message: delivery.messages[0], clearAttachment, busy: false, error: '' }; void execute(id);
  }
  return {
    async bind(value, signal) {
      cancelReply(); epoch++; drafts.clear(); change = undefined; history = undefined; error = ''; reading = false; session = value; sessionSignal = signal;
      store = createMessageStore(win, profiles, value, signal); library = createStickerLibrary(win, value.account); await refresh();
    },
    history: () => history,
    status: () => ({ error, reading, generating: job?.id, change }), draft,
    requestReply, cancelReply, library: () => library, sessionSignal: () => sessionSignal,
    async stickerPeople(){const captured=session,signal=sessionSignal;profiles.assertSession(captured,signal);const fresh=await profiles.load(signal);profiles.assertSession(captured,signal);if(fresh.book.id!==captured.book.id)throw Error('存档已变化');return {archiveId:fresh.book.id,people:fresh.book.people.filter(p=>!p.deletedAt).map(p=>({id:p.id,name:p.remark||p.name}))};},
    async sendSticker(id, assetId, signal) { const state = draft(id); if (state.sendingSticker) return; state.sendingSticker = true;
      try { const ticket = epoch, captured = library; const asset = await captured.get(assetId); if (ticket !== epoch || signal?.aborted) return; if (!asset || asset.hidden) throw Error('找不到可用的表情包'); deliver(id, [stickerPayload(asset)]); }
      finally { state.sendingSticker = false; } },
    sendTransfer(id, amount, note) { const state = draft(id); deliver(id, [transferPayload(amount, note)], [], {edit: state.attachment?.edit}); },
    settleTransfer(id, messageId, action) { deliver(id, [], [{messageId, action}]); },
    beginEdit(id, messageId) { ensureMutable(); const m = history.messages.find(m => m.messageId === messageId && m.conversationId === conversationId(id)); if (!m) throw Error('找不到原消息'); if (kindOf(m) !== 'text') throw Error('只能编辑文字消息'); cancelReply(); draft(id).editing = { messageId, text: m.text, revision: history.revision }; emit(); },
    editInput(id, text) { const state = draft(id); if (state.editing && !change) state.editing.text = text; },
    cancelEdit(id) { if (change) return; draft(id).editing = undefined; emit(); },
    saveEdit(id) { const value = draft(id).editing; if (value) mutate(id, 'edit', [value.messageId], value.text, value.revision); },
    deleteMessages: (id, ids) => mutate(id, 'delete', ids),
    quote(id, messageId) { const state = draft(id); if (messageId && !history?.messages.some(m => m.messageId === messageId && m.conversationId === conversationId(id))) throw Error('找不到引用消息'); state.quoteId = messageId; state.edit++; emit(); },
    retryChange: executeChange,
    async endChange() { if (!change || change.busy) return; const ticket = epoch, op = change; await refresh(); if (ticket === epoch && change === op && history) { draft(op.value.personId).editing = undefined; change = undefined; emit(); } },
    input(id, text) { const state = draft(id); state.text = text; state.edit++; },
    submit(id) {
      const state = draft(id); if (!history || reading || state.operation || job || change || state.editing) return;
      const message = createMessage(history.archiveId, id, state.text, (history.messages.at(-1)?.sequence || 0) + 1);
      if (state.quoteId) message.replyTo = state.quoteId;
      state.operation = { message, revision: history.revision, edit: state.edit, busy: false, error: '' };
      void execute(id);
    },
    retry: id => execute(id), refresh: () => refresh(true),
    async endSend(id) { const state = draft(id), op = state.operation, ticket = epoch; if (!op || op.busy) return; await refresh(); if (ticket === epoch && state.operation === op && history) { state.operation = null; emit(); } },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dirty: () => !!job || !!change || [...drafts.values()].some(d => d.text.length || d.operation || d.editing || d.quoteId || d.sendingSticker || d.attachment && (d.attachment.busy || d.attachment.amount || d.attachment.note || d.attachment.urls || d.attachment.description || d.attachment.files?.length || Object.keys(d.attachment.assetEdits || {}).length || Object.keys(d.attachment.groupDrafts || {}).length || d.attachment.fileDescriptions?.length || d.attachment.newCategory)),
    reset() { cancelReply(); epoch++; drafts.clear(); change = undefined; store = undefined; history = undefined; reading = false; error = ''; listeners.clear(); },
  };
}
