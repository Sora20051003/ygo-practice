// 画面部品の共通ヘルパー
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function el(tag, attrs, ...children) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(n.dataset, v);
      else n.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

// ブラウザへの保存。ログイン中は ns（ユーザーごとの接頭辞）を付けて、人ごとに分ける
const store = {
  ns: '',
  get(key, fallback) {
    try { const v = localStorage.getItem(this.ns + key); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(this.ns + key, JSON.stringify(value)); } catch { /* 保存できなくても動作は続ける */ }
  },
};

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

// モーダル。close関数を返す
const openModals = new Set();
function showModal({ title, body, buttons = [], wide = false, onClose }) {
  const root = $('#modal-root');
  const box = el('div', { class: 'modal' + (wide ? ' wide' : '') });
  const back = el('div', { class: 'modal-back' }, box);
  const close = () => {
    if (!openModals.has(close)) return;
    openModals.delete(close);
    back.remove(); document.removeEventListener('keydown', onKey); onClose && onClose();
  };
  openModals.add(close);
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  // 背景を押したら閉じる（押した所と離した所が両方背景のときだけ。iPhone でも動くよう pointer を使う）
  let downOnBack = false;
  back.addEventListener('pointerdown', e => { downOnBack = e.target === back; });
  back.addEventListener('click', e => { if (e.target === back && downOnBack) close(); });
  box.append(
    el('div', { class: 'modal-head' }, el('h2', { text: title }), el('button', { class: 'btn small', text: '閉じる', onclick: close })),
    el('div', { class: 'modal-body' }, body),
  );
  if (buttons.length) {
    box.append(el('div', { class: 'modal-foot' }, buttons.map(b =>
      el('button', { class: 'btn' + (b.primary ? ' primary' : ''), text: b.label, onclick: () => { if (b.onClick(close) !== false) close(); } }))));
  }
  root.append(back);
  return close;
}

function promptText(title, initial, onOk) {
  const input = el('input', { type: 'text', value: initial || '', class: 'full' });
  const submit = () => { const v = input.value.trim(); if (!v) return false; onOk(v); };
  const close = showModal({ title, body: input, buttons: [{ label: 'OK', primary: true, onClick: submit }] });
  setTimeout(() => { input.focus(); input.select(); }, 0);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && submit() !== false) close(); });
}

// ページを90度回して横画面にしているとき（スマホを縦持ち）、画面上の位置をページの中の位置に直す
const Rot = { on: false };
const viewW = () => (Rot.on ? innerHeight : innerWidth);
const viewH = () => (Rot.on ? innerWidth : innerHeight);
function screenToLocal(x, y) { return Rot.on ? { x: y, y: innerWidth - x } : { x, y }; }
function localRect(r) {
  if (!Rot.on) return r;
  return { left: r.top, top: innerWidth - r.right, width: r.height, height: r.width, right: r.bottom, bottom: innerWidth - r.left };
}

// 右クリック風メニュー。items: {label, onClick, disabled} / {sep:true} / {head:'見出し'}
function showMenu(x, y, items) {
  const m = $('#menu');
  m.innerHTML = '';
  for (const it of items) {
    if (it.sep) { m.append(el('div', { class: 'menu-sep' })); continue; }
    if (it.head) { m.append(el('div', { class: 'menu-head', text: it.head })); continue; }
    m.append(el('button', {
      class: 'menu-item', text: it.label, disabled: it.disabled,
      onclick: e => { e.stopPropagation(); hideMenu(); it.onClick(); },
    }));
  }
  m.hidden = false;
  ({ x, y } = screenToLocal(x, y));
  const w = m.offsetWidth, h = m.offsetHeight;
  const vw = viewW(), vh = viewH();
  m.style.left = Math.max(4, Math.min(x, vw - w - 4)) + 'px';
  m.style.top = Math.max(4, Math.min(y, vh - h - 4)) + 'px';
}
function hideMenu() { $('#menu').hidden = true; }
document.addEventListener('pointerdown', e => { if (!e.target.closest('#menu')) hideMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideMenu(); });

// カードの小さな表示（デッキ・盤面共通）
// ---------- カード画像 ----------
// 画像は YGOPRODeck のものを表示（ブラウザのキャッシュに残るので2回目以降は通信しない）
// 表示形式: jp = 日本語版カード（標準。イラストに日本語の名前・効果などを重ねて描く）
//          image = カード画像（英語版） / art = イラスト＋日本語名 / text = 文字のみ
const CARD_STYLES = { jp: '日本語版カード', image: 'カード画像（英語版）', art: 'イラスト＋日本語名', text: '文字のみ' };
let cardStyle = store.get('ygo.cardStyle3', 'jp');
// 画像の番号：発売前の仮の番号のままのカードなどは、正式な番号の画像も試す（IMG_IDS：data/alt-arts.js。まずそのカードの番号、無ければ正式な番号）
// アニメ版のカードは、今のカード（同じ名前）の絵を使う
const imgIdOf = id => (typeof IMG_IDS !== 'undefined' && IMG_IDS[id]) || (typeof DB !== 'undefined' && DB.byId && (DB.byId.get(id) || {}).animeBase) || id;
const IMG_URL = {
  art: id => `https://images.ygoprodeck.com/images/cards_cropped/${id}.jpg`,
  small: id => `https://images.ygoprodeck.com/images/cards_small/${id}.jpg`,
  full: id => `https://images.ygoprodeck.com/images/cards/${id}.jpg`,
};
// 発売前の仮の番号（100000000 以上）は、画像のサイトでは別のカードに使われていたことがあるので、正式な番号の画像だけを使う
const webSources = (kind, id) => {
  const real = imgIdOf(id);
  if (real === id) return [IMG_URL[kind](id)];
  return id >= 100000000 ? [IMG_URL[kind](real)] : [IMG_URL[kind](id), IMG_URL[kind](real)];
};
// 画像が無いと分かったカード（新しい日本先行カードなど）は、以後は文字で表示する
const missingImages = new Set();

