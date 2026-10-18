// 一人回しの「効果を自動処理」モード。
// 盤面は engine.js の対戦（AutoDuel）から作り、カードをクリックすると今できる操作だけを出す。
// 効果の対象などの選択は、エンジンからの質問ごとに選択画面を出して自分で選ぶ。
const Auto = {
  on: false,   // setupAutoPlay で読む（ユーザーごとの設定）
  duel: null,
  closePrompt: null,
};

const autoActive = () => Auto.on && !(typeof Duel !== 'undefined' && Duel.active);
const autoKey = (con, loc, seq) => 1 + con * 100000 + loc * 100 + seq;
const POS_NAME = { 1: '表側攻撃表示', 2: '裏側攻撃表示', 4: '表側守備表示', 8: '裏側守備表示' };

// ---------- 盤面 ----------
function autoState() {
  const d = Auto.duel, me = d.me, q = d.query();
  const S = {
    auto: true, turn: d.turn || 1, ns: false, used: [], log: d.log, uidc: 0,
    hand: [], deck: [], gy: [], ban: [], extra: [],
    m: Array(5).fill(null), emz: [null, null], s: Array(5).fill(null), f: [null],
  };
  const mk = (c, loc, seq, forceUp) => {
    if (!c || !c.code) return null;
    return {
      uid: autoKey(me, loc, seq), id: c.code,
      faceUp: forceUp || !!(c.position & 5), pos: (loc === LOC.MZONE && c.position & 12) ? 'def' : 'atk',
      mats: (c.overlayCards || []).map((code, i) => ({ uid: autoKey(me, LOC.OVERLAY, seq * 10 + i), id: code, faceUp: true, pos: 'atk', mats: [], ctr: 0 })),
      ctr: Object.values(c.counters || {}).reduce((a, b) => a + b, 0),
      ref: { con: me, loc, seq },
    };
  };
  const side = q[me];
  side.hand.forEach((c, i) => { const x = mk(c, LOC.HAND, i, true); if (x) S.hand.push(x); });
  side.deck.forEach((c, i) => { const x = mk(c, LOC.DECK, i); if (x) { x.faceUp = false; S.deck.push(x); } });
  side.gy.forEach((c, i) => { const x = mk(c, LOC.GRAVE, i, true); if (x) S.gy.push(x); });
  side.ban.forEach((c, i) => { const x = mk(c, LOC.REMOVED, i); if (x) S.ban.push(x); });
  side.extra.forEach((c, i) => { const x = mk(c, LOC.EXTRA, i); if (x) S.extra.push(x); });
  side.m.forEach((c, i) => { const x = mk(c, LOC.MZONE, i); if (i < 5) S.m[i] = x; else if (i < 7) S.emz[i - 5] = x; });
  side.s.forEach((c, i) => { const x = mk(c, LOC.SZONE, i); if (i < 5) S.s[i] = x; else if (i === 5) S.f[0] = x; });
  // 相手（CPU）の盤面。対戦タブの相手の表示と同じ形にする（裏向きのカードは id を伏せる）
  const op = q[1 - me];
  const pub = (c, loc) => (c && c.code ? {
    id: c.position & 5 ? c.code : 0, faceUp: !!(c.position & 5), pos: loc === LOC.MZONE && c.position & 12 ? 'def' : 'atk',
    ctr: Object.values(c.counters || {}).reduce((a, b) => a + b, 0), mats: c.overlayCards || [],
  } : null);
  const count = a => a.filter(Boolean).length;
  S.opp = {
    lp: d.lp[1 - me], hand: count(op.hand), deck: count(op.deck), extra: count(op.extra),
    extraUp: op.extra.filter(c => c && c.position & 5).map(c => c.code),
    gy: op.gy.filter(Boolean).map(c => c.code), ban: op.ban.filter(Boolean).map(c => (c.position & 5 ? c.code : 0)),
    m: op.m.slice(0, 5).map(c => pub(c, LOC.MZONE)), emz: [pub(op.m[5], LOC.MZONE), pub(op.m[6], LOC.MZONE)],
    s: op.s.slice(0, 5).map(c => pub(c, LOC.SZONE)), f: [pub(op.s[5], LOC.SZONE)],
  };
  S.oppText = `CPU：LP ${d.lp[1 - me]}　手札${S.opp.hand}枚`;
  return S;
}

// 今の入力待ちで、そのカードにできる操作
function autoActions(inst) {
  const d = Auto.duel, p = d && d.pending;
  if (!p || !inst.ref) return [];
  const { con, loc, seq } = inst.ref;
  const same = c => c.controller === con && c.location === loc && c.sequence === seq;
  const out = [];
  const add = (list, label, action, kind) => list.forEach((c, index) => {
    if (same(c)) out.push({ label: typeof label === 'function' ? label(c) : label, kind: typeof kind === 'function' ? kind(c) : kind, res: { type: p.type === MSG.SELECT_BATTLECMD ? RES.SELECT_BATTLECMD : RES.SELECT_IDLECMD, action, index } });
  });
  const actLabel = c => { const t = descText(c.description); return t && !/^発動$/.test(t) ? `効果を発動：${t}` : '効果を発動'; };
  if (p.type === MSG.SELECT_IDLECMD) {
    // 発動しても何も起きない永続・フィールド魔法／永続罠は出さない（セットはできる）
    add(p.activates.map((c, i) => (Auto.useless && Auto.useless.has(i) ? { ...c, controller: -1 } : c)), actLabel, IDLE.ACTIVATE, 'y');
    // 通常召喚とセットは「召喚する」1つにまとめ、押したあとに表示形式を聞く
    const res = (action, list) => { const i = list.findIndex(same); return i < 0 ? null : { type: RES.SELECT_IDLECMD, action, index: i }; };
    const ns = res(IDLE.SUMMON, p.summons), mset = res(IDLE.MSET, p.monster_sets);
    if (ns || mset) {
      out.push({ label: '召喚する', kind: 'b', name: cardOf(inst).name, choose: [
        ns && { label: '表側攻撃表示で召喚', res: ns },
        mset && { label: 'セット（裏側守備表示）', res: mset },
      ].filter(Boolean) });
    }
    // 自分の方法で特殊召喚できる（手札・墓地などから）ものは効果と同じ黄色、EXデッキからの召喚とペンデュラム召喚は青
    add(p.special_summons, summonLabel, IDLE.SPSUMMON, c => (summonLabel(c) === '特殊召喚' ? 'y' : 'b'));
    add(p.spell_sets, 'セットする', IDLE.SSET);
    add(p.pos_changes, '表示形式を変更', IDLE.REPOS);
  } else if (p.type === MSG.SELECT_BATTLECMD) {
    add(p.chains, actLabel, BATTLE.CHAIN, 'y');
    add(p.attacks, c => (c.can_direct ? '攻撃する（直接攻撃できます）' : '攻撃する'), BATTLE.ATTACK, 'b');
  }
  // 召喚しかできないモンスターは、「攻撃表示で召喚」「セット」をそのままボタンにする
  if (out.length === 1 && out[0].choose) return out[0].choose.map(c => ({ label: c.label === '表側攻撃表示で召喚' ? '攻撃表示で召喚' : c.label, kind: 'b', res: c.res }));
  return out;
}

// 光らせる（黄＝発動、青＝召喚）。エンジンが「できる」と言ったものだけ
function autoGlow() {
  const map = new Map();
  const S = Board.S;
  if (!S || !Auto.duel) return map;
  const all = [...S.hand, ...S.gy, ...S.ban, ...S.extra, ...S.deck, ...S.m, ...S.emz, ...S.s, ...S.f].filter(Boolean);
  for (const inst of all) {
    const acts = autoActions(inst);
    if (acts.some(a => a.kind === 'y')) map.set(inst.uid, 'y');
    else if (acts.some(a => a.kind === 'b')) map.set(inst.uid, 'b');
  }
  return map;
}

