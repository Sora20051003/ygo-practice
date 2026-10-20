// ---------- フレンド ----------
// ログインなしで使う。端末ごとの「フレンドコード」（対戦の ID から作る8文字）でつながる。
// 対戦と同じ公開の中継サーバー（MQTT）を使う：
//   <base>/user/<コード>/presence     ：オンラインかどうか（残しておくメッセージ。アプリを閉じると自動で「オフライン」に変わる）
//   <base>/user/<コード>/req/<相手のコード> ：フレンド申請（残しておくメッセージ。相手がオフラインでも次に開いたときに届く）
//   <base>/user/<コード>/inbox        ：対戦の招待など（その場で届くもの）
// フレンドの一覧はこの端末にだけ保存する（ygo.friends）。
const Friends = {
  client: null,
  list: [],            // [{ code, name, added }]
  status: new Map(),   // コード → { online, name, t }
  requests: new Map(), // 申請してきた人のコード → { name, t }
  started: false,
};

// 自分のフレンドコード（対戦の ID の英数字の先頭8文字）
function myFriendCode() {
  const uid = duelMe().uid;
  const hex = uid.replace(/^.*?g-/, '').replace(/[^0-9a-f]/gi, '');
  return (hex.length >= 8 ? hex.slice(0, 8) : (hex + '00000000').slice(0, 8)).toUpperCase();
}
const friendCodeOfUid = uid => (uid || '').replace(/^.*?g-/, '').replace(/[^0-9a-f]/gi, '').slice(0, 8).toUpperCase();
const fmtFriendCode = c => c.slice(0, 4) + '-' + c.slice(4);
const normFriendCode = s => (s || '').toUpperCase().replace(/[^0-9A-F]/g, '');
const friendTopic = (code, kind) => `${MQTT_BASE}/user/${code}/${kind}`;

function loadFriends() {
  Friends.list = store.get('ygo.friends', []).filter(f => f && /^[0-9A-F]{8}$/.test(f.code));
}
function saveFriends() { store.set('ygo.friends', Friends.list); }
const isFriend = code => Friends.list.some(f => f.code === code);

// 中継サーバーにつなぐ（アプリを開いている間ずっと）
async function startFriends() {
  if (Friends.started || DUEL_TEST) return;
  Friends.started = true;
  loadFriends();
  const me = myFriendCode();
  try {
    if (typeof mqtt === 'undefined') await loadScript(MQTT_URL);
    const offline = JSON.stringify({ online: false, name: duelMe().name, t: Date.now() });
    const c = mqtt.connect(MQTT_BROKERS[0], {
      clientId: 'ygof_' + Math.random().toString(36).slice(2, 12), clean: true, keepalive: 30, reconnectPeriod: 5000, connectTimeout: 10000,
      will: { topic: friendTopic(me, 'presence'), payload: offline, qos: 1, retain: true },
    });
    Friends.client = c;
    c.on('connect', () => {
      c.subscribe([friendTopic(me, 'inbox'), friendTopic(me, 'req/+'), friendTopic(me, 'dm/+'), ...Friends.list.map(f => friendTopic(f.code, 'presence'))], { qos: 1 });
      announcePresence();
    });
    c.on('message', (t, buf) => onFriendMessage(t, buf));
    // 名前を変えたときなども知らせ直す。閉じるときはオフラインにする
    setInterval(announcePresence, 5 * 60 * 1000);
    window.addEventListener('pagehide', () => { try { c.publish(friendTopic(me, 'presence'), JSON.stringify({ online: false, name: duelMe().name, t: Date.now() }), { qos: 0, retain: true }); } catch { /* 閉じるときなので気にしない */ } });
  } catch (e) { console.warn('フレンドの中継サーバーにつながりませんでした', e); Friends.started = false; }
}
function announcePresence() {
  const c = Friends.client;
  if (!c || !c.connected) return;
  c.publish(friendTopic(myFriendCode(), 'presence'), JSON.stringify({ online: true, name: duelMe().name, t: Date.now() }), { qos: 1, retain: true });
}
function friendPub(code, kind, obj, retain = false) {
  const c = Friends.client;
  if (!c || !c.connected) { toast('フレンドの中継サーバーにつながっていません。少し待ってからもう一度お試しください'); return false; }
  c.publish(friendTopic(code, kind), obj == null ? '' : JSON.stringify(obj), { qos: 1, retain });
  return true;
}

