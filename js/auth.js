// ログイン（Firebase Authentication）とデッキのネット保存（Cloud Firestore）
// ・ネットに公開したアプリ（http/https）で FIREBASE_CONFIG が設定されているときだけ有効
// ・パソコンのファイルとして開いたとき（file://）は、今までどおりログインなしで動く
const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';

const Online = {
  enabled: typeof FIREBASE_CONFIG !== 'undefined' && !!FIREBASE_CONFIG && location.protocol.startsWith('http'),
  user: null,
  db: null,
  saveTimer: null,
};

// 画像はパソコン内のフォルダ（pics/）にあるので、ファイルとして開いたときだけ使う
const LOCAL_FILES = location.protocol === 'file:';

const AUTH_ERRORS = {
  'auth/invalid-credential': 'メールアドレスかパスワードが違います。',
  'auth/wrong-password': 'メールアドレスかパスワードが違います。',
  'auth/user-not-found': 'このメールアドレスのアカウントはありません。「新規登録」から作ってください。',
  'auth/email-already-in-use': 'このメールアドレスは登録済みです。「ログイン」してください。',
  'auth/weak-password': 'パスワードは6文字以上にしてください。',
  'auth/invalid-email': 'メールアドレスの形が正しくありません。',
  'auth/missing-password': 'パスワードを入力してください。',
  'auth/popup-closed-by-user': 'ログイン画面が閉じられました。もう一度お試しください。',
  'auth/popup-blocked': 'ポップアップがブロックされました。ブラウザの設定で許可してください。',
  'auth/too-many-requests': '試行回数が多すぎます。しばらく待ってからお試しください。',
  'auth/network-request-failed': 'インターネットに接続できませんでした。',
  'auth/unauthorized-domain': 'このアドレスからのログインが許可されていません（Firebaseの「承認済みドメイン」の設定が必要です）。',
  'auth/operation-not-allowed': 'このログイン方法が有効になっていません（Firebaseの設定が必要です）。',
  'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'Firebaseの設定（firebase-config.js）が正しくありません。',
  'auth/invalid-api-key': 'Firebaseの設定（firebase-config.js）が正しくありません。',
};
const authMessage = e => AUTH_ERRORS[e && e.code] || ('ログインできませんでした：' + ((e && e.message) || e));

// ログインが終わるまで待つ。ログイン不要なら何もしない
async function initAuth() {
  if (!Online.enabled) return;
  showLoading('準備中…');
  await loadScript(FIREBASE_SDK + 'firebase-app-compat.js');
  await Promise.all([loadScript(FIREBASE_SDK + 'firebase-auth-compat.js'), loadScript(FIREBASE_SDK + 'firebase-firestore-compat.js')]);
  firebase.initializeApp(FIREBASE_CONFIG);
  const auth = firebase.auth();
  auth.languageCode = 'ja';
  Online.db = firebase.firestore();
  showLoading('ログイン状態を確認中…');

  const user = await new Promise(resolve => {
    const off = auth.onAuthStateChanged(u => {
      showLoading(null);
      if (u) { off(); resolve(u); } else showLoginScreen();
    });
  });
  hideLoginScreen();
  Online.user = user;
  store.ns = 'u:' + user.uid + ':';   // 同じブラウザで別の人が使っても設定が混ざらないようにする

  // ネットに保存してあるデッキを読む
  showLoading('デッキを読み込み中…');
  try {
    const snap = await userDoc().get();
    Online.remote = snap.exists ? snap.data() : null;
    Online.lastSeen = JSON.stringify((Online.remote && Online.remote.decks) || []);
  } catch (e) {
    console.error(e);
    Online.remote = null;
    toast('デッキを読み込めませんでした：' + e.message);
  }
  showLoading(null);
  renderUserBox();
}

const userDoc = () => Online.db.collection('users').doc(Online.user.uid);

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
      await userDoc().set({ decks, currentDeck: currentId, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
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
  userDoc().onSnapshot(snap => {
    if (snap.metadata.hasPendingWrites || Online.pending) return;   // この端末で保存中のものは無視
    const data = snap.data();
    if (!data) return;
    const json = JSON.stringify(data.decks || []);
    if (json === Online.lastSeen) return;
    Online.lastSeen = json;
    Online.remote = data;
    onChange();
  }, e => console.warn('同期を受け取れませんでした', e));
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
  if (!Online.user) { box.hidden = true; return; }
  const u = Online.user;
  box.hidden = false;
  box.innerHTML = '';
  box.append(
    el('span', { id: 'save-state', class: 'save-state saved', text: '✓ 保存済み' }),
    el('span', { class: 'user-name', title: u.email || '', text: u.displayName || u.email || 'ログイン中' }),
    el('button', { class: 'btn small', text: 'ログアウト', onclick: async () => {
      clearTimeout(Online.saveTimer);
      await firebase.auth().signOut();
      location.reload();
    } }));
}

// ---------- ログイン画面 ----------
function showLoginScreen() {
  const scr = $('#auth-screen');
  scr.hidden = false;
  if (scr.dataset.ready) return;
  scr.dataset.ready = '1';
  const auth = firebase.auth();
  const msg = $('#auth-msg');
  const email = $('#auth-email'), pass = $('#auth-pass');
  const busy = async (fn) => {
    msg.className = 'auth-msg'; msg.textContent = '';
    $$('#auth-screen button').forEach(b => { b.disabled = true; });
    try { await fn(); } catch (e) { msg.className = 'auth-msg error'; msg.textContent = authMessage(e); }
    $$('#auth-screen button').forEach(b => { b.disabled = false; });
  };
  $('#auth-google').onclick = () => busy(() => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()));
  $('#auth-login').onclick = () => busy(() => auth.signInWithEmailAndPassword(email.value.trim(), pass.value));
  $('#auth-signup').onclick = () => busy(async () => {
    if (pass.value.length < 6) throw { code: 'auth/weak-password' };
    await auth.createUserWithEmailAndPassword(email.value.trim(), pass.value);
  });
  $('#auth-reset').onclick = () => busy(async () => {
    if (!email.value.trim()) throw { message: '先にメールアドレスを入力してください。' };
    await auth.sendPasswordResetEmail(email.value.trim());
    msg.className = 'auth-msg ok';
    msg.textContent = 'パスワード再設定のメールを送りました。メールのリンクから新しいパスワードを決めてください。';
  });
  pass.addEventListener('keydown', e => { if (e.key === 'Enter') $('#auth-login').click(); });
}
function hideLoginScreen() { $('#auth-screen').hidden = true; }
