// カードデコーダー（複数人で遊ぶカード当てゲーム）
// ・部屋の中の1人が「出題者」になり、答えのカードを1枚決める（答えは出題者の端末にだけある。ほかの人には送らない）
//   出題者を「コンピューター」にすると、ホストのアプリがランダムに選び、開示する項目もランダムに選ぶ（ひとりで遊ぶときもこれ）
// ・出題者以外の人が、順番にチャットでカード名を出して答える。出したカードはイラストとステータスが表示される
// ・出したカードと答えのカードで、同じ項目（属性・種族・レベル・攻撃力など）があれば「当たり」。
//   当たりが複数あるときは、まだ開示していない当たりの中から、出題者が1つだけ選んで全員に開示する（1つだけなら自動）
// ・答えのカードそのものを出した人の勝ち
// 通信は対戦と同じ公開の中継サーバー（MQTT）。ホストのアプリが部屋の状態を持ち、全員に送る。
//   <base>/dec/<コード>/alive ：部屋があるしるし（ホストが落ちると消える）
//   <base>/dec/<コード>/msg   ：やり取り（全員 → ホスト：join / chat / guess / bye / master / start / judge / giveup、ホスト → 全員：state）

const DEC_FIELDS = [
  ['kind', 'カードの種類'], ['frame', '種類'], ['attr', '属性'], ['race', '種族'],
  ['level', 'レベル・ランク・リンク'], ['atk', '攻撃力'], ['def', '守備力'], ['theme', 'テーマ'],
];
const DEC_POOLS = {
  all: ['すべてのカード', c => true],
  monster: ['モンスターだけ', c => isMonster(c)],
  main: ['メインデッキのモンスター', c => isMonster(c) && !isExtraType(c)],
  extra: ['EXデッキのモンスター', c => isExtraType(c)],
  spelltrap: ['魔法・罠だけ', c => !isMonster(c)],
  deck: ['自分の今のデッキから', null],
};
const DEC_LIMITS = { 0: 'なし', 30: '30秒', 60: '60秒', 120: '2分' };
const DEC_LOG_MAX = 200;
const DEC_CPU = 'cpu';

// 出せるカード（トークン・アニメ・オリジナルのカードは使わない）
const decUsable = c => c && !isToken(c) && !c.anime && !c.custom;

// テーマの名前（公式のテーマ名があるものだけ。読みの部分は外す）
let decThemeNames = null;
function decThemesOf(c) {
  if (!decThemeNames) decThemeNames = new Map((typeof SETNAMES !== 'undefined' ? SETNAMES : []).map(([, own, name]) => [own, String(name).replace(/（[^）]*）$/, '')]));
  const list = typeof cardThemes === 'function' ? cardThemes(c) : [];
  return [...new Set(list.map(t => decThemeNames.get(t) || decThemeNames.get(t & 0xfff)).filter(Boolean))];
}

// カードの各項目（比べるための key と、表示する text）。当てはまらない項目は null
const decValCache = new Map();   // カードごとの項目（候補を絞るときに何度も使う）
function decVals(c) {
  const hit = decValCache.get(c.id);
  if (hit) return hit;
  const v = decValsRaw(c);
  decValCache.set(c.id, v);
  return v;
}
function decValsRaw(c) {
  const mon = isMonster(c);
  const v = {};
  v.kind = { key: mon ? 'M' : has(c, T.SPELL) ? 'S' : 'T', text: mon ? 'モンスター' : has(c, T.SPELL) ? '魔法' : '罠' };
  if (mon) {
    const fr = has(c, T.LINK) ? 'リンク' : has(c, T.XYZ) ? 'エクシーズ' : has(c, T.SYNCHRO) ? 'シンクロ' : has(c, T.FUSION) ? '融合' : has(c, T.RITUAL) ? '儀式' : has(c, T.EFFECT) ? '効果' : '通常';
    const t = fr + (has(c, T.PENDULUM) ? '・ペンデュラム' : '');
    v.frame = { key: 'M' + t, text: t };
    v.attr = { key: c.attr, text: (ATTR[c.attr] || '？') + '属性' };
    v.race = { key: c.race, text: RACE[c.race] || '？族' };
    v.level = { key: levelText(c), text: levelText(c) };
    v.atk = { key: c.atk < 0 ? '?' : c.atk, text: c.atk < 0 ? '?' : String(c.atk) };
    v.def = has(c, T.LINK) ? null : { key: c.def < 0 ? '?' : c.def, text: c.def < 0 ? '?' : String(c.def) };
  } else {
    v.frame = { key: v.kind.key + typeLine(c), text: typeLine(c) };
    v.attr = v.race = v.level = v.atk = v.def = null;
  }
  const th = decThemesOf(c);
  v.theme = { list: th, text: th.length ? th.join('・') : 'なし' };
  return v;
}
// 答えの全項目（開示用の文）
function decAllTexts(a) {
  const v = decVals(a), out = {};
  for (const [k] of DEC_FIELDS) if (v[k]) out[k] = v[k].text;
  return out;
}

// 出したカード g と答え a で当たっている項目 → { key: 開示する文 }
function decMatches(g, a) {
  const vg = decVals(g), va = decVals(a), out = {};
  for (const [k] of DEC_FIELDS) {
    if (k === 'theme') {
      const same = va.theme.list.filter(t => vg.theme.list.includes(t));
      if (same.length) out.theme = same.join('・');
      else if (!va.theme.list.length && !vg.theme.list.length) out.theme = 'なし';
      continue;
    }
    if (va[k] && vg[k] && va[k].key === vg[k].key) out[k] = va[k].text;
  }
  return out;
}
const decIsAnswer = (c, a) => !!(c && a && (c.id === a.id || c.name === a.name));

