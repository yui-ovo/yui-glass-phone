import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const server = createServer(async (req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://test').pathname);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try { const body = await readFile(file); res.setHeader('Content-Type', ({ '.js':'text/javascript', '.html':'text/html', '.css':'text/css', '.json':'application/json' })[path.extname(file)] || 'text/plain'); res.end(body); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=', 'base64');
const passed = [];
async function until(check, label) { const end = Date.now() + 6000; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 30)); } throw Error(`Timed out: ${label}`); }
const b = (page, name) => page.getByRole('button', { name, exact: true });
async function start(tt = false, suffix = '') {
  const page = await browser.newPage({ viewport: { width: 393, height: 740 } });
  page.setDefaultTimeout(5000); const errors = []; page.on('pageerror', e => errors.push(e.message)); page.errors = errors;
  await page.addInitScript({ content: await readFile(path.join(root, 'tests/profile-mock.js'), 'utf8') });
  if (tt) await page.addInitScript({ content: await readFile(path.join(root, 'tests/tt-mock.js'), 'utf8') });
  else await page.route('**/api/users/me', async route => route.fulfill({ json: { handle: await page.evaluate(() => profileMock.account) } }));
  await page.route('**/thumbnail?**', route => route.fulfill({ contentType: 'image/png', body: png }));
  await page.goto(base + '/preview.html' + suffix);
  return page;
}
async function open(page) { await b(page, '打开消息').click(); await b(page, '联系人').click(); await until(() => b(page, '登记人物').count(), 'contacts loaded'); }
async function add(page, name, relation = 'friend', card = true) {
  await b(page, '登记人物').click(); await b(page, card ? '从当前角色卡带入' : '手动创建人物').click();
  if(card && await b(page,'登记这张卡里的另一位人物').count()) await b(page,'登记这张卡里的另一位人物').click();
  if (card) assert.equal(await page.getByLabel('人物名字', { exact: true }).inputValue(), '花店故事标题');
  await page.getByLabel('人物名字', { exact: true }).fill(name); await page.getByLabel('开局关系', { exact: true }).selectOption(relation);
}
async function openChat(page,name) { const contact=b(page,`查看联系人：${name}`); if(await contact.count()){await contact.click();await b(page,'发消息').click();} else await b(page,`打开聊天：${name}`).click(); }
async function save(page) { await b(page, '保存人物').click(); await until(async () => (await page.locator('.profile-status').textContent()).includes('已保存到当前存档'), 'save'); }
async function storage(page, tt = false) { return page.evaluate(tt => JSON.parse(localStorage.getItem(tt ? 'fixture.tt.store' : 'yui-glass-phone.contacts.v1:test-user') || 'null'), tt); }
async function books(page, tt = false) { const data = await storage(page, tt); return tt ? Object.values(data || {}) : Object.values(data?.books || {}); }
try {
  for(const tt of [false,true]) {
    const p=await start(tt);await open(p);await add(p,'关系人物','stranger');
    await p.getByLabel('线上人设（如有）',{exact:true}).fill('线上话少，喜欢用表情。');await save(p);
    const first=(await books(p,tt))[0].people[0];
    await p.getByLabel('开局关系',{exact:true}).selectOption('friend');await save(p);await save(p);
    let data=(await books(p,tt))[0];assert.equal(data.people.length,1);assert.equal(data.people[0].id,first.id);assert.equal(data.people[0].account,first.account);assert.deepEqual(data.people[0].source,first.source);
    await b(p,'取消').click();await b(p,'编辑关系人物').click();await p.getByLabel('开局关系',{exact:true}).selectOption('known');await save(p);await b(p,'取消').click();
    await b(p,'登记人物').click();await b(p,'从当前角色卡带入').click();
    assert(await p.getByRole('heading',{name:'此角色卡已有登记'}).isVisible());assert.equal(await p.getByLabel('人物名字',{exact:true}).count(),0);
    data=(await books(p,tt))[0];assert.equal(data.people.length,1);
    await b(p,'编辑关系人物').click();assert.equal(await p.getByLabel('线上人设（如有）',{exact:true}).inputValue(),first.description);
    await p.getByLabel('开局关系',{exact:true}).selectOption('friend');await save(p);await p.reload();await open(p);await b(p,'管理剧情人物').click();
    data=(await books(p,tt))[0];assert.equal(data.people.length,1);assert.equal(data.people[0].id,first.id);assert.equal(data.people[0].account,first.account);assert.equal(data.people[0].description,first.description);assert.deepEqual(data.people[0].source,first.source);
    // An explicit second character on the same card is legal, even with the same name.
    await b(p,'登记人物').click();await b(p,'从当前角色卡带入').click();await b(p,'登记这张卡里的另一位人物').click();await p.getByLabel('人物名字',{exact:true}).fill('关系人物');await save(p);
    data=(await books(p,tt))[0];assert.equal(data.people.length,2);assert.notEqual(data.people[0].id,data.people[1].id);
    assert.deepEqual(p.errors,[]);await p.close();passed.push(`${tt?'TT':'ST'}: repeat relationship edits preserve identity/count/persona; repeated card import selects existing; explicit same-name second character remains independent`);
  }
  for (const tt of [false, true]) {
    const p=await start(tt);await b(p,'收起手机').click();
    const launcher=b(p,'打开灰玻璃小手机');
    assert.equal((await launcher.textContent()).trim(),'');
    assert.equal(Math.round((await launcher.boundingBox()).width),44);
    const cdp=await p.context().newCDPSession(p);
    let r=await launcher.boundingBox();
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+22,y:r.y+22}]});
    await p.waitForTimeout(400);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:170,y:310}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    assert(await launcher.isVisible());assert.equal(await p.locator('.overlay').isVisible(),false);
    r=await launcher.boundingBox();assert(Math.abs(r.x-148)<2);assert(Math.abs(r.y-288)<2);
    const moved=await p.evaluate(()=>localStorage.getItem('yui-glass-phone.launcher.v1'));
    await p.reload();await b(p,'收起手机').click();
    r=await launcher.boundingBox();assert(Math.abs(r.x-148)<2);assert.equal(await p.evaluate(()=>localStorage.getItem('yui-glass-phone.launcher.v1')),moved);
    // Dock on either side; the visible half remains clickable and draggable.
    for (const side of ['left','right']) {
      r=await launcher.boundingBox();const startX=Math.max(4,Math.min((tt?375:393)-4,r.x+22));
      await p.mouse.move(startX,r.y+22);await p.mouse.down();await p.mouse.move(side==='left'?1:392,400,{steps:5});await p.mouse.up();
      assert.equal(await launcher.getAttribute('data-dock'),side);assert.equal(await p.locator('.overlay').isVisible(),false);
      r=await launcher.boundingBox();assert(side==='left'?r.x<0:r.x+r.width>(tt?375:393));
    }
    r=await launcher.boundingBox();await p.mouse.click((tt?375:393)-8,r.y+22);assert(await p.locator('.overlay').isVisible());await b(p,'收起手机').click();
    await p.setViewportSize({width:320,height:568});
    if(tt)await p.evaluate(()=>ttMock.emitLayout({version:1,safeFrame:{left:0,top:20,width:320,height:500},ime:{keyboardOffset:0}}));
    await until(async()=>Math.round((await launcher.boundingBox()).x)===298,'launcher viewport resize');
    r=await launcher.boundingBox();assert.equal(Math.round(r.x),298);assert(r.y>=0&&r.y+r.height<=568);
    // Cancelling a drag restores its prior position and does not persist a partial move.
    const before=await p.evaluate(()=>localStorage.getItem('yui-glass-phone.launcher.v1'));
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:310,y:r.y+22}]});await p.waitForTimeout(400);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:160,y:220}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
    assert.equal(await p.evaluate(()=>localStorage.getItem('yui-glass-phone.launcher.v1')),before);
    assert.equal(await launcher.getAttribute('data-dragging'),null);
    await p.evaluate(async()=>{const m=await import('/index.js');m.onDisable();m.onEnable();});
    await until(()=>b(p,'收起手机').count(),'re-enabled');await b(p,'收起手机').click();assert.equal(await launcher.count(),1);
    assert.deepEqual(p.errors,[]);await cdp.detach();await p.close();
    passed.push(`${tt?'TT':'ST'} launcher: touch hold/drag, icon only, position restore, both edge docks, visible-half click, resize, cancel and disable/re-enable`);
  }
  for (const tt of [false, true]) {
    const page = await start(tt), label = tt ? 'TT' : 'ST';
    await page.evaluate(() => localStorage.setItem('yui-pocket.contacts.v1:test-user', '{"old":"untouched"}'));
    await open(page);
    if (!tt) { await mkdir(path.join(root, 'test-results'), {recursive:true}); await page.screenshot({path:path.join(root,'test-results/v041-contacts.png')}); }
    assert.equal(await b(page, '管理剧情人物').count(), 1);
    await b(page, '消息').click(); assert.equal(await b(page, '管理剧情人物').count(), 0); assert.equal(await b(page, '登记人物').count(), 0);
    if (!tt) await page.screenshot({path:path.join(root,'test-results/v041-messages.png')});
    await b(page, '我').click(); assert.equal(await b(page, '人物管理').count(), 0);
    for (const label of ['钱包', '收藏', '相册', '设置']) assert(await b(page, label).isVisible());
    if (!tt) await page.screenshot({path:path.join(root,'test-results/v041-me.png')});
    const beforeMenus = await storage(page, tt);
    await b(page, '钱包').click(); assert.equal(await page.locator('.toast').textContent(), '钱包功能待接入');
    assert.deepEqual(await storage(page, tt), beforeMenus);
    await page.locator('.me-page').getByRole('button', {name:'朋友圈',exact:true}).click(); assert.equal(await page.locator('.toolbar h1').textContent(), '朋友圈');
    await b(page, '联系人').click(); await b(page, '管理剧情人物').click(); await b(page, '返回').click(); assert.equal(await page.locator('.toolbar h1').textContent(), '联系人');
    assert.equal(await page.locator('.directory-view').getByText('林间').count(), 0);
    await add(page, '<img src=x onerror=alert(1)>'); await page.getByLabel('手机备注', { exact: true }).fill('阿棠'); await save(page);
    const original = (await books(page, tt))[0], id = original.people[0].id;
    await b(page, '取消').click(); await b(page, '登记人物').click(); await b(page, '手动创建人物').click();
    await page.getByLabel('人物名字', { exact: true }).fill('陌生人'); await save(page); await b(page, '取消').click();
    assert.equal(await page.locator('.directory-scroll').getByText('尚不认识', { exact: true }).count(), 1);
    await b(page, '返回手机桌面').click(); await open(page); await b(page, '联系人').click();
    assert.equal(await page.locator('.contact-row').count(), 1);
    await openChat(page,'阿棠'); assert.equal(await page.locator('.directory-empty').textContent(), '暂无消息'); assert(await b(page, '发送').isDisabled());
    await b(page, '聊天资料').click(); assert.equal(await page.getByLabel('人物名字', { exact: true }).inputValue(), '<img src=x onerror=alert(1)>');
    assert.equal(await page.locator('.directory-view img[src="x"]').count(), 0);
    await page.getByLabel('手机备注', { exact: true }).fill('老板'); await save(page);
    const modified = (await books(page, tt))[0].people[0];
    for (const field of ['id', 'account', 'source', 'relation']) assert.deepEqual(modified[field], original.people[0][field]);
    await b(page, '取消').click();
    await page.reload(); await open(page); await openChat(page,'老板'); await b(page, '聊天资料').click();
    assert.equal(await page.getByLabel('手机备注', { exact: true }).inputValue(), '老板');
    await page.getByLabel('手机备注', { exact: true }).fill('不保存'); await b(page, '收起手机').click(); await b(page, '打开灰玻璃小手机').click();
    assert.equal(await page.getByLabel('手机备注', { exact: true }).inputValue(), '不保存'); await b(page, '取消').click();
    assert.equal((await books(page, tt))[0].people[0].remark, '老板');
    await page.evaluate(() => profileMock.switch('0', 'chat-B', 'integrity-A')); await until(() => b(page, '登记人物').count(), 'switch B');
    assert.equal(await page.locator('.contact-row').count(), 0); await add(page, '只属于B', 'friend', false); await save(page); await b(page, '取消').click();
    await page.evaluate(() => profileMock.switch('1', 'chat-A', 'integrity-A')); await until(() => b(page, '登记人物').count(), 'switch card'); assert.equal(await page.locator('.contact-row').count(), 0);
    await page.evaluate(() => profileMock.switch('0', 'chat-A', 'integrity-A')); await until(async () => (await page.locator('.contact-row').count()) === 2, 'return A');
    assert.equal((await books(page, tt)).flatMap(x => x.people).filter(p => p.id === id).length, 1);
    assert.equal(await page.evaluate(() => localStorage.getItem('yui-pocket.contacts.v1:test-user')), '{"old":"untouched"}');
    await page.evaluate(() => profileMock.switch('0', null)); await until(async () => (await page.locator('.directory-empty').textContent()).includes('请先打开有效聊天'), 'no chat');
    assert.equal(await b(page, '登记人物').count(), 0);
    await page.evaluate(async () => { const ext = await import('/index.js'); ext.onDisable(); ext.onEnable(); ext.onEnable(); });
    await until(() => page.locator('#yui-glass-phone').count(), 'reenable'); assert.equal(await page.locator('#yui-glass-phone').count(), 1);
    await page.evaluate(async () => (await import('/index.js')).onDisable());
    assert.equal(await page.evaluate(() => profileMock.listeners()), 0);
    if (tt) { await until(async () => (await page.evaluate(() => ttMock.subscriptions())) === 0, 'TT cleanup'); }
    assert.deepEqual(page.errors, []); await page.close(); passed.push(`${label}: create/edit/refresh, names safe, friend filter, fixed identity, draft/cancel, 3 scopes, old data untouched, no chat, lifecycle`);
  }
  const page = await start(); await open(page); await add(page, '保存失败草稿');
  await page.evaluate(() => { window.originalSet = Storage.prototype.setItem; Storage.prototype.setItem = function(k,v) { if (k.startsWith('yui-glass-phone.contacts')) throw Error('quota'); return originalSet.call(this,k,v); }; });
  await b(page, '保存人物').click(); await until(async () => (await page.locator('.profile-status').textContent()).includes('草稿'), 'failure');
  assert.equal(await page.getByLabel('人物名字', { exact:true }).inputValue(), '保存失败草稿'); assert.equal(await storage(page), null);
  await page.evaluate(() => { Storage.prototype.setItem = originalSet; }); await save(page); await save(page); assert.equal((await books(page))[0].people.length, 1);
  await b(page, '取消').click(); await b(page, '返回手机桌面').click(); await b(page, '打开设置').click(); await b(page, '独立样式演示').click();
  assert.equal(await page.locator('.conversation').count(), 3); await b(page, '返回手机桌面').click(); await b(page, '打开设置').click(); await b(page, '退出样式演示').click(); await open(page);
  assert.equal(await page.locator('.conversation').count(), 0); assert.equal((await books(page))[0].people.length, 1);
  await b(page, '联系人').click(); await mkdir(path.join(root, 'test-results'), {recursive:true}); await page.screenshot({path:path.join(root,'test-results/contacts.png')});
  await openChat(page,'保存失败草稿'); await b(page, '聊天资料').click(); await page.screenshot({path:path.join(root,'test-results/profile.png')});
  assert.deepEqual(page.errors, []); await page.close(); passed.push('ST: quota failure keeps draft, retry is idempotent, explicit demo isolation, screenshots');
  // Real editor round trips preserve worldbook data, self identity and avatars.
  const avatarPage = await start(); await open(avatarPage); await add(avatarPage, '头像人物');
  await avatarPage.getByLabel('上传头像', {exact:true}).setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:png});
  await until(async()=> (await avatarPage.locator('.profile-status').textContent()).includes('头像已预览'), 'upload'); await save(avatarPage);
  assert.equal((await books(avatarPage))[0].people[0].avatar.kind, 'upload');
  await avatarPage.route('https://avatar.test/good.png',r=>r.fulfill({contentType:'image/png',body:png}));
  await avatarPage.route('https://avatar.test/bad.png',r=>r.abort());
  await avatarPage.getByLabel('头像图片 URL',{exact:true}).fill('https://avatar.test/good.png'); await b(avatarPage,'加载此头像 URL').click();
  await until(async()=> (await avatarPage.locator('.profile-status').textContent()).includes('头像已预览'), 'url'); await save(avatarPage);
  await avatarPage.getByLabel('头像图片 URL',{exact:true}).fill('https://avatar.test/bad.png'); await b(avatarPage,'加载此头像 URL').click();
  await until(async()=> (await avatarPage.locator('.profile-status').textContent()).includes('图片加载失败'), 'bad url'); await save(avatarPage);
  assert.equal((await books(avatarPage))[0].people[0].avatar.value,'https://avatar.test/good.png');
  await b(avatarPage,'取消').click();
  const materials=[{world:'设定',uid:'1',title:'<img src=x>',content:'<script>仅文字</script>',fingerprint:'sha256:'+'a'.repeat(64),confirmedAt:'2026-10-04T00:00:00Z'}];
  await avatarPage.evaluate(materials=>{const key='yui-glass-phone.contacts.v1:test-user';const registry=JSON.parse(localStorage.getItem(key));Object.values(registry.books)[0].people[0].roleplayMaterials=materials;localStorage.setItem(key,JSON.stringify(registry));},materials);
  await avatarPage.reload();await open(avatarPage);await openChat(avatarPage,'头像人物');await b(avatarPage,'聊天资料').click();await avatarPage.getByLabel('手机备注',{exact:true}).fill('保留资料');await save(avatarPage);
  assert.deepEqual((await books(avatarPage))[0].people[0].roleplayMaterials,materials);
  await b(avatarPage,'取消').click();await b(avatarPage,'返回手机桌面').click();await open(avatarPage);await b(avatarPage,'我').click();await b(avatarPage,'我的名片').click();
  const selfAccount=(await books(avatarPage))[0].self.account; await avatarPage.getByLabel('我的名字',{exact:true}).fill('玩家名字');await b(avatarPage,'保存我的名片').click();await until(async()=> (await avatarPage.locator('.profile-status').textContent()).includes('已保存'), 'self');
  assert.equal((await books(avatarPage))[0].self.account,selfAccount);await b(avatarPage,'取消').click();await avatarPage.reload();await open(avatarPage);await b(avatarPage,'我').click();await b(avatarPage,'我的名片').click();assert.equal(await avatarPage.getByLabel('我的名字',{exact:true}).inputValue(),'玩家名字');
  await b(avatarPage,'取消').click();await b(avatarPage,'联系人').click();await b(avatarPage,'管理剧情人物').click();await b(avatarPage,'编辑保留资料').click();
  await avatarPage.evaluate(()=>{const decode=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=function(){return decode.call(this).then(()=>new Promise(resolve=>window.releaseImage=resolve));};});
  await avatarPage.getByLabel('上传头像',{exact:true}).setInputFiles({name:'delay.png',mimeType:'image/png',buffer:png});await avatarPage.waitForFunction(()=>window.releaseImage);
  await avatarPage.evaluate(()=>profileMock.switch('0','B'));await until(()=>b(avatarPage,'登记人物').count(),'image switch');await avatarPage.evaluate(()=>releaseImage());assert.equal((await books(avatarPage))[0].people[0].avatar.kind,'url');assert.equal(await avatarPage.locator('.contact-row').count(),0);
  assert.deepEqual(avatarPage.errors,[]);await avatarPage.close();passed.push('ST: upload/URL/failure, worldbook round trip, self card fixed account, delayed image switch');
  // TT write already dispatched remains bound to A; stale UI cannot appear in B.
  const native = await start(true);await open(native);await add(native,'原存档人物');await native.evaluate(()=>ttMock.waitWrite=true);await b(native,'保存人物').click();await native.waitForFunction(()=>ttMock.releasewaitWrite);
  await native.evaluate(()=>profileMock.switch('0','B'));await until(()=>b(native,'登记人物').count(),'native switch');await native.evaluate(()=>{ttMock.waitWrite=false;ttMock.releasewaitWrite();});
  await until(async()=> (await books(native,true)).length===1,'native completion');assert.equal(await native.locator('.contact-row').count(),0);assert.equal(await native.evaluate(()=>ttMock.calls[0].ref.fileName),'chat-A');
  await add(native,'读取延迟', 'friend',false);await native.evaluate(()=>ttMock.waitRead=true);await b(native,'保存人物').click();await native.waitForFunction(()=>ttMock.releasewaitRead);
  await native.evaluate(()=>{ttMock.waitRead=false;profileMock.switch('1','C');});await native.evaluate(()=>ttMock.releasewaitRead());await until(()=>b(native,'登记人物').count(),'native delayed read switch');assert.equal(await native.evaluate(()=>ttMock.calls.length),1);
  await add(native,'失败保留','friend',false);await native.evaluate(()=>ttMock.fail=true);await b(native,'保存人物').click();await until(async()=> (await native.locator('.profile-status').textContent()).includes('草稿'),'TT failure');assert.equal(await native.getByLabel('人物名字',{exact:true}).inputValue(),'失败保留');
  await native.evaluate(()=>ttMock.fail=false);await save(native);await b(native,'取消').click();
  await native.setViewportSize({width:320,height:568});await native.evaluate(()=>ttMock.emitLayout({version:1,safeFrame:{left:0,top:0,width:320,height:568},ime:{keyboardOffset:220}}));await b(native,'编辑失败保留').click();await b(native,'保存人物').scrollIntoViewIfNeeded();
  const bounds=await b(native,'保存人物').boundingBox();assert(bounds.y+bounds.height<=348);assert.deepEqual(native.errors,[]);await native.close();passed.push('TT: captured write, delayed read switch, native failure/retry, keyboard frame at 320px');
  const readiness=await start(true,'?delay');assert.equal(await readiness.locator('#yui-glass-phone').count(),0);await readiness.evaluate(async()=>{(await import('/index.js')).onDisable();ttMock.ready();});await readiness.waitForTimeout(50);assert.equal(await readiness.locator('#yui-glass-phone').count(),0);
  await readiness.evaluate(async()=>{ttMock.waitUnsubscribe=true;(await import('/index.js')).onEnable();});await until(()=>readiness.locator('#yui-glass-phone').count(),'ready');await readiness.waitForFunction(()=>ttMock.releasewaitUnsubscribe);await readiness.evaluate(async()=>{(await import('/index.js')).onDisable();ttMock.releasewaitUnsubscribe();});await until(async()=> (await readiness.evaluate(()=>ttMock.subscriptions()))===0,'late cleanup');await readiness.close();passed.push('TT: disable before ready and delayed subscription cleanup');
  console.log(passed.map(x=>'PASS '+x).join('\n'));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
