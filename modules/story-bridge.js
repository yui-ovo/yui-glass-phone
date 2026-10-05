import { createMessageStore } from './message-host.js';
import { pendingSupplement, formatSupplement, validateSupplementSize, digest, SUPPLEMENT_KEY } from './supplement.js';
import { captureSupplementHost, supplementSupported } from './supplement-host.js';
import { decorateSupplements } from './supplement-view.js';
import { sameJson } from './contacts.js';
export const STORY_PROMPT_KEY='yui-glass-phone.story-reference.v1';
export const SUPPLEMENT_INTERCEPTOR='yuiPhoneSupplementInterceptorV1';
export const storyBridgeSupported=supplementSupported;
const instances=new WeakMap();
export function createStoryBridge(win,profiles,notify=()=>{}) {
  instances.get(win)?.dispose();let dead=false,epoch=0,controller=new AbortController(),pending=null,blocked='',busy=false;const removers=[];
  const context=()=>win.SillyTavern?.getContext();
  function removeLegacy(){const ctx=context();if(ctx?.extensionPrompts)delete ctx.extensionPrompts[STORY_PROMPT_KEY];}
  const tell=message=>{notify(message);win.toastr?.warning?.(message,'手机补记');};
  function invalidate(){removeLegacy();}
  function switchChat(){epoch++;controller.abort();controller=new AbortController();pending=null;blocked='';removeLegacy();}
  async function retry(){
    if(!pending||busy)return;busy=true;const operation=pending,ticket=epoch;
    try{
      // A failed generation may already have appended the user's own message.
      // Capture again, retaining that message, but never retarget a different AI floor.
      const host=captureSupplementHost(win,operation.session,profiles,controller.signal);
      if(host.target!==operation.host.target||host.index!==operation.host.index||(!sameJson(host.before,operation.host.before)&&!sameJson(host.before,operation.next)))throw Error('待核对的正文已被修改或切换，请重新加载存档核对补记');
      await host.commit(operation.next);if(dead||ticket!==epoch)return;
      pending=null;blocked='';
      // Refresh only the display; do not emit MESSAGE_EDITED and trigger a second summary.
      const ctx=context();if(ctx.updateMessageBlock)ctx.updateMessageBlock(host.index,host.target);
      decorateSupplements(win);notify('手机补记已保存到上一条 AI 正文');
    }catch(e){if(!dead&&ticket===epoch){blocked=e.message;context()?.stopGeneration?.();tell(blocked);}}
    finally{busy=false;}
  }
  async function prepare(type,options={},dryRun=false){
    removeLegacy();if(dead||dryRun||![undefined,'normal'].includes(type)||options.quiet_prompt||options.agentResume||options.automatic_trigger)return;
    if(busy){blocked='手机补记正在保存，请稍后重试';context()?.stopGeneration?.();return;}
    if(pending){await retry();if(pending)return;}
    blocked='';const ticket=epoch,signal=controller.signal;
    try{
      if(typeof profiles.valid==='function'&&!profiles.valid())return;
      const session=await profiles.load(signal);if(dead||ticket!==epoch||!session.book.storySync?.enabled)return;
      if(!session.book.people.some(p=>!p.deletedAt&&p.relation.friend&&p.storyContext?.sharePhone))return;
      if(!supplementSupported(win))throw Error('当前宿主不支持补记保存，请关闭补记开关后继续');
      const history=await createMessageStore(win,profiles,session,signal).read();profiles.assertSession(session,signal);if(dead||ticket!==epoch)return;
      const rows=(await pendingSupplement(win,session.book,history,context().chat)).filter(r=>!r.excluded);
      profiles.assertSession(session,signal);if(dead||ticket!==epoch)return;validateSupplementSize(session.book,rows);if(!rows.length)return;
      const host=captureSupplementHost(win,session,profiles,signal),batchId=win.crypto.randomUUID(),block=formatSupplement(batchId,rows);
      const receipt={version:1,archiveId:session.book.id,batchId,sourceIds:rows.map(r=>r.id),hash:await digest(win,block)};
      host.guard();pending={host,session,next:host.next(block,receipt)};await retry();
    }catch(e){if(!dead&&ticket===epoch){blocked=e.message;context()?.stopGeneration?.();tell('本次正文暂停：'+blocked);}}
  }
  const intercept=async(chat,_size,abort,type)=>{
    if(dead||type==='quiet'||type==='impersonate')return;
    if(pending||busy||blocked){abort(true);tell('手机补记尚未确认：'+(blocked||'请稍后重试'));return;}
    if(![undefined,'normal'].includes(type))return;
    const latest=context()?.chat?.findLast(m=>m?.is_user===false),receipts=latest?.extra?.[SUPPLEMENT_KEY]?.batches||[];
    if(receipts.some(r=>!chat.some(m=>m.mes?.includes(`【Yui手机交流补记 ${r.batchId}】`)))){abort(true);tell('正文输入未包含手机补记，请检查隐藏楼层、输入正则及上下文范围');}
  };
  win[SUPPLEMENT_INTERCEPTOR]=intercept;removeLegacy();
  const ctx=context();if(ctx?.eventSource?.on){const listen=(name,fn)=>{const event=ctx.eventTypes?.[name];if(event){ctx.eventSource.on(event,fn);removers.push(()=>ctx.eventSource.removeListener(event,fn));}};
    listen('GENERATION_AFTER_COMMANDS',prepare);
    for(const name of ['CHAT_CHANGED','CHAT_RENAMED','CHAT_DELETED'])listen(name,switchChat);
    for(const name of ['CHARACTER_MESSAGE_RENDERED','CHAT_CHANGED','MESSAGE_UPDATED'])listen(name,()=>decorateSupplements(win));
  }
  decorateSupplements(win);
  const api={invalidate,retry,status:()=>({busy,error:blocked,pending:!!pending}),last:()=>null,dispose(){dead=true;switchChat();removers.forEach(fn=>fn());if(win[SUPPLEMENT_INTERCEPTOR]===intercept)delete win[SUPPLEMENT_INTERCEPTOR];if(instances.get(win)===api)instances.delete(win);}};
  instances.set(win,api);return api;
}
