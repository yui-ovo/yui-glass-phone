// Adapted from yui-pocket profile-host/tt-host. Independent storage; no old-data reads.
import { newBook, validateBook, clone, record, sameJson } from './contacts.js';
export const NAMESPACE = 'yui-glass-phone';
export const storageKey = account => `${NAMESPACE}.contacts.v1:${encodeURIComponent(account)}`;
export const ttHost = host => host.__TAURITAVERN__;
export const ttReady = host => ttHost(host)?.ready ?? host.__TAURITAVERN_MAIN_READY__;
export function ttFrame(snapshot) {
  const frame = snapshot?.safeFrame, keyboard = snapshot?.ime?.keyboardOffset;
  if (snapshot?.version !== 1 || !frame || ![frame.left, frame.top, frame.width, frame.height, keyboard].every(x => Number.isFinite(x) && x >= 0) || !frame.width || !frame.height) return;
  return { ...frame, height: Math.max(1, frame.height - keyboard) };
}
export function ttStore(host, chatId, group, avatar, collection = 'contacts-v1') {
  if (!['contacts-v1', 'messages-v1'].includes(collection)) throw Error('不支持的资料类型');
  const api = ttHost(host)?.api?.chat;
  if (!api?.open) throw Error('此 TT 版本未提供独立聊天资料接口，请更新 TT');
  const fileName = chatId.replace(/\.jsonl$/, '');
  if (!fileName.trim() || (!group && (!avatar?.endsWith('.png') || /[\\/\u0000-\u001f?<>:*|"]/u.test(avatar)))) throw Error('无法确认 TT 存档身份，未读取或保存资料');
  const handle = api.open(group ? { kind: 'group', chatId: fileName } : { kind: 'character', characterId: avatar.slice(0, -4), fileName });
  const store = handle?.store;
  if (!store?.getJson || !store.setJson || !store.listKeys || !store.renameKey) throw Error('TT 独立资料接口不完整，请更新 TT');
  async function entry(chat) {
    const digest = await host.crypto.subtle.digest('SHA-256', new TextEncoder().encode(chat.replace(/\.jsonl$/, '')));
    return collection + '-' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  }
  async function keys() {
    const values = await store.listKeys({ namespace: NAMESPACE });
    if (!Array.isArray(values) || !values.every(k => typeof k === 'string')) throw Error('TT 资料索引读取失败');
    return values;
  }
  return {
    async read() { const key = await entry(fileName); return (await keys()).includes(key) ? store.getJson({ namespace: NAMESPACE, key }) : undefined; },
    async write(value, guard) { const key = await entry(fileName); guard(); await store.setJson({ namespace: NAMESPACE, key, value }); },
    async rename(oldName) {
      const key = await entry(oldName), newKey = await entry(fileName), existing = await keys();
      if (key === newKey || !existing.includes(key)) return;
      if (existing.includes(newKey)) throw Error('重命名目标已有通讯录');
      await store.renameKey({ namespace: NAMESPACE, key, newKey });
    },
  };
}
export function createProfileHost(host) {
  let dead = false, generation = 0, warning = '', renaming = false;
  const life = new AbortController(), subscribers = new Set(), removers = [];
  const context = () => host.SillyTavern?.getContext();
  function snapshot() {
    const ctx = context();
    if (typeof ctx?.chatId !== 'string' || !ctx.chatId.trim() || !ctx.eventSource?.on || !ctx.eventSource?.removeListener || !ctx.eventTypes?.CHAT_CHANGED) return;
    const card = ctx.characters?.[String(ctx.characterId)];
    const group = ctx.groupId !== undefined && ctx.groupId !== null && ctx.groupId !== '';
    const scope = group ? `group:${ctx.groupId}` : card?.avatar && card.avatar !== 'none' ? `card:${card.avatar}` : undefined;
    if (!scope) return;
    return { locator: JSON.stringify([scope, ctx.chatId, ctx.chatMetadata?.integrity ?? '']), chatId: ctx.chatId,
      group, source: !group && card ? { kind: 'card', name: card.name, avatarFile: card.avatar } : undefined };
  }
  function changed() { generation++; for (const fn of subscribers) fn(); }
  function ensure(session, epoch, signal) {
    if (dead || signal.aborted || epoch !== generation || session.generation !== generation || snapshot()?.locator !== session.snapshot.locator) throw Error('聊天已切换或操作已取消，请重新打开资料');
    if (warning || renaming) throw Error(warning || '正在处理聊天重命名，请稍后重新读取');
  }
  function readRegistry(account) {
    const raw = host.localStorage.getItem(storageKey(account));
    if (raw === null) return { version: 1, books: {} };
    let value; try { value = JSON.parse(raw); } catch { throw Error('本机通讯录无法读取，已停止写入'); }
    if (!record(value) || value.version !== 1 || !record(value.books)) throw Error('本机通讯录格式不支持，已停止写入');
    return value;
  }
  function writeRegistry(account, value) {
    const raw = JSON.stringify(value);
    try { host.localStorage.setItem(storageKey(account), raw); if (host.localStorage.getItem(storageKey(account)) !== raw) throw Error(); }
    catch { throw Error('本机保存失败，草稿已保留；请检查存储空间后重试'); }
  }
  async function accountHandle(signal) {
    const ctx = context();
    if (!ctx?.getRequestHeaders) throw Error('宿主未提供账号接口，未读取或保存资料');
    const timeout = new AbortController(), abort = () => timeout.abort();
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    const timer = setTimeout(abort, 10000);
    try {
      const response = await host.fetch('/api/users/me', { headers: ctx.getRequestHeaders(), credentials: 'same-origin', cache: 'no-store', signal: timeout.signal });
      if (!response.ok) throw Error('无法确认酒馆账号，未读取或保存资料');
      const value = await response.json();
      if (typeof value.handle !== 'string' || !value.handle) throw Error('酒馆未提供有效账号');
      return value.handle;
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  }
  const ctx = context();
  if (ctx?.eventSource?.on) {
    function bind(name, fn) { const event = ctx.eventTypes?.[name]; if (!event) return; ctx.eventSource.on(event, fn); removers.push(() => ctx.eventSource.removeListener(event, fn)); }
    bind('CHAT_CHANGED', changed);
    bind('CHAT_RENAMED', async event => {
      if (dead) return;
      renaming = true; changed();
      try {
        if (typeof event?.oldFileName !== 'string' || typeof event.newFileName !== 'string') throw Error('重命名事件无效');
        if (ttHost(host)) {
          for (const collection of ['contacts-v1', 'messages-v1']) await ttStore(host, event.newFileName, !!event.groupId, event.avatarId, collection).rename(event.oldFileName);
        }
        else {
          const account = await accountHandle(life.signal); if (dead) return;
          const registry = readRegistry(account), scope = event.groupId ? `group:${event.groupId}` : `card:${event.avatarId}`;
          let moved = false;
          for (const locator of Object.keys(registry.books)) {
            const parts = JSON.parse(locator);
            if (parts[0] !== scope || `${parts[1].replace(/\.jsonl$/, '')}.jsonl` !== event.oldFileName) continue;
            validateBook(registry.books[locator]); parts[1] = event.newFileName.replace(/\.jsonl$/, '');
            const target = JSON.stringify(parts);
            if (target === locator) continue;
            if (Object.hasOwn(registry.books, target)) throw Error('重命名目标已有通讯录');
            registry.books[target] = registry.books[locator]; delete registry.books[locator]; moved = true;
          }
          if (moved) writeRegistry(account, registry);
        }
      } catch { warning = '聊天重命名资料迁移未确认，已停止保存；请改回原名检查资料并刷新'; }
      finally { renaming = false; if (!dead) changed(); }
    });
  }
  return {
    assertSession(session, signal) { ensure(session, generation, signal); },
    valid: () => !!snapshot(),
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    async load(signal) {
      const selected = snapshot(), epoch = generation;
      if (!selected) throw Error('请先打开有效聊天，再使用本存档通讯录');
      const session = { snapshot: selected, generation: epoch, book: newBook(), exists: false, account: '', nativeStore: null };
      ensure(session, epoch, signal);
      let saved;
      if (ttHost(host)) { session.account = 'tt-native'; session.nativeStore = ttStore(host, selected.chatId, selected.group, selected.source?.avatarFile); saved = await session.nativeStore.read(); }
      else { session.account = await accountHandle(signal); ensure(session, epoch, signal); saved = readRegistry(session.account).books[selected.locator]; }
      ensure(session, epoch, signal);
      if (saved !== undefined) { session.book = clone(saved); session.exists = true; }
      validateBook(session.book); return session;
    },
    async save(session, book, signal) {
      const epoch = generation; ensure(session, epoch, signal); validateBook(book);
      const next = clone(book); next.revision = session.book.revision + 1;
      function check(previous) {
        if (previous !== undefined) validateBook(previous);
        if ((previous !== undefined) !== session.exists || (previous && (previous.id !== session.book.id || previous.revision !== session.book.revision))) throw Error('通讯录已变化，草稿已保留；请取消后重新读取再编辑');
      }
      if (session.nativeStore) {
        const previous = await session.nativeStore.read(); ensure(session, epoch, signal); check(previous);
        await session.nativeStore.write(next, () => ensure(session, epoch, signal));
        const confirmed = await session.nativeStore.read(); ensure(session, epoch, signal);
        if (!sameJson(confirmed, next)) throw Error('TT 保存结果未确认，草稿已保留；请重新读取核对');
      } else {
        const account = await accountHandle(signal); ensure(session, epoch, signal);
        if (account !== session.account) throw Error('酒馆账号已变化，已停止保存');
        const registry = readRegistry(account); check(registry.books[session.snapshot.locator]);
        registry.books[session.snapshot.locator] = next; writeRegistry(account, registry);
      }
      session.book = next; session.exists = true;
    },
    avatar(person) {
      if (person.avatar.kind !== 'default') return person.avatar.value;
      const file = person.source?.avatarFile, ctx = context();
      if (!file || !ctx?.getThumbnailUrl || !Object.values(ctx.characters || {}).some(card => card.avatar === file)) return '';
      const url = new URL(ctx.getThumbnailUrl('avatar', file), host.location.href);
      return url.origin === host.location.origin ? url.href : '';
    },
    dispose() { if (dead) return; dead = true; life.abort(); generation++; subscribers.clear(); removers.forEach(fn => fn()); },
  };
}
