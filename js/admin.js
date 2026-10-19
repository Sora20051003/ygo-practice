// アカウントの記録と管理ページ（Supabase を使うネット版だけ）
// ・ログインした人は profiles 表に「名前・メール・最後に使った日時・端末・デッキの数」を記録する（1分ごとに更新）
// ・管理者（app_owner 表に登録した1人）だけが、全員の記録と対戦の部屋の一覧を見られる
// 読み書きできる範囲は supabase/setup.sql の決まり（RLS）で守っている

const ONLINE_MS = 3 * 60 * 1000;   // 最後に使ってから3分以内なら「オンライン中」

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
    const now = new Date().toISOString();
    const row = {
      uid: u.uid, name: u.displayName || '', email: u.email || '', device: deviceName(), last_seen: now,
      deck_count: typeof Decks !== 'undefined' && Decks.list ? Decks.list.length : 0,
      version: typeof APP_VERSION !== 'undefined' ? APP_VERSION : '',
    };
    if (first) { row.last_login = now; row.created_at = u.createdAt || now; row.provider = u.provider || ''; }
    const { error } = await Online.sb.from('profiles').upsert(row);
    if (error) console.warn('アカウントの記録を保存できませんでした', error);
    await writeDevice(now);
  };
  write(true);
  setInterval(() => write(false), 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) write(false); });
}

// ---------- 端末ごとの記録 ----------
// 端末ごとにランダムな番号を作って覚えておく（ログアウトさせられたら作り直す）
function myDeviceId() {
  let id = null;
  try { id = localStorage.getItem('ygo.deviceId'); } catch { /* 使えなくてもよい */ }
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now().toString(36));
    try { localStorage.setItem('ygo.deviceId', id); } catch { /* 使えなくてもよい */ }
  }
  return id;
}
// 今のログインの番号（ログインの鍵 JWT の中の session_id）
async function mySessionId() {
  try {
    const { data } = await Online.sb.auth.getSession();
    const t = data && data.session && data.session.access_token;
    if (!t) return null;
    const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return p.session_id || null;
  } catch { return null; }
}
async function writeDevice(now) {
  if (!Online.user) return;
  const row = { uid: Online.user.uid, device_id: myDeviceId(), device: deviceName(), version: typeof APP_VERSION !== 'undefined' ? APP_VERSION : '', last_seen: now };
  const sid = await mySessionId();
  if (sid) row.session_id = sid;
  const { error } = await Online.sb.from('user_devices').upsert(row);
  if (error) { console.warn('端末の記録を保存できませんでした', error); return; }
  // 管理者（または本人がほかの端末から）この端末をログアウトさせていたら、ログアウトする
  const { data } = await Online.sb.from('user_devices').select('revoked_at').eq('uid', Online.user.uid).eq('device_id', row.device_id).maybeSingle();
  if (data && data.revoked_at) forcedLogout();
}
async function forcedLogout() {
  if (Online.forcedOut) return;
  Online.forcedOut = true;
  try { localStorage.removeItem('ygo.deviceId'); } catch { /* 使えなくてもよい */ }
  try { await Online.sb.auth.signOut({ scope: 'local' }); } catch { /* すでに無効でもよい */ }
  alert('この端末は、ほかの端末（または管理者）の操作でログアウトされました。もう一度ログインすると使えます。');
  location.reload();
}

