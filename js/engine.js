// 効果の自動処理：EDOPro のルール処理（ocgcore を WebAssembly にしたもの）を使う。
// カードの効果は ProjectIgnis/CardScripts の Lua スクリプト（カードごとの効果の書き方）をネットから読み込む。
// 1回の処理はすべて同期（sync 版）。スクリプトは使う前にまとめて読み込んでおく。
const ENGINE_URL = 'https://cdn.jsdelivr.net/npm/ocgcore-wasm@0.1.4/dist/index.js';
const SCRIPT_BASES = [
  'https://raw.githubusercontent.com/ProjectIgnis/CardScripts/master/',
  'https://cdn.jsdelivr.net/gh/ProjectIgnis/CardScripts@master/',
];
// 起動時に読む共通スクリプト（ルールの手順：融合・シンクロなど）
const CORE_SCRIPTS = ['constant.lua', 'utility.lua', 'archetype_setcode_constants.lua', 'card_counter_constants.lua',
  'cards_specific_functions.lua', 'chain.lua', 'debug_utility.lua', 'deprecated_functions.lua', 'proc_equip.lua',
  'proc_fusion.lua', 'proc_fusion_spell.lua', 'proc_gemini.lua', 'proc_link.lua', 'proc_maximum.lua', 'proc_normal.lua',
  'proc_pendulum.lua', 'proc_persistent.lua', 'proc_ritual.lua', 'proc_rush.lua', 'proc_skill.lua', 'proc_spirit.lua',
  'proc_synchro.lua', 'proc_union.lua', 'proc_workaround.lua', 'proc_xyz.lua'];
const STRINGS_URL = 'https://raw.githubusercontent.com/mycard/ygopro-database/master/locales/ja-JP/strings.conf';
const SCRIPT_TTL = 24 * 3600 * 1000;
const OPP_FILLER = 46986414;   // 相手のデッキ（何もしない通常モンスター。ブラック・マジシャン）

const Engine = { ocg: null, lib: null, scripts: new Map(), sys: new Map(), loading: null };

// 定数（ocgcore-wasm と同じ値）
const LOC = { DECK: 1, HAND: 2, MZONE: 4, SZONE: 8, GRAVE: 16, REMOVED: 32, EXTRA: 64, OVERLAY: 128, FZONE: 256, PZONE: 512, ONFIELD_ALL: 12 };
const POS = { FU_ATK: 1, FD_ATK: 2, FU_DEF: 4, FD_DEF: 8 };
const MSG = {
  RETRY: 1, HINT: 2, WIN: 5, SELECT_BATTLECMD: 10, SELECT_IDLECMD: 11, SELECT_EFFECTYN: 12, SELECT_YESNO: 13,
  SELECT_OPTION: 14, SELECT_CARD: 15, SELECT_CHAIN: 16, SELECT_PLACE: 18, SELECT_POSITION: 19, SELECT_TRIBUTE: 20,
  SORT_CHAIN: 21, SELECT_COUNTER: 22, SELECT_SUM: 23, SELECT_DISFIELD: 24, SORT_CARD: 25, SELECT_UNSELECT_CARD: 26,
  CONFIRM_DECKTOP: 30, CONFIRM_CARDS: 31, SHUFFLE_DECK: 32, NEW_TURN: 40, NEW_PHASE: 41, MOVE: 50, POS_CHANGE: 53, SET: 54,
  SUMMONING: 60, SPSUMMONING: 62, FLIPSUMMONING: 64, CHAINING: 70, CHAIN_SOLVING: 72, CHAIN_SOLVED: 73, CHAIN_END: 74, CHAIN_NEGATED: 75,
  CHAIN_DISABLED: 76, DRAW: 90, DAMAGE: 91, RECOVER: 92, LPUPDATE: 94, PAY_LPCOST: 100, ATTACK: 110,
  TOSS_COIN: 130, TOSS_DICE: 131, ROCK_PAPER_SCISSORS: 132, ANNOUNCE_RACE: 140, ANNOUNCE_ATTRIB: 141,
  ANNOUNCE_CARD: 142, ANNOUNCE_NUMBER: 143, CARD_HINT: 160, PLAYER_HINT: 165,
};
const RES = {
  SELECT_BATTLECMD: 0, SELECT_IDLECMD: 1, SELECT_EFFECTYN: 2, SELECT_YESNO: 3, SELECT_OPTION: 4, SELECT_CARD: 5,
  SELECT_UNSELECT_CARD: 7, SELECT_CHAIN: 8, SELECT_DISFIELD: 9, SELECT_PLACE: 10, SELECT_POSITION: 11,
  SELECT_TRIBUTE: 12, SELECT_COUNTER: 13, SELECT_SUM: 14, SORT_CARD: 15, ANNOUNCE_RACE: 16, ANNOUNCE_ATTRIB: 17,
  ANNOUNCE_CARD: 18, ANNOUNCE_NUMBER: 19, ROCK_PAPER_SCISSORS: 20,
};
const IDLE = { SUMMON: 0, SPSUMMON: 1, REPOS: 2, MSET: 3, SSET: 4, ACTIVATE: 5, TO_BP: 6, TO_EP: 7 };
const BATTLE = { CHAIN: 0, ATTACK: 1, TO_M2: 2, TO_EP: 3 };
const PHASE_NAME = { 1: 'ドローフェイズ', 2: 'スタンバイフェイズ', 4: 'メインフェイズ1', 8: 'バトルフェイズ', 16: 'バトルフェイズ', 32: 'ダメージステップ', 64: 'ダメージ計算', 128: 'バトルフェイズ', 256: 'メインフェイズ2', 512: 'エンドフェイズ' };
const LOC_NAME = { 1: 'デッキ', 2: '手札', 4: 'モンスターゾーン', 8: '魔法・罠ゾーン', 16: '墓地', 32: '除外', 64: 'EXデッキ', 128: 'X素材', 256: 'フィールドゾーン', 512: 'Pゾーン' };

// ---------- 読み込み ----------
async function idbScript(name) {
  try { return await idbGet('script:' + name); } catch { return null; }
}
// スクリプトを1つ取る（ブラウザに1日保存）。無ければ null
async function fetchScript(name, path) {
  const saved = await idbScript(name);
  if (saved && Date.now() - saved.t < SCRIPT_TTL) return saved.text;
  for (const base of SCRIPT_BASES) {
    try {
      const r = await fetch(base + path);
      if (r.status === 404) break;
      if (!r.ok) continue;
      const text = await r.text();
      idbSet('script:' + name, { t: Date.now(), text }).catch(() => {});
      return text;
    } catch { /* 次の取得先へ */ }
  }
  return saved ? saved.text : null;   // 通信できないときは古いものでも使う
}

async function loadSystemStrings() {
  if (Engine.sys.size) return;
  let text = null;
  try { const s = await idbGet('ja-strings'); if (s && Date.now() - s.t < 7 * SCRIPT_TTL) text = s.text; } catch { /* 取り直す */ }
  if (!text) {
    try { const r = await fetch(STRINGS_URL); if (r.ok) { text = await r.text(); idbSet('ja-strings', { t: Date.now(), text }).catch(() => {}); } } catch { /* 無くても動く */ }
  }
  for (const line of (text || '').split(/\r?\n/)) {
    const m = line.match(/^!system (\d+) (.*)$/);
    if (m) Engine.sys.set(+m[1], m[2]);
  }
}

// エンジン本体と共通スクリプトを読み込む（2回目以降は何もしない）
function engineLoad(onStatus) {
  if (Engine.loading) return Engine.loading;
  Engine.loading = (async () => {
    onStatus && onStatus('自動処理の準備中…（ルール処理を読み込んでいます）');
    Engine.ocg = await import(ENGINE_URL);
    Engine.lib = await Engine.ocg.default({ sync: true });
    // EDOPro のカードデータ（カテゴリ番号が YGOPro と違うので、エンジンにはこちらを渡す。毎日作り直されるので日付を付けて読む）
    if (typeof EDO_CARDS === 'undefined') {
      try { await loadScript('data/edo-cards.js?d=' + new Date().toISOString().slice(0, 10)); } catch (e) { console.warn('EDOPro のカードデータを読めませんでした', e); }
    }
    // 効果の説明（選択肢の文）。EDOPro の番号順にそろえたもの
    if (typeof EDO_STRS === 'undefined') {
      try { await loadScript('data/edo-strs.js?d=' + new Date().toISOString().slice(0, 10)); } catch (e) { console.warn('効果の説明のデータを読めませんでした', e); }
    }
    onStatus && onStatus('自動処理の準備中…（共通スクリプトを読み込んでいます）');
    const texts = await Promise.all(CORE_SCRIPTS.map(n => fetchScript(n, n)));
    CORE_SCRIPTS.forEach((n, i) => { if (texts[i]) Engine.scripts.set(n, texts[i]); });
    if (!Engine.scripts.has('utility.lua')) throw new Error('共通スクリプトを読み込めませんでした');
    await loadSystemStrings();
  })();
  Engine.loading.catch(() => { Engine.loading = null; });
  return Engine.loading;
}

