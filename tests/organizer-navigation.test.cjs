const {test}=require('node:test'),assert=require('node:assert/strict');
const {mount}=require('../public/organizer-navigation.js');
test('organizer menu preserves nodes, routes direct links and history, hides sidebar on logout',()=>{
 const ids=['lists-panel','schedule-panel','drivers-panel','organizer-sidebar','list-title','schedule-title','drivers-title'];
 const nodes=Object.fromEntries(ids.map(id=>[id,{hidden:false,value:'fictional input',focus(){this.focused=true;}}]));
 const links=['lists','schedule','drivers'].map(route=>({dataset:{organizerRoute:route},attrs:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},addEventListener(k,f){this[k]=f;}}));
 const browser={location:{hash:'#drivers'},history:{pushState(a,b,path){browser.location.hash=path;}},handlers:{},addEventListener(k,f){this.handlers[k]=f;},scrollTo(){}};
 const nav=mount({getElementById:id=>nodes[id],querySelectorAll:()=>links},browser);nav.setAuthenticated(false);assert.equal(nodes['organizer-sidebar'].hidden,true);nav.setAuthenticated(true);assert.equal(nodes['drivers-panel'].hidden,false);assert.equal(nodes['lists-panel'].hidden,true);
 links[0].click({preventDefault(){}});assert.equal(browser.location.hash,'#lists');assert.equal(nodes['list-title'].focused,true);assert.equal(nodes['drivers-panel'].value,'fictional input');
 browser.location.hash='#schedule';browser.handlers.popstate();assert.equal(nodes['schedule-panel'].hidden,false);nav.setAuthenticated(false);assert.equal(nodes['organizer-sidebar'].hidden,true);
});
