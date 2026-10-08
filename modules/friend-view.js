import {FRIEND_TYPES,scanFriendEvents,sourceCurrent,applyFriendEvent,manualFriendAction} from './friends.js';
export function friendPage({win,host,session,signal,base,el,button,onSaved,go}){
 const {wrap,scroll}=base('新的朋友','contacts');scroll.classList.add('friend-page');let active=true,busy=false,query='',note='',scanId=0;
 const current=()=>active&&!signal.aborted;
 const status=el('p','profile-status');status.setAttribute('role','status');
 function chat(){return win.SillyTavern?.getContext()?.chat;}
 async function save(make,item){
  if(busy||!current())return;busy=true;const controls=[...scroll.querySelectorAll('button,input,textarea')];controls.forEach(n=>n.disabled=true);status.textContent='正在保存…';
  try{host.assertSession(session,signal);if(item&&!sourceCurrent(chat(),item))throw Error('来源楼层已修改、删除或切换备选，请刷新事件');const next=make();await host.save(session,next,signal);if(!current())return;onSaved?.();note='';status.textContent='已保存';paint();}
  catch(e){if(current())status.textContent=e.message+'；请刷新核对后重试';}
  finally{busy=false;if(current())controls.forEach(n=>n.disabled=false);}
 }
 function card(title,detail){const box=el('section','friend-card');box.append(el('strong','',title),el('p','',detail));return box;}
 async function scan(list){const ticket=++scanId;try{const b=session.book;const result=await scanFriendEvents(win,b,b.people.some(p=>p.friendLinkEnabled&&!p.deletedAt)?chat():[]);if(!current()||ticket!==scanId)return;list.replaceChildren();
  for(const text of result.warnings)list.append(el('p','friend-warning',text));
  for(const item of result.events){const e=item.event,p=b.people.find(p=>p.id===e.personId),box=card(`${p.name} · ${FRIEND_TYPES[e.type]}`,`第 ${item.index+1} 楼 · 账号 ${e.account}${e.note?'\n'+e.note:''}`),details=el('details','friend-evidence');details.append(el('summary','','查看来源正文'),el('p','',item.evidence||'此楼没有可预览的正文，请先到原楼核对'));box.append(details);
   const actions=el('div','friend-actions');actions.append(button('确认此事件',()=>void save(()=>applyFriendEvent(session.book,item),item),'preset-button'),button('忽略',()=>void save(()=>applyFriendEvent(session.book,item,true),item),'preset-button'));box.append(actions);list.append(box);
  }
  if(!result.events.length)list.append(el('p','friend-help','暂无待确认事件。正文没有输出事件时，可以按账号手动添加。'));
 }catch(e){if(current()&&ticket===scanId)list.replaceChildren(el('p','friend-warning',e.message));}}
 function paint(){
  if(!current())return;scroll.replaceChildren();
  scroll.append(el('p','friend-help','按剧情确认交换账号和好友申请。发出申请后，待对方通过才可聊天。'));
  const search=el('div','friend-search'),input=el('input');input.setAttribute('aria-label','搜索微信号');input.placeholder='输入完整微信号';input.value=query;input.maxLength=40;input.oninput=()=>{query=input.value;};search.append(input);const result=el('div');
  search.append(button('搜索',()=>{result.replaceChildren();const p=session.book.people.find(p=>!p.deletedAt&&p.account.toLowerCase()===query.trim().toLowerCase());if(!p){result.append(el('p','friend-help','未找到已登记的人物；请先到人物管理登记并核对账号。'));return;}
   const box=card(p.name,`微信号：${p.account}`);if(p.relation.friend)box.append(el('p','','已是好友'));else if(p.friendRequest)box.append(el('p','','已有待办申请，请在下方处理'));else{const label=el('label','friend-help','验证消息'),field=el('textarea');field.rows=2;field.maxLength=160;field.setAttribute('aria-label','好友验证消息');field.value=note;field.oninput=()=>{note=field.value;};label.append(field);box.append(label,button('发送好友申请',()=>void save(()=>manualFriendAction(session.book,p.id,'request',note)),'preset-button'));if(!p.friendLinkEnabled)box.append(el('p','friend-help','此人物未开启剧情联动，正文不会读取这条申请。可在人物资料开启，或在剧情通过后手动确认。'));}result.append(box);
  },'preset-button'));scroll.append(search,result);
  scroll.append(el('h2','section-label','好友申请'));
  const pending=session.book.people.filter(p=>!p.deletedAt&&p.friendRequest);if(!pending.length)scroll.append(el('p','friend-help','暂无待办申请'));
  for(const p of session.book.people.filter(p=>!p.deletedAt&&p.friendOutcome&&!p.friendRequest))scroll.append(el('p','friend-help',p.name+' · '+({accepted:'已成为好友',declined:'最近申请已拒绝',cancelled:'最近申请已取消'})[p.friendOutcome.status]));
  for(const p of pending){const incoming=p.friendRequest.direction==='incoming',box=card(p.name,incoming?'申请加你为好友':'你已发出申请 · 等待对方通过');box.append(el('p','',p.friendRequest.note||'无验证消息'));
   const actions=el('div','friend-actions');actions.append(button(incoming?'通过申请':'剧情中已通过',()=>{if(!incoming&&!win.confirm('确认剧情中对方已经通过这条申请？确认后才会成为好友。'))return;void save(()=>manualFriendAction(session.book,p.id,'accept'));},'preset-button'),button(incoming?'拒绝申请':'取消申请',()=>void save(()=>manualFriendAction(session.book,p.id,incoming?'decline':'cancel')),'preset-button'));box.append(actions);scroll.append(box);
  }
  scroll.append(el('h2','section-label','正文事件 · 待确认'));const list=el('div');scroll.append(list,status,button('刷新事件与申请',async()=>{if(busy)return;busy=true;status.textContent='正在读取…';try{const fresh=await host.load(signal);host.assertSession(session,signal);if(!current())return;if(fresh.book.id!==session.book.id)throw Error('存档已变化，请重新打开');session.book=fresh.book;session.exists=fresh.exists;status.textContent='';paint();}catch(e){if(current())status.textContent=e.message;}finally{busy=false;}},'preset-button'),button('管理剧情人物',()=>go('people'),'preset-button'));
  void scan(list);
 }
 paint();return {wrap,editor:{saving:()=>busy,dirty:()=>busy||!!note,dispose(){active=false;scanId++;}}};
}
