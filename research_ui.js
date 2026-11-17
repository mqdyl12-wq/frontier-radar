/* Research-focused presentation layer. Uses the existing static dashboard store. */
(function(){
  'use strict';
  const researchThemes=[
    ['AI中介传播与AI信息中介','界定 AI 生成信息与人际 AI-MC、生成式搜索及算法把关之间的关系。'],
    ['AI内容趋同','关注共同 AI 信息源、语义集中、表达相似度及集体多样性的变化。'],
    ['意见气候','关注多数线索、表达规范、社会影响和公共讨论中的意见分布。'],
    ['AI摘要与公众意见','关注 AI 对公众讨论的概括、再呈现与后续参与和表达。']
  ];
  let focus='全部';
  const escape=esc;
  const literature=document.getElementById('view-literature');
  if(!literature||typeof NAV==='undefined')return;
  literature.insertAdjacentHTML('beforebegin',`
    <section class="section" id="view-research">
      <div class="heading"><div><span class="eyebrow narrow">CURRENT RESEARCH / READING MAP</span><h2>在研课题 · 核心参考文献</h2>
      <p>围绕四条研究脉络组织公开学术文献：直接研究、理论支撑、交叉参考分开呈现。</p></div>
      <span class="chip" id="research-count">文献更新中</span></div>
      <div class="research-intro">
        <strong>研究前沿追踪</strong>
        <p>追踪 AI 信息中介、内容趋同、意见气候与 AI 摘要的研究。仅展示公开来源，不公开任何未发表手稿、原始研究数据或个人笔记。</p>
        <p>“重点期刊”是按学科声誉和研究相关性预设的筛选层级，<b>不是实时 JCR 分区或影响因子数值</b>；CHI、预印本、工作论文均单独标记。</p>
      </div>
      <div class="research-topics" id="research-topics"></div>
      <div class="heading"><div><span class="eyebrow narrow">PRIORITIZED READING</span><h2>研究脉络与精读</h2>
      <p>核心文献优先，最新候选自动补充；理论、方法、结论分别注明证据范围。</p></div></div>
      <div class="research-cards" id="research-cards"></div>
    </section>`);
  NAV.splice(2,0,['research','在研课题参考','book']);
  const filters=document.querySelector('#view-literature .headbar');
  filters.insertAdjacentHTML('beforeend',`
    <select id="quality-filter" aria-label="期刊及发表来源"><option value="all">全部来源层级</option><option value="传播">传播学重点／专业期刊</option><option value="交叉">交叉学科重点期刊</option><option value="会议">同行评议会议</option><option value="预印本">预印本与工作论文</option></select>
    <select id="relevance-filter" aria-label="与在研课题相关程度"><option value="all">全部相关程度</option><option value="直接相关">直接相关</option><option value="重点关注">重点关注</option><option value="理论支撑">理论支撑</option><option value="交叉参考">交叉参考</option></select>
  `);
  const qualityMatch=(x,v)=>{
    if(v==='all')return true;
    const tier=x.sourceTier||'';
    if(v==='传播')return tier.includes('传播学');
    if(v==='交叉')return tier.includes('交叉学科');
    if(v==='会议')return tier.includes('会议');
    return x.type==='工作论文'||tier.includes('预印本');
  };
  const relLabel=x=>x.relevance||(x.curated?'理论支撑':'尚待评估');
  const topicsOf=x=>x.researchThemes||[];
  const scopeLabel=x=>x.publicScope||x.discussionScope||
    (x.public?'直接研究公共讨论':'是否直接涉及公共讨论尚待核对');
  const reviewBadge=x=>x.curated?'人工核对的公开文献':x.analysisStatus||'仅有题录/摘要';
  const paperSource=x=>x.sourceTier||(x.type==='工作论文'?'工作论文／预印本':'未核验来源层级');
  function researchPapers(){
    const q=el('search').value.toLowerCase().trim();
    const topic=el('topic').value, type=el('type').value,pub=el('public-only').checked;
    const quality=el('quality-filter').value,relevance=el('relevance-filter').value;
    const list=(corpus.papers||[]).filter(x=>
      (topic==='all'||(x.topic||[]).includes(topic))&&
      (type==='all'||x.type===type)&&(!pub||x.public)&&
      qualityMatch(x,quality)&&(relevance==='all'||relLabel(x)===relevance)&&
      (!q||[x.title,x.en,x.authors,x.theory,x.method,x.finding,x.significance,
        ...topicsOf(x),...(x.tags||[])].join(' ').toLowerCase().includes(q))
    );
    el('paper-count').textContent=list.length+' 篇匹配文献';
    el('papers').innerHTML=list.length?list.map(x=>{
      const saved=library[x.id]?.saved;
      return `<article class="paper ${x.relevance==='直接相关'?'high-relevance':''}">
        <div class="tags">${tag(relLabel(x),x.relevance==='直接相关'?'purple':'')}
        ${tag(paperSource(x),x.type==='正式发表'?'green':'orange')}
        ${tag(scopeLabel(x))}</div>
        <h3>${escape(x.title)}</h3><div class="english">${escape(x.en||'')}</div>
        <div class="meta">${escape(x.authors||'')} · ${escape(x.venue||'')} · ${escape(x.date||'')}</div>
        <p>${escape(x.finding||'暂无可核实的研究发现')}</p>
        <p class="evidence-label">${escape(reviewBadge(x))} · ${escape((topicsOf(x)||[]).join(' / '))}</p>
        <footer><a href="${escape(safeUrl(x.url))}" target="_blank" rel="noopener noreferrer">原始来源 ↗</a>
        <div class="paper-footer-actions"><button class="iconbtn ${saved?'saved':''}" data-save="${escape(x.id)}" aria-label="收藏">${svg('bookmark')}</button>
        <button class="btn small" data-open="${escape(x.id)}">结构化解读</button></div></footer></article>`;
    }).join(''):'<div class="empty" style="grid-column:1/-1">当前筛选下无文献。可以选择其他研究方向或来源级别。</div>';
  }
  papers=researchPapers;
  function researchView(){
    const rows=(corpus.papers||[]).filter(x=>x.curated||x.relevance==='直接相关'||x.relevance==='重点关注');
    const filtered=rows.filter(x=>focus==='全部'||topicsOf(x).includes(focus))
      .sort((a,b)=>{
        const scores={'直接相关':0,'重点关注':1,'理论支撑':2,'交叉参考':3};
        return (scores[relLabel(a)]??4)-(scores[relLabel(b)]??4)
          ||Number(Boolean(b.curated))-Number(Boolean(a.curated))
          ||String(b.date||'').localeCompare(String(a.date||''));
      });
    el('research-topics').innerHTML=
      '<button class="focus-chip '+(focus==='全部'?'active':'')+'" data-research-focus="全部">全部方向</button>'+
      researchThemes.map(([title])=>`<button class="focus-chip ${focus===title?'active':''}" data-research-focus="${escape(title)}">${escape(title)}</button>`).join('');
    el('research-count').textContent=filtered.length+' 篇参考文献';
    el('research-cards').innerHTML=filtered.length?filtered.map(x=>{
      const saved=library[x.id]?.saved;
      return `<article class="research-paper">
        <div class="tags">${tag(relLabel(x),x.relevance==='直接相关'?'purple':'')}
        ${tag(paperSource(x),x.type==='正式发表'?'green':'orange')}
        ${tag(scopeLabel(x))}</div>
        <h3>${escape(x.title)}</h3><div class="english">${escape(x.en||'')}</div>
        <div class="meta">${escape(x.authors||'')} · ${escape(x.venue||'')} · ${escape(x.date||'')}</div>
        <div class="theme-links">${topicsOf(x).map(t=>tag(t)).join('')}</div>
        <div class="research-detail"><strong>研究理论与定位</strong><p>${escape(x.theory||'摘要未说明理论框架')}</p>
        <strong>数据与研究方法</strong><p>${escape(x.method||'摘要未说明研究方法')}</p>
        <strong>主要发现</strong><p>${escape(x.finding||'摘要未说明发现')}</p>
        <strong>与研究方向的关系</strong><p>${escape(x.significance||'尚待分析')}</p></div>
        <div class="evidence-label">${escape(x.scope||'证据范围尚待核验')} · ${escape(reviewBadge(x))}</div>
        <div class="paper-footer-actions"><a class="btn small" href="${escape(safeUrl(x.url))}" target="_blank" rel="noopener noreferrer">文献来源 ↗</a>
        <button class="btn small" data-open="${escape(x.id)}">详情 / 笔记</button>
        <button class="btn small" data-save="${escape(x.id)}">${saved?'已收藏':'加入阅读清单'}</button></div>
      </article>`;
    }).join(''):'<div class="empty">暂无匹配的研究参考文献。</div>';
  }
  const originalRender=render;
  render=function(){originalRender();if(view==='research')researchView()};
  const originalOpen=openItem;
  openItem=function(id){
    originalOpen(id);
    const paper=(corpus.papers||[]).find(x=>x.id===id);
    if(!paper)return;
    const details=document.querySelector('#drawer-content .detail');
    if(!details)return;
    const extra=(paper.theory||paper.limitations||paper.sourceTier||paper.researchThemes)?
      `<div class="study-extras"><h3>研究主题与来源层级</h3>
      <p>${escape((topicsOf(paper)||[]).join(' / ')||'待核查')} · ${escape(paperSource(paper))}</p>
      <h3>理论框架与分析视角</h3><p>${escape(paper.theory||'作者摘要未说明理论框架')}</p>
      <h3>证据限制 / 待核实项</h3><p>${escape(paper.limitations||paper.scope||'尚待核查原文')}</p></div>`:'';
    details.insertAdjacentHTML('afterbegin',extra);
  };
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-research-focus]');
    if(!b)return;
    focus=b.dataset.researchFocus; researchView();
  });
  document.querySelectorAll('#quality-filter,#relevance-filter').forEach(x=>
    x.addEventListener('change',()=>{if(view==='literature')papers()})
  );
  nav();render();
})();