function autoMenuItems(uid) {
  const loc = locate(uid);
  if (!loc) return [];
  const inst = loc.inst;
  const items = [{ head: cardOf(inst).name }];
  const acts = autoActions(inst);
  for (const a of acts) items.push({ label: a.label, onClick: () => runAction(a) });
  if (!acts.length) items.push({ label: Auto.duel && isPrompt(Auto.duel.pending) ? '先に選択画面で選んでください' : '今できる操作はありません', disabled: true, onClick: () => {} });
  return items;
}

const isPrompt = p => p && p.type !== MSG.SELECT_IDLECMD && p.type !== MSG.SELECT_BATTLECMD;

// ---------- 進める ----------
function autoRespond(res) {
  const d = Auto.duel;
  if (!d) return;
  Auto.redoLog = null;   // 新しい手を選んだら「1手進む」はできなくなる
  try { d.respond(res); } catch (e) { console.error(e); toast('処理中にエラーが起きました：' + e.message); }
  autoAfter();
}

function autoAfter(noAnim) {
  const d = Auto.duel;
  if (d.retry) { toast('その選び方はできません。選び直してください'); d.retry = false; }
  autoSave();
  findUseless(d);
  const events = d.events.splice(0);
  const anim = Auto.anim && !noAnim && events.length;
  const before = anim ? captureRects() : null;
  autoSync();
  if (anim) playEvents(events, before);
  if (!noAnim) queueActivations(events);
  if (isPrompt(d.pending)) openPrompt();
}

function autoSync() {
  if (!Auto.duel) return;
  Board.S = autoState();
  // 詳細欄に出しているカードを描き直す（使用済みのチェックを最新にする）
  if (!isMobile() && Board.detailCard) renderDetail($('#board-detail'), Board.detailCard);
  Board.pick = null;
  renderBoard();
}

function autoPanel() {
  const d = Auto.duel, p = d && d.pending;
  const st = $('#ap-status');
  if (!st) return;
  $('#ap-bp').hidden = $('#ap-ep').hidden = false;
  if (!d) { $('#ap-locks').hidden = true; st.textContent = '「シャッフルして開始」で始めます'; $('#ap-lp').textContent = ''; $('#ap-bp').disabled = $('#ap-ep').disabled = $('#ap-undo').disabled = $('#ap-open').disabled = $('#ap-rewind').disabled = true; return; }
  const phase = PHASE_NAME[d.phase] || '';
  let text;
  if (d.ended) text = `対戦終了（${d.ended}）`;
  else if (!p) text = '処理中…';
  else if (p.type === MSG.SELECT_IDLECMD) text = `T${d.turn} ${phase}：カードをクリックして操作`;
  else if (p.type === MSG.SELECT_BATTLECMD) text = `T${d.turn} バトルフェイズ：攻撃するモンスターや発動する効果をクリック`;
  else text = '選択待ち：' + promptTitle(p);
  st.textContent = text;
  st.classList.toggle('waiting', isPrompt(p));
  $('#ap-lp').textContent = Board.S && Board.S.oppText ? `自分：LP ${d.lp[d.me]}　／　${Board.S.oppText}` : '';
  const bp = $('#ap-bp'), ep = $('#ap-ep');
  if (p && p.type === MSG.SELECT_BATTLECMD) { bp.textContent = 'メインフェイズ2へ'; bp.disabled = !p.to_m2; ep.disabled = !p.to_ep; }
  else { bp.textContent = 'バトルフェイズへ'; bp.disabled = !(p && p.type === MSG.SELECT_IDLECMD && p.to_bp); ep.disabled = !(p && p.type === MSG.SELECT_IDLECMD && p.to_ep); }
  $('#ap-undo').disabled = !d.userMarks.length;
  $('#ap-rewind').disabled = !(Auto.redoLog && Auto.redoLog.length > d.responses.length);
  $('#ap-open').disabled = !isPrompt(p);
  renderChainBox();
  const locks = $('#ap-locks');
  locks.innerHTML = '';
  locks.hidden = !d.locks || !d.locks.length;
  if (!locks.hidden) { locks.append(el('li', { class: 'ap-locks-head', text: '今かかっている制限（縛り）' })); for (const l of d.locks) locks.append(el('li', { text: l.text })); }
}

function autoPhase(which) {
  const p = Auto.duel && Auto.duel.pending;
  if (!p) return;
  if (p.type === MSG.SELECT_IDLECMD) autoRespond({ type: RES.SELECT_IDLECMD, action: which === 'bp' ? IDLE.TO_BP : IDLE.TO_EP, index: null });
  else if (p.type === MSG.SELECT_BATTLECMD) autoRespond({ type: RES.SELECT_BATTLECMD, action: which === 'bp' ? BATTLE.TO_M2 : BATTLE.TO_EP, index: null });
}

function autoUndo() {
  const d = Auto.duel;
  if (!d || !d.userMarks.length) { toast('これ以上戻せません'); return; }
  closePromptModal();
  Auto.selQueue = null;
  // 戻す前の手順を覚えておく（「1手進む」でやり直せるように）
  if (!Auto.redoLog || Auto.redoLog.length < d.responses.length) Auto.redoLog = d.history();
  try { d.undo(); } catch (e) { toast('戻せませんでした：' + e.message); }
  autoAfter(true);
}

// 1手進む：戻した手順を、次の行動1つ分だけやり直す
function autoRedo() {
  const d = Auto.duel, log = Auto.redoLog;
  if (!d || !log || log.length <= d.responses.length) { toast('進める手がありません'); return; }
  const isAction = x => x.user && (x.res.type === RES.SELECT_IDLECMD || x.res.type === RES.SELECT_BATTLECMD);
  // 今の位置から先の、次の行動の始まり（ここから1手）と、その次の行動の始まり（ここまで流す）
  let from = d.responses.length;
  while (from < log.length && !isAction(log[from])) from++;
  if (from >= log.length) { toast('進める手がありません'); return; }
  let to = from + 1;
  while (to < log.length && !isAction(log[to])) to++;
  closePromptModal();
  Auto.selQueue = null;
  try { d.responses = []; d.userMarks = []; d.labels = {}; d.create(); d.run(log.slice(0, to).map(x => ({ ...x }))); } catch (e) { toast('進められませんでした：' + e.message); }
  if (d.responses.length >= log.length) Auto.redoLog = null;
  autoAfter(true);
}

// ---------- 開始・保存 ----------
async function autoPrepare(deck) {
  showLoading('自動処理の準備中…');
  try {
    await engineLoad(showLoading);
    await loadCardScripts([...deck.main, ...(deck.extra || []), OPP_FILLER], showLoading);
  } finally { showLoading(null); }
}

async function autoStart(handIds) {
  const deck = boardDeck();
  if (!deck || !deck.main.length) { toast('メインデッキが空です。先にデッキを作ってください'); return; }
  closeAllModals();
  try { await autoPrepare(deck); } catch (e) { toast('自動処理を準備できませんでした：' + e.message); return; }
  const handSize = +$('#b-handsize').value;
  const opp = oppDeck();
  if (opp) {
    try { await autoPrepare(opp); } catch (e) { toast('相手のデッキを準備できませんでした：' + e.message); return; }
  }
  Auto.redoLog = null;
  Auto.duel = new AutoDuel({ main: deck.main.filter(id => DB.byId.has(id)), extra: deck.extra.filter(id => DB.byId.has(id)), handIds: handIds && handIds.slice(0, 5), handSize, opp, chainMode: $('#ap-chain').value, autoTrigger: $('#ap-autotrig').checked });
  Auto.deckId = deck.id;
  try { Auto.duel.start(); } catch (e) { console.error(e); toast('開始できませんでした：' + e.message); Auto.duel = null; renderBoard(); return; }
  autoAfter();
}

function autoRestart() {
  if (!Auto.duel) { toast('まだ開始していません'); return; }
  closePromptModal();
  Auto.redoLog = null;
  Auto.duel.restart();
  autoAfter(true);
  toast('最初の状態に戻しました');
}

