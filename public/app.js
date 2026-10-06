const $=s=>document.querySelector(s);let ME,cur,liked=new Set();
const api=(p,b)=>fetch(p,b?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{}).then(r=>r.json().catch(()=>({})));
const note=t=>{const n=$('#note');n.textContent=t;n.style.display='block';setTimeout(()=>n.style.display='none',4000)};
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js');
async function boot(){const r=await fetch('/api/me');if(!r.ok){$('#auth').hidden=false;$('#app').hidden=true;return}
ME=await r.json();$('#auth').hidden=true;$('#app').hidden=false;$('#autoplay').checked=ME.settings.autoplay;$('#muted').checked=ME.settings.muted;plats();feed()}
async function auth(k){const r=await api('/api/'+k,{name:$('#u').value,password:$('#p').value});r.error?$('#aerr').textContent=r.error:boot()}
$('#login').onclick=()=>auth('login');$('#signup').onclick=()=>auth('signup');
$('#logout').onclick=async()=>{await api('/api/logout',{});location.reload()};
$('#home').onclick=()=>{$('#q').value='';feed()};$('#sf').onsubmit=e=>{e.preventDefault();feed($('#q').value)};
$('#gear').onclick=()=>$('#set').hidden=false;$('#close').onclick=()=>$('#set').hidden=true;
$('#autoplay').onchange=e=>api('/api/settings',{autoplay:e.target.checked});$('#muted').onchange=e=>api('/api/settings',{muted:e.target.checked});
const P=[['youtube','YouTube','Official sign-in. Likes and comments sync.'],['smolish','Smolish','Unofficial. Paste your smolish.com session cookie.'],['tiktok','TikTok','Not available: TikTok gives apps no feed or likes.'],['instagram','Instagram','Not available: Instagram gives apps no feed or likes.']];
function plats(){$('#plats').innerHTML='';P.forEach(([k,n,d])=>{const ok=k==='youtube'||k==='smolish',on=ME.linked[k],h=ME.settings.hidden[k];const el=document.createElement('div');el.className='pl';
el.innerHTML=`<b>${n}</b><small>${d}</small>`;if(ok){const b=document.createElement('button');b.textContent=on?'Disconnect':'Connect';b.className=on?'ghost':'';
b.onclick=async()=>{if(on){await api('/api/unlink/'+k,{});ME.linked[k]=false;plats();feed()}else if(k==='youtube')location='/auth/youtube';else{const c=prompt('Paste your Smolish session cookie');if(c){await api('/api/link/smolish',{cookie:c});ME.linked[k]=true;plats();feed()}}};el.append(b);
if(on){const l=document.createElement('label');l.innerHTML=`<input type=checkbox ${h?'':'checked'}> Show in feed`;l.firstChild.onchange=async e=>{ME.settings.hidden[k]=!e.target.checked;await api('/api/settings',{hidden:ME.settings.hidden});feed()};el.append(l)}}$('#plats').append(el)})}
async function feed(q=''){const f=$('#feed');f.innerHTML='';const r=await api('/api/feed?q='+encodeURIComponent(q));(r.notes||[]).forEach(note);
if(!r.items?.length){f.innerHTML='<div class="empty"><b>Nothing to show yet</b><p>Connect YouTube or Smolish in Settings to fill your feed.</p></div>';return}
r.items.forEach(v=>{const s=document.createElement('section');s.className='v';s.dataset.k=v.platform+':'+v.id;
s.innerHTML=`<div class="card">${v.embed?'':`<video src="${v.src}" poster="${v.poster}" loop playsinline ${ME.settings.muted?'muted':''}></video>`}<div class="cap"><span class="tag">${v.platform}</span><b></b><small></small></div></div><div class="acts"><button aria-label="Like">♥</button><button aria-label="Comment">✎</button><button aria-label="Share">⇪</button></div>`;
s.querySelector('b').textContent=v.title;s.querySelector('small').textContent=v.author;const[a,c,sh]=s.querySelectorAll('.acts button');
a.onclick=async()=>{const r=await api('/api/like',v);r.ok?(a.classList.add('on'),liked.add(s.dataset.k)):note(r.error||'Like failed')};
c.onclick=()=>{cur=v;$('#ct').value='';$('#cm').showModal()};
sh.onclick=()=>{const u=v.embed?'https://youtube.com/shorts/'+v.id:'https://smolish.com/video/'+v.id;navigator.share?navigator.share({url:u}):navigator.clipboard.writeText(u).then(()=>note('Link copied'))};
f.append(s);s._v=v});io.disconnect();document.querySelectorAll('.v').forEach(x=>io.observe(x))}
const io=new IntersectionObserver(es=>es.forEach(e=>{const v=e.target._v;if(v.embed&&e.isIntersecting&&!e.target.querySelector('iframe')){const i=document.createElement('iframe');i.allow='autoplay;encrypted-media';i.src=v.embed+(ME.settings.autoplay?'&autoplay=1':'')+(ME.settings.muted?'&mute=1':'');e.target.querySelector('.card').prepend(i)}
if(v.embed&&!e.isIntersecting)e.target.querySelector('iframe')?.remove();const m=e.target.querySelector('video');if(m)e.isIntersecting&&ME.settings.autoplay?m.play().catch(()=>{}):m.pause()}),{threshold:.7});
$('#cm').onclose=async()=>{if($('#cm').returnValue==='go'&&$('#ct').value.trim()){const r=await api('/api/comment',{...cur,text:$('#ct').value});note(r.ok?'Comment posted':r.error||'Comment failed')}};
boot();
