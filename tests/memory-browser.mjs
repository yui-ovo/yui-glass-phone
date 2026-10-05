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
const wait=async(fn,label)=>{for(let i=0;i<240;i++){if(await fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('Timeout '+label);};
async function chat(p,name){await b(p,'返回手机桌面').click();await b(p,'打开消息').click();await b(p,'打开聊天：'+name).click();}
try{
 for(const tt of [false,true]){
  const context=await browser.newContext({viewport:{width:393,height:740}}),p=await context.newPage();p.setDefaultTimeout(7000);
  const errors=[],requests=[];let delay=false,release;p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript({content:await readFile(path.join(root,'tests/profile-mock.js'),'utf8')});
  if(tt)await p.addInitScript({content:await readFile(path.join(root,'tests/tt-mock.js'),'utf8')});else await p.route('**/api/users/me',r=>r.fulfill({json:{handle:'test-user'}}));
  await p.addInitScript(()=>{
   const f=window.memoryMock={calls:0,status:'ready',empty:false,recall:'记忆唯一标记：约好明天去海边 <img src=x onerror=alert(1)>',id:'memory-A'};
   const identity=()=>({hostChatId:profileMock.chat,qqjChatId:f.id,characterLocator:'story.png',personaLocator:'persona-A'});
   window.qqj_v3_public_bridge_v1={schemaVersion:1,kind:'qqj-public-memory-bridge',
    getStatus(){f.calls++;return {status:f.status,identity:identity()};},
    getPromptSnapshot(){f.calls++;return {status:f.empty?'empty':'ready',scope:'latest-prepared',identity:identity(),recall:{text:f.recall},prequel:{text:'前情：在书店相识'}};},
    getSnapshot(){f.calls++;return {status:'ready',identity:identity(),memory:{floors:[{summary:'不要发送整库'}]},people:{status:'ready',items:[{entityId:'person-one',displayName:'同名人物',profile:{personality:'人物一温和',apiKey:'不要发送此字段'}},{entityId:'person-two',displayName:'同名人物',profile:{personality:'人物二的秘密'}}]},cse:{ready:false,currentSubjects:[{subjectEntityId:'person-one',displayName:'同名人物',core:[{text:'还没告诉对方的心愿',visibility:'private',reason:'未说出口'}],adaptive:[],situational:[{text:'犹豫',visibility:'authorial'}]}]}};},
    readMemory(){throw Error('禁止读取完整后台记忆');}
   };
  });
  await p.route('https://memory-ai.fixture/**',async r=>{if(r.request().method()==='OPTIONS'){await r.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type'}});return;}requests.push(r.request().postDataJSON());if(delay)await new Promise(resolve=>release=resolve);await r.fulfill({json:{choices:[{message:{content:'已参考记忆回复'},finish_reason:'stop'}]}}).catch(()=>{});});
  await p.goto(base+'/preview.html');await b(p,'打开设置').click();await b(p,'独立 API 设置').click();await p.getByLabel('API 地址',{exact:true}).fill('https://memory-ai.fixture/v1');await p.getByLabel('模型名称',{exact:true}).fill('fixture');await b(p,'保存 API 设置').click();
  let preview;
  for(const name of ['男主','NPC']){
   await b(p,'返回手机桌面').click();await b(p,'打开消息').click();await b(p,'联系人').click();await b(p,'登记人物').click();await b(p,'手动创建人物').click();await p.getByLabel('人物名字',{exact:true}).fill(name);await p.getByLabel('开局关系',{exact:true}).selectOption('friend');
   assert.equal(await p.locator('.memory-settings').getAttribute('open'),null);
   if(name==='男主'){
    await p.getByText('记忆 · 千千结',{exact:true}).click();assert(!(await p.getByLabel('参考千千结记忆',{exact:true}).isChecked()));await p.getByLabel('参考千千结记忆',{exact:true}).check();await b(p,'刷新人物').click();await p.getByLabel('关联千千结人物',{exact:true}).selectOption('person-one');await p.getByLabel('人物档案',{exact:true}).check();await p.getByLabel('人物状态',{exact:true}).check();await b(p,'预览本次记忆').click();preview=await p.locator('.memory-text').textContent();assert(preview.includes('仅此人物本人知情'));assert(!preview.includes('人物二的秘密'));assert.equal(await p.locator('.memory-preview img').count(),0);assert.equal(requests.length,0);
    await p.getByText('记忆 · 千千结',{exact:true}).scrollIntoViewIfNeeded();await p.screenshot({path:path.join(root,`test-results/memory-${tt?'tt':'st'}.png`)});
    const toggleSize=await p.locator('.memory-toggle').first().evaluate(el=>({font:parseFloat(getComputedStyle(el).fontSize),height:el.getBoundingClientRect().height}));assert(toggleSize.font<=12);assert(toggleSize.height<=40);
   }
   await b(p,'保存人物').click();await wait(async()=> (await p.locator('.profile-status').textContent()).includes('已保存到当前存档'),'save');await b(p,'取消').click();
  }
  // Only binding/preferences are persisted, never the external memory or other person's data.
  assert(!(await p.evaluate(()=>JSON.stringify(localStorage))).includes('记忆唯一标记'));
  await chat(p,'男主');await b(p,'让对方回复').click();await wait(()=>p.getByText('已参考记忆回复',{exact:true}).count(),'reply');
  const material=requests[0].messages.find(m=>m.content.startsWith('以下 JSON'));
  const actual=JSON.parse(material.content.slice(material.content.indexOf('\n')+1));assert.equal(actual.memory.text,preview);assert(!JSON.stringify(requests[0]).includes('不要发送'));
  await chat(p,'NPC');const calls=await p.evaluate(()=>memoryMock.calls);await b(p,'让对方回复').click();await wait(()=>p.getByText('已参考记忆回复',{exact:true}).count(),'NPC reply');assert.equal(await p.evaluate(()=>memoryMock.calls),calls);assert(!JSON.stringify(requests[1]).includes('记忆唯一标记'));
  // Enabling memory never silently falls back when material is absent.
  await chat(p,'男主');await p.evaluate(()=>memoryMock.empty=true);await b(p,'让对方回复').click();await wait(()=>b(p,'灵动岛：查看回复提示').count(),'empty');assert.equal(requests.length,2);await b(p,'灵动岛：查看回复提示').click();assert((await p.locator('.toast').textContent()).includes('暂无'));await p.evaluate(()=>memoryMock.empty=false);
  // Memory changing while awaiting AI invalidates the reply.
  delay=true;await b(p,'让对方回复').click();await wait(()=>!!release,'delayed');await p.evaluate(()=>memoryMock.recall='剧情已经修改');delay=false;release();await wait(()=>b(p,'灵动岛：查看回复提示').count(),'stale');assert.equal(await p.getByText('已参考记忆回复',{exact:true}).count(),1);
  await p.reload();await b(p,'打开消息').click();await b(p,'打开聊天：男主').click();await b(p,'聊天资料').click();await p.getByText('记忆 · 千千结',{exact:true}).click();assert(await p.getByLabel('参考千千结记忆',{exact:true}).isChecked());assert.equal(await p.getByLabel('关联千千结人物',{exact:true}).inputValue(),'person-one');await b(p,'刷新人物').click();
  await p.setViewportSize({width:320,height:540});if(tt)await p.evaluate(()=>ttMock.emitLayout({...ttMock.layout,safeFrame:{left:0,top:0,width:320,height:540}}));
  const overflow=await p.locator('.memory-settings').evaluate(el=>el.scrollWidth>el.clientWidth+2);assert(!overflow);
  // A copied phone archive must be explicitly rebound to a different plugin archive.
  await p.evaluate(()=>memoryMock.id='memory-B');await b(p,'预览本次记忆').click();assert((await p.locator('.memory-preview').textContent()).includes('另一份'));await b(p,'关联当前存档').click();assert.equal(await p.getByLabel('关联千千结人物',{exact:true}).inputValue(),'');
  await b(p,'保存人物').click();assert((await p.locator('.profile-status').textContent()).includes('对应人物'));
  await p.getByLabel('参考千千结记忆',{exact:true}).uncheck();await b(p,'保存人物').click();await wait(async()=> (await p.locator('.profile-status').textContent()).includes('已保存到当前存档'),'save disabled');
  assert.deepEqual(errors,[]);console.log(`PASS ${tt?'TT':'ST'} memory UI: opt-in, explicit binding, preview=request, persistence without memory copies, NPC off, empty/stale guards, rebind, 320px layout`);await context.close();
 }
}finally{await browser.close();server.close();}
