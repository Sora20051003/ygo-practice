// 対戦（2人のブラウザを直接つなぐ。ログインしていなくてもよい）
// ・部屋を作る → 6文字の部屋コードを相手に教える → 相手が参加 → お互いデッキを選んで「準備OK」で開始
// ・自分の盤面は今までどおり手で動かす。変わるたびに「相手に見せてよい情報だけ」を相手に送る
//   （手札の中身・デッキの順番・裏向きのカードは送らない）
// ・LP・ターン・フェイズ・チャット・コイン・サイコロ・カードの公開・相手へのダメージは、部屋で共有する
// 通信は PeerJS（WebRTC。相手を見つけるときだけ公開の仲介サーバーを使う）。Supabase 用の通信も残してある。テスト用に、同じパソコンの2つの画面でやり取りする仕組みもある（?duelTest=A など）

const PHASES = [['DP', 'ドロー'], ['SP', 'スタンバイ'], ['M1', 'メイン1'], ['BP', 'バトル'], ['M2', 'メイン2'], ['EP', 'エンド']];
const START_LP = 8000;
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 見間違えやすい 0 O 1 I は使わない
const newRoomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => ROOM_CHARS[b % ROOM_CHARS.length]).join('');
const DUEL_TEST = new URLSearchParams(location.search).get('duelTest');

