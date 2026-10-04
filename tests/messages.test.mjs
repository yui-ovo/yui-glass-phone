import test from 'node:test';
import assert from 'node:assert/strict';
import { newBook, newPerson, clone } from '../modules/contacts.js';
import { createMessage, newHistory, appendMessage, validateHistory, forPerson, MAX_TEXT, createChange, applyChange, changeFingerprint, quotedMessage } from '../modules/messages.js';
import { createMessageStore, messageKey } from '../modules/message-host.js';
import { createMessenger } from '../modules/messenger.js';
import { saveConfig, defaultConfig } from '../modules/ai.js';
const tick = () => new Promise(r=>setTimeout(r,10));
function fixture(tt=false) {
  const book=newBook(),friend=newPerson();friend.name='好友';friend.relation={known:true,friend:true,accountKnown:true};book.people.push(friend);
  const session={book,account:tt?'tt-native':'u',snapshot:{chatId:'A',source:{avatarFile:'story.png'},group:false}};
  const state={data:new Map(),writes:0,fail:false,unconfirmed:false,delay:null,active:true};
  const profiles={assertSession(s,signal){if(!state.active||signal.aborted)throw Error('切档');},async load(){return clone(session);}};
  const win={crypto,navigator:{locks:{async request(key,options,fn){return fn();}}},localStorage:{getItem:key=>state.data.get(key)??null,setItem(key,value){if(state.fail)throw Error('full');state.writes++;state.data.set(key,value);}}};
  if(tt)win.__TAURITAVERN__={api:{chat:{open:()=>({store:{
    async listKeys(){if(state.unconfirmed){state.unconfirmed=false;throw Error('确认读取失败');}return [...state.data.keys()];},
    async getJson({key}){return clone(state.data.get(key));},
    async setJson({key,value}){state.writes++;if(state.delay)await state.delay;if(state.fail)throw Error('full');state.data.set(key,clone(value));if(state.loseConfirmation)state.unconfirmed=true;},
    async renameKey(){},
  }})}}};
  const signal=new AbortController().signal,store=createMessageStore(win,profiles,session,signal);
  return {book,friend,session,state,win,profiles,signal,store};
}
test('normalized messages: identity, deterministic order, same text is legal twice, corrupt/oversize rejected',()=>{
  const a=createMessage('book','friend','中文\n🙂 <script>alert(1)</script>',1);const b=createMessage('book','friend',a.text,2);
  const history=appendMessage(appendMessage(newHistory('book'),a,0),b,1);
  assert.notEqual(a.messageId,b.messageId);assert.equal(forPerson(history,'friend').length,2);assert.equal(forPerson(history,'other').length,0);
  assert.deepEqual(appendMessage(history,a,0),history);assert.throws(()=>appendMessage(history,{...a,text:'different'},2));
  assert.throws(()=>createMessage('book','p','  \n ',1));assert.throws(()=>createMessage('book','p','字'.repeat(MAX_TEXT+1),1));
  assert.throws(()=>validateHistory({...history,version:99},'book'));assert.throws(()=>validateHistory(history,'wrong'));
});
for(const tt of [false,true])test(`${tt?'TT':'ST'} independent message storage, profile preservation, conflict and friend recheck`,async()=>{
  const f=fixture(tt); const before=clone(f.book),a=createMessage(f.book.id,f.friend.id,'消息',1);
  const saved=await f.store.send(a,0);assert.equal(saved.messages.length,1);assert.deepEqual(f.book,before);
  assert.equal((await f.store.send(a,0)).messages.length,1);assert.equal(f.state.writes,1);
  f.friend.remark='新备注';f.friend.avatar={kind:'url',value:'https://example.test/avatar.png'};
  await f.store.send(createMessage(f.book.id,f.friend.id,'第二条',2),1);assert.equal(f.friend.remark,'新备注');assert.equal(f.friend.avatar.kind,'url');
  await assert.rejects(f.store.send(createMessage(f.book.id,f.friend.id,'冲突',2),1),/其他窗口/);assert.equal((await f.store.read()).messages.length,2);
  f.friend.relation.friend=false;await assert.rejects(f.store.send(createMessage(f.book.id,f.friend.id,'不是好友',3),2),/好友/);
  f.friend.relation.friend=true;f.friend.deletedAt=new Date().toISOString();
  await assert.rejects(f.store.send(createMessage(f.book.id,f.friend.id,'已删除',3),2),/好友/);
  assert.equal((await f.store.send(a,0)).messages.length,2);assert.equal(f.state.writes,2);
  delete f.friend.deletedAt;await f.store.send(createMessage(f.book.id,f.friend.id,'恢复后',3),2);assert.equal((await f.store.read()).messages.length,3);
});
test('TT successful write with failed confirmation retries same ID without another write',async()=>{
  const f=fixture(true),message=createMessage(f.book.id,f.friend.id,'保存结果不明',1);f.state.loseConfirmation=true;
  await assert.rejects(f.store.send(message,0),/确认读取/);assert.equal(f.state.writes,1);
  const confirmed=await f.store.send(message,0);assert.equal(confirmed.messages.length,1);assert.equal(f.state.writes,1);
});
test('TT dispatched write stays captured; switch blocks late UI confirmation',async()=>{
  const f=fixture(true);let release;f.state.delay=new Promise(r=>release=r);
  const saving=f.store.send(createMessage(f.book.id,f.friend.id,'旧档',1),0);await tick();f.state.active=false;release();await assert.rejects(saving,/切档/);
  assert.equal([...f.state.data.values()][0].archiveId,f.book.id);
});
test('read failure/corruption, capacity and missing lock never overwrite history',async()=>{
  const f=fixture();const key=messageKey(f.session.account,f.book.id);f.state.data.set(key,'broken');await assert.rejects(f.store.read());
  await assert.rejects(f.store.send(createMessage(f.book.id,f.friend.id,'x',1),0));assert.equal(f.state.data.get(key),'broken');
  f.state.data.delete(key);f.win.navigator.locks=null;await assert.rejects(f.store.send(createMessage(f.book.id,f.friend.id,'x',1),0),/写入锁/);assert.equal(f.state.writes,0);
  const large=newHistory(f.book.id);large.messages=Array.from({length:2001},(_,i)=>createMessage(f.book.id,f.friend.id,'x',i+1));assert.throws(()=>validateHistory(large,f.book.id),/容量/);
});
test('controller keeps later input, blocks duplicate click, retains retry ID and preserves drafts on view unsubscribe',async()=>{
  const f=fixture(true),m=createMessenger(f.win,f.profiles);await m.bind(f.session,f.signal);m.input(f.friend.id,'first');let release;f.state.delay=new Promise(r=>release=r);
  m.submit(f.friend.id);m.submit(f.friend.id);await tick();m.input(f.friend.id,'new input');release();await tick();assert.equal(f.state.writes,1);assert.equal(m.draft(f.friend.id).text,'new input');
  f.state.delay=null;f.state.fail=true;m.submit(f.friend.id);await tick();const id=m.draft(f.friend.id).operation.message.messageId;assert.equal(m.draft(f.friend.id).text,'new input');
  f.state.fail=false;await m.retry(f.friend.id);assert.equal(m.history().messages.at(-1).messageId,id);assert.equal(m.draft(f.friend.id).text,'');
  m.input(f.friend.id,'unsent');const stop=m.subscribe(()=>{});stop();assert(m.dirty());m.reset();assert(!m.dirty());
});
function aiFixture(tt = false) {
  const f = fixture(tt); let calls = 0, release;
  const persona = {name1:'当前人设',powerUserSettings:{persona_description:'用户设定'}};
  f.win.SillyTavern = {getContext:()=>persona};
  saveConfig(f.win,{...defaultConfig(),baseUrl:'https://fixture.test/v1',model:'test',apiKey:'fixture-only'});
  f.win.fetch = async (_url, options) => {
    calls++; f.lastRequest=JSON.parse(options.body);
    if(f.wait) await new Promise((resolve,reject)=>{release=resolve; options.signal.addEventListener('abort',()=>reject(Error('abort')),{once:true});});
    return Response.json({choices:[{message:{content:'AI 文字回复'},finish_reason:'stop'}]});
  };
  return Object.assign(f,{calls:()=>calls,release:()=>release?.(),persona});
}
for (const tt of [false,true]) test(`${tt?'TT':'ST'} AI reply persistent, same-ID save retry, no regeneration or draft loss`, async()=>{
  const f=aiFixture(tt),m=createMessenger(f.win,f.profiles);await m.bind(f.session,f.signal);
  if(tt)f.state.loseConfirmation=true;else f.state.fail=true;
  await m.requestReply(f.friend.id);const pending=m.draft(f.friend.id).operation;assert(pending);assert.equal(f.calls(),1);assert.equal(pending.message.source,'ai-reply');
  await m.requestReply(f.friend.id);assert.equal(f.calls(),1);
  m.input(f.friend.id,'随后输入的内容');f.state.fail=false;f.state.loseConfirmation=false;
  await m.retry(f.friend.id);assert.equal(f.calls(),1);assert.equal(m.history().messages[0].messageId,pending.message.messageId);assert.equal(m.draft(f.friend.id).text,'随后输入的内容');
  if(tt)assert.equal(f.state.writes,2); // one config write and one native reply write
  await m.bind(f.session,f.signal);assert.equal(m.history().messages[0].text,'AI 文字回复');
});
test('AI double click, cancel, persona changes and archive switches discard late results',async()=>{
  const f=aiFixture(),m=createMessenger(f.win,f.profiles);await m.bind(f.session,f.signal);f.wait=true;
  let pending=m.requestReply(f.friend.id);await tick();await m.requestReply(f.friend.id);assert.equal(f.calls(),1);assert(m.dirty());m.cancelReply();f.release();await pending;assert.equal(m.history().messages.length,0);
  pending=m.requestReply(f.friend.id);await tick();f.persona.name1='另一个人设';f.release();await pending;assert.equal(m.history().messages.length,0);assert.match(m.draft(f.friend.id).aiError,/已变化/);
  pending=m.requestReply(f.friend.id);await tick();m.reset();f.release();await pending;assert.equal(m.history(),undefined);assert(!m.dirty());
});
test('AI captured native write finishes in old store and empty-button cooldown prevents accidental request',async()=>{
  const f=aiFixture(true),m=createMessenger(f.win,f.profiles);await m.bind(f.session,f.signal);
  m.input(f.friend.id,'发送');m.submit(f.friend.id);await tick();await m.requestReply(f.friend.id);assert.equal(f.calls(),0);
  m.draft(f.friend.id).replyAfter=0;let release;f.state.delay=new Promise(r=>release=r);const pending=m.requestReply(f.friend.id);await tick();m.reset();f.state.active=false;release();await pending;
  const histories=[...f.state.data.values()].filter(v=>v?.messages);assert.equal(histories[0].messages[1].source,'ai-reply');assert.equal(m.history(),undefined);
});
test('edit/delete preserve identity, update references, erase actual text, and prevent stale send resurrection',async()=>{
  const original=createMessage('book','p','OLD_PRIVATE_TEXT',1), quoted=createMessage('book','p','引用的回复',2);quoted.replyTo=original.messageId;
  let h=appendMessage(appendMessage(newHistory('book'),original,0),quoted,1);
  const edit=createChange(h,'p','edit',[original.messageId],'更正🙂\n<script>text</script>');h=applyChange(h,edit,await changeFingerprint(edit));
  assert.equal(h.messages[0].messageId,original.messageId);assert.equal(h.messages[0].sequence,1);assert.equal(quotedMessage(h,quoted).text,edit.text);assert(!JSON.stringify(h).includes('OLD_PRIVATE_TEXT'));
  const before=clone(h),remove=createChange(h,'p','delete',[original.messageId]);h=applyChange(h,remove,await changeFingerprint(remove));
  assert.equal(h.version,2);assert.equal(h.messages.length,1);assert.equal(quotedMessage(h,quoted),undefined);assert(!JSON.stringify(h).includes(edit.text));assert(h.deletedMessageIds.includes(original.messageId));
  assert.throws(()=>appendMessage(h,{...original,sequence:3},h.revision),/已删除/);
  assert.deepEqual(applyChange(h,remove,await changeFingerprint(remove)),h);
  const wrong={...remove,ids:[quoted.messageId]};assert.throws(()=>applyChange(h,wrong,'f'.repeat(64)),/ID/);
  const foreign=createChange(before,'someone-else','delete',[quoted.messageId]);assert.throws(()=>applyChange(before,foreign,'a'.repeat(64)),/不属于/);
});
for(const tt of [false,true])test(`${tt?'TT':'ST'} mutations persist independently with conflict checks and ambiguous-result retry`,async()=>{
  const f=fixture(tt),first=createMessage(f.book.id,f.friend.id,'原消息',1),second=createMessage(f.book.id,f.friend.id,'第二条',2);
  await f.store.send(first,0);let h=await f.store.send(second,1);const profiles=clone(f.book);
  const edit=createChange(h,f.friend.id,'edit',[first.messageId],'修改后');
  if(tt)f.state.loseConfirmation=true;else f.state.fail=true;
  await assert.rejects(f.store.change(edit));f.state.loseConfirmation=false;f.state.fail=false;
  h=await f.store.change(edit);assert.equal(h.messages[0].text,'修改后');assert.deepEqual(f.book,profiles);
  const newer=createChange(h,f.friend.id,'edit',[first.messageId],'较新的内容');h=await f.store.change(newer);
  assert.equal((await f.store.change(edit)).messages[0].text,'较新的内容');
  const stale=createChange({...h,revision:1},f.friend.id,'delete',[second.messageId]);await assert.rejects(f.store.change(stale),/已变化/);
  const remove=createChange(h,f.friend.id,'delete',[first.messageId,second.messageId]);h=await f.store.change(remove);assert.deepEqual(h.messages,[]);assert.equal((await f.store.read()).messages.length,0);assert.deepEqual(f.book,profiles);
});
test('edit drafts survive failure, cancel has no write, and reread never silently rebases an edit',async()=>{
  const f=fixture(),m=createMessenger(f.win,f.profiles);await m.bind(f.session,f.signal);m.input(f.friend.id,'原文');m.submit(f.friend.id);await tick();const id=m.history().messages[0].messageId;
  m.beginEdit(f.friend.id,id);m.editInput(f.friend.id,'取消的内容');assert(m.dirty());m.cancelEdit(f.friend.id);assert.equal((await f.store.read()).messages[0].text,'原文');
  m.beginEdit(f.friend.id,id);m.editInput(f.friend.id,'新的草稿');f.state.fail=true;m.saveEdit(f.friend.id);await tick();assert(m.status().change.error);assert.equal(m.draft(f.friend.id).editing.text,'新的草稿');f.state.fail=false;await m.retryChange();assert.equal(m.history().messages[0].text,'新的草稿');
  m.beginEdit(f.friend.id,id);m.editInput(f.friend.id,'过时草稿');await f.store.change(createChange(await f.store.read(),f.friend.id,'edit',[id],'另一窗口修改'));await m.refresh();m.saveEdit(f.friend.id);await tick();assert.match(m.status().change.error,/已变化/);assert.equal((await f.store.read()).messages[0].text,'另一窗口修改');await m.endChange();assert.equal(m.status().change,undefined);
});
test('editing cancels AI, quote input survives navigation, deletion in-flight stays in old archive',async()=>{
  const f=aiFixture(true),m=createMessenger(f.win,f.profiles);await m.bind(f.session,f.signal);m.input(f.friend.id,'文字');m.submit(f.friend.id);await tick();const id=m.history().messages[0].messageId;
  m.draft(f.friend.id).replyAfter=0;f.wait=true;const request=m.requestReply(f.friend.id);await tick();m.beginEdit(f.friend.id,id);f.release();await request;assert.equal(m.history().messages.length,1);m.cancelEdit(f.friend.id);
  m.quote(f.friend.id,id);assert(m.dirty());m.input(f.friend.id,'带引用');m.submit(f.friend.id);await tick();assert.equal(m.history().messages[1].replyTo,id);assert.equal(m.draft(f.friend.id).quoteId,undefined);
  let release;f.state.delay=new Promise(r=>release=r);m.deleteMessages(f.friend.id,[id]);await tick();m.reset();f.state.active=false;release();await tick();assert.equal(m.history(),undefined);const saved=[...f.state.data.values()].find(v=>v?.messages);assert.equal(saved.messages.length,1);assert(saved.deletedMessageIds.includes(id));
});
test('an uncertain send deleted elsewhere cannot resurrect, and ending verification retains input',async()=>{
  const f=fixture(true),m=createMessenger(f.win,f.profiles);await m.bind(f.session,f.signal);f.state.loseConfirmation=true;m.input(f.friend.id,'待核对原文');m.submit(f.friend.id);await tick();const id=m.draft(f.friend.id).operation.message.messageId;f.state.loseConfirmation=false;
  const h=await f.store.read();await f.store.change(createChange(h,f.friend.id,'delete',[id]));await m.refresh();await m.retry(f.friend.id);assert.equal((await f.store.read()).messages.length,0);assert(m.draft(f.friend.id).operation.error);
  await m.endSend(f.friend.id);assert.equal(m.draft(f.friend.id).operation,null);assert.equal(m.draft(f.friend.id).text,'待核对原文');
  m.submit(f.friend.id);await tick();assert.equal(m.history().messages.length,1);assert.notEqual(m.history().messages[0].messageId,id);
});
