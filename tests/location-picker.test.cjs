const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');const api=require('../public/location-picker.js');
test('coordinate range, Mercator roundtrip and safe OSM marker link',()=>{
 const point={lat:51.17,lon:71.43},back=api.coordinates(api.world(point,18),18);
 assert.ok(Math.abs(point.lat-back.lat)<1e-9);assert.ok(Math.abs(point.lon-back.lon)<1e-9);
 for(const bad of [{lat:null,lon:71.4},{lat:'51.1',lon:71.4},{lat:0,lon:0},{lat:NaN,lon:71.4}])assert.ok(!api.valid(bad));
 const url=new URL(api.osmURL(point));assert.equal(url.origin,'https://www.openstreetmap.org');assert.equal(url.searchParams.get('mlat'),'51.170000');assert.equal(api.osmURL({lat:0,lon:0}),null);
});
class Element {
 constructor(){this.children=[];this.handlers={};this.style={};this.value='';this.textContent='';this.clientWidth=320;this.clientHeight=340;}
 addEventListener(type,fn){this.handlers[type]=fn;}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 fire(type,event={}){this.handlers[type]?.({preventDefault(){},...event});}
 setPointerCapture(){}
 getBoundingClientRect(){return {left:0,top:0,width:320,height:340};}
}
function setup(protocol='https:',observe=false){
 const names=['location-map','location-tiles','location-confirm','location-status','location-value','location-load','location-map-panel','location-in','location-out','location-west','location-east','location-north','location-south'];
 const nodes=Object.fromEntries(names.map(n=>[n,new Element()]));let timer=0;
 let notify=()=>{};
 const context=vm.createContext({URL,location:{protocol},setTimeout:()=>++timer,clearTimeout(){},...(observe?{ResizeObserver:class{constructor(callback){notify=callback;}observe(){}}}:{})});
 vm.runInContext(fs.readFileSync(require.resolve('../public/location-picker.js'),'utf8'),context);
 const picker=context.RazvozkaLocation.mount({getElementById:id=>nodes[id],createElement:()=>new Element()},()=> 'ru');
 return {nodes,picker,resize(){notify();},loaded(){nodes['location-tiles'].children.forEach(img=>img.fire('load'));}};
}
test('default city center is not selected; confirm requires loaded tiles and building-level zoom',()=>{
 const h=setup();assert.equal(h.picker.value(),null);h.nodes['location-confirm'].fire('click');assert.equal(h.picker.value(),null);
 h.nodes['location-load'].fire('click');h.loaded();h.nodes['location-confirm'].fire('click');assert.equal(h.picker.value(),null);
 for(let i=0;i<4;i++)h.nodes['location-in'].fire('click');
 h.nodes['location-confirm'].fire('click');assert.equal(h.picker.value(),null);h.loaded();h.nodes['location-confirm'].fire('click');assert.ok(h.picker.value());
 h.nodes['location-east'].fire('click');assert.equal(h.picker.value(),null);
});
test('failed tiles cannot confirm a new location; an existing saved point can be restored without network',()=>{
 const h=setup();h.nodes['location-load'].fire('click');for(let i=0;i<4;i++)h.nodes['location-in'].fire('click');
 const images=h.nodes['location-tiles'].children;images[0].fire('error');images.slice(1).forEach(img=>img.fire('load'));
 h.nodes['location-confirm'].fire('click');assert.equal(h.picker.value(),null);assert.match(h.nodes['location-status'].textContent,/не загрузилась/);
 h.picker.set({lat:51.17,lon:71.43});assert.equal(h.picker.value().lat,51.17);h.picker.set(null);assert.equal(h.picker.value(),null);
});
test('file page explains local launch instead of sending tile requests without Referer',()=>{
 const h=setup('file:');h.nodes['location-load'].fire('click');assert.equal(h.nodes['location-tiles'].children.length,0);assert.match(h.nodes['location-status'].textContent,/локальный сервер/);
});
test('pointer tap selects center only after explicit confirmation; cancelling gesture clears no saved coordinates silently',()=>{
 const h=setup();h.nodes['location-load'].fire('click');for(let i=0;i<4;i++)h.nodes['location-in'].fire('click');h.loaded();
 h.nodes['location-map'].fire('pointerdown',{clientX:160,clientY:170,pointerId:1,button:0});
 h.nodes['location-map'].fire('pointerup',{clientX:190,clientY:175});assert.equal(h.picker.value(),null);h.loaded();
 h.nodes['location-confirm'].fire('click');assert.ok(h.picker.value());
});
test('resizing a visible map redraws tiles while preserving the saved point; hidden panels do not load tiles',()=>{
 const h=setup('https:',true);h.picker.set({lat:51.17,lon:71.43});h.nodes['location-load'].fire('click');h.loaded();
 const old=h.nodes['location-tiles'].children[0];h.nodes['location-map'].clientWidth=420;h.resize();
 assert.notEqual(h.nodes['location-tiles'].children[0],old);assert.equal(h.picker.value().lat,51.17);
 const current=h.nodes['location-tiles'].children[0];h.nodes['location-map'].clientWidth=0;h.resize();assert.equal(h.nodes['location-tiles'].children[0],current);
});