// ---------- 通信（Supabase） ----------
// 部屋：rooms 表（data に部屋の情報）。盤面：room_players 表。出来事（チャットなど）：room_events 表。
// 変わったら Supabase の Realtime で知らせてもらう。参加と部屋の書き換えは、同時に書いても壊れないようサーバー側の関数で行う
class SupabaseDuelTransport {
  constructor(me) { this.me = me; this.sb = Online.sb; this.channel = null; }
  async create() {
    for (let t = 0; t < 5; t++) {
      const code = newRoomCode();
      const data = {
        host: this.me.uid, hostName: this.me.name, guest: null, guestName: null, status: 'waiting',
        ready: {}, decks: {}, turn: 0, turnPlayer: null, phase: 'DP', winner: null, createdAt: Date.now(),
      };
      const { error } = await this.sb.from('rooms').insert({ code, host: this.me.uid, data });
      if (!error) return code;
      if (!/duplicate|unique/i.test(error.message)) throw error;   // 同じコードの部屋があれば作り直す
    }
    throw new Error('部屋を作れませんでした。もう一度お試しください');
  }
  async join(code) {
    const { error } = await this.sb.rpc('join_room', { p_code: code, p_name: this.me.name });
    if (!error) return;
    if (/NO_ROOM/.test(error.message)) throw new Error('その部屋コードの部屋はありません');
    if (/FULL/.test(error.message)) throw new Error('この部屋はもう満員です');
    throw error;
  }
  async listen(code, h) {
    this.code = code;
    const seenEvents = new Set();
    const onEvent = row => { if (!seenEvents.has(row.id)) { seenEvents.add(row.id); h.event(row.data); } };
    const filter = 'code=eq.' + code;
    this.channel = this.sb.channel('room-' + code)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter }, p => { if (p.new && p.new.data) h.room(p.new.data); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter }, p => { if (p.new && p.new.uid !== this.me.uid && p.new.json) h.opp(JSON.parse(p.new.json)); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_events', filter }, p => { if (p.new) onEvent(p.new); })
      .subscribe(status => { if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') h.error(new Error('対戦の通信がつながりませんでした')); });
    // 今の状態を一度読む（つながる前に変わった分も取りこぼさないように）
    const [room, players, events] = await Promise.all([
      this.sb.from('rooms').select('data').eq('code', code).maybeSingle(),
      this.sb.from('room_players').select('uid,json').eq('code', code),
      this.sb.from('room_events').select('id,data').eq('code', code).order('id'),
    ]);
    if (room.error || !room.data) { h.error(room.error || new Error('その部屋コードの部屋はありません')); return; }
    h.room(room.data.data);
    (players.data || []).forEach(p => { if (p.uid !== this.me.uid && p.json) h.opp(JSON.parse(p.json)); });
    (events.data || []).forEach(onEvent);
  }
  async updateRoom(patch) {
    const { error } = await this.sb.rpc('patch_room', { p_code: this.code, p_patch: patch });
    if (error) throw error;
  }
  async sendState(json) {
    const { error } = await this.sb.from('room_players').upsert({ code: this.code, uid: this.me.uid, json, at: new Date().toISOString() });
    if (error) throw error;
  }
  async sendEvent(ev) {
    const { error } = await this.sb.from('room_events').insert({ code: this.code, from_uid: this.me.uid, data: { ...ev, from: this.me.uid, name: this.me.name, ts: Date.now() } });
    if (error) throw error;
  }
  leave() { if (this.channel) this.sb.removeChannel(this.channel); this.channel = null; }
}

// ---------- 通信（サーバーなし：ブラウザどうしを直接つなぐ WebRTC） ----------
// 相手を見つけるときだけ、無料で公開されている仲介サーバー（PeerJS）を使う。つながったあとは2人のブラウザが直接やり取りする。
// 部屋を作った人（ホスト）の画面が部屋の情報を持ち、参加した人に送る。ホストが部屋を閉じると部屋はなくなる
const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
const PEER_PREFIX = 'ygo-practice-room-';
class PeerDuelTransport {
  constructor(me) { this.me = me; this.h = null; this.room = null; this.peer = null; this.conn = null; this.closed = false; }
  async lib() { if (typeof Peer === 'undefined') await loadScript(PEERJS_URL); }
  // 仲介サーバーにつなぐ（id を指定すると、その部屋コードの持ち主になる）
  openPeer(id) {
    return new Promise((resolve, reject) => {
      const p = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
      const timer = setTimeout(() => { p.destroy(); reject(new Error('対戦の仲介サーバーにつながりませんでした。インターネット接続を確認してください')); }, 15000);
      p.on('open', () => { clearTimeout(timer); this.peer = p; resolve(p); });
      p.on('error', e => {
        if (!this.peer) { clearTimeout(timer); p.destroy(); reject(e); return; }
        if (e.type === 'peer-unavailable') return;   // 参加のときに別で扱う
        if (this.h && !this.closed) this.h.error(new Error('通信が切れました（' + (e.type || e.message) + '）'));
      });
      // 仲介サーバーとの接続が切れても、つながっている相手とはそのまま続けられる。部屋を作った人は受付のためにつなぎ直す
      p.on('disconnected', () => { if (!this.closed && this.isHost) setTimeout(() => { try { p.reconnect(); } catch { /* つなぎ直せなくてもよい */ } }, 2000); });
    });
  }
  emitRoom() { if (this.h && this.room) this.h.room(JSON.parse(JSON.stringify(this.room))); }
  send(m) { if (this.conn && this.conn.open) this.conn.send(m); }
  async create(code) {
    await this.lib();
    for (let t = 0; t < 5; t++) {
      const c = code || newRoomCode();
      try { await this.openPeer(PEER_PREFIX + c); this.code = c; break; } catch (e) {
        if (e.type === 'unavailable-id' && !code) continue;   // 同じコードの部屋があれば作り直す
        throw e.type === 'unavailable-id' ? new Error('その部屋コードは今使われています') : e;
      }
    }
    if (!this.code) throw new Error('部屋を作れませんでした。もう一度お試しください');
    this.isHost = true;
    this.room = { host: this.me.uid, hostName: this.me.name, guest: null, guestName: null, status: 'waiting', ready: {}, decks: {}, turn: 0, turnPlayer: null, phase: 'DP', winner: null, createdAt: Date.now() };
    this.peer.on('connection', c => this.accept(c));
    return this.code;
  }
  // 部屋を作った人：参加しに来た相手を受け付ける
  accept(c) {
    c.on('data', m => {
      if (m.kind === 'join') {
        const r = this.room;
        if (r.guest && r.guest !== m.me.uid) { c.send({ kind: 'full' }); setTimeout(() => c.close(), 500); return; }
        const rejoin = r.guest === m.me.uid;
        if (this.conn && this.conn !== c) { try { this.conn.close(); } catch { /* もう閉じている */ } }
        this.conn = c;
        r.guest = m.me.uid; r.guestName = m.me.name;
        c.send({ kind: 'room', room: r });
        if (this.lastState) c.send({ kind: 'state', json: this.lastState });   // 入り直しのときは自分の盤面も送り直す
        this.emitRoom();
        if (rejoin && this.h) this.h.event({ type: 'sys', from: 'sys', name: '', text: `${m.me.name} が入り直しました`, ts: Date.now() });
        return;
      }
      if (c === this.conn) this.recv(m);
    });
    c.on('close', () => { if (c === this.conn && !this.closed && this.h) this.h.error(new Error('相手との接続が切れました（相手が「前回の部屋に戻る」で戻ってこられます）')); });
  }
  async join(code) {
    await this.lib();
    await this.openPeer(null);
    this.code = code;
    const c = this.peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('部屋に入れませんでした（部屋を作った人がアプリを閉じていないか確認してください）')), 15000);
      const fail = e => { clearTimeout(timer); reject(e); };
      this.peer.on('error', e => { if (e.type === 'peer-unavailable') fail(new Error('その部屋コードの部屋はありません（部屋を作った人がアプリを開いている間だけ入れます）')); });
      c.on('open', () => c.send({ kind: 'join', me: this.me }));
      c.on('data', m => {
        if (m.kind === 'full') { fail(new Error('この部屋はもう満員です')); return; }
        if (m.kind === 'room' && !this.room) { clearTimeout(timer); this.room = m.room; this.conn = c; resolve(); }
        this.recv(m);
      });
      c.on('close', () => { if (this.conn === c && !this.closed && this.h) this.h.error(new Error('部屋を作った人との接続が切れました')); });
    });
  }
  recv(m) {
    if (m.kind === 'room') { this.room = m.room; this.emitRoom(); }
    else if (m.kind === 'patch' && this.room) { applyPatch(this.room, m.patch); this.emitRoom(); }
    else if (m.kind === 'state' && this.h) this.h.opp(JSON.parse(m.json));
    else if (m.kind === 'event' && this.h) this.h.event(m.ev);
  }
  listen(code, h) { this.h = h; this.emitRoom(); }
  async updateRoom(patch) { applyPatch(this.room, patch); this.send({ kind: 'patch', patch }); this.emitRoom(); }
  async sendState(json) { this.lastState = json; this.send({ kind: 'state', json }); }
  async sendEvent(ev) {
    const e = { ...ev, from: this.me.uid, name: this.me.name, ts: Date.now() };
    this.send({ kind: 'event', ev: e });
    if (this.h) this.h.event(e);
  }
  leave() { this.closed = true; this.h = null; try { if (this.peer) this.peer.destroy(); } catch { /* もう閉じている */ } }
}

