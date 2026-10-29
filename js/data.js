// カードデータの取得・保存・検索
// 取得元: ygocdb.com の全カードデータ（zip）。ブラウザ内(IndexedDB)に保存して2回目以降はオフラインで使う。
const DATA_URL = 'https://ygocdb.com/api/v0/cards.zip';
const DATA_MD5_URL = 'https://ygocdb.com/api/v0/cards.zip.md5';
const DATA_VERSION = 3; // 変換形式を変えたら上げる（2: マスターデュエル実装済みかどうか md を追加、3: 自動処理用に setcode を追加）

const DB = {
  cards: [],
  byId: new Map(),
  meta: null,
};

// ---------- IndexedDB ----------
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ygo-practice', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const r = db.transaction('kv').objectStore('kv').get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- zip展開（ブラウザ標準の DecompressionStream を使う） ----------
async function unzipJson(buf) {
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zipの形式が読めませんでした');
  const entries = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < entries; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!name.endsWith('.json')) continue;
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const data = new Uint8Array(buf, start, compSize);
    if (method === 0) return JSON.parse(dec.decode(data));
    if (method !== 8) throw new Error('未対応の圧縮形式です');
    return JSON.parse(dec.decode(await inflateRaw(data)));
  }
  throw new Error('zipの中にカードデータがありませんでした');
}

// ygocdbの1枚分 → アプリで使う形
function convertCard(e) {
  const d = e.data;
  if (!d || !e.id) return null;
  const lv = d.level || 0;
  return {
    id: e.id,
    cid: e.cid || 0,
    name: e.jp_name || e.en_name || e.cn_name || String(e.id),
    noJp: !e.jp_name,
    md: !!e.md_name,   // マスターデュエルに実装済み（ygocdb にマスターデュエル版の名前がある）
    ruby: e.jp_ruby || '',
    en: e.en_name || '',
    type: d.type || 0,
    atk: d.atk ?? 0,
    def: d.def ?? 0,
    level: lv & 0xff,
    ls: (lv >>> 24) & 0xff,
    rs: (lv >>> 16) & 0xff,
    race: d.race || 0,
    setcode: d.setcode || 0,   // カテゴリ（自動処理で使う）
    attr: d.attribute || 0,
    desc: (e.text && e.text.desc) || '',
    pdesc: (e.text && e.text.pdesc) || '',
  };
}

