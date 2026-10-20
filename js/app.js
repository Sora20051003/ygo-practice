// 起動処理と画面切り替え
function switchView(name) {
  for (const t of $$('.tab')) t.classList.toggle('active', t.dataset.view === name);
  $('#view-deck').hidden = name !== 'deck';
  $('#view-board').hidden = name !== 'board';
  $('#view-duel').hidden = name !== 'duel';
  store.set('ygo.view', name);
  document.body.dataset.view = name;   // スマホ横向きのとき、一人回しだけ横画面の配置にする
  if (name !== 'board') unlockLandscape();
  if (typeof updateLandscape === 'function') { updateLandscape(); if (name === 'board') tryLandscapeLock(); }
  if (name === 'board') { refreshBoardDeckSelect(); renderBoard(); }
  if (name === 'duel') renderDuelLobby();
}

// 新しい版が公開されたら知らせる（ネット版のみ。5分ごとと、画面に戻ってきたときに確認）
// 開いた直後に新しい版が見つかったときは、そのまま新しい版に切り替える（ブラウザに残った古いページを使わないように）
function startUpdateCheck() {
  if (!location.protocol.startsWith('http')) return;
  let shown = false, first = true;
  const check = async () => {
    if (shown) return;
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      const j = await r.json();
      if (j.version && j.version !== APP_VERSION) {
        // 同じ版への自動切り替えは1回だけ（うまく切り替わらないときに繰り返さない）
        let tried = null;
        try { tried = sessionStorage.getItem('ygo.autoUpdate'); } catch { /* 使えなくてもよい */ }
        if (first && tried !== j.version) {
          try { sessionStorage.setItem('ygo.autoUpdate', j.version); } catch { /* 使えなくてもよい */ }
          freshReload(j.version);
          return;
        }
        shown = true; showUpdateBanner(j.version);
      }
    } catch { /* オフラインなどは無視 */ } finally { first = false; }
  };
  setInterval(check, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  check();
}

// ブラウザに残った古いページを使わず、必ず新しいページを読み込む（アドレスに版番号を付ける）
function freshReload(version) {
  const u = new URL(location.href);
  u.searchParams.set('v', version || Date.now());
  location.replace(u.toString());
}

function showUpdateBanner(version) {
  document.body.append(el('div', { class: 'update-banner' },
    el('span', { text: '新しいバージョンがあります。' }),
    el('button', { class: 'btn small primary', text: '更新する', onclick: () => freshReload(version) })));
}

function showLoading(text) {
  $('#loading').hidden = !text;
  if (text) $('#loading-text').textContent = text;
}

function updateDataInfo() {
  const m = DB.meta;
  $('#data-info').textContent = m ? `カード ${m.count.toLocaleString()}枚（${new Date(m.date).toLocaleDateString('ja-JP')} 取得）` : 'データなし';
}

function textStatus(text) {
  const s = $('#text-status');
  s.hidden = !text;
  s.textContent = text || '';
}

// テキスト検索用データは裏で準備する（その間も名前検索などは使える）
async function prepareTextSearch(task) {
  const qt = $('#qt');
  qt.disabled = true;
  qt.placeholder = '効果テキスト検索を準備中…';
  try {
    await task();
    textStatus(null);
    qt.disabled = false;
    qt.placeholder = '効果テキストで検索（例：デッキから 特殊召喚）';
    renderResults(); renderDeck(); renderBoard(); // 日本語の効果文をカードにも反映
  } catch (e) {
    console.error(e);
    textStatus('テキスト検索用データを取得できませんでした。「データ更新」で再試行できます。');
    qt.placeholder = '効果テキスト検索は使えません';
  }
}

// アプリのファイルが全部読み込めたか（新しい版を出した直後などに、通信の具合で一部だけ読めないことがある）
function checkScriptsLoaded() {
  const missing = [
    ['board.js', typeof renderBoard], ['engine.js', typeof engineLoad], ['autoplay.js', typeof autoStart], ['glow.js', typeof computeGlow],
    ['duel.js', typeof setupDuel], ['friends.js', typeof startFriends], ['replay.js', typeof startReplay], ['deck.js', typeof openSamples],
  ].filter(x => x[1] !== 'function').map(x => x[0]);
  if (!missing.length) return;
  console.warn('読み込めなかったファイル', missing);
  document.body.append(el('div', { class: 'update-banner' },
    el('span', { text: `アプリの一部（${missing.join('・')}）を読み込めませんでした。再読み込みしてください。` }),
    el('button', { class: 'btn small primary', text: '再読み込み', onclick: () => freshReload(Date.now()) })));
}