// 盤面は「最初の条件＋自分の選択の一覧」で保存し、開き直したら流し直す
const bigReplacer = (k, v) => (typeof v === 'bigint' ? { __big: String(v) } : v);
const bigReviver = (k, v) => (v && typeof v === 'object' && '__big' in v ? BigInt(v.__big) : v);
function autoSave() {
  const d = Auto.duel;
  if (!d) return;
  const items = d.history();
  try {
    store.set('ygo.autoBoard', JSON.parse(JSON.stringify({
      main: d.main, extra: d.extra, handIds: d.handIds, handSize: d.handSize, seed: d.seed, items, deckId: Auto.deckId, opp: d.opp, chainMode: d.chainMode, autoTrigger: d.autoTrigger,
    }, bigReplacer)));
  } catch { /* 保存できなくても続けられる */ }
}
async function autoResume() {
  let saved = null;
  try { saved = JSON.parse(JSON.stringify(store.get('ygo.autoBoard', null)), bigReviver); } catch { saved = null; }
  if (!saved || !saved.main || !saved.items) return;   // 古い形式の保存は使わない
  try { await autoPrepare(saved); if (saved.opp) await autoPrepare(saved.opp); } catch { return; }
  const d = new AutoDuel({ main: saved.main, extra: saved.extra, handIds: saved.handIds, handSize: saved.handSize, seed: saved.seed, opp: saved.opp, chainMode: saved.chainMode || 'auto', autoTrigger: !!saved.autoTrigger && store.get('ygo.autoTrigger', false) });
  Auto.duel = d; Auto.deckId = saved.deckId;
  try { d.create(); d.run(saved.items.map(x => ({ ...x }))); } catch (e) { console.error(e); Auto.duel = null; return; }
  if (autoActive()) autoAfter(true);
}

// ---------- モード切り替え ----------
function setBoardMode(auto) {
  Auto.on = auto;
  store.set('ygo.boardMode', auto ? 'auto' : 'manual');
  closeAllModals();
  Board.pick = null;
  if (auto) {
    Board.S = null;
    if (Auto.duel) autoSync(); else { renderBoard(); if (!Auto.resumed) { Auto.resumed = true; autoResume(); } }
  } else {
    const saved = store.get('ygo.board', null);
    Board.S = saved && saved.S ? saved.S : null;
    Board.initial = saved ? saved.initial : null;
    renderBoard();
  }
}

function setupAutoPlay() {
  $$('#b-mode button').forEach(b => { b.onclick = () => setBoardMode(b.dataset.mode === 'auto'); });
  $('#ap-bp').onclick = () => autoPhase('bp');
  $('#ap-ep').onclick = () => autoPhase('ep');
  $('#ap-undo').onclick = autoUndo;
  $('#ap-rewind').onclick = autoRedo;
  $('#ap-open').onclick = () => { if (Auto.duel && isPrompt(Auto.duel.pending)) openPrompt(); };
  $('#mb-auto').onclick = e => {
    const p = Auto.duel && Auto.duel.pending;
    const r = e.target.getBoundingClientRect();
    showMenu(r.left, r.top - 10, [
      { head: $('#ap-status').textContent },
      { label: '選択画面を開く', disabled: !isPrompt(p), onClick: () => openPrompt() },
      { label: p && p.type === MSG.SELECT_BATTLECMD ? 'メインフェイズ2へ' : 'バトルフェイズへ', disabled: $('#ap-bp').disabled, onClick: () => autoPhase('bp') },
      { label: 'ターン終了', disabled: $('#ap-ep').disabled, onClick: () => autoPhase('ep') },
      { label: '⏪ 1手戻す', disabled: $('#ap-undo').disabled, onClick: () => autoUndo() },
      { label: '1手進む ⏩', disabled: $('#ap-rewind').disabled, onClick: () => autoRedo() },
    ]);
  };
  // 設定（相手・チェーン確認・演出）
  if (store.get('ygo.oppMode', null) === null && store.get('ygo.autoOpp', '') === 'none') store.set('ygo.oppMode', 'none');   // 前の「相手：何もしない」の設定を引き継ぐ
  refreshOppSelect();
  $('#ap-opp').onchange = e => { store.set('ygo.autoOpp', e.target.value); toast('次に開始したときから、このデッキになります'); };
  $$('#ap-oppmode button').forEach(b => { b.onclick = () => { store.set('ygo.oppMode', b.dataset.v); renderOppSettings(); toast(b.dataset.v === 'trap' ? '誘発練習：次に開始したときから、相手が手札誘発を使ってきます' : '次に開始したときから、相手は何もしません'); }; });
  $('#ap-trappick').onclick = openOppHandPicker;
  $('#ap-chain').value = store.get('ygo.chainMode', 'auto');
  const chainNote = { off: 'チェーンの確認をしません（必ず答える場面だけ聞きます）', always: '召喚・発動などのあと、発動できるものがあれば毎回聞きます', auto: '効果が発動したとき、それに対して発動できるものがあるときだけ聞きます' };
  const paintChain = () => { const v = $('#ap-chain').value; $$('#ap-chainseg button').forEach(b => b.classList.toggle('on', b.dataset.v === v)); $('#ap-chainnote').textContent = chainNote[v] || ''; };
  $$('#ap-chainseg button').forEach(b => { b.onclick = () => { $('#ap-chain').value = b.dataset.v; $('#ap-chain').onchange({ target: $('#ap-chain') }); }; });
  paintChain();
  $('#ap-chain').onchange = e => {
    store.set('ygo.chainMode', e.target.value);
    paintChain();
    if (Auto.duel) { Auto.duel.chainMode = e.target.value; autoSave(); }
  };
  // 任意の効果は聞くのが標準（前に自動にしていた設定は1回だけオフに戻す）
  if (!store.get('ygo.autoTrigger2', false)) { store.set('ygo.autoTrigger2', true); store.set('ygo.autoTrigger', false); }
  $('#ap-autotrig').checked = store.get('ygo.autoTrigger', false);
  $('#ap-autotrig').onchange = e => {
    store.set('ygo.autoTrigger', e.target.checked);
    if (Auto.duel) { Auto.duel.autoTrigger = e.target.checked; autoSave(); }
  };
  Auto.anim = store.get('ygo.autoAnim', true);
  $('#ap-anim').checked = Auto.anim;
  $('#ap-anim').onchange = e => { Auto.anim = e.target.checked; store.set('ygo.autoAnim', Auto.anim); };
  // 「効果を自動処理」を標準にする（前に手動を使っていた人も1回だけ切り替える。左上でいつでも手動に戻せる）
  if (!store.get('ygo.autoDefault1', false)) {
    store.set('ygo.autoDefault1', true);
    if (store.get('ygo.boardMode', 'auto') !== 'auto') { store.set('ygo.boardMode', 'auto'); setTimeout(() => toast('一人回しを「効果を自動処理」モードにしました（左上で「手動」に戻せます）'), 1500); }
  }
  Auto.on = store.get('ygo.boardMode', 'auto') === 'auto';
  if (Auto.on) { Auto.resumed = true; autoResume(); }
}

// ---------- 相手（何もしない／誘発練習） ----------
// 手札誘発セット：よく使われる妨害カード＋何もしない通常モンスター
const HANDTRAP_SET = [[14558127, 3], [23434538, 3], [97268402, 3], [10045474, 3], [94145021, 2], [73642296, 2], [59438930, 3], [24224830, 2]];
// 相手の手札を選ぶときに上に出すカード（名前で探す。無いものは出さない）
const HANDTRAP_NAMES = ['灰流うらら', '増殖するG', 'エフェクト・ヴェーラー', '無限泡影', 'ドロール＆ロックバード', '屋敷わらし', '幽鬼うさぎ',
  '墓穴の指名者', '原始生命態ニビル', 'PSYフレームギア・γ', '儚無みずき', '浮幽さくら', '朔夜しぐれ', 'D.D.クロウ', 'ディメンション・シフター', '抹殺の指名者', '三戦の才', 'センサー万別'];
const oppMode = () => store.get('ygo.oppMode', 'trap');
const oppHandIds = () => store.get('ygo.oppHand', []).filter(id => DB.byId.has(id));

