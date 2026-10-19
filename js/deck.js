// デッキ作成画面
const LIMITS = { main: 60, extra: 15, side: 15 };
const MAX_COPIES = 3;
const SECTION_LABEL = { main: 'メインデッキ', extra: 'EXデッキ', side: 'サイドデッキ' };

const Decks = {
  list: [],
  currentId: null,

  load() {
    if (Online.user) {
      // ログイン中：ネットに保存したデッキを使う
      const r = Online.remote || {};
      this.list = (r.decks || []).map(d => ({ id: d.id, name: d.name, format: d.format || 'ocg', reg: d.reg || 'latest', main: d.main || [], extra: d.extra || [], side: d.side || [] }));
      this.currentId = r.currentDeck;
    } else {
      this.list = store.get('ygo.decks', []);
      this.currentId = store.get('ygo.currentDeck', null);
    }
    if (!this.list.length) this.list.push(this.blank('新しいデッキ'));
    if (!this.get(this.currentId)) this.currentId = this.list[0].id;
  },
  save() {
    store.set('ygo.decks', this.list);
    store.set('ygo.currentDeck', this.currentId);
    saveDecksOnline(this.list, this.currentId);
  },
  // 新しいデッキのルールは、今開いているデッキと同じにする
  blank(name, format) {
    const fmt = format || (this.current && this.list.length && this.current() ? deckFormat(this.current()) : 'ocg');
    return { id: 'd' + Date.now() + Math.random().toString(36).slice(2, 6), name, format: fmt, main: [], extra: [], side: [] };
  },
  get(id) { return this.list.find(d => d.id === id); },
  current() { return this.get(this.currentId); },
};

// デッキのルール（古いデッキはOCG扱い）
const deckFormat = d => (d && FORMATS[d.format] ? d.format : 'ocg');
const curFormat = () => deckFormat(Decks.current());

// デッキの中の、ルール違反（使えないカード・枚数オーバー）を調べる
function deckProblems(deck) {
  const ctx = regContext(deck);
  const counts = new Map();
  for (const sec of ['main', 'extra', 'side']) for (const id of deck[sec]) {
    const c = DB.byId.get(id);
    if (c) counts.set(c.name, { c, n: (counts.get(c.name) || { n: 0 }).n + 1 });
  }
  const notAllowed = [], over = [];
  for (const { c, n } of counts.values()) {
    const l = limitIn(c, ctx);
    if (!cardAllowed(c, ctx.fmt)) notAllowed.push(c.name);
    else if (n > l) over.push(`${c.name}（${limitLabel(c, ctx)}${l ? `：${l}枚まで` : ''}）`);
  }
  return { notAllowed, over };
}

// 禁止・制限の小さな印（未発売は「未」）
function limitBadge(c, ctx) {
  if (!cardAllowed(c, ctx.fmt)) return el('span', { class: 'lim lim-x', title: `${FORMATS[ctx.fmt].label}では使えません`, text: '×' });
  if (isUnreleased(c, ctx)) return el('span', { class: 'lim lim-u', title: '未発売（禁止扱い）', text: '未' });
  const l = limitIn(c, ctx);
  return l < 3 ? el('span', { class: 'lim lim-' + l, title: LIMIT_LABEL[l], text: l }) : null;
}

// 過去のリストを選んでいるデッキなら、リストと発売日表を読み込んでから描き直す
const regLoading = new Set();
function ensureRegLoaded(deck) {
  const ctx = regContext(deck);
  if (!ctx.loading) return;
  const key = ctx.src.join(':');
  if (regLoading.has(key)) return;
  regLoading.add(key);
  Promise.all([loadRegulation(...ctx.src), loadReleaseDates()])
    .then(() => { renderDeck(); renderResults(); })
    .catch(e => toast('過去のリストを読み込めませんでした：' + e.message))
    .finally(() => regLoading.delete(key));
}

// レギュレーションの選択肢（最新・過去のリスト・制限なし）
function renderRegSelect(deck) {
  const sel = $('#deck-reg');
  const fmt = deckFormat(deck);
  const cur = deck.reg || 'latest';
  const fmtDate = d => d.replace(/-/g, '/');
  sel.innerHTML = '';
  const latest = DB.banlists[fmt] && DB.banlists[fmt].date;
  sel.append(el('option', { value: 'latest', text: `最新${latest ? `（${fmtDate(latest)}〜）` : ''}` }));
  const dates = DB.regDates[fmt] || [];
  // 発表済みで、まだ適用日が来ていない次回のリスト
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = dates.filter(d => d > today && d !== latest);
  if (upcoming.length) {
    const g = el('optgroup', { label: '次回のリスト（発表済み）' });
    for (const d of upcoming) g.append(el('option', { value: d, text: `${fmtDate(d)}〜（次回・発表済み）` }));
    sel.append(g);
  }
  const past = dates.filter(d => d <= today && d !== latest);
  // 過去のリストは年ごとにまとめる（その時に未発売のカードは禁止扱い）
  const years = new Map();
  for (const d of past) { const y = d.slice(0, 4); if (!years.has(y)) years.set(y, []); years.get(y).push(d); }
  for (const [y, ds] of years) {
    const g = el('optgroup', { label: `${y}年（過去のリスト・未発売のカードは禁止扱い）` });
    for (const d of ds) g.append(el('option', { value: d, text: `${fmtDate(d)}〜` }));
    sel.append(g);
  }
  if (cur !== 'latest' && cur !== 'none' && !cur.startsWith('custom:') && !dates.includes(cur)) sel.append(el('option', { value: cur, text: `${fmtDate(cur)}〜` }));
  // オリジナルのレギュレーション
  const og = el('optgroup', { label: 'オリジナル' });
  for (const r of customRegs()) og.append(el('option', { value: 'custom:' + r.id, text: `★ ${r.name}` }));
  if (cur.startsWith('custom:') && customReg(cur.slice(7))) og.append(el('option', { value: '__edit', text: `✎ 「${customReg(cur.slice(7)).name}」を編集…` }));
  og.append(el('option', { value: '__new', text: '＋ オリジナルを作る…' }));
  sel.append(og);
  sel.append(el('option', { value: 'none', text: '制限なし（禁止・制限・発売日を気にしない）' }));
  sel.value = cur;
}

function countCopies(deck, card) {
  let n = 0;
  for (const sec of ['main', 'extra', 'side']) {
    for (const id of deck[sec]) {
      const c = DB.byId.get(id);
      if (c && c.name === card.name) n++;
    }
  }
  return n;
}

function addToDeck(card, section) {
  const deck = Decks.current();
  if (!section) section = isExtraType(card) ? 'extra' : 'main';
  if (section === 'main' && isExtraType(card)) section = 'extra';
  if (section === 'extra' && !isExtraType(card)) { toast('EXデッキに入れられるのは融合・S・X・リンクだけです'); return; }
  if (deck[section].length >= LIMITS[section]) { toast(`${SECTION_LABEL[section]}は${LIMITS[section]}枚までです`); return; }
  const ctx = regContext(deck);
  const fmt = ctx.fmt;
  if (!cardAllowed(card, fmt)) { toast(`このカードは${FORMATS[fmt].label}では使えません`); return; }
  const limit = Math.min(MAX_COPIES, limitIn(card, ctx));
  if (limit === 0) {
    toast(isUnreleased(card, ctx) ? `${card.name}は選んでいるリストの時点では未発売です（禁止扱い）` : `${card.name}は${FORMATS[fmt].label}の禁止カードです`);
    return;
  }
  if (countCopies(deck, card) >= limit) {
    toast(limit < MAX_COPIES ? `${card.name}は${LIMIT_LABEL[limit]}カードなので${limit}枚までです` : `同じカードは${MAX_COPIES}枚までです`);
    return;
  }
  // 同じ名前のカードがすでにあれば、その隣（最後の1枚の後ろ）に入れる
  let at = -1;
  deck[section].forEach((id, i) => { const x = DB.byId.get(id); if (x && x.name === card.name) at = i; });
  if (at >= 0) deck[section].splice(at + 1, 0, card.id); else deck[section].push(card.id);
  Decks.save();
  renderDeck();
  // スマホは検索中にデッキが見えないので、追加したことを知らせる
  if (isMobile()) toast(`${card.name} を${SECTION_LABEL[section]}に追加（${deck[section].length}枚）`);
}

// 別の端末で変わったデッキを反映する（今どのデッキを開いているかは端末ごとに保つ）
function applyRemoteDecks() {
  const cur = Decks.currentId;
  Decks.load();
  if (Decks.get(cur)) Decks.currentId = cur;
  store.set('ygo.decks', Decks.list);
  renderDeck();
  toast('別の端末でのデッキの変更を反映しました');
}

// スマホ用：「カードを探す」「デッキ」の切り替え
function setupMobileTabs() {
  const tabs = $('#deck-mtabs');
  tabs.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    tabs.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    $('#view-deck .deck-layout').dataset.pane = b.dataset.pane;
    window.scrollTo(0, 0);
  });
}

// デッキ画面でカードの詳細を出す（詳細欄の上に、追加・減らすボタンと今の枚数を付ける）
function showDeckCard(c) {
  showCardDetail(c, '#deck-detail', deckCardBar(c));
}

