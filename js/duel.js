// 対戦（公開の中継サーバー MQTT を通して2人がやり取りする。ログインしていなくてもよい）
// ・部屋を作る → 6文字の部屋コードを相手に教える → 相手が参加 → お互いデッキを選んで「準備OK」で開始
// ・自分の盤面は今までどおり手で動かす。変わるたびに「相手に見せてよい情報だけ」を相手に送る
//   （手札の中身・デッキの順番・裏向きのカードは送らない）
// ・LP・ターン・フェイズ・チャット・コイン・サイコロ・カードの公開・相手へのダメージは、部屋で共有する
// 通信は MQTT（公開の中継サーバー）。直接つなぐ PeerJS 版と Supabase 版も残してある（今は使っていない）。テスト用に、同じパソコンの2つの画面でやり取りする仕組みもある（?duelTest=A など）

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
      // 「だれかと対戦」の下見：相手を待っている部屋かどうかだけ答える
      if (m.kind === 'probe') { c.send({ kind: 'probe', open: !this.room.guest && this.room.status === 'waiting' && m.uid !== this.me.uid }); return; }
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
  // 「だれかと対戦」：待合の部屋を全部下見して、相手を待っている部屋の部屋コードを返す（なければ null）
  static async findOpen(codes, myUid) {
    if (typeof Peer === 'undefined') await loadScript(PEERJS_URL);
    const t = new PeerDuelTransport({ uid: myUid, name: '' });
    const peer = await t.openPeer(null);
    try {
      return await new Promise(resolve => {
        let left = codes.length, done = false;
        const finish = v => { if (!done) { done = true; resolve(v); } };
        const miss = () => { if (--left <= 0) finish(null); };
        peer.on('error', e => { if (e.type === 'peer-unavailable') miss(); });
        for (const code of codes) {
          const c = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
          c.on('open', () => c.send({ kind: 'probe', uid: myUid }));
          c.on('data', m => { if (m.kind === 'probe') { if (m.open) finish(code); else miss(); } });
        }
        setTimeout(() => finish(null), 6000);   // 返事がない部屋は待たない
      });
    } finally { t.leave(); }
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

// ---------- 通信（サーバーなし：公開の中継サーバー MQTT を経由する） ----------
// 2人とも、誰でも無料で使える公開の中継サーバー（MQTT ブローカー）へつなぎ、部屋ごとの「話題（トピック）」でやり取りする。
// どちらも外へ向かってつなぐだけなので、スマホの回線どうしでもつながる（ブラウザどうしを直接つなぐ方式はつながらないことがある）。
// 部屋を作った人（ホスト）の画面が部屋の情報を持ち、参加した人に送る。
//   <base>/room/<コード>/alive ：部屋があるしるし（残しておくメッセージ。ホストが落ちると自動で消える）
//   <base>/room/<コード>/msg   ：やり取り（{ from, to?, kind, ... }）
//   <base>/match/<コード>      ：「だれかと対戦」で相手を待っているしるし
const MQTT_URL = 'https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js';
const MQTT_BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
const MQTT_BASE = 'ygo-practice-sora20051003/v1';
class MqttDuelTransport {
  constructor(me) { this.me = me; this.h = null; this.room = null; this.client = null; this.closed = false; }
  topic(kind, code) { return MQTT_BASE + '/room/' + (code || this.code) + '/' + kind; }
  // 中継サーバーにつなぐ（つながらなければ次のサーバー）。will：自分が落ちたときに代わりに出してもらうメッセージ
  async connect(will, brokers) {
    if (typeof mqtt === 'undefined') await loadScript(MQTT_URL);
    let last = null;
    for (const url of brokers || MQTT_BROKERS) {
      try {
        const client = await new Promise((resolve, reject) => {
          const c = mqtt.connect(url, { clientId: 'ygo_' + Math.random().toString(36).slice(2, 12), clean: true, keepalive: 20, reconnectPeriod: 2000, connectTimeout: 8000, will });
          const timer = setTimeout(() => { c.end(true); reject(new Error('timeout')); }, 9000);
          c.once('connect', () => { clearTimeout(timer); resolve(c); });
          c.once('error', e => { clearTimeout(timer); c.end(true); reject(e); });
        });
        this.client = client; this.broker = url;
        client.on('message', (t, buf) => this.onMessage(t, buf));
        return client;
      } catch (e) { last = e; }
    }
    throw new Error('対戦の中継サーバーにつながりませんでした。インターネット接続を確認してください' + (last ? '（' + last.message + '）' : ''));
  }
  sub(t) { return new Promise((res, rej) => this.client.subscribe(t, { qos: 1 }, e => (e ? rej(e) : res()))); }
  pub(t, obj, retain) {
    if (!this.client) return;
    this.client.publish(t, obj == null ? '' : JSON.stringify(obj), { qos: 1, retain: !!retain });
  }
  send(m) { this.pub(this.topic('msg'), Object.assign({}, m, { from: this.me.uid })); }
  // 部屋があるか（残してあるしるしを読む）。少し待って返事がなければ「ない」
  peekAlive(code, ms) {
    return new Promise(resolve => {
      const t = this.topic('alive', code);
      const off = (tp, buf) => {
        if (tp !== t) return;
        this.client.removeListener('message', off); clearTimeout(timer);
        let v = null; try { v = buf.length ? JSON.parse(buf.toString()) : null; } catch { v = null; }
        resolve(v);
      };
      const timer = setTimeout(() => { this.client.removeListener('message', off); resolve(null); }, ms || 2500);
      this.client.on('message', off);
      this.sub(t).catch(() => {});
    });
  }
  setAlive() {
    const open = !!this.room && !this.room.guest && this.room.status === 'waiting';
    this.pub(this.topic('alive'), { host: this.me.uid, name: this.me.name, open, t: Date.now() }, true);
    if (/^MATCH/.test(this.code)) this.pub(MQTT_BASE + '/match/' + this.code, open ? { host: this.me.uid, t: Date.now() } : null, true);
  }
  emitRoom() { if (this.h && this.room) this.h.room(JSON.parse(JSON.stringify(this.room))); }

  async create(code) {
    for (let t = 0; t < 5; t++) {
      const c = code || newRoomCode();
      this.code = c;
      // 落ちたときは「部屋があるしるし」を消してもらう
      await this.connect({ topic: this.topic('alive', c), payload: '', qos: 1, retain: true }, [MQTT_BROKERS[0]]).catch(() => this.connect({ topic: this.topic('alive', c), payload: '', qos: 1, retain: true }));
      const alive = await this.peekAlive(c, 1500);
      if (alive && alive.host !== this.me.uid) {   // ほかの人が使っている
        this.client.end(true); this.client = null;
        if (code) throw new Error('その部屋コードは今使われています');
        continue;
      }
      this.isHost = true;
      this.room = { host: this.me.uid, hostName: this.me.name, guest: null, guestName: null, status: 'waiting', ready: {}, decks: {}, turn: 0, turnPlayer: null, phase: 'DP', winner: null, createdAt: Date.now() };
      await this.sub(this.topic('msg'));
      this.setAlive();
      return c;
    }
    throw new Error('部屋を作れませんでした。もう一度お試しください');
  }

  async join(code) {
    this.code = code;
    // 部屋を作った人と同じ中継サーバーを探す。自分が落ちたら部屋を作った人に知らせる
    for (const url of MQTT_BROKERS) {
      try { await this.connect({ topic: this.topic('msg', code), payload: JSON.stringify({ kind: 'bye', from: this.me.uid }), qos: 1, retain: false }, [url]); } catch { continue; }
      const alive = await this.peekAlive(code, 2500);
      if (alive) break;
      this.client.end(true); this.client = null;   // このサーバーにはない：次のサーバーで探す
    }
    if (!this.client) throw new Error('その部屋コードの部屋はありません（部屋を作った人がアプリを開いている間だけ入れます）');
    await this.sub(this.topic('msg'));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waitJoin = null; reject(new Error('部屋に入れませんでした（部屋を作った人がアプリを閉じていないか確認してください）')); }, 10000);
      this.waitJoin = {
        resolve: () => { clearTimeout(timer); this.waitJoin = null; resolve(); },
        reject: e => { clearTimeout(timer); this.waitJoin = null; reject(e); },
      };
      this.send({ kind: 'join', me: this.me });
    });
  }

  onMessage(t, buf) {
    if (this.closed) return;
    if (!buf.length) {
      // 部屋があるしるしが消えた ＝ 部屋を作った人がいなくなった
      if (!this.isHost && t === this.topic('alive') && this.room && this.h) this.h.error(new Error('部屋を作った人との接続が切れました'));
      return;
    }
    if (t !== this.topic('msg')) return;
    let m;
    try { m = JSON.parse(buf.toString()); } catch { return; }
    if (m.from === this.me.uid) return;   // 自分が出したもの
    if (m.to && m.to !== this.me.uid) return;   // ほかの人あて
    if (this.isHost) this.hostRecv(m); else this.guestRecv(m);
  }
  // 部屋を作った人：参加した人からのメッセージ
  hostRecv(m) {
    const r = this.room;
    if (m.kind === 'join') {
      if (!m.me || (r.guest && r.guest !== m.me.uid)) { if (m.me) this.send({ kind: 'full', to: m.me.uid }); return; }
      const rejoin = r.guest === m.me.uid;
      r.guest = m.me.uid; r.guestName = m.me.name;
      this.send({ kind: 'room', to: m.me.uid, room: r });
      if (this.lastState) this.send({ kind: 'state', to: m.me.uid, json: this.lastState });   // 入り直しのときは自分の盤面も送り直す
      this.setAlive();
      this.emitRoom();
      if (rejoin && this.h) this.h.event({ type: 'sys', from: 'sys', name: '', text: m.me.name + ' が入り直しました', ts: Date.now() });
      return;
    }
    if (m.from !== r.guest) return;   // 部屋の参加者以外は無視
    if (m.kind === 'bye') { if (this.h) this.h.error(new Error('相手との接続が切れました（相手が「前回の部屋に戻る」で戻ってこられます）')); return; }
    this.common(m);
  }
  // 参加した人：部屋を作った人からのメッセージ
  guestRecv(m) {
    if (this.waitJoin) {
      if (m.kind === 'full') { this.waitJoin.reject(new Error('この部屋はもう満員です')); return; }
      if (m.kind === 'room') { this.room = m.room; this.waitJoin.resolve(); this.emitRoom(); return; }
    }
    if (this.room && m.from !== this.room.host) return;
    this.common(m);
  }
  common(m) {
    if (m.kind === 'room') { this.room = m.room; this.emitRoom(); }
    else if (m.kind === 'patch' && this.room) { applyPatch(this.room, m.patch); if (this.isHost) this.setAlive(); this.emitRoom(); }
    else if (m.kind === 'state' && this.h) this.h.opp(JSON.parse(m.json));
    else if (m.kind === 'event' && this.h) this.h.event(m.ev);
  }
  listen(code, h) { this.h = h; this.emitRoom(); }
  async updateRoom(patch) { applyPatch(this.room, patch); this.send({ kind: 'patch', patch }); if (this.isHost) this.setAlive(); this.emitRoom(); }
  async sendState(json) { this.lastState = json; this.send({ kind: 'state', json }); }
  async sendEvent(ev) {
    const e = Object.assign({}, ev, { from: this.me.uid, name: this.me.name, ts: Date.now() });
    this.send({ kind: 'event', ev: e });
    if (this.h) this.h.event(e);
  }
  leave() {
    if (this.closed) return;
    if (this.client) {
      if (this.isHost) { this.pub(this.topic('alive'), null, true); if (/^MATCH/.test(this.code)) this.pub(MQTT_BASE + '/match/' + this.code, null, true); }
      else this.send({ kind: 'bye' });
      const c = this.client;
      setTimeout(() => c.end(), 300);
    }
    this.closed = true; this.h = null; this.client = null;
  }
  // 「だれかと対戦」：相手を待っている待合の部屋のコードを返す（なければ null）
  static async findOpen(codes, myUid) {
    const t = new MqttDuelTransport({ uid: myUid, name: '' });
    await t.connect(undefined, [MQTT_BROKERS[0]]);
    try {
      const found = [];
      await new Promise(resolve => {
        t.client.on('message', (tp, buf) => {
          const code = tp.split('/').pop();
          if (!buf.length || !codes.includes(code) || tp.indexOf(MQTT_BASE + '/match/') !== 0) return;
          try { const v = JSON.parse(buf.toString()); if (v.host !== myUid) found.push(code); } catch { /* 読めないものは無視 */ }
        });
        t.client.subscribe(MQTT_BASE + '/match/+', { qos: 1 });
        setTimeout(resolve, 1500);
      });
      // 本当にいるか（部屋があるしるしで）確かめる
      for (const code of found) {
        const alive = await t.peekAlive(code, 1500);
        if (alive && alive.open && alive.host !== myUid) return code;
      }
      return null;
    } finally { t.closed = true; if (t.client) t.client.end(true); }
  }
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
  feed: [],           // 対戦のログ（システム・相手の操作）
  chat: [],           // チャット（ログとは別に出す）
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
  // 同じアカウントで複数の端末を使っても、端末どうしで対戦できるように、端末ごとに別の ID にする
  return { uid: u ? u.uid.slice(0, 8) + '-' + uid : uid, name: name.slice(0, 20) };
}
const oppUid = () => Duel.room && (Duel.room.host === Duel.me.uid ? Duel.room.guest : Duel.room.host);
const oppName = () => (Board.S && Board.S.auto && !Auto.net ? 'CPU' : (Duel.room && (Duel.room.host === Duel.me.uid ? Duel.room.guestName : Duel.room.hostName) || '相手'));
// 表示する相手の盤面（自動処理モードでは CPU の盤面）
const curOpp = () => (Board.S && Board.S.auto ? Board.S.opp : Duel.opp);
const myTurn = () => (Auto.net && Auto.duel ? Auto.duel.turnPlayer === Auto.duel.me && !Auto.duel.ended : !!(Duel.room && Duel.room.turnPlayer === Duel.me.uid));

