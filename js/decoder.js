// カードデコーダー（複数人で遊ぶカード当てゲーム）
// ・部屋を作った人（ホスト）のアプリが、答えのカードを1枚こっそり選ぶ（ホストの画面にも出さない）
// ・順番にチャットでカード名を出して答える。出したカードはイラストとステータスが表示される
// ・出したカードと答えのカードで、同じ項目（属性・種族・レベル・攻撃力など）があれば「当たり」。
//   当たりが複数あっても、まだ開示していない当たりの中から1つだけを全員に開示する
// ・答えのカードそのものを出した人の勝ち。ホストが「次の問題」で続ける
// 通信は対戦と同じ公開の中継サーバー（MQTT）。ホストのアプリが状態を持ち、全員に送る。
//   <base>/dec/<コード>/alive ：部屋があるしるし（ホストが落ちると消える）
//   <base>/dec/<コード>/msg   ：やり取り（参加者 → ホスト：join / chat / guess / bye、ホスト → 全員：state）

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
  deck: ['ホストの今のデッキから', null],
};
const DEC_LIMITS = { 0: 'なし', 30: '30秒', 60: '60秒', 120: '2分' };
const DEC_LOG_MAX = 200;

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
function decVals(c) {
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

// 出したカード g と答え a で当たっている項目 → { key: 開示する文 }
function decMatches(g, a) {
  const vg = decVals(g), va = decVals(a), out = {};
  for (const [k] of DEC_FIELDS) {
    if (k === 'theme') {
      const same = va.theme.list.filter(t => vg.theme.list.includes(t));
      if (same.length) out.theme = same[Math.floor(Math.random() * same.length)];
      else if (!va.theme.list.length && !vg.theme.list.length) out.theme = 'なし';
      continue;
    }
    if (va[k] && vg[k] && va[k].key === vg[k].key) out[k] = va[k].text;
  }
  return out;
}

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
  secret: null,     // 答えのカード（ホストだけが持つ。画面には出さない）
  recvAt: 0, shownN: 0, shownRound: -1, tick: null, joinWait: null,
};
const decMyTurn = () => !!(Dec.G && Dec.G.status === 'play' && Dec.G.turn === Dec.me.uid);
const decPlayer = uid => Dec.G && Dec.G.players.find(p => p.uid === uid);

