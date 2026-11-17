const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(match, 'Main inline dashboard script is missing');
new vm.Script(match[1], {filename: 'index-inline.js'});
const researchScript = fs.readFileSync(path.join(__dirname, '..', 'research_ui.js'), 'utf8');
new vm.Script(researchScript, {filename: 'research_ui.js'});

const nodes = new Map();
const listeners = {};
const storage = new Map();
function element(id) {
  if (!nodes.has(id)) {
    nodes.set(id, {
      id, innerHTML: '', textContent: '', value: '', checked: false, style: {},
      classList: {add(){}, remove(){}, toggle(){}},
      addEventListener(){}, insertAdjacentHTML(position, content) {this.innerHTML += content;},
      scrollTop: 0
    });
  }
  return nodes.get(id);
}
const document = {
  getElementById: element,
  querySelector: selector => selector.includes('.headbar') ? element('headbar') : null,
  querySelectorAll: () => [],
  addEventListener(type, callback) {(listeners[type] ||= []).push(callback);},
  body: {style: {}}
};
const localStorage = {
  getItem(key) {return storage.has(key) ? storage.get(key) : null;},
  setItem(key, value) {storage.set(key, String(value));}
};
const context = vm.createContext({
  document, localStorage, URL, location: {protocol: 'file:'},
  window: {scrollTo(){}}, setTimeout(){return 0;}, clearTimeout(){},
  console
});
vm.runInContext(match[1], context, {filename: 'index-inline.js'});
vm.runInContext(researchScript, context, {filename: 'research_ui.js'});

const tech = {
  id: 't-test-reference', title: 'AI Search Update', date: '2026-11-16',
  source: 'Official Research Lab', url: 'https://example.org/ai-search-update',
  excerpt: 'Verified public announcement summary', impact: 'Possible research use',
  tags: ['官方动态']
};
const paper = {
  id: 'p-test-paper', title: 'AI-Mediated Communication', en: 'AI-Mediated Communication',
  date: '2026-11-16', venue: 'Journal of Communication', type: '正式发表',
  url: 'https://example.org/paper', authors: 'A. Author', topic: ['AI-MC'], tags: []
};
vm.runInContext('corpus.tech = [' + JSON.stringify(tech) + ']; corpus.papers = [' +
  JSON.stringify(paper) + ']; view = "technology"; render();', context);
assert.match(element('tech-list').innerHTML, /data-save="t-test-reference"/);
assert.match(element('tech-list').innerHTML, /详情 \/ 研究备注/);

function click(selector, dataset) {
  const event = {target: {closest(name) {
    return name === selector ? {dataset: dataset || {}} : null;
  }}};
  for (const callback of listeners.click || []) callback(event);
}
click('[data-save]', {save: tech.id});
let library = JSON.parse(storage.get('frontierRadarLibrary_v1'));
assert.equal(library[tech.id].saved, true);
assert.equal(library[tech.id].reference.kind, 'tech');
assert.equal(library[tech.id].reference.url, tech.url);
assert.equal(library[tech.id].reference.source, tech.source);
assert.equal(library[tech.id].reference.date, tech.date);
assert.equal(library[tech.id].reference.excerpt, tech.excerpt);
assert.match(element('tech-list').innerHTML, /取消收藏/);

vm.runInContext('save("p-test-paper"); view = "reading"; render();', context);
assert.match(element('reading-list').innerHTML, /学术文献（1）/);
assert.match(element('reading-list').innerHTML, /官方报告与科技动态（1）/);
assert.match(element('reading-list').innerHTML, /AI Search Update/);
assert.match(element('reading-list').innerHTML, /AI-Mediated Communication/);
assert.match(element('reading-text').textContent, /收藏 2 项/);

// The official reference remains accessible when the rolling feed drops the item.
vm.runInContext('corpus.tech = []; view = "reading"; render(); openItem("t-test-reference");',
  context);
assert.match(element('reading-list').innerHTML, /AI Search Update/);
assert.match(element('drawer-content').innerHTML, /Official Research Lab/);
assert.match(element('drawer-content').innerHTML, /研究用途与参考笔记/);
assert.match(element('drawer-content').innerHTML, /https:\/\/example.org\/ai-search-update/);
element('read-status').value = '已读';
element('note').value = 'Used as a source in a research proposal';
click('#save-note');
library = JSON.parse(storage.get('frontierRadarLibrary_v1'));
assert.equal(library[tech.id].status, '已读');
assert.equal(library[tech.id].note, 'Used as a source in a research proposal');
assert.equal(library[tech.id].reference.url, tech.url);
vm.runInContext('view = "reading"; render();', context);
assert.match(element('reading-text').textContent, /已读 1/);
click('[data-save]', {save: tech.id});
library = JSON.parse(storage.get('frontierRadarLibrary_v1'));
assert.equal(library[tech.id].saved, false);
vm.runInContext('view = "reading"; render();', context);
assert.doesNotMatch(element('reading-list').innerHTML, /AI Search Update/);
assert.match(element('reading-list').innerHTML, /AI-Mediated Communication/);
console.log('Tech bookmark / reference snapshot / notes / paper regression: OK');