function deckCardBar(c) {
  const bar = el('div', { class: 'd-addbar' });
  const draw = () => {
    bar.innerHTML = '';
    const deck = Decks.current();
    if (!deck) return;
    const main = isExtraType(c) ? 'extra' : 'main';
    const count = sec => deck[sec].filter(id => id === c.id).length;
    const nMain = count(main), nSide = count('side');
    // 指定した場所から1枚減らす
    const removeOne = sec => {
      const i = deck[sec].lastIndexOf(c.id);
      if (i >= 0) removeFromDeck(sec, i);
      draw();
    };
    const label = main === 'extra' ? 'EXデッキ' : 'メインデッキ';
    bar.append(
      el('div', { class: 'd-addcount', text: `今の枚数：${main === 'extra' ? 'EX' : 'メイン'} ${nMain}枚・サイド ${nSide}枚` }),
      el('div', { class: 'd-addbtns' },
        el('button', { class: 'btn small primary', text: `＋ ${label}に追加`, onclick: () => { addToDeck(c, main); draw(); } }),
        el('button', { class: 'btn small', text: '＋ サイドに追加', onclick: () => { addToDeck(c, 'side'); draw(); } })),
      el('div', { class: 'd-addbtns' },
        el('button', { class: 'btn small', text: `− ${label}から1枚減らす`, disabled: !nMain, onclick: () => removeOne(main) }),
        el('button', { class: 'btn small', text: '− サイドから1枚減らす', disabled: !nSide, onclick: () => removeOne('side') })),
      el('div', { class: 'd-addbtns' },
        el('button', { class: 'btn small', text: '🔍 関連カードを検索', onclick: () => showRelated(c) })));
  };
  draw();
  return bar;
}

function removeFromDeck(section, index) {
  const deck = Decks.current();
  deck[section].splice(index, 1);
  Decks.save();
  renderDeck();
}

// ---------- 検索 ----------
let searchTimer = null;
const MAX_RESULTS = 300;

function setupSearch() {
  // 検索の条件を変えたら、関連カードの表示をやめて普通の検索結果に戻す
  const run = () => { Related.card = null; clearTimeout(searchTimer); searchTimer = setTimeout(renderResults, 120); };
  // カードデータに実際にある数字だけを選択肢にする
  const values = { level: new Set(), rank: new Set(), link: new Set() };
  for (const c of DB.cards) if (isMonster(c) && !isToken(c)) values[levelKind(c)].add(c.level);
  const numEntries = (kind, fmt) => [...values[kind]].sort((a, b) => a - b).map(n => [String(n), fmt(n)]);
  setupMulti('#f-level', 'レベル', numEntries('level', n => '★' + n), run);
  setupMulti('#f-rank', 'ランク', numEntries('rank', n => '☆' + n), run);
  setupMulti('#f-link', 'リンク', numEntries('link', n => 'LINK-' + n), run);
  // リンクマーカー：実際のカードと同じ3×3の並び（真ん中は空き）
  const markerEntries = LINK_ARROWS.map(([bit, arrow]) => (bit ? [String(bit), arrow] : null));
  setupMulti('#f-marker', 'マーカー', markerEntries, run, { modeToggle: true });
  setupMulti('#f-sub', '細かい種類', SUB_LABELS, run, { modeToggle: true });
  setupMulti('#f-attr', '属性', Object.entries(ATTR).map(([v, l]) => [v, l + '属性']), run);
  setupMulti('#f-race', '種族', Object.entries(RACE), run);
  $('#q').addEventListener('input', run);
  $('#qt').addEventListener('input', run);
  for (const seg of $$('.seg')) {
    seg.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      run();
    });
  }
  for (const id of ['#f-kind', '#f-sort']) $(id).addEventListener('change', run);
}

const SUB_LABELS = [
  ['normal', '通常'], ['effect', '効果'], ['tuner', 'チューナー'], ['pendulum', 'ペンデュラム'],
  ['ritual', '儀式'], ['fusion', '融合'], ['synchro', 'シンクロ'], ['xyz', 'エクシーズ'], ['link', 'リンク'],
  ['flip', 'リバース'], ['spsummon', '特殊召喚'], ['toon', 'トゥーン'], ['spirit', 'スピリット'],
  ['union', 'ユニオン'], ['gemini', 'デュアル'], ['quickplay', '速攻魔法'], ['continuous', '永続'],
  ['equip', '装備魔法'], ['field', 'フィールド魔法'], ['counter', 'カウンター罠'],
];

// チェックボックスで複数選べる絞り込み（細かい種類・属性・種族など）
// modeToggle: AND（すべてに当てはまる）/ OR（どれかに当てはまる）の切り替えを付ける。無い欄は常にOR
function setupMulti(sel, label, entries, onChange, { modeToggle = false } = {}) {
  const box = $(sel);
  const summary = box.querySelector('summary');
  const panel = box.querySelector('.multi-panel');
  box.dataset.mode = 'or';
  const update = () => {
    const names = $$('input[type=checkbox]:checked', panel).map(i => i.dataset.label);
    const mode = box.dataset.mode.toUpperCase();
    summary.textContent = !names.length ? label
      : names.length === 1 ? names[0]
      : names.length === 2 ? names.join(` ${mode} `) : `${label}：${names.length}つ ${mode}`;
    box.classList.toggle('active', names.length > 0);
    onChange();
  };
  if (modeToggle) {
    const seg = el('div', { class: 'seg' },
      el('button', { type: 'button', dataset: { mode: 'and' }, title: 'すべてに当てはまる', text: 'AND' }),
      el('button', { type: 'button', class: 'on', dataset: { mode: 'or' }, title: 'どれかに当てはまる', text: 'OR' }));
    seg.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      box.dataset.mode = b.dataset.mode;
      update();
    });
    panel.append(el('div', { class: 'multi-mode' }, el('span', { class: 'muted', text: '複数選んだとき' }), seg));
  }
  for (const entry of entries) {
    if (!entry) { panel.append(el('div', { class: 'multi-gap' })); continue; } // 配置用の空きマス
    const [v, l] = entry;
    const cb = el('input', { type: 'checkbox', value: v, dataset: { label: l } });
    cb.addEventListener('change', update);
    panel.append(el('label', { class: 'check' }, cb, l));
  }
  panel.append(el('button', { class: 'btn small multi-clear', text: '選択を解除', onclick: () => {
    $$('input[type=checkbox]', panel).forEach(i => { i.checked = false; });
    update();
  } }));
}
const segMode = sel => ($(sel + ' button.on') || {}).dataset?.mode || 'and';
const getMulti = sel => $$(sel + ' .multi-panel input[type=checkbox]:checked').map(i => i.value);

// 絞り込みパネルの外をクリックしたら閉じる
document.addEventListener('pointerdown', e => {
  for (const d of $$('details.multi[open]')) if (!d.contains(e.target)) d.open = false;
});

function renderResults() {
  const box = $('#results');
  box.innerHTML = '';
  if (!DB.cards.length) return;
  if (Related.card) { renderRelated(box); return; }
  const text = $('#qt').value.trim();
  const fmt = curFormat();
  const ctx = regContext(Decks.current());
  const res = searchCards({
    format: fmt, q: $('#q').value, qMode: segMode('#q-mode'), text, textMode: segMode('#qt-mode'), kind: $('#f-kind').value, sub: getMulti('#f-sub'), subMode: $('#f-sub').dataset.mode,
    attr: getMulti('#f-attr'), race: getMulti('#f-race'), level: getMulti('#f-level'), rank: getMulti('#f-rank'), link: getMulti('#f-link'), marker: getMulti('#f-marker'), markerMode: $('#f-marker').dataset.mode, sort: $('#f-sort').value,
  });
  $('#result-count').textContent = res.length > MAX_RESULTS
    ? `${res.length}件（上位${MAX_RESULTS}件を表示。条件をしぼってください）`
    : `${res.length}件`;
  const frag = document.createDocumentFragment();
  for (const c of res.slice(0, MAX_RESULTS)) frag.append(resultRow(c, ctx, text));
  box.append(frag);
}

// 検索結果の1行
function resultRow(c, ctx, text) {
  const info = isMonster(c)
    ? `${levelText(c)} ${ATTR[c.attr] || ''} ${RACE[c.race] || ''}　${statText(c)}${has(c, T.LINK) ? "　" + linkArrowsText(c) : ""}`
    : typeLine(c);
  const row = el('div', { class: 'result-row', onclick: () => showDeckCard(c) },
    rowMark(c),
    el('div', { class: 'r-main' },
      el('div', { class: 'r-name' }, limitBadge(c, ctx), c.name + (c.noJp ? '（TCG）' : '')),
      el('div', { class: 'r-info', text: info }),
      text ? snippetEl(c.jaText, text) : null),
    el('button', { class: 'btn small', title: 'サイドデッキに追加', text: 'S', onclick: e => { e.stopPropagation(); addToDeck(c, 'side'); } }),
    el('button', { class: 'btn small primary', title: 'デッキに追加', text: '＋', onclick: e => { e.stopPropagation(); addToDeck(c); } }),
  );
  row.addEventListener('contextmenu', e => { e.preventDefault(); addToDeck(c); });
  return row;
}

// ---------- 関連カード ----------
// 選んだカードについて、次のカードを検索結果の欄にまとめて出す
//  ・効果に「」で書かれているカード
//  ・効果に「」で書かれているテーマ（「耀聖」など）のカード
//  ・同じテーマのカード
//  ・効果にこのカードの名前が書かれているカード
const Related = { card: null, text: '' };

async function showRelated(c) {
  Related.card = c;
  Related.text = c.jaText || '';
  // スマホ：詳細の画面を閉じて「カードを探す」に切り替える
  if (isMobile()) {
    [...openModals].forEach(close => close());
    const tab = $('#deck-mtabs button[data-pane="search"]');
    if (tab) tab.click();
  }
  renderResults();
  $('#results').scrollTop = 0;
  // 効果文がまだ無いときは取ってきて、出し直す
  if (!Related.text) {
    const t = await fetchCardTexts(c).catch(() => null);
    const text = t ? [t.jaP, t.ja].filter(Boolean).join('\n') : '';
    if (Related.card === c && text) { Related.text = text; renderResults(); }
  }
}

