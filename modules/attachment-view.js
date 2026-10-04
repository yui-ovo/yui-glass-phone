import { readSticker, fetchSticker } from './stickers.js';
import { money, transferState } from './rich-messages.js';

export function createAttachments({ wrap, person, messenger, el, button }) {
  const win = wrap.ownerDocument.defaultView, state = messenger.draft(person.id);
  const form = state.attachment ||= { amount:'', note:'', description:'', category:'默认', urls:'', files:[], allowedAI:false, edit:0, busy:false };
  const library = messenger.library(), panel = el('section', 'attachment-panel'); panel.hidden = true; wrap.append(panel);
  const life = new AbortController(), trigger = wrap.querySelector('[aria-label="添加附件"]');
  trigger?.setAttribute('aria-expanded','false');
  let active = true, task, view = '', selectedTransfer;
  const hostSignal = messenger.sessionSignal();
  const current = controller => active && !hostSignal.aborted && !controller?.signal.aborted;
  function cancel() { task?.abort(); task = undefined; form.busy = false; }
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
    body.append(el('p','profile-help',`转给 ${person.remark || person.name} · 虚构转账`));
    const amount=input(body,'转账金额','amount'); amount.inputMode='decimal'; amount.placeholder='0.00';
    input(body,'转账备注','note');
    const actions=el('div','attachment-dialog-actions');body.append(actions);
    actions.append(button('取消转账',()=>{form.amount='';form.note='';form.edit++;close();}),button('发送转账',()=>{try{messenger.sendTransfer(person.id,form.amount,form.note);close();}catch(e){status.textContent=e.message;}},'profile-action primary'));
  }
  function inspectTransfer(messageId) {
    const message=messenger.history()?.messages.find(m=>m.messageId===messageId); if(!message?.transfer)return;
    selectedTransfer=messageId; view='receipt'; const {body,status}=frame('转账详情');
    body.append(el('h2','transfer-amount',`¥${money(message.transfer.amountMinor)}`),el('p','',message.transfer.note),el('p','profile-help',transferState(message.transfer.state)));
    if(message.transfer.state==='pending'&&message.recipient.kind==='self') {
      for(const [label,action] of [['确认收款','receive'],['确认退回','refund']])body.append(button(label,()=>{try{messenger.settleTransfer(person.id,messageId,action);close();}catch(e){status.textContent=e.message;}}));
    }
    body.append(el('p','profile-help','虚构转账，不涉及真实支付或钱包余额。'));
  }
  function stickerFrame(selected) {
    const titles={stickers:'表情包',import:'添加表情包',tags:'管理标签',settings:'表情包设置'};
    const result=frame(titles[selected]),head=panel.querySelector('.attachment-head'),tools=el('div','sticker-header-tools');
    if(selected==='stickers') {
      const add=button('＋',importView,'sticker-header-button');add.setAttribute('aria-label','添加表情包');
      const menu=el('details','sticker-more'),toggle=el('summary','','⋯');toggle.setAttribute('aria-label','表情包管理');
      const choices=el('div','sticker-more-menu');choices.append(button('管理标签',()=>void stickers('tags')),button('设置',()=>void stickers('settings')));menu.append(toggle,choices);tools.append(add,menu);
    } else tools.append(button('返回',()=>void stickers(),'sticker-header-button'));
    head.insertBefore(tools,head.lastChild);return result;
  }
  async function stickers(mode='stickers') {
    view=mode; const {body,status}=stickerFrame(mode), controller=new AbortController();task=controller;
    status.textContent='正在读取…';
    try {
      const assets=(await library.list()).filter(a=>!a.hidden); if(!current(controller))return; status.textContent='';
      if(mode==='settings')body.append(el('p','profile-help','勾选后，角色可在你请求回复时使用该表情包。AI 通过描述理解图片，尚未接入识图。'));
      if(mode==='tags')body.append(el('p','profile-help','修改每张表情包的标签；保存后可在收藏中按标签筛选。'));
      const filterRow=el('div','sticker-filter'),count=el('span','sticker-count');
      const filter=el('nav','sticker-tabs');filter.setAttribute('aria-label','表情包分类');
      let selected='';
      for(const category of ['',...new Set(assets.map(a=>a.category||'默认'))]){
        const tab=button(category||'收藏',()=>{selected=category;paint();},'sticker-tab');tab.dataset.category=category;filter.append(tab);
      }
      filterRow.append(filter,count);body.append(filterRow);
      const grid=el('div',mode==='stickers'?'sticker-grid':'sticker-management');body.append(grid);
      function paint(){grid.replaceChildren();const visible=assets.filter(a=>!selected||a.category===selected);
        for(const tab of filter.children){const active=tab.dataset.category===selected;tab.classList.toggle('active',active);tab.setAttribute('aria-pressed',String(active));}
        count.textContent=`共 ${visible.length} 个`;
        if(!visible.length){const empty=el('div','sticker-empty');empty.append(el('span','','☺'),el('p','','还没有表情包'),button('导入表情包',importView,'sticker-empty-add'));grid.append(empty);}
        for(const asset of visible){
          if(mode==='stickers'){
          const card=el('div','sticker-tile'),send=button('',async()=>{if(form.busy)return;form.busy=true;send.disabled=true;try{await messenger.sendSticker(person.id,asset.id,controller.signal);if(current(controller))close();}catch(e){if(current(controller))status.textContent=e.message;}finally{form.busy=false;if(current(controller))send.disabled=false;}},'sticker-send');
          send.setAttribute('aria-label',`发送表情包：${asset.description}`);const img=el('img');img.src=asset.data;img.alt=asset.description;img.loading='lazy';send.append(img,el('span','',asset.description));card.append(send);
          grid.append(card);continue;
          }
          const card=el('div','sticker-tile'),img=el('img');img.src=asset.data;img.alt=asset.description;card.append(img);
          const details=el('div','sticker-options');
          const description=el('input');description.value=asset.description;description.maxLength=256;description.setAttribute('aria-label',`表情包描述：${asset.description}`);
          const category=el('input');category.value=asset.category;category.maxLength=40;category.setAttribute('aria-label','修改分类');
          const label=el('label','profile-check','允许角色使用'),allow=el('input');allow.type='checkbox';allow.checked=asset.allowedAI;label.prepend(allow);
          const draft=form.assetEdits?.[asset.id];if(draft){description.value=draft.description;category.value=draft.category;allow.checked=draft.allowedAI;}
          const edited=()=>{(form.assetEdits ||= {})[asset.id]={description:description.value,category:category.value,allowedAI:allow.checked};};description.oninput=category.oninput=allow.onchange=edited;
          async function update(patch){if(form.busy)return;form.busy=true;try{await library.update(asset.id,patch,controller.signal);if(current(controller)){delete form.assetEdits?.[asset.id];await stickers(mode);}}catch(e){if(current(controller))status.textContent=e.message;}finally{form.busy=false;}}
          if(mode==='tags')details.append(el('span','',asset.description),category);else details.append(description,label);
          const actions=el('div','sticker-manage-actions');actions.append(button('保存素材设置',()=>void update({description:description.value.trim(),category:category.value.trim()||'默认',allowedAI:allow.checked}),'sticker-save'),button('取消素材修改',()=>{delete form.assetEdits?.[asset.id];void stickers(mode);},'sticker-cancel'));
          if(mode==='tags')actions.append(button('移出收藏',()=>void update({hidden:true,allowedAI:false}),'sticker-remove'));
          details.append(actions);
          card.append(details);grid.append(card);
        }
      }paint();
      if(mode==='settings')body.append(el('p','profile-help','素材保存在本机，可供不同存档使用。移出收藏后，已发送的图片仍保留。'));
    }catch(e){if(current(controller))status.textContent=e.message;}
  }
  function importView(){
    view='import';const {body,status}=stickerFrame('import');const controller=new AbortController();task=controller;
    const file=el('input');file.type='file';file.multiple=true;file.accept='image/png,image/jpeg,image/webp,image/gif';file.setAttribute('aria-label','选择表情包图片');
    const upload=button('',()=>file.click(),'sticker-upload-zone');upload.append(el('span','upload-icon','＋'),el('span','','点击选择图片'),el('small','','PNG · JPG · WebP · GIF / 每张 2 MB'));
    if(form.files.length)upload.querySelector('small').textContent=`已选 ${form.files.length} 张`;
    file.hidden=true;file.onchange=()=>{form.files=Array.from(file.files||[]);form.edit++;status.textContent=`已选 ${form.files.length} 张`;upload.querySelector('small').textContent=`已选 ${form.files.length} 张`;};body.append(upload,file);
    input(body,'图片链接（每行一条）','urls',true);input(body,'表情描述','description');input(body,'分类','category');
    const label=el('label','profile-check','允许角色使用这些表情包'),allow=el('input');allow.type='checkbox';allow.checked=form.allowedAI;allow.onchange=()=>{form.allowedAI=allow.checked;form.edit++;};label.prepend(allow);body.append(label);
    body.append(el('p','profile-help','每批最多 12 张，每张 2 MB。GIF 保留动画。链接需要允许跨域读取；图片只保存在本机。描述供 AI 理解，不代表已接入识图。'));
    body.append(button('保存到表情包',async()=>{
      if(form.busy)return;const urls=form.urls.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),files=[...form.files];
      if(!files.length&&!urls.length||files.length+urls.length>12){status.textContent='每批请选择 1–12 张图片或链接';return;}
      form.busy=true;const fields=[...body.querySelectorAll('input,textarea,button')];fields.forEach(f=>f.disabled=true);status.textContent='正在处理图片…';
      try{
        const images=[];
        for(const f of files){images.push({data:await readSticker(f,win,controller.signal),fallback:f.name.replace(/\.[^.]+$/,'')||'表情包'});if(!current(controller))return;}
        for(const url of urls){images.push({data:await fetchSticker(url,win,controller.signal),fallback:'表情包'});if(!current(controller))return;}
        const items=images.map(img=>({data:img.data,description:(form.description.trim()||img.fallback).slice(0,256),category:form.category.trim()||'默认',allowedAI:form.allowedAI}));
        await library.addBatch(items,controller.signal);if(!current(controller))return;
        form.description='';form.urls='';form.files=[];form.edit++;await stickers();
      }catch(e){if(current(controller))status.textContent=`${e.message}；本批未完成，输入已保留`;}
      finally{form.busy=false;if(current(controller))fields.forEach(f=>f.disabled=false);}
    },'profile-action primary'),button('返回表情包',()=>void stickers()),button('取消导入',()=>{form.files=[];form.urls='';form.description='';form.edit++;void stickers();}));
  }
  const abort=()=>close();hostSignal.addEventListener('abort',abort,{once:true});
  wrap.addEventListener('pointerdown',event=>{if(!panel.hidden&&!panel.contains(event.target)&&!trigger?.contains(event.target))close();},{signal:life.signal});
  wrap.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){event.preventDefault();event.stopPropagation();close();trigger?.focus({preventScroll:true});}},{signal:life.signal});
  return {open(){if(!panel.hidden){close();return;}wrap.querySelector('.text-composer textarea')?.blur();home();},inspectTransfer,close,paint(){if(view==='receipt'&&!panel.hidden){const m=messenger.history()?.messages.find(m=>m.messageId===selectedTransfer);if(!m)close();}},dispose(){active=false;cancel();life.abort();hostSignal.removeEventListener('abort',abort);panel.remove();}};
}
