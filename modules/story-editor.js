import { clone } from './contacts.js';
import { storyPolicy, readStoryContext, phoneStoryReference } from './story-context.js';
import { storyBridgeSupported } from './story-bridge.js';

export function storyEditor({win,scroll,draft,book,messenger,el,button,current,status}){
  const policy=clone(storyPolicy(draft)),section=el('details','profile-trace story-settings');
  section.append(el('summary','','剧情衔接'),el('p','profile-help','两个方向分别设置，只用于当前存档。修改后保存人物生效。'));
  const changed=()=>{draft.storyContext=clone(policy);status.textContent='剧情衔接设置尚未保存';};
  function toggle(text,key){const row=el('label','profile-check',text),input=el('input');input.type='checkbox';input.checked=policy[key];input.setAttribute('aria-label',text);input.onchange=()=>{policy[key]=input.checked;changed();};row.prepend(input);section.append(row);return input;}
  function count(text,key,max){const row=el('label','profile-label',text),input=el('input');input.type='number';input.min='1';input.max=String(max);input.value=policy[key];input.setAttribute('aria-label',text);input.oninput=()=>{policy[key]=Number(input.value);changed();};row.append(input);section.append(row);}
  toggle('参考当前酒馆剧情','readStory');count('最近可见正文消息条数','storyCount',100);
  section.append(el('p','profile-help','隐藏楼层不读取，先排除再计数。只读已加载的当前剧情，不读取其他聊天或备选回复。正文可能包含角色不知情的内容，请按人物选择。'));
  const share=toggle('将此人的手机聊天提供给正文','sharePhone');count('提供给正文的手机消息条数','phoneCount',200);
  const supported=storyBridgeSupported(win);if(!supported){share.disabled=true;section.append(el('p','profile-help','当前宿主缺少生成注入接口，正文参考暂不可用；已有设置保留。'));}
  section.append(el('p','profile-help','仅附在正文生成请求中，不新增可见楼层。手机历史目前不随正文回退自动回滚；切换同存档剧情分支时，请先检查参考内容。'));
  const result=el('div','story-preview');result.setAttribute('role','status');
  const preview=(kind)=>{
    if(!current())return;
    result.replaceChildren();
    try{
      const person={...draft,storyContext:clone(policy)};
      if(kind==='story'){
        const data=readStoryContext(win,person);
        if(!data){result.append(el('p','profile-help','此人物未开启正文读取'));return;}
        result.append(el('p','profile-help',`计划读取 ${data.requested} 条 · 当前可用 ${data.count} 条${data.truncated?' · 内容超过字数限制，已截短':''}`));
        for(const item of data.messages)result.append(el('p','profile-material',`${item.name}：${item.text}`));
      }else{
        if(!supported)throw Error('当前宿主不支持正文参考');
        const history=messenger.history();if(!history)throw Error('手机消息尚未读取完成');
        const previewBook={...book,people:[person]},data=phoneStoryReference(previewBook,history,person.id);
        result.append(el('p','profile-help',`供正文参考：${data[0]?.messages.length||0} 条手机消息`));
        for(const item of data[0]?.messages||[])result.append(el('p','profile-material',`${item.sender}：${item.text}`));
      }
      result.append(el('p','profile-help','这是按当前设置预览；实际请求时会重新读取。'));
    }catch(e){result.append(el('p','profile-help',e.message));}
  };
  section.append(button('预览正文参考',()=>preview('story')),button('预览分享给正文的手机消息',()=>preview('phone')),result);scroll.append(section);
}