async function init() {
  checkScriptsLoaded();
  for (const t of $$('.tab')) t.addEventListener('click', () => switchView(t.dataset.view));
  // ネット版ならログインが終わるまで待つ
  try { await initAuth(); } catch (e) {
    console.error(e);
    showLoading('ログインの準備に失敗しました。インターネット接続を確認して再読み込みしてください。\n' + e.message);
    return;
  }
  // 表示形式はユーザーごとの設定を読み直す。画像はパソコン内のフォルダにしか無いので、ネット版は描いたカードか文字のみ
  cardStyle = store.get('ygo.cardStyle3', 'jp');
  if (!LOCAL_FILES) { delete CARD_STYLES.image; delete CARD_STYLES.art; if (!CARD_STYLES[cardStyle]) cardStyle = 'jp'; }
  try {
    await loadCards(showLoading);
    await loadUserPics();   // デッキ画像から切り抜いたカード画像
    await loadBanlists();   // 禁止・制限リスト（取れなくてもアプリは使える）
    loadRegDates().then(() => { if (typeof renderDeck === 'function' && Decks.list.length) renderDeck(); });   // 過去のリストの一覧は裏で
  } catch (e) {
    console.error(e);
    showLoading('カードデータを取得できませんでした。インターネット接続を確認して再読み込みしてください。\n' + e.message);
    return;
  }
  showLoading(null);
  updateDataInfo();

  const styleSel = $('#card-style');
  for (const [v, l] of Object.entries(CARD_STYLES)) styleSel.append(el('option', { value: v, text: l, selected: v === cardStyle }));
  styleSel.addEventListener('change', () => {
    cardStyle = styleSel.value;
    store.set('ygo.cardStyle3', cardStyle);
    renderResults(); renderDeck(); renderBoard();
  });

  setupDeckView();
  renderDeck();
  renderResults();
  setupBoardView();
  setupSlots();   // 一人回しのページ（複数の盤面）
  setupDuel();
  switchView(store.get('ygo.view', 'deck'));
  startRemoteSync(applyRemoteDecks);
  // カードデータ・禁止・制限リストの自動更新（アプリの更新なしで最新になる）
  startAutoDataUpdate((what, detail) => {
    updateDataInfo();
    renderResults(); renderDeck(); renderBoard();
    if (what === 'banlist') {
      toast('禁止・制限リストが更新されました（' + detail.map(f => `${FORMATS[f].short} ${DB.banlists[f].date.replace(/-/g, '/')}〜`).join('・') + '）');
    } else if (what === 'cards') {
      toast('新しいカードを取り込みました');
    }
  });
  checkSharedDeckLink();
  window.addEventListener('hashchange', checkSharedDeckLink);
  startUpdateCheck();
  if (!store.get('ygo.aboutSeen', false)) showAbout(true);   // 初めて開いたときに、非公式であることを知らせる
  prepareTextSearch(() => loadJaTexts(textStatus));

  $('#btn-update-data').onclick = async () => {
    try {
      const updated = await updateCards(showLoading);
      await loadBanlists(true);
      showLoading(null);
      updateDataInfo();
      toast(updated ? 'カードデータを更新しました' : 'カードデータは最新です');
      renderResults(); renderDeck(); renderBoard();
      // テキスト検索用データも取り直す（カードデータを取り直した場合は貼り直しも兼ねる）
      prepareTextSearch(() => downloadJaTexts(textStatus));
    } catch (e) {
      showLoading(null);
      toast('更新に失敗しました：' + e.message);
    }
  };
}

init();

