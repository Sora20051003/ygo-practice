// デッキ画像（ニューロンの「デッキ画像」など、カードが格子状に並んだ画像）からデッキを読み取る
//  1. 背景（紺色）とカードの枠の色の違いから、カードの位置を見つける
//  2. 見出しで区切られたグループを、上から メイン → EX → サイド とみなす
//  3. 各カードのイラストの中央部分を 8×8 マスに縮めた「特徴」と枠の色を、
//     全カードの特徴（data/card-features.js。日本版カード画像から前もって作ったもの）と比べて、一番似ているカードを選ぶ
// 特徴の作り方（cardFeature）は、前もって作る側（tools/build-features.html）と同じ関数を使うこと

const FEAT_GRID = 8;                       // 8×8 マス × RGB = 192 個の数
const FEAT_LEN = FEAT_GRID * FEAT_GRID * 3;
// カードの中のイラスト中央部分（カード全体を 0〜1 としたときの位置）
const ART_BOX = { x0: 0.20, x1: 0.80, y0: 0.24, y1: 0.62 };
// 枠の色を取る場所（カードの左端の細い帯。イラストより上の名前の横あたり）
const FRAME_BOX = { x0: 0.015, x1: 0.06, y0: 0.10, y1: 0.55 };

// 画像の一部（sx,sy,sw,sh）を n×n に縮めて RGB の配列を返す（2段階で縮めて、ちらつきを減らす）
function shrinkRegion(src, sx, sy, sw, sh, n) {
  const mid = document.createElement('canvas');
  mid.width = n * 4; mid.height = n * 4;
  const mg = mid.getContext('2d');
  mg.imageSmoothingEnabled = true; mg.imageSmoothingQuality = 'high';
  mg.drawImage(src, sx, sy, sw, sh, 0, 0, n * 4, n * 4);
  const small = document.createElement('canvas');
  small.width = n; small.height = n;
  const sg = small.getContext('2d');
  sg.imageSmoothingEnabled = true; sg.imageSmoothingQuality = 'high';
  sg.drawImage(mid, 0, 0, n, n);
  return sg.getImageData(0, 0, n, n).data;
}

// カード1枚分の特徴：イラスト中央の 8×8×RGB（色ごとに明るさ・コントラストをそろえる）＋ 枠の平均色
// src：画像（canvas か img）、r：カードの位置 {x,y,w,h}、artOnly：r がイラスト部分だけの画像のとき
function cardFeature(src, r, artOnly = false) {
  let box = ART_BOX;
  if (artOnly) box = { x0: 0.10, x1: 0.90, y0: 0.11, y1: 0.84 };   // イラストだけの画像での同じ場所
  const px = shrinkRegion(src, r.x + r.w * box.x0, r.y + r.h * box.y0, r.w * (box.x1 - box.x0), r.h * (box.y1 - box.y0), FEAT_GRID);
  const feat = new Uint8Array(FEAT_LEN + 3);
  for (let ch = 0; ch < 3; ch++) {
    let sum = 0, sq = 0;
    for (let i = 0; i < FEAT_GRID * FEAT_GRID; i++) { const v = px[i * 4 + ch]; sum += v; sq += v * v; }
    const n = FEAT_GRID * FEAT_GRID, mean = sum / n, sd = Math.sqrt(Math.max(sq / n - mean * mean, 1));
    for (let i = 0; i < n; i++) feat[i * 3 + ch] = Math.max(0, Math.min(255, Math.round(128 + ((px[i * 4 + ch] - mean) / sd) * 40)));
  }
  if (!artOnly) {
    const f = shrinkRegion(src, r.x + r.w * FRAME_BOX.x0, r.y + r.h * FRAME_BOX.y0, r.w * (FRAME_BOX.x1 - FRAME_BOX.x0), r.h * (FRAME_BOX.y1 - FRAME_BOX.y0), 1);
    feat[FEAT_LEN] = f[0]; feat[FEAT_LEN + 1] = f[1]; feat[FEAT_LEN + 2] = f[2];
  }
  return feat;
}

