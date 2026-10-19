// ログインとデッキのネット保存（Supabase）
// ・ネットに公開したアプリ（http/https）で SUPABASE_CONFIG（js/cloud-config.js）が設定されているときだけ有効
// ・パソコンのファイルとして開いたとき（file://）や、設定がないときは、今までどおりログインなしで動く
// ・サーバー側の表（テーブル）と読み書きの決まりは supabase/setup.sql
const SUPABASE_SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';

const Online = {
  enabled: typeof SUPABASE_CONFIG !== 'undefined' && !!SUPABASE_CONFIG && !!SUPABASE_CONFIG.url && location.protocol.startsWith('http'),
  sb: null,         // Supabase のクライアント
  user: null,       // { uid, email, displayName, createdAt, provider }
  saveTimer: null,
};

// 画像はパソコン内のフォルダ（pics/）にあるので、ファイルとして開いたときだけ使う
const LOCAL_FILES = location.protocol === 'file:';

// ---------- ID でログイン（メールアドレスは聞かない） ----------
// Supabase はメールアドレスの形が必要なので、ID から中だけで使うアドレスを作る（このアドレスにメールは送らない）
const ID_DOMAIN = 'sora20051003.github.io';
const ID_RE = /^[a-z0-9_-]{3,20}$/;
function idToEmail(input) {
  const s = (input || '').trim();
  if (s.includes('@')) return s;   // メールアドレスで作ったアカウントもそのまま使える
  const id = s.toLowerCase();
  if (!ID_RE.test(id)) throw new Error('ID_FORMAT');
  return id + '@' + ID_DOMAIN;
}
// 中で使うアドレス → 画面に出す ID
const emailToId = e => (e && e.endsWith('@' + ID_DOMAIN) ? e.slice(0, -ID_DOMAIN.length - 1) : (e || ''));
const isIdAccount = e => !!e && e.endsWith('@' + ID_DOMAIN);

// Supabase のエラー → 日本語
function authMessage(e) {
  const m = (e && (e.message || e.error_description || String(e))) || '';
  if (m === 'ID_FORMAT') return 'ID は半角の英字・数字・_ - で3〜20文字にしてください。';
  if (/Invalid login credentials/i.test(m)) return 'ID かパスワードが違います。';
  if (/Email not confirmed|sending confirmation|confirmation email|not authorized/i.test(m)) return '登録の確認が終わっていません。サーバー（Supabase）の「Authentication」→「Sign In / Providers」→「Email」で「Confirm email」をオフにしてください（管理者の作業です）。';
  if (/already registered|already been registered|User already exists/i.test(m)) return 'この ID はもう使われています。別の ID にするか、「ログイン」してください。';
  if (/Password should be at least|weak/i.test(m)) return 'パスワードは6文字以上にしてください。';
  if (/valid email|invalid email|Unable to validate email/i.test(m)) return 'この ID では登録できませんでした（サーバーの設定を確認してください）：' + m;
  if (/rate limit|too many/i.test(m)) return '試行回数が多すぎます。しばらく待ってからお試しください。';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'インターネットに接続できませんでした。';
  if (/provider is not enabled|Unsupported provider/i.test(m)) return 'このログイン方法はまだ使えません（サーバーの設定が必要です）。';
  if (/Invalid API key|apikey/i.test(m)) return 'サーバーの設定（js/cloud-config.js）が正しくありません。';
  return 'ログインできませんでした：' + m;
}

// Supabase のユーザー → アプリで使う形
function toAppUser(u) {
  if (!u) return null;
  const meta = u.user_metadata || {};
  return {
    uid: u.id, email: u.email || '', loginId: emailToId(u.email || ''),
    displayName: meta.name || meta.full_name || meta.user_name || (u.email || '').split('@')[0] || '',
    createdAt: u.created_at, provider: (u.app_metadata && u.app_metadata.provider) || 'email',
  };
}

