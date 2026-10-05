import { defaultMemoryPolicy } from './memory-policy.js';
import { memoryConnection, memoryPeople, readMemoryReference } from './memory-bridge.js';

export function memoryEditor({win,scroll,draft,el,button,current,status}) {
  const policy=structuredClone(draft.memoryLink || defaultMemoryPolicy());
  const section=el('details','profile-trace memory-settings'), content=el('div','memory-options');
  const info=el('p','profile-help'), result=el('div','memory-preview');info.setAttribute('role','status');result.setAttribute('role','status');
  section.append(el('summary','','记忆 · 千千结'));
  const changed=()=>{draft.memoryLink=structuredClone(policy);status.textContent='记忆设置尚未保存';result.replaceChildren();};
  function toggle(label,key,parent) {
    const row=el('label','memory-toggle'),text=el('span','',label),control=el('span','preset-switch'),input=el('input');
    input.type='checkbox';input.checked=policy[key];input.setAttribute('aria-label',label);control.append(input,el('span','preset-switch-track'));row.append(text,control);parent.append(row);
    input.onchange=()=>{if(!current())return;policy[key]=input.checked;changed();};return input;
  }
  const enabled=toggle('参考千千结记忆','enabled',section);
  enabled.onchange=()=>{
    if(!current())return;
    if(enabled.checked && !policy.chatId){try{policy.chatId=memoryConnection(win).identity.qqjChatId;}catch(e){enabled.checked=false;info.textContent=e.message;return;}}
    policy.enabled=enabled.checked;content.hidden=!policy.enabled;changed();if(policy.enabled)refresh();
  };
  section.append(info,content);content.hidden=!policy.enabled;
  const actions=el('div','memory-actions');
  const select=el('select');select.setAttribute('aria-label','关联千千结人物');
  function renderOptions(people=[]) {
    select.replaceChildren();const none=el('option','','请选择对应人物');none.value='';select.append(none);
    for(const person of people){const option=el('option','',`${person.name} · ${person.id.slice(-6)}`);option.value=person.id;select.append(option);}
    if(policy.entityId && !people.some(p=>p.id===policy.entityId)){const option=el('option','','已保存的关联（请刷新核对）');option.value=policy.entityId;select.append(option);}
    select.value=policy.entityId;
  }
  const refresh=()=>{
    if(!current())return;
    try {const data=memoryPeople(win);if(policy.chatId && data.identity.qqjChatId!==policy.chatId)throw Error('关联存档已变化，请先点击“关联当前存档”');renderOptions(data.people);info.textContent=data.people.length?`千千结已连接 · 可选 ${data.people.length} 人`:'千千结已连接，人物档案和状态尚未加载；请在千千结中打开后刷新';}
    catch(e){info.textContent=e.message;}
  };
  actions.append(button('刷新人物',refresh,'preset-button'),button('关联当前存档',()=>{
    if(!current())return;
    try{const id=memoryConnection(win).identity.qqjChatId;if(id!==policy.chatId){policy.chatId=id;policy.entityId='';changed();}renderOptions();refresh();}
    catch(e){info.textContent=e.message;}
  },'preset-button'));
  const label=el('label','memory-label','对应人物');label.append(select);select.onchange=()=>{if(!current())return;policy.entityId=select.value;changed();};renderOptions();
  content.append(actions,label);
  toggle('剧情记忆','plot',content);toggle('人物档案','profile',content);toggle('人物状态','state',content);
  content.append(el('p','profile-help','剧情记忆采用最近为正文准备的材料，可能已含人物状态；人物档案、状态只读上方绑定的人物。仅选剧情记忆时可不绑定人物。'));
  const limitLabel=el('label','memory-label','参考字数上限'),frame=el('span','memory-input-frame'),limit=el('input');limit.type='number';limit.min='1000';limit.max='30000';limit.step='1000';limit.value=policy.maxChars;limit.setAttribute('aria-label','千千结参考字数上限');limit.oninput=()=>{if(!current())return;policy.maxChars=Number(limit.value);changed();};frame.append(limit);limitLabel.append(frame);content.append(limitLabel);
  content.append(button('预览本次记忆',()=>{
    if(!current())return;result.replaceChildren();
    try{const reference=readMemoryReference(win,{...draft,memoryLink:policy});result.append(el('p','profile-help',`本次参考 ${reference.text.length} 字 · 发送时重新读取`),el('pre','memory-text',reference.text));}
    catch(e){result.append(el('p','profile-help',e.message));}
  },'preset-button'),result,el('p','profile-help','保存人物后生效。超出上限或所选记忆不可用时会提示并停止请求；可关闭联动继续聊天。只读取已有材料，不触发总结。'));
  section.addEventListener('toggle',()=>{if(section.open && current()){try{memoryConnection(win);info.textContent='千千结已连接';}catch(e){info.textContent=e.message;}}});
  scroll.append(section);
}