// ---------- カードの位置を見つける ----------
// 背景＝暗い紺色。カードの枠（オレンジ・緑・紫・黒・白など）はこれに当てはまらない
const isBackground = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b < 75 && b > r + 15;

function runs(arr, minLen) {   // true が続く区間 [始め, 終わり) の一覧
  const out = [];
  let s = -1;
  for (let i = 0; i <= arr.length; i++) {
    if (i < arr.length && arr[i]) { if (s < 0) s = i; } else if (s >= 0) { if (i - s >= minLen) out.push([s, i]); s = -1; }
  }
  return out;
}

function detectDeckCards(canvas) {
  const W = canvas.width, H = canvas.height;
  const d = canvas.getContext('2d').getImageData(0, 0, W, H).data;
  const bg = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) bg[i] = isBackground(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) ? 1 : 0;

  // 1. 縦の帯：背景でない画素が多い列（＝カードがある列）
  const colFg = new Float32Array(W);
  for (let x = 0; x < W; x++) { let c = 0; for (let y = 0; y < H; y++) c += 1 - bg[y * W + x]; colFg[x] = c / H; }
  const colMax = Math.max(...colFg);
  let cols = runs(Array.from(colFg, v => v > colMax * 0.5), W * 0.03);
  // カードの幅はだいたい同じなので、極端に広い・狭いものは除く
  const widths = cols.map(c => c[1] - c[0]).sort((a, b) => a - b);
  const cw = widths[Math.floor(widths.length / 2)] || 0;
  cols = cols.filter(c => Math.abs((c[1] - c[0]) - cw) < cw * 0.35);
  if (!cols.length) return [];

  // 2. 見出し（メインデッキ・エクストラデッキ…）の上下にある「画面幅いっぱいの明るい線」を目印に、各グループの最初の段を決める
  const cardW = cw * 0.93, cardH = cardW * 1.46;
  const starts = cols.map(c => c[0]);
  const gaps = starts.slice(1).map((s, i) => s - starts[i]).sort((a, b) => a - b);
  const pitchX = gaps.length ? gaps[Math.floor(gaps.length / 2)] : cw;
  const pitchY = cardH + (pitchX - cardW);   // 段の間隔（横の間隔と同じだけすき間がある）
  // そのマスにカードがあるか：イラストの中央部分に背景でない画素が多い
  const hasCard = (x0, y) => {
    let fg = 0, n = 0;
    for (let yy = Math.round(y + cardH * 0.24); yy < Math.min(H, y + cardH * 0.62); yy += 2)
      for (let xx = Math.round(x0 + cardW * 0.2); xx < x0 + cardW * 0.8; xx += 2) { fg += 1 - bg[yy * W + xx]; n++; }
    return n > 0 && fg / n > 0.55;
  };
  // 見出しの線の色：水色っぽい白（例 190,240,255）。カードの文字欄（ベージュ）とは青みで区別する
  const lineColorAt = i => d[i * 4 + 1] > 200 && d[i * 4 + 2] > 230 && d[i * 4 + 2] - d[i * 4] > 25;
  const brightLine = [];
  for (let y = 0; y < H; y++) { let c = 0; for (let x = 0; x < W; x += 2) if (lineColorAt(y * W + x)) c++; brightLine.push(c / (W / 2) > 0.85); }
  let groupStarts = [];
  for (const [, e] of runs(brightLine, 1)) {
    const s = e + 1;
    if (s + cardH * 0.62 < H && cols.some(([x0, x1]) => hasCard(x0 + (x1 - x0 - cardW) / 2, s))) groupStarts.push(s);
  }
  // 近すぎる候補（見出しの上の線と下の線）は、下の方を使う
  groupStarts = groupStarts.filter((s, i) => !(groupStarts[i + 1] !== undefined && groupStarts[i + 1] - s < cardH * 0.8));
  if (groupStarts.length) {
    const cards = [];
    groupStarts.forEach((s, g) => {
      const next = groupStarts[g + 1];
      for (let y = s; y + cardH * 0.62 < H; y += pitchY) {
        if (next !== undefined && y > next - pitchY * 0.5) break;
        const row = cols.map(([x0, x1]) => x0 + (x1 - x0 - cardW) / 2).filter(x => hasCard(x, y));
        if (!row.length) break;
        for (const x of row) cards.push({ x, y, w: cardW, h: cardH, group: g });
      }
    });
    const sections = ['main', 'extra', 'side'];
    for (const c of cards) c.section = sections[Math.min(c.group, 2)];
    return cards;
  }

  // 見出しの線が見つからない画像：カードの段の帯から探す
  // 横の帯：カードの列の「左端・中央・右端」のうち2か所以上が背景でない行（＝カードがある行。下の文字などは数えない）
  const rowHit = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    let c = 0;
    for (const [x0, x1] of cols) {
      const w = x1 - x0;
      const hits = [0.1, 0.5, 0.9].reduce((s, f) => s + 1 - bg[y * W + Math.round(x0 + w * f)], 0);
      if (hits >= 2) c++;
    }
    rowHit[y] = c / cols.length;
  }

  const expectH = cardH;
  const rows = runs(Array.from(rowHit, v => v > 0.08), expectH * 0.6);
  // 1つの帯が何段分もあるとき（段の間が詰まっている）は、カードの高さで分ける
  const splitRows = [];
  for (const [y0, y1] of rows) {
    const k = Math.max(1, Math.round((y1 - y0) / (expectH * 1.05)));
    const pitch = (y1 - y0) / k;
    for (let i = 0; i < k; i++) splitRows.push([y0 + pitch * i, y0 + pitch * (i + 1)]);
  }

  // 3. 各マスにカードがあるか（マスの中の背景の割合で判断）し、段の間の大きな隙間でグループに分ける
  const cards = [];
  let group = 0, prevBottom = null;
  for (const [y0, y1] of splitRows) {
    if (prevBottom !== null && y0 - prevBottom > cw * 0.3) group++;   // 見出しをはさむと隙間が大きい
    prevBottom = y1;
    for (const [x0, x1] of cols) {
      let fg = 0, n = 0;
      for (let y = Math.round(y0); y < y1; y += 3) for (let x = x0; x < x1; x += 3) { fg += 1 - bg[y * W + x]; n++; }
      // カードの位置：マスの中央に、カードの幅と縦横比で置く（段の上端がカードの上端）
      if (fg / n > 0.6) cards.push({ x: x0 + (x1 - x0 - cardW) / 2, y: y0, w: cardW, h: Math.min(expectH, y1 - y0), group });
    }
  }
  const sections = ['main', 'extra', 'side'];
  const groups = [...new Set(cards.map(c => c.group))].sort((a, b) => a - b);
  for (const c of cards) c.section = sections[Math.min(groups.indexOf(c.group), 2)];
  return cards;
}

