import { record } from './contacts.js';
import { worldNames } from './ai.js';

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ENTRIES = 500;
const validName = name => typeof name === 'string' && name.length > 0 && name.length <= 500;
const avatarKey = avatar => avatar.replace(/\.[^/.]+$/, '');

// Read host metadata only. Never hydrate other cards, scan chats, or change bindings.
export function classifyWorldbooks(ctx, names, settings) {
  if (!Array.isArray(names) || !names.every(validName)) throw Error('世界书列表格式无法确认');
  const bound = new Set(), current = new Set(), problems = [];
  const characters = ctx?.characters;
  const cards = characters && typeof characters === 'object' ? Object.values(characters) : [];
  const active = characters?.[ctx?.characterId];
  const activeAvatar = typeof active?.avatar === 'string' ? active.avatar : null;
  if (!cards.length) problems.push('角色列表不可用');
  const seen = new Set();
  for (const card of cards) {
    if (!record(card) || !validName(card.avatar) || seen.has(card.avatar)) { problems.push('角色身份信息不完整'); continue; }
    seen.add(card.avatar);
    if (!record(card.data)) { problems.push('有角色缺少世界书绑定字段'); continue; }
    const extensions = card.data.extensions;
    if (extensions !== undefined && !record(extensions)) { problems.push('角色绑定格式无法确认'); continue; }
    // ST and TT 2.3.0 keep world in shallow projections. An explicit empty
    // string means unbound; a missing field must still remain unknown.
    if (card.shallow && (!record(extensions) || !Object.hasOwn(extensions, 'world') || typeof extensions.world !== 'string')) { problems.push('有精简角色资料缺少世界书绑定字段'); continue; }
    const name = extensions?.world;
    if (name !== undefined && name !== '' && !validName(name)) { problems.push('角色绑定格式无法确认'); continue; }
    if (name) { bound.add(name); if (card.avatar === activeAvatar) current.add(name); }
  }
  const info = settings?.world_info;
  if (!record(info) || (info.charLore !== undefined && !Array.isArray(info.charLore))) {
    problems.push('无法读取额外角色绑定');
  } else {
    for (const link of info.charLore || []) {
      if (!record(link) || !validName(link.name) || !Array.isArray(link.extraBooks) || !link.extraBooks.every(validName)) { problems.push('额外角色绑定格式无法确认'); continue; }
      // Also exclude links for cards absent from the current list.
      for (const name of link.extraBooks) { bound.add(name); if (activeAvatar && link.name === avatarKey(activeAvatar)) current.add(name); }
    }
  }
  const warning = problems.length ? `无法确认全部角色绑定：${[...new Set(problems)].join('；')}。暂不列出未绑定的世界书，可使用当前角色已确认的书或导入文件。` : '';
  return { current: [...new Set(names)].filter(name => current.has(name)), unbound: warning ? [] : [...new Set(names)].filter(name => !bound.has(name)), warning };
}

export async function worldbookChoices(win) {
  let settings;
  try {
    // Both ST and TT expose this same-origin module; no ST server request on TT.
    const host = await import('/scripts/world-info.js');
    settings = host.getWorldInfoSettings?.();
  } catch { /* Unknown bindings must never be classified as unbound. */ }
  const ctx = win.SillyTavern?.getContext();
  return classifyWorldbooks(ctx, worldNames(win), settings);
}

export function parseWorldbookFile(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) throw Error('世界书文件不能超过 2 MB');
  let data;
  try { data = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw Error('不是有效的 JSON 世界书，原资料未修改'); }
  if (!record(data) || (!record(data.entries) && !Array.isArray(data.entries))) throw Error('请导入含 entries 的世界书 JSON 文件');
  const array = Array.isArray(data.entries), values = Object.entries(data.entries);
  if (!values.length || values.length > MAX_IMPORT_ENTRIES) throw Error('文件需包含 1–500 个世界书条目');
  const ids = new Set();
  return values.map(([key, entry]) => {
    if (!record(entry)) throw Error('世界书条目格式不支持，原资料未修改');
    const rawId = entry.uid ?? entry.id ?? (array ? undefined : key);
    if (!['string', 'number'].includes(typeof rawId) || (typeof rawId === 'number' && !Number.isSafeInteger(rawId))) throw Error('条目缺少稳定 ID，无法导入');
    const uid = String(rawId), title = entry.comment ?? entry.name ?? '';
    if (!uid || uid.length > 100 || ids.has(uid)) throw Error('条目 ID 无效或重复，无法导入');
    if (typeof title !== 'string' || title.length > 2000 || typeof entry.content !== 'string' || entry.content.length > 20000) throw Error('条目标题或正文格式/长度不支持，原资料未修改');
    if ((entry.disable !== undefined && typeof entry.disable !== 'boolean') || (entry.enabled !== undefined && typeof entry.enabled !== 'boolean')) throw Error('条目启用状态格式不支持');
    ids.add(uid);
    return { uid, title: title || uid, content: entry.content, disabled: entry.disable === true || entry.enabled === false };
  });
}

export async function importWorldbook(win, file) {
  if (!file || file.size > MAX_IMPORT_BYTES) throw Error('世界书文件不能超过 2 MB');
  const entries = parseWorldbookFile(await file.text());
  // Content identity prevents duplicate imports; same-named different files cannot overwrite.
  const normalized = [...entries].sort((a, b) => a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0);
  const hash = await win.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(normalized)));
  const fingerprint = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  const name = String(file.name || '世界书').replace(/\.json$/i, '').slice(0, 120);
  const world = `导入 · ${name} · ${fingerprint}`;
  return entries.map(entry => ({ ...entry, world }));
}

export const worldbookLabel = world => world.replace(/ · ([a-f0-9]{64})$/, (_, hash) => ` · ${hash.slice(0, 6)}`);