// 画像の読み込み先の順番。パソコンに保存した画像（tools/download-images.bat で取得）を優先し、無ければネットから読む
const IMG_SOURCES = {
  art: id => LOCAL_FILES ? [`pics/art/${id}.jpg`, ...webSources('art', id)] : webSources('art', id),
  small: id => webSources('small', id),
  full: id => webSources('full', id),
};

// ---------- 絵違い ----------
// 絵違い（イラスト違い）のあるカードは、デッキごとにどの絵で表示するかを選べる（deck.arts = { カード: 画像番号 }）。
// 盤面・対戦では使っているデッキ、それ以外（デッキ作成・検索）では今のデッキの選択で表示する
// そのカードの番号と、画像のサイトでの番号（IMG_IDS）の両方の絵違いを合わせる（そのカード自身の番号は除く）
const altArtsCache = new Map();
function altArtsOf(id) {
  if (typeof ALT_ARTS === 'undefined') return [];
  if (altArtsCache.has(id)) return altArtsCache.get(id);
  const real = imgIdOf(id);
  // 発売前の仮の番号のカードは、正式な番号の絵がそのカードの絵なので、絵違いには入れない
  const list = [...new Set([...(ALT_ARTS[id] || []), ...(real !== id ? [...(ALT_ARTS[real] || []), ...(id < 100000000 ? [real] : [])] : [])])].filter(x => x !== id && x !== real || (x === real && id < 100000000));
  altArtsCache.set(id, list);
  return list;
}
function artDeck() {
  if (typeof Decks === 'undefined') return null;
  const board = document.getElementById('view-board');
  if (board && !board.hidden) {
    if (typeof Duel !== 'undefined' && Duel.active && Duel.deckId) return Decks.get(Duel.deckId);
    const sel = document.getElementById('b-deck');
    if (sel && sel.value) return Decks.get(sel.value);
  }
  return Decks.current();
}
// イラストの画像が無い絵違い（EDOPro のカード全体の画像から切り出す）
let altFullSet = null;
const isAltFull = id => { if (!altFullSet) altFullSet = new Set(typeof ALT_FULL !== 'undefined' ? ALT_FULL : []); return altFullSet.has(id); };
const IGNIS_FULL = id => `https://pics.projectignis.org:2096/pics/${id}.jpg`;
// その画像番号の読み込み先
const altSources = (id, kind) => (isAltFull(id) ? [IGNIS_FULL(id)] : IMG_SOURCES[kind](id));
function artOf(id) {
  const d = artDeck();
  const a = d && d.arts && d.arts[id];
  return a && altArtsOf(id).includes(a) ? a : id;
}

