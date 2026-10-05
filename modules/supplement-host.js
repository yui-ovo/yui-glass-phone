import { clone, sameJson } from './contacts.js';
import { ttHost } from './host.js';
import { SUPPLEMENT_KEY } from './supplement.js';
export function supplementSupported(win) {
  const c=win.SillyTavern?.getContext();
  return !!(c?.eventSource?.on && c.eventSource?.removeListener && c.eventTypes?.MESSAGE_SENT && c.eventTypes?.GENERATION_AFTER_COMMANDS && c.getRequestHeaders && (!ttHost(win)||c.saveChat&&ttHost(win).api?.chat?.open));
}
export function captureSupplementHost(win, session, profiles, signal) {
  const ctx=win.SillyTavern.getContext(),chat=ctx.chat;
  if(ctx.groupId!==undefined&&ctx.groupId!==null&&ctx.groupId!=='')throw Error('本批补记暂支持角色聊天，酒馆群聊请先关闭补记');
  if(!Array.isArray(chat)||!chat.length||chat.some(m=>!m))throw Error('请先加载完整的当前聊天');
  const ref={avatar:session.snapshot.source?.avatarFile,file:session.snapshot.chatId.replace(/\.jsonl$/,''),name:ctx.characters?.[String(ctx.characterId)]?.name};
  if(!ref.avatar||!ref.file)throw Error('无法确认补记所属存档');
  const native=ttHost(win)?.api?.chat?.open({kind:'character',characterId:ref.avatar.replace(/\.png$/,''),fileName:ref.file});
  if(native&&!native.history?.tail)throw Error('此 TT 版本缺少补记读回核对接口，请更新 TT');
  let index=chat.length-1;
  while(index>=0&&chat[index].is_user===true)index--;
  const target=chat[index],length=chat.length;
  if(!target||target.is_user!==false||target.role==='tool'||target.extra?.tool_invocations||typeof target.mes!=='string'||target.extra?.type||target.isPhoneMessage||target.isGaigaiPrompt||target.isGaigaiData)throw Error('找不到可追加补记的上一条 AI 正文');
  if(Array.isArray(target.swipes)&&(!Number.isInteger(target.swipe_id)||target.swipes[target.swipe_id]!==target.mes))throw Error('当前备选回复尚未稳定，请结束生成后再同步');
  const before=clone(target),beforeChat=clone(chat),metadata=clone(ctx.chatMetadata||{}),headers=ctx.getRequestHeaders();
  async function request(url,options){const timeout=new AbortController(),abort=()=>timeout.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();const timer=setTimeout(abort,15000);try{return await win.fetch(url,{...options,signal:timeout.signal});}finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}}
  function guard(){profiles.assertSession(session,signal);const now=win.SillyTavern.getContext();if(now.chat!==chat||chat[index]!==target||chat.length!==length)throw Error('正文或存档已变化，未追加手机补记');}
  async function read(){
    if(native){const page=await native.history.tail({limit:length});if(page?.startIndex!==0||!Array.isArray(page.messages)||page.messages.length!==length)throw Error('TT 正文尾部已变化，补记保存未确认');return {message:page.messages[index],messages:page.messages};}
    const response=await request('/api/chats/get',{method:'POST',headers,body:JSON.stringify({avatar_url:ref.avatar,file_name:ref.file}),cache:'no-store'});
    if(!response.ok)throw Error('正文读回失败');const data=await response.json();
    if(!Array.isArray(data)||data.length!==length+1||!data[0]?.chat_metadata)throw Error('正文长度或存档头已变化，补记保存未确认');
    if(data[0].chat_metadata.integrity!==metadata.integrity)throw Error('正文存档身份已变化');
    return {message:data[index+1],messages:data.slice(1)};
  }
  return {index,target,before,guard,read,
    async commit(next) {
      guard();const disk=await read();guard();
      if(sameJson(disk.message,next)){if(!sameJson(target,before)&&!sameJson(target,next))throw Error('正文已有其他修改，请重新加载核对');Object.assign(target,clone(next));return;}
      if(!sameJson(disk.message,before)||!sameJson(target,before)||!sameJson(chat,beforeChat))throw Error('本次发言已有其他修改，请核对后重试；未覆盖正文');
      if(disk.messages&&!sameJson(disk.messages,beforeChat))throw Error('磁盘正文已有其他修改，未覆盖');
      guard();let writeError;
      if(native){Object.assign(target,clone(next));try{await ctx.saveChat();}catch(e){writeError=e;}}
      else{const data=clone(beforeChat);data[index]=clone(next);try{const response=await request('/api/chats/save',{method:'POST',headers,cache:'no-store',body:JSON.stringify({ch_name:ref.name,avatar_url:ref.avatar,file_name:ref.file,force:false,chat:[{chat_metadata:metadata,user_name:'unused',character_name:'unused'},...data]})});if(!response.ok)writeError=Error(`正文保存返回 HTTP ${response.status}`);}catch(e){writeError=e;}}
      try{const confirmed=await read();guard();if(!sameJson(confirmed.message,next))throw Error('补记保存结果未确认');if(!sameJson(target,before)&&!sameJson(target,next))throw Error('保存期间正文有其他修改，请重新加载核对');Object.assign(target,clone(next));}
      catch(e){if(native&&sameJson(target,next)){for(const k of Object.keys(target))delete target[k];Object.assign(target,clone(before));}throw Error((writeError?.message||e.message)+'；请在待同步补记中核对并重试');}
    },
    next(block,receipt){const next=clone(before);next.mes=before.mes+'\n\n'+block;next.extra={...(next.extra||{}),[SUPPLEMENT_KEY]:{version:2,batches:[...(before.extra?.[SUPPLEMENT_KEY]?.batches||[]),receipt]}};if(Array.isArray(next.swipes)){next.swipes[next.swipe_id]=next.mes;if(!Array.isArray(next.swipe_info))next.swipe_info=[];next.swipe_info[next.swipe_id]={...(next.swipe_info[next.swipe_id]||{}),extra:clone(next.extra)};}return next;},
  };
}