// ---------- 通信（対戦の MQTT の仕組みを、別の話題で使う） ----------
class DecoderNet extends MqttDuelTransport {
  topic(kind, code) { return MQTT_BASE + '/dec/' + (code || this.code) + '/' + kind; }
  onMessage(t, buf) {
    if (this.closed) return;
    if (t === this.topic('alive')) { if (!buf.length && !this.isHost && this.onLost) this.onLost(); return; }
    if (t !== this.topic('msg') || !buf.length) return;
    let m; try { m = JSON.parse(buf.toString()); } catch { return; }
    if (this.onMsg) this.onMsg(m);
  }
  async host(code) {
    for (let t = 0; t < 5; t++) {
      const c = code || newRoomCode();
      this.code = c;
      const will = { topic: this.topic('alive', c), payload: '', qos: 1, retain: true };
      await this.connect(will, [MQTT_BROKERS[0]]).catch(() => this.connect(will));
      const alive = await this.peekAlive(c, 1500);
      if (alive && alive.host !== this.me.uid) { this.client.end(true); this.client = null; if (code) throw new Error('その部屋コードは今使われています'); continue; }
      this.isHost = true;
      await this.sub(this.topic('msg'));
      this.pub(this.topic('alive'), { host: this.me.uid, name: this.me.name, game: 'decoder', t: Date.now() }, true);
      return c;
    }
    throw new Error('部屋を作れませんでした。もう一度お試しください');
  }
  async enter(code) {
    this.code = code;
    let alive = null;
    for (const url of MQTT_BROKERS) {
      try { await this.connect({ topic: this.topic('msg', code), payload: JSON.stringify({ kind: 'bye', from: this.me.uid }), qos: 1, retain: false }, [url]); } catch { continue; }
      alive = await this.peekAlive(code, 2500);
      if (alive) break;
      this.client.end(true); this.client = null;
    }
    if (!this.client || !alive) throw new Error('その部屋コードの部屋はありません（部屋を作った人がアプリを開いている間だけ入れます）');
    this.hostUid = alive.host;
    await this.sub(this.topic('msg'));
    return alive;
  }
  close() {
    this.closed = true;
    if (this.client) {
      if (this.isHost) this.pub(this.topic('alive'), null, true);
      else this.send({ kind: 'bye' });
      const c = this.client; setTimeout(() => c.end(true), 300);
    }
    this.client = null;
  }
}

// ---------- 状態 ----------
const Dec = {
  me: null, net: null, isHost: false, solo: false, code: null,
  G: null,          // 部屋の状態（ホストが持ち、全員に送る）
  secret: null,     // 答えのカード（出題者の端末だけが持つ。コンピューターが出題するときはホスト）
  judged: 0,        // 出題者：判定を送った答えの番号（同じ答えを二度判定しない）
  recvAt: 0, shownN: 0, tick: null, joinWait: null,
};
const decPlayer = uid => Dec.G && Dec.G.players.find(p => p.uid === uid);
const decIsMaster = () => !!(Dec.G && Dec.G.master && Dec.G.master === Dec.me.uid);
const decMyTurn = () => !!(Dec.G && Dec.G.status === 'play' && !Dec.G.pending && Dec.G.turn === Dec.me.uid);
const decMasterName = G => (G.master === DEC_CPU ? 'コンピューター' : (decPlayer(G.master) || {}).name || '？');

function decNewState(solo) {
  return {
    hostUid: Dec.me.uid, status: 'lobby', round: 0, turn: null, starter: null, winner: null,
    master: solo ? DEC_CPU : null, pending: null,
    players: [{ uid: Dec.me.uid, name: Dec.me.name, wins: 0, online: true }],
    revealed: {}, answerId: null, log: [], seq: 0,
    settings: { pool: store.get('ygo.decPool', 'all'), limit: store.get('ygo.decLimit', 60), hint: store.get('ygo.decHint', true) },
    turnLeft: 0,
  };
}

