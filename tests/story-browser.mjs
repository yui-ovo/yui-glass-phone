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
    for(const name of ['GENERATION_AFTER_COMMANDS','GENERATION_STARTED','GENERATION_ENDED','GENERATION_STOPPED','MESSAGE_SWIPED','MESSAGE_EDITED','MESSAGE_DELETED'])ctx.eventTypes[name]=name;
    ctx.extensionPrompts=m.prompts;ctx.setExtensionPrompt=(key,value,position,depth,scan,role,filter)=>{m.prompts[key]={value,position,depth,scan,role,filter};};
    Object.defineProperty(ctx,'chat',{get(){m.storyReads++;return m.story;}});return ctx;
   };
  });
  await p.route('https://story-ai.fixture/**',async r=>{if(r.request().method()==='OPTIONS'){await r.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type'}});return;}requests.push(r.request().postDataJSON());if(delay)await new Promise(resolve=>release=resolve);await r.fulfill({json:{choices:[{message:{content:'手机回复测试'},finish_reason:'stop'}]}}).catch(()=>{});});
  await p.goto(base+'/preview.html');await b(p,'打开设置').click();await b(p,'独立 API 设置').click();await p.getByLabel('API 地址',{exact:true}).fill('https://story-ai.fixture/v1');await p.getByLabel('模型名称',{exact:true}).fill('fixture');
  await p.getByText('前置提示词（选填）',{exact:true}).click();await p.getByLabel('前置提示词',{exact:true}).fill('前置风格测试');await p.getByText('聊天风格提示词',{exact:true}).click();await p.getByLabel('提示词内容',{exact:true}).fill('使用短句');await b(p,'保存 API 设置').click();
  for(const name of ['男主','NPC']){
   await home(p);await b(p,'打开消息').click();await b(p,'联系人').click();await b(p,'登记人物').click();await b(p,'手动创建人物').click();await p.getByLabel('人物名字',{exact:true}).fill(name);await p.getByLabel('开局关系',{exact:true}).selectOption('friend');
   await p.getByText('剧情衔接',{exact:true}).click();assert(!(await p.getByLabel('参考当前酒馆剧情',{exact:true}).isChecked()));assert(!(await p.getByLabel('将此人的手机聊天提供给正文',{exact:true}).isChecked()));
   if(name==='男主'){await p.getByLabel('参考当前酒馆剧情',{exact:true}).check();await p.getByLabel('最近可见正文消息条数',{exact:true}).fill('2');await p.getByLabel('将此人的手机聊天提供给正文',{exact:true}).check();await p.getByLabel('提供给正文的手机消息条数',{exact:true}).fill('2');await b(p,'预览正文参考').click();assert((await p.locator('.story-preview').textContent()).includes('酒吧见面'));assert(!(await p.locator('.story-preview').textContent()).includes('隐藏的秘密'));assert.equal(await p.locator('.story-preview img').count(),0);await p.screenshot({path:path.join(root,`test-results/story-settings-${tt?'tt':'st'}.png`)});}
   await b(p,'保存人物').click();await wait(async()=> (await p.locator('.profile-status').textContent()).includes('已保存到当前存档'),'save person');await b(p,'取消').click();
  }
  await chat(p,'男主');await p.getByLabel('消息输入框',{exact:true}).fill('我约好了酒吧见');await b(p,'发送').click();await wait(()=>b(p,'让对方回复').isEnabled(),'sent');await p.waitForTimeout(850);await b(p,'让对方回复').click();await wait(()=>requests.length===1,'reply');await wait(()=>p.getByText('手机回复测试',{exact:true}).count(),'reply saved');
  assert.equal(requests[0].messages[0].content,'前置风格测试');assert.equal(requests[0].messages[1].content,'使用短句');const serialized=JSON.stringify(requests[0]);assert(serialized.includes('酒吧见面'));assert(!serialized.includes('隐藏的秘密'));assert(!serialized.includes('不该读取的备选'));assert(!serialized.includes('旧剧情'));
  await chat(p,'NPC');const reads=await p.evaluate(()=>profileMock.storyReads);await p.getByLabel('消息输入框',{exact:true}).fill('NPC独立聊天');await b(p,'发送').click();await wait(()=>b(p,'让对方回复').isEnabled(),'npc sent');await p.waitForTimeout(850);await b(p,'让对方回复').click();await wait(()=>requests.length===2,'npc request');await wait(()=>p.getByText('手机回复测试',{exact:true}).count(),'npc response');assert.equal(await p.evaluate(()=>profileMock.storyReads),reads);assert(!JSON.stringify(requests[1]).includes('酒吧见面'));
  const key='yui-glass-phone.story-reference.v1',before=await p.evaluate(()=>JSON.stringify(profileMock.story));
  await p.evaluate(async()=>{await profileMock.emit('GENERATION_STARTED','normal');await profileMock.emit('GENERATION_AFTER_COMMANDS','normal',{},false);});
  let injected=await p.evaluate(async key=>{const prompt=profileMock.prompts[key];return {...prompt,allowed:await prompt.filter()};},key);
  assert(injected.allowed);assert(injected.value.includes('我约好了酒吧见'));assert(!injected.value.includes('NPC独立聊天'));assert.equal(injected.scan,false);assert.equal(injected.depth,0);assert.equal(await p.evaluate(()=>JSON.stringify(profileMock.story)),before);
  await p.evaluate(()=>profileMock.emit('GENERATION_ENDED'));assert.equal(await p.evaluate(key=>!!profileMock.prompts[key],key),false);
  // Same archive active swipe changes during phone request: late reply is not saved.
  await chat(p,'男主');delay=true;await b(p,'让对方回复').click();await wait(()=>!!release,'delayed request');await p.evaluate(()=>{profileMock.story[1].mes='改成另一段剧情';profileMock.story[1].swipe_id=0;});delay=false;release();await wait(()=>b(p,'灵动岛：查看回复提示').count(),'context changed');await b(p,'灵动岛：查看回复提示').click();assert((await p.locator('.toast').textContent()).includes('已变化'));assert.equal(await p.getByText('手机回复测试',{exact:true}).count(),1);
  await p.reload();await b(p,'打开消息').click();await b(p,'打开聊天：男主').click();await b(p,'聊天资料').click();await p.getByText('剧情衔接',{exact:true}).click();assert(await p.getByLabel('参考当前酒馆剧情',{exact:true}).isChecked());assert.equal(await p.getByLabel('最近可见正文消息条数',{exact:true}).inputValue(),'2');await b(p,'预览分享给正文的手机消息').click();assert((await p.locator('.story-preview').textContent()).includes('我约好了酒吧见'));
  await p.evaluate(async()=>{await profileMock.emit('GENERATION_AFTER_COMMANDS','normal');await profileMock.switch('0','other-save');});assert.equal(await p.evaluate(key=>!!profileMock.prompts[key],key),false);
  await p.evaluate(async()=>{const ext=await import('/index.js');ext.onDisable();ext.onEnable();ext.onEnable();});const listenerCount=await p.evaluate(()=>profileMock.listeners());assert(listenerCount>0);await p.evaluate(async()=>{await profileMock.emit('GENERATION_AFTER_COMMANDS','normal');(await import('/index.js')).onDisable();});assert.equal(await p.evaluate(()=>profileMock.listeners()),0);assert.equal(await p.evaluate(key=>!!profileMock.prompts[key],key),false);assert.equal(await p.evaluate(()=>profileMock.prompts.other.value),'保留其他扩展');assert.deepEqual(errors,[]);console.log(`PASS ${tt?'TT':'ST'} story settings, front prompt, hidden exclusion, NPC opt-out, injection, active swipe guard, persistence and lifecycle`);await context.close();
 }
}finally{await browser.close();server.close();}



