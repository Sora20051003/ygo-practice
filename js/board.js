// 一人回し（盤面操作）
const ZONE_LABEL = {
  hand: '手札', deck: 'デッキ', gy: '墓地', ban: '除外', extra: 'EXデッキ',
  m: 'モンスターゾーン', emz: 'EXモンスターゾーン', s: '魔法・罠ゾーン', f: 'フィールドゾーン', mat: 'X素材',
};
const PILES = ['hand', 'deck', 'gy', 'ban', 'extra'];
const SLOTS = { m: 5, emz: 2, s: 5, f: 1 };
const FIELD_ZONES = ['m', 'emz', 's', 'f'];

const Board = {
  S: null,          // 現在の状態
  history: [],      // 元に戻す用
  initial: null,    // 「同じ初手でやり直す」用
  pick: null,       // ゾーン選択モード
  selected: null,   // 選択中カードのuid
};

function emptyState() {
  return {
    uidc: 0, turn: 1, ns: false, used: [], log: [],
    hand: [], deck: [], gy: [], ban: [], extra: [],
    m: Array(5).fill(null), emz: Array(2).fill(null), s: Array(5).fill(null), f: [null],
  };
}

const cardOf = inst => (inst.tokenCard ? inst.tokenCard : DB.byId.get(inst.id)) || { name: '不明', type: 0, level: 0, atk: 0, def: 0 };

function newInst(S, id) {
  return { uid: ++S.uidc, id, faceUp: true, pos: 'atk', mats: [], ctr: 0 };
}

