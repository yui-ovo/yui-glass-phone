import { clone, displayName, newPerson, sameJson } from './contacts.js';
import { readAvatar, loadAvatarUrl } from './avatar.js';
import { createProfileHost } from './host.js';
import { createMessenger } from './messenger.js';
import { latestMessage, forPerson } from './messages.js';
import { mountConversation } from './message-view.js';

// All profile content uses textContent/value. HTML is reserved for fixed shell icons.
export function createDirectory({ window: win, document: doc, navigate, icon, notify }) {
  const host = createProfileHost(win);
  const messenger = createMessenger(win, host);
  let clearMessageView;
  let session, selected, route = 'messages', loadError = '', loading = false, dead = false;
  let generation = 0, controller = new AbortController(), editor, lastFormRoute = 'people';
  function el(tag, cls = '', text) { const node = doc.createElement(tag); node.className = cls; if (text !== undefined) node.textContent = text; return node; }
  function button(text, run, cls = 'profile-action') { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', run); return b; }
  function symbol(name) { const span = el('span', 'menu-icon'); span.innerHTML = icon(name); return span; }
  function go(target) { navigate(target); }
  function toolbar(title, back, action) {
    const bar = el('header', 'toolbar'), b = button('', () => go(back), 'icon-button'); b.setAttribute('aria-label', '返回'); b.innerHTML = icon('back');
    const center = el('div', 'toolbar-title'); center.append(el('h1', '', title));
    bar.append(b, center, action || el('span', 'toolbar-spacer')); return bar;
  }
  function base(title, back = 'home', action) { const wrap = el('div', 'directory-view'), scroll = el('div', 'social-scroll directory-scroll'); wrap.append(toolbar(title, back, action), scroll); return { wrap, scroll }; }
  function avatar(person) {
    const span = el('span', 'avatar sage', (person.name || '我').slice(0, 1)); span.setAttribute('aria-hidden', 'true');
    const source = host.avatar(person);
    if (source) { const image = el('img'); image.alt = ''; image.referrerPolicy = 'no-referrer'; image.src = source; image.onerror = () => image.remove(); span.append(image); }
    return span;
  }
  const relationship = p => p.relation.friend ? '已是好友' : p.relation.known ? '认识但未加好友' : '尚不认识';
  function empty(scroll, text) { scroll.append(el('p', 'directory-empty', text)); }
  function personRow(person, manage = false) {
    const row = button('', () => { selected = person.id; lastFormRoute = manage ? 'people' : 'chat'; go(manage ? 'details' : 'chat'); }, 'contact-row');
    row.setAttribute('aria-label', `${manage ? '编辑' : '打开聊天：'}${displayName(person)}`);
    const history = messenger.history(), latest = history && latestMessage(history, person.id);
    row.dataset.search = `${person.name} ${person.remark} ${!manage && history ? forPerson(history, person.id).map(m => m.text).join(' ') : ''}`.toLowerCase();
    const copy = el('span', 'directory-person'); copy.append(el('strong', '', displayName(person)), el('small', 'message-summary', manage ? relationship(person) : latest ? latest.text.replace(/\s+/g, ' ').slice(0, 80) : history ? '暂无消息' : '消息暂不可读取'));
    row.append(avatar(person), copy, symbol('arrow')); return row;
  }
  function search(scroll) {
    const label = el('label', 'search'), input = el('input'); input.type = 'search'; input.placeholder = '搜索聊天记录或联系人'; input.setAttribute('aria-label', input.placeholder); input.autocomplete = 'off';
    label.append(symbol('search'), input); scroll.append(label);
    input.addEventListener('input', () => { let count = 0; scroll.querySelectorAll('.contact-row').forEach(row => { row.hidden = !row.dataset.search.includes(input.value.trim().toLowerCase()); if (!row.hidden) count++; }); const status = scroll.querySelector('.filter-empty'); if (status) status.hidden = count > 0; });
  }
  async function load() {
    if (loading || dead) return;
    loading = true; loadError = ''; const epoch = generation, signal = controller.signal;
    try { const result = await host.load(signal); if (!dead && epoch === generation) { session = result; await messenger.bind(result, signal); } }
    catch (error) { if (!dead && epoch === generation) loadError = error.message || '资料读取失败，未写入数据'; }
    finally { if (!dead && epoch === generation) { loading = false; navigate(route, false, true); } }
  }
  function clearEditor() { editor?.dispose(); editor = undefined; }
  function editorPage(self = false, freshSource) {
    const original = freshSource !== undefined ? newPerson(freshSource || undefined, freshSource?.name || '') : self ? session.book.self : session.book.people.find(p => p.id === selected);
    if (!original) { const { wrap, scroll } = base('人物资料', 'people'); empty(scroll, '找不到这个人物，请返回人物管理重新选择'); return wrap; }
    const draft = clone(original), captured = session, epoch = generation, signal = controller.signal;
    const { wrap, scroll } = base(self ? '我的名片' : '人物资料', self ? 'me' : lastFormRoute);
    let baseline = clone(original), active = true, busy = false, saving = false, imageTicket = 0, pendingImage;
    let persisted = self ? captured.exists : captured.book.people.some(p => p.id === draft.id);
    const status = el('p', 'profile-status'); status.setAttribute('role', 'status');
    const current = () => active && !dead && generation === epoch && session === captured;
    const inputs = [];
    function field(labelText, value, key, max = 80, multiline = false) {
      const label = el('label', 'profile-label', labelText), input = el(multiline ? 'textarea' : 'input');
      input.value = value; input.maxLength = max; input.setAttribute('aria-label', labelText); if (multiline) input.rows = 3;
      input.addEventListener('input', () => { draft[key] = input.value; status.textContent = '资料已修改，尚未保存'; });
      label.append(input); scroll.append(label); inputs.push(input); return input;
    }
    const preview = button('', () => upload.click(), 'profile-avatar-button'); preview.setAttribute('aria-label', '更换头像'); scroll.append(preview);
    function renderAvatar() { preview.replaceChildren(avatar({ ...draft, name: draft.name || '我' })); }
    field(self ? '我的名字' : '人物名字', draft.name, 'name');
    if (!self) { field('手机备注', draft.remark, 'remark'); field('简短设定', draft.description, 'description', 1000, true); }
    scroll.append(el('p', 'profile-meta', `虚构账号：${draft.account}`));
    if (!self) {
      scroll.append(el('p', 'profile-meta', `来源：${draft.source.name || '手动创建'}`));
      const trace = el('details', 'profile-trace'); trace.append(el('summary', '', '身份与来源'), el('p', 'profile-meta', `人物 ID：${draft.id}\n来源类型：${draft.source.kind}\n来源角色文件：${draft.source.avatarFile || '无'}`)); scroll.append(trace);
      if (freshSource) scroll.append(el('p', 'profile-help', '角色卡标题可能不是人物真名，请确认上面的名字。'));
      const label = el('label', 'profile-label', '开局关系'), preset = el('select'); preset.setAttribute('aria-label', '开局关系');
      for (const [value, text] of [['friend', '已是好友'], ['known', '认识但未加好友'], ['stranger', '尚不认识']]) { const option = el('option', '', text); option.value = value; preset.append(option); }
      preset.value = draft.relation.friend ? 'friend' : draft.relation.known ? 'known' : 'stranger'; label.append(preset); scroll.append(label);
      const knownLabel = el('label', 'profile-check', '已知道对方账号'), known = el('input'); known.type = 'checkbox'; known.checked = draft.relation.accountKnown; known.setAttribute('aria-label', '已知道对方账号'); knownLabel.prepend(known); scroll.append(knownLabel);
      const setRelation = () => { const friend = preset.value === 'friend', isKnown = preset.value !== 'stranger'; draft.relation = { friend, known: isKnown, accountKnown: friend || (isKnown && known.checked) }; knownLabel.hidden = preset.value !== 'known'; status.textContent = '资料已修改，尚未保存'; };
      knownLabel.hidden = preset.value !== 'known'; preset.onchange = setRelation; known.onchange = setRelation;
      scroll.append(el('p', 'profile-help', '登记人物后，只有“已是好友”的人会出现在联系人中。'));
      if (draft.roleplayMaterials?.length) {
        const materials = el('details', 'profile-trace'); materials.append(el('summary', '', `已关联世界书资料 · ${draft.roleplayMaterials.length} 条`));
        for (const item of draft.roleplayMaterials) materials.append(el('h3', 'profile-meta', `${item.world} · ${item.title || item.uid}`), el('p', 'profile-material', item.content));
        materials.append(el('p', 'profile-help', '保存人物会完整保留这些资料。选择和编辑关联将在后续接入。')); scroll.append(materials);
      }
    }
    const uploadLabel = el('label', 'profile-label', '上传头像'), upload = el('input'); upload.type = 'file'; upload.accept = 'image/png,image/jpeg,image/webp'; upload.setAttribute('aria-label', '上传头像'); uploadLabel.append(upload); scroll.append(uploadLabel);
    const urlLabel = el('label', 'profile-label', '头像图片 URL'), url = el('input'); url.type = 'url'; url.maxLength = 2048; url.setAttribute('aria-label', '头像图片 URL'); urlLabel.append(url); scroll.append(urlLabel);
    let baselineUrl = '';
    function setBusy(value) { busy = value; save.disabled = value || saving; }
    async function imageWork(work) {
      const ticket = ++imageTicket; pendingImage?.abort(); pendingImage = new AbortController(); const imageSignal = pendingImage.signal;
      setBusy(true); status.textContent = '正在处理头像…';
      try { const result = await work(imageSignal); if (current() && ticket === imageTicket) { draft.avatar = result; renderAvatar(); status.textContent = '头像已预览，保存后保留'; } }
      catch (error) { if (current() && ticket === imageTicket) status.textContent = error.message; }
      finally { if (current() && ticket === imageTicket) setBusy(false); }
    }
    upload.onchange = () => { const file = upload.files?.[0]; upload.value = ''; if (file) void imageWork(async () => ({ kind: 'upload', value: await readAvatar(file, doc) })); };
    scroll.append(button('加载此头像 URL', () => { void imageWork(async s => ({ kind: 'url', value: await loadAvatarUrl(url.value, doc, s) })); }),
      button('恢复默认头像', () => { imageTicket++; pendingImage?.abort(); setBusy(false); draft.avatar = { kind: 'default', value: '' }; renderAvatar(); status.textContent = '默认头像已预览，保存后保留'; }),
      el('p', 'profile-help', '上传图片在本机处理。外链仅在你点击加载后访问。'));
    const save = button(self ? '保存我的名片' : '保存人物', async () => {
      if (busy || saving || !current()) return;
      const book = clone(captured.book), value = clone(draft); value.name = value.name.trim();
      if (!self) { value.remark = value.remark.trim(); value.description = value.description.trim(); const index = book.people.findIndex(p => p.id === value.id); if (index === -1) book.people.push(value); else book.people[index] = value; }
      else book.self = value;
      saving = true; status.textContent = '正在保存…'; const controls = [...scroll.querySelectorAll('input, textarea, select, button'), save, cancel]; controls.forEach(n => n.disabled = true);
      try { await host.save(captured, book, signal); if (current()) { Object.assign(draft, value); persisted = true; baseline = clone(draft); baselineUrl = url.value; selected = self ? selected : value.id; status.textContent = '已保存到当前存档'; } }
      catch (error) { if (current()) status.textContent = `${error.message || '保存失败'}；草稿仍在此页`; }
      finally { if (current()) { saving = false; controls.forEach(n => n.disabled = false); } }
    }, 'profile-action primary');
    const cancel = button('取消', () => { if (saving) return; clearEditor(); go(self ? 'me' : lastFormRoute); });
    const actions = el('div', 'profile-actions'); actions.append(save, cancel); scroll.append(status, actions);
    renderAvatar();
    editor = { saving: () => saving, dirty: () => !persisted || saving || busy || !sameJson(draft, baseline) || url.value !== baselineUrl,
      dispose() { active = false; imageTicket++; pendingImage?.abort(); }, draft };
    return wrap;
  }
  function render(target) {
    route = target; clearEditor(); clearMessageView?.(); clearMessageView = undefined;
    if (target === 'moments') { const { wrap, scroll } = base('朋友圈'); empty(scroll, '朋友圈功能尚未接入'); return wrap; }
    if (!session) {
      const { wrap, scroll } = base(({ messages: '消息', contacts: '联系人', me: '我', people: '人物管理' })[target] || '人物资料');
      empty(scroll, loadError || '正在读取当前存档…');
      if (loadError) scroll.append(button('重新读取', () => { loadError = ''; void load(); navigate(route, false, true); }));
      else void load(); return wrap;
    }
    if (target === 'details') return editorPage();
    if (target === 'self') return editorPage(true);
    if (target === 'new-card') return editorPage(false, session.snapshot.source);
    if (target === 'new-manual') return editorPage(false, null);
    if (target === 'chat') {
      const person = session.book.people.find(p => p.id === selected && p.relation.friend);
      const more = button('', () => { lastFormRoute = 'chat'; go('details'); }, 'icon-button'); more.setAttribute('aria-label', '聊天资料'); more.innerHTML = icon('more');
      const { wrap, scroll } = base(person ? displayName(person) : '聊天', 'contacts', person ? more : undefined);
      if (person) clearMessageView = mountConversation({wrap, scroll, person, self: session.book.self, messenger, el, button, avatar, icon});
      else empty(scroll, '找不到这个好友，请返回联系人');
      return wrap;
    }
    if (target === 'me') {
      const { wrap, scroll } = base('我'); const self = session.book.self;
      const card = button('', () => go('self'), 'profile-card'); card.setAttribute('aria-label', '我的名片');
      const copy = el('span', 'profile-text'); copy.append(el('strong', '', self.name), el('small', '', `账号 · ${self.account}`)); card.append(avatar(self), copy, symbol('arrow')); scroll.append(card);
      scroll.classList.add('me-page');
      const groups = [
        [['钱包', null, 'wallet']],
        [['收藏', null, 'bookmark'], ['相册', null, 'image'], ['朋友圈', 'moments', 'moments']],
        [['设置', 'settings', 'settings']],
      ];
      for (const entries of groups) {
        const group = el('div', 'glass-menu');
        for (const [label, target, glyph] of entries) {
          const row = button('', () => target ? go(target) : notify(`${label}功能待接入`), 'menu-row');
          row.append(symbol(glyph), el('span', '', label), symbol('arrow')); group.append(row);
        }
        scroll.append(group);
      }
      return wrap;
    }
    if (target === 'add') {
      const { wrap, scroll } = base('登记人物', 'people');
      const card = button('从当前角色卡带入', () => { lastFormRoute = 'people'; go('new-card'); }); card.disabled = !session.snapshot.source;
      scroll.append(card, button('手动创建人物', () => { lastFormRoute = 'people'; go('new-manual'); }), el('p', 'profile-help', '同一存档可以登记多个人物。名字确认后再保存；登记不会自动加好友。'));
      if (!session.snapshot.source) empty(scroll, '当前为群聊，请手动创建人物'); return wrap;
    }
    const manage = target === 'people', title = manage ? '人物管理' : target === 'messages' ? '消息' : '联系人';
    const add = button('', () => go('add'), 'icon-button'); add.setAttribute('aria-label', '登记人物'); add.innerHTML = icon('plus');
    const { wrap, scroll } = base(title, manage ? 'contacts' : 'home', target === 'messages' ? undefined : add);
    search(scroll);
    const list = manage ? session.book.people : session.book.people.filter(p => p.relation.friend);
    if (target === 'messages') {
      const history = messenger.history();
      if (history) list.sort((a, b) => (latestMessage(history, b.id)?.sequence || 0) - (latestMessage(history, a.id)?.sequence || 0));
      if (messenger.status().error) scroll.append(el('p', 'profile-help', messenger.status().error), button('重新读取消息', () => { void messenger.refresh(); }));
    }
    for (const person of list) scroll.append(personRow(person, manage));
    if (!list.length) empty(scroll, manage ? '此存档还没有登记人物' : '此存档暂无好友');
    const noMatch = el('p', 'directory-empty filter-empty', '没有找到相关联系人'); noMatch.hidden = true; scroll.append(noMatch);
    if (target === 'contacts') scroll.append(button('管理剧情人物', () => go('people')));
    if (!manage) clearMessageView = messenger.subscribe(() => navigate(target, false, true));
    return wrap;
  }
  const unsubscribe = host.subscribe(() => {
    const hadDraft = editor?.dirty() || messenger.dirty(); clearEditor(); clearMessageView?.(); clearMessageView = undefined; messenger.reset(); controller.abort(); controller = new AbortController(); generation++; session = undefined; selected = undefined; loading = false; loadError = '';
    if (['chat', 'details', 'new-card', 'new-manual', 'self'].includes(route)) route = 'people';
    navigate(route, false, true);
    notify(hadDraft ? '聊天已切换，未保存修改已取消' : '已切换到当前存档');
  });
  return { render, handles: target => ['messages', 'contacts', 'moments', 'me', 'people', 'add', 'new-card', 'new-manual', 'chat', 'details', 'self'].includes(target),
    dirty: () => !!editor?.dirty() || messenger.dirty(),
    leave(force = false) { if (!force && editor?.saving()) { notify('正在保存，请稍候'); return false; } if (!force && editor?.dirty() && !win.confirm('资料尚未保存，放弃修改并离开？')) return false; clearEditor(); clearMessageView?.(); clearMessageView = undefined; return true; },
    dispose() { dead = true; generation++; clearEditor(); clearMessageView?.(); messenger.reset(); controller.abort(); unsubscribe(); host.dispose(); },
  };
}