// ---------- 全カードの特徴（data/card-features.js） ----------
let featurePromise = null;
function loadCardFeatures() {
  if (typeof CARD_FEATURES !== 'undefined') return Promise.resolve();
  if (!featurePromise) {
    featurePromise = loadScript('data/card-features.js?v=' + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '')).then(() => {
      if (typeof CARD_FEATURES === 'undefined') throw new Error('カードの特徴データを読めませんでした');
      const bin = atob(CARD_FEATURES.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      CARD_FEATURES.bytes = bytes;
      // イラスト画像しかないカードは枠の色が分からないので、同じ種類（枠）のカードの平均の色で補う
      const step = FEAT_LEN + 3, sums = {}, art = new Set(CARD_FEATURES.artOnly);
      CARD_FEATURES.ids.forEach((id, k) => {
        const c = DB.byId.get(featRealId(id));
        if (!c || art.has(id)) return;
        const s = sums[frameClass(c)] || (sums[frameClass(c)] = [0, 0, 0, 0]);
        for (let i = 0; i < 3; i++) s[i] += bytes[k * step + FEAT_LEN + i];
        s[3]++;
      });
      CARD_FEATURES.ids.forEach((id, k) => {
        const c = DB.byId.get(featRealId(id));
        const s = c && art.has(id) && sums[frameClass(c)];
        if (s) for (let i = 0; i < 3; i++) bytes[k * step + FEAT_LEN + i] = Math.round(s[i] / s[3]);
      });
    });
  }
  return featurePromise;
}

