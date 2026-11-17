/* PaperLens v2: on-device PDF text positioning, argument map, multi-paper intake. */
(function(){
  'use strict';
  if(typeof STATUS==='undefined'||typeof renderAll!=='function')return;
  const el2=id=>document.getElementById(id);
  const locator=window.PaperLensLocator;
  let pdfLib=null,pdfDoc=null,pdfToken=0,renderSerial=0,renderQueue=Promise.resolve();
  let zoom=1,pdfFile=null;
  const PDFJS_URL='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
  const PDFJS_WORKER='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

  const BATCH_PROMPT=[
    '你是一名严谨的新闻传播学与计算传播方向文献精读助手。本次我在同一对话上传了多篇英文 PDF，请批量完成第一轮选择性精读，生成可导入 PaperLens 的多个 UTF-8 JSON 文件。',
    '',
    '工作规则：',
    '1. 首先按上传文件逐一列出：原文件名、真实英文题名、作者、期刊、年份、PDF 物理总页数、正文可读性。每篇单独处理，绝不可把不同论文的段落混在一起。',
    '2. 这一轮是【选择性初读】，不是全文逐段翻译。逐篇核查摘要、引言中的问题/空白、理论机制、方法、主要结果、讨论/局限；每篇优先挑选 6–12 个真正有价值的自然段翻译和注释。没有可靠核查到的部分写“尚未核实”，不能猜测。',
    '3. 每个 paragraph 必须复制 PDF 实际英文原段（original），完整、顺序不变；翻译（translation）和分析（analysis）、论证作用（logicNote）分别填写；role、importance 1–3、terms、caution 按原论文证据填写。page 必须是文件第1页起算的物理页码；id 使用 p3-01 这种稳定格式，跨页段按起始页编号。绝不把两栏排版横向拼接。',
    '4. 每篇输出独立 JSON，schemaVersion=1，包含 paper、sections、paragraphs；paper 填写 id、title、titleZh、authors、year、journal、doi、abstractZh、coreQuestion、theoreticalContribution、methodSummary、findings、limitations、takeaways。paper.id 优先 DOI，没有 DOI 用题名 slug。额外在 paper 中加入 readingMode="selective"、coverageNote="选择性初读，未覆盖全文"。sections 必须如实对应已读取的章节。',
    '5. 严格区分作者报告的结果和你的研究启发，重点关注 AI 信息中介、AI 内容趋同、意见气候、AI 摘要及公共讨论；不能编造样本量、显著性、因果解释，也不能把“有引用”直接等于可核验。扫描页、公式和图片无法可靠辨认时明确指出。',
    '6. 每篇文件命名为 PaperLens_英文题名slug_brief.json。推荐把全部独立 JSON 打包成一个 ZIP 供下载，也可以提供各文件下载链接。JSON 为标准 UTF-8，正确转义，禁止 Markdown 围栏。不要上传到 GitHub。',
    '7. 为核对质量，结束时汇报每篇的处理页码、已翻译段落数及尚未核实的部分。不要将选择性初读描述为全文完成。',
    '',
    '本轮最多先处理3篇；如果上传更多论文，请按上传顺序分组。生成可下载文件，而不是在聊天中贴很长的 JSON。后续我会选定论文继续全篇逐段精读。'
  ].join('\n');

  function ensureControls(){
    const actions=document.querySelector('.topActions');
    if(actions&&!el2('batchPromptBtn')){
      actions.insertAdjacentHTML('afterbegin',
        '<button id="batchPromptBtn" class="button subtle" title="一次上传多篇PDF，在ChatGPT生成多份精读JSON">复制多篇批量初读指令</button>'+
        '<button id="multiJsonBtn" class="button subtle">批量导入 JSON</button>'+
        '<input id="multiJsonFiles" type="file" accept=".json,application/json" multiple hidden>');
    }
    const tabs=document.querySelector('.tabs');
    if(tabs&&!document.querySelector('[data-tab="map"]')){
      tabs.insertAdjacentHTML('beforeend',
        '<button role="tab" aria-selected="false" class="tab" data-tab="map">论证结构图</button>');
    }
    const wrap=el2('dropTarget');
    if(wrap&&!el2('pdfjsHost')){
      wrap.insertAdjacentHTML('beforeend',
        '<div id="pdfjsHost"><div class="pdfLocationStatus" id="pdfLocationStatus" role="status">选择 PDF 后即可启用文字锚点定位</div>'+
        '<div id="pdfjsPage"><canvas id="pdfjsCanvas"></canvas><div id="pdfjsHighlights"></div></div></div>');
    }
    const controls=document.querySelector('.pdfBottom');
    if(controls&&!el2('pdfZoomIn')){
      controls.insertAdjacentHTML('beforeend',
        '<div class="pdfZoomTools"><button class="iconBtn" id="pdfZoomOut" title="缩小页面">−</button>'+
        '<span class="muted">缩放</span><button class="iconBtn" id="pdfZoomIn" title="放大页面">＋</button></div>');
    }
    const importHelp=document.querySelector('#importModal .modal p');
    if(importHelp){
      importHelp.insertAdjacentHTML('afterend',
        '<p class="batchHint">多篇论文可在顶部“批量导入 JSON”一次选择多个文件；每篇使用独立 paper.id。批量初读并非全篇逐段翻译。</p>');
    }
  }

  function makeArgumentMap(){
    const pack=currentPack();
    const ps=pack.paragraphs||[];
    const sections=pack.sections||[];
    const groups=sections.map((s,i)=>{
      const rows=ps.filter(p=>p.section===s.id);
      const key=rows.find(p=>p.importance===3)||rows[0];
      if(!rows.length)return '';
      const roles=[...new Set(rows.map(p=>p.role).filter(Boolean))].slice(0,3);
      return '<button class="mapSection" data-map-go="'+escapeHtml(key.id)+'">'+
        '<span class="mapIndex">'+String(i+1).padStart(2,'0')+'</span>'+
        '<b>'+escapeHtml(s.titleZh||s.title||s.id)+'</b>'+
        '<small>'+rows.length+'段 · 核心段'+rows.filter(p=>p.importance===3).length+' · PDF 第'+
        Math.min(...rows.map(p=>p.page))+'页起</small>'+
        '<small>'+escapeHtml(roles.join(' / ')||'章节段落')+'</small></button>';
    }).join('');
    const stages=[
      ['问题与研究空白',/研究问题|研究空白|研究背景|问题提出/],
      ['理论与机制',/理论|机制|假设|概念|规范性/],
      ['研究设计与测量',/研究方法|方法|研究设计|测量|评价指标|操作化|样本/],
      ['研究结果与证据',/研究结果|结果|发现|稳健性|证据|相关性/],
      ['讨论、贡献与局限',/讨论|贡献|结论|研究局限|局限性|启示/]
    ];
    const path=stages.map(([name,re],i)=>{
      const candidates=ps.filter(p=>re.test(p.role||''));
      const p=candidates.find(x=>x.importance===3)||candidates[0];
      const description=p?(p.analysis||p.logicNote||p.translation||'').slice(0,135):
        '当前已导入内容尚未出现这一论证环节；不据此推测论文没有相关内容。';
      return '<button class="mapStep '+(p?'done':'empty')+'" '+(p?'data-map-go="'+escapeHtml(p.id)+'"':'disabled')+'>'+
        '<span class="mapStepNumber">'+(i+1)+'</span><span><b>'+name+
        (p?' · PDF 第'+p.page+'页':' · 尚未覆盖')+'</b><p>'+
        escapeHtml(description)+'</p></span></button>';
    }).join('');
    const pages=[...new Set(ps.map(p=>p.page))].sort((a,b)=>a-b);
    const coverage=pages.length?'已导入译注涉及 PDF 物理页 '+pages.join('、'):'尚无真实译注';
    const mode=pack.paper.readingMode==='selective'?' · 选择性初读，未覆盖全文':'';
    el2('readingCount').textContent='结构导航 · '+ps.length+'段';
    el2('readingCanvas').innerHTML=
      '<div class="argumentMapHeader"><small class="eyebrow">ARGUMENT STRUCTURE</small>'+
      '<h3>从研究问题到证据：论文论证路线图</h3>'+
      '<p>以下结构根据已导入段落的章节和角色自动归纳，点击卡片可定位相应译注和 PDF 原文。不是AI重新生成的研究结论。</p></div>'+
      '<p class="mapCoverage">'+escapeHtml(coverage+mode)+'</p>'+
      '<div class="mapPathTitle">章节路线</div>'+
      '<div class="mapSectionList">'+groups+'</div>'+
      '<div class="mapPathTitle">论证与证据链</div><div class="mapPath">'+path+'</div>';
  }

  const nativeRenderContent=renderContent;
  renderContent=function(){
    if(STATUS.tab==='map')makeArgumentMap();
    else nativeRenderContent();
  };
  const nativeRenderParagraph=renderParagraph;
  renderParagraph=function(p){
    const markup=nativeRenderParagraph(p);
    return markup.replace('<button class="pageLink" data-page=',
      '<button class="pageLink" title="在PDF文本层查找原段落" data-locate="'+escapeHtml(p.id)+'" data-page=')
      .replace(' 页 ↗</button>',' 页 · 定位原文 ⌖</button>');
  };

  async function startPdf(file){
    if(!file||(!file.name.toLowerCase().endsWith('.pdf')&&file.type!=='application/pdf')||
       file.size>75*1024*1024)return;
    const token=++pdfToken;
    pdfFile=file;
    pdfDoc=null;
    el2('pdfLocationStatus').textContent='正在加载 PDF 文本层（无需付费 API）…';
    try{
      if(!pdfLib){
        pdfLib=await import(PDFJS_URL);
        pdfLib.GlobalWorkerOptions.workerSrc=PDFJS_WORKER;
      }
      const raw=new Uint8Array(await file.arrayBuffer());
      const loading=pdfLib.getDocument({data:raw,isEvalSupported:false});
      const doc=await loading.promise;
      if(token!==pdfToken){await doc.destroy();return;}
      pdfDoc=doc;zoom=1;
      el2('dropTarget').classList.add('precise');
      el2('pdfStatus').textContent='PDF 文本定位 · '+doc.numPages+' 页 · 原文件仅在浏览器内处理';
      await showPdfPage(1,null);
    }catch(error){
      if(token!==pdfToken)return;
      pdfDoc=null;
      el2('dropTarget').classList.remove('precise');
      el2('pdfStatus').textContent='原生 PDF 预览 · 精准定位未启用';
      el2('pdfLocationStatus').textContent='无法加载PDF文本层，继续使用浏览器原生翻页；可能因网络或扫描版PDF限制。';
      console.warn('PaperLens precise PDF rendering unavailable:',error);
    }
  }

  async function renderPdfPage(pageNumber,paragraph){
    if(!pdfDoc)return;
    const pageNo=Math.min(pdfDoc.numPages,Math.max(1,Math.floor(Number(pageNumber)||1)));
    STATUS.currentPage=pageNo;
    el2('pageInput').value=pageNo;
    const page=await pdfDoc.getPage(pageNo);
    const base=page.getViewport({scale:1});
    const wrap=el2('dropTarget');
    const scale=Math.max(.48,Math.min(3.5,(Math.max(250,wrap.clientWidth-32)/base.width)*zoom));
    const viewport=page.getViewport({scale});
    const canvas=el2('pdfjsCanvas');
    const ratio=Math.min(2,window.devicePixelRatio||1);
    canvas.width=Math.ceil(viewport.width*ratio);
    canvas.height=Math.ceil(viewport.height*ratio);
    canvas.style.width=viewport.width+'px';
    canvas.style.height=viewport.height+'px';
    const container=el2('pdfjsPage');
    container.style.width=viewport.width+'px';
    container.style.height=viewport.height+'px';
    const ctx=canvas.getContext('2d');
    await page.render({canvasContext:ctx,viewport,transform:[ratio,0,0,ratio,0,0]}).promise;
    const highlights=el2('pdfjsHighlights');
    highlights.innerHTML='';
    if(!paragraph){
      el2('pdfLocationStatus').textContent='PDF 第'+pageNo+'/'+pdfDoc.numPages+'页 · 点击右侧段落的“定位原文”高亮文字';
      return;
    }
    const content=await page.getTextContent();
    const found=locator?.findTextRange(content.items,paragraph.original||'');
    if(!found||!found.indices.length){
      el2('pdfLocationStatus').textContent='已跳至第'+pageNo+'页；没有找到可靠的文本锚点，未进行高亮。请人工核对原文。';
      return;
    }
    found.indices.forEach(index=>{
      const item=content.items[index];
      if(!item?.transform)return;
      const [x,y]=viewport.convertToViewportPoint(item.transform[4],item.transform[5]);
      const fontHeight=Math.max(6,Math.hypot(item.transform[2],item.transform[3])*scale);
      const width=Math.max(2,(item.width||0)*scale);
      const node=document.createElement('span');
      node.className='pdfHighlight'+(found.confidence==='high'?'':' partial');
      node.style.left=Math.max(0,x)+'px';
      node.style.top=Math.max(0,y-fontHeight*1.04)+'px';
      node.style.width=width+'px';
      node.style.height=fontHeight*1.16+'px';
      highlights.appendChild(node);
    });
    el2('pdfLocationStatus').textContent=found.confidence==='high'?
      'PDF 第'+pageNo+'页 · 文本锚点高度匹配，已高亮相关行（需核对完整段落）':
      'PDF 第'+pageNo+'页 · 仅匹配到局部文本或存在重复，蓝色高亮为参考位置，请人工复核';
    highlights.querySelector('.pdfHighlight')?.scrollIntoView({block:'center',inline:'nearest'});
  }
  function showPdfPage(page,p){
    const id=++renderSerial;
    renderQueue=renderQueue.catch(()=>{}).then(async()=>{
      if(id!==renderSerial)return;
      await renderPdfPage(page,p);
    });
    return renderQueue.catch(error=>{
      console.warn('PDF page rendering failed:',error);
      el2('pdfLocationStatus').textContent='此页文本层无法渲染，保留原生 PDF 翻页功能。';
      el2('dropTarget').classList.remove('precise');
      const oldPage=Number(page)||1;
      nativeGotoPage(oldPage);
    });
  }
  const nativeGotoPage=gotoPage;
  gotoPage=function(n){
    if(!pdfDoc)return nativeGotoPage(n);
    return showPdfPage(n,null);
  };
  async function locateParagraph(p){
    STATUS.lastSelected=p.id;
    document.querySelectorAll('.paragraph.chosen').forEach(x=>x.classList.remove('chosen'));
    document.getElementById('paragraph-'+p.id)?.classList.add('chosen');
    if(!pdfDoc)return nativeGotoPage(p.page);
    return showPdfPage(p.page,p);
  }

  const nativeImportPack=importPack;
  importPack=function(raw){
    const incoming=cleanImport(raw);
    const key=paperKey(incoming.paper);
    if(!STATUS.pack||paperKey(STATUS.pack.paper)!==key){
      const previous=localStorage.getItem(STORE_PREFIX+key);
      let old=null;
      try{old=previous?JSON.parse(previous):null}catch{}
      STATUS.pack=old?.pack||null;
      STATUS.notes=old?.notes||{};
      STATUS.flags=old?.flags||{};
    }
    return nativeImportPack(incoming);
  };
  function expandPacks(data){
    if(Array.isArray(data))return data;
    if(Array.isArray(data?.packs))return data.packs;
    return [data];
  }
  async function importMultiple(files){
    const good=[],bad=[];
    for(const file of [...files].slice(0,30)){
      try{
        if(!file.name.toLowerCase().endsWith('.json')||file.size>4_000_000)
          throw Error('不是有效大小的 JSON 文件');
        const obj=JSON.parse(await file.text());
        for(const pack of expandPacks(obj)){
          cleanImport(pack);
          good.push(pack);
        }
      }catch(e){bad.push(file.name+'：'+String(e.message||e).slice(0,110));}
    }
    if(!good.length){toast('没有可导入的 JSON 文件；'+(bad[0]||''));return}
    let count=0;
    for(const pack of good){
      try{importPack(pack);count++;}
      catch(e){bad.push(pack.paper?.title||'无题'+': '+String(e.message||e));}
    }
    toast('批量导入成功 '+count+' 份'+(bad.length?'；失败 '+bad.length+' 份':''));
    if(bad.length)console.warn('PaperLens batch import:',bad);
  }

  ensureControls();
  document.querySelector('[data-tab="map"]')?.addEventListener('click',()=>updateTab('map'));
  el2('batchPromptBtn')?.addEventListener('click',()=>{
    copyText(BATCH_PROMPT).then(()=>toast('批量初读指令已复制；在 ChatGPT 同时上传多篇英文 PDF'))
      .catch(()=>toast('剪贴板不可用，请检查浏览器权限'));
  });
  el2('multiJsonBtn')?.addEventListener('click',()=>el2('multiJsonFiles').click());
  el2('multiJsonFiles')?.addEventListener('change',async e=>{
    await importMultiple(e.target.files||[]);
    e.target.value='';
  });
  el2('pdfFile')?.addEventListener('change',e=>{if(e.target.files?.[0])startPdf(e.target.files[0])});
  el2('dropTarget')?.addEventListener('drop',e=>{if(e.dataTransfer?.files?.[0])startPdf(e.dataTransfer.files[0])});
  el2('pdfZoomIn')?.addEventListener('click',()=>{zoom=Math.min(2.5,zoom*1.2);if(pdfDoc)showPdfPage(STATUS.currentPage,null)});
  el2('pdfZoomOut')?.addEventListener('click',()=>{zoom=Math.max(.65,zoom/1.2);if(pdfDoc)showPdfPage(STATUS.currentPage,null)});
  el2('readingCanvas').addEventListener('click',e=>{
    const locate=e.target.closest('[data-locate]');
    if(locate){
      e.preventDefault();e.stopImmediatePropagation();
      const p=currentPack().paragraphs.find(p=>p.id===locate.dataset.locate);
      if(p)locateParagraph(p);
      return;
    }
    const link=e.target.closest('[data-map-go]');
    if(link){
      e.preventDefault();e.stopImmediatePropagation();
      const p=currentPack().paragraphs.find(p=>p.id===link.dataset.mapGo);
      if(!p)return;
      STATUS.focus=false;
      el2('searchInput').value='';
      el2('roleFilter').value='all';
      el2('focusToggle').classList.remove('active');
      updateTab('reading');
      requestAnimationFrame(()=>{
        document.getElementById('paragraph-'+p.id)?.scrollIntoView({block:'center',behavior:'smooth'});
        locateParagraph(p);
      });
    }
  },true);
  window.PaperLensV2={
    findTextRange:locator?.findTextRange,locateParagraph,importMultiple,
    getPdfState:()=>({loaded:!!pdfDoc,pages:pdfDoc?.numPages||0}),
    getBatchPrompt:()=>BATCH_PROMPT
  };
  renderAll();
})();