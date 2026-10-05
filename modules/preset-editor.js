import {clone,sameJson} from './contacts.js';
import {readConfig} from './ai.js';
import {readPresets,savePresets,copyPreset,textBlock,moveBlock,exportPreset,importPreset,validatePreset,FIXED_BLOCKS} from './presets.js';
import {previewPhonePrompt} from './reply-prompt.js';
export function presetSettings({win,profiles,base,el,button}){
 const {wrap,scroll}=base('聊天预设','settings');let active=true,busy=false,ticket=0,controller;
 let draft,baseline,savedRaw,viewId,opened=new Set(),fatal='';
 try{const loaded=readPresets(win,readConfig(win));draft=loaded.library;savedRaw=loaded.raw;baseline=clone(draft);viewId=draft.activeId;}catch(e){fatal=e.message;}
 const status=el('p','profile-status',fatal);status.setAttribute('role','status');scroll.append(el('p','profile-help','预设只用于小手机回复。开关和编辑保存在本机，点“保存预设设置”后生效；不更改 API 密钥或酒馆预设。'),status);
 if(fatal)return {wrap,editor:{dirty:()=>false,saving:()=>false,dispose(){active=false;}}};
 const chooser=el('select','preset-select');chooser.setAttribute('aria-label','查看预设');scroll.append(chooser);
 const toolbar=el('div','preset-actions'),importBox=el('div','preset-import'),content=el('div','preset-content'),preview=el('div','preset-preview');scroll.append(toolbar,importBox,content);
 const current=()=>draft.presets.find(p=>p.id===viewId);
 const changed=()=>{ticket++;controller?.abort();busy=false;preview.replaceChildren();status.textContent='预设设置尚未保存';};
 const safe=fn=>{try{fn();}catch(e){status.textContent=e.message;}};
 function add(p){if(draft.presets.length>=30)throw Error('最多保存 30 个预设');draft.presets.push(p);viewId=p.id;changed();render();}
 function field(parent,labelText,value,update,tag='input'){
  const label=el('label','profile-label',labelText),input=el(tag);input.setAttribute('aria-label',labelText);input.value=value;if(tag==='textarea'){input.rows=5;input.maxLength=12000;}else input.maxLength=100;input.oninput=()=>{update(input.value);changed();};label.append(input);parent.append(label);return input;
 }
 const file=el('input');file.type='file';file.accept='.json,.nuopreset';file.hidden=true;file.setAttribute('aria-label','导入聊天预设文件');scroll.append(file);
 file.onchange=async()=>{const selected=file.files?.[0];file.value='';if(!selected||busy)return;const mark=++ticket;busy=true;status.textContent='正在检查预设…';try{
  if(selected.size>1000000)throw Error('预设文件最多 1 MB');const result=importPreset(await selected.text());if(!active||mark!==ticket)return;
  importBox.replaceChildren(el('h2','section-label','导入预览：'+result.preset.name));
  for(const line of [...result.report,...result.preset.unsupported])importBox.append(el('p','profile-help',line));
  for(const b of result.preset.blocks){const row=el('details','profile-trace');row.append(el('summary','',`${b.name} · ${b.enabled?'启用':'关闭'} · ${b.role}`),el('p','profile-material',b.content));importBox.append(row);}
  importBox.append(button('确认导入为新预设',()=>safe(()=>{add(result.preset);importBox.replaceChildren();})),button('取消导入',()=>importBox.replaceChildren()));status.textContent='检查完成；确认导入后仍需保存设置';
 }catch(e){if(active&&mark===ticket)status.textContent=e.message;}finally{if(mark===ticket)busy=false;}};
 function render(){
  chooser.replaceChildren();for(const p of draft.presets){const o=el('option','',p.name+(p.id===draft.activeId?' · 使用中':''));o.value=p.id;chooser.append(o);}chooser.value=viewId;
  toolbar.replaceChildren(button('新建预设',()=>safe(()=>add({...copyPreset(current(),'新预设'),blocks:[],unsupported:[],attribution:[]}))),button('导入预设',()=>file.click()),button('复制预设',()=>safe(()=>add(copyPreset(current())))),button('使用此预设',()=>{draft.activeId=viewId;changed();render();}),button('导出预设',()=>safe(()=>{
   const raw=exportPreset(current()),url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),a=el('a');a.href=url;a.download='yui-phone-preset.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='已导出当前预设草稿，不包含密钥、人物或聊天内容';
  })));
  const p=current(),locked=p.id==='builtin';content.replaceChildren();
  if(locked)content.append(el('p','profile-help','内置默认为只读；点“复制预设”即可修改副本。'));
  const name=field(content,'预设名称',p.name,v=>p.name=v);name.maxLength=80;name.disabled=locked;
  if(!locked){
   const replacement=el('select','preset-select');replacement.setAttribute('aria-label','删除后的替代预设');replacement.append(el('option','','请选择替代预设'));replacement.firstChild.value='';for(const other of draft.presets.filter(x=>x.id!==p.id)){const o=el('option','',other.name);o.value=other.id;replacement.append(o);}if(p.id===draft.activeId)content.append(replacement);
   content.append(button('删除此预设',()=>safe(()=>{if(p.id===draft.activeId&&!replacement.value)throw Error('先选择删除后使用的替代预设');if(!win.confirm('删除此预设？保存设置后生效。'))return;if(p.id===draft.activeId)draft.activeId=replacement.value;draft.presets=draft.presets.filter(x=>x.id!==p.id);viewId=draft.activeId;changed();render();})));
  }
  if(p.attribution.length)content.append(el('p','profile-help','来源记录：'+p.attribution.join('；')));
  content.append(el('h2','section-label','自定义条目'),el('p','profile-help','支持 {{user}}（当前用户人设名）和 {{char}}（聊天人物名）。每个预设最多 20 万字符，只有启用的条目进入请求。')); 
  p.blocks.forEach((b,index)=>{
   const row=el('details','profile-trace preset-block');row.open=opened.has(b.id);row.ontoggle=()=>{if(row.open)opened.add(b.id);else opened.delete(b.id);};row.append(el('summary','',`${index+1}. ${b.name} · ${b.enabled?'启用':'关闭'}`));
   const label=el('label','profile-check','启用此条目'),check=el('input');check.type='checkbox';check.checked=b.enabled;check.disabled=locked;check.setAttribute('aria-label','启用条目：'+b.name);check.onchange=()=>{b.enabled=check.checked;changed();row.querySelector('summary').textContent=`${index+1}. ${b.name} · ${b.enabled?'启用':'关闭'}`;};label.prepend(check);row.append(label);
   field(row,'条目名称',b.name,v=>{b.name=v;row.querySelector('summary').textContent=`${index+1}. ${v} · ${b.enabled?'启用':'关闭'}`;}).disabled=locked;
   const role=el('select','preset-select');role.setAttribute('aria-label','条目角色');for(const key of ['system','user','assistant']){const o=el('option','',({system:'系统提示',user:'用户消息',assistant:'角色示例'})[key]);o.value=key;role.append(o);}role.value=b.role;role.disabled=locked;role.onchange=()=>{b.role=role.value;changed();};row.append(role);
   field(row,'条目内容',b.content,v=>b.content=v,'textarea').disabled=locked;
   const actions=el('div','preset-actions');for(const [label,delta] of [['上移',-1],['下移',1]]){const btn=button(label,()=>safe(()=>{moveBlock(p,b.id,delta);changed();render();}));btn.disabled=locked||index+delta<0||index+delta>=p.blocks.length;actions.append(btn);}
   const remove=button('删除条目',()=>{if(!win.confirm('删除这个提示词条目？'))return;p.blocks=p.blocks.filter(x=>x.id!==b.id);changed();render();});remove.disabled=locked;actions.append(remove);row.append(actions);content.append(row);
  });
  const addBlock=button('添加条目',()=>safe(()=>{if(p.blocks.length>=80)throw Error('最多 80 个文字条目');const b=textBlock();p.blocks.push(b);opened.add(b.id);changed();render();}));addBlock.disabled=locked;content.append(addBlock);
  if(p.unsupported.length){const more=el('details','profile-trace');more.append(el('summary','',`兼容检查 · ${p.unsupported.length} 项`));for(const line of p.unsupported)more.append(el('p','profile-help',line));more.append(el('p','profile-help','这些占位项不发送给模型，也没有自动实现对应功能。'));content.append(more);}
  const fixed=el('details','profile-trace preset-fixed');fixed.append(el('summary','','固定资料与功能 · 已锁定'));for(const item of FIXED_BLOCKS)fixed.append(el('p','profile-material',item.name+'：'+item.description));fixed.append(el('p','profile-help','固定部分在自定义条目之后，由程序按当前会话填充。预设不能替人物开启正文读取或世界书条目。'));content.append(fixed);
 }
 chooser.onchange=()=>{ticket++;controller?.abort();busy=false;viewId=chooser.value;preview.replaceChildren();render();};render();
 scroll.append(button('保存预设设置',()=>safe(()=>{if(busy)throw Error('请等待当前操作完成');const saved=savePresets(win,draft,savedRaw);draft=saved.library;savedRaw=saved.raw;baseline=clone(draft);status.textContent='预设设置已保存在本机';render();}),'profile-action primary'),button('取消未保存修改',()=>{if(!sameJson(draft,baseline)&&!win.confirm('放弃未保存的预设修改？'))return;ticket++;controller?.abort();busy=false;draft=clone(baseline);viewId=draft.activeId;importBox.replaceChildren();preview.replaceChildren();render();status.textContent='已取消，未写入';}));
 const friends=el('select','preset-select');friends.setAttribute('aria-label','预览好友');scroll.append(el('h2','section-label','预览本次发送内容'),el('p','profile-help','使用当前查看的预设草稿和所选好友的实际资料组装；不调用 AI，不保存聊天，未保存草稿只影响预览。'),friends,
 button('读取当前存档好友',()=>void loadFriends()),button('预览发送内容',()=>void showPreview()),preview);
 async function loadFriends(){if(busy)return;const mark=++ticket;controller?.abort();controller=new AbortController();busy=true;try{const session=await profiles.load(controller.signal);profiles.assertSession(session,controller.signal);if(!active||mark!==ticket)return;friends.replaceChildren();const placeholder=el('option','','请选择好友');placeholder.value='';friends.append(placeholder);for(const p of session.book.people.filter(x=>x.relation.friend&&!x.deletedAt)){const o=el('option','',p.remark||p.name);o.value=p.id;friends.append(o);}status.textContent='好友列表已读取';}catch(e){if(active&&mark===ticket)status.textContent=e.message;}finally{if(mark===ticket)busy=false;}}
 async function showPreview(){if(busy)return;const mark=++ticket;controller?.abort();controller=new AbortController();busy=true;preview.replaceChildren();try{validatePreset(current());const messages=await previewPhonePrompt(win,profiles,friends.value,clone(current()),controller.signal);if(!active||mark!==ticket)return;for(const [i,m] of messages.entries()){const section=el('details','profile-trace');section.append(el('summary','',`${i+1}. ${m.role} · ${m.content.length} 字符`),el('p','profile-material',m.content));preview.append(section);}status.textContent=`已预览 ${messages.length} 条请求消息，没有发送给 AI`;}catch(e){if(active&&mark===ticket)status.textContent=e.message;}finally{if(mark===ticket)busy=false;}}
 return {wrap,editor:{saving:()=>false,dirty:()=>busy||!!importBox.childElementCount||!sameJson(draft,baseline),suspend(){controller?.abort();},dispose(){active=false;ticket++;controller?.abort();}}};
}