// ---------- エラッタ（効果の変更）前の効果 ----------
// 今のカード（パスワード）→ EDOPro の pre-errata フォルダにある「エラッタ前の効果」のスクリプト
// （レッドアイズ・ダークネスメタルドラゴンは pre-errata にあるものが今の OCG の効果なので、ここには入れない）
const ERRATA = {
  16226786: 16226796, 17412721: 17412731, 21593977: 21593987, 25862681: 25862691, 33900648: 33900658, 3784434: 3784444,
  39188539: 39188549, 5043010: 5043020, 61665245: 61665255, 63394872: 63394882, 70583986: 70583996, 71525232: 71525242,
  7563579: 7563589, 76573247: 76573257, 96782886: 96782896, 9995766: 9995776,
  95727991: 511000228, 32646477: 511000229, 8131171: 511000818, 82301904: 511000819, 17484499: 511000820, 29762407: 511000821,
  57728570: 511000822, 83555666: 511000824, 43586926: 511000868, 40737112: 511001039, 26202165: 511002631, 23265594: 511002851,
  65622692: 511002852, 64500000: 511002853, 96300057: 511002901, 16227556: 511002982, 96316857: 511002983, 10248389: 511002991,
  14878871: 511002992, 50321796: 511002993, 7391448: 511002994, 87910978: 511002995, 61740673: 511002996, 77565204: 511002997,
  47355498: 511002998, 45894482: 511003006, 21502796: 511003007, 12923641: 511003008, 15894048: 511003009, 78010363: 511003012,
  28563545: 511003018, 58996430: 511003020, 99173029: 511003021, 13955608: 511003022, 80604091: 511003023, 15800838: 511003026,
  75043725: 511003027, 80168720: 511003028, 5645210: 511003054, 67159705: 511003055, 61468779: 511003062, 22446869: 511003071,
  56570271: 511003116, 15259703: 511004007, 68540058: 511006005, 79853073: 511006006, 23995346: 511006007, 55821894: 511006010,
};
const ERRATA_MODES = { post: 'エラッタ後の効果（今の効果）', pre: 'エラッタ前の効果' };
const hasErrata = id => !!ERRATA[id];
// 対戦で使うスクリプト。errata が 'pre' なら、エラッタのあったカードは「エラッタ前」のものにする
// エラッタの設定：{ mode: 全体の設定（'pre'／'post'）, pre: エラッタ前にするカード, post: エラッタ後にするカード }
// カードごとの設定（デッキ作成で選ぶ）が全体の設定より優先。古い形（'pre'／'post' の文字）も受け付ける
function errataSpec(x) {
  if (x && typeof x === 'object') return { mode: x.mode === 'pre' ? 'pre' : 'post', pre: (x.pre || []).map(Number), post: (x.post || []).map(Number) };
  return { mode: x === 'pre' ? 'pre' : 'post', pre: [], post: [] };
}
const usePre = (spec, code) => !!ERRATA[code] && (spec.pre.includes(code) || (spec.mode === 'pre' && !spec.post.includes(code)));
// デッキ（いくつでも）の、カードごとの設定（deck.errata = { カード: 'pre'／'post' }）をまとめる。同じカードで分かれたらエラッタ前
// （2人の対戦では、同じカードの効果を人ごとに変えられないため）
function errataOfDecks(mode, ...decks) {
  const pre = new Set(), post = new Set();
  for (const d of decks) for (const [id, v] of Object.entries((d && d.errata) || {})) (v === 'pre' ? pre : post).add(+id);
  for (const id of pre) post.delete(id);
  return { mode: mode === 'pre' ? 'pre' : 'post', pre: [...pre], post: [...post] };
}
function scriptFor(name, errata) {
  const m = name.match(/^c(\d+)\.lua$/);
  if (m && usePre(errataSpec(errata), +m[1]) && Engine.scripts.get('pre:' + name)) return Engine.scripts.get('pre:' + name);
  return Engine.scripts.get(name) || null;
}

// デッキのカードのスクリプトを読み込む。スクリプト内で読み込む別スクリプトも追いかける
async function loadCardScripts(codes, onStatus, errata = 'post') {
  // エラッタ前の効果で遊ぶときは、そのカードの「エラッタ前」のスクリプトも読む（'pre:c番号.lua' に入れる）
  const spec = errataSpec(errata);
  {
    const pre = [...new Set(codes)].filter(c => usePre(spec, c) && !Engine.scripts.has(`pre:c${c}.lua`));
    await Promise.all(pre.map(async c => { const t = await fetchScript(`c${ERRATA[c]}.lua`, `pre-errata/c${ERRATA[c]}.lua`); Engine.scripts.set(`pre:c${c}.lua`, t || ''); }));
  }
  const want = [...new Set(codes)].filter(c => !Engine.scripts.has(`c${c}.lua`));
  let done = 0;
  const one = async code => {
    const name = `c${code}.lua`;
    let text = await fetchScript(name, `official/${name}`);
    if (!text) text = await fetchScript(name, `pre-release/${name}`);
    // OCG でエラッタ（効果の変更）があったカードの一部は、今の OCG 版が pre-errata フォルダにある（レッドアイズ・ダークネスメタルドラゴンなど）
    if (!text) text = await fetchScript(name, `pre-errata/${name}`);
    Engine.scripts.set(name, text || '');
    onStatus && onStatus(`カードの効果を読み込み中…（${++done}／${want.length}）`);
    // 別のスクリプトの読み込み（Duel.LoadScript / Duel.LoadCardScript）
    for (const m of (text || '').matchAll(/Duel\.Load(?:Card)?Script\(\s*"([^"]+)"/g)) {
      const n = m[1];
      if (Engine.scripts.has(n)) continue;
      const cm = n.match(/^c(\d+)\.lua$/);
      if (cm) await one(+cm[1]);
      else { Engine.scripts.set(n, ''); const t = await fetchScript(n, n); Engine.scripts.set(n, t || ''); }
    }
  };
  // 同時に取りすぎないよう 8 件ずつ
  for (let i = 0; i < want.length; i += 8) await Promise.all(want.slice(i, i + 8).map(one));
  // 効果の処理（スクリプト）が見つからなかったカードを知らせる（通常モンスターなど、効果の無いカードは除く）
  const missing = want.filter(code => {
    if (Engine.scripts.get(`c${code}.lua`)) return false;
    const c = DB.byId.get(code);
    return c && !(isMonster(c) && has(c, T.NORMAL) && !has(c, T.EFFECT)) && !isToken(c);
  });
  if (missing.length && typeof toast === 'function') {
    const names = missing.slice(0, 5).map(cardName).join('、') + (missing.length > 5 ? ` ほか${missing.length - 5}枚` : '');
    setTimeout(() => toast(`効果の処理が見つからなかったカード：${names}（このカードの効果は自動処理されません）`), 1500);
  }
}

// ---------- 表示用の文字 ----------
// ---------- 練習ツール（効果を自動処理するときの「1枚ドロー」などのボタン用） ----------
// エンジンは返答でしか進まないので、除外ゾーンに見えないカードを1枚置き、その「起動効果」としてドローなどを行う。
// こうすると「1手戻す」や保存からの再開でも、ほかの操作と同じように流し直せる。画面にはこのカードを出さない
// ---------- マスタールール（ルールだけ。禁止・制限は別） ----------
// エンジン（ocgcore）の MODE_MR1〜MODE_MR5 をそのまま使う。emz：EXモンスターゾーンがある、pzone：ペンデュラムゾーンがある（sep：魔法・罠ゾーンとは別）
const MASTER_RULES = {
  mr5: { label: 'マスタールール2020（今のルール）', short: 'MR2020', note: '2020年4月〜。EXデッキから出すリンク・ペンデュラムモンスターだけ、EXモンスターゾーンかリンク先に出します。', emz: true, pzone: true },
  mr4: { label: '新マスタールール（2017〜2020）', short: '新MR', note: '2017年3月〜2020年3月。EXデッキから出すモンスターは、すべてEXモンスターゾーンかリンク先に出します。ペンデュラムゾーンは魔法・罠ゾーンの両端です。', emz: true, pzone: true },
  mr3: { label: 'マスタールール3（2014〜2017）', short: 'MR3', note: '2014年4月〜2017年3月。EXモンスターゾーンはありません。ペンデュラムゾーンは魔法・罠ゾーンとは別（両端）です。', emz: false, pzone: true, sep: true },
  mr2: { label: 'マスタールール2（2011〜2014）', short: 'MR2', note: '2011年3月〜2014年3月。EXモンスターゾーン・ペンデュラムゾーンはありません。先攻1ターン目もドローします。', emz: false, pzone: false },
  mr1: { label: 'マスタールール（2008〜2011）', short: 'MR1', note: '2008年3月〜2011年2月。EXモンスターゾーン・ペンデュラムゾーンはありません。先攻1ターン目もドローするなど、当時の処理になります。', emz: false, pzone: false },
};

// EXモンスターゾーンの無いルール（マスタールール1〜3）にはリンクモンスターが無かったので、EXデッキに入れない（出せないようにする）
const isLinkCode = code => { const c = DB.byId.get(code); return !!(c && has(c, T.LINK)); };
const ruleExtra = (extra, rule) => (MASTER_RULES[rule] && !MASTER_RULES[rule].emz ? extra.filter(code => !isLinkCode(code)) : extra);
// 外したことを知らせる
function noteLinkRemoved(extra, rule) {
  const n = extra.length - ruleExtra(extra, rule).length;
  if (n && typeof toast === 'function') toast(`${MASTER_RULES[rule].label}にはリンクモンスターが無いので、EXデッキのリンクモンスター${n}枚は使えません（EXデッキから外して始めました）`);
}

const TOOL_CODE = 999990001;
const TOOL_LABELS = ['1枚ドロー', 'デッキから手札に加える', 'デッキから墓地へ送る', '手札をデッキに戻す', 'デッキをシャッフル'];
const TOOL_LUA = `local s,id=GetID()
function s.initial_effect(c)
	s.add(c,0,s.drtg,s.drop)
	s.add(c,1,s.decktg,s.thop)
	s.add(c,2,s.decktg,s.tgop)
	s.add(c,3,s.handtg,s.tdop)
	s.add(c,4,s.decktg,s.shop)
end
function s.add(c,n,tg,op)
	local e=Effect.CreateEffect(c)
	e:SetDescription(aux.Stringid(id,n))
	e:SetType(EFFECT_TYPE_IGNITION)
	e:SetRange(LOCATION_REMOVED)
	e:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_CANNOT_NEGATE+EFFECT_FLAG_UNCOPYABLE+EFFECT_FLAG_CANNOT_INACTIVATE)
	e:SetTarget(tg)
	e:SetOperation(op)
	c:RegisterEffect(e)
end
function s.drtg(e,tp,eg,ep,ev,re,r,rp,chk) if chk==0 then return Duel.IsPlayerCanDraw(tp,1) end end
function s.decktg(e,tp,eg,ep,ev,re,r,rp,chk) if chk==0 then return Duel.GetFieldGroupCount(tp,LOCATION_DECK,0)>0 end end
function s.handtg(e,tp,eg,ep,ev,re,r,rp,chk) if chk==0 then return Duel.GetFieldGroupCount(tp,LOCATION_HAND,0)>0 end end
function s.drop(e,tp) Duel.Draw(tp,1,REASON_RULE) end
function s.thop(e,tp)
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)
	local g=Duel.SelectMatchingCard(tp,nil,tp,LOCATION_DECK,0,1,1,nil)
	if #g>0 then Duel.SendtoHand(g,nil,REASON_RULE) Duel.ShuffleDeck(tp) end
end
function s.tgop(e,tp)
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TOGRAVE)
	local g=Duel.SelectMatchingCard(tp,nil,tp,LOCATION_DECK,0,1,1,nil)
	if #g>0 then Duel.SendtoGrave(g,REASON_RULE) Duel.ShuffleDeck(tp) end
end
function s.tdop(e,tp)
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TODECK)
	local g=Duel.SelectMatchingCard(tp,nil,tp,LOCATION_HAND,0,1,1,nil)
	if #g>0 then Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_RULE) end
end
function s.shop(e,tp) Duel.ShuffleDeck(tp) end
`;
const isToolCode = code => code === TOOL_CODE;
const cardName = code => { if (code === TOOL_CODE) return '練習ツール'; const c = DB.byId.get(code); return c ? c.name : `カード${code}`; };
function descText(desc) {
  const d = BigInt(desc || 0);
  const code = Number(d >> 20n), idx = Number(d & 0xfffffn);
  if (code === TOOL_CODE) return TOOL_LABELS[idx] || '練習ツール';
  if (code) {
    const c = DB.byId.get(code);
    // EDOPro の番号順の説明があればそれを使う（YGOPro 用の日本語の説明は番号の並びが違うことが多く、別の効果の説明になってしまう）
    const s = typeof EDO_STRS !== 'undefined' ? (EDO_STRS[code] || [])[idx] : (c && c.jaStrs && c.jaStrs[idx]);
    return s || `「${cardName(code)}」の効果${idx + 1}`;
  }
  const s = Engine.sys.get(idx) || '';
  return s.includes('%') ? '' : s;   // 「[%ls]の…」のような埋め込み前提の文は使わない
}
const placeText = (con, loc, seq) => {
  const side = con === Engine.me ? '' : '相手の';
  if (loc === LOC.MZONE) return side + (seq >= 5 ? 'EXモンスターゾーン' : `モンスターゾーン${seq + 1}`);
  if (loc === LOC.SZONE) return side + (seq === 5 ? 'フィールドゾーン' : seq === 6 ? 'ペンデュラムゾーン（左）' : seq === 7 ? 'ペンデュラムゾーン（右）' : `魔法・罠ゾーン${seq + 1}`);
  return side + (LOC_NAME[loc & ~LOC.OVERLAY] || '') + (loc & LOC.OVERLAY ? 'のX素材' : '');
};

