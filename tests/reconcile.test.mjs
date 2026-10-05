import {transferPayload} from '../modules/rich-messages.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {supplementFixture} from './supplement-fixture.mjs';
import {createMessage,createChange,createDelivery} from '../modules/messages.js';
import {createStoryBridge} from '../modules/story-bridge.js';
import {SUPPLEMENT_KEY,supplementBlocks,entryStart,entryEnd,pendingSupplement,legacySupplement,digest,messageRow} from '../modules/supplement.js';
import {clone} from '../modules/contacts.js';
import {historyRange} from '../modules/history-range.js';
const send=async(f,text)=>{const h=await f.store.read(),m=createMessage(f.book.id,f.person.id,text,(h.messages.at(-1)?.sequence||0)+1);await f.store.send(m,h.revision);return m;};
const begin=async f=>{const b=createStoryBridge(f.win,f.profiles);await f.emit('GENERATION_AFTER_COMMANDS','normal');assert.equal(b.status().error,'');return b;};
const change=async(f,id,text)=>{const h=await f.store.read();return f.store.change(createChange(h,f.person.id,text===null?'delete':'edit',[id],text));};
function pencil(f,transform){const m=f.ctx.chat[0];m.mes=transform(m.mes);m.swipes[m.swipe_id]=m.mes;}
for(const tt of [false,true]){
 test(`${tt?'TT':'ST'} phone edit/delete update only matching entry, keep equal-text neighbour and other swipe`,async()=>{
  const f=supplementFixture(tt),a=await send(f,'一样'),c=await send(f,'一样'),b=await begin(f),other=f.ctx.chat[0].swipes[1];
  await change(f,a.messageId,'修改');assert(await b.reconcile());assert(f.ctx.chat[0].mes.includes('修改'));assert(f.ctx.chat[0].mes.includes('一样'));
  await change(f,a.messageId,null);assert(await b.reconcile());assert(!f.ctx.chat[0].mes.includes('修改'));assert(!f.ctx.chat[0].mes.includes(entryStart(a.messageId)));assert(f.ctx.chat[0].mes.includes(entryStart(c.messageId)));assert.equal(f.ctx.chat[0].swipes[1],other);assert.equal(supplementBlocks(f.ctx.chat[0])[0].receipt.entries.length,1);assert((await f.store.read()).storySyncedIds.includes(a.messageId));b.dispose();
 });
 test(`${tt?'TT':'ST'} pencil edits and deletes phone records after confirmed host save, no phantom summary write`,async()=>{
  const f=supplementFixture(tt),a=await send(f,'原文'),c=await send(f,'保留'),b=await begin(f);
  pencil(f,s=>s.replace('\n原文\n','\n小铅笔修改\n'));await f.emit('MESSAGE_UPDATED',0);assert.equal((await f.store.read()).messages[0].text,'小铅笔修改');assert.equal(b.status().error,'');
  pencil(f,s=>{const a=s.indexOf(entryStart(c.messageId)),z=s.indexOf(entryEnd(c.messageId));return s.slice(0,a)+s.slice(z+entryEnd(c.messageId).length);});await f.emit('MESSAGE_UPDATED',0);const h=await f.store.read();assert.equal(h.messages.length,1);assert(h.deletedMessageIds.includes(c.messageId));assert(!f.ctx.chat[0].mes.includes('保留'));assert.deepEqual(f.state.disk,f.ctx.chat);b.dispose();
 });
 test(`${tt?'TT':'ST'} independent conflicts and damaged/whole wrappers preserve phone records and prevent repost`,async()=>{
  const f=supplementFixture(tt),a=await send(f,'原文'),b=await begin(f);await change(f,a.messageId,'手机版本');pencil(f,s=>s.replace('\n原文\n','\n正文版本\n'));f.state.disk=clone(f.ctx.chat);assert.equal(await b.reconcile(),false);assert(b.status().error.includes('同时修改'));assert.equal((await f.store.read()).messages[0].text,'手机版本');
  pencil(f,s=>s.replace('\n正文版本\n','\n手机版本\n'));f.state.disk=clone(f.ctx.chat);assert(await b.reconcile());
  pencil(f,s=>s.slice(0,s.indexOf('<yui_phone>')).trim());f.state.disk=clone(f.ctx.chat);assert.equal(await b.reconcile(),false);assert.equal((await f.store.read()).messages.length,1);await b.detachMissing();assert.equal((await pendingSupplement(f.win,f.book,await f.store.read(),f.ctx.chat)).length,0);
  f.ctx.chat=[];f.state.disk=[];await f.emit('MESSAGE_DELETED',0);assert.equal((await pendingSupplement(f.win,f.book,await f.store.read(),f.ctx.chat)).length,0);b.dispose();
 });
 test(`${tt?'TT':'ST'} partial phone-first commit recovers after reload without resurrecting deletion`,async()=>{
  const f=supplementFixture(tt),a=await send(f,'删掉我'),b=await begin(f);
  pencil(f,s=>s.replace('\n删掉我\n','\n\n'));f.state.disk=clone(f.ctx.chat);f.state.failWrite=true;assert.equal(await b.reconcile(),false);assert.equal((await f.store.read()).messages.length,0);assert(f.ctx.chat[0].extra[SUPPLEMENT_KEY].batches[0].entries.length===1);b.dispose();f.state.failWrite=false;
  const next=createStoryBridge(f.win,f.profiles);assert(await next.reconcile());assert.equal(f.ctx.chat[0].extra[SUPPLEMENT_KEY].batches[0].entries.length,0);assert.equal((await f.store.read()).messages.length,0);assert.equal((await pendingSupplement(f.win,f.book,await f.store.read(),f.ctx.chat)).length,0);next.dispose();
 });
 test(`${tt?'TT':'ST'} settled transfer updates body, pencil cannot forge settlement`,async()=>{
  const f=supplementFixture(tt),h=await f.store.read();await f.store.deliver(createDelivery(h,f.person.id,[transferPayload('10','晚饭')],[],false));
  const b=await begin(f),current=await f.store.read(),id=current.messages[0].messageId;await f.store.deliver(createDelivery(current,f.person.id,[],[{messageId:id,action:'receive'}],true));assert(await b.reconcile());assert(f.ctx.chat[0].mes.includes('已收款'));
  pencil(f,s=>s.replace('已收款','已退回'));f.state.disk=clone(f.ctx.chat);assert.equal(await b.reconcile(),false);assert.equal((await f.store.read()).messages[0].transfer.state,'received');b.dispose();
 });
}
test('unchanged legacy block upgrades only with exact source match; timestamps and quoted text refresh',async()=>{
 const f=supplementFixture(),a=await send(f,'引用原文');let h=await f.store.read();const q=createMessage(f.book.id,f.person.id,'回复',2);q.replyTo=a.messageId;await f.store.send(q,h.revision);h=await f.store.read();const rows=h.messages.map(m=>messageRow(f.book,h,m)),id=crypto.randomUUID(),raw=legacySupplement(id,rows);const m=f.ctx.chat[0];m.mes+='\n\n'+raw;m.swipes[0]=m.mes;m.extra[SUPPLEMENT_KEY]={version:2,batches:[{version:1,archiveId:f.book.id,batchId:id,sourceIds:rows.map(r=>r.id),hash:await digest(f.win,raw)}]};f.state.disk=clone(f.ctx.chat);
 const b=createStoryBridge(f.win,f.profiles);assert(await b.reconcile());assert.equal(m.extra[SUPPLEMENT_KEY].batches[0].version,2);await change(f,a.messageId,null);assert(await b.reconcile());assert(m.mes.includes('原消息已删除'));assert(!m.mes.includes('引用原文'));b.dispose();
});
test('range makes omitted history and unconfirmed memory explicit, synced ids survive missing floor',async()=>{
 const f=supplementFixture();for(let i=0;i<55;i++)await send(f,'第'+i+'条');const h=await f.store.read(),r=historyRange(f.win,h,f.person);assert.equal(r.shown,40);assert.equal(r.omitted,15);assert.equal(r.pending,55);assert(r.long);assert(!r.nearCapacity);
});