// 特徴が一番近いカード（候補つき）。section が extra ならEXデッキのカードだけ、それ以外はメインデッキのカードだけで探す
// 特徴データの番号 → 本来のカードID（別イラストは元のカードにまとめる）
const featRealId = id => (typeof CARD_FEATURES !== 'undefined' && CARD_FEATURES.alias && CARD_FEATURES.alias[id]) || id;

// 2つの特徴の距離（イラスト＋枠の色）
function featDist(feat, bytes, o) {
  let dist = 0;
  for (let i = 0; i < FEAT_LEN; i++) { const t = feat[i] - bytes[o + i]; dist += t * t; }
  // 枠の色の違い（カードの種類の違い）も足す
  for (let i = 0; i < 3; i++) { const t = feat[FEAT_LEN + i] - bytes[o + FEAT_LEN + i]; dist += t * t * 12; }
  return dist;
}

// 特徴が一番近いカード（候補つき）。section が extra ならEXデッキのカードだけ、それ以外はメインデッキのカードだけで探す
// 同じカードの別イラストや、前に選び直して覚えたイラストも比べ、カードごとに一番近い距離を使う
function matchCard(feat, section, keep = 5) {
  const { ids, bytes } = CARD_FEATURES;
  const step = FEAT_LEN + 3;
  // EXデッキ用・メインデッキ用の候補の番号を、最初の1回だけ作っておく
  if (!CARD_FEATURES.pool) {
    const ex = [], mn = [];
    ids.forEach((id, k) => { const c = DB.byId.get(featRealId(id)); if (c && !isToken(c)) (isExtraType(c) ? ex : mn).push(k); });
    CARD_FEATURES.pool = { extra: Int32Array.from(ex), main: Int32Array.from(mn) };
  }
  const extra = section === 'extra';
  const pool = CARD_FEATURES.pool[extra ? 'extra' : 'main'];
  const byId = new Map();
  const add = (id, dist) => { const b = byId.get(id); if (b === undefined || dist < b) byId.set(id, dist); };
  // 上位だけ残すための目安（keep×3 件より遠いものは捨てる）
  let worst = Infinity;
  const top = [];
  for (let p = 0; p < pool.length; p++) {
    const k = pool[p];
    const dist = featDist(feat, bytes, k * step);
    if (dist >= worst) continue;
    add(featRealId(ids[k]), dist);
    top.push(dist);
    if (top.length > keep * 6) { top.sort((a, b) => a - b); top.length = keep * 3; worst = top[top.length - 1]; }
  }
  // 自分で選び直して覚えたイラスト
  for (const l of learnedFeatures()) {
    const c = DB.byId.get(l.id);
    if (!c || isExtraType(c) !== extra) continue;
    add(l.id, featDist(feat, l.bytes, 0) * 0.9);   // 自分のデッキ画像から覚えたものは少しだけ優先
  }
  return [...byId].map(([id, dist]) => ({ id, dist })).sort((a, b) => a.dist - b.dist).slice(0, keep);
}

// ---------- 選び直したイラストを覚える（この端末に保存） ----------
// 読み取り結果で選び直したカードは、その切り抜きの特徴を覚えて、次から同じイラストを正しく読めるようにする
const LEARN_KEY = 'ygo.imgLearn', LEARN_MAX = 600;
let learnedCache = null;
function learnedFeatures() {
  if (learnedCache) return learnedCache;
  const raw = store.get(LEARN_KEY, []);
  learnedCache = raw.map(r => {
    const bin = atob(r.f), b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return { id: r.id, bytes: b };
  });
  return learnedCache;
}
function learnFeatures(list) {   // list: [{ id, feat }]
  if (!list.length) return;
  const raw = store.get(LEARN_KEY, []);
  for (const { id, feat } of list) raw.push({ id, f: btoa(String.fromCharCode.apply(null, feat)) });
  store.set(LEARN_KEY, raw.slice(-LEARN_MAX));
  learnedCache = null;
}

