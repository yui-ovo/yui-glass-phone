import { supplementBlocks, startMarker, endMarker, unplain } from './supplement.js';
export function decorateSupplements(win) {
  const doc=win.document;if(!doc?.createTreeWalker)return;
  let chat;try{chat=win.SillyTavern?.getContext()?.chat;}catch{return;}if(!Array.isArray(chat))return;
  for(let index=0;index<chat.length;index++){
    let blocks;try{blocks=supplementBlocks(chat[index]);}catch{continue;}
    const container=doc.querySelector(`#chat .mes[mesid="${index}"] .mes_text`);if(!container)continue;
    for(const block of blocks){
      const existing=container.querySelector(`[data-yui-batch="${block.receipt.batchId}"]`);
      if(existing){existing.querySelector('summary').textContent=`手机交流 · ${block.receipt.entries?.length??block.receipt.sourceIds.length} 条`;existing.querySelector('pre').textContent=unplain(block.text.slice(block.text.indexOf(startMarker(block.receipt.batchId))+startMarker(block.receipt.batchId).length,block.text.indexOf(endMarker(block.receipt.batchId))).replace(/<!-- (?:\/?yui-message:[a-f0-9-]+|yui-content) -->/g,'').trim());continue;}
      const start=startMarker(block.receipt.batchId),end=endMarker(block.receipt.batchId),walker=doc.createTreeWalker(container,4),nodes=[];let node,text='';
      while((node=walker.nextNode())){nodes.push({node,offset:text.length});text+=node.textContent;}
      const a=text.indexOf(start),b=text.indexOf(end);
      const details=doc.createElement('details');details.className='yui-supplement';details.dataset.yuiBatch=block.receipt.batchId;details.style.cssText='font-size:12px;border:1px solid #8884;border-radius:8px;padding:6px 9px;margin:5px 0';
      const heading=doc.createElement('summary');heading.textContent=`手机交流 · ${block.receipt.entries?.length??block.receipt.sourceIds.length} 条`;
      const pre=doc.createElement('pre');pre.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;max-height:260px;overflow:auto';
      pre.textContent=block.text.slice(block.text.indexOf(start)+start.length,block.text.indexOf(end)).trim();
      pre.textContent=unplain(pre.textContent.replace(/<!-- (?:\/?yui-message:[a-f0-9-]+|yui-content) -->/g,''));
      details.append(heading,pre);
      // display_text or display-only regex can omit the block. Show its saved text.
      if(a<0||b<a){container.append(details);continue;}
      const literalStart=text.lastIndexOf('<yui_phone>',a),literalEnd=text.indexOf('</yui_phone>',b+end.length);
      const from=literalStart>=0&&!text.slice(literalStart+11,a).trim()?literalStart:a;
      const to=literalEnd>=0&&!text.slice(b+end.length,literalEnd).trim()?literalEnd+12:b+end.length;
      const first=nodes.find(v=>v.offset+v.node.textContent.length>from),last=nodes.find(v=>v.offset+v.node.textContent.length>=to);if(!first||!last)continue;
      const range=doc.createRange();range.setStart(first.node,from-first.offset);range.setEnd(last.node,to-last.offset);range.deleteContents();range.insertNode(details);
    }
  }
}
