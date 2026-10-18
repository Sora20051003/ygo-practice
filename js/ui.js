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
const IMG_URL = {
  art: id => `https://images.ygoprodeck.com/images/cards_cropped/${id}.jpg`,
  small: id => `https://images.ygoprodeck.com/images/cards_small/${id}.jpg`,
  full: id => `https://images.ygoprodeck.com/images/cards/${id}.jpg`,
};
// 画像が無いと分かったカード（新しい日本先行カードなど）は、以後は文字で表示する
const missingImages = new Set();

// 画像の読み込み先の順番。パソコンに保存した画像（tools/download-images.bat で取得）を優先し、無ければネットから読む
const IMG_SOURCES = {
  art: id => LOCAL_FILES ? [`pics/art/${id}.jpg`, IMG_URL.art(id)] : [IMG_URL.art(id)],
  small: id => [IMG_URL.small(id)],
  full: id => [IMG_URL.full(id)],
};

// 画像を読み込み、すべて失敗したら onFail を呼ぶ
function cardImg(id, kind, onFail, cls) {
  const sources = IMG_SOURCES[kind](id);
  let n = 0;
  const img = el('img', { class: cls || '', src: sources[0], loading: 'lazy', alt: '', draggable: 'false', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => {
    if (++n < sources.length) { img.src = sources[n]; return; }
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
  const mine = c.id && UserPics.get(c.id);
  if (!LOCAL_FILES || !c.id || missingJp.has(c.id)) {
    if (!mine) return jpCard(c, big);
    return el('div', { class: 'cardface photo jpphoto ' + frameClass(c), title: c.name },
      el('img', { src: mine, alt: c.name, draggable: 'false' }));
  }
  const node = el('div', { class: 'cardface photo jpphoto ' + frameClass(c), title: c.name });
  const img = el('img', { src: `pics/jp/${c.id}.jpg`, loading: 'lazy', alt: c.name, draggable: 'false' });
  img.addEventListener('error', () => {
    missingJp.add(c.id);
    const m = UserPics.get(c.id);
    if (m) img.src = m; else node.replaceWith(jpCard(c, big));
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

// ペンデュラムの文を「P効果」と「モンスター効果（またはフレーバー）」に分ける
function splitPendulum(text) {
  const m = text.match(/^【[ＰP]スケール[^】]*】\n?([\s\S]*?)\n?【(?:モンスター効果|フレーバーテキスト)】\n?([\s\S]*)$/);
  return m ? { p: m[1].trim(), main: m[2].trim() } : { p: '', main: text };
}

function jpCard(c, big = false) {
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
  if (c.id && cardStyle !== 'text' && !missingImages.has(c.id + 'art')) art.append(cardImg(c.id, 'art', img => img.remove()));   // ネット版でもイラストはネットから読む
  if (has(c, T.LINK)) {
    for (const [bit, ch] of Object.entries(JP_ARROWS)) art.append(el('span', { class: `jp-arrow b${bit}` + ((c.def & bit) ? ' on' : ''), text: ch }));
  }

  const text = c.jaText || '';
  const { p, main } = pend ? splitPendulum(text) : { p: '', main: text };
  const flavor = mon && has(c, T.NORMAL) && !has(c, T.EFFECT);
  const atk = c.atk < 0 ? '?' : c.atk;
  const def = c.def < 0 ? '?' : c.def;
  const box = el('div', { class: 'jp-box' },
    mon ? el('div', { class: 'jp-type', text: `【${typeLine(c)}】` }) : null,
    el('div', { class: 'jp-desc' + (flavor ? ' flavor' : ''), style: `font-size:${descSize(main.length)}cqw`, text: main }),
    mon ? el('div', { class: 'jp-stat' },
      el('span', { text: `ATK/${String(atk).padStart(4, ' ')}` }),
      el('span', { text: has(c, T.LINK) ? `LINK-${c.level}` : `DEF/${String(def).padStart(4, ' ')}` })) : null);

  // ペンデュラム：イラストの下にP効果の欄と左右のスケール
  const pbox = pend ? el('div', { class: 'jp-pbox' },
    el('div', { class: 'jp-pscale l' }, el('span', { text: '◆' }), el('b', { text: c.ls })),
    el('div', { class: 'jp-pdesc', style: `font-size:${Math.min(2.8, descSize(p.length * 1.6))}cqw`, text: p }),
    el('div', { class: 'jp-pscale r' }, el('span', { text: '◆' }), el('b', { text: c.rs }))) : null;

  return el('div', { class: `cardface jp ${frameClass(c)}${pend ? ' pend' : ''}${big ? ' big' : ''}`, title: c.name },
    el('div', { class: 'jp-head' },
      el('div', { class: 'jp-name', style: `font-size:max(${jpNameSize(c.name)}cqw, 7px)`, text: c.name }),
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

// 日本語・英語の効果文（ygoresources.com から取得。一度取ったらブラウザに保存）
const cardTextCache = new Map();
function fetchCardTexts(c) {
  const key = 'text:' + c.id;
  if (cardTextCache.has(key)) return cardTextCache.get(key);
  const p = (async () => {
    try {
      const saved = await idbGet(key);
      if (saved && saved.ja) {
        if (!c.jaText) setCardText(c, saved.jaP ? `${saved.jaP}\n${saved.ja}` : saved.ja);
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
    if (ja && !c.jaText) setCardText(c, jaP ? `${jaP}\n${ja}` : ja);
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
  if (cardStyle === 'jp') return el('div', { class: 'd-image jp' }, jpPhotoOrDrawn(c, true));
  const kind = cardStyle === 'image' ? 'full' : 'art';
  if (!hasImage(c, kind)) return null;
  const box = el('div', { class: 'd-image ' + kind });
  box.append(cardImg(c.id, kind, () => box.remove()));
  return box;
}

// スマホ幅かどうか（CSSの切り替えと同じ幅）
const isMobile = () => !document.body.classList.contains('land') && window.matchMedia('(max-width: 720px)').matches;
// iPhone・iPad（iPadOS は Mac と名乗るので、タッチの有無でも見分ける）
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// カードの詳細を出す。パソコンは右の欄、スマホは画面下から出る窓
function showCardDetail(c, panelSel, extra) {
  if (!isMobile()) { renderDetail($(panelSel), c, extra); return; }
  const body = el('div', { class: 'detail-sheet' });
  renderDetail(body, c, extra);
  showModal({ title: c.name, body });
}

// OCG・マスターデュエルそれぞれで使えるか／禁止・制限か
function formatInfo(c) {
  if (typeof FORMATS === 'undefined' || !c.cid) return null;
  return el('div', { class: 'd-formats' }, Object.entries(FORMATS).map(([fmt, f]) => {
    let state, cls;
    if (!cardAllowed(c, fmt)) { state = fmt === 'md' ? '未実装' : '使用不可'; cls = 'x'; }
    else { const l = limitOf(c, fmt); state = l < 3 ? LIMIT_LABEL[l] : '制限なし'; cls = l < 3 ? 'l' + l : 'ok'; }
    return el('span', { class: 'd-fmt ' + cls }, el('b', { text: f.short }), state);
  }));
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
  const enBox = el('div', { class: 'card-text', text: '英語テキストを読み込み中…' });
  box.append(...[
    extra,
    detailImage(c),
    el('div', { class: 'detail-head ' + frameClass(c) },
      el('div', { class: 'd-name', text: c.name }),
      c.ruby && c.ruby !== c.name ? el('div', { class: 'd-ruby', text: c.ruby }) : null,
      c.en && c.en !== c.name ? el('div', { class: 'd-en', text: c.en }) : null,
    ),
    el('div', { class: 'd-type', text: typeLine(c) }),
    stats.length ? el('div', { class: 'd-stats', text: stats.join('　') }) : null,
    c.noJp ? el('div', { class: 'warn', text: '日本未発売（TCGのみ）のカードです' }) : null,
    formatInfo(c),
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
