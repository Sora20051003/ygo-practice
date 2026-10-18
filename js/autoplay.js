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
  // 相手の様子（文字で出す）
  const op = q[1 - me];
  const oppCards = [...op.m, ...op.s].filter(c => c && c.code && c.position & 5).map(c => cardName(c.code));
  S.oppText = `相手：LP ${d.lp[1 - me]}　手札${op.hand.filter(Boolean).length}枚` + (oppCards.length ? `　場：${oppCards.join('、')}` : '');
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
    if (same(c)) out.push({ label: typeof label === 'function' ? label(c) : label, kind, res: { type: p.type === MSG.SELECT_BATTLECMD ? RES.SELECT_BATTLECMD : RES.SELECT_IDLECMD, action, index } });
  });
  const actLabel = c => '発動：' + (descText(c.description) || '効果を発動');
  if (p.type === MSG.SELECT_IDLECMD) {
    add(p.activates, actLabel, IDLE.ACTIVATE, 'y');
    add(p.summons, '通常召喚', IDLE.SUMMON, 'b');
    add(p.special_summons, '特殊召喚', IDLE.SPSUMMON, 'b');
    add(p.monster_sets, '裏守備でセット', IDLE.MSET);
    add(p.spell_sets, 'セットする', IDLE.SSET);
    add(p.pos_changes, '表示形式を変更', IDLE.REPOS);
  } else if (p.type === MSG.SELECT_BATTLECMD) {
    add(p.chains, actLabel, BATTLE.CHAIN, 'y');
    add(p.attacks, c => (c.can_direct ? '攻撃する（直接攻撃できます）' : '攻撃する'), BATTLE.ATTACK, 'b');
  }
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
  for (const a of acts) items.push({ label: a.label, onClick: () => autoRespond(a.res) });
  if (!acts.length) items.push({ label: Auto.duel && isPrompt(Auto.duel.pending) ? '先に選択画面で選んでください' : '今できる操作はありません', disabled: true, onClick: () => {} });
  return items;
}

const isPrompt = p => p && p.type !== MSG.SELECT_IDLECMD && p.type !== MSG.SELECT_BATTLECMD;

// ---------- 進める ----------
function autoRespond(res) {
  const d = Auto.duel;
  if (!d) return;
  try { d.respond(res); } catch (e) { console.error(e); toast('処理中にエラーが起きました：' + e.message); }
  autoAfter();
}

function autoAfter() {
  const d = Auto.duel;
  if (d.retry) { toast('その選び方はできません。選び直してください'); d.retry = false; }
  autoSave();
  autoSync();
  if (isPrompt(d.pending)) openPrompt();
}

function autoSync() {
  if (!Auto.duel) return;
  Board.S = autoState();
  Board.pick = null;
  renderBoard();
}

function autoPanel() {
  const d = Auto.duel, p = d && d.pending;
  const st = $('#ap-status');
  if (!st) return;
  $('#ap-bp').hidden = $('#ap-ep').hidden = false;
  if (!d) { st.textContent = '「シャッフルして開始」で始めます'; $('#ap-lp').textContent = ''; $('#ap-bp').disabled = $('#ap-ep').disabled = $('#ap-undo').disabled = $('#ap-open').disabled = true; return; }
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
  $('#ap-open').disabled = !isPrompt(p);
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
  try { d.undo(); } catch (e) { toast('戻せませんでした：' + e.message); }
  autoAfter();
}

// ---------- 開始・保存 ----------
async function autoPrepare(deck) {
  showLoading('自動処理の準備中…');
  try {
    await engineLoad(showLoading);
    await loadCardScripts([...deck.main, ...deck.extra, OPP_FILLER], showLoading);
  } finally { showLoading(null); }
}

async function autoStart(handIds) {
  const deck = boardDeck();
  if (!deck || !deck.main.length) { toast('メインデッキが空です。先にデッキを作ってください'); return; }
  closeAllModals();
  try { await autoPrepare(deck); } catch (e) { toast('自動処理を準備できませんでした：' + e.message); return; }
  const handSize = +$('#b-handsize').value;
  Auto.duel = new AutoDuel({ main: deck.main.filter(id => DB.byId.has(id)), extra: deck.extra.filter(id => DB.byId.has(id)), handIds: handIds && handIds.slice(0, 5), handSize });
  Auto.deckId = deck.id;
  try { Auto.duel.start(); } catch (e) { console.error(e); toast('開始できませんでした：' + e.message); Auto.duel = null; renderBoard(); return; }
  autoAfter();
}

function autoRestart() {
  if (!Auto.duel) { toast('まだ開始していません'); return; }
  closePromptModal();
  Auto.duel.restart();
  autoAfter();
  toast('最初の状態に戻しました');
}