// ---------- このアプリについて（非公式であること・権利とライセンスの表記） ----------
const REPO_URL = 'https://github.com/Sora20051003/ygo-practice';
function showAbout(first) {
  const a = (href, text) => el('a', { href, target: '_blank', rel: 'noopener', text: text || href });
  const li = (...kids) => el('li', null, ...kids);
  const body = el('div', { class: 'about' },
    el('p', { class: 'about-lead', text: 'このアプリは、個人が作った非公式のファンツールです。株式会社コナミデジタルエンタテインメント（KONAMI）とは関係がなく、KONAMI の承認や後援を受けたものではありません。' }),
    el('h4', { text: '権利の表記' }),
    el('p', { text: '「遊☆戯☆王」および「遊戯王オフィシャルカードゲーム」のカード名・カードの効果テキスト・イラスト・ロゴなどの権利は、原作者・権利者および KONAMI に帰属します（©高橋和希 スタジオ・ダイス／集英社　©Konami Digital Entertainment）。' }),
    el('p', { class: 'muted', text: 'このアプリはカードの画像やイラストを配布していません。表示されるイラストは、下の外部サイトから閲覧のたびに読み込んでいるか、利用者が自分で読み込んだデッキ画像を利用者の端末の中だけで切り抜いたものです。' }),
    el('ul', { class: 'about-list' },
      li('無料・広告なしで、お金をいただくことはありません。'),
      li('公式の大会ルール・裁定と違う動きをすることがあります。正確なルールは公式の情報を確認してください。'),
      li('権利者から求めがあった場合は、すみやかに内容の変更や公開の停止をします。')),
    el('h4', { text: 'データと素材の出どころ' }),
    el('ul', { class: 'about-list' },
      li('カードの情報・イラスト画像：', a('https://ygoprodeck.com/', 'YGOPRODeck'), '（API・画像サーバー）'),
      li('日本語のカード名・効果テキスト：', a('https://ygocdb.com/', '百鸽 (ygocdb)'), '、', a('https://github.com/mycard/ygopro-database', 'mycard/ygopro-database')),
      li('禁止・制限リスト：', a('https://github.com/DawnbrandBots/yaml-yugi-limit-regulation', 'DawnbrandBots/yaml-yugi-limit-regulation')),
      li('カードの発売日など：', a('https://db.ygoresources.com/', 'YGOResources')),
      li('公式カードデータベースへのリンク：', a('https://www.db.yugioh-card.com/', '遊戯王OCG カードデータベース（KONAMI）'))),
    el('h4', { text: '使っているソフトウェアとライセンス' }),
    el('ul', { class: 'about-list' },
      li('効果の自動処理のエンジン：', a('https://github.com/n1xx1/ocgcore-wasm', 'ocgcore-wasm'), '（MIT License）。中身は ', a('https://github.com/edo9300/ygopro-core', 'EDOPro の ygopro-core'), '（AGPL-3.0。ライセンスは各リポジトリを参照）'),
      li('カードの効果の処理（カードスクリプト）：', a('https://github.com/ProjectIgnis/CardScripts', 'ProjectIgnis/CardScripts'), '（各リポジトリのライセンスに従います）'),
      li('エンジン用のカードデータ：', a('https://github.com/ProjectIgnis/BabelCDB', 'ProjectIgnis/BabelCDB')),
      li('対戦の中継：', a('https://www.emqx.com/en/mqtt/public-mqtt5-broker', 'EMQX の公開 MQTT サーバー'), '、', a('https://www.hivemq.com/mqtt/public-mqtt-broker/', 'HiveMQ の公開 MQTT サーバー'), '（', a('https://github.com/mqttjs/MQTT.js', 'MQTT.js'), '・MIT License）')),
    el('p', null, 'このアプリのソースコードは公開しています：', a(REPO_URL)),
  );
  showModal({
    title: first ? 'はじめに（非公式のファンツールです）' : 'このアプリについて', body, wide: true,
    buttons: [{ label: first ? '了解して使う' : '閉じる', primary: true, onClick: () => { store.set('ygo.aboutSeen', true); } }],
    onClose: () => store.set('ygo.aboutSeen', true),
  });
}
document.addEventListener('click', e => {
  if (e.target.closest('#btn-about, [data-about]')) { if (typeof closePause === 'function' && !$('#pause').hidden) closePause(); showAbout(); }
});
