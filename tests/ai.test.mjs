import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, validateConfig, saveConfig, readConfig, apiRequest, replyContext, buildPrompt, currentPersona, materialSnapshot, worldEntries, materialKey } from '../modules/ai.js';
import { newBook, newPerson, clone, validateBook } from '../modules/contacts.js';
import { createMessage, createReply, appendMessage, newHistory, validateHistory } from '../modules/messages.js';
const config = () => ({ ...defaultConfig(), baseUrl: 'https://api.example.test/v1/', apiKey: 'fixture-secret', model: 'fixture-model' });
test('independent config rejects malformed input and storage failures; secret never passed through URL', async () => {
  assert.equal(validateConfig(config()).baseUrl, 'https://api.example.test/v1');
  for (const change of [{ baseUrl: 'javascript:alert(1)' }, { baseUrl: 'https://secret@host/v1' }, { baseUrl: 'https://host/v1?k=secret' }, { model: '' }, { temperature: 3 }, { maxTokens: 0 }, { historyCount: 0 }]) assert.throws(() => validateConfig({ ...config(), ...change }));
  const values = new Map(), win = { localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } };
  assert.deepEqual(readConfig(win), defaultConfig()); saveConfig(win, config()); assert.equal(readConfig(win).model, 'fixture-model');
  win.localStorage.setItem = () => { throw Error('quota'); }; assert.throws(() => saveConfig(win, config()), /保存失败/);
  let request;
  const reply = await apiRequest({ fetch: async (url, options) => { request = { url, options }; return Response.json({ choices: [{ message: { content: '中文🙂\n<img onerror=evil()>' }, finish_reason: 'stop' }] }); } }, config(), 'reply', [{ role: 'user', content: '测试' }]);
  assert(reply.includes('<img')); assert.equal(request.options.credentials, 'omit'); assert.equal(request.options.redirect, 'error'); assert.equal(request.options.headers.Authorization, 'Bearer fixture-secret'); assert(!request.url.includes('secret'));
  assert.equal(JSON.parse(request.options.body).stream, false);
});
test('API models, HTTP failure, bad JSON, truncated and tool responses are explicit errors', async () => {
  const win = body => ({ fetch: async () => Response.json(body) });
  assert.deepEqual(await apiRequest(win({data:[{id:'b'},{id:'a'},{id:'a'}]}), {...config(),model:''}, 'models'), ['a','b']);
  for (const body of [{}, { choices:[{message:{content:' '}}] }, { choices:[{message:{content:'abc'},finish_reason:'length'}] }, { choices:[{message:{content:'abc',tool_calls:[{}]}}] }]) await assert.rejects(apiRequest(win(body), config(), 'reply', []));
  await assert.rejects(apiRequest({fetch:async()=>new Response('SECRET-DO-NOT-ECHO',{status:401})},config(),'reply',[]), e=>e.message.includes('401')&&!e.message.includes('SECRET'));
  await assert.rejects(apiRequest({fetch:async()=>new Response('bad')},config(),'reply',[]), /JSON/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(apiRequest({fetch:async()=>{throw Error('network secret');}},config(),'reply',[],controller.signal), /已停止/);
});
test('context selects only active persona, source card, chosen materials and one phone conversation', async () => {
  const book = newBook(), person = newPerson({kind:'card',name:'卡标题',avatarFile:'source.png'},'人物');
  person.relation={friend:true,known:true,accountKnown:true};book.people.push(person);person.description='线上习惯';
  const entries={1:{uid:1,comment:'相关',content:'选中内容'},2:{uid:2,comment:'无关',content:'不得发出'}};
  const ctx={name1:'当前我',powerUserSettings:{persona_description:'当前我的人设'},characters:{9:{avatar:'source.png',data:{name:'卡标题',description:'指定卡内容'}},0:{avatar:'other.png',description:'不得读取的卡'}},getWorldInfoNames:()=>['书'],loadWorldInfo:async()=>({entries})};
  Object.defineProperty(ctx,'chat',{get(){throw Error('不能读取宿主历史');}});Object.defineProperty(ctx.powerUserSettings,'personas',{get(){throw Error('不能遍历其他人设');}});
  const win={SillyTavern:{getContext:()=>ctx},crypto};
  person.roleplayMaterials=await Promise.all((await worldEntries(win,'书')).map(entry=>materialSnapshot(win,entry)));
  person.aiExcludedMaterials=[materialKey(person.roleplayMaterials[1])];validateBook(book);
  const before=clone(book),context=replyContext(win,book,person);
  assert.equal(context.user.description,'当前我的人设');assert.equal(context.character.card.description,'指定卡内容');assert.equal(context.worldbook.length,1);
  let history=newHistory(book.id);history=appendMessage(history,createMessage(book.id,person.id,'自己的消息',1),0);history=appendMessage(history,createReply(book.id,person.id,'对方回复',2),1);history=appendMessage(history,createMessage(book.id,'else','其他人的消息',3),2);
  const prompt=buildPrompt(context,history,person.id,1);assert(prompt.some(m=>m.role==='assistant'&&m.content==='对方回复'));assert(!JSON.stringify(prompt).includes('不得发出'));assert(!JSON.stringify(prompt).includes('其他人的消息'));assert(!JSON.stringify(prompt).includes('自己的消息'));assert.deepEqual(book,before);
  delete ctx.name1;assert.throws(()=>currentPersona(win),/当前用户人设/);
});
test('incoming records share old history safely and cannot spoof direction or source', () => {
  let history=appendMessage(newHistory('book'),createMessage('book','person','用户',1),0);
  const incoming=createReply('book','person','回复',2);history=appendMessage(history,incoming,1);
  assert.equal(history.messages[1].sender.id,'person');assert.equal(history.messages[1].recipient.id,'self:book');assert.deepEqual(appendMessage(history,incoming,0),history);
  for(const patch of [{source:'phone-manual'},{conversationId:'direct:wrong'},{recipient:{kind:'self',id:'self:other'}}]) assert.throws(()=>validateHistory({...history,messages:[history.messages[0],{...incoming,...patch}]},'book'));
});
