// Contract fixture: native TT character store is grouped by integrity, not filename.
(() => {
  const callbacks = new Set();
  const rawFetch = window.fetch;
  window.fetch = (...args) => { if (String(args[0]).includes('/api/')) throw new Error('TT must not use ST identity endpoint'); return rawFetch(...args); };
  const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])) : value;
  const state = window.ttMock = {
    calls: [], fail:false, mismatch:false, waitRead:false, waitWrite:false, waitUnsubscribe:false,
    layout: { version:1, safeFrame:{left:0,top:24,width:375,height:620},ime:{keyboardOffset:0} },
    emitLayout(snapshot) { this.layout=snapshot;for(const fn of callbacks)fn(snapshot); },
    subscriptions:()=>callbacks.size,
    data:()=>JSON.parse(localStorage.getItem('fixture.tt.store')||'{}'),
    async pause(kind) { if (this[kind]) await new Promise(resolve=>this['release'+kind]=resolve); },
  };
  const ready = new Promise(resolve=>state.ready=resolve);
  window.__TAURITAVERN__ = { ready, api:{
    layout:{async subscribe(fn){callbacks.add(fn);fn(state.layout);await state.pause('waitUnsubscribe');return ()=>callbacks.delete(fn);}},
    chat:{open(ref){
      const scope=ref.kind==='group' ? `group:${ref.chatId}` : `${ref.characterId}:${profileMock.integrity}`;
      const prefix=`${scope}/yui-glass-phone/`;
      const check=options=>{if(options.namespace!=='yui-glass-phone'||!/^(contacts|messages)-v1-[a-f0-9]{64}$/.test(options.key))throw new Error('Unexpected namespace or key');};
      return {store:{
        async listKeys({namespace}) { if(namespace!=='yui-glass-phone')throw new Error('Unexpected namespace');if(state.fail)throw new Error('Native storage unavailable');await state.pause('waitRead');return Object.keys(state.data()).filter(key=>key.startsWith(prefix)).map(key=>key.slice(prefix.length)); },
        async getJson(options) { check(options);if(options.key.startsWith('messages-')&&state.messageReadFail){state.messageReadFail=false;throw Error('Message confirmation unavailable');}const value=state.data()[prefix+options.key];if(!value)throw new Error('Chat store entry not found');return sorted(structuredClone(value)); },
        async setJson(options) { check(options);state.calls.push({ref:structuredClone(ref),key:options.key});await state.pause('waitWrite');if(options.key.startsWith('messages-'))await state.pause('waitMessage');if(state.fail)throw new Error('Native write failed');const data=state.data();data[prefix+options.key]=structuredClone(options.value);if(state.mismatch)data[prefix+options.key].revision+=5;localStorage.setItem('fixture.tt.store',JSON.stringify(data));if(options.key.startsWith('messages-')&&state.messageFailAfterWrite){state.messageFailAfterWrite=false;state.messageReadFail=true;} },
        async renameKey(options) {check(options);const data=state.data();if(data[prefix+options.newKey])throw new Error('Destination exists');data[prefix+options.newKey]=data[prefix+options.key];delete data[prefix+options.key];localStorage.setItem('fixture.tt.store',JSON.stringify(data));},
      }};
    }},
  }};
  if(!new URLSearchParams(location.search).has('delay'))state.ready();
})();
