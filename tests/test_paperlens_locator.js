const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const reader=path.join(__dirname,'..','reader');
const locatorSource=fs.readFileSync(path.join(reader,'paperlens_locator.js'),'utf8');
const addonSource=fs.readFileSync(path.join(reader,'paperlens_v2.js'),'utf8');
const html=fs.readFileSync(path.join(reader,'index.html'),'utf8');
new vm.Script(locatorSource,{filename:'paperlens_locator.js'});
new vm.Script(addonSource,{filename:'paperlens_v2.js'});
assert.match(html,/paperlens_locator\.js/);
assert.match(html,/paperlens_v2\.js/);
assert.match(html,/paperlens_v2\.css/);
const sandbox={window:{}};
vm.runInNewContext(locatorSource,sandbox);
const locate=sandbox.window.PaperLensLocator.findTextRange;
const norm=sandbox.window.PaperLensLocator.normalize;
assert.equal(norm('Generative Search-Engine'), 'generativesearchengine');
assert.equal(norm('ﬁndings'), 'findings'); // NFKC ligature normalization.
const items=[
  {str:'Generative search engines directly gen-'},{str:'erate responses to user queries,'},
  {str:' along with inline citations.'},{str:'Unrelated adjacent chart.'}
];
const original='Generative search engines directly generate responses to user queries, along with inline citations.';
const result=locate(items,original);
assert.equal(result.confidence,'partial');
assert.deepEqual(Array.from(result.indices),[0,1,2]);
const longText='A trustworthy generative search engine should provide accurate citations for externally verifiable claims and should clearly distinguish source attribution from factual accuracy.';
assert.equal(locate([{str:longText}],longText).confidence,'high');
const repeat=locate([{str:'Generated responses have in-line citations. Generated responses have in-line citations.'}],
'Generated responses have in-line citations.');
assert.equal(repeat.confidence,'partial');
assert.equal(repeat.ambiguous,true);
assert.equal(locate(items,'There are completely different claims in this paper about energy systems.'),null);
assert.equal(locate([{str:'a text fragment'}],''),null);
console.log('PaperLens locator tests: 5 passed; PDF highlight anchored by matched words only.');