// ---------- 通信（テスト用：同じパソコンの2つの画面） ----------
function applyPatch(obj, patch) {
  for (const [k, v] of Object.entries(patch)) {
    const keys = k.split('.');
    let o = obj;
    for (const kk of keys.slice(0, -1)) o = o[kk] || (o[kk] = {});
    o[keys[keys.length - 1]] = v;
  }
}
class LocalDuelTransport {
  constructor(me) {
    this.me = me; this.h = null; this.room = null;
    // 親ページに中継役（__duelBus）があればそれを使う（自動テスト用）。無ければ BroadcastChannel（同じブラウザの別タブ）
    let bus = null;
    try { if (window.top !== window && window.top.__duelBus) bus = window.top.__duelBus; } catch { /* 別のサイトの中など */ }
    if (bus) {
      bus.listeners.push(this);
      this.ch = { postMessage: m => bus.listeners.forEach(l => { if (l !== this) setTimeout(() => l.recv(JSON.parse(JSON.stringify(m))), 0); }) };
    } else {
      this.ch = new BroadcastChannel('ygo-duel-test');
      this.ch.onmessage = e => this.recv(e.data);
    }
  }
  emitRoom() { if (this.h && this.room) this.h.room(JSON.parse(JSON.stringify(this.room))); }
  async create() {
    this.code = newRoomCode();
    this.room = { host: this.me.uid, hostName: this.me.name, guest: null, guestName: null, status: 'waiting', ready: {}, decks: {}, turn: 0, turnPlayer: null, phase: 'DP', winner: null };
    return this.code;
  }
  async join(code) {
    this.code = code;
    this.ch.postMessage({ code, kind: 'join', me: this.me });
    for (let i = 0; i < 30 && !(this.room && this.room.guest === this.me.uid); i++) await new Promise(r => setTimeout(r, 100));
    if (!this.room) throw new Error('その部屋コードの部屋はありません');
  }
  recv(m) {
    if (m.code !== this.code) return;
    if (m.kind === 'join' && this.room && this.room.host === this.me.uid && !this.room.guest) {
      this.room.guest = m.me.uid; this.room.guestName = m.me.name;
      this.ch.postMessage({ code: this.code, kind: 'room', room: this.room });
      this.emitRoom();
    } else if (m.kind === 'room') { this.room = m.room; this.emitRoom(); }
    else if (m.kind === 'patch' && this.room) { applyPatch(this.room, m.patch); this.emitRoom(); }
    else if (m.kind === 'state' && this.h) this.h.opp(JSON.parse(m.json));
    else if (m.kind === 'event' && this.h) this.h.event(m.ev);
  }
  listen(code, h) { this.code = code; this.h = h; this.emitRoom(); }
  async updateRoom(patch) { applyPatch(this.room, patch); this.ch.postMessage({ code: this.code, kind: 'patch', patch }); this.emitRoom(); }
  async sendState(json) { this.ch.postMessage({ code: this.code, kind: 'state', json }); }
  async sendEvent(ev) {
    const e = { ...ev, from: this.me.uid, name: this.me.name, ts: Date.now() };
    this.ch.postMessage({ code: this.code, kind: 'event', ev: e });
    if (this.h) this.h.event(e);
  }
  leave() { this.h = null; }
}

// ---------- 対戦の状態 ----------
const Duel = {
  active: false,      // 盤面で対戦中
  code: null,         // 部屋コード
  room: null,         // 部屋の情報（参加者・準備・ターン・フェイズなど）
  t: null,            // 通信
  me: null,           // { uid, name }
  opp: null,          // 相手の盤面（見てよい情報だけ）
  oppLogSeen: 0,      // 相手のログを何行目まで表示したか
  feed: [],           // 対戦のログ（チャット・システム・相手の操作）
  seen: new Set(),    // 受け取ったイベント（二重表示を防ぐ）
  deckId: null,       // 使うデッキ
  turnKey: '',
  lastSent: '',
  sendTimer: null,
  solo: null,         // 対戦前の一人回しの盤面（終わったら戻す）
};

