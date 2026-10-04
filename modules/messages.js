import { record, clone, sameJson } from './contacts.js';
export const MAX_TEXT = 10000, MAX_MESSAGES = 2000, MAX_TOTAL_TEXT = 1000000;
export const conversationId = personId => `direct:${personId}`;
// Existing address books need no migration: their UUID scopes this fixed self slot.
export const selfId = archiveId => `self:${archiveId}`;
export const newHistory = archiveId => ({ version: 1, archiveId, revision: 0, messages: [] });
export function validateText(text) {
  if (typeof text !== 'string' || !text.trim()) throw Error('请输入消息内容');
  if ([...text].length > MAX_TEXT) throw Error(`每条消息最多 ${MAX_TEXT} 个字符`);
}
export function createMessage(archiveId, personId, text, sequence) {
  validateText(text);
  return { version: 1, messageId: crypto.randomUUID(), archiveId, conversationId: conversationId(personId),
    sender: { kind: 'self', id: selfId(archiveId) }, recipient: { kind: 'person', id: personId },
    text, createdAt: new Date().toISOString(), sequence, source: 'phone-manual' };
}
export function createReply(archiveId, personId, text, sequence) {
  const message = createMessage(archiveId, personId, text, sequence);
  return { ...message, sender: message.recipient, recipient: message.sender, source: 'ai-reply' };
}
export const messagePersonId = m => m.source === 'ai-reply' ? m.sender?.id : m.recipient?.id;
function validParties(m, archiveId) {
  const incoming = m.source === 'ai-reply', self = incoming ? m.recipient : m.sender, person = incoming ? m.sender : m.recipient;
  return ['phone-manual', 'ai-reply'].includes(m.source) && record(self) && self.kind === 'self' && self.id === selfId(archiveId)
    && record(person) && person.kind === 'person' && typeof person.id === 'string' && !!person.id && person.id.length <= 128
    && m.conversationId === conversationId(person.id);
}
export function validateHistory(value, archiveId) {
  if (!record(value) || ![1, 2].includes(value.version) || value.archiveId !== archiveId || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.messages) || value.messages.length > MAX_MESSAGES) throw Error('消息格式或容量不支持，已停止写入');
  const ids = new Set(); let previous = 0, size = 0;
  if (value.deletedMessageIds !== undefined && (!Array.isArray(value.deletedMessageIds) || value.deletedMessageIds.length > 20000 || !value.deletedMessageIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 128) || new Set(value.deletedMessageIds).size !== value.deletedMessageIds.length)) throw Error('消息删除索引格式或容量不支持，已停止写入');
  if (value.changeReceipts !== undefined && (!Array.isArray(value.changeReceipts) || value.changeReceipts.length > 64 || !value.changeReceipts.every(r => record(r) && typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 128 && /^[a-f0-9]{64}$/.test(r.fingerprint)))) throw Error('消息操作回执格式不支持');
  for (const m of value.messages) {
    if (!record(m) || m.version !== 1 || typeof m.messageId !== 'string' || !m.messageId || m.messageId.length > 128 || ids.has(m.messageId)
      || m.archiveId !== archiveId || !validParties(m, archiveId)
      || typeof m.createdAt !== 'string' || !Number.isFinite(Date.parse(m.createdAt))
      || !Number.isSafeInteger(m.sequence) || m.sequence <= previous) throw Error('消息记录无法可靠识别，已停止写入');
    if ((value.deletedMessageIds || []).includes(m.messageId)) throw Error('已删除消息不能重新写入');
    if (m.replyTo !== undefined && (typeof m.replyTo !== 'string' || !m.replyTo || m.replyTo.length > 128 || m.replyTo === m.messageId)) throw Error('引用消息身份无效');
    if (m.editedAt !== undefined && (typeof m.editedAt !== 'string' || !Number.isFinite(Date.parse(m.editedAt)))) throw Error('消息修改时间无效');
    validateText(m.text); ids.add(m.messageId); previous = m.sequence; size += m.text.length;
  }
  for (const m of value.messages) if (m.replyTo) { const original = value.messages.find(other => other.messageId === m.replyTo); if (original && (original.conversationId !== m.conversationId || original.sequence >= m.sequence)) throw Error('引用不属于本会话的更早消息'); }
  if (size > MAX_TOTAL_TEXT) throw Error('消息总容量已达上限，未删除旧消息或覆盖历史');
  return value;
}
export function appendMessage(history, message, expectedRevision) {
  validateHistory(history, message.archiveId);
  const existing = history.messages.find(m => m.messageId === message.messageId);
  if (existing) {
    if (!sameJson(existing, message)) throw Error('相同消息 ID 的内容不一致，已停止写入');
    return clone(history);
  }
  if (history.revision !== expectedRevision) throw Error('消息已被其他窗口或操作修改，请重新读取后再重试；未覆盖较新消息');
  const next = clone(history); next.messages.push(clone(message)); next.revision++;
  if (message.replyTo) next.version = 2; // Older writers must stop instead of ignoring quotation/mutation semantics.
  return validateHistory(next, message.archiveId);
}
export const forPerson = (history, id) => history.messages.filter(m => m.conversationId === conversationId(id));
export const latestMessage = (history, id) => forPerson(history, id).at(-1);
export const quotedMessage = (history, message) => history.messages.find(m => m.messageId === message.replyTo && m.conversationId === message.conversationId);
export function createChange(history, personId, kind, ids, text) {
  const change = { id: crypto.randomUUID(), archiveId: history.archiveId, personId, expectedRevision: history.revision, kind, ids: [...new Set(ids)], createdAt: new Date().toISOString() };
  if (kind === 'edit') { validateText(text); change.text = text; }
  return change;
}
export async function changeFingerprint(change) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(change)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
export function applyChange(history, change, fingerprint) {
  validateHistory(history, change.archiveId);
  if (!record(change) || !['edit','delete'].includes(change.kind) || typeof change.id !== 'string' || !change.id || change.id.length > 128 || !/^[a-f0-9]{64}$/.test(fingerprint) || !Array.isArray(change.ids) || !change.ids.length || change.ids.length > MAX_MESSAGES || new Set(change.ids).size !== change.ids.length || !Number.isFinite(Date.parse(change.createdAt))) throw Error('消息操作无效');
  const receipt = history.changeReceipts?.find(item => item.id === change.id);
  if (receipt) { if (receipt.fingerprint !== fingerprint) throw Error('相同操作 ID 的内容不一致'); return clone(history); }
  if (history.revision !== change.expectedRevision) throw Error('消息已变化，请结束核对、重新选择后再操作；未覆盖较新记录');
  const selected = change.ids.map(id => history.messages.find(m => m.messageId === id && m.conversationId === conversationId(change.personId)));
  if (selected.some(m => !m)) throw Error('找不到所选消息或消息不属于此会话');
  const next = clone(history);
  if (change.kind === 'edit') {
    if (selected.length !== 1) throw Error('每次只能编辑一条消息'); validateText(change.text);
    const target = next.messages.find(m => m.messageId === change.ids[0]); target.text = change.text; target.editedAt = change.createdAt;
  } else {
    next.messages = next.messages.filter(m => !change.ids.includes(m.messageId));
    // IDs only prevent uncertain old sends from resurrecting deleted text. No body backup.
    next.deletedMessageIds = [...new Set([...(next.deletedMessageIds || []), ...change.ids])];
  }
  next.changeReceipts = [...(next.changeReceipts || []), { id: change.id, fingerprint }].slice(-64);
  next.version = 2; next.revision++; return validateHistory(next, change.archiveId);
}