// 画像を読み込み、すべて失敗したら onFail を呼ぶ（絵違いを選んでいれば、その絵。読めなければ元の絵）
function cardImg(id, kind, onFail, cls, raw = false) {
  const art = raw ? id : artOf(id);   // raw：デッキで選んだ絵違いに置き換えず、その番号の絵を出す
  const own = altSources(art, kind);
  // イラストの画像が無いカード（新しいカードなど）は、最後にカード全体の画像からイラストの部分を切り出して使う
  const fullCrop = kind === 'art' ? webSources('full', id) : [];
  const sources = [...own, ...(art !== id ? IMG_SOURCES[kind](id) : []), ...fullCrop];
  // カード全体の画像からイラストを切り出す（EDOPro の画像の絵違い・上のカード全体の画像）
  const cropAt = i => (i < own.length ? kind === 'art' && isAltFull(art) : i >= sources.length - fullCrop.length);
  let n = 0;
  const img = el('img', { class: (cls || '') + (cropAt(0) ? ' img-full-crop' : ''), src: sources[0], loading: 'lazy', alt: '', draggable: 'false', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => {
    if (++n < sources.length) { img.classList.toggle('img-full-crop', cropAt(n)); img.src = sources[n]; return; }
    missingImages.add(id + kind);
    onFail && onFail(img);
  });
  return img;
}
const hasImage = (c, kind) => LOCAL_FILES && cardStyle !== 'text' && c && c.id && !missingImages.has(c.id + kind);

// 検索結果などの行の左端：イラストの小さな四角（文字のみなら色の帯）
function rowMark(c) {
  if (!hasImage(c, 'art')) return el('div', { class: 'r-color ' + frameClass(c) });
  const box = el('div', { class: 'r-thumb ' + frameClass(c) });
  box.append(cardImg(c.id, 'art', img => img.remove()));
  return box;
}

// カードの見た目。表向きのカードには data-cid を付け、押したときに詳細（スマホは最後に触ったカード）を出せるようにする
function cardFace(c, opts = {}) {
  const n = cardFaceInner(c, opts);
  if (c && c.id && !opts.faceDown && n && n.dataset) n.dataset.cid = c.id;
  return n;
}
function cardFaceInner(c, opts = {}) {
  const { faceDown = false, small = false } = opts;
  if (faceDown) {
    return el('div', { class: 'cardface back' + (small ? ' small' : '') },
      el('div', { class: 'cf-name', text: c ? c.name : '' }));
  }
  if (cardStyle === 'jp') return jpPhotoOrDrawn(c, false);
  if (cardStyle === 'image' && hasImage(c, 'small')) {
    const node = el('div', { class: 'cardface photo ' + frameClass(c), title: c.name });
    node.append(cardImg(c.id, 'small', () => node.replaceWith(textFace(c, small))));
    return node;
  }
  if (cardStyle === 'art' && hasImage(c, 'art')) {
    const foot = isMonster(c)
      ? [el('span', { text: levelText(c) }), el('span', { text: statText(c).replace('ATK ', '') })]
      : [el('span', { text: typeLine(c) })];
    const node = el('div', { class: 'cardface art ' + frameClass(c) + (small ? ' small' : ''), title: c.name },
      el('div', { class: 'cf-name', text: c.name }),
      el('div', { class: 'cf-art' }),
      el('div', { class: 'cf-foot' }, foot));
    node.querySelector('.cf-art').append(cardImg(c.id, 'art', () => node.replaceWith(textFace(c, small))));
    return node;
  }
  return textFace(c, small);
}

// ---------- 日本語版カード ----------
// イラスト（pics/art かネット）に、日本語の名前・属性・レベル・種族・効果文・攻守を重ねて描く。
// 文字の大きさはカードの幅に合わせて伸び縮みする（CSSの cqw 単位）
const JP_ARROWS = { 0x40: '◤', 0x80: '▲', 0x100: '◥', 0x08: '◀', 0x20: '▶', 0x01: '◣', 0x02: '▼', 0x04: '◢' };

// 日本版カード画像（tools/download-jp-cards.bat で pics/jp に保存）があればそれを、無ければアプリで描いたカードを出す
const missingJp = new Set();
function jpPhotoOrDrawn(c, big) {
  // デッキ画像から切り抜いた画像はそのまま出さず、アプリのカード（名前・効果文などをアプリで描いたもの）にする。
  // 切り抜きは、イラストが取れないカードのイラストとしてだけ使う（jpCard）
  if (!LOCAL_FILES || !c.id || missingJp.has(c.id) || faceOf(c)) return jpCard(c, big);   // 三幻神の別の表示はアプリで描く
  const node = el('div', { class: 'cardface photo jpphoto ' + frameClass(c), title: c.name });
  const img = el('img', { src: `pics/jp/${c.id}.jpg`, loading: 'lazy', alt: c.name, draggable: 'false' });
  img.addEventListener('error', () => {
    missingJp.add(c.id);
    node.replaceWith(jpCard(c, big));
  });
  node.append(img);
  return node;
}

// デッキ画像から切り抜いたカード画像（この端末のブラウザにだけ保存。カードid → 画像のdata URL）
const UserPics = new Map();
async function loadUserPics() {
  try {
    const saved = await idbGet('userpics');
    if (saved) for (const [id, url] of Object.entries(saved)) UserPics.set(+id, url);
  } catch { /* 読めなくても描いたカードで表示できる */ }
}
async function saveUserPics(pics) {
  for (const [id, url] of pics) UserPics.set(id, url);
  await idbSet('userpics', Object.fromEntries(UserPics));
}
async function clearUserPics() {
  UserPics.clear();
  await idbSet('userpics', {});
}

// 長い名前ほど文字を小さくして枠に収める（本物のカードと同じ考え方）
function jpNameSize(name) {
  const n = [...name].reduce((s, ch) => s + (ch.charCodeAt(0) < 0x2000 ? 0.55 : 1), 0); // 半角は幅を半分ぐらいで数える
  return Math.max(2.6, Math.min(6.2, 66 / Math.max(n, 1)));
}

// 魔法・罠の種類マーク（公式カードの【魔法カード＋マーク】の部分）
function stIcon(c) {
  if (has(c, T.QUICKPLAY)) return 'ϟ';
  if (has(c, T.CONTINUOUS)) return '∞';
  if (has(c, T.EQUIP)) return '✚';
  if (has(c, T.FIELD)) return '✣';
  if (has(c, T.RITUAL)) return '✦';
  if (has(c, T.COUNTER)) return '⤺';
  return '';
}

// 効果文の長さに合わせた文字の大きさ（cqw）
const descSize = len => (len < 70 ? 3.6 : len < 140 ? 3.1 : len < 220 ? 2.7 : len < 320 ? 2.3 : len < 420 ? 2.0 : 1.75);

// 効果文が欄に入りきらないときは、入りきるまで文字を小さくする（見切れ防止）
// 表示されて大きさが決まった時（と大きさが変わった時）に合わせる。小さいカード（盤面・デッキの一覧）は読めないので何もしない
function fitText(n) {
  const card = n.closest('.cardface');
  // まだ画面に出ていないカードは、出てから合わせる。画面から消えたカードは見張るのをやめる
  if (!n.isConnected) { if (n._fitShown && textFitter) textFitter.unobserve(n); return; }
  n._fitShown = true;
  if (!card || card.clientWidth < 120) return;
  const base = +n.dataset.fs;
  n.style.fontSize = base + 'cqw';
  if (n.scrollHeight <= n.clientHeight) return;
  let lo = 0.9, hi = base;
  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2;
    n.style.fontSize = mid + 'cqw';
    if (n.scrollHeight <= n.clientHeight) lo = mid; else hi = mid;
  }
  n.style.fontSize = lo + 'cqw';
}
const textFitter = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(es => { for (const e of es) fitText(e.target); }) : null;
function fitLater(n, size) {
  n.dataset.fs = size;
  n.style.fontSize = size + 'cqw';
  if (textFitter) textFitter.observe(n);
  // 文字（フォント）の読み込みが終わると大きさが変わるので、その後にもう一度合わせる
  if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => requestAnimationFrame(() => fitText(n)));
  return n;
}