function duelMe() {
  if (DUEL_TEST) return { uid: 'test-' + DUEL_TEST, name: 'テスト' + DUEL_TEST };
  const u = Online.user;
  // ログインしていなくても対戦できる。この端末の ID（入り直し用）と、自分で決めた名前を使う
  let uid = null;
  try { uid = localStorage.getItem('ygo.duelUid'); if (!uid) { uid = 'g-' + Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem('ygo.duelUid', uid); } } catch { uid = 'g-' + Date.now(); }
  const saved = localStorage.getItem('ygo.duelName');
  const name = saved || (u && (u.displayName || (u.email || '').split('@')[0])) || 'プレイヤー';
  return { uid: u ? u.uid : uid, name: name.slice(0, 20) };
}
const oppUid = () => Duel.room && (Duel.room.host === Duel.me.uid ? Duel.room.guest : Duel.room.host);
const oppName = () => (Board.S && Board.S.auto ? 'CPU' : (Duel.room && (Duel.room.host === Duel.me.uid ? Duel.room.guestName : Duel.room.hostName) || '相手'));
// 表示する相手の盤面（自動処理モードでは CPU の盤面）
const curOpp = () => (Board.S && Board.S.auto ? Board.S.opp : Duel.opp);
const myTurn = () => Duel.room && Duel.room.turnPlayer === Duel.me.uid;

function feed(text, cls = '') {
  Duel.feed.push({ text, cls, at: Date.now() });
  if (Duel.feed.length > 300) Duel.feed.shift();
  renderDuelFeed();
}

// ---------- 部屋に入る・作る ----------
async function duelCreate(code) {   // code：前回の部屋を作り直すとき
  Duel.me = duelMe();
  Duel.t = DUEL_TEST ? new LocalDuelTransport(Duel.me) : new PeerDuelTransport(Duel.me);
  try {
    const newCode = await Duel.t.create(code);
    enterRoom(newCode);
  } catch (e) { toast(e.message); }
}

async function duelJoin(code) {
  code = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) { toast('部屋コードは6文字です'); return; }
  Duel.me = duelMe();
  Duel.t = DUEL_TEST ? new LocalDuelTransport(Duel.me) : new PeerDuelTransport(Duel.me);
  try {
    await Duel.t.join(code);
    enterRoom(code);
  } catch (e) { toast(e.message || '部屋に入れませんでした'); }
}

function enterRoom(code) {
  Duel.code = code;
  Duel.feed = []; Duel.seen = new Set(); Duel.opp = null; Duel.oppLogSeen = 0; Duel.lastSent = ''; Duel.turnKey = '';
  Duel.deckId = Duel.deckId || Decks.currentId;
  store.set('ygo.duel.current', { code, deckId: Duel.deckId, host: !!(Duel.t && Duel.t.isHost) });
  Duel.t.listen(code, { room: onDuelRoom, opp: onDuelOpp, event: onDuelEvent, error: e => toast('通信エラー：' + e.message) });
  renderDuelLobby();
}

function leaveRoom() {
  if (Duel.t) Duel.t.leave();
  if (Duel.active) endDuelBoard();
  Duel.t = null; Duel.code = null; Duel.room = null; Duel.opp = null;
  store.set('ygo.duel.current', null);
  renderDuelLobby();
}

// ---------- 受信 ----------
function onDuelRoom(r) {
  const prev = Duel.room;
  Duel.room = r;
  const me = Duel.me.uid;
  // 相手が来た・準備した
  if (prev && !prev.guest && r.guest && r.host === me) feed(`${r.guestName} が部屋に入りました`, 'sys');
  // 両方準備OKなら、部屋を作った人がコイントスで先攻を決めて開始する
  if (r.status === 'waiting' && r.host === me && r.guest && r.ready && r.ready[r.host] && r.ready[r.guest]) {
    const first = Math.random() < 0.5 ? r.host : r.guest;
    Duel.t.sendEvent({ type: 'sys', text: `コイントスの結果、${first === r.host ? r.hostName : r.guestName} の先攻です` });
    Duel.t.updateRoom({ status: 'playing', turn: 1, turnPlayer: first, phase: 'DP' });
    return;   // 開始の変更が届いたときに、もう一度ここが呼ばれる（古い情報で処理を続けないように）
  }
  if (r.status === 'playing' && !Duel.active) beginDuelBoard();
  if (Duel.active) {
    // ターンが変わったら、自分の盤面のターン数・通常召喚・使用済みを更新
    const key = r.turn + ':' + r.turnPlayer;
    if (key !== Duel.turnKey && Board.S) {
      Duel.turnKey = key;
      Board.S.turn = r.turn;
      if (r.turnPlayer === me) {
        Board.S.ns = false; Board.S.used = [];
        toast(r.turn === 1 ? 'あなたの先攻です（最初のターンはドローしません）' : 'あなたのターンです。ドローしてください');
      }
      persist(); renderBoard();
    }
    if (r.status === 'ended' && !Duel.endedShown) {
      Duel.endedShown = true;
      const text = r.winner === me ? 'あなたの勝ちです！' : r.winner ? `${oppName()} の勝ちです` : '対戦が終了しました';
      showModal({ title: '対戦終了', body: el('p', { text }), buttons: [{ label: '盤面を閉じて部屋を出る', primary: true, onClick: () => leaveRoom() }] });
    }
  }
  renderDuelLobby();
  renderDuelPanel();
}

