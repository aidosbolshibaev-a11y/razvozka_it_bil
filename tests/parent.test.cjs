const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
class Element {
 constructor(){this.value='';this.children=[];this.textContent='';this.handlers={};this.disabled=false;this.style={};this.classList={toggle(){}};}
 get options(){return this.children;}
 set innerHTML(_){this.children=[];this.value='';}
 add(option){this.children.push(option);if(!this.value)this.value=option.value;}
 append(...children){this.children.push(...children);}
 replaceChildren(){this.children=[];}
 addEventListener(type,fn){this.handlers[type]=fn;}
 scrollIntoView(){}
}
const catalog={points:[{id:'11111111-1111-4111-8111-111111111111',city:'astana',address:'Точка 1'},{id:'22222222-2222-4222-8222-222222222222',city:'shchuchinsk',address:'Точка 1'}],times:['fri','sun'].flatMap(dir=>['14:00','16:00'].map(time=>({dir,time})))};
function start(lang='ru'){
 const html=fs.readFileSync(require.resolve('../public/index.html'),'utf8');
 const nodes=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));const calls=[],routes=[];
 const context=vm.createContext({URL,Date,setTimeout,clearTimeout,location:{protocol:'file:'},
  Option:class{constructor(text,value){this.textContent=text;this.value=value;}},
  localStorage:{getItem:()=>lang,setItem(){}},RazvozkaParentNavigation:{show:id=>routes.push(id)},
  document:{getElementById:id=>{assert.ok(nodes[id],'Missing element '+id);return nodes[id];},createElement:()=>new Element(),querySelectorAll:()=>[],documentElement:{},title:''},
  fetch:async(path,options)=>{if(path.endsWith('trip_catalog'))return{ok:true,json:async()=>catalog};calls.push({path,body:JSON.parse(options.body)});return{ok:true,json:async()=>path.endsWith('my_signups')?{rows:[]}:{ok:true}};}
 });context.window=context;context.CFG={URL:'https://fictional.invalid',KEY:'public-test-key'};
 vm.runInContext(fs.readFileSync(require.resolve('../public/location-picker.js'),'utf8'),context);
 vm.runInContext(fs.readFileSync(require.resolve('../public/trip-catalog.js'),'utf8'),context);
 vm.runInContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n'),context);
 const fill=()=>{nodes.name.value='Учебный Ученик';nodes.phone.value='0000000001';nodes.pin.value='1234';nodes.num.value='7';nodes.let.value='A';};
 return{nodes,context,calls,html,fill,routes,ready:vm.runInContext('catalogReady',context)};
}
test('parent form boots in RU/KZ without train controls and missing dependencies',async()=>{
 for(const lang of ['ru','kz']){const h=start(lang);await h.ready;assert.ok(h.nodes.date.value);assert.ok(h.nodes.time.value);assert.equal(h.context.document.documentElement.lang,lang==='ru'?'ru':'kk');assert.equal(h.html.includes('id="trainBox"'),false);assert.equal(vm.runInContext('Object.values(L[lang]).some(s=>/электрич|сенімхат|доверенност/i.test(s))',h.context),false);}
});
test('common point submits car without coordinates, own point requires explicit selection',async()=>{
 const h=start();await h.ready;h.fill();await h.nodes.send.onclick();assert.equal(h.calls[0].body.p_data.tr,'car');assert.equal(h.calls[0].body.p_data.addr,'Точка 1');assert.equal(h.calls[0].body.p_data.delivery_lat,null);
 const own=start();await own.ready;own.fill();own.nodes.pt.value='own';await own.nodes.send.onclick();assert.equal(own.calls.length,0);
 vm.runInContext('locationPicker.set({lat:51.17,lon:71.43})',own.context);await own.nodes.send.onclick();
 assert.equal(own.calls[0].body.p_data.delivery_lat,51.17);assert.equal(own.calls[0].body.p_data.delivery_lon,71.43);
});
test('saved map location restores when editing; archived train has no edit controls',async()=>{
 const h=start();await h.ready;vm.runInContext('AUTH={phone:"0000000001",pin:"1234"};startEdit({id:"fictional",tr:"car",dir:"fri",date:"2030-01-18",time:"14:00",addr:"Точка на карте",name:"Учебный Ученик",cls:"7A",delivery_lat:51.17,delivery_lon:71.43,delivery_note:"Учебный ориентир"});',h.context);
 assert.equal(vm.runInContext('locationPicker.value().lat',h.context),51.17);assert.equal(h.nodes['delivery-note'].value,'Учебный ориентир');
 assert.equal(h.routes.at(-1),'form');
 vm.runInContext('MINE=[{id:"archived",name:"Учебный Ученик",cls:"7A",tr:"train",dir:"fri",date:"2030-01-18",time:"14:00"}];renderMine();',h.context);
 const card=h.nodes.mineList.children[0];assert.equal(card.children.length,3);assert.match(card.children[2].textContent,/Архивная/);
});
test('successful save opens My records and exposes feedback; a failed save preserves fields and opens form',async()=>{
 const h=start();await h.ready;h.fill();await h.nodes.send.onclick();assert.equal(h.routes.at(-1),'mine');assert.equal(h.nodes['parent-feedback'].hidden,false);assert.match(h.nodes['parent-feedback'].textContent,/Готово/);
 const bad=start();await bad.ready;bad.fill();bad.context.fetch=async()=>{throw Error('fictional network failure');};await bad.nodes.send.onclick();
 assert.equal(bad.routes.at(-1),'form');assert.equal(bad.nodes.name.value,'Учебный Ученик');assert.equal(bad.nodes['parent-feedback'].hidden,true);assert.equal(bad.nodes.send.disabled,false);
});
test('selected deadline uses Astana date, preserves year boundary and follows time choice in both languages',async()=>{
 for(const lang of ['ru','kz']){
  const h=start(lang);await h.ready;h.nodes.date.value='2030-01-01';h.nodes.time.value='14:00';h.nodes.time.onchange();assert.match(h.nodes['trip-deadline'].textContent,/31\.12\.2029, 14:00/);
  h.nodes.time.value='16:00';h.nodes.time.onchange();assert.match(h.nodes['trip-deadline'].textContent,/31\.12\.2029, 16:00/);assert.equal(h.calls.length,0);
 }
});

