(function(root){
 'use strict';
 const cities=['astana','shchuchinsk'];
 function direction(from,to){
  if(!cities.includes(from)||!cities.includes(to)||from===to)throw Error('bad_cities');
  return from==='shchuchinsk'?'fri':'sun';
 }
 function parse(data){
  if(!data||!Array.isArray(data.points)||!Array.isArray(data.times))throw Error('catalog');
  const points=data.points.map(p=>{
   if(typeof p.id!=='string'||!p.id||!cities.includes(p.city)||typeof p.address!=='string'||p.address.length<5||p.address.length>200)throw Error('catalog');
   return {id:p.id,city:p.city,address:p.address};
  });
  if(new Set(points.map(p=>p.id)).size!==points.length)throw Error('catalog');
  const slots={fri:{car:[]},sun:{car:[]}};
  for(const row of data.times){
   if(!['fri','sun'].includes(row.dir)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(row.time))throw Error('catalog');
   if(!slots[row.dir].car.includes(row.time))slots[row.dir].car.push(row.time);
  }
  for(const dir of ['fri','sun']){if(!slots[dir].car.length)throw Error('catalog');slots[dir].car.sort();}
  return {points,slots};
 }
 const api={direction,parse};root.RazvozkaTripCatalog=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
