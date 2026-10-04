import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const engines = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const engine = engines[process.env.BROWSER_ENGINE || 'chromium'];
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(path.join(root,'test-results'),{recursive:true});
const server = createServer(async (req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://test').pathname);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try { const body = await readFile(file); res.setHeader('Content-Type', ({ '.js':'text/javascript', '.html':'text/html', '.css':'text/css', '.json':'application/json' })[path.extname(file)] || 'text/plain'); res.end(body); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await engine.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
console.log(`Browser: ${process.env.BROWSER_ENGINE || 'chromium'} ${browser.version()}`);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=', 'base64');
const passed = [];
async function until(check, label) { const end = Date.now() + 6000; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 30)); } throw Error(`Timed out: ${label}`); }
const b = (page, name) => page.getByRole('button', { name, exact: true });
async function start(tt = false, suffix = '') {
  const context = await browser.newContext({ viewport: { width: 393, height: 740 } });
  const page = await context.newPage();
  page.setDefaultTimeout(5000); const errors = []; page.on('pageerror', e => errors.push(e.message)); page.errors = errors;
  await page.addInitScript({ content: await readFile(path.join(root, 'tests/profile-mock.js'), 'utf8') });
  if (tt) await page.addInitScript({ content: await readFile(path.join(root, 'tests/tt-mock.js'), 'utf8') });
  else await page.route('**/api/users/me', async route => route.fulfill({ json: { handle: await page.evaluate(() => profileMock.account) } }));
  await page.route('**/thumbnail?**', route => route.fulfill({ contentType: 'image/png', body: png }));
  // Optional regression control: reproduce the pre-0.5.3 percentage/flex layout
  // on WebKit 17.4 without checking out or loading old production modules.
  if (process.env.LEGACY_LAYOUT) await page.route('**/style.css?*', async route => route.fulfill({contentType:'text/css',body:await readFile(path.join(root,'style.css'),'utf8')+'\n.presentation{height:auto;max-height:100%}.sp-phone-wrap-cv2{height:550px;max-height:none;flex:0 1 auto}.sp-phone-screen-cv2{position:relative;inset:auto;width:100%;height:100%}:host([data-short-frame]) .presentation{max-height:100%}'}));
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
async function save(page) { await b(page, '保存人物').click(); await until(async () => (await page.locator('.profile-status').textContent()).includes('已保存到当前存档'), 'save'); }
async function storage(page, tt = false) { return page.evaluate(tt => JSON.parse(localStorage.getItem(tt ? 'fixture.tt.store' : 'yui-glass-phone.contacts.v1:test-user') || 'null'), tt); }
async function books(page, tt = false) { const data = await storage(page, tt); return tt ? Object.values(data || {}) : Object.values(data?.books || {}); }
try {
  async function histories(page, tt) {
    return page.evaluate(tt => tt ? Object.values(JSON.parse(localStorage.getItem('fixture.tt.store')||'{}')).filter(v=>v.messages)
      : Object.keys(localStorage).filter(k=>k.startsWith('yui-glass-phone.messages.v1:')).map(k=>JSON.parse(localStorage.getItem(k))), tt);
  }
  const textBox = page => page.getByLabel('消息输入框', {exact:true});
  const bubbles = page => page.locator('.real-messages .sp-message-bubble-cv2');
  async function sendText(page, text) { await textBox(page).fill(text); await b(page,'发送').click(); await until(async()=> (await textBox(page).inputValue())==='', 'message saved'); }
  async function backContacts(page) { await b(page,'返回手机桌面').click();await open(page); }
  async function chat(page,name) {
    if(await b(page,`查看联系人：${name}`).count()) await b(page,'消息').click();
    await b(page,`打开聊天：${name}`).click();
  }
  for(const tt of [false,true]) {
    const p=await start(tt);await open(p);await add(p,'名片人物');await save(p);await b(p,'取消').click();await backContacts(p);
    await b(p,'查看联系人：名片人物').click();assert.equal(await textBox(p).count(),0);
    assert.equal(await p.locator('.person-name').textContent(),'名片人物');
    if(!tt)await p.screenshot({path:path.join(root,'test-results/contact-card.png')});
    assert.equal(await b(p,'朋友资料').count(),0);assert.equal(await b(p,'联系人资料设置').count(),0);
    await b(p,'返回').click();await b(p,'联系人更多').click();await b(p,'管理剧情人物').click();await b(p,'编辑名片人物').click();
    await p.getByLabel('手机备注',{exact:true}).fill('备注人物');await save(p);await b(p,'取消').click();await backContacts(p);await b(p,'查看联系人：备注人物').click();
    assert.equal(await p.locator('.person-name').textContent(),'备注人物');assert.equal(await textBox(p).count(),0);
    await b(p,'朋友圈').click();assert((await p.locator('.toast').textContent()).includes('尚未接入'));
    await b(p,'音视频通话').click();assert((await p.locator('.toast').textContent()).includes('尚未接入'));
    await b(p,'发消息').click();await sendText(p,'删除恢复后保留的消息');await textBox(p).fill('未发送草稿');
    await b(p,'返回').click();assert.equal(await p.locator('.person-name').textContent(),'备注人物');
    await b(p,'返回').click();await b(p,'联系人更多').click();await b(p,'管理剧情人物').click();await b(p,'编辑备注人物').click();await b(p,'删除人物').click();await b(p,'确认删除').click();
    assert((await p.locator('.profile-status').textContent()).includes('未发送草稿'));await b(p,'取消').click();await backContacts(p);await chat(p,'备注人物');assert.equal(await textBox(p).inputValue(),'未发送草稿');await textBox(p).fill('');
    await b(p,'聊天资料').click();await b(p,'删除人物').click();
    const original=tt ? Object.values(await storage(p,true)).find(v=>v.people) : (await books(p))[0], history=await histories(p,tt);
    await b(p,'取消').click();assert.deepEqual(tt ? Object.values(await storage(p,true)).find(v=>v.people) : (await books(p))[0],original);
    await b(p,'编辑备注人物').click();await b(p,'删除人物').click();
    if(tt)await p.evaluate(()=>ttMock.fail=true);
    else await p.evaluate(()=>{window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('yui-glass-phone.contacts'))throw Error('full');return originalSet.call(this,k,v);};});
    await b(p,'确认删除').click();await until(async()=> (await p.locator('.profile-status').textContent()).includes('核对'),'deletion failure');
    assert.deepEqual(tt ? Object.values(await storage(p,true)).find(v=>v.people) : (await books(p))[0],original);
    if(tt)await p.evaluate(()=>ttMock.fail=false);else await p.evaluate(()=>Storage.prototype.setItem=originalSet);
    await b(p,'确认删除').click();await until(()=>b(p,'人物管理更多').count(),'deleted');
    assert.equal(await b(p,'已删除人物').count(),0);assert.equal(await p.locator('.directory-scroll .profile-action').count(),0);
    const more=await b(p,'人物管理更多').boundingBox(),plus=await b(p,'登记人物').boundingBox();assert(more.x+more.width<=plus.x);
    assert.equal(await p.locator('.contact-row').count(),0);assert.deepEqual(await histories(p,tt),history);
    await p.reload();await open(p);assert.equal(await p.locator('.contact-row').count(),0);await b(p,'消息').click();assert.equal(await p.locator('.contact-row').count(),0);
    await b(p,'联系人').click();await b(p,'联系人更多').click();await b(p,'管理剧情人物').click();await b(p,'人物管理更多').click();await b(p,'已删除人物').click();await b(p,'恢复人物：备注人物').click();await b(p,'确认恢复').click();await until(()=>p.getByText('暂无已删除人物',{exact:true}).count(),'restored');
    const restored=tt ? Object.values(await storage(p,true)).find(v=>v.people) : (await books(p))[0];assert.deepEqual(restored.people,original.people);assert.deepEqual(await histories(p,tt),history);
    await backContacts(p);await chat(p,'备注人物');assert.equal(await bubbles(p).textContent(),'删除恢复后保留的消息');
    if(tt) {
      await b(p,'聊天资料').click();await b(p,'删除人物').click();
      await p.evaluate(()=>{ttMock.waitWrite=true;delete ttMock.releasewaitWrite;});await b(p,'确认删除').click();await p.waitForFunction(()=>ttMock.releasewaitWrite);
      await p.evaluate(()=>profileMock.switch('0','delete-other-chat'));await until(()=>b(p,'登记人物').count(),'switch deleting');
      await p.evaluate(()=>{ttMock.waitWrite=false;ttMock.releasewaitWrite();});await p.waitForTimeout(50);assert.equal(await p.locator('.contact-row').count(),0);
      await p.evaluate(()=>profileMock.switch('0','chat-A','integrity-A'));await until(()=>b(p,'登记人物').count(),'return deleted archive');
      const stored=Object.values(await storage(p,true)).find(v=>v.people?.some(x=>x.id===original.people[0].id));assert(stored.people[0].deletedAt);assert.deepEqual(await histories(p,true),history);
    }
    assert.deepEqual(p.errors,[]);await p.close();passed.push(`${tt?'TT':'ST'}: contact card/edit/back/chat, placeholder actions, deletion cancel/failure/draft guard, refresh hiding, restore identity/history, captured TT deletion`);
  }
  for (const tt of [false,true]) {
    const p=await start(tt); await open(p);await add(p,'好友甲');await save(p);await b(p,'取消').click();await add(p,'好友乙');await save(p);await b(p,'取消').click();
    const before=(await books(p,tt))[0];await backContacts(p);await chat(p,'好友甲');
    const composerBounds=await p.locator('.text-composer').boundingBox(), homeBounds=await b(p,'返回手机桌面').boundingBox();
    assert(homeBounds.y-composerBounds.y-composerBounds.height<=3,'composer is close to the home indicator');
    if (tt) {
      assert.equal(await textBox(p).getAttribute('placeholder'),'⟡小如思念送達中······ ♡⟡');
      assert.equal(Math.round((await p.locator('.text-composer').boundingBox()).height),34);
      await b(p,'添加附件').click();assert((await p.locator('.message-feedback').textContent()).includes('附件还未接入'));
      for (const frame of [
        {version:1,safeFrame:{left:0,top:80,width:393,height:300},ime:{keyboardOffset:0}},
        {version:1,safeFrame:{left:0,top:120,width:393,height:240},ime:{keyboardOffset:0}},
        {version:1,safeFrame:{left:0,top:0,width:320,height:568},ime:{keyboardOffset:220}},
      ]) {
        await textBox(p).focus();
        await p.evaluate(frame=>ttMock.emitLayout(frame),frame);
        await p.waitForTimeout(100);
        // Do not fill/click after resizing: those actions may scroll a clipped control
        // into view and hide the keyboard-open regression we are trying to detect.
        const geometry=await p.evaluate(()=>{const s=document.querySelector('#yui-glass-phone').shadowRoot;return Object.fromEntries(['.sp-phone-wrap-cv2','.sp-phone-screen-cv2','.toolbar','.text-composer','.home-bar'].map(k=>[k,s.querySelector(k).getBoundingClientRect().toJSON()]));});
        const shell=geometry['.sp-phone-wrap-cv2'], screen=geometry['.sp-phone-screen-cv2'];
        if(process.env.LEGACY_LAYOUT) { console.log('Legacy keyboard geometry:',JSON.stringify(geometry));await p.screenshot({path:path.join(root,'test-results/legacy-keyboard.png')}); }
        for(const selector of ['.sp-phone-screen-cv2','.toolbar','.text-composer','.home-bar']) {
          const r=geometry[selector];assert(r.top>=shell.top && r.bottom<=shell.bottom,`${selector} must fit the shell immediately after keyboard opens`);
        }
        assert(screen.height<=shell.height,'inner screen shrinks together with shell');
        for (const draft of ['键盘草稿🙂\n第二行\n第三行\n第四行\n第五行','字'.repeat(9500),'字'.repeat(10001)]) {
          await textBox(p).fill(draft);
          await p.waitForTimeout(100);
          const bounds=await p.locator('.page').boundingBox(), input=await textBox(p).boundingBox(), send=await b(p,'发送').boundingBox();
          assert(input.y>=bounds.y && input.y+input.height<=bounds.y+bounds.height, 'textarea stays inside phone with reduced native frame');
          assert(send.y+send.height<=bounds.y+bounds.height, 'send stays inside phone');
          assert(send.y+send.height<=frame.safeFrame.top+frame.safeFrame.height-frame.ime.keyboardOffset,'send stays above keyboard');
        }
        await textBox(p).fill('键盘草稿🙂');
        if (frame.safeFrame.height===300) await p.screenshot({path:path.join(root,'test-results/keyboard-frame.png')});
        await b(p,'收起手机').click();await b(p,'打开灰玻璃小手机').click();assert.equal(await textBox(p).inputValue(),'键盘草稿🙂');
      }
      await sendText(p,'键盘内可发送');assert.equal(await bubbles(p).count(),1);
      // Restore this fixture's empty history so the existing persistence assertions remain unchanged.
      await p.evaluate(()=>{const data=ttMock.data();for(const key of Object.keys(data))if(key.includes('/messages-v1-'))delete data[key];localStorage.setItem('fixture.tt.store',JSON.stringify(data));});
      await p.reload();await open(p);await chat(p,'好友甲');
      await p.evaluate(()=>ttMock.emitLayout({version:1,safeFrame:{left:0,top:24,width:375,height:620},ime:{keyboardOffset:0}}));
      passed.push('TT layout mock: reduced/panned iOS frame and Android keyboard inset keep multiline input/send visible; collapse retains draft; send works');
    }
    assert.equal(await textBox(p).getAttribute('type'),null);
    await textBox(p).fill('中文');await textBox(p).press('Enter');await textBox(p).press('End');await textBox(p).type('emoji🙂');
    assert((await textBox(p).inputValue()).includes('\n'));assert.equal((await histories(p,tt)).length,0);
    await textBox(p).dispatchEvent('compositionstart');assert(await b(p,'发送').isDisabled());await textBox(p).dispatchEvent('compositionend');
    const content='你好\n多行 🌙🙂\n<img src=x onerror=alert(1)> /send 不执行';
    await sendText(p,content);assert.equal(await bubbles(p).last().textContent(),content);assert.equal(await p.locator('.real-messages img[src=x]').count(),0);
    assert.equal(await p.locator('.sp-message-sender-cv2').count(),0);
    const avatarBounds=await p.locator('.real-messages .avatar').last().boundingBox(), bubbleBounds=await bubbles(p).last().boundingBox();
    assert.equal(Math.round(avatarBounds.width),34);assert(Math.abs(bubbleBounds.y-avatarBounds.y-4)<1,'bubble starts 4px below avatar');
    await b(p,'返回').click();await b(p,'消息').click();assert((await p.locator('.message-summary').first().textContent()).includes('你好 多行'));assert.equal(await p.locator('.unread').count(),0);
    await chat(p,'好友乙');assert.equal(await bubbles(p).count(),0);await sendText(p,'相同文字');await sendText(p,'相同文字');assert.equal(await bubbles(p).count(),2);
    await b(p,'返回').click();await b(p,'消息').click();assert.equal(await p.locator('.contact-row').first().getAttribute('aria-label'),'打开聊天：好友乙');
    await chat(p,'好友甲');await textBox(p).fill('甲未发草稿');await b(p,'返回').click();await chat(p,'好友乙');assert.equal(await textBox(p).inputValue(),'');
    await textBox(p).fill('乙未发草稿');await b(p,'收起手机').click();await b(p,'打开灰玻璃小手机').click();assert.equal(await textBox(p).inputValue(),'乙未发草稿');await textBox(p).fill('');
    await b(p,'返回').click();await chat(p,'好友甲');assert.equal(await textBox(p).inputValue(),'甲未发草稿');await textBox(p).fill('');
    await b(p,'聊天资料').click();await p.getByLabel('手机备注',{exact:true}).fill('甲备注');await b(p,'恢复默认头像').click();
    await p.getByLabel('开局关系',{exact:true}).selectOption('stranger');await save(p);
    await p.getByLabel('开局关系',{exact:true}).selectOption('friend');await save(p);await b(p,'取消').click();assert.equal(await bubbles(p).count(),1);
    await sendText(p,'资料修改后发送');const profile=tt ? Object.values(await storage(p,true)).find(v=>v.people) : (await books(p))[0];
    assert.equal(profile.people[0].remark,'甲备注');assert.equal(profile.id,before.id);assert.equal(profile.self.account,before.self.account);
    assert.equal(profile.people.length,2);assert.equal(profile.people[0].id,before.people[0].id);assert.equal(profile.people[0].account,before.people[0].account);
    await p.reload();await open(p);await chat(p,'甲备注');assert.equal(await bubbles(p).count(),2);
    await textBox(p).fill('字'.repeat(10001));assert(await b(p,'发送').isDisabled());assert((await p.locator('.message-feedback').textContent()).includes('10000'));await textBox(p).fill('  \n ');assert(await b(p,'发送').isDisabled());await textBox(p).fill('');
    await sendText(p,'长'.repeat(10000));assert.equal((await bubbles(p).last().textContent()).length,10000);
    await p.evaluate(()=>profileMock.switch('0','chat-B','integrity-A'));await until(()=>b(p,'登记人物').count(),'B');await add(p,'B人物','friend',false);await save(p);await b(p,'取消').click();await backContacts(p);await chat(p,'B人物');assert.equal(await bubbles(p).count(),0);await sendText(p,'B独有');
    await p.evaluate(()=>profileMock.switch('1','chat-A','integrity-A'));await until(()=>b(p,'登记人物').count(),'other card');assert.equal(await p.locator('.contact-row').count(),0);
    await p.evaluate(()=>profileMock.switch('0','chat-A','integrity-A'));await until(()=>b(p,'登记人物').count(),'A');await backContacts(p);await chat(p,'甲备注');assert.equal(await bubbles(p).count(),3);
    const stable=await histories(p,tt);await b(p,'返回手机桌面').click();await b(p,'打开设置').click();await b(p,'独立样式演示').click();await p.locator('[data-chat=rain]').click();await b(p,'发送消息（预览）').click();assert.deepEqual(await histories(p,tt),stable);
    assert.deepEqual(p.errors,[]);await p.close();passed.push(`${tt?'TT':'ST'}: text/newline/IME/emoji/HTML, persistence, summaries/order, two friends, three archive scopes, profile preservation, drafts, length, demo isolation`);
  }
  const p=await start(true);await open(p);await add(p,'异步好友');await save(p);await b(p,'取消').click();await add(p,'另一好友');await save(p);await b(p,'取消').click();await backContacts(p);await chat(p,'异步好友');
  await p.evaluate(()=>{ttMock.waitMessage=true;delete ttMock.releasewaitMessage;});await textBox(p).fill('点击两次');await b(p,'发送').evaluate(node=>{node.click();node.click();});await p.waitForFunction(()=>ttMock.releasewaitMessage);await textBox(p).fill('随后输入');
  await p.evaluate(()=>{ttMock.waitMessage=false;ttMock.releasewaitMessage();});await until(async()=>!(await p.locator('.pending-message').count()),'confirmed');assert.equal(await textBox(p).inputValue(),'随后输入');assert.equal((await histories(p,true))[0].messages.length,1);
  await p.evaluate(()=>ttMock.messageFailAfterWrite=true);await b(p,'发送').click();await until(()=>b(p,'核对并重试').count(),'unknown outcome');const messageId=await p.locator('.pending-message').getAttribute('data-message-id');const writes=await p.evaluate(()=>ttMock.calls.filter(c=>c.key.startsWith('messages-')).length);
  await b(p,'核对并重试').click();await until(async()=> (await textBox(p).inputValue())==='', 'retry confirmed');assert.equal(await p.evaluate(()=>ttMock.calls.filter(c=>c.key.startsWith('messages-')).length),writes);assert.equal((await histories(p,true))[0].messages.at(-1).messageId,messageId);
  await p.evaluate(()=>{ttMock.waitMessage=true;delete ttMock.releasewaitMessage;});await textBox(p).fill('迟到旧会话');await b(p,'发送').click();await p.waitForFunction(()=>ttMock.releasewaitMessage);await b(p,'返回').click();await chat(p,'另一好友');await textBox(p).fill('新会话草稿');await p.evaluate(()=>{ttMock.waitMessage=false;ttMock.releasewaitMessage();});await p.waitForTimeout(50);assert.equal(await textBox(p).inputValue(),'新会话草稿');assert.equal(await bubbles(p).count(),0);
  await textBox(p).fill('');await b(p,'返回').click();await chat(p,'异步好友');await p.evaluate(()=>{ttMock.waitMessage=true;delete ttMock.releasewaitMessage;});await textBox(p).fill('原存档在途');await b(p,'发送').click();await p.waitForFunction(()=>ttMock.releasewaitMessage);
  await p.evaluate(()=>profileMock.switch('0','B'));await until(()=>b(p,'登记人物').count(),'switch writing');await p.evaluate(()=>{ttMock.waitMessage=false;ttMock.releasewaitMessage();});await p.waitForTimeout(50);assert.equal(await p.locator('.contact-row').count(),0);
  assert((await histories(p,true))[0].messages.some(m=>m.text==='原存档在途'));assert.deepEqual(p.errors,[]);await p.close();passed.push('TT: double click, later typing retained, unknown confirmation ID retry, contact/archive switch during write');
  const f=await start();await open(f);await add(f,'失败好友');await save(f);await b(f,'取消').click();await backContacts(f);await chat(f,'失败好友');
  await f.evaluate(()=>{window.realSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('yui-glass-phone.messages'))throw Error('quota');return realSet.call(this,k,v);};});
  await textBox(f).fill('保留原文');await b(f,'发送').click();await until(()=>b(f,'核对并重试').count(),'failed');const failedId=await f.locator('.pending-message').getAttribute('data-message-id');assert.equal(await textBox(f).inputValue(),'保留原文');assert.equal((await histories(f,false)).length,0);
  await f.evaluate(()=>Storage.prototype.setItem=realSet);await b(f,'核对并重试').click();await until(async()=> (await textBox(f).inputValue())==='', 'retry');assert.equal((await histories(f,false))[0].messages[0].messageId,failedId);
  await f.screenshot({path:path.join(root,'test-results/text-message.png')});
  await textBox(f).fill('保护草稿');
  assert(await f.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;}));
  await b(f,'返回').click();assert(await f.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;}));
  await chat(f,'失败好友');await textBox(f).fill('');
  const other=await f.context().newPage();other.setDefaultTimeout(5000);
  await other.addInitScript({content:await readFile(path.join(root,'tests/profile-mock.js'),'utf8')});await other.route('**/api/users/me',r=>r.fulfill({json:{handle:'test-user'}}));await other.route('**/thumbnail?**',r=>r.fulfill({contentType:'image/png',body:png}));
  await other.goto(base+'/preview.html');await open(other);await chat(other,'失败好友');
  await sendText(f,'先写入的新消息');await textBox(other).fill('过时窗口的消息');await b(other,'发送').click();await until(()=>b(other,'核对并重试').count(),'stale window conflict');
  assert.equal((await histories(f,false))[0].messages.length,2);assert((await other.locator('.message-pending-status').textContent()).includes('其他窗口'));
  const retryId=await other.locator('.pending-message').getAttribute('data-message-id');await b(other,'重新读取消息').click();await until(async()=> (await bubbles(other).count())===3,'read current records');await b(other,'核对并重试').click();await until(async()=> (await textBox(other).inputValue())==='','rebased retry');
  assert.equal((await histories(f,false))[0].messages.length,3);assert.equal((await histories(f,false))[0].messages.at(-1).messageId,retryId);await other.close();
  assert.deepEqual(f.errors,[]);await f.close();passed.push('ST: quota failure keeps text/ID, draft refresh protection, stale second window conflicts and explicit reread/retry');
  console.log(passed.map(x=>'PASS '+x).join('\n'));
} finally { await browser.close();await new Promise(resolve=>server.close(resolve)); }
