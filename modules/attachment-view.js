import { readSticker, fetchSticker } from './stickers.js';
import { FAVORITES, parseStickerLines } from './sticker-groups.js';
import { money } from './rich-messages.js';
import { conversationId } from './messages.js';

export function createAttachments({ wrap, person, messenger, el, button }) {
  const win = wrap.ownerDocument.defaultView, state = messenger.draft(person.id);
  const form = state.attachment ||= { amount:'', note:'', description:'', category:'默认', urls:'', files:[], allowedAI:false, edit:0, busy:false };
  const library = messenger.library(), panel = el('section', 'attachment-panel'); panel.hidden = true; wrap.append(panel);
  const life = new AbortController(), trigger = wrap.querySelector('[aria-label="添加附件"]');
  trigger?.setAttribute('aria-expanded','false');
  let active = true, task, view = '', selectedTransfer, receiptState, categoryId=FAVORITES, holdTimer;
  const hostSignal = messenger.sessionSignal();
  const current = controller => active && !hostSignal.aborted && !controller?.signal.aborted;
  function cancel() { clearTimeout(holdTimer); task?.abort(); task = undefined; form.busy = false; }
  function close() { cancel(); panel.hidden = true; panel.replaceChildren(); view = ''; trigger?.setAttribute('aria-expanded','false'); }
  function frame(title) {
    cancel(); panel.replaceChildren(); panel.hidden = false; panel.dataset.view = view; panel.setAttribute('aria-label', title); trigger?.setAttribute('aria-expanded','true');
    const head = el('div','attachment-head'); head.append(el('strong','',title),button('×',close,'attachment-close')); head.lastChild.setAttribute('aria-label','关闭附件面板'); panel.append(head);
    const openedView=view;queueMicrotask(()=>{if(active&&view===openedView&&!panel.hidden)panel.querySelector(view==='transfer'?'.attachment-dialog-actions button':'.attachment-close')?.focus({preventScroll:true});});
    const body = el('div','attachment-body'), status = el('p','profile-status'); status.setAttribute('role','status'); panel.append(body,status); return {body,status};
  }
  function input(body, label, key, multiline = false) {
    const row = el('label','profile-label',label), field = el(multiline?'textarea':'input'); field.value = form[key]; field.setAttribute('aria-label',label);
    field.maxLength = key === 'description' ? 256 : key === 'note' ? 120 : key === 'category' ? 40 : key === 'urls' ? 16000 : 16;
    field.oninput = () => { form[key] = field.value; form.edit++; }; if(multiline) field.rows=2;
    row.append(field); body.append(row); return field;
  }
  function home() {
    view='home'; const {body}=frame('聊天工具');
    body.classList.add('attachment-tools');
    const paths = { sticker:'M15 3H7a4 4 0 0 0-4 4v10a4 4 0 0 0 4 4h6l8-8V7a4 4 0 0 0-4-4h-2 M13 21v-4a4 4 0 0 1 4-4h4 M8 9h.01 M15 9h.01 M8 13c1 1.5 2.5 2 4 1.5', transfer:'M5 8h14m-4-4 4 4-4 4 M19 16H5m4-4-4 4 4 4' };
    for(const [label,glyph,run] of [['表情包','sticker',()=>void stickers()],['转账','transfer',transfer]]) {
      const item=button('',run,'attachment-tool');item.setAttribute('aria-label',label);
      const tile=el('span','attachment-tool-icon'), svg=wrap.ownerDocument.createElementNS('http://www.w3.org/2000/svg','svg'), path=wrap.ownerDocument.createElementNS('http://www.w3.org/2000/svg','path');
      svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');path.setAttribute('d',paths[glyph]);svg.append(path);tile.append(svg);
      item.append(tile,el('span','attachment-tool-label',label));body.append(item);
    }
    queueMicrotask(()=>{if(active&&view==='home'&&!panel.hidden)body.querySelector('button')?.focus({preventScroll:true});});
  }
  function transfer() {
    view='transfer'; const {body,status}=frame('转账');
    const recipient=el('div','transfer-recipient');recipient.append(el('span','transfer-recipient-mark','↗'),el('span','',`转给 ${person.remark || person.name}`));body.append(recipient);
    const amountBox=el('div','transfer-amount-entry');body.append(amountBox);
    const amount=input(amountBox,'转账金额','amount'); amount.inputMode='decimal'; amount.placeholder='0.00';
    amount.parentElement.firstChild.replaceWith(el('span','transfer-amount-label','转账金额'));
    const currency=el('span','transfer-currency','¥');currency.setAttribute('aria-hidden','true');amount.parentElement.insertBefore(currency,amount);
    const note=input(body,'转账备注','note');note.placeholder='添加备注（选填）';note.parentElement.classList.add('transfer-note-entry');
    body.append(el('p','transfer-local-hint','虚构转账 · 不涉及真实支付'));
    const actions=el('div','attachment-dialog-actions');body.append(actions);
    actions.append(button('取消转账',()=>{form.amount='';form.note='';form.edit++;close();}),button('发送转账',()=>{try{messenger.sendTransfer(person.id,form.amount,form.note);close();}catch(e){status.textContent=e.message;}},'profile-action primary'));
  }
  function inspectTransfer(messageId) {
    const message=messenger.history()?.messages.find(m=>m.messageId===messageId&&m.conversationId===conversationId(person.id)); if(!message?.transfer)return;
    selectedTransfer=messageId; view='receipt'; const {body,status}=frame('转账详情');
    receiptState=message.transfer.state;const incoming=message.recipient.kind==='self';
    const stateText=receiptState==='pending'?(incoming?'等待你收款':'等待对方收款'):receiptState==='received'?(incoming?'你已收款':'对方已收款'):(incoming?'你已退回':'对方已退回');
    body.append(el('span','receipt-symbol',receiptState==='pending'?'⇄':receiptState==='received'?'✓':'↩'),el('p','receipt-state',stateText),el('h2','transfer-amount',`¥${money(message.transfer.amountMinor)}`),el('p','receipt-note',message.transfer.note||'转账'),el('p','profile-help',incoming?`来自 ${person.remark||person.name}`:`转给 ${person.remark||person.name}`));
    if(message.transfer.state==='pending'&&message.recipient.kind==='self') {
      for(const [label,action] of [['确认收款','receive'],['确认退回','refund']])body.append(button(label,()=>{try{messenger.settleTransfer(person.id,messageId,action);close();}catch(e){status.textContent=e.message;}},action==='receive'?'profile-action primary':'profile-action'));
    }
    body.append(el('p','profile-help','虚构转账，不涉及真实支付或钱包余额。'));
  }
  function hold(node, action, controller) {
    let start,blocked=false;
    const clear=()=>{clearTimeout(holdTimer);start=undefined;};
    node.addEventListener('pointerdown',e=>{if(e.button!==0)return;blocked=false;start={x:e.clientX,y:e.clientY};clearTimeout(holdTimer);holdTimer=setTimeout(()=>{if(current(controller)){blocked=true;start=undefined;action();}},600);});
    node.addEventListener('pointermove',e=>{if(start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>8)clear();});
    for(const name of ['pointerup','pointercancel','pointerleave'])node.addEventListener(name,clear);
    node.addEventListener('click',e=>{if(blocked){e.preventDefault();e.stopImmediatePropagation();blocked=false;}},true);
    node.addEventListener('contextmenu',e=>{e.preventDefault();clear();if(current(controller)){blocked=true;action();}});
    controller.signal.addEventListener('abort',clear,{once:true});
  }
  function stickerFrame(title) {
    const result=frame(title),head=panel.querySelector('.attachment-head'),tools=el('div','sticker-header-tools');
    if(view==='stickers'){
      const add=button('＋',()=>void importView(),'sticker-header-button');add.setAttribute('aria-label','添加表情包');
      const menu=el('details','sticker-more'),toggle=el('summary','','⋯');toggle.setAttribute('aria-label','表情包管理');
      const choices=el('div','sticker-more-menu');choices.append(button('管理当前分类',()=>void categoryView(categoryId)),button('多选删除',()=>void stickers(true)));menu.append(toggle,choices);tools.append(add,menu);
    }else tools.append(button('返回',()=>void stickers(),'sticker-header-button'));
    head.insertBefore(tools,head.lastChild);return result;
  }
  function confirmAction(title,text,run,back){
    view='confirm';const {body,status}=frame(title),controller=new AbortController();task=controller;
    body.append(el('p','profile-help',text),button('确认删除',async()=>{if(form.busy)return;form.busy=true;try{await run(controller.signal);if(current(controller))await stickers();}catch(e){if(current(controller))status.textContent=e.message;}finally{form.busy=false;}},'profile-action danger'),button('取消',back));
  }
  async function stickers(selecting=false) {
    view='stickers';const {body,status}=stickerFrame('表情包'),controller=new AbortController();task=controller;status.textContent='正在读取…';
    try{
      const snapshot=await library.snapshot();if(!current(controller))return;status.textContent='';
      if(!snapshot.categories.some(c=>c.id===categoryId))categoryId=FAVORITES;
      const filterRow=el('div','sticker-filter'),filter=el('nav','sticker-tabs'),count=el('span','sticker-count');filter.setAttribute('aria-label','表情包分类');
      for(const c of snapshot.categories){const tab=button(c.name,()=>{categoryId=c.id;void stickers();},'sticker-tab');tab.dataset.categoryId=c.id;if(c.id===categoryId){tab.classList.add('active');tab.setAttribute('aria-pressed','true');}else tab.setAttribute('aria-pressed','false');tab.title='长按管理分类';hold(tab,()=>void categoryView(c.id),controller);filter.append(tab);}
      filterRow.append(filter,count);body.append(filterRow);
      const visible=snapshot.assets.filter(a=>!a.hidden&&a.categoryId===categoryId),selected=new Set(),grid=el('div','sticker-grid'),batch=el('div','sticker-batch');count.textContent=`共 ${visible.length} 个`;body.append(grid,batch);
      function selection(){batch.replaceChildren();if(!selecting)return;batch.append(el('span','',`已选 ${selected.size} 张`),button('删除所选',()=>{if(!selected.size)return;const ids=[...selected];confirmAction('删除表情包',`从素材库删除这 ${ids.length} 张图片？已发送的聊天图片仍保留。`,signal=>library.removeBatch(ids,snapshot.revision,signal),()=>void stickers(true));},'sticker-remove'),button('完成',()=>void stickers(),'sticker-cancel'));}
      function paint(){grid.replaceChildren();selection();
        if(!visible.length){const empty=el('div','sticker-empty');empty.append(el('span','','☺'),el('p','','这个分类还没有表情包'),button('导入表情包',()=>void importView(),'sticker-empty-add'));grid.append(empty);}
        for(const a of visible){const card=el('div','sticker-tile'),send=button('',async()=>{
          if(selecting){selected.has(a.id)?selected.delete(a.id):selected.add(a.id);paint();return;}
          if(form.busy)return;form.busy=true;send.disabled=true;try{await messenger.sendSticker(person.id,a.id,controller.signal);if(current(controller))close();}catch(e){if(current(controller))status.textContent=e.message;}finally{form.busy=false;if(current(controller))send.disabled=false;}
        },'sticker-send'+(selected.has(a.id)?' is-selected':''));
          send.setAttribute('aria-label',`${selecting?'选择':'发送'}表情包：${a.description}`);if(selecting)send.setAttribute('aria-pressed',String(selected.has(a.id)));
          const img=el('img');img.src=a.data;img.alt=a.description;img.draggable=false;img.loading='lazy';send.append(img,el('span','',a.description));
          hold(send,()=>{selecting=true;selected.add(a.id);paint();},controller);card.append(send);grid.append(card);
        }
      }paint();
      if(snapshot.permissionReview)body.append(el('p','profile-help','旧图片已保留。长按分类，重新选择可使用它的角色。'));
    }catch(e){if(current(controller))status.textContent=e.message;}
  }
  async function categoryView(id){
    categoryId=id;view='category';const {body,status}=stickerFrame('分类设置'),controller=new AbortController();task=controller;status.textContent='正在读取…';
    try{
      const snapshot=await library.snapshot(),people=await messenger.stickerPeople();if(!current(controller))return;const cat=snapshot.categories.find(c=>c.id===id);if(!cat)throw Error('分类已不存在');status.textContent='';
      const stored=form.groupDrafts?.[id];
      const draft=stored||{id,name:cat.name,bindings:structuredClone(cat.bindings),revision:snapshot.revision};
      const nameRow=el('label','profile-label','分类名称'),name=el('input');name.value=draft.name;name.maxLength=40;name.disabled=id===FAVORITES;name.setAttribute('aria-label','分类名称');nameRow.append(name);body.append(nameRow,el('p','profile-help','允许以下人物使用整组表情包。你自己可以发送所有分类。'));
      function changed(){draft.name=name.value;(form.groupDrafts ||= {})[id]=draft;}
      name.oninput=changed;
      const list=el('div','sticker-role-list');body.append(list);
      for(const p of people.people){const row=el('label','profile-check',p.name),check=el('input');check.type='checkbox';check.checked=draft.bindings.some(b=>b.archiveId===people.archiveId&&b.personId===p.id);check.setAttribute('aria-label',`允许 ${p.name} 使用`);check.onchange=()=>{draft.bindings=draft.bindings.filter(b=>!(b.archiveId===people.archiveId&&b.personId===p.id));if(check.checked)draft.bindings.push({archiveId:people.archiveId,personId:p.id});changed();};row.prepend(check);list.append(row);}
      if(!people.people.length)list.append(el('p','profile-help','当前存档没有可选择的人物'));
      const selectedIds=new Set(people.people.map(p=>p.id));const unavailable=draft.bindings.filter(b=>b.archiveId===people.archiveId&&!selectedIds.has(b.personId)).length;
      if(unavailable)body.append(el('p','profile-help',`${unavailable} 位已不在人物列表的绑定仍保留；不会转给同名新人物。`));
      body.append(button('保存分类',async()=>{if(form.busy)return;form.busy=true;try{await library.saveCategory(id,name.value,draft.bindings,draft.revision,controller.signal);if(current(controller)){delete form.groupDrafts?.[id];await stickers();}}catch(e){if(current(controller))status.textContent=e.message;}finally{form.busy=false;}},'profile-action primary'),button('取消修改',()=>{delete form.groupDrafts?.[id];void stickers();}));
      if(id!==FAVORITES)body.append(button('删除分类',()=>confirmAction('删除分类',`删除“${cat.name}”及其中的素材？已发送的聊天图片仍保留。`,async signal=>{await library.removeCategory(id,draft.revision,signal);if(form.groupDraft?.id===id)form.groupDraft=undefined;categoryId=FAVORITES;},()=>void categoryView(id)),'profile-action danger'));
    }catch(e){if(current(controller))status.textContent=e.message;}
  }
  async function importView(){
    view='import';const {body,status}=stickerFrame('添加表情包'),controller=new AbortController();task=controller;status.textContent='正在读取…';
    try{
      const snapshot=await library.snapshot();if(!current(controller))return;status.textContent='';
      const choiceRow=el('label','profile-label','保存到分类'),choice=el('select');choice.setAttribute('aria-label','保存到分类');
      for(const c of snapshot.categories){const o=el('option','',c.name);o.value=c.id;choice.append(o);}const newOption=el('option','','＋ 新分类');newOption.value='new';choice.append(newOption);choiceRow.append(choice);body.append(choiceRow);
      choice.value=snapshot.categories.some(c=>c.id===(form.importCategory||categoryId))?(form.importCategory||categoryId):FAVORITES;
      if(form.importCategory==='new')choice.value='new';
      const newName=input(body,'新分类名称','newCategory');newName.maxLength=40;newName.value=form.newCategory||'';newName.parentElement.hidden=choice.value!=='new';choice.onchange=()=>{form.importCategory=choice.value;form.edit++;newName.parentElement.hidden=choice.value!=='new';};
      const file=el('input');file.type='file';file.multiple=true;file.accept='image/png,image/jpeg,image/webp,image/gif';file.hidden=true;file.setAttribute('aria-label','选择表情包图片');
      const upload=button('',()=>file.click(),'sticker-upload-zone');upload.append(el('span','upload-icon','＋'),el('span','','选择本地图片'),el('small','','PNG · JPG · WebP · GIF / 每张 2 MB'));
      const fileRows=el('div','sticker-file-descriptions');
      function paintFiles(){fileRows.replaceChildren();form.fileDescriptions ||= form.files.map(f=>f.name.replace(/\.[^.]+$/,'')||'表情包');if(form.files.length)upload.querySelector('small').textContent=`已选 ${form.files.length} 张`;
        form.files.forEach((f,i)=>{const label=el('label','profile-label',f.name),description=el('input');description.maxLength=256;description.value=form.fileDescriptions[i]||'';description.setAttribute('aria-label',`图片描述 ${i+1}`);description.oninput=()=>{form.fileDescriptions[i]=description.value;form.edit++;};label.append(description);fileRows.append(label);});
      }
      file.onchange=()=>{form.files=Array.from(file.files||[]);form.fileDescriptions=undefined;form.edit++;paintFiles();};body.append(upload,file,fileRows);paintFiles();
      const urls=input(body,'批量链接（每行：描述:图片链接）','urls',true);urls.placeholder='开心:https://example.com/happy.png\n晚安:https://example.com/night.gif';urls.rows=3;
      body.append(el('p','profile-help','每行一张，描述可含空格。每批最多 12 张，图片保存在本机；分类的角色权限请长按分类设置。'));
      body.append(button('保存到表情包',async()=>{
        if(form.busy)return;
        let links;try{links=parseStickerLines(form.urls);}catch(e){status.textContent=e.message;return;}
        const files=[...form.files],descriptions=[...(form.fileDescriptions||[])];if(!files.length&&!links.length||files.length+links.length>12){status.textContent='每批请选择 1–12 张图片或链接';return;}
        const options={revision:snapshot.revision,...(choice.value==='new'?{newName:newName.value}:{categoryId:choice.value})};
        form.busy=true;const fields=[...body.querySelectorAll('input,textarea,select,button')];fields.forEach(f=>f.disabled=true);status.textContent='正在处理图片…';
        try{
          const items=[];
          for(let i=0;i<files.length;i++){if(!descriptions[i]?.trim())throw Error(`请填写第 ${i+1} 张图片的描述`);items.push({data:await readSticker(files[i],win,controller.signal),description:descriptions[i].trim(),category:'收藏',allowedAI:false});if(!current(controller))return;}
          for(const link of links){items.push({data:await fetchSticker(link.url,win,controller.signal),description:link.description||'表情包',category:'收藏',allowedAI:false});if(!current(controller))return;}
          const saved=await library.addBatch(items,controller.signal,options);if(!current(controller))return;
          categoryId=options.categoryId||saved.categories.find(c=>c.name===options.newName.trim()).id;
          form.urls='';form.files=[];form.fileDescriptions=undefined;form.newCategory='';form.importCategory=categoryId;form.edit++;await stickers();
        }catch(e){if(current(controller))status.textContent=`${e.message}；本批未完成，输入已保留`;}
        finally{form.busy=false;if(current(controller))fields.forEach(f=>f.disabled=false);}
      },'profile-action primary'),button('取消导入',()=>{form.files=[];form.fileDescriptions=undefined;form.urls='';form.newCategory='';form.edit++;void stickers();}));
    }catch(e){if(current(controller))status.textContent=e.message;}
  }

  const abort=()=>close();hostSignal.addEventListener('abort',abort,{once:true});
  wrap.addEventListener('pointerdown',event=>{if(!panel.hidden&&!panel.contains(event.target)&&!trigger?.contains(event.target))close();},{signal:life.signal});
  wrap.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){event.preventDefault();event.stopPropagation();close();trigger?.focus({preventScroll:true});}},{signal:life.signal});
  return {open(){if(!panel.hidden){close();return;}wrap.querySelector('.text-composer textarea')?.blur();home();},inspectTransfer,close,paint(){if(view==='receipt'&&!panel.hidden){const m=messenger.history()?.messages.find(m=>m.messageId===selectedTransfer);if(!m)close();else if(m.transfer.state!==receiptState)inspectTransfer(selectedTransfer);}},dispose(){active=false;cancel();life.abort();hostSignal.removeEventListener('abort',abort);panel.remove();}};
}
