import { clone, sameJson, validateMaterials } from './contacts.js';
import { AI_KEY, defaultConfig, readConfig, saveConfig, apiRequest, currentPersona, materialKey, worldNames, worldEntries, materialSnapshot } from './ai.js';

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

// Selected snapshots remain in roleplayMaterials. Exclusion changes only the prompt,
// never erases previously linked material or silently refreshes it from another book.
export function materialEditor({ win, scroll, draft, el, button, current, status }) {
  let active = true, busy = false, ticket = 0;
  const section = el('details', 'profile-trace'), saved = el('div'), results = el('div');
  section.append(el('summary', '', 'AI 回复参考 · 世界书'), el('p', 'profile-help', '勾选要参考的条目；取消勾选只排除本次人物的回复参考，原关联资料仍保留。最多关联 20 条、共 4 万字。已关联条目使用保存时的内容快照。'));
  const isCurrent = () => active && current();
  function setExcluded(item, excluded) {
    const key = materialKey(item), keys = new Set(draft.aiExcludedMaterials || []); excluded ? keys.add(key) : keys.delete(key); draft.aiExcludedMaterials = [...keys]; status.textContent = '参考资料已修改，保存人物后生效';
  }
  function renderSaved() {
    saved.replaceChildren();
    for (const item of draft.roleplayMaterials || []) {
      const label = el('label', 'profile-check', `${item.world} · ${item.title || item.uid}`), check = el('input'); check.type = 'checkbox'; check.checked = !(draft.aiExcludedMaterials || []).includes(materialKey(item)); check.setAttribute('aria-label', `参考：${item.world} · ${item.title || item.uid}`);
      check.onchange = () => setExcluded(item, !check.checked); label.prepend(check);
      const detail = el('details', 'profile-trace'); detail.append(el('summary', '', '查看已保存内容'), el('p', 'profile-material', item.content)); saved.append(label, detail);
    }
    if (!draft.roleplayMaterials?.length) saved.append(el('p', 'profile-help', '尚未选择世界书条目'));
  }
  const books = el('select'); books.setAttribute('aria-label', '选择世界书');
  const choose = button('读取世界书列表', () => { try { const names = worldNames(win); books.replaceChildren(); for (const name of names) { const option = el('option', '', name); option.value = name; books.append(option); } status.textContent = names.length ? '选择一本书，再点打开条目' : '酒馆中暂无世界书'; } catch (e) { status.textContent = e.message; } });
  const open = button('打开条目', async () => {
    if (busy) return; busy = true; const task = ++ticket; results.replaceChildren(); status.textContent = '正在读取所选世界书…';
    try {
      const entries = await worldEntries(win, books.value); if (!isCurrent() || task !== ticket) return;
      for (const entry of entries) {
        const row = el('details', 'profile-trace'); row.append(el('summary', '', `${entry.title || entry.uid}${entry.disabled ? '（世界书中已禁用）' : ''}`), el('p', 'profile-material', entry.content));
        row.append(button('添加此条参考', async () => {
          if (busy || !isCurrent()) return; busy = true;
          try {
            if ((draft.roleplayMaterials || []).some(item => materialKey(item) === materialKey(entry))) throw Error('此条已关联，请在上方勾选；保留原内容快照');
            const item = await materialSnapshot(win, entry); if (!isCurrent()) return;
            const next = [...(draft.roleplayMaterials || []), item]; validateMaterials(next); draft.roleplayMaterials = next; setExcluded(item, false); renderSaved();
          } catch (e) { if (isCurrent()) status.textContent = e.message; }
          finally { busy = false; }
        })); results.append(row);
      }
      status.textContent = `已读取 ${entries.length} 条；仅添加你需要的条目`;
    } catch (e) { if (isCurrent() && task === ticket) status.textContent = e.message; }
    finally { if (task === ticket) busy = false; }
  });
  section.append(saved, choose, books, open, results); scroll.append(section); renderSaved();
  return { busy: () => busy, dispose() { active = false; ticket++; } };
}

export function personaPreview(win, el) {
  try { const persona = currentPersona(win), details = el('details', 'profile-trace'); details.append(el('summary', '', `当前酒馆人设：${persona.name}`), el('p', 'profile-material', persona.description || '当前人设没有描述')); return details; }
  catch (e) { return el('p', 'profile-help', e.message); }
}
