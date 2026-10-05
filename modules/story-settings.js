import { clone, sameJson } from './contacts.js';
import { defaultClockSettings, storyTime, clockDisplay } from './phone-clock.js';
import { defaultSyncSettings, pendingSupplement, formatSupplement, validateSupplementSize } from './supplement.js';
import { createMessageStore } from './message-host.js';
export function storySettings({win,host,session,signal,base,el,button,bridge,kind,onSaved}) {
  const {wrap,scroll}=base(kind==='clock'?'剧情时间':'待同步补记','settings');wrap.classList.add('story-manager');
  let active=true,busy=false,baseline=clone(session.book),draft=clone(session.book),rows=[];
  const status=el('p','profile-status');status.setAttribute('role','status');
  const current=()=>active&&!signal.aborted;
  const change=()=>{status.textContent='设置尚未保存';};
  if(kind==='clock'){
    draft.phoneClock=clone(draft.phoneClock||defaultClockSettings());baseline=clone(draft);
    const label=el('label','memory-label','时间来源'),mode=el('select');mode.setAttribute('aria-label','时间来源');
    for(const [value,text] of [['story','剧情时间'],['device','设备时间']]){const option=el('option','',text);option.value=value;mode.append(option);}mode.value=draft.phoneClock.mode;label.append(mode);scroll.append(label);
    const display=el('p','profile-material'),refresh=()=>{const data=clockDisplay(win,draft);display.textContent=`${data.date} ${data.time}\n${data.note}`;};mode.onchange=()=>{draft.phoneClock.mode=mode.value;change();refresh();};refresh();scroll.append(display,el('p','profile-help','读取最新正文的结束时间；缺失时沿用同一存档此前已确认的时间。不会随现实等待自动推进。新正文出现后会恢复自动同步。'));
    const manual=el('details','profile-trace');manual.append(el('summary','','手动校正'));const inputs={};
    for(const [key,text] of [['date','剧情日期'],['time','剧情时间'],['weekday','剧情星期（可不填）']]){const label=el('label','memory-label',text),frame=el('span','memory-input-frame'),input=el('input');input.setAttribute('aria-label',text);input.maxLength=200;input.value=storyTime(win,draft)?.[key]||'';inputs[key]=input;frame.append(input);label.append(frame);manual.append(label);input.oninput=()=>{draft.phoneClock.manual={date:inputs.date.value,time:inputs.time.value,weekday:inputs.weekday.value,anchor:storyTime(win,{...draft,phoneClock:{mode:'story',manual:null}}).anchor};change();refresh();};}
    manual.append(button('恢复自动读取',()=>{draft.phoneClock.manual=null;change();refresh();},'preset-button'));scroll.append(manual);
  }else{
    draft.storySync=clone(draft.storySync||defaultSyncSettings());baseline=clone(draft);
    const row=el('label','memory-toggle','保存手机补记到正文'),check=el('input');check.type='checkbox';check.checked=draft.storySync.enabled;check.setAttribute('aria-label','保存手机补记到正文');row.append(check);check.onchange=()=>{draft.storySync.enabled=check.checked;change();};scroll.append(row,el('p','profile-help','启用后，把所选人物的新手机消息在下次正文生成前保存到上一条 AI 楼末尾。千千结的保留包裹符请填 content,yui_phone。请先在人物资料的“剧情衔接”中勾选分享。取消勾选的消息保持排除，重新勾选后才会同步。'));
    const list=el('div','supplement-pending'),preview=el('pre','memory-text');preview.hidden=true;
    async function refresh(){if(busy||!current())return;busy=true;try{const history=await createMessageStore(win,host,session,signal).read();const next=await pendingSupplement(win,draft,history,win.SillyTavern.getContext().chat);host.assertSession(session,signal);if(!current())return;rows=next;list.replaceChildren();for(const r of rows){const label=el('label','supplement-row'),input=el('input');input.type='checkbox';input.checked=!r.excluded;input.setAttribute('aria-label',`同步：${r.sender}：${r.text}`);const copy=el('span');copy.append(el('small','',`${r.time} · ${r.person}`),el('span','',`${r.sender}：${r.text}`));label.append(input,copy);input.onchange=()=>{r.excluded=!input.checked;draft.storySync.excludedIds=input.checked?draft.storySync.excludedIds.filter(id=>id!==r.id):[...new Set([...draft.storySync.excludedIds,r.id])];preview.hidden=true;change();};list.append(label);}if(!rows.length)list.append(el('p','profile-help','没有待同步消息。只列出已开启分享的人物；保存过的补记不重复发送。'));status.textContent=`待同步 ${rows.filter(r=>!r.excluded).length} 条${bridge.status().error?' · '+bridge.status().error:''}`;}catch(e){if(current())status.textContent=e.message;}finally{busy=false;}}
    const actions=el('div','memory-actions');actions.append(button('刷新待同步内容',()=>void refresh(),'preset-button'),button('预览补记',()=>{try{const selected=rows.filter(r=>!r.excluded);validateSupplementSize(draft,selected);preview.textContent=selected.length?formatSupplement('00000000-0000-0000-0000-000000000000',selected):'没有所选消息';preview.hidden=false;}catch(e){status.textContent=e.message;}},'preset-button'),button('核对并重试补记',async()=>{if(busy)return;busy=true;await bridge.retry();busy=false;if(current())await refresh();},'preset-button'));scroll.append(actions,list,preview,el('p','profile-help','补记保存后，后续编辑或删除手机消息暂不会改写这份剧情记录，也不会修改千千结已有摘要；这些操作留待第二批讨论。'));void refresh();
  }
  scroll.append(status);const save=button('保存',async()=>{
    if(!current()||busy)return;busy=true;save.disabled=true;const controls=[...scroll.querySelectorAll('input,select,button')];controls.forEach(c=>c.disabled=true);
    try{host.assertSession(session,signal);await host.save(session,draft,signal);if(!current())return;baseline=clone(draft);onSaved?.();status.textContent='已保存到当前存档';}
    catch(e){if(current())status.textContent=e.message+'；草稿保留';}
    finally{if(current())controls.forEach(c=>c.disabled=false);save.disabled=false;busy=false;}
  },'preset-button');save.setAttribute('aria-label','保存设置');save.classList.add('story-save');wrap.querySelector('.toolbar-spacer').replaceWith(save);
  return {wrap,editor:{dirty:()=>!sameJson(draft,baseline),saving:()=>busy,dispose(){active=false;}}};
}