function onDuelOpp(state) {
  Duel.opp = state;
  // 相手の新しい操作をログに足す
  const lines = state.plog || [];
  const start = state.plogCount - lines.length;
  for (let i = Math.max(Duel.oppLogSeen, start); i < state.plogCount; i++) feed(`${oppName()}：${lines[i - start]}`, 'opp');
  Duel.oppLogSeen = Math.max(Duel.oppLogSeen, state.plogCount);
  if (Duel.active) renderBoard();
  renderDuelPanel();
}

function onDuelEvent(ev) {
  const id = ev.from + ':' + ev.ts + ':' + ev.type;
  if (Duel.seen.has(id)) return;
  Duel.seen.add(id);
  const mine = ev.from === Duel.me.uid;
  const who = mine ? 'あなた' : ev.name;
  switch (ev.type) {
    case 'chat': feed(`${who}：${ev.text}`, mine ? 'me chat' : 'chat'); break;
    case 'sys': feed(ev.text, 'sys'); break;
    case 'coin': feed(`${who}がコインを投げました → ${ev.result}`, 'sys'); break;
    case 'dice': feed(`${who}がサイコロを振りました → ${ev.result}`, 'sys'); break;
    case 'phase': feed(`${who}：${ev.text}`, 'sys'); break;
    case 'reveal': {
      feed(`${who}が公開：${ev.cardName}（${ev.from_zone || ''}）`, 'sys');
      const c = DB.byId.get(ev.cardId);
      if (!mine && c) {
        const body = el('div', { class: 'detail-sheet' });
        renderDetail(body, c);
        showModal({ title: `${ev.name} が公開したカード`, body });
      }
      break;
    }
    case 'lp':
      feed(`${who}：${ev.to === Duel.me.uid ? 'あなた' : oppName()}に ${ev.delta} のダメージ`, 'sys');
      if (ev.to === Duel.me.uid && !mine && Duel.active) changeMyLp(ev.delta, `${ev.name}から`);
      break;
    case 'surrender': feed(`${who}が降参しました`, 'sys'); break;
    default: break;
  }
}

// ---------- 対戦の盤面 ----------
function beginDuelBoard() {
  const deck = Decks.get(Duel.deckId) || Decks.current();
  Duel.solo = { S: Board.S, initial: Board.initial, history: Board.history };
  const saved = store.get('ygo.duel.board.' + Duel.code, null);
  Duel.active = true;
  Duel.endedShown = false;
  if (saved && saved.S) Board.S = saved.S;   // 読み込み直したときは続きから
  else {
    Board.S = buildState(deck, null, 5);
    Board.S.lp = START_LP;
    Board.S.plog = ['[T1] 5枚引いて対戦開始'];
  }
  Board.initial = null; Board.history = []; Board.pick = null;
  document.body.classList.add('dueling');
  switchView('board');
  persist();
  renderBoard();
  feed('対戦開始！', 'sys');
}

function endDuelBoard() {
  Duel.active = false;
  document.body.classList.remove('dueling');
  if (Duel.solo) { Board.S = Duel.solo.S; Board.initial = Duel.solo.initial; Board.history = Duel.solo.history || []; }
  Duel.solo = null;
  renderBoard();
}

// 相手に送ってよい情報だけにした盤面
function publicState(S) {
  const pub = inst => inst && {
    id: inst.faceUp && !inst.tokenCard ? inst.id : 0,
    faceUp: !!inst.faceUp, pos: inst.pos, ctr: inst.ctr || 0,
    mats: (inst.mats || []).map(m => m.id),
    token: inst.tokenCard ? { name: inst.tokenCard.name, atk: inst.tokenCard.atk, def: inst.tokenCard.def, level: inst.tokenCard.level, attr: inst.tokenCard.attr } : undefined,
  };
  const plog = S.plog || [];
  return {
    lp: S.lp ?? START_LP,
    hand: S.hand.length, deck: S.deck.length,
    extra: S.extra.length, extraUp: S.extra.filter(i => i.faceUp).map(i => i.id),
    gy: S.gy.map(i => i.id), ban: S.ban.map(i => (i.faceUp ? i.id : 0)),
    m: S.m.map(pub), emz: S.emz.map(pub), s: S.s.map(pub), f: S.f.map(pub),
    plog: plog.slice(-60), plogCount: plog.length,
  };
}

// 盤面が描き直されるたびに呼ばれる。変わっていれば少し待って相手に送る
function duelAfterRender() {
  renderDuelPanel();
  clearTimeout(Duel.sendTimer);
  Duel.sendTimer = setTimeout(() => {
    if (!Duel.active || !Duel.t || !Board.S) return;
    const json = JSON.stringify(publicState(Board.S));
    if (json === Duel.lastSent) return;
    Duel.lastSent = json;
    Duel.t.sendState(json).catch(e => toast('盤面を送れませんでした：' + e.message));
  }, 150);
}

function changeMyLp(delta, from) {
  const S = Board.S;
  commit();
  S.lp = Math.max(0, (S.lp ?? START_LP) + delta);
  log(`LP ${delta > 0 ? '+' : ''}${delta}${from ? '（' + from + '）' : ''} → ${S.lp}`);
  finishChange();
  if (S.lp === 0) toast('LPが0になりました');
}

function duelReveal(c, zoneLabel) {
  Duel.t.sendEvent({ type: 'reveal', cardId: c.id, cardName: c.name, from_zone: zoneLabel });
}

