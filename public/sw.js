const C='pr1',A=['/','/style.css','/app.js','/icon.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(A))));
self.addEventListener('fetch',e=>{if(e.request.url.includes('/api/')||e.request.url.includes('/auth/'))return;e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)))});