function shuffleArr(a) {
  const r = new Uint32Array(a.length);
  crypto.getRandomValues(r);
  for (let i = a.length - 1; i > 0; i--) {
    const j = r[i] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- 状態の保存・元に戻す ----------
function commit() {
  Board.history.push(JSON.stringify(Board.S));
  if (Board.history.length > 300) Board.history.shift();
}
function undo() {
  if (Board.S && Board.S.auto) { autoUndo(); return; }
  if (!Board.history.length) { toast('これ以上戻せません'); return; }
  Board.S = JSON.parse(Board.history.pop());
  Board.pick = null;
  renderBoard();
}
function persist() {
  if (Board.S && Board.S.auto) return;   // 自動処理の盤面は autoplay.js が別に保存する
  // 対戦中は対戦用の盤面として別に保存する（一人回しの盤面を上書きしないように）
  if (typeof Duel !== 'undefined' && Duel.active) { store.set('ygo.duel.board.' + Duel.code, { S: Board.S }); return; }
  store.set('ygo.board', { S: Board.S, initial: Board.initial, deckId: $('#b-deck').value });
}
// text：自分用のログ。pub：対戦相手に見せるログ（省略時は同じ。見えないカードの名前を伏せたいときに指定）
function log(text, pub) {
  Board.S.log.push(`[T${Board.S.turn}] ${text}`);
  (Board.S.plog || (Board.S.plog = [])).push(`[T${Board.S.turn}] ${pub ?? text}`);
}

// ---------- カードの場所を探す ----------
function locate(uid) {
  const S = Board.S;
  for (const z of PILES) {
    const i = S[z].findIndex(c => c.uid === uid);
    if (i >= 0) return { zone: z, idx: i, inst: S[z][i] };
  }
  for (const z of FIELD_ZONES) {
    for (let i = 0; i < S[z].length; i++) {
      const c = S[z][i];
      if (!c) continue;
      if (c.uid === uid) return { zone: z, idx: i, inst: c };
      const mi = c.mats.findIndex(m => m.uid === uid);
      if (mi >= 0) return { zone: 'mat', idx: mi, inst: c.mats[mi], host: c };
    }
  }
  return null;
}

function detach(loc) {
  const S = Board.S;
  if (loc.zone === 'mat') loc.host.mats.splice(loc.idx, 1);
  else if (PILES.includes(loc.zone)) S[loc.zone].splice(loc.idx, 1);
  else S[loc.zone][loc.idx] = null;
}

// カードを動かす本体。dest = {zone, idx?, faceUp?, pos?, bottom?}
function moveCard(uid, dest, note) {
  const S = Board.S;
  const loc = locate(uid);
  if (!loc) return false;
  const inst = loc.inst;
  const card = cardOf(inst);
  const toField = FIELD_ZONES.includes(dest.zone);
  if (toField && S[dest.zone][dest.idx]) { toast('そのゾーンには既にカードがあります'); return false; }

  commit();
  detach(loc);
  const wasFaceUp = inst.faceUp;
  const fromLabel = loc.zone === 'mat' ? `${cardOf(loc.host).name}のX素材` : ZONE_LABEL[loc.zone];
  const wasOnField = FIELD_ZONES.includes(loc.zone);

  // フィールドを離れる：X素材は墓地へ、カウンターは消える
  if (wasOnField && !toField) {
    for (const m of inst.mats) { m.faceUp = true; m.pos = 'atk'; S.gy.push(m); }
    if (inst.mats.length) log(`${card.name}のX素材${inst.mats.length}枚 → 墓地`);
    inst.mats = [];
    inst.ctr = 0;
  }
  // トークンはフィールド以外に行くと消える
  if (inst.tokenCard && !toField) {
    log(`${card.name}（トークン）: ${fromLabel} → 消滅`);
    finishChange();
    return true;
  }

  if (toField) {
    inst.faceUp = dest.faceUp ?? (wasOnField ? inst.faceUp : true);
    inst.pos = dest.pos ?? (wasOnField ? inst.pos : 'atk');
    S[dest.zone][dest.idx] = inst;
    if (!inst.faceUp && (!wasOnField || wasFaceUp)) inst.setTurn = S.turn;   // セットしたターン（罠・反転召喚の目安用）
  } else {
    inst.pos = 'atk';
    inst.mats = inst.mats || [];
    if (dest.zone === 'deck') {
      inst.faceUp = false;
      if (dest.bottom) S.deck.push(inst); else S.deck.unshift(inst);
    } else if (dest.zone === 'extra') {
      // ペンデュラムがフィールドからEXへ行くときは表側
      inst.faceUp = dest.faceUp ?? (wasOnField && has(card, T.PENDULUM) && !isExtraType(card));
      S.extra.push(inst);
    } else {
      inst.faceUp = dest.faceUp ?? true;
      S[dest.zone].push(inst);
    }
  }

  let toLabel = ZONE_LABEL[dest.zone];
  if (dest.zone === 'deck') toLabel = dest.bottom ? 'デッキの下' : 'デッキの上';
  if (dest.zone === 'ban' && !inst.faceUp) toLabel = '除外（裏）';
  if (toField) {
    let state;
    if (['m', 'emz'].includes(dest.zone)) state = !inst.faceUp ? '裏守備' : (inst.pos === 'def' ? '守備' : '攻撃');
    else state = inst.faceUp ? '表' : 'セット';
    toLabel += `${dest.idx + 1}（${state}）`;
  }
  // 対戦相手に見せるログでは、見えない所（手札・デッキ・裏向き）同士の移動はカード名を伏せる
  const isPublicPlace = (zone, faceUp) => ['gy', 'mat'].includes(zone) || (['m', 'emz', 's', 'f', 'ban', 'extra'].includes(zone) && faceUp);
  const pubName = inst.tokenCard || isPublicPlace(loc.zone, wasFaceUp) || isPublicPlace(dest.zone, inst.faceUp) ? card.name : 'カード';
  log(`${card.name}: ${fromLabel} → ${toLabel}${note ? '　' + note : ''}`, `${pubName}: ${fromLabel} → ${toLabel}${note ? '　' + note : ''}`);

  // デッキから手札・場などへ持ってきたら（ドローや上から墓地送りを除く）シャッフル
  if (loc.zone === 'deck' && dest.zone !== 'deck' && !dest.noShuffle && $('#b-autoshuffle').checked) {
    shuffleArr(S.deck);
    log('デッキをシャッフル');
  }
  finishChange();
  return true;
}

function finishChange() {
  persist();
  renderBoard();
  if (Board.onChange) Board.onChange();
}

function attachMaterial(uid, hostUid) {
  const S = Board.S;
  const loc = locate(uid), hostLoc = locate(hostUid);
  if (!loc || !hostLoc || uid === hostUid) return;
  commit();
  detach(loc);
  const inst = loc.inst;
  // X素材になるカードが持っていた素材は墓地へ
  for (const m of inst.mats) S.gy.push(m);
  inst.mats = []; inst.ctr = 0; inst.faceUp = true; inst.pos = 'atk';
  if (inst.tokenCard) { log(`${cardOf(inst).name}（トークン）は素材にできないので消滅`); finishChange(); return; }
  hostLoc.inst.mats.push(inst);
  log(`${cardOf(inst).name}: ${ZONE_LABEL[loc.zone]} → ${cardOf(hostLoc.inst).name}のX素材`);
  finishChange();
}

function changeInst(uid, fn, text) {
  const loc = locate(uid);
  if (!loc) return;
  commit();
  const wasUp = loc.inst.faceUp;
  fn(Board.S, locate(uid).inst);
  if (wasUp && !locate(uid).inst.faceUp) locate(uid).inst.setTurn = Board.S.turn;
  if (text) log(text);
  finishChange();
}

// ---------- ゾーン選択モード ----------
// opts: {zones:[...], slotFilter?(zone, idx), faceUp, pos, ns, verb, attach}
function requestPlace(uid, opts) {
  const S = Board.S;
  const slots = [];
  for (const z of opts.zones) {
    for (let i = 0; i < SLOTS[z]; i++) {
      if (opts.slotFilter && !opts.slotFilter(z, i)) continue;
      if (z === 'emz' && !opts.attach && emzBlocked(i)) continue;   // 対戦相手が使っているEXモンスターゾーン
      const occupant = S[z][i];
      if (opts.attach ? (occupant && occupant.uid !== uid && isMonster(cardOf(occupant))) : !occupant) slots.push({ zone: z, idx: i });
    }
  }
  if (!slots.length) { toast(opts.attach ? '素材にできるモンスターがいません' : '空いているゾーンがありません'); return; }
  const done = slot => {
    Board.pick = null;
    if (opts.attach) { attachMaterial(uid, S[slot.zone][slot.idx].uid); return; }
    if (opts.ns) { Board.S.ns = true; }
    moveCard(uid, { zone: slot.zone, idx: slot.idx, faceUp: opts.faceUp, pos: opts.pos }, opts.verb);
  };
  if (slots.length === 1) { done(slots[0]); return; }
  closeAllModals();
  Board.pick = { uid, slots, done, label: opts.attach ? 'X素材にする先のモンスターをクリック' : '置くゾーンをクリック' };
  renderBoard();
}

function closeAllModals() { [...openModals].forEach(close => close()); Board.onChange = null; }

// EXモンスターゾーンは2人で共有。相手のEXモンスターゾーン(1-i)にカードがあれば、自分の i には置けない
const emzBlocked = i => typeof Duel !== 'undefined' && Duel.active && Duel.opp && Duel.opp.emz && !!Duel.opp.emz[1 - i];

// ---------- カードのメニュー ----------
function cardMenuItems(uid) {
  if (Board.S && Board.S.auto) return autoMenuItems(uid);
  const loc = locate(uid);
  if (!loc) return [];
  const inst = loc.inst, c = cardOf(inst);
  const items = [{ head: c.name }];
  const z = loc.zone;
  const onField = FIELD_ZONES.includes(z);
  const mon = isMonster(c);
  const fromExtraType = isExtraType(c);
  const mZones = fromExtraType ? ['m', 'emz'] : ['m'];
  const add = (label, fn, cond = true) => { if (cond) items.push({ label, onClick: fn }); };
  const sep = () => { if (!items[items.length - 1].sep) items.push({ sep: true }); };

  // 対戦中：手札・デッキ・裏向きのカードを相手に見せる（サーチしたカードの公開など）
  if (typeof Duel !== 'undefined' && Duel.active && !inst.tokenCard && (['hand', 'deck', 'extra'].includes(z) || !inst.faceUp)) {
    add('👁 相手に見せる（公開）', () => duelReveal(c, ZONE_LABEL[z]));
    sep();
  }

  if (!onField && z !== 'mat') {
    if (mon && !inst.tokenCard) {
      add('通常召喚', () => requestPlace(uid, { zones: ['m'], faceUp: true, pos: 'atk', ns: true, verb: '（通常召喚）' }), z === 'hand' && !fromExtraType);
      add('裏守備でセット', () => requestPlace(uid, { zones: ['m'], faceUp: false, pos: 'def', ns: true, verb: '（セット）' }), z === 'hand' && !fromExtraType);
      add('特殊召喚（攻撃表示）', () => requestPlace(uid, { zones: mZones, faceUp: true, pos: 'atk', verb: '（特殊召喚）' }));
      add('特殊召喚（守備表示）', () => requestPlace(uid, { zones: mZones, faceUp: true, pos: 'def', verb: '（特殊召喚）' }));
      add('ペンデュラムスケールに置く', () => requestPlace(uid, { zones: ['s'], slotFilter: (zz, i) => i === 0 || i === 4, faceUp: true, verb: '（Pスケール）' }), has(c, T.PENDULUM) && !fromExtraType);
    }
    if (!mon) {
      if (has(c, T.FIELD)) {
        add('発動する（フィールドゾーン）', () => requestPlace(uid, { zones: ['f'], faceUp: true, verb: '（発動）' }));
        add('セットする', () => requestPlace(uid, { zones: ['f'], faceUp: false }));
      } else {
        add('発動する', () => requestPlace(uid, { zones: ['s'], faceUp: true, verb: '（発動）' }));
        add('セットする', () => requestPlace(uid, { zones: ['s'], faceUp: false }));
      }
    }
    sep();
  }

  if (onField) {
    if (mon && ['m', 'emz'].includes(z)) {
      add(inst.pos === 'atk' ? '守備表示にする' : '攻撃表示にする', () => changeInst(uid, (S, i) => { i.pos = i.pos === 'atk' ? 'def' : 'atk'; i.faceUp = true; }, `${c.name}: 表示形式を変更`));
      add(inst.faceUp ? '裏側守備表示にする' : '表側攻撃表示にする（反転召喚など）', () => changeInst(uid, (S, i) => { i.faceUp = !i.faceUp; i.pos = i.faceUp ? 'atk' : 'def'; }, `${c.name}: ${inst.faceUp ? '裏側守備表示に' : '表側攻撃表示に'}`));
      add('X素材を取り除く', () => openMaterials(uid), inst.mats.length > 0);
      add('カウンター ＋1', () => changeInst(uid, (S, i) => { i.ctr++; }, `${c.name}: カウンター+1`));
      add('カウンター −1', () => changeInst(uid, (S, i) => { i.ctr--; }, `${c.name}: カウンター−1`), inst.ctr > 0);
    } else {
      add(inst.faceUp ? '裏側にする（セット）' : '表にする（発動）', () => changeInst(uid, (S, i) => { i.faceUp = !i.faceUp; }, `${c.name}: ${inst.faceUp ? 'セット' : '発動'}`));
      add('カウンター ＋1', () => changeInst(uid, (S, i) => { i.ctr++; }, `${c.name}: カウンター+1`));
      add('カウンター −1', () => changeInst(uid, (S, i) => { i.ctr--; }, `${c.name}: カウンター−1`), inst.ctr > 0);
    }
    add('別のゾーンへ移動', () => requestPlace(uid, { zones: mon && ['m', 'emz'].includes(z) ? ['m', 'emz'] : (z === 'f' ? ['f'] : ['s']) }));
    sep();
  }

  if (!inst.tokenCard) add('X素材にする…', () => requestPlace(uid, { zones: ['m', 'emz'], attach: true }), z !== 'mat');
  if (z === 'mat') add('取り除いて墓地へ', () => moveCard(uid, { zone: 'gy' }, '（X素材を取り除く）'));

  add('手札に加える', () => moveCard(uid, { zone: 'hand' }), z !== 'hand' && !fromExtraType);
  add('墓地へ送る', () => moveCard(uid, { zone: 'gy' }), z !== 'gy' && z !== 'mat');
  add('除外する', () => moveCard(uid, { zone: 'ban', faceUp: true }), z !== 'ban');
  add('裏側で除外する', () => moveCard(uid, { zone: 'ban', faceUp: false }));
  if (fromExtraType) {
    add('EXデッキに戻す', () => moveCard(uid, { zone: 'extra', faceUp: false }), z !== 'extra');
  } else {
    add('デッキの上に戻す', () => moveCard(uid, { zone: 'deck' }));
    add('デッキの下に戻す', () => moveCard(uid, { zone: 'deck', bottom: true }));
    add('デッキに戻してシャッフル', () => { if (moveCard(uid, { zone: 'deck' })) { shuffleArr(Board.S.deck); log('デッキをシャッフル'); finishChange(); } }, z !== 'deck');
    add('EXデッキに表側で加える', () => moveCard(uid, { zone: 'extra', faceUp: true }), has(c, T.PENDULUM) && z !== 'extra');
  }
  sep();
  const used = Board.S.used.includes(c.name);
  add(used ? '効果使用済みマークを外す' : '効果を使用済みにする（1ターンに1度）', () => toggleUsed(c.name));
  return items;
}

function toggleUsed(name) {
  commit();
  const S = Board.S;
  if (S.used.includes(name)) { S.used = S.used.filter(n => n !== name); log(`${name}: 使用済みマークを外す`); }
  else { S.used.push(name); log(`${name}: 効果を使用`); }
  finishChange();
}

function openCardMenu(uid, x, y) {
  if (Board.S && Board.S.auto) {
    // 自動処理モード：選択中なら盤面から選ぶ。そうでなければカードの上に操作ボタンを出す（マスターデュエル風）
    if (Auto.selectable && Auto.selectable.has(uid)) { Auto.pickFromBoard(uid); return; }
    const l = locate(uid);
    if (l && !isMobile()) showBoardDetail(l);
    if (autoActionPopup(uid)) return;
  }
  Board.selected = uid;
  const loc = locate(uid);
  const items = cardMenuItems(uid);
  if (isMobile()) {
    // スマホは詳細欄が画面外なので、メニューの先頭に「カードの詳細」を出す
    if (loc && !loc.inst.tokenCard) items.splice(1, 0, { label: '🔍 カードの詳細を見る', onClick: () => showBoardDetail(locate(uid) || loc) }, { sep: true });
  } else if (loc) showBoardDetail(loc);
  showMenu(x, y, items);
}

function showBoardDetail(loc) {
  const inst = loc.inst, c = cardOf(inst);
  let extra = null;
  if (inst.mats && inst.mats.length) {
    extra = el('div', { class: 'mat-box' }, el('b', { text: `X素材（${inst.mats.length}）` }),
      el('ul', null, inst.mats.map(m => el('li', { text: cardOf(m).name }))));
  }
  if (inst.tokenCard) {

    box.innerHTML = '';
    box.append(el('div', { class: 'detail-head f-token' }, el('div', { class: 'd-name', text: c.name })),
      el('div', { class: 'd-stats', text: `${ATTR[c.attr] || ''} ${levelText(c)}　${statText(c)}` }));
    return;
  }
  Board.detailCard = c;
  showCardDetail(c, '#board-detail', extra);
}

// スマホ用の下のボタン
function setupMobileBar() {
  $('#mb-draw').onclick = () => { if (Board.S) drawCard(); else toast('先に「シャッフルして開始」を押してください'); };
  $('#mb-undo').onclick = () => { if (Board.S) undo(); };
  $('#mb-shuffle').onclick = () => { if (Board.S) shuffleDeck(); };
  $('#mb-log').onclick = () => {
    const S = Board.S;
    const list = el('ol', { class: 'log sheet-log' }, (S ? S.log : []).map(l => el('li', { text: l })));
    showModal({ title: 'ログ', body: list, buttons: [{ label: 'コピー', onClick: () => { if (S) navigator.clipboard.writeText(S.log.join('\n')).then(() => toast('ログをコピーしました')); return false; } }] });
    setTimeout(() => { list.scrollTop = list.scrollHeight; }, 0);
  };
  $('#mb-ctrl').onclick = () => $('.side-left').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- 山札・墓地などの一覧 ----------
function openPile(zone) {
  const S = Board.S;
  const body = el('div', { class: 'stack' });
  const orderToggle = el('input', { type: 'checkbox' });
  const draw = () => {
    body.querySelector('.pile-list')?.remove();
    const list = el('div', { class: 'pile-list' });
    let items = S[zone].map((inst, i) => ({ inst, i }));
    if (zone === 'deck' && !orderToggle.checked) items.sort((a, b) => compareCards(cardOf(a.inst), cardOf(b.inst)));
    if (zone === 'gy' || zone === 'ban') items.reverse(); // 新しいものを上に
    // 自動処理モード：今使えるカード（光っているカード）を上に
    if (S.auto && Board.glow) { const rank = x => ({ y: 0, b: 1 }[Board.glow.get(x.inst.uid)] ?? 2); items.sort((a, b) => rank(a) - rank(b)); }
    if (!items.length) list.append(el('p', { class: 'muted', text: 'カードがありません' }));
    for (const { inst, i } of items) {
      const c = cardOf(inst);
      const gl = Board.glow && Board.glow.get(inst.uid);
      const row = el('div', { class: 'pile-row' + (zone === 'extra' && inst.faceUp ? ' faceup' : '') + (gl ? ' glow-' + gl : '') },
        zone === 'deck' && orderToggle.checked ? el('span', { class: 'muted', text: `${i + 1}.` }) : null,
        rowMark(c),
        el('div', { class: 'r-main' },
          el('div', { class: 'r-name', text: c.name + (zone === 'ban' && !inst.faceUp ? '（裏）' : '') + (zone === 'extra' && inst.faceUp ? '（表）' : '') }),
          el('div', { class: 'r-info', text: isMonster(c) ? `${levelText(c)} ${ATTR[c.attr] || ''} ${RACE[c.race] || ''}　${statText(c)}` : typeLine(c) })),
        Board.S.auto ? autoRowButtons(inst, () => closeAllModals()) : null,
      );
      row.addEventListener('click', e => { openCardMenu(inst.uid, e.clientX, e.clientY); });
      row.addEventListener('contextmenu', e => { e.preventDefault(); row.click(); });
      row.draggable = true;
      row.addEventListener('dragstart', e => { e.dataTransfer.setData('text/uid', String(inst.uid)); });
      list.append(row);
    }
    body.append(list);
  };
  if (zone === 'deck' && !S.auto) {
    body.append(el('div', { class: 'row' },
      el('label', { class: 'check' }, orderToggle, '実際の順番で表示（上から）'),
      el('button', { class: 'btn small', text: '上から1枚墓地へ', onclick: () => { const S2 = Board.S; if (S2.deck[0]) moveCard(S2.deck[0].uid, { zone: 'gy', noShuffle: true }); } }),
      el('button', { class: 'btn small', text: '上から1枚除外', onclick: () => { const S2 = Board.S; if (S2.deck[0]) moveCard(S2.deck[0].uid, { zone: 'ban', noShuffle: true }); } }),
      el('button', { class: 'btn small', text: 'シャッフル', onclick: () => shuffleDeck() })));
    orderToggle.addEventListener('change', draw);
  }
  draw();
  const close = showModal({
    title: `${ZONE_LABEL[zone]}（${S[zone].length}枚）`, body, wide: true,
    onClose: () => { Board.onChange = null; },
  });
  Board.onChange = () => {
    const head = $('#modal-root .modal-head h2');
    if (head) head.textContent = `${ZONE_LABEL[zone]}（${Board.S[zone].length}枚）`;
    draw();
  };
  return close;
}

function openMaterials(hostUid) {
  const loc = locate(hostUid);
  if (!loc) return;
  const list = el('div', { class: 'pile-list' });
  const draw = () => {
    list.innerHTML = '';
    const l = locate(hostUid);
    if (!l || !l.inst.mats.length) { list.append(el('p', { class: 'muted', text: 'X素材はありません' })); return; }
    for (const m of l.inst.mats) {
      const c = cardOf(m);
      list.append(el('div', { class: 'pile-row', onclick: e => openCardMenu(m.uid, e.clientX, e.clientY) },
        rowMark(c), el('div', { class: 'r-main' }, el('div', { class: 'r-name', text: c.name })),
        el('button', { class: 'btn small primary', text: '取り除く', onclick: e => { e.stopPropagation(); moveCard(m.uid, { zone: 'gy' }, '（X素材を取り除く）'); } })));
    }
  };
  draw();
  showModal({ title: `${cardOf(loc.inst).name}のX素材`, body: list, onClose: () => { Board.onChange = null; } });
  Board.onChange = draw;
}

// ---------- ゲーム開始 ----------
// handSize：引く枚数（省略時は画面の「先攻5枚／後攻6枚」）
function buildState(deck, handIds, handSize) {
  const S = emptyState();
  for (const id of deck.main) if (DB.byId.has(id)) S.deck.push(newInst(S, id));
  for (const id of deck.extra) if (DB.byId.has(id)) { const i = newInst(S, id); i.faceUp = false; S.extra.push(i); }
  for (const i of S.deck) i.faceUp = false;
  shuffleArr(S.deck);
  if (handIds) {
    for (const id of handIds) {
      const idx = S.deck.findIndex(i => i.id === id);
      if (idx >= 0) { const [inst] = S.deck.splice(idx, 1); inst.faceUp = true; S.hand.push(inst); }
    }
    S.log.push(`[T1] 初手を指定して開始：${S.hand.map(i => cardOf(i).name).join('、')}`);
  } else {
    const n = handSize || +$('#b-handsize').value;
    for (let k = 0; k < n && S.deck.length; k++) { const inst = S.deck.shift(); inst.faceUp = true; S.hand.push(inst); }
    S.log.push(`[T1] ${n}枚引いて開始：${S.hand.map(i => cardOf(i).name).join('、')}`);
  }
  return S;
}

function boardDeck() {
  return Decks.get($('#b-deck').value) || Decks.current();
}

function startGame(handIds) {
  if (autoActive()) { autoStart(handIds); return; }
  const deck = boardDeck();
  if (!deck || !deck.main.length) { toast('メインデッキが空です。先にデッキを作ってください'); return; }
  closeAllModals();
  Board.S = buildState(deck, handIds);
  Board.initial = JSON.stringify(Board.S);
  Board.history = [];
  Board.pick = null;
  persist();
  renderBoard();
}

function restartSame() {
  if (autoActive()) { autoRestart(); return; }
  if (!Board.initial) { toast('まだ開始していません'); return; }
  closeAllModals();
  Board.S = JSON.parse(Board.initial);
  Board.history = [];
  Board.pick = null;
  persist();
  renderBoard();
  toast('最初の状態に戻しました');
}

function openPickHand() {
  const deck = boardDeck();
  if (!deck || !deck.main.length) { toast('メインデッキが空です'); return; }
  const counts = new Map();
  for (const id of deck.main) counts.set(id, (counts.get(id) || 0) + 1);
  const chosen = new Map();
  const n = +$('#b-handsize').value;
  const info = el('p', { class: 'muted' });
  const list = el('div', { class: 'pile-list' });
  const total = () => [...chosen.values()].reduce((a, b) => a + b, 0);
  const draw = () => {
    info.textContent = `手札にするカードを選んでください（${total()}／${n}枚。足りない分はランダムで引きません）`;
    list.innerHTML = '';
    const ids = [...counts.keys()].sort((a, b) => compareCards(DB.byId.get(a), DB.byId.get(b)));
    for (const id of ids) {
      const c = DB.byId.get(id);
      const k = chosen.get(id) || 0;
      list.append(el('div', { class: 'pile-row' + (k ? ' chosen' : '') },
        rowMark(c),
        el('div', { class: 'r-main' }, el('div', { class: 'r-name', text: `${c.name}（デッキに${counts.get(id)}枚）` })),
        el('button', { class: 'btn small', text: '−', disabled: !k, onclick: () => { chosen.set(id, k - 1); draw(); } }),
        el('b', { class: 'qty', text: String(k) }),
        el('button', { class: 'btn small', text: '＋', disabled: k >= counts.get(id), onclick: () => { chosen.set(id, k + 1); draw(); } })));
    }
  };
  draw();
  showModal({
    title: '初手を選んで開始', wide: true, body: el('div', { class: 'stack' }, info, list),
    buttons: [{ label: 'この手札で開始', primary: true, onClick: () => {
      const ids = [];
      for (const [id, k] of chosen) for (let i = 0; i < k; i++) ids.push(id);
      if (!ids.length) { toast('1枚以上選んでください'); return false; }
      startGame(ids);
    } }],
  });
}

function drawCard() {
  const S = Board.S;
  if (S.auto) return;
  if (!S.deck.length) { toast('デッキがありません'); return; }
  moveCard(S.deck[0].uid, { zone: 'hand', noShuffle: true }, '（ドロー）');
}

function shuffleDeck() {
  commit();
  shuffleArr(Board.S.deck);
  log('デッキをシャッフル');
  finishChange();
  toast('シャッフルしました');
}

function openToken() {
  const name = el('input', { type: 'text', value: 'トークン', class: 'full' });
  const lv = el('input', { type: 'number', value: 1, min: 0, max: 13 });
  const atk = el('input', { type: 'number', value: 0, step: 100 });
  const def = el('input', { type: 'number', value: 0, step: 100 });
  const attr = el('select', null, Object.entries(ATTR).map(([v, l]) => el('option', { value: v, text: l + '属性' })));
  const pos = el('select', null, el('option', { value: 'atk', text: '攻撃表示' }), el('option', { value: 'def', text: '守備表示' }));
  showModal({
    title: 'トークンを特殊召喚',
    body: el('div', { class: 'form' },
      el('label', null, '名前', name), el('label', null, 'レベル', lv), el('label', null, '攻撃力', atk),
      el('label', null, '守備力', def), el('label', null, '属性', attr), el('label', null, '表示形式', pos)),
    buttons: [{ label: '特殊召喚', primary: true, onClick: () => {
      const S = Board.S;
      if (!S.m.some(x => !x)) { toast('モンスターゾーンが空いていません'); return false; }
      commit();
      const inst = newInst(S, 0);
      inst.tokenCard = { name: name.value || 'トークン', type: T.MONSTER | T.TOKEN | T.NORMAL, level: +lv.value || 0, atk: +atk.value || 0, def: +def.value || 0, attr: +attr.value, race: 0 };
      inst.pos = pos.value;
      // 一時的に手札に置いてからゾーン選択（キャンセル時は消す）
      S.hand.push(inst);
      requestPlaceToken(inst);
    } }],
  });
}

function requestPlaceToken(inst) {
  const S = Board.S;
  const slots = [];
  for (let i = 0; i < 5; i++) if (!S.m[i]) slots.push({ zone: 'm', idx: i });
  const done = slot => {
    Board.pick = null;
    S.hand = S.hand.filter(i => i.uid !== inst.uid);
    S.m[slot.idx] = inst;
    log(`${inst.tokenCard.name}（トークン）を特殊召喚 → モンスターゾーン${slot.idx + 1}`);
    finishChange();
  };
  if (slots.length === 1) { done(slots[0]); return; }
  Board.pick = { uid: inst.uid, slots, done, label: 'トークンを置くゾーンをクリック', onCancel: () => { S.hand = S.hand.filter(i => i.uid !== inst.uid); Board.history.pop(); } };
  renderBoard();
}

function cancelPick() {
  if (!Board.pick) return;
  if (Board.pick.onCancel) Board.pick.onCancel();
  Board.pick = null;
  renderBoard();
}

// ---------- 描画 ----------
function cardEl(inst, zone) {
  const c = cardOf(inst);
  const gl = Board.glow && Board.glow.get(inst.uid);
  const tgt = Board.S && Board.S.auto && Auto.selectable && Auto.selectable.has(inst.uid);   // 自動処理の選択中：盤面から選べるカード
  const node = el('div', { class: 'bcard' + (inst.pos === 'def' ? ' def' : '') + (Board.selected === inst.uid ? ' selected' : '') + (gl ? ' glow-' + gl : '') + (tgt ? ' ap-target' + (Auto.chosen && Auto.chosen.has(Auto.selectable.get(inst.uid)) ? ' ap-chosen' : '') : ''), draggable: 'true', dataset: { uid: inst.uid } },
    cardFace(c, { faceDown: !inst.faceUp }));
  if (inst.mats && inst.mats.length) node.append(el('div', { class: 'badge mats', title: 'X素材', text: '素材' + inst.mats.length }));
  if (inst.ctr) node.append(el('div', { class: 'badge ctr', title: 'カウンター', text: '●' + inst.ctr }));
  if (Board.S.used.includes(c.name)) node.append(el('div', { class: 'badge used', title: '効果使用済み', text: '済' }));
  node.addEventListener('click', e => {
    e.stopPropagation();
    if (Board.pick) return; // ゾーン選択中はゾーン側で処理
    openCardMenu(inst.uid, e.clientX, e.clientY);
  });
  node.addEventListener('contextmenu', e => { e.preventDefault(); node.click(); });
  node.addEventListener('dragstart', e => { e.dataTransfer.setData('text/uid', String(inst.uid)); hideMenu(); });
  return node;
}

function slotEl(zone, idx) {
  const S = Board.S;
  const inst = S[zone][idx];
  const label = { m: 'モンスター', emz: 'EXモンスター', s: idx === 0 || idx === 4 ? '魔法・罠 / P' : '魔法・罠', f: 'フィールド' }[zone];
  const slot = el('div', { class: `zone slot z-${zone}`, dataset: { zone, idx } }, el('span', { class: 'zone-label', text: label }));
  if (inst) slot.append(cardEl(inst, zone));
  const pickable = Board.pick && Board.pick.slots.some(s => s.zone === zone && s.idx === idx);
  if (pickable) {
    slot.classList.add('pickable');
    slot.addEventListener('click', e => { e.stopPropagation(); Board.pick.done({ zone, idx }); }, true);
  }
  addDrop(slot, uid => {
    const target = Board.S[zone][idx];
    if (target) {
      if (['m', 'emz'].includes(zone) && target.uid !== uid && isMonster(cardOf(locate(uid).inst))) attachMaterial(uid, target.uid);
      else toast('そのゾーンには既にカードがあります');
      return;
    }
    const loc = locate(uid);
    const c = cardOf(loc.inst);
    const fromField = FIELD_ZONES.includes(loc.zone);
    if (zone === 'emz' && emzBlocked(idx)) { toast('相手が使っているEXモンスターゾーンです'); return; }
    // 手札から魔法・罠をゾーンへ → 表で発動扱い
    moveCard(uid, { zone, idx, faceUp: fromField ? undefined : true, pos: fromField ? undefined : 'atk' });
  });
  return slot;
}

function pileEl(zone) {
  const S = Board.S;
  const arr = S[zone];
  const label = ZONE_LABEL[zone];
  const gls = Board.glow ? arr.map(i => Board.glow.get(i.uid)).filter(Boolean) : [];
  const pg = gls.includes('y') ? ' glow-y' : (gls.length ? ' glow-b' : '');
  const node = el('div', { class: `zone pile z-${zone}${pg}`, dataset: { zone } }, el('span', { class: 'zone-label', text: label }));
  if (arr.length) {
    const top = zone === 'deck' || zone === 'extra' ? null : arr[arr.length - 1];
    if (top) node.append(el('div', { class: 'bcard' }, cardFace(cardOf(top), { faceDown: !top.faceUp })));
    else node.append(el('div', { class: 'bcard' }, el('div', { class: 'cardface back' })));
  }
  node.append(el('div', { class: 'pile-count', text: arr.length + '枚' }));
  node.addEventListener('click', e => {
    if (Board.pick) return;
    if (zone === 'deck' && e.shiftKey) { drawCard(); return; }
    openPile(zone);
  });
  addDrop(node, uid => {
    const c = cardOf(locate(uid).inst);
    if (zone === 'extra' && !isExtraType(c) && !has(c, T.PENDULUM)) { toast('EXデッキに置けるカードではありません'); return; }
    if (zone === 'deck' && isExtraType(c)) { moveCard(uid, { zone: 'extra' }); return; }
    moveCard(uid, { zone });
  });
  return node;
}

function addDrop(node, onDrop) {
  node.classList.add('dropzone');
  node.addEventListener('dragover', e => { e.preventDefault(); node.classList.add('dragover'); });
  node.addEventListener('dragleave', () => node.classList.remove('dragover'));
  node.addEventListener('drop', e => {
    e.preventDefault();
    node.classList.remove('dragover');
    const uid = +e.dataTransfer.getData('text/uid');
    if (Board.S && Board.S.auto) { toast('効果を自動処理するモードでは、カードをクリックして操作します'); return; }
    if (uid && locate(uid)) onDrop(uid);
  });
}

function renderBoard() {
  const S = Board.S;
  const field = $('#field');
  field.innerHTML = '';
  $('#view-board').classList.toggle('auto-mode', autoActive());
  $$('#b-mode button').forEach(b => b.classList.toggle('on', (b.dataset.mode === 'auto') === Auto.on));
  if (!(typeof Duel !== 'undefined' && Duel.active)) $('#opp-bar').hidden = true;
  if (autoActive()) {
    autoPanel();
    $('#opp-bar').hidden = !(S && S.oppText);
    if (S && S.oppText) $('#opp-bar').textContent = S.oppText;
  }
  if (!S) {
    field.append(el('div', { class: 'empty-board' },
      el('p', { text: '左の「シャッフルして開始」でデッキから初手を引きます。' }),
      el('p', { class: 'muted', text: 'デッキは「デッキ作成」タブで作れます。' })));
    $('#hand').innerHTML = '';
    $('#b-log').innerHTML = '';
    $('#b-used').innerHTML = '';
    return;
  }
  Board.glow = computeGlow(S);
  const blank = () => el('div', { class: 'zone blank' });
  const dueling = typeof Duel !== 'undefined' && Duel.active;
  const withOpp = dueling || !!(S.auto && S.opp);   // 自動処理モードでは CPU の盤面も出す
  field.classList.toggle('duel', withOpp);
  if (withOpp) {
    // 対戦中：上に相手の盤面（相手から見た向きなので左右が逆）、真ん中に共有のEXモンスターゾーン
    renderOppRows(field);
    // 自動処理モード：上の帯に相手（CPU）のライフ
    if (S.auto && S.opp) $('#opp-bar').append(lpBox(Auto.duel ? Auto.duel.lp[1 - Auto.duel.me] : S.opp.lp, 'opp'));
    field.append(oppPileEl('ban'), blank(), emzSharedEl(0), blank(), emzSharedEl(1), blank(), pileEl('ban'));
  } else {
    // 1段目：EXモンスターゾーン・除外
    field.append(blank(), blank(), slotEl('emz', 0), blank(), slotEl('emz', 1), blank(), pileEl('ban'));
  }
  // 2段目：フィールド・モンスター・墓地
  field.append(slotEl('f', 0));
  for (let i = 0; i < 5; i++) field.append(slotEl('m', i));
  field.append(pileEl('gy'));
  // 3段目：EXデッキ・魔法罠・デッキ
  field.append(pileEl('extra'));
  for (let i = 0; i < 5; i++) field.append(slotEl('s', i));
  field.append(pileEl('deck'));

  const hand = $('#hand');
  hand.innerHTML = '';
  for (const inst of S.hand) if (!(Board.pick && Board.pick.uid === inst.uid && inst.tokenCard)) hand.append(cardEl(inst, 'hand'));
  $('#hand-count').textContent = S.hand.length;
  renderMyLp();

  const banner = $('#pick-banner');
  banner.hidden = !Board.pick;
  if (Board.pick) {
    banner.innerHTML = '';
    banner.append(el('span', { text: Board.pick.label }), el('button', { class: 'btn small', text: 'キャンセル（Esc）', onclick: cancelPick }));
  }

  $('#b-ns').textContent = '通常召喚：' + (S.ns ? '使用済み' : '未使用');
  $('#b-ns').classList.toggle('on', S.ns);
  $('#b-turn').textContent = `次のターン（今T${S.turn}）`;

  const used = $('#b-used');
  used.innerHTML = '';
  if (!S.used.length) used.append(el('li', { class: 'muted', text: 'カードのメニューから記録できます' }));
  for (const n of S.used) used.append(el('li', null, n, el('button', { class: 'x', title: '外す', text: '×', onclick: () => toggleUsed(n) })));

  const logEl = $('#b-log');
  logEl.innerHTML = '';
  for (const line of S.log) logEl.append(el('li', { text: line }));
  logEl.scrollTop = logEl.scrollHeight;

  // 対戦中なら、変わった盤面を相手に送る
  if (dueling) duelAfterRender();
}

function refreshBoardDeckSelect() {
  const sel = $('#b-deck');
  if (!sel) return;
  const cur = sel.value || Decks.currentId;
  sel.innerHTML = '';
  for (const d of Decks.list) sel.append(el('option', { value: d.id, text: `${d.name}（${d.main.length}枚）` }));
  sel.value = Decks.get(cur) ? cur : Decks.currentId;
}

function setupBoardView() {
  setupMobileBar();
  refreshBoardDeckSelect();
  $('#b-start').onclick = () => startGame();
  $('#b-pickhand').onclick = openPickHand;
  $('#b-restart').onclick = restartSame;
  $('#b-draw').onclick = () => { if (Board.S) drawCard(); };
  $('#b-shuffle').onclick = () => { if (Board.S) shuffleDeck(); };
  $('#b-undo').onclick = () => { if (Board.S) undo(); };
  $('#b-rewind').onclick = () => { if (Board.S) openRewind(); };
  $('#b-token').onclick = () => { if (Board.S) openToken(); };
  setupAutoPlay();
  $('#b-glow').checked = Glow.on;
  $('#b-glow').onchange = e => { Glow.on = e.target.checked; store.set('ygo.glow', Glow.on); renderBoard(); };
  $('#b-ns').onclick = () => { if (!Board.S) return; commit(); Board.S.ns = !Board.S.ns; log(Board.S.ns ? '通常召喚を使用済みに' : '通常召喚を未使用に'); finishChange(); };
  $('#b-turn').onclick = () => {
    if (!Board.S) return;
    commit();
    Board.S.turn++; Board.S.ns = false; Board.S.used = [];
    log('---- ターン開始 ----');
    finishChange();
  };
  $('#b-used-clear').onclick = () => { if (!Board.S || !Board.S.used.length) return; commit(); Board.S.used = []; log('使用済みマークをすべて外す'); finishChange(); };
  $('#b-copylog').onclick = () => {
    if (!Board.S) return;
    navigator.clipboard.writeText(Board.S.log.join('\n')).then(() => toast('ログをコピーしました'));
  };
  addDrop($('#hand'), uid => {
    const c = cardOf(locate(uid).inst);
    if (isExtraType(c)) { toast('EXデッキのモンスターは手札に加えられません'); return; }
    moveCard(uid, { zone: 'hand' });
  });
  document.addEventListener('keydown', e => {
    if ($('#view-board').hidden) return;
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'Escape') cancelPick();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (Board.S) undo(); }
    if (e.key === 'd' && Board.S && !$('#modal-root').children.length) drawCard();
  });

  const saved = store.get('ygo.board', null);
  if (saved && saved.S) {
    Board.S = saved.S;
    Board.initial = saved.initial;
    if (saved.deckId && Decks.get(saved.deckId)) $('#b-deck').value = saved.deckId;
  }
  renderBoard();
}

// ---------- 押したカードの表示 ----------
// パソコン：右の詳細欄に、クリックしたカードを出す。スマホ：盤面の上の帯に、最後に触ったカードを出す（押すと詳細）
function previewCard(c) {
  if (!c) return;
  Board.detailCard = c;
  if (!isMobile()) {

    renderDetail($('#board-detail'), c);
    return;
  }
  const bar = $('#m-preview');
  bar.hidden = false;
  bar.innerHTML = '';
  const text = (c.jaText || '').replace(/\s+/g, ' ');
  bar.append(
    el('div', { class: 'mp-face' }, cardFace(c, { small: true })),
    el('div', { class: 'mp-main' },
      el('div', { class: 'mp-name', text: c.name }),
      el('div', { class: 'mp-info muted', text: isMonster(c) ? `${levelText(c)} ${ATTR[c.attr] || ''} ${RACE[c.race] || ''}　${statText(c)}` : typeLine(c) }),
      el('div', { class: 'mp-text', text })),
    el('span', { class: 'mp-more muted', text: '詳細 ›' }));
  bar.onclick = () => showCardDetail(c, '#board-detail');
}
document.addEventListener('pointerdown', e => {
  if ($('#view-board').hidden) return;
  if (e.target.closest('#board-detail, .detail-sheet, #m-preview')) return;
  const n = e.target.closest('[data-cid]');
  if (n) previewCard(DB.byId.get(+n.dataset.cid));
}, true);

// ライフの表示（減ったら赤、増えたら緑に光らせる）
const lastLp = {};
function lpBox(lp, who) {
  const box = el('div', { class: 'lp-box ' + who }, el('small', { text: who === 'me' ? '自分' : '相手' }), el('b', { text: 'LP ' + lp }));
  const prev = lastLp[who];
  if (prev !== undefined && prev !== lp) box.classList.add(lp < prev ? 'lp-down' : 'lp-up');
  lastLp[who] = lp;
  return box;
}
function renderMyLp() {
  const slot = $('#my-lp');
  const S = Board.S;
  const show = !!(S && S.auto && Auto.duel);
  slot.hidden = !show;
  if (!show) return;
  const box = lpBox(Auto.duel.lp[Auto.duel.me], 'me');
  slot.className = box.className;
  slot.replaceChildren(...box.childNodes);
}

// ---------- 巻き戻し（一人回しだけ） ----------
// これまでの行動を一覧にして、選んだ行動の直前まで戻す
function openRewind() {
  if (typeof Duel !== 'undefined' && Duel.active) return;   // 対戦では使えない
  const auto = Board.S && Board.S.auto && Auto.duel;
  let points;   // { label, go }（新しい順）
  if (auto) {
    points = Auto.duel.actions().reverse().map(a => ({ label: a.label, go: () => { closePromptModal(); Auto.selQueue = null; Auto.duel.rewindTo(a.at); autoAfter(true); } }));
  } else {
    const h = Board.history;
    points = [];
    for (let k = h.length - 1; k >= 0; k--) {
      const s = JSON.parse(h[k]);
      const next = k + 1 < h.length ? JSON.parse(h[k + 1]).log : Board.S.log;
      const label = (next[s.log.length] || '操作').replace(/^\[T(\d+)\] /, 'T$1 ');
      points.push({ label, go: () => { Board.S = s; Board.history = h.slice(0, k); Board.pick = null; persist(); renderBoard(); } });
    }
  }
  if (!points.length) { toast('まだ戻せる行動がありません'); return; }
  const list = el('div', { class: 'pile-list rewind-list' }, points.map((p, i) =>
    el('div', { class: 'pile-row rewind-row' },
      el('span', { class: 'muted', text: `${points.length - i}.` }),
      el('div', { class: 'r-main' }, el('div', { class: 'r-name', text: p.label })),
      el('button', { class: 'btn small', text: 'この前に戻す', onclick: () => { closeRw(); p.go(); toast('「' + p.label + '」の前まで戻しました'); } }))));
  const closeRw = showModal({ title: '巻き戻し（行動の前の状態に戻します）', wide: true,
    body: el('div', { class: 'stack' }, el('p', { class: 'muted', text: '新しい行動が上です。戻したい行動の「この前に戻す」を押してください。' }), list) });
}