// ---------- 1回の対戦 ----------
// main/extra：自分のデッキ（カードid）。handIds：初手に入れるカード（省略時はランダムに引く）
// opp：相手のデッキ {main, extra}（省略時は何もしない相手）。chainMode：チェーン確認（'auto' / 'always' / 'off'）
class AutoDuel {
  constructor({ main, extra, handIds, handSize = 5, seed, opp = null, chainMode = 'auto', autoTrigger = false, firstDraw = false, net = null, tools = false, rule = 'mr5', errata = 'post' }) {
    this.errata = errataSpec(errata);   // エラッタのあったカードを、エラッタ前の効果で処理するか（全体の設定とカードごとの設定）
    this.rule = MASTER_RULES[rule] ? rule : 'mr5';   // マスタールール mr1〜mr5（mr3 はペンデュラムゾーンが別＝魔法・罠ゾーンの6・7番）
    this.tools = tools && !net;   // 練習ツール（ドローなどのボタン）を使う。前に保存した盤面（ツールなし）と並びが変わらないよう、新しく始めたときだけ
    // net：対戦（2人がそれぞれ同じエンジンを動かす）。{ me: 自分の番号（0＝先攻）, decks: [[先攻のmain, extra], [後攻のmain, extra]] }
    this.net = net;
    this.firstDraw = firstDraw;   // 先攻1ターン目もドローする（昔のルールなど）
    this.autoTrigger = autoTrigger;   // オンなら、召喚・特殊召喚したカード自身の任意の効果も聞かずに発動する（強制の効果はいつも自動）
    this.main = main; this.extra = extra; this.handIds = handIds || null; this.handSize = handSize;
    this.opp = opp && opp.main && opp.main.length ? opp : null;
    this.chainMode = chainMode;
    this.me = net ? net.me : handSize === 6 ? 1 : 0;   // 後攻なら相手が先に動く
    this.seed = seed || [...crypto.getRandomValues(new Uint32Array(4))].map(BigInt);
    this.responses = [];     // これまでの返答（元に戻すときは最初からやり直して、ここを途中まで流し直す）
    this.userMarks = [];     // 自分が選んだ返答の位置
    this.labels = {};        // 自分の行動の説明（巻き戻しの一覧用）。返答の位置 → 文
  }

  create() {
    if (this.net) return this.netCreate();
    const L = Engine.lib, O = Engine.ocg;
    if (this.h) L.destroyDuel(this.h);
    this.log = []; this.pending = null; this.hint = 0; this.ended = null; this.turn = 0; this.turnPlayer = 0; this.phase = 0;
    this.lp = [8000, 8000]; this.chain = []; this.events = []; this.retries = 0; this.locks = [];
    this.justSummoned = new Set();   // 召喚・特殊召喚したばかりのカードの位置（誘発効果を自動で発動するため）
    this.justMoved = new Set();      // 直前に動いたカードの行き先（墓地へ送られた場合などの誘発を聞くため）
    this.used = new Map();   // このターンに自分が使った効果（カードid → Stringid の番号の集合。'proc'＝自分の方法での特殊召喚）
    this.rng = seededRandom(Number(BigInt(this.seed[1]) & 0xffffffffn) || 7);   // 相手の判断用（やり直しで同じになるように）
    const team = n => ({ drawCountPerTurn: 1, startingDrawCount: n, startingLP: 8000 });
    this.h = L.createDuel({
      flags: O.OcgDuelMode['MODE_' + this.rule.toUpperCase()] | (this.firstDraw ? O.OcgDuelMode.FIRST_TURN_DRAW : 0n),
      seed: this.seed,
      team1: team(this.me === 0 ? (this.handIds ? 0 : this.handSize) : this.oppDraw()),
      team2: team(this.me === 1 ? (this.handIds ? 0 : 5) : this.oppDraw()),
      cardReader: code => engineCardData(code),
      scriptReader: name => scriptFor(name, this.errata),
      errorHandler: (type, text) => { if (type === 0) console.warn('ocgcore', text); },
    });
    if (!this.h) throw new Error('対戦を作れませんでした');
    L.loadScript(this.h, 'constant.lua', Engine.scripts.get('constant.lua'));
    L.loadScript(this.h, 'utility.lua', Engine.scripts.get('utility.lua'));
    const me = this.me; Engine.me = me;
    const add = (team, code, location, position = POS.FD_ATK) =>
      L.duelNewCard(this.h, { team, duelist: 0, code, controller: team, location, sequence: 2, position });
    const rest = [...this.main];
    if (this.handIds) for (const id of this.handIds) { const i = rest.indexOf(id); if (i >= 0) { rest.splice(i, 1); add(me, id, LOC.HAND, POS.FD_ATK); } }
    // デッキはこちらで混ぜる（エンジンは混ぜない）。やり直しで同じ順になるよう seed から作る乱数を使う
    const rand = seededRandom(Number(BigInt(this.seed[0]) & 0xffffffffn) || 1);
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    for (const id of shuffle(rest)) add(me, id, LOC.DECK);
    for (const id of ruleExtra(this.extra, this.rule)) add(me, id, LOC.EXTRA);
    if (this.tools) { Engine.scripts.set(`c${TOOL_CODE}.lua`, TOOL_LUA); add(me, TOOL_CODE, LOC.REMOVED, POS.FU_ATK); }
    if (this.opp) {
      const rest = [...this.opp.main];
      // 相手の初手を指定したとき（誘発練習）：そのカードを手札に置き、残りを引く
      for (const id of this.opp.handIds || []) { const i = rest.indexOf(id); if (i >= 0) rest.splice(i, 1); add(1 - me, id, LOC.HAND); }
      for (const id of shuffle(rest)) add(1 - me, id, LOC.DECK);
      for (const id of ruleExtra(this.opp.extra || [], this.rule)) add(1 - me, id, LOC.EXTRA);
    } else {
      for (let i = 0; i < 40; i++) add(1 - me, OPP_FILLER, LOC.DECK);
    }
    L.startDuel(this.h);
  }

  // 試しに発動してみて、何か起きるか（効果が使える・サーチなどの処理がある）を調べる。
  // 今の対戦をそのまま複製して試すので、本当の盤面は変わらない。index は今の SELECT_IDLECMD の activates の番号
  probeActivate(index) {
    const t = new AutoDuel({ main: this.main, extra: this.extra, handIds: this.handIds, handSize: this.handSize, seed: this.seed, opp: this.opp, chainMode: 'off', autoTrigger: true, net: this.net, tools: this.tools, rule: this.rule, errata: this.errata });
    try {
      t.create();
      t.run(this.history());
      const p = t.pending;
      if (!p || p.type !== MSG.SELECT_IDLECMD || !p.activates[index]) return true;   // うまく試せないときは止めない
      const code = p.activates[index].code;
      const stats = () => { const q = t.query(); return [0, 1].map(pl => q[pl].m.map(c => (c && c.code ? `${c.code}:${c.attack}:${c.defense}:${c.level}` : '-')).join(',')).join('|'); };
      const before = stats();
      t.probing = code; t.probeHits = 0; t.events = [];
      t.respond({ type: RES.SELECT_IDLECMD, action: IDLE.ACTIVATE, index }, false, true);
      t.run();
      // ほかのカードが動いた（サーチ・特殊召喚など）／LPが変わった
      if (t.events.some(e => (e.t === 'move' && e.code !== code) || (e.t === 'chain' && e.code !== code) || e.t === 'summon')) return true;
      if (t.probeHits > 0) return true;
      if (t.lp[0] !== this.lp[0] || t.lp[1] !== this.lp[1]) return true;
      if (stats() !== before) return true;   // 攻撃力などが変わった（ずっと続く効果が働いた）
      // 発動したあと、そのカードの効果がすぐ使える
      const q = t.pending;
      if (q && q.type === MSG.SELECT_IDLECMD && q.activates.some(a => a.code === code)) return true;
      return false;
    } catch (e) {
      console.warn('試し発動に失敗', e);
      return true;
    } finally {
      if (t.h) Engine.lib.destroyDuel(t.h);
    }
  }

