import { clone, sameJson, validateMaterials } from './contacts.js';
import { worldbookChoices, importWorldbook, worldbookLabel } from './worldbooks.js';
import { AI_KEY, DEFAULT_PROMPT, defaultConfig, readConfig, saveConfig, apiRequest, currentPersona, materialKey, worldEntries, materialSnapshot } from './ai.js';

export function apiSettings({ win, base, el, button }) {
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
  const promptSection = el('details', 'profile-trace'); promptSection.append(el('summary', '', '手机聊天提示词'), el('p', 'profile-help', '独立用于手机聊天，不读取酒馆正文预设。这里设置通用聊天风格，每个人的习惯仍填在人物的线上人设中。保存 API 设置后生效。'));
  const label = el('label', 'profile-label', '提示词内容'), prompt = el('textarea'); prompt.rows = 8; prompt.maxLength = 12000; prompt.value = draft.prompt; prompt.setAttribute('aria-label', '提示词内容');
  prompt.oninput = () => { draft.prompt = prompt.value; status.textContent = '提示词尚未保存'; }; label.append(prompt);
  promptSection.append(label, button('恢复默认提示词', () => { prompt.value = DEFAULT_PROMPT; draft.prompt = DEFAULT_PROMPT; status.textContent = '默认提示词已填入，保存后生效'; })); scroll.append(promptSection);
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

// Selection only changes this person's saved snapshots and exclusions.
export function materialEditor({ win, scroll, draft, el, button, current, status }) {
  let active = true, busy = false, ticket = 0, displayed = [], mode = '';
  const section = el('details', 'profile-trace'), saved = el('div'), results = el('div', 'worldbook-results');
  const summary = el('p', 'material-summary'), notice = el('p', 'profile-help worldbook-notice'); notice.setAttribute('role', 'status');
  const choices = el('div', 'worldbook-sources'), books = el('select', 'worldbook-select'); books.hidden = true; books.setAttribute('aria-label', '选择世界书');
  const file = el('input', 'worldbook-file'); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true; file.setAttribute('aria-label', '导入世界书文件');
  const isCurrent = () => active && current();
  const selectedItem = entry => (draft.roleplayMaterials || []).find(item => materialKey(item) === materialKey(entry));
  const included = entry => !!selectedItem(entry) && !(draft.aiExcludedMaterials || []).includes(materialKey(entry));
  section.append(el('summary', '', 'AI 回复参考 · 世界书'), el('p', 'profile-help', '只把勾选条目用于此人物的手机回复，保存人物后生效。正文世界书不受影响；已添加的内容保留快照。'));
  function refresh() {
    const selected = (draft.roleplayMaterials || []).filter(included);
    summary.textContent = '已选 ' + selected.length + ' 条 · 共 ' + selected.reduce((n, item) => n + item.content.length, 0) + ' 字';
    for (const check of section.querySelectorAll('[data-material-key]')) {
      const item = (draft.roleplayMaterials || []).find(item => materialKey(item) === check.dataset.materialKey);
      check.checked = !!item && included(item); check.disabled = busy || check.dataset.empty === 'true';
    }
    for (const control of choices.querySelectorAll('button')) control.disabled = busy;
    books.disabled = busy; file.disabled = busy;
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
        status.textContent = '参考资料已修改，保存人物后生效'; notice.textContent = status.textContent;
      });
    };
    line.append(check, detail); return line;
  }
  function renderSaved() {
    saved.replaceChildren();
    const visible = new Set(displayed.map(materialKey)), items = (draft.roleplayMaterials || []).filter(item => !visible.has(materialKey(item)));
    if (items.length) {
      const group = el('details', 'worldbook-saved'); group.open = true; group.append(el('summary', '', '已添加的参考'));
      let world;
      for (const item of items) { if (item.world !== world) { world = item.world; group.append(el('p', 'profile-help', worldbookLabel(world))); } group.append(row(item)); }
      saved.append(group);
    }
  }
  function showEntries(entries, emptyMessage = '这本世界书没有条目') {
    displayed = entries; results.replaceChildren();
    if (entries.length) { results.append(el('p', 'profile-help', worldbookLabel(entries[0].world))); for (const entry of entries) results.append(row(entry)); }
    else if (emptyMessage) results.append(el('p', 'profile-help', emptyMessage));
    renderSaved(); refresh();
  }
  function fillBooks(names) {
    books.replaceChildren(); for (const name of names) { const option = el('option', '', name); option.value = name; books.append(option); } books.hidden = !names.length;
  }
  function browse(kind) {
    void work(async valid => {
      fillBooks([]); showEntries([], ''); notice.textContent = '正在核对世界书绑定…'; const available = await worldbookChoices(win); if (!valid()) return;
      mode = kind; const names = available[kind]; fillBooks(names);
      notice.textContent = available.warning || (names.length ? '已找到 ' + names.length + ' 本' + (kind === 'current' ? '当前角色世界书' : '其他世界书') + '，可选择书名并勾选条目。' : kind === 'current' ? '当前角色没有已确认的绑定世界书' : '没有可添加的其他世界书（已排除角色绑定）');
      if (names.length) { const entries = await worldEntries(win, names[0]); if (valid()) showEntries(entries); }
    });
  }
  books.onchange = () => {
    const name = books.value, kind = mode;
    void work(async valid => {
      showEntries([], ''); notice.textContent = '正在读取所选世界书…'; const available = await worldbookChoices(win); if (!valid()) return;
      if (!available[kind]?.includes(name)) { fillBooks([]); throw Error(available.warning || '这本书的绑定已变化，请重新选择'); }
      const entries = await worldEntries(win, name); if (valid()) { showEntries(entries); notice.textContent = '已读取条目，勾选后保存人物即可。'; }
    });
  };
  file.onchange = () => {
    const picked = file.files?.[0]; file.value = ''; if (!picked) return;
    void work(async valid => {
      notice.textContent = '正在读取文件…'; const entries = await importWorldbook(win, picked); if (!valid()) return;
      mode = 'file'; fillBooks([]); showEntries(entries);
      notice.textContent = '文件已预览。勾选后保存人物，只保存所选内容；不会安装到酒馆或自动启用条目。';
    });
  };
  choices.append(button('当前角色世界书', () => browse('current'), 'worldbook-source'), button('添加其他世界书', () => browse('unbound'), 'worldbook-source'), button('导入文件', () => file.click(), 'worldbook-source'));
  section.append(summary, choices, file, notice, books, results, saved, el('p', 'profile-help', '最多保留 20 条、共 4 万字；导入文件最多 2 MB、500 条。取消勾选保留原快照，不计入本次回复字数。'));
  scroll.append(section); renderSaved(); refresh();
  return { busy: () => busy, dispose() { active = false; ticket++; } };
}

export function personaPreview(win, el) {
  try { const persona = currentPersona(win), details = el('details', 'profile-trace'); details.append(el('summary', '', `当前酒馆人设：${persona.name}`), el('p', 'profile-material', persona.description || '当前人设没有描述')); return details; }
  catch (e) { return el('p', 'profile-help', e.message); }
}