function onFriendMessage(t, buf) {
  const me = myFriendCode();
  let m = null;
  try { m = buf.length ? JSON.parse(buf.toString()) : null; } catch { return; }
  const pm = t.match(/\/user\/([0-9A-F]{8})\/presence$/);
  if (pm) {
    if (!m) return;
    Friends.status.set(pm[1], { online: !!m.online, name: m.name, t: m.t });
    const f = Friends.list.find(x => x.code === pm[1]);
    if (f && m.name && f.name !== m.name) { f.name = m.name; saveFriends(); }
    renderFriendsBox();
    return;
  }
  const dm = t.match(/\/user\/[0-9A-F]{8}\/dm\/([0-9A-F]{8})$/);
  if (dm) { onDmMessage(dm[1], m); return; }
  const rm = t.match(/\/user\/[0-9A-F]{8}\/req\/([0-9A-F]{8})$/);
  if (rm) {
    const from = rm[1];
    if (!m) { Friends.requests.delete(from); renderFriendsBox(); return; }
    if (from === me) return;
    if (isFriend(from)) { clearFriendRequest(from); return; }   // もうフレンド：申請を片付けるだけ
    const isNew = !Friends.requests.has(from);
    Friends.requests.set(from, { name: (m.name || '').slice(0, 20), t: m.t });
    renderFriendsBox(); updateDmBadge();
    if (isNew) toast(`${m.name || 'だれか'}さんからフレンド申請が届きました（「対戦」の画面で追加できます）`);
    return;
  }
  if (t === friendTopic(me, 'inbox') && m) onFriendInbox(m);
}

function onFriendInbox(m) {
  const from = normFriendCode(m.from);
  if (!from || from === myFriendCode()) return;
  const name = (m.name || 'フレンド').slice(0, 20);
  if (m.kind === 'invite' && /^[A-Z0-9]{6}$/i.test(m.room || '')) {
    // フレンドでない人からの招待は出さない（いたずら防止）
    if (!isFriend(from)) return;
    showModal({
      title: '📨 対戦の招待',
      body: el('p', { text: `${name}さんから対戦に誘われました（部屋 ${m.room}）。` }),
      buttons: [
        { label: '参加する', primary: true, onClick: () => {
          if (Duel.code) { toast('今いる部屋を出てから参加してください'); return; }
          switchView('duel'); duelJoin(m.room);
        } },
        { label: 'あとで', onClick: () => friendPub(from, 'inbox', { kind: 'decline', from: myFriendCode(), name: duelMe().name }) },
      ],
    });
  } else if (m.kind === 'decline') {
    toast(`${name}さんは今は対戦できないようです`);
  } else if (m.kind === 'accepted') {
    toast(`${name}さんがフレンドになりました`);
    const f = Friends.list.find(x => x.code === from);
    if (f && m.name) { f.name = m.name; saveFriends(); renderFriendsBox(); }
  }
}