function decNewState() {
  return {
    hostUid: Dec.me.uid, status: 'lobby', round: 0, turn: null, starter: null, winner: null,
    players: [{ uid: Dec.me.uid, name: Dec.me.name, wins: 0, online: true }],
    revealed: {}, answerId: null, log: [], seq: 0,
    settings: { pool: store.get('ygo.decPool', 'all'), limit: store.get('ygo.decLimit', 60) },
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
function decNextTurn(from) {
  const G = Dec.G;
  const on = G.players.filter(p => p.online);
  if (!on.length) { G.turn = null; return; }
  const all = G.players;
  let i = all.findIndex(p => p.uid === (from || G.turn));
  for (let k = 0; k < all.length; k++) { i = (i + 1) % all.length; if (all[i].online) break; }
  G.turn = all[i].uid;
  G.turnEnds = G.settings.limit ? Date.now() + G.settings.limit * 1000 : 0;
}
function decPool() {
  const p = Dec.G.settings.pool;
  if (p === 'deck') {
    const d = typeof Decks !== 'undefined' && Decks.current();
    const ids = d ? [...new Set([...(d.main || []), ...(d.extra || [])])] : [];
    return ids.map(id => DB.byId.get(id)).filter(decUsable);
  }
  const f = (DEC_POOLS[p] || DEC_POOLS.all)[1];
  return DB.cards.filter(c => decUsable(c) && c.cid && !c.pre && f(c));
}
function decStartRound() {
  const G = Dec.G;
  const pool = decPool();
  if (!pool.length) { toast(G.settings.pool === 'deck' ? '今のデッキにカードがありません（デッキ作成で選んでいるデッキから出題します）' : '出題できるカードがありません'); return; }
  Dec.secret = pool[Math.floor(Math.random() * pool.length)];
  G.round++; G.status = 'play'; G.revealed = {}; G.answerId = null; G.winner = null;
  // 最初の番は、前の問題で最初だった人の次の人
  const on = G.players.filter(p => p.online);
  if (G.starter && on.length) { G.turn = G.starter; decNextTurn(G.starter); } else { G.turn = on[0] ? on[0].uid : null; G.turnEnds = G.settings.limit ? Date.now() + G.settings.limit * 1000 : 0; }
  G.starter = G.turn;
  decLog({ t: 'sys', text: `第${G.round}問 スタート（出題：${(DEC_POOLS[G.settings.pool] || DEC_POOLS.all)[0]}・${pool.length}枚から）` });
  decPublish();
}
function decRevealAll() {
  const G = Dec.G, a = Dec.secret;
  if (!a) return;
  G.answerId = a.id;
  const v = decVals(a);
  for (const [k] of DEC_FIELDS) if (v[k]) G.revealed[k] = v[k].text;
}
function decGiveUp() {
  const G = Dec.G;
  if (G.status !== 'play') return;
  G.status = 'over'; G.turn = null; G.turnEnds = 0;
  decRevealAll();
  decLog({ t: 'sys', text: `ギブアップ。答えは「${Dec.secret.name}」でした` });
  decPublish();
}
function decGuess(uid, id) {
  const G = Dec.G, a = Dec.secret, c = DB.byId.get(+id), p = decPlayer(uid);
  if (G.status !== 'play' || G.turn !== uid || !decUsable(c) || !a || !p) return;
  const entry = { t: 'guess', uid, name: p.name, id: c.id };
  if (c.id === a.id || c.name === a.name) {
    entry.correct = true;
    p.wins = (p.wins || 0) + 1;
    G.status = 'over'; G.winner = uid; G.turn = null; G.turnEnds = 0;
    decRevealAll();
    decLog(entry);
    decLog({ t: 'sys', text: `🎉 ${p.name} が正解！ 答えは「${a.name}」でした` });
  } else {
    const hit = decMatches(c, a);
    const fresh = Object.keys(hit).filter(k => G.revealed[k] == null);
    if (fresh.length) {
      const k = fresh[Math.floor(Math.random() * fresh.length)];
      G.revealed[k] = hit[k];
      entry.reveal = { k, text: hit[k] };
    } else if (Object.keys(hit).length) entry.old = true;   // 当たりはあったが、もう全部開示している
    decLog(entry);
    decNextTurn(uid);
  }
  decPublish();
}
// 参加者・自分からのメッセージ（ホストが受け取る）
function decHostHandle(uid, m) {
  const G = Dec.G;
  if (m.kind === 'join' && m.me) {
    const name = String(m.me.name || 'プレイヤー').slice(0, 20);
    let p = decPlayer(uid);
    if (p) { p.online = true; p.name = name; decLog({ t: 'sys', text: `${name} が入り直しました` }); }
    else { G.players.push({ uid, name, wins: 0, online: true }); decLog({ t: 'sys', text: `${name} が入りました` }); }
    if (G.status === 'play' && !G.turn) decNextTurn(uid);
    decPublish();
  } else if (m.kind === 'bye') {
    const p = decPlayer(uid);
    if (!p || !p.online) return;
    p.online = false;
    decLog({ t: 'sys', text: `${p.name} が抜けました` });
    if (G.status === 'play' && G.turn === uid) decNextTurn(uid);
    decPublish();
  } else if (m.kind === 'chat') {
    const p = decPlayer(uid), text = String(m.text || '').slice(0, 200).trim();
    if (!p || !text) return;
    decLog({ t: 'chat', uid, name: p.name, text });
    decPublish();
  } else if (m.kind === 'guess') decGuess(uid, m.id);
}
function decHostTick() {
  const G = Dec.G;
  if (!Dec.isHost || !G || G.status !== 'play' || !G.turnEnds || Date.now() < G.turnEnds) return;
  const p = decPlayer(G.turn);
  decLog({ t: 'sys', text: `${p ? p.name : '？'} の時間切れ。次の人の番です` });
  decNextTurn(G.turn);
  decPublish();
}

// 自分の操作：ホストならそのまま処理、参加者ならホストへ送る
function decAct(m) {
  if (Dec.isHost) decHostHandle(Dec.me.uid, m);
  else if (Dec.net) Dec.net.send(m);
}

// ---------- 部屋に入る・出る ----------
function decStartTimers() {
  clearInterval(Dec.tick);
  Dec.tick = setInterval(() => { decHostTick(); decRenderTurn(); }, 500);
}
async function decCreate(solo) {
  Dec.me = duelMe();
  Dec.solo = !!solo; Dec.isHost = true; Dec.secret = null;
  Dec.G = decNewState();
  if (!solo) {
    const net = new DecoderNet(Dec.me);
    showLoading('部屋を作っています…');
    try { Dec.code = await net.host(DEC_TEST_CODE || null); } catch (e) { showLoading(''); toast(e.message); return; }
    showLoading('');
    Dec.net = net;
    net.onMsg = m => { if (m.from && m.from !== Dec.me.uid) decHostHandle(m.from, m); };
  } else Dec.code = null;
  decLog({ t: 'sys', text: solo ? 'ひとりで遊ぶ部屋です。「スタート」で始めます' : '部屋を作りました。部屋コードを友だちに教えてください' });
  Dec.shownN = 0; Dec.shownRound = -1;
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
  Dec.net = net; Dec.code = code; Dec.isHost = false; Dec.solo = false;
  Dec.shownN = 0; Dec.shownRound = -1;
  store.set('ygo.decLastCode', code);
  decStartTimers();
  renderDecoder(true);
}
function decLeave(silent) {
  if (!silent && Dec.isHost && !Dec.solo && Dec.G && Dec.G.players.filter(p => p.online).length > 1 && !confirm('部屋を閉じると、ほかの人も遊べなくなります。閉じますか？')) return;
  clearInterval(Dec.tick);
  if (Dec.net) Dec.net.close();
  Object.assign(Dec, { net: null, G: null, secret: null, code: null, isHost: false, solo: false });
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
function decCardView(c, cls) {
  return el('div', { class: 'dec-cardbox ' + (cls || '') }, cardFace(c));
}

function renderDecoder(full) {
  const root = $('#dec-root');
  if (!root) return;
  if (!Dec.G) { root.innerHTML = ''; root.append(decLobby()); return; }
  if (full || !$('#dec-room', root)) {
    root.innerHTML = '';
    root.append(decRoomSkeleton());
    Dec.shownN = 0; Dec.shownRound = -1;
  }
  decRenderSide(); decRenderSlots(); decRenderLog(); decRenderTurn(); decRenderSuggest();
}

function decLobby() {
  const name = el('input', { type: 'text', maxlength: '20', value: duelMe().name, placeholder: '表示名' });
  name.addEventListener('change', () => { try { localStorage.setItem('ygo.duelName', name.value.trim().slice(0, 20) || 'プレイヤー'); } catch { /* 保存できなくてもよい */ } });
  const code = el('input', { type: 'text', class: 'room-input', maxlength: '8', placeholder: 'コード', value: store.get('ygo.decLastCode', '') });
  return el('div', { class: 'duel-lobby' }, el('div', { class: 'duel-card' },
    el('h2', { text: 'カードデコーダー' }),
    el('p', { class: 'muted', text: '隠された1枚のカードを、みんなで順番にカード名を出して当てるゲームです。出したカードと同じ項目（属性・種族・レベル・攻撃力・テーマなど）があると「当たり」になり、当たりの中から1つだけが全員に開示されます。答えのカードを出した人の勝ちです。' }),
    el('label', { class: 'auth-field' }, '表示名', name),
    el('div', { class: 'duel-actions' },
      el('div', { class: 'duel-box' }, el('h3', { text: '部屋を作る' }),
        el('p', { class: 'muted small-note', text: '部屋コードを友だちに教えて、同じ部屋に入ってもらいます。' }),
        el('button', { class: 'btn primary', text: '部屋を作る', onclick: () => decCreate(false) }),
        el('button', { class: 'btn', text: 'ひとりで遊ぶ', onclick: () => decCreate(true) })),
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
  return el('div', { class: 'dec-room', id: 'dec-room' },
    el('aside', { class: 'dec-side', id: 'dec-side' }),
    el('div', { class: 'dec-main' },
      el('div', { class: 'dec-answer' }, el('div', { class: 'dec-answer-card', id: 'dec-answer-card' }), el('div', { class: 'dec-slots', id: 'dec-slots' })),
      el('div', { class: 'dec-turn', id: 'dec-turn' }),
      el('ul', { class: 'dec-log', id: 'dec-log' }),
      el('div', { class: 'dec-inputbar' },
        el('div', { class: 'dec-suggest', id: 'dec-suggest', hidden: true }),
        input,
        el('button', { class: 'btn primary', text: '送る', onclick: decSubmit }))));
}

function decRenderSide() {
  const G = Dec.G, box = $('#dec-side');
  box.innerHTML = '';
  if (Dec.code) box.append(el('div', { class: 'duel-box' }, el('div', { class: 'muted small-note', text: '部屋コード' }),
    el('div', { class: 'room-code', text: Dec.code }),
    el('button', { class: 'btn small', text: 'コードをコピー', onclick: () => navigator.clipboard.writeText(Dec.code).then(() => toast('コピーしました')) })));
  box.append(el('div', { class: 'duel-box' }, el('h3', { text: 'プレイヤー' }),
    el('ul', { class: 'dec-players' }, G.players.map(p => el('li', { class: (p.uid === G.turn ? 'turn ' : '') + (p.online ? '' : 'off') },
      el('span', { text: (p.uid === G.turn ? '▶ ' : '') + p.name + (p.uid === Dec.me.uid ? '（あなた）' : '') + (p.uid === G.hostUid ? ' 👑' : '') + (p.online ? '' : '（抜けた）') }),
      el('b', { text: `${p.wins || 0}勝` }))))));
  if (Dec.isHost) {
    const playing = G.status === 'play';
    const sel = (key, opts, val, onChange) => {
      const s = el('select', { disabled: playing ? true : null }, Object.entries(opts).map(([k, v]) => el('option', { value: k, text: Array.isArray(v) ? v[0] : v })));
      s.value = String(val);
      s.addEventListener('change', () => onChange(s.value));
      return s;
    };
    box.append(el('div', { class: 'duel-box' }, el('h3', { text: '設定（ホスト）' }),
      el('label', { class: 'auth-field' }, '出題の範囲', sel('pool', DEC_POOLS, G.settings.pool, v => { G.settings.pool = v; store.set('ygo.decPool', v); decPublish(); })),
      el('label', { class: 'auth-field' }, '1人の持ち時間', sel('limit', DEC_LIMITS, G.settings.limit, v => { G.settings.limit = +v; store.set('ygo.decLimit', +v); decPublish(); })),
      playing ? el('button', { class: 'btn', text: 'ギブアップ（答えを見る）', onclick: () => { if (confirm('この問題を終わりにして答えを見ますか？')) decGiveUp(); } })
        : el('button', { class: 'btn primary', text: G.round ? '次の問題' : 'スタート', onclick: decStartRound })));
  } else if (G.status !== 'play') box.append(el('p', { class: 'muted small-note', text: 'ホストが問題を始めるのを待っています' }));
  box.append(el('button', { class: 'btn', text: Dec.isHost && !Dec.solo ? '部屋を閉じる' : '部屋を出る', onclick: () => decLeave() }));
}

function decRenderSlots() {
  const G = Dec.G, box = $('#dec-slots'), ans = $('#dec-answer-card');
  box.innerHTML = ''; ans.innerHTML = '';
  const a = G.answerId && DB.byId.get(G.answerId);
  ans.append(a ? decCardView(a, 'answer') : el('div', { class: 'dec-cardbox q' }, el('div', { class: 'cardface back' }, el('div', { class: 'cf-name', text: G.status === 'play' ? `第${G.round}問` : '？' }))));
  for (const [k, label] of DEC_FIELDS) {
    const v = G.revealed[k];
    box.append(el('div', { class: 'dec-slot' + (v != null ? ' open' : '') }, el('small', { text: label }), el('b', { text: v != null ? v : '？' })));
  }
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
    text = mine ? `あなたの番です！ カード名を入れて答えてください${tail}` : `${p ? p.name : '？'} の番です${tail}`;
  } else if (G.status === 'over') text = G.winner ? `${(decPlayer(G.winner) || {}).name || '？'} の勝ち！` + (Dec.isHost ? '「次の問題」で続けます' : '') : '答えを開示しました';
  else text = Dec.isHost ? '「スタート」を押すと問題が始まります' : 'ホストが問題を始めるのを待っています';
  if (box.textContent !== text) box.textContent = text;
  box.classList.toggle('mine', mine);
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
