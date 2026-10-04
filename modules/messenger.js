import { createMessageStore } from './message-host.js';
import { createMessage, createReply } from './messages.js';
import { sameJson } from './contacts.js';
import { readConfig, replyContext, buildPrompt, apiRequest } from './ai.js';

// In-memory drafts are scoped to the active archive; only confirmed records enter history.
export function createMessenger(win, profiles) {
  let epoch = 0, store, history, error = '', reading = false, session, sessionSignal, job;
  const drafts = new Map(), listeners = new Set();
  const emit = () => { for (const fn of [...listeners]) fn(); };
  const draft = id => { if (!drafts.has(id)) drafts.set(id, { text: '', edit: 0, operation: null, aiError: '', replyAfter: 0 }); return drafts.get(id); };
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
        if (op && !op.busy && !value.messages.some(m => m.messageId === op.message.messageId)) {
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
      const saved = await captured.send(op.message, op.revision);
      if (ticket !== epoch) return;
      history = saved;
      if (op.message.source === 'phone-manual' && state.edit === op.edit) { state.text = ''; state.edit++; }
      if (op.message.source === 'phone-manual') state.replyAfter = Date.now() + 800;
      state.operation = null;
    } catch (e) { if (ticket === epoch) op.error = `${e.message || '保存未确认'}。可核对并重试，消息可能已写入。`; }
    finally { if (ticket === epoch) { op.busy = false; emit(); } }
  }
  async function requestReply(id) {
    const state = draft(id);
    if (!history || reading || job || state.text.trim() || Date.now() < state.replyAfter) return;
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
      const text = await apiRequest(win, config, 'reply', buildPrompt(context, initial, id, config.historyCount), controller.signal);
      if (!current()) return;
      profiles.assertSession(captured, signal);
      const latest = await profiles.load(signal); if (!current()) return;
      const now = latest.book.people.find(p => p.id === id && p.relation.friend && !p.deletedAt);
      if (!now || latest.book.id !== captured.book.id || latest.account !== captured.account || !sameJson(replyContext(win, latest.book, now), context)) throw Error('人物资料或当前人设已变化，本次回复已取消');
      const latestHistory = await store.read(); if (!current()) return;
      if (!sameJson(initial, latestHistory)) throw Error('请求期间手机消息已变化，本次回复未保存，请重新读取后再请求');
      history = latestHistory;
      state.operation = { message: createReply(history.archiveId, id, text, (history.messages.at(-1)?.sequence || 0) + 1), revision: history.revision, busy: false, error: '' };
      job = undefined;
      await execute(id); // Saving retries reuse this reply, never call AI again.
    } catch (e) { if (current()) state.aiError = e.message || '回复失败，请重试'; }
    finally { signal.removeEventListener('abort', abort); if (job === task) job = undefined; if (ticket === epoch) emit(); }
  }
  return {
    async bind(value, signal) {
      cancelReply(); epoch++; drafts.clear(); history = undefined; error = ''; reading = false; session = value; sessionSignal = signal;
      store = createMessageStore(win, profiles, value, signal); await refresh();
    },
    history: () => history,
    status: () => ({ error, reading, generating: job?.id }), draft,
    requestReply, cancelReply,
    input(id, text) { const state = draft(id); state.text = text; state.edit++; },
    submit(id) {
      const state = draft(id); if (!history || reading || state.operation || job) return;
      const message = createMessage(history.archiveId, id, state.text, (history.messages.at(-1)?.sequence || 0) + 1);
      state.operation = { message, revision: history.revision, edit: state.edit, busy: false, error: '' };
      void execute(id);
    },
    retry: id => execute(id), refresh: () => refresh(true),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dirty: () => !!job || [...drafts.values()].some(d => d.text.length || d.operation),
    reset() { cancelReply(); epoch++; drafts.clear(); store = undefined; history = undefined; reading = false; error = ''; listeners.clear(); },
  };
}
