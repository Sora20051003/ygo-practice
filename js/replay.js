// ---------- 盤面の記録・再生・共有 ----------
// 記録の形（どれも JSON にできる）
//   kind 'auto'  ：効果を自動処理した対局（一人回し・対戦）。始めたときの条件（デッキ・乱数の種など）と、選んだ返答の並び。
//                   再生では同じ条件のエンジンで、返答を途中まで流し直して盤面を作る（数が少なく、リンクで送りやすい）
//   kind 'manual'：手動の一人回し。動かすたびの盤面（frames）
//   kind 'duel'  ：手動の対戦。動かすたびの自分の盤面と、相手の見えている盤面（frames）
// 記録はこの端末の IndexedDB に保存する（recIndex：一覧、rec:<id>：中身）。対戦が終わったときは自動で保存する
const REC_MAX = 50;          // 残す記録の数
const REC_FRAMES_MAX = 3000; // 手動の記録に残す盤面の数
const Rec = { manual: null, duel: null };
const Rep = { on: false };   // 再生中の状態

// ---------- 記録する ----------
// 手動の盤面：ログは毎回大きくなるので、盤面ごとには入れない（最後のログだけ）
function frameOfS(S) {
  const s = { ...S };
  const lastLog = (S.log || []).slice(-1)[0] || '';
  delete s.log; delete s.plog;
  s.lastLog = lastLog;
  return JSON.stringify(s);
}
// 手動の一人回し：始めたら新しい記録にする
function recManualStart() {
  if (!Board.S || Board.S.auto) return;
  Rec.manual = { frames: [frameOfS(Board.S)], deckName: (boardDeck() || {}).name || '', at: Date.now() };
}
// 盤面が変わるたび（persist から呼ぶ）
function recFrame() {
  if (Rep.on || !Board.S || Board.S.auto) return;
  if (typeof Duel !== 'undefined' && Duel.active) { recDuelFrame(); return; }
  if (!Rec.manual) recManualStart();
  const f = frameOfS(Board.S), fr = Rec.manual.frames;
  if (fr[fr.length - 1] !== f) { fr.push(f); if (fr.length > REC_FRAMES_MAX) fr.shift(); }
}
// 手動の対戦：自分の盤面と、相手の見えている盤面・ターン・フェイズ
function recDuelStart() {
  Rec.duel = { frames: [], me: Duel.me, names: { me: Duel.me.name, opp: oppName() }, code: Duel.code, at: Date.now() };
}
function recDuelFrame() {
  if (Rep.on || typeof Duel === 'undefined' || !Duel.active || Auto.net || !Board.S) return;
  if (!Rec.duel || Rec.duel.code !== Duel.code) recDuelStart();
  const r = Duel.room || {};
  const room = { turn: r.turn, phase: r.phase, turnPlayer: r.turnPlayer, host: r.host, guest: r.guest, hostName: r.hostName, guestName: r.guestName, status: r.status, first: r.first, mode: r.mode, rule: r.rule };
  const f = JSON.stringify({ S: JSON.parse(frameOfS(Board.S)), opp: Duel.opp || null, room });
  const fr = Rec.duel.frames;
  if (fr[fr.length - 1] !== f) { fr.push(f); if (fr.length > REC_FRAMES_MAX) fr.shift(); }
}

// 今の対局を記録の形にする
function currentRecord() {
  const deckName = (boardDeck() || {}).name || '';
  if (Auto.duel && (Auto.on || Auto.net) && (Auto.net || !(typeof Duel !== 'undefined' && Duel.active))) {
    const d = Auto.duel;
    const p = { main: d.main, extra: d.extra, handIds: d.handIds, handSize: d.handSize, seed: d.seed.map(String), opp: d.opp, firstDraw: d.firstDraw, tools: d.tools, rule: d.rule, speed: d.speed, errata: d.errata, sv: d.sv };
    if (d.net) p.net = { me: d.net.me, decks: d.net.decks };
    return {
      kind: 'auto', p, items: JSON.parse(JSON.stringify(d.history(), bigReplacer)), deckName,
      names: d.net ? { me: Duel.me && Duel.me.name, opp: typeof oppName === 'function' ? oppName() : '相手' } : { me: '自分', opp: d.opp ? 'CPU' : '' },
    };
  }
  if (typeof Duel !== 'undefined' && Duel.active && Rec.duel && Rec.duel.frames.length) return { kind: 'duel', frames: Rec.duel.frames, me: Rec.duel.me, names: Rec.duel.names, deckName };
  if (Rec.manual && Rec.manual.frames.length) return { kind: 'manual', frames: Rec.manual.frames, deckName: Rec.manual.deckName || deckName };
  return null;
}

