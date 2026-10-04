import { ttStore, ttHost } from './host.js';
import { clone, sameJson } from './contacts.js';
import { newHistory, validateHistory, appendMessage } from './messages.js';
export const messageKey = (account, archiveId) => `yui-glass-phone.messages.v1:${encodeURIComponent(account)}:${encodeURIComponent(archiveId)}`;
export function createMessageStore(win, profiles, session, signal) {
  const archiveId = session.book.id, key = messageKey(session.account, archiveId);
  const native = ttHost(win) ? ttStore(win, session.snapshot.chatId, session.snapshot.group, session.snapshot.source?.avatarFile, 'messages-v1') : null;
  const guard = () => profiles.assertSession(session, signal);
  async function read() {
    guard();
    let raw;
    if (native) raw = await native.read();
    else { const text = win.localStorage.getItem(key); if (text !== null) { try { raw = JSON.parse(text); } catch { throw Error('消息读取失败，已停止覆盖历史'); } } }
    guard(); return raw === undefined ? newHistory(archiveId) : validateHistory(clone(raw), archiveId);
  }
  return { read, async send(message, expectedRevision) {
    guard();
    if (!win.navigator?.locks?.request) throw Error('当前宿主缺少安全的多窗口写入锁，已停止保存消息，请更新宿主');
    return win.navigator.locks.request(key, { mode: 'exclusive', signal }, async () => {
      guard();
      // Fresh identity/relation check, without copying or writing the profile book.
      const fresh = await profiles.load(signal); guard();
      if (fresh.book.id !== archiveId || fresh.account !== session.account) throw Error('存档身份已变化，未写入消息');
      const previous = await read();
      const existing = previous.messages.find(m => m.messageId === message.messageId);
      if (existing) {
        if (!sameJson(existing, message)) throw Error('相同消息 ID 的内容不一致，未写入');
        return previous; // A previous native write succeeded even if confirmation failed.
      }
      if (!fresh.book.people.some(p => p.id === message.recipient.id && p.relation.friend && !p.deletedAt)) throw Error('对方已不在本存档好友中，未写入消息');
      const next = appendMessage(previous, message, expectedRevision);
      guard();
      // Recheck immediately before dispatch. Web Locks serialize cooperating windows.
      const latest = await read(); if (!sameJson(latest, previous)) throw Error('消息在保存前发生变化，请重新读取，未覆盖');
      if (native) await native.write(next, guard);
      else {
        guard();
        try { win.localStorage.setItem(key, JSON.stringify(next)); } catch { throw Error('消息保存失败，输入已保留；请检查本机容量'); }
      }
      const confirmed = await read();
      if (!sameJson(confirmed, next)) throw Error('保存结果未确认，请按原消息 ID 核对重试');
      return confirmed;
    });
  } };
}
