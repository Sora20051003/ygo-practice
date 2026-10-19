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

function indexCards(cards) {
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

// ---------- ルール（OCG / マスターデュエル）と禁止・制限リスト ----------
// 禁止・制限リストは DawnbrandBots/yaml-yugi-limit-regulation（KONAMIの発表を毎日自動で取り込んでいる公開データ）から取得。
// 中身は { date, regulation: { KONAMIカード番号: 0=禁止 / 1=制限 / 2=準制限 } }
const FORMATS = {
  ocg: { label: 'OCG', short: 'OCG', list: 'ocg', allowed: c => !c.noJp },
  md: { label: 'マスターデュエル', short: 'MD', list: 'master-duel', allowed: c => c.md },
};
const BANLIST_URL = key => `https://dawnbrandbots.github.io/yaml-yugi-limit-regulation/${key}/current.vector.json`;
DB.banlists = { ocg: null, md: null };

// 保存済みのリストがあればすぐそれを使い、無いときだけ取りに行く（起動を待たせないため）
const BANLIST_TTL = 6 * 60 * 60 * 1000;   // 6時間たったら新しいリストが出ていないか確認する
async function loadBanlists(force = false) {
  let saved = null;
  try { saved = await idbGet('banlists'); } catch { /* 無ければ取りに行く */ }
  if (saved) DB.banlists = saved.lists;
  DB.banlistFetched = saved ? saved.fetched : 0;
  if (!saved || force) await refreshBanlists();
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
  if (saved && !force && Date.now() - saved.fetched < BANLIST_TTL) return;
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
  if (table[c.cid]) return table[c.cid];
  if (fmt === 'md') return 99999999;   // マスターデュエルは実装順がばらばらなので、不明なら「最近実装」とみなす
  if (!releaseIndex[fmt]) releaseIndex[fmt] = Object.keys(table).map(Number).sort((a, b) => a - b);
  const ids = releaseIndex[fmt];
  let lo = 0, hi = ids.length - 1, best = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (ids[mid] <= c.cid) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  return best >= 0 ? table[ids[best]] : 0;
}

// デッキに合わせた判定の材料
// reg：'latest'（最新）／'none'（制限なし）／'YYYY-MM-DD'（過去のリスト）／'custom:ID'（オリジナル）
// src：読み込みが必要なリスト [ルール, 日付]（過去のリストのとき）
function regContext(deck) {
  const fmt = deckFormat(deck);
  const reg = deck.reg || 'latest';
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

// 入れられる枚数（禁止0・制限1・準制限2・無制限3）
function limitIn(c, ctx) {
  // オリジナルで決めた枚数がいちばん優先
  if (ctx.custom && ctx.custom.overrides && ctx.custom.overrides[c.cid] !== undefined) return ctx.custom.overrides[c.cid];
  if (ctx.none) return 3;
  if (isUnreleased(c, ctx)) return 0;
  const v = ctx.vector && ctx.vector.regulation ? ctx.vector.regulation[c.cid] : undefined;
  return v === undefined ? 3 : v;
}
const limitOf = (c, fmt) => limitIn(c, { fmt, vector: DB.banlists[fmt] });   // 最新のリストで
const LIMIT_LABEL = { 0: '禁止', 1: '制限', 2: '準制限' };
const limitLabel = (c, ctx) => (isUnreleased(c, ctx) ? '未発売（禁止扱い）' : LIMIT_LABEL[limitIn(c, ctx)]);
const cardAllowed = (c, fmt) => (FORMATS[fmt] || FORMATS.ocg).allowed(c);

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

function searchCards({ format = '', q = '', qMode = 'and', text = '', textMode = 'and', kind = '', sub = '', subMode = 'or', attr = '', race = '', level = '', rank = '', link = '', marker = '', markerMode = 'or', sort = 'new' }) {
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
    if (format && !cardAllowed(c, format)) continue;   // そのルールで使えないカードは出さない
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