// ---------- 保存・一覧 ----------
async function recIndex() { try { return (await idbGet('recIndex')) || []; } catch { return []; } }
async function saveRecord(rec, title, quiet) {
  if (!rec) { if (!quiet) toast('記録する盤面がありません（一人回しか対戦を始めてください）'); return null; }
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const steps = rec.kind === 'auto' ? rec.items.length : rec.frames.length;
  const meta = { id, title: title || defaultRecTitle(rec), at: Date.now(), kind: rec.kind, steps };
  try {
    await idbSet('rec:' + id, rec);
    let idx = await recIndex();
    idx.unshift(meta);
    for (const old of idx.slice(REC_MAX)) await idbSet('rec:' + old.id, null);   // 古いものから消す
    idx = idx.slice(0, REC_MAX);
    await idbSet('recIndex', idx);
    if (!quiet) toast(`「${meta.title}」を記録に保存しました`);
    return meta;
  } catch (e) { if (!quiet) showError('記録を保存できませんでした', e); return null; }
}
function defaultRecTitle(rec) {
  const d = new Date();
  const when = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const what = rec.kind === 'duel' || (rec.kind === 'auto' && rec.p.net) ? `対戦 vs ${(rec.names && rec.names.opp) || '相手'}` : rec.kind === 'auto' ? `一人回し（自動処理）${rec.deckName ? '・' + rec.deckName : ''}` : `一人回し（手動）${rec.deckName ? '・' + rec.deckName : ''}`;
  return `${what}（${when}）`;
}
async function deleteRecord(id) {
  const idx = (await recIndex()).filter(m => m.id !== id);
  await idbSet('recIndex', idx);
  await idbSet('rec:' + id, null);
}
const REC_KIND = { auto: '自動処理', manual: '手動', duel: '対戦（手動）' };

// 記録の一覧
async function openRecords() {
  const body = el('div', { class: 'stack rec-list' });
  const close = showModal({ title: '📼 盤面の記録', body, wide: true });
  const draw = async () => {
    body.innerHTML = '';
    const cur = currentRecord();
    body.append(el('div', { class: 'row rec-save' },
      el('button', { class: 'btn primary', text: '⏺ 今の対局を記録に保存', disabled: !cur, onclick: async () => {
        const t = prompt('記録の名前', defaultRecTitle(cur));
        if (t === null) return;
        await saveRecord(currentRecord(), t.trim() || undefined);
        draw();
      } }),
      el('span', { class: 'muted small-note', text: cur ? '一人回し・対戦の、最初から今までを記録します。対戦は終わったときに自動で記録します。' : '一人回しか対戦を始めると、記録に保存できます。' })));
    const idx = await recIndex();
    if (!idx.length) { body.append(el('p', { class: 'muted', text: 'まだ記録はありません。' })); return; }
    for (const m of idx) {
      const d = new Date(m.at);
      body.append(el('div', { class: 'rec-item' },
        el('div', { class: 'rec-head' }, el('b', { text: m.title }),
          el('span', { class: 'muted small-note', text: `${REC_KIND[m.kind] || ''}・${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` })),
        el('div', { class: 'row' },
          el('button', { class: 'btn small primary', text: '▶ 再生', onclick: async () => { const rec = await idbGet('rec:' + m.id); if (!rec) { toast('記録が見つかりません'); return; } close(); startReplay(rec, m.title); } }),
          el('button', { class: 'btn small', text: '🔗 共有', onclick: async () => { const rec = await idbGet('rec:' + m.id); if (rec) shareRecord(rec, m.title); } }),
          el('button', { class: 'btn small', text: '名前を変える', onclick: async () => {
            const t = prompt('記録の名前', m.title); if (!t) return;
            const all = await recIndex(); const x = all.find(y => y.id === m.id); if (x) { x.title = t.trim(); await idbSet('recIndex', all); } draw();
          } }),
          el('button', { class: 'btn small danger', text: '削除', onclick: async () => { if (!confirm(`「${m.title}」を削除しますか？`)) return; await deleteRecord(m.id); draw(); } }))));
    }
  };
  draw();
}