// ---------- ホストの処理 ----------
function decLog(entry) {
  const G = Dec.G;
  entry.n = ++G.seq; entry.ts = Date.now();
  G.log.push(entry);
  if (G.log.length > DEC_LOG_MAX) G.log.splice(0, G.log.length - DEC_LOG_MAX);
}
function decPublish() {
  const G = Dec.G;
  G.turnLeft = G.turnEnds ? Math.max(0, G.turnEnds - Date.now()) : 0;
  if (Dec.net) Dec.net.send({ kind: 'state', g: G });
  Dec.recvAt = Date.now();
  renderDecoder();
}
// 次の番（出題者と、抜けた人は飛ばす）
function decNextTurn(from) {
  const G = Dec.G, all = G.players;
  const can = p => p.online && p.uid !== G.master;
  if (!all.some(can)) { G.turn = null; G.turnEnds = 0; return; }
  let i = all.findIndex(p => p.uid === from);
  for (let k = 0; k < all.length; k++) { i = (i + 1) % all.length; if (can(all[i])) break; }
  G.turn = all[i].uid;
  G.turnEnds = G.settings.limit ? Date.now() + G.settings.limit * 1000 : 0;
}
function decPool(pool) {
  if (pool === 'deck') {
    const d = typeof Decks !== 'undefined' && Decks.current();
    const ids = d ? [...new Set([...(d.main || []), ...(d.extra || [])])] : [];
    return ids.map(id => DB.byId.get(id)).filter(decUsable);
  }
  const f = (DEC_POOLS[pool] || DEC_POOLS.all)[1];
  return DB.cards.filter(c => decUsable(c) && (c.cid || c.special) && !c.pre && f(c));
}
const decRandom = list => list[Math.floor(Math.random() * list.length)];
// hint：最初（1人目が答える前）に開示する項目 { k, text }。出題者が選ぶ（なしでもよい）
function decStartRound(note, hint) {
  const G = Dec.G;
  G.round++; G.status = 'play'; G.revealed = {}; G.answerId = null; G.winner = null; G.pending = null; G.hint = null;
  const f = hint && DEC_FIELDS.find(x => x[0] === hint.k);
  if (f && hint.text) { G.hint = { k: f[0], text: String(hint.text).slice(0, 60) }; G.revealed[f[0]] = G.hint.text; }
  decNextTurn(G.starter || G.master);   // 最初の番は、前の問題で最初だった人の次の人
  G.starter = G.turn;
  decLog({ t: 'sys', text: `第${G.round}問 スタート（出題者：${decMasterName(G)}${note ? '・' + note : ''}）` });
  if (G.hint) decLog({ t: 'sys', text: `最初のヒント：${f[1]}は「${G.hint.text}」` });
  decPublish();
}
// コンピューターが出題する（ホストのアプリが選ぶ）
function decCpuStart() {
  const G = Dec.G, pool = decPool(G.settings.pool);
  if (!pool.length) { toast(G.settings.pool === 'deck' ? '今のデッキにカードがありません' : '出題できるカードがありません'); return; }
  if (!G.players.some(p => p.online && p.uid !== G.master)) { toast('答える人がいません'); return; }
  Dec.secret = decRandom(pool);
  // 「最初に1つ開示」の設定なら、答えの項目からランダムに1つ
  const all = decAllTexts(Dec.secret), ks = Object.keys(all), hk = G.settings.hint && ks.length ? decRandom(ks) : null;
  decStartRound(`${(DEC_POOLS[G.settings.pool] || DEC_POOLS.all)[0]}・${pool.length}枚から`, hk ? { k: hk, text: all[hk] } : null);
}
function decEndRound(winner, answerId, all, text) {
  const G = Dec.G;
  G.status = 'over'; G.turn = null; G.turnEnds = 0; G.pending = null; G.winner = winner || null;
  if (answerId) { G.answerId = answerId; Object.assign(G.revealed, all || {}); }
  if (winner) { const p = decPlayer(winner); if (p) p.wins = (p.wins || 0) + 1; }
  if (text) decLog({ t: 'sys', text });
}
// 判定を反映する（出題者の判定、またはコンピューターの判定）
function decApplyJudge(j) {
  const G = Dec.G, pd = G.pending;
  if (!pd || j.n !== pd.n) return;
  const entry = { t: 'guess', uid: pd.uid, name: pd.name, id: pd.id, r: G.round };   // r：何問目の答えか（候補を絞るのに使う）
  const c = DB.byId.get(pd.id);
  if (j.correct) {
    entry.correct = true;
    decLog(entry);
    decEndRound(pd.uid, j.answerId || pd.id, j.all, `🎉 ${pd.name} が正解！ 答えは「${c ? c.name : '？'}」でした`);
  } else {
    if (j.k && G.revealed[j.k] == null) { G.revealed[j.k] = String(j.text || '').slice(0, 60); entry.reveal = { k: j.k, text: G.revealed[j.k] }; }
    else if (j.old) entry.old = true;
    decLog(entry);
    G.pending = null;
    decNextTurn(pd.uid);
  }
  decPublish();
}
// コンピューターの判定（当たりの中からランダムに1つ開示）
function decCpuJudge() {
  const G = Dec.G, pd = G.pending, a = Dec.secret, c = pd && DB.byId.get(pd.id);
  if (!pd || !a || !c) return;
  if (decIsAnswer(c, a)) { decApplyJudge({ n: pd.n, correct: true, answerId: a.id, all: decAllTexts(a) }); return; }
  const hit = decMatches(c, a), fresh = Object.keys(hit).filter(k => G.revealed[k] == null);
  const k = fresh.length ? decRandom(fresh) : null;
  decApplyJudge({ n: pd.n, k, text: k ? hit[k] : '', old: !k && Object.keys(hit).length > 0 });
}
// 全員・自分からのメッセージ（ホストが受け取る）
function decHostHandle(uid, m) {
  const G = Dec.G, p = decPlayer(uid);
  if (m.kind === 'join' && m.me) {
    const name = String(m.me.name || 'プレイヤー').slice(0, 20);
    if (p) { p.online = true; p.name = name; decLog({ t: 'sys', text: `${name} が入り直しました` }); }
    else { G.players.push({ uid, name, wins: 0, online: true }); decLog({ t: 'sys', text: `${name} が入りました` }); }
    if (G.status === 'play' && !G.turn && !G.pending) decNextTurn(uid);
    decPublish();
    return;
  }
  if (!p) return;
  if (m.kind === 'bye') {
    if (!p.online) return;
    p.online = false;
    decLog({ t: 'sys', text: `${p.name} が抜けました` });
    if (G.status === 'play' && G.master === uid) decEndRound(null, null, null, '出題者が抜けたので、この問題は中止です');
    else if (G.status === 'play' && G.pending && G.pending.uid === uid) { G.pending = null; decNextTurn(uid); }
    else if (G.status === 'play' && G.turn === uid) decNextTurn(uid);
    if (G.master === uid && G.status !== 'play') G.master = null;
    decPublish();
  } else if (m.kind === 'chat') {
    const text = String(m.text || '').slice(0, 200).trim();
    if (!text) return;
    decLog({ t: 'chat', uid, name: p.name, text });
    decPublish();
  } else if (m.kind === 'master') {
    // 出題者になる（問題の途中は変えない）。ホストはコンピューターも選べる
    if (G.status === 'play') return;
    const to = m.cpu && uid === G.hostUid ? DEC_CPU : uid;
    if (G.master === to) return;
    G.master = to;
    decLog({ t: 'sys', text: `${decMasterName(G)} が出題者になりました` });
    decPublish();
  } else if (m.kind === 'start') {
    if (G.status === 'play' || G.master !== uid) return;
    if (!G.players.some(x => x.online && x.uid !== G.master)) return;
    decStartRound('', m.hint);
  } else if (m.kind === 'guess') {
    const c = DB.byId.get(+m.id);
    if (G.status !== 'play' || G.pending || G.turn !== uid || !decUsable(c)) return;
    G.pending = { n: ++G.seq, uid, name: p.name, id: c.id };
    G.turnEnds = 0;   // 判定のあいだは時間を止める
    decPublish();
    if (G.master === DEC_CPU) decCpuJudge();
  } else if (m.kind === 'judge') {
    if (G.status === 'play' && G.master === uid) decApplyJudge(m);
  } else if (m.kind === 'giveup') {
    if (G.status !== 'play' || !(G.master === uid || (uid === G.hostUid && G.master === DEC_CPU))) return;
    const a = m.answerId && DB.byId.get(+m.answerId);
    decEndRound(null, a ? a.id : null, m.all, a ? `ギブアップ。答えは「${a.name}」でした` : 'この問題は中止です');
    decPublish();
  } else if (m.kind === 'abort') {
    if (G.status !== 'play' || uid !== G.hostUid) return;
    decEndRound(null, null, null, 'ホストがこの問題を中止しました');
    decPublish();
  }
}
function decHostTick() {
  const G = Dec.G;
  if (!Dec.isHost || !G || G.status !== 'play' || G.pending || !G.turnEnds || Date.now() < G.turnEnds) return;
  const p = decPlayer(G.turn);
  decLog({ t: 'sys', text: `${p ? p.name : '？'} の時間切れ。次の人の番です` });
  decNextTurn(G.turn);
  decPublish();
}

