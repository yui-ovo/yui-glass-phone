// Contract fixture only. No real SillyTavern data or credentials.
(() => {
  const listeners = new Map();
  window.profileMock = {
    account: 'test-user', card: '0', chat: 'chat-A', integrity: 'integrity-A',
    cards: { '0': { name: '花店故事标题', avatar: 'story.png', data: { extensions: {} } }, '1': { name: '另一段故事', avatar: 'other.png', data: { extensions: {} } } },
    persona: { name: '测试用户人设', description: '只读取当前选中的人设' }, worlds: {},
    async emit(event, ...args) { for (const fn of [...(listeners.get(event) ?? [])]) await fn(...args); },
    async switch(card, chat, integrity = `integrity-${chat}`) { this.card=card;this.chat=chat;this.integrity=integrity;await this.emit('chat_id_changed',chat); },
    listeners: () => [...listeners.values()].reduce((n,set)=>n+set.size,0),
  };
  window.SillyTavern = { getContext() {
    const mock=window.profileMock;
    const ctx={ characterId:mock.card, chatId:mock.chat, characters:mock.cards, chatMetadata:{integrity:mock.integrity},
      name1: mock.persona.name, powerUserSettings: { persona_description: mock.persona.description },
      getWorldInfoNames: () => Object.keys(mock.worlds), loadWorldInfo: async name => structuredClone(mock.worlds[name]),
      getRequestHeaders:()=>({'Content-Type':'application/json'}),
      getThumbnailUrl:(_type,file)=>`/thumbnail?type=avatar&file=${encodeURIComponent(file)}`,
      eventTypes:{CHAT_CHANGED:'chat_id_changed',CHAT_RENAMED:'chat_renamed'},
      eventSource:{ on(event,fn){if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(fn);},removeListener(event,fn){listeners.get(event)?.delete(fn);}},
    };
    Object.defineProperty(ctx,'chat',{get(){throw new Error('Yui must not read host messages');}});
    for(const method of ['saveMetadata','saveChat','saveSettingsDebounced','generate'])ctx[method]=()=>{throw new Error(`Forbidden host write ${method}`);};
    return ctx;
  } };
})();