  // 対戦：両方の画面で同じになるよう、先攻（0番）→後攻（1番）の順に、同じ乱数でデッキを混ぜて並べる
  netCreate() {
    const L = Engine.lib, O = Engine.ocg;
    if (this.h) L.destroyDuel(this.h);
    this.log = []; this.pending = null; this.remoteAsk = null; this.cpuWait = null; this.leaving = 0; this.hint = 0; this.ended = null; this.turn = 0; this.turnPlayer = 0; this.phase = 0;
    this.lp = [8000, 8000]; this.chain = []; this.events = []; this.retries = 0; this.locks = [];
    this.justSummoned = new Set(); this.justMoved = new Set(); this.used = new Map();
    this.rng = seededRandom(Number(BigInt(this.seed[1]) & 0xffffffffn) || 7);
    const team = { drawCountPerTurn: 1, startingDrawCount: 5, startingLP: 8000 };
    this.h = L.createDuel({
      flags: O.OcgDuelMode['MODE_' + this.rule.toUpperCase()] | (this.firstDraw ? O.OcgDuelMode.FIRST_TURN_DRAW : 0n),
      seed: this.seed, team1: team, team2: team,
      cardReader: code => engineCardData(code),
      scriptReader: name => scriptFor(name, this.errata),
      errorHandler: (type, text) => { if (type === 0) console.warn('ocgcore', text); },
    });
    if (!this.h) throw new Error('対戦を作れませんでした');
    L.loadScript(this.h, 'constant.lua', Engine.scripts.get('constant.lua'));
    L.loadScript(this.h, 'utility.lua', Engine.scripts.get('utility.lua'));
    Engine.me = this.me;
    const rand = seededRandom(Number(BigInt(this.seed[0]) & 0xffffffffn) || 1);
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    this.net.decks.forEach(([main, extra], p) => {
      for (const code of shuffle([...main])) L.duelNewCard(this.h, { team: p, duelist: 0, code, controller: p, location: LOC.DECK, sequence: 2, position: POS.FD_ATK });
      for (const code of ruleExtra(extra, this.rule)) L.duelNewCard(this.h, { team: p, duelist: 0, code, controller: p, location: LOC.EXTRA, sequence: 2, position: POS.FD_ATK });
    });
    L.startDuel(this.h);
  }
  // 対戦：相手の画面から届いた返答を流す（相手が選ぶ番のときだけ）
  applyRemote(res) {
    if (!this.remoteAsk) return false;
    this.lastAsk = this.remoteAsk; this.remoteAsk = null;
    this.respond(res, true);
    return true;
  }

  // 止めていた CPU の行動を行って、続きを進める
  resumeCpu() {
    const res = this.cpuWait;
    if (!res) return false;
    this.cpuWait = null;
    this.respond(res, true);
    return true;
  }

  // 相手が最初に引く枚数（初手を指定したら、その分だけ減らす）
  oppDraw() { return Math.max(0, 5 - ((this.opp && this.opp.handIds) || []).length); }

  start() { this.create(); this.run(); }

  // 自分の入力が必要になるまで進める。replay：前に記録した返答（{res, user}）を順に流し直す
  run(replay) {
    const L = Engine.lib;
    for (let guard = 0; guard < 100000; guard++) {
      const status = L.duelProcess(this.h);
      const msgs = L.duelGetMessage(this.h);
      let ask = null;
      for (const m of msgs) {
        if (m.type === MSG.RETRY) { this.retry = true; if (++this.retries > 20) throw new Error('処理が先に進めなくなりました'); continue; }
        if (isSelectMsg(m)) ask = m; else this.onInfo(m);
      }
      if (status === 0 || this.ended) { this.pending = null; return; }   // 対戦終了（勝ち負けが決まったら、それ以上は進めない）
      if (status === 2) continue;
      if (!ask) continue;
      // 自分が次の行動を選ぶ時点で、召喚したばかりのカードの記録は消す（誘発の機会は終わっている）
      if (ask.player === this.me && (ask.type === MSG.SELECT_IDLECMD || ask.type === MSG.SELECT_BATTLECMD)) { this.justSummoned.clear(); this.justMoved.clear(); }
      this.lastAsk = ask;
      if (replay && replay.length) { const r = replay.shift(); this.replaying = true; try { this.respond(r.res, !r.user, true); } finally { this.replaying = false; } continue; }
      // 記録の再生：記録した返答が終わったら、そこで止める（CPU や自動の返答で先へ進めない）
      if (this.replayOnly) { this.pending = ask; return; }
      // 試し発動中（probeActivate）：自分の選択は自動で答え、意味のある選択が出たかを数える
      if (this.probing && ask.player === this.me && ask.type !== MSG.SELECT_IDLECMD && ask.type !== MSG.SELECT_BATTLECMD) {
        if (probeMeaningful(ask, this.probing)) this.probeHits++;
        this.respond(probeAnswer(ask, this.me), true, true); continue;
      }
      // 先読み用の複製：相手（CPU）の番で一度止まる（ここから候補の手を試す）
      if (this.stopAtCpu && ask.player !== this.me) { this.stopAtCpu = false; this.pending = ask; return; }
      // 対戦：相手が選ぶ番は、相手の画面から返答が届くのを待つ
      if (this.net && ask.player !== this.me) { this.pending = null; this.remoteAsk = ask; return; }
      // 相手の番の入力と、聞くまでもない確認は自動で返す
      const auto = ask.player !== this.me ? (this.opp ? cpuAnswer(ask, this) : autoAnswer(ask)) : skippable(ask, this);
      // CPU が目に見える行動（召喚・発動・攻撃など）をするときは、一度止めて画面に見せてから進める（cpuSlow のときだけ）
      if (auto && this.cpuSlow && !this.probing && ask.player !== this.me && this.opp && cpuVisible(ask, auto)) { this.cpuWait = auto; this.pending = null; return; }
      if (auto) { this.respond(auto, true, true); continue; }
      this.pending = ask;
      return;
    }
  }

  markUsed(code, key) { if (!this.used.has(code)) this.used.set(code, new Set()); this.used.get(code).add(key); }

  respond(res, auto, inner) {
    // フェイズを進める返答：次のフェイズになるまで「今のフェイズを終わろうとしている」と覚えておく（チェーンの確認で使う）
    if ((res.type === RES.SELECT_IDLECMD && (res.action === IDLE.TO_BP || res.action === IDLE.TO_EP)) || (res.type === RES.SELECT_BATTLECMD && (res.action === BATTLE.TO_M2 || res.action === BATTLE.TO_EP))) this.leaving = this.phase;
    // 手札などから自分の方法で特殊召喚するとき（「①の方法による特殊召喚は1ターンに1度」の記録用）
    const src = this.pending || this.lastAsk;
    if (!auto && res.type === RES.SELECT_IDLECMD && res.action === IDLE.SPSUMMON && src && src.special_summons) { const c = src.special_summons[res.index]; this.procCode = c && c.location !== LOC.EXTRA ? c.code : 0; }
    if (!auto && (res.type === RES.SELECT_IDLECMD || res.type === RES.SELECT_BATTLECMD)) this.labels[this.responses.length] = describeAction(res, src, this);
    if (!auto) this.userMarks.push(this.responses.length);
    this.responses.push(res);
    // 対戦：自分が選ぶ番の返答は、相手の画面にも送る（流し直し中は送らない）
    if (this.net && this.onSend && !this.replaying && src && src.player === this.me) this.onSend(res, this.responses.length - 1);
    this.retry = false;
    if (!auto) this.retries = 0;
    Engine.lib.duelSetResponse(this.h, res);
    if (!inner) { this.pending = null; this.run(); }
  }

  // これまでの返答（自分が選んだものかどうか付き）
  history(upto = this.responses.length) {
    const mine = new Set(this.userMarks);
    return this.responses.slice(0, upto).map((res, i) => ({ res, user: mine.has(i) }));
  }

  // 自分の操作を1つ戻す（最後に「召喚する」「発動する」などを選ぶ前まで）。最初から返答を流し直す
  undo() {
    const acts = this.actions();
    if (!acts.length) return false;
    return this.rewindTo(acts[acts.length - 1].at);
  }

  // これまでの自分の行動（召喚・発動・フェイズ移動など）の一覧。at＝その行動の返答の位置
  actions() {
    const isAction = r => r.type === RES.SELECT_IDLECMD || r.type === RES.SELECT_BATTLECMD;
    return this.userMarks.filter(i => isAction(this.responses[i])).map(i => ({ at: i, label: this.labels[i] || '操作' }));
  }

  // 巻き戻し：指定した行動の直前の状態に戻す（最初から返答を流し直す）
  rewindTo(at) {
    const items = this.history(at);
    this.responses = []; this.userMarks = []; this.labels = {};
    this.create();
    this.run(items);
    return true;
  }
  restart() { this.responses = []; this.userMarks = []; this.labels = {}; this.start(); }

  addLog(text) { this.log.push(`[T${this.turn || 1}] ${text}`); }
  who(con) { return con === this.me ? '' : '相手の'; }