// 自分の操作：ホストならそのまま処理、ほかの人はホストへ送る
function decAct(m) {
  if (Dec.isHost) decHostHandle(Dec.me.uid, m);
  else if (Dec.net) Dec.net.send(m);
}

// ---------- 出題者の端末の処理 ----------
// 答えを持っているのは出題者（コンピューターならホスト）だけ。それ以外になったら忘れる
function decKeepSecret() {
  const G = Dec.G;
  if (!G) return;
  const mine = G.master === Dec.me.uid || (G.master === DEC_CPU && Dec.isHost);
  if (!mine) Dec.secret = null;
  else if (G.master !== DEC_CPU && G.status === 'over' && Dec.secret && G.answerId === Dec.secret.id) Dec.secret = null;   // 終わった問題の答えは、次の問題に持ち越さない
}
// 出題者：答えが出されたら判定する。当たりが2つ以上なら、どれを開示するか選んでもらう（画面の decRenderPending）
function decMasterAuto() {
  const G = Dec.G, pd = G && G.pending, a = Dec.secret;
  if (!decIsMaster() || !pd || !a || Dec.judged === pd.n) return;
  const c = DB.byId.get(pd.id);
  if (!c) return;
  if (decIsAnswer(c, a)) { decSendJudge({ correct: true, answerId: a.id, all: decAllTexts(a) }); return; }
  const hit = decMatches(c, a), fresh = Object.keys(hit).filter(k => G.revealed[k] == null);
  if (fresh.length === 1) decSendJudge({ k: fresh[0], text: hit[fresh[0]] });
  else if (!fresh.length) decSendJudge({ old: Object.keys(hit).length > 0 });
  // 2つ以上：選ぶまで待つ
}
function decSendJudge(j) {
  const pd = Dec.G.pending;
  if (!pd) return;
  Dec.judged = pd.n;
  decAct({ kind: 'judge', n: pd.n, ...j });
}

// ---------- 部屋に入る・出る ----------
function decStartTimers() {
  clearInterval(Dec.tick);
  Dec.tick = setInterval(() => { decHostTick(); decRenderTurn(); }, 500);
}
async function decCreate(solo) {
  Dec.me = duelMe();
  Dec.solo = !!solo; Dec.isHost = true; Dec.secret = null; Dec.judged = 0;
  Dec.G = decNewState(solo);
  if (!solo) {
    const net = new DecoderNet(Dec.me);
    showLoading('部屋を作っています…');
    try { Dec.code = await net.host(DEC_TEST_CODE || null); } catch (e) { showLoading(''); toast(e.message); return; }
    showLoading('');
    Dec.net = net;
    net.onMsg = m => { if (m.from && m.from !== Dec.me.uid) decHostHandle(m.from, m); };
  } else Dec.code = null;
  decLockBack();
  decLog({ t: 'sys', text: solo ? 'ひとりで遊ぶ部屋です（コンピューターが出題します）。「スタート」で始めます' : '部屋を作りました。部屋コードを友だちに教えて、出題者を決めてください' });
  Dec.shownN = 0;
  decStartTimers();
  renderDecoder(true);
}
async function decJoin(code) {
  code = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(code)) { toast('部屋コードを入れてください'); return; }
  Dec.me = duelMe();
  const net = new DecoderNet(Dec.me);
  showLoading('部屋をさがしています…');
  try {
    await net.enter(code);
    net.onLost = () => { toast('部屋を作った人との接続が切れました'); decLeave(true); };
    net.onMsg = m => {
      if (m.kind !== 'state' || m.from !== net.hostUid || !m.g) return;
      Dec.G = m.g; Dec.recvAt = Date.now();
      if (Dec.joinWait && m.g.players.some(p => p.uid === Dec.me.uid)) Dec.joinWait();
      if (Dec.net) renderDecoder();
    };
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { Dec.joinWait = null; reject(new Error('部屋に入れませんでした（部屋を作った人がアプリを閉じていないか確認してください）')); }, 10000);
      Dec.joinWait = () => { clearTimeout(timer); Dec.joinWait = null; resolve(); };
      net.send({ kind: 'join', me: Dec.me });
    });
  } catch (e) { showLoading(''); net.close(); toast(e.message); return; }
  showLoading('');
  Dec.net = net; Dec.code = code; Dec.isHost = false; Dec.solo = false; Dec.secret = null; Dec.judged = 0;
  Dec.shownN = 0;
  store.set('ygo.decLastCode', code);
  decLockBack();
  decStartTimers();
  renderDecoder(true);
}
function decLeave(silent) {
  if (!silent && Dec.isHost && !Dec.solo && Dec.G && Dec.G.players.filter(p => p.online).length > 1 && !confirm('部屋を閉じると、ほかの人も遊べなくなります。閉じますか？')) return;
  clearInterval(Dec.tick);
  if (Dec.net) Dec.net.close();
  Object.assign(Dec, { net: null, G: null, secret: null, code: null, isHost: false, solo: false, backLocked: false });
  renderDecoder(true);
}

// ---------- 画面 ----------
function decCardStats(c, hiKey) {
  const v = decVals(c);
  const row = (k, text) => el('span', { class: 'dec-stat' + (k === hiKey ? ' hit' : '') }, text);
  return el('div', { class: 'dec-stats' },
    row('frame', typeLine(c)),
    isMonster(c) ? el('div', null, row('attr', v.attr.text), ' ', row('level', v.level.text)) : null,
    isMonster(c) ? el('div', null, row('atk', 'ATK ' + v.atk.text), v.def ? [' ', row('def', 'DEF ' + v.def.text)] : [' ', el('span', { class: 'muted' }, linkArrowsText(c))]) : null,
    el('div', null, row('theme', 'テーマ：' + v.theme.text)));
}
const decCardView = (c, cls) => el('div', { class: 'dec-cardbox ' + (cls || '') }, cardFace(c));

function renderDecoder(full) {
  const root = $('#dec-root');
  if (!root) return;
  if (!Dec.G) { root.innerHTML = ''; root.append(decLobby()); return; }
  decKeepSecret();
  if (full || !$('#dec-room', root)) {
    root.innerHTML = '';
    root.append(decRoomSkeleton());
    Dec.shownN = 0;
  }
  decRenderSide(); decRenderSlots(); decRenderMaster(); decRenderPending(); decRenderLog(); decRenderTurn(); decRenderSuggest(); decRenderCands();
  decMasterAuto();
}

