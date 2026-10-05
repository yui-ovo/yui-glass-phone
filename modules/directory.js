import { presetSettings } from './preset-editor.js';
import { clone, displayName, newPerson, sameJson } from './contacts.js';
import { readAvatar, loadAvatarUrl } from './avatar.js';
import { createProfileHost } from './host.js';
import { createMessenger } from './messenger.js';
import { latestMessage, forPerson } from './messages.js';
import { mountConversation } from './message-view.js';
import { apiSettings, materialEditor, personaPreview } from './ai-editor.js';
import { currentPersona } from './ai.js';
import { storyEditor } from './story-editor.js';
import { createStoryBridge } from './story-bridge.js';

// All profile content uses textContent/value. HTML is reserved for fixed shell icons.
export function createDirectory({ window: win, document: doc, navigate, icon, notify, onReplyState }) {
  const host = createProfileHost(win);
  const messenger = createMessenger(win, host);
  const storyBridge = createStoryBridge(win, host, notify);
  let clearMessageView;
  let session, selected, route = 'messages', loadError = '', loading = false, dead = false;
  let generation = 0, controller = new AbortController(), editor, lastFormRoute = 'people', chatBack = 'messages';
  function el(tag, cls = '', text) { const node = doc.createElement(tag); node.className = cls; if (text !== undefined) node.textContent = text; return node; }
  function button(text, run, cls = 'profile-action') { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', run); return b; }
  function symbol(name) { const span = el('span', 'menu-icon'); span.innerHTML = icon(name); return span; }
  function go(target) { navigate(target); }
  function toolbar(title, back, action) {
    const bar = el('header', 'toolbar'), b = button('', () => go(back), 'icon-button'); b.setAttribute('aria-label', '返回'); b.innerHTML = icon('back');
    const center = el('div', 'toolbar-title'); center.append(el('h1', '', title));
    if (action?.classList.contains('toolbar-actions')) bar.classList.add('has-actions');
    bar.append(b, center, action || el('span', 'toolbar-spacer')); return bar;
  }
  function base(title, back = 'home', action) { const wrap = el('div', 'directory-view'), scroll = el('div', 'social-scroll directory-scroll'); wrap.append(toolbar(title, back, action), scroll); return { wrap, scroll }; }
  function listActions(manage, add) {
    const actions = el('div', 'toolbar-actions'), more = el('details', 'toolbar-more');
    const toggle = el('summary', 'icon-button'); toggle.setAttribute('role', 'button');
    toggle.setAttribute('aria-label', manage ? '人物管理更多' : '联系人更多'); toggle.setAttribute('aria-expanded', 'false'); toggle.innerHTML = icon('more');
    const menu = el('div', 'toolbar-popover');
    menu.append(button(manage ? '已删除人物' : '管理剧情人物', () => { more.open = false; go(manage ? 'deleted-people' : 'people'); }, 'toolbar-menu-item'));
    more.append(toggle, menu); actions.append(more, add);
    more.addEventListener('toggle', () => toggle.setAttribute('aria-expanded', String(more.open)));
    actions.addEventListener('keydown', event => { if (event.key === 'Escape' && more.open) { event.preventDefault(); event.stopPropagation(); more.open = false; toggle.focus(); } });
    return actions;
  }
  function avatar(person) {
    const span = el('span', 'avatar sage', (person.name || '我').slice(0, 1)); span.setAttribute('aria-hidden', 'true');
    const source = host.avatar(person);
    if (source) { const image = el('img'); image.alt = ''; image.referrerPolicy = 'no-referrer'; image.src = source; image.onerror = () => image.remove(); span.append(image); }
    return span;
  }
  const relationship = p => p.relation.friend ? '已是好友' : p.relation.known ? '认识但未加好友' : '尚不认识';
  function empty(scroll, text) { scroll.append(el('p', 'directory-empty', text)); }
  function personRow(person, manage = false) {
    const contact = !manage && route === 'contacts';
    const row = button('', () => { selected = person.id; lastFormRoute = manage ? 'people' : contact ? 'contact-card' : 'chat'; chatBack = 'messages'; go(manage ? 'details' : contact ? 'contact-card' : 'chat'); }, 'contact-row');
    row.setAttribute('aria-label', `${manage ? '编辑' : contact ? '查看联系人：' : '打开聊天：'}${displayName(person)}`);
    const history = messenger.history(), latest = history && latestMessage(history, person.id);
    row.dataset.search = `${person.name} ${person.remark} ${!manage && history ? forPerson(history, person.id).map(m => m.text).join(' ') : ''}`.toLowerCase();
    const copy = el('span', 'directory-person'); copy.append(el('strong', '', displayName(person)), el('small', 'message-summary', manage ? relationship(person) : contact ? (person.remark ? `名字：${person.name}` : `账号：${person.account}`) : latest ? latest.text.replace(/\s+/g, ' ').slice(0, 80) : history ? '暂无消息' : '消息暂不可读取'));
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
    const original = freshSource !== undefined ? newPerson(freshSource || undefined, freshSource?.name || '') : self ? session.book.self : session.book.people.find(p => p.id === selected && !p.deletedAt);
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
    const nameField = field(self ? '我的名字' : '人物名字', draft.name, 'name');
    if (!self) {
      field('手机备注', draft.remark, 'remark');
      const persona = field('线上人设（如有）', draft.description, 'description', 1000, true);
      persona.placeholder = '可填写作者设定的线上聊天习惯、语气、表情使用方式等';
    }
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
    }
    scroll.append(personaPreview(win, el));
    const materials = !self ? materialEditor({ win, scroll, draft, el, button, current, status }) : undefined;
    if (!self) storyEditor({win,scroll,draft,book:captured.book,messenger,el,button,current,status});
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
    if (self) scroll.append(button('带入当前酒馆人设的名字和头像', () => {
      let persona; try { persona = currentPersona(win); } catch (e) { status.textContent = e.message; return; }
      draft.name = persona.name; nameField.value = draft.name;
      void imageWork(async imageSignal => {
        const { user_avatar } = await import('/scripts/personas.js');
        if (!current() || imageSignal.aborted) throw Error('操作已取消');
        if (!user_avatar) throw Error('名字已带入，宿主未提供头像；可手动上传');
        const ctx = win.SillyTavern.getContext(), address = new URL(ctx.getThumbnailUrl('persona', user_avatar), win.location.href);
        if (address.origin !== win.location.origin) throw Error('名字已带入，头像地址无法确认；可手动上传');
        const response = await win.fetch(address.href, { signal: imageSignal, credentials: 'same-origin' });
        if (!response.ok) throw Error('名字已带入，头像读取失败；可手动上传');
        return { kind: 'upload', value: await readAvatar(await response.blob(), doc) };
      });
    }));
    scroll.append(button('加载此头像 URL', () => { void imageWork(async s => ({ kind: 'url', value: await loadAvatarUrl(url.value, doc, s) })); }),
      button('恢复默认头像', () => { imageTicket++; pendingImage?.abort(); setBusy(false); draft.avatar = { kind: 'default', value: '' }; renderAvatar(); status.textContent = '默认头像已预览，保存后保留'; }),
      el('p', 'profile-help', '上传图片在本机处理。外链仅在你点击加载后访问。'));
    const save = button(self ? '保存我的名片' : '保存人物', async () => {
      if (busy || saving || !current()) return;
      if (materials?.busy()) { status.textContent = '请等待世界书资料读取完成'; return; }
      const book = clone(captured.book), value = clone(draft); value.name = value.name.trim();
      if (!self) {
        value.remark = value.remark.trim(); value.description = value.description.trim();
        const index = book.people.findIndex(p => p.id === value.id);
        if (persisted && index === -1) { status.textContent = '找不到原人物，已停止保存；请返回人物管理重新读取'; return; }
        if (index === -1) book.people.push(value); else book.people[index] = value;
      }
      else book.self = value;
      saving = true; status.textContent = '正在保存…'; const controls = [...scroll.querySelectorAll('input, textarea, select, button'), save, cancel]; const disabledBefore = controls.map(n=>n.disabled); controls.forEach(n => n.disabled = true);
      try { await host.save(captured, book, signal); storyBridge.invalidate(); if (current()) { Object.assign(draft, value); persisted = true; baseline = clone(draft); baselineUrl = url.value; selected = self ? selected : value.id; status.textContent = '已保存到当前存档'; } }
      catch (error) { if (current()) status.textContent = `${error.message || '保存失败'}；草稿仍在此页`; }
      finally { if (current()) { saving = false; controls.forEach((n,i) => n.disabled = disabledBefore[i]); } }
    }, 'profile-action primary');
    const cancel = button('取消', () => { if (saving) return; clearEditor(); go(self ? 'me' : lastFormRoute); });
    const actions = el('div', 'profile-actions'); actions.append(save, cancel); scroll.append(status, actions);
    if (!self && persisted) scroll.append(button('删除人物', () => go('delete-person'), 'profile-action danger'));
    renderAvatar();
    editor = { saving: () => saving, dirty: () => !persisted || saving || busy || materials?.busy() || !sameJson(draft, baseline) || url.value !== baselineUrl,
      dispose() { active = false; imageTicket++; pendingImage?.abort(); materials?.dispose(); }, draft };
    return wrap;
  }
  function removalPage(restore = false) {
    const captured = session, epoch = generation, signal = controller.signal;
    const person = captured.book.people.find(p => p.id === selected && !!p.deletedAt === restore);
    const back = restore ? 'deleted-people' : 'people';
    const { wrap, scroll } = base(restore ? '恢复人物' : '删除人物', back);
    if (!person) { empty(scroll, '找不到这个人物，请返回重新选择'); return wrap; }
    scroll.append(avatar(person), el('h2', 'person-name', displayName(person)), el('p', 'profile-meta', `账号：${person.account}`));
    scroll.append(el('p', 'profile-help', restore ? '恢复原人物、账号、关系和已保存的消息。' : '将从联系人、消息列表和人物管理中移除。资料和已保存消息保留，可在“人物管理 → ⋯ → 已删除人物”恢复。不会删除酒馆角色卡。'));
    const status = el('p', 'profile-status'); status.setAttribute('role', 'status');
    let busy = false, active = true;
    const current = () => active && !dead && session === captured && generation === epoch;
    const commit = button(restore ? '确认恢复' : '确认删除', async () => {
      if (!current() || busy) return;
      const pending = messenger.draft(person.id);
      if (!restore && (pending.text || pending.operation || pending.editing || pending.quoteId || messenger.status().change)) { status.textContent = '此人物有未发送草稿或未确认消息，请先在聊天页处理后再删除'; return; }
      const book = clone(captured.book), target = book.people.find(p => p.id === person.id);
      if (!target || !!target.deletedAt !== restore) { status.textContent = '人物状态已变化，请返回重新读取'; return; }
      if (restore) delete target.deletedAt; else target.deletedAt = new Date().toISOString();
      busy = true; commit.disabled = true; cancel.disabled = true; status.textContent = '正在保存…';
      try {
        await host.save(captured, book, signal);
        if (current()) { busy = false; go(back); notify(restore ? '人物已恢复' : '人物已移到已删除人物'); }
      } catch (error) { if (current()) status.textContent = `${error.message || '保存未确认'}；如状态不明，请刷新后核对`; }
      finally { if (current()) { busy = false; commit.disabled = false; cancel.disabled = false; } }
    }, `profile-action ${restore ? 'primary' : 'danger'}`);
    const cancel = button('取消', () => { if (!busy) go(back); });
    scroll.append(status, commit, cancel);
    editor = { saving: () => busy, dirty: () => busy, dispose() { active = false; } };
    return wrap;
  }
  function contactCard() {
    const person = session.book.people.find(p => p.id === selected && !p.deletedAt && p.relation.friend);
    const { wrap, scroll } = base('联系人名片', 'contacts');
    if (!person) { empty(scroll, '此人物已不在好友中，请返回联系人或人物管理'); return wrap; }
    scroll.classList.add('person-card-scroll');
    const hero = el('div', 'person-card-hero'), copy = el('div', 'person-card-copy');
    copy.append(el('h2', 'person-name', displayName(person)));
    if (person.remark) copy.append(el('p', 'profile-meta', `名字：${person.name}`));
    copy.append(el('p', 'profile-meta', `账号：${person.account}`)); hero.append(avatar(person), copy); scroll.append(hero);
    const menu = el('div', 'glass-menu');
    for (const [label, action, glyph] of [['朋友圈', () => notify('朋友圈功能尚未接入'), 'moments']]) {
      const row = button('', action, 'menu-row'); row.setAttribute('aria-label', label); row.append(symbol(glyph), el('span', '', label), symbol('arrow')); menu.append(row);
    }
    const send = button('', () => { chatBack = 'contact-card'; go('chat'); }, 'person-card-action'); send.setAttribute('aria-label', '发消息'); send.append(symbol('message'), el('span', '', '发消息'));
    const call = button('', () => notify('音视频通话功能尚未接入'), 'person-card-action'); call.setAttribute('aria-label', '音视频通话'); call.append(symbol('phone'), el('span', '', '音视频通话'));
    const actions = el('div', 'glass-menu'); actions.append(send, call); scroll.append(menu, actions); return wrap;
  }
  function render(target) {
    route = target; clearEditor(); clearMessageView?.(); clearMessageView = undefined;
    if (target === 'preset-settings') { const view = presetSettings({win,profiles:host,base,el,button}); editor=view.editor; return view.wrap; }
    if (target === 'ai-settings') { const view = apiSettings({ win, base, el, button, openPresets:()=>go('preset-settings') }); editor = view.editor; return view.wrap; }
    if (target === 'moments') { const { wrap, scroll } = base('朋友圈'); empty(scroll, '朋友圈功能尚未接入'); return wrap; }
    if (!session) {
      const { wrap, scroll } = base(({ messages: '消息', contacts: '联系人', me: '我', people: '人物管理' })[target] || '人物资料');
      empty(scroll, loadError || '正在读取当前存档…');
      if (loadError) scroll.append(button('重新读取', () => { loadError = ''; void load(); navigate(route, false, true); }));
      else void load(); return wrap;
    }
    if (target === 'details') return editorPage();
    if (target === 'contact-card') return contactCard();
    if (target === 'delete-person') return removalPage();
    if (target === 'restore-person') return removalPage(true);
    if (target === 'deleted-people') {
      const { wrap, scroll } = base('已删除人物', 'people');
      const removed = session.book.people.filter(p => p.deletedAt);
      for (const person of removed) {
        const row = button('', () => { selected = person.id; go('restore-person'); }, 'contact-row'); row.setAttribute('aria-label', `恢复人物：${displayName(person)}`);
        const copy = el('span', 'directory-person'); copy.append(el('strong', '', displayName(person)), el('small', '', `账号：${person.account}`)); row.append(avatar(person), copy, symbol('arrow')); scroll.append(row);
      }
      if (!removed.length) empty(scroll, '暂无已删除人物'); return wrap;
    }
    if (target === 'self') return editorPage(true);
    if (target === 'new-card') {
      const source = session.snapshot.source;
      const existing = source?.avatarFile ? session.book.people.filter(p => p.source.kind === 'card' && p.source.avatarFile === source.avatarFile) : [];
      if (existing.length) {
        const { wrap, scroll } = base('此角色卡已有登记', 'add');
        scroll.append(el('p', 'profile-help', '修改开局关系或资料，请点下面已有的人物。只有这张卡里确实还有另一位人物时，才继续新登记。'));
        for (const person of existing.filter(p => !p.deletedAt)) {
          const row = personRow(person, true);
          row.querySelector('small').textContent = `${relationship(person)} · 账号 ${person.account}`;
          scroll.append(row);
        }
        if (existing.some(p => p.deletedAt)) scroll.append(button('查看已删除人物', () => go('deleted-people')));
        scroll.append(button('登记这张卡里的另一位人物', () => go('new-card-extra')));
        return wrap;
      }
      return editorPage(false, source);
    }
    if (target === 'new-card-extra') return editorPage(false, session.snapshot.source);
    if (target === 'new-manual') return editorPage(false, null);
    if (target === 'chat') {
      const person = session.book.people.find(p => p.id === selected && p.relation.friend && !p.deletedAt);
      const more = button('', () => { lastFormRoute = 'chat'; go('details'); }, 'icon-button'); more.setAttribute('aria-label', '聊天资料'); more.innerHTML = icon('more');
      const { wrap, scroll } = base(person ? displayName(person) : '聊天', chatBack, person ? more : undefined);
      if (person) clearMessageView = mountConversation({wrap, scroll, person, self: session.book.self, messenger, el, button, avatar, icon, onReplyState});
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
    const actions = target === 'messages' ? undefined : listActions(manage, add);
    const { wrap, scroll } = base(title, manage ? 'contacts' : 'home', actions);
    if (actions) wrap.addEventListener('pointerdown', event => { const more = actions.querySelector('details'); if (!more.contains(event.target)) more.open = false; });
    search(scroll);
    const list = session.book.people.filter(p => !p.deletedAt && (manage || p.relation.friend));
    if (target === 'messages') {
      const history = messenger.history();
      if (history) list.sort((a, b) => (latestMessage(history, b.id)?.sequence || 0) - (latestMessage(history, a.id)?.sequence || 0));
      if (messenger.status().error) scroll.append(el('p', 'profile-help', messenger.status().error), button('重新读取消息', () => { void messenger.refresh(); }));
    }
    for (const person of list) scroll.append(personRow(person, manage));
    if (!list.length) empty(scroll, manage ? '此存档还没有登记人物' : '此存档暂无好友');
    const noMatch = el('p', 'directory-empty filter-empty', '没有找到相关联系人'); noMatch.hidden = true; scroll.append(noMatch);
    if (!manage) clearMessageView = messenger.subscribe(() => navigate(target, false, true));
    return wrap;
  }
  const unsubscribe = host.subscribe(() => {
    const hadDraft = editor?.dirty() || messenger.dirty(); clearEditor(); clearMessageView?.(); clearMessageView = undefined; messenger.reset(); controller.abort(); controller = new AbortController(); generation++; session = undefined; selected = undefined; loading = false; loadError = '';
    if (['chat', 'contact-card', 'delete-person', 'restore-person', 'details', 'new-card', 'new-card-extra', 'new-manual', 'self'].includes(route)) route = 'people';
    navigate(route, false, true);
    notify(hadDraft ? '聊天已切换，未保存修改已取消' : '已切换到当前存档');
  });
  return { render, handles: target => ['preset-settings', 'ai-settings', 'messages', 'contacts', 'moments', 'me', 'people', 'add', 'new-card', 'new-card-extra', 'new-manual', 'chat', 'contact-card', 'deleted-people', 'delete-person', 'restore-person', 'details', 'self'].includes(target),
    suspend() { messenger.cancelReply(); editor?.suspend?.(); },
    dirty: () => !!editor?.dirty() || messenger.dirty(),
    leave(force = false) { if (!force && editor?.saving()) { notify('正在保存，请稍候'); return false; } if (!force && editor?.dirty() && !win.confirm('资料尚未保存，放弃修改并离开？')) return false; clearEditor(); clearMessageView?.(); clearMessageView = undefined; return true; },
    dispose() { dead = true; generation++; clearEditor(); clearMessageView?.(); storyBridge.dispose(); messenger.reset(); controller.abort(); unsubscribe(); host.dispose(); },
  };
}
