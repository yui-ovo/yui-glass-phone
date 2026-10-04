// Categories are account-local; permissions use archive + person IDs, never names.
export const FAVORITES = 'favorites';
export function categoryName(value) {
  if(typeof value!=='string'||!value.trim()||value.trim().length>40)throw Error('分类名称需为 1–40 个字符');
  return value.trim();
}
export function validateGroups(doc, account, assets) {
  if(!doc||doc.version!==1||doc.account!==account||!Number.isSafeInteger(doc.revision)||doc.revision<0||!Array.isArray(doc.categories)||!doc.categories.length||doc.categories.length>100||!doc.assignments||typeof doc.assignments!=='object'||Array.isArray(doc.assignments))throw Error('表情包分类格式无法读取，已停止修改');
  const ids=new Set(),names=new Set();
  for(const c of doc.categories){
    if(!c||typeof c.id!=='string'||!c.id||ids.has(c.id)||categoryName(c.name)!==c.name||names.has(c.name)||!Array.isArray(c.bindings)||c.bindings.length>500)throw Error('表情包分类重复或格式无效');
    ids.add(c.id);names.add(c.name);const bindings=new Set();
    for(const b of c.bindings){if(!b||typeof b.archiveId!=='string'||!b.archiveId||typeof b.personId!=='string'||!b.personId||bindings.has(JSON.stringify(b)))throw Error('分类角色绑定无效');bindings.add(JSON.stringify(b));}
  }
  if(doc.categories.find(c=>c.id===FAVORITES)?.name!=='收藏')throw Error('收藏分类无法读取');
  for(const a of assets)if(!ids.has(doc.assignments[a.id]))throw Error('检测到旧窗口修改了素材，请关闭旧窗口后重新读取；未覆盖资料');
  return doc;
}
export function migrateGroups(account, assets, uuid) {
  const categories=[{id:FAVORITES,name:'收藏',bindings:[]}],assignments={},legacy=[];
  for(const a of assets){
    const name=a.category?.trim()||'收藏';let c=categories.find(c=>c.name===name);
    if(!c){c={id:uuid(),name,bindings:[]};categories.push(c);}
    assignments[a.id]=c.id;
    legacy.push({id:a.id,category:a.category,allowedAI:a.allowedAI,hidden:a.hidden});
  }
  return validateGroups({version:1,account,revision:0,categories,assignments,legacyBackup:legacy,permissionReview:assets.some(a=>a.allowedAI&&!a.hidden)},account,assets);
}
export function usableBy(asset, categories, archiveId, personId) {
  return !asset.hidden&&categories.some(c=>c.id===asset.categoryId&&c.bindings.some(b=>b.archiveId===archiveId&&b.personId===personId));
}
export function parseStickerLines(text) {
  if(typeof text!=='string'||text.length>16000)throw Error('批量链接过长');
  return text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map((line,i)=>{
    // One entry per line lets descriptions contain spaces and URLs contain colons.
    const match=line.match(/^(.*?)[:：]\s*(https?:\/\/\S+)$/i);
    let description='',address=line;
    if(match){description=match[1].trim();address=match[2];if(!description||description.length>256)throw Error(`第 ${i+1} 行描述需为 1–256 个字符`);}
    let url;try{url=new URL(address);}catch{throw Error(`第 ${i+1} 行请填写 描述:图片链接`);}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error(`第 ${i+1} 行图片链接无效`);
    return {description,url:url.href};
  });
}
