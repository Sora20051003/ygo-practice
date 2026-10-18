// カードデータの取得・保存・検索
// 取得元: ygocdb.com の全カードデータ（zip）。ブラウザ内(IndexedDB)に保存して2回目以降はオフラインで使う。
const DATA_URL = 'https://ygocdb.com/api/v0/cards.zip';
const DATA_MD5_URL = 'https://ygocdb.com/api/v0/cards.zip.md5';
const DATA_VERSION = 1; // 変換形式を変えたら上げる

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
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return JSON.parse(await new Response(stream).text());
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
    ruby: e.jp_ruby || '',
    en: e.en_name || '',
    type: d.type || 0,
    atk: d.atk ?? 0,
    def: d.def ?? 0,
    level: lv & 0xff,
    ls: (lv >>> 24) & 0xff,
    rs: (lv >>> 16) & 0xff,
    race: d.race || 0,
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

function indexCards(cards) {
  DB.cards = cards;
  DB.byId = new Map();
  for (const c of cards) {
    c.key = normalizeText(c.name) + '|' + normalizeText(c.ruby) + '|' + normalizeText(c.en);
    c.nkey = normalizeText(c.name);
    DB.byId.set(c.id, c);
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
      if (cards && cards.length) { DB.meta = meta; indexCards(cards); return; }
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

function applyJaTexts(texts) {
  for (const c of DB.cards) {
    const t = texts[c.id];
    if (t) setCardText(c, t);
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
  const texts = {};
  try {
    const r = db.exec('select id, desc from texts');
    for (const [id, desc] of (r[0] ? r[0].values : [])) if (desc) texts[id] = String(desc).replace(/\r\n/g, '\n');
  } finally { db.close(); }
  const meta = { date: new Date().toISOString(), count: Object.keys(texts).length };
  await idbSet('jatexts', texts);
  await idbSet('jatextMeta', meta);
  DB.textMeta = meta;
  applyJaTexts(texts);
}

async function loadJaTexts(onStatus) {
  try {
    const meta = await idbGet('jatextMeta');
    if (meta) {
      const texts = await idbGet('jatexts');
      if (texts) { DB.textMeta = meta; applyJaTexts(texts); return; }
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

function searchCards({ q = '', qMode = 'and', text = '', textMode = 'and', kind = '', sub = '', subMode = 'or', attr = '', race = '', level = '', rank = '', link = '', marker = '', markerMode = 'or', sort = 'new' }) {
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
  for (const c of DB.cards) {
    if (isToken(c)) continue;
    if (kind && !KIND_FILTERS[kind](c)) continue;
    if (subs.length && !subOk(c)) continue;
    if (attrs.length && !(isMonster(c) && attrs.includes(c.attr))) continue;
    if (races.length && !(isMonster(c) && races.includes(c.race))) continue;
    if (useStars && !starOk(c)) continue;
    if (markers.length && !markerOk(c)) continue;
    if (terms.length && !matchTerms(c.key, terms, qMode)) continue;
    if (textTerms.length && !(c.tkey && matchTerms(c.tkey, textTerms, textMode))) continue;
    out.push(c);
  }
  // 名前が完全一致 → 前方一致 → その他 の順に並べる（ORのときは各語で一番良いもの）
  const matchRankOne = (c, t) => (c.nkey === t ? 0 : c.key.startsWith(t) ? 1 : 2);
  const matchRank = c => (!nq ? 0 : qMode === 'or' ? Math.min(...terms.map(t => matchRankOne(c, t))) : matchRankOne(c, nq));
  const sorters = {
    new: (a, b) => b.cid - a.cid,
    name: (a, b) => (a.ruby || a.name).localeCompare(b.ruby || b.name, 'ja'),
    level: (a, b) => b.level - a.level || b.atk - a.atk,
    atk: (a, b) => b.atk - a.atk,
  };
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