// フレンドに追加（コードで）。相手に申請を送る。相手が追加し返すとお互いに見える
function addFriend(code, name) {
  code = normFriendCode(code);
  if (!/^[0-9A-F]{8}$/.test(code)) { toast('フレンドコードは英数字8文字です（例：1A2B-3C4D）'); return false; }
  if (code === myFriendCode()) { toast('自分のコードです'); return false; }
  if (!isFriend(code)) {
    Friends.list.push({ code, name: name || (Friends.requests.get(code) || {}).name || (Friends.status.get(code) || {}).name || '（名前を確認中）', added: Date.now() });
    saveFriends();
    if (Friends.client) Friends.client.subscribe(friendTopic(code, 'presence'), { qos: 1 });
  }
  if (Friends.requests.has(code)) {
    // 相手からの申請に応えた
    clearFriendRequest(code);
    friendPub(code, 'inbox', { kind: 'accepted', from: myFriendCode(), name: duelMe().name });
    toast('フレンドに追加しました');
  } else {
    friendPub(code, 'req/' + myFriendCode(), { name: duelMe().name, t: Date.now() }, true);
    toast('フレンドに追加して、相手に申請を送りました');
  }
  renderFriendsBox();
  return true;
}
function clearFriendRequest(code) {
  Friends.requests.delete(code);
  friendPub(myFriendCode(), 'req/' + code, null, true);   // 残してある申請を消す
  renderFriendsBox();
}
function removeFriend(code) {
  Friends.list = Friends.list.filter(f => f.code !== code);
  saveFriends();
  if (Friends.client) Friends.client.unsubscribe(friendTopic(code, 'presence'));
  friendPub(code, 'req/' + myFriendCode(), null, true);   // 出していた申請も取り消す
  friendPub(code, 'dm/' + myFriendCode(), null, true);    // 中継サーバーに残していた DM も消す
  renderFriendsBox();
}

// 対戦に誘う：部屋が無ければ作ってから、部屋コードを送る
async function inviteFriend(code) {
  const f = Friends.list.find(x => x.code === code);
  if (!Duel.code) {
    await duelCreate(null, false);
    if (!Duel.code) return;
  } else if (Duel.room && Duel.room.guest) { toast('部屋がもう満員です'); return; }
  if (friendPub(code, 'inbox', { kind: 'invite', from: myFriendCode(), name: duelMe().name, room: Duel.code })) {
    toast(`${f ? f.name : 'フレンド'}さんを招待しました。来るまでこの画面でお待ちください`);
  }
}

// 対戦の画面のフレンド欄
function friendsPanel(inRoom) {
  const box = el('div', { class: 'panel duel-card friends-box', id: 'friends-box' });
  box.dataset.inRoom = inRoom ? '1' : '';
  fillFriendsBox(box);
  return box;
}
function renderFriendsBox() {
  const box = $('#friends-box');
  if (box) fillFriendsBox(box);
  updateDmBadge();
}
function fillFriendsBox(box) {
  const inRoom = !!box.dataset.inRoom;
  box.innerHTML = '';
  const me = myFriendCode();
  const input = el('input', { type: 'text', placeholder: '相手のフレンドコード（例：1A2B-3C4D）', maxlength: 9, class: 'room-input', autocomplete: 'off' });
  const add = () => { if (addFriend(input.value)) input.value = ''; };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  const sorted = [...Friends.list].sort((a, b) => (friendOnline(b.code) - friendOnline(a.code)) || a.name.localeCompare(b.name, 'ja'));
  box.append(
    el('h2', { text: '👥 フレンド' }),
    inRoom ? null : el('div', { class: 'row friend-mycode' },
      el('span', null, 'あなたのフレンドコード ', el('b', { class: 'room-code', text: fmtFriendCode(me) })),
      el('button', { class: 'btn small', text: 'コピー', onclick: () => navigator.clipboard.writeText(fmtFriendCode(me)).then(() => toast('コピーしました')) })),
    // 届いている申請
    ...[...Friends.requests].map(([code, r]) => el('div', { class: 'friend-req' },
      el('span', { text: `📩 ${r.name || 'だれか'}（${fmtFriendCode(code)}）からフレンド申請` }),
      el('button', { class: 'btn small primary', text: '追加する', onclick: () => addFriend(code, r.name) }),
      el('button', { class: 'btn small', text: '断る', onclick: () => clearFriendRequest(code) }))),
    sorted.length
      ? el('ul', { class: 'friend-list' }, sorted.map(f => {
        const on = friendOnline(f.code);
        return el('li', { class: on ? 'on' : '' },
          el('span', { class: 'friend-dot', title: on ? 'オンライン' : 'オフライン' }),
          el('span', { class: 'friend-name' }, el('b', { text: f.name }), el('small', { class: 'muted', text: `　${fmtFriendCode(f.code)}・${on ? 'オンライン' : 'オフライン'}` })),
          inRoom ? null : el('button', { class: 'btn small', onclick: () => openDm(f.code) }, '💬 DM', dmUnread(f.code) ? el('span', { class: 'tab-badge', text: String(dmUnread(f.code)) }) : null),
          on ? el('button', { class: 'btn small primary', text: inRoom ? 'この部屋に招待' : '対戦に誘う', onclick: () => inviteFriend(f.code) }) : null,
          inRoom ? null : el('button', { class: 'btn small', text: '削除', onclick: () => { if (confirm(`${f.name}さんをフレンドから削除しますか？`)) removeFriend(f.code); } }));
      }))
      : el('p', { class: 'muted small-note', text: 'まだフレンドがいません。相手のフレンドコードを入れて追加するか、対戦した相手を部屋の画面から追加できます。' }),
    inRoom ? null : el('div', { class: 'row' }, input, el('button', { class: 'btn primary', text: '追加', onclick: add })),
    inRoom ? null : el('p', { class: 'muted small-note', text: 'フレンドがアプリを開いているときは「オンライン」と表示され、対戦に誘えます。フレンドの一覧はこの端末にだけ保存されます（コードは端末ごとに違います）。' }),
  );
}
function friendOnline(code) {
  const s = Friends.status.get(code);
  return s && s.online ? 1 : 0;
}