// ---------- 候補（まだ答えの可能性があるカード） ----------
// この問題で出たカードと、その結果から、答えではありえないカードを除く
//   ・出たカード（はずれ）そのもの
//   ・開示された項目：そのカードと比べたとき、同じ項目が同じ文で当たりになるカードだけ残す
//   ・はずれ（当たりなし）：そのカードと1つでも同じ項目があるカードは除く
//   ・当たりはもう開示済み：そのカードとの当たりが、開示済みの項目だけのカードを残す
function decCandList() {
  const G = Dec.G;
  if (!G || G.status !== 'play') return null;
  const guesses = G.log.filter(e => e.t === 'guess' && e.r === G.round && !e.correct).map(e => ({ e, c: DB.byId.get(e.id) })).filter(x => x.c);
  const tried = new Set(guesses.map(x => x.c.name));
  const pf = G.master === DEC_CPU && G.settings.pool !== 'deck' ? (DEC_POOLS[G.settings.pool] || DEC_POOLS.all)[1] : () => true;
  const rev = Object.entries(G.revealed).filter(([k]) => k !== 'theme');
  const out = [];
  for (const c of DB.cards) {
    if (!decUsable(c) || !(c.cid || c.special) || c.pre || tried.has(c.name) || !pf(c)) continue;
    const v = decVals(c);
    if (rev.some(([k, t]) => !v[k] || v[k].text !== t)) continue;
    if (G.hint && G.hint.k === 'theme' && v.theme.text !== G.hint.text) continue;   // 最初のヒントのテーマは、答えのテーマ全部
    let ok = true;
    for (const { e, c: g } of guesses) {
      const m = decMatches(g, c), keys = Object.keys(m);
      if (e.reveal) ok = m[e.reveal.k] === e.reveal.text;
      else if (e.old) ok = keys.length > 0 && keys.every(k => G.revealed[k] != null);
      else ok = !keys.length;
      if (!ok) break;
    }
    if (ok) out.push(c);
  }
  return out;
}
const DEC_CAND_MAX = 300;
function decRenderCands() {
  const box = $('#dec-cands-box'), G = Dec.G;
  if (!box || !G) return;
  const key = G.status + ':' + G.round + ':' + G.seq + ':' + Object.keys(G.revealed).length;
  if (Dec.candKey !== key) { Dec.candKey = key; Dec.cands = decCandList(); }
  const list = Dec.cands, q = normalizeText($('#dec-cand-q').value || '');
  const shown = list ? (q ? list.filter(c => c.key.includes(q)) : list) : [];
  const count = list ? `${list.length.toLocaleString()}枚` : '';
  $('#dec-cand-count').textContent = list ? `候補 ${count}` + (q ? `（名前で絞って ${shown.length}枚）` : '') : '候補';
  const mt = $('#dec-mt-cands');
  if (mt) mt.textContent = '🔍 候補' + (list ? `（${count}）` : '');
  const ul = $('#dec-cand-list');
  ul.innerHTML = '';
  if (!list) { ul.append(el('li', { class: 'muted', text: '問題が始まると、まだ答えの可能性があるカードがここに出ます' })); return; }
  const mine = decMyTurn();
  for (const c of shown.slice(0, DEC_CAND_MAX)) {
    ul.append(el('li', { class: 'dec-cand', dataset: { cid: c.id } }, rowMark(c),
      el('div', { class: 'dec-cand-body' }, el('div', { class: 'dec-cand-name', text: c.name }), el('small', { class: 'muted', text: [typeLine(c), isMonster(c) ? `${ATTR[c.attr] || ''} ${levelText(c)} ${statText(c)}` : ''].filter(Boolean).join('　') })),
      mine ? el('button', { class: 'btn small primary', text: '答える', onclick: () => decSendGuess(c) }) : null));
  }
  if (shown.length > DEC_CAND_MAX) ul.append(el('li', { class: 'muted small-note', text: `ほか ${shown.length - DEC_CAND_MAX}枚（名前で絞ってください）` }));
}

// ---------- 戻るボタン（部屋にいる間は使えない） ----------
function decLockBack() {
  if (Dec.backLocked) return;
  Dec.backLocked = true;
  history.pushState({ decRoom: 1 }, '');
}
window.addEventListener('popstate', () => {
  if (!Dec.backLocked) return;
  if (!Dec.G) { Dec.backLocked = false; return; }
  history.pushState({ decRoom: 1 }, '');   // 戻る前の状態に置き直す
  toast('デコーダーの部屋にいる間は、戻るボタンは使えません');
});

function decLobby() {
  const name = el('input', { type: 'text', maxlength: '20', value: duelMe().name, placeholder: '表示名' });
  name.addEventListener('change', () => { try { localStorage.setItem('ygo.duelName', name.value.trim().slice(0, 20) || 'プレイヤー'); } catch { /* 保存できなくてもよい */ } });
  const code = el('input', { type: 'text', class: 'room-input', maxlength: '8', placeholder: 'コード', value: store.get('ygo.decLastCode', '') });
  return el('div', { class: 'duel-lobby' }, el('div', { class: 'duel-card' },
    el('h2', { text: 'カードデコーダー' }),
    el('p', { class: 'muted', text: '部屋の中の1人が「出題者」になって答えのカードを決め、ほかの人が順番にカード名を出して当てるゲームです。出したカードと同じ項目（属性・種族・レベル・攻撃力・テーマなど）があると「当たり」。当たりが複数あるときは、出題者がその中から1つだけ選んで開示します。答えのカードを出した人の勝ちです。' }),
    el('label', { class: 'auth-field' }, '表示名', name),
    el('div', { class: 'duel-actions' },
      el('div', { class: 'duel-box' }, el('h3', { text: '部屋を作る' }),
        el('p', { class: 'muted small-note', text: '部屋コードを友だちに教えて、同じ部屋に入ってもらいます。' }),
        el('button', { class: 'btn primary', text: '部屋を作る', onclick: () => decCreate(false) }),
        el('button', { class: 'btn', text: 'ひとりで遊ぶ（コンピューターが出題）', onclick: () => decCreate(true) })),
      el('div', { class: 'duel-box' }, el('h3', { text: '部屋に入る' }), code,
        el('button', { class: 'btn primary', text: '入る', onclick: () => decJoin(code.value) }))),
  ));
}

