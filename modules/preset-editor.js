import {clone,sameJson} from './contacts.js';
import {readConfig} from './ai.js';
import {readPresets,savePresets,copyPreset,textBlock,moveBlock,exportPreset,importPreset,validatePreset,FIXED_BLOCKS} from './presets.js';
import {previewPhonePrompt} from './reply-prompt.js';
export function presetSettings({win,profiles,base,el,button}){
 const {wrap,scroll}=base('聊天预设','settings');wrap.classList.add('preset-manager');
 let active=true,busy=false,ticket=0,controller,draft,baseline,savedRaw,viewId,mode='list',opened='',query='',fatal='';
 try{const loaded=readPresets(win,readConfig(win));draft=loaded.library;savedRaw=loaded.raw;baseline=clone(draft);viewId=draft.activeId;}catch(e){fatal=e.message;}
 const status=el('p','profile-status',fatal||'仅用于手机聊天');status.setAttribute('role','status');
 const importBox=el('div','preset-import'),content=el('div','preset-content'),preview=el('div','preset-preview');scroll.append(importBox,content);
 wrap.insertBefore(status,scroll);
 if(fatal)return {wrap,editor:{dirty:()=>false,saving:()=>false,dispose(){active=false;}}};
 const bar=wrap.querySelector('.toolbar'),title=bar.querySelector('h1'),originalBack=bar.firstElementChild;
 const back=button('‹',()=>{ticket++;controller?.abort();busy=false;status.textContent=!sameJson(draft,baseline)?'有修改未保存':'仅用于手机聊天';if(mode==='preview'){mode='edit';render(true);}else if(mode==='edit'){mode='list';query='';render(true);}else originalBack.click();},'preset-back');back.setAttribute('aria-label','返回');originalBack.replaceWith(back);
 const save=button('保存',()=>safe(()=>{if(busy)throw Error('请等待当前操作完成');const result=savePresets(win,draft,savedRaw);draft=result.library;savedRaw=result.raw;baseline=clone(draft);status.textContent='预设设置已保存在本机';render();}),'preset-save');save.setAttribute('aria-label','保存预设设置');bar.lastElementChild.replaceWith(save);
 const current=()=>draft.presets.find(p=>p.id===viewId);
 const safe=fn=>{try{fn();}catch(e){status.textContent=e.message;}};
 const changed=()=>{ticket++;controller?.abort();busy=false;preview.replaceChildren();status.textContent='有修改未保存';save.classList.add('is-dirty');};
 function open(p){ticket++;controller?.abort();busy=false;viewId=p.id;mode='edit';query='';opened='';status.textContent=!sameJson(draft,baseline)?'有修改未保存':'仅用于手机聊天';preview.replaceChildren();render(true);}
 function add(p){if(draft.presets.length>=30)throw Error('最多保存 30 个预设');draft.presets.push(p);changed();open(p);}
 function small(text,fn,label=text,cls=''){const b=button(text,fn,'preset-button '+cls);b.setAttribute('aria-label',label);return b;}
 function menu(label){const d=el('details','preset-more'),s=el('summary','preset-button','⋯');s.setAttribute('role','button');s.setAttribute('aria-label',label);s.setAttribute('aria-expanded','false');d.append(s);const panel=el('div','preset-popover');d.append(panel);panel.addEventListener('click',e=>{if(e.target.closest('button'))d.open=false;});d.addEventListener('toggle',()=>{s.setAttribute('aria-expanded',String(d.open));if(d.open)for(const other of wrap.querySelectorAll('.preset-more'))if(other!==d)other.open=false;});d.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();d.open=false;s.focus();}});return {d,panel};}
 function field(parent,labelText,value,update,tag='input'){
  const label=el('label','profile-label',labelText),frame=el('span','preset-input-frame'+(tag==='textarea'?' multiline':'')),input=el(tag);input.setAttribute('aria-label',labelText);input.value=value;input.maxLength=tag==='textarea'?12000:100;input.oninput=()=>{update(input.value);changed();};frame.append(input);label.append(frame);parent.append(label);return input;
 }
 function cancel(){if(!sameJson(draft,baseline)&&!win.confirm('放弃未保存的预设修改？'))return;ticket++;controller?.abort();busy=false;draft=clone(baseline);viewId=draft.presets.some(p=>p.id===viewId)?viewId:draft.activeId;importBox.replaceChildren();preview.replaceChildren();render();status.textContent='已取消，未写入';}
 function download(){const raw=exportPreset(current()),url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),a=el('a');a.href=url;a.download='yui-phone-preset.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='已导出，不含密钥、人物或聊天内容';}
 const file=el('input');file.type='file';file.accept='.json,.nuopreset';file.hidden=true;file.setAttribute('aria-label','导入聊天预设文件');scroll.append(file);
 file.onchange=async()=>{const selected=file.files?.[0];file.value='';if(!selected||busy)return;const mark=++ticket;busy=true;status.textContent='正在检查预设…';try{
  if(selected.size>1000000)throw Error('预设文件最多 1 MB');const result=importPreset(await selected.text());if(!active||mark!==ticket)return;
  importBox.replaceChildren(el('h2','section-label','导入：'+result.preset.name));
  for(const line of result.report)importBox.append(el('p','profile-help',line));
  const check=el('details','profile-trace');check.append(el('summary','',`兼容详情 · ${result.preset.unsupported.length} 项`));for(const line of result.preset.unsupported)check.append(el('p','profile-help',line));importBox.append(check);
  const texts=el('details','profile-trace');texts.append(el('summary','',`查看文字 · ${result.preset.blocks.length} 条`));for(const b of result.preset.blocks){const row=el('details','profile-trace');row.append(el('summary','',`${b.name} · ${b.enabled?'启用':'关闭'}`),el('p','profile-material',b.content));texts.append(row);}importBox.append(texts);
  const actions=el('div','preset-actions');actions.append(small('确认导入',()=>safe(()=>{add(result.preset);importBox.replaceChildren();}),'确认导入为新预设'),small('取消',()=>importBox.replaceChildren(),'取消导入'));importBox.append(actions);scroll.scrollTop=0;status.textContent='检查完成，确认后点右上角保存';
 }catch(e){if(active&&mark===ticket)status.textContent=e.message;}finally{if(mark===ticket)busy=false;}};
 wrap.addEventListener('click',e=>{for(const d of wrap.querySelectorAll('.preset-more[open]'))if(!d.contains(e.target))d.open=false;});
 function render(reset=false){
  const top=scroll.scrollTop;content.replaceChildren();save.classList.toggle('is-dirty',!sameJson(draft,baseline));
  title.textContent=mode==='list'?'聊天预设':mode==='preview'?'发送预览':current().name;title.title=title.textContent;
  back.setAttribute('aria-label',mode==='list'?'返回':mode==='preview'?'返回预设编辑':'返回预设列表');
  if(mode==='list')renderList();else if(mode==='preview')renderPreview();else renderEdit();
  scroll.scrollTop=reset?0:top;
 }
 function renderList(){
  const tools=el('div','preset-tools'),more=menu('预设列表更多');more.panel.append(small('取消未保存修改',cancel));
  tools.append(small('＋ 新建',()=>safe(()=>add({...copyPreset(current(),'新预设'),blocks:[],unsupported:[],attribution:[]})),'新建预设'),small('导入',()=>file.click(),'导入预设'),more.d);content.append(tools);
  for(const p of draft.presets){
   const card=el('div','preset-card'+(p.id===draft.activeId?' is-active':''));card.dataset.presetId=p.id;
   const main=button('',()=>open(p),'preset-card-main');main.setAttribute('aria-label','编辑预设：'+p.name);main.append(el('strong','',p.name),el('small','',p.id==='builtin'?'内置 · 复制后可编辑':`${p.blocks.length} 条文字 · ${p.blocks.filter(b=>b.enabled).length} 条开启`));
   const use=small(p.id===draft.activeId?'✓ 使用中':'使用',()=>{draft.activeId=p.id;changed();render();},'使用预设：'+p.name,'preset-use');use.disabled=p.id===draft.activeId;
   card.append(main,use);content.append(card);
  }
 }
 function renderEdit(){
  const p=current(),locked=p.id==='builtin',tools=el('div','preset-tools'),more=menu('预设操作');
  const use=small(p.id===draft.activeId?'✓ 使用中':'使用此预设',()=>{draft.activeId=viewId;changed();render();},'使用此预设','preset-use');use.disabled=p.id===draft.activeId;
  const addBlock=small('＋ 条目',()=>safe(()=>{if(p.blocks.length>=80)throw Error('最多 80 个文字条目');const b=textBlock();p.blocks.push(b);opened=b.id;query='';changed();render();content.querySelector('[data-block-id="'+b.id+'"]')?.scrollIntoView({block:'nearest'});}),'添加条目');addBlock.disabled=locked;
  tools.append(use,addBlock,more.d);content.append(tools);
  more.panel.append(small('复制预设',()=>safe(()=>add(copyPreset(p)))),small('导出预设',()=>safe(download)),small('预览发送内容',()=>{mode='preview';render(true);}),small('取消未保存修改',cancel));
  const manage=el('details','preset-manage');manage.append(el('summary','','名称与删除'));
  const name=field(manage,'预设名称',p.name,v=>{p.name=v;title.textContent=v;});name.maxLength=80;name.disabled=locked;
  if(!locked){const replacement=el('select','preset-select');replacement.setAttribute('aria-label','删除后的替代预设');const option=el('option','','请选择替代预设');option.value='';replacement.append(option);for(const other of draft.presets.filter(x=>x.id!==p.id)){const o=el('option','',other.name);o.value=other.id;replacement.append(o);}if(p.id===draft.activeId)manage.append(replacement);
   manage.append(small('删除此预设',()=>safe(()=>{if(p.id===draft.activeId&&!replacement.value)throw Error('先选择删除后使用的替代预设');if(!win.confirm('删除此预设？保存设置后生效。'))return;if(p.id===draft.activeId)draft.activeId=replacement.value;draft.presets=draft.presets.filter(x=>x.id!==p.id);viewId=draft.activeId;mode='list';changed();render(true);}),'删除此预设','danger'));
  }
  more.panel.append(manage);
  const searchFrame=el('div','preset-search'),search=el('input');search.type='search';search.placeholder='搜索条目名称或内容';search.setAttribute('aria-label',search.placeholder);search.value=query;searchFrame.append(search);content.append(searchFrame);
  const caption=el('p','preset-caption',locked?'内置只读 · 在 ⋯ 中复制后编辑':`${p.blocks.length} 条文字 · 点条目编辑，开关直接生效于草稿`);content.append(caption);
  const rows=el('div','preset-rows'),empty=el('p','preset-caption','没有匹配的条目');content.append(rows,empty);
  function filter(){let count=0;for(const row of rows.children){const b=p.blocks.find(b=>b.id===row.dataset.blockId);row.hidden=!(b.name+'\n'+b.content).toLocaleLowerCase().includes(query.toLocaleLowerCase());if(!row.hidden)count++;}empty.hidden=count>0;}
  search.oninput=()=>{query=search.value;filter();};
  p.blocks.forEach((b,index)=>{
   const row=el('details','preset-block');row.dataset.blockId=b.id;row.open=opened===b.id;
   const summary=el('summary','preset-row-head'),copy=el('span','preset-row-copy'),name=el('strong','',b.name),meta=el('small','',`${b.role} · ${b.content.length} 字符`);copy.append(name,meta);
   const label=el('label','preset-switch'),check=el('input');check.type='checkbox';check.checked=b.enabled;check.disabled=locked;check.setAttribute('aria-label','启用条目：'+b.name);label.append(check,el('span','preset-switch-track'));label.onclick=e=>e.stopPropagation();
   check.onchange=()=>{b.enabled=check.checked;changed();row.classList.toggle('is-off',!b.enabled);};row.classList.toggle('is-off',!b.enabled);
   summary.append(el('span','preset-row-dot'),copy,label);row.append(summary);
   const body=el('div','preset-block-body'),line=el('div','preset-field-line');
   field(line,'条目名称',b.name,v=>{b.name=v;name.textContent=v;check.setAttribute('aria-label','启用条目：'+v);}).disabled=locked;
   const roleLabel=el('label','profile-label','角色'),role=el('select','preset-select');role.setAttribute('aria-label','条目角色');for(const key of ['system','user','assistant']){const o=el('option','',({system:'系统',user:'用户',assistant:'角色'})[key]);o.value=key;role.append(o);}role.value=b.role;role.disabled=locked;role.onchange=()=>{b.role=role.value;meta.textContent=`${b.role} · ${b.content.length} 字符`;changed();};roleLabel.append(role);line.append(roleLabel);body.append(line);
   field(body,'条目内容',b.content,v=>{b.content=v;meta.textContent=`${b.role} · ${v.length} 字符`;},'textarea').disabled=locked;
   const actions=el('div','preset-actions');for(const [label,delta] of [['上移',-1],['下移',1]]){const btn=small(label,()=>safe(()=>{moveBlock(p,b.id,delta);changed();render();}));btn.disabled=locked||index+delta<0||index+delta>=p.blocks.length;actions.append(btn);}
   const remove=small('删除',()=>{if(!win.confirm('删除这个提示词条目？'))return;p.blocks=p.blocks.filter(x=>x.id!==b.id);changed();render();},'删除条目','danger');remove.disabled=locked;actions.append(remove);body.append(actions);row.append(body);rows.append(row);
   row.addEventListener('toggle',()=>{if(!row.isConnected)return;if(row.open){opened=b.id;for(const other of rows.children)if(other!==row)other.open=false;}else if(opened===b.id)opened='';});
  });filter();
  const fixed=el('details','profile-trace preset-fixed');fixed.append(el('summary','','固定资料与功能 · 锁定'));for(const item of FIXED_BLOCKS)fixed.append(el('p','profile-material',item.name+'：'+item.description));content.append(fixed);
  if(p.unsupported.length){const more=el('details','profile-trace');more.append(el('summary','',`兼容检查 · ${p.unsupported.length} 项`));for(const line of p.unsupported)more.append(el('p','profile-help',line));content.append(more);}
  const help=el('details','profile-trace');help.append(el('summary','','使用说明'),el('p','profile-help','支持 {{user}} 和 {{char}} 名字变量。固定资料在文字条目之后填充，人物的正文读取和世界书开关仍在人物资料中设置。修改后点右上角保存。'));if(p.attribution.length)help.append(el('p','profile-help','来源：'+p.attribution.join('；')));content.append(help);
 }
 const friends=el('select','preset-select');friends.setAttribute('aria-label','预览好友');
 function renderPreview(){content.append(el('p','preset-caption','使用当前预设草稿和好友资料，只预览，不调用 AI。'),friends,small('读取当前存档好友',()=>void loadFriends()),small('预览发送内容',()=>void showPreview()),preview);}
 async function loadFriends(){if(busy)return;const mark=++ticket;controller?.abort();controller=new AbortController();busy=true;try{const session=await profiles.load(controller.signal);profiles.assertSession(session,controller.signal);if(!active||mark!==ticket)return;friends.replaceChildren();const placeholder=el('option','','请选择好友');placeholder.value='';friends.append(placeholder);for(const p of session.book.people.filter(x=>x.relation.friend&&!x.deletedAt)){const o=el('option','',p.remark||p.name);o.value=p.id;friends.append(o);}status.textContent='好友列表已读取';}catch(e){if(active&&mark===ticket)status.textContent=e.message;}finally{if(mark===ticket)busy=false;}}
 async function showPreview(){if(busy)return;const mark=++ticket;controller?.abort();controller=new AbortController();busy=true;preview.replaceChildren();try{validatePreset(current());const messages=await previewPhonePrompt(win,profiles,friends.value,clone(current()),controller.signal);if(!active||mark!==ticket)return;for(const [i,m] of messages.entries()){const section=el('details','profile-trace');section.append(el('summary','',`${i+1}. ${m.role} · ${m.content.length} 字符`),el('p','profile-material',m.content));preview.append(section);}status.textContent=`已预览 ${messages.length} 条请求消息，没有发送给 AI`;}catch(e){if(active&&mark===ticket)status.textContent=e.message;}finally{if(mark===ticket)busy=false;}}
 render();
 return {wrap,editor:{saving:()=>false,dirty:()=>busy||!!importBox.childElementCount||!sameJson(draft,baseline),suspend(){controller?.abort();},dispose(){active=false;ticket++;controller?.abort();}}};
}
