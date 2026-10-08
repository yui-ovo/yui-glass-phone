import {friendPrompt,scanFriendEvents} from './friends.js';
export const FRIEND_PROMPT_KEY='yui-glass-phone.friend-events.v1';
export function createFriendBridge(win,profiles,notify=()=>{}){
 let dead=false,epoch=0,controller=new AbortController();const removers=[],ctx=()=>win.SillyTavern?.getContext();
 const clear=()=>{const c=ctx();if(c?.extensionPrompts)delete c.extensionPrompts[FRIEND_PROMPT_KEY];};
 const reset=()=>{epoch++;controller.abort();controller=new AbortController();clear();};
 async function prepare(type,options={},dryRun=false){
  reset();const ticket=epoch,signal=controller.signal;if(dead||dryRun||![undefined,'normal'].includes(type)||options.automatic_trigger||options.quiet_prompt||options.agentResume||!profiles.valid())return;
  try{const session=await profiles.load(signal);profiles.assertSession(session,signal);if(dead||ticket!==epoch)return;const prompt=friendPrompt(session.book);if(!prompt)return;
   if(session.snapshot.group)throw Error('剧情加好友联动暂只支持酒馆角色聊天');if(!ctx().setExtensionPrompt)throw Error('宿主缺少正文提示词接口');
   ctx().setExtensionPrompt(FRIEND_PROMPT_KEY,prompt,1,0,false,0);
  }catch(e){if(!dead&&ticket===epoch){notify('好友联动未准备好：'+e.message);ctx()?.stopGeneration?.();}}
 }
 function bind(name,fn){const c=ctx(),event=c?.eventTypes?.[name];if(event&&c.eventSource?.on){c.eventSource.on(event,fn);removers.push(()=>c.eventSource.removeListener(event,fn));}}
 bind('GENERATION_STARTED',reset);bind('GENERATION_AFTER_COMMANDS',prepare);
 for(const name of ['GENERATION_ENDED','GENERATION_STOPPED'])bind(name,reset);
 for(const name of ['CHAT_CHANGED','CHAT_RENAMED','CHAT_DELETED'])bind(name,reset);
 bind('CHARACTER_MESSAGE_RENDERED',async()=>{const ticket=epoch,signal=controller.signal;try{const s=await profiles.load(signal);profiles.assertSession(s,signal);if(dead||ticket!==epoch||!s.book.people.some(p=>p.friendLinkEnabled&&!p.deletedAt))return;const result=await scanFriendEvents(win,s.book,ctx().chat);if(!dead&&ticket===epoch&&result.events.length)notify(`有 ${result.events.length} 条好友事件待确认：联系人 → 新的朋友`);}catch{}});
 return {clear:reset,dispose(){dead=true;reset();removers.forEach(fn=>fn());}};
}
