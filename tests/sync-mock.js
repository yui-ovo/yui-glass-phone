// Synthetic ST/TT body persistence for browser tests; no real chat or AI service.
(()=>{
 const original=SillyTavern.getContext,m=profileMock,rawFetch=fetch;
 m.story=JSON.parse(localStorage.getItem('fixture.sync.body')||'null')||[{is_user:false,name:'角色',mes:'<content>酒吧门口</content>',extra:{}}];m.disk=structuredClone(m.story);
 m.saveBody=()=>{m.disk=structuredClone(m.story);localStorage.setItem('fixture.sync.body',JSON.stringify(m.disk));};
 SillyTavern.getContext=()=>{const old=original(),ctx={};for(const k of Object.keys(old))if(k!=='chat')ctx[k]=old[k];ctx.chat=m.story;
  for(const name of ['MESSAGE_SENT','MESSAGE_UPDATED','MESSAGE_DELETED','MESSAGE_SWIPED','CHARACTER_MESSAGE_RENDERED','GENERATION_AFTER_COMMANDS'])ctx.eventTypes[name]=name;
  ctx.saveChat=async()=>m.saveBody();ctx.stopGeneration=()=>{};
  ctx.updateMessageBlock=(index,message)=>{let host=document.querySelector('#chat');if(!host){host=document.createElement('div');host.id='chat';host.style.display='none';document.body.append(host);}let node=host.querySelector(`[mesid="${index}"]`);if(!node){node=document.createElement('div');node.className='mes';node.setAttribute('mesid',index);const text=document.createElement('div');text.className='mes_text';node.append(text);host.append(node);}node.querySelector('.mes_text').textContent=message.mes;};return ctx;
 };
 window.fetch=async(url,options)=>{if(url==='/api/chats/get')return new Response(JSON.stringify([{chat_metadata:{integrity:m.integrity}},...m.disk]));if(url==='/api/chats/save'){m.disk=JSON.parse(options.body).chat.slice(1);localStorage.setItem('fixture.sync.body',JSON.stringify(m.disk));return new Response('{}');}return rawFetch(url,options);};
 if(window.__TAURITAVERN__){const open=__TAURITAVERN__.api.chat.open;__TAURITAVERN__.api.chat.open=ref=>({...open(ref),history:{tail:async({limit})=>({startIndex:Math.max(0,m.disk.length-limit),messages:structuredClone(m.disk.slice(-limit))})}});}
})();