function refreshOppSelect() {
  const sel = $('#ap-opp');
  if (!sel) return;
  const cur = store.get('ygo.autoOpp', 'handtraps');
  sel.innerHTML = '';
  sel.append(el('option', { value: 'handtraps', text: '手札誘発セット（うらら・G・ヴェーラーなど）' }));
  for (const d of Decks.list) sel.append(el('option', { value: 'deck:' + d.id, text: `デッキ「${d.name}」` }));
  sel.value = [...sel.options].some(o => o.value === cur) ? cur : 'handtraps';
  renderOppSettings();
}

function renderOppSettings() {
  const mode = oppMode();
  $$('#ap-oppmode button').forEach(b => b.classList.toggle('on', b.dataset.v === mode));
  $('#ap-trapbox').hidden = mode !== 'trap';
  const box = $('#ap-traphand');
  box.innerHTML = '';
  const ids = oppHandIds();
  if (!ids.length) box.append(el('span', { class: 'muted small-note', text: 'ランダム（デッキから5枚引く）' }));
  else box.append(...ids.map(id => el('span', { class: 'chip', text: DB.byId.get(id).name })),
    el('span', { class: 'muted small-note', text: ids.length < 5 ? `（残り${5 - ids.length}枚はデッキから）` : '' }));
}

function oppDeck() {
  if (oppMode() !== 'trap') return null;
  const v = $('#ap-opp').value;
  let deck = null;
  if (v.startsWith('deck:')) {
    const d = Decks.get(v.slice(5));
    if (d && d.main.length) deck = { main: d.main.filter(id => DB.byId.has(id)), extra: d.extra.filter(id => DB.byId.has(id)) };
  }
  if (!deck) {
    const main = [];
    for (const [id, n] of HANDTRAP_SET) if (DB.byId.has(id)) for (let i = 0; i < n; i++) main.push(id);
    while (main.length < 40) main.push(OPP_FILLER);
    deck = { main, extra: [] };
  }
  // 選んだ初手は、デッキに無ければ足す（何もしないカードと入れ替え）
  const handIds = oppHandIds().slice(0, 5);
  for (const id of handIds) {
    const need = handIds.filter(x => x === id).length, have = deck.main.filter(x => x === id).length;
    for (let k = have; k < need; k++) { const f = deck.main.indexOf(OPP_FILLER); if (f >= 0) deck.main[f] = id; else deck.main.push(id); }
  }
  deck.handIds = handIds;
  return deck;
}

// 相手の初手を選ぶ画面
function openOppHandPicker() {
  const chosen = oppHandIds();
  const list = el('div', { class: 'pile-list' });
  const info = el('p', { class: 'muted' });
  const search = el('input', { type: 'text', class: 'full', placeholder: 'ほかのカードを名前で探す' });
  const draw = () => {
    info.textContent = `相手の初手にするカードを選んでください（${chosen.length}／5枚。足りない分はデッキから引きます）`;
    list.innerHTML = '';
    const q = search.value.trim();
    const cards = q ? searchCards({ q }).slice(0, 40) : HANDTRAP_NAMES.map(n => DB.cards.find(c => c.name === n)).filter(Boolean);
    for (const c of cards) {
      const k = chosen.filter(x => x === c.id).length;
      list.append(el('div', { class: 'pile-row' + (k ? ' chosen' : '') }, rowMark(c),
        el('div', { class: 'r-main' }, el('div', { class: 'r-name', text: c.name }), el('div', { class: 'r-info', text: typeLine(c) })),
        el('button', { class: 'btn small', text: '−', disabled: !k, onclick: () => { chosen.splice(chosen.indexOf(c.id), 1); draw(); } }),
        el('b', { class: 'qty', text: String(k) }),
        el('button', { class: 'btn small', text: '＋', disabled: chosen.length >= 5 || k >= 3, onclick: () => { chosen.push(c.id); draw(); } })));
    }
  };
  search.addEventListener('input', draw);
  draw();
  showModal({
    title: '相手の初手（誘発練習）', wide: true, body: el('div', { class: 'stack' }, info, search, list),
    buttons: [
      { label: 'この手札にする', primary: true, onClick: () => { store.set('ygo.oppHand', chosen); renderOppSettings(); toast('次に開始したときから、この手札になります'); } },
      { label: 'ランダムに戻す', onClick: () => { store.set('ygo.oppHand', []); renderOppSettings(); } },
    ],
  });
}

// ---------- カードの上に出す操作ボタン（マスターデュエル風） ----------
function autoActionPopup(uid) {
  hideActionPopup();
  const node = document.querySelector(`.bcard[data-uid="${uid}"]`);
  const loc = locate(uid);
  if (!node || !loc) return false;
  const acts = autoActions(loc.inst);
  if (!acts.length) return false;
  const box = el('div', { class: 'ap-actions', id: 'ap-actions' },
    acts.map(a => el('button', { class: 'ap-act' + (a.kind ? ' k-' + a.kind : ''), text: a.label, onclick: e => { e.stopPropagation(); hideActionPopup(); runAction(a); } })),
    isMobile() ? el('button', { class: 'ap-act k-info', text: '🔍 詳細', onclick: e => { e.stopPropagation(); hideActionPopup(); showBoardDetail(loc); } }) : null);
  document.body.append(box);
  const r = node.getBoundingClientRect(), b = box.getBoundingClientRect();
  let left = r.left + r.width / 2 - b.width / 2, top = r.top - b.height - 6;
  if (top < 4) top = r.bottom + 6;
  left = Math.max(4, Math.min(left, innerWidth - b.width - 4));
  box.style.left = left + 'px'; box.style.top = top + 'px';
  setTimeout(() => document.addEventListener('pointerdown', onOutsideAction, true), 0);
  return true;
}
function onOutsideAction(e) { if (!e.target.closest('#ap-actions')) hideActionPopup(); }
function hideActionPopup() {
  const b = $('#ap-actions');
  if (b) b.remove();
  document.removeEventListener('pointerdown', onOutsideAction, true);
}

// ---------- 演出 ----------
// 位置ごとの画面上の四角（動く前と後で比べる）
function captureRects() {
  const me = Auto.duel.me, op = 1 - me, map = new Map();
  const put = (k, n) => { if (n) map.set(k, n.getBoundingClientRect()); };
  const L = { m: LOC.MZONE, emz: LOC.MZONE, s: LOC.SZONE, f: LOC.SZONE, gy: LOC.GRAVE, ban: LOC.REMOVED, extra: LOC.EXTRA, deck: LOC.DECK };
  const seqOf = (z, i) => (z === 'emz' ? 5 + i : z === 'f' ? 5 : i);
  $$('#field .slot[data-zone]').forEach(n => put(`${me}-${L[n.dataset.zone]}-${seqOf(n.dataset.zone, +n.dataset.idx)}`, n));
  $$('#field .pile[data-zone]').forEach(n => put(`${me}-${L[n.dataset.zone]}`, n));
  $$('#hand .bcard').forEach((n, i) => put(`${me}-${LOC.HAND}-${i}`, n));
  put(`${me}-${LOC.HAND}`, $('#hand'));
  $$('#field [data-ozone]').forEach(n => put(n.dataset.oidx !== undefined ? `${op}-${L[n.dataset.ozone]}-${seqOf(n.dataset.ozone, +n.dataset.oidx)}` : `${op}-${L[n.dataset.ozone]}`, n));
  put(`${op}-${LOC.HAND}`, $('#opp-bar'));
  return map;
}
const rectAt = (map, p) => map.get(`${p.con}-${p.loc & ~LOC.OVERLAY}-${p.seq}`) || map.get(`${p.con}-${p.loc & ~LOC.OVERLAY}`) || map.get(`${p.con}-${LOC.HAND}`);