test('cities cannot match, direction and delivery point follow destination',async()=>{
 const h=start();await h.ready;h.fill();
 h.nodes['from-city'].value='astana';h.nodes['from-city'].onchange();
 assert.equal(h.nodes['to-city'].value,'shchuchinsk');
 assert.equal(vm.runInContext('st.dir',h.context),'sun');
 assert.equal(h.nodes.pt.options.some(o=>o.value==='own'),false);
 await h.nodes.send.onclick();assert.equal(h.calls[0].body.p_data.to_city,'shchuchinsk');
 assert.equal(h.calls[0].body.p_data.point_id,catalog.points[1].id);
 const same=start();await same.ready;same.fill();same.nodes['to-city'].value='shchuchinsk';await same.nodes.send.onclick();assert.equal(same.calls.length,0);
});
test('refresh picks up new points/times, rejects bad catalog and blocks stale submission',async()=>{
 const h=start();await h.ready;h.fill();
 h.context.fetch=async()=>({ok:true,json:async()=>({points:[...catalog.points,{id:'33333333-3333-4333-8333-333333333333',city:'astana',address:'Учебная улица, дом А'}],times:[...catalog.times,{dir:'fri',time:'18:30'}]})});
 await h.nodes['catalog-refresh'].onclick();assert.ok(h.nodes.time.options.some(o=>o.value==='18:30'));
 assert.ok(h.nodes.pt.options.some(o=>o.textContent==='Учебная улица, дом А'));
 h.context.fetch=async()=>{throw Error('offline');};await h.nodes['catalog-refresh'].onclick();assert.equal(h.nodes.send.disabled,true);await h.nodes.send.onclick();assert.equal(h.calls.length,0);
});
