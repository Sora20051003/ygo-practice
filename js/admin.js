// アカウントの記録と管理ページ（Firebase を使うネット版だけ）
// ・ログインした人は profiles/<uid> に「名前・メール・最後に使った日時・端末・デッキの数」を記録する（1分ごとに更新）
// ・管理者（meta/owner に登録した人）だけが、全員の記録と対戦の部屋の一覧を見られる
// 読み書きできる範囲は firestore.rules で決めている

const ONLINE_MS = 3 * 60 * 1000;   // 最後に使ってから3分以内なら「オンライン中」
const fsNow = () => firebase.firestore.FieldValue.serverTimestamp();
const profileDoc = uid => Online.db.collection('profiles').doc(uid);
const ownerDoc = () => Online.db.collection('meta').doc('owner');

// 端末の種類（だいたい）
function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad'
    : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'その他';
  const br = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  const app = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches ? '・ホーム画面のアプリ' : '';
  return os + (br ? '・' + br : '') + app;
}

// ---------- 自分の記録 ----------
function startPresence() {
  if (!Online.user) return;
  const u = Online.user;
  const write = async first => {
    if (document.hidden && !first) return;
    const data = {
      name: u.displayName || '', email: u.email || '', device: deviceName(),
      lastSeen: fsNow(), deckCount: typeof Decks !== 'undefined' && Decks.list ? Decks.list.length : 0,
      version: typeof APP_VERSION !== 'undefined' ? APP_VERSION : '',
    };
    if (first) {
      data.lastLogin = fsNow();
      data.createdAt = u.metadata && u.metadata.creationTime ? new Date(u.metadata.creationTime) : fsNow();
      data.provider = (u.providerData[0] && u.providerData[0].providerId) || '';
    }
    try { await profileDoc(u.uid).set(data, { merge: true }); } catch (e) { console.warn('アカウントの記録を保存できませんでした', e); }
  };
  write(true);
  setInterval(() => write(false), 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) write(false); });
}

// ---------- 管理者かどうか ----------
async function checkAdmin() {
  if (!Online.user) return;
  try {
    const snap = await ownerDoc().get();
    Online.ownerExists = snap.exists;
    Online.isAdmin = snap.exists && snap.data().uid === Online.user.uid;
  } catch (e) { console.warn('管理者の確認ができませんでした', e); return; }
  renderAdminButton();
}
function renderAdminButton() {
  const box = $('#user-box');
  if (!box || !Online.user) return;
  const old = $('#btn-admin');
  if (old) old.remove();
  if (Online.isAdmin) box.prepend(el('button', { id: 'btn-admin', class: 'btn small', text: '🛡 管理', title: 'アカウントと対戦の部屋の一覧', onclick: openAdmin }));
  else if (Online.ownerExists === false) box.prepend(el('button', { id: 'btn-admin', class: 'btn small', text: '管理者として登録', title: 'まだ管理者がいません。押した人が管理者になります（1人だけ）', onclick: claimOwner }));
}
async function claimOwner() {
  if (!confirm('このアカウントを管理者として登録します。管理者は1人だけで、あとから変えるには Firebase の管理画面での操作が必要です。登録しますか？')) return;
  try {
    await ownerDoc().set({ uid: Online.user.uid, email: Online.user.email || '', at: fsNow() });
    toast('管理者として登録しました');
  } catch (e) { toast('登録できませんでした（すでに管理者がいるかもしれません）：' + e.message); }
  checkAdmin();
}

