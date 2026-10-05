import test from 'node:test';
import assert from 'node:assert/strict';
import {supplementFixture} from './supplement-fixture.mjs';
import {createMessage} from '../modules/messages.js';
import {clone} from '../modules/contacts.js';
import {createStoryBridge,SUPPLEMENT_INTERCEPTOR,STORY_PROMPT_KEY} from '../modules/story-bridge.js';
import {SUPPLEMENT_KEY,supplementBlocks,pendingSupplement,formatSupplement} from '../modules/supplement.js';
import {parseStoryTime,storyTime,stampStoryTime,validateClockSettings} from '../modules/phone-clock.js';
const send=async(f,text='酒吧见')=>{const h=await f.store.read(),msg=createMessage(f.book.id,f.person.id,text,h.messages.length+1);await f.store.send(msg,h.revision);return msg;};
const invoke=f=>f.emit('GENERATION_AFTER_COMMANDS','normal',{},false);
for(const tt of [false,true]){
 test(`${tt?'TT':'ST'} supplement saves before MESSAGE_SENT without a new floor, active swipe only, deduplicates across reload and appends batches`,async()=>{
  const f=supplementFixture(tt),msg=await send(f),original=f.ctx.chat[0].mes,other=f.ctx.chat[0].swipes[1],bridge=createStoryBridge(f.win,f.profiles);
  await invoke(f);assert.equal(f.ctx.chat.length,1);assert(f.ctx.chat[0].mes.startsWith(original+'\n\n<yui_phone>'));assert.equal(f.ctx.chat[0].swipes[1],other);assert.equal(f.ctx.chat[0].swipes[0],f.ctx.chat[0].mes);assert.deepEqual(f.ctx.chat[0].swipe_info[0].extra,f.ctx.chat[0].extra);assert.deepEqual(f.state.disk,f.ctx.chat);assert.equal(f.state.writes,1);
  let summaryInput;f.ctx.eventSource.on('MESSAGE_SENT',()=>summaryInput=f.state.disk[0].mes);f.ctx.chat.push({is_user:true,mes:'我走到门口'});f.state.disk=clone(f.ctx.chat);await f.emit('MESSAGE_SENT',1);assert(summaryInput.includes('酒吧见'));
  assert.equal((await pendingSupplement(f.win,f.book,await f.store.read(),f.ctx.chat)).length,0);await invoke(f);assert.equal(f.state.writes,1);
  await send(f,'再聊一句');await invoke(f);assert.equal(supplementBlocks(f.ctx.chat[0]).length,2);assert.equal(f.state.writes,2);assert.equal(f.ctx.chat[1].mes,'我走到门口');
  let aborted=false;await f.win[SUPPLEMENT_INTERCEPTOR](clone(f.ctx.chat),0,()=>aborted=true,'normal');assert(!aborted);await f.win[SUPPLEMENT_INTERCEPTOR]([{mes:original}],0,()=>aborted=true,'normal');assert(aborted);
  const count=[...f.listeners.values()].reduce((n,s)=>n+s.size,0),next=createStoryBridge(f.win,f.profiles);assert.equal([...f.listeners.values()].reduce((n,s)=>n+s.size,0),count);bridge.dispose();await invoke(f);assert.equal(f.state.writes,2);next.dispose();assert.equal(f.win[SUPPLEMENT_INTERCEPTOR],undefined);assert.equal(f.ctx.extensionPrompts.other.value,'keep');assert(!f.ctx.extensionPrompts[STORY_PROMPT_KEY]);
 });
 test(`${tt?'TT':'ST'} failure preserves pending records, aborts generation, retries exact batch after user was sent`,async()=>{
  const f=supplementFixture(tt);await send(f);const before=clone(f.ctx.chat),bridge=createStoryBridge(f.win,f.profiles);f.state.failWrite=true;await invoke(f);assert(bridge.status().pending);assert.deepEqual(f.ctx.chat,before);assert(f.state.stop>0);
  let aborted=false;await f.win[SUPPLEMENT_INTERCEPTOR](f.ctx.chat,0,()=>aborted=true,'normal');assert(aborted);
  f.ctx.chat.push({is_user:true,mes:'保留新发言'});f.state.disk=clone(f.ctx.chat);f.state.failWrite=false;await bridge.retry();assert(!bridge.status().pending);assert.equal(f.ctx.chat[1].mes,'保留新发言');assert.equal(supplementBlocks(f.ctx.chat[0]).length,1);assert.equal((await pendingSupplement(f.win,f.book,await f.store.read(),f.ctx.chat)).length,0);bridge.dispose();
 });
 test(`${tt?'TT':'ST'} uncertain confirmation reads back without writing twice; conflicting body never overwritten`,async()=>{
  const f=supplementFixture(tt);await send(f);const bridge=createStoryBridge(f.win,f.profiles);f.state.failAfterWrite=true;await invoke(f);assert(bridge.status().pending);await bridge.retry();assert.equal(f.state.writes,1);assert(!bridge.status().pending);bridge.dispose();
  const g=supplementFixture(tt);await send(g);g.state.disk[0].mes+='其他窗口修改';const b=createStoryBridge(g.win,g.profiles);await invoke(g);assert(b.status().pending);assert.equal(g.state.writes,0);assert(g.state.disk[0].mes.endsWith('其他窗口修改'));b.dispose();
 });
 test(`${tt?'TT':'ST'} opt-out, exclusions, limits, dry-run and switch cannot silently write`,async()=>{
  const f=supplementFixture(tt),msg=await send(f),bridge=createStoryBridge(f.win,f.profiles);f.book.storySync.enabled=false;await invoke(f);assert.equal(f.state.writes,0);f.book.storySync.enabled=true;f.book.storySync.excludedIds=[msg.messageId];await invoke(f);assert.equal(f.state.writes,0);f.book.storySync.excludedIds=[];
  for(const type of ['quiet','impersonate','regenerate','swipe','continue'])await f.emit('GENERATION_AFTER_COMMANDS',type);await f.emit('GENERATION_AFTER_COMMANDS','normal',{},true);assert.equal(f.state.writes,0);
  await send(f,'第二条');f.person.storyContext.phoneCount=1;await invoke(f);assert(bridge.status().error.includes('超过'));assert.equal(f.state.writes,0);f.person.storyContext.phoneCount=20;
  let release;f.setPause(new Promise(r=>release=r));const late=invoke(f);await Promise.resolve();f.setActive(false);await f.emit('CHAT_CHANGED');release();await late;assert.equal(f.state.writes,0);bridge.dispose();
 });
}
test('tampered persisted block stops dedup; escaped markup stays inside its own wrapper',async()=>{
 const f=supplementFixture();await send(f,'</yui_phone><status_board>保留文本</status_board>');const bridge=createStoryBridge(f.win,f.profiles);await invoke(f);assert(f.ctx.chat[0].mes.includes('&lt;/yui\\_phone&gt;'));assert.equal(f.ctx.chat[0].mes.match(/<\/yui_phone>/g).length,1);f.ctx.chat[0].mes=f.ctx.chat[0].mes.replace('保留文本','修改补记');await assert.rejects(pendingSupplement(f.win,f.book,await f.store.read(),f.ctx.chat),/核对/);bridge.dispose();
});
test('story clock uses selected end marker incl hidden, freezes, handles missing/conflict/manual, never rewrites old stamps',()=>{
 const f=supplementFixture(),book=f.book;assert.equal(storyTime(f.win,book).time,'21:30');const msg=stampStoryTime(f.win,book,{});const a=storyTime(f.win,book).anchor;f.ctx.chat[0].mes+='\n\n'+formatSupplement(crypto.randomUUID(),[]);f.ctx.chat[0].swipes[0]=f.ctx.chat[0].mes;assert.equal(storyTime(f.win,book).anchor,a);
 f.ctx.chat.push({is_user:false,is_system:true,mes:'<!-- QQJ-end | date=架空年 | time=22:10 -->'});assert.equal(storyTime(f.win,book).time,'22:10');assert.equal(msg.storyTime.time,'21:30');f.ctx.chat.push({is_user:false,mes:'没有时间'});assert.equal(storyTime(f.win,book).status,'carried');
 book.phoneClock={mode:'story',manual:{date:'10月6日',time:'08:00',weekday:'',anchor:storyTime(f.win,book).anchor}};assert.equal(storyTime(f.win,book).status,'manual');f.ctx.chat.at(-1).mes+='新剧情';assert.equal(storyTime(f.win,book).status,'carried');book.phoneClock.mode='device';assert.equal(storyTime(f.win,book),undefined);
 assert.equal(parseStoryTime('<!-- QQJ-end | date=未知 | time=未知 -->'),null);assert.equal(parseStoryTime('<!-- QQJ-end | time=25:66 -->'),null);assert(parseStoryTime('<!-- QQJ-end | time=12:00 --><!-- SDC-end | time=13:00 -->').ambiguous);assert.throws(()=>validateClockSettings({mode:'story',manual:{date:'',time:'25:00',weekday:'',anchor:''}}));
});