function feed(text, cls = '') {
  Duel.feed.push({ text, cls, at: Date.now() });
  if (Duel.feed.length > 300) Duel.feed.shift();
  renderDuelFeed();
}

// ---------- 部屋に入る・作る ----------
async function duelCreate(code, share) {   // code：前回の部屋を作り直すとき。share：作ったらすぐ招待リンクを送る
  Duel.me = duelMe();
  Duel.t = DUEL_TEST ? new LocalDuelTransport(Duel.me) : new MqttDuelTransport(Duel.me);
  try {
    const newCode = await Duel.t.create(code);
    enterRoom(newCode);
    if (share) shareInvite();
  } catch (e) { toast(e.message); }
}

// 招待リンクを送る。スマホは共有画面（LINE など）を出す。パソコンはリンクをコピーする
function shareInvite() {
  if (!Duel.code || !location.protocol.startsWith('http')) return;
  const url = `${location.origin}${location.pathname}#room=${Duel.code}`;
  const text = `遊戯王 展開練習で対戦しよう！ 部屋コード：${Duel.code}`;
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    navigator.share({ title: '対戦の招待', text, url }).catch(e => { if (e.name !== 'AbortError') copyInvite(text, url); });   // 閉じただけなら何もしない
    return;
  }
  copyInvite(text, url);
}
function copyInvite(text, url) {
  navigator.clipboard.writeText(`${text}\n${url}`).then(() => toast('招待リンクをコピーしました。LINE や Discord などに貼り付けて送ってください'), () => toast('招待リンク：' + url));
}

// ---------- だれかと対戦（相手を自動で探す） ----------
// 決まった数の「待合の部屋」（部屋コード MATCH1〜MATCHC）を使う。空いて待っている部屋があれば入り、なければ空いている番号で部屋を作って待つ
const MATCH_SLOTS = '123456789ABC'.split('').map(s => 'MATCH' + s);
let matching = false;
async function quickMatch() {
  if (matching) return;
  matching = true;
  const close = showModal({ title: '相手を探しています…', body: el('div', { class: 'stack' }, el('div', { class: 'spinner' }), el('p', { class: 'muted', text: '待っている人がいるか確かめています（数秒かかります）' })) });
  try {
    Duel.me = duelMe();
    const open = DUEL_TEST ? null : await MqttDuelTransport.findOpen(MATCH_SLOTS, Duel.me.uid);
    close();
    if (open) { await duelJoin(open); return; }
    // だれも待っていない：空いている番号で部屋を作って待つ
    for (const code of MATCH_SLOTS) {
      Duel.t = DUEL_TEST ? new LocalDuelTransport(Duel.me) : new MqttDuelTransport(Duel.me);
      try {
        await Duel.t.create(code);
        enterRoom(code);
        toast('だれかが来るまで、この画面で待っていてください');
        return;
      } catch (e) { if (!/使われています/.test(e.message)) throw e; }
    }
    toast('今は混んでいます。少し待ってからもう一度お試しください');
  } catch (e) { close(); toast(e.message || '相手を探せませんでした'); }
  finally { matching = false; }
}