function askNumber(title, onOk) {
  const input = el('input', { type: 'number', step: 100, min: 0, value: 1000, class: 'full' });
  showModal({ title, body: input, buttons: [{ label: 'OK', primary: true, onClick: () => { const n = Math.abs(parseInt(input.value, 10)); if (!n) return false; onOk(n); } }] });
  setTimeout(() => input.select(), 0);
}

// ---------- 相手の盤面の表示 ----------
const emptyPub = { lp: START_LP, hand: 0, deck: 0, extra: 0, extraUp: [], gy: [], ban: [], m: [null, null, null, null, null], emz: [null, null], s: [null, null, null, null, null], f: [null] };

function oppCardEl(p) {
  const card = p.token ? { name: p.token.name, type: T.MONSTER | T.TOKEN | T.NORMAL, level: p.token.level, atk: p.token.atk, def: p.token.def, attr: p.token.attr, race: 0 } : (p.id ? DB.byId.get(p.id) : null);
  const visible = p.faceUp && card;
  const node = el('div', { class: 'bcard opp' + (p.pos === 'def' ? ' def' : '') }, cardFace(visible ? card : null, { faceDown: !visible }));
  if (p.mats && p.mats.length) node.append(el('div', { class: 'badge mats', text: '素材' + p.mats.length }));
  if (p.ctr) node.append(el('div', { class: 'badge ctr', text: '●' + p.ctr }));
  node.addEventListener('click', e => {
    e.stopPropagation();
    if (visible && !p.token) showCardDetail(card, '#board-detail');
    else toast(p.token ? `${card.name}（トークン）` : '裏向きのカードです');
  });
  return node;
}

function oppSlotEl(zone, idx) {
  const o = curOpp() || emptyPub;
  const slot = el('div', { class: `zone slot opp-zone z-${zone}`, dataset: { ozone: zone, oidx: idx } });
  const p = o[zone] && o[zone][idx];
  if (p) slot.append(oppCardEl(p));
  if (p && zone !== 's' && zone !== 'f') { const b = oppStatBadge(p); if (b) slot.append(b); }
  return slot;
}

function oppPileEl(zone) {
  const o = curOpp() || emptyPub;
  const label = { deck: 'デッキ', extra: 'EXデッキ', gy: '墓地', ban: '除外' }[zone];
  const node = el('div', { class: `zone pile opp-zone z-${zone}`, dataset: { ozone: zone } }, el('span', { class: 'zone-label', text: '相手の' + label }));
  const list = zone === 'gy' ? o.gy : zone === 'ban' ? o.ban : null;
  const count = list ? list.length : o[zone];
  if (count) {
    const topId = list ? list[list.length - 1] : 0;
    const top = topId && DB.byId.get(topId);
    node.append(el('div', { class: 'bcard' }, top ? cardFace(top) : el('div', { class: 'cardface back' })));
  }
  node.append(el('div', { class: 'pile-count', text: count + '枚' }));
  node.addEventListener('click', () => {
    if (list) openOppPile(label, list);
    else if (zone === 'extra' && o.extraUp && o.extraUp.length) openOppPile('EXデッキ（表側）', o.extraUp);
    else toast(`相手の${label}：${count}枚`);
  });
  return node;
}

function openOppPile(label, ids) {
  const box = el('div', { class: 'pile-list' });
  if (!ids.length) box.append(el('p', { class: 'muted', text: 'カードがありません' }));
  for (const id of [...ids].reverse()) {
    const c = id && DB.byId.get(id);
    if (!c) { box.append(el('div', { class: 'pile-row' }, el('div', { class: 'r-main' }, el('div', { class: 'r-name muted', text: '裏側のカード' })))); continue; }
    box.append(el('div', { class: 'pile-row', onclick: () => showCardDetail(c, '#board-detail') }, rowMark(c),
      el('div', { class: 'r-main' }, el('div', { class: 'r-name', text: c.name }), el('div', { class: 'r-info', text: typeLine(c) }))));
  }
  showModal({ title: `相手の${label}（${ids.length}枚）`, body: box, wide: true });
}

// 相手の盤面（2段）：相手から見た並びなので左右が逆
function renderOppRows(field) {
  field.append(oppPileEl('deck'));
  for (let i = 4; i >= 0; i--) field.append(oppSlotEl('s', i));
  field.append(oppPileEl('extra'));
  field.append(oppPileEl('gy'));
  for (let i = 4; i >= 0; i--) field.append(oppSlotEl('m', i));
  field.append(oppSlotEl('f', 0));
  // 相手の手札（枚数だけ）
  const o = curOpp() || emptyPub;
  const bar = $('#opp-bar');
  bar.hidden = false;
  bar.innerHTML = '';
  const backs = el('div', { class: 'opp-hand' });
  for (let i = 0; i < Math.min(o.hand, 12); i++) backs.append(el('div', { class: 'cardface back mini' }));
  bar.append(el('div', { class: 'opp-name' }, el('b', { text: oppName() }), el('span', { class: 'muted', text: `　手札${o.hand}枚` })), backs);
}

