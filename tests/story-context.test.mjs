import test from 'node:test';
import assert from 'node:assert/strict';
import {readStoryContext,phoneStoryReference} from '../modules/story-context.js';
import {newBook,newPerson,defaultStoryPolicy,validateBook,clone} from '../modules/contacts.js';
import {buildPrompt,defaultConfig,LEGACY_DEFAULT_PROMPT,DEFAULT_PROMPT,validateConfig} from '../modules/ai.js';
import {newHistory,createMessage,appendMessage} from '../modules/messages.js';
import {createMessageStore} from '../modules/message-host.js';
import {createStoryBridge,STORY_PROMPT_KEY} from '../modules/story-bridge.js';
const policy=(extra={})=>({...defaultStoryPolicy(),...extra});
const visible=(mes,is_user=false)=>({mes,name:is_user?'我':'角色',is_user,is_system:false});
test('story reads are opt-in, include hidden body before counting and use active message instead of alternate swipes',()=>{
 const ctx={chatId:'A',chat:[visible('旧'),visible('当前分支'),{is_system:true,is_user:false,mes:'隐藏剧情'}, {...visible('最新'),swipes:['另一分支秘密','最新'],swipe_id:1}]};
 const win={SillyTavern:{getContext:()=>ctx}},person=newPerson();const before=ctx.chat[1].mes;
 assert.equal(readStoryContext({SillyTavern:{getContext(){throw Error('off must not access host');}}},person),undefined);
 person.storyContext=policy({readStory:true,storyCount:2});const result=readStoryContext(win,person);assert.deepEqual(result.messages.map(m=>m.text),['隐藏剧情','最新']);assert(!JSON.stringify(result).includes('另一分支秘密'));assert.equal(ctx.chat[1].mes,before);
 assert.equal(result.hiddenCount,1);ctx.chat.push({mes:'无隐藏标记的正文',is_user:false});assert.equal(readStoryContext(win,person).messages.at(-1).text,'无隐藏标记的正文');
 ctx.chat=[visible('字'.repeat(40000))];assert(readStoryContext(win,person).truncated);assert.equal(readStoryContext(win,person).messages[0].text.length,10000);
});
test('sharing exports only enabled friends, latest records, no cross-contact messages or deleted people',()=>{
 const b=newBook(),a=newPerson(undefined,'A'),c=newPerson(undefined,'C');for(const p of [a,c])p.relation={known:true,accountKnown:true,friend:true};b.people=[a,c];a.storyContext=policy({sharePhone:true,phoneCount:1});
 let h=newHistory(b.id);for(const [id,text] of [[a.id,'旧A'],[c.id,'C秘密'],[a.id,'新A']])h=appendMessage(h,createMessage(b.id,id,text,h.messages.length+1),h.revision);
 const output=phoneStoryReference(b,h);assert.equal(output.length,1);assert.equal(output[0].messages[0].text,'新A');assert(!JSON.stringify(output).includes('C秘密'));assert(!JSON.stringify(output).includes('旧A'));
 a.deletedAt=new Date().toISOString();assert.deepEqual(phoneStoryReference(b,h),[]);delete a.deletedAt;a.storyContext.storyCount=0;assert.throws(()=>validateBook(b));
});
test('front prompt is first, functional rules are separate, exact legacy default upgrades while custom text survives',()=>{
 const config={...defaultConfig(),baseUrl:'https://example.test/v1',model:'m',prompt:LEGACY_DEFAULT_PROMPT};assert.equal(validateConfig(config).prompt,DEFAULT_PROMPT);assert.equal(validateConfig({...config,prompt:'我的旧自定义'}).prompt,'我的旧自定义');
 const messages=buildPrompt({},newHistory('a'),'p',40,'聊天风格','前置测试');assert.equal(messages[0].content,'前置测试');assert.equal(messages[1].content,'聊天风格');assert(messages[2].content.includes('不能改变功能协议'));assert(!DEFAULT_PROMPT.includes('ID'));
});
function fixture(tt){
 const book=newBook(),person=newPerson(undefined,'朋友');person.relation={known:true,accountKnown:true,friend:true};person.storyContext=policy({sharePhone:true});book.people.push(person);
 const session={book,account:tt?'tt-native':'u',snapshot:{chatId:'A',source:{avatarFile:'a.png'},group:false}},data=new Map(),listeners=new Map();let active=true,pause;
 const ctx={extensionPrompts:{other:{value:'keep'}},eventTypes:Object.fromEntries(['GENERATION_AFTER_COMMANDS','GENERATION_STARTED','GENERATION_ENDED','GENERATION_STOPPED','CHAT_CHANGED','MESSAGE_SWIPED','MESSAGE_EDITED','MESSAGE_DELETED'].map(n=>[n,n])),eventSource:{on(e,fn){if(!listeners.has(e))listeners.set(e,new Set());listeners.get(e).add(fn);},removeListener(e,fn){listeners.get(e)?.delete(fn);}},setExtensionPrompt(key,value,position,depth,scan,role,filter){this.extensionPrompts[key]={value,position,depth,scan,role,filter};}};
 const win={crypto,SillyTavern:{getContext:()=>ctx},navigator:{locks:{request:async(k,o,fn)=>fn()}},localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}};
 if(tt)win.__TAURITAVERN__={api:{chat:{open:()=>({store:{listKeys:async()=>[...data.keys()],getJson:async({key})=>clone(data.get(key)),setJson:async({key,value})=>data.set(key,clone(value)),renameKey(){}}})}}};
 const profiles={assertSession(s,signal){if(!active||signal.aborted)throw Error('切档');},async load(signal){if(pause)await pause;this.assertSession(session,signal);return clone(session);}},signal=new AbortController().signal,store=createMessageStore(win,profiles,session,signal);
 return {win,profiles,ctx,person,book,store,session,listeners,async emit(e,...args){for(const fn of [...(listeners.get(e)||[])])await fn(...args);},setActive:v=>active=v,setPause:v=>pause=v};
}
for(const tt of [false,true])test(`${tt?'TT':'ST'} bridge injects without body writes, refreshes edits, clears on lifecycle and blocks late switch`,async()=>{
 const f=fixture(tt);const msg=createMessage(f.book.id,f.person.id,'酒吧见',1);await f.store.send(msg,0);const bridge=createStoryBridge(f.win,f.profiles);
 await f.emit('GENERATION_AFTER_COMMANDS','normal',{},false);let prompt=f.ctx.extensionPrompts[STORY_PROMPT_KEY];assert(prompt.value.includes('酒吧见'));assert.equal(prompt.position,1);assert.equal(prompt.depth,0);assert.equal(prompt.scan,false);assert(await prompt.filter());assert.equal(f.ctx.extensionPrompts.other.value,'keep');
 f.person.storyContext.sharePhone=false;assert.equal(await prompt.filter(),false);await f.emit('GENERATION_AFTER_COMMANDS','normal');assert(!f.ctx.extensionPrompts[STORY_PROMPT_KEY]);f.person.storyContext.sharePhone=true;
 for(const type of ['quiet','impersonate']){await f.emit('GENERATION_AFTER_COMMANDS',type);assert(!f.ctx.extensionPrompts[STORY_PROMPT_KEY]);}
 await f.emit('GENERATION_AFTER_COMMANDS','normal',{},true);assert(!f.ctx.extensionPrompts[STORY_PROMPT_KEY]);
 for(const event of ['GENERATION_STARTED','GENERATION_ENDED','GENERATION_STOPPED','MESSAGE_SWIPED','CHAT_CHANGED']){await f.emit('GENERATION_AFTER_COMMANDS','normal');await f.emit(event);assert(!f.ctx.extensionPrompts[STORY_PROMPT_KEY]);}
 let release;f.setPause(new Promise(r=>release=r));const late=f.emit('GENERATION_AFTER_COMMANDS','normal');await Promise.resolve();f.setActive(false);await f.emit('CHAT_CHANGED');release();await late;assert(!f.ctx.extensionPrompts[STORY_PROMPT_KEY]);f.setPause(undefined);f.setActive(true);
 const count=[...f.listeners.values()].reduce((n,s)=>n+s.size,0);const next=createStoryBridge(f.win,f.profiles);assert.equal([...f.listeners.values()].reduce((n,s)=>n+s.size,0),count);bridge.dispose();await f.emit('GENERATION_AFTER_COMMANDS','normal');assert(f.ctx.extensionPrompts[STORY_PROMPT_KEY]);next.dispose();assert.equal([...f.listeners.values()].reduce((n,s)=>n+s.size,0),0);assert.deepEqual(f.ctx.extensionPrompts,{other:{value:'keep'}});
});