// ログインが終わるまで待つ。ログイン不要なら何もしない
async function initAuth() {
  if (!Online.enabled) return;
  showLoading('準備中…');
  await loadScript(SUPABASE_SDK);
  const sb = Online.sb = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  // パスワードを忘れた人がメールのリンクから戻ってきたとき：新しいパスワードを決めてもらう
  sb.auth.onAuthStateChange(event => {
    if (event === 'PASSWORD_RECOVERY') setTimeout(askNewPassword, 300);
    // 自分で「ログアウト」を押していないのにログインが切れた（ほかの端末や管理者がこの端末をログアウトさせた）
    if (event === 'SIGNED_OUT' && Online.user && !Online.loggingOut && typeof forcedLogout === 'function') forcedLogout();
  });
  showLoading('ログイン状態を確認中…');
  const { data } = await sb.auth.getSession();
  let user = data && data.session ? data.session.user : null;
  showLoading(null);
  if (!user && localStorage.getItem('ygo.guest') !== '1') {
    user = await new Promise(resolve => showLoginScreen(resolve));
  }
  hideLoginScreen();
  if (!user) { renderUserBox(); return; }   // ログインしないで使う（デッキはこの端末だけに保存）
  localStorage.removeItem('ygo.guest');
  Online.user = toAppUser(user);
  // ログインする前にこの端末で作っていたデッキ（アカウントにまだデッキがなければ、引き継ぐ）
  const localDecks = store.get('ygo.decks', []), localCurrent = store.get('ygo.currentDeck', null);
  store.ns = 'u:' + Online.user.uid + ':';   // 同じブラウザで別の人が使っても設定が混ざらないようにする

  // ネットに保存してあるデッキを読む
  showLoading('デッキを読み込み中…');
  try {
    const { data: row, error } = await sb.from('user_decks').select('decks,current_deck').eq('uid', Online.user.uid).maybeSingle();
    if (error) throw error;
    Online.remote = row ? { decks: row.decks || [], currentDeck: row.current_deck } : null;
    if ((!Online.remote || !Online.remote.decks.length) && localDecks.length && localDecks.some(d => d.main && d.main.length)) {
      Online.remote = { decks: localDecks, currentDeck: localCurrent };
      setTimeout(() => toast('この端末のデッキをアカウントに引き継ぎました'), 1500);
      Online.migrate = true;
    }
    Online.lastSeen = deckCanon((Online.remote && Online.remote.decks) || []);
  } catch (e) {
    console.error(e);
    Online.remote = null;
    toast('デッキを読み込めませんでした：' + e.message);
  }
  showLoading(null);
  renderUserBox();
  startPresence();   // アカウントの記録（最後に使った日時など。管理ページで見られる）
  checkAdmin();
}

// デッキが変わるたびに呼ばれる。少し待ってまとめてネットに保存する
function saveDecksOnline(list, currentId) {
  if (!Online.user) return;
  setSaveState('saving');
  Online.pending = true;
  clearTimeout(Online.saveTimer);
  Online.saveTimer = setTimeout(async () => {
    let decks = list.map(normDeck);
    try {
      // 保存する前に、ほかの端末が先に保存していないか確かめる。していたら、両方の変更を合わせてから保存する
      // （寝ていたスマホの古いデッキで、ほかの端末の変更を消してしまわないように）
      const { data: row, error: readErr } = await Online.sb.from('user_decks').select('decks').eq('uid', Online.user.uid).maybeSingle();
      if (readErr) throw readErr;
      if (row && row.decks && deckCanon(row.decks) !== Online.lastSeen) {
        const base = JSON.parse(Online.lastSeen || '[]');
        decks = mergeDecks(base, row.decks.map(normDeck), decks);
        if (deckCanon(decks) !== deckCanon(list)) {
          Online.remote = { decks, currentDeck: currentId };
          if (Online.onRemote) Online.onRemote();
        }
      }
      Online.lastSeen = deckCanon(decks);   // 自分が保存した内容は「別の端末の変更」として扱わない
      const { error } = await Online.sb.from('user_decks').upsert({ uid: Online.user.uid, decks, current_deck: currentId, updated_at: new Date().toISOString() });
      if (error) throw error;
      setSaveState('saved');
    } catch (e) {
      console.error(e);
      setSaveState('error');
    }
    Online.pending = false;
  }, 800);
}

// デッキを比べるための決まった形（サーバーの jsonb はキーの順番を変えるので、そろえてから比べる）
const normDeck = d => ({ id: d.id, name: d.name, format: d.format || 'ocg', reg: d.reg || 'latest', cutoff: d.cutoff || null, main: d.main || [], extra: d.extra || [], side: d.side || [] });
const deckCanon = list => JSON.stringify((list || []).map(normDeck));

