// 起動処理と画面切り替え
function switchView(name) {
  for (const t of $$('.tab')) t.classList.toggle('active', t.dataset.view === name);
  $('#view-deck').hidden = name !== 'deck';
  $('#view-board').hidden = name !== 'board';
  store.set('ygo.view', name);
  if (name === 'board') { refreshBoardDeckSelect(); renderBoard(); }
}

// 新しい版が公開されたら知らせる（ネット版のみ。5分ごとと、画面に戻ってきたときに確認）
function startUpdateCheck() {
  if (!location.protocol.startsWith('http')) return;
  let shown = false;
  const check = async () => {
    if (shown) return;
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      const j = await r.json();
      if (j.version && j.version !== APP_VERSION) { shown = true; showUpdateBanner(); }
    } catch { /* オフラインなどは無視 */ }
  };
  setInterval(check, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  check();
}

function showUpdateBanner() {
  document.body.append(el('div', { class: 'update-banner' },
    el('span', { text: '新しいバージョンがあります。' }),
    el('button', { class: 'btn small primary', text: '更新する', onclick: () => location.reload() })));
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

async function init() {
  if (typeof DecompressionStream === 'undefined') {
    showLoading('このブラウザは古いため使えません。最新の Chrome / Edge / Firefox / Safari で開いてください。');
    return;
  }
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
  switchView(store.get('ygo.view', 'deck'));
  startRemoteSync(applyRemoteDecks);
  startUpdateCheck();
  prepareTextSearch(() => loadJaTexts(textStatus));

  $('#btn-update-data').onclick = async () => {
    try {
      const updated = await updateCards(showLoading);
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
