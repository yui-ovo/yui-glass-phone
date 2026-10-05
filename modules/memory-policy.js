// Per-contact consent and binding only; never persist another plugin's memory.
export const defaultMemoryPolicy = () => ({ enabled:false, chatId:'', entityId:'', plot:true, profile:false, state:false, maxChars:12000 });
export function validateMemoryPolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !['enabled','plot','profile','state'].every(key => typeof value[key] === 'boolean')
    || !['chatId','entityId'].every(key => typeof value[key] === 'string' && value[key].length <= 1000)
    || !Number.isInteger(value.maxChars) || value.maxChars < 1000 || value.maxChars > 30000
    || (value.enabled && (!value.chatId || !(value.plot || value.profile || value.state) || ((value.profile || value.state) && !value.entityId)))) {
    throw Error('请关联千千结存档、选择参考内容及对应人物；字数上限为 1000–30000');
  }
  return value;
}
export const memoryPolicy = person => validateMemoryPolicy(person.memoryLink || defaultMemoryPolicy());
