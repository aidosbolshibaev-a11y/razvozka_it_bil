(function(root){
 'use strict';
 function mount(document,rpc){
  const $=id=>document.getElementById(id);let generation=0,busy=false,visible=false;
  const controls=['point-city','point-address','point-add','departure-dir','departure-time','departure-add','catalog-reload'];
  function lock(value){busy=value;for(const id of controls)$(id).disabled=value;}
  function render(data){
   const c=root.RazvozkaTripCatalog.parse(data);$('catalog-points').replaceChildren();$('catalog-times').replaceChildren();
   for(const p of c.points){const li=document.createElement('li');li.textContent=(p.city==='astana'?'Астана':'Щучинск')+' · '+p.address;$('catalog-points').append(li);}
   for(const dir of ['fri','sun']){const li=document.createElement('li');li.textContent=(dir==='fri'?'Щучинск → Астана':'Астана → Щучинск')+' · '+c.slots[dir].car.join(', ');$('catalog-times').append(li);}
  }
  async function run(fn,args,field){
   if(!visible||busy)return;const op=++generation;lock(true);$('catalog-message').textContent='Загрузка…';
   try{
    if(fn){const result=await rpc(fn,args);if(op!==generation)return;if(!result||result.ok!==true)throw Error(result?.error==='duplicate'?'Такой вариант уже есть.':'Не удалось сохранить.');if(field)$(field).value='';}
    const data=await rpc('trip_catalog',{});if(op!==generation)return;render(data);
    $('catalog-message').textContent=fn?'Сохранено. Родителям нужно обновить варианты в форме или открыть страницу заново.':'Варианты обновлены.';
   }catch(e){if(op===generation)$('catalog-message').textContent=(fn?'Если связь прервалась после сохранения, обновите варианты перед повтором. ':'')+e.message;}
   finally{if(op===generation)lock(false);}
  }
  $('point-form').addEventListener('submit',e=>{e.preventDefault();const address=$('point-address').value.trim().replace(/\s+/g,' ');if(address.length<5||address.length>200){$('catalog-message').textContent='Укажите адрес от 5 до 200 символов.';return;}return run('organizer_add_point',{p_city:$('point-city').value,p_address:address},'point-address');});
  $('departure-form').addEventListener('submit',e=>{e.preventDefault();const time=$('departure-time').value;if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)){$('catalog-message').textContent='Укажите время в формате ЧЧ:ММ.';return;}return run('organizer_add_time',{p_dir:$('departure-dir').value,p_time:time},'departure-time');});
  $('catalog-reload').addEventListener('click',()=>run());
  return {open(){visible=true;$('catalog-admin').hidden=false;return run();},clear(){visible=false;generation++;lock(false);$('catalog-admin').hidden=true;$('catalog-points').replaceChildren();$('catalog-times').replaceChildren();$('point-address').value='';$('departure-time').value='';$('catalog-message').textContent='';}};
 }
 root.RazvozkaCatalogAdmin={mount};
 if(typeof module!=='undefined'&&module.exports)module.exports={mount};
})(globalThis);