  onInfo(m) {
    switch (m.type) {
      case MSG.HINT: if (m.hint_type === 3 && m.player === this.me) this.hint = m.hint; break;
      case MSG.NEW_TURN: this.used = new Map(); this.turn++; this.turnPlayer = m.player; this.addLog(`---- ${m.player === this.me ? '自分' : '相手'}のターン ----`); this.events.push({ t: 'turn', player: m.player, turn: this.turn }); break;
      case MSG.NEW_PHASE: this.phase = m.phase; if (this.turnPlayer === this.me) this.addLog(PHASE_NAME[m.phase] || 'フェイズ'); this.leaving = 0; this.events.push({ t: 'phase', phase: m.phase, player: this.turnPlayer, turn: this.turn }); break;
      case MSG.DRAW: if (m.player === this.me) this.addLog(`ドロー：${m.drawn.map(d => cardName(d.code & 0x7fffffff)).join('、')}`); break;
      case MSG.SUMMONING: this.justSummoned.add(locKey(m.controller, m.location, m.sequence)); this.addLog(`${this.who(m.controller)}${cardName(m.code)} を通常召喚`); this.events.push({ t: 'summon', code: m.code, con: m.controller, loc: m.location, seq: m.sequence }); break;
      case MSG.SPSUMMONING: if (this.procCode === m.code && !this.chain.length) { this.markUsed(m.code, 'proc'); this.procCode = 0; } this.justSummoned.add(locKey(m.controller, m.location, m.sequence)); this.addLog(`${this.who(m.controller)}${cardName(m.code)} を特殊召喚`); this.events.push({ t: 'summon', code: m.code, con: m.controller, loc: m.location, seq: m.sequence }); break;
      case MSG.FLIPSUMMONING: this.justSummoned.add(locKey(m.controller, m.location, m.sequence)); this.addLog(`${this.who(m.controller)}${cardName(m.code)} を反転召喚`); break;
      case MSG.CHAINING: {
        const link = { code: m.code, con: m.controller, loc: m.location, seq: m.sequence, desc: descText(m.description), n: m.chain_size };
        if (m.code === TOOL_CODE) { this.chain.push(link); this.addLog(`練習の操作：${link.desc}`); break; }   // 練習ツール：演出やチェーンの表示には出さない
        this.chain.push(link); this.events.push({ t: 'chain', ...link });
        if (m.controller === this.me) { const dc = Number(BigInt(m.description || 0) >> 20n); this.markUsed(m.code, dc && (dc === m.code || dc === (DB.byId.get(m.code) || {}).alias) ? Number(BigInt(m.description) & 0xfffffn) : '?'); }
        this.addLog(`チェーン${m.chain_size}：${this.who(m.controller)}${cardName(m.code)} の効果を発動（${link.desc || '効果'}）`); break;
      }
      case MSG.CHAIN_SOLVING: this.solving = m.chain_size; break;   // チェーンの解決中（何番目を解決しているか）
      case MSG.CHAIN_SOLVED: this.chain.pop(); break;
      case MSG.CHAIN_END: this.chain = []; this.solving = 0; break;
      case MSG.CHAIN_NEGATED: case MSG.CHAIN_DISABLED: {
        // 無効になったチェーン（演出用に、どのカードかを残す）
        const link = this.chain.find(l => l.n === m.chain_size) || this.chain[this.chain.length - 1];
        if (link) this.events.push({ t: 'negate', code: link.code, con: link.con, loc: link.loc, seq: link.seq, what: m.type === MSG.CHAIN_NEGATED ? '発動を無効' : '効果を無効' });
        this.addLog(link ? `${this.who(link.con)}${cardName(link.code)} の${m.type === MSG.CHAIN_NEGATED ? '発動' : '効果'}が無効になった` : 'チェーンの効果が無効になった'); break;
      }
      case MSG.ATTACK: {
        const a = m.card, tg = m.target;
        this.events.push({ t: 'attack', from: { con: a.controller, loc: a.location, seq: a.sequence }, to: tg ? { con: tg.controller, loc: tg.location, seq: tg.sequence } : null, con: a.controller });
        break;
      }
      case MSG.MOVE: {
        const code = m.card;
        if (!code || m.from.location === m.to.location && m.from.controller === m.to.controller) break;
        if (m.from.controller !== this.me && m.to.controller !== this.me && !(m.from.location & LOC.ONFIELD_ALL) && !(m.to.location & LOC.ONFIELD_ALL)) break;   // 相手の手札・デッキ・墓地の間の移動（手札調整など）は省く
        if (m.to.location === LOC.HAND && m.from.location === LOC.DECK && m.from.controller === this.me && this.drawing) break;
        this.justMoved.add(locKey(m.to.controller, m.to.location, m.to.sequence));
        this.justMoved.add(`${m.to.controller}-${m.to.location}-c${code}`);   // 手札などは位置の番号がずれるので、カードの種類でも覚える
        this.events.push({ t: 'move', code, from: { con: m.from.controller, loc: m.from.location, seq: m.from.sequence }, to: { con: m.to.controller, loc: m.to.location, seq: m.to.sequence }, faceUp: !!(m.to.position & 5) });
        const secret = m.to.controller !== this.me && !(m.to.position & 5) && (m.to.location & (LOC.ONFIELD_ALL | LOC.HAND | LOC.DECK));   // 相手が裏向きにしたカードは名前を伏せる
        this.addLog(`${secret ? 'カード' : cardName(code)}：${placeText(m.from.controller, m.from.location, m.from.sequence)} → ${placeText(m.to.controller, m.to.location, m.to.sequence)}`);
        break;
      }
      case MSG.DAMAGE: this.addLog(`${m.player === this.me ? '自分' : '相手'}に ${m.amount} ダメージ`); this.events.push({ t: 'damage', player: m.player, amount: m.amount }); break;
      case MSG.RECOVER: this.addLog(`${m.player === this.me ? '自分' : '相手'}が ${m.amount} 回復`); break;
      case MSG.PAY_LPCOST: this.addLog(`${m.player === this.me ? '自分' : '相手'}が ${m.amount} LPを払った`); break;
      case MSG.LPUPDATE: this.lp[m.player] = Math.max(0, m.lp); break;
      case MSG.PLAYER_HINT: {
        // 「このターン、〇〇しか特殊召喚できない」などの制限（縛り）が付いた・外れた
        if (m.player !== this.me) break;
        const code = Number(BigInt(m.description) >> 20n);
        const text = (code ? `「${cardName(code)}」：` : '') + (descText(m.description) || '効果による制限');
        if (m.player_hint === 6) { this.locks.push({ desc: String(m.description), text }); this.addLog('制限が付いた ' + text); }
        else if (m.player_hint === 7) { const i = this.locks.findIndex(l => l.desc === String(m.description)); if (i >= 0) this.locks.splice(i, 1); }
        break;
      }
      // カードを見せる・確認する（相手の手札を確認する、手札のカードを見せる、デッキの上を確認する など）。m.player が見る人
      case MSG.CONFIRM_CARDS: case MSG.CONFIRM_DECKTOP:
        if (m.cards.length) {
          this.addLog(`${m.player === this.me ? '' : '相手が'}確認：${m.cards.map(c => cardName(c.code)).join('、')}`);
          this.events.push({ t: 'confirm', player: m.player, top: m.type === MSG.CONFIRM_DECKTOP, cards: m.cards.map(c => ({ code: c.code, con: c.controller, loc: c.location, seq: c.sequence })) });
        }
        break;
      case MSG.TOSS_COIN: this.addLog(`コイン：${m.results.map(r => (r ? '表' : '裏')).join('・')}`); break;
      case MSG.TOSS_DICE: this.addLog(`サイコロ：${m.results.join('・')}`); break;
      case MSG.WIN: {
        const why = { 1: 'ライフが0', 2: 'デッキ切れ（ドローできない）', 3: '時間切れ' }[m.reason] || '';
        this.endReason = why;
        this.ended = (m.player === this.me ? '自分の勝ち' : '相手の勝ち') + (why ? '・' + why : '');
        this.addLog(`対戦終了（${this.ended}）`); break;
      }
      default: break;
    }
    if (m.type === MSG.DAMAGE || m.type === MSG.RECOVER || m.type === MSG.PAY_LPCOST) {
      // ライフは0より下にしない（0以下になったら0）
      this.lp[m.player] = Math.max(0, this.lp[m.player] + (m.type === MSG.RECOVER ? m.amount : -m.amount));
    }
  }

  // 盤面を読み取る
  query() {
    const L = Engine.lib;
    const F = Engine.ocg.OcgQueryFlags;
    const flags = F.CODE | F.POSITION | F.LEVEL | F.RANK | F.ATTACK | F.DEFENSE | F.OVERLAY_CARD | F.COUNTERS | F.LINK | F.IS_PUBLIC;
    const out = {};
    for (const p of [0, 1]) {
      out[p] = {};
      for (const [k, loc] of [['hand', LOC.HAND], ['m', LOC.MZONE], ['s', LOC.SZONE], ['gy', LOC.GRAVE], ['ban', LOC.REMOVED], ['extra', LOC.EXTRA], ['deck', LOC.DECK]]) {
        out[p][k] = L.duelQueryLocation(this.h, { flags, controller: p, location: loc });
      }
    }
    return out;
  }
}

// カードの情報（ocgcore 用）
function engineCardData(code) {
  if (code === TOOL_CODE) return { code, alias: 0, setcodes: [], type: 0x2, level: 0, attribute: 0, race: 0n, attack: 0, defense: 0, lscale: 0, rscale: 0, link_marker: 0 };   // 練習ツール（魔法カードとして扱う）
  const e = typeof EDO_CARDS !== 'undefined' && EDO_CARDS.d[code];
  if (e) {
    const [alias, setcodes, type, lv, race, attribute, atk, def] = e;
    const link = (type & T.LINK) !== 0;
    return {
      code, alias, setcodes: setcodes || [], type, level: lv & 0xff, attribute, race: BigInt(race),
      attack: atk, defense: link ? 0 : def, lscale: (lv >>> 24) & 0xff, rscale: (lv >>> 16) & 0xff, link_marker: link ? def : 0,
    };
  }
  // EDOPro のデータに無いカード（ごく新しいカードなど）は、アプリのカードデータで代用する（カテゴリ番号は合わないことがある）
  const c = DB.byId.get(code);
  if (!c) return null;
  const setcodes = [];
  for (let s = c.setcode || 0; s > 0; s = Math.floor(s / 65536)) setcodes.push(s % 65536);
  const link = has(c, T.LINK);
  return {
    code, alias: c.alias || 0, setcodes, type: c.type, level: c.level, attribute: c.attr, race: BigInt(c.race),
    attack: c.atk, defense: link ? 0 : c.def, lscale: c.ls || 0, rscale: c.rs || 0, link_marker: link ? c.def : 0,
  };
}

const SELECT_TYPES = new Set([MSG.SELECT_BATTLECMD, MSG.SELECT_IDLECMD, MSG.SELECT_EFFECTYN, MSG.SELECT_YESNO, MSG.SELECT_OPTION,
  MSG.SELECT_CARD, MSG.SELECT_CHAIN, MSG.SELECT_PLACE, MSG.SELECT_POSITION, MSG.SELECT_TRIBUTE, MSG.SORT_CHAIN, MSG.SELECT_COUNTER,
  MSG.SELECT_SUM, MSG.SELECT_DISFIELD, MSG.SORT_CARD, MSG.SELECT_UNSELECT_CARD, MSG.ROCK_PAPER_SCISSORS, MSG.ANNOUNCE_RACE,
  MSG.ANNOUNCE_ATTRIB, MSG.ANNOUNCE_CARD, MSG.ANNOUNCE_NUMBER]);
const isSelectMsg = m => SELECT_TYPES.has(m.type);

// 自分の入力でも、聞くまでもないもの（発動できるものが無いチェーン確認・並び替え）は自動で返す
// チェーン確認（マスターデュエルと同じ考え方）
//   always（オン）：召喚・発動などすべての行動のあと、発動できるものがあれば聞く
//   auto（自動）：効果が発動したときに、それに対して発動できるものがあれば聞く（召喚・移動したカードの誘発も聞く）
//   off（オフ）：チェーンの確認はしない（必ず答える場面と、自分のカードの誘発効果だけ聞く）
const locKey = (con, loc, seq) => `${con}-${loc}-${seq}`;