function relatedGroups(c, text) {
  const fmt = curFormat();
  const usable = x => x.id !== c.id && !isToken(x) && cardAllowed(x, fmt);
  const seen = new Set([c.id]);
  const groups = [];
  const add = (title, list) => {
    const cards = list.filter(x => usable(x) && !seen.has(x.id));
    cards.forEach(x => seen.add(x.id));
    if (cards.length) groups.push({ title, cards });
  };
  const byName = new Map(DB.cards.map(x => [x.name, x]));
  const quoted = [...new Set([...(text || '').matchAll(/「([^「」]+)」/g)].map(m => m[1].trim()).filter(s => s && s !== c.name))];
  // 効果に書かれているカード
  add('効果に書かれているカード', quoted.map(s => byName.get(s)).filter(Boolean));
  // 効果に書かれているテーマ（カード名ではない「」）→ 名前にその言葉が入っているカード
  const themeWords = quoted.filter(s => !byName.has(s)).map(s => normalizeText(s)).filter(s => s.length >= 2);
  if (themeWords.length) add('効果に書かれているテーマのカード', DB.cards.filter(x => themeWords.some(w => (x.nkey || normalizeText(x.name)).includes(w))));
  // 同じテーマ（カテゴリ）のカード
  const mine = cardThemes(c);
  if (mine.length) add('同じテーマのカード', DB.cards.filter(x => cardThemes(x).some(t => mine.includes(t))));
  // 効果にこのカードの名前が書かれているカード
  const quote = `「${c.name}」`;
  add('このカードの名前が効果に書かれているカード', DB.cards.filter(x => x.jaText && x.jaText.includes(quote)));
  // 各グループの中は種類順（モンスター→魔法→罠、EXは後ろ）、同じ種類は新しい順
  const kindRank = x => (isExtraType(x) ? 3 : isMonster(x) ? 0 : has(x, T.SPELL) ? 1 : 2);
  for (const g of groups) g.cards.sort((a, b) => kindRank(a) - kindRank(b) || b.cid - a.cid);
  return groups;
}

function renderRelated(box) {
  const c = Related.card;
  const ctx = regContext(Decks.current());
  const groups = relatedGroups(c, Related.text);
  const total = groups.reduce((n, g) => n + g.cards.length, 0);
  $('#result-count').textContent = `「${c.name}」の関連カード ${total}件`;
  const frag = document.createDocumentFragment();
  frag.append(el('div', { class: 'rel-head' },
    el('span', { text: `🔍「${c.name}」の関連カード` }),
    el('button', { class: 'btn small', text: '✕ 普通の検索に戻る', onclick: () => { Related.card = null; renderResults(); } })));
  if (!total) frag.append(el('p', { class: 'muted rel-empty', text: '関連カードが見つかりませんでした。' }));
  for (const g of groups) {
    frag.append(el('div', { class: 'rel-group', text: `${g.title}（${g.cards.length}）` }));
    for (const x of g.cards.slice(0, MAX_RESULTS)) frag.append(resultRow(x, ctx, ''));
  }
  if (!DB.cards.some(x => x.jaText)) frag.append(el('p', { class: 'muted rel-empty', text: 'テキスト検索用データの読み込みが終わると、「このカードの名前が効果に書かれているカード」も出ます。' }));
  box.append(frag);
}

// テキスト検索で当たった部分の前後を、語を強調して表示する
function snippetEl(fullText, query) {
  if (!fullText) return null;
  // 全角英数字だけ半角にそろえる（①などの記号はそのまま残す）
  const half = s => s.replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  const src = half(fullText).replace(/\n/g, ' ');
  const words = query.split(/[\s　]+/).filter(Boolean).map(half);
  const first = words.map(w => src.indexOf(w)).filter(i => i >= 0).sort((a, b) => a - b)[0];
  const start = first === undefined ? 0 : Math.max(0, first - 18);
  const part = (start > 0 ? '…' : '') + src.slice(start, start + 90);
  const node = el('div', { class: 'r-snippet' });
  const re = words.length ? new RegExp('(' + words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'g') : null;
  if (!re) { node.textContent = part; return node; }
  part.split(re).forEach((s, i) => node.append(i % 2 ? el('mark', { text: s }) : s));
  return node;
}

// ---------- デッキ表示 ----------
// デッキの表紙にするカード（EXの1枚目、無ければメインの1枚目）
function deckCover(d) {
  const id = d.extra[0] || d.main[0];
  const c = id && DB.byId.get(id);
  if (!c) return el('div', { class: 'chip-cover empty', text: '空' });
  if (!hasImage(c, 'art')) return el('div', { class: 'chip-cover ' + frameClass(c) });
  const box = el('div', { class: 'chip-cover' });
  box.append(cardImg(c.id, 'art', img => img.remove()));
  return box;
}

// マイデッキ一覧（クリックで切り替え。最後に「＋ 新しいデッキ」）
function renderDeckList() {
  const list = $('#deck-list');
  list.innerHTML = '';
  // デッキ名で絞り込み（ひらがな/カタカナ・全角/半角の違いは無視。スペース区切りは全部含むもの）
  const terms = splitTerms($('#deck-filter').value);
  const shown = Decks.list.filter(d => {
    const key = normalizeText(d.name);
    return terms.every(t => key.includes(t));
  });
  if (terms.length && !shown.length) list.append(el('div', { class: 'muted deck-none', text: '一致するデッキはありません' }));
  for (const d of shown) {
    const ok = d.main.length >= 40;
    list.append(el('button', {
      class: 'deck-chip' + (d.id === Decks.currentId ? ' current' : ''), title: d.name,
      onclick: () => { Decks.currentId = d.id; Decks.save(); renderDeck(); renderResults(); },
    },
      deckCover(d),
      el('div', { class: 'chip-body' },
        el('div', { class: 'chip-name', text: d.name }),
        el('div', { class: 'chip-count' + (ok ? '' : ' warn-text') },
          el('span', { class: 'fmt-tag fmt-' + deckFormat(d), text: FORMATS[deckFormat(d)].short }),
          ` メイン${d.main.length}・EX${d.extra.length}`))));
  }
  list.append(el('button', { class: 'deck-chip new', onclick: newDeck }, el('span', { class: 'plus', text: '＋' }), '新しいデッキ'));
  $('#deck-total').textContent = terms.length ? `${Decks.list.length}個中${shown.length}個` : `${Decks.list.length}個`;
}

function newDeck() {
  promptText('新しいデッキの名前', `デッキ${Decks.list.length + 1}`, name => {
    const d = Decks.blank(name); Decks.list.push(d); Decks.currentId = d.id; Decks.save(); renderDeck();
    toast(`「${name}」を作りました。左の検索からカードを追加してください`);
  });
}

function renderDeck() {
  const deck = Decks.current();
  if (applySort(deck)) Decks.save();   // 選んでいる並び順に合わせる（追加したカードもここで正しい位置に入る）
  renderDeckList();
  $('#deck-name').textContent = deck.name;
  $('#deck-sum').textContent = `メイン${deck.main.length}枚・EX${deck.extra.length}枚・サイド${deck.side.length}枚`;
  $('#mt-count').textContent = `（${deck.main.length}）`;

  // ルールの切り替えボタンと、ルール違反の警告
  const fmt = deckFormat(deck);
  $$('#deck-format button').forEach(b => b.classList.toggle('on', b.dataset.format === fmt));
  const { notAllowed, over } = deckProblems(deck);
  const bad = new Set([...notAllowed, ...over.map(s => s.replace(/（.*$/, ''))]);
  const warn = $('#deck-warn');
  warn.innerHTML = '';
  warn.hidden = !notAllowed.length && !over.length;
  if (notAllowed.length) warn.append(el('div', { text: `⚠ ${FORMATS[fmt].label}で使えないカード：${notAllowed.join('、')}` }));
  if (over.length) warn.append(el('div', { text: `⚠ 禁止・制限の枚数オーバー：${over.join('、')}` }));
  // レギュレーション（禁止・制限リスト）の選択
  const ctx = regContext(deck);
  renderRegSelect(deck);
  ensureRegLoaded(deck);
  $('#deck-banlist').textContent = ctx.custom ? customRegNote(ctx.custom)
    : ctx.none ? '禁止・制限なし'
    : ctx.loading ? '読み込み中…'
    : ctx.date ? `${ctx.reg.replace(/-/g, '/')}〜${ctx.endDate.replace(/-/g, '/')} のリスト：${ctx.endDate.replace(/-/g, '/')}（このリストの最後の日）までに発売されたカードが使えます`
    : (ctx.vector ? '' : '（リスト未取得）');

  for (const sec of ['main', 'extra', 'side']) {
    const grid = $('#deck-' + sec);
    grid.innerHTML = '';
    deck[sec].forEach((id, i) => {
      const c = DB.byId.get(id);
      if (!c) { grid.append(el('div', { class: 'deck-tile missing', text: '不明なカード ' + id })); return; }
      const badge = limitBadge(c, ctx);
      const tile = el('div', { class: 'deck-tile' + (bad.has(c.name) ? ' invalid' : ''), onclick: () => showDeckCard(c) },
        cardFace(c, { small: true }),
        badge ? el('div', { class: 'tile-lim' }, badge) : null,
        el('button', { class: 'tile-remove', title: '1枚減らす', text: '−', onclick: e => { e.stopPropagation(); removeFromDeck(sec, i); } }));
      tile.addEventListener('contextmenu', e => { e.preventDefault(); removeFromDeck(sec, i); });
      grid.append(tile);
    });
    const n = deck[sec].length;
    const warn = sec === 'main' && n < 40 ? '（40枚以上必要）' : '';
    $('#cnt-' + sec).textContent = `${n}枚${warn}`;
  }
  if (typeof refreshBoardDeckSelect === 'function') refreshBoardDeckSelect();
}