// 共有のEXモンスターゾーン：自分のカードがあれば自分、無ければ相手（相手の 1-i 番）
function emzSharedEl(i) {
  const op = curOpp();
  if (Board.S.emz[i] || !(op && op.emz && op.emz[1 - i])) return slotEl('emz', i);
  const slot = el('div', { class: 'zone slot opp-zone z-emz' }, el('span', { class: 'zone-label', text: '相手のEXモンスター' }));
  slot.append(oppCardEl(op.emz[1 - i]));
  { const b = oppStatBadge(op.emz[1 - i]); if (b) slot.append(b); }
  return slot;
}

// ---------- 画面：ロビー（「対戦」タブ） ----------
function renderDuelLobby() {
  const box = $('#duel-lobby');
  if (!box) return;
  box.innerHTML = '';
  const me = duelMe();
  if (!Duel.code) {
    const codeInput = el('input', { type: 'text', placeholder: '例：AB3CDE', maxlength: 8, class: 'room-input', autocomplete: 'off' });
    const nameIn = el('input', { type: 'text', value: me.name, maxlength: 20, class: 'full', autocomplete: 'nickname' });
    nameIn.addEventListener('change', () => { const v = nameIn.value.trim(); try { if (v) localStorage.setItem('ygo.duelName', v); else localStorage.removeItem('ygo.duelName'); } catch { /* 保存できなくてもよい */ } });
    const deckSel = el('select', { class: 'full' }, Decks.list.map(d => el('option', { value: d.id, text: `${d.name}（${FORMATS[deckFormat(d)].short}・メイン${d.main.length}）`, selected: d.id === (Duel.deckId || Decks.currentId) })));
    deckSel.addEventListener('change', () => { Duel.deckId = deckSel.value; });
    Duel.deckId = deckSel.value;
    const last = store.get('ygo.duel.current', null);
    box.append(el('div', { class: 'panel duel-card' },
      el('h2', { text: '対戦' }),
      el('p', { class: 'muted', text: '部屋を作って部屋コードを相手に伝えるか、相手から聞いた部屋コードで参加してください。ログインしていなくても対戦できます（2人のブラウザを直接つないで対戦します）。' }),
      el('label', { class: 'auth-field' }, 'あなたの名前（相手に表示されます）', nameIn),
      el('label', { class: 'auth-field' }, '使うデッキ', deckSel),
      el('div', { class: 'duel-actions' },
        el('div', { class: 'duel-box' }, el('h3', { text: '部屋を作る' }), el('button', { class: 'btn primary', text: '＋ 新しい部屋を作る', onclick: duelCreate })),
        el('div', { class: 'duel-box' }, el('h3', { text: '部屋に入る' }), codeInput,
          el('button', { class: 'btn primary', text: '参加する', onclick: () => duelJoin(codeInput.value) }))),
      last && last.code ? el('button', { class: 'btn', text: `前回の部屋（${last.code}）に戻る`, onclick: () => { Duel.deckId = last.deckId; if (last.host) duelCreate(last.code); else duelJoin(last.code); } }) : null));
    codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') duelJoin(codeInput.value); });
    return;
  }
  const r = Duel.room;
  const shareUrl = location.protocol.startsWith('http') ? `${location.origin}${location.pathname}#room=${Duel.code}` : null;
  const deck = Decks.get(Duel.deckId);
  const amReady = r && r.ready && r.ready[me.uid];
  const player = (uid, name) => el('li', null, el('b', { text: name || '（待っています…）' }),
    uid && r.ready && r.ready[uid] ? el('span', { class: 'ready-tag', text: '準備OK' }) : uid ? el('span', { class: 'muted', text: '　デッキを選んでいます' }) : null,
    uid && r.decks && r.decks[uid] ? el('span', { class: 'muted', text: `（${r.decks[uid]}）` }) : null);
  box.append(el('div', { class: 'panel duel-card' },
    el('h2', null, '部屋コード ', el('span', { class: 'room-code', text: Duel.code })),
    el('div', { class: 'row' },
      el('button', { class: 'btn small', text: 'コードをコピー', onclick: () => navigator.clipboard.writeText(Duel.code).then(() => toast('コピーしました')) }),
      shareUrl ? el('button', { class: 'btn small', text: '招待リンクをコピー', onclick: () => navigator.clipboard.writeText(shareUrl).then(() => toast('招待リンクをコピーしました')) }) : null),
    el('ul', { class: 'duel-players' }, r ? [player(r.host, r.hostName), player(r.guest, r.guestName)] : el('li', { text: '接続中…' })),
    r && r.status === 'playing' ? el('button', { class: 'btn primary', text: '▶ 対戦の盤面を開く', onclick: () => { if (!Duel.active) beginDuelBoard(); else switchView('board'); } })
      : el('div', { class: 'stack' },
        el('p', { text: `使うデッキ：${deck ? deck.name : '（未選択）'}（メイン${deck ? deck.main.length : 0}・EX${deck ? deck.extra.length : 0}）` }),
        el('button', {
          class: 'btn ' + (amReady ? '' : 'primary'), text: amReady ? '準備OKを取り消す' : '準備OK', disabled: !r || !deck || deck.main.length < 1,
          onclick: () => Duel.t.updateRoom({ ['ready.' + me.uid]: !amReady, ['decks.' + me.uid]: deck ? deck.name : '' }),
        }),
        el('p', { class: 'muted small-note', text: '2人とも「準備OK」になると、コイントスで先攻を決めて対戦が始まります。' })),
    el('button', { class: 'btn small danger', text: '部屋を出る', onclick: leaveRoom })));
}

