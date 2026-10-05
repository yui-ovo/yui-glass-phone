import { clone } from './contacts.js';
import { storyPolicy, readStoryContext } from './story-context.js';
import { pendingSupplement } from './supplement.js';
import { storyBridgeSupported } from './story-bridge.js';

export function storyEditor({win,scroll,draft,book,messenger,el,button,current,status}){
  const policy=clone(storyPolicy(draft)),section=el('details','profile-trace story-settings');
  section.append(el('summary','','剧情衔接'),el('p','profile-help','两个方向分别设置，只用于当前存档。修改后保存人物生效。'));
  const changed=()=>{draft.storyContext=clone(policy);status.textContent='剧情衔接设置尚未保存';};
  function toggle(text,key){const row=el('label','profile-check',text),input=el('input');input.type='checkbox';input.checked=policy[key];input.setAttribute('aria-label',text);input.onchange=()=>{policy[key]=input.checked;changed();};row.prepend(input);section.append(row);return input;}
  function count(text,key,max){const row=el('label','profile-label',text),input=el('input');input.type='number';input.min='1';input.max=String(max);input.value=policy[key];input.setAttribute('aria-label',text);input.oninput=()=>{policy[key]=Number(input.value);changed();};row.append(input);section.append(row);}
  toggle('参考当前酒馆剧情','readStory');count('最近正文消息条数（含隐藏楼层）','storyCount',100);
  section.append(el('p','profile-help','开启后也会读取有正文的隐藏楼层，并随请求发送给独立 API。只读当前已加载剧情，不读取其他聊天或备选回复；跳过工具和已标记的插件内部消息。请按人物选择，预览可核对隐藏条数。'));
  const share=toggle('将此人的手机聊天提供给正文','sharePhone');count('每次补记最多消息条数','phoneCount',200);
  const supported=storyBridgeSupported(win);if(!supported){share.disabled=true;section.append(el('p','profile-help','当前宿主缺少补记保存接口，正文分享暂不可用；已有设置保留。'));}
  section.append(el('p','profile-help','还需在设置 → 待同步补记开启总开关。生成前保存到上一条 AI 正文末尾，不新增楼层。已保存补记暂不随手机编辑、删除或剧情回退改写。'));
  const result=el('div','story-preview');result.setAttribute('role','status');
  const preview=async(kind)=>{
    if(!current())return;
    result.replaceChildren();
    try{
      const person={...draft,storyContext:clone(policy)};
      if(kind==='story'){
        const data=readStoryContext(win,person);
        if(!data){result.append(el('p','profile-help','此人物未开启正文读取'));return;}
        result.append(el('p','profile-help',`计划读取 ${data.requested} 条 · 当前可用 ${data.count} 条 · 其中隐藏 ${data.hiddenCount} 条${data.truncated?' · 内容超过字数限制，已截短':''}`));
        for(const item of data.messages)result.append(el('p','profile-material',`${item.name}：${item.text}`));
      }else{
        if(!supported)throw Error('当前宿主不支持正文参考');
        const history=messenger.history();if(!history)throw Error('手机消息尚未读取完成');
        const previewBook={...book,people:[person]},data=(await pendingSupplement(win,previewBook,history,win.SillyTavern.getContext().chat)).filter(r=>!r.excluded);
        if(!current())return;
        result.append(el('p','profile-help',`待同步：${data.length} 条手机消息`));
        for(const item of data)result.append(el('p','profile-material',`${item.sender}：${item.text}`));
      }
      result.append(el('p','profile-help','这是按当前设置预览；实际请求时会重新读取。'));
    }catch(e){result.append(el('p','profile-help',e.message));}
  };
  section.append(button('预览正文参考',()=>preview('story')),button('预览分享给正文的手机消息',()=>preview('phone')),result);scroll.append(section);
}