// ---------- 並び順（全部のデッキ共通。追加したときもこの順に入る） ----------
const SORT_MODES = { theme: 'テーマごと', type: '種類ごと', manual: '追加した順' };
const sortMode = () => store.get('ygo.deckSort', 'theme');

// カードのテーマ（カテゴリ番号）。下位12ビットが同じものは同じテーマ（「〇〇・××」のような派生も含める）
function cardThemes(c) {
  const e = typeof EDO_CARDS !== 'undefined' && EDO_CARDS.d[c.id];
  let list = e && e[1] ? e[1] : null;
  if (!list) { list = []; for (let s = c.setcode || 0; s > 0; s = Math.floor(s / 65536)) list.push(s % 65536); }
  return [...new Set(list.map(s => s & 0xfff).filter(Boolean))];
}

// テーマごと：デッキ全体で多いテーマから順に固め、テーマ内は種類順。2枚以上ないテーマや汎用カードは最後
function themeSorter(deck) {
  const all = [...deck.main, ...deck.extra, ...deck.side].map(id => DB.byId.get(id)).filter(Boolean);
  const freq = new Map();
  const seen = new Set();
  for (const c of all) {
    if (seen.has(c.name)) { for (const t of cardThemes(c)) freq.set(t, freq.get(t) + 0.001); continue; } // 同名は種類数を優先
    seen.add(c.name);
    for (const t of cardThemes(c)) freq.set(t, (freq.get(t) || 0) + 1);
  }
  const themeOf = c => {
    let best = 0, bf = 1;
    for (const t of cardThemes(c)) { const f = freq.get(t) || 0; if (f >= 2 && f > bf) { best = t; bf = f; } }
    return best;
  };
  const keyCache = new Map();
  const key = c => { if (!keyCache.has(c.id)) keyCache.set(c.id, themeOf(c)); return keyCache.get(c.id); };
  return (a, b) => {
    const ta = key(a), tb = key(b);
    if (ta !== tb) {
      if (!ta || !tb) return ta ? -1 : 1;
      return (freq.get(tb) - freq.get(ta)) || ta - tb;
    }
    return compareCards(a, b);
  };
}

// 並び順に合わせて並べ直す。変わったら true
function applySort(deck, mode = sortMode()) {
  if (mode === 'manual') return false;
  const cmp = mode === 'theme' ? themeSorter(deck) : compareCards;
  let changed = false;
  for (const sec of ['main', 'extra', 'side']) {
    const before = deck[sec].join();
    deck[sec].sort((a, b) => {
      const ca = DB.byId.get(a), cb = DB.byId.get(b);
      if (!ca || !cb) return (ca ? -1 : 0) + (cb ? 1 : 0);
      return cmp(ca, cb) || a - b;
    });
    if (deck[sec].join() !== before) changed = true;
  }
  return changed;
}

function sortDeck() {
  const deck = Decks.current();
  applySort(deck, sortMode() === 'manual' ? 'theme' : sortMode());
  Decks.save();
  renderDeck();
}

// ---------- 読み込み・書き出し ----------
function toYdk(deck) {
  return ['#created by ygo-practice', '#main', ...deck.main, '#extra', ...deck.extra, '!side', ...deck.side].join('\n') + '\n';
}

function toTextList(deck) {
  const lines = [];
  for (const sec of ['main', 'extra', 'side']) {
    if (!deck[sec].length) continue;
    lines.push(`【${SECTION_LABEL[sec]}】`);
    const counts = new Map();
    for (const id of deck[sec]) counts.set(id, (counts.get(id) || 0) + 1);
    for (const [id, n] of counts) { const c = DB.byId.get(id); lines.push(`${c ? c.name : id} ×${n}`); }
  }
  return lines.join('\n');
}

// YDK形式 か「カード名 ×3」形式のテキストを読む
// ---------- YDKE（デッキを1行の文字列にした形式。EDOPro・Duelingbook・拡張機能などで使われる） ----------
// ydke://<メイン>!<EX>!<サイド>!  それぞれカードのパスワード（4バイト・リトルエンディアン）を並べて Base64 にしたもの
function decodeYdkePart(b64) {
  if (!b64) return [];
  const bin = atob(b64);
  const out = [];
  for (let i = 0; i + 3 < bin.length; i += 4) {
    out.push((bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8) | (bin.charCodeAt(i + 2) << 16) | (bin.charCodeAt(i + 3) << 24)) >>> 0);
  }
  return out;
}
function encodeYdkePart(ids) {
  let bin = '';
  for (const id of ids) bin += String.fromCharCode(id & 0xff, (id >>> 8) & 0xff, (id >>> 16) & 0xff, (id >>> 24) & 0xff);
  return btoa(bin);
}
const toYdke = deck => `ydke://${encodeYdkePart(deck.main)}!${encodeYdkePart(deck.extra)}!${encodeYdkePart(deck.side)}!`;

// ---------- このアプリのデッキコード（YGO2-…、古い YGO1-…） ----------
// 中身：版(1) / デッキ名(UTF-8) / メイン・EX・サイドの「カードの種類数, (前のカード番号との差×4＋枚数)…」を
// 可変長の数値で並べ、URLに使える Base64 にしたもの。サーバー不要で、コードだけでデッキを再現できる。
const DECK_CODE_PREFIX = 'YGO1-';

function pushVarint(arr, n) {
  while (n >= 0x80) { arr.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
  arr.push(n);
}
function readVarint(bytes, pos) {
  let n = 0, mul = 1, b;
  do {
    if (pos.i >= bytes.length) throw new Error('コードが途中で切れています');
    b = bytes[pos.i++];
    n += (b & 0x7f) * mul; mul *= 128;
  } while (b & 0x80);
  return n;
}
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), ch => ch.charCodeAt(0));

// 古い形式（YGO1-）。読み込みは今も対応。先頭の1バイトでルールを表す（1 = OCG、2 = マスターデュエル）
const CODE_FORMAT = { ocg: 1, md: 2 };
function encodeDeckCode1(deck) {
  const bytes = [CODE_FORMAT[deckFormat(deck)] || 1];
  const name = new TextEncoder().encode(deck.name).slice(0, 60);
  pushVarint(bytes, name.length); bytes.push(...name);
  for (const sec of ['main', 'extra', 'side']) {
    // 同じカードはまとめて「何枚か」で表す（並び順は最初に出てきた順）
    const counts = new Map();
    for (const id of deck[sec]) { const c = DB.byId.get(id); if (c && c.cid) counts.set(c.cid, (counts.get(c.cid) || 0) + 1); }
    // カード番号を小さい順に並べ、前の番号との差だけを書く（数が小さくなりコードが短くなる）
    const entries = [...counts].sort((a, b) => a[0] - b[0]);
    pushVarint(bytes, entries.length);
    let prev = 0;
    for (const [cid, n] of entries) { pushVarint(bytes, (cid - prev) * 4 + Math.min(n, 3)); prev = cid; }
  }
  // 最後に禁止・制限リストの指定（0=最新、1=制限なし、それ以外=2000/1/1からの日数＋2）。古いコードには無いので省略可
  const reg = deck.reg || 'latest';
  // オリジナルはコードに入れられないので最新として書く
  pushVarint(bytes, reg === 'latest' || reg.startsWith('custom:') ? 0 : reg === 'none' ? 1 : Math.round((Date.parse(reg) - Date.UTC(2000, 0, 1)) / 86400000) + 2);
  return DECK_CODE_PREFIX + b64url(bytes);
}

// ---------- 短いデッキコード（YGO2-…） ----------
// YGO1 と同じ中身を、バイト単位ではなくビット単位で詰める：
//  ・カード番号の差は「指数ゴロム符号」（小さい数ほど短い）。区切りごとに一番短くなる長さの目安(k)を選ぶ
//  ・枚数は2ビット
//  ・デッキ名はかな1文字10ビット、英数字8ビット、漢字など18ビット（UTF-8 だと、かな・漢字は24ビット）
const DECK_CODE2_PREFIX = 'YGO2-';
class BitWriter {
  constructor() { this.bytes = []; this.n = 0; }
  bit(b) { if (!(this.n & 7)) this.bytes.push(0); if (b) this.bytes[this.bytes.length - 1] |= 0x80 >> (this.n & 7); this.n++; }
  bits(v, len) { for (let i = len - 1; i >= 0; i--) this.bit(Math.floor(v / 2 ** i) % 2); }
  eg(v, k) { const w = v + 2 ** k; const len = Math.floor(Math.log2(w)) + 1; for (let i = 0; i < len - k - 1; i++) this.bit(0); this.bits(w, len); }
}
class BitReader {
  constructor(bytes) { this.bytes = bytes; this.n = 0; }
  bit() { if (this.n >= this.bytes.length * 8) throw new Error('コードが途中で切れています'); const b = (this.bytes[this.n >> 3] >> (7 - (this.n & 7))) & 1; this.n++; return b; }
  bits(len) { let v = 0; for (let i = 0; i < len; i++) v = v * 2 + this.bit(); return v; }
  eg(k) { let z = 0; while (!this.bit()) { if (++z > 40) throw new Error('コードが正しくありません'); } return (2 ** (z + k) + this.bits(z + k)) - 2 ** k; }
}
const egCost = (v, k) => 2 * Math.floor(Math.log2(v + 2 ** k)) - k + 1;