test('quoted content delimiters remain text and renamed contacts preserve historical sender headers',async()=>{
 const f=supplementFixture(),a=await send(f,'第一行\n内容：\n第二行');let h=await f.store.read();const q=createMessage(f.book.id,f.person.id,'回复',2);q.replyTo=a.messageId;await f.store.send(q,h.revision);const b=await begin(f),before=f.ctx.chat[0].mes;
 assert(await b.reconcile());assert.equal(f.ctx.chat[0].mes,before);
 f.book.people[0].name='新的名字';await change(f,q.messageId,'修改回复');assert(await b.reconcile());assert(f.ctx.chat[0].mes.includes('修改回复'));assert(!f.ctx.chat[0].mes.includes('与 新的名字 的手机会话'));
 pencil(f,s=>s.replace('\n修改回复\n','\n铅笔回复\n'));await f.emit('MESSAGE_UPDATED',0);assert.equal((await f.store.read()).messages.find(m=>m.messageId===q.messageId).text,'铅笔回复');b.dispose();
});

test('queued reconciliation does not retarget a switched archive',async()=>{
 const f=supplementFixture();await send(f,'原文');const b=await begin(f);let release;f.setPause(new Promise(r=>release=r));const first=b.reconcile(),queued=b.reconcile(),writes=f.state.writes;
 await f.emit('CHAT_CHANGED');f.setActive(false);release();assert.equal(await first,false);assert.equal(await queued,false);assert.equal(f.state.writes,writes);b.dispose();
});
