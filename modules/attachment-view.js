import { readSticker, fetchSticker } from './stickers.js';
import { money, transferState } from './rich-messages.js';

export function createAttachments({ wrap, person, messenger, el, button }) {
  const win = wrap.ownerDocument.defaultView, state = messenger.draft(person.id);
  const form = state.attachment ||= { amount:'', note:'', description:'', category:'默认', urls:'', files:[], allowedAI:false, edit:0, busy:false };
  const library = messenger.library(), panel = el('section', 'attachment-panel'); panel.hidden = true; wrap.append(panel);
  let active = true, task, view = '', selectedTransfer;
  const hostSignal = messenger.sessionSignal();
  const current = controller => active && !hostSignal.aborted && !controller?.signal.aborted;
  function cancel() { task?.abort(); task = undefined; form.busy = false; }
  function close() { cancel(); panel.hidden = true; panel.replaceChildren(); view = ''; }
  function frame(title) {
    cancel(); panel.replaceChildren(); panel.hidden = false; panel.setAttribute('aria-label', title);
    const head = el('div','attachment-head'); head.append(el('strong','',title),button('×',close,'attachment-close')); head.lastChild.setAttribute('aria-label','关闭附件面板'); panel.append(head);
    const body = el('div','attachment-body'), status = el('p','profile-status'); status.setAttribute('role','status'); panel.append(body,status); return {body,status};
  }
  function input(body, label, key, multiline = false) {
    const row = el('label','profile-label',label), field = el(multiline?'textarea':'input'); field.value = form[key]; field.setAttribute('aria-label',label);
    field.maxLength = key === 'description' ? 256 : key === 'note' ? 120 : key === 'category' ? 40 : key === 'urls' ? 16000 : 16;
    field.oninput = () => { form[key] = field.value; form.edit++; }; if(multiline) field.rows=2;
    row.append(field); body.append(row); return field;
  }
  function home() {
    view='home'; const {body}=frame('添加');
    body.append(button('表情包',stickers),button('转账',transfer));
  }
  function transfer() {
    view='transfer'; const {body,status}=frame('转账');
    body.append(el('p','profile-help',`转给 ${person.remark || person.name} · 虚构转账`));
    const amount=input(body,'转账金额','amount'); amount.inputMode='decimal'; amount.placeholder='0.00';
    input(body,'转账备注','note');
    body.append(button('发送转账',()=>{try{messenger.sendTransfer(person.id,form.amount,form.note);close();}catch(e){status.textContent=e.message;}},'profile-action primary'),button('取消转账',()=>{form.amount='';form.note='';form.edit++;close();}));
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
  async function stickers() {
    view='stickers'; const {body,status}=frame('表情包'), controller=new AbortController();task=controller;
    status.textContent='正在读取…';
    try {
      const assets=(await library.list()).filter(a=>!a.hidden); if(!current(controller))return; status.textContent='';
      const filter=el('select');filter.setAttribute('aria-label','表情包分类');
      for(const category of ['全部',...new Set(assets.map(a=>a.category||'默认'))]){const option=el('option','',category);option.value=category;filter.append(option);}
      body.append(filter,button('导入表情包',importView));
      const grid=el('div','sticker-grid');body.append(grid);
      function paint(){grid.replaceChildren();const visible=assets.filter(a=>filter.value==='全部'||a.category===filter.value);
        if(!visible.length)grid.append(el('p','profile-help','还没有表情包，先导入几张吧'));
        for(const asset of visible){
          const card=el('div','sticker-tile'),send=button('',async()=>{if(form.busy)return;form.busy=true;send.disabled=true;try{await messenger.sendSticker(person.id,asset.id,controller.signal);if(current(controller))close();}catch(e){if(current(controller))status.textContent=e.message;}finally{form.busy=false;if(current(controller))send.disabled=false;}},'sticker-send');
          send.setAttribute('aria-label',`发送表情包：${asset.description}`);const img=el('img');img.src=asset.data;img.alt=asset.description;img.loading='lazy';send.append(img,el('span','',asset.description));card.append(send);
          const details=el('details','sticker-options');details.append(el('summary','','管理'));
          const description=el('input');description.value=asset.description;description.maxLength=256;description.setAttribute('aria-label',`表情包描述：${asset.description}`);
          const category=el('input');category.value=asset.category;category.maxLength=40;category.setAttribute('aria-label','修改分类');
          const label=el('label','profile-check','允许角色使用'),allow=el('input');allow.type='checkbox';allow.checked=asset.allowedAI;label.prepend(allow);
          const draft=form.assetEdits?.[asset.id];if(draft){description.value=draft.description;category.value=draft.category;allow.checked=draft.allowedAI;}
          const edited=()=>{(form.assetEdits ||= {})[asset.id]={description:description.value,category:category.value,allowedAI:allow.checked};};description.oninput=category.oninput=allow.onchange=edited;
          async function update(patch){if(form.busy)return;form.busy=true;try{await library.update(asset.id,patch,controller.signal);if(current(controller)){delete form.assetEdits?.[asset.id];await stickers();}}catch(e){if(current(controller))status.textContent=e.message;}finally{form.busy=false;}}
          details.append(description,category,label,button('保存素材设置',()=>void update({description:description.value.trim(),category:category.value.trim()||'默认',allowedAI:allow.checked})),button('取消素材修改',()=>{delete form.assetEdits?.[asset.id];void stickers();}),button('移出收藏',()=>void update({hidden:true,allowedAI:false})));
          card.append(details);grid.append(card);
        }
      }filter.onchange=paint;paint();
      body.append(el('p','profile-help','素材保存在本机，可供不同存档使用。移出收藏后，已发送的图片仍保留。'));
    }catch(e){if(current(controller))status.textContent=e.message;}
  }
  function importView(){
    view='import';const {body,status}=frame('导入表情包');const controller=new AbortController();task=controller;
    const file=el('input');file.type='file';file.multiple=true;file.accept='image/png,image/jpeg,image/webp,image/gif';file.setAttribute('aria-label','选择表情包图片');
    file.onchange=()=>{form.files=Array.from(file.files||[]);form.edit++;status.textContent=`已选 ${form.files.length} 张`;};body.append(file);
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
    },'profile-action primary'),button('返回表情包',stickers),button('取消导入',()=>{form.files=[];form.urls='';form.description='';form.edit++;void stickers();}));
  }
  const abort=()=>close();hostSignal.addEventListener('abort',abort,{once:true});
  return {open:home,inspectTransfer,close,paint(){if(view==='receipt'&&!panel.hidden){const m=messenger.history()?.messages.find(m=>m.messageId===selectedTransfer);if(!m)close();}},dispose(){active=false;cancel();hostSignal.removeEventListener('abort',abort);panel.remove();}};
}
