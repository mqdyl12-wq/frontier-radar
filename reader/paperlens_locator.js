/* PaperLens v2: conservative PDF text anchor matching; never guess a location. */
(function(global){
  'use strict';
  function normalize(value){
    return String(value||'').normalize('NFKC').toLowerCase()
      .replace(/[\u00ad\u200b]/g,'').replace(/[^a-z0-9]/g,'');
  }
  function findTextRange(items, original){
    const anchor=normalize(original);
    if(anchor.length<24||!Array.isArray(items))return null;
    let combined='',spans=[];
    items.forEach((item,i)=>{
      const part=normalize(item&&item.str);
      if(!part)return;
      const start=combined.length;
      combined+=part;
      spans.push({index:i,start,end:combined.length});
    });
    const candidateLengths=[120,90,64,45,28];
    for(const desired of candidateLengths){
      const length=Math.min(desired,anchor.length);
      if(length<24)continue;
      const needle=anchor.slice(0,length);
      const start=combined.indexOf(needle);
      if(start<0)continue;
      const end=start+length;
      const matching=spans.filter(s=>s.start<end&&s.end>start).map(s=>s.index);
      const repeated=combined.indexOf(needle,start+1)!==-1;
      return {indices:matching,confidence:!repeated&&length>=90?'high':'partial',
        matchedChars:length,ambiguous:repeated};
    }
    return null;
  }
  global.PaperLensLocator={normalize,findTextRange};
})(typeof window!=='undefined'?window:globalThis);
