import test from 'node:test';
import assert from 'node:assert/strict';
import {newHistory,createMessage,appendMessage,createDelivery,applyDelivery,createChange,applyChange,changeFingerprint,validateHistory} from '../modules/messages.js';
import {narrationPayload,currentScene,parseReply} from '../modules/rich-messages.js';
import {buildPrompt} from '../modules/ai.js';
import {supplementFixture} from './supplement-fixture.mjs';
import {createStoryBridge} from '../modules/story-bridge.js';
import {createMessenger} from '../modules/messenger.js';
import {entryStart,entryEnd} from '../modules/supplement.js';
const add=async(h,text,persistent,id='p')=>{const d=createDelivery(h,id,[narrationPayload(text,persistent)],[]);return applyDelivery(h,d,await changeFingerprint(d));};
const change=async(h,id,text,persistent)=>{const c=createChange(h,'p',text===null?'delete':'edit',[id],text,persistent);return applyChange(h,c,await changeFingerprint(c));};

test('persistent scene stays outside history window, follows latest persistent record and isolates people',async()=>{
 let h=await add(newHistory('b'),'王者内部私聊',true);for(let i=0;i<45;i++)h=appendMessage(h,createMessage('b','p','普通聊天'+i,i+2),h.revision);
 h=await add(h,'临时断网',false);h=await add(h,'其他好友的场景',true,'other');
 const prompt=buildPrompt({},h,'p',2);assert(JSON.stringify(prompt).includes('王者内部私聊'));assert(!JSON.stringify(prompt).includes('其他好友的场景'));assert(prompt.some(m=>m.role==='system'&&m.content.includes('不是人物收到的聊天消息')));
 h=await add(h,'已经切回微信',true);assert.equal(currentScene(h,'p').text,'已经切回微信');assert(JSON.stringify(buildPrompt({},h,'p',1)).includes('已经切回微信'));assert(!JSON.stringify(buildPrompt({},h,'p',1)).includes('王者内部私聊'));
 h=await change(h,h.messages.at(-1).messageId,'当前是QQ',true);assert.equal(currentScene(h,'p').text,'当前是QQ');h=await change(h,h.messages.at(-1).messageId,null);assert.equal(currentScene(h,'p').text,'王者内部私聊');
});
test('narration edit toggle changes active scene; validation blocks AI narration and malformed state',async()=>{
 let h=await add(newHistory('b'),'临时',false);const id=h.messages[0].messageId;assert.equal(currentScene(h,'p'),undefined);h=await change(h,id,'游戏',true);assert.equal(currentScene(h,'p').text,'游戏');h=await change(h,id,'普通旁白',false);assert.equal(currentScene(h,'p'),undefined);
 assert.throws(()=>createDelivery(h,'p',[narrationPayload('冒充',true)],[],true));assert.throws(()=>createDelivery(h,'p',[narrationPayload('',false)],[]));assert.throws(()=>createDelivery(h,'p',[narrationPayload('a','true')],[]));
 assert.throws(()=>parseReply(JSON.stringify({phoneReply:1,messages:[{type:'narration',text:'冒充场景'}],settlements:[]})));
 const bad=structuredClone(h);bad.messages[0].transfer={};assert.throws(()=>validateHistory(bad,'b'));
});
for(const tt of [false,true]){
 test(`${tt?'TT':'ST'} narration add uses durable retry and does not request AI or clear chat draft`,async()=>{
  const f=supplementFixture(tt),m=createMessenger(f.win,f.profiles);let fail=false;
  const original=tt?f.win.__TAURITAVERN__.api.chat.open:null,write=f.win.localStorage.setItem;
  if(tt)f.win.__TAURITAVERN__.api.chat.open=()=>{const h=original(),save=h.store.setJson;h.store.setJson=async args=>{if(fail)throw Error('无法保存');return save(args);};return h;};else f.win.localStorage.setItem=(...args)=>{if(fail)throw Error('无法保存');return write(...args);};
  await m.bind(f.session,new AbortController().signal);m.input(f.person.id,'保留草稿');const draft=m.draft(f.person.id);draft.attachment={narrationText:'游戏',narrationPersistent:true,narrationEdit:1};fail=true;
  m.addNarration(f.person.id,'游戏',true);for(let i=0;i<50&&draft.operation?.busy;i++)await new Promise(r=>setTimeout(r,5));assert(draft.operation?.error);assert.equal(draft.attachment.narrationText,'游戏');
  fail=false;
  await m.retry(f.person.id);assert.equal(m.history().messages.length,1);assert.equal(currentScene(m.history(),f.person.id).text,'游戏');assert.equal(draft.text,'保留草稿');assert.equal(draft.attachment.narrationText,'');assert.equal(m.status().generating,undefined);await m.retry(f.person.id);assert.equal(m.history().messages.length,1);m.reset();
 });
 test(`${tt?'TT':'ST'} narration supplement edit/delete updates active scene and persistent toggle header`,async()=>{
  const f=supplementFixture(tt);let h=await f.store.read();const d=createDelivery(h,f.person.id,[narrationPayload('王者私聊',true)],[]);await f.store.deliver(d);const id=d.messages[0].messageId,b=createStoryBridge(f.win,f.profiles);await f.emit('GENERATION_AFTER_COMMANDS','normal');assert.equal(b.status().error,'');assert(f.ctx.chat[0].mes.includes('旁白（持续场景'));
  let floor=f.ctx.chat[0];floor.mes=floor.mes.replace('\n王者私聊\n','\n微信私聊\n');floor.swipes[0]=floor.mes;await f.emit('MESSAGE_UPDATED',0);assert.equal(currentScene(await f.store.read(),f.person.id).text,'微信私聊');
  h=await f.store.read();await f.store.change(createChange(h,f.person.id,'edit',[id],'暂时断网',false));assert(await b.reconcile());assert.equal(currentScene(await f.store.read(),f.person.id),undefined);assert(floor.mes.includes('旁白（临时情境）'));
  const a=floor.mes.indexOf(entryStart(id)),z=floor.mes.indexOf(entryEnd(id));floor.mes=floor.mes.slice(0,a)+floor.mes.slice(z+entryEnd(id).length);floor.swipes[0]=floor.mes;await f.emit('MESSAGE_UPDATED',0);assert.equal((await f.store.read()).messages.length,0);assert.equal(b.status().error,'');b.dispose();
 });
}