async function duelJoin(code) {
  code = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) { toast('部屋コードは6文字です'); return; }
  Duel.me = duelMe();
  Duel.t = DUEL_TEST ? new LocalDuelTransport(Duel.me) : new MqttDuelTransport(Duel.me);
  try {
    await Duel.t.join(code);
    enterRoom(code);
  } catch (e) { toast(e.message || '部屋に入れませんでした'); }
}

function enterRoom(code) {
  Duel.code = code;
  Duel.feed = []; Duel.chat = []; Duel.seen = new Set(); Duel.opp = null; Duel.oppLogSeen = 0; Duel.lastSent = ''; Duel.turnKey = '';
  Duel.deckId = Duel.deckId || Decks.currentId;
  store.set('ygo.duel.current', { code, deckId: Duel.deckId, host: !!(Duel.t && Duel.t.isHost) });
  Duel.t.listen(code, { room: onDuelRoom, opp: onDuelOpp, event: onDuelEvent, error: e => { if (!(Duel.room && Duel.room.status === 'ended')) toast('通信エラー：' + e.message); } });
  // 部屋を作った人：持ち時間を部屋に書く（最初は一人回しの制限時間の設定と同じ）
  if (Duel.t.isHost && Duel.t.room && Duel.t.room.timeLimit === undefined) {
    // 最初のレギュレーションは、部屋を作った人のデッキと同じ（オリジナルなら中身ごと）
    const dk = Decks.get(Duel.deckId), dr = (dk && dk.reg) || 'latest', cr = dr.startsWith('custom:') ? customReg(dr.slice(7)) : null;
    const reg = cr ? { fmt: cr.base ? cr.base.fmt : (dk ? deckFormat(dk) : 'ocg'), reg: 'custom', custom: { id: cr.id, name: cr.name, base: cr.base || null, overrides: cr.overrides || {} } }
      : { fmt: dk ? deckFormat(dk) : 'ocg', reg: dr.startsWith('custom:') ? 'latest' : dr };
    if (dk && dk.cutoff) reg.cutoff = dk.cutoff;   // 発売日の区切りも、部屋を作った人のデッキと同じに
    Duel.t.updateRoom({ timeLimit: typeof timeLimit === 'function' ? timeLimit() : 0, clock: {}, mode: 'auto', reg });
  }
  renderDuelLobby();
}

function leaveRoom() {
  if (Duel.t) Duel.t.leave();
  if (Duel.active) endDuelBoard();
  Duel.t = null; Duel.code = null; Duel.room = null; Duel.opp = null;
  store.set('ygo.duel.current', null);
  renderDuelLobby();
}

// ---------- じゃんけん ----------
// 2人がそれぞれ手を選んで部屋に書く（rps.<uid>）。2人とも出したら、部屋を作った人の端末が勝ち負けを決める。
// あいこはやり直し。RPS_SEC 秒たっても出さない人は、部屋を作った人の端末がランダムに出す
const RPS_SEC = 20;
const RPS_HANDS = { g: '✊ グー', c: '✌️ チョキ', p: '✋ パー' };
const rpsBeats = (a, b) => (a === 'g' && b === 'c') || (a === 'c' && b === 'p') || (a === 'p' && b === 'g');
function judgeRps(r) {
  const h = r.rps || {}, a = h[r.host], b = h[r.guest];
  const timeUp = Date.now() > (r.chooseUntil || 0) + 2000;
  if ((!a || !b) && timeUp) {
    // 時間切れ：出さなかった人の負け。2人とも出さなかったら、勝つ人をランダムに決める
    if (Duel.rpsJudged === r.rpsRound) return;
    Duel.rpsJudged = r.rpsRound;
    const name = uid => (uid === r.host ? r.hostName : r.guestName);
    let winner, text;
    if (a || b) { winner = a ? r.host : r.guest; text = `じゃんけん：${name(winner === r.host ? r.guest : r.host)} が時間内に出さなかったので、${name(winner)} の勝ち`; }
    else { winner = crypto.getRandomValues(new Uint8Array(1))[0] % 2 ? r.host : r.guest; text = `じゃんけん：2人とも時間内に出さなかったので、ランダムで ${name(winner)} の勝ち`; }
    Duel.t.sendEvent({ type: 'sys', text });
    Duel.t.updateRoom({ status: 'choosing', coinWinner: winner, rpsTimeout: a || b ? 'one' : 'both', chooseUntil: Date.now() + CHOOSE_SEC * 1000 });
    return;
  }
  if (!a || !b || Duel.rpsJudged === r.rpsRound) return;
  Duel.rpsJudged = r.rpsRound;
  const text = `じゃんけん：${r.hostName} ${RPS_HANDS[a]}・${r.guestName} ${RPS_HANDS[b]}`;
  if (a === b) {
    Duel.t.sendEvent({ type: 'sys', text: text + ' → あいこ' });
    setTimeout(() => Duel.t && Duel.t.updateRoom({ rps: {}, rpsRound: (r.rpsRound || 1) + 1, rpsLast: { [r.host]: a, [r.guest]: b }, chooseUntil: Date.now() + RPS_SEC * 1000 }), 1500);
    return;
  }
  const winner = rpsBeats(a, b) ? r.host : r.guest;
  Duel.t.sendEvent({ type: 'sys', text: `${text} → ${winner === r.host ? r.hostName : r.guestName} の勝ち` });
  setTimeout(() => Duel.t && Duel.t.updateRoom({ status: 'choosing', coinWinner: winner, rpsTimeout: null, rpsLast: { [r.host]: a, [r.guest]: b }, chooseUntil: Date.now() + CHOOSE_SEC * 1000 }), 1500);
}
// じゃんけんの窓。部屋の情報が変わるたびに中身を描き直す
function showRps(r) {
  const me = Duel.me.uid, opp = r.host === me ? r.guest : r.host;
  const h = r.rps || {};
  if (!Duel.rpsUi) {
    const body = el('div', { class: 'stack rps-box' });
    const close = showModal({ title: '✊ じゃんけん', body, onClose: () => {
      // 決まる前に閉じられたら、もう一度出す
      if (Duel.rpsUi && Duel.rpsUi.close === close) {
        clearInterval(Duel.rpsUi.timer); Duel.rpsUi = null;
        setTimeout(() => { if (Duel.room && Duel.room.status === 'rps') showRps(Duel.room); }, 300);
      }
    } });
    Duel.rpsUi = { close, body, timer: setInterval(() => { const room = Duel.room; if (room && room.status === 'rps') { drawRps(room); if (room.host === Duel.me.uid) judgeRps(room); } }, 500) };
  }
  drawRps(r);
}
function drawRps(r) {
  const ui = Duel.rpsUi;
  if (!ui) return;
  const me = Duel.me.uid, opp = r.host === me ? r.guest : r.host;
  const h = r.rps || {}, mine = h[me], theirs = h[opp];
  const left = Math.max(0, Math.ceil(((r.chooseUntil || Date.now()) - Date.now()) / 1000));
  const both = mine && theirs;
  const key = [r.rpsRound, mine, theirs, left].join('|');
  if (ui.key === key) return;
  ui.key = key;
  ui.body.innerHTML = '';
  const last = r.rpsLast && r.rpsRound > 1 ? el('p', { class: 'muted', text: `あいこでした（あなた ${RPS_HANDS[r.rpsLast[me]] || ''}・${oppName()} ${RPS_HANDS[r.rpsLast[opp]] || ''}）。もう一度！` }) : null;
  ui.body.append(...[
    last,
    el('p', { text: both ? '結果を見ています…' : mine ? `${oppName()} が出すのを待っています…（あと ${left} 秒）` : `勝った人が、先攻か後攻かを選びます。手を選んでください（あと ${left} 秒。時間内に出さないと負けになります。2人とも出さなければランダム）` }),
    el('div', { class: 'rps-hands' }, Object.entries(RPS_HANDS).map(([k, t]) => el('button', {
      class: 'btn rps-hand' + (mine === k ? ' primary' : ''), text: t, disabled: !!mine,
      onclick: () => { if (!(Duel.room && Duel.room.rps && Duel.room.rps[me])) Duel.t.updateRoom({ ['rps.' + me]: k }); },
    }))),
    el('p', { class: 'muted small-note', text: `あなた：${mine ? RPS_HANDS[mine] : '選んでいます'}　${oppName()}：${both ? RPS_HANDS[theirs] : theirs ? '出しました' : '選んでいます'}` }),
  ].filter(Boolean));
}
function closeRps() {
  if (!Duel.rpsUi) return;
  const ui = Duel.rpsUi;
  Duel.rpsUi = null;
  clearInterval(ui.timer);
  ui.close();
}

