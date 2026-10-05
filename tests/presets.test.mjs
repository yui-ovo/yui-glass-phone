import test from 'node:test';
import assert from 'node:assert/strict';
import {createLibrary,builtinPreset,copyPreset,textBlock,moveBlock,readPresets,savePresets,selectedPreset,importPreset,exportPreset,validateLibrary,PRESETS_KEY,PRESETS_BACKUP_KEY,presetMessages,PRESET_STYLE} from '../modules/presets.js';
import {assemblePhonePrompt} from '../modules/reply-prompt.js';
import {defaultConfig} from '../modules/ai.js';
import {newHistory} from '../modules/messages.js';
const storage=()=>{const data=new Map();return {data,localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}};};
test('legacy prompts migrate in memory without touching API storage; builtin locked; export contains no credentials',()=>{
 const win=storage();win.data.set('yui-glass-phone.ai.v1','original credentials');const l=readPresets(win,{frontPrompt:'前置',prompt:'我的风格'});assert.equal(l.raw,null);assert.deepEqual(presetMessages(selectedPreset(l.library)).map(m=>m.content),['前置','我的风格']);assert.equal(win.data.size,1);
 const saved=savePresets(win,l.library,null);assert.equal(readPresets(win).library.activeId,saved.library.activeId);assert.equal(win.data.get('yui-glass-phone.ai.v1'),'original credentials');assert(!exportPreset(selectedPreset(l.library)).includes('credentials'));
 const broken=structuredClone(l.library);broken.presets[0].blocks[0].content='mutated';assert.throws(()=>validateLibrary(broken));
});
test('custom text toggles and order are honored; required context/history/protocol remain',()=>{
 const p=copyPreset(builtinPreset());p.blocks=[textBlock('一','第一'),textBlock('二','第二'),{...textBlock('关','不要发送'),enabled:false}];moveBlock(p,p.blocks[1].id,-1);
 const ctx={character:{name:'人物'},user:{name:'用户'},worldbook:[]},out=assemblePhonePrompt(ctx,newHistory('a'),'p',defaultConfig(),[],p),raw=JSON.stringify(out);
 assert.equal(out[0].content,'第二');assert.equal(out[1].content,'第一');assert(!raw.includes('不要发送'));assert(raw.includes('phoneReply'));assert(raw.includes('人物'));assert(!raw.includes('虚构 CNY'));assert(raw.includes('故事中实际发生'));
 assert.throws(()=>moveBlock(builtinPreset(),'builtin-style',1));
});
test('nuopreset imports real text, repairs IDs and quarantines unknown markers/macros/depth/regex',()=>{
 const v={__nuojijiChatPreset:true,name:'外部',mode:'online',author:'作者',blocks:[{id:'same',type:'text',content:'正常',name:'A',enabled:true,role:'system'},{id:'same',type:'text',content:'{{foreign}}',name:'B',enabled:true},{id:'c',type:'text',content:'深度',name:'C',injection:{position:'depth',depth:3}},{id:'m',key:'memoryLong',type:'marker'},{id:'f',key:'format',type:'marker'}],regexRules:[{findRegex:'.*'}],params:{apiKey:'secret'}};
 const {preset,report}=importPreset(JSON.stringify(v));assert.equal(new Set(preset.blocks.map(b=>b.id)).size,3);assert.equal(preset.unsupported.length,3);assert.deepEqual(presetMessages(preset).map(m=>m.content),['正常']);assert(report.some(x=>x.includes('重复')));assert(report.some(x=>x.includes('正则')));assert(!exportPreset(preset).includes('secret'));
 const own=importPreset(exportPreset(preset)).preset;assert.equal(own.blocks[0].content,'正常');assert.deepEqual(own.attribution,['作者：作者']);
});
test('empty marker preset is not advertised as migrated built-in text and malformed imports reject',()=>{
 const p=importPreset(JSON.stringify({__nuojijiChatPreset:true,name:'markers',blocks:[{id:'a',type:'marker',key:'soul'},{id:'a',type:'marker',key:'discipline'}]})).preset;assert.equal(p.blocks.length,0);assert.equal(p.unsupported.length,2);
 for(const raw of ['{}','{','x'.repeat(1000001),JSON.stringify({__nuojijiChatPreset:true,name:'bad',blocks:[{type:'text',content:'x',enabled:'false'}]})])assert.throws(()=>importPreset(raw));
});
test('save failure keeps previous library; conflicts rejected and previous version backed up',()=>{
 const win=storage(),l=createLibrary(),first=savePresets(win,l,null),copy=copyPreset(builtinPreset());const d=structuredClone(first.library);d.presets.push(copy);d.activeId=copy.id;
 const original=win.localStorage.setItem;win.localStorage.setItem=()=>{throw Error('quota');};assert.throws(()=>savePresets(win,d,first.raw),/草稿/);assert.equal(win.localStorage.getItem(PRESETS_KEY),first.raw);win.localStorage.setItem=original;
 const second=savePresets(win,d,first.raw);assert.equal(win.data.get(PRESETS_BACKUP_KEY),first.raw);assert.throws(()=>savePresets(win,d,first.raw),/其他窗口/);assert.equal(win.data.get(PRESETS_KEY),second.raw);
 win.data.set(PRESETS_KEY,'bad');assert.throws(()=>readPresets(win));assert.equal(win.data.get(PRESETS_KEY),'bad');
});