function encodeDeckCode(deck) {
  const w = new BitWriter();
  w.bits(CODE_FORMAT[deckFormat(deck)] || 1, 2);
  // デッキ名（最大40文字）
  const name = [...(deck.name || '')].join('').slice(0, 40);
  w.eg(name.length, 3);
  for (let i = 0; i < name.length; i++) {
    const ch = name.charCodeAt(i);
    if (ch < 0x80) { w.bit(0); w.bits(ch, 7); }
    else if (ch >= 0x3000 && ch <= 0x30ff) { w.bit(1); w.bit(0); w.bits(ch - 0x3000, 8); }
    else { w.bit(1); w.bit(1); w.bits(ch, 16); }
  }
  for (const sec of ['main', 'extra', 'side']) {
    const counts = new Map();
    for (const id of deck[sec]) { const c = DB.byId.get(id); if (c && c.cid) counts.set(c.cid, (counts.get(c.cid) || 0) + 1); }
    const entries = [...counts].sort((a, b) => a[0] - b[0]);
    w.eg(entries.length, 2);
    if (!entries.length) continue;
    let prev = 0;
    const deltas = entries.map(([cid]) => { const d = cid - prev - 1; prev = cid; return d; });
    // 一番短くなる k を選ぶ（0〜15）
    let bestK = 0, best = Infinity;
    for (let k = 0; k < 16; k++) { const cost = deltas.reduce((s, d) => s + egCost(d, k), 0); if (cost < best) { best = cost; bestK = k; } }
    w.bits(bestK, 4);
    entries.forEach(([, n], i) => { w.eg(deltas[i], bestK); w.bits(Math.min(n, 3), 2); });
  }
  const reg = deck.reg || 'latest';
  w.eg(reg === 'latest' || reg.startsWith('custom:') ? 0 : reg === 'none' ? 1 : Math.round((Date.parse(reg) - Date.UTC(2000, 0, 1)) / 86400000) + 2, 0);
  return DECK_CODE2_PREFIX + b64url(w.bytes);
}

function decodeDeckCode2(code) {
  const r = new BitReader(unb64url(code.slice(DECK_CODE2_PREFIX.length).trim()));
  const head = r.bits(2);
  const format = Object.keys(CODE_FORMAT).find(k => CODE_FORMAT[k] === head);
  if (!format) throw new Error('このアプリでは読めない形式のコードです');
  const len = r.eg(3);
  if (len > 40) throw new Error('コードが正しくありません');
  let name = '';
  for (let i = 0; i < len; i++) {
    if (!r.bit()) name += String.fromCharCode(r.bits(7));
    else if (!r.bit()) name += String.fromCharCode(0x3000 + r.bits(8));
    else name += String.fromCharCode(r.bits(16));
  }
  const deck = { name, format, main: [], extra: [], side: [] }, unknown = [];
  for (const sec of ['main', 'extra', 'side']) {
    const kinds = r.eg(2);
    if (!kinds) continue;
    if (kinds > 200) throw new Error('コードが正しくありません');
    const k = r.bits(4);
    let prev = 0;
    for (let i = 0; i < kinds; i++) {
      const cid = prev + r.eg(k) + 1;
      prev = cid;
      const n = r.bits(2);
      const c = DB.byCid.get(cid);
      if (!c) { unknown.push(`カード番号 ${cid}`); continue; }
      for (let j = 0; j < n; j++) deck[sec].push(c.id);
    }
  }
  const v = r.eg(0);
  deck.reg = v === 0 ? 'latest' : v === 1 ? 'none' : new Date(Date.UTC(2000, 0, 1) + (v - 2) * 86400000).toISOString().slice(0, 10);
  return { deck, unknown };
}

function decodeDeckCode(code) {
  if (code.startsWith(DECK_CODE2_PREFIX)) return decodeDeckCode2(code);
  const bytes = unb64url(code.replace(DECK_CODE_PREFIX, '').trim());
  const pos = { i: 0 };
  const head = bytes[pos.i++];
  const format = Object.keys(CODE_FORMAT).find(k => CODE_FORMAT[k] === head);
  if (!format) throw new Error('このアプリでは読めない形式のコードです');
  const nameLen = readVarint(bytes, pos);
  const name = new TextDecoder().decode(bytes.slice(pos.i, pos.i + nameLen)); pos.i += nameLen;
  const deck = { name, format, main: [], extra: [], side: [] }, unknown = [];
  for (const sec of ['main', 'extra', 'side']) {
    const kinds = readVarint(bytes, pos);
    let prev = 0;
    for (let k = 0; k < kinds; k++) {
      const v = readVarint(bytes, pos);
      const cid = prev + Math.floor(v / 4);
      prev = cid;
      const c = DB.byCid.get(cid);
      if (!c) { unknown.push(`カード番号 ${cid}`); continue; }
      for (let i = 0; i < (v % 4); i++) deck[sec].push(c.id);
    }
  }
  if (pos.i < bytes.length) {
    const r = readVarint(bytes, pos);
    deck.reg = r === 0 ? 'latest' : r === 1 ? 'none' : new Date(Date.UTC(2000, 0, 1) + (r - 2) * 86400000).toISOString().slice(0, 10);
  }
  return { deck, unknown };
}

// 文章やリンクの中からデッキコードを探す（共有リンクの #deck=… にも対応）
function findDeckCode(text) {
  const m = (text || '').match(/YGO[12]-[A-Za-z0-9_-]+/);
  return m ? m[0] : null;
}

function parseDeckText(text) {
  const result = { main: [], extra: [], side: [] }, unknown = [], review = [];   // review：似ている候補から選んでもらう行

  // このアプリのデッキコード
  const code = findDeckCode(text);
  if (code) {
    try {
      const d = decodeDeckCode(code);
      return { result: { main: d.deck.main, extra: d.deck.extra, side: d.deck.side }, unknown: d.unknown, name: d.deck.name, format: d.deck.format, reg: d.deck.reg };
    } catch (e) {
      return { result, unknown: ['デッキコードを読めませんでした：' + e.message] };
    }
  }

  // YDKE が含まれていればそれを読む
  const y = text.match(/ydke:\/\/([A-Za-z0-9+/=]*)!([A-Za-z0-9+/=]*)!([A-Za-z0-9+/=]*)!?/);
  if (y) {
    ['main', 'extra', 'side'].forEach((sec, i) => {
      for (const id of decodeYdkePart(y[i + 1])) {
        if (DB.byId.has(id)) result[sec].push(id); else unknown.push(`パスワード ${id}`);
      }
    });
    return { result, unknown };
  }

  let sec = 'main';
  const isYdk = /^\s*#main/m.test(text);
  let last = null;   // 直前に読んだカード（次の行が枚数だけのとき用）
  // secOverride：表の何列目かで決まる区分（左右2列のデッキ登録用紙など）
  const add = (c, n, explicit, secOverride) => {
    const s = secOverride || sec;
    const target = isExtraType(c) && s === 'main' ? 'extra' : (!isExtraType(c) && s === 'extra' ? 'main' : s);
    for (let i = 0; i < Math.min(n, MAX_COPIES); i++) result[target].push(c.id);
    last = { c, target, explicit };
  };
  // 表の列ごとの区分（例：左の列はメイン、右の列はEX→サイド）
  const colSec = [];
  const countOf = s => { const m = (s || '').match(/^[×xX]?\s*([1-3])\s*枚?$/); return m ? +m[1] : 0; };
  const secOf = s => (/side|サイド/i.test(s) ? 'side' : /extra|ＥＸ|^ex|エクストラ/i.test(s) ? 'extra' : /main|メイン|モンスター|魔法|罠/i.test(s) ? 'main' : null);
  // 3つ以上に区切られた行（複数列の表）を、「枚数・カード名」の組ごとに左から読む。読めたら true
  const parseColumns = cells => {
    let col = 0, used = false;
    for (let k = 0; k < cells.length; k++) {
      const a = cells[k], b = cells[k + 1];
      if (/^枚数$/.test(a) && b !== undefined) { const s = secOf(b); if (s) colSec[col] = s; col++; k++; used = true; continue; }
      const cb = b !== undefined && countOf(a) ? findCardByName(b) : null;
      if (cb) { add(cb, countOf(a), true, colSec[col]); col++; k++; used = true; continue; }
      const ca = findCardByName(a);
      if (ca) {
        // カード名の後ろの列に枚数があれば使う（「カード名｜種類｜枚数」のように間に別の列があってもよい）
        let j = k + 1;
        while (j < cells.length && !countOf(cells[j]) && !findCardByName(cells[j])) j++;
        if (j < cells.length && countOf(cells[j])) { add(ca, countOf(cells[j]), true, colSec[col]); k = j; }
        else add(ca, 1, false, colSec[col]);
        col++; used = true; continue;
      }
      const s = a.length <= 14 ? secOf(a) : null;
      if (s) { colSec[col] = s; used = true; }
    }
    return used;
  };
  // 見出しなどの、カードではない行（公式データベースのページをコピーしたときに混ざるもの）
  const ignorable = l => /^(モンスター|魔法|罠|monster|spell|trap|カード名|枚数|合計|total|レアリティ|種類)/i.test(l) || /^[\d\s()（）枚:：/／-]+$/.test(l);

  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;

    // 枚数だけの行 → 直前のカードの枚数
    const lone = line.match(/^[×xX]?\s*([1-3])\s*枚?$/);
    if (lone && last && !last.explicit) {
      for (let i = 1; i < +lone[1]; i++) result[last.target].push(last.c.id);
      last.explicit = true;
      continue;
    }
    // YDK の見出し（#main / #extra / !side）やコメント行
    if (/^[#!]/.test(line)) {
      if (/side/i.test(line)) sec = 'side';
      else if (/extra/i.test(line)) sec = 'extra';
      else if (/main/i.test(line)) sec = 'main';
      last = null;
      continue;
    }
    if (isYdk || /^\d{5,9}$/.test(line)) {
      const id = parseInt(line, 10);
      if (DB.byId.has(id)) result[sec].push(id); else unknown.push(line);
      continue;
    }
    // 複数列の表（PDFのデッキ登録用紙など）
    const multi = line.split(/\t|\s{2,}|\s*[|｜]\s*/).map(s => s.trim()).filter(Boolean);
    if (multi.length >= 3 && parseColumns(multi)) continue;

    // そのままカード名と一致する行（「デッキ破壊ウイルス」のように見出しと紛らわしい名前もあるので先に調べる）
    const exact = findCardByName(line);
    if (exact && normalizeText(line) === exact.nkey) { add(exact, 1, false); continue; }

    // 見出し（メイン／EX／サイド）
    if (line.length <= 24 && /(デッキ|deck|^【|^\[|^#|^!)/i.test(line)) {
      if (/side|サイド/i.test(line)) { sec = 'side'; last = null; continue; }
      if (/extra|ＥＸ|ex|エクストラ/i.test(line)) { sec = 'extra'; last = null; continue; }
      if (/main|メイン/i.test(line)) { sec = 'main'; last = null; continue; }
    }
    if (ignorable(line)) continue;

    // タブ区切り（表をコピーしたとき）：カード名の列と枚数の列を探す
    const cells = line.split(/\t|\s{2,}|\s*[|｜]\s*/).map(s => s.trim()).filter(Boolean);
    if (cells.length > 1) {
      const nameCell = cells.map(s => findCardByName(s)).find(Boolean);
      const numCell = cells.map(s => s.match(/^[×xX]?\s*([1-3])\s*枚?$/)).find(Boolean);
      if (nameCell) { add(nameCell, numCell ? +numCell[1] : 1, !!numCell); continue; }
    }

    // 「カード名 ×3」「3 カード名」「カード名 3枚」
    let name = line, n = 1, m, explicit = false;
    if ((m = line.match(/^(.*?)\s*[×xX＊*]\s*(\d+)\s*枚?$/)) || (m = line.match(/^(.*?)\s+(\d+)\s*枚?$/))) { name = m[1]; n = +m[2]; explicit = true; }
    else if ((m = line.match(/^(\d+)\s*[×xX枚]?\s+(.*)$/))) { name = m[2]; n = +m[1]; explicit = true; }
    const c = findCardByName(name);
    if (!c) {
      // 完全には一致しない：似ている名前のカードを探して、確認画面で選んでもらう
      const cands = fuzzyCandidates(name.replace(/\s*[（(][^)）]*[)）]\s*$/, ''));
      if (cands.length && cands[0].score >= 0.5) { review.push({ line, n: Math.min(n, MAX_COPIES), sec, cands: cands.map(x => ({ id: x.c.id, score: x.score })) }); continue; }
      unknown.push(line); continue;
    }
    add(c, n, explicit);
  }
  return { result, unknown, review };
}

// ---------- PDF から文字を取り出す（PDF.js を使う。使うときだけ読み込む） ----------
// 文字の位置（高さ）が同じものを1行にまとめ、離れている文字の間にはタブを入れる（表の「枚数｜カード名」を分けるため）
const PDFJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
async function pdfToText(buf) {
  if (typeof pdfjsLib === 'undefined') await loadScript(PDFJS_BASE + 'pdf.min.js');
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const out = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 10); p++) {
    const page = await pdf.getPage(p);
    const { items } = await page.getTextContent();
    const rows = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || 10;
      let row = rows.find(r => Math.abs(r.y - y) < h * 0.5);
      if (!row) rows.push(row = { y, h, parts: [] });
      row.parts.push({ x, w: it.width || 0, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);   // 上の行から
    for (const r of rows) {
      r.parts.sort((a, b) => a.x - b.x);
      let line = '', end = null;
      for (const part of r.parts) {
        if (end !== null) line += part.x - end > r.h * 0.8 ? '\t' : '';
        line += part.s;
        end = part.x + part.w;
      }
      // PDFによっては「穴」「生」などが部首の文字（⽳・⽣）で入っているので普通の漢字に直す
      out.push(line.replace(/[⺀-⿟]/g, ch => ch.normalize('NFKC')).trim());
    }
  }
  return out.join('\n');
}