function decRoomSkeleton() {
  const input = el('input', { type: 'text', id: 'dec-input', maxlength: '200', autocomplete: 'off', placeholder: 'チャット' });
  input.addEventListener('input', decRenderSuggest);
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault(); decSubmit();
  });
  const candQ = el('input', { type: 'search', id: 'dec-cand-q', autocomplete: 'off', placeholder: '候補を名前で絞る' });
  candQ.addEventListener('input', decRenderCands);
  // スマホ：「ゲーム」「候補」をタブで切り替える（デッキ作成と同じ形）
  const tabs = el('div', { class: 'mobile-tabs dec-mtabs' },
    el('button', { class: 'on', dataset: { pane: 'game' }, text: '🎮 ゲーム' }),
    el('button', { id: 'dec-mt-cands', dataset: { pane: 'cands' }, text: '🔍 候補' }));
  tabs.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    tabs.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    $('#dec-room').dataset.pane = b.dataset.pane;
    window.scrollTo(0, 0);
  });
  return el('div', { class: 'dec-room', id: 'dec-room', dataset: { pane: 'game' } },
    tabs,
    el('aside', { class: 'dec-cands', id: 'dec-cands-box' },
      el('div', { class: 'dec-cand-head' }, el('b', { id: 'dec-cand-count', text: '候補' }),
        el('div', { class: 'muted small-note', text: 'この問題で出たカードと、開示された情報から、答えではありえないカードを除いています' }), candQ),
      el('ul', { class: 'dec-cand-list', id: 'dec-cand-list' })),
    el('aside', { class: 'dec-side', id: 'dec-side' }),
    el('div', { class: 'dec-main' },
      el('div', { class: 'dec-answer' }, el('div', { class: 'dec-answer-card', id: 'dec-answer-card' }), el('div', { class: 'dec-slots', id: 'dec-slots' })),
      el('div', { class: 'dec-master', id: 'dec-master', hidden: true }),
      el('div', { class: 'dec-turn', id: 'dec-turn' }),
      el('div', { class: 'dec-pending', id: 'dec-pending', hidden: true }),
      el('ul', { class: 'dec-log', id: 'dec-log' }),
      el('div', { class: 'dec-inputbar' },
        el('div', { class: 'dec-suggest', id: 'dec-suggest', hidden: true }),
        input,
        el('button', { class: 'btn primary', text: '送る', onclick: decSubmit }))));
}

function decRenderSide() {
  const G = Dec.G, box = $('#dec-side');
  box.innerHTML = '';
  const playing = G.status === 'play';
  if (Dec.code) box.append(el('div', { class: 'duel-box' }, el('div', { class: 'muted small-note', text: '部屋コード' }),
    el('div', { class: 'room-code', text: Dec.code }),
    el('button', { class: 'btn small', text: 'コードをコピー', onclick: () => navigator.clipboard.writeText(Dec.code).then(() => toast('コピーしました')) })));
  box.append(el('div', { class: 'duel-box' }, el('h3', { text: 'プレイヤー' }),
    el('ul', { class: 'dec-players' }, G.players.map(p => el('li', { class: (p.uid === G.turn ? 'turn ' : '') + (p.online ? '' : 'off') },
      el('span', { text: (p.uid === G.turn ? '▶ ' : '') + (p.uid === G.master ? '🎯 ' : '') + p.name + (p.uid === Dec.me.uid ? '（あなた）' : '') + (p.uid === G.hostUid ? ' 👑' : '') + (p.online ? '' : '（抜けた）') }),
      el('b', { text: `${p.wins || 0}勝` })))),
    el('div', { class: 'muted small-note', text: `🎯 出題者：${G.master ? decMasterName(G) : 'まだ決まっていません'}` })));
  // 出題者を決める（問題の途中は変えられない）
  if (!playing) {
    const btns = [];
    if (G.master !== Dec.me.uid) btns.push(el('button', { class: 'btn' + (G.master ? '' : ' primary'), text: '自分が出題する', onclick: () => decAct({ kind: 'master' }) }));
    if (Dec.isHost && G.master !== DEC_CPU) btns.push(el('button', { class: 'btn', text: 'コンピューターが出題', onclick: () => decAct({ kind: 'master', cpu: true }) }));
    if (btns.length) box.append(el('div', { class: 'duel-box' }, el('h3', { text: '出題者' }), ...btns));
  } else if (decIsMaster()) {
    box.append(el('button', { class: 'btn', text: 'ギブアップ（答えを開示）', onclick: () => { if (confirm('この問題を終わりにして答えを開示しますか？')) decAct({ kind: 'giveup', answerId: Dec.secret && Dec.secret.id, all: Dec.secret && decAllTexts(Dec.secret) }); } }));
  }
  if (Dec.isHost) {
    const sel = (opts, val, onChange, dis) => {
      const s = el('select', { disabled: dis ? true : null }, Object.entries(opts).map(([k, v]) => el('option', { value: k, text: Array.isArray(v) ? v[0] : v })));
      s.value = String(val);
      s.addEventListener('change', () => onChange(s.value));
      return s;
    };
    const cpu = G.master === DEC_CPU;
    box.append(el('div', { class: 'duel-box' }, el('h3', { text: '設定（ホスト）' }),
      el('label', { class: 'auth-field' }, '1人の持ち時間', sel(DEC_LIMITS, G.settings.limit, v => { G.settings.limit = +v; store.set('ygo.decLimit', +v); decPublish(); }, playing)),
      cpu ? el('label', { class: 'auth-field' }, 'コンピューターの出題の範囲', sel(DEC_POOLS, G.settings.pool, v => { G.settings.pool = v; store.set('ygo.decPool', v); decPublish(); }, playing)) : null,
      cpu ? (() => {
        const cb = el('input', { type: 'checkbox', disabled: playing ? true : null });
        cb.checked = !!G.settings.hint;
        cb.addEventListener('change', () => { G.settings.hint = cb.checked; store.set('ygo.decHint', cb.checked); decPublish(); });
        return el('label', { class: 'check', title: '1人目が答える前に、答えの項目を1つランダムに開示します' }, cb, '最初に1つ開示する');
      })() : null,
      cpu && !playing ? el('button', { class: 'btn primary', text: G.round ? '次の問題' : 'スタート', onclick: decCpuStart }) : null,
      cpu && playing ? el('button', { class: 'btn', text: 'ギブアップ（答えを見る）', onclick: () => { if (confirm('この問題を終わりにして答えを見ますか？')) decAct({ kind: 'giveup', answerId: Dec.secret && Dec.secret.id, all: Dec.secret && decAllTexts(Dec.secret) }); } }) : null,
      !cpu && playing && !decIsMaster() ? el('button', { class: 'btn', text: 'この問題を中止', onclick: () => { if (confirm('この問題を中止しますか？（答えは開示されません）')) decAct({ kind: 'abort' }); } }) : null));
  }
  box.append(el('button', { class: 'btn', text: Dec.isHost && !Dec.solo ? '部屋を閉じる' : '部屋を出る', onclick: () => decLeave() }));
}

