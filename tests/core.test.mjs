import test from 'node:test';
import assert from 'node:assert/strict';
import { newBook, newPerson, validateBook, clone } from '../modules/contacts.js';
import { createProfileHost, storageKey } from '../modules/host.js';
import { installUpdateRefresh } from '../update-refresh.js';
const delay = () => new Promise(r => setTimeout(r, 15));
function fixture() {
  const data = new Map(), listeners = new Map();
  const state = { chatId: 'A', integrity: 'a', account: 'u', wait: null, fail: false };
  const ctx = { characterId: 0, characters: {0:{name:'故事',avatar:'story.png'}}, get chatId(){return state.chatId;},get chatMetadata(){return {integrity:state.integrity};},getRequestHeaders:()=>({}),getThumbnailUrl:()=>'/thumbnail',eventTypes:{CHAT_CHANGED:'switch',CHAT_RENAMED:'rename'},eventSource:{on(e,f){if(!listeners.has(e))listeners.set(e,new Set());listeners.get(e).add(f);},removeListener(e,f){listeners.get(e)?.delete(f);}} };
  const win = { crypto, location:{href:'http://localhost/',origin:'http://localhost'}, SillyTavern:{getContext:()=>ctx},localStorage:{getItem:k=>data.get(k)??null,setItem(k,v){if(state.fail)throw Error('full');data.set(k,v);}},async fetch(){if(state.wait)await state.wait;return {ok:true,json:async()=>({handle:state.account})};} };
  const emit = async(e,p)=>{for(const fn of listeners.get(e)||[])await fn(p);};
  return {data,state,win,ctx,emit,host:createProfileHost(win),signal:new AbortController().signal};
}
const material = {world:'设定',uid:'7',title:'角色',content:'<script>text only</script>',fingerprint:'sha256:'+'a'.repeat(64),confirmedAt:'2026-10-04T00:00:00Z'};
test('remarks preserve independent identity, relation, unknown future fields and worldbook snapshots', async()=>{
  const f=fixture(),session=await f.host.load(f.signal), book=clone(session.book), person=newPerson();person.name='人物';person.roleplayMaterials=[material];person.future={keep:true};book.people.push(person);
  await f.host.save(session,book,f.signal);const edit=clone(session.book);edit.people[0].remark='备注';await f.host.save(session,edit,f.signal);
  const loaded=await f.host.load(f.signal);assert.deepEqual(loaded.book.people[0],{...person,remark:'备注'});assert.equal(loaded.book.self.account,book.self.account);f.host.dispose();
});
test('failed read never overwrites invalid registry or null book',async()=>{
  for(const raw of ['not json','{"version":2,"books":{}}',JSON.stringify({version:1,books:{[JSON.stringify(['card:story.png','A','a'])]:null}})]) {
    const f=fixture();f.data.set(storageKey('u'),raw);await assert.rejects(f.host.load(f.signal));assert.equal(f.data.get(storageKey('u')),raw);f.host.dispose();
  }
});
test('in-flight ST save cancels on switching and an old session stays invalid after switching back',async()=>{
  const f=fixture(),session=await f.host.load(f.signal);const book=clone(session.book),person=newPerson();person.name='A';book.people.push(person);
  let release;f.state.wait=new Promise(r=>release=r);const saving=f.host.save(session,book,f.signal);
  f.state.chatId='B';await f.emit('switch');f.state.chatId='A';await f.emit('switch');release();await assert.rejects(saving,/切换/);assert.equal(f.data.size,0);
  f.state.wait=null;await assert.rejects(f.host.save(session,book,f.signal),/切换/);f.host.dispose();
});
test('account changes, revision conflict and failed writes fail closed',async()=>{
  const f=fixture(),a=await f.host.load(f.signal),b=await f.host.load(f.signal);
  await f.host.save(a,a.book,f.signal);await assert.rejects(f.host.save(b,b.book,f.signal),/变化/);
  f.state.fail=true;await assert.rejects(f.host.save(a,a.book,f.signal),/失败/);assert.equal(a.book.revision,1);
  f.state.fail=false;f.state.account='other';await assert.rejects(f.host.save(a,a.book,f.signal),/账号/);f.host.dispose();
});
test('ST official rename preserves ids, target conflict leaves both books unchanged',async()=>{
  const f=fixture(),a=await f.host.load(f.signal);await f.host.save(a,a.book,f.signal);const id=a.book.id;
  f.state.chatId='renamed';await f.emit('switch');await f.emit('rename',{avatarId:'story.png',oldFileName:'A.jsonl',newFileName:'renamed.jsonl'});assert.equal((await f.host.load(f.signal)).book.id,id);
  f.state.chatId='B';f.state.integrity='a';await f.emit('switch');const b=await f.host.load(f.signal);await f.host.save(b,b.book,f.signal);const raw=f.data.get(storageKey('u'));
  await f.emit('rename',{avatarId:'story.png',oldFileName:'renamed.jsonl',newFileName:'B.jsonl'});assert.equal(f.data.get(storageKey('u')),raw);await assert.rejects(f.host.load(f.signal),/停止/);f.host.dispose();
});
test('strict data and avatar validation reject malformed records without repairing them silently',()=>{
  const book=newBook();const p=newPerson();p.name='safe';book.people.push(p);validateBook(book);
  for(const mutate of [b=>b.people[0].avatar={kind:'url',value:'javascript:alert(1)'},b=>b.people[0].avatar={kind:'url',value:'https://user:pass@host/a'},b=>b.people[0].relation.friend=true,b=>b.people.push(clone(b.people[0])),b=>b.people[0].roleplayMaterials=[{...material,content:''}],b=>b.self=null]){const bad=clone(book);mutate(bad);assert.throws(()=>validateBook(bad));}
});
test('version refresh respects dirty state at response time, resumes only on later close, and disposes listeners',async()=>{
  let click,dirty=false,reloads=0,deferred=0,release;
  const doc={addEventListener(_,fn){click=fn;},removeEventListener(){click=null;}};
  const dialog=new EventTarget();dialog.open=true;dialog.querySelector=()=>true;
  const dispose=installUpdateRefresh({document:doc,version:'0.4.0',manifestUrl:'http://local/manifest.json',canReload:()=>!dirty,onDeferred:()=>deferred++,reload:()=>reloads++,fetch:async()=>{if(release===undefined)await new Promise(r=>release=r);return {ok:true,json:async()=>({version:'0.5.0',homePage:'https://github.com/yui-ovo/yui-glass-phone'})};}});
  click({target:{closest:()=>({closest:()=>dialog})}});dialog.open=false;dialog.dispatchEvent(new Event('close'));await delay();dirty=true;release();await delay();assert.equal(reloads,0);assert.equal(deferred,1);
  dirty=false;dialog.dispatchEvent(new Event('close'));await delay();assert.equal(reloads,1);dispose();assert.equal(click,null);dialog.dispatchEvent(new Event('close'));await delay();assert.equal(reloads,1);
});
test('disposing during update check prevents a late reload',async()=>{
  let click, release,reloads=0;const doc={addEventListener(_,f){click=f;},removeEventListener(){}};const dialog=new EventTarget();dialog.open=false;dialog.querySelector=()=>true;
  const dispose=installUpdateRefresh({document:doc,version:'0.4.0',manifestUrl:'http://local/manifest.json',reload:()=>reloads++,fetch:async()=>{await new Promise(r=>release=r);return {ok:true,json:async()=>({version:'0.5.0',homePage:'https://github.com/yui-ovo/yui-glass-phone'})};}});
  click({target:{closest:()=>({closest:()=>dialog})}});dialog.dispatchEvent(new Event('close'));await delay();dispose();release();await delay();assert.equal(reloads,0);
});