// 画像ファイル → [{ rect, section, candidates }]
async function readDeckImage(file) {
  await loadCardFeatures();
  const img = await createImageBitmap(file);
  // 幅をそろえる（大きすぎる画像は処理が重いので縮める）
  const scale = Math.min(1, 1600 / img.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const rects = detectDeckCards(canvas);
  const cards = rects.map(r => ({ rect: r, section: r.section, feat: cardFeature(canvas, r), candidates: matchShifted(canvas, r) }));
  preferConsistent(cards);
  return { canvas, cards };
}

// カード1枚を切り抜いて画像にする（表示用。小さい画像は少し大きめにして文字のつぶれを防ぐ）
function cropCardPic(canvas, r) {
  const w = Math.max(120, Math.min(240, Math.round(r.w))), h = Math.round(w * r.h / r.w);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, w, h);
  return cv.toDataURL('image/jpeg', 0.85);
}

// ---------- 確認画面 ----------
// 読み取った結果を、切り抜いた画像と並べて表示し、違うものは候補から選び直してもらう
async function openImageImport(file) {
  const closeWait = showModal({ title: 'デッキ画像を読み取り中…', body: el('p', { text: 'カードの位置を探して、イラストを照合しています（初回は照合用のデータを読み込むので少し時間がかかります）' }) });
  let res;
  try { res = await readDeckImage(file); } catch (e) { closeWait(); toast('画像を読めませんでした：' + e.message); return; }
  closeWait();
  if (!res.cards.length) { toast('カードが見つかりませんでした。ニューロンのデッキ画像のように、カードが並んだ画像を選んでください'); return; }

  const choice = res.cards.map(c => (c.candidates[0] ? c.candidates[0].id : 0));
  const grid = el('div', { class: 'imgdeck-grid' });
  res.cards.forEach((c, i) => {
    const thumb = document.createElement('canvas');
    thumb.width = 60; thumb.height = Math.round(60 * c.rect.h / c.rect.w);
    thumb.getContext('2d').drawImage(res.canvas, c.rect.x, c.rect.y, c.rect.w, c.rect.h, 0, 0, thumb.width, thumb.height);
    const sel = el('select', null,
      c.candidates.map(k => el('option', { value: k.id, text: (DB.byId.get(k.id) || {}).name })),
      el('option', { value: 0, text: '（このカードは入れない）' }),
      el('option', { value: -1, text: '🔍 候補にない：名前で探す…' }));
    // 候補にないときは名前で探す（同じイラストを次から正しく読めるよう、選んだカードは覚える）
    sel.addEventListener('change', () => {
      if (+sel.value !== -1) { choice[i] = +sel.value; return; }
      sel.value = String(choice[i]);
      promptText('カード名で探す（一部でも、ひらがなでも可）', '', q => {
        const exact = findCardByName(q);
        const hits = exact ? [{ c: exact }] : fuzzyCandidates(q, 8);
        const allowed = hits.map(h => h.c).filter(x => x && !isToken(x) && (isExtraType(x) === (c.section === 'extra')));
        if (!allowed.length) { toast('見つかりませんでした'); return; }
        for (const x of allowed.slice().reverse()) {
          if (![...sel.options].some(o => +o.value === x.id)) sel.insertBefore(el('option', { value: x.id, text: x.name }), sel.firstChild);
        }
        sel.value = String(allowed[0].id); choice[i] = allowed[0].id;
        if (allowed.length > 1) toast(`「${allowed[0].name}」にしました。違うときは一覧から選んでください`);
      });
    });
    // 一番目と二番目の候補の差が小さいものは「要確認」
    const sure = c.candidates.length < 2 || c.candidates[1].dist - c.candidates[0].dist > c.candidates[0].dist * 0.15;
    grid.append(el('div', { class: 'imgdeck-item' + (sure ? '' : ' unsure') }, thumb,
      el('div', { class: 'imgdeck-sec', text: { main: 'メイン', extra: 'EX', side: 'サイド' }[c.section] }), sel));
  });
  const count = s => res.cards.filter(c => c.section === s).length;
  const usePics = el('input', { type: 'checkbox', checked: true });
  showModal({
    title: 'デッキ画像の読み取り結果', wide: true,
    body: el('div', { class: 'stack' },
      el('p', { text: `メイン${count('main')}枚・EX${count('extra')}枚・サイド${count('side')}枚を見つけました。カード名が違うものは選び直してください（黄色の枠は自信がないカードです）。` }),
      el('label', { class: 'check' }, usePics, 'この画像のカードを、アプリのカード表示に使う（この端末に保存）'),
      grid),
    buttons: [{
      label: 'このデッキを追加', primary: true, onClick: () => {
        const deck = Decks.blank(file.name.replace(/\.\w+$/, '') || '画像から読み込んだデッキ');
        res.cards.forEach((c, i) => { if (choice[i]) deck[c.section].push(choice[i]); });
        // 選び直したカードは、その切り抜きのイラストを覚えておく（別イラストのカードなどを次から正しく読めるように）
        learnFeatures(res.cards.map((c, i) => ({ id: choice[i], feat: c.feat, top: c.candidates[0] && c.candidates[0].id }))
          .filter(x => x.id > 0 && x.id !== x.top));
        if (usePics.checked) {
          const pics = new Map();
          res.cards.forEach((c, i) => { if (choice[i] && !pics.has(choice[i])) pics.set(choice[i], cropCardPic(res.canvas, c.rect)); });
          saveUserPics(pics).then(() => { renderDeck(); renderResults(); if (typeof renderBoard === 'function') renderBoard(); })
            .catch(e => toast('カード画像を保存できませんでした：' + e.message));
        }
        Decks.list.push(deck); Decks.currentId = deck.id; Decks.save();
        renderDeck(); renderResults(); switchView('deck');
        toast(`「${deck.name}」を追加しました（メイン${deck.main.length}・EX${deck.extra.length}・サイド${deck.side.length}）`);
      },
    }],
  });
}