// ペンデュラムの文を「P効果」と「モンスター効果（またはフレーバー）」に分ける
function splitPendulum(text) {
  const m = text.match(/^【[ＰP]スケール[^】]*】\n?([\s\S]*?)\n?【(?:モンスター効果|フレーバーテキスト)】\n?([\s\S]*)$/);
  return m ? { p: m[1].trim(), main: m[2].trim() } : { p: '', main: text };
}

// ---------- 三幻神の別の表示（デッキごとに選ぶ。deck.faces = { カード: 'god'／'hieratic' }） ----------
// god：神の色の枠（オベリスク＝青・オシリス＝赤・ラー＝金）／hieratic：ラーの翼神竜のヒエラティックテキスト（アニメのカードのように、名前と効果文を神官文字で描く）
const GOD_FACES = {
  10000000: { cls: 'god-obelisk', opts: { god: '神の色の枠（青）' } },
  10000020: { cls: 'god-slifer', opts: { god: '神の色の枠（赤）' } },
  10000010: { cls: 'god-ra', opts: { god: '神の色の枠（金）', hieratic: 'ヒエラティックテキスト' } },
};
// 神の色の枠のオベリスク・オシリスは、名前・種族・効果文がすべて英語のカード
const GOD_EN = {
  10000000: { name: 'THE GOD OF OBELISK', type: '[Divine-Beast/Effect]', text: 'Requires 3 Tributes to Normal Summon (cannot be Normal Set). This card\'s Normal Summon cannot be negated. When Normal Summoned, cards and effects cannot be activated. Neither player can target this card with card effects. Once per turn, during the End Phase, if this card was Special Summoned: Send it to the GY. You can Tribute 2 monsters; destroy all monsters your opponent controls. This card cannot declare an attack the turn this effect is activated.' },
  10000020: { name: 'SAINT DRAGON -THE GOD OF OSIRIS-', type: '[Divine-Beast/Effect]', text: 'Requires 3 Tributes to Normal Summon (cannot be Normal Set). This card\'s Normal Summon cannot be negated. When Normal Summoned, cards and effects cannot be activated. Once per turn, during the End Phase, if this card was Special Summoned: Send it to the GY. Gains 1000 ATK/DEF for each card in your hand. If a monster(s) is Normal or Special Summoned to your opponent\'s field in Attack Position: That monster(s) loses 2000 ATK, then if its ATK has been reduced to 0 as a result, destroy it.' },
};
const godBaseId = c => (c && (c.animeBase || c.id)) || 0;
function faceOf(c) {
  const g = GOD_FACES[godBaseId(c)];
  if (!g) return null;
  const d = artDeck();
  const v = d && d.faces && d.faces[godBaseId(c)];
  return v && g.opts[v] ? { kind: v, cls: g.cls + (v === 'hieratic' ? ' hieratic' : '') } : null;
}
// 文を神官文字（エジプトのヒエログリフの字）に置き換える。同じ文はいつも同じ字になる
function hieraticize(s) {
  let out = '';
  for (const ch of String(s || '')) {
    if (/[\s。、・：:（）()【】「」\n]/.test(ch)) { out += ch === '。' ? ' ' : ch === '\n' ? '\n' : ''; continue; }
    out += String.fromCodePoint(0x13000 + (ch.codePointAt(0) * 37) % 1070);
  }
  return out;
}