// ---------- 先攻・後攻を選ぶ ----------
// じゃんけんで勝った人が選ぶ。CHOOSE_SEC 秒たっても選ばなければ先攻にする
const CHOOSE_SEC = 30;
function startDuelAs(first) {
  const r = Duel.room;
  if (!r || r.status !== 'choosing') return;
  const seed = Array.from(crypto.getRandomValues(new Uint32Array(4)), String);   // 効果を自動処理する対戦で、2人のエンジンを同じにするための乱数の種
  const name = uid => (uid === r.host ? r.hostName : r.guestName);
  Duel.t.sendEvent({ type: 'sys', text: `${name(r.coinWinner)} が${first === r.coinWinner ? '先攻' : '後攻'}を選びました。${name(first)} の先攻です` });
  Duel.t.updateRoom({ status: 'playing', turn: 1, turnPlayer: first, first, phase: 'DP', seed });
}
function askFirstOrSecond(r) {
  if (Duel.choosing) return;
  const me = Duel.me.uid, opp = r.host === me ? r.guest : r.host;
  const mine = r.coinWinner === me;
  const left = () => Math.max(0, Math.ceil(((r.chooseUntil || Date.now()) - Date.now()) / 1000));
  const sec = el('b', { text: String(left()) });
  const body = mine
    ? el('div', { class: 'stack' }, el('p', { class: 'coin-result', text: '✊ じゃんけん：あなたの勝ち！' + (r.rpsTimeout === 'one' ? `（${oppName()} が時間内に出さなかったため）` : r.rpsTimeout === 'both' ? '（2人とも出さなかったので、ランダムで決めました）' : '') }), el('p', null, '先攻か後攻かを選んでください（あと ', sec, ' 秒。選ばなければ先攻になります）'))
    : el('div', { class: 'stack' }, el('p', { class: 'coin-result', text: `✊ じゃんけん：${oppName()} の勝ち` + (r.rpsTimeout === 'one' ? '（あなたが時間内に出さなかったため）' : r.rpsTimeout === 'both' ? '（2人とも出さなかったので、ランダムで決めました）' : '') }), el('p', null, `${oppName()} が先攻か後攻かを選んでいます…（あと `, sec, ' 秒）'));
  const close = showModal({ title: '先攻・後攻', body, buttons: mine ? [
    { label: '先攻', primary: true, onClick: () => startDuelAs(me) },
    { label: '後攻', onClick: () => startDuelAs(opp) },
  ] : [], onClose: () => {
    // 選ぶ前に閉じられたときは、もう一度出す（時間切れの自動の決定も止めない）
    if (Duel.choosing && Duel.choosing.close === close) {
      clearInterval(Duel.choosing.timer); Duel.choosing = null;
      setTimeout(() => { if (Duel.room && Duel.room.status === 'choosing') askFirstOrSecond(Duel.room); }, 300);
    }
  } });
  const timer = setInterval(() => {
    sec.textContent = String(left());
    // 時間切れ：選ぶ人の端末で先攻にする（選ぶ人が通信できないときは、部屋を作った人が代わりに決める）
    if (left() <= 0 && (mine || (r.host === me && left() <= 0 && Date.now() - (r.chooseUntil || 0) > 5000))) startDuelAs(mine ? me : r.coinWinner);
  }, 500);
  Duel.choosing = { close, timer };
}
function closeFirstOrSecond() {
  if (!Duel.choosing) return;
  const c = Duel.choosing;
  Duel.choosing = null;
  clearInterval(c.timer);
  c.close();
}

