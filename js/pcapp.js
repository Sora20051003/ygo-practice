// ---------- パソコンの独立したアプリにする（PWA） ----------
// Chrome・Edge で「💻 アプリとして入れる」を押すと、インストールの画面が出る。入れると、スタートメニュー・デスクトップから
// ブラウザとは別のウィンドウで開ける（タブやアドレスバーが無い）。中身はネット版と同じで、新しい版も自動で入れ替わる
const PcApp = { prompt: null };
// パソコン（マウスで操作する画面）は、全画面ではなくふつうのウィンドウで開くアプリにする（スマホは今までどおり全画面）
if (matchMedia('(pointer: fine)').matches) { const l = document.querySelector('link[rel="manifest"]'); if (l) l.href = 'manifest-pc.webmanifest'; }
const pcInstalled = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: window-controls-overlay), (display-mode: minimal-ui)').matches;
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* 入れられなくてもネット版はそのまま使える */ });
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); PcApp.prompt = e; pcAppButton(); });
window.addEventListener('appinstalled', () => { PcApp.prompt = null; pcAppButton(); toast('アプリとして入れました。スタートメニューやデスクトップから開けます'); });
function pcAppButton() {
  const b = document.getElementById('btn-pcapp');
  if (b) b.hidden = pcInstalled();
}
async function openPcApp() {
  if (pcInstalled()) { toast('今はアプリとして開いています'); return; }
  if (PcApp.prompt) {
    PcApp.prompt.prompt();
    try { await PcApp.prompt.userChoice; } catch { /* 閉じただけ */ }
    PcApp.prompt = null;
    return;
  }
  // インストールの画面を出せないブラウザ：やり方を説明する
  const ua = navigator.userAgent;
  const how = /Edg\//.test(ua) ? '右上の「…」→「アプリ」→「このサイトをアプリとしてインストール」'
    : /Chrome\//.test(ua) ? '右上の「︙」→「キャスト、保存、共有」→「ページをアプリとしてインストール」（またはアドレスバーの右の 💻 のマーク）'
    : 'Chrome か Edge で開くと、アプリとして入れられます（Firefox・Safari はパソコンでは入れられません）';
  showModal({ title: '💻 アプリとして入れる', body: el('div', { class: 'stack' },
    el('p', { text: '入れると、ブラウザとは別のウィンドウ（タブやアドレスバーの無い画面）で開けるようになります。スタートメニューやデスクトップから起動できます。中身はネット版と同じで、新しい版にも自動で入れ替わります。' }),
    el('p', {}, el('b', { text: 'やり方：' }), how),
    el('p', { class: 'muted small-note', text: 'すでに入れている場合は、スタートメニューの「遊戯王 展開練習」から開けます。' })) });
}
document.addEventListener('DOMContentLoaded', pcAppButton);
pcAppButton();
