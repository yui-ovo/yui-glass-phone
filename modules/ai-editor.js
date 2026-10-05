import { clone, sameJson, validateMaterials } from './contacts.js';
import { worldbookChoices, importWorldbook, worldbookLabel, phoneWorldbooks, addPhoneWorldbook, removePhoneWorldbook } from './worldbooks.js';
import { AI_KEY, DEFAULT_PROMPT, defaultConfig, readConfig, saveConfig, apiRequest, currentPersona, materialKey, worldEntries, materialSnapshot } from './ai.js';

export function apiSettings({ win, base, el, button, openPresets }) {
  const { wrap, scroll } = base('独立 API', 'settings');
  let draft, error = '', active = true, task, savedRaw;
  try { savedRaw = win.localStorage.getItem(AI_KEY); } catch { error = '无法读取本机设置存储'; }
  try { draft = readConfig(win); } catch (e) { draft = defaultConfig(); error = e.message; }
  let baseline = clone(draft);
  scroll.append(el('p', 'profile-help', '使用兼容 OpenAI 的聊天接口。密钥仅保存在此设备的酒馆站点存储中；不会使用或更改酒馆的 API 配置。接口需允许浏览器跨域访问。'));
  const status = el('p', 'profile-status', error); status.setAttribute('role', 'status');
  function field(parent, labelText, key, type = 'text') {
    const label = el('label', 'profile-label', labelText), input = el('input'); input.type = type; input.value = draft[key]; input.autocomplete = 'off'; input.setAttribute('aria-label', labelText);
    input.oninput = () => { draft[key] = type === 'number' ? Number(input.value) : input.value; status.textContent = '设置尚未保存'; };
    label.append(input); parent.append(label); return input;
  }
  const address = field(scroll, 'API 地址', 'baseUrl', 'url'); address.placeholder = 'https://example.com/v1';
  field(scroll, 'API 密钥', 'apiKey', 'password');
  const model = field(scroll, '模型名称', 'model'), choices = el('select'); choices.setAttribute('aria-label', '可用模型'); choices.hidden = true;
  choices.onchange = () => { if (choices.value) { draft.model = choices.value; model.value = choices.value; status.textContent = '模型已选择，尚未保存'; } }; scroll.append(choices);
  const advanced = el('details', 'profile-trace'); advanced.append(el('summary', '', '高级设置'));
  const temperature = field(advanced, '温度', 'temperature', 'number'); temperature.min = '0'; temperature.max = '2'; temperature.step = '0.1';
  const tokens = field(advanced, '输出长度上限', 'maxTokens', 'number'); tokens.min = '64'; tokens.max = '8192';
  const count = field(advanced, '携带最近消息条数', 'historyCount', 'number'); count.min = '1'; count.max = '200'; scroll.append(advanced);
  const timeout = field(advanced, '等待时间（秒）', 'timeoutSeconds', 'number'); timeout.min = '30'; timeout.max = '600';
  scroll.append(button('管理聊天预设',openPresets),el('p','profile-help','前置要求和聊天风格统一在聊天预设中编辑。旧自定义提示词会保留为“原有提示词”；首次保存预设后使用预设库。'));
  async function run(kind) {
    if (task) return; const controller = new AbortController(); task = controller; status.textContent = kind === 'models' ? '正在读取模型…' : '正在测试连接…';
    try {
      const result = await apiRequest(win, clone(draft), kind, [{ role: 'user', content: '请回复 OK' }], controller.signal);
      if (!active || task !== controller) return;
      if (kind === 'models') { choices.replaceChildren(); const placeholder = el('option', '', '请选择模型'); placeholder.value = ''; choices.append(placeholder); for (const id of result) { const option = el('option', '', id); option.value = id; choices.append(option); } choices.hidden = false; status.textContent = `已读取 ${result.length} 个模型，也可手动填写`; }
      else status.textContent = '连接测试成功；本次仅发送测试文字，没有发送人物或聊天资料';
    } catch (e) { if (active && task === controller) status.textContent = e.message; }
    finally { if (task === controller) task = undefined; }
  }
  scroll.append(button('获取模型列表', () => void run('models')), button('测试连接', () => void run('test')),
    el('p', 'profile-help', '测试连接会发送一条简短请求，可能产生接口费用。正式回复会发送当前人物资料、当前用户人设、勾选的世界书资料和最近的手机会话。'),
    button('停止测试', () => task?.abort()), status,
    button('保存 API 设置', () => {
      try {
        if (task) throw Error('请等待测试完成或停止测试后保存');
        if (win.localStorage.getItem(AI_KEY) !== savedRaw) throw Error('API 设置已被其他窗口修改，请返回后重新打开，未覆盖');
        draft = saveConfig(win, draft); baseline = clone(draft); savedRaw = win.localStorage.getItem(AI_KEY); status.textContent = 'API 设置已保存在本机';
      } catch (e) { status.textContent = e.message; }
    }, 'profile-action primary'));
  return { wrap, editor: { saving: () => false, dirty: () => !!task || !sameJson(draft, baseline), suspend() { task?.abort(); }, dispose() { active = false; task?.abort(); } } };
}

