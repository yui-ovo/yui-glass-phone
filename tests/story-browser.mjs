import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
const engines=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=fileURLToPath(new URL('../',import.meta.url));await mkdir(path.join(root,'test-results'),{recursive:true});
const server=createServer(async(req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://test').pathname);if(!file.startsWith(root)){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[path.extname(file)]||'text/plain');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await engines[process.env.BROWSER_ENGINE||'chromium'].launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const b=(p,name)=>p.getByRole('button',{name,exact:true});
const wait=async(fn,label)=>{for(let i=0;i<220;i++){if(await fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('Timeout '+label);};
async function home(p){await b(p,'返回手机桌面').click();}
async function chat(p,name){await home(p);await b(p,'打开消息').click();await b(p,'打开聊天：'+name).click();}
try{
 for(const tt of [false,true]){
  const context=await browser.newContext({viewport:{width:393,height:740}}),p=await context.newPage();p.setDefaultTimeout(8000);const errors=[],requests=[];let release,delay=false;p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript({content:await readFile(path.join(root,'tests/profile-mock.js'),'utf8')});if(tt)await p.addInitScript({content:await readFile(path.join(root,'tests/tt-mock.js'),'utf8')});else await p.route('**/api/users/me',r=>r.fulfill({json:{handle:'test-user'}}));
  await p.addInitScript(()=>{
   const original=SillyTavern.getContext,m=profileMock;m.storyReads=0;m.prompts={other:{value:'保留其他扩展'}};
   m.story=[{name:'我',is_user:true,is_system:false,mes:'旧剧情'}, {name:'男主',is_user:false,is_system:false,mes:'酒吧见面',swipes:['不该读取的备选','酒吧见面'],swipe_id:1}, {is_user:false,is_system:true,mes:'隐藏的秘密'}, {name:'我',is_user:true,is_system:false,mes:'现在到了门口 <img src=x onerror=alert(1)>'}];
   SillyTavern.getContext=()=>{const old=original(),ctx={};for(const key of Object.keys(old))if(key!=='chat')ctx[key]=old[key];
    for(const name of ['MESSAGE_SENT','GENERATION_AFTER_COMMANDS','GENERATION_STARTED','GENERATION_ENDED','GENERATION_STOPPED','MESSAGE_SWIPED','MESSAGE_EDITED','MESSAGE_DELETED'])ctx.eventTypes[name]=name;
    ctx.extensionPrompts=m.prompts;ctx.setExtensionPrompt=(key,value,position,depth,scan,role,filter)=>{m.prompts[key]={value,position,depth,scan,role,filter};};
    Object.defineProperty(ctx,'chat',{get(){m.storyReads++;return m.story;}});ctx.saveChat=async()=>{m.disk=structuredClone(m.story);localStorage.setItem('fixture.story.disk',JSON.stringify(m.disk));};ctx.stopGeneration=()=>{};return ctx;
   };
  });
  await p.addInitScript(()=>{
   const m=profileMock,stored=localStorage.getItem('fixture.story.disk');if(stored)m.story=JSON.parse(stored);
   m.disk=structuredClone(m.story);
   const raw=fetch;window.fetch=async(url,options)=>{
    if(url==='/api/chats/get')return new Response(JSON.stringify([{chat_metadata:{integrity:m.integrity}},...m.disk]),{status:200});
    if(url==='/api/chats/save'){m.disk=JSON.parse(options.body).chat.slice(1);localStorage.setItem('fixture.story.disk',JSON.stringify(m.disk));return new Response('{}',{status:200});}
    return raw(url,options);
   };
   if(window.__TAURITAVERN__){const open=__TAURITAVERN__.api.chat.open;__TAURITAVERN__.api.chat.open=ref=>({...open(ref),history:{tail:async({limit})=>({startIndex:Math.max(0,m.disk.length-limit),messages:structuredClone(m.disk.slice(-limit))})}});}
  });
  await p.route('https://story-ai.fixture/**',async r=>{if(r.request().method()==='OPTIONS'){await r.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type'}});return;}requests.push(r.request().postDataJSON());if(delay)await new Promise(resolve=>release=resolve);await r.fulfill({json:{choices:[{message:{content:'手机回复测试'},finish_reason:'stop'}]}}).catch(()=>{});});
  await p.goto(base+'/preview.html');await b(p,'打开设置').click();await b(p,'独立 API 设置').click();await p.getByLabel('API 地址',{exact:true}).fill('https://story-ai.fixture/v1');await p.getByLabel('模型名称',{exact:true}).fill('fixture');
  await b(p,'保存 API 设置').click();await b(p,'管理聊天预设').click();await b(p,'新建预设').click();await b(p,'添加条目').click();await p.getByLabel('条目名称',{exact:true}).fill('前置提示词');await p.getByLabel('条目内容',{exact:true}).fill('前置风格测试');await b(p,'添加条目').click();await p.getByLabel('条目名称',{exact:true}).last().fill('聊天风格');await p.getByLabel('条目内容',{exact:true}).last().fill('使用短句');await b(p,'使用此预设').click();await b(p,'保存预设设置').click();
  for(const name of ['男主','NPC']){
   await home(p);await b(p,'打开消息').click();await b(p,'联系人').click();await b(p,'登记人物').click();await b(p,'手动创建人物').click();await p.getByLabel('人物名字',{exact:true}).fill(name);await p.getByLabel('开局关系',{exact:true}).selectOption('friend');
   await p.getByText('剧情衔接',{exact:true}).click();assert(!(await p.getByLabel('参考当前酒馆剧情',{exact:true}).isChecked()));assert(!(await p.getByLabel('将此人的手机聊天提供给正文',{exact:true}).isChecked()));
   if(name==='男主'){await p.getByText('AI 回复参考 · 世界书',{exact:true}).click();await p.getByLabel('导入世界书文件',{exact:true}).setInputFiles({name:'story-fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({entries:{0:{uid:0,comment:'自然聊天',content:'回应对方真正关心的事',disable:true},1:{uid:1,comment:'其他规则',content:'不为展示功能强行发出',disable:true}}}))});const selectedRule=p.getByRole('checkbox',{name:/自然聊天$/});await selectedRule.waitFor();assert(!(await selectedRule.isChecked()));await selectedRule.check();await wait(()=>selectedRule.isEnabled(),'companion selection');await p.getByLabel('参考当前酒馆剧情',{exact:true}).check();await p.getByLabel('最近正文消息条数（含隐藏楼层）',{exact:true}).fill('2');await p.getByLabel('将此人的手机聊天提供给正文',{exact:true}).check();await p.getByLabel('每次补记最多消息条数',{exact:true}).fill('2');await b(p,'预览正文参考').click();assert((await p.locator('.story-preview').textContent()).includes('其中隐藏 1 条'));assert((await p.locator('.story-preview').textContent()).includes('隐藏的秘密'));assert.equal(await p.locator('.story-preview img').count(),0);await p.screenshot({path:path.join(root,`test-results/story-settings-${tt?'tt':'st'}.png`)});}
   await b(p,'保存人物').click();await wait(async()=> (await p.locator('.profile-status').textContent()).includes('已保存到当前存档'),'save person');await b(p,'取消').click();
  }
  await chat(p,'男主');await p.getByLabel('消息输入框',{exact:true}).fill('我约好了酒吧见');await b(p,'发送').click();await wait(()=>b(p,'让对方回复').isEnabled(),'sent');await p.waitForTimeout(850);await b(p,'让对方回复').click();await wait(()=>requests.length===1,'reply');await wait(()=>p.getByText('手机回复测试',{exact:true}).count(),'reply saved');
  assert.equal(requests[0].messages[0].content,'前置风格测试');assert.equal(requests[0].messages[1].content,'使用短句');const serialized=JSON.stringify(requests[0]);assert(!serialized.includes('酒吧见面'));assert(serialized.includes('隐藏的秘密'));assert(serialized.includes('回应对方真正关心的事'));assert(!serialized.includes('不为展示功能强行发出'));assert(!serialized.includes('不该读取的备选'));assert(!serialized.includes('旧剧情'));
  await chat(p,'NPC');const reads=await p.evaluate(()=>profileMock.storyReads);await p.getByLabel('消息输入框',{exact:true}).fill('NPC独立聊天');await b(p,'发送').click();await wait(()=>b(p,'让对方回复').isEnabled(),'npc sent');await p.waitForTimeout(850);await b(p,'让对方回复').click();await wait(()=>requests.length===2,'npc request');await wait(()=>p.getByText('手机回复测试',{exact:true}).count(),'npc response');assert(!JSON.stringify(requests[1]).includes('隐藏的秘密'));assert(!JSON.stringify(requests[1]).includes('酒吧见面'));
  const key='yui-glass-phone.story-reference.v1',before=await p.evaluate(()=>JSON.stringify(profileMock.story));
  await home(p);await b(p,'打开设置').click();await b(p,'剧情时间').click();await p.getByText('手动校正',{exact:true}).click();await p.getByLabel('剧情日期',{exact:true}).fill('10月5日');await p.getByLabel('剧情时间',{exact:true}).fill('21:30');await b(p,'保存设置').click();await wait(async()=> (await p.locator('.profile-status').textContent()).includes('已保存'),'save clock');await home(p);assert.equal(await p.locator('.home-time').textContent(),'21:30');
  await b(p,'打开设置').click();await b(p,'待同步补记').click();await wait(()=>p.locator('.supplement-row').count(),'load pending');await p.getByLabel('保存手机补记到正文',{exact:true}).check();await b(p,'预览补记').click();assert((await p.locator('pre.memory-text').textContent()).includes('<yui_phone>'));assert(!(await p.locator('pre.memory-text').textContent()).includes('NPC独立聊天'));await b(p,'保存设置').click();await wait(async()=> (await p.locator('.profile-status').textContent()).includes('已保存'),'save sync');
  await p.setViewportSize({width:320,height:540});if(tt)await p.evaluate(()=>ttMock.emitLayout({version:1,safeFrame:{left:0,top:24,width:320,height:516},ime:{keyboardOffset:0}}));assert(await p.locator('.story-manager').evaluate(e=>e.scrollWidth<=e.clientWidth+1));await p.locator('.story-manager .directory-scroll').evaluate(e=>e.scrollTop=0);await p.screenshot({path:path.join(root,`test-results/supplement-${tt?'tt':'st'}-${process.env.BROWSER_ENGINE||'chromium'}.png`)});await p.setViewportSize({width:393,height:740});if(tt)await p.evaluate(()=>ttMock.emitLayout({version:1,safeFrame:{left:0,top:24,width:375,height:620},ime:{keyboardOffset:0}}));
  await p.evaluate(async()=>{await profileMock.emit('GENERATION_STARTED','normal');await profileMock.emit('GENERATION_AFTER_COMMANDS','normal',{},false);});
  const saved=await p.evaluate(()=>profileMock.story);assert.equal(saved.length,JSON.parse(before).length);assert(saved[2].mes.includes('我约好了酒吧见'));assert(!saved[2].mes.includes('NPC独立聊天'));assert.equal(saved[3].mes,JSON.parse(before)[3].mes);assert.equal(await p.evaluate(()=>JSON.stringify(profileMock.disk)),JSON.stringify(saved));
  await p.evaluate(async()=>{
   const host=document.createElement('div');host.id='chat';host.innerHTML='<div class="mes" mesid="2"><div class="mes_text"></div></div>';document.body.append(host);host.querySelector('.mes_text').textContent=profileMock.story[2].mes;
   const {decorateSupplements}=await import('/modules/supplement-view.js');decorateSupplements(window);decorateSupplements(window);
  });assert.equal(await p.locator('#chat .yui-supplement').count(),1);assert.equal(await p.locator('#chat .yui-supplement').getAttribute('open'),null);assert(!(await p.locator('#chat').textContent()).includes('<yui_phone>'));
  let aborted=await p.evaluate(async()=>{let stopped=false;await window.yuiPhoneSupplementInterceptorV1(profileMock.story,0,()=>stopped=true,'normal');return stopped;});assert(!aborted);
  await p.evaluate(()=>profileMock.emit('GENERATION_ENDED'));assert.equal(await p.evaluate(key=>!!profileMock.prompts[key],key),false);
  // Same archive active swipe changes during phone request: late reply is not saved.
  await chat(p,'男主');delay=true;await b(p,'让对方回复').click();await wait(()=>!!release,'delayed request');await p.evaluate(()=>{profileMock.story[3].mes='改成另一段剧情';profileMock.story[3].swipe_id=0;});delay=false;release();await wait(()=>b(p,'灵动岛：查看回复提示').count(),'context changed');await b(p,'灵动岛：查看回复提示').click();assert((await p.locator('.toast').textContent()).includes('已变化'));assert.equal(await p.getByText('手机回复测试',{exact:true}).count(),1);
  await p.reload();await b(p,'打开消息').click();await b(p,'打开聊天：男主').click();await b(p,'聊天资料').click();await p.getByText('剧情衔接',{exact:true}).click();assert(await p.getByLabel('参考当前酒馆剧情',{exact:true}).isChecked());assert.equal(await p.getByLabel('最近正文消息条数（含隐藏楼层）',{exact:true}).inputValue(),'2');await b(p,'预览分享给正文的手机消息').click();assert((await p.locator('.story-preview').textContent()).includes('待同步：0 条'));
  await p.evaluate(async()=>{await profileMock.emit('GENERATION_AFTER_COMMANDS','normal');await profileMock.switch('0','other-save');});assert.equal(await p.evaluate(key=>!!profileMock.prompts[key],key),false);
  await p.evaluate(async()=>{const ext=await import('/index.js');ext.onDisable();ext.onEnable();ext.onEnable();});const listenerCount=await p.evaluate(()=>profileMock.listeners());assert(listenerCount>0);await p.evaluate(async()=>{await profileMock.emit('GENERATION_AFTER_COMMANDS','normal');(await import('/index.js')).onDisable();});assert.equal(await p.evaluate(()=>profileMock.listeners()),0);assert.equal(await p.evaluate(key=>!!profileMock.prompts[key],key),false);assert.equal(await p.evaluate(()=>profileMock.prompts.other.value),'保留其他扩展');assert.deepEqual(errors,[]);console.log(`PASS ${tt?'TT':'ST'} worldbook import and selected-only prompt, story settings, front prompt, hidden inclusion, NPC opt-out, persisted supplement, clock, active swipe guard, persistence and lifecycle`);await context.close();
 }
}finally{await browser.close();server.close();}




