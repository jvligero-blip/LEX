// Adaptador leve para o atlas original LexBot v2. Sem dependência do motor ClippyJS.
export class LexBot {
 constructor({userId,reduced=false,messages=true}){
  if(!userId)throw new Error('LexBot requer conta autenticada');
  document.getElementById('lexbot')?.remove();this.userId=userId;this.reduced=reduced||matchMedia('(prefers-reduced-motion: reduce)').matches;this.messages=messages;this.abort=new AbortController();this.seen=new Map();this.dead=false;
  const node=document.createElement('aside');node.id='lexbot';node.setAttribute('aria-label','LexBot, assistente visual');
  node.innerHTML='<div class="lexbot-message" role="status" aria-live="polite" hidden></div><div class="lexbot-toolbar"><button type="button" data-bot="min" aria-label="Minimizar LexBot">−</button><button type="button" data-bot="off" aria-label="Desativar LexBot">×</button></div><button class="lexbot-sprite" type="button" title="LexBot — arraste para reposicionar" aria-label="LexBot"></button><button class="lexbot-mini" type="button" data-bot="restore" aria-label="Restaurar LexBot"><img src="/assets/lexbot/icon.png" alt="">LexBot</button>';
  document.body.append(node);document.body.classList.add('lexbot-space');this.node=node;
  const p=this.prefs();if(p.botMinimized)node.classList.add('minimized');
  if(p.botPosition){const x=Math.min(innerWidth-140,Math.max(0,p.botPosition.x)),y=Math.min(innerHeight-160,Math.max(0,p.botPosition.y));node.style.left=x+'px';node.style.top=y+'px';node.style.right='auto';node.style.bottom='auto';}
  node.addEventListener('click',e=>{const action=e.target.closest('[data-bot]')?.dataset.bot;if(action==='off'){this.write({botEnabled:false});this.destroy();return;}if(action==='min'||action==='restore'){const min=action==='min';node.classList.toggle('minimized',min);this.write({botMinimized:min});if(min)clearTimeout(this.timer);else this.play('Idle1_1');}},{signal:this.abort.signal});
  let drag=null;const sprite=node.querySelector('.lexbot-sprite');
  sprite.addEventListener('pointerdown',e=>{const r=node.getBoundingClientRect();drag={x:e.clientX-r.left,y:e.clientY-r.top};sprite.setPointerCapture(e.pointerId);},{signal:this.abort.signal});
  sprite.addEventListener('pointermove',e=>{if(!drag)return;node.style.left=Math.max(0,Math.min(innerWidth-node.offsetWidth,e.clientX-drag.x))+'px';node.style.top=Math.max(0,Math.min(innerHeight-node.offsetHeight,e.clientY-drag.y))+'px';node.style.right='auto';node.style.bottom='auto';},{signal:this.abort.signal});
  sprite.addEventListener('pointerup',()=>{if(drag){const r=node.getBoundingClientRect();this.write({botPosition:{x:r.left,y:r.top}});}drag=null;},{signal:this.abort.signal});
  this.ready=this.load();
 }
 prefs(){try{return JSON.parse(localStorage.getItem('lex_v3_preferences_'+this.userId)||'{}');}catch{return {};}}
 write(change){try{localStorage.setItem('lex_v3_preferences_'+this.userId,JSON.stringify({...this.prefs(),...change}));}catch{}}
 async load(){try{const r=await fetch('/assets/lexbot/agent.json');if(!r.ok)throw new Error('atlas');this.data=await r.json();await new Promise((resolve,reject)=>{const img=new Image();img.onload=resolve;img.onerror=reject;img.src='/assets/lexbot/map.png';});if(!this.dead)this.play(this.queued||'Idle1_1');}catch{if(!this.dead){this.node.classList.add('static');this.node.querySelector('.lexbot-sprite').style.backgroundImage='url(/assets/lexbot/icon.png)';}}}
 play(name){
  clearTimeout(this.timer);if(this.dead)return;this.queued=name;if(!this.data||this.node.classList.contains('minimized'))return;
  const frames=this.data.animations[name]?.frames||this.data.animations.Idle1_1.frames;let i=0;
  const tick=()=>{if(this.dead)return;const frame=frames[i],image=frame.images?.[0];if(image)this.node.querySelector('.lexbot-sprite').style.backgroundPosition=`-${image[0]}px -${image[1]}px`;
   if(this.reduced)return;i++;if(i>=frames.length){if(name==='Idle1_1')i=0;else{this.play('Idle1_1');return;}}this.timer=setTimeout(tick,Math.max(80,frame.duration||200));};tick();
 }
 notify(animation,message){if(this.dead)return;const now=Date.now();if(now-(this.seen.get(animation)||0)<30000)return;this.seen.set(animation,now);this.play(animation);if(this.messages){const bubble=this.node.querySelector('.lexbot-message');bubble.textContent=message;bubble.hidden=false;clearTimeout(this.bubbleTimer);this.bubbleTimer=setTimeout(()=>{bubble.hidden=true;},10000);}}
 daily(animation,message){const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date());if(this.prefs().botDay===day)return;this.write({botDay:day});this.notify(animation,message);}
 destroy(){if(this.dead)return;this.dead=true;clearTimeout(this.timer);clearTimeout(this.bubbleTimer);this.abort.abort();this.node?.remove();document.body.classList.remove('lexbot-space');}
}