// ---------- 画面：対戦中の操作パネル（一人回し画面の左側） ----------
function renderDuelPanel() {
  const p = $('#duel-panel');
  if (!p) return;
  p.hidden = !Duel.active;
  if (!Duel.active || !Board.S) return;
  const r = Duel.room || {};
  const o = curOpp() || emptyPub;
  const phase = PHASES.find(x => x[0] === r.phase) || PHASES[0];
  $('#dp-code').textContent = Duel.code;
  $('#dp-opp-name').textContent = oppName();
  $('#dp-opp-lp').textContent = o.lp;
  $('#dp-my-name').textContent = Duel.me.name;
  $('#dp-my-lp').textContent = Board.S.lp ?? START_LP;
  $('#dp-turn').textContent = r.turn ? `T${r.turn}　${myTurn() ? 'あなたのターン' : oppName() + 'のターン'}　${phase[1]}フェイズ` : '準備中';
  $('#dp-turn').classList.toggle('mine', myTurn());
  $('#dp-next').disabled = !myTurn();
  $('#dp-end').disabled = !myTurn();
}

function renderDuelFeed() {
  const list = $('#dp-feed');
  if (!list) return;
  list.innerHTML = '';
  for (const f of Duel.feed.slice(-120)) list.append(el('li', { class: f.cls, text: f.text }));
  list.scrollTop = list.scrollHeight;
}

function setupDuel() {
  const tab = $('.tab[data-view="duel"]');
  if (tab) tab.addEventListener('click', renderDuelLobby);
  // 操作パネルのボタン
  $('#dp-my-minus').onclick = () => askNumber('自分のLPを減らす', n => changeMyLp(-n));
  $('#dp-my-plus').onclick = () => askNumber('自分のLPを増やす', n => changeMyLp(n));
  $('#dp-damage').onclick = () => askNumber(`${oppName()}にダメージを与える`, n => Duel.t.sendEvent({ type: 'lp', to: oppUid(), delta: -n }));
  $('#dp-next').onclick = () => {
    const i = PHASES.findIndex(x => x[0] === Duel.room.phase);
    if (i >= PHASES.length - 1) { toast('エンドフェイズです。「ターン終了」を押してください'); return; }
    const next = PHASES[i + 1];
    Duel.t.updateRoom({ phase: next[0] });
    Duel.t.sendEvent({ type: 'phase', text: `${next[1]}フェイズへ` });
  };
  $('#dp-end').onclick = () => {
    const r = Duel.room;
    Duel.t.updateRoom({ turn: r.turn + 1, turnPlayer: oppUid(), phase: 'DP' });
    Duel.t.sendEvent({ type: 'phase', text: `ターン終了 → T${r.turn + 1} ${oppName()}のターン` });
  };
  $('#dp-coin').onclick = () => Duel.t.sendEvent({ type: 'coin', result: crypto.getRandomValues(new Uint8Array(1))[0] % 2 ? '表' : '裏' });
  $('#dp-dice').onclick = () => Duel.t.sendEvent({ type: 'dice', result: (crypto.getRandomValues(new Uint8Array(1))[0] % 6) + 1 });
  $('#dp-surrender').onclick = () => showModal({
    title: '降参', body: el('p', { text: '降参して対戦を終えますか？' }),
    buttons: [{ label: '降参する', primary: true, onClick: () => { Duel.t.sendEvent({ type: 'surrender' }); Duel.t.updateRoom({ status: 'ended', winner: oppUid() }); } }],
  });
  $('#dp-leave').onclick = () => showModal({
    title: '対戦を終える', body: el('p', { text: '対戦を終えて部屋を出ますか？（相手には「終了」と表示されます）' }),
    buttons: [{ label: '終える', primary: true, onClick: () => { Duel.t.updateRoom({ status: 'ended' }); leaveRoom(); } }],
  });
  const chat = $('#dp-chat');
  const send = () => { const t = chat.value.trim(); if (!t) return; Duel.t.sendEvent({ type: 'chat', text: t.slice(0, 200) }); chat.value = ''; };
  $('#dp-send').onclick = send;
  chat.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });

  // 招待リンク（…#room=ABCDEF）で開かれたら、その部屋に入る
  const m = location.hash.match(/room=([A-Z0-9]{6})/i);
  if (m && duelMe()) {
    history.replaceState(null, '', location.pathname + location.search);
    switchView('duel');
    duelJoin(m[1]);
  }
  renderDuelLobby();
}

function oppStatBadge(p) {
  if (!p || !p.faceUp) return null;
  const card = p.token ? { type: T.MONSTER | T.TOKEN, atk: p.token.atk, def: p.token.def } : (p.id ? DB.byId.get(p.id) : null);
  return card ? statBadge(card, p) : null;
}