// Books are added independently of the snapshots selected for AI replies.
export function materialEditor({ win, scroll, draft, el, button, current, status }) {
  let active = true, busy = false, ticket = 0, mode = '';
  const cache = new Map(), opened = new Set(), loaded = new Set();
  const section = el('details', 'profile-trace'), saved = el('div', 'worldbook-results');
  const summary = el('p', 'material-summary'), notice = el('p', 'profile-help worldbook-notice'); notice.setAttribute('role', 'status');
  const choices = el('div', 'worldbook-sources'), picker = el('div', 'worldbook-picker'); picker.hidden = true;
  const books = el('select', 'worldbook-select'); books.setAttribute('aria-label', '选择世界书');
  const add = button('添加这本世界书', () => void addSelected(), 'worldbook-source');
  picker.append(books, add);
  const file = el('input', 'worldbook-file'); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true; file.setAttribute('aria-label', '导入世界书文件');
  const isCurrent = () => active && current();
  const selectedItem = entry => (draft.roleplayMaterials || []).find(item => materialKey(item) === materialKey(entry));
  const included = entry => !!selectedItem(entry) && !(draft.aiExcludedMaterials || []).includes(materialKey(entry));
  const changed = message => { status.textContent = message + '，保存人物后生效'; notice.textContent = status.textContent; };
  section.append(el('summary', '', 'AI 回复参考 · 世界书'), el('p', 'profile-help', '先添加世界书，再展开勾选用于手机回复的条目。保存人物后生效；移除只影响此人物的小手机参考，酒馆原书不变。'));
  function refresh() {
    const selected = (draft.roleplayMaterials || []).filter(included);
    summary.textContent = '已选 ' + selected.length + ' 条 · 共 ' + selected.reduce((n, item) => n + item.content.length, 0) + ' 字';
    for (const check of section.querySelectorAll('[data-material-key]')) {
      const item = (draft.roleplayMaterials || []).find(item => materialKey(item) === check.dataset.materialKey);
      check.checked = !!item && included(item); check.disabled = busy || check.dataset.empty === 'true';
    }
    for (const control of section.querySelectorAll('button,select,input[type=file]')) control.disabled = busy;
    for (const count of saved.querySelectorAll('[data-world-count]')) {
      const world = count.dataset.worldCount;
      count.textContent = '已选 ' + selected.filter(item => item.world === world).length + ' 条';
    }
    const exists = books.value && phoneWorldbooks(draft).some(book => book.world === books.value);
    add.textContent = exists ? '已添加' : '添加这本世界书'; add.disabled = busy || !books.value || exists;
  }
  async function work(fn) {
    if (busy || !isCurrent()) return;
    busy = true; const task = ++ticket; refresh();
    try { await fn(() => isCurrent() && task === ticket); }
    catch (e) { if (isCurrent() && task === ticket) { status.textContent = e.message; notice.textContent = e.message; } }
    finally { if (isCurrent() && task === ticket) { busy = false; refresh(); } }
  }
  function row(entry) {
    const item = selectedItem(entry) || entry, line = el('div', 'worldbook-entry'), check = el('input');
    check.type = 'checkbox'; check.dataset.materialKey = materialKey(entry); check.dataset.empty = String(!item.content.trim());
    check.setAttribute('aria-label', '参考：' + worldbookLabel(entry.world) + ' · ' + (item.title || item.uid));
    const detail = el('details'), title = (item.title || item.uid) + (entry.disabled ? '（原书已禁用）' : '') + (!item.content.trim() ? '（空条目）' : '');
    detail.append(el('summary', '', title), el('p', 'profile-material', item.content));
    check.onchange = () => {
      const wanted = check.checked;
      if (busy || !isCurrent()) { refresh(); return; }
      void work(async valid => {
        let linked = selectedItem(entry);
        if (wanted && !linked) {
          const snapshot = await materialSnapshot(win, entry); if (!valid()) return;
          const next = [...(draft.roleplayMaterials || []), snapshot]; validateMaterials(next); draft.roleplayMaterials = next; linked = snapshot;
        }
        if (!valid() || !linked) return;
        const key = materialKey(linked), excluded = new Set(draft.aiExcludedMaterials || []);
        wanted ? excluded.delete(key) : excluded.add(key); draft.aiExcludedMaterials = [...excluded];
        changed('参考条目已修改');
      });
    };
    line.append(check, detail); return line;
  }
  function renderBooks() {
    saved.replaceChildren();
    const list = phoneWorldbooks(draft);
    if (!list.length) saved.append(el('p', 'profile-help', '尚未添加世界书'));
    for (const book of list) {
      const group = el('details', 'worldbook-book'); group.dataset.world = book.world; group.open = opened.has(book.world);
      const head = el('summary', 'worldbook-heading'), count = el('span', 'worldbook-count'); count.dataset.worldCount = book.world;
      head.append(el('span', 'worldbook-name', worldbookLabel(book.world)), count); group.append(head);
      const content = el('div', 'worldbook-book-content');
      const entries = [...(cache.get(book.world) || book.entries || [])];
      const keys = new Set(entries.map(materialKey));
      for (const item of draft.roleplayMaterials || []) if (item.world === book.world && !keys.has(materialKey(item))) entries.push(item);
      const tools = el('div', 'worldbook-book-tools');
      if (book.kind !== 'file') tools.append(button('读取条目', () => void readBook(book), 'worldbook-source'));
      const remove = button('移除', () => { if (!busy && isCurrent()) { confirm.hidden = false; remove.hidden = true; } }, 'worldbook-remove'); remove.setAttribute('aria-label', '移除世界书：' + worldbookLabel(book.world));
      const confirm = el('div', 'worldbook-remove-confirm'); confirm.hidden = true;
      confirm.append(el('p', 'profile-help', '从此人物的手机参考中移除整本书及已选条目？'), button('确认移除', () => {
        if (busy || !isCurrent()) return;
        removePhoneWorldbook(draft, book.world); opened.delete(book.world); cache.delete(book.world); loaded.delete(book.world);
        changed('世界书已移除'); renderBooks();
      }, 'worldbook-source'), button('保留', () => { confirm.hidden = true; remove.hidden = false; }, 'worldbook-source'));
      tools.append(remove); content.append(tools, confirm);
      if (book.kind === 'file' && !book.entries) content.append(el('p', 'profile-help', '旧资料只保留已选快照，重新导入同一文件可补齐其他条目。'));
      if (!entries.length) content.append(el('p', 'profile-help', loaded.has(book.world) || book.entries ? '这本世界书没有条目' : '展开后读取条目；读取失败时保留已有资料。'));
      for (const entry of entries) content.append(row(entry));
      group.append(content);
      group.ontoggle = () => {
        if (!isCurrent() || !group.isConnected) return;
        group.open ? opened.add(book.world) : opened.delete(book.world);
        if (group.open && book.kind !== 'file' && !loaded.has(book.world) && !busy) void readBook(book);
      };
      saved.append(group);
    }
    refresh();
  }
  async function readBook(book) {
    await work(async valid => {
      notice.textContent = '正在读取世界书条目…';
      const available = await worldbookChoices(win); if (!valid()) return;
      if (![...available.current, ...available.unbound].includes(book.world)) throw Error(available.warning || '此书已不可用或绑定其他角色；已选快照保留，可移除关联');
      const entries = await worldEntries(win, book.world); if (!valid()) return;
      cache.set(book.world, entries); loaded.add(book.world); renderBooks(); notice.textContent = '条目已读取，请勾选需要的内容。原有快照保持不变。';
    });
  }
  function browse(kind) {
    void work(async valid => {
      picker.hidden = true; books.replaceChildren(); notice.textContent = '正在核对世界书绑定…';
      const available = await worldbookChoices(win); if (!valid()) return;
      mode = kind; const names = available[kind];
      for (const name of names) { const option = el('option', '', name); option.value = name; books.append(option); }
      picker.hidden = !names.length;
      notice.textContent = available.warning || (names.length ? '已找到 ' + names.length + ' 本' + (kind === 'current' ? '当前角色世界书' : '其他世界书') + '，选择后点击添加。' : '没有可添加的世界书');
    });
  }
  async function addSelected() {
    const name = books.value, kind = mode;
    await work(async valid => {
      const available = await worldbookChoices(win); if (!valid()) return;
      if (!available[kind]?.includes(name)) throw Error(available.warning || '这本书的绑定已变化，请重新选择');
      notice.textContent = '正在添加世界书…';
      const entries = await worldEntries(win, name); if (!valid()) return;
      addPhoneWorldbook(draft, { world: name, kind: kind === 'current' ? 'current' : 'other' });
      cache.set(name, entries); loaded.add(name); opened.add(name); picker.hidden = true;
      renderBooks(); changed('世界书已添加，请展开勾选条目');
    });
  }
  books.onchange = refresh;
  file.onchange = () => {
    const picked = file.files?.[0]; file.value = ''; if (!picked) return;
    void work(async valid => {
      notice.textContent = '正在读取文件…'; const entries = await importWorldbook(win, picked); if (!valid()) return;
      const world = entries[0].world;
      addPhoneWorldbook(draft, { world, kind: 'file', entries }); opened.add(world); picker.hidden = true;
      renderBooks(); changed('文件已添加，请勾选条目');
    });
  };
  choices.append(button('当前角色世界书', () => browse('current'), 'worldbook-source'), button('添加其他世界书', () => browse('unbound'), 'worldbook-source'), button('导入文件', () => file.click(), 'worldbook-source'));
  section.append(summary, choices, file, notice, picker, saved, el('p', 'profile-help', '最多添加 30 本书；参考快照最多 20 条、共 4 万字。未勾选条目不发送给 AI。导入文件共限 2 MB，酒馆书的未选正文不复制保存。'));
  scroll.append(section); renderBooks();
  return { busy: () => busy, dispose() { active = false; ticket++; } };
}

export function personaPreview(win, el) {
  try { const persona = currentPersona(win), details = el('details', 'profile-trace'); details.append(el('summary', '', `当前酒馆人设：${persona.name}`), el('p', 'profile-material', persona.description || '当前人设没有描述')); return details; }
  catch (e) { return el('p', 'profile-help', e.message); }
}