// 端末の一覧（本人用の画面と管理ページで使う）
function deviceTable(devices, { onRevoke, currentId } = {}) {
  if (!devices.length) return el('p', { class: 'muted', text: '端末の記録はまだありません' });
  const sorted = [...devices].sort((a, b) => (!!a.revoked_at - !!b.revoked_at) || (new Date(b.last_seen || 0) - new Date(a.last_seen || 0)));
  return el('div', { class: 'adm-table-wrap' }, el('table', { class: 'adm-table adm-dev' },
    el('thead', null, el('tr', null, ['端末', '最後に使った', '初めて使った', '状態', ''].map(h => el('th', { text: h })))),
    el('tbody', null, sorted.map(d => el('tr', { class: d.revoked_at ? 'revoked' : '' },
      el('td', { text: (d.device || '—') + (d.device_id === currentId ? '（この端末）' : '') }),
      el('td', { text: admWhen(d.last_seen) }),
      el('td', { text: admWhen(d.first_seen) }),
      el('td', { text: d.revoked_at ? 'ログアウト済み（' + admWhen(d.revoked_at) + '）' : 'ログイン中' }),
      el('td', null, !d.revoked_at && d.device_id !== currentId && onRevoke
        ? el('button', { class: 'btn small danger', text: 'ログアウトさせる', onclick: () => onRevoke(d) }) : null))))));
}
function admWhen(t) {
  const d = t ? new Date(t) : null;
  if (!d || isNaN(d)) return '—';
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'たった今';
  if (s < 3600) return Math.floor(s / 60) + '分前';
  if (s < 86400) return Math.floor(s / 3600) + '時間前';
  return d.toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
const setupHint = e => '読み込めませんでした：' + (e && e.message || e) + '（サーバーの準備がまだのときは、supabase/setup.sql をもう一度実行してください）';

// 本人用：自分のアカウントでログインしている端末（なくした・壊れた端末をログアウトさせる）
async function openMyDevices() {
  if (!Online.user) return;
  const box = el('div', { class: 'adm' }, el('p', { class: 'muted', text: '読み込み中…' }));
  const close = showModal({ title: '📱 ログインしている端末', wide: true, body: box });
  const load = async () => {
    const { data, error } = await Online.sb.from('user_devices').select('*').eq('uid', Online.user.uid);
    box.innerHTML = '';
    if (error) { box.append(el('p', { class: 'warn', text: setupHint(error) })); return; }
    box.append(
      el('div', { class: 'adm-actions' },
        el('span', { class: 'muted', text: 'ID：' + (Online.user.loginId || '—') }),
        el('button', { class: 'btn small', text: '🔑 パスワードを変える', onclick: askNewPassword })),
      el('p', { class: 'muted small-note', text: '壊れた・なくした端末は「ログアウトさせる」を押すと、その端末ではログインが切れます（次にその端末で開いたとき、またはしばらくたってから）。' }),
      deviceTable(data || [], { currentId: myDeviceId(), onRevoke: async d => {
        if (!confirm(`「${d.device || '端末'}」をログアウトさせますか？`)) return;
        const { error: e } = await Online.sb.rpc('revoke_device', { p_uid: Online.user.uid, p_device_id: d.device_id });
        toast(e ? 'できませんでした：' + e.message : 'ログアウトさせました');
        load();
      } }));
  };
  load();
  return close;
}

// ---------- 管理者かどうか ----------
async function checkAdmin() {
  if (!Online.user) return;
  const { data, error } = await Online.sb.from('app_owner').select('uid').maybeSingle();
  if (error) { console.warn('管理者の確認ができませんでした', error); return; }
  Online.ownerExists = !!data;
  Online.isAdmin = !!data && data.uid === Online.user.uid;
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
  if (!confirm('このアカウントを管理者として登録します。管理者は1人だけで、あとから変えるには Supabase の管理画面での操作が必要です。登録しますか？')) return;
  const { error } = await Online.sb.from('app_owner').insert({ id: 1, uid: Online.user.uid });
  toast(error ? '登録できませんでした（すでに管理者がいるかもしれません）：' + error.message : '管理者として登録しました');
  checkAdmin();
}

// ---------- 1つのアカウントを管理する画面（管理者） ----------
// 故障・紛失でその端末からログインできなくなった人のために：端末をログアウトさせる、パスワードを決め直す、デッキを保存する
async function openAccountAdmin(acc, onChanged) {
  if (!Online.isAdmin) return;
  const sb = Online.sb;
  const box = el('div', { class: 'adm' }, el('p', { class: 'muted', text: '読み込み中…' }));
  showModal({ title: '👤 ' + (acc.name || emailToId(acc.email) || 'アカウント'), wide: true, body: box, onClose: () => onChanged && onChanged() });
  const done = (error, okText) => { toast(error ? 'できませんでした：' + (error.message || error) : okText); load(); };
  const load = async () => {
    const [dv, dk] = await Promise.all([
      sb.from('user_devices').select('*').eq('uid', acc.uid),
      sb.from('user_decks').select('decks,updated_at').eq('uid', acc.uid).maybeSingle(),
    ]);
    const decks = (dk.data && dk.data.decks) || [];
    box.innerHTML = '';
    box.append(
      el('div', { class: 'adm-info' },
        el('div', null, el('b', { text: '名前：' }), acc.name || '（なし）'),
        el('div', null, el('b', { text: isIdAccount(acc.email) ? 'ID：' : 'メール：' }), emailToId(acc.email) || '—'),
        el('div', null, el('b', { text: '登録日：' }), admWhen(acc.created_at)),
        el('div', null, el('b', { text: '最後にログイン：' }), admWhen(acc.last_sign_in_at || acc.last_login)),
        el('div', null, el('b', { text: 'デッキ：' }), `${decks.length}個` + (dk.data ? `（最後の保存 ${admWhen(dk.data.updated_at)}）` : '')),
        el('div', { class: 'muted small-note', text: 'ID：' + acc.uid })),
      el('h4', { text: 'ログインしている端末' }),
      dv.error ? el('p', { class: 'warn', text: setupHint(dv.error) }) : deviceTable(dv.data || [], { currentId: acc.uid === Online.user.uid ? myDeviceId() : null, onRevoke: async d => {
        if (!confirm(`「${d.device || '端末'}」をログアウトさせますか？`)) return;
        const { error } = await sb.rpc('revoke_device', { p_uid: acc.uid, p_device_id: d.device_id });
        done(error, 'ログアウトさせました');
      } }),
      el('h4', { text: '操作' }),
      el('div', { class: 'adm-actions' },
        el('button', { class: 'btn danger', text: '🚪 すべての端末からログアウトさせる', onclick: async () => {
          if (!confirm('このアカウントを、すべての端末からログアウトさせますか？（本人はもう一度ログインすれば使えます）')) return;
          const { error } = await sb.rpc('admin_signout_all', { p_uid: acc.uid });
          done(error, 'すべての端末からログアウトさせました');
        } }),
        el('button', { class: 'btn', text: '✉ パスワード再設定のメールを送る', disabled: !acc.email || isIdAccount(acc.email), title: isIdAccount(acc.email) ? 'ID で作ったアカウントはメールを受け取れません。「仮のパスワードを決める」を使ってください' : '', onclick: async () => {
          if (!confirm(`${acc.email} にパスワード再設定のメールを送りますか？`)) return;
          const { error } = await sb.auth.resetPasswordForEmail(acc.email, { redirectTo: location.origin + location.pathname });
          done(error, 'メールを送りました。本人がメールのリンクを開くと、新しいパスワードを決められます');
        } }),
        el('button', { class: 'btn', text: '🔑 仮のパスワードを決める', onclick: () => {
          promptText('仮のパスワード（6文字以上。本人に伝えて、ログイン後に変えてもらってください）', '', async pw => {
            if (pw.length < 6) { toast('6文字以上にしてください'); return false; }
            const { error } = await sb.rpc('admin_set_password', { p_uid: acc.uid, p_password: pw });
            done(error, 'パスワードを変えました。新しい端末で、このパスワードでログインできます');
          });
        } }),
        el('button', { class: 'btn', text: '💾 デッキをファイルに保存', disabled: !decks.length, onclick: () => {
          downloadText(`decks-${(emailToId(acc.email) || acc.name || acc.uid).replace(/[\\/:*?"<>|@]/g, '_')}.json`, JSON.stringify({ app: 'ygo-practice', decks }, null, 2));
        } })),
      el('p', { class: 'muted small-note', text: '「ログアウトさせる」は、その端末が次に開いたとき（開いたままなら1分以内）に切れます。サーバー側のログインも無効にするので、しばらくすると必ず切れます。' }));
  };
  load();
}

// ---------- 管理ページ ----------
function openAdmin() {
  if (!Online.isAdmin) return;
  const summary = el('div', { class: 'adm-summary' });
  const userList = el('div', { class: 'adm-table-wrap' });
  const roomList = el('div', { class: 'adm-table-wrap' });
  const filter = el('input', { type: 'search', placeholder: '名前・メールで絞り込み', class: 'adm-filter' });
  const updated = el('span', { class: 'muted small-note' });
  let profiles = [], rooms = [];
  const toDate = t => (t ? new Date(t) : null);
  const when = t => {
    const d = toDate(t);
    if (!d || isNaN(d)) return '—';
    const s = (Date.now() - d.getTime()) / 1000;
    if (s < 60) return 'たった今';
    if (s < 3600) return Math.floor(s / 60) + '分前';
    if (s < 86400) return Math.floor(s / 3600) + '時間前';
    return d.toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const isOnline = p => { const d = toDate(p.last_seen); return !!d && Date.now() - d.getTime() < ONLINE_MS; };
  const draw = () => {
    const q = normalizeText(filter.value);
    const list = profiles.filter(p => !q || normalizeText((p.name || '') + ' ' + emailToId(p.email)).includes(q))
      .sort((a, b) => (isOnline(b) - isOnline(a)) || ((toDate(b.last_seen) || 0) - (toDate(a.last_seen) || 0)));
    const online = profiles.filter(isOnline).length;
    const today = profiles.filter(p => { const d = toDate(p.last_seen); return d && Date.now() - d.getTime() < 86400000; }).length;
    summary.innerHTML = '';
    summary.append(
      el('div', { class: 'adm-num' }, el('b', { text: String(profiles.length) }), '登録アカウント'),
      el('div', { class: 'adm-num on' }, el('b', { text: String(online) }), 'オンライン中'),
      el('div', { class: 'adm-num' }, el('b', { text: String(today) }), '24時間以内に使った人'),
      el('div', { class: 'adm-num' }, el('b', { text: String(rooms.length) }), '対戦の部屋'));
    userList.innerHTML = '';
    userList.append(el('table', { class: 'adm-table' },
      el('thead', null, el('tr', null, ['', '名前', 'ID / メール', '最後に使った', '登録日', '端末', 'デッキ', ''].map(h => el('th', { text: h })))),
      el('tbody', null, list.map(p => el('tr', { class: isOnline(p) ? 'on' : '' },
        el('td', { text: isOnline(p) ? '🟢' : '⚪', title: isOnline(p) ? 'オンライン中' : 'オフライン' }),
        el('td', { text: p.name || '（名前なし）' }),
        el('td', { text: emailToId(p.email) || '—' }),
        el('td', { text: when(p.last_seen) }),
        el('td', { text: toDate(p.created_at) ? toDate(p.created_at).toLocaleDateString('ja-JP') : '—' }),
        el('td', { text: p.device || '—' }),
        el('td', { text: p.deck_count != null ? String(p.deck_count) : '—' }),
        el('td', null, el('button', { class: 'btn small', text: '管理…', title: '端末のログアウト・パスワード・デッキの保存', onclick: () => openAccountAdmin(p, load) })))))));
    roomList.innerHTML = '';
    roomList.append(rooms.length ? el('table', { class: 'adm-table' },
      el('thead', null, el('tr', null, ['部屋', '作った人', '参加した人', '状態', '作成'].map(h => el('th', { text: h })))),
      el('tbody', null, rooms.map(r => el('tr', null,
        el('td', { text: r.code }),
        el('td', { text: (r.data && r.data.hostName) || '—' }),
        el('td', { text: (r.data && r.data.guestName) || '（待ち）' }),
        el('td', { text: ({ waiting: '待ち', playing: '対戦中', ended: '終了' })[r.data && r.data.status] || '—' }),
        el('td', { text: when(r.created_at) })))))
      : el('p', { class: 'muted', text: '対戦の部屋はありません' }));
  };
  // 20秒ごとに読み直す
  const load = async () => {
    const [p, au, r] = await Promise.all([
      Online.sb.from('profiles').select('*'),
      Online.sb.rpc('admin_users'),
      Online.sb.from('rooms').select('code,data,created_at').order('created_at', { ascending: false }).limit(30),
    ]);
    if (p.error) userList.textContent = '読み込めませんでした：' + p.error.message;
    else {
      // 記録（profiles）に、登録されている全アカウント（admin_users）を合わせる。まだ一度も記録のない人も出す
      const byUid = new Map((p.data || []).map(x => [x.uid, { ...x }]));
      if (!au.error) for (const a of au.data || []) { const x = byUid.get(a.uid) || { uid: a.uid, email: a.email, created_at: a.created_at }; x.email = x.email || a.email; x.last_sign_in_at = a.last_sign_in_at; x.confirmed = a.confirmed; byUid.set(a.uid, x); }
      profiles = [...byUid.values()];
    }
    if (r.error) roomList.textContent = '読み込めませんでした：' + r.error.message; else rooms = r.data || [];
    updated.textContent = '（' + new Date().toLocaleTimeString('ja-JP') + ' 時点・20秒ごとに更新）';
    if (!p.error && !r.error) draw();
  };
  filter.addEventListener('input', draw);
  const tick = setInterval(load, 20 * 1000);
  showModal({
    title: '🛡 管理ページ', wide: true,
    body: el('div', { class: 'adm' },
      summary, updated,
      el('h4', null, 'アカウント', filter),
      el('p', { class: 'muted small-note', text: '「オンライン中」は最後に使ってから3分以内の人です。「ログインしないで使う」を選んだ人はここには出ません。故障・紛失で端末が使えなくなった人は「管理…」から、その端末をログアウトさせたり、パスワードを決め直したりできます。' }),
      userList,
      el('h4', { text: '対戦の部屋（新しい順に30件）' }),
      roomList),
    onClose: () => clearInterval(tick),
  });
  load();
}
