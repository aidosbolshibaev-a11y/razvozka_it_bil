(function(root){
'use strict';
function mount(document,rpc,getRows){
 const $=id=>document.getElementById(id);let data={drivers:[],groups:[]},busy=false,version=0;
 const el=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
 function input(parent,label,value,type='text'){const l=el('label',label),i=document.createElement('input');i.type=type;i.value=value||'';l.append(i);parent.append(l);return i;}
 function button(parent,text,fn){const b=el('button',text);b.type='button';b.addEventListener('click',fn);parent.append(b);return b;}
 async function run(action,args={}){if(busy)return;busy=true;const op=version;$('dispatch-message').textContent='Загрузка…';
 try{const result=await rpc('organizer_dispatch',{p_action:action,p_data:args});if(op!==version)return;
 if(!Array.isArray(result.drivers)||!Array.isArray(result.groups))throw Error('Некорректный ответ сервера');data=result;render();$('dispatch-message').textContent='Обновлено. После изменения записи обновите основной список.';
 }catch(e){if(op===version)$('dispatch-message').textContent=e.message;}
 finally{if(op===version)busy=false;}}
 function render(){
 $('dispatch-drivers').replaceChildren();for(const d of data.drivers)$('dispatch-drivers').append(el('li',d.name+' · '+d.phone+' · Kaspi '+d.kaspi));
 const select=$('group-driver');select.replaceChildren();for(const d of data.drivers){const o=el('option',d.name+' · '+d.phone);o.value=d.id;select.append(o);}
 $('dispatch-groups').replaceChildren();for(const g of data.groups){const box=el('li',g.trip_date+' · '+(g.dir==='fri'?'Щучинск → Астана':'Астана → Щучинск')+' · '+g.dep_time+' · '+(data.drivers.find(d=>d.id===g.driver_id)?.name||'Водитель')+' · '+(g.published?'Опубликовано':'Черновик')+' · '+(g.members||[]).length+' детей');
 button(box,'Опубликовать весь рейс',()=>run('publish',{id:g.id}));button(box,'Расформировать группу',()=>{if(root.confirm('Расформировать группу? Публикация рейса будет снята.'))run('remove_group',{id:g.id});});$('dispatch-groups').append(box);}
 }
 $('driver-form').addEventListener('submit',e=>{e.preventDefault();return run('driver',{name:$('driver-name').value.trim(),phone:$('driver-phone').value.replace(/\D/g,''),kaspi:$('driver-kaspi').value.replace(/\D/g,'')});});
 let candidates=[];
 function records(){candidates=[];$('dispatch-records').replaceChildren();for(const r of getRows()){
 const box=document.createElement('li');box.append(el('h3',r.name+' · '+r.date+' '+r.time+' · '+r.addr));
 const chosen=input(box,'Включить в новую группу','','checkbox');const street=input(box,'Проверенная улица (одинаковое написание для одного названия)');
 const lat=input(box,'Широта здания',r.delivery_lat,'number');lat.step='any';const lon=input(box,'Долгота здания',r.delivery_lon,'number');lon.step='any';
 const verified=input(box,'Подтверждаю здание и близость соседних улиц','','checkbox');
 candidates.push({r,chosen,street,lat,lon,verified});
 const details=document.createElement('details');details.append(el('summary','Изменить или отменить запись (организатор)'));
 const name=input(details,'ФИО',r.name),addr=input(details,'Адрес',r.addr),date=input(details,'Дата',r.date,'date'),time=input(details,'Время из расписания',r.time,'time');
 button(details,'Сохранить изменения',()=>run('edit',{id:r.id,version:r.updated_at,name:name.value,addr:addr.value,date:date.value,time:time.value}));
 button(details,'Отменить запись',()=>{if(root.confirm('Отменить запись '+r.name+'?'))run('cancel',{id:r.id,version:r.updated_at});});box.append(details);$('dispatch-records').append(box);
 }}
 $('dispatch-refresh').addEventListener('click',()=>{records();return run('read');});
 $('group-form').addEventListener('submit',e=>{e.preventDefault();const selected=candidates.filter(x=>x.chosen.checked);
 if(selected.length<1||selected.length>7){$('dispatch-message').textContent='Выберите от 1 до 7 записей.';return;}
 const members=selected.map(x=>({id:x.r.id,version:x.r.updated_at,street:x.street.value.trim(),lat:x.lat.value===''?null:Number(x.lat.value),lon:x.lon.value===''?null:Number(x.lon.value),verified:x.verified.checked}));
 if(members.some(m=>!m.verified||!m.street||m.lat===null||m.lon===null)){$('dispatch-message').textContent='Проверьте улицу, здание и координаты каждой записи.';return;}
 return run('group',{driver_id:$('group-driver').value,members});});
 return {open(){records();return run('read');},clear(){version++;busy=false;data={drivers:[],groups:[]};candidates=[];for(const id of ['dispatch-drivers','dispatch-groups','dispatch-records'])$(id).replaceChildren();for(const id of ['driver-name','driver-phone','driver-kaspi'])$(id).value='';$('dispatch-message').textContent='';}};
}
root.RazvozkaDispatch={mount};if(typeof module!=='undefined'&&module.exports)module.exports={mount};
})(globalThis);
