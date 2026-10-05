// Run against a separately obtained, unmodified upstream sanitizer. No third-party code is bundled.
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {formatSupplement} from '../modules/supplement.js';
if(!process.env.QQJ_SANITIZER_FILE)throw Error('Set QQJ_SANITIZER_FILE to memory-content-sanitizer.js (ES module)');
const {sanitizeMemoryContent}=await import(pathToFileURL(process.env.QQJ_SANITIZER_FILE));
const block=formatSupplement(crypto.randomUUID(),[{time:'10月5日 21:30',person:'测试角色',sender:'测试用户',text:'酒吧门口见，尚未见面',quote:'马上到'}]);
const raw='<content>正文测试</content><status_board>不应出现的状态栏</status_board>\n'+block;
const options={keepTags:'content,yui_phone',extraTags:'status_board,options,section'};
const result=sanitizeMemoryContent(raw,options);
assert(result.includes('正文测试'));assert(result.includes('酒吧门口见'));assert(result.includes('马上到'));assert(!result.includes('不应出现的状态栏'));
assert(!sanitizeMemoryContent(raw,{...options,keepTags:'content'}).includes('酒吧门口见'));
console.log('PASS upstream QQJ sanitizer retains yui_phone only when configured, and still filters status_board');