// PDF の1ページ目を画像（PNG）にする（文字の入っていない、デッキ画像の PDF 用）
async function pdfFirstPageImage(buf) {
  if (typeof pdfjsLib === 'undefined') await loadScript(PDFJS_BASE + 'pdf.min.js');
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const page = await pdf.getPage(1);
  const vp0 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: Math.min(4, 1400 / vp0.width) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  return new Promise(res => canvas.toBlob(res, 'image/png'));
}

function openImport() {
  const ta = el('textarea', { class: 'full', rows: 12, placeholder: '次のどれでも貼り付けられます\n・YDKファイルの中身\n・ydke:// で始まる文字列\n・公式カードデータベースのデッキページからコピーした文字\n・「灰流うらら ×3」のようなカード名の一覧' });
  const neuronHelp = el('details', { class: 'import-help' },
    el('summary', { text: 'ニューロン／マスターデュエルのデッキを取り込むには' }),
    el('p', { text: 'いちばん簡単なのは、ニューロンの「デッキ画像」を保存して、上の「ファイルから」で選ぶ方法です。カードのイラストを照合してデッキにします。' }),
    el('ol', null,
      el('li', { text: 'ニューロンを KONAMI ID と連携すると、デッキが公式カードデータベース（db.yugioh-card.com）の「マイデッキ」に表示されます。' }),
      el('li', { text: 'パソコンのブラウザでそのデッキのページを開き、カード一覧の部分を選択してコピーし、下の欄に貼り付けます。' }),
      el('li', { text: 'うまく読めない場合は、ブラウザ拡張「Deck transfer for Master Duel」を入れると、デッキのページに書き出しボタンが付きます。YDKファイルか ydke:// の文字列で書き出して、ここで読み込んでください。' })),
    el('p', { class: 'muted', text: '※ニューロンの「デッキコード」は KONAMI のサーバーに保存されたデッキの番号なので、コードそのものからは読み取れません。' }));
  // iPhone は知らない拡張子（.ydk など）を指定すると選べなくなるので、種類をしぼらない
  const file = el('input', { type: 'file', accept: isIOS ? null : '.ydk,.txt,.pdf,application/pdf,image/*' });
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    // 画像（ニューロンのデッキ画像やスクリーンショット）→ カードのイラストで照合する
    if (/^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(f.name)) {
      closeImport();
      openImageImport(f);
      return;
    }
    if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
      // PDF（大会のデッキ登録用紙やデッキレシピ）から文字を取り出して、下の欄に入れる
      ta.value = 'PDFを読み込み中…';
      try {
        const buf = await f.arrayBuffer();
        ta.value = await pdfToText(buf.slice(0));
        if (!ta.value.trim()) ta.value = '';
        const { result } = parseDeckText(ta.value);
        const n = result.main.length + result.extra.length + result.side.length;
        if (n) { toast(`PDFから${n}枚のカードを読み取りました。内容を確かめて「読み込む」を押してください`); return; }
        // 文字が無い（デッキ画像を PDF にしたもの）なら、1ページ目を画像にしてイラストで照合する
        const img = await pdfFirstPageImage(buf);
        closeImport();
        openImageImport(new File([img], f.name.replace(/\.pdf$/i, '.png'), { type: 'image/png' }));
      } catch (e) {
        ta.value = '';
        toast('PDFを読めませんでした：' + e.message);
      }
      return;
    }
    ta.value = await f.text();
  });
  const asNew = el('input', { type: 'checkbox', checked: true });
  let closeImport = () => {};
  closeImport = showModal({
    title: 'デッキを読み込む', wide: true,
    body: el('div', { class: 'stack' }, neuronHelp, el('div', null, 'ファイルから：', file), ta,
      el('label', { class: 'check' }, asNew, '新しいデッキとして追加する（オフにすると今のデッキを上書き）')),
    buttons: [{
      label: '読み込む', primary: true, onClick: () => {
        const { result, unknown, name, format, reg, review = [] } = parseDeckText(ta.value);
        const total0 = result.main.length + result.extra.length + result.side.length;
        if (!total0 && !review.length) { toast(unknown[0] && unknown[0].startsWith('デッキコード') ? unknown[0] : 'カードを読み取れませんでした'); return false; }
        // 名前が完全には一致しなかった行は、候補から選んでもらってから読み込む
        if (review.length) { closeImport(); openReviewNames(review, result, () => applyImport(result, unknown, name, format, reg)); return false; }
        applyImport(result, unknown, name, format, reg);
      },
    }],
  });
  function applyImport(result, unknown, name, format, reg) {
        const total = result.main.length + result.extra.length + result.side.length;
        if (!total) { toast('カードを読み取れませんでした'); return; }
        let deck;
        if (asNew.checked) {
          deck = Decks.blank(name || (file.files[0] ? file.files[0].name.replace(/\.\w+$/, '') : '読み込んだデッキ'), format);
          if (reg) deck.reg = reg;
          Decks.list.push(deck);
          Decks.currentId = deck.id;
        } else deck = Decks.current();
        deck.main = result.main.slice(0, LIMITS.main);
        deck.extra = result.extra.slice(0, LIMITS.extra);
        deck.side = result.side.slice(0, LIMITS.side);
        Decks.save();
        renderDeck();
        if (unknown.length) {
          showModal({ title: '見つからなかったカード', body: el('div', null,
            el('p', { text: `${total}枚を読み込みました。次の行はカードが特定できませんでした：` }),
            el('pre', { class: 'card-text', text: unknown.join('\n') })) });
          return;
        }
        toast(`${total}枚を読み込みました`);
  }
}