function playEvents(events, before) {
  if (!events.length) return;
  const after = captureRects();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let n = 0;
  for (const ev of events) {
    if (ev.t !== 'move' || n >= 14 || reduce) continue;
    const a = rectAt(before, ev.from), b = rectAt(after, ev.to);
    if (!a || !b) continue;
    const card = DB.byId.get(ev.code);
    const showFace = card && (ev.faceUp || ev.to.con === Auto.duel.me);
    const w = Math.min(b.width, 90), h = w * 1.46;
    const ghost = el('div', { class: 'ap-ghost' }, cardFace(showFace ? card : null, { faceDown: !showFace }));
    ghost.style.width = w + 'px';
    document.body.append(ghost);
    const at = r => `translate(${r.left + r.width / 2 - w / 2}px, ${r.top + r.height / 2 - h / 2}px)`;
    ghost.animate([{ transform: at(a), opacity: 0.9 }, { transform: at(b), opacity: 1 }], { duration: 420, delay: n * 90, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'both' })
      .finished.then(() => ghost.remove(), () => ghost.remove());
    n++;
  }
  // 召喚したゾーンを光らせる
  for (const ev of events) {
    if (ev.t !== 'summon') continue;
    const sel = ev.con === Auto.duel.me ? `#field .slot[data-zone="${ev.seq >= 5 ? 'emz' : 'm'}"][data-idx="${ev.seq >= 5 ? ev.seq - 5 : ev.seq}"]` : `#field [data-ozone="m"][data-oidx="${ev.seq}"]`;
    const node = $(sel);
    if (node) { node.classList.add('ap-flash'); setTimeout(() => node.classList.remove('ap-flash'), 900); }
  }
}

