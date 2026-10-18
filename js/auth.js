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

// Supabase のエラー → 日本語
function authMessage(e) {
  const m = (e && (e.message || e.error_description || String(e))) || '';
  if (/Invalid login credentials/i.test(m)) return 'メールアドレスかパスワードが違います。';
  if (/Email not confirmed/i.test(m)) return 'メールアドレスの確認がまだです。届いたメールのリンクを押してから、ログインしてください。';
  if (/already registered|already been registered|User already exists/i.test(m)) return 'このメールアドレスは登録済みです。「ログイン」してください。';
  if (/Password should be at least|weak/i.test(m)) return 'パスワードは6文字以上にしてください。';
  if (/valid email|invalid email|Unable to validate email/i.test(m)) return 'メールアドレスの形が正しくありません。';
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
    uid: u.id, email: u.email || '',
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
    Online.lastSeen = JSON.stringify((Online.remote && Online.remote.decks) || []);
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
    const decks = list.map(d => ({ id: d.id, name: d.name, format: d.format || 'ocg', reg: d.reg || 'latest', main: d.main, extra: d.extra, side: d.side }));
    Online.lastSeen = JSON.stringify(decks);   // 自分が保存した内容は「別の端末の変更」として扱わない
    try {
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

// 別の端末でデッキが変わったら、開いているこの画面にもすぐ反映する
function startRemoteSync(onChange) {
  if (!Online.user) return;
  if (Online.migrate && typeof Decks !== 'undefined') { Online.migrate = false; saveDecksOnline(Decks.list, Decks.currentId); }
  Online.sb.channel('decks-' + Online.user.uid)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user_decks', filter: 'uid=eq.' + Online.user.uid }, payload => {
      if (Online.pending) return;   // この端末で保存中のものは無視
      const row = payload.new;
      if (!row || !row.decks) return;
      const json = JSON.stringify(row.decks);
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
    el('span', { class: 'user-name', title: u.email || '', text: u.displayName || u.email || 'ログイン中' }),
    el('button', { class: 'btn small', text: 'ログアウト', onclick: async () => {
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
    const { data, error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
    if (error) throw error;
    done(data.user);
  });
  $('#auth-signup').onclick = () => busy(async () => {
    if (pass.value.length < 6) throw new Error('Password should be at least 6 characters');
    const name = nameIn.value.trim() || email.value.trim().split('@')[0];
    const { data, error } = await sb.auth.signUp({ email: email.value.trim(), password: pass.value, options: { data: { name }, emailRedirectTo: here } });
    if (error) throw error;
    if (data.session) { done(data.user); return; }
    // メールの確認が必要な設定のとき
    say('確認のメールを送りました。メールのリンクを押してから、ここでログインしてください。', 'ok');
  });
  $('#auth-reset').onclick = () => busy(async () => {
    if (!email.value.trim()) throw new Error('先にメールアドレスを入力してください。');
    const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: here });
    if (error) throw error;
    say('パスワード再設定のメールを送りました。メールのリンクを開くと、新しいパスワードを決められます。', 'ok');
  });
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