// 名前が完全には一致しなかった行の確認：似ているカードの候補から選ぶ（「入れない」も選べる）
function openReviewNames(review, result, done) {
  const rows = review.map(r => {
    const sel = el('select', { class: 'full' },
      r.cands.map(k => el('option', { value: k.id, text: `${DB.byId.get(k.id).name}（似ている度 ${Math.round(k.score * 100)}%）` })),
      el('option', { value: 0, text: '（このカードは入れない）' }));
    // 似ている度が低いものは、最初は「入れない」にしておく
    sel.value = r.cands[0].score >= 0.6 ? r.cands[0].id : 0;
    const num = el('input', { type: 'number', min: 1, max: 3, value: r.n, class: 'num-input' });
    return { r, sel, num, node: el('div', { class: 'review-row' + (r.cands[0].score >= 0.8 ? '' : ' unsure') },
      el('div', { class: 'review-line', text: `読み取った文字：${r.line}` }),
      el('div', { class: 'row' }, sel, num, el('span', { class: 'muted', text: '枚' }))) };
  });
  showModal({
    title: `名前を確認してください（${review.length}行）`, wide: true,
    body: el('div', { class: 'stack' },
      el('p', { class: 'muted', text: '次の行は、カード名が完全には一致しませんでした。いちばん似ているカードを選んであります。違っていたら選び直してください（黄色は自信がないもの）。' }),
      el('div', { class: 'review-list' }, rows.map(x => x.node))),
    buttons: [{ label: 'この内容で読み込む', primary: true, onClick: () => {
      for (const { r, sel, num } of rows) {
        const c = DB.byId.get(+sel.value);
        if (!c) continue;
        const n = Math.max(1, Math.min(MAX_COPIES, +num.value || 1));
        const target = isExtraType(c) && r.sec === 'main' ? 'extra' : (!isExtraType(c) && r.sec === 'extra' ? 'main' : r.sec);
        for (let i = 0; i < n; i++) result[target].push(c.id);
      }
      done();
    } }],
  });
}

function openExport() {
  const deck = Decks.current();
  const text = toTextList(deck);
  showModal({
    title: 'デッキを書き出す', wide: true,
    body: el('pre', { class: 'card-text', text: text || '（空のデッキです）' }),
    buttons: [
      { label: 'テキストをコピー', onClick: () => { navigator.clipboard.writeText(text).then(() => toast('コピーしました')); return false; } },
      { label: 'ydke:// をコピー', onClick: () => { navigator.clipboard.writeText(toYdke(deck)).then(() => toast('ydke:// の文字列をコピーしました（EDOPro・拡張機能などに貼り付けられます）')); return false; } },
      {
        label: 'YDKファイルを保存', primary: true, onClick: () => {
          const a = el('a', { href: URL.createObjectURL(new Blob([toYdk(deck)], { type: 'text/plain' })), download: deck.name + '.ydk' });
          document.body.append(a); a.click(); a.remove();
          return false;
        },
      },
    ],
  });
}

// ---------- デッキコードの発行と共有 ----------
// ネット版なら、開くだけでデッキを追加できるリンクも作る
const shareUrl = code => (location.protocol.startsWith('http') ? `${location.origin}${location.pathname}#deck=${code}` : null);

function openDeckCode() {
  const deck = Decks.current();
  if (!deck.main.length && !deck.extra.length) { toast('空のデッキはコードにできません'); return; }
  const code = encodeDeckCode(deck);
  const url = shareUrl(code);
  const copy = (text, msg) => navigator.clipboard.writeText(text).then(() => toast(msg), () => toast('コピーできませんでした。手で選択してコピーしてください'));
  const codeBox = el('textarea', { class: 'full code-box', rows: 3, readonly: true });
  codeBox.value = code;
  codeBox.addEventListener('focus', () => codeBox.select());
  const body = el('div', { class: 'stack' },
    el('p', { text: `「${deck.name}」（メイン${deck.main.length}・EX${deck.extra.length}・サイド${deck.side.length}）のデッキコードです。` }),
    codeBox,
    el('p', { class: 'muted small-note', text: 'このコードを友達に送ると、相手はこのアプリの「デッキコードから追加」に貼るだけで同じデッキを追加できます。' + (url ? 'リンクを送れば、開くだけで追加できます。' : '') }));
  const buttons = [{ label: 'コードをコピー', primary: !url, onClick: () => { copy(code, 'デッキコードをコピーしました'); return false; } }];
  if (url) buttons.push({ label: 'リンクをコピー', primary: true, onClick: () => { copy(url, '共有リンクをコピーしました'); return false; } });
  if (url && navigator.share) {
    buttons.push({ label: '共有…', onClick: () => { navigator.share({ title: deck.name, text: `遊戯王デッキ「${deck.name}」`, url }).catch(() => {}); return false; } });
  }
  showModal({ title: 'デッキコードを発行', body, buttons });
}

function openCodeImport() {
  const input = el('textarea', { class: 'full code-box', rows: 3, placeholder: 'YGO2- / YGO1- で始まるデッキコード、または共有リンクを貼り付け' });
  showModal({
    title: 'デッキコードから追加', body: input,
    buttons: [{ label: '追加する', primary: true, onClick: () => addDeckFromCode(input.value) === false ? false : undefined }],
  });
  setTimeout(() => input.focus(), 0);
}

// コード（や共有リンク）から新しいデッキとして追加する。失敗したら false
function addDeckFromCode(text) {
  const code = findDeckCode(text);
  if (!code) { toast('デッキコードが見つかりませんでした'); return false; }
  let d;
  try { d = decodeDeckCode(code); } catch (e) { toast('デッキコードを読めませんでした：' + e.message); return false; }
  const deck = Decks.blank(d.deck.name || '共有されたデッキ', d.deck.format);
  if (d.deck.reg) deck.reg = d.deck.reg;
  deck.main = d.deck.main.slice(0, LIMITS.main);
  deck.extra = d.deck.extra.slice(0, LIMITS.extra);
  deck.side = d.deck.side.slice(0, LIMITS.side);
  Decks.list.push(deck);
  Decks.currentId = deck.id;
  Decks.save();
  renderDeck();
  switchView('deck');
  toast(`「${deck.name}」を追加しました` + (d.unknown.length ? `（見つからないカード${d.unknown.length}種類は除きました）` : ''));
  return true;
}

// 共有リンク（…#deck=YGO1-…）で開かれたら、追加するか確認する
function checkSharedDeckLink() {
  const code = findDeckCode(decodeURIComponent(location.hash));
  if (!code) return;
  history.replaceState(null, '', location.pathname + location.search);   // 再読み込みで何度も聞かないように
  let d;
  try { d = decodeDeckCode(code); } catch (e) { toast('共有リンクのデッキを読めませんでした'); return; }
  showModal({
    title: '共有されたデッキ',
    body: el('p', { text: `「${d.deck.name}」（メイン${d.deck.main.length}・EX${d.deck.extra.length}・サイド${d.deck.side.length}）をマイデッキに追加しますか？` }),
    buttons: [{ label: '追加する', primary: true, onClick: () => { addDeckFromCode(code); } }],
  });
}

// ---------- 全デッキのバックアップ（別のPCやネット版へ移すとき用） ----------
function downloadText(name, text, type = 'application/json') {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
}