function jpCard(c, big = false) {
  const face = faceOf(c);
  const hier = face && face.kind === 'hieratic';
  const eng = face && face.kind === 'god' ? GOD_EN[godBaseId(c)] : null;   // 英語のカード（オベリスク・オシリスの神の色の枠）
  const mon = isMonster(c);
  const spell = has(c, T.SPELL);
  const pend = has(c, T.PENDULUM);
  const attr = mon ? { label: ATTR[c.attr] || '？', cls: 'a' + c.attr } : { label: spell ? '魔' : '罠', cls: spell ? 'a-spell' : 'a-trap' };

  // 名前の下の段：レベル（赤い丸の★・右寄せ）／ランク（黒い丸の★・左寄せ）／【魔法カード】【罠カード】
  let sub = el('div', { class: 'jp-sub' });
  if (mon && !has(c, T.LINK)) {
    const rank = has(c, T.XYZ);
    sub = el('div', { class: 'jp-sub ' + (rank ? 'rank' : 'level') });
    for (let i = 0; i < Math.min(c.level, 13); i++) sub.append(el('span', { class: 'jp-star', text: '★' }));
  } else if (!mon) {
    const icon = stIcon(c);
    sub = el('div', { class: 'jp-sub st' }, `【${spell ? '魔法' : '罠'}カード`, icon ? el('span', { class: 'jp-sticon', text: icon }) : null, '】');
  }

  const art = el('div', { class: 'jp-art' });
  // イラストはネットから読む。取れないときは、デッキ画像から切り抜いたカードのイラスト部分を使う
  const userArt = () => { const m = c.id && UserPics.get(c.id); if (m) art.prepend(el('div', { class: 'jp-userart' }, el('img', { src: m, alt: '', draggable: 'false' }))); };
  if (c.id && cardStyle !== 'text' && !missingImages.has(c.id + 'art')) art.append(cardImg(c.id, 'art', img => { img.remove(); userArt(); }));
  else userArt();
  if (has(c, T.LINK)) {
    for (const [bit, ch] of Object.entries(JP_ARROWS)) art.append(el('span', { class: `jp-arrow b${bit}` + ((c.def & bit) ? ' on' : ''), text: ch }));
  }

  // エラッタ前の効果で処理する設定のカードは、エラッタ前の文章を描く
  const preText = errataTextFor(c);
  const text = (preText && (preText.ja || preText.en)) || c.jaText || '';
  const { p, main } = pend ? splitPendulum(text) : { p: '', main: text };
  const flavor = mon && has(c, T.NORMAL) && !has(c, T.EFFECT);
  const atk = c.atk < 0 ? '?' : c.atk;
  const def = c.def < 0 ? '?' : c.def;
  const box = el('div', { class: 'jp-box' },
    mon ? el('div', { class: 'jp-type', text: eng ? eng.type : hier ? `【${hieraticize(typeLine(c))}】` : `【${typeLine(c)}】` }) : null,
    fitLater(el('div', { class: 'jp-desc' + (flavor ? ' flavor' : ''), text: eng ? eng.text : hier ? hieraticize(main) : main }), eng ? 2.7 : descSize(main.length)),
    mon ? el('div', { class: 'jp-stat' },
      el('span', { text: `ATK/${String(atk).padStart(4, ' ')}` }),
      el('span', { text: has(c, T.LINK) ? `LINK-${c.level}` : `DEF/${String(def).padStart(4, ' ')}` })) : null);

  // ペンデュラム：イラストの下にP効果の欄と左右のスケール
  // 本物のカードと同じ比率：イラストはP効果の欄の下の端まであり、欄はイラストの下の方に半透明で重なる（位置は style.css）
  const pbox = pend ? el('div', { class: 'jp-pbox' },
    el('div', { class: 'jp-pscale l' }, el('span', { text: '◆' }), el('b', { text: c.ls })),
    fitLater(el('div', { class: 'jp-pdesc', text: p }), 3.2),
    el('div', { class: 'jp-pscale r' }, el('span', { text: '◆' }), el('b', { text: c.rs }))) : null;

  return el('div', { class: `cardface jp ${frameClass(c)}${pend ? ' pend' : ''}${big ? ' big' : ''}${face ? ' ' + face.cls : ''}`, title: c.name },
    el('div', { class: 'jp-head' },
      // ヒエラティックテキスト版：名前だけ英語（THE SUN OF GOD DRAGON）、ほかは神官文字
      ((nm) => el('div', { class: 'jp-name' + (hier || eng ? ' en' : ''), style: `font-size:max(${jpNameSize(nm)}cqw, 7px)`, text: nm }))(hier ? 'THE SUN OF GOD DRAGON' : eng ? eng.name : c.name),
      el('div', { class: 'jp-attr ' + attr.cls, text: attr.label })),
    sub, art, pbox, box,
    c.id ? el('div', { class: 'jp-pass', text: String(c.id).padStart(8, '0') }) : null);
}

function textFace(c, small) {
  return el('div', { class: 'cardface ' + frameClass(c) + (small ? ' small' : ''), title: c.name },
    el('div', { class: 'cf-name', text: c.name }),
    isMonster(c) ? el('div', { class: 'cf-lv', text: levelText(c) }) : el('div', { class: 'cf-lv', text: typeLine(c) }),
    isMonster(c) ? el('div', { class: 'cf-stat', text: statText(c) }) : null,
  );
}

