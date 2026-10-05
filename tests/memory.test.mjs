import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultMemoryPolicy } from '../modules/memory-policy.js';
import { readMemoryReference, memoryPeople, memoryConnection, MEMORY_BRIDGE_KEY } from '../modules/memory-bridge.js';
import { newPerson, newBook, validateBook } from '../modules/contacts.js';
import { replyContext, buildPrompt } from '../modules/ai.js';
import { newHistory } from '../modules/messages.js';

function fixture() {
  const identity={hostChatId:'chat-A',qqjChatId:'memory-A',characterLocator:'card-A',personaLocator:'user-A'};
  const person=newPerson(undefined,'同名人物');person.memoryLink={...defaultMemoryPolicy(),enabled:true,chatId:'memory-A'};
  const ctx={chatId:'chat-A',name1:'用户',powerUserSettings:{persona_description:'用户人设'}};
  const prepared={status:'ready',scope:'latest-prepared',identity,recall:{text:'双方约好明天见面'},prequel:{text:'前情：今天在酒吧相识'}};
  const data={status:'ready',identity,memory:{floors:[{summary:'不得整库注入的秘密'}]},people:{status:'ready',items:[
    {entityId:'p1',displayName:'同名人物',profile:{personality:'温和',apiKey:'不得发送密钥',unknown:'不得发送未知字段'}},
    {entityId:'p2',displayName:'同名人物',profile:{personality:'其他人物秘密'}}]},cse:{ready:false,currentSubjects:[
    {subjectEntityId:'p1',displayName:'同名人物',core:[{text:'想邀请用户吃饭',visibility:'private',reason:'只是打算，尚未行动',towardEntityId:'u',towardDisplayName:'用户'}],adaptive:[],situational:[{text:'容易犹豫',visibility:'authorial'}]},
    {subjectEntityId:'p2',core:[{text:'别人的私密状态',visibility:'private'}]}]}};
  const bridge={schemaVersion:1,kind:'qqj-public-memory-bridge',getStatus:()=>({status:'ready',identity}),getPromptSnapshot:()=>structuredClone(prepared),getSnapshot:()=>structuredClone(data),readMemory(){throw Error('must not read full backend memory');}};
  const win={SillyTavern:{getContext:()=>ctx},[MEMORY_BRIDGE_KEY]:bridge};
  return {win,person,identity,ctx,prepared,data,bridge};
}
test('off performs zero plugin access; legacy profiles remain valid; malformed enabled bindings cannot save',()=>{
  const win={};Object.defineProperty(win,MEMORY_BRIDGE_KEY,{get(){throw Error('must not touch plugin');}});
  const p=newPerson(undefined,'人物'),book=newBook();book.people.push(p);assert.equal(readMemoryReference(win,p),undefined);assert.equal(validateBook(book),book);
  p.memoryLink={...defaultMemoryPolicy(),enabled:true};assert.throws(()=>validateBook(book),/关联/);
  p.memoryLink={...defaultMemoryPolicy(),enabled:true,chatId:'a',profile:true};assert.throws(()=>validateBook(book),/对应人物/);
});
test('latest prepared material only; no full-memory fallback or automatic retrieval; unavailable selections stop',()=>{
  const f=fixture(),ref=readMemoryReference(f.win,f.person);assert.match(ref.text,/明天见面/);assert(!ref.text.includes('整库'));assert(!ref.text.includes('人物秘密'));
  f.prepared.status='empty';assert.throws(()=>readMemoryReference(f.win,f.person),/暂无/);
  delete f.bridge.getPromptSnapshot;assert.throws(()=>readMemoryReference(f.win,f.person),/更新插件/);
  delete f.win[MEMORY_BRIDGE_KEY];assert.throws(()=>readMemoryReference(f.win,f.person),/未检测/);
});
test('explicit IDs isolate duplicate names; only allowlisted profile and bound state with knowledge boundaries',()=>{
  const f=fixture();Object.assign(f.person.memoryLink,{plot:false,profile:true,state:true,entityId:'p1'});
  const before=JSON.stringify(f.data),ref=readMemoryReference(f.win,f.person);
  for(const phrase of ['温和','仅此人物本人知情','尚未行动','不代表人物知情','仅已保存部分','对象：用户'])assert(ref.text.includes(phrase));
  for(const phrase of ['明天见面','其他人物秘密','别人的私密状态','密钥','未知字段'])assert(!ref.text.includes(phrase));
  assert.equal(JSON.stringify(f.data),before);assert.equal(memoryPeople(f.win).people.length,2);
  f.data.people.items=f.data.people.items.filter(x=>x.entityId!=='p1');assert.throws(()=>readMemoryReference(f.win,f.person),/档案未加载或已删除/);
});
test('archive mismatch, stale snapshots, changing persona and bridge replacement fail closed',()=>{
  const f=fixture();f.person.memoryLink.chatId='another';assert.throws(()=>readMemoryReference(f.win,f.person),/另一份/);f.person.memoryLink.chatId='memory-A';
  f.ctx.chatId='chat-B';assert.throws(()=>memoryConnection(f.win),/尚未对应/);f.ctx.chatId='chat-A';
  f.bridge.getPromptSnapshot=()=>({...f.prepared,identity:{...f.identity,qqjChatId:'other'}});assert.throws(()=>readMemoryReference(f.win,f.person),/所属存档/);
  f.bridge.getPromptSnapshot=()=>{const value=structuredClone(f.prepared);f.identity.personaLocator='user-B';return value;};assert.throws(()=>readMemoryReference(f.win,f.person),/人设已变化/);
  f.bridge.getPromptSnapshot=()=>{f.win[MEMORY_BRIDGE_KEY]={...f.bridge};return structuredClone(f.prepared);};assert.throws(()=>readMemoryReference(f.win,f.person),/已变化/);
});
test('size cap preserves complete boundaries; preview and reply share the same source',()=>{
  const f=fixture();f.person.memoryLink.maxChars=1000;f.prepared.recall.text='长记忆'.repeat(1000);assert.throws(()=>readMemoryReference(f.win,f.person),/超过设置/);
  f.prepared.recall.text='<img src=x onerror=alert(1)> 只是文本';const book=newBook();book.people.push(f.person);
  const ref=readMemoryReference(f.win,f.person),ctx=replyContext(f.win,book,f.person);assert.deepEqual(ctx.memory,ref);
  const prompt=buildPrompt(ctx,newHistory(book.id),f.person.id,20);assert(prompt.some(m=>m.content.includes(ref.text.replaceAll('\n','\\n'))));
});
test('disabled plugin, partial states, deleted binding, empty and unsupported scopes are explicit',()=>{
  const f=fixture();f.bridge.getStatus=()=>({status:'disabled'});assert.throws(()=>readMemoryReference(f.win,f.person),/已关闭/);
  f.bridge.getStatus=()=>({status:'ready',identity:f.identity});f.prepared.scope='all';assert.throws(()=>readMemoryReference(f.win,f.person),/暂无/);
  Object.assign(f.person.memoryLink,{plot:false,state:true,entityId:'p1'});assert.match(readMemoryReference(f.win,f.person).text,/仅已保存部分/);
  f.data.cse.currentSubjects=[];assert.throws(()=>readMemoryReference(f.win,f.person),/状态未加载或已删除/);
});