// ---------- DM（フレンドどうしのメッセージ） ----------
// 送る側が <base>/user/<相手>/dm/<自分> に「自分が送った最近のメッセージ（30件）」を残しておくメッセージとして出す。
// 相手は自分あての dm/+ を見ているので、すぐ届く。相手がアプリを閉じていても、次に開いたときに届く。
// 会話の記録はそれぞれの端末に保存する（ygo.dm）。フレンドでない人からのメッセージは表示しない。
const DM_KEEP_SENT = 30;     // 中継サーバーに残す、自分が送ったメッセージの数
const DM_KEEP_LOCAL = 300;   // この端末に残す会話の数（相手ごと）
Friends.dm = null;           // { コード: [{ id, me: true/false, text, t }] }
Friends.dmRead = null;       // { コード: 最後に読んだ時刻 }
Friends.dmOpen = null;       // 開いている DM の画面 { code, draw }

function dmLoad() {
  if (Friends.dm) return;
  Friends.dm = store.get('ygo.dm', {}) || {};
  Friends.dmRead = store.get('ygo.dmRead', {}) || {};
}
function dmSave() { store.set('ygo.dm', Friends.dm); store.set('ygo.dmRead', Friends.dmRead); }
const dmList = code => (dmLoad(), Friends.dm[code] || (Friends.dm[code] = []));
function dmUnread(code) {
  dmLoad();
  const read = Friends.dmRead[code] || 0;
  return (Friends.dm[code] || []).filter(m => !m.me && m.t > read).length;
}
const dmUnreadTotal = () => Friends.list.reduce((n, f) => n + dmUnread(f.code), 0);

function sendDm(code, text) {
  text = (text || '').trim().slice(0, 300);
  if (!text) return false;
  const list = dmList(code);
  list.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), me: true, text, t: Date.now() });
  if (list.length > DM_KEEP_LOCAL) list.splice(0, list.length - DM_KEEP_LOCAL);
  dmSave();
  const sent = list.filter(m => m.me).slice(-DM_KEEP_SENT).map(m => ({ id: m.id, text: m.text, t: m.t }));
  const ok = friendPub(code, 'dm/' + myFriendCode(), { name: duelMe().name, msgs: sent }, true);
  dmRefresh();
  return ok;
}