// 英語テキストのキャッシュ（YGOPRODeckから必要な時だけ取得）
const enTextCache = new Map();
async function fetchEnglishText(id) {
  if (enTextCache.has(id)) return enTextCache.get(id);
  const p = fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${id}`)
    .then(r => (r.ok ? r.json() : null))
    .then(j => (j && j.data && j.data[0] ? j.data[0].desc : null))
    .catch(() => null);
  enTextCache.set(id, p);
  return p;
}

// P効果とモンスター効果をつなぐ。カードの絵で分けて表示できるよう、ほかのデータと同じ【Pスケール】【モンスター効果】の見出しを付ける
function joinPendText(c, p, main) {
  if (!p) return main;
  const head = has(c, T.EFFECT) ? 'モンスター効果' : 'フレーバーテキスト';
  return `【Pスケール：青${c.ls}／赤${c.rs}】
${p}
【${head}】
${main}`;
}
// 日本語・英語の効果文（ygoresources.com から取得。一度取ったらブラウザに保存）
const cardTextCache = new Map();
function fetchCardTexts(c) {
  const key = 'text:' + c.id;
  if (cardTextCache.has(key)) return cardTextCache.get(key);
  // アニメのカード：文はカードのデータに入っている（日本語が無ければ英語）
  if (c.anime) { const r = Promise.resolve({ ja: c.jaText || '', jaP: '', en: c.enText || '' }); cardTextCache.set(key, r); return r; }
  const p = (async () => {
    try {
      const saved = await idbGet(key);
      if (saved && saved.ja) {
        if (!c.jaText) setCardText(c, joinPendText(c, saved.jaP, saved.ja));
        return saved;
      }
    } catch { /* 保存データが読めなくても取得に進む */ }
    let ja = '', jaP = '', en = '';
    if (c.cid) {
      try {
        const r = await fetch(`https://db.ygoresources.com/data/card/${c.cid}`);
        if (r.ok) {
          const d = (await r.json()).cardData || {};
          ja = (d.ja && d.ja.effectText) || '';
          jaP = (d.ja && d.ja.pendulumEffectText) || '';
          en = (d.en && d.en.effectText) || (d.ae && d.ae.effectText) || '';
          if (d.en && d.en.pendulumEffectText) en = `[Pendulum Effect]\n${d.en.pendulumEffectText}\n\n${en}`;
        }
      } catch { /* オフラインなど */ }
    }
    if (!en) en = (await fetchEnglishText(c.id)) || '';
    // テキスト検索用データに無い新しいカードは、ここで取れた文を検索にも使う
    if (ja && !c.jaText) setCardText(c, joinPendText(c, jaP, ja));
    // 通信できない場合はテキスト検索用データの文を使う
    if (!ja && c.jaText) return { ja: c.jaText, jaP: '', en };
    const result = { ja, jaP, en };
    if (ja) idbSet(key, result).catch(() => {});
    else cardTextCache.delete(key); // 取れなかったときは次回また試す
    return result;
  })();
  cardTextCache.set(key, p);
  return p;
}

// 詳細パネル上部の画像（イラスト表示ならイラスト、カード画像表示ならカード全体）
function detailImage(c) {
  const kind = cardStyle === 'jp' ? 'jp' : cardStyle === 'image' ? 'full' : 'art';
  let box;
  if (kind === 'jp') box = el('div', { class: 'd-image jp' }, jpPhotoOrDrawn(c, true));
  else {
    if (!hasImage(c, kind)) return null;
    box = el('div', { class: 'd-image ' + kind });
    box.append(cardImg(c.id, kind, () => box.remove()));
  }
  // デッキ作成の画面では、押すと大きく表示する
  box.addEventListener('click', () => { if (document.body.dataset.view === 'deck') openCardZoom(c, kind); });
  return box;
}

// カードを画面の真ん中に大きく出す。ほかは暗くする（うっすら見える）。どこかを押すか Esc で閉じる
function openCardZoom(c, kind) {
  closeCardZoom();
  const face = kind === 'jp' ? jpPhotoOrDrawn(c, true) : cardImg(c.id, kind, () => {});
  const back = el('div', { class: 'card-zoom-back', id: 'card-zoom', title: '押すと閉じます' },
    el('div', { class: 'card-zoom ' + kind }, face));
  back.addEventListener('click', closeCardZoom);
  document.addEventListener('keydown', cardZoomKey);
  document.body.append(back);
}
function closeCardZoom() {
  const n = document.getElementById('card-zoom');
  if (n) n.remove();
  document.removeEventListener('keydown', cardZoomKey);
}
function cardZoomKey(e) { if (e.key === 'Escape') closeCardZoom(); }

// スマホ幅かどうか（CSSの切り替えと同じ幅）
const isMobile = () => !document.body.classList.contains('land') && window.matchMedia('(max-width: 720px)').matches;
// iPhone・iPad（iPadOS は Mac と名乗るので、タッチの有無でも見分ける）
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// カードの詳細を出す。パソコンは右の欄、スマホは画面下から出る窓
function showCardDetail(c, panelSel, extra) {
  if (!isMobile()) { renderDetail($(panelSel), c, extra); if (panelSel === '#board-detail' && typeof showLandDetail === 'function') showLandDetail(); return; }
  const body = el('div', { class: 'detail-sheet' });
  renderDetail(body, c, extra);
  showModal({ title: c.name, body });
}

// OCG・マスターデュエルそれぞれで使えるか／禁止・制限か
function formatInfo(c) {
  if (typeof FORMATS === 'undefined' || !c.cid) return null;
  return el('div', { class: 'd-formats' }, Object.entries(FORMATS).map(([fmt, f]) => {
    let state, cls;
    if (!cardAllowed(c, fmt)) { state = fmt === 'md' ? '未実装' : fmt === 'tcg' ? '未発売' : '使用不可'; cls = 'x'; }
    else { const l = limitOf(c, fmt); state = l < 3 ? LIMIT_LABEL[l] : '制限なし'; cls = l < 3 ? 'l' + l : 'ok'; }
    return el('span', { class: 'd-fmt ' + cls }, el('b', { text: f.short }), state);
  }));
}