// 答えの欄：開示した項目。出題者には、答えのカードと全部の項目が見える（まだ開示していない項目は薄く）
function decRenderSlots() {
  const G = Dec.G, box = $('#dec-slots'), ans = $('#dec-answer-card');
  box.innerHTML = ''; ans.innerHTML = '';
  const a = G.answerId ? DB.byId.get(G.answerId) : (decIsMaster() ? Dec.secret : null);
  ans.append(a ? decCardView(a, 'answer') : el('div', { class: 'dec-cardbox q' }, el('div', { class: 'cardface back' }, el('div', { class: 'cf-name', text: G.status === 'play' ? `第${G.round}問` : '？' }))));
  if (a && !G.answerId) ans.append(el('div', { class: 'muted small-note', text: 'あなただけに見えています' }));
  const mine = decIsMaster() && Dec.secret ? decAllTexts(Dec.secret) : {};
  for (const [k, label] of DEC_FIELDS) {
    const v = G.revealed[k];
    const hidden = v == null && mine[k] != null;
    box.append(el('div', { class: 'dec-slot' + (v != null ? ' open' : '') + (hidden ? ' secret' : '') }, el('small', { text: label + (hidden ? '（未開示）' : '') }), el('b', { text: v != null ? v : hidden ? mine[k] : '？' })));
  }
}

// 出題者：問題の前に答えのカードを選ぶ
function decRenderMaster() {
  const G = Dec.G, box = $('#dec-master');
  const show = decIsMaster() && G.status !== 'play';
  box.hidden = !show;
  if (!show) { Dec.pickBuilt = false; return; }
  if (Dec.pickBuilt) { decRenderPickInfo(); return; }
  Dec.pickBuilt = true;
  box.innerHTML = '';
  const input = el('input', { type: 'text', id: 'dec-pick-input', autocomplete: 'off', placeholder: '答えにするカード名を入れて選ぶ（ほかの人には見えません）' });
  const sug = el('div', { class: 'dec-suggest down', id: 'dec-pick-sug', hidden: true });
  input.addEventListener('input', () => {
    sug.innerHTML = '';
    const list = decCandidates(input.value.trim());
    sug.hidden = !list.length;
    for (const c of list) sug.append(el('button', { type: 'button', class: 'dec-sug', onclick: () => { Dec.secret = c; input.value = ''; sug.hidden = true; renderDecoder(); } }, rowMark(c), el('span', { text: c.name }), el('small', { class: 'muted', text: typeLine(c) })));
  });
  const pool = el('select', null, Object.entries(DEC_POOLS).map(([k, v]) => el('option', { value: k, text: v[0] })));
  pool.value = store.get('ygo.decPool', 'all');
  pool.addEventListener('change', () => store.set('ygo.decPool', pool.value));
  box.append(el('h3', { text: '🎯 あなたが出題者です。答えのカードを決めてください' }),
    el('div', { class: 'dec-pick' }, input, sug),
    el('div', { class: 'dec-pick-row' }, el('span', { class: 'muted small-note', text: 'ランダムに選ぶ：' }), pool,
      el('button', { class: 'btn small', text: 'ランダム', onclick: () => { const list = decPool(pool.value); if (!list.length) { toast('選べるカードがありません'); return; } Dec.secret = decRandom(list); renderDecoder(); } })),
    el('div', { class: 'dec-pick-row', id: 'dec-pick-info' }));
  decRenderPickInfo();
}
function decRenderPickInfo() {
  const box = $('#dec-pick-info');
  if (!box) return;
  box.innerHTML = '';
  const others = Dec.G.players.some(p => p.online && p.uid !== Dec.me.uid);
  // 最初に開示する項目（1人目が答える前に全員に見せる）
  let hintSel = null;
  if (Dec.secret) {
    const all = decAllTexts(Dec.secret);
    hintSel = el('select', { title: '1人目が答える前に、全員に開示する項目' },
      el('option', { value: '', text: '最初は開示しない' }),
      DEC_FIELDS.filter(([k]) => all[k] != null).map(([k, l]) => el('option', { value: k, text: `${l}：${all[k]}` })));
    if (Dec.hintKey && all[Dec.hintKey] != null) hintSel.value = Dec.hintKey;
    hintSel.addEventListener('change', () => { Dec.hintKey = hintSel.value; });
  }
  const start = () => {
    const all = decAllTexts(Dec.secret), k = hintSel && hintSel.value;
    Dec.judged = 0;
    decAct({ kind: 'start', hint: k ? { k, text: all[k] } : null });
  };
  box.append(el('span', { text: Dec.secret ? `答え：「${Dec.secret.name}」` : 'まだ選んでいません' }),
    hintSel ? el('label', { class: 'dec-hint-pick' }, el('span', { class: 'muted small-note', text: '最初に開示する項目' }), hintSel) : null,
    el('button', { class: 'btn primary', text: 'このカードで出題する', disabled: Dec.secret && others ? null : true, onclick: start }),
    others ? null : el('span', { class: 'muted small-note', text: '（答える人が入るのを待っています）' }));
}

