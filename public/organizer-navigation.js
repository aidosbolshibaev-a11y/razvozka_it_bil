(function(root){
 'use strict';
 const routes=['lists','schedule','drivers'];
 function mount(document,browser){
  let authenticated=false;
  const links=[...document.querySelectorAll('[data-organizer-route]')];
  const sidebar=document.getElementById('organizer-sidebar');
  function show(id,{history=true,focus=true}={}){
   if(!routes.includes(id))id='lists';
   for(const route of routes)document.getElementById(route+'-panel').hidden=route!==id;
   for(const link of links){if(link.dataset.organizerRoute===id)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}
   if(history&&browser.location.hash!=='#'+id)browser.history.pushState(null,'','#'+id);
   if(focus&&authenticated){document.getElementById(id==='lists'?'list-title':id==='schedule'?'schedule-title':'drivers-title').focus({preventScroll:true});browser.scrollTo({top:0,behavior:'auto'});}
  }
  const restore=()=>show(browser.location.hash.slice(1),{history:false,focus:false});
  links.forEach(link=>link.addEventListener('click',event=>{if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();show(link.dataset.organizerRoute);}));
  browser.addEventListener('hashchange',restore);browser.addEventListener('popstate',restore);restore();
  return {show,setAuthenticated(value){authenticated=value;sidebar.hidden=!value;if(value)restore();}};
 }
 const api={mount};root.RazvozkaOrganizerNavigation=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(typeof document!=='undefined')Object.assign(api,mount(document,root));
})(globalThis);