// 相手から届いた（残してあった分も含む）
function onDmMessage(from, m) {
  if (!m || !Array.isArray(m.msgs) || !isFriend(from)) return;
  const list = dmList(from);
  const have = new Set(list.map(x => x.id));
  const fresh = m.msgs.filter(x => x && x.id && !have.has(x.id) && typeof x.text === 'string')
    .map(x => ({ id: String(x.id).slice(0, 20), me: false, text: x.text.slice(0, 300), t: +x.t || Date.now() }));
  if (!fresh.length) return;
  list.push(...fresh);
  list.sort((a, b) => a.t - b.t);
  if (list.length > DM_KEEP_LOCAL) list.splice(0, list.length - DM_KEEP_LOCAL);
  const open = Friends.dmOpen && Friends.dmOpen.code === from;
  if (open) Friends.dmRead[from] = Date.now();
  dmSave();
  dmRefresh();
  if (!open) {
    const f = Friends.list.find(x => x.code === from);
    const last = fresh[fresh.length - 1];
    if (last.t > (Friends.dmRead[from] || 0)) toast(`💬 ${f ? f.name : m.name || 'フレンド'}：${last.text.slice(0, 40)}`);
  }
}

// DM の画面
function openDm(code) {
  const f = Friends.list.find(x => x.code === code);
  if (!f) return;
  const box = el('ol', { class: 'log dm-log' });
  const input = el('input', { type: 'text', placeholder: 'メッセージを入力（Enter で送信）', maxlength: 300 });
  const send = () => { if (sendDm(code, input.value)) input.value = ''; input.focus(); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) send(); });
  const draw = () => {
    const list = dmList(code);
    box.innerHTML = '';
    if (!list.length) box.append(el('li', { class: 'muted', text: 'まだメッセージはありません。' }));
    let lastDay = '';
    for (const m of list) {
      const d = new Date(m.t);
      const day = `${d.getMonth() + 1}/${d.getDate()}`;
      if (day !== lastDay) { box.append(el('li', { class: 'dm-day', text: day })); lastDay = day; }
      box.append(el('li', { class: 'dm-msg ' + (m.me ? 'me' : 'them') },
        el('span', { class: 'dm-bubble', text: m.text }),
        el('small', { class: 'dm-time', text: `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` })));
    }
    box.scrollTop = box.scrollHeight;
  };
  Friends.dmRead[code] = Date.now(); dmSave();
  Friends.dmOpen = { code, draw };
  showModal({
    title: `💬 ${f.name}`,
    body: el('div', { class: 'stack dm-box' }, box,
      el('div', { class: 'row chat-row' }, input, el('button', { class: 'btn primary', text: '送信', onclick: send })),
      el('p', { class: 'muted small-note', text: 'メッセージは公開の中継サーバーを通ります（相手がアプリを閉じていても、次に開いたときに届きます）。個人情報は送らないでください。' })),
    onClose: () => { Friends.dmOpen = null; renderFriendsBox(); updateDmBadge(); },
  });
  draw();
  setTimeout(() => input.focus(), 0);
  renderFriendsBox(); updateDmBadge();
}
function dmRefresh() {
  if (Friends.dmOpen) Friends.dmOpen.draw();
  renderFriendsBox();
  updateDmBadge();
}
// 「対戦」のタブに、読んでいない DM の数を出す
function updateDmBadge() {
  const tab = $('.tab[data-view="duel"]');
  if (!tab) return;
  let b = tab.querySelector('.tab-badge');
  const n = Friends.list.length ? dmUnreadTotal() + Friends.requests.size : Friends.requests.size;
  if (!n) { if (b) b.remove(); return; }
  if (!b) { b = el('span', { class: 'tab-badge' }); tab.append(b); }
  b.textContent = n > 99 ? '99+' : String(n);
}
