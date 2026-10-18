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
  SUMMONING: 60, SPSUMMONING: 62, FLIPSUMMONING: 64, CHAINING: 70, CHAIN_SOLVED: 73, CHAIN_END: 74, CHAIN_NEGATED: 75,
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
    onStatus && onStatus('自動処理の準備中…（共通スクリプトを読み込んでいます）');
    const texts = await Promise.all(CORE_SCRIPTS.map(n => fetchScript(n, n)));
    CORE_SCRIPTS.forEach((n, i) => { if (texts[i]) Engine.scripts.set(n, texts[i]); });
    if (!Engine.scripts.has('utility.lua')) throw new Error('共通スクリプトを読み込めませんでした');
    await loadSystemStrings();
  })();
  Engine.loading.catch(() => { Engine.loading = null; });
  return Engine.loading;
}

// デッキのカードのスクリプトを読み込む。スクリプト内で読み込む別スクリプトも追いかける
async function loadCardScripts(codes, onStatus) {
  const want = [...new Set(codes)].filter(c => !Engine.scripts.has(`c${c}.lua`));
  let done = 0;
  const one = async code => {
    const name = `c${code}.lua`;
    let text = await fetchScript(name, `official/${name}`);
    if (!text) text = await fetchScript(name, `pre-release/${name}`);
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
}

// ---------- 表示用の文字 ----------
const cardName = code => { const c = DB.byId.get(code); return c ? c.name : `カード${code}`; };
function descText(desc) {
  const d = BigInt(desc || 0);
  const code = Number(d >> 20n), idx = Number(d & 0xfffffn);
  if (code) {
    const c = DB.byId.get(code);
    const s = c && c.jaStrs && c.jaStrs[idx];
    return s || `「${cardName(code)}」の効果${idx + 1}`;
  }
  const s = Engine.sys.get(idx) || '';
  return s.includes('%') ? '' : s;   // 「[%ls]の…」のような埋め込み前提の文は使わない
}
const placeText = (con, loc, seq) => {
  const side = con === Engine.me ? '' : '相手の';
  if (loc === LOC.MZONE) return side + (seq >= 5 ? 'EXモンスターゾーン' : `モンスターゾーン${seq + 1}`);
  if (loc === LOC.SZONE) return side + (seq === 5 ? 'フィールドゾーン' : `魔法・罠ゾーン${seq + 1}`);
  return side + (LOC_NAME[loc & ~LOC.OVERLAY] || '') + (loc & LOC.OVERLAY ? 'のX素材' : '');
};

// ---------- 1回の対戦 ----------
// main/extra：自分のデッキ（カードid）。handIds：初手に入れるカード（省略時はランダムに引く）
// opp：相手のデッキ {main, extra}（省略時は何もしない相手）。chainMode：チェーン確認（'auto' / 'always' / 'off'）
class AutoDuel {
  constructor({ main, extra, handIds, handSize = 5, seed, opp = null, chainMode = 'auto' }) {
    this.main = main; this.extra = extra; this.handIds = handIds || null; this.handSize = handSize;
    this.opp = opp && opp.main && opp.main.length ? opp : null;
    this.chainMode = chainMode;
    this.me = handSize === 6 ? 1 : 0;   // 後攻なら相手が先に動く
    this.seed = seed || [...crypto.getRandomValues(new Uint32Array(4))].map(BigInt);
    this.responses = [];     // これまでの返答（元に戻すときは最初からやり直して、ここを途中まで流し直す）
    this.userMarks = [];     // 自分が選んだ返答の位置
  }

  create() {
    const L = Engine.lib, O = Engine.ocg;
    if (this.h) L.destroyDuel(this.h);
    this.log = []; this.pending = null; this.hint = 0; this.ended = null; this.turn = 0; this.turnPlayer = 0; this.phase = 0;
    this.lp = [8000, 8000]; this.chain = []; this.events = []; this.retries = 0; this.locks = [];
    this.rng = seededRandom(Number(BigInt(this.seed[1]) & 0xffffffffn) || 7);   // 相手の判断用（やり直しで同じになるように）
    const team = n => ({ drawCountPerTurn: 1, startingDrawCount: n, startingLP: 8000 });
    this.h = L.createDuel({
      flags: O.OcgDuelMode.MODE_MR5,
      seed: this.seed,
      team1: team(this.me === 0 ? (this.handIds ? 0 : this.handSize) : 5),
      team2: team(this.me === 1 ? (this.handIds ? 0 : 5) : 5),
      cardReader: code => engineCardData(code),
      scriptReader: name => {
        const t = Engine.scripts.get(name);
        return t ? t : null;
      },
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
    for (const id of this.extra) add(me, id, LOC.EXTRA);
    if (this.opp) {
      for (const id of shuffle([...this.opp.main])) add(1 - me, id, LOC.DECK);
      for (const id of this.opp.extra || []) add(1 - me, id, LOC.EXTRA);
    } else {
      for (let i = 0; i < 40; i++) add(1 - me, OPP_FILLER, LOC.DECK);
    }
    L.startDuel(this.h);
  }

  start() { this.create(); this.run(); }

  // 自分の入力が必要になるまで進める
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
      if (status === 0) { this.pending = null; return; }   // 対戦終了
      if (status === 2) continue;
      if (!ask) continue;
      // 相手の番の入力と、選ぶものが無い確認は自動で返す
      const auto = ask.player !== this.me ? (this.opp ? cpuAnswer(ask, this) : autoAnswer(ask)) : skippable(ask, this);
      if (auto) { this.respond(auto, true, replay); continue; }
      if (replay && replay.length) { this.respond(replay.shift(), false, replay); continue; }
      this.pending = ask;
      return;
    }
  }

  respond(res, auto, replay) {
    if (!auto) this.userMarks.push(this.responses.length);
    this.responses.push(res);
    this.retry = false;
    if (!auto) this.retries = 0;
    Engine.lib.duelSetResponse(this.h, res);
    if (!auto && !replay) { this.pending = null; this.run(); }
  }

  // 自分の操作を1つ戻す（最後に「召喚する」「発動する」などを選ぶ前まで。最初から流し直す）
  undo() {
    if (!this.userMarks.length) return false;
    const isAction = r => r.type === RES.SELECT_IDLECMD || r.type === RES.SELECT_BATTLECMD;
    let k = this.userMarks.length - 1;
    while (k > 0 && !isAction(this.responses[this.userMarks[k]])) k--;
    const cut = this.userMarks[k];
    const keep = this.responses.slice(0, cut).filter((r, i) => this.userMarks.includes(i));
    this.responses = []; this.userMarks = [];
    this.create();
    this.run(keep);
    return true;
  }
  restart() { this.responses = []; this.userMarks = []; this.start(); }

  addLog(text) { this.log.push(`[T${this.turn || 1}] ${text}`); }
  who(con) { return con === this.me ? '' : '相手の'; }

  onInfo(m) {
    switch (m.type) {
      case MSG.HINT: if (m.hint_type === 3 && m.player === this.me) this.hint = m.hint; break;
      case MSG.NEW_TURN: this.turn++; this.turnPlayer = m.player; this.addLog(`---- ${m.player === this.me ? '自分' : '相手'}のターン ----`); break;
      case MSG.NEW_PHASE: this.phase = m.phase; if (this.turnPlayer === this.me) this.addLog(PHASE_NAME[m.phase] || 'フェイズ'); break;
      case MSG.DRAW: if (m.player === this.me) this.addLog(`ドロー：${m.drawn.map(d => cardName(d.code & 0x7fffffff)).join('、')}`); break;
      case MSG.SUMMONING: this.addLog(`${this.who(m.controller)}${cardName(m.code)} を通常召喚`); this.events.push({ t: 'summon', code: m.code, con: m.controller, loc: m.location, seq: m.sequence }); break;
      case MSG.SPSUMMONING: this.addLog(`${this.who(m.controller)}${cardName(m.code)} を特殊召喚`); this.events.push({ t: 'summon', code: m.code, con: m.controller, loc: m.location, seq: m.sequence }); break;
      case MSG.FLIPSUMMONING: this.addLog(`${this.who(m.controller)}${cardName(m.code)} を反転召喚`); break;
      case MSG.CHAINING: {
        const link = { code: m.code, con: m.controller, loc: m.location, seq: m.sequence, desc: descText(m.description), n: m.chain_size };
        this.chain.push(link); this.events.push({ t: 'chain', ...link });
        this.addLog(`チェーン${m.chain_size}：${this.who(m.controller)}${cardName(m.code)} の効果を発動（${link.desc || '効果'}）`); break;
      }
      case MSG.CHAIN_SOLVED: this.chain.pop(); break;
      case MSG.CHAIN_END: this.chain = []; break;
      case MSG.CHAIN_NEGATED: case MSG.CHAIN_DISABLED: this.addLog('チェーンの効果が無効になった'); break;
      case MSG.MOVE: {
        const code = m.card;
        if (!code || m.from.location === m.to.location && m.from.controller === m.to.controller) break;
        if (m.from.controller !== this.me && m.to.controller !== this.me && !(m.from.location & LOC.ONFIELD_ALL) && !(m.to.location & LOC.ONFIELD_ALL)) break;   // 相手の手札・デッキ・墓地の間の移動（手札調整など）は省く
        if (m.to.location === LOC.HAND && m.from.location === LOC.DECK && m.from.controller === this.me && this.drawing) break;
        this.events.push({ t: 'move', code, from: { con: m.from.controller, loc: m.from.location, seq: m.from.sequence }, to: { con: m.to.controller, loc: m.to.location, seq: m.to.sequence }, faceUp: !!(m.to.position & 5) });
        const secret = m.to.controller !== this.me && !(m.to.position & 5) && (m.to.location & (LOC.ONFIELD_ALL | LOC.HAND | LOC.DECK));   // 相手が裏向きにしたカードは名前を伏せる
        this.addLog(`${secret ? 'カード' : cardName(code)}：${placeText(m.from.controller, m.from.location, m.from.sequence)} → ${placeText(m.to.controller, m.to.location, m.to.sequence)}`);
        break;
      }
      case MSG.DAMAGE: this.addLog(`${m.player === this.me ? '自分' : '相手'}に ${m.amount} ダメージ`); break;
      case MSG.RECOVER: this.addLog(`${m.player === this.me ? '自分' : '相手'}が ${m.amount} 回復`); break;
      case MSG.PAY_LPCOST: this.addLog(`${m.player === this.me ? '自分' : '相手'}が ${m.amount} LPを払った`); break;
      case MSG.LPUPDATE: this.lp[m.player] = m.lp; break;
      case MSG.PLAYER_HINT: {
        // 「このターン、〇〇しか特殊召喚できない」などの制限（縛り）が付いた・外れた
        if (m.player !== this.me) break;
        const code = Number(BigInt(m.description) >> 20n);
        const text = (code ? `「${cardName(code)}」：` : '') + (descText(m.description) || '効果による制限');
        if (m.player_hint === 6) { this.locks.push({ desc: String(m.description), text }); this.addLog('制限が付いた ' + text); }
        else if (m.player_hint === 7) { const i = this.locks.findIndex(l => l.desc === String(m.description)); if (i >= 0) this.locks.splice(i, 1); }
        break;
      }
      case MSG.CONFIRM_CARDS: if (m.cards.length) this.addLog(`確認：${m.cards.map(c => cardName(c.code)).join('、')}`); break;
      case MSG.TOSS_COIN: this.addLog(`コイン：${m.results.map(r => (r ? '表' : '裏')).join('・')}`); break;
      case MSG.TOSS_DICE: this.addLog(`サイコロ：${m.results.join('・')}`); break;
      case MSG.WIN: this.ended = m.player === this.me ? '自分の勝ち' : '相手の勝ち'; this.addLog(`対戦終了（${this.ended}）`); break;
      default: break;
    }
    if (m.type === MSG.DAMAGE || m.type === MSG.RECOVER || m.type === MSG.PAY_LPCOST) {
      this.lp[m.player] += m.type === MSG.RECOVER ? m.amount : -m.amount;
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
//   always：発動できるものがあれば毎回聞く
//   auto  ：相手が発動したとき・自分の誘発効果があるときだけ聞く
//   off   ：誘発効果があるときだけ聞く
function skippable(m, duel) {
  if (m.type === MSG.SELECT_CHAIN && !m.forced) {
    if (!m.selects.length) return { type: RES.SELECT_CHAIN, index: null };
    const mode = duel ? duel.chainMode : 'always';
    const last = duel && duel.chain[duel.chain.length - 1];
    const ask = mode === 'always' || m.spe_count > 0 || (mode === 'auto' && last && last.con !== duel.me);
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
function cpuAnswer(m, duel) {
  const me = duel.me;            // 練習する人（CPU から見た相手）
  const rnd = duel.rng;
  const theirs = c => c.controller === me;
  // 選ぶカード：相手（練習する人）のフィールドのカードを優先
  const prefer = list => {
    const idx = list.map((c, i) => i);
    const score = c => (theirs(c) ? 10 : 0) + (c.location & LOC.ONFIELD_ALL ? 5 : 0);
    return idx.sort((a, b) => score(list[b]) - score(list[a]));
  };
  switch (m.type) {
    case MSG.SELECT_IDLECMD: {
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
      // 相手（練習する人）のターンに、相手が発動したものへの妨害として使う
      if (m.selects.length && (m.forced || (duel.turnPlayer === me && duel.chain.length && duel.chain[duel.chain.length - 1].con === me) || m.spe_count > 0 || (duel.turnPlayer === me && rnd() < 0.5)))
        return { type: RES.SELECT_CHAIN, index: Math.floor(rnd() * m.selects.length) };
      return { type: RES.SELECT_CHAIN, index: m.forced ? 0 : null };
    case MSG.SELECT_EFFECTYN: return { type: RES.SELECT_EFFECTYN, yes: true };
    case MSG.SELECT_YESNO: return { type: RES.SELECT_YESNO, yes: true };
    case MSG.SELECT_CARD: return { type: RES.SELECT_CARD, indicies: prefer(m.selects).slice(0, m.min).sort((a, b) => a - b) };
    case MSG.SELECT_TRIBUTE: return { type: RES.SELECT_TRIBUTE, indicies: [...Array(m.min).keys()] };
    case MSG.SELECT_UNSELECT_CARD: {
      if (m.can_finish || !m.select_cards.length) return { type: RES.SELECT_UNSELECT_CARD, index: null };
      return { type: RES.SELECT_UNSELECT_CARD, index: prefer(m.select_cards)[0] };
    }
    case MSG.SELECT_POSITION: return { type: RES.SELECT_POSITION, position: [1, 4, 2, 8].find(p => m.positions & p) };
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
    case MSG.SELECT_PLACE: case MSG.SELECT_DISFIELD: return { type: m.type === MSG.SELECT_PLACE ? RES.SELECT_PLACE : RES.SELECT_DISFIELD, places: freePlaces(m.field_mask, m.player).slice(0, m.count) };
    case MSG.SELECT_SUM: return { type: RES.SELECT_SUM, indicies: [...Array(Math.max(m.min, 1)).keys()] };
    case MSG.SORT_CARD: case MSG.SORT_CHAIN: return { type: RES.SORT_CARD, order: null };
    case MSG.SELECT_COUNTER: return { type: RES.SELECT_COUNTER, counters: m.cards.map((c, i) => (i === 0 ? m.count : 0)) };
    case MSG.ANNOUNCE_NUMBER: return { type: RES.ANNOUNCE_NUMBER, value: 0 };
    default: return skippable(m);
  }
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
