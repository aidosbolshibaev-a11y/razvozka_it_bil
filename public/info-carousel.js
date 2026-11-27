(function(root){
'use strict';
function mount(document,browser){
 const $=id=>document.getElementById(id),region=$('info-carousel');if(!region)return;
 const viewport=$('info-carousel-viewport'),slides=[...viewport.querySelectorAll('.info-guide')],dots=[...region.querySelectorAll('[data-carousel-slide]')];
 const motion=browser.matchMedia('(prefers-reduced-motion: reduce)');let index=0,timer=null,hover=false,focus=false,destroyed=false;
 function stop(){if(timer!==null)browser.clearTimeout(timer);timer=null;}
 function schedule(){stop();if(!destroyed&&!motion.matches&&!hover&&!focus&&!document.hidden&&!$('info').hidden)timer=browser.setTimeout(()=>{show((index+1)%slides.length);},6500);}
 function controls(){dots.forEach((dot,i)=>{if(i===index)dot.setAttribute('aria-current','true');else dot.removeAttribute('aria-current');});$('carousel-count').textContent=(index+1)+' / '+slides.length;}
 function show(next,smooth=true){index=(next+slides.length)%slides.length;viewport.scrollTo({left:slides[index].offsetLeft-viewport.offsetLeft,behavior:smooth&&!motion.matches?'smooth':'instant'});controls();schedule();}
 $('carousel-prev').addEventListener('click',()=>show(index-1));$('carousel-next').addEventListener('click',()=>show(index+1));
 dots.forEach((dot,i)=>dot.addEventListener('click',()=>show(i)));
 region.addEventListener('mouseenter',()=>{hover=true;show(index,false);});region.addEventListener('mouseleave',()=>{hover=false;schedule();});
 region.addEventListener('focusin',e=>{focus=true;const slide=e.target.closest?.('.info-guide');if(slides.includes(slide))show(slides.indexOf(slide),false);else stop();});region.addEventListener('focusout',e=>{focus=region.contains(e.relatedTarget);schedule();});
 viewport.addEventListener('pointerdown',stop);viewport.addEventListener('pointerup',schedule);viewport.addEventListener('pointercancel',schedule);
 viewport.addEventListener('scroll',()=>{const left=viewport.scrollLeft;let closest=0;slides.forEach((slide,i)=>{if(Math.abs(slide.offsetLeft-viewport.offsetLeft-left)<Math.abs(slides[closest].offsetLeft-viewport.offsetLeft-left))closest=i;});index=closest;controls();schedule();},{passive:true});
 viewport.addEventListener('keydown',e=>{if(e.target!==viewport)return;if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();show(index+(e.key==='ArrowRight'?1:-1));}});
 const visibility=()=>schedule();document.addEventListener('visibilitychange',visibility);
 const observer=new browser.MutationObserver(()=>{if(!$('info').hidden)show(index,false);else stop();});observer.observe($('info'),{attributes:true,attributeFilter:['hidden']});
 const resize=new browser.ResizeObserver(()=>show(index,false));resize.observe(viewport);
 const reduce=()=>schedule();motion.addEventListener('change',reduce);
 region.classList.add('carousel-ready');controls();schedule();
 return {destroy(){destroyed=true;stop();observer.disconnect();resize.disconnect();document.removeEventListener('visibilitychange',visibility);motion.removeEventListener('change',reduce);},get index(){return index;}};
}
root.RazvozkaInfoCarousel={mount};if(typeof module!=='undefined'&&module.exports)module.exports={mount};if(typeof document!=='undefined')mount(document,root);
})(globalThis);
