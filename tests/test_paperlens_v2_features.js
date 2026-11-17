const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const filename=path.join(__dirname,'..','reader','paperlens_v2.js');
const source=fs.readFileSync(filename,'utf8');
const views=new Map();
function node(id){
  if(!views.has(id)){
    const obj={id,innerHTML:'',value:'',clientWidth:700,classList:{add(){},remove(){}},
      dataset:{},listeners:{},addEventListener(type,fn){(this.listeners[type]||=[]).push(fn)},
      insertAdjacentHTML(_place,content){this.innerHTML+=content}};
    views.set(id,obj);
  }
  return views.get(id);
}
const paperA={id:'a',title:'Paper A',readingMode:'selective'};
const paperB={id:'b',title:'Paper B',readingMode:'selective'};
const pack=(paper,id,role)=>({schemaVersion:1,paper,sections:[{id:'intro',title:'Introduction',titleZh:'引言'}],
  paragraphs:[{id,page:1,section:'intro',role,importance:3,original:'A meaningful sentence about research design.',
    translation:'研究设计的句子。',analysis:'说明研究问题',logicNote:'证据链的起点',terms:[],caution:''}]});
const storage=new Map();
const STATUS={pack:pack(paperA,'p1-01','研究问题'),tab:'reading',pdf:null,
  notes:{},flags:{},focus:false,showEnglish:true,lastSelected:null,currentPage:1};
const keys={
  'paperlens.v1.a':{pack:STATUS.pack,notes:{'p1-01':'保留的人工研究笔记'},flags:{}}
};
Object.entries(keys).forEach(([key,value])=>storage.set(key,JSON.stringify(value)));
const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v))};
const sandbox={window:{},document:{
    getElementById:id=>{
      const dynamic={'batchPromptBtn':'topActions','multiJsonBtn':'topActions',
        'multiJsonFiles':'topActions','pdfjsHost':'dropTarget',
        'pdfZoomIn':'pdfBottom','pdfZoomOut':'pdfBottom'};
      if(dynamic[id]&&!node(dynamic[id]).innerHTML.includes('id="'+id+'"'))return null;
      return node(id);
    },
    querySelector:sel=>{
      if(sel==='[data-tab="map"]')return node('tabs').innerHTML.includes('data-tab="map"')?node('mapTab'):null;
      const m={'.topActions':'topActions','.tabs':'tabs','.pdfBottom':'pdfBottom',
        '#importModal .modal p':'importHelp'};
      return m[sel]?node(m[sel]):null;
    },
    querySelectorAll:()=>[],
    createElement:()=>({style:{},className:'',appendChild(){}}),
  },STATUS,localStorage,STORE_PREFIX:'paperlens.v1.',console,
  currentPack:()=>STATUS.pack,
  escapeHtml:s=>String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
  renderContent:()=>{},
  renderParagraph:()=>'<button class="pageLink" data-page="1">PDF 第 1 页 ↗</button>',
  renderAll:()=>{},
  gotoPage:()=>{},
  updateTab:function(tab){STATUS.tab=tab;sandbox.renderContent()},
  paperKey:p=>p.id,
  cleanImport:x=>x,
  importPack:function(raw){
    if(STATUS.pack?.paper?.id===raw.paper.id){
      const by=new Map(STATUS.pack.paragraphs.map(p=>[p.id,p]));
      raw.paragraphs.forEach(p=>by.set(p.id,p));
      STATUS.pack={...raw,paragraphs:[...by.values()]};
    }else STATUS.pack=raw;
    storage.set('paperlens.v1.'+raw.paper.id,JSON.stringify({
      pack:STATUS.pack,notes:STATUS.notes,flags:STATUS.flags}));
  },
  toast:()=>{},copyText:()=>Promise.resolve(),requestAnimationFrame:fn=>fn(),
  setTimeout:()=>0};
const helper=fs.readFileSync(path.join(__dirname,'..','reader','paperlens_locator.js'),'utf8');
vm.createContext(sandbox);
vm.runInContext(helper,sandbox);
vm.runInContext(source,sandbox);
assert.match(node('tabs').innerHTML,/论证结构图/);
assert.match(node('topActions').innerHTML,/批量导入 JSON/);
assert.match(node('pdfBottom').innerHTML,/pdfZoomIn/);
assert.match(sandbox.renderParagraph(STATUS.pack.paragraphs[0]),/data-locate="p1-01"/);
sandbox.STATUS.tab='map';
sandbox.renderContent();
assert.match(node('readingCanvas').innerHTML,/研究问题/);
assert.match(node('readingCanvas').innerHTML,/章节路线/);
(async()=>{
  const blob=raw=>({name:'paper.json',size:800,text:async()=>JSON.stringify(raw)});
  await sandbox.window.PaperLensV2.importMultiple([blob(pack(paperB,'p1-01','研究方法'))]);
  assert.equal(STATUS.pack.paper.id,'b');
  await sandbox.window.PaperLensV2.importMultiple([blob(pack(paperA,'p2-01','研究结果'))]);
  assert.equal(STATUS.pack.paper.id,'a');
  assert.equal(STATUS.pack.paragraphs.length,2);
  assert.equal(STATUS.notes['p1-01'],'保留的人工研究笔记');
  const keys=[...storage.keys()];
  assert.ok(keys.includes('paperlens.v1.b'));
  assert.ok(keys.includes('paperlens.v1.a'));
  console.log('PaperLens v2: map, anchor buttons, multi-paper imports and saved-notes regression passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
