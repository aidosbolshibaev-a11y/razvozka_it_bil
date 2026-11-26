const {test}=require('node:test');const assert=require('node:assert/strict');
const {mount}=require('../public/parent-navigation.js');
class Element {
 constructor(id){this.id=id;this.hidden=false;this.attributes={};this.handlers={};this.value='';}
 addEventListener(type,fn){this.handlers[type]=fn;}
 setAttribute(key,value){this.attributes[key]=value;}
 removeAttribute(key){delete this.attributes[key];}
 focus(){this.focused=true;}
}
function setup(hash=''){
 const nodes=Object.fromEntries(['info','form','mine','info-title','formTitle','mine-title'].map(id=>[id,new Element(id)]));
 const menu=['info','form','mine'].map(id=>Object.assign(new Element(),{dataset:{parentRoute:id}}));
 const cta=Object.assign(new Element(),{dataset:{parentRoute:'form'}});
 const listeners={},history=[];
 const browser={location:{hash},history:{pushState(_a,_b,url){history.push(url);browser.location.hash=url;}},addEventListener(name,fn){listeners[name]=fn;},scrollTo(){}};
 const document={getElementById:id=>nodes[id],querySelectorAll:selector=>selector.startsWith('.parent-nav')?menu:[...menu,cta]};
 const api=mount(document,browser);return{nodes,menu,cta,browser,listeners,history,api};
}
test('default info, navigation preserves existing form values and exposes active menu',()=>{
 const h=setup();assert.equal(h.nodes.info.hidden,false);assert.equal(h.nodes.form.hidden,true);assert.equal(h.nodes.mine.hidden,true);
 h.nodes.form.value='fictional unsaved input';h.api.show('form');h.api.show('mine');h.api.show('form');
 assert.equal(h.nodes.form.value,'fictional unsaved input');assert.equal(h.nodes.form.hidden,false);
 assert.equal(h.menu[1].attributes['aria-current'],'page');assert.equal(h.menu[0].attributes['aria-current'],undefined);assert.equal(h.nodes.formTitle.focused,true);
});
test('direct URL and browser back/forward restore section without adding history entries',()=>{
 const h=setup('#mine');assert.equal(h.nodes.mine.hidden,false);assert.equal(h.history.length,0);
 h.api.show('form');assert.equal(h.browser.location.hash,'#form');assert.equal(h.history.length,1);
 h.browser.location.hash='#mine';h.listeners.popstate();assert.equal(h.nodes.mine.hidden,false);assert.equal(h.history.length,1);
 h.browser.location.hash='#invalid';h.listeners.hashchange();assert.equal(h.nodes.info.hidden,false);
});
test('CTA routes to new record; modified links retain normal browser behavior',()=>{
 const h=setup();let prevented=false;h.cta.handlers.click({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(h.nodes.form.hidden,false);
 h.menu[2].handlers.click({ctrlKey:true,preventDefault(){assert.fail('Ctrl+click should be native');}});assert.equal(h.browser.location.hash,'#form');
});