// 出されたカード（判定待ち）。出題者には、開示する項目を選ぶボタンを出す
function decRenderPending() {
  const G = Dec.G, box = $('#dec-pending'), pd = G.pending;
  const key = pd ? pd.n + ':' + (decIsMaster() ? 'm' : '') : '';
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = '';
  box.hidden = !pd;
  if (!pd) return;
  const c = DB.byId.get(pd.id);
  const body = el('div', { class: 'dec-guess-body' },
    el('div', null, el('b', { text: pd.name }), ' が出したカード'),
    el('div', { class: 'dec-guess-name', text: c ? c.name : '？' }),
    c ? decCardStats(c) : null);
  if (decIsMaster() && Dec.secret && c && !decIsAnswer(c, Dec.secret)) {
    const hit = decMatches(c, Dec.secret), fresh = Object.keys(hit).filter(k => G.revealed[k] == null);
    if (fresh.length > 1) {
      body.append(el('div', { class: 'dec-res hit', text: `当たりが${fresh.length}つあります。開示する項目を1つ選んでください` }),
        el('div', { class: 'dec-choices' }, fresh.map(k => el('button', { class: 'btn small', onclick: () => decSendJudge({ k, text: hit[k] }) }, `${DEC_FIELDS.find(f => f[0] === k)[1]}：${hit[k]}`))));
    }
  } else body.append(el('div', { class: 'muted', text: G.master === DEC_CPU ? '判定中…' : '出題者が判定しています…' }));
  box.append(c ? decCardView(c, 'small') : null, body);
}

function decLogEntry(e) {
  if (e.t === 'sys') return el('li', { class: 'sys', text: e.text });
  if (e.t === 'chat') return el('li', { class: 'chat' + (e.uid === Dec.me.uid ? ' me' : '') }, el('b', { text: e.name + '：' }), e.text);
  const c = DB.byId.get(e.id);
  const label = DEC_FIELDS.find(f => e.reveal && f[0] === e.reveal.k);
  const res = e.correct ? el('div', { class: 'dec-res ok', text: '🎉 正解！' })
    : e.reveal ? el('div', { class: 'dec-res hit', text: `当たり！ ${label ? label[1] : ''}を開示：${e.reveal.text}` })
      : el('div', { class: 'dec-res miss', text: e.old ? '当たりはもう開示済みの項目だけでした' : 'はずれ' });
  return el('li', { class: 'guess' + (e.uid === Dec.me.uid ? ' me' : '') },
    c ? decCardView(c, 'small') : null,
    el('div', { class: 'dec-guess-body' },
      el('div', null, el('b', { text: e.name }), ' が出したカード'),
      el('div', { class: 'dec-guess-name', text: c ? c.name : '？' }),
      c ? decCardStats(c, e.reveal && e.reveal.k) : null,
      res));
}
function decRenderLog() {
  const G = Dec.G, ul = $('#dec-log');
  const near = ul.scrollHeight - ul.scrollTop - ul.clientHeight < 80;
  const fresh = G.log.filter(e => e.n > Dec.shownN);
  for (const e of fresh) ul.append(decLogEntry(e));
  if (fresh.length) Dec.shownN = fresh[fresh.length - 1].n;
  while (ul.children.length > DEC_LOG_MAX) ul.firstChild.remove();
  if (fresh.length && (near || fresh.some(e => e.uid === Dec.me.uid))) ul.scrollTop = ul.scrollHeight;
}
function decRenderTurn() {
  const G = Dec.G, box = $('#dec-turn');
  if (!G || !box) return;
  const left = G.turnLeft ? Math.max(0, Math.ceil((G.turnLeft - (Date.now() - Dec.recvAt)) / 1000)) : 0;
  const tail = G.turnLeft ? `（残り ${left}秒）` : '';
  let text = '', mine = false;
  if (G.status === 'play') {
    mine = decMyTurn();
    const p = decPlayer(G.turn);
    if (G.pending) text = decIsMaster() ? `${G.pending.name} が答えました。判定してください` : `${G.pending.name} が答えました`;
    else if (decIsMaster()) text = `あなたは出題者です。${p ? p.name : '？'} の番です${tail}`;
    else text = mine ? `あなたの番です！ カード名を入れて答えてください${tail}` : `${p ? p.name : '？'} の番です${tail}`;
  } else if (G.status === 'over') text = G.winner ? `${(decPlayer(G.winner) || {}).name || '？'} の勝ち！ 出題者が決まったら次の問題です` : 'この問題は終わりました';
  else text = G.master ? `出題者（${decMasterName(G)}）が答えのカードを決めるのを待っています` : '出題者を決めてください（「自分が出題する」）';
  if (G.status !== 'play' && G.master === DEC_CPU) text = Dec.isHost ? '「スタート」を押すと、コンピューターが出題します' : 'ホストが問題を始めるのを待っています';
  if (box.textContent !== text) box.textContent = text;
  box.classList.toggle('mine', mine || (decIsMaster() && !!G.pending));
  const input = $('#dec-input');
  if (input) {
    const ph = mine ? 'カード名を入れて答える（候補から選ぶ）／チャット' : 'チャット';
    if (input.placeholder !== ph) { input.placeholder = ph; decRenderSuggest(); }
  }
}

// 自分の番：入力に合うカードの候補を出す。選ぶと答えになる
function decCandidates(q) {
  if (!q || typeof searchCards !== 'function') return [];
  return searchCards({ q }).filter(decUsable).slice(0, 8);
}
function decRenderSuggest() {
  const box = $('#dec-suggest'), input = $('#dec-input');
  if (!box || !input) return;
  box.innerHTML = '';
  const list = decMyTurn() ? decCandidates(input.value.trim()) : [];
  box.hidden = !list.length;
  for (const c of list) box.append(el('button', { type: 'button', class: 'dec-sug', onclick: () => decSendGuess(c) }, rowMark(c), el('span', { text: c.name }), el('small', { class: 'muted', text: typeLine(c) })));
}
function decSendGuess(c) {
  if (!decMyTurn()) { toast('自分の番になってから答えてください'); return; }
  const input = $('#dec-input');
  if (input) input.value = '';
  decAct({ kind: 'guess', id: c.id });
  decRenderSuggest();
}
function decSubmit() {
  const input = $('#dec-input');
  const text = input.value.trim();
  if (!text) return;
  // 自分の番で、カード名がそのまま入っていれば答えにする。それ以外はチャット
  if (decMyTurn()) {
    const n = normalizeText(text);
    const c = decCandidates(text).find(x => x.nkey === n || normalizeText(x.name) === n);
    if (c) { decSendGuess(c); return; }
  }
  input.value = '';
  decAct({ kind: 'chat', text });
  decRenderSuggest();
}

const DEC_TEST_CODE = new URLSearchParams(location.search).get('decCode');
