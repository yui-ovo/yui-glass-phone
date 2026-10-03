import { createMessageStore } from './message-host.js';
import { createMessage } from './messages.js';

// In-memory drafts are scoped to the active archive; only confirmed records enter history.
export function createMessenger(win, profiles) {
  let epoch = 0, store, history, error = '', reading = false;
  const drafts = new Map(), listeners = new Set();
  const emit = () => { for (const fn of [...listeners]) fn(); };
  const draft = id => { if (!drafts.has(id)) drafts.set(id, { text: '', edit: 0, operation: null }); return drafts.get(id); };
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
      if (state.edit === op.edit) { state.text = ''; state.edit++; }
      state.operation = null;
    } catch (e) { if (ticket === epoch) op.error = `${e.message || '保存未确认'}。可核对并重试，消息可能已写入。`; }
    finally { if (ticket === epoch) { op.busy = false; emit(); } }
  }
  return {
    async bind(session, signal) {
      epoch++; drafts.clear(); history = undefined; error = ''; reading = false;
      store = createMessageStore(win, profiles, session, signal); await refresh();
    },
    history: () => history,
    status: () => ({ error, reading }), draft,
    input(id, text) { const state = draft(id); state.text = text; state.edit++; },
    submit(id) {
      const state = draft(id); if (!history || reading || state.operation) return;
      const message = createMessage(history.archiveId, id, state.text, (history.messages.at(-1)?.sequence || 0) + 1);
      state.operation = { message, revision: history.revision, edit: state.edit, busy: false, error: '' };
      void execute(id);
    },
    retry: id => execute(id), refresh: () => refresh(true),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dirty: () => [...drafts.values()].some(d => d.text.length || d.operation),
    reset() { epoch++; drafts.clear(); store = undefined; history = undefined; reading = false; error = ''; listeners.clear(); },
  };
}
