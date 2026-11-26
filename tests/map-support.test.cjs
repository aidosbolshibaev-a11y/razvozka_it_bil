const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const {searchURL}=require('../public/map-support.js');
test('address search is restricted to OSM, encoded and scoped to Astana',()=>{
 for(const input of ['Учебная улица, 12А/1','Астана, Учебная улица 12','<script>&x=1']) {
  const url=new URL(searchURL(input));assert.equal(url.origin,'https://www.openstreetmap.org');assert.equal(url.pathname,'/search');
  assert.match(url.searchParams.get('query'),/^Астана, /);assert.equal([...url.searchParams].length,1);
 }
 assert.throws(()=>searchURL(''));assert.throws(()=>searchURL('Астана'));assert.throws(()=>searchURL('x'.repeat(161)));
});
class Element {
 constructor(){this.children=[];this.handlers={};this.value='';this.hidden=false;this.textContent='';this.attributes={};}
 setAttribute(k,v){this.attributes[k]=v;}
 removeAttribute(k){delete this.attributes[k];delete this[k];}
 addEventListener(name,fn){this.handlers[name]=fn;}
 replaceChildren(...nodes){this.children=nodes;}
 fire(name){let prevented=false;this.handlers[name]?.({preventDefault(){prevented=true;}});return prevented;}
 focus(){this.focused=true;}
}
function harness(){
 const ids=['astana-map','map-status','map-load','map-address','map-search-form','map-search-status','map-search-result'];
 const nodes=Object.fromEntries(ids.map(id=>[id,new Element()])),timers=new Map();let timerId=0;
 const context=vm.createContext({URL,setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(fs.readFileSync(require.resolve('../public/map-support.js'),'utf8'),context);
 const document={getElementById:id=>nodes[id],createElement:()=>new Element()};
 const api=context.RazvozkaMapSupport.mount(document);
 return {nodes,timers,api};
}
test('map loads only on explicit click; retry ignores events from old iframe',()=>{
 const h=harness();assert.equal(h.nodes['astana-map'].children.length,0);
 h.nodes['map-load'].fire('click');const old=h.nodes['astana-map'].children[0];
 assert.match(old.src,/openstreetmap.org\/export\/embed.html/);assert.match(old.title,/Астаны/);
 assert.equal(old.attributes.referrerpolicy,'strict-origin-when-cross-origin');
 h.nodes['map-load'].fire('click');const current=h.nodes['astana-map'].children[0];
 const message=h.nodes['map-status'].textContent;old.fire('load');assert.equal(h.nodes['map-status'].textContent,message);
 current.fire('load');assert.equal(h.timers.size,0);
 assert.match(h.nodes['map-status'].textContent,/Масштаб/);
});
test('map failure and timeout keep fallback instructions visible',()=>{
 const h=harness();h.nodes['map-load'].fire('click');
 [...h.timers.values()][0]();assert.match(h.nodes['map-status'].textContent,/дольше обычного/);
 h.nodes['astana-map'].children[0].fire('error');assert.match(h.nodes['map-status'].textContent,/Список и Excel доступны/);
 h.api.destroy();assert.equal(h.nodes['astana-map'].children.length,0);
});
test('search prepares a link without a network request or confirmed-address claim; input clears stale link',()=>{
 const h=harness();h.nodes['map-address'].value='Учебная улица, 12';assert.equal(h.nodes['map-search-form'].fire('submit'),true);
 const link=h.nodes['map-search-result'];assert.equal(link.hidden,false);assert.equal(link.focused,true);
 assert.match(h.nodes['map-search-status'].textContent,/не подтверждает адрес/);
 assert.equal(new URL(link.href).searchParams.get('query'),'Астана, Учебная улица, 12');
 h.nodes['map-address'].fire('input');assert.equal(link.hidden,true);assert.equal(link.href,undefined);
 h.nodes['map-address'].value='';h.nodes['map-search-form'].fire('submit');assert.equal(link.hidden,true);
 assert.match(h.nodes['map-search-status'].textContent,/Укажите улицу/);
});
