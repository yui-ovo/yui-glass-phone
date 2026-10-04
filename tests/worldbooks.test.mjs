import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyWorldbooks, parseWorldbookFile, importWorldbook, MAX_IMPORT_BYTES } from '../modules/worldbooks.js';
import { materialSnapshot, replyContext, materialKey } from '../modules/ai.js';
import { newPerson, newBook, clone, validateBook } from '../modules/contacts.js';

const card = (avatar, world = '') => ({ avatar, data: { extensions: { world } } });
const fixture = () => ({ characterId: '42', characters: { 42: card('now.png', '当前主书'), 7: card('other.png', '其他主书') } });
const names = ['当前主书', '当前副书', '其他主书', '其他副书', '遗留绑定', '通用书'];
const settings = { world_info: { charLore: [{ name: 'now', extraBooks: ['当前副书'] }, { name: 'other', extraBooks: ['其他副书'] }, { name: 'missing', extraBooks: ['遗留绑定'] }] } };

test('worldbook choices exclude every primary/auxiliary binding, preserve current group, never use character names or indices as identities', () => {
  const ctx = fixture(), before = clone(ctx);
  assert.deepEqual(classifyWorldbooks(ctx, names, settings), { current: ['当前主书', '当前副书'], unbound: ['通用书'], warning: '' });
  assert.deepEqual(ctx,before);
  ctx.characters[42].name = ctx.characters[7].name = '同名人物';
  ctx.characters[99] = ctx.characters[42]; delete ctx.characters[42]; ctx.characterId = 99;
  assert.deepEqual(classifyWorldbooks(ctx, names, settings).current, ['当前主书', '当前副书']);
});

test('shallow ST/TT cards with explicit world metadata remain classifiable without hydrating cards', () => {
  const ctx=fixture();for(const c of Object.values(ctx.characters))c.shallow=true;
  ctx.characters[99]={...card('unbound.png'),shallow:true};
  const before=clone(ctx);assert.deepEqual(classifyWorldbooks(ctx,names,settings),{current:['当前主书','当前副书'],unbound:['通用书'],warning:''});assert.deepEqual(ctx,before);
  Object.defineProperty(ctx.characters[7],'description',{get(){throw Error('must not read character content');}});
  ctx.unshallowCharacter=()=>{throw Error('must not hydrate characters');};
  assert.deepEqual(classifyWorldbooks(ctx,names,settings).unbound,['通用书']);
});

test('missing or malformed binding metadata fails closed; verified current books remain available', () => {
  for (const mutate of [ctx=>{ctx.characters[7].shallow=true;delete ctx.characters[7].data.extensions.world;},ctx=>{ctx.characters[7].shallow=true;ctx.characters[7].data.extensions.world=undefined;}, ctx=>delete ctx.characters[7].data, ctx=>ctx.characters[7].data.extensions.world=7]) {
    const ctx = fixture(); mutate(ctx); const result = classifyWorldbooks(ctx,names,settings);
    assert.deepEqual(result.unbound,[]); assert(result.warning.includes('无法确认')); assert(result.current.includes('当前主书'));
  }
  for (const invalid of [undefined, {}, {world_info:{charLore:'bad'}}, {world_info:{charLore:[{name:'other',extraBooks:'bad'}]}}]) {
    const result=classifyWorldbooks(fixture(),names,invalid); assert.deepEqual(result.unbound,[]);assert(result.warning);
  }
  assert.deepEqual(classifyWorldbooks({characters:[]},names,settings).unbound,[]);
});

test('JSON import accepts ST objects and character-book arrays, keeps disabled entries opt-in and renders content as data', () => {
  const entries=parseWorldbookFile(JSON.stringify({entries:{9:{uid:9,comment:'状态栏',content:'<img src=x onerror=evil()>',disable:true},10:{content:'中文🙂\n第二行'}}}));
  assert.equal(entries[0].disabled,true);assert.equal(entries[0].content,'<img src=x onerror=evil()>');assert.equal(entries[1].uid,'10');
  assert.deepEqual(parseWorldbookFile(JSON.stringify({entries:[{id:3,name:'聊天',content:'简短',enabled:false}]})),[{uid:'3',title:'聊天',content:'简短',disabled:true}]);
});

test('invalid, duplicate, oversized or ID-less imports stop before profile mutation', async () => {
  for (const value of ['{','{}',JSON.stringify({entries:[]}),JSON.stringify({entries:[{content:'x'}]}),JSON.stringify({entries:[{id:1,content:'x'},{id:'1',content:'y'}]}),JSON.stringify({entries:{1:{content:5}}}),JSON.stringify({entries:{1:{content:'x'.repeat(20001)}}}),JSON.stringify({entries:{1:{content:'x',enabled:'yes'}}})]) assert.throws(()=>parseWorldbookFile(value));
  assert.throws(()=>parseWorldbookFile(' '.repeat(MAX_IMPORT_BYTES+1)),/2 MB/);
  await assert.rejects(importWorldbook({crypto},{size:MAX_IMPORT_BYTES+1,text:()=>{throw Error('must not read');}}),/2 MB/);
});

test('repeat file import has stable identity; different same-named content cannot replace old snapshots; exclusions preserve old fields', async () => {
  const text=JSON.stringify({entries:{1:{uid:1,content:'手机习惯'},2:{uid:2,content:'正文状态栏'}}});
  const file={name:'聊天规则.json',size:text.length,text:async()=>text}, win={crypto};
  const first=await importWorldbook(win,file),second=await importWorldbook(win,file);
  assert.deepEqual(first,second);
  const changed=await importWorldbook(win,{...file,text:async()=>text.replace('手机习惯','新习惯')});assert.notEqual(first[0].world,changed[0].world);
  const person=newPerson(undefined,'人物'),book=newBook();book.people.push(person);person.futureField={keep:true};
  person.roleplayMaterials=await Promise.all(first.map(entry=>materialSnapshot(win,entry)));const before=clone(person.roleplayMaterials);
  person.aiExcludedMaterials=[materialKey(person.roleplayMaterials[1])];validateBook(book);
  win.SillyTavern={getContext:()=>({name1:'我',powerUserSettings:{persona_description:'用户人设'}})};
  assert.equal(replyContext(win,book,person).worldbook.length,1);assert(!JSON.stringify(replyContext(win,book,person)).includes('正文状态栏'));
  assert.deepEqual(person.roleplayMaterials,before);assert.deepEqual(person.futureField,{keep:true});
});
