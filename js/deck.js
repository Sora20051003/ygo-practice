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
      this.list = (r.decks || []).map(d => ({ id: d.id, name: d.name, main: d.main || [], extra: d.extra || [], side: d.side || [] }));
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
  blank(name) { return { id: 'd' + Date.now() + Math.random().toString(36).slice(2, 6), name, main: [], extra: [], side: [] }; },
  get(id) { return this.list.find(d => d.id === id); },
  current() { return this.get(this.currentId); },
};

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
  if (countCopies(deck, card) >= MAX_COPIES) { toast(`同じカードは${MAX_COPIES}枚までです`); return; }
  deck[section].push(card.id);
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
  const run = () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderResults, 120); };
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
document.addEventListener('mousedown', e => {
  for (const d of $$('details.multi[open]')) if (!d.contains(e.target)) d.open = false;
});

function renderResults() {
  const box = $('#results');
  box.innerHTML = '';
  if (!DB.cards.length) return;
  const text = $('#qt').value.trim();
  const res = searchCards({
    q: $('#q').value, qMode: segMode('#q-mode'), text, textMode: segMode('#qt-mode'), kind: $('#f-kind').value, sub: getMulti('#f-sub'), subMode: $('#f-sub').dataset.mode,
    attr: getMulti('#f-attr'), race: getMulti('#f-race'), level: getMulti('#f-level'), rank: getMulti('#f-rank'), link: getMulti('#f-link'), marker: getMulti('#f-marker'), markerMode: $('#f-marker').dataset.mode, sort: $('#f-sort').value,
  });
  $('#result-count').textContent = res.length > MAX_RESULTS
    ? `${res.length}件（上位${MAX_RESULTS}件を表示。条件をしぼってください）`
    : `${res.length}件`;
  const frag = document.createDocumentFragment();
  for (const c of res.slice(0, MAX_RESULTS)) {
    const info = isMonster(c)
      ? `${levelText(c)} ${ATTR[c.attr] || ''} ${RACE[c.race] || ''}　${statText(c)}${has(c, T.LINK) ? "　" + linkArrowsText(c) : ""}`
      : typeLine(c);
    const row = el('div', { class: 'result-row', onclick: () => showCardDetail(c, '#deck-detail') },
      rowMark(c),
      el('div', { class: 'r-main' },
        el('div', { class: 'r-name', text: c.name + (c.noJp ? '（TCG）' : '') }),
        el('div', { class: 'r-info', text: info }),
        text ? snippetEl(c.jaText, text) : null),
      el('button', { class: 'btn small', title: 'サイドデッキに追加', text: 'S', onclick: e => { e.stopPropagation(); addToDeck(c, 'side'); } }),
      el('button', { class: 'btn small primary', title: 'デッキに追加', text: '＋', onclick: e => { e.stopPropagation(); addToDeck(c); } }),
    );
    row.addEventListener('contextmenu', e => { e.preventDefault(); addToDeck(c); });
    frag.append(row);
  }
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
      onclick: () => { Decks.currentId = d.id; Decks.save(); renderDeck(); },
    },
      deckCover(d),
      el('div', { class: 'chip-body' },
        el('div', { class: 'chip-name', text: d.name }),
        el('div', { class: 'chip-count' + (ok ? '' : ' warn-text'), text: `メイン${d.main.length}・EX${d.extra.length}` }))));
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
  renderDeckList();
  $('#deck-name').textContent = deck.name;
  $('#deck-sum').textContent = `メイン${deck.main.length}枚・EX${deck.extra.length}枚・サイド${deck.side.length}枚`;
  $('#mt-count').textContent = `（${deck.main.length}）`;

  for (const sec of ['main', 'extra', 'side']) {
    const grid = $('#deck-' + sec);
    grid.innerHTML = '';
    deck[sec].forEach((id, i) => {
      const c = DB.byId.get(id);
      if (!c) { grid.append(el('div', { class: 'deck-tile missing', text: '不明なカード ' + id })); return; }
      const tile = el('div', { class: 'deck-tile', onclick: () => showCardDetail(c, '#deck-detail') },
        cardFace(c, { small: true }),
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

function sortDeck() {
  const deck = Decks.current();
  for (const sec of ['main', 'extra', 'side']) {
    deck[sec].sort((a, b) => {
      const ca = DB.byId.get(a), cb = DB.byId.get(b);
      if (!ca || !cb) return 0;
      return compareCards(ca, cb) || a - b;
    });
  }
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
function parseDeckText(text) {
  const result = { main: [], extra: [], side: [] }, unknown = [];
  let sec = 'main';
  const isYdk = /^\s*#main/m.test(text);
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;
    const isHeader = /^[【\[#!]/.test(line) || /^(メイン|エクストラ|EX|サイド)(デッキ)?\s*[:：]?\s*(\d+\s*枚?)?$/i.test(line);
    if (isHeader) {
      if (/side|サイド/i.test(line)) sec = 'side';
      else if (/extra|ex|エクストラ/i.test(line)) sec = 'extra';
      else if (/main|メイン/i.test(line)) sec = 'main';
      continue;
    }
    if (isYdk || /^\d{4,9}$/.test(line)) {
      const id = parseInt(line, 10);
      if (DB.byId.has(id)) result[sec].push(id); else unknown.push(line);
      continue;
    }
    // 「カード名 ×3」「3 カード名」「カード名 3枚」
    let name = line, n = 1, m;
    if ((m = line.match(/^(.*?)\s*[×xX＊*]\s*(\d+)\s*枚?$/)) || (m = line.match(/^(.*?)\s+(\d+)\s*枚?$/))) { name = m[1]; n = +m[2]; }
    else if ((m = line.match(/^(\d+)\s*[×xX枚]?\s+(.*)$/))) { name = m[2]; n = +m[1]; }
    const c = findCardByName(name);
    if (!c) { unknown.push(line); continue; }
    const target = isExtraType(c) && sec === 'main' ? 'extra' : sec;
    for (let i = 0; i < Math.min(n, MAX_COPIES); i++) result[target].push(c.id);
  }
  return { result, unknown };
}

function openImport() {
  const ta = el('textarea', { class: 'full', rows: 14, placeholder: 'YDKファイルの中身、または\n灰流うらら ×3\n増殖するG 3\nのようなカード名の一覧を貼り付けてください。' });
  const file = el('input', { type: 'file', accept: '.ydk,.txt' });
  file.addEventListener('change', async () => { if (file.files[0]) ta.value = await file.files[0].text(); });
  const asNew = el('input', { type: 'checkbox', checked: true });
  showModal({
    title: 'デッキを読み込む', wide: true,
    body: el('div', { class: 'stack' }, el('div', null, 'ファイルから：', file), ta,
      el('label', { class: 'check' }, asNew, '新しいデッキとして追加する（オフにすると今のデッキを上書き）')),
    buttons: [{
      label: '読み込む', primary: true, onClick: () => {
        const { result, unknown } = parseDeckText(ta.value);
        const total = result.main.length + result.extra.length + result.side.length;
        if (!total) { toast('カードを読み取れませんでした'); return false; }
        let deck;
        if (asNew.checked) {
          deck = Decks.blank(file.files[0] ? file.files[0].name.replace(/\.\w+$/, '') : '読み込んだデッキ');
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
      },
    }],
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
  const input = el('input', { type: 'file', accept: '.json' });
  input.addEventListener('change', async () => {
    try {
      const data = JSON.parse(await input.files[0].text());
      const decks = (data && Array.isArray(data.decks)) ? data.decks : [];
      if (!decks.length) throw new Error('デッキが入っていません');
      // 今あるデッキは残したまま、新しいデッキとして追加する
      const onlyBlank = Decks.list.length === 1 && !Decks.list[0].main.length && !Decks.list[0].extra.length;
      if (onlyBlank) Decks.list = [];
      for (const d of decks) {
        const nd = Decks.blank(String(d.name || '読み込んだデッキ'));
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
  input.click();
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
  $('#deck-sort').onclick = sortDeck;
  $('#deck-import').onclick = openImport;
  $('#deck-export').onclick = openExport;
  $('#deck-backup').onclick = backupAll;
  $('#deck-restore').onclick = restoreBackup;
  $('#deck-play').onclick = () => {
    if (Decks.current().main.length === 0) { toast('メインデッキが空です'); return; }
    switchView('board');
    $('#b-deck').value = Decks.currentId;
    startGame();
  };
}