// 検索用に表記ゆれをそろえる（ひらがな→カタカナ、全角→半角、記号・空白を除去）
function normalizeText(s) {
  return (s || '').normalize('NFKC').toLowerCase()
    .replace(/[ぁ-ゖ]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .replace(/[\s・･\-‐－―ー〜~'"’”“!?,.。、:;&＆()（）「」『』【】\[\]<>《》☆★]/g, '');
}

// 発売前（情報が出ている）のカードを足す（data/prerelease-cards.js。カードデータにもう同じ名前のカードがあれば足さない）
function withPreCards(cards) {
  if (typeof PRE_CARDS === 'undefined' || !PRE_CARDS.length) return cards;
  const ids = new Set(cards.map(c => c.id)), names = new Set(cards.map(c => normalizeText(c.name)));
  const add = [];
  for (const [id, type, lv, race, attr, atk, def, name, ruby, en, text, set, noJp] of PRE_CARDS) {
    if (ids.has(id) || names.has(normalizeText(name))) continue;
    const c = {
      id, cid: 0, name, noJp: !!noJp, md: false, ruby: ruby || '', en: en || '', type, atk, def,
      level: lv & 0xff, ls: (lv >>> 24) & 0xff, rs: (lv >>> 16) & 0xff, race, setcode: 0, attr,
      desc: noJp ? text : '', pdesc: '', pre: set,   // pre：発売前（収録予定のパックの記号）
    };
    if (!noJp) { c.jaText = text; c.tkey = normalizeText(text); }
    add.push(c);
  }
  return add.length ? [...cards, ...add] : cards;
}

// ---------- アニメのカード ----------
// data/anime-cards.js（EDOPro の cards-unofficial.cdb のアニメ・漫画のカード＋Yugipedia の日本語名・日本語の文）。
// ANIME_CARDS.d[id] = [base, tag, en, ja, type, lv, race, attr, atk, def, setcodes, alias, jaText, enText, strs]
//   base：同じ名前の今のカード（あればアニメ版。無ければ 0＝アニメだけのカード）／tag：「アニメ」「漫画」など
// アニメ版（今のカードと同じ名前）は検索に出さず、デッキ作成のカードの説明で「アニメの効果」に切り替える
const ANIME_FILE = 'data/anime-cards.js?v=5';
async function loadAnimeCards() {
  if (typeof ANIME_CARDS !== 'undefined') return;
  try { await loadScript(ANIME_FILE); } catch (e) { console.warn('アニメのカードを読めませんでした', e); }
}
DB.animeOf = new Map();   // 今のカード → そのアニメ版の一覧
function withAnimeCards(cards) {
  DB.animeOf = new Map();
  if (typeof ANIME_CARDS === 'undefined') return cards;
  const byId = new Map(cards.map(c => [c.id, c]));
  // 同じ名前のカード：今のカード（日本語名・英語名）と、先に入れたアニメだけのカード
  const nameKey = s => normalizeText(s || '');
  const byName = new Map();
  for (const c of cards) { if (c.name && !byName.has(nameKey(c.name))) byName.set(nameKey(c.name), c); if (c.en && !byName.has('en:' + nameKey(c.en))) byName.set('en:' + nameKey(c.en), c); }
  const animeByName = new Map();
  const add = [];
  for (const [k, a] of Object.entries(ANIME_CARDS.d)) {
    const id = +k;
    if (byId.has(id)) continue;   // 番号がほかのカードとぶつかるものは入れない
    const [base0, tag, en, ja, type, lv, race, attr, atk, def, sc, alias, jaText, enText, strs, ruby] = a;
    let base = base0;
    let b = base ? byId.get(base) : null;
    // 今のカードと同じ名前なのに、つながっていないもの → そのカードのアニメ版にする
    if (!b) { b = (ja && byName.get(nameKey(ja))) || byName.get('en:' + nameKey(en)) || null; base = b ? b.id : 0; }
    // アニメだけのカードで、同じ名前のものが前にある（同じカードの別の版） → 前のもののもう1つの版にする（検索には1枚だけ出す）
    let dupOf = null;
    if (!b) {
      const key = nameKey(ja || en);
      dupOf = animeByName.get(key) || null;
      if (!dupOf) animeByName.set(key, null);   // 下で自分を入れる
    }
    const c = {
      id, cid: 0, name: b ? `${b.name}（${tag}）` : (ja || en), noJp: !b && !ja, md: false, ruby: b ? b.ruby : (ruby || ''), en, type, atk, def,
      level: lv & 0xff, ls: (lv >>> 24) & 0xff, rs: (lv >>> 16) & 0xff, race, setcode: b ? b.setcode : 0, attr,
      desc: '', pdesc: '', anime: true, animeTag: tag, animeBase: b ? base : 0,
      edo: [alias, sc, type, lv, race, attr, atk, def], strs: strs || [], enText: enText || '',
    };
    const text = jaText || enText || '';
    if (text) { c.jaText = text; c.tkey = normalizeText(text); }
    // 機皇帝のパーツ（ワイゼルＴ など）：「機皇帝」「トップ」などでも探せるようにする
    const mk = c.name.match(/^(ワイゼル|スキエル|グランエル)([ＴＡＧＣTAGC])/);
    if (mk) c.ruby = `機皇帝${mk[1]}のパーツ ${mk[1]}${{ Ｔ: 'トップ', T: 'トップ', Ａ: 'アタック', A: 'アタック', Ｇ: 'ガード', G: 'ガード', Ｃ: 'キャリア', C: 'キャリア' }[mk[2]]}`;
    if (b) { if (!DB.animeOf.has(base)) DB.animeOf.set(base, []); DB.animeOf.get(base).push(c); }
    else {
      if (dupOf) {
        // 同じ名前のアニメだけのカードの別の版：最初の1枚にまとめる（検索には出さず、カードの説明で切り替える）
        c.animeBase = dupOf.id; c.name = `${c.name}（別の版）`;
        if (!DB.animeOf.has(dupOf.id)) DB.animeOf.set(dupOf.id, []);
        DB.animeOf.get(dupOf.id).push(c);
      } else animeByName.set(nameKey(ja || en), c);
      // アニメだけのカードは絵が無い（枠だけ描く）。無い絵を取りに行かないようにする
      if (typeof missingImages !== 'undefined') for (const k of ['art', 'small', 'full']) missingImages.add(id + k);
    }
    add.push(c);
  }
  return add.length ? [...cards, ...add] : cards;
}
// 今のカードとアニメ版をまとめた一覧（切り替え用。先頭が今のカード）
function animeFamily(c) {
  const baseId = c.animeBase || c.id;
  const base = DB.byId.get(baseId);
  const list = DB.animeOf.get(baseId) || [];
  return base && list.length ? [base, ...list] : [];
}

function indexCards(cards) {
  cards = withPreCards(cards);
  cards = withAnimeCards(cards);
  if (typeof withCustomCards === 'function') cards = withCustomCards(cards);   // オリジナルカード（custom.js）
  DB.cards = cards;
  DB.byId = new Map();
  DB.byCid = new Map();   // KONAMIのカード番号 → カード（デッキコードで使う）
  for (const c of cards) {
    c.key = normalizeText(c.name) + '|' + normalizeText(c.ruby) + '|' + normalizeText(c.en);
    c.nkey = normalizeText(c.name);
    DB.fuzzIndex = null;
    DB.byId.set(c.id, c);
    if (c.cid && !DB.byCid.has(c.cid)) DB.byCid.set(c.cid, c);
  }
}

async function downloadCards(onStatus) {
  onStatus && onStatus('カードデータをダウンロード中…（初回のみ・約2.5MB）');
  const [res, md5] = await Promise.all([
    fetch(DATA_URL, { cache: 'no-store' }),
    fetch(DATA_MD5_URL, { cache: 'no-store' }).then(r => (r.ok ? r.text() : '')).catch(() => ''),
  ]);
  if (!res.ok) throw new Error('ダウンロードに失敗しました（' + res.status + '）');
  const buf = await res.arrayBuffer();
  onStatus && onStatus('カードデータを展開中…');
  const raw = await unzipJson(buf);
  const cards = Object.values(raw).map(convertCard).filter(Boolean);
  await loadAnimeCards();
  const meta = { md5: md5.replace(/"/g, '').trim(), date: new Date().toISOString(), count: cards.length, version: DATA_VERSION };
  await idbSet('cards', cards);
  await idbSet('meta', meta);
  DB.meta = meta;
  indexCards(cards);
}

async function loadCards(onStatus) {
  try {
    const meta = await idbGet('meta');
    if (meta && meta.version === DATA_VERSION) {
      const cards = await idbGet('cards');
      if (cards && cards.length) { await loadAnimeCards(); DB.meta = meta; indexCards(cards); return; }
    }
  } catch (e) { console.warn('保存済みデータを読めませんでした', e); }
  await downloadCards(onStatus);
}

// 新しいデータがあるか確認して、あれば取り直す。戻り値: 更新したらtrue
async function updateCards(onStatus) {
  const md5 = await fetch(DATA_MD5_URL, { cache: 'no-store' }).then(r => r.text()).catch(() => '');
  if (md5 && DB.meta && md5.replace(/"/g, '').trim() === DB.meta.md5) return false;
  await downloadCards(onStatus);
  return true;
}

// ---------- ルール（OCG / マスターデュエル）と禁止・制限リスト ----------
// 禁止・制限リストは DawnbrandBots/yaml-yugi-limit-regulation（KONAMIの発表を毎日自動で取り込んでいる公開データ）から取得。
// 中身は { date, regulation: { KONAMIカード番号: 0=禁止 / 1=制限 / 2=準制限 } }
const FORMATS = {
  ocg: { label: 'OCG', short: 'OCG', list: 'ocg', allowed: c => !c.noJp || (!!c.pre && c.id < 101000000) },
  md: { label: 'マスターデュエル', short: 'MD', list: 'master-duel', allowed: c => c.md },
  // 海外（TCG）：海外で発売済みのカード（発売日の表に TCG の日付があるもの。表をまだ読んでいなければ英語名があるもの）
  tcg: { label: 'TCG（海外）', short: 'TCG', list: 'tcg', allowed: c => (c.pre ? c.id >= 101000000 : typeof RELEASE_DATES !== 'undefined' && RELEASE_DATES.tcg ? !!(c.cid && RELEASE_DATES.tcg[c.cid]) : !!c.en) },   // 発売前のカードは、海外の発売前（101 で始まる番号）だけ
};
const BANLIST_URL = key => `https://dawnbrandbots.github.io/yaml-yugi-limit-regulation/${key}/current.vector.json`;
DB.banlists = { ocg: null, md: null, tcg: null };

// 保存済みのリストがあればすぐそれを使い、無いときだけ取りに行く（起動を待たせないため）
const BANLIST_TTL = 6 * 60 * 60 * 1000;   // 6時間たったら新しいリストが出ていないか確認する
async function loadBanlists(force = false) {
  let saved = null;
  try { saved = await idbGet('banlists'); } catch { /* 無ければ取りに行く */ }
  if (saved) DB.banlists = saved.lists;
  DB.banlistFetched = saved ? saved.fetched : 0;
  // 保存してあるものに無いルール（あとから足した TCG など）があれば取り直す
  if (!saved || force || Object.keys(FORMATS).some(f => !saved.lists || !saved.lists[f])) await refreshBanlists();
}

// 新しいリストを取りに行く。適用日が変わったルールの一覧を返す（変化なしなら空）
async function refreshBanlists() {
  try {
    const lists = {};
    for (const [fmt, f] of Object.entries(FORMATS)) {
      const r = await fetch(BANLIST_URL(f.list), { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      lists[fmt] = await r.json();
    }
    const changed = Object.keys(lists).filter(fmt => DB.banlists[fmt] && DB.banlists[fmt].date !== lists[fmt].date);
    DB.banlists = lists;
    DB.banlistFetched = Date.now();
    await idbSet('banlists', { fetched: Date.now(), lists });
    return changed;
  } catch (e) {
    console.warn('禁止・制限リストを取得できませんでした', e);   // 保存済みのものがあればそれを使う
    return [];
  }
}

// 起動中・使っている間に、カードデータと禁止・制限リストの更新を裏で確認する（コードの更新は不要）
// onChange(内容) で画面を描き直してもらう
function startAutoDataUpdate(onChange) {
  const check = async () => {
    // 禁止・制限リスト（6時間おき）と、過去のリストの一覧
    if (Date.now() - (DB.banlistFetched || 0) > BANLIST_TTL) {
      const changed = await refreshBanlists();
      await loadRegDates(true);
      if (changed.length) onChange('banlist', changed);
    }
    // カードデータ（1日1回。新しいカードがあれば取り込む）
    if (DB.meta && Date.now() - Date.parse(DB.meta.checked || DB.meta.date) > 24 * 60 * 60 * 1000) {
      try {
        const updated = await updateCards(null);
        DB.meta.checked = new Date().toISOString();
        idbSet('meta', DB.meta).catch(() => {});
        if (updated) {
          // 新しく取り込んだカードにも日本語の効果文を付け直す
          try { applyJaTexts(await idbGet('jatexts') || {}, await idbGet('jastrs')); } catch { /* 無くても動く */ }
          onChange('cards');
        }
      } catch (e) { console.warn('カードデータの確認に失敗しました', e); }
    }
  };
  check();
  setInterval(check, 30 * 60 * 1000);   // 開きっぱなしでも30分おきに確認
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
}

// ---------- レギュレーション（どの時点の禁止・制限リストを使うか） ----------
// デッキの reg：'latest'（最新）/ 'YYYY-MM-DD'（過去のリスト）/ 'none'（制限なし）
// 過去のリストでは、その日より後に発売されたカードを「未発売（禁止扱い）」にする
const REG_REPO_API = key => `https://api.github.com/repos/DawnbrandBots/yaml-yugi-limit-regulation/contents/data/${key}`;
const REG_URL = (key, date) => `https://dawnbrandbots.github.io/yaml-yugi-limit-regulation/${key}/${date}.vector.json`;
DB.regDates = { ocg: [], md: [] };   // 選べる過去のリストの日付（新しい順）
DB.regCache = {};                    // 'ocg:2024-01-01' → リスト

// 選べる日付の一覧（1日1回取り直す）
async function loadRegDates(force = false) {
  let saved = null;
  try { saved = await idbGet('regDates2'); } catch { /* 無ければ取りに行く */ }
  if (saved) { DB.regDates = saved.dates; DB.regNameOnly = new Set(saved.nameOnly || []); }
  if (saved && !force && Date.now() - saved.fetched < BANLIST_TTL && Object.keys(FORMATS).every(f => saved.dates && saved.dates[f])) return;
  try {
    const dates = {}, nameOnly = [];
    for (const [fmt, f] of Object.entries(FORMATS)) {
      const r = await fetch(REG_REPO_API(f.list));
      if (!r.ok) throw new Error(r.status);
      const files = (await r.json()).map(x => x.name);
      const pick = re => new Set(files.map(n => (n.match(re) || [])[1]).filter(Boolean));
      const vec = pick(/^(\d{4}-\d{2}-\d{2})\.vector\.json$/);
      // 古いリスト（OCG は 2021 年より前）は英語のカード名で書かれた .name.json しかないので、それも使う
      const names = pick(/^(\d{4}-\d{2}-\d{2})\.name\.json$/);
      for (const d of names) if (!vec.has(d)) nameOnly.push(fmt + ':' + d);
      dates[fmt] = [...new Set([...vec, ...names])].sort().reverse();
    }
    DB.regDates = dates;
    DB.regNameOnly = new Set(nameOnly);
    await idbSet('regDates2', { fetched: Date.now(), dates, nameOnly });
  } catch (e) { console.warn('過去のリストの一覧を取得できませんでした', e); }
}
DB.regNameOnly = new Set();

// 英語名で書かれた古いリストを、カード番号（cid）のリストに直す
const REG_NAME_URL = (key, date) => `https://raw.githubusercontent.com/DawnbrandBots/yaml-yugi-limit-regulation/master/data/${key}/${date}.name.json`;
const enKey = s => String(s || '').toLowerCase().normalize('NFKC').replace(/[^a-z0-9]/g, '');
function namesToVector(date, byName) {
  const index = new Map();
  for (const c of DB.cards) if (c.cid && c.en) { const k = enKey(c.en); if (!index.has(k)) index.set(k, c.cid); }
  const regulation = {}, missing = [];
  for (const [name, v] of Object.entries(byName)) {
    const cid = index.get(enKey(name));
    if (cid) regulation[cid] = v; else missing.push(name);
  }
  return { date, regulation, missing };
}

// 過去のリスト本体（一度取ったら変わらないので保存しておく）
async function loadRegulation(fmt, date) {
  const key = fmt + ':' + date;
  if (DB.regCache[key]) return DB.regCache[key];
  try { const saved = await idbGet('reg:' + key); if (saved) return (DB.regCache[key] = saved); } catch { /* 取りに行く */ }
  let v;
  if (DB.regNameOnly.has(key)) {
    const r = await fetch(REG_NAME_URL(FORMATS[fmt].list, date));
    if (!r.ok) throw new Error('リストを取得できませんでした（' + r.status + '）');
    v = namesToVector(date, await r.json());
  } else {
    const r = await fetch(REG_URL(FORMATS[fmt].list, date));
    if (!r.ok) throw new Error('リストを取得できませんでした（' + r.status + '）');
    v = await r.json();
  }
  idbSet('reg:' + key, v).catch(() => {});
  return (DB.regCache[key] = v);
}

// 発売日の対応表（data/release-dates.js）。過去のリストを選んだときだけ読み込む
let releasePromise = null;
function loadReleaseDates() {
  if (typeof RELEASE_DATES !== 'undefined') return Promise.resolve();
  if (!releasePromise) {
    releasePromise = loadScript('data/release-dates.js?v=' + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : ''))
      .catch(() => {})
      .then(() => {
        // 読めなかったときは発売日のチェックなしで続ける（「読み込み中」のまま止まらないように）
        if (typeof RELEASE_DATES === 'undefined') { DB.releaseFailed = true; toast('発売日のデータを読めなかったため、未発売カードの判定はしていません'); }
      });
  }
  return releasePromise;
}

// 発売日（YYYYMMDD）。表に無いカードは、KONAMIのカード番号が近い（＝登録が近い）カードの日付で推定する
const releaseIndex = {};
function releaseDate(c, fmt) {
  if (typeof RELEASE_DATES === 'undefined' || !c.cid) return 0;
  const table = RELEASE_DATES[fmt];
  if (!table) return 0;   // 古い発売日の表（TCG の日付が無い）
  if (table[c.cid]) return table[c.cid];
  if (fmt === 'md') return 99999999;   // マスターデュエルは実装順がばらばらなので、不明なら「最近実装」とみなす
  if (fmt === 'tcg') return 99999999;   // 海外の日付が無い＝海外では未発売（日本だけのカード）
  if (!releaseIndex[fmt]) releaseIndex[fmt] = Object.keys(table).map(Number).sort((a, b) => a - b);
  const ids = releaseIndex[fmt];
  let lo = 0, hi = ids.length - 1, best = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (ids[mid] <= c.cid) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  return best >= 0 ? table[ids[best]] : 0;
}

// デッキに合わせた判定の材料
// reg：'latest'（最新）／'none'（制限なし）／'YYYY-MM-DD'（過去のリスト）／'custom:ID'（オリジナル）
// src：読み込みが必要なリスト [ルール, 日付]（過去のリストのとき）
// 発売日の区切り（deck.cutoff = 'YYYY-MM-DD'）：その日までに発売されたカードだけ使える。
// 禁止・制限リストとは別に決められる（同じレギュレーションの中で、まだ発売されていない頃の環境を遊ぶため）
function regContext(deck) {
  const ctx = regContextBase(deck);
  const cut = deck && /^\d{4}-\d{2}-\d{2}$/.test(deck.cutoff || '') ? deck.cutoff : null;
  if (!cut) return ctx;
  const end = ctx.endDate && ctx.endDate < cut ? ctx.endDate : cut;   // リストの最後の日のほうが早ければ、そちら
  return { ...ctx, cutoff: cut, endDate: end, date: +end.replace(/-/g, ''), loading: ctx.loading || (typeof RELEASE_DATES === 'undefined' && !DB.releaseFailed) };
}
function regContextBase(deck) {
  const fmt = deckFormat(deck);
  const reg = deck.reg || 'latest';
  // マスターデュエルの過去のイベント：始まった日のマスターデュエルのリスト＋イベントのルール（カードの範囲の決まりがあれば、その日までに発売されたカード）
  const ev = mdEventOf(reg);
  if (ev) {
    const ctx = { ...baseContext('md', mdListAt(ev.start), fmt), reg, event: ev };
    if (ev.pool) Object.assign(ctx, { cutoff: ev.pool, endDate: ev.pool, date: +ev.pool.replace(/-/g, '') });
    return ctx;
  }
  if (reg.startsWith('custom:')) {
    const cr = customReg(reg.slice(7));
    if (!cr) return baseContext(fmt, 'latest', fmt);   // 消されたオリジナルは最新扱い
    if (!cr.base) return { fmt, reg, custom: cr };     // 完全オリジナル：何も制限がない状態から
    return { ...baseContext(cr.base.fmt, cr.base.reg, fmt), reg, custom: cr };
  }
  return baseContext(fmt, reg, fmt);
}
// そのリストが使われた最後の日（次のリストが始まる前の日）。期間の途中で発売されたカードも、そのリストで使える
// 次のリストが無い（今も使われている）ときは今日
function regEndDate(listFmt, reg) {
  const ymd = t => new Date(t).toISOString().slice(0, 10);
  const dates = DB.regDates[listFmt] || [];
  if (!dates.length) return reg;   // 一覧がまだ無いときは、前と同じく始まりの日で判定する
  const next = dates.filter(d => d > reg).sort()[0];
  if (!next) return ymd(Date.now());
  return ymd(Date.parse(next + 'T00:00:00Z') - 86400000);
}
// listFmt のリスト（日付 reg）を、cardFmt のカードの発売日で使う
function baseContext(listFmt, reg, cardFmt) {
  if (reg === 'none') return { fmt: cardFmt, reg, none: true };
  if (reg === 'latest') return { fmt: cardFmt, reg, vector: DB.banlists[listFmt] };
  const key = listFmt + ':' + reg;
  const end = regEndDate(listFmt, reg);
  return { fmt: cardFmt, reg, src: [listFmt, reg], vector: DB.regCache[key] || null, date: +end.replace(/-/g, ''), endDate: end, loading: !DB.regCache[key] || (typeof RELEASE_DATES === 'undefined' && !DB.releaseFailed) };
}

// ---------- オリジナルのレギュレーション ----------
// { id, name, base: null（完全オリジナル）| { fmt, reg }（元にしたリスト）, overrides: { cid: 0〜3 } }
const customRegs = () => store.get('ygo.customRegs', []);
const customReg = id => customRegs().find(r => r.id === id) || null;
function saveCustomReg(r) {
  const list = customRegs().filter(x => x.id !== r.id);
  list.push(r);
  store.set('ygo.customRegs', list);
}
function deleteCustomReg(id) { store.set('ygo.customRegs', customRegs().filter(x => x.id !== id)); }
const isUnreleased = (c, ctx) => !!ctx.date && typeof RELEASE_DATES !== 'undefined' && releaseDate(c, ctx.fmt) > ctx.date;

// ---------- マスターデュエルの過去のイベント（デッキのルールが分かっているもの） ----------
// 禁止・制限は、イベントが始まった日に使われていたマスターデュエルのリスト。そこにイベントのデッキのルールを足す
// （イベントだけの禁止・制限は、元のデータが無いので入っていない）。
// ex：EXデッキに入れられる種類（[] は EXデッキ0枚）／rar：使えるレアリティ／copies：同じカードの枚数／noSpell：魔法カード禁止／
// attrs・races：モンスターの属性・種族の制限（魔法・罠は使える）／pool：この日までに発売されたカードだけ
const MD_EVENTS = [
  { id: 'xyz-fes-2022', name: 'エクシーズフェス', start: '2022-02-17', ex: ['xyz'] },
  { id: 'nr-fes-2022', name: 'N/Rレアリティフェス', start: '2022-03-23', rar: ['N', 'R'] },
  { id: 'synchro-fes-2022', name: 'シンクロフェス', start: '2022-04-12', ex: ['synchro'] },
  { id: 'fusion-fes-2022', name: 'フュージョンフェス', start: '2022-05-12', ex: ['fusion'] },
  { id: 'limitone-fes-2022', name: 'リミットワンフェス', start: '2022-06-16', copies: 1 },
  { id: 'extrazero-fes-2022', name: 'エクストラゼロフェス', start: '2022-07-19', ex: [] },
  { id: 'synchro-xyz-fes-2022', name: 'シンクロ×エクシーズフェス', start: '2022-09-20', ex: ['synchro', 'xyz'] },
  { id: 'link-reg-2022', name: 'リンクReg.', start: '2022-10-14', ex: ['link'] },
  { id: 'antispell-fes-2022', name: 'アンチスペルフェス', start: '2022-11-17', noSpell: true },
  { id: 'xyz-fes-2023', name: 'エクシーズフェス 2023', start: '2023-02-21', ex: ['xyz'] },
  { id: 'attribute4-2023', name: 'アトリビュート4', start: '2023-04-20', attrs: [4, 2, 8, 1] },
  { id: 'warlords-fes-2023', name: '群雄割拠フェス：アイランド・チャンピオンズ', start: '2023-09-13', races: [0x8000, 0x4000, 0x200, 0x800, 0x80000] },
  { id: 'fusion-xyz-fes-2023', name: 'フュージョン×エクシーズフェス', start: '2023-09-19', ex: ['fusion', 'xyz'] },
  { id: 'synchro-link-fes-2024', name: 'シンクロ×リンクフェス', start: '2024-02-19', ex: ['synchro', 'link'] },
  { id: 'triangle-2024-fusion', name: 'デュエルトライアングル（融合）', start: '2024-04-18', ex: ['fusion'] },
  { id: 'triangle-2024-synchro', name: 'デュエルトライアングル（シンクロ）', start: '2024-04-18', ex: ['synchro'] },
  { id: 'triangle-2024-xyz', name: 'デュエルトライアングル（エクシーズ）', start: '2024-04-18', ex: ['xyz'] },
  { id: 'fusion-link-fes-2024', name: 'フュージョン×リンクフェス', start: '2024-05-20', ex: ['fusion', 'link'] },
  { id: 'xyz-link-fes-2024', name: 'エクシーズ×リンクフェス', start: '2024-11-01', ex: ['xyz', 'link'], approx: true },
  { id: 'extrazero-fes-2024', name: 'エクストラゼロフェス 2024', start: '2024-11-01', ex: [], approx: true },
  { id: 'fusion-synchro-fes-2025', name: 'フュージョン×シンクロフェス', start: '2025-02-17', ex: ['fusion', 'synchro'] },
  { id: 'timetravel-2004', name: 'デュエルトライアル：タイムトラベル2004', start: '2025-02-28', pool: '2004-11-25' },
  { id: 'triangle-2025-le', name: 'デュエルトライアングル（光・地）', start: '2025-04-17', attrs: [16, 1] },
  { id: 'triangle-2025-dw', name: 'デュエルトライアングル（闇・水）', start: '2025-04-17', attrs: [32, 2] },
  { id: 'triangle-2025-fw', name: 'デュエルトライアングル（炎・風）', start: '2025-04-17', attrs: [4, 8] },
  { id: 'fusion-link-fes-2025', name: 'フュージョン×リンクフェス 2025', start: '2025-07-10', ex: ['fusion', 'link'] },
  { id: 'synchro-cup-2025', name: 'シンクロカップ', start: '2025-08-08', ex: ['synchro'] },
  { id: 'triangle-2025-fusion', name: 'デュエルトライアングル 2025秋（融合）', start: '2025-11-13', ex: ['fusion'] },
  { id: 'triangle-2025-xyz', name: 'デュエルトライアングル 2025秋（エクシーズ）', start: '2025-11-13', ex: ['xyz'] },
  { id: 'triangle-2025-link', name: 'デュエルトライアングル 2025秋（リンク）', start: '2025-11-13', ex: ['link'] },
  { id: 'fusion-synchro-fes-2026', name: 'フュージョン×シンクロフェス＋', start: '2026-01-19', ex: ['fusion', 'synchro'] },
  { id: 'triangle-2026-fusion', name: 'デュエルトライアングル 2026春（融合）', start: '2026-04-16', ex: ['fusion'] },
  { id: 'triangle-2026-synchro', name: 'デュエルトライアングル 2026春（シンクロ）', start: '2026-04-16', ex: ['synchro'] },
  { id: 'triangle-2026-link', name: 'デュエルトライアングル 2026春（リンク）', start: '2026-04-16', ex: ['link'] },
  { id: 'fusion-xyz-fes-2026', name: 'フュージョン×エクシーズ＋', start: '2026-07-13', ex: ['fusion', 'xyz'] },
  { id: 'fusion-cup-2026', name: 'フュージョンカップ', start: '2026-08-07', ex: ['fusion'] },
];
const mdEventOf = reg => (reg && reg.startsWith('event:') ? MD_EVENTS.find(e => e.id === reg.slice(6)) || null : null);
// イベントの始まった日に使われていたマスターデュエルのリストの日付（一覧がまだ無ければ最新）
function mdListAt(date) { const ds = (DB.regDates.md || []).filter(d => d <= date).sort(); return ds.length ? ds[ds.length - 1] : 'latest'; }
const EX_KIND = { fusion: ['融合', T.FUSION], synchro: ['シンクロ', T.SYNCHRO], xyz: ['エクシーズ', T.XYZ], link: ['リンク', T.LINK] };
const ATTR_NAME = { 1: '地', 2: '水', 4: '炎', 8: '風', 16: '光', 32: '闇', 64: '神' };
// イベントのルールでそのカードを使えるか。使えなければ理由
function eventBlock(ev, c) {
  if (!ev) return null;
  if (ev.ex && isExtraType(c) && !ev.ex.some(k => has(c, EX_KIND[k][1]))) return ev.ex.length ? `EXデッキは${ev.ex.map(k => EX_KIND[k][0]).join('・')}モンスターだけ` : 'EXデッキは使えない';
  if (ev.rar) { const r = typeof mdRarityOf === 'function' ? mdRarityOf(c) : null; if (r && !ev.rar.includes(r)) return `${ev.rar.join('・')}のカードだけ`; }
  if (ev.noSpell && has(c, T.SPELL)) return '魔法カードは使えない';
  if (ev.attrs && isMonster(c) && !ev.attrs.includes(c.attr)) return `モンスターは${ev.attrs.map(a => ATTR_NAME[a]).join('・')}属性だけ`;
  if (ev.races && isMonster(c) && !ev.races.includes(c.race)) return 'モンスターは獣戦士・獣・鳥獣・昆虫・爬虫類族だけ';
  return null;
}

// 入れられる枚数（禁止0・制限1・準制限2・無制限3）
function limitIn(c, ctx) {
  // オリジナルで決めた枚数がいちばん優先
  if (ctx.custom && ctx.custom.overrides && ctx.custom.overrides[c.cid] !== undefined) return ctx.custom.overrides[c.cid];
  if (isUnreleased(c, ctx)) return 0;   // 未発売（過去のリスト・発売日の区切り）。「制限なし」でも区切りの日付は効く
  if (ctx.event && eventBlock(ctx.event, c)) return 0;   // マスターデュエルのイベントのルールで使えない
  if (ctx.none) return 3;
  const v = ctx.vector && ctx.vector.regulation ? ctx.vector.regulation[c.cid] : undefined;
  const n = v === undefined ? 3 : v;
  return ctx.event && ctx.event.copies ? Math.min(n, ctx.event.copies) : n;
}
const limitOf = (c, fmt) => limitIn(c, { fmt, vector: DB.banlists[fmt] });   // 最新のリストで
const LIMIT_LABEL = { 0: '禁止', 1: '制限', 2: '準制限' };
const limitLabel = (c, ctx) => (isUnreleased(c, ctx) ? '未発売（禁止扱い）' : ctx.event && eventBlock(ctx.event, c) ? `イベントのルールで使えない：${eventBlock(ctx.event, c)}` : LIMIT_LABEL[limitIn(c, ctx)]);
const cardAllowed = (c, fmt) => !!c.custom || !!c.anime || (FORMATS[fmt] || FORMATS.ocg).allowed(c);   // オリジナルカード・アニメのカードはどのルールでも使える

// ---------- 日本語の効果文（テキスト検索用） ----------
// 取得元: mycard/ygopro-database の日本語カードDB（SQLite）。sql.js で読んで id→効果文 の形で保存する。
const JA_CDB_URL = 'https://raw.githubusercontent.com/mycard/ygopro-database/master/locales/ja-JP/cards.cdb';
const SQLJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/';
DB.textMeta = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('読み込みに失敗しました: ' + src));
    document.head.append(s);
  });
}

function setCardText(c, text) {
  c.jaText = text;
  c.tkey = normalizeText(text);
}

function applyJaTexts(texts, strs) {
  for (const c of DB.cards) {
    const t = texts[c.id];
    if (t) setCardText(c, t);
    if (strs && strs[c.id]) c.jaStrs = strs[c.id];   // 効果ごとの短い説明（自動処理のメニューで使う）
  }
}

async function downloadJaTexts(onStatus) {
  onStatus && onStatus('テキスト検索用データをダウンロード中…（約12MB）');
  if (typeof initSqlJs === 'undefined') await loadScript(SQLJS_BASE + 'sql-wasm.js');
  const [SQL, res] = await Promise.all([
    initSqlJs({ locateFile: f => SQLJS_BASE + f }),
    fetch(JA_CDB_URL, { cache: 'no-store' }),
  ]);
  if (!res.ok) throw new Error('ダウンロードに失敗しました（' + res.status + '）');
  const db = new SQL.Database(new Uint8Array(await res.arrayBuffer()));
  const texts = {}, strs = {};
  try {
    const cols = Array.from({ length: 16 }, (_, i) => 'str' + (i + 1)).join(', ');
    const r = db.exec('select id, desc, ' + cols + ' from texts');
    for (const [id, desc, ...ss] of (r[0] ? r[0].values : [])) {
      if (desc) texts[id] = String(desc).replace(/\r\n/g, '\n');
      if (ss.some(Boolean)) strs[id] = ss.map(s => s || '');
    }
  } finally { db.close(); }
  const meta = { date: new Date().toISOString(), count: Object.keys(texts).length, v: 2 };
  await idbSet('jatexts', texts);
  await idbSet('jastrs', strs);
  await idbSet('jatextMeta', meta);
  DB.textMeta = meta;
  applyJaTexts(texts, strs);
}

async function loadJaTexts(onStatus) {
  try {
    const meta = await idbGet('jatextMeta');
    if (meta && meta.v === 2) {
      const texts = await idbGet('jatexts');
      if (texts) { DB.textMeta = meta; applyJaTexts(texts, await idbGet('jastrs')); return; }
    }
  } catch (e) { console.warn('保存済みテキストを読めませんでした', e); }
  await downloadJaTexts(onStatus);
}

// ---------- 検索 ----------
const SUB_FILTERS = {
  normal: c => has(c, T.NORMAL) && isMonster(c),
  effect: c => has(c, T.EFFECT),
  tuner: c => has(c, T.TUNER),
  pendulum: c => has(c, T.PENDULUM),
  ritual: c => has(c, T.RITUAL),
  fusion: c => has(c, T.FUSION),
  synchro: c => has(c, T.SYNCHRO),
  xyz: c => has(c, T.XYZ),
  link: c => has(c, T.LINK),
  flip: c => has(c, T.FLIP),
  spsummon: c => has(c, T.SPSUMMON),
  toon: c => has(c, T.TOON),
  spirit: c => has(c, T.SPIRIT),
  union: c => has(c, T.UNION),
  gemini: c => has(c, T.GEMINI),
  quickplay: c => has(c, T.QUICKPLAY),
  continuous: c => has(c, T.CONTINUOUS),
  equip: c => has(c, T.EQUIP),
  field: c => has(c, T.FIELD),
  counter: c => has(c, T.COUNTER),
};
const KIND_FILTERS = {
  monster: isMonster,
  'main-monster': c => isMonster(c) && !isExtraType(c),
  extra: isExtraType,
  spell: c => has(c, T.SPELL),
  trap: c => has(c, T.TRAP),
};

// スペース区切りの各語をそろえた形にする
const splitTerms = s => (s || '').split(/[\s　]+/).map(normalizeText).filter(Boolean);
// and: すべての語を含む / or: どれかの語を含む
const matchTerms = (hay, terms, mode) => (mode === 'or' ? terms.some(t => hay.includes(t)) : terms.every(t => hay.includes(t)));

function searchCards({ format = '', q = '', qMode = 'and', text = '', textMode = 'and', kind = '', sub = '', subMode = 'or', attr = '', race = '', level = '', rank = '', link = '', marker = '', markerMode = 'or', sort = 'new', atkMin = null, atkMax = null, defMin = null, defMax = null }) {
  // 攻撃力・守備力の範囲（片方だけでもよい）。「？」（マイナスの値）と、守備力の無いリンクモンスターは、指定したら出さない
  const inRange = (v, lo, hi) => v >= 0 && (lo == null || v >= lo) && (hi == null || v <= hi);
  const useAtk = atkMin != null || atkMax != null, useDef = defMin != null || defMax != null;
  const subs = (Array.isArray(sub) ? sub : (sub ? [sub] : [])).map(s => SUB_FILTERS[s]).filter(Boolean);
  const subOk = c => (subMode === 'and' ? subs.every(f => f(c)) : subs.some(f => f(c)));
  const terms = splitTerms(q);
  const nq = terms.join('');
  const textTerms = splitTerms(text);
  // 属性・種族は複数指定（配列）に対応。どれか1つに当てはまればOK
  const toList = v => (Array.isArray(v) ? v.map(Number) : (v ? [+v] : []));
  const attrs = toList(attr), races = toList(race);
  // レベル・ランク・リンクは別々に指定。複数の欄を指定したら、どれかに当てはまればOK
  const stars = { level: toList(level), rank: toList(rank), link: toList(link) };
  const useStars = stars.level.length + stars.rank.length + stars.link.length > 0;
  // リンクマーカー（守備力の欄のビット）。and: 選んだ向きをすべて持つ / or: どれかを持つ
  const markers = toList(marker);
  const markerOk = c => has(c, T.LINK) && (markerMode === 'and' ? markers.every(b => c.def & b) : markers.some(b => c.def & b));
  const starOk = c => isMonster(c) && stars[levelKind(c)].includes(c.level);
  const out = [];
  const showAnime = store.get('ygo.showAnime', true);
  for (const c of DB.cards) {
    if (isToken(c)) continue;
    // アニメ版（今のカードと同じ名前）は出さない（カードの説明で切り替える）。アニメだけのカードは設定で出す・出さない
    if (c.anime && (c.animeBase || !showAnime)) continue;
    if (format && !cardAllowed(c, format)) continue;   // そのルールで使えないカードは出さない
    if (kind && !KIND_FILTERS[kind](c)) continue;
    if (subs.length && !subOk(c)) continue;
    if (attrs.length && !(isMonster(c) && attrs.includes(c.attr))) continue;
    if (races.length && !(isMonster(c) && races.includes(c.race))) continue;
    if (useStars && !starOk(c)) continue;
    if (markers.length && !markerOk(c)) continue;
    if (useAtk && !(isMonster(c) && inRange(c.atk, atkMin, atkMax))) continue;
    if (useDef && !(isMonster(c) && !has(c, T.LINK) && inRange(c.def, defMin, defMax))) continue;
    if (terms.length && !matchTerms(c.key, terms, qMode)) continue;
    if (textTerms.length && !(c.tkey && matchTerms(c.tkey, textTerms, textMode))) continue;
    out.push(c);
  }
  // 名前が完全一致 → 前方一致 → その他 の順に並べる（ORのときは各語で一番良いもの）
  const matchRankOne = (c, t) => (c.nkey === t ? 0 : c.key.startsWith(t) ? 1 : 2);
  const matchRank = c => (!nq ? 0 : qMode === 'or' ? Math.min(...terms.map(t => matchRankOne(c, t))) : matchRankOne(c, nq));
  // 新しい順：KONAMI のカード番号の大きい順。発売前のカード（番号がまだ無い）はいちばん新しいものとして先に出す（仮の番号の順）
  const newness = c => (c.pre ? 1e12 + c.id : c.cid || 0);
  const sorters = {
    new: (a, b) => newness(b) - newness(a),
    name: (a, b) => (a.ruby || a.name).localeCompare(b.ruby || b.name, 'ja'),
    level: (a, b) => b.level - a.level || b.atk - a.atk,
    atk: (a, b) => b.atk - a.atk,
    // 守備力順：リンクモンスター（守備力が無い）と魔法・罠は後ろ
    def: (a, b) => defOf(b) - defOf(a) || b.atk - a.atk,
  };
  function defOf(c) { return isMonster(c) && !has(c, T.LINK) ? c.def : -9; }
  const s = sorters[sort] || sorters.new;
  out.sort((a, b) => matchRank(a) - matchRank(b) || s(a, b));
  return out;
}

// 名前からカードを探す（デッキ読み込み用）
function findCardByName(name) {
  const n = normalizeText(name);
  if (!n) return null;
  let partial = [];
  for (const c of DB.cards) {
    if (isToken(c)) continue;
    if (c.nkey === n || normalizeText(c.en) === n) return c;
    if (c.key.includes(n)) partial.push(c);
  }
  return partial.length === 1 ? partial[0] : null;
}

// ---------- 名前のあいまい検索（デッキリストの読み込み用） ----------
// 読み取りで間違えやすい文字（ロ／口、カ／力 など）をそろえ、2文字ずつの組み合わせの重なりで似ている度合いを測る
const CONFUSABLE = { '口': 'ロ', '力': 'カ', '工': 'エ', '一': 'ー', '二': 'ニ', '八': 'ハ', '卜': 'ト', '夕': 'タ', '才': 'オ', '千': 'チ', 'へ': 'ヘ', 'ぺ': 'ペ', 'べ': 'ベ', '0': 'o', 'ｏ': 'o' };
const fuzzKey = s => normalizeText(s).replace(/./g, ch => CONFUSABLE[ch] || ch);
function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i++) { const b = s.slice(i, i + 2); out.set(b, (out.get(b) || 0) + 1); }
  if (s.length === 1) out.set(s, 1);
  return out;
}
function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0, na = 0, nb = 0;
  for (const v of a.values()) na += v;
  for (const v of b.values()) nb += v;
  for (const [k, v] of a) if (b.has(k)) inter += Math.min(v, b.get(k));
  return (2 * inter) / (na + nb);
}
// 似ているカードを点数（0〜1）の高い順に返す。日本語名・読み・英語名のいちばん近いもので比べる
function fuzzyCandidates(name, k = 5) {
  const q = fuzzKey(name);
  if (q.length < 2) return [];
  const qb = bigrams(q);
  if (!DB.fuzzIndex) {
    DB.fuzzIndex = DB.cards.filter(c => !isToken(c)).map(c => ({ c, keys: [fuzzKey(c.name), fuzzKey(c.ruby), fuzzKey(c.en)].filter(x => x.length >= 2).map(x => ({ x, b: bigrams(x) })) }));
  }
  const out = [];
  for (const { c, keys } of DB.fuzzIndex) {
    let s = 0;
    for (const { x, b } of keys) {
      let v = dice(qb, b);
      if (x.includes(q) || q.includes(x)) v = Math.max(v, 0.75 * Math.min(q.length, x.length) / Math.max(q.length, x.length) + 0.2);
      if (v > s) s = v;
    }
    if (s >= 0.35) out.push({ c, score: s });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, k);
}

// zip の中身（deflate）を展開する。ブラウザ標準の DecompressionStream が使えないとき（iPhone の iOS 16.3 以前など）は、
// 展開用の小さなライブラリ（fflate）を読み込んで使う
async function inflateRaw(data) {
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) { console.warn('DecompressionStream が使えないので別の方法で展開します', e); }
  }
  if (typeof fflate === 'undefined') await loadScript('https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js');
  return fflate.inflateSync(data);
}
