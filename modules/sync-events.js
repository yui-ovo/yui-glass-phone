// One handler per phone instance; runs outside message-store locks.
const handlers=new WeakMap();
export const setPhoneSync=(win,run,status)=>{const value={run,status};handlers.set(win,value);return ()=>{if(handlers.get(win)===value)handlers.delete(win);};};
export const syncPhoneChanges=async win=>handlers.get(win)?.run();
export const phoneSyncStatus=win=>handlers.get(win)?.status?.()||{};