function skippable(m, duel) {
  // 召喚・特殊召喚したカード自身の「召喚・特殊召喚した場合」の効果は、聞かずに発動する（対象などは自分で選ぶ）
  if (duel && duel.autoTrigger && duel.justSummoned.size) {
    const fresh = c => duel.justSummoned.has(locKey(c.controller, c.location, c.sequence));
    if (m.type === MSG.SELECT_EFFECTYN && fresh(m)) return { type: RES.SELECT_EFFECTYN, yes: true };
    if (m.type === MSG.SELECT_CHAIN && !m.forced && m.spe_count > 0 && m.selects.length && m.selects.every(fresh)) return { type: RES.SELECT_CHAIN, index: 0 };
  }
  if (m.type === MSG.SELECT_CHAIN && !m.forced) {
    if (!m.selects.length) return { type: RES.SELECT_CHAIN, index: null };
    if (duel && duel.chain.length && duel.chain[duel.chain.length - 1].code === TOOL_CODE) return { type: RES.SELECT_CHAIN, index: null };   // 練習ツールには聞かない
    const mode = duel ? duel.chainMode : 'always';
    const last = duel && duel.chain[duel.chain.length - 1];
    // 召喚したばかり・動いたばかりの自分のカードの誘発効果（「〜した場合に発動できる」）は、チェーン確認の設定に関係なく聞く
    const freshTrigger = !!duel && !last && m.selects.some(c => duel.justSummoned.has(locKey(c.controller, c.location, c.sequence)) || duel.justMoved.has(locKey(c.controller, c.location, c.sequence)) || duel.justMoved.has(`${c.controller}-${c.location}-c${c.code}`));
    let ask = mode === 'always' || freshTrigger;
    if (mode === 'auto' && last) {
      // 効果が発動したときだけ聞く（相手の発動、または自分の発動に自分で重ねられるとき）
      ask = last.con !== duel.me || !m.selects.every(c => c.location === LOC.HAND && isHandTrap(c.code));
    }
    if (!ask) return { type: RES.SELECT_CHAIN, index: null };
  }
  if (m.type === MSG.SORT_CHAIN) return { type: RES.SORT_CARD, order: null };
  if (m.type === MSG.ROCK_PAPER_SCISSORS) return { type: RES.ROCK_PAPER_SCISSORS, value: 1 + Math.floor(Math.random() * 3) };
  return null;
}

