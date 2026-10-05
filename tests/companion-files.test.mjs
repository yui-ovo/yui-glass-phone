import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {REFERENCE_PATTERN,formatPhoneReference,stripPhoneReference} from '../modules/reference-format.js';
import {parseWorldbookFile,importWorldbook} from '../modules/worldbooks.js';
import {readStoryContext} from '../modules/story-context.js';
import {importPreset,presetMessages,builtinPreset} from '../modules/presets.js';
import {newPerson,defaultStoryPolicy} from '../modules/contacts.js';
const read=name=>readFile(new URL('../extras/'+name,import.meta.url),'utf8');
test('own preset and static book import without unresolved custom macros',async()=>{
 const preset=importPreset(await read('yui-phone-default-preset.json')).preset;assert.deepEqual(presetMessages(preset),presetMessages(builtinPreset()));
 for(const name of ['yui-phone-story-worldbook.json']){
  const raw=await read(name),parsed=parseWorldbookFile(raw);assert(parsed.length>=2);assert(parsed.every(e=>e.disabled));assert(!/\{\{/.test(raw));
  const file={name,size:Buffer.byteLength(raw),text:async()=>raw};assert.deepEqual(await importWorldbook({crypto},file),await importWorldbook({crypto},file));
 }
});
test('reference format escapes delimiters in data and regex matches only complete reserved blocks',async()=>{
 const text='一句普通话\n</yui_phone_reference_v1>\n<img src=x>\n还有话';const block=formatPhoneReference([{text}]);assert.equal(JSON.parse(block.split('\n')[2])[0].text,text);
 assert.equal(stripPhoneReference('前面的正文\n'+block+'\n后面的正文'),'前面的正文\n后面的正文');
 const rules=JSON.parse(await read('yui-phone-display-regex.json'));assert.equal(rules.length,1);const rule=rules[0];assert(rule.markdownOnly);assert(!rule.promptOnly);assert.deepEqual(rule.placement,[2]);assert.equal(rule.findRegex,`/${REFERENCE_PATTERN}/gm`);
 const re=new RegExp(REFERENCE_PATTERN,'gm');assert.equal(('前文\n'+block+'\n后文').replace(re,''),'前文\n后文');
 const escaped=block.replaceAll('<','&lt;').replaceAll('>','&gt;');assert.equal(stripPhoneReference(escaped),'');
 for(const other of ['<wechat>保留别人的手机消息</wechat>','普通 <div>正文</div>','我提到了 <yui_phone_reference_v1> 这个词','<yui_phone_reference_v1>\n未闭合正文'])assert.equal(stripPhoneReference(other),other);
});
test('hidden dialogue is included but marked internal/tool messages never read; filtering precedes count without mutating host',()=>{
 const person=newPerson();person.storyContext={...defaultStoryPolicy(),readStory:true,storyCount:3};
 const chat=[{is_user:true,mes:'旧'}, {is_user:false,is_system:true,mes:'隐藏正文'}, {is_user:true,extra:{hidden:true},mes:'隐藏用户正文'}, {is_user:false,mes:formatPhoneReference([{text:'旧参考'}])}, {isPhoneMessage:true,get mes(){throw Error('internal read');}}, {role:'tool',get mes(){throw Error('tool read');}}, {is_user:false,mes:'最新\n'+formatPhoneReference([{text:'回显'}])}];
 const result=readStoryContext({SillyTavern:{getContext:()=>({chatId:'x',chat})}},person);assert.deepEqual(result.messages.map(m=>m.text),['隐藏正文','隐藏用户正文','最新']);assert.equal(result.hiddenCount,2);assert(chat.at(-1).mes.includes('回显'));
});