// 3つを合わせる：base＝前に同じだった内容、server＝ほかの端末が保存した内容、local＝この端末の内容
// ・この端末で変えた・作ったデッキ → この端末のもの
// ・この端末で変えていないデッキ → サーバーのもの（ほかの端末で変わっていれば、その内容）
// ・ほかの端末で作ったデッキ → 足す。どちらかで消したデッキ → 消す
function mergeDecks(base, server, local) {
  const key = d => JSON.stringify(normDeck(d));
  const B = new Map(base.map(d => [d.id, key(d)]));
  const S = new Map(server.map(d => [d.id, d]));
  const out = [], seen = new Set();
  for (const d of local) {
    seen.add(d.id);
    if (B.get(d.id) !== key(d)) out.push(d);          // この端末で変えた・作った
    else if (S.has(d.id)) out.push(S.get(d.id));      // 変えていない → サーバーの内容
    // 変えていないのにサーバーに無い → ほかの端末で消した
  }
  for (const d of server) if (!seen.has(d.id) && !B.has(d.id)) out.push(d);   // ほかの端末で作った
  return out.map(normDeck);
}

// 別の端末でデッキが変わったら、開いているこの画面にもすぐ反映する
function startRemoteSync(onChange) {
  if (!Online.user) return;
  Online.onRemote = onChange;
  // スマホを開き直したとき（寝ている間は知らせが届かないことがある）にも、最新のデッキを読み直す
  const refresh = async () => {
    if (document.hidden || Online.pending || !Online.user) return;
    const { data: row } = await Online.sb.from('user_decks').select('decks,current_deck').eq('uid', Online.user.uid).maybeSingle();
    if (!row || !row.decks || Online.pending) return;
    const json = deckCanon(row.decks);
    if (json === Online.lastSeen) return;
    Online.lastSeen = json;
    Online.remote = { decks: row.decks, currentDeck: Decks.currentId || row.current_deck };
    onChange();
  };
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('online', refresh);
  if (Online.migrate && typeof Decks !== 'undefined') { Online.migrate = false; saveDecksOnline(Decks.list, Decks.currentId); }
  Online.sb.channel('decks-' + Online.user.uid)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user_decks', filter: 'uid=eq.' + Online.user.uid }, payload => {
      if (Online.pending) return;   // この端末で保存中のものは無視
      const row = payload.new;
      if (!row || !row.decks) return;
      const json = deckCanon(row.decks);
      if (json === Online.lastSeen) return;
      Online.lastSeen = json;
      Online.remote = { decks: row.decks, currentDeck: row.current_deck };
      onChange();
    })
    .subscribe();
}

function setSaveState(s) {
  const el2 = $('#save-state');
  if (!el2) return;
  el2.textContent = { saving: '保存中…', saved: '✓ 保存済み', error: '⚠ 保存できませんでした' }[s];
  el2.className = 'save-state ' + s;
}

// 保存が終わる前にページを閉じようとしたら確認する
window.addEventListener('beforeunload', e => {
  if ($('#save-state') && $('#save-state').classList.contains('saving')) { e.preventDefault(); e.returnValue = ''; }
});

function renderUserBox() {
  const box = $('#user-box');
  if (!Online.user) {
    // ログインしないで使っている：ログインに切り替えられるようにする
    box.hidden = !Online.enabled;
    box.innerHTML = '';
    if (Online.enabled) box.append(el('button', { class: 'btn small', text: 'ログイン', title: 'ログインすると、デッキがアカウントに保存され、どの端末からでも使えます', onclick: () => { localStorage.removeItem('ygo.guest'); try { sessionStorage.setItem('ygo.wantLogin', '1'); } catch { /* 使えなくてもよい */ } location.reload(); } }));
    return;
  }
  const u = Online.user;
  box.hidden = false;
  box.innerHTML = '';
  box.append(
    el('span', { id: 'save-state', class: 'save-state saved', text: '✓ 保存済み' }),
    el('span', { class: 'user-name', title: u.loginId ? 'ID：' + u.loginId : '', text: u.displayName || u.loginId || 'ログイン中' }),
    ...(typeof openMyDevices === 'function' ? [el('button', { class: 'btn small', text: '📱 端末', title: 'このアカウントでログインしている端末（なくした・壊れた端末をログアウトさせる）', onclick: openMyDevices })] : []),
    el('button', { class: 'btn small', text: 'ログアウト', onclick: async () => {
      Online.loggingOut = true;
      clearTimeout(Online.saveTimer);
      await Online.sb.auth.signOut();
      location.reload();
    } }));
  if (typeof renderAdminButton === 'function') renderAdminButton();
}

