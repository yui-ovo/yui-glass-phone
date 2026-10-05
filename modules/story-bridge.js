import {planFloor,syncActiveSwipe} from './supplement-reconcile.js';
import {setPhoneSync} from './sync-events.js';
import {clone} from './contacts.js';
import { createMessageStore } from './message-host.js';
import { pendingSupplement, formatSupplement, validateSupplementSize, digest, makeReceipt, supplementBlocks, SUPPLEMENT_KEY } from './supplement.js';
import { captureSupplementHost, supplementSupported } from './supplement-host.js';
import { decorateSupplements } from './supplement-view.js';
import { sameJson } from './contacts.js';
export const STORY_PROMPT_KEY='yui-glass-phone.story-reference.v1';
export const SUPPLEMENT_INTERCEPTOR='yuiPhoneSupplementInterceptorV1';
export const storyBridgeSupported=supplementSupported;
const instances=new WeakMap();
export function createStoryBridge(win,profiles,notify=()=>{},onHistory=()=>{}) {
  instances.get(win)?.dispose();let dead=false,epoch=0,controller=new AbortController(),pending=null,blocked='',busy=false,syncTask=null;const removers=[];
  const context=()=>win.SillyTavern?.getContext();
  function removeLegacy(){const ctx=context();if(ctx?.extensionPrompts)delete ctx.extensionPrompts[STORY_PROMPT_KEY];}
  const tell=message=>{notify(message);win.toastr?.warning?.(message,'手机补记');};
  function invalidate(){removeLegacy();}
  function switchChat(){epoch++;controller.abort();controller=new AbortController();pending=null;blocked='';removeLegacy();}
  async function retryAppend(){
    if(!pending||busy)return;busy=true;const operation=pending,ticket=epoch;
    try{
      // A failed generation may already have appended the user's own message.
      // Capture again, retaining that message, but never retarget a different AI floor.
      const host=captureSupplementHost(win,operation.session,profiles,controller.signal);
      if(host.target!==operation.host.target||host.index!==operation.host.index||(!sameJson(host.before,operation.host.before)&&!sameJson(host.before,operation.next)))throw Error('待核对的正文已被修改或切换，请重新加载存档核对补记');
      await host.commit(operation.next);if(dead||ticket!==epoch)return;
      pending=null;blocked='';
      const store=createMessageStore(win,profiles,operation.session,controller.signal),history=await store.read();
      await store.reconcile({expectedRevision:history.revision,synced:operation.next.extra[SUPPLEMENT_KEY].batches.flatMap(r=>r.sourceIds)});
      await onHistory();
      // Refresh only the display; do not emit MESSAGE_EDITED and trigger a second summary.
      const ctx=context();if(ctx.updateMessageBlock)ctx.updateMessageBlock(host.index,host.target);
      decorateSupplements(win);notify('手机补记已保存到上一条 AI 正文');
    }catch(e){if(!dead&&ticket===epoch){blocked=e.message;context()?.stopGeneration?.();tell(blocked);}}
    finally{busy=false;}
  }
  async function reconcile(editedIndex){
    const requestedEpoch=epoch;
    if(syncTask){const running=syncTask;await running;if(dead||requestedEpoch!==epoch)return false;if(syncTask===running)syncTask=null;return reconcile(editedIndex);}
    if(dead||busy||pending)return false;
    const ticket=epoch,signal=controller.signal;
    const task=(async()=>{
      try{
        if(typeof profiles.valid==='function'&&!profiles.valid())return true;
        const session=await profiles.load(signal);profiles.assertSession(session,signal);
        if(dead||ticket!==epoch||!session.book.storySync?.enabled)return true;
        const ctx=context(),chat=ctx.chat,store=createMessageStore(win,profiles,session,signal);
        if(!Array.isArray(chat)||chat.some(m=>!m))throw Error('请先加载完整正文再核对手机补记');
        if(Number.isInteger(editedIndex)&&chat[editedIndex]?.extra?.[SUPPLEMENT_KEY]){
          if(!ctx.saveChat)throw Error('宿主没有楼层保存接口');
          // MESSAGE_UPDATED is emitted before the editor's own final save.
          await ctx.saveChat();profiles.assertSession(session,signal);
          const capture=captureSupplementHost(win,session,profiles,signal,editedIndex),disk=await capture.read();capture.guard();
          if(!sameJson(disk.message,capture.before))throw Error('楼层编辑保存未确认，手机消息尚未改动');
        }
        let changed=false;
        for(let index=0;index<chat.length;index++){
          if(!chat[index]?.extra?.[SUPPLEMENT_KEY]?.batches?.some(r=>r.archiveId===session.book.id))continue;
          profiles.assertSession(session,signal);if(dead||ticket!==epoch)return false;
          const host=captureSupplementHost(win,session,profiles,signal,index),history=await store.read();
          const plan=await planFloor(win,session.book,history,host.before);host.guard();
          if(!plan.changed)continue;
          const disk=await host.read();host.guard();if(!sameJson(disk.message,host.before))throw Error('正文编辑尚未保存或磁盘内容不同，请保存楼层后核对');
          // Three-way hashes make partial completion retryable after reload.
          await store.reconcile({expectedRevision:history.revision,changes:plan.changes,synced:plan.synced});host.guard();
          await host.commit(plan.next);host.guard();changed=true;
          ctx.updateMessageBlock?.(index,host.target);
        }
        if(dead||ticket!==epoch)return false;
        blocked='';decorateSupplements(win);if(changed)await onHistory();return true;
      }catch(e){if(!dead&&ticket===epoch){blocked=e.message;tell('补记修改待核对：'+blocked);await onHistory();}return false;}
    })();syncTask=task;try{return await task;}finally{if(syncTask===task)syncTask=null;}
  }
  async function detachMissing(){
    if(busy||syncTask||pending)throw Error('请先等待正在进行的补记操作');
    const signal=controller.signal,session=await profiles.load(signal),ctx=context(),store=createMessageStore(win,profiles,session,signal);
    for(let index=0;index<ctx.chat.length;index++){
      if(!ctx.chat[index]?.extra?.[SUPPLEMENT_KEY])continue;
      const missing=supplementBlocks(ctx.chat[index],{allowMissing:true}).filter(b=>b.text===null&&b.receipt.archiveId===session.book.id);if(!missing.length)continue;
      const host=captureSupplementHost(win,session,profiles,signal,index),next=clone(host.before),history=await store.read();
      await store.reconcile({expectedRevision:history.revision,synced:missing.flatMap(b=>b.receipt.sourceIds)});
      next.extra[SUPPLEMENT_KEY].batches=next.extra[SUPPLEMENT_KEY].batches.filter(r=>!missing.some(b=>b.receipt.batchId===r.batchId));syncActiveSwipe(next);await host.commit(next);
    }
    blocked='';await onHistory();return reconcile();
  }
  const removeSync=setPhoneSync(win,()=>reconcile(),()=>({busy:busy||!!syncTask,error:blocked}));
  async function prepare(type,options={},dryRun=false){
    removeLegacy();if(dead||dryRun||![undefined,'normal'].includes(type)||options.quiet_prompt||options.agentResume||options.automatic_trigger)return;
    const startEpoch=epoch;
    if(busy){blocked='手机补记正在保存，请稍后重试';context()?.stopGeneration?.();return;}
    if(pending){await retryAppend();if(dead||epoch!==startEpoch||pending)return;}
    const ready=await reconcile();if(dead||epoch!==startEpoch)return;if(!ready){context()?.stopGeneration?.();return;}
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
      const receipt=await makeReceipt(win,session.book.id,batchId,rows);
      host.guard();pending={host,session,next:host.next(block,receipt)};await retryAppend();
    }catch(e){if(!dead&&ticket===epoch){blocked=e.message;context()?.stopGeneration?.();tell('本次正文暂停：'+blocked);}}
  }
  const intercept=async(chat,_size,abort,type)=>{
    if(dead||type==='quiet'||type==='impersonate')return;
    if(pending||busy||syncTask||blocked){abort(true);tell('手机补记尚未确认：'+(blocked||'请稍后重试'));return;}
    if(![undefined,'normal'].includes(type))return;
    const latest=context()?.chat?.findLast(m=>m?.is_user===false),receipts=latest?.extra?.[SUPPLEMENT_KEY]?.batches||[];
    if(receipts.some(r=>!chat.some(m=>m.mes?.includes(`【Yui手机交流补记 ${r.batchId}】`)))){abort(true);tell('正文输入未包含手机补记，请检查隐藏楼层、输入正则及上下文范围');}
  };
  win[SUPPLEMENT_INTERCEPTOR]=intercept;removeLegacy();
  const ctx=context();if(ctx?.eventSource?.on){const listen=(name,fn)=>{const event=ctx.eventTypes?.[name];if(event){ctx.eventSource.on(event,fn);removers.push(()=>ctx.eventSource.removeListener(event,fn));}};
    listen('GENERATION_AFTER_COMMANDS',prepare);
    listen('MESSAGE_UPDATED',index=>reconcile(index));
    listen('MESSAGE_SWIPED',()=>{if(pending||busy||syncTask){epoch++;controller.abort();controller=new AbortController();pending=null;blocked='已切换备选回复，请核对当前补记后重试';}});
    listen('MESSAGE_DELETED',()=>{if(pending){epoch++;controller.abort();controller=new AbortController();pending=null;blocked='正文楼层已删除，请核对待同步内容';}});
    for(const name of ['CHAT_CHANGED','CHAT_RENAMED','CHAT_DELETED'])listen(name,switchChat);
    for(const name of ['CHARACTER_MESSAGE_RENDERED','CHAT_CHANGED','MESSAGE_UPDATED'])listen(name,()=>decorateSupplements(win));
  }
  decorateSupplements(win);
  const api={invalidate,retry:async()=>{await retryAppend();return reconcile();},reconcile,detachMissing,status:()=>({busy:busy||!!syncTask,error:blocked,pending:!!pending}),last:()=>null,dispose(){dead=true;switchChat();removeSync();removers.forEach(fn=>fn());if(win[SUPPLEMENT_INTERCEPTOR]===intercept)delete win[SUPPLEMENT_INTERCEPTOR];if(instances.get(win)===api)instances.delete(win);}};
  instances.set(win,api);void reconcile();return api;
}