// 発動したカードを大きく出す（順番に）
const activationQueue = [];
function queueActivations(events) {
  const me = Auto.duel.me;
  for (const ev of events) {
    if (ev.t !== 'chain') continue;
    if (ev.con !== me) toast(`CPU が「${cardName(ev.code)}」を発動しました`);
    if (Auto.anim && !matchMedia('(prefers-reduced-motion: reduce)').matches) activationQueue.push(ev);
  }
  if (activationQueue.length && !activationQueue.running) showNextActivation();
}
function showNextActivation() {
  const ev = activationQueue.shift();
  if (!ev) { activationQueue.running = false; return; }
  activationQueue.running = true;
  const card = DB.byId.get(ev.code);
  const mine = ev.con === Auto.duel.me;
  const pop = el('div', { class: 'ap-activate' + (mine ? '' : ' opp') },
    el('div', { class: 'ap-act-card' }, cardFace(card || null, { faceDown: !card })),
    el('div', { class: 'ap-act-text' }, el('b', { text: `チェーン${ev.n}` }), el('span', { text: (mine ? '' : 'CPU：') + cardName(ev.code) }), ev.desc ? el('small', { text: ev.desc }) : null));
  document.body.append(pop);
  pop.animate([{ opacity: 0, transform: 'translate(-50%, -50%) scale(.85)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.2 }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.8 }, { opacity: 0, transform: 'translate(-50%, -50%) scale(1.05)' }],
    { duration: activationQueue.length > 2 ? 700 : 1100, easing: 'ease-out', fill: 'both' })
    .finished.then(() => { pop.remove(); showNextActivation(); }, () => { pop.remove(); showNextActivation(); });
  pop.addEventListener('click', () => pop.getAnimations().forEach(a => a.finish()));
}

// 処理中のチェーン（選択待ちのあいだ盤面に出す）
function renderChainBox() {
  let box = $('#ap-chainbox');
  const d = Auto.duel;
  const chain = d && isPrompt(d.pending) ? d.chain : [];
  if (!chain.length) { if (box) box.remove(); return; }
  if (!box) { box = el('div', { class: 'ap-chainbox', id: 'ap-chainbox' }); $('.board-center').append(box); }
  box.innerHTML = '';
  box.append(el('b', { text: 'チェーン' }));
  for (const c of [...chain].reverse()) box.append(el('div', { class: 'ap-link' + (c.con === d.me ? '' : ' opp') }, `${c.n}. ${c.con === d.me ? '' : 'CPU：'}${cardName(c.code)}`));
}

// ---------- 選択画面 ----------
function closePromptModal() { if (Auto.closePrompt) { Auto.closePrompt(); Auto.closePrompt = null; } }

function promptTitle(p) {
  const hint = Auto.duel && Auto.duel.hint ? descText(Auto.duel.hint) : '';
  switch (p.type) {
    case MSG.SELECT_CHAIN: return 'チェーンして発動しますか？';
    case MSG.SELECT_EFFECTYN: return `「${cardName(p.code)}」の効果を発動しますか？`;
    case MSG.SELECT_YESNO: return descText(p.description) || 'はい／いいえ';
    case MSG.SELECT_OPTION: return '効果を選んでください';
    case MSG.SELECT_POSITION: return `「${cardName(p.code)}」の表示形式を選んでください`;
    case MSG.SELECT_PLACE: return 'カードを置く場所を選んでください';
    case MSG.SELECT_DISFIELD: return '使用不可にする場所を選んでください';
    case MSG.SELECT_TRIBUTE: return 'リリースするモンスターを選んでください';
    case MSG.SELECT_SUM: return hint || '素材にするカードを選んでください';
    case MSG.SORT_CARD: return 'カードの順番';
    case MSG.ANNOUNCE_RACE: return '種族を宣言してください';
    case MSG.ANNOUNCE_ATTRIB: return '属性を宣言してください';
    case MSG.ANNOUNCE_CARD: return 'カード名を宣言してください';
    case MSG.ANNOUNCE_NUMBER: return '数字を選んでください';
    case MSG.SELECT_COUNTER: return 'カウンターを取り除くカードを選んでください';
    default: return hint && !/^「カード\d+」/.test(hint) ? hint : 'カードを選んでください';
  }
}

// 選択画面の共通の形
// 選択は画面下の帯に出す（盤面は見えたまま。マスターデュエル風）
function promptModal(body, buttons = [], title) {
  closePromptModal();
  const p = Auto.duel.pending;
  const sheet = el('div', { class: 'ap-sheet', id: 'ap-sheet' },
    el('div', { class: 'ap-sheet-head' },
      el('b', { text: title || promptTitle(p) }),
      el('button', { class: 'btn small', text: '盤面を見る', title: '左の「選択画面を開く」でまた出せます', onclick: () => closePromptModal() })),
    el('div', { class: 'ap-sheet-body' }, body),
    buttons.length ? el('div', { class: 'ap-sheet-foot' }, buttons.map(b =>
      el('button', { class: 'btn' + (b.primary ? ' primary' : ''), text: b.label, onclick: () => { if (b.onClick() !== false) closePromptModal(); } }))) : null);
  document.body.append(sheet);
  const close = () => {
    sheet.remove();
    if (Auto.selectable) { Auto.selectable = null; Auto.pickFromBoard = null; renderBoard(); }
    autoPanel();
  };
  Auto.closePrompt = close;
  return close;
}
const answer = res => { closePromptModal(); autoRespond(res); };

// カード1枚の表示（選択画面用）
function promptCard(c, extra) {
  const card = DB.byId.get(c.code) || { name: c.code ? cardName(c.code) : '裏側のカード', type: 0 };
  const hidden = !c.code;
  const node = el('div', { class: 'ap-item' },
    el('div', { class: 'ap-face' }, cardFace(card, { faceDown: hidden, small: true })),
    el('div', { class: 'ap-text' },
      el('div', { class: 'ap-name', text: hidden ? '裏側のカード' : card.name }),
      el('div', { class: 'ap-place muted', text: placeText(c.controller, c.location, c.sequence) + (extra ? '　' + extra : '') })));
  node.addEventListener('contextmenu', e => { e.preventDefault(); if (!hidden) showCardDetail(card, '#board-detail'); });
  return node;
}

// 複数枚から min〜max 枚を選ぶ
function chooseCards(cards, { min, max, canCancel, extra, onDone, onCancel, note }) {
  const chosen = new Set();
  const grid = el('div', { class: 'ap-grid' });
  const info = el('p', { class: 'muted' });
  const ok = el('button', { class: 'btn primary', text: '決定' });
  // 同じ名前のカードを隣どうしに並べる（1枚ずつ別の札）
  const groups = [];
  const byKey = new Map();
  cards.forEach((c, i) => {
    const key = `card|${i}`;   // 同じカードも1枚ずつ別の札にして、名前ごとに隣へ並べる
    let g = byKey.get(key);
    if (!g) { g = { key, code: c.code, idx: [] }; byKey.set(key, g); groups.push(g); }
    g.idx.push(i);
  });
  // 名前ごとに固める（最初に出てきた順を保つ）
  const firstOf = new Map();
  groups.forEach((g, k) => { if (!firstOf.has(g.code)) firstOf.set(g.code, k); });
  groups.sort((a, b) => firstOf.get(a.code) - firstOf.get(b.code));
  const tileOf = new Map();
  const refresh = () => {
    const names = [...chosen].map(i => cards[i] && cards[i].code ? cardName(cards[i].code) : '裏側のカード');
    info.textContent = (note ? note + '　' : '') + (min === max ? `${min}枚選んでください` : `${min}〜${max}枚選んでください`) + (names.length ? `（選択中：${names.join('、')}）` : '（カードを押して選び、「決定」で確定します）');
    ok.disabled = chosen.size < min || chosen.size > max;
    for (const g of groups) {
      const n = tileOf.get(g), k = g.idx.filter(i => chosen.has(i)).length;
      n.classList.toggle('on', k > 0);
      const badge = n.querySelector('.ap-count');
      if (badge) badge.textContent = k ? `${k}／${g.idx.length}枚選択` : `×${g.idx.length}`;
    }
    if (Auto.selectable) renderBoard();
  };
  // 札を押したとき：1枚選ぶなら切り替え。まとめた札は押すたびに1枚ずつ増え、全部選んだらもう一度押すと外れる
  const press = g => {
    const sel = g.idx.filter(i => chosen.has(i)), free = g.idx.filter(i => !chosen.has(i));
    if (max === 1) { const had = sel.length > 0; chosen.clear(); if (!had) chosen.add(g.idx[0]); refresh(); return; }
    if (free.length && chosen.size < max) chosen.add(free[0]);
    else sel.forEach(i => chosen.delete(i));
    refresh();
  };
  // 選べるカードの場所が分かれているときは、場所ごとに見出しを付けて分ける（場・手札・墓地・除外・デッキ…）
  const me = Auto.duel.me;
  const AREA = [[LOC.MZONE | LOC.SZONE | LOC.FZONE | LOC.PZONE, 'フィールド'], [LOC.HAND, '手札'], [LOC.GRAVE, '墓地'], [LOC.REMOVED, '除外'], [LOC.DECK, 'デッキ'], [LOC.EXTRA, 'EXデッキ'], [LOC.OVERLAY, 'X素材']];
  const areaOf = c => {
    const k = c.location & LOC.OVERLAY ? AREA.length - 1 : AREA.findIndex(([m]) => c.location & m);
    const i = k < 0 ? AREA.length : k;
    return { key: (c.controller === me ? 0 : 1) * 100 + i, label: (c.controller === me ? '' : '相手の') + (AREA[i] ? AREA[i][1] : 'その他') };
  };
  const sections = new Map();
  for (const g of groups) {
    const c = cards[g.idx[0]];
    const n = promptCard(c, extra && extra(c, g.idx[0]));
    if (g.idx.length > 1) n.append(el('div', { class: 'ap-count' }));
    n.addEventListener('click', () => press(g));
    tileOf.set(g, n);
    const a = areaOf(c);
    if (!sections.has(a.key)) sections.set(a.key, { label: a.label, tiles: [], count: 0 });
    const s = sections.get(a.key);
    s.tiles.push(n); s.count += g.idx.length;
  }
  let list;
  if (sections.size > 1) {
    list = el('div', { class: 'ap-sections' }, [...sections.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) =>
      el('div', { class: 'ap-section' }, el('div', { class: 'ap-sec-head', text: `${s.label}（${s.count}枚）` }), el('div', { class: 'ap-grid' }, s.tiles))));
  } else {
    for (const s of sections.values()) grid.append(...s.tiles);
    list = grid;
  }
  ok.onclick = () => onDone([...chosen].sort((a, b) => a - b));
  const foot = el('div', { class: 'row' }, ok, canCancel ? el('button', { class: 'btn', text: 'キャンセル', onclick: onCancel }) : null);
  refresh();
  promptModal(el('div', { class: 'stack' }, info, list, foot));
  // 盤面・手札のカードを直接押したときは、そのカードが入っている札を押したことにする
  boardPickable(cards, i => press(groups.find(g => g.idx.includes(i))), chosen);
}

// 選べるカードのうち、盤面・手札にある自分のカードは、盤面をクリックしても選べるようにする
function boardPickable(cards, pick, chosen) {
  const me = Auto.duel.me;
  const map = new Map();
  cards.forEach((c, i) => { if (c.controller === me && (c.location & (LOC.MZONE | LOC.SZONE | LOC.HAND))) map.set(autoKey(me, c.location, c.sequence), i); });
  if (!map.size) return;
  Auto.selectable = map;
  Auto.chosen = chosen || new Set();
  Auto.pickFromBoard = uid => { if (map.has(uid)) pick(map.get(uid)); };
  renderBoard();
}

function yesNo(text, onAnswer, card, labels = ['はい', 'いいえ'], note) {
  promptModal(el('div', { class: 'stack' }, card ? promptCard(card) : null, el('p', { class: 'ap-question', text }), note ? el('p', { class: 'muted', text: note }) : null), [
    { label: labels[0], primary: true, onClick: () => { onAnswer(true); return false; } },
    { label: labels[1], onClick: () => { onAnswer(false); return false; } },
  ]);
}

function openPrompt() {
  const d = Auto.duel, p = d && d.pending;
  if (!isPrompt(p)) { Auto.selQueue = null; return; }
  if (p.type !== MSG.SELECT_UNSELECT_CARD) Auto.selQueue = null;
  const me = d.me;
  switch (p.type) {
    case MSG.SELECT_CARD:
      chooseCards(p.selects, { min: p.min, max: p.max, canCancel: p.can_cancel,
        onDone: idx => answer({ type: RES.SELECT_CARD, indicies: idx }), onCancel: () => answer({ type: RES.SELECT_CARD, indicies: null }) });
      break;
    case MSG.SELECT_TRIBUTE:
      chooseCards(p.selects, { min: p.min, max: p.max, canCancel: p.can_cancel,
        onDone: idx => answer({ type: RES.SELECT_TRIBUTE, indicies: idx }), onCancel: () => answer({ type: RES.SELECT_TRIBUTE, indicies: null }) });
      break;
    case MSG.SELECT_SUM: {
      const lv = c => { const a = c.amount & 0xffff, b = c.amount >>> 16; return b && b !== a ? `${a}／${b}` : String(a); };
      const must = p.selects_must.length ? `必ず使うカード：${p.selects_must.map(c => cardName(c.code)).join('、')}。` : '';
      chooseCards(p.selects, { min: Math.max(p.min, 1), max: p.max || p.selects.length, extra: c => `数値 ${lv(c)}`,
        note: `${must}合計が ${p.amount}${p.select_max ? ' 以上' : ''} になるように`,
        onDone: idx => answer({ type: RES.SELECT_SUM, indicies: idx }) });
      break;
    }
    case MSG.SELECT_UNSELECT_CARD: {
      // エンジンは1枚ずつ聞いてくるので、画面ではまとめて選んでもらい、「決定」のあとで1枚ずつ送る
      const q = Auto.selQueue;
      if (q) {
        const same = (a, b) => a.controller === b.controller && a.location === b.location && a.sequence === b.sequence;
        if (q.length) {
          const i = p.select_cards.findIndex(c => same(c, q[0]));
          if (i >= 0) { q.shift(); autoRespond({ type: RES.SELECT_UNSELECT_CARD, index: i }); break; }
        } else if (p.can_finish) { Auto.selQueue = null; autoRespond({ type: RES.SELECT_UNSELECT_CARD, index: null }); break; }
        Auto.selQueue = null;   // 選んだ組み合わせでは足りない・選べない：残りを画面で選んでもらう
      }
      const done = p.unselect_cards.length;
      const hintNo = Number(BigInt(d.hint || 0) & 0xfffffn), hintCard = Number(BigInt(d.hint || 0) >> 20n);
      const multi = !hintCard && [511, 512, 513, 533].includes(hintNo);   // 511融合 512シンクロ 513エクシーズ 533リンク素材
      const note = done ? `選んだカード：${p.unselect_cards.map(c => cardName(c.code)).join('、')}。続けて選んでください` : '';
      chooseCards(p.select_cards, {
        // 素材を選ぶとき（リンク・シンクロ・エクシーズ・融合）は、エンジンが1枚ずつ聞いてきても画面ではまとめて選べるようにする
        min: p.can_finish ? 0 : 1, max: multi ? p.select_cards.length : Math.max(p.max - done, 1), canCancel: p.can_cancel || p.can_finish, note: note || (multi ? '素材にするカードをすべて選んで「決定」を押してください' : ''),
        onDone: idx => {
          closePromptModal();
          if (!idx.length) { autoRespond({ type: RES.SELECT_UNSELECT_CARD, index: null }); return; }
          Auto.selQueue = idx.map(i => p.select_cards[i]);
          openPrompt();
        },
        onCancel: () => { closePromptModal(); Auto.selQueue = null; autoRespond({ type: RES.SELECT_UNSELECT_CARD, index: null }); },
      });
      break;
    }
    case MSG.SELECT_CHAIN: {
      // 発動する効果を選んでから「発動する」で確定
      let pick = -1;
      const grid = el('div', { class: 'ap-grid' });
      const go = el('button', { class: 'btn primary', text: '発動する', disabled: true, onclick: () => answer({ type: RES.SELECT_CHAIN, index: pick }) });
      p.selects.forEach((c, i) => {
        const n = promptCard(c, descText(c.description));
        n.onclick = () => { pick = pick === i ? -1 : i; [...grid.children].forEach((x, k) => x.classList.toggle('on', k === pick)); go.disabled = pick < 0; };
        grid.append(n);
      });
      promptModal(el('div', { class: 'stack' }, el('p', { class: 'muted', text: '発動する効果を選んで「発動する」を押してください' }), grid,
        el('div', { class: 'row' }, go, p.forced ? null : el('button', { class: 'btn', text: '発動しない', onclick: () => answer({ type: RES.SELECT_CHAIN, index: null }) }))));
      break;
    }
    case MSG.SELECT_EFFECTYN:
    {
      // 発動するかどうかを聞く（「特殊召喚する」などは効果の中身として下に小さく出す）
      const what = descText(p.description);
      yesNo(`「${cardName(p.code)}」の効果を発動しますか？`, yes => answer({ type: RES.SELECT_EFFECTYN, yes }), p,
        ['発動する', '発動しない'], what && !/発動/.test(what) ? `発動する効果：${what}` : null);
      break;
    }
    case MSG.SELECT_YESNO: {
      // 効果の処理の途中で「〜できる」部分を行うかどうか
      const code = Number(BigInt(p.description || 0) >> 20n);
      yesNo(descText(p.description) || 'はい／いいえ', yes => answer({ type: RES.SELECT_YESNO, yes }), null, ['はい', 'いいえ'],
        code ? `「${cardName(code)}」の効果の処理の途中です（効果の中の「〜できる」部分を行うかどうか）` : null);
      break;
    }
    case MSG.SELECT_OPTION:
      promptModal(el('div', { class: 'stack' }, p.options.map((o, i) =>
        el('button', { class: 'btn full', text: descText(o) || `選択肢${i + 1}`, onclick: () => answer({ type: RES.SELECT_OPTION, index: i }) }))));
      break;
    case MSG.SELECT_POSITION:
      promptModal(el('div', { class: 'stack' }, [1, 2, 4, 8].filter(x => p.positions & x).map(x =>
        el('button', { class: 'btn full', text: POS_NAME[x], onclick: () => answer({ type: RES.SELECT_POSITION, position: x }) }))));
      break;
    case MSG.SELECT_PLACE: case MSG.SELECT_DISFIELD:
      choosePlace(p, me);
      break;
    case MSG.SORT_CARD:
      promptModal(el('div', { class: 'stack' }, el('p', { text: p.cards.map((c, i) => `${i + 1}. ${cardName(c.code)}`).join('\n') })),
        [{ label: 'この順番でよい', primary: true, onClick: () => { answer({ type: RES.SORT_CARD, order: null }); return false; } }]);
      break;
    case MSG.ANNOUNCE_NUMBER:
      promptModal(el('div', { class: 'row wrap' }, p.options.map(o =>
        el('button', { class: 'btn', text: String(Number(o)), onclick: () => answer({ type: RES.ANNOUNCE_NUMBER, value: Number(o) }) }))));
      break;
    case MSG.ANNOUNCE_RACE: case MSG.ANNOUNCE_ATTRIB: {
      const isRace = p.type === MSG.ANNOUNCE_RACE;
      const names = isRace ? RACE : ATTR;
      const avail = BigInt(p.available);
      const picked = new Set();
      const box = el('div', { class: 'row wrap' });
      for (const [bit, name] of Object.entries(names)) {
        if (!(avail & BigInt(bit))) continue;
        const b = el('button', { class: 'btn', text: name });
        b.onclick = () => { if (picked.has(bit)) picked.delete(bit); else if (picked.size < p.count) picked.add(bit); b.classList.toggle('primary', picked.has(bit)); };
        box.append(b);
      }
      promptModal(el('div', { class: 'stack' }, el('p', { class: 'muted', text: `${p.count}つ選んでください` }), box), [{ label: '決定', primary: true, onClick: () => {
        if (picked.size !== p.count) { toast(`${p.count}つ選んでください`); return false; }
        answer(isRace ? { type: RES.ANNOUNCE_RACE, races: [...picked].map(b => BigInt(b)) } : { type: RES.ANNOUNCE_ATTRIB, attributes: [...picked].map(Number) });
        return false;
      } }]);
      break;
    }
    case MSG.ANNOUNCE_CARD: {
      const input = el('input', { type: 'text', class: 'full', placeholder: 'カード名で検索' });
      const list = el('div', { class: 'ap-grid' });
      const draw = () => {
        list.innerHTML = '';
        const hits = searchCards({ q: input.value.trim() }).filter(c => Engine.ocg.cardMatchesOpcode(engineCardData(c.id), p.opcodes)).slice(0, 40);
        for (const c of hits) { const n = promptCard({ code: c.id, controller: me, location: 0, sequence: 0 }); n.onclick = () => answer({ type: RES.ANNOUNCE_CARD, card: c.id }); list.append(n); }
      };
      input.addEventListener('input', draw);
      promptModal(el('div', { class: 'stack' }, input, list));
      draw();
      setTimeout(() => input.focus(), 0);
      break;
    }
    case MSG.SELECT_COUNTER: {
      const inputs = p.cards.map(c => el('input', { type: 'number', min: 0, max: c.count, value: 0 }));
      promptModal(el('div', { class: 'stack' }, el('p', { class: 'muted', text: `合計 ${p.count} 個` }),
        p.cards.map((c, i) => el('div', { class: 'row' }, promptCard(c, `${c.count}個`), inputs[i]))),
      [{ label: '決定', primary: true, onClick: () => {
        const v = inputs.map(x => +x.value || 0);
        if (v.reduce((a, b) => a + b, 0) !== p.count) { toast(`合計 ${p.count} 個にしてください`); return false; }
        answer({ type: RES.SELECT_COUNTER, counters: v }); return false;
      } }]);
      break;
    }
    default:
      toast('この選択にはまだ対応していません（' + p.type + '）');
  }
}

// 置く場所を選ぶ。自分のゾーンは盤面をクリックして選ぶ
function choosePlace(p, me) {
  const places = freePlaces(p.field_mask, me);
  const resType = p.type === MSG.SELECT_PLACE ? RES.SELECT_PLACE : RES.SELECT_DISFIELD;
  if (p.count === 1 && places.length === 1) { autoRespond({ type: resType, places }); return; }
  const toSlot = pl => {
    if (pl.player !== me) return null;
    if (pl.location === LOC.MZONE) return pl.sequence < 5 ? { zone: 'm', idx: pl.sequence } : (pl.sequence < 7 ? { zone: 'emz', idx: pl.sequence - 5 } : null);
    if (pl.location === LOC.SZONE) return pl.sequence < 5 ? { zone: 's', idx: pl.sequence } : (pl.sequence === 5 ? { zone: 'f', idx: 0 } : null);
    return null;
  };
  const chosen = [];
  const finish = pl => {
    chosen.push(pl);
    if (chosen.length >= p.count) { Board.pick = null; autoRespond({ type: resType, places: chosen }); return; }
    ask();
  };
  const ask = () => {
    const rest = places.filter(pl => !chosen.includes(pl));
    const slots = rest.map(toSlot);
    if (slots.every(Boolean)) {
      closePromptModal();
      Board.pick = { uid: null, slots, label: promptTitle(p) + '（光っているゾーンをクリック）', done: s => finish(rest[slots.findIndex(x => x.zone === s.zone && x.idx === s.idx)]) };
      renderBoard();
      return;
    }
    promptModal(el('div', { class: 'stack' }, rest.map(pl =>
      el('button', { class: 'btn full', text: placeText(pl.player, pl.location, pl.sequence), onclick: () => { closePromptModal(); finish(pl); } }))));
  };
  ask();
}

// 特殊召喚の呼び方（EXデッキのモンスターは召喚方法の名前で出す。素材はこのあと選択画面で選ぶ）
function summonLabel(c) {
  const card = DB.byId.get(c.code);
  if (!card) return '特殊召喚';
  if (c.location === LOC.EXTRA) {
    if (has(card, T.LINK)) return 'リンク召喚';
    if (has(card, T.XYZ)) return 'エクシーズ召喚';
    if (has(card, T.SYNCHRO)) return 'シンクロ召喚';
    if (has(card, T.FUSION)) return '融合召喚';
    if (has(card, T.PENDULUM)) return 'ペンデュラム召喚';
  }
  if ((c.location === LOC.SZONE || c.location === LOC.PZONE) && has(card, T.PENDULUM)) return 'ペンデュラム召喚';
  return '特殊召喚';
}

// 山札・墓地・EXデッキの一覧の行に、今できる操作のボタンを付ける（自動処理モード）
function autoRowButtons(inst, onDone) {
  const acts = autoActions(inst);
  if (!acts.length) return null;
  return el('div', { class: 'row-acts' }, acts.map(a => el('button', {
    class: 'ap-act small' + (a.kind ? ' k-' + a.kind : ''), text: a.label,
    onclick: e => { e.stopPropagation(); onDone(); runAction(a); },
  })));
}

// 操作ボタンを押したとき。「召喚する」は表示形式（攻撃表示／セット）を聞いてから進める
function runAction(a) {
  if (!a.choose) { autoRespond(a.res); return; }

  promptModal(el('div', { class: 'stack' }, el('p', { class: 'ap-question', text: '表示形式を選んでください' })), [
    ...a.choose.map((c, i) => ({ label: c.label, primary: i === 0, onClick: () => { closePromptModal(); autoRespond(c.res); return false; } })),
    { label: 'やめる', onClick: () => {} },
  ], a.name ? `「${a.name}」を召喚する` : '召喚する');
}

// 発動しても何も起きない永続魔法・永続罠を調べる（試し発動して確かめる）
function findUseless(d) {
  Auto.useless = new Set();
  const p = d.pending;
  if (!p || p.type !== MSG.SELECT_IDLECMD || p.player !== d.me || !p.activates.length) return;
  let field = null;
  p.activates.forEach((a, i) => {
    const c = DB.byId.get(a.code);
    if (!c) return;
    // フィールド魔法は効果が使えなくても発動できる（いつでも発動してよい）ので調べない
    const lasting = (has(c, T.SPELL) && has(c, T.CONTINUOUS)) || (has(c, T.TRAP) && has(c, T.CONTINUOUS));
    if (!lasting) return;   // 通常・速攻魔法、通常・カウンター罠は、発動できるかどうかをエンジンが効果の条件まで見て決めている
    // カード自体の発動か（手札、または裏側でセットされている）
    if (a.location !== LOC.HAND) {
      if (!(a.location & (LOC.SZONE | LOC.FZONE))) return;
      field = field || d.query()[d.me];
      const s = field.s[a.location === LOC.FZONE ? 5 : a.sequence];
      if (!s || s.position & 5) return;   // 表側のカードの効果はエンジンが条件を見ている
    }
    // 「発動できる」効果や発動時の処理が無いカード（ずっと効果が続くだけのカード）は、発動に意味があるので止めない
    const text = c.jaText || '';
    if (!/発動できる|発動時の効果処理|発動時に/.test(text)) return;
    if (!d.probeActivate(i)) Auto.useless.add(i);
  });
}

// ---------- このターン使った効果のチェック ----------
// 効果文から「このカード名の〜は1ターンに1度」の効果の番号と、効果の並び（Stringid の番号との対応）を読む
function optInfo(text) {
  const t = toHalf(text || '');
  const parts = t.split(/(?=[①-⑳])/);
  const order = [];   // 説明（Stringid）を持つ効果の番号を順に：発動する効果と、自分の方法での特殊召喚
  for (const p of parts) {
    const n = p[0];
    if (!/[①-⑳]/.test(n)) continue;
    if (/発動/.test(p) || /特殊召喚できる/.test(p)) order.push(n);
  }
  const named = /このカード名/.test(t);
  const once = new Set();
  let all = false, card = false, proc = null;
  if (named) {
    for (const m of t.matchAll(/([①-⑳]+)の効果は(?:それぞれ)?1ターンに1度/g)) for (const ch of m[1]) once.add(ch);
    if (/このカード名の効果は1ターンに1度/.test(t)) all = true;
    const pm = t.match(/([①-⑳])の方法による特殊召喚は1ターンに1度/);
    if (pm) { proc = pm[1]; once.add(pm[1]); }
    if (/このカード名のカードは1ターンに1枚しか発動できない/.test(t)) card = true;
  }
  return { order, once, all, card, proc };
}

// このターンに使ったもの（自動処理モード）。{ nums: 使った効果の番号, card: カードを発動した, any: 何か使った }
function usedMarks(c, text) {
  const d = Auto.duel;
  if (!d || !Board.S || !Board.S.auto || !d.used) return null;
  const set = d.used.get(c.id) || (c.alias && d.used.get(c.alias));
  if (!set || !set.size) return null;
  const info = optInfo(text || c.jaText);
  const nums = new Set();
  for (const k of set) {
    if (k === 'proc') { if (info.proc) nums.add(info.proc); continue; }
    if (typeof k === 'number' && info.order[k]) nums.add(info.order[k]);
  }
  return { nums, info, any: true };
}

// 詳細欄の効果文に ✅ を付ける（名前指定の1ターンに1度の効果だけ）
function decorateUsed(box, c, text) {
  // 手動モード：「効果を使用済みにする」で記録したカード
  if (Board.S && !Board.S.auto && Board.S.used && Board.S.used.includes(c.name)) { box.append(el('div', { class: 'used-head', text: '✅ このターン効果を使用済み（記録）' }), el('div', { class: 'card-text', text })); return true; }
  const u = usedMarks(c, text);
  if (!u) return false;
  const { nums, info } = u;
  const shown = [...nums].filter(n => info.all || info.once.has(n));
  if (!shown.length && !(info.card && u.any) && !(info.all && u.any)) return false;
  const head = el('div', { class: 'used-head', text: '✅ このターン使用済み：' + (info.card ? 'このカードの発動（同名カードも1ターンに1枚）' : info.all && !shown.length ? 'このカード名の効果' : shown.join('')) });
  const body = el('div', { class: 'card-text' });
  for (const line of text.split('\n')) {
    const n = toHalf(line)[0];
    const used = (info.all && u.any && /[①-⑳]/.test(n)) || shown.includes(n);
    body.append(el('div', { class: used ? 'used-line' : '', text: (used ? '✅ ' : '') + line }));
  }
  box.append(head, body);
  return true;
}