// ---------- ログイン画面 ----------
// done(user)：ログインできたら Supabase のユーザー、「ログインしないで使う」なら null
function showLoginScreen(done) {
  const scr = $('#auth-screen');
  scr.hidden = false;
  const sb = Online.sb;
  const msg = $('#auth-msg');
  const email = $('#auth-email'), pass = $('#auth-pass'), nameIn = $('#auth-name');
  const here = location.origin + location.pathname;
  // Google ログインはサーバー側で設定したときだけ出す
  $('#auth-google').hidden = !SUPABASE_CONFIG.google;
  $('#auth-google-or').hidden = !SUPABASE_CONFIG.google;
  const say = (text, kind) => { msg.className = 'auth-msg' + (kind ? ' ' + kind : ''); msg.textContent = text; };
  const busy = async fn => {
    say('');
    $$('#auth-screen button').forEach(b => { b.disabled = true; });
    try { await fn(); } catch (e) { say(authMessage(e), 'error'); }
    $$('#auth-screen button').forEach(b => { b.disabled = false; });
  };
  $('#auth-google').onclick = () => busy(async () => {
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: here } });
    if (error) throw error;
  });
  $('#auth-login').onclick = () => busy(async () => {
    const { data, error } = await sb.auth.signInWithPassword({ email: idToEmail(email.value), password: pass.value });
    if (error) throw error;
    done(data.user);
  });
  $('#auth-signup').onclick = () => busy(async () => {
    if (pass.value.length < 6) throw new Error('Password should be at least 6 characters');
    const addr = idToEmail(email.value);
    const name = nameIn.value.trim() || emailToId(addr).split('@')[0];
    const { data, error } = await sb.auth.signUp({ email: addr, password: pass.value, options: { data: { name }, emailRedirectTo: here } });
    if (error) throw error;
    if (data.session) { done(data.user); return; }
    // サーバーの設定で「メールの確認」がオンのまま（ID のアカウントは確認メールを受け取れない）
    if (isIdAccount(addr)) throw new Error('Email not confirmed');
    say('確認のメールを送りました。メールのリンクを押してから、ここでログインしてください。', 'ok');
  });
  // ID のアカウントはメールを受け取れないので、パスワードを忘れたら管理者に決め直してもらう
  $('#auth-reset').onclick = () => say('パスワードを忘れたときは、管理者に「仮のパスワード」を決めてもらってください。ログインしたあと、右上の「📱 端末」から自分のパスワードを変えられます。', 'ok');
  pass.onkeydown = e => { if (e.key === 'Enter') $('#auth-login').click(); };
  // 最初は「ログインして使う」「ゲストで使う」を選ぶ画面。ログインを選んだら入力欄を出す
  const showForm = on => { $('#auth-choice').hidden = on; $('#auth-form').hidden = !on; say(''); if (on) setTimeout(() => email.focus(), 50); };
  // 右上の「ログイン」から来たときは、すぐ入力欄を出す
  let want = false; try { want = sessionStorage.getItem('ygo.wantLogin') === '1'; sessionStorage.removeItem('ygo.wantLogin'); } catch { /* 使えなくてもよい */ }
  showForm(want);
  $('#auth-pick-login').onclick = () => showForm(true);
  $('#auth-back').onclick = () => showForm(false);
  $('#auth-guest').onclick = () => { localStorage.setItem('ygo.guest', '1'); hideLoginScreen(); done(null); };
}
function hideLoginScreen() { $('#auth-screen').hidden = true; }

// メールのリンクから戻ってきたとき：新しいパスワードを決める
function askNewPassword() {
  promptText('新しいパスワード（6文字以上）', '', async pw => {
    if (pw.length < 6) { toast('パスワードは6文字以上にしてください'); return false; }
    const { error } = await Online.sb.auth.updateUser({ password: pw });
    toast(error ? '変更できませんでした：' + error.message : 'パスワードを変更しました');
  });
}
