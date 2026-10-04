import test from 'node:test';
import assert from 'node:assert/strict';
import {newBook,newPerson,clone} from '../modules/contacts.js';
import {createMessage,appendMessage,newHistory,createDelivery,applyDelivery,changeFingerprint,createChange,applyChange,validateHistory} from '../modules/messages.js';
import {parseAmount,parseReply,stickerPayload,transferPayload,summary} from '../modules/rich-messages.js';
import {createMessageStore} from '../modules/message-host.js';
import {createMessenger} from '../modules/messenger.js';
import {defaultConfig,saveConfig,buildPrompt} from '../modules/ai.js';
const apply=async(h,d)=>applyDelivery(h,d,await changeFingerprint(d));
const tick=()=>new Promise(r=>setTimeout(r,10));
function fixture(tt=false){
  const book=newBook(),friend=newPerson();friend.name='好友';friend.relation={friend:true,known:true,accountKnown:true};book.people.push(friend);
  const session={book,account:'tester',snapshot:{chatId:'A',source:{avatarFile:'card.png'},group:false}},state={data:new Map(),writes:0,fail:false,active:true};
  const profiles={assertSession(_s,signal){if(signal.aborted||!state.active)throw Error('切档');},async load(){return clone(session);}};
  const win={crypto,navigator:{locks:{async request(_k,_o,fn){return fn();}}},localStorage:{getItem:k=>state.data.get(k)??null,setItem(k,v){if(state.fail)throw Error('满');state.writes++;state.data.set(k,v);}},SillyTavern:{getContext:()=>({name1:'我',powerUserSettings:{persona_description:'用户设定'}})}};
  if(tt)win.__TAURITAVERN__={api:{chat:{open:()=>({store:{async listKeys(){if(state.uncertain){state.uncertain=false;throw Error('确认失败');}return [...state.data.keys()];},async getJson({key}){return clone(state.data.get(key));},async setJson({key,value}){state.writes++;if(state.delay)await state.delay;if(state.fail)throw Error('失败');state.data.set(key,clone(value));if(state.failAfter)state.uncertain=true;},async renameKey(){}}})}}};
  const signal=new AbortController().signal,store=createMessageStore(win,profiles,session,signal);return {book,friend,session,state,win,profiles,signal,store};
}
test('money uses cents, rejects negatives, exponent, suffixes, zero, excess precision and bounds',()=>{
  assert.equal(parseAmount('0.01'),1);assert.equal(parseAmount(' 5.2 '),520);assert.equal(parseAmount('1000000'),100000000);
  for(const v of ['-1','1e3','5元','0','1.001','1000000.01','Infinity','NaN','01','+5',''])assert.throws(()=>parseAmount(v));
});
test('v1 text and profiles survive v3 rich history; references and summaries use canonical payload',async()=>{
  const old=createMessage('book','p','原文字',1);let h=appendMessage(newHistory('book'),old,0);
  const d=createDelivery(h,'p',[transferPayload('5.20','🙂'),stickerPayload({id:'asset',description:'<img onerror=alert(1)>'})],[]);
  h=await apply(h,d);assert.equal(h.version,3);assert.deepEqual(h.messages[0],old);assert.equal(h.messages.length,3);assert.equal(h.messages[1].transfer.amountMinor,520);assert(summary(h.messages[2]).includes('<img'));
  assert.throws(()=>validateHistory({...h,version:2},'book'));const corrupt=clone(h);corrupt.messages[1].text='伪造';assert.throws(()=>validateHistory(corrupt,'book'));
  const edit=createChange(h,'p','edit',[old.messageId],'新文字');h=applyChange(h,edit,await changeFingerprint(edit));assert.equal(h.version,3);
  const bad=createChange(h,'p','edit',[d.messages[0].messageId],'篡改金额');assert.throws(()=>applyChange(h,bad,'a'.repeat(64)));
});
test('receive/refund bind recipient, exact transfer ID and conversation; invalid actions are atomic',async()=>{
  let h=newHistory('b');const d=createDelivery(h,'p',[transferPayload('5')],[],true);h=await apply(h,d);
  const m=d.messages[0],receive=createDelivery(h,'p',[],[{messageId:m.messageId,action:'receive'}]);h=await apply(h,receive);
  assert.equal(h.messages[0].transfer.state,'received');assert.deepEqual(await apply(h,receive),h);
  await assert.rejects(apply(h,createDelivery(h,'p',[],[{messageId:m.messageId,action:'refund'}])));
  const user=createDelivery(h,'q',[transferPayload('5')],[]);h=await apply(h,user);
  for(const d of [createDelivery(h,'q',[],[{messageId:user.messages[0].messageId,action:'receive'}]),createDelivery(h,'p',[],[{messageId:user.messages[0].messageId,action:'receive'}],true),createDelivery(h,'q',[{kind:'text',text:'不应保存'}],[{messageId:'missing',action:'refund'}],true)])await assert.rejects(apply(h,d));
  const refund=createDelivery(h,'q',[],[{messageId:user.messages[0].messageId,action:'refund'}],true);h=await apply(h,refund);assert.equal(h.messages.at(-1).transfer.state,'refunded');
  const prompt=JSON.stringify(buildPrompt({},h,'q',20));assert(prompt.includes('refunded'));assert(!prompt.includes(m.messageId));
});
test('AI protocol accepts plain text and validated actions, refuses invented stickers, malformed or duplicated actions',()=>{
  assert.equal(parseReply('你好').messages[0].text,'你好');const catalog=[{id:'a',description:'开心',allowedAI:true,hidden:false}];
  const value={phoneReply:1,messages:[{type:'sticker',assetId:'a'},{type:'transfer',amount:'5.20'},{type:'text',text:'hi🙂'}],settlements:[]};assert.equal(parseReply(JSON.stringify(value),catalog).messages.length,3);
  assert.throws(()=>parseReply(JSON.stringify(value),[]));assert.throws(()=>parseReply('{broken'));assert.throws(()=>parseReply(JSON.stringify({...value,messages:[{type:'image',url:'https://bad'}]}),catalog));
  assert.throws(()=>parseReply(JSON.stringify({...value,settlements:[{messageId:'x',action:'receive'},{messageId:'x',action:'refund'}]}),catalog));
});
for(const tt of [false,true])test(`${tt?'TT':'ST'} rich write failure, exact retry, repeat text/amount, profile isolation and stale revisions`,async()=>{
  const f=fixture(tt),before=clone(f.book),h=await f.store.read(),d=createDelivery(h,f.friend.id,[transferPayload('1')],[]);
  f.state.fail=true;await assert.rejects(f.store.deliver(d));f.state.fail=false;let saved=await f.store.deliver(d);const writes=f.state.writes;
  saved=await f.store.deliver(d);assert.equal(f.state.writes,writes);assert.equal(saved.messages.length,1);
  f.friend.remark='新备注';f.friend.roleplayMaterials=[{world:'书',uid:'1',title:'设定',content:'保留'}];
  saved=await f.store.deliver(createDelivery(saved,f.friend.id,[transferPayload('1')],[]));assert.equal(saved.messages.length,2);assert.notEqual(saved.messages[0].messageId,saved.messages[1].messageId);assert.equal(f.friend.remark,'新备注');assert.equal(f.friend.roleplayMaterials[0].content,'保留');assert.equal(f.book.self.account,before.self.account);
  await assert.rejects(f.store.deliver(createDelivery(h,f.friend.id,[transferPayload('2')],[])),/消息已变化/);
  f.friend.relation.friend=false;await assert.rejects(f.store.deliver(createDelivery(saved,f.friend.id,[transferPayload('3')],[])),/好友/);
});
test('TT ambiguous batch commit checks receipt, even after messages deleted; no duplicate or resurrection',async()=>{
  const f=fixture(true);const d=createDelivery(await f.store.read(),f.friend.id,[transferPayload('88'),{kind:'text',text:'给你'}],[],true);
  f.state.failAfter=true;await assert.rejects(f.store.deliver(d));f.state.failAfter=false;const writes=f.state.writes;let h=await f.store.deliver(d);assert.equal(f.state.writes,writes);assert.equal(h.messages.length,2);
  const change=createChange(h,f.friend.id,'delete',d.messages.map(m=>m.messageId));h=await f.store.change(change);assert.equal(h.messages.length,0);await f.store.deliver(d);assert.equal((await f.store.read()).messages.length,0);
});
test('manual transfer keeps text draft, rapid taps blocked, failed transfer retains fields and operation ID',async()=>{
  const f=fixture(),m=createMessenger(f.win,f.profiles);await m.bind(f.session,f.signal);m.input(f.friend.id,'未发送文字');m.draft(f.friend.id).attachment={amount:'5',note:'备注',edit:1};
  f.state.fail=true;m.sendTransfer(f.friend.id,'5','备注');assert.throws(()=>m.sendTransfer(f.friend.id,'5','备注'));await tick();const id=m.draft(f.friend.id).operation.delivery.id;assert.equal(m.draft(f.friend.id).attachment.amount,'5');assert(m.dirty());
  f.state.fail=false;await m.retry(f.friend.id);assert.equal(m.draft(f.friend.id).text,'未发送文字');assert.equal(m.draft(f.friend.id).attachment.amount,'');assert.equal(m.history().changeReceipts.at(-1).id,id);
});
test('AI text + transfer + settlement save atomically, retry never calls API again and later draft remains',async()=>{
  const f=fixture(true);saveConfig(f.win,{...defaultConfig(),baseUrl:'https://example.test/v1',model:'fixture'});
  const initial=await f.store.deliver(createDelivery(await f.store.read(),f.friend.id,[transferPayload('5')],[]));let calls=0;
  f.win.fetch=async(_url,opts)=>{calls++;assert(JSON.stringify(JSON.parse(opts.body)).includes(initial.messages[0].messageId));return Response.json({choices:[{message:{content:JSON.stringify({phoneReply:1,messages:[{type:'text',text:'收到啦'},{type:'transfer',amount:'6'}],settlements:[{messageId:initial.messages[0].messageId,action:'receive'}]})}}]});};
  const m=createMessenger(f.win,f.profiles);await m.bind(f.session,f.signal);f.state.failAfter=true;await m.requestReply(f.friend.id);assert(m.draft(f.friend.id).operation);m.input(f.friend.id,'后来打的字');
  f.state.failAfter=false;await m.retry(f.friend.id);assert.equal(calls,1);assert.equal(m.history().messages.length,3);assert.equal(m.history().messages[0].transfer.state,'received');assert.equal(m.draft(f.friend.id).text,'后来打的字');
});
test('in-flight native rich commit stays in original archive, late UI result cannot enter new one',async()=>{
  const f=fixture(true),m=createMessenger(f.win,f.profiles);await m.bind(f.session,f.signal);let release;f.state.delay=new Promise(r=>release=r);m.sendTransfer(f.friend.id,'5','');await tick();
  const other=fixture(true);await m.bind(other.session,other.signal);release();await tick();assert.equal(m.history().messages.length,0);assert.equal([...f.state.data.values()][0].messages[0].transfer.amountMinor,500);
});
test('transfer controller can save without a mounted attachment form',async()=>{
  const f=fixture(),m=createMessenger(f.win,f.profiles);await m.bind(f.session,f.signal);m.sendTransfer(f.friend.id,'2','');await tick();assert.equal(m.draft(f.friend.id).operation,null);assert.equal(m.history().messages[0].transfer.amountMinor,200);
});
