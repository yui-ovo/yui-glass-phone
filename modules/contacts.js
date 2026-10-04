// Adapted from the owner's yui-pocket contacts/worldbook model; see SOURCES.md.
export const clone = value => structuredClone(value);
export const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
export const displayName = person => person.remark.trim() || person.name;
export const newAccount = () => crypto.randomUUID().replaceAll('-', '').slice(0, 12);
export const newBook = () => ({ version: 1, id: crypto.randomUUID(), revision: 0, people: [], self: { name: '我', account: newAccount(), avatar: { kind: 'default', value: '' } } });
export function newPerson(source = { kind: 'manual', name: '手动创建' }, name = '') {
  return { id: crypto.randomUUID(), source: clone(source), name, remark: '', description: '',
    avatar: { kind: 'default', value: '' }, relation: { known: false, accountKnown: false, friend: false }, account: newAccount() };
}
const string = (value, max, required = false) => typeof value === 'string' && value.length <= max && (!required || !!value.trim());
export function validateAvatarUrl(value) {
  if (!string(value, 2048, true)) throw Error('请输入有效的 HTTP(S) 图片地址');
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('请输入不带账号密码的 HTTP(S) 图片地址');
  return url.href;
}
export function validateAvatar(avatar) {
  if (!record(avatar) || typeof avatar.value !== 'string') throw Error('头像资料格式无效');
  if (avatar.kind === 'url') validateAvatarUrl(avatar.value);
  else if (avatar.kind === 'upload') {
    if (avatar.value.length > 380000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar.value)) throw Error('头像图片无效或过大');
  } else if (avatar.kind !== 'default' || avatar.value !== '') throw Error('头像类型无效');
}
export function validateMaterials(items) {
  if (!Array.isArray(items) || items.length > 20) throw Error('人物世界书关联资料格式不支持，未保存');
  const keys = new Set(); let size = 0;
  for (const item of items) {
    if (!record(item) || !string(item.world, 500, true) || !string(item.uid, 100, true) || !string(item.title, 2000) || !string(item.content, 20000, true)
      || typeof item.fingerprint !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(item.fingerprint) || typeof item.confirmedAt !== 'string' || !Number.isFinite(Date.parse(item.confirmedAt))) throw Error('世界书关联资料无效，已停止保存');
    const key = JSON.stringify([item.world, item.uid]);
    if (keys.has(key)) throw Error('世界书关联重复，已停止保存');
    keys.add(key); size += item.content.length;
  }
  if (size > 40000) throw Error('世界书资料总长度超限，已停止保存');
}
export function validateBook(book) {
  if (!record(book) || book.version !== 1 || !string(book.id, 128, true) || !Number.isSafeInteger(book.revision) || book.revision < 0 || !Array.isArray(book.people) || book.people.length > 100 || !record(book.self)) throw Error('通讯录格式不支持，已停止写入');
  const ids = new Set(), accounts = new Set();
  function account(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{3,40}$/.test(value)) throw Error('虚构账号需为 3–40 位字母、数字、下划线或短横线');
    const key = value.toLowerCase();
    if (accounts.has(key)) throw Error('本存档已有相同账号');
    accounts.add(key);
  }
  account(book.self.account);
  if (!string(book.self.name, 80, true)) throw Error('请填写我的名字（最多 80 字）');
  validateAvatar(book.self.avatar);
  for (const person of book.people) {
    if (!record(person) || !string(person.id, 128, true) || ids.has(person.id) || !string(person.name, 80, true) || !string(person.remark, 80) || !string(person.description, 1000)) throw Error('人物资料无效，请检查名字、备注和设定');
    ids.add(person.id); account(person.account);
    if (person.deletedAt !== undefined && (typeof person.deletedAt !== 'string' || !Number.isFinite(Date.parse(person.deletedAt)))) throw Error('人物删除记录格式无效，已停止保存');
    if (!record(person.source) || !['card', 'manual', 'worldbook'].includes(person.source.kind) || !string(person.source.name, 2000)
      || (person.source.avatarFile !== undefined && !string(person.source.avatarFile, 1000, true))) throw Error('人物来源无效');
    const rel = person.relation;
    if (!record(rel) || ![rel.known, rel.accountKnown, rel.friend].every(x => typeof x === 'boolean') || (rel.friend && (!rel.known || !rel.accountKnown)) || (!rel.known && rel.accountKnown)) throw Error('人物关系不一致');
    validateAvatar(person.avatar);
    if (person.roleplayMaterials !== undefined) validateMaterials(person.roleplayMaterials);
    if (person.aiExcludedMaterials !== undefined && (!Array.isArray(person.aiExcludedMaterials) || person.aiExcludedMaterials.length > 20 || !person.aiExcludedMaterials.every(key => typeof key === 'string' && (person.roleplayMaterials || []).some(item => JSON.stringify([item.world, item.uid]) === key)))) throw Error('世界书排除条目格式无效，已停止保存');
  }
  return book;
}
export function sameJson(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && sameJson(a[key], b[key]));
}