// 盤面は「最初の条件＋自分の選択の一覧」で保存し、開き直したら流し直す
const bigReplacer = (k, v) => (typeof v === 'bigint' ? { __big: String(v) } : v);
const bigReviver = (k, v) => (v && typeof v === 'object' && '__big' in v ? BigInt(v.__big) : v);
function autoSave() {
  const d = Auto.duel;
  if (!d) return;
  const picks = d.userMarks.map(i => d.responses[i]);
  try {
    store.set('ygo.autoBoard', JSON.parse(JSON.stringify({
      main: d.main, extra: d.extra, handIds: d.handIds, handSize: d.handSize, seed: d.seed, picks, deckId: Auto.deckId,
    }, bigReplacer)));
  } catch { /* 保存できなくても続けられる */ }
}
async function autoResume() {
  let saved = null;
  try { saved = JSON.parse(JSON.stringify(store.get('ygo.autoBoard', null)), bigReviver); } catch { saved = null; }
  if (!saved || !saved.main) return;
  try { await autoPrepare(saved); } catch { return; }
  const d = new AutoDuel({ main: saved.main, extra: saved.extra, handIds: saved.handIds, handSize: saved.handSize, seed: saved.seed });
  Auto.duel = d; Auto.deckId = saved.deckId;
  try { d.create(); d.run([...saved.picks]); } catch (e) { console.error(e); Auto.duel = null; return; }
  if (autoActive()) autoAfter();
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
  $('#ap-open').onclick = () => { if (Auto.duel && isPrompt(Auto.duel.pending)) openPrompt(); };
  $('#mb-auto').onclick = e => {
    const p = Auto.duel && Auto.duel.pending;
    const r = e.target.getBoundingClientRect();
    showMenu(r.left, r.top - 10, [
      { head: $('#ap-status').textContent },
      { label: '選択画面を開く', disabled: !isPrompt(p), onClick: () => openPrompt() },
      { label: p && p.type === MSG.SELECT_BATTLECMD ? 'メインフェイズ2へ' : 'バトルフェイズへ', disabled: $('#ap-bp').disabled, onClick: () => autoPhase('bp') },
      { label: 'ターン終了', disabled: $('#ap-ep').disabled, onClick: () => autoPhase('ep') },
    ]);
  };
  Auto.on = store.get('ygo.boardMode', 'manual') === 'auto';
  if (Auto.on) { Auto.resumed = true; autoResume(); }
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
function promptModal(body, buttons) {
  closePromptModal();
  const p = Auto.duel.pending;
  const close = showModal({ title: promptTitle(p), body, buttons, wide: true, onClose: () => { if (Auto.closePrompt === close) Auto.closePrompt = null; autoPanel(); } });
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
  const refresh = () => {
    info.textContent = (note ? note + '　' : '') + (min === max ? `${min}枚選んでください` : `${min}〜${max}枚選んでください`) + `（${chosen.size}枚選択中）`;
    ok.disabled = chosen.size < min || chosen.size > max;
    [...grid.children].forEach((n, i) => n.classList.toggle('on', chosen.has(i)));
  };
  cards.forEach((c, i) => {
    const n = promptCard(c, extra && extra(c, i));
    n.addEventListener('click', () => {
      if (min === 1 && max === 1) { answerDone([i]); return; }
      if (chosen.has(i)) chosen.delete(i); else if (chosen.size < max) chosen.add(i);
      refresh();
    });
    grid.append(n);
  });
  const answerDone = idx => onDone(idx);
  ok.onclick = () => answerDone([...chosen]);
  const foot = el('div', { class: 'row' }, ok, canCancel ? el('button', { class: 'btn', text: 'キャンセル', onclick: onCancel }) : null);
  refresh();
  promptModal(el('div', { class: 'stack' }, info, grid, foot));
}

function yesNo(text, onAnswer, card) {
  promptModal(el('div', { class: 'stack' }, card ? promptCard(card) : null, el('p', { text })), [
    { label: 'はい', primary: true, onClick: () => { onAnswer(true); return false; } },
    { label: 'いいえ', onClick: () => { onAnswer(false); return false; } },
  ]);
}

function openPrompt() {
  const d = Auto.duel, p = d && d.pending;
  if (!isPrompt(p)) return;
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
      const grid = el('div', { class: 'ap-grid' });
      p.select_cards.forEach((c, i) => { const n = promptCard(c); n.onclick = () => answer({ type: RES.SELECT_UNSELECT_CARD, index: i }); grid.append(n); });
      p.unselect_cards.forEach((c, i) => { const n = promptCard(c, '選択中（クリックで外す）'); n.classList.add('on'); n.onclick = () => answer({ type: RES.SELECT_UNSELECT_CARD, index: p.select_cards.length + i }); grid.append(n); });
      const btns = [];
      if (p.can_finish) btns.push({ label: '決定', primary: true, onClick: () => { answer({ type: RES.SELECT_UNSELECT_CARD, index: null }); return false; } });
      if (p.can_cancel && !p.can_finish) btns.push({ label: 'キャンセル', onClick: () => { answer({ type: RES.SELECT_UNSELECT_CARD, index: null }); return false; } });
      promptModal(el('div', { class: 'stack' }, el('p', { class: 'muted', text: `1枚ずつクリックして選びます（${p.min}〜${p.max}枚）` }), grid), btns);
      break;
    }
    case MSG.SELECT_CHAIN: {
      const grid = el('div', { class: 'ap-grid' });
      p.selects.forEach((c, i) => { const n = promptCard(c, descText(c.description)); n.onclick = () => answer({ type: RES.SELECT_CHAIN, index: i }); grid.append(n); });
      promptModal(el('div', { class: 'stack' }, el('p', { class: 'muted', text: '発動する効果をクリックしてください' }), grid),
        p.forced ? [] : [{ label: '発動しない', onClick: () => { answer({ type: RES.SELECT_CHAIN, index: null }); return false; } }]);
      break;
    }
    case MSG.SELECT_EFFECTYN:
      yesNo(descText(p.description) || 'この効果を発動しますか？', yes => answer({ type: RES.SELECT_EFFECTYN, yes }), p);
      break;
    case MSG.SELECT_YESNO:
      yesNo(descText(p.description) || 'はい／いいえ', yes => answer({ type: RES.SELECT_YESNO, yes }));
      break;
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