// ---------- エラッタ前の文章 ----------
// そのカードを今「エラッタ前の効果」で処理する設定か。一人回し・対戦の盤面ではその対戦の設定、ほかは今のデッキの設定（無ければ全体の設定）
function isPreSelected(id) {
  if (typeof hasErrata !== 'function' || !hasErrata(id)) return false;
  const boardShown = typeof Board !== 'undefined' && Board.S && Board.S.auto && typeof Auto !== 'undefined' && Auto.duel && !document.getElementById('view-board').hidden;
  if (boardShown) return usePre(errataSpec(Auto.duel.errata), id);
  const d = typeof Decks !== 'undefined' && Decks.current();
  const v = d && d.errata && d.errata[id];
  if (v) return v === 'pre';
  return typeof errataMode === 'function' && errataMode() === 'pre';
}
// エラッタ前の文章 { ja } または { en }（エラッタ前で処理する設定でなければ null）
function errataTextFor(c) {
  if (!c || typeof ERRATA_TEXTS === 'undefined' || !ERRATA_TEXTS[c.id] || !isPreSelected(c.id)) return null;
  return ERRATA_TEXTS[c.id];
}

// カード詳細パネル
function renderDetail(box, c, extra) {
  box.innerHTML = '';
  if (!c) { box.append(el('p', { class: 'muted', text: 'カードをクリックすると詳細が表示されます。' })); return; }
  const stats = [];
  if (isMonster(c)) {
    stats.push(`${ATTR[c.attr] || '?'}属性`);
    stats.push(levelText(c));
    stats.push(statText(c));
    if (has(c, T.PENDULUM)) stats.push(`スケール ${c.ls}`);
    if (has(c, T.LINK)) stats.push(linkArrowsText(c));
  }
  const jaBox = el('div', { class: 'ja-text' }, el('div', { class: 'card-text muted', text: '日本語の効果を読み込み中…' }));
  // カードの絵（アプリで描いたもの）には効果文も描くので、効果文がまだ無いときは、読み込めたら描き直す
  const textBefore = c.jaText;
  const img = detailImage(c);
  const enBox = el('div', { class: 'card-text', text: '英語テキストを読み込み中…' });
  box.append(...[
    extra,
    img,
    // 一人回し・対戦の盤面では、関連カードを窓で見られるようにする（デッキ作成の画面には「関連カードを検索」がある）
    document.body.dataset.view === 'board' && c.id && typeof openRelatedModal === 'function' ? el('button', { class: 'btn small full d-related', text: '🔍 関連カードを見る', onclick: () => openRelatedModal(c) }) : null,
    el('div', { class: 'detail-head ' + frameClass(c) },
      el('div', { class: 'd-name', text: c.name }),
      c.ruby && c.ruby !== c.name ? el('div', { class: 'd-ruby', text: c.ruby }) : null,
      c.en && c.en !== c.name ? el('div', { class: 'd-en', text: c.en }) : null,
    ),
    el('div', { class: 'd-type', text: typeLine(c) }),
    stats.length ? el('div', { class: 'd-stats', text: stats.join('　') }) : null,
    c.noJp && !c.pre ? el('div', { class: 'warn', text: '日本未発売（TCGのみ）のカードです' }) : null,
    formatInfo(c),
    c.pre ? el('p', { class: 'muted small-note pre-note', text: `🆕 発売前のカードです（${c.pre} に収録予定・公開されている情報）。${c.noJp ? '日本語の情報がまだ無いので、英語の名前と効果文です。' : ''}` }) : null,
    typeof hasErrata === 'function' && hasErrata(c.id)
      ? el('div', { class: 'muted small-note', text: 'エラッタ（効果の変更）があったカードです。効果を自動処理するときにエラッタ前・エラッタ後のどちらの効果を使うかは、デッキ作成でカードごとに選べます（ふだんはエラッタ後。下の文章は今の効果です）。' })
      : null,
    el('h4', { text: '効果' }), jaBox,
    el('div', { class: 'd-links' },
      c.cid ? el('a', { class: 'btn small', href: OFFICIAL_DB_URL(c.cid), target: '_blank', rel: 'noopener', text: '公式データベースで見る' }) : null,
    ),
    el('details', null, el('summary', { text: '効果（英語）' }), enBox),
    el('details', null, el('summary', { text: '効果（中国語）' }),
      c.pdesc ? el('div', { class: 'card-text', text: '【P効果】\n' + c.pdesc }) : null,
      el('div', { class: 'card-text', text: c.desc || '' })),
  ].filter(Boolean));

  fetchCardTexts(c).then(t => {
    if (!jaBox.isConnected) return;
    if (img && img.isConnected && c.jaText && c.jaText !== textBefore) img.replaceWith(detailImage(c));
    jaBox.innerHTML = '';
    if (t && t.ja) {
      if (t.jaP) jaBox.append(el('div', { class: 'text-label', text: 'ペンデュラム効果' }), el('div', { class: 'card-text', text: t.jaP }),
        el('div', { class: 'text-label', text: isMonster(c) && has(c, T.NORMAL) && !has(c, T.EFFECT) ? 'フレーバーテキスト' : 'モンスター効果' }));
      if (!(typeof decorateUsed === 'function' && decorateUsed(jaBox, c, t.ja))) jaBox.append(el('div', { class: 'card-text', text: t.ja }));
    } else {
      jaBox.append(el('div', { class: 'card-text muted', text: c.noJp
        ? '日本では未発売のカードのため、日本語の効果文はありません。下の英語の効果を見てください。'
        : '日本語の効果文を取得できませんでした（インターネット接続を確認してください）。' }));
    }
    // エラッタ前の効果で処理する設定のカードは、エラッタ前の文章を出す（今の文章は下に畳んでおく）
    const pre = errataTextFor(c);
    if (pre) {
      const cur = el('div', { class: 'ja-text' }, ...jaBox.childNodes);
      jaBox.innerHTML = '';
      jaBox.append(el('div', { class: 'text-label errata-label', text: 'エラッタ前の効果（エラッタ前で処理する設定です）' }),
        el('div', { class: 'card-text', text: pre.ja || pre.en }),
        pre.en ? el('div', { class: 'muted small-note', text: 'エラッタ前の日本語の文章が見つからなかったため、英語の文章です。' }) : null,
        el('details', null, el('summary', { text: '今の効果（エラッタ後）' }), cur));
    }
    enBox.textContent = (t && t.en) || '英語テキストが見つかりませんでした（日本先行のカードなど）。';
  });
}

