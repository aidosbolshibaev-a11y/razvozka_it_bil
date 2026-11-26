const {test}=require('node:test'),assert=require('node:assert/strict');
const {direction,parse}=require('../public/trip-catalog.js');
const data={points:[{id:'fictional-a',city:'astana',address:'Учебная улица, дом А'}],times:[{dir:'fri',time:'18:30'},{dir:'fri',time:'14:00'},{dir:'sun',time:'16:00'}]};
test('catalog validates city pairs, addresses and 24h times without trusting arbitrary server shape',()=>{
 assert.equal(direction('astana','shchuchinsk'),'sun');assert.equal(direction('shchuchinsk','astana'),'fri');
 for(const pair of [['astana','astana'],['bad','astana'],['shchuchinsk','shchuchinsk']])assert.throws(()=>direction(...pair));
 assert.deepEqual(parse(data).slots.fri.car,['14:00','18:30']);
 for(const bad of [{},{...data,times:[{dir:'fri',time:'25:00'}]},{...data,points:[...data.points,...data.points]},{...data,points:[{...data.points[0],city:'bad'}]}])assert.throws(()=>parse(bad));
});
class Element{
 constructor(){this.value='';this.textContent='';this.children=[];this.handlers={};}
 addEventListener(k,fn){this.handlers[k]=fn;}append(x){this.children.push(x);}replaceChildren(){this.children=[];}
 fire(k){return this.handlers[k]({preventDefault(){}});}
}
function harness(){
 const ids=['point-city','point-address','point-add','departure-dir','departure-time','departure-add','catalog-reload','catalog-points','catalog-times','point-form','departure-form','catalog-admin','catalog-message'];
 const nodes=Object.fromEntries(ids.map(id=>[id,new Element()]));let reply=async()=>data;const calls=[];
 global.RazvozkaTripCatalog={parse};
 const admin=require('../public/catalog-admin.js').mount({getElementById:id=>nodes[id],createElement:()=>new Element()},async(fn,args)=>{calls.push({fn,args});return reply(fn,args);});
 return{nodes,calls,admin,setReply:fn=>{reply=fn;}};
}
test('organizer catalog loads, normalizes additions, handles duplicates/errors and clears on logout',async()=>{
 const h=harness();await h.admin.open();assert.equal(h.nodes['catalog-points'].children.length,1);
 h.setReply(async fn=>fn==='trip_catalog'?data:{ok:true});h.nodes['point-city'].value='astana';h.nodes['point-address'].value=' Учебная   улица, дом Б ';
 await h.nodes['point-form'].fire('submit');assert.deepEqual(h.calls.at(-2),{fn:'organizer_add_point',args:{p_city:'astana',p_address:'Учебная улица, дом Б'}});
 h.nodes['departure-dir'].value='fri';h.nodes['departure-time'].value='18:30';await h.nodes['departure-form'].fire('submit');assert.equal(h.calls.at(-2).fn,'organizer_add_time');
 h.setReply(async()=>({error:'duplicate'}));h.nodes['departure-time'].value='18:30';await h.nodes['departure-form'].fire('submit');assert.match(h.nodes['catalog-message'].textContent,/уже есть/);assert.equal(h.nodes['departure-add'].disabled,false);
 h.admin.clear();const n=h.calls.length;await h.nodes['catalog-reload'].fire('click');assert.equal(h.calls.length,n);assert.equal(h.nodes['catalog-admin'].hidden,true);assert.equal(h.nodes['catalog-points'].children.length,0);
});
test('logout discards a pending catalog response and prevents old data restoring',async()=>{
 const h=harness();let resolve;h.setReply(()=>new Promise(r=>{resolve=r;}));const pending=h.admin.open();h.admin.clear();resolve(data);await pending;
 assert.equal(h.nodes['catalog-points'].children.length,0);assert.equal(h.nodes['catalog-admin'].hidden,true);
});
