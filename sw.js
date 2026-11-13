// パソコン・スマホに「アプリ」として入れられるようにするためのサービスワーカー。
// 中身は保存しない（毎回ネットから読む）。アプリの新しい版はいつもどおり「新しいバージョンがあります」で入れ替わる
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request));
});
