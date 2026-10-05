import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const engines = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(path.join(root,'test-results'),{recursive:true});
const server=createServer(async(req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://test').pathname);
  if(!file.startsWith(root)){res.writeHead(403).end();return;}
  try{const body=await readFile(file);res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json'})[path.extname(file)]||'text/plain');res.end(body);}catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await engines[process.env.BROWSER_ENGINE||'chromium'].launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const b=(page,name)=>page.getByRole('button',{name,exact:true});
const input=page=>page.getByLabel('消息输入框',{exact:true});
const bubbles=page=>page.locator('.real-messages .sp-message-bubble-cv2');
const wait=async(check,label)=>{for(let i=0;i<160;i++){if(await check())return;await new Promise(r=>setTimeout(r,30));}throw Error('Timed out: '+label);};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=','base64');
async function histories(page,tt){return page.evaluate(tt=>tt?Object.values(JSON.parse(localStorage.getItem('fixture.tt.store')||'{}')).filter(v=>v.messages):Object.keys(localStorage).filter(k=>k.startsWith('yui-glass-phone.messages.v1:')).map(k=>JSON.parse(localStorage.getItem(k))),tt);}
async function home(page){await b(page,'返回手机桌面').click();}
async function openChat(page){await home(page);await b(page,'打开消息').click();await wait(()=>b(page,'打开聊天：小晴').count(),'list');await b(page,'打开聊天：小晴').click();}
try {
  for(const tt of [false,true]){
    const context=await browser.newContext({viewport:{width:393,height:740}}),page=await context.newPage();page.setDefaultTimeout(6000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript({content:await readFile(path.join(root,'tests/profile-mock.js'),'utf8')});
    if(tt)await page.addInitScript({content:await readFile(path.join(root,'tests/tt-mock.js'),'utf8')});
    else await page.route('**/api/users/me',route=>route.fulfill({json:{handle:'test-user'}}));
    await page.route('**/scripts/personas.js',route=>route.fulfill({contentType:'text/javascript',body:'export const user_avatar="test-user.png";'}));
    await page.route('**/scripts/world-info.js',route=>route.fulfill({contentType:'text/javascript',body:'export function getWorldInfoSettings(){return {world_info:{}};}'}));
    await page.route('**/thumbnail?**',route=>route.fulfill({contentType:'image/png',body:png}));
    const requests=[];let mode='normal',release;
    await page.route('https://ai.fixture.test/**',async route=>{
      const req=route.request();if(req.method()==='OPTIONS'){await route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,POST'}});return;}
      if(req.url().endsWith('/models')){await route.fulfill({json:{data:[{id:'fixture-chat'}]}});return;}
      requests.push(req.postDataJSON());
      if(mode==='delay')await new Promise(r=>release=r);
      await route.fulfill({json:{choices:[{message:{content:'你好🙂\n<img src=x onerror="alert(1)">'},finish_reason:'stop'}]}}).catch(()=>{});
    });
    await page.goto(base+'/preview.html');
    await page.evaluate(()=>{profileMock.cards['0'].data={name:'卡标题',description:'这是来源卡资料'};profileMock.worlds={'设定书':{entries:{1:{uid:1,comment:'线上习惯',content:'喜欢简短文字'},2:{uid:2,comment:'无关支线',content:'不得发出这段资料'}}}};});
    await b(page,'打开设置').click();await b(page,'独立 API 设置').click();
    await page.getByLabel('API 地址',{exact:true}).fill('https://ai.fixture.test/v1');await page.getByLabel('API 密钥',{exact:true}).fill('fixture-only-key');assert.equal(await page.getByLabel('API 密钥',{exact:true}).getAttribute('type'),'password');
    await b(page,'获取模型列表').click();await page.getByLabel('可用模型',{exact:true}).selectOption('fixture-chat');
    await b(page,'测试连接').click();await wait(async()=> (await page.locator('.profile-status').textContent()).includes('测试成功'),'test');assert.equal(requests.length,1);assert.equal(requests[0].messages.length,1);assert.equal(requests[0].messages[0].content,'请回复 OK');
    await b(page,'保存 API 设置').click();assert((await page.locator('.profile-status').textContent()).includes('已保存在本机'));
    if(!tt)await page.screenshot({path:path.join(root,'test-results/ai-settings.png')});
    await home(page);await b(page,'打开消息').click();await b(page,'联系人').click();await b(page,'登记人物').click();await b(page,'从当前角色卡带入').click();
    await page.getByLabel('人物名字',{exact:true}).fill('小晴');await page.getByLabel('线上人设（如有）',{exact:true}).fill('爱用表情');await page.getByLabel('开局关系',{exact:true}).selectOption('friend');
    await page.getByText('AI 回复参考 · 世界书',{exact:true}).click();await b(page,'添加其他世界书').click();await b(page,'添加这本世界书').click();
    const habit=page.getByLabel('参考：设定书 · 线上习惯',{exact:true}),branch=page.getByLabel('参考：设定书 · 无关支线',{exact:true});
    await habit.check();await wait(()=>habit.isEnabled(),'habit saved');await branch.check();await wait(()=>branch.isEnabled(),'branch saved');await branch.uncheck();
    await b(page,'保存人物').click();await wait(async()=> (await page.locator('.profile-status').textContent()).includes('已保存到当前存档'),'profile');
    if(!tt)await page.screenshot({path:path.join(root,'test-results/ai-materials.png')});
    await b(page,'取消').click();await home(page);await b(page,'打开消息').click();await b(page,'我').click();await b(page,'我的名片').click();
    await b(page,'带入当前酒馆人设的名字和头像').click();await wait(async()=> (await page.locator('.profile-status').textContent()).includes('头像已预览'),'persona avatar');assert.equal(await page.getByLabel('我的名字',{exact:true}).inputValue(),'测试用户人设');
    await b(page,'保存我的名片').click();await wait(async()=> (await page.locator('.profile-status').textContent()).includes('已保存到当前存档'),'self');await b(page,'取消').click();await openChat(page);
    await input(page).fill('手机测试🙂\n第二行');await b(page,'发送').click();await wait(async()=>await input(page).inputValue()==='','manual');await b(page,'让对方回复').click();assert.equal(requests.length,1);
    await page.waitForTimeout(850);await b(page,'让对方回复').click();await wait(async()=>await bubbles(page).count()===2,'reply');
    const sent=JSON.stringify(requests.at(-1).messages);assert(sent.includes('这是来源卡资料'));assert(sent.includes('只读取当前选中的人设'));assert(sent.includes('爱用表情'));assert(sent.includes('喜欢简短文字'));assert(!sent.includes('不得发出这段资料'));assert(sent.includes('手机测试'));
    assert.equal(await page.locator('.sp-message-bubble-cv2 img').count(),0);assert.equal(await page.locator('.real-messages .sp-message-cv2:not(.self)').count(),1);
    await wait(async()=>!(await page.locator('.pending-message').count()),'confirmed reply');
    if(!tt)await page.screenshot({path:path.join(root,'test-results/ai-chat.png')});
    const original=await histories(page,tt);await b(page,'返回').click();assert((await b(page,'打开聊天：小晴').textContent()).includes('你好'));await b(page,'打开聊天：小晴').click();
    mode='delay';await b(page,'让对方回复').click();await wait(()=>requests.length===3,'delayed API');await input(page).fill('后来输入的草稿');release();await wait(async()=>!(await b(page,'停止回复').count()),'completed');assert.equal(await input(page).inputValue(),'后来输入的草稿');assert.equal(await bubbles(page).count(),3);await input(page).fill('');
    await b(page,'让对方回复').click();await wait(()=>requests.length===4,'cancel API');await b(page,'停止回复').click();release();await page.waitForTimeout(80);assert.equal(await bubbles(page).count(),3);
    mode='normal';if(tt)await page.evaluate(()=>ttMock.messageFailAfterWrite=true);else await page.evaluate(()=>{window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('yui-glass-phone.messages'))throw Error('full');return originalSet.call(this,k,v);};});
    await b(page,'让对方回复').click();await wait(()=>b(page,'核对并重试').count(),'save failure');const id=await page.locator('.pending-message').getAttribute('data-message-id'),calls=requests.length;
    if(tt)await page.evaluate(()=>ttMock.messageFailAfterWrite=false);else await page.evaluate(()=>Storage.prototype.setItem=originalSet);
    await b(page,'核对并重试').click();await wait(async()=>!(await b(page,'核对并重试').count()) && !(await page.locator('.pending-message').count()),'retry');assert.equal(requests.length,calls);assert.equal((await histories(page,tt))[0].messages.filter(m=>m.messageId===id).length,1);
    mode='delay';await b(page,'让对方回复').click();await wait(()=>requests.length===calls+1,'close pending');await b(page,'收起手机').click();release();await page.waitForTimeout(80);await b(page,'打开灰玻璃小手机').click();assert.equal(await bubbles(page).count(),4);
    await b(page,'让对方回复').click();await wait(()=>requests.length===calls+2,'switch pending');await page.evaluate(()=>profileMock.switch('0','another-chat'));release();await wait(()=>b(page,'登记人物').count(),'switch');assert.equal(await page.locator('.contact-row').count(),0);
    const stored=await histories(page,tt);assert.equal(stored[0].messages.length,4);assert.deepEqual(stored[0].messages.slice(0,2),original[0].messages);
    await page.reload();await b(page,'打开消息').click();await wait(()=>b(page,'打开聊天：小晴').count(),'reload');await b(page,'打开聊天：小晴').click();assert.equal(await bubbles(page).count(),4);
    assert.deepEqual(errors,[]);console.log(`PASS ${tt?'TT':'ST'} AI UI: config/models/test, active persona import, worldbook exclusion, plane modes/cooldown, escaped incoming reply, summary/refresh, later draft, cancel/close/switch, same-ID save retry without API repeat`);
    await context.close();
  }
} finally {await browser.close();server.close();}