// ---------- 共有（リンク） ----------
// 記録を圧縮してリンクに入れる。長すぎるときは中継サーバーに置いて、短いリンク（番号）にする
const REC_LINK_MAX = 12000;
const b64u = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), ch => ch.charCodeAt(0));
async function packRecord(rec) {
  const raw = new TextEncoder().encode(JSON.stringify(rec));
  if (typeof CompressionStream === 'undefined') return 'j' + b64u(raw);
  const buf = await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
  return 'z' + b64u(new Uint8Array(buf));
}
async function unpackRecord(s) {
  const bytes = unb64u(s.slice(1));
  if (s[0] === 'j') return JSON.parse(new TextDecoder().decode(bytes));
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
  return JSON.parse(new TextDecoder().decode(buf));
}
// 中継サーバー（MQTT）に残しておく／読む
async function recMqtt() {
  if (typeof Friends !== 'undefined' && Friends.client && Friends.client.connected) return { c: Friends.client, own: false };
  if (typeof mqtt === 'undefined') await loadScript(MQTT_URL);
  const c = await new Promise((resolve, reject) => {
    const x = mqtt.connect(MQTT_BROKERS[0], { clientId: 'ygor_' + Math.random().toString(36).slice(2, 12), clean: true, connectTimeout: 10000, reconnectPeriod: 0 });
    const t = setTimeout(() => { x.end(true); reject(new Error('中継サーバーにつながりませんでした')); }, 12000);
    x.once('connect', () => { clearTimeout(t); resolve(x); });
    x.once('error', e => { clearTimeout(t); x.end(true); reject(e); });
  });
  return { c, own: true };
}
// 中継サーバーは1つのメッセージに大きいものを残せない（60KB 程度まで）ので、50KB ずつに分けて置く
//   rec/<id>     ：{ n: 分けた数 }
//   rec/<id>/<i> ：i 番目の中身
const REC_CHUNK = 50000;
async function uploadRecord(data) {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
  const { c, own } = await recMqtt();
  const pub = (t, v) => new Promise((resolve, reject) => c.publish(t, v, { qos: 1, retain: true }, e => (e ? reject(e) : resolve())));
  const parts = [];
  for (let i = 0; i < data.length; i += REC_CHUNK) parts.push(data.slice(i, i + REC_CHUNK));
  try {
    for (let i = 0; i < parts.length; i++) await pub(`${MQTT_BASE}/rec/${id}/${i}`, parts[i]);
    await pub(`${MQTT_BASE}/rec/${id}`, JSON.stringify({ n: parts.length }));
  } finally { if (own) setTimeout(() => c.end(), 500); }
  return id;
}
async function downloadRecord(id) {
  const { c, own } = await recMqtt();
  const head = `${MQTT_BASE}/rec/${id}`, partsTopic = `${head}/+`;
  const parts = {};
  let n = null;
  try {
    return await new Promise((resolve, reject) => {
      const done = () => {
        if (n === null || Object.keys(parts).length < n) return;
        cleanup(); resolve(Array.from({ length: n }, (_, i) => parts[i]).join(''));
      };
      const on = (t, buf) => {
        if (t === head) { try { n = JSON.parse(buf.toString()).n; } catch { n = null; } done(); return; }
        if (t.startsWith(head + '/')) { parts[+t.slice(head.length + 1)] = buf.toString(); done(); }
      };
      const cleanup = () => { c.removeListener('message', on); clearTimeout(timer); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('記録が見つかりませんでした（期限が切れたか、リンクがまちがっています）')); }, 15000);
      c.on('message', on);
      c.subscribe([head, partsTopic], { qos: 1 });
    });
  } finally { try { c.unsubscribe([head, partsTopic]); } catch { /* 気にしない */ } if (own) setTimeout(() => c.end(), 300); }
}
async function shareRecord(rec, title) {
  if (!location.protocol.startsWith('http')) { toast('共有はネット版で使えます'); return; }
  let url;
  try {
    const data = await packRecord({ ...rec, title });
    const base = `${location.origin}${location.pathname}`;
    if (data.length <= REC_LINK_MAX) url = `${base}#rec=${data}`;
    else url = `${base}#recid=${await uploadRecord(data)}`;
  } catch (e) { showError('共有のリンクを作れませんでした', e); return; }
  const input = el('input', { type: 'text', class: 'full', value: url, readonly: true });
  showModal({
    title: '🔗 記録を共有', body: el('div', { class: 'stack' },
      el('p', { text: 'このリンクを開くと、アプリで記録を再生できます。' }), input,
      url.includes('#recid=') ? el('p', { class: 'muted small-note', text: '記録が長いので、公開の中継サーバーに置いて短いリンクにしました（しばらくすると消えることがあります）。' }) : null),
    buttons: [
      navigator.share ? { label: '送る', primary: true, onClick: () => { navigator.share({ title: title || '盤面の記録', url }).catch(() => {}); return false; } } : null,
      { label: 'コピー', primary: !navigator.share, onClick: () => { navigator.clipboard.writeText(url).then(() => toast('コピーしました')); return false; } },
    ].filter(Boolean),
  });
  setTimeout(() => input.select(), 0);
}
// リンク（#rec=… / #recid=…）で開かれたら再生する
async function openRecordFromHash() {
  const m = location.hash.match(/(?:^|[#&])rec(id)?=([^&]+)/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  for (let i = 0; i < 600 && !(DB.cards.length && Decks.list); i++) await new Promise(r => setTimeout(r, 100));
  showLoading('記録を読み込んでいます…');
  try {
    const data = m[1] ? await downloadRecord(m[2]) : m[2];
    const rec = await unpackRecord(data);
    showLoading(null);
    startReplay(rec, rec.title || '共有された記録', true);
  } catch (e) { showLoading(null); showError('記録を開けませんでした', e); }
}

// ---------- 再生 ----------
async function startReplay(rec, title, shared) {
  if (Rep.on) stopReplay();
  closeAllModals();
  // 今の状態を覚えておき、終わったら戻す
  Rep.saved = { S: Board.S, autoOn: Auto.on, duel: Auto.duel, net: Auto.net, pick: Board.pick, view: [...document.querySelectorAll('.view')].find(v => !v.hidden) };
  Rep.rec = rec; Rep.title = title; Rep.shared = !!shared; Rep.i = 0; Rep.playing = false;
  if (rec.kind === 'auto') {
    showLoading('再生の準備中…');
    try {
      await engineLoad(showLoading);
      const p = rec.p, all = [...p.main, ...(p.extra || [])];
      if (p.opp) all.push(...p.opp.main, ...(p.opp.extra || []));
      if (p.net) for (const [m, x] of p.net.decks) all.push(...m, ...x);
      await loadCardScripts([...all, OPP_FILLER], showLoading, p.errata);
    } catch (e) { showLoading(null); showError('再生の準備ができませんでした', e); return; }
    showLoading(null);
    const p = rec.p;
    const d = new AutoDuel({ main: p.main, extra: p.extra, handIds: p.handIds, handSize: p.handSize, seed: p.seed.map(s => BigInt(s)), opp: p.opp, chainMode: 'off', autoTrigger: false, firstDraw: p.firstDraw, tools: p.tools, rule: p.rule, speed: p.speed, errata: p.errata, sv: p.sv === 2 ? 2 : 1, net: p.net || null });
    d.replayOnly = true;   // 記録の返答が終わったら、そこで止まる（CPU も自分では動かない）
    Rep.duel = d;
    Rep.items = JSON.parse(JSON.stringify(rec.items), bigReviver);
    // 1手＝召喚・発動・フェイズ移動などの行動（自分も相手も）。最初と最後も入れる
    const isAction = x => x.res && (x.res.type === RES.SELECT_IDLECMD || x.res.type === RES.SELECT_BATTLECMD);
    Rep.steps = [0, ...Rep.items.map((x, i) => (isAction(x) && i > 0 ? i : -1)).filter(i => i > 0), Rep.items.length];
    Rep.steps = [...new Set(Rep.steps)];
    // 行動の説明を作るために一度最後まで流す
    try { d.create(); d.run(Rep.items.map(x => ({ ...x }))); Rep.labels = { ...d.labels }; } catch (e) { console.error(e); Rep.labels = {}; }
  } else {
    Rep.steps = rec.frames.map((_, i) => i);
  }
  Rep.on = true;
  document.body.classList.add('replaying');
  switchView('board');
  showReplayBar();
  replayGo(0);
}
function replayGo(i) {
  if (!Rep.on) return;
  i = Math.max(0, Math.min(Rep.steps.length - 1, i));
  Rep.i = i;
  const rec = Rep.rec;
  let label = '';
  try {
    if (rec.kind === 'auto') {
      const d = Rep.duel, at = Rep.steps[i];
      d.responses = []; d.userMarks = []; d.labels = {};
      d.create(); d.run(Rep.items.slice(0, at).map(x => ({ ...x })));
      Auto.duel = d; Auto.on = true; Auto.net = false;
      Board.S = autoState();
      if (rec.p.net && rec.names) Board.S.oppText = `${rec.names.opp || '相手'}：LP ${d.lp[1 - d.me]}　手札${Board.S.opp.hand}枚`;
      Board.pick = null;
      // 次の行動（召喚・発動・フェイズ移動など）
      const isAct = x => x && x.res && (x.res.type === RES.SELECT_IDLECMD || x.res.type === RES.SELECT_BATTLECMD);
      let na = at;
      while (na < Rep.items.length && !isAct(Rep.items[na])) na++;
      const next = Rep.items[na];
      const who = rec.p.net ? (rec.names && rec.names.opp) || '相手' : 'CPU';
      label = at >= Rep.items.length ? '最後の盤面' : !next ? '（このあと行動はありません）' : `次：${next.user ? Rep.labels[na] || '自分の行動' : who + 'の行動'}`;
      renderBoard();
    } else if (rec.kind === 'manual') {
      Auto.on = false;
      Board.S = { ...JSON.parse(rec.frames[i]), log: [] };
      Board.pick = null;
      label = Board.S.lastLog || (i === 0 ? '最初の盤面' : '');
      renderBoard();
    } else {
      // 手動の対戦：自分の盤面と、そのときの相手の盤面を一時的に戻して描く
      const f = JSON.parse(rec.frames[i]);
      Auto.on = false;
      Board.S = { ...f.S, log: [] };
      Board.pick = null;
      const save = { active: Duel.active, opp: Duel.opp, room: Duel.room, me: Duel.me };
      Duel.active = true; Duel.opp = f.opp; Duel.room = f.room; Duel.me = rec.me;
      try { renderBoard(); } finally { Object.assign(Duel, save); }
      label = Board.S.lastLog || '';
    }
  } catch (e) { console.error(e); label = '（この盤面は再生できませんでした：' + e.message + '）'; }
  const bar = $('#replay-bar');
  if (bar) {
    bar.querySelector('.rp-pos').textContent = `${i + 1} / ${Rep.steps.length}`;
    bar.querySelector('.rp-label').textContent = label;
    bar.querySelector('input[type=range]').value = i;
  }
}
function showReplayBar() {
  $('#replay-bar') && $('#replay-bar').remove();
  const range = el('input', { type: 'range', min: 0, max: Rep.steps.length - 1, value: 0 });
  range.addEventListener('input', () => { replayPause(); replayGo(+range.value); });
  const play = el('button', { class: 'btn small primary rp-play', text: '▶ 再生', onclick: () => (Rep.playing ? replayPause() : replayPlay()) });
  const bar = el('div', { id: 'replay-bar', class: 'replay-bar' },
    el('div', { class: 'row rp-top' }, el('b', { class: 'rp-title', text: '📼 ' + (Rep.title || '記録の再生') }), el('span', { class: 'rp-pos muted' }),
      Rep.shared ? el('button', { class: 'btn small', text: '保存', onclick: () => saveRecord(Rep.rec, Rep.title) }) : null,
      el('button', { class: 'btn small danger', text: '✕ 終わる', onclick: stopReplay })),
    el('div', { class: 'rp-label muted small-note' }),
    range,
    el('div', { class: 'row rp-btns' },
      el('button', { class: 'btn small', text: '⏮', title: '最初', onclick: () => { replayPause(); replayGo(0); } }),
      el('button', { class: 'btn small', text: '◀ 1手', onclick: () => { replayPause(); replayGo(Rep.i - 1); } }),
      play,
      el('button', { class: 'btn small', text: '1手 ▶', onclick: () => { replayPause(); replayGo(Rep.i + 1); } }),
      el('button', { class: 'btn small', text: '⏭', title: '最後', onclick: () => { replayPause(); replayGo(Rep.steps.length - 1); } })));
  document.body.append(bar);
}
function replayPlay() {
  if (Rep.i >= Rep.steps.length - 1) replayGo(0);
  Rep.playing = true;
  const b = $('#replay-bar .rp-play'); if (b) b.textContent = '⏸ 止める';
  clearInterval(Rep.timer);
  Rep.timer = setInterval(() => { if (Rep.i >= Rep.steps.length - 1) { replayPause(); return; } replayGo(Rep.i + 1); }, 1200);
}
function replayPause() {
  Rep.playing = false;
  clearInterval(Rep.timer);
  const b = $('#replay-bar .rp-play'); if (b) b.textContent = '▶ 再生';
}
function stopReplay() {
  if (!Rep.on) return;
  replayPause();
  Rep.on = false;
  document.body.classList.remove('replaying');
  $('#replay-bar') && $('#replay-bar').remove();
  const s = Rep.saved || {};
  Board.S = s.S; Auto.on = s.autoOn; Auto.duel = s.duel; Auto.net = s.net; Board.pick = null;
  Rep.duel = null; Rep.rec = null;
  renderBoard();
  if (s.view && s.view.id && s.view.id !== 'view-board') switchView(s.view.id.replace('view-', ''));
}