// 切り抜き位置を少しずつずらして何回か照合し、カードごとに一番よく合った距離を使う（位置のずれに強くする）
function matchShifted(canvas, r) {
  const best = new Map();
  const dx = r.w * 0.03, dy = r.h * 0.03;
  for (const [ox, oy] of [[0, 0], [-dx, 0], [dx, 0], [0, -dy], [0, dy]]) {
    const rr = { ...r, x: Math.max(0, r.x + ox), y: Math.max(0, r.y + oy) };
    for (const c of matchCard(cardFeature(canvas, rr), r.section, 8)) {
      const b = best.get(c.id);
      if (!b || c.dist < b.dist) best.set(c.id, c);
    }
  }
  return [...best.values()].sort((a, b) => a.dist - b.dist).slice(0, 6);
}

// デッキ全体のつじつまで選び直す：自信がないカードは、隣のカードや同じデッキの自信があるカードと同じ候補が
// 近い距離にあれば、そちらを選ぶ（同じカードは並んで置かれることが多いため）
function preferConsistent(cards) {
  const sure = c => c.candidates.length < 2 || c.candidates[1].dist - c.candidates[0].dist > c.candidates[0].dist * 0.15;
  const confident = new Map();
  cards.forEach(c => { if (c.candidates[0] && sure(c)) confident.set(c.section + ':' + c.candidates[0].id, true); });
  cards.forEach((c, i) => {
    if (!c.candidates.length || sure(c)) return;
    const top = c.candidates[0].dist;
    const near = c.candidates.filter(k => k.dist <= top * 1.25);
    const neighbor = [cards[i - 1], cards[i + 1]].filter(n => n && n.section === c.section && n.candidates[0]).map(n => n.candidates[0].id);
    const pick = near.find(k => neighbor.includes(k.id)) || near.find(k => confident.has(c.section + ':' + k.id));
    if (pick && pick !== c.candidates[0]) {
      c.candidates = [pick, ...c.candidates.filter(k => k !== pick)];
      c.adjusted = true;
    }
  });
}