function backupAll() {
  const data = { app: 'ygo-practice', version: 1, date: new Date().toISOString(), decks: Decks.list };
  downloadText(`デッキバックアップ_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 1));
  toast(`${Decks.list.length}個のデッキをファイルに保存しました`);
}

function restoreBackup() {
  const input = el('input', { type: 'file', accept: isIOS ? null : '.json' });
  input.addEventListener('change', async () => {
    try {
      const data = JSON.parse(await input.files[0].text());
      const decks = (data && Array.isArray(data.decks)) ? data.decks : [];
      if (!decks.length) throw new Error('デッキが入っていません');
      // 今あるデッキは残したまま、新しいデッキとして追加する
      const onlyBlank = Decks.list.length === 1 && !Decks.list[0].main.length && !Decks.list[0].extra.length;
      if (onlyBlank) Decks.list = [];
      for (const d of decks) {
        const nd = Decks.blank(String(d.name || '読み込んだデッキ'), FORMATS[d.format] ? d.format : 'ocg');
        if (typeof d.reg === 'string') nd.reg = d.reg;
        nd.main = (d.main || []).filter(id => DB.byId.has(id));
        nd.extra = (d.extra || []).filter(id => DB.byId.has(id));
        nd.side = (d.side || []).filter(id => DB.byId.has(id));
        Decks.list.push(nd);
      }
      Decks.currentId = Decks.list[Decks.list.length - decks.length].id;
      Decks.save(); renderDeck();
      toast(`${decks.length}個のデッキを追加しました`);
    } catch (e) {
      toast('バックアップを読めませんでした：' + e.message);
    }
  });
  openFilePicker(input);
}

function setupDeckView() {
  setupMobileTabs();
  Decks.load();
  setupSearch();
  const rename = () => promptText('デッキの名前', Decks.current().name, name => {
    Decks.current().name = name; Decks.save(); renderDeck();
  });
  $('#deck-rename').onclick = rename;
  $('#deck-filter').addEventListener('input', renderDeckList);
  $('#deck-name').onclick = rename;
  $('#deck-copy').onclick = () => {
    const src = Decks.current();
    const d = { ...Decks.blank(src.name + 'のコピー'), main: [...src.main], extra: [...src.extra], side: [...src.side] };
    Decks.list.push(d); Decks.currentId = d.id; Decks.save(); renderDeck();
    toast(`「${d.name}」を作りました（元のデッキはそのまま残っています）`);
  };
  $('#deck-delete').onclick = () => {
    const d = Decks.current();
    showModal({
      title: 'デッキを削除', body: el('p', { text: `「${d.name}」を削除します。元に戻せません。（念のため「ファイルに書き出し」で保存しておくこともできます）` }),
      buttons: [{ label: '削除する', primary: true, onClick: () => {
        Decks.list = Decks.list.filter(x => x.id !== d.id);
        if (!Decks.list.length) Decks.list.push(Decks.blank('新しいデッキ'));
        Decks.currentId = Decks.list[0].id; Decks.save(); renderDeck();
      } }],
    });
  };
  const sortSel = $('#deck-sort');
  for (const [v, l] of Object.entries(SORT_MODES)) sortSel.append(el('option', { value: v, text: l, selected: v === sortMode() }));
  sortSel.onchange = () => { store.set('ygo.deckSort', sortSel.value); if (sortSel.value !== 'manual') sortDeck(); toast('並び順を「' + SORT_MODES[sortSel.value] + '」にしました（全部のデッキ共通）'); };
  $('#deck-import').onclick = openImport;
  $('#deck-export').onclick = openExport;
  $('#deck-backup').onclick = backupAll;
  // 禁止・制限リストの切り替え（最新・過去・制限なし）
  $('#deck-reg').addEventListener('change', e => {
    // オリジナルを作る・編集する
    if (e.target.value === '__new' || e.target.value === '__edit') {
      const deck = Decks.current();
      const cur = deck.reg || 'latest';
      openRegEditor(e.target.value === '__edit' ? cur.slice(7) : null);
      e.target.value = cur;
      return;
    }
    const deck = Decks.current();
    deck.reg = e.target.value;
    Decks.save();
    renderDeck();
    renderResults();
  });
  // ルール（OCG / マスターデュエル）の切り替え：今のデッキのルールを変え、検索もそのルールのカードにする
  $('#deck-format').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const deck = Decks.current();
    if (deckFormat(deck) === b.dataset.format) return;
    deck.format = b.dataset.format;
    // 過去のリストの日付はルールごとに違うので、切り替えたら「最新」に戻す（制限なしはそのまま）
    if (deck.reg && deck.reg !== 'none' && !deck.reg.startsWith('custom:')) deck.reg = 'latest';
    Decks.save();
    renderDeck();
    renderResults();
    toast(`「${deck.name}」を${FORMATS[deck.format].label}用にしました`);
  });
  $('#deck-code').onclick = openDeckCode;
  $('#deck-code-import').onclick = openCodeImport;
  $('#deck-image-import').onclick = () => {
    const input = el('input', { type: 'file', accept: 'image/*,.pdf,application/pdf' });
    input.addEventListener('change', async () => {
      const f = input.files[0];
      if (!f) return;
      if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
        try { openImageImport(new File([await pdfFirstPageImage(await f.arrayBuffer())], f.name.replace(/\.pdf$/i, '.png'), { type: 'image/png' })); }
        catch (e) { toast('PDFを読めませんでした：' + e.message); }
      } else openImageImport(f);
    });
    openFilePicker(input);
  };
  $('#deck-restore').onclick = restoreBackup;
  $('#deck-play').onclick = () => {
    if (Decks.current().main.length === 0) { toast('メインデッキが空です'); return; }
    switchView('board');
    $('#b-deck').value = Decks.currentId;
    startGame();
  };
}

// ---------- オリジナルのレギュレーションを作る・編集する ----------
// 完全オリジナル（制限なしから）か、既存のリスト（OCG／MD の最新・過去）を元にして、カードごとに枚数を決める
function openRegEditor(id) {
  const old = id ? customReg(id) : null;
  const deck = Decks.current();
  const r = old ? JSON.parse(JSON.stringify(old))
    : { id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name: 'オリジナル', base: { fmt: deckFormat(deck), reg: 'latest' }, overrides: {} };
  const LBL = ['禁止', '制限', '準制限', '無制限'];
  const name = el('input', { type: 'text', class: 'full', value: r.name, maxlength: 40 });
  // 元にするリスト
  const baseSel = el('select', { class: 'full' });
  const fillBase = () => {
    baseSel.innerHTML = '';
    baseSel.append(el('option', { value: '', text: '完全オリジナル（何も制限がない状態から作る）' }));
    for (const [fmt, f] of Object.entries(FORMATS)) {
      const g = el('optgroup', { label: `${f.label}のリストを元にする` });
      g.append(el('option', { value: fmt + '|latest', text: `${f.label}・最新` }));
      for (const d of DB.regDates[fmt] || []) g.append(el('option', { value: `${fmt}|${d}`, text: `${f.label}・${d.replace(/-/g, '/')}〜` }));
      baseSel.append(g);
    }
    baseSel.value = r.base ? `${r.base.fmt}|${r.base.reg}` : '';
  };
  fillBase();
  const ctxOf = () => {
    const c = r.base ? baseContext(r.base.fmt, r.base.reg, deckFormat(deck)) : { fmt: deckFormat(deck), reg: 'custom' };
    return { ...c, custom: r };
  };
  const baseLimit = c => { const ctx = ctxOf(); return limitIn(c, { ...ctx, custom: null }); };
  const nowLimit = c => limitIn(c, ctxOf());
  baseSel.addEventListener('change', async () => {
    const v = baseSel.value;
    r.base = v ? { fmt: v.split('|')[0], reg: v.split('|')[1] } : null;
    const ctx = ctxOf();
    if (ctx.loading && ctx.src) { try { await Promise.all([loadRegulation(...ctx.src), loadReleaseDates()]); } catch (e) { toast('リストを読み込めませんでした：' + e.message); } }
    drawAll();
  });
  // カードを探して枚数を決める
  const q = el('input', { type: 'text', class: 'full', placeholder: 'カード名で探す（例：うらら）' });
  const results = el('div', { class: 'pile-list reg-results' });
  const changed = el('div', { class: 'pile-list reg-changed' });
  const changedHead = el('b');
  const limitButtons = c => el('div', { class: 'reg-btns' }, LBL.map((t, n) => el('button', {
    class: 'btn small' + (nowLimit(c) === n ? ' primary' : ''), text: t,
    onclick: () => { if (baseLimit(c) === n) delete r.overrides[c.cid]; else r.overrides[c.cid] = n; drawAll(); },
  })));
  const row = (c, extra) => el('div', { class: 'pile-row' }, rowMark(c),
    el('div', { class: 'r-main' }, el('div', { class: 'r-name', text: c.name }), el('div', { class: 'r-info', text: extra || typeLine(c) })), limitButtons(c));
  const drawResults = () => {
    results.innerHTML = '';
    const text = q.value.trim();
    if (!text) { results.append(el('p', { class: 'muted', text: 'カード名を入れると、ここに出ます。' })); return; }
    for (const c of searchCards({ q: text }).filter(c => c.cid).slice(0, 30)) results.append(row(c, `元のリスト：${LBL[baseLimit(c)]}`));
  };
  const drawChanged = () => {
    changed.innerHTML = '';
    const ids = Object.keys(r.overrides);
    changedHead.textContent = `変えたカード（${ids.length}枚）`;
    if (!ids.length) changed.append(el('p', { class: 'muted', text: 'まだありません。上で探したカードの「禁止」などを押すと、ここに並びます。' }));
    for (const cid of ids) {
      const c = DB.cards.find(x => x.cid === +cid);
      if (!c) continue;
      changed.append(row(c, `元のリスト：${LBL[baseLimit(c)]} → ${LBL[r.overrides[cid]]}`));
    }
  };
  const drawAll = () => { drawResults(); drawChanged(); };
  q.addEventListener('input', drawResults);
  drawAll();
  const body = el('div', { class: 'stack' },
    el('label', { class: 'muted', text: '名前' }), name,
    el('label', { class: 'muted', text: '元にするリスト' }), baseSel,
    el('p', { class: 'muted small-note', text: '元にしたリストの禁止・制限に、下で変えたカードの枚数を上書きします。完全オリジナルでは、変えたカード以外はすべて無制限（3枚）です。過去のリストを元にすると、その時に未発売のカードは禁止扱いになります。' }),
    el('label', { class: 'muted', text: 'カードの枚数を決める' }), q, results,
    changedHead, changed);
  const buttons = [{ label: '保存してこのデッキに使う', primary: true, onClick: () => {
    r.name = name.value.trim() || 'オリジナル';
    saveCustomReg(r);
    deck.reg = 'custom:' + r.id;
    Decks.save();
    renderDeck(); renderResults();
    if (typeof renderRegInfo === 'function') renderRegInfo();
    toast(`オリジナル「${r.name}」を保存しました`);
  } }];
  if (old) buttons.push({ label: '削除', onClick: () => {
    if (!confirm(`オリジナル「${old.name}」を削除しますか？`)) return false;
    deleteCustomReg(old.id);
    for (const d of Decks.list) if (d.reg === 'custom:' + old.id) d.reg = 'latest';
    Decks.save();
    renderDeck(); renderResults();
    toast('削除しました（使っていたデッキは最新のリストに戻しました）');
  } });
  showModal({ title: old ? `オリジナルを編集：${old.name}` : 'オリジナルの禁止・制限を作る', body, wide: true, buttons });
}

function customRegNote(cr) {
  const n = Object.keys(cr.overrides || {}).length;
  const base = cr.base ? `${FORMATS[cr.base.fmt].label}・${cr.base.reg === 'latest' ? '最新' : cr.base.reg.replace(/-/g, '/')}を元に` : '完全オリジナル';
  return `オリジナル（${base}、${n}枚を変更）`;
}