// ---------- 受信 ----------
function onDuelRoom(r) {
  const prev = Duel.room;
  Duel.room = r;
  const me = Duel.me.uid;
  // 相手が来た・準備した
  if (prev && !prev.guest && r.guest && r.host === me) feed(`${r.guestName} が部屋に入りました`, 'sys');
  // 両方準備OKなら、じゃんけんをする（status: 'rps'）。勝った人が先攻・後攻を選ぶ（status: 'choosing'）
  if (r.status === 'waiting' && r.host === me && r.guest && r.ready && r.ready[r.host] && r.ready[r.guest]) {
    Duel.t.sendEvent({ type: 'sys', text: 'じゃんけんで、先攻・後攻を選ぶ人を決めます' });
    Duel.t.updateRoom({ status: 'rps', rps: {}, rpsRound: 1, rpsTimeout: null, rpsLast: null, chooseUntil: Date.now() + RPS_SEC * 1000 });
    return;   // 変更が届いたときに、もう一度ここが呼ばれる（古い情報で処理を続けないように）
  }
  if (r.status === 'rps') { showRps(r); if (r.host === me) judgeRps(r); } else closeRps();
  if (r.status === 'choosing') askFirstOrSecond(r); else closeFirstOrSecond();
  if (r.status === 'playing' && !Duel.active) {
    // 始まったら、先攻か後攻かを画面の真ん中に大きく出す（入り直したときは出さない）
    if (prev && prev.status !== 'playing' && r.first) showPhaseBanner(r.first === me ? 'あなたは先攻' : 'あなたは後攻', `${r.first === r.host ? r.hostName : r.guestName} の先攻で始めます`, r.first !== me, true);
    Duel.timeoutSent = false; if (r.mode === 'auto') beginNetDuel(); else beginDuelBoard(); }
  if (Duel.active) {
    // ターンが変わったら、自分の盤面のターン数・通常召喚・使用済みを更新
    const key = r.turn + ':' + r.turnPlayer;
    if (key !== Duel.turnKey && Board.S && !Auto.net) {
      // 持ち時間：ターンが始まった時刻（この端末の時計）
      if (r.turnPlayer === me) Duel.myTurnStart = Date.now(); else Duel.oppTurnStart = Date.now();
      Duel.turnKey = key;
      Board.S.turn = r.turn;
      if (r.turnPlayer === me) {
        Board.S.ns = false; Board.S.used = [];
        toast(r.turn === 1 ? 'あなたの先攻です（最初のターンはドローしません）' : 'あなたのターンです。ドローしてください');
      }
      persist(); renderBoard();
    }
    // フェイズが変わったら盤面を描き直す（光らせる・カードのボタンをフェイズに合わせるため）
    if (r.phase !== Duel.lastPhase && Board.S) { Duel.lastPhase = r.phase; renderBoard(); }
    if (r.status === 'ended' && !Duel.endedShown) {
      Duel.endedShown = true;
      const why = r.endReason === 'timeout' ? (r.winner === me ? '相手の持ち時間がなくなりました。' : 'あなたの持ち時間がなくなりました。') : '';
      const text = why + (r.winner === me ? 'あなたの勝ちです！' : r.winner ? `${oppName()} の勝ちです` : '対戦が終了しました');
      // 2人とも：開いている選択の窓などを閉じ、盤面を閉じて「対戦」のページに戻ってから結果を出す
      // （盤面の上に出すだけだと、効果の選択の窓などに隠れて、終わったことに気づけないことがある）
      // 部屋を出るのは少し待ってから（降参などの知らせが相手に届く前に通信を切らないように）
      closeAllModals();
      if (typeof closePromptModal === 'function') closePromptModal();
      endDuelBoard();
      switchView('duel');
      setTimeout(() => { if (Duel.room && Duel.room.status === 'ended') leaveRoom(); }, 1500);
      const reason = r.endReason === 'timeout' ? '' : r.winner === me ? '（相手が降参しました）' : '';
      showModal({ title: '対戦終了', body: el('p', { text: text + (r.winner === me && !why && r.surrendered ? reason : '') }), buttons: [{ label: 'OK', primary: true, onClick: () => {} }] });
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
  if (ev.type === 'eng' || ev.type === 'engsync') { onNetEvent(ev); return; }   // 効果を自動処理する対戦のやり取り（ログには出さない）
  const id = ev.from + ':' + ev.ts + ':' + ev.type;
  if (Duel.seen.has(id)) return;
  Duel.seen.add(id);
  const mine = ev.from === Duel.me.uid;
  const who = mine ? 'あなた' : ev.name;
  switch (ev.type) {
    case 'chat': addChat(who, ev.text, mine); break;
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
  document.body.classList.remove('dueling', 'netauto');
  if (Auto.net) {
    // 効果を自動処理する対戦を終えたら、一人回しの状態に戻す
    Auto.net = false;
    if (Duel.solo) { Auto.on = Duel.solo.autoOn; Auto.duel = Duel.solo.autoDuel; }
    if (typeof hideActionPopup === 'function') hideActionPopup();
    closePromptModal();
    if (Duel.code) store.set('ygo.duel.net.' + Duel.code, null);
  }
  if (Duel.solo) { Board.S = Duel.solo.S; Board.initial = Duel.solo.initial; Board.history = Duel.solo.history || []; }
  Duel.solo = null;
  if (Auto.on && Auto.duel) autoSync(); else renderBoard();
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
  if (Auto.net) { renderDuelPanel(); return; }   // 効果を自動処理する対戦は、盤面を送らない（2人とも同じエンジンを動かしている）
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
  if (zone === 'p') slot.append(el('span', { class: 'zone-label', text: '相手のPゾーン' }));
  const p = o[zone] && o[zone][idx];
  if (p) slot.append(oppCardEl(p));
  if (p && zone !== 's' && zone !== 'f' && zone !== 'p') { const b = oppStatBadge(p); if (b) slot.append(b); }
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
  // 公開されている手札（効果で見せたカードなど）は表向きに出す。押すと詳しい内容
  for (let i = 0; i < Math.min(o.hand, 12); i++) {
    const code = o.handPub && o.handPub[i], card = code && DB.byId.get(code);
    if (!card) { backs.append(el('div', { class: 'cardface back mini' })); continue; }
    const n = el('div', { class: 'opp-hand-pub', title: card.name + '（公開中）' }, cardFace(card, { small: true }));
    n.addEventListener('click', () => { Board.detailCard = card; showCardDetail(card, '#board-detail'); });
    backs.append(n);
  }
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
    nameIn.addEventListener('change', () => { const v = nameIn.value.trim(); try { if (v) localStorage.setItem('ygo.duelName', v); else localStorage.removeItem('ygo.duelName'); } catch { /* 保存できなくてもよい */ } announcePresence(); });
    const deckSel = el('select', { class: 'full' }, Decks.list.map(d => el('option', { value: d.id, text: `${d.name}（${FORMATS[deckFormat(d)].short}・メイン${d.main.length}）`, selected: d.id === (Duel.deckId || Decks.currentId) })));
    deckSel.addEventListener('change', () => { Duel.deckId = deckSel.value; });
    Duel.deckId = deckSel.value;
    const last = store.get('ygo.duel.current', null);
    box.append(el('div', { class: 'panel duel-card' },
      el('h2', { text: '対戦' }),
      el('div', { class: 'duel-quick' },
        el('label', { class: 'auth-field' }, 'あなたの名前（相手に表示されます）', nameIn),
        el('label', { class: 'auth-field' }, '使うデッキ', deckSel)),
      // ボタン1つで始められる2つの方法
      el('div', { class: 'duel-big' },
        el('button', { class: 'duel-big-btn primary', onclick: () => duelCreate(null, true) },
          el('b', { text: '📨 友達と対戦' }),
          el('small', { text: '押すと部屋ができて、招待リンクを送る画面が出ます（LINE などで送るだけ）。友達はリンクを開くだけで参加できます。' })),
        el('button', { class: 'duel-big-btn', onclick: quickMatch },
          el('b', { text: '🎲 だれかと対戦' }),
          el('small', { text: '待っている人がいればすぐ対戦。いなければ部屋を作って、だれかが来るのを待ちます。' }))),
      el('details', { class: 'duel-more' },
        el('summary', { text: '部屋コードで入る' }),
        el('div', { class: 'row' }, codeInput, el('button', { class: 'btn primary', text: '参加する', onclick: () => duelJoin(codeInput.value) }))),
      last && last.code ? el('button', { class: 'btn', text: `前回の部屋（${last.code}）に戻る`, onclick: () => { Duel.deckId = last.deckId; if (last.host) duelCreate(last.code); else duelJoin(last.code); } }) : null,
      el('p', { class: 'muted small-note', text: 'ログインしていなくても対戦できます（誰でも使える公開の中継サーバーを通して対戦します。部屋を作った人がアプリを閉じると部屋はなくなります）。' })));
    box.append(friendsPanel(false));
    codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') duelJoin(codeInput.value); });
    return;
  }
  const r = Duel.room;
  const shareUrl = location.protocol.startsWith('http') ? `${location.origin}${location.pathname}#room=${Duel.code}` : null;
  const deck = Decks.get(Duel.deckId);
  const amReady = r && r.ready && r.ready[me.uid];
  const player = (uid, name) => el('li', null, el('b', { text: name || '（待っています…）' }),
    uid && uid !== me.uid && !isFriend(friendCodeOfUid(uid)) && friendCodeOfUid(uid).length === 8 ? el('button', { class: 'btn small', text: '👥 フレンドに追加', onclick: () => addFriend(friendCodeOfUid(uid), name) }) : null,
    uid && r.ready && r.ready[uid] ? el('span', { class: 'ready-tag', text: '準備OK' }) : uid ? el('span', { class: 'muted', text: '　デッキを選んでいます' }) : null,
    uid && r.decks && r.decks[uid] ? el('span', { class: 'muted', text: `（${r.decks[uid]}）` }) : null);
  box.append(el('div', { class: 'panel duel-card' },
    el('h2', null, '部屋コード ', el('span', { class: 'room-code', text: Duel.code })),
    el('div', { class: 'row' },
      el('button', { class: 'btn small', text: 'コードをコピー', onclick: () => navigator.clipboard.writeText(Duel.code).then(() => toast('コピーしました')) }),
      shareUrl && !/^MATCH/.test(Duel.code) ? el('button', { class: 'btn small primary', text: '📨 招待リンクを送る', onclick: shareInvite }) : null),
    /^MATCH/.test(Duel.code) && r && !r.guest ? el('p', { class: 'duel-wait', text: '🎲 だれかが来るのを待っています…（この画面のままお待ちください）' }) : null,
    el('ul', { class: 'duel-players' }, r ? [player(r.host, r.hostName), player(r.guest, r.guestName)] : el('li', { text: '接続中…' })),
    r && r.status === 'playing' ? el('button', { class: 'btn primary', text: '▶ 対戦の盤面を開く', onclick: () => { if (!Duel.active) beginDuelBoard(); else switchView('board'); } })
      : el('div', { class: 'stack' },
        duelModeSetting(r),
        duelRuleSetting(r),
        duelErrataSetting(r),
        duelTimeSetting(r),
        duelRegSetting(r),
        duelDeckSetting(r, amReady),
        duelDeckCheck(deck, r),
        el('button', {
          class: 'btn ' + (amReady ? '' : 'primary'), text: amReady ? '準備OKを取り消す' : '準備OK', disabled: !r || !deck || deck.main.length < 1,
          onclick: () => {
            // レギュレーションに合っていないデッキで準備OKにするときは確かめる
            const p = !amReady && deck ? deckCheckForRoom(deck, r) : null;
            if (p && !p.loading && (p.notAllowed.length || p.over.length) && !confirm('このデッキは選んだレギュレーションに合っていません。このまま準備OKにしますか？')) return;
            Duel.t.updateRoom({ ['ready.' + me.uid]: !amReady, ['decks.' + me.uid]: deck ? deck.name : '', ['deckList.' + me.uid]: deck ? { main: deck.main, extra: deck.extra } : null });
          },
        }),
        el('p', { class: 'muted small-note', text: '2人とも「準備OK」になるとじゃんけんをして、勝った人が先攻か後攻かを選びます。' })),
    el('button', { class: 'btn small danger', text: '部屋を出る', onclick: leaveRoom })));
  // 相手を待っている間は、フレンドをこの部屋に招待できる
  if (r && r.host === me.uid && !r.guest && r.status === 'waiting' && !/^MATCH/.test(Duel.code) && Friends.list.length) box.append(friendsPanel(true));
  box.append(roomChatBox());
  renderDuelChat();
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

// チャット：ログとは別の欄に出す。相手から届いたときは、盤面を見ていても気づけるよう知らせる
function addChat(who, text, mine) {
  Duel.chat.push({ who, text, mine, at: Date.now() });
  if (Duel.chat.length > 200) Duel.chat.shift();
  renderDuelChat();
  if (!mine && ![...$$('.dp-chatlog')].some(l => l.offsetParent)) toast(`💬 ${who}：${text}`);   // チャット欄が見えていないときだけ
}
function renderDuelChat() {
  // 対戦の盤面の欄と、部屋の画面の欄の両方
  for (const list of $$('.dp-chatlog')) {
    list.innerHTML = '';
    if (!Duel.chat.length) list.append(el('li', { class: 'muted', text: 'まだメッセージはありません' }));
    for (const c of Duel.chat) {
      const d = new Date(c.at);
      list.append(el('li', { class: c.mine ? 'me' : '' }, el('span', { class: 'chat-time', text: `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` }), el('b', { text: c.who + '：' }), c.text));
    }
    list.scrollTop = list.scrollHeight;
  }
}
function sendChat(input) {
  const t = input.value.trim();
  if (!t || !Duel.t) return;
  Duel.t.sendEvent({ type: 'chat', text: t.slice(0, 200) });
  input.value = ''; Duel.chatDraft = '';
}
// 部屋の画面のチャット欄
function roomChatBox() {
  const input = el('input', { type: 'text', placeholder: 'メッセージを入力', maxlength: 200 });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(input); });
  // 部屋の画面は描き直されることがあるので、書きかけの文と入力中かどうかを引き継ぐ
  input.value = Duel.chatDraft || '';
  input.addEventListener('input', () => { Duel.chatDraft = input.value; });
  input.addEventListener('focus', () => { Duel.chatFocus = true; });
  input.addEventListener('blur', () => { setTimeout(() => { if (!input.isConnected) return; Duel.chatFocus = false; }, 0); });
  if (Duel.chatFocus) setTimeout(() => input.focus(), 0);
  return el('div', { class: 'panel duel-card room-chat' }, el('h2', { text: '💬 チャット' }), el('ol', { class: 'log dp-feed dp-chatlog' }),
    el('div', { class: 'row chat-row' }, input, el('button', { class: 'btn small', text: '送信', onclick: () => sendChat(input) })));
}

function renderDuelFeed() {
  const list = $('#dp-feed');
  if (!list) return;
  list.innerHTML = '';
  for (const f of Duel.feed.slice(-120)) list.append(el('li', { class: f.cls, text: f.text }));
  list.scrollTop = list.scrollHeight;
}

function setupDuel() {
  // フレンド（オンライン表示・招待の受け取り）のため、アプリを開いたら中継サーバーにつなぐ
  setTimeout(() => startFriends(), 1500);
  const tab = $('.tab[data-view="duel"]');
  if (tab) tab.addEventListener('click', renderDuelLobby);
  // 操作パネルのボタン
  $('#dp-my-minus').onclick = () => askNumber('自分のLPを減らす', n => changeMyLp(-n));
  $('#dp-my-plus').onclick = () => askNumber('自分のLPを増やす', n => changeMyLp(n));
  $('#dp-damage').onclick = () => askNumber(`${oppName()}にダメージを与える`, n => Duel.t.sendEvent({ type: 'lp', to: oppUid(), delta: -n }));
  $('#dp-next').onclick = () => {
    const i = PHASES.findIndex(x => x[0] === Duel.room.phase);
    if (i >= PHASES.length - 1) { toast('エンドフェイズです。「ターン終了」を押してください'); return; }
    let next = PHASES[i + 1][0];
    if (next === 'BP' && Duel.room.turn === 1) next = 'EP';   // 先攻の最初のターンはバトルフェイズに入れない
    if (next === 'M2' && Duel.room.phase !== 'BP') next = 'EP';
    duelGoPhase(next);
  };
  $('#dp-end').onclick = duelEndTurn;
  $('#dp-pause').onclick = openPause;
  $('#dp-coin').onclick = () => Duel.t.sendEvent({ type: 'coin', result: crypto.getRandomValues(new Uint8Array(1))[0] % 2 ? '表' : '裏' });
  $('#dp-dice').onclick = () => Duel.t.sendEvent({ type: 'dice', result: (crypto.getRandomValues(new Uint8Array(1))[0] % 6) + 1 });
  $('#dp-surrender').onclick = () => showModal({
    title: '降参', body: el('p', { text: '降参して対戦を終えますか？' }),
    buttons: [{ label: '降参する', primary: true, onClick: () => { Duel.t.sendEvent({ type: 'surrender' }); Duel.t.updateRoom({ status: 'ended', winner: oppUid(), surrendered: true }); } }],
  });
  $('#dp-leave').onclick = () => showModal({
    title: '対戦を終える', body: el('p', { text: '対戦を終えて部屋を出ますか？（相手には「終了」と表示されます）' }),
    buttons: [{ label: '終える', primary: true, onClick: () => { Duel.t.updateRoom({ status: 'ended' }); leaveRoom(); } }],
  });
  const chat = $('#dp-chat');
  const send = () => sendChat(chat);
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

// ---------- 対戦のフェイズ・ターン（一人回しと同じフェイズの帯から操作する） ----------
function duelGoPhase(k) {
  if (!Duel.room || !myTurn()) return;
  const p = PHASES.find(x => x[0] === k);
  Duel.t.updateRoom({ phase: k });
  Duel.t.sendEvent({ type: 'phase', text: `${p ? p[1] : k}フェイズへ` });
}
function duelEndTurn() {
  const r = Duel.room;
  if (!r || !myTurn() || r.status !== 'playing') return;
  // 自分の持ち時間を使った分を記録してから、相手のターンにする
  Duel.t.updateRoom({ turn: r.turn + 1, turnPlayer: oppUid(), phase: 'DP', ['clock.' + Duel.me.uid]: Math.round(myClockUsed()) });
  Duel.t.sendEvent({ type: 'phase', text: `ターン終了 → T${r.turn + 1} ${oppName()}のターン` });
}

// ---------- 対戦の持ち時間 ----------
// 部屋を作った人が部屋の最初に決める（30秒〜900秒・無限）。1人ずつの持ち時間で、自分のターンの間だけ減る。0になったら負け
const duelLimit = () => (Duel.room && Duel.room.timeLimit) || 0;
function myClockUsed() {
  const r = Duel.room;
  const base = (r && r.clock && r.clock[Duel.me.uid]) || 0;
  return base + (r && r.status === 'playing' && myTurn() && Duel.myTurnStart ? (Date.now() - Duel.myTurnStart) / 1000 : 0);
}
function oppClockUsed() {
  const r = Duel.room;
  const base = (r && r.clock && r.clock[oppUid()]) || 0;
  return base + (r && r.status === 'playing' && !myTurn() && Duel.oppTurnStart ? (Date.now() - Duel.oppTurnStart) / 1000 : 0);
}
function renderDuelClock() {
  const box = $('#b-timer');
  if (!box || !Duel.active) return;
  const lim = duelLimit();
  box.hidden = !lim || !Duel.room || !Duel.room.turn;
  if (box.hidden) return;
  const mine = Math.max(0, lim - myClockUsed()), theirs = Math.max(0, lim - oppClockUsed());
  box.textContent = `⏱ 自分 ${fmtTime(Math.ceil(mine))} ／ ${oppName()} ${fmtTime(Math.ceil(theirs))}`;
  const left = myTurn() ? mine : theirs;
  box.classList.toggle('warn', left <= 60 && left > 10);
  box.classList.toggle('danger', left <= 10);
}
function tickDuelClock() {
  if (!Duel.active || !Duel.room) return;
  renderDuelClock();
  const r = Duel.room, lim = duelLimit();
  // 自分の持ち時間がなくなったら負け（自分の画面で判定して、部屋に知らせる）
  if (lim && r.status === 'playing' && myTurn() && myClockUsed() >= lim && !Duel.timeoutSent) {
    Duel.timeoutSent = true;
    Duel.t.sendEvent({ type: 'sys', text: `${Duel.me.name} の持ち時間がなくなりました` });
    Duel.t.updateRoom({ status: 'ended', winner: oppUid(), endReason: 'timeout', ['clock.' + Duel.me.uid]: lim });
  }
}
setInterval(tickDuelClock, 500);

// 部屋の画面：持ち時間の設定（部屋を作った人だけが変えられる）
function duelTimeSetting(r) {
  const lim = (r && r.timeLimit) || 0;
  const isHost = r && r.host === Duel.me.uid;
  if (!isHost) return el('p', { class: 'muted', text: `持ち時間：${timeLabel(lim)}（部屋を作った人が決めます）` });
  const label = el('b', { text: timeLabel(lim) });
  const range = el('input', { type: 'range', min: 30, max: 930, step: 30, value: lim || 930, class: 'full' });
  const val = () => (+range.value > 900 ? 0 : +range.value);
  range.addEventListener('input', () => { label.textContent = timeLabel(val()); });
  range.addEventListener('change', () => Duel.t.updateRoom({ timeLimit: val() }));
  return el('div', { class: 'duel-time' }, el('label', { class: 'muted' }, '1人ずつの持ち時間：', label), range,
    el('p', { class: 'muted small-note', text: '自分のターンの間だけ減ります。なくなったら負けです。右端は無限（時間制限なし）。' }));
}

// ---------- 効果を自動処理する対戦 ----------
// 2人とも同じエンジンを、同じ乱数・同じデッキで動かす。自分が選んだこと（返答）は相手に送り、相手の返答は届いた順に流す。
// こうすると2人の画面のエンジンはいつも同じ状態になる（自分の画面には自分の手札だけを出す）
Duel.netQueue = [];
async function beginNetDuel() {
  const r = Duel.room, me = Duel.me.uid;
  const firstUid = r.first || r.turnPlayer, secondUid = firstUid === r.host ? r.guest : r.host;
  const idx = firstUid === me ? 0 : 1;
  const dl = uid => (r.deckList && r.deckList[uid]) || { main: [], extra: [] };
  const decks = [firstUid, secondUid].map(u => [dl(u).main || [], dl(u).extra || []]);
  Duel.solo = { S: Board.S, initial: Board.initial, history: Board.history, autoOn: Auto.on, autoDuel: Auto.duel };
  Duel.active = true; Duel.endedShown = false; Duel.netQueue = [];
  document.body.classList.add('dueling', 'netauto');
  switchView('board');
  try {
    await engineLoad(showLoading);
    await loadCardScripts([...decks[0][0], ...decks[0][1], ...decks[1][0], ...decks[1][1], OPP_FILLER], showLoading, r.errata);
  } catch (e) { showLoading(null); showError('自動処理を準備できませんでした', e); return; }
  showLoading(null);
  const d = new AutoDuel({ main: decks[idx][0], extra: decks[idx][1], seed: r.seed.map(s => BigInt(s)), net: { me: idx, decks }, rule: r.rule || 'mr5', errata: r.errata,
    chainMode: $('#ap-chain').value, autoTrigger: $('#ap-autotrig').checked, firstDraw: !!r.firstDraw });
  noteLinkRemoved(decks[idx][1], r.rule || 'mr5');
  d.onSend = (res, i) => Duel.t.sendEvent({ type: 'eng', i, res: JSON.stringify(res, bigReplacer) });
  Auto.on = true; Auto.net = true; Auto.duel = d; Auto.redoLog = null; Auto.resumed = true;
  // 読み込み直したときは、保存していた返答を流し直して続きから
  const saved = store.get('ygo.duel.net.' + Duel.code, null);
  const items = saved && saved.seed === r.seed.join(',') ? JSON.parse(saved.items, bigReviver) : null;
  try { d.create(); d.run(items || undefined); } catch (e) { showError('対戦を始められませんでした', e); return; }
  feed('対戦開始！（効果を自動処理）', 'sys');
  netFlush();
  autoAfter(true);
  // 相手が先に進んでいたら、足りない分を送ってもらう
  Duel.t.sendEvent({ type: 'engsync', have: d.responses.length });
}

// 相手の返答を、順番どおりに流す
function netFlush() {
  const d = Auto.duel;
  if (!Auto.net || !d) return;
  let moved = false;
  for (;;) {
    const k = Duel.netQueue.findIndex(q => q.i === d.responses.length);
    if (k < 0 || !d.remoteAsk) break;
    const [q] = Duel.netQueue.splice(k, 1);
    try { d.applyRemote(JSON.parse(q.res, bigReviver)); } catch (e) { showError('相手の操作を処理できませんでした', e); break; }
    moved = true;
  }
  Duel.netQueue = Duel.netQueue.filter(q => q.i >= d.responses.length);   // もう流したもの（重複して届いたもの）は捨てる
  if (moved) autoAfter();
}

function onNetEvent(ev) {
  if (ev.from === Duel.me.uid) return;
  if (ev.type === 'eng') { Duel.netQueue.push({ i: ev.i, res: ev.res }); if (Auto.net) netFlush(); return; }
  if (ev.type === 'engsync' && Auto.net && Auto.duel) {
    // 相手が持っていない分の返答を送り直す（相手は自分が選ぶ番の分だけ使う）
    const d = Auto.duel;
    for (let i = ev.have; i < d.responses.length; i++) Duel.t.sendEvent({ type: 'eng', i, res: JSON.stringify(d.responses[i], bigReplacer) });
  }
}

function netSave() {
  const d = Auto.duel;
  if (!d || !Duel.code || !Duel.room || !Duel.room.seed) return;
  try { store.set('ygo.duel.net.' + Duel.code, { seed: Duel.room.seed.join(','), items: JSON.stringify(d.history(), bigReplacer) }); } catch { /* 保存できなくても続けられる */ }
}

// 自動処理のたびに呼ぶ：ターンが変わったら持ち時間を記録する
function netAfter() {
  const d = Auto.duel;
  if (!d || !Duel.room) return;
  const key = d.turn + ':' + d.turnPlayer;
  if (key === Duel.netTurnKey) return;
  const wasMine = Duel.netTurnMine;
  if (wasMine && Duel.myTurnStart && Duel.room.status === 'playing') {
    Duel.t.updateRoom({ ['clock.' + Duel.me.uid]: Math.round(myClockUsedAt(Duel.netTurnEndedAt || Date.now())) });
  }
  Duel.netTurnKey = key;
  Duel.netTurnMine = d.turnPlayer === d.me;
  if (Duel.netTurnMine) Duel.myTurnStart = Date.now(); else Duel.oppTurnStart = Date.now();
}
function myClockUsedAt(now) {
  const r = Duel.room;
  return ((r.clock && r.clock[Duel.me.uid]) || 0) + (Duel.myTurnStart ? (now - Duel.myTurnStart) / 1000 : 0);
}

// 勝ち負けが決まったとき（エンジンの判定）：部屋に書いて、2人に終了を出す
function netGameOver(result, reason) {
  const r = Duel.room;
  if (r && r.status === 'playing') Duel.t.updateRoom({ status: 'ended', winner: result === 'win' ? Duel.me.uid : oppUid(), endReason: reason });
}

// 部屋の画面：対戦のしかた（部屋を作った人だけが変えられる）
// マスタールール（効果を自動処理する対戦）：部屋を作った人が決める
function duelRuleSetting(r) {
  const rule = MASTER_RULES[r && r.rule] ? r.rule : 'mr5';
  const isHost = r && r.host === Duel.me.uid;
  if ((r && r.mode) !== 'auto') return null;   // 手動の対戦では、ゾーンを自分で使い分けるので選ばない
  if (!isHost) return el('p', { class: 'muted', text: `ルール：${MASTER_RULES[rule].label}（部屋を作った人が決めます）` });
  const sel = el('select', { class: 'full' }, Object.entries(MASTER_RULES).map(([k, x]) => el('option', { value: k, text: x.label, selected: k === rule })));
  // 変えたら2人とも準備OKをやり直す
  sel.addEventListener('change', () => Duel.t.updateRoom({ rule: sel.value, ready: {} }));
  return el('div', { class: 'duel-time' }, el('label', { class: 'muted', text: 'ルール（マスタールール）' }), sel,
    el('p', { class: 'muted small-note', text: MASTER_RULES[rule].note }));
}
// エラッタ（効果の変更）があったカードの効果：部屋を作った人が決める（2人で同じにしないと処理がずれる）
function duelErrataSetting(r) {
  const mode = r && r.errata === 'pre' ? 'pre' : 'post';
  if ((r && r.mode) !== 'auto') return null;
  if (!(r && r.host === Duel.me.uid)) return el('p', { class: 'muted', text: `エラッタのあったカード：${ERRATA_MODES[mode]}（部屋を作った人が決めます）` });
  const sel = el('select', { class: 'full' }, Object.entries(ERRATA_MODES).map(([k, t]) => el('option', { value: k, text: t, selected: k === mode })));
  sel.addEventListener('change', () => Duel.t.updateRoom({ errata: sel.value, ready: {} }));
  return el('div', { class: 'duel-time' }, el('label', { class: 'muted', text: 'エラッタ（効果の変更）があったカード' }), sel);
}

function duelModeSetting(r) {
  const mode = (r && r.mode) || 'manual';
  const isHost = r && r.host === Duel.me.uid;
  const label = { auto: '効果を自動処理（ルールどおりに自動で処理）', manual: '手動（自分でカードを動かす）' };
  if (!isHost) return el('p', { class: 'muted', text: `対戦のしかた：${label[mode]}（部屋を作った人が決めます）` });
  return el('div', { class: 'duel-time' }, el('label', { class: 'muted', text: '対戦のしかた' }),
    el('div', { class: 'seg full' }, ['auto', 'manual'].map(m => el('button', {
      class: mode === m ? 'on' : '', text: m === 'auto' ? '効果を自動処理' : '手動',
      onclick: () => Duel.t.updateRoom({ mode: m }),
    }))),
    el('p', { class: 'muted small-note', text: mode === 'auto' ? '召喚・効果の発動・チェーン・ダメージなどをルールどおり自動で処理します（対象などは自分で選びます）。' : '一人回しの手動モードと同じく、カードを自分で動かします。' }));
}

// ---------- 対戦の直前に選ぶ：デッキとレギュレーション ----------
// レギュレーションは部屋を作った人が決め、部屋（room.reg = { fmt, reg }）で2人に共有する
const roomReg = r => (r && r.reg) || { fmt: 'ocg', reg: 'latest' };
function regLabel(x) {
  if (!x || x.reg === 'none') return '制限なし（禁止・制限・発売日を気にしない）';
  if (x.reg === 'custom' && x.custom) return `★ ${x.custom.name}（${customRegNote(x.custom)}）`;
  const f = FORMATS[x.fmt] || FORMATS.ocg;
  if (x.reg === 'latest') { const d = DB.banlists[x.fmt] && DB.banlists[x.fmt].date; return `${f.label}・最新${d ? `（${d.replace(/-/g, '/')}〜）` : ''}`; }
  return `${f.label}・${x.reg.replace(/-/g, '/')}〜 のリスト`;
}
// 部屋のレギュレーションの判定の材料。オリジナルは部屋に入っている中身（部屋を作った人のもの）を使う
function roomRegContext(x, tmp) {
  if (x.reg !== 'custom' || !x.custom) return regContext(tmp);
  const cr = x.custom;
  const ctx = !cr.base ? { fmt: x.fmt, reg: 'custom', custom: cr } : { ...baseContext(cr.base.fmt, cr.base.reg, x.fmt), reg: 'custom', custom: cr };
  if (!x.cutoff) return ctx;
  const end = ctx.endDate && ctx.endDate < x.cutoff ? ctx.endDate : x.cutoff;   // 発売日の区切り
  return { ...ctx, cutoff: x.cutoff, endDate: end, date: +end.replace(/-/g, ''), loading: ctx.loading || (typeof RELEASE_DATES === 'undefined' && !DB.releaseFailed) };
}
// 部屋のレギュレーションで見たときの、そのデッキの問題（使えないカード・枚数オーバー）
const roomRegLoading = new Set();
function deckCheckForRoom(deck, r) {
  const x = roomReg(r);
  const tmp = { ...deck, format: x.fmt, reg: x.reg, cutoff: x.cutoff || undefined };
  const ctx = roomRegContext(x, tmp);
  if (ctx.loading) {
    const key = ctx.src ? ctx.src.join(':') : 'release';
    if (!roomRegLoading.has(key)) {
      roomRegLoading.add(key);
      Promise.all([ctx.src ? loadRegulation(...ctx.src) : null, loadReleaseDates()]).then(renderDuelLobby, e => toast('リストを読み込めませんでした：' + e.message)).finally(() => roomRegLoading.delete(key));
    }
    return { loading: true };
  }
  return deckProblems(tmp, ctx);
}
function duelDeckSetting(r, amReady) {
  const me = Duel.me.uid;
  const sel = el('select', { class: 'full' }, Decks.list.map(d => el('option', { value: d.id, text: `${d.name}（${FORMATS[deckFormat(d)].short}・メイン${d.main.length}・EX${d.extra.length}）`, selected: d.id === Duel.deckId })));
  sel.addEventListener('change', () => {
    Duel.deckId = sel.value;
    const cur = store.get('ygo.duel.current', null);
    if (cur) store.set('ygo.duel.current', { ...cur, deckId: Duel.deckId });
    // 準備OKのあとでデッキを変えたら、準備OKを取り消す（相手に古いデッキが伝わらないように）
    if (amReady) Duel.t.updateRoom({ ['ready.' + me]: false });
    renderDuelLobby();
  });
  return el('label', { class: 'auth-field' }, '使うデッキ', sel);
}
function duelRegSetting(r) {
  const x = roomReg(r);
  const isHost = r && r.host === Duel.me.uid;
  if (!isHost) return el('div', null,
    el('p', { class: 'muted', text: `レギュレーション：${regLabel(x)}${x.cutoff ? `・${x.cutoff.replace(/-/g, '/')} までに発売されたカード` : ''}（部屋を作った人が決めます）` }),
    // 相手のオリジナルを、自分のレギュレーションとして保存できる（デッキ作成で使える）
    x.reg === 'custom' && x.custom ? el('button', { class: 'btn small', text: customReg(x.custom.id) ? '✓ 自分のオリジナルに保存済み（上書きする）' : 'このオリジナルを自分にも保存', onclick: () => { saveCustomReg({ id: x.custom.id, name: x.custom.name, base: x.custom.base || null, overrides: x.custom.overrides || {} }); toast(`「${x.custom.name}」を保存しました（デッキ作成のレギュレーションで選べます）`); renderDuelLobby(); } }) : null);
  const sel = el('select', { class: 'full' });
  for (const fmt of Object.keys(FORMATS)) {
    const f = FORMATS[fmt];
    const g = el('optgroup', { label: f.label });
    g.append(el('option', { value: `${fmt}|latest`, text: regLabel({ fmt, reg: 'latest' }) }));
    const latest = DB.banlists[fmt] && DB.banlists[fmt].date;
    const today = new Date().toISOString().slice(0, 10);
    for (const d of (DB.regDates[fmt] || []).filter(d => d !== latest && d <= today)) g.append(el('option', { value: `${fmt}|${d}`, text: `${f.label}・${d.replace(/-/g, '/')}〜（過去のリスト）` }));
    sel.append(g);
  }
  // 自分（部屋を作った人）のオリジナルのレギュレーション：中身ごと部屋に入れて、相手と共有する
  const mine = customRegs();
  if (mine.length) {
    const g = el('optgroup', { label: 'オリジナル（中身を相手と共有します）' });
    for (const cr of mine) g.append(el('option', { value: 'custom|' + cr.id, text: `★ ${cr.name}` }));
    sel.append(g);
  }
  sel.append(el('option', { value: 'ocg|none', text: regLabel({ reg: 'none' }) }));
  sel.value = x.reg === 'none' ? 'ocg|none' : x.reg === 'custom' ? 'custom|' + (x.custom && x.custom.id) : `${x.fmt}|${x.reg}`;
  if (x.reg === 'custom' && sel.value === '') sel.append(el('option', { value: 'custom|' + (x.custom && x.custom.id), text: regLabel(x), selected: true }));
  // 変えたら2人とも準備OKをやり直す（違うルールで準備OKのままにならないように）
  sel.addEventListener('change', () => {
    const [a, b] = sel.value.split('|');
    if (a === 'custom') {
      const cr = customReg(b);
      if (!cr) return;
      Duel.t.updateRoom({ reg: { fmt: cr.base ? cr.base.fmt : 'ocg', reg: 'custom', custom: { id: cr.id, name: cr.name, base: cr.base || null, overrides: cr.overrides || {} }, cutoff: x.cutoff || null }, ready: {} });
    } else Duel.t.updateRoom({ reg: { fmt: a, reg: b, cutoff: x.cutoff || null }, ready: {} });
  });
  // 発売日の区切り（この日までに発売されたカードだけ使う）
  const cut = el('input', { type: 'date', class: 'cutoff-input', value: x.cutoff || '' });
  const setCut = v => Duel.t.updateRoom({ reg: { ...x, cutoff: v || null }, ready: {} });
  cut.addEventListener('change', () => setCut(cut.value));
  return el('div', { class: 'stack' },
    el('label', { class: 'auth-field' }, 'レギュレーション（2人とも同じルールで対戦します）', sel),
    el('div', { class: 'row wrap' }, el('span', { class: 'muted', text: '発売日の区切り' }), cut,
      el('button', { class: 'btn small', text: '✕', title: '区切りをなくす', disabled: !x.cutoff, onclick: () => setCut('') }),
      el('span', { class: 'muted small-note', text: 'この日までに発売されたカードだけ（空欄＝区切りなし）' })));
}
function duelDeckCheck(deck, r) {
  if (!deck) return null;
  const p = deckCheckForRoom(deck, r);
  if (p.loading) return el('p', { class: 'muted small-note', text: 'レギュレーションを確認中…' });
  const bad = [];
  if (p.notAllowed.length) bad.push(`使えないカード：${p.notAllowed.join('、')}`);
  if (p.over.length) bad.push(`枚数オーバー：${p.over.join('、')}`);
  if (deck.main.length < 40) bad.push(`メインデッキが${deck.main.length}枚です（40枚以上必要）`);
  return bad.length ? el('div', { class: 'warn small-note' }, bad.map(t => el('div', { text: '⚠ ' + t })))
    : el('p', { class: 'ok-note small-note', text: '✓ このデッキは選んだレギュレーションで使えます' });
}
