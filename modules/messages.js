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
  if (!record(value) || value.version !== 1 || value.archiveId !== archiveId || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.messages) || value.messages.length > MAX_MESSAGES) throw Error('消息格式或容量不支持，已停止写入');
  const ids = new Set(); let previous = 0, size = 0;
  for (const m of value.messages) {
    if (!record(m) || m.version !== 1 || typeof m.messageId !== 'string' || !m.messageId || m.messageId.length > 128 || ids.has(m.messageId)
      || m.archiveId !== archiveId || !validParties(m, archiveId)
      || typeof m.createdAt !== 'string' || !Number.isFinite(Date.parse(m.createdAt))
      || !Number.isSafeInteger(m.sequence) || m.sequence <= previous) throw Error('消息记录无法可靠识别，已停止写入');
    validateText(m.text); ids.add(m.messageId); previous = m.sequence; size += m.text.length;
  }
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
  return validateHistory(next, message.archiveId);
}
export const forPerson = (history, id) => history.messages.filter(m => m.conversationId === conversationId(id));
export const latestMessage = (history, id) => forPerson(history, id).at(-1);
