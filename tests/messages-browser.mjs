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
  const context = await browser.newContext({ viewport: { width: 393, height: 740 } });
  const page = await context.newPage();
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
  for (const tt of [false,true]) {
    const p=await start(tt); await open(p);await add(p,'好友甲');await save(p);await b(p,'取消').click();await add(p,'好友乙');await save(p);await b(p,'取消').click();
    const before=(await books(p,tt))[0];await backContacts(p);await b(p,'打开聊天：好友甲').click();
    assert.equal(await textBox(p).getAttribute('type'),null);
    await textBox(p).fill('中文');await textBox(p).press('Enter');await textBox(p).press('End');await textBox(p).type('emoji🙂');
    assert((await textBox(p).inputValue()).includes('\n'));assert.equal((await histories(p,tt)).length,0);
    await textBox(p).dispatchEvent('compositionstart');assert(await b(p,'发送').isDisabled());await textBox(p).dispatchEvent('compositionend');
    const content='你好\n多行 🌙🙂\n<img src=x onerror=alert(1)> /send 不执行';
    await sendText(p,content);assert.equal(await bubbles(p).last().textContent(),content);assert.equal(await p.locator('.real-messages img[src=x]').count(),0);
    assert.equal(await p.locator('.sp-message-sender-cv2').textContent(),'我');
    await b(p,'返回').click();await b(p,'消息').click();assert((await p.locator('.message-summary').first().textContent()).includes('你好 多行'));assert.equal(await p.locator('.unread').count(),0);
    await b(p,'打开聊天：好友乙').click();assert.equal(await bubbles(p).count(),0);await sendText(p,'相同文字');await sendText(p,'相同文字');assert.equal(await bubbles(p).count(),2);
    await b(p,'返回').click();await b(p,'消息').click();assert.equal(await p.locator('.contact-row').first().getAttribute('aria-label'),'打开聊天：好友乙');
    await b(p,'打开聊天：好友甲').click();await textBox(p).fill('甲未发草稿');await b(p,'返回').click();await b(p,'打开聊天：好友乙').click();assert.equal(await textBox(p).inputValue(),'');
    await textBox(p).fill('乙未发草稿');await b(p,'收起手机').click();await b(p,'打开灰玻璃小手机').click();assert.equal(await textBox(p).inputValue(),'乙未发草稿');await textBox(p).fill('');
    await b(p,'返回').click();await b(p,'打开聊天：好友甲').click();assert.equal(await textBox(p).inputValue(),'甲未发草稿');await textBox(p).fill('');
    await b(p,'聊天资料').click();await p.getByLabel('手机备注',{exact:true}).fill('甲备注');await b(p,'恢复默认头像').click();await save(p);await b(p,'取消').click();assert.equal(await bubbles(p).count(),1);
    await sendText(p,'资料修改后发送');const profile=tt ? Object.values(await storage(p,true)).find(v=>v.people) : (await books(p))[0];
    assert.equal(profile.people[0].remark,'甲备注');assert.equal(profile.id,before.id);assert.equal(profile.self.account,before.self.account);
    await p.reload();await open(p);await b(p,'打开聊天：甲备注').click();assert.equal(await bubbles(p).count(),2);
    await textBox(p).fill('字'.repeat(10001));assert(await b(p,'发送').isDisabled());assert((await p.locator('.message-feedback').textContent()).includes('10000'));await textBox(p).fill('  \n ');assert(await b(p,'发送').isDisabled());await textBox(p).fill('');
    await sendText(p,'长'.repeat(10000));assert.equal((await bubbles(p).last().textContent()).length,10000);
    await p.evaluate(()=>profileMock.switch('0','chat-B','integrity-A'));await until(()=>b(p,'登记人物').count(),'B');await add(p,'B人物','friend',false);await save(p);await b(p,'取消').click();await backContacts(p);await b(p,'打开聊天：B人物').click();assert.equal(await bubbles(p).count(),0);await sendText(p,'B独有');
    await p.evaluate(()=>profileMock.switch('1','chat-A','integrity-A'));await until(()=>b(p,'登记人物').count(),'other card');assert.equal(await p.locator('.contact-row').count(),0);
    await p.evaluate(()=>profileMock.switch('0','chat-A','integrity-A'));await until(()=>b(p,'登记人物').count(),'A');await backContacts(p);await b(p,'打开聊天：甲备注').click();assert.equal(await bubbles(p).count(),3);
    const stable=await histories(p,tt);await b(p,'返回手机桌面').click();await b(p,'打开设置').click();await b(p,'独立样式演示').click();await p.locator('[data-chat=rain]').click();await b(p,'发送消息（预览）').click();assert.deepEqual(await histories(p,tt),stable);
    assert.deepEqual(p.errors,[]);await p.close();passed.push(`${tt?'TT':'ST'}: text/newline/IME/emoji/HTML, persistence, summaries/order, two friends, three archive scopes, profile preservation, drafts, length, demo isolation`);
  }
  const p=await start(true);await open(p);await add(p,'异步好友');await save(p);await b(p,'取消').click();await add(p,'另一好友');await save(p);await b(p,'取消').click();await backContacts(p);await b(p,'打开聊天：异步好友').click();
  await p.evaluate(()=>{ttMock.waitMessage=true;delete ttMock.releasewaitMessage;});await textBox(p).fill('点击两次');await b(p,'发送').evaluate(node=>{node.click();node.click();});await p.waitForFunction(()=>ttMock.releasewaitMessage);await textBox(p).fill('随后输入');
  await p.evaluate(()=>{ttMock.waitMessage=false;ttMock.releasewaitMessage();});await until(async()=>!(await p.locator('.pending-message').count()),'confirmed');assert.equal(await textBox(p).inputValue(),'随后输入');assert.equal((await histories(p,true))[0].messages.length,1);
  await p.evaluate(()=>ttMock.messageFailAfterWrite=true);await b(p,'发送').click();await until(()=>b(p,'核对并重试').count(),'unknown outcome');const messageId=await p.locator('.pending-message').getAttribute('data-message-id');const writes=await p.evaluate(()=>ttMock.calls.filter(c=>c.key.startsWith('messages-')).length);
  await b(p,'核对并重试').click();await until(async()=> (await textBox(p).inputValue())==='', 'retry confirmed');assert.equal(await p.evaluate(()=>ttMock.calls.filter(c=>c.key.startsWith('messages-')).length),writes);assert.equal((await histories(p,true))[0].messages.at(-1).messageId,messageId);
  await p.evaluate(()=>{ttMock.waitMessage=true;delete ttMock.releasewaitMessage;});await textBox(p).fill('迟到旧会话');await b(p,'发送').click();await p.waitForFunction(()=>ttMock.releasewaitMessage);await b(p,'返回').click();await b(p,'打开聊天：另一好友').click();await textBox(p).fill('新会话草稿');await p.evaluate(()=>{ttMock.waitMessage=false;ttMock.releasewaitMessage();});await p.waitForTimeout(50);assert.equal(await textBox(p).inputValue(),'新会话草稿');assert.equal(await bubbles(p).count(),0);
  await textBox(p).fill('');await b(p,'返回').click();await b(p,'打开聊天：异步好友').click();await p.evaluate(()=>{ttMock.waitMessage=true;delete ttMock.releasewaitMessage;});await textBox(p).fill('原存档在途');await b(p,'发送').click();await p.waitForFunction(()=>ttMock.releasewaitMessage);
  await p.evaluate(()=>profileMock.switch('0','B'));await until(()=>b(p,'登记人物').count(),'switch writing');await p.evaluate(()=>{ttMock.waitMessage=false;ttMock.releasewaitMessage();});await p.waitForTimeout(50);assert.equal(await p.locator('.contact-row').count(),0);
  assert((await histories(p,true))[0].messages.some(m=>m.text==='原存档在途'));assert.deepEqual(p.errors,[]);await p.close();passed.push('TT: double click, later typing retained, unknown confirmation ID retry, contact/archive switch during write');
  const f=await start();await open(f);await add(f,'失败好友');await save(f);await b(f,'取消').click();await backContacts(f);await b(f,'打开聊天：失败好友').click();
  await f.evaluate(()=>{window.realSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('yui-glass-phone.messages'))throw Error('quota');return realSet.call(this,k,v);};});
  await textBox(f).fill('保留原文');await b(f,'发送').click();await until(()=>b(f,'核对并重试').count(),'failed');const failedId=await f.locator('.pending-message').getAttribute('data-message-id');assert.equal(await textBox(f).inputValue(),'保留原文');assert.equal((await histories(f,false)).length,0);
  await f.evaluate(()=>Storage.prototype.setItem=realSet);await b(f,'核对并重试').click();await until(async()=> (await textBox(f).inputValue())==='', 'retry');assert.equal((await histories(f,false))[0].messages[0].messageId,failedId);
  await f.screenshot({path:path.join(root,'test-results/text-message.png')});
  await textBox(f).fill('保护草稿');
  assert(await f.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;}));
  await b(f,'返回').click();assert(await f.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;}));
  await b(f,'打开聊天：失败好友').click();await textBox(f).fill('');
  const other=await f.context().newPage();other.setDefaultTimeout(5000);
  await other.addInitScript({content:await readFile(path.join(root,'tests/profile-mock.js'),'utf8')});await other.route('**/api/users/me',r=>r.fulfill({json:{handle:'test-user'}}));await other.route('**/thumbnail?**',r=>r.fulfill({contentType:'image/png',body:png}));
  await other.goto(base+'/preview.html');await open(other);await b(other,'打开聊天：失败好友').click();
  await sendText(f,'先写入的新消息');await textBox(other).fill('过时窗口的消息');await b(other,'发送').click();await until(()=>b(other,'核对并重试').count(),'stale window conflict');
  assert.equal((await histories(f,false))[0].messages.length,2);assert((await other.locator('.message-pending-status').textContent()).includes('其他窗口'));
  const retryId=await other.locator('.pending-message').getAttribute('data-message-id');await b(other,'重新读取消息').click();await until(async()=> (await bubbles(other).count())===3,'read current records');await b(other,'核对并重试').click();await until(async()=> (await textBox(other).inputValue())==='','rebased retry');
  assert.equal((await histories(f,false))[0].messages.length,3);assert.equal((await histories(f,false))[0].messages.at(-1).messageId,retryId);await other.close();
  assert.deepEqual(f.errors,[]);await f.close();passed.push('ST: quota failure keeps text/ID, draft refresh protection, stale second window conflicts and explicit reread/retry');
  console.log(passed.map(x=>'PASS '+x).join('\n'));
} finally { await browser.close();await new Promise(resolve=>server.close(resolve)); }
