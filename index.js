// Visual prototype only. No chat/API access, storage or external assets.
const HOST_ID = 'yui-glass-phone';
const stylesheet = new URL('./style.css', import.meta.url).href;
const icons = {
  message: '<path d="M20 11.4a8 8 0 0 1-8 7.6 9.7 9.7 0 0 1-3.2-.6L4 20l1.3-4.3A7.3 7.3 0 0 1 4 11.4a8 8 0 0 1 16 0Z"/><path d="M8 11h.01M12 11h.01M16 11h.01"/>',
  thread: '<path d="M18.6 7.3C17.5 4.5 15.5 3 12.2 3 6.8 3 4 6.4 4 12s2.8 9 8.2 9c4.6 0 7.8-2.6 7.8-6.1 0-3.2-3.1-5.2-6.6-5.2-3.2 0-5.2 1.5-5.2 3.8 0 1.8 1.3 3 3.1 3 2.7 0 4-2.2 4-5.1 0-3.4-1.3-5-3.8-5-1.5 0-2.8.7-3.5 1.8"/>',
  settings: '<path d="m9 3-1 3-3 .5-2 3 2 2v1l-2 2 2 3 3 .5 1 3h6l1-3 3-.5 2-3-2-2v-1l2-2-2-3-3-.5-1-3Z"/><circle cx="12" cy="12" r="3.2"/>',
  back: '<path d="m14.5 5-7 7 7 7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  more: '<circle cx="5" cy="12" r=".7"/><circle cx="12" cy="12" r=".7"/><circle cx="19" cy="12" r=".7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  send: '<path d="m8 5 7 7-7 7"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4M10 19h4"/>',
  arrow: '<path d="m9 6 6 6-6 6"/>',
  moon: '<path d="M20 14a8 8 0 0 1-10-10A8.5 8.5 0 1 0 20 14Z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
  signal: '<path d="M4 19v-3M9 19v-7M14 19V8M19 19V4"/>',
  battery: '<rect x="2" y="6" width="18" height="12" rx="3"/><path d="M23 10v4M6 10v4M10 10v4M14 10v4"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.message}</svg>`;
const escape = (text) => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const people = {
  rain: {name:'林间', glyph:'林', tone:'sage'},
  evening: {name:'晚风', glyph:'晚', tone:'mauve'},
  group: {name:'一些小事', glyph:'✳', tone:'slate'},
  self: {name:'我', glyph:'月', tone:'pearl'},
};
const conversations = [
  {id:'rain', text:'路过花店，想起你说喜欢白色。', time:'17:42', unread:2, note:'置顶'},
  {id:'group', text:'晚风：周末一起去散步吧。', time:'17:26', unread:3, note:'群聊 · 3 人'},
  {id:'evening', text:'给你留了一小块今天的天空。', time:'昨天', unread:0, note:''},
];
function avatar(id, small = false) {
  const person = people[id] || people.rain;
  return `<span class="avatar ${person.tone} ${small ? 'small' : ''}" aria-hidden="true">${person.glyph}</span>`;
}

function mount() {
  if (document.getElementById(HOST_ID)) return;
  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({mode:'open'});
  // Minimal startup CSS prevents a flash of unstyled overlay while the sheet loads.
  shadow.innerHTML = `<style>:host{all:initial;position:fixed;inset:0;z-index:2147483000;pointer-events:none}.overlay[hidden]{display:none!important}.launcher{position:fixed;right:16px;bottom:110px;pointer-events:auto;border:1px solid #6d6d77;border-radius:18px;padding:12px;background:#35353c;color:#eee;font:12px sans-serif}.launcher svg{width:20px;height:20px}</style>
    <link rel="stylesheet" href="${stylesheet}">
    <button class="launcher" type="button" aria-label="打开灰玻璃小手机" title="灰玻璃小手机"><span>${icon('phone')}</span><span>小手机</span></button>
    <div class="overlay" hidden>
      <section class="presentation" role="dialog" aria-modal="true" aria-label="灰玻璃小手机 · 美化预览" tabindex="-1">
        <div class="outside-bar"><span>YUI <i>·</i> GLASS PHONE <em>美化预览</em></span><button class="close" type="button" aria-label="收起手机">${icon('close')}</button></div>
        <div class="sp-phone-wrap-cv2">
          <div class="sp-phone-screen-cv2">
            <div class="wallpaper"></div>
            <div class="status-bar"><span class="status-time">17:42</span><span class="status-icons">${icon('signal')}${icon('battery')}</span></div>
            <main class="page"></main>
            <button class="home-bar" type="button" aria-label="返回手机桌面"><span></span></button>
            <div class="toast" role="status" hidden></div>
          </div>
        </div>
        <p class="outside-note">⟡ 小如思念送達中 ······ ♡ ⟡</p>
      </section>
    </div>`;
  document.body.append(host);
  const $ = (selector) => shadow.querySelector(selector);
  const page = $('.page');
  const overlay = $('.overlay');
  const panel = $('.presentation');
  const launcher = $('.launcher');
  const screen = $('.sp-phone-screen-cv2');
  let current = 'home';
  let activeChat = 'rain';
  let lastFocus;
  let toastTimeout;
  let clockInterval;
  let wallpaper = 'graphite';
  const clock = () => {
    const now = new Date();
    const time = now.toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit',hour12:false});
    $('.status-time').textContent = time;
    if ($('.home-time')) $('.home-time').textContent = time;
    if ($('.home-date')) $('.home-date').textContent = now.toLocaleDateString('zh-CN', {month:'long', day:'numeric', weekday:'long'});
  };
  const resize = () => {
    const viewport = window.visualViewport;
    host.style.setProperty('--view-height', `${viewport?.height || window.innerHeight}px`);
    host.style.setProperty('--view-top', `${viewport?.offsetTop || 0}px`);
  };
  const toast = (text) => {
    clearTimeout(toastTimeout);
    $('.toast').textContent = text;
    $('.toast').hidden = false;
    toastTimeout = setTimeout(() => { $('.toast').hidden = true; }, 2500);
  };
  const toolbar = (title, subtitle = '', back = 'home', action = '') => `<header class="toolbar"><button type="button" data-go="${back}" class="icon-button" aria-label="${back === 'messages' ? '返回消息列表' : back === 'chat' ? '返回聊天' : '返回桌面'}">${icon('back')}</button><div class="toolbar-title"><h1>${title}</h1>${subtitle ? `<span>${subtitle}</span>` : ''}</div>${action || '<span class="toolbar-spacer"></span>'}</header>`;
  function home() {
    return `<section class="home-page"><div class="home-clock"><div class="home-date"></div><div class="home-time"></div><div class="home-caption"><span></span> 把日常，轻轻收好 <span></span></div></div>
      <div class="home-orbit" aria-hidden="true"><span>✦</span><i></i></div>
      <div class="desktop-apps">${[['messages','message','消息'],['thread','thread','Thread'],['settings','settings','设置']].map(([target,name,label]) => `<button type="button" class="app" data-go="${target}" aria-label="打开${label}"><span class="app-icon">${icon(name)}${target === 'messages' ? '<b class="app-dot"></b>' : ''}</span><span>${label}</span></button>`).join('')}</div>
      <div class="desktop-bottom"><span class="page-dot"></span><span></span></div></section>`;
  }
  function messages() {
    return `${toolbar('消息', 'MESSAGES')}<div class="list-page"><label class="search">${icon('search')}<input type="search" placeholder="搜索联系人" aria-label="搜索示例联系人" autocomplete="off"></label><div class="list-label"><span>最近聊天</span><span>03</span></div><div class="conversation-list">${conversations.map(c => `<button type="button" class="conversation" data-chat="${c.id}" data-name="${people[c.id].name}" aria-label="打开${people[c.id].name}${c.id === 'group' ? '群聊' : '聊天'}">${avatar(c.id)}<span class="conversation-content"><span class="conversation-top"><strong>${people[c.id].name}</strong><time>${c.time}</time></span><span class="conversation-preview">${c.text}</span><span class="conversation-meta">${c.note || ' '}</span></span>${c.unread ? `<span class="unread">${c.unread}</span>` : ''}</button>`).join('')}</div><p class="empty-search" hidden>没有找到这个联系人</p><p class="list-footnote">只展示示例消息 · 轻点进入聊天</p></div>`;
  }
  function bubble(sender, content, {self = false, kind = 'text'} = {}) {
    const person = self ? 'self' : sender;
    const side = self ? 'right' : 'left';
    let body;
    if (kind === 'voice') body = `<div class="sp-voice-bubble-cv2 ${side}"><div class="sp-voice-top-cv2"><span class="wave" aria-hidden="true">ı▏▎▏ı▎▏▎ı▏ı</span><span>08″</span></div><div class="sp-voice-divider-cv2"></div><div class="sp-voice-text-cv2">${content}</div></div>`;
    else if (kind === 'transfer') body = `<div class="sp-transfer-card-cv2 ${side}"><div class="sp-transfer-main-cv2"><div class="sp-transfer-line1-cv2"><span class="sp-transfer-icon-cv2">¥</span><div class="sp-transfer-text-group-cv2"><div class="sp-transfer-title-cv2">转账 ¥52.00</div><div class="sp-transfer-note-cv2">${content}</div></div></div></div><div class="sp-transfer-footer-cv2">转账 · 样式预览</div></div>`;
    else if (kind === 'media') body = `<div class="sp-media-card-cv2 ${side}"><span class="sp-media-badge-cv2">图片</span><div class="sp-media-caption-cv2">${icon('image')}<br>${content}</div></div>`;
    else body = `<div class="sp-message-bubble-cv2 ${self ? 'self' : ''}">${content}</div>`;
    return `<div class="sp-message-cv2 ${self ? 'self' : ''}">${!self ? avatar(person,true) : ''}<div class="sp-message-main-cv2 ${self ? 'self' : ''}"><div class="sp-message-sender-cv2 ${self ? 'self' : ''}">${people[person].name}</div><div class="sp-message-row-cv2 ${self ? 'self' : ''}">${body}</div></div>${self ? avatar('self',true) : ''}</div>`;
  }
  function chat(id) {
    const group = id === 'group';
    let content = '';
    if (group) {
      content = bubble('rain','这个群，就用来收藏一点日常吧。') + bubble('evening','那我先放一片今天的天空。',{kind:'media'}) + bubble('rain','还有周末的散步计划。') + bubble('self','好呀，慢慢把这里填满。',{self:true}) + '<div class="sp-system-row-cv2"><span class="sp-system-pill-cv2"><span class="sp-system-text-cv2">晚风将群名改为「一些小事」</span></span></div>';
    } else if (id === 'evening') {
      content = bubble(id,'给你留了一小块今天的天空。',{kind:'media'}) + bubble('self','收到了，是很温柔的颜色。',{self:true}) + bubble(id,'下次一起看吧。');
    } else {
      content = bubble(id,'路过花店，想起你说喜欢白色。') + bubble('self','所以，你带了一束回来？',{self:true}) + bubble(id,'嗯。等见面的时候给你。',{kind:'voice'}) + bubble(id,'给今天的一点小小快乐。',{kind:'transfer'}) + bubble('self','那我也有一件小事想告诉你。',{self:true});
    }
    return `${toolbar(people[id].name, group ? '3 位成员 · 示例群聊' : '示例聊天', 'messages', `<button type="button" class="icon-button" data-go="details" aria-label="聊天资料">${icon('more')}</button>`)}<div class="chat-scroll"><div class="sp-time-divider-cv2"><span class="sp-time-divider-text-cv2">今天 17:42</span></div>${content}</div><div class="composer"><button type="button" data-hint="附件功能以后再做，先看看现在的样子。" class="icon-button" aria-label="添加附件">${icon('plus')}</button><button type="button" class="composer-placeholder" data-hint="现在是美化预览，还不能发送消息。">小如思念送達中······ ♡</button><button type="button" data-hint="现在是美化预览，还不能发送消息。" class="send-button" aria-label="发送消息（预览）">${icon('send')}</button></div>`;
  }
  function thread() {
    return `${toolbar('Thread','A LITTLE SPACE')}<div class="placeholder-page"><div class="placeholder-icon">${icon('thread')}</div><h2>留一处空白</h2><p>想说的话，遇见的小事。<br>以后，慢慢放在这里。</p><span class="quiet-pill">待续</span></div>`;
  }
  function settings() {
    return `${toolbar('设置','MAKE IT YOURS')}<div class="settings-page"><section class="identity-card">${avatar('self')}<div><strong>我的小手机</strong><span>灰玻璃 · 第一版</span></div><span class="little-star">✦</span></section><h2 class="section-label">外观</h2><section class="settings-card"><div class="setting-line"><span>${icon('image')}桌面壁纸</span><small>${wallpaper === 'graphite' ? '深灰渐变' : '雾灰渐变'}</small></div><div class="swatches"><button type="button" class="swatch graphite" data-wallpaper="graphite" aria-label="深灰渐变" aria-pressed="${wallpaper === 'graphite'}"><span>深灰</span>${wallpaper === 'graphite' ? '<b>✓</b>' : ''}</button><button type="button" class="swatch mist" data-wallpaper="mist" aria-label="雾灰渐变" aria-pressed="${wallpaper === 'mist'}"><span>雾灰</span>${wallpaper === 'mist' ? '<b>✓</b>' : ''}</button></div></section><section class="settings-card settings-summary"><div class="setting-line"><span>${icon('phone')}手机外壳</span><small>原版磨砂</small></div><div class="setting-line"><span>${icon('moon')}配色</span><small>深灰玻璃</small></div></section><p class="settings-note">其余设置，以后慢慢补齐。<br>当前仅预览外观，壁纸选择不保存。</p><div class="version">YUI GLASS PHONE <span>0.1.0</span></div></div>`;
  }
  function details() {
    return `${toolbar('聊天资料','','chat')}<div class="detail-page">${avatar(activeChat)}<h2>${people[activeChat].name}</h2><p>${activeChat === 'group' ? '把大家的小日常，收在一起。' : '有些小事，只想和你分享。'}</p><span class="quiet-pill">示例${activeChat === 'group' ? '群聊 · 3 人' : '联系人'}</span><div class="detail-note">头像、备注与聊天背景<br>后续在这里设置</div></div>`;
  }
  function navigate(target, focus = true) {
    clearTimeout(toastTimeout);
    $('.toast').hidden = true;
    current = target;
    page.className = `page page-${target}`;
    screen.dataset.page = target;
    page.innerHTML = ({home, messages, chat:() => chat(activeChat), thread, settings, details}[target] || home)();
    clock();
    if (focus) {
      const title = page.querySelector('h1') || page.querySelector('button');
      if (title) { if (title.tagName === 'H1') title.tabIndex = -1; title.focus({preventScroll:true}); }
    }
  }
  function close() {
    overlay.hidden = true;
    launcher.hidden = false;
    clearInterval(clockInterval);
    clearTimeout(toastTimeout);
    window.visualViewport?.removeEventListener('resize', resize);
    window.visualViewport?.removeEventListener('scroll', resize);
    window.removeEventListener('resize', resize);
    (lastFocus?.isConnected ? lastFocus : launcher).focus({preventScroll:true});
  }
  function open() {
    lastFocus = document.activeElement;
    if (lastFocus === host) lastFocus = launcher;
    overlay.hidden = false;
    launcher.hidden = true;
    resize();
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize);
    window.addEventListener('resize', resize);
    navigate(current,false);
    panel.focus({preventScroll:true});
    clearInterval(clockInterval);
    clockInterval = setInterval(clock, 15000);
  }
  launcher.addEventListener('click', open);
  $('.close').addEventListener('click', close);
  $('.home-bar').addEventListener('click', () => navigate('home'));
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  page.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.go) navigate(button.dataset.go);
    if (button.dataset.chat) { activeChat = button.dataset.chat; navigate('chat'); }
    if (button.dataset.hint) toast(button.dataset.hint);
    if (button.dataset.wallpaper) {
      wallpaper = button.dataset.wallpaper;
      screen.dataset.wallpaper = wallpaper;
      navigate('settings', false);
      page.querySelector(`[data-wallpaper="${wallpaper}"]`).focus({preventScroll:true});
    }
  });
  page.addEventListener('input', event => {
    if (!event.target.matches('input[type="search"]')) return;
    const query = event.target.value.trim().toLowerCase();
    let shown = 0;
    page.querySelectorAll('.conversation').forEach(row => { row.hidden = !row.dataset.name.toLowerCase().includes(query); if (!row.hidden) shown++; });
    $('.empty-search').hidden = shown > 0;
  });
  shadow.addEventListener('keydown', event => {
    if (overlay.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const controls = [...overlay.querySelectorAll('button, input')].filter(el => !el.disabled && el.getClientRects().length);
      const first = controls[0]; const last = controls.at(-1);
      const active = shadow.activeElement;
      if (event.shiftKey && (active === first || !controls.includes(active))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (active === last || !controls.includes(active))) { event.preventDefault(); first?.focus(); }
    }
  });
  if (document.documentElement.dataset.yuiPreview === 'true') open();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once:true});
else mount();
