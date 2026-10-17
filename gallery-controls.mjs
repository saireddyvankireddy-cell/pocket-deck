export function sortPhotos(items,order='newest'){
 const result=[...items];if(order==='relevance')return result;const tie=(a,b)=>a.id.localeCompare(b.id);const date=item=>Number(item.addedAt)||0;
 return result.sort((a,b)=>{if(order==='largest')return (Number(b.size)||0)-(Number(a.size)||0)||tie(a,b);if(order==='smallest')return (Number(a.size)||0)-(Number(b.size)||0)||tie(a,b);if(order==='name'||order==='name-desc')return (order==='name-desc'?-1:1)*String(a.fileName||a.name).localeCompare(String(b.fileName||b.name),undefined,{numeric:true})||tie(a,b);if(!date(a)||!date(b))return (date(b)>0)-(date(a)>0)||tie(a,b);return (order==='oldest'?date(a)-date(b):date(b)-date(a))||tie(a,b);});
}
export function rangeSelection(ids,anchor,end,baseline,add=true){const selected=new Set(baseline),a=ids.indexOf(anchor),b=ids.indexOf(end);if(a<0||b<0)return selected;for(const id of ids.slice(Math.min(a,b),Math.max(a,b)+1))add?selected.add(id):selected.delete(id);return selected;}
export class GallerySelection{
 constructor({change,deleteSelected}){this.selected=new Set();this.mode=false;this.change=change;this.deleteSelected=deleteSelected;this.grids=[];}
 scope(key){if(key!==this.key){this.key=key;this.mode=false;this.selected.clear();this.refresh();}}
 attach(grid){
  this.grids.push(grid);
  grid.style.userSelect="none";grid.style.webkitUserSelect="none";
  grid.addEventListener("contextmenu",event=>event.preventDefault());
  const cardAt=target=>target.closest?.('[data-photo-id]');
  const prepare=(card,x,y)=>{clearTimeout(this.hold);this.x=x;this.y=y;this.down=[x,y];this.startCard=card.dataset.photoId;this.moved=false;this.cancelled=false;};
  const begin=()=>{this.mode=true;this.drag=true;this.anchor=this.startCard;this.baseline=new Set(this.selected);this.add=!this.selected.has(this.anchor);this.move(this.anchor);this.suppressClick=true;};
  const finish=()=>{clearTimeout(this.hold);cancelAnimationFrame(this.frame);this.frame=null;this.drag=false;this.pointer=null;this.touchId=null;};
  const tap=()=>{if(this.mode&&!this.moved&&!this.cancelled&&!this.drag){this.selected.has(this.startCard)?this.selected.delete(this.startCard):this.selected.add(this.startCard);this.refresh();}if(this.mode)this.suppressClick=true;};
  // A normal vertical swipe must remain browser scrolling, even in selection mode.
  // Only a held finger becomes a selection gesture; prevent its touchmove default
  // before WebView starts scrolling. Changing touch-action mid-gesture is too late.
  grid.addEventListener('touchstart',event=>{if(event.touches.length!==1){this.cancelled=true;finish();return;}const card=cardAt(event.target);if(!card||event.target.closest('input,select,button.person-remove'))return;const touch=event.touches[0];prepare(card,touch.clientX,touch.clientY);this.touchId=touch.identifier;this.hold=setTimeout(begin,450);},{passive:true});
  grid.addEventListener('touchmove',event=>{const touch=[...event.touches].find(value=>value.identifier===this.touchId);if(!touch)return;this.x=touch.clientX;this.y=touch.clientY;if(!this.drag){if(Math.hypot(this.x-this.down[0],this.y-this.down[1])>10){this.moved=true;clearTimeout(this.hold);}return;}event.preventDefault();this.hit();this.scroll();},{passive:false});
  grid.addEventListener('touchend',()=>{if(this.touchId==null)return;tap();finish();});
  grid.addEventListener('touchcancel',()=>{this.cancelled=true;finish();});
  grid.addEventListener('pointerdown',event=>{if(!['mouse','pen'].includes(event.pointerType))return;const card=cardAt(event.target);if(!card||event.target.closest('input,select,button.person-remove'))return;prepare(card,event.clientX,event.clientY);this.pointer=event.pointerId;const start=()=>{begin();grid.setPointerCapture(event.pointerId);};if(this.mode){event.preventDefault();start();}else this.hold=setTimeout(start,450);});
  grid.addEventListener('pointermove',event=>{if(!['mouse','pen'].includes(event.pointerType)||this.pointer!==event.pointerId)return;this.x=event.clientX;this.y=event.clientY;if(!this.drag&&Math.hypot(this.x-this.down[0],this.y-this.down[1])>10){this.moved=true;clearTimeout(this.hold);}if(!this.drag)return;event.preventDefault();this.hit();this.scroll();});
  grid.addEventListener('pointerup',event=>{if(['mouse','pen'].includes(event.pointerType))finish();});grid.addEventListener('pointercancel',event=>{if(['mouse','pen'].includes(event.pointerType))finish();});
  grid.addEventListener('click',event=>{if(!this.mode&&!this.suppressClick)return;const card=cardAt(event.target);if(card&&!event.target.closest('input,button.person-remove')){event.preventDefault();event.stopPropagation();}this.suppressClick=false;},true);
 }

 ids(){return [...new Set(this.grids.filter(grid=>grid.getClientRects().length).flatMap(grid=>[...grid.querySelectorAll('[data-photo-id]')].map(card=>card.dataset.photoId)))];}
 move(id){const next=rangeSelection(this.ids(),this.anchor,id,this.baseline,this.add);this.selected.clear();for(const value of next)this.selected.add(value);this.refresh();}
 hit(){const card=document.elementFromPoint(this.x,this.y)?.closest('[data-photo-id]');if(card)this.move(card.dataset.photoId);}
 scroll(){if(this.frame)return;const tick=()=>{this.frame=null;if(!this.drag)return;const edge=110,speed=this.y<edge?-14:this.y>innerHeight-edge?14:0;if(speed){window.scrollBy(0,speed);this.hit();this.frame=requestAnimationFrame(tick);}};this.frame=requestAnimationFrame(tick);}
 toggle(){this.mode=!this.mode;if(!this.mode)this.selected.clear();this.refresh();}
 refresh(){for(const grid of this.grids){grid.classList.toggle('selecting',this.mode);for(const card of grid.querySelectorAll('[data-photo-id]')){const active=this.selected.has(card.dataset.photoId);card.classList.toggle('is-selected',active);card.setAttribute('aria-selected',String(active));const box=card.querySelector('input[type=checkbox]');if(box)box.checked=active;}}this.change?.();}
 selectLoaded(){this.mode=true;for(const id of this.ids())this.selected.add(id);this.refresh();}
 clear(){this.selected.clear();this.refresh();}
}