// ---------- 管理ページ ----------
function openAdmin() {
  if (!Online.isAdmin) return;
  const summary = el('div', { class: 'adm-summary' });
  const userList = el('div', { class: 'adm-table-wrap' });
  const roomList = el('div', { class: 'adm-table-wrap' });
  const filter = el('input', { type: 'search', placeholder: '名前・メールで絞り込み', class: 'adm-filter' });
  let profiles = [], rooms = [];
  const toDate = t => (t && t.toDate ? t.toDate() : t instanceof Date ? t : typeof t === 'number' ? new Date(t) : null);
  const when = t => {
    const d = toDate(t);
    if (!d) return '—';
    const s = (Date.now() - d.getTime()) / 1000;
    if (s < 60) return 'たった今';
    if (s < 3600) return Math.floor(s / 60) + '分前';
    if (s < 86400) return Math.floor(s / 3600) + '時間前';
    return d.toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const isOnline = p => { const d = toDate(p.lastSeen); return !!d && Date.now() - d.getTime() < ONLINE_MS; };
  const draw = () => {
    const q = normalizeText(filter.value);
    const list = profiles.filter(p => !q || normalizeText((p.name || '') + ' ' + (p.email || '')).includes(q))
      .sort((a, b) => (isOnline(b) - isOnline(a)) || ((toDate(b.lastSeen) || 0) - (toDate(a.lastSeen) || 0)));
    const online = profiles.filter(isOnline).length;
    const today = profiles.filter(p => { const d = toDate(p.lastSeen); return d && Date.now() - d.getTime() < 86400000; }).length;
    summary.innerHTML = '';
    summary.append(
      el('div', { class: 'adm-num' }, el('b', { text: String(profiles.length) }), '登録アカウント'),
      el('div', { class: 'adm-num on' }, el('b', { text: String(online) }), 'オンライン中'),
      el('div', { class: 'adm-num' }, el('b', { text: String(today) }), '24時間以内に使った人'),
      el('div', { class: 'adm-num' }, el('b', { text: String(rooms.length) }), '対戦の部屋'));
    userList.innerHTML = '';
    userList.append(el('table', { class: 'adm-table' },
      el('thead', null, el('tr', null, ['', '名前', 'メール', '最後に使った', '登録日', '端末', 'デッキ'].map(h => el('th', { text: h })))),
      el('tbody', null, list.map(p => el('tr', { class: isOnline(p) ? 'on' : '' },
        el('td', { text: isOnline(p) ? '🟢' : '⚪', title: isOnline(p) ? 'オンライン中' : 'オフライン' }),
        el('td', { text: p.name || '（名前なし）' }),
        el('td', { text: p.email || '—' }),
        el('td', { text: when(p.lastSeen) }),
        el('td', { text: toDate(p.createdAt) ? toDate(p.createdAt).toLocaleDateString('ja-JP') : '—' }),
        el('td', { text: p.device || '—' }),
        el('td', { text: p.deckCount != null ? String(p.deckCount) : '—' }))))));
    roomList.innerHTML = '';
    roomList.append(rooms.length ? el('table', { class: 'adm-table' },
      el('thead', null, el('tr', null, ['部屋', '作った人', '参加した人', '作成'].map(h => el('th', { text: h })))),
      el('tbody', null, rooms.map(r => el('tr', null,
        el('td', { text: r.id }),
        el('td', { text: r.hostName || r.host || '—' }),
        el('td', { text: r.guestName || (r.guest ? r.guest : '（待ち）') }),
        el('td', { text: when(r.createdAt) })))))
      : el('p', { class: 'muted', text: '対戦の部屋はありません' }));
  };
  filter.addEventListener('input', draw);
  const offs = [
    Online.db.collection('profiles').onSnapshot(s => { profiles = s.docs.map(d => Object.assign({ uid: d.id }, d.data())); draw(); },
      e => { userList.textContent = '読み込めませんでした：' + e.message; }),
    Online.db.collection('rooms').onSnapshot(s => {
      rooms = s.docs.map(d => Object.assign({ id: d.id }, d.data()))
        .sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0)).slice(0, 30);
      draw();
    }, e => { roomList.textContent = '読み込めませんでした：' + e.message; }),
  ];
  const tick = setInterval(draw, 30 * 1000);   // 「〜分前」の表示を更新
  showModal({
    title: '🛡 管理ページ', wide: true,
    body: el('div', { class: 'adm' },
      summary,
      el('h4', null, 'アカウント', filter),
      el('p', { class: 'muted small-note', text: '「オンライン中」は最後に使ってから3分以内の人です。「ログインしないで使う」を選んだ人はここには出ません。' }),
      userList,
      el('h4', { text: '対戦の部屋（新しい順に30件）' }),
      roomList),
    onClose: () => { offs.forEach(f => f()); clearInterval(tick); },
  });
  draw();
}