// ファイル選択を開く。iPhone の Safari は、ページに置いていない <input type=file> だと選んだあとの知らせが来ないことがあるので、一度ページに置く
function openFilePicker(input) {
  input.style.display = 'none';
  document.body.append(input);
  input.addEventListener('change', () => setTimeout(() => input.remove(), 0), { once: true });
  input.click();
}

// ドラッグでカードを動かせるのはマウスのときだけ。指で操作する端末（iPhone など）では、ドラッグ用の設定がタップのじゃまになることがあるので付けない
const canDrag = () => !window.matchMedia('(pointer: coarse)').matches;

// ---------- エラーを画面に出す ----------
// スマホではエラーが見えないので、画面の上に赤い帯で出す（内容を送ってもらえば原因が分かる）
function showError(title, err) {
  const msg = (err && (err.message || String(err))) || '';
  console.error(title, err);
  let bar = document.getElementById('error-bar');
  if (!bar) {
    bar = el('div', { id: 'error-bar', class: 'error-bar' });
    document.body.append(bar);
  }
  bar.innerHTML = '';
  bar.append(
    el('div', { class: 'eb-text', text: `⚠ ${title}${msg ? '：' + msg : ''}` }),
    el('div', { class: 'eb-note', text: `（版 ${typeof APP_VERSION !== 'undefined' ? APP_VERSION : '?'}・${navigator.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 90)}）この画面を送ってもらえると直せます` }),
    el('button', { class: 'btn small', text: '閉じる', onclick: () => bar.remove() }));
}
window.addEventListener('error', e => { if (e.message && !/ResizeObserver/.test(e.message)) showError('エラーが起きました', e.error || e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno); });
window.addEventListener('unhandledrejection', e => showError('エラーが起きました', e.reason));

// ---------- 設定ページ ----------
// 文字の大きさ：カードの説明・選択の画面・ログ・窓などの文字を、まとめて拡大・縮小する（CSS の --fs）
const FONT_SCALES = [[0.8, '小'], [0.9, 'やや小'], [1, '標準'], [1.15, '大'], [1.3, '特大']];
function applyFontScale() {
  const v = Number(store.get('ygo.fontScale', 1)) || 1;
  document.documentElement.style.setProperty('--fs', String(v));
}
applyFontScale();
function openSettings() {
  const body = el('div', { class: 'settings' });
  const draw = () => {
    body.innerHTML = '';
    const cur = Number(store.get('ygo.fontScale', 1)) || 1;
    body.append(
      el('h4', { text: '文字の大きさ' }),
      el('p', { class: 'muted small-note', text: 'カードの説明・選択の画面・ログ・設定などの文字の大きさ' }),
      el('div', { class: 'seg full' }, FONT_SCALES.map(([v, label]) => el('button', {
        class: Math.abs(cur - v) < 0.01 ? 'on' : '', text: label,
        onclick: () => { store.set('ygo.fontScale', v); applyFontScale(); draw(); if (typeof fitSheet === 'function') fitSheet(); },
      }))),
      el('p', { class: 'settings-sample', text: '①：相手メインフェイズに、このカードを手札から墓地へ送り、相手フィールドの効果モンスター１体を対象として発動できる。（見本）' }),
      el('h4', { text: '盤面' }),
      (() => {
        const cb = el('input', { type: 'checkbox' });
        cb.checked = store.get('ygo.tilt', true);
        cb.onchange = () => { store.set('ygo.tilt', cb.checked); if (typeof updateLandscape === 'function') updateLandscape(); if (typeof drawChainLinks === 'function') requestAnimationFrame(drawChainLinks); };
        return el('label', { class: 'check' }, cb, '盤面を奥へ傾けて大きく表示する（横長の画面の一人回し・対戦）');
      })());
  };
  draw();
  showModal({ title: '⚙ 設定', body, buttons: [{ label: '閉じる', primary: true, onClick: () => {} }] });
}
document.addEventListener('click', e => { if (e.target.closest('[data-settings]')) openSettings(); });