// 決まった種から作る乱数（やり直しても同じ結果になる）
function seededRandom(seed) {
  let r = seed | 0;
  return () => { r = (r + 0x6D2B79F5) | 0; let t = Math.imul(r ^ (r >>> 15), 1 | r); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// 相手（CPU）の返答。妨害（手札誘発・伏せカード）は使えるときに使い、自分のターンは簡単に動く
// 「デッキで対戦」の相手（CPU）：自分のターンにデッキを回す。
// 発動できる効果 → 特殊召喚 → 通常召喚 → 罠を伏せる → 攻撃できるならバトル → 終わり の順に試す。
// 同じ効果を何度も繰り返さないよう、1ターンの回数に上限をつける
function cpuPlayIdle(m, duel) {
  if (!duel.noThink && !duel.probing) { const best = cpuThink(m, duel, 'idle'); if (best) return best; }
  const t = duel.cpuTurn && duel.cpuTurn.turn === duel.turn ? duel.cpuTurn : (duel.cpuTurn = { turn: duel.turn, n: 0, count: new Map(), bp: false });
  const key = (kind, c) => kind + ':' + c.code + ':' + (c.description || '');
  const tryList = (list, kind, action, max) => {
    for (let i = 0; i < (list || []).length; i++) {
      const k = key(kind, list[i]);
      if ((t.count.get(k) || 0) >= max) continue;
      t.count.set(k, (t.count.get(k) || 0) + 1); t.n++;
      return { type: RES.SELECT_IDLECMD, action, index: i };
    }
    return null;
  };
  if (t.n < 25) {
    // 手札誘発は自分のターンには使わない（相手の行動への妨害用に残す）
    const acts = (m.activates || []).map((c, i) => ({ c, i })).filter(({ c }) => !(c.location === LOC.HAND && isHandTrap(c.code)));
    for (const { c, i } of acts) {
      const k = key('a', c);
      if ((t.count.get(k) || 0) >= 2) continue;
      t.count.set(k, (t.count.get(k) || 0) + 1); t.n++;
      return { type: RES.SELECT_IDLECMD, action: IDLE.ACTIVATE, index: i };
    }
    const sp = tryList(m.special_summons, 's', IDLE.SPSUMMON, 2);
    if (sp) return sp;
    if (m.summons.length) {
      let best = 0;
      m.summons.forEach((c, i) => { if ((DB.byId.get(c.code) || {}).atk > (DB.byId.get(m.summons[best].code) || {}).atk) best = i; });
      t.n++;
      return { type: RES.SELECT_IDLECMD, action: IDLE.SUMMON, index: best };
    }
    const traps = (m.spell_sets || []).map((c, i) => ({ c, i })).filter(({ c }) => { const d = DB.byId.get(c.code); return d && (has(d, T.TRAP) || has(d, T.QUICKPLAY)); });
    if (traps.length) { t.n++; return { type: RES.SELECT_IDLECMD, action: IDLE.SSET, index: traps[0].i }; }
  }
  // 攻撃できるモンスターがいればバトルフェイズへ（1ターンに1回）
  if (m.to_bp && !t.bp && duel.turn > 1) { t.bp = true; return { type: RES.SELECT_IDLECMD, action: IDLE.TO_BP, index: null }; }
  return { type: RES.SELECT_IDLECMD, action: m.to_ep ? IDLE.TO_EP : IDLE.TO_BP, index: null };
}
// 「デッキで対戦」の相手：バトルフェイズでは、攻撃できるモンスターで順に攻撃する
function cpuPlayBattle(m, duel) {
  if (duel && !duel.noThink && !duel.probing) { const best = cpuThink(m, duel, 'battle'); if (best) return best; }
  if (m.attacks && m.attacks.length) return { type: RES.SELECT_BATTLECMD, action: BATTLE.ATTACK, index: 0 };
  return { type: RES.SELECT_BATTLECMD, action: m.to_m2 ? BATTLE.TO_M2 : BATTLE.TO_EP, index: null };
}

function cpuAnswer(m, duel) {
  const me = duel.me;            // 練習する人（CPU から見た相手）
  const rnd = duel.rng;
  const theirs = c => c.controller === me;
  // 選ぶカード：相手（練習する人）のフィールドのカードを優先
  const prefer = list => {
    const idx = list.map((c, i) => i);
    // 自分のカードを選ぶ（サーチなど）ときは、手札にまだ無いカード・攻撃力の高いモンスターを優先する
    let inHand = null;
    const fresh = c => { if (!inHand) { try { inHand = new Set(duel.query()[1 - me].hand.filter(x => x && x.code).map(x => x.code)); } catch { inHand = new Set(); } } return !inHand.has(c.code); };
    const score = c => (theirs(c) ? 10 : 0) + (c.location & LOC.ONFIELD_ALL ? 5 : 0) + (!theirs(c) && c.location & (LOC.DECK | LOC.GRAVE | LOC.REMOVED) && fresh(c) ? 2 : 0) + ((DB.byId.get(c.code) || {}).atk || 0) / 10000;
    return idx.sort((a, b) => score(list[b]) - score(list[a]));
  };
  switch (m.type) {
    case MSG.SELECT_IDLECMD: {
      if (duel.opp && duel.opp.plays) return cpuPlayIdle(m, duel);
      // 罠などを伏せる → 一番攻撃力の高いモンスターを召喚 → 終わり
      const traps = m.spell_sets.filter(c => { const d = DB.byId.get(c.code); return d && has(d, T.TRAP); });
      if (traps.length) return { type: RES.SELECT_IDLECMD, action: IDLE.SSET, index: m.spell_sets.indexOf(traps[0]) };
      if (m.summons.length) {
        let best = 0;
        m.summons.forEach((c, i) => { if ((DB.byId.get(c.code) || {}).atk > (DB.byId.get(m.summons[best].code) || {}).atk) best = i; });
        return { type: RES.SELECT_IDLECMD, action: IDLE.SUMMON, index: best };
      }
      return { type: RES.SELECT_IDLECMD, action: m.to_ep ? IDLE.TO_EP : IDLE.TO_BP, index: null };
    }
    case MSG.SELECT_CHAIN:
      // 練習ツール（ドローなどのボタン）には何もしない
      if (!m.forced && duel.chain.length && duel.chain[duel.chain.length - 1].code === TOOL_CODE) return { type: RES.SELECT_CHAIN, index: null };
      if (!m.selects.length) return { type: RES.SELECT_CHAIN, index: null };
      // 先読み：発動する／しない、どれを発動するかを試して、いちばん得になるものを選ぶ（先読みの中では簡単に決める）
      if (!duel.noThink && !duel.probing) { const best = cpuChainThink(m, duel); if (best) return best; }
      if (m.forced) return { type: RES.SELECT_CHAIN, index: 0 };
      if (duel.noThink) return { type: RES.SELECT_CHAIN, index: null };   // 先読みの中では温存する（読みがぶれないように）
      // 先読みできないとき：相手（練習する人）が発動したものへの妨害としてだけ使う
      if (duel.chain.length && duel.chain[duel.chain.length - 1].con === me) return { type: RES.SELECT_CHAIN, index: Math.floor(rnd() * m.selects.length) };
      return { type: RES.SELECT_CHAIN, index: null };
    case MSG.SELECT_BATTLECMD: if (duel.opp && duel.opp.plays) return cpuPlayBattle(m, duel); return autoAnswer(m);
    case MSG.SELECT_EFFECTYN: return { type: RES.SELECT_EFFECTYN, yes: true };
    case MSG.SELECT_YESNO: return { type: RES.SELECT_YESNO, yes: true };
    case MSG.SELECT_CARD: return { type: RES.SELECT_CARD, indicies: prefer(m.selects).slice(0, m.min).sort((a, b) => a - b) };
    case MSG.SELECT_TRIBUTE: return { type: RES.SELECT_TRIBUTE, indicies: [...Array(m.min).keys()] };
    case MSG.SELECT_UNSELECT_CARD: {
      if (m.can_finish || !m.select_cards.length) return { type: RES.SELECT_UNSELECT_CARD, index: null };
      return { type: RES.SELECT_UNSELECT_CARD, index: prefer(m.select_cards)[0] };
    }
    case MSG.SELECT_POSITION: return { type: RES.SELECT_POSITION, position: cpuPosition(m, duel) };
    case MSG.SELECT_OPTION: return { type: RES.SELECT_OPTION, index: Math.floor(rnd() * m.options.length) };
    case MSG.ANNOUNCE_CARD: { const hit = [...duel.main, ...DB.cards.map(c => c.id)].find(id => Engine.ocg.cardMatchesOpcode(engineCardData(id), m.opcodes)); return { type: RES.ANNOUNCE_CARD, card: hit || duel.main[0] }; }
    default: return autoAnswer(m);
  }
}

// 相手（何もしない）の返答
function autoAnswer(m) {
  switch (m.type) {
    case MSG.SELECT_IDLECMD: return { type: RES.SELECT_IDLECMD, action: m.to_ep ? IDLE.TO_EP : IDLE.TO_BP, index: null };
    case MSG.SELECT_BATTLECMD: return { type: RES.SELECT_BATTLECMD, action: m.to_ep ? BATTLE.TO_EP : BATTLE.TO_M2, index: null };
    case MSG.SELECT_CHAIN: return { type: RES.SELECT_CHAIN, index: m.forced ? 0 : null };
    case MSG.SELECT_EFFECTYN: return { type: RES.SELECT_EFFECTYN, yes: false };
    case MSG.SELECT_YESNO: return { type: RES.SELECT_YESNO, yes: false };
    case MSG.SELECT_OPTION: return { type: RES.SELECT_OPTION, index: 0 };
    case MSG.SELECT_CARD: return { type: RES.SELECT_CARD, indicies: [...Array(m.min).keys()] };
    case MSG.SELECT_TRIBUTE: return { type: RES.SELECT_TRIBUTE, indicies: [...Array(m.min).keys()] };
    case MSG.SELECT_UNSELECT_CARD: return { type: RES.SELECT_UNSELECT_CARD, index: m.can_finish || !m.select_cards.length ? null : 0 };
    case MSG.SELECT_POSITION: return { type: RES.SELECT_POSITION, position: [1, 2, 4, 8].find(p => m.positions & p) };
    case MSG.SELECT_PLACE: return { type: RES.SELECT_PLACE, places: placeOrder(freePlaces(m.field_mask, m.player), m.player).slice(0, m.count) };
    case MSG.SELECT_DISFIELD: return { type: RES.SELECT_DISFIELD, places: freePlaces(m.field_mask, m.player).slice(0, m.count) };
    case MSG.SELECT_SUM: return { type: RES.SELECT_SUM, indicies: [...Array(Math.max(m.min, 1)).keys()] };
    case MSG.SORT_CARD: case MSG.SORT_CHAIN: return { type: RES.SORT_CARD, order: null };
    case MSG.SELECT_COUNTER: return { type: RES.SELECT_COUNTER, counters: m.cards.map((c, i) => (i === 0 ? m.count : 0)) };
    case MSG.ANNOUNCE_NUMBER: return { type: RES.ANNOUNCE_NUMBER, value: 0 };
    default: return skippable(m);
  }
}

// 自動で置く場所を決めるときの順番：真ん中から外へ（「中央のゾーンに召喚した場合」の効果を使えるように）
const PLACE_PREF = [2, 1, 3, 0, 4, 5, 6, 7];
function placeOrder(places, player) {
  const rank = p => (p.player === player ? 0 : 100) + (p.location === LOC.MZONE ? 0 : 10) + PLACE_PREF.indexOf(p.sequence);
  return places.slice().sort((a, b) => rank(a) - rank(b));
}

// field_mask（1＝選べない）から選べる場所の一覧。自分から見た向き（下位16ビットが自分）
function freePlaces(mask, player) {
  const out = [];
  for (const [base, owner] of [[0, player], [16, 1 - player]]) {
    for (let i = 0; i < 7; i++) if (!(mask & (1 << (base + i)))) out.push({ player: owner, location: LOC.MZONE, sequence: i });
    for (let i = 0; i < 8; i++) if (!(mask & (1 << (base + 8 + i)))) out.push({ player: owner, location: LOC.SZONE, sequence: i });
  }
  return out;
}

// 手札誘発（自分のターンに何も起きていないときは、発動するか聞かない）。autoplay.js の一覧から作る
let handTrapIds = null;
function isHandTrap(code) {
  if (!handTrapIds) {
    handTrapIds = new Set(typeof HANDTRAP_SET !== 'undefined' ? HANDTRAP_SET.map(([id]) => id) : []);
    if (typeof HANDTRAP_NAMES !== 'undefined') for (const n of HANDTRAP_NAMES) { const c = DB.cards.find(x => x.name === n); if (c) handTrapIds.add(c.id); }
  }
  const c = DB.byId.get(code);
  return handTrapIds.has(code) || (c && c.alias && handTrapIds.has(c.alias));
}

// 試し発動の中で出た選択が「効果で何かを選ぶ」ものか（置く場所・表示形式・チェーン確認は数えない）
function probeMeaningful(m, code) {
  switch (m.type) {
    case MSG.SELECT_CARD: case MSG.SELECT_UNSELECT_CARD: case MSG.SELECT_SUM: case MSG.SELECT_TRIBUTE:
    case MSG.SELECT_YESNO: case MSG.SELECT_OPTION: case MSG.ANNOUNCE_CARD: case MSG.ANNOUNCE_NUMBER:
    case MSG.ANNOUNCE_RACE: case MSG.ANNOUNCE_ATTRIB: case MSG.SELECT_COUNTER:
      return true;
    case MSG.SELECT_EFFECTYN: return m.code === code;
    default: return false;
  }
}
// 試し発動の中での自分の答え（できるだけ効果を使う方へ）
function probeAnswer(m, me) {
  switch (m.type) {
    case MSG.SELECT_YESNO: return { type: RES.SELECT_YESNO, yes: true };
    case MSG.SELECT_EFFECTYN: return { type: RES.SELECT_EFFECTYN, yes: true };
    case MSG.SELECT_CHAIN: return { type: RES.SELECT_CHAIN, index: m.forced ? 0 : null };
    case MSG.SELECT_PLACE: return { type: RES.SELECT_PLACE, places: placeOrder(freePlaces(m.field_mask, me), me).slice(0, m.count) };
    case MSG.SELECT_DISFIELD: return { type: RES.SELECT_DISFIELD, places: freePlaces(m.field_mask, me).slice(0, m.count) };
    default: return autoAnswer(m);
  }
}

// 行動の説明（巻き戻しの一覧に出す文）
function describeAction(res, src, duel) {
  const t = `T${duel.turn || 1}`;
  const nameOf = list => { const c = src && list && list[res.index]; return c ? cardName(c.code) : ''; };
  if (res.type === RES.SELECT_IDLECMD) {
    switch (res.action) {
      case IDLE.SUMMON: return `${t} ${nameOf(src.summons)} を通常召喚`;
      case IDLE.SPSUMMON: { const c = src && src.special_summons && src.special_summons[res.index]; return `${t} ${nameOf(src.special_summons)} を${c && typeof summonLabel === 'function' ? summonLabel(c) : '特殊召喚'}`; }
      case IDLE.MSET: return `${t} ${nameOf(src.monster_sets)} をセット`;
      case IDLE.SSET: return `${t} ${nameOf(src.spell_sets)} をセット`;
      case IDLE.REPOS: return `${t} ${nameOf(src.pos_changes)} の表示形式を変更`;
      case IDLE.ACTIVATE: return `${t} ${nameOf(src.activates)} の効果を発動`;
      case IDLE.TO_BP: return `${t} バトルフェイズへ`;
      case IDLE.TO_EP: return `${t} ターン終了`;
    }
  } else if (res.type === RES.SELECT_BATTLECMD) {
    switch (res.action) {
      case BATTLE.CHAIN: return `${t} ${nameOf(src.chains)} の効果を発動`;
      case BATTLE.ATTACK: return `${t} ${nameOf(src.attacks)} で攻撃`;
      case BATTLE.TO_M2: return `${t} メインフェイズ2へ`;
      case BATTLE.TO_EP: return `${t} ターン終了`;
    }
  }
  return `${t} 操作`;
}

// ---------- 「デッキで対戦」の相手の先読み ----------
// 今できる手を1つずつ、裏で複製した対戦で試す（そのあとのターンの残りは簡単な動きで進める）。
// 進めたあとの盤面を点数にして、一番よくなる手を選ぶ。どの手も今より良くならなければ null（簡単な動きに任せる）
// 今の場面で打てる手の一覧
function cpuCandidates(m, kind) {
  const cands = [];
  const desc = (list, i) => ({ code: list[i].code, loc: list[i].location, d: String(list[i].description || '') });
  if (kind === 'idle') {
    (m.activates || []).forEach((c, i) => { if (!(c.location === LOC.HAND && isHandTrap(c.code))) cands.push({ res: { type: RES.SELECT_IDLECMD, action: IDLE.ACTIVATE, index: i }, id: { list: 'activates', ...desc(m.activates, i) } }); });
    (m.special_summons || []).forEach((c, i) => cands.push({ res: { type: RES.SELECT_IDLECMD, action: IDLE.SPSUMMON, index: i }, id: { list: 'special_summons', ...desc(m.special_summons, i) } }));
    (m.summons || []).forEach((c, i) => cands.push({ res: { type: RES.SELECT_IDLECMD, action: IDLE.SUMMON, index: i }, id: { list: 'summons', ...desc(m.summons, i) } }));
    // 伏せるのは罠と速攻魔法だけ（通常魔法などを伏せても意味がない）
    (m.spell_sets || []).forEach((c, i) => { const d = DB.byId.get(c.code); if (d && (has(d, T.TRAP) || has(d, T.QUICKPLAY))) cands.push({ res: { type: RES.SELECT_IDLECMD, action: IDLE.SSET, index: i }, id: { list: 'spell_sets', ...desc(m.spell_sets, i) } }); });
  } else {
    (m.attacks || []).forEach((c, i) => cands.push({ res: { type: RES.SELECT_BATTLECMD, action: BATTLE.ATTACK, index: i }, id: { list: 'attacks', ...desc(m.attacks, i) } }));
  }
  return cands;
}
// 予定していた手を、今の場面の一覧の中から探す（見つからなければ null）
function cpuFindPlanned(m, id) {
  const list = m[id.list] || [];
  const i = list.findIndex(c => c.code === id.code && c.location === id.loc && String(c.description || '') === id.d);
  if (i < 0) return null;
  const action = { activates: IDLE.ACTIVATE, special_summons: IDLE.SPSUMMON, summons: IDLE.SUMMON, spell_sets: IDLE.SSET, attacks: BATTLE.ATTACK }[id.list];
  return { type: id.list === 'attacks' ? RES.SELECT_BATTLECMD : RES.SELECT_IDLECMD, action, index: i };
}

// 先読み：2〜3手先まで（良い候補だけを残して広げていく）。一番良い手順の最初の手を返し、残りは予定として覚える
const CPU_DEPTH = 3, CPU_WIDTH = 3, CPU_MAXCANDS = 12, CPU_TIME = 4000;
// CPU の返答が、画面で見せたい行動か（フェイズを進めるだけ・発動しないだけのときは止めない）
function cpuVisible(ask, res) {
  switch (ask.type) {
    case MSG.SELECT_IDLECMD: return res.action !== IDLE.TO_BP && res.action !== IDLE.TO_EP;
    case MSG.SELECT_BATTLECMD: return res.action === BATTLE.CHAIN || res.action === BATTLE.ATTACK;
    case MSG.SELECT_CHAIN: return res.index != null;
    case MSG.SELECT_EFFECTYN: return !!res.yes;
    default: return false;
  }
}

function cpuThink(m, duel, kind) {
  const t0 = performance.now();
  const cpu = 1 - duel.me;
  // 何もしないとき（メイン：攻撃できるならバトルへ、なければ終わり。バトル：メイン2かエンドへ）
  const fallback = () => {
    duel.cpuPlan = null;
    if (kind === 'idle') {
      const canAttack = m.to_bp && duel.turn > 1 && duel.cpuBattled !== duel.turn;
      if (canAttack) { duel.cpuBattled = duel.turn; return { type: RES.SELECT_IDLECMD, action: IDLE.TO_BP, index: null }; }
      return { type: RES.SELECT_IDLECMD, action: m.to_ep ? IDLE.TO_EP : IDLE.TO_BP, index: null };
    }
    return { type: RES.SELECT_BATTLECMD, action: m.to_m2 ? BATTLE.TO_M2 : BATTLE.TO_EP, index: null };
  };
  // 前に立てた予定があり、その手が今も打てるなら、考え直さずに打つ
  const plan = duel.cpuPlan;
  if (plan && plan.turn === duel.turn && plan.kind === kind && plan.steps.length) {
    const res = cpuFindPlanned(m, plan.steps[0]);
    if (res) { plan.steps.shift(); return res; }
  }
  duel.cpuPlan = null;
  const first = cpuCandidates(m, kind);
  if (!first.length) return fallback();
  const hist = duel.history();
  // 手順 path を打ったあとの複製（CPU が次の手を選ぶ場面、または相手の番まで進めたもの）
  const play = path => {
    const t = new AutoDuel({ main: duel.main, extra: duel.extra, handIds: duel.handIds, handSize: duel.handSize, seed: duel.seed, opp: duel.opp, chainMode: 'off', autoTrigger: true, tools: duel.tools, rule: duel.rule, errata: duel.errata });
    t.noThink = true;
    t.create();
    t.stopAtCpu = true;   // 流し直したあと、今の判断の場面（CPU の番）で止める
    t.run(hist.slice());  // run は渡した一覧を使い切るので、複製ごとに写しを渡す
    if (!t.pending || t.pending.player !== cpu) { Engine.lib.destroyDuel(t.h); return null; }
    for (const step of path) {
      if (!t.pending || t.pending.player !== cpu) break;
      cpuStep(t, step.res, cpu);
    }
    return t;
  };
  let base = null;
  try { const t = play([]); if (t) { base = cpuScore(t, cpu); Engine.lib.destroyDuel(t.h); } } catch (e) { /* 比べられない */ }
  if (base == null) return null;
  // 1段目
  let beam = [], bestPath = null, bestScore = -Infinity;
  const consider = (path, t) => {
    const s = cpuScore(t, cpu);
    if (s > bestScore) { bestScore = s; bestPath = path; }
    return s;
  };
  let level = first.slice(0, CPU_MAXCANDS).map(c => [c]);
  for (let depth = 1; depth <= CPU_DEPTH && level.length; depth++) {
    const scored = [];
    for (const path of level) {
      if (performance.now() - t0 > CPU_TIME) break;   // 考えすぎない（画面が止まらないように）
      let t = null;
      try {
        t = play(path);
        if (!t) continue;
        const s = consider(path, t);
        // 次の手を広げられる場面（CPU のメインで、同じターン）なら、候補として残す
        const p = t.pending;
        const next = p && p.player === cpu && p.type === MSG.SELECT_IDLECMD && kind === 'idle' ? cpuCandidates(p, 'idle') : [];
        scored.push({ path, s, next });
      } catch (e) { /* 試せない手順は使わない */ }
      finally { if (t && t.h) Engine.lib.destroyDuel(t.h); }
    }
    // 良い順に CPU_WIDTH 個だけ残して、次の段を作る
    beam = scored.sort((a, b) => b.s - a.s).slice(0, CPU_WIDTH);
    level = [];
    for (const b of beam) for (const c of b.next.slice(0, CPU_MAXCANDS)) level.push([...b.path, c]);
  }
  // 今より良くなる手順があれば、その最初の手を打つ（残りは予定にする）
  if (!bestPath || bestScore <= base + 0.5) return fallback();
  duel.cpuPlan = { turn: duel.turn, kind, steps: bestPath.slice(1).map(c => c.id) };
  return bestPath[0].res;
}
// ---------- チェーンの判断（手札誘発・速攻効果・任意の誘発） ----------
// 「発動しない」と、発動できるそれぞれを複製の中で試し、チェーンを解決して次に誰かが行動を選ぶところまで進めて点数を比べる。
// 相手（練習する人）の効果を無効にできたら、その分を高く見る（サーチ・展開を止めた価値）
const LASTING_TRAPS = new Set(['増殖するG', 'ドロール＆ロックバード']);
function cpuChainThink(m, duel) {
  const cpu = 1 - duel.me, hist = duel.history(), t0 = performance.now();
  const opts = [...(m.forced ? [] : [-1]), ...m.selects.map((_, i) => i)];
  if (opts.length < 2 && !m.forced) return null;
  let best = null, bestS = -Infinity, passS = null;
  for (const o of opts) {
    if (performance.now() - t0 > 3500) break;   // 考えすぎない
    let t = null;
    try {
      t = new AutoDuel({ main: duel.main, extra: duel.extra, handIds: duel.handIds, handSize: duel.handSize, seed: duel.seed, opp: duel.opp, chainMode: 'off', autoTrigger: true, tools: duel.tools, rule: duel.rule, errata: duel.errata });
      t.noThink = true;
      t.create();
      t.stopAtCpu = true;
      t.run(hist.slice());
      const p = t.pending;
      if (!p || p.player !== cpu || p.type !== MSG.SELECT_CHAIN) continue;
      t.events = [];
      t.stopAtCpu = true;
      t.respond({ type: RES.SELECT_CHAIN, index: o < 0 ? null : o });
      for (let i = 0; i < 80 && t.pending && !t.ended; i++) {
        const q = t.pending;
        if (q.type === MSG.SELECT_IDLECMD || q.type === MSG.SELECT_BATTLECMD) break;
        t.stopAtCpu = true;
        t.respond(q.player === cpu ? cpuAnswer(q, t) : autoAnswer(q));
      }
      const denied = t.events.filter(e => e.t === 'negate' && e.con === duel.me).length;
      // 増殖するG のように、効果がそのターンの間あとから効くカード：相手のメインフェイズに使う価値を足す
      const lasting = o >= 0 && LASTING_TRAPS.has(cardName(m.selects[o].code)) && duel.turnPlayer === duel.me && (duel.phase === 4 || duel.phase === 256);
      const s = cpuScore(t, cpu, true) + denied * 4 + (lasting ? 6 : 0);
      if (o < 0) passS = s;
      if (s > bestS) { bestS = s; best = o; }
    } catch (e) { /* 試せない選び方は使わない */ }
    finally { if (t && t.h) Engine.lib.destroyDuel(t.h); }
  }
  if (best === null) return null;
  // 発動しても大して得にならないなら、温存する
  if (best >= 0 && passS != null && bestS < passS + 0.8) best = -1;
  return { type: RES.SELECT_CHAIN, index: best < 0 ? null : best };
}

// 表示形式：相手の場にいちばん強いモンスターより攻撃力が低く、守備力のほうが高いなら守備表示
function cpuPosition(m, duel) {
  const d = DB.byId.get(m.code) || {};
  const can = p => m.positions & p;
  let oppMax = 0;
  try { for (const c of duel.query()[duel.me].m) if (c && c.code && (c.position & 1)) oppMax = Math.max(oppMax, c.attack || 0); } catch { /* 分からなければ攻撃表示 */ }
  const wantDef = (d.atk || 0) < oppMax && (d.def || 0) > (d.atk || 0);
  const order = wantDef ? [4, 8, 1, 2] : [1, 4, 2, 8];
  return order.find(can) || [1, 2, 4, 8].find(can);
}

// 複製の中で1手打って、その処理が終わるところ（CPU が次の手を選ぶ場面、または相手の番）まで進める
function cpuStep(t, res, cpu) {
  t.stopAtCpu = true;
  t.respond(res);
  for (let i = 0; i < 60 && t.pending && !t.ended; i++) {
    const p = t.pending;
    if (p.type === MSG.SELECT_IDLECMD || p.type === MSG.SELECT_BATTLECMD) break;
    // 処理の途中の選択：CPU はいつもの答え、練習する人は「しない」で進める
    t.stopAtCpu = true;
    t.respond(p.player === cpu ? cpuAnswer(p, t) : autoAnswer(p));
  }
}
// 手を打って、その先（CPU のターンの残り）を簡単な動きで進めてから、盤面の点数を出す
// 盤面の点数（CPU から見て）。モンスターの強さ・数、伏せカード、手札、相手のライフを数える
function cpuScore(t, cpu, chain = false) {
  if (t.ended) return t.ended.startsWith(cpu === t.me ? '自分の勝ち' : '相手の勝ち') ? 1e6 : -1e6;
  const q = t.query(), you = 1 - cpu;
  const monVal = c => {
    if (!c || !c.code) return 0;
    const d = DB.byId.get(c.code) || {};
    const faceUp = c.position & 5;
    let v = 6 + (faceUp ? (c.attack || 0) / 250 : 3);
    if (d.type && has(d, T.LINK)) v += (d.level || 1) * 2;
    if (d.type && isExtraType(d)) v += 4;   // EXデッキのモンスターは効果も強いことが多い
    return v;
  };
  const side = p => {
    const s = q[p];
    let v = 0;
    for (const c of s.m) v += monVal(c);
    for (const c of s.s) if (c && c.code) v += 3;
    v += s.hand.filter(c => c && c.code).length * 2.2;
    // 手札誘発は手札にあるほうが強い（自分のターンに使わないように）。チェーンの判断でも、むだ撃ちしないよう少し残す価値を見る
    if (p === cpu) v += s.hand.filter(c => c && c.code && isHandTrap(c.code)).length * (chain ? 2 : 4);
    v += s.gy.filter(c => c && c.code).length * 0.2;
    return v;
  };
  // チェーンの判断では、相手が得るもの（サーチ・展開）を重く見る
  return side(cpu) - side(you) * (chain ? 1.3 : 0.9) + (8000 - t.lp[you]) / 120 - (8000 - t.lp[cpu]) / 200;
}
