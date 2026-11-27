(function(root){
'use strict';
function mount(document,browser){
 const $=id=>document.getElementById(id),region=$('info-carousel');if(!region)return;
 const viewport=$('info-carousel-viewport'),slides=[...viewport.querySelectorAll('.info-guide')];
 const motion=browser.matchMedia('(prefers-reduced-motion: reduce)');let index=0,timer=null,held=null,keyboardFocus=false,destroyed=false;
 function stop(){if(timer!==null)browser.clearTimeout(timer);timer=null;}
 function schedule(){stop();if(!destroyed&&!motion.matches&&held===null&&!keyboardFocus&&!document.hidden&&!$('info').hidden)timer=browser.setTimeout(()=>show((index+1)%slides.length),2000);}
 function show(next,smooth=true){index=(next+slides.length)%slides.length;viewport.scrollTo({left:slides[index].offsetLeft-viewport.offsetLeft,behavior:smooth&&!motion.matches?'smooth':'instant'});schedule();}
 region.addEventListener('pointerdown',e=>{if(e.isPrimary===false||e.button>0)return;held=e.pointerId;show(index,false);});
 const release=e=>{if(held===null||e.pointerId!==held)return;held=null;schedule();};
 browser.addEventListener('pointerup',release);browser.addEventListener('pointercancel',release);
 const blur=()=>{held=null;schedule();};browser.addEventListener('blur',blur);
 region.addEventListener('focusin',e=>{keyboardFocus=!!e.target.matches?.(':focus-visible');const slide=e.target.closest?.('.info-guide');if(slides.includes(slide))show(slides.indexOf(slide),false);else schedule();});
 region.addEventListener('focusout',e=>{keyboardFocus=region.contains(e.relatedTarget)&&!!e.relatedTarget?.matches?.(':focus-visible');schedule();});
 viewport.addEventListener('scroll',()=>{const left=viewport.scrollLeft;let closest=0;slides.forEach((slide,i)=>{if(Math.abs(slide.offsetLeft-viewport.offsetLeft-left)<Math.abs(slides[closest].offsetLeft-viewport.offsetLeft-left))closest=i;});index=closest;schedule();},{passive:true});
 viewport.addEventListener('keydown',e=>{if(e.target!==viewport)return;if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();keyboardFocus=true;show(index+(e.key==='ArrowRight'?1:-1));}});
 const visibility=()=>schedule();document.addEventListener('visibilitychange',visibility);
 const observer=new browser.MutationObserver(()=>{if(!$('info').hidden)show(index,false);else stop();});observer.observe($('info'),{attributes:true,attributeFilter:['hidden']});
 const resize=new browser.ResizeObserver(()=>show(index,false));resize.observe(viewport);
 const reduce=()=>schedule();motion.addEventListener('change',reduce);schedule();
 return {destroy(){destroyed=true;stop();observer.disconnect();resize.disconnect();document.removeEventListener('visibilitychange',visibility);motion.removeEventListener('change',reduce);browser.removeEventListener('pointerup',release);browser.removeEventListener('pointercancel',release);browser.removeEventListener('blur',blur);},get index(){return index;}};
}
root.RazvozkaInfoCarousel={mount};if(typeof module!=='undefined'&&module.exports)module.exports={mount};if(typeof document!=='undefined')mount(document,root);
})(globalThis);
