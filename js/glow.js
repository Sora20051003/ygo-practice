// 発動できそうなカードを黄色、召喚できそうなカードを青に光らせる（マスターデュエル風）。
// 効果の自動処理はしていないので、ルールと効果文の書き方から推測した「目安」。両方満たすときは黄色。
const Glow = {
  on: store.get('ygo.glow', true),
  textCache: new Map(),
};

const toHalf = s => s.replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xFEE0));

// 効果文を ①②… ごとの文に分け、どこで発動する効果か・起動/誘発のどちらっぽいかを調べる
function glowInfo(c) {
  if (Glow.textCache.has(c.id)) return Glow.textCache.get(c.id);
  const raw = toHalf(c.jaText || '');
  let pend = '', main = raw;
  if (has(c, T.PENDULUM) && raw.includes('【モンスター効果】')) [pend, main] = raw.split('【モンスター効果】');
  const lines = main.split('\n');
  const matLine = isExtraType(c) ? lines[0] : '';
  const clauses = s => s.split(/[①-⑳]/).slice(s.match(/[①-⑳]/) ? 1 : 0).map(x => x.trim()).filter(Boolean);
  const where = cl => {
    if (/このカードを手札から|このカードが手札に(存在|ある)|手札のこのカード/.test(cl)) return 'hand';
    if (/このカードが墓地に存在|墓地のこのカード|このカードを墓地から/.test(cl)) return 'gy';
    if (/このカードが除外されている|除外されているこのカード|除外状態のこのカード/.test(cl)) return 'ban';
    return 'field';
  };
  // 自分のメインフェイズに自分から使えそうな効果か（「〜した場合／時」の誘発や相手ターン専用は除く）
  const ignition = cl => {
    const i = cl.search(/発動できる|発動する/);
    if (i < 0) return false;
    const head = cl.slice(0, i);
    if (/(た|だ)(場合|時)/.test(head)) return false;
    if (/(スタンバイ|エンド|バトル)フェイズ|ダメージステップ|ダメージ計算/.test(head)) return false;
    if (/相手(ターン|メインフェイズ)/.test(head) && !/自分・相手/.test(head)) return false;
    return true;
  };
  const sets = { hand: false, gy: false, ban: false, field: false };
  for (const cl of clauses(main)) if (ignition(cl)) sets[where(cl)] = true;
  let pendField = false;
  for (const cl of clauses(pend)) if (ignition(cl) && where(cl) === 'field') pendField = true;
  const info = {
    ...sets, pendField, matLine,
    noNormal: /通常召喚できない/.test(raw),
    noTribute: /リリースなしで(通常)?召喚できる/.test(raw),
    procHand: clauses(main).some(cl => /手札から(も)?特殊召喚できる/.test(cl) && !/発動/.test(cl) && !/でのみ/.test(cl)),
    procGy: clauses(main).some(cl => /墓地から(も)?特殊召喚できる/.test(cl) && !/発動/.test(cl) && !/でのみ/.test(cl)),
    trapFromHand: /手札から(も)?発動できる/.test(raw),
    setTurnOk: /セットしたターン(でも|に)発動できる/.test(raw),
  };
  if (c.jaText) Glow.textCache.set(c.id, info);
  return info;
}

// 盤面全体を見て、uid → 'y'（発動）/'b'（召喚）を返す
function computeGlow(S) {
  const res = new Map();
  if (S && !S.auto) snapActions(S);   // 光らせない設定でも、カードを押したときのボタンのために判定しておく
  if (!Glow.on || !S) return res;
  if (S.auto) return autoGlow();   // 自動処理モード：エンジンが「できる」と言ったものだけ光らせる
  if (typeof Duel !== 'undefined' && Duel.active && !myTurn()) return res;
  // 手動・対戦も、今の盤面をエンジンで判定した結果で光らせる（判定中・判定できないときは光らせない）
  const snap = snapActions(S);
  if (snap) for (const [uid, r] of snap) { if (r.activate) res.set(uid, 'y'); else if (r.summon || r.spsummon) res.set(uid, 'b'); }
  return res;
}
// （以前の、効果文から推測して光らせる方法。今は使っていない）
function computeGlowGuess(S) {
  const res = new Map();
  const used = new Set(S.used);
  const fieldMons = [...S.m, ...S.emz].filter(Boolean);
  const upMons = fieldMons.filter(i => i.faceUp && !i.tokenCard).map(i => ({ inst: i, c: cardOf(i) }))
    .concat(fieldMons.filter(i => i.faceUp && i.tokenCard).map(i => ({ inst: i, c: cardOf(i) })));
  const freeM = S.m.filter(x => !x).length;
  const freeS = S.s.filter(x => !x).length;
  const emzFree = S.emz.some((x, i) => !x && !emzBlocked(i)) || S.emz.some(Boolean);
  const hasLinkOnField = upMons.some(m => has(m.c, T.LINK));
  const set = (inst, v) => { if (v === 'y' || !res.has(inst.uid)) res.set(inst.uid, v); };

  // ペンデュラムスケール
  const sc = [S.s[0], S.s[4]].map(i => i && i.faceUp && has(cardOf(i), T.PENDULUM) ? cardOf(i) : null);
  let pLo = 0, pHi = 0;
  if (sc[0] && sc[1]) { pLo = Math.min(sc[0].ls, sc[1].rs); pHi = Math.max(sc[0].ls, sc[1].rs); }
  const canPend = c => pHi - pLo > 1 && c.level > pLo && c.level < pHi && (freeM > 0);

  // 手札
  for (const inst of S.hand) {
    const c = cardOf(inst);
    if (inst.tokenCard) continue;
    const g = glowInfo(c);
    if (isMonster(c)) {
      if (!used.has(c.name) && g.hand) set(inst, 'y');
      const tributes = g.noTribute || c.level <= 4 ? 0 : (c.level <= 6 ? 1 : 2);
      const canNormal = !S.ns && !g.noNormal && !has(c, T.RITUAL) && (tributes ? fieldMons.length >= tributes : freeM > 0);
      if (canNormal || (g.procHand && freeM > 0) || canPend(c)) set(inst, 'b');
    } else if (has(c, T.SPELL)) {
      if (used.has(c.name)) continue;
      let ok = has(c, T.FIELD) || freeS > 0;
      if (has(c, T.EQUIP)) ok = ok && fieldMons.length > 0;
      if (has(c, T.RITUAL)) ok = ok && S.hand.some(h => h !== inst && has(cardOf(h), T.RITUAL) && isMonster(cardOf(h)));
      if (ok) set(inst, 'y');
    } else if (has(c, T.TRAP) && g.trapFromHand && freeS > 0 && !used.has(c.name)) set(inst, 'y');
  }

  // フィールド
  for (const inst of fieldMons) {
    const c = cardOf(inst);
    if (inst.tokenCard) continue;
    if (!inst.faceUp) { if ((inst.setTurn ?? 0) < S.turn) set(inst, 'b'); continue; } // 反転召喚
    if (!used.has(c.name) && glowInfo(c).field) set(inst, 'y');
  }
  for (const inst of [...S.s, ...S.f].filter(Boolean)) {
    const c = cardOf(inst);
    if (used.has(c.name)) continue;
    const g = glowInfo(c);
    if (!inst.faceUp) {
      const waits = has(c, T.TRAP) || has(c, T.QUICKPLAY);
      if (!waits || g.setTurnOk || (inst.setTurn ?? 0) < S.turn) set(inst, 'y');
    } else if (isMonster(c) ? g.pendField : g.field) set(inst, 'y');
  }

  // 墓地・除外
  for (const inst of S.gy) { const c = cardOf(inst); if (used.has(c.name)) continue; const g = glowInfo(c); if (g.gy) set(inst, 'y'); else if (g.procGy && isMonster(c) && freeM > 0) set(inst, 'b'); }
  for (const inst of S.ban) { if (!inst.faceUp) continue; const c = cardOf(inst); if (!used.has(c.name) && glowInfo(c).ban) set(inst, 'y'); }

  // EXデッキ（S・X・リンク。融合・儀式は魔法が要るので光らせない）
  const lv = upMons.filter(m => !has(m.c, T.XYZ) && !has(m.c, T.LINK) && m.c.level > 0);
  for (const inst of S.extra) {
    const c = cardOf(inst);
    if (!isExtraType(c)) { if (inst.faceUp && canPend(c)) set(inst, 'b'); continue; }
    const g = glowInfo(c);
    const req = g.matLine;
    const effOnly = /効果モンスター/.test(req);
    const pool = m => (!effOnly || has(m.c, T.EFFECT)) && (!/トークン以外/.test(req) || !m.inst.tokenCard);
    let ok = false;
    if (has(c, T.LINK)) {
      const need = c.level; // リンクの数値は level に入っている
      const minN = +(req.match(/(\d+)体以上/) || [])[1] || (/(\d+)体/.test(req) ? +req.match(/(\d+)体/)[1] : (need === 1 ? 1 : 2));
      const ms = upMons.filter(pool);
      const maxSum = ms.reduce((a, m) => a + (has(m.c, T.LINK) ? m.c.level : 1), 0);
      ok = ms.length >= minN && need >= minN && maxSum >= need && (emzFree || hasLinkOnField);
    } else if (has(c, T.SYNCHRO)) {
      const tuners = lv.filter(m => has(m.c, T.TUNER));
      ok = tuners.some(t => {
        const rest = lv.filter(m => m !== t).map(m => m.c.level);
        const target = c.level - t.c.level;
        if (target <= 0) return false;
        const can = new Set([0]);
        for (const l of rest) for (const v of [...can]) if (v + l <= target) can.add(v + l);
        return can.has(target);
      });
    } else if (has(c, T.XYZ)) {
      const m = req.match(/レベル(\d+).*?×(\d+)/);
      const L = m ? +m[1] : c.level, n = m ? +m[2] : 2;
      ok = lv.filter(x => x.c.level === L).length >= n;
    }
    if (ok) set(inst, 'b');
  }
  return res;
}

// ---------- 手動・対戦：今の盤面をエンジンで判定する ----------
// 手動の盤面（と対戦相手の見えている盤面）をそのまま、裏で動かすエンジンに並べて、
// 「今、発動・召喚できるカード」を聞く。光らせるのも、カードを押したときのボタンも、これに合わせる（効果文からの推測はしない）。
// ・自分のメインフェイズとして判定する（相手のターン・メイン以外のフェイズでは何も光らせない）
// ・「1ターンに1度」は、手動で「使用済み」にしたカード名だけ除く
const Snap = { key: null, result: null, busy: false, failed: false, loadedFor: '' };

function snapKey(S) {
  const opp = typeof Duel !== 'undefined' && Duel.active ? Duel.opp : null;
  return JSON.stringify([S.hand, S.m, S.emz, S.s, S.f, S.gy, S.ban, S.extra, S.ns, S.used, opp && [opp.m, opp.emz, opp.s, opp.f, opp.gy, opp.ban]]);
}
// 盤面のカード → [{ code, loc, seq, pos, overlay? }]
function snapCards(S) {
  const out = [];
  const pos = i => (i.faceUp ? (i.pos === 'def' ? POS.FU_DEF : POS.FU_ATK) : (i.pos === 'def' ? POS.FD_DEF : POS.FD_ATK));
  const id = i => (i.tokenCard ? 0 : i.id);
  S.hand.forEach((i, k) => out.push({ code: id(i), loc: LOC.HAND, seq: k, pos: POS.FU_ATK, ref: ['hand', k] }));
  S.m.forEach((i, k) => { if (i) out.push({ code: id(i), loc: LOC.MZONE, seq: k, pos: pos(i), ref: ['m', k], mats: i.mats }); });
  S.emz.forEach((i, k) => { if (i) out.push({ code: id(i), loc: LOC.MZONE, seq: 5 + k, pos: pos(i), ref: ['emz', k], mats: i.mats }); });
  S.s.forEach((i, k) => { if (i) out.push({ code: id(i), loc: LOC.SZONE, seq: k, pos: i.faceUp ? POS.FU_ATK : POS.FD_ATK, ref: ['s', k] }); });
  if (S.f[0]) out.push({ code: id(S.f[0]), loc: LOC.SZONE, seq: 5, pos: S.f[0].faceUp ? POS.FU_ATK : POS.FD_ATK, ref: ['f', 0] });
  S.gy.forEach((i, k) => out.push({ code: id(i), loc: LOC.GRAVE, seq: k, pos: POS.FU_ATK, ref: ['gy', k] }));
  S.ban.forEach((i, k) => out.push({ code: id(i), loc: LOC.REMOVED, seq: k, pos: i.faceUp ? POS.FU_ATK : POS.FD_ATK, ref: ['ban', k] }));
  S.extra.forEach((i, k) => out.push({ code: id(i), loc: LOC.EXTRA, seq: k, pos: i.faceUp ? POS.FU_ATK : POS.FD_ATK, ref: ['extra', k] }));
  S.deck.forEach((i, k) => out.push({ code: id(i), loc: LOC.DECK, seq: k, pos: POS.FD_ATK, ref: ['deck', k] }));
  return out.filter(x => x.code);
}

// 裏でエンジンを動かして判定する（必要なカードの処理を読み込んでから）
async function snapCompute(S) {
  const key = snapKey(S);
  if (Snap.busy || Snap.key === key) return;
  Snap.busy = true;
  try {
    const mine = snapCards(S);
    const op = typeof Duel !== 'undefined' && Duel.active ? Duel.opp : null;
    const oppCards = [];
    if (op) {
      const pub = (p, loc, seq) => { if (p && p.id && p.faceUp) oppCards.push({ code: p.id, loc, seq, pos: loc === LOC.MZONE && p.pos === 'def' ? POS.FU_DEF : POS.FU_ATK }); else if (p) oppCards.push({ code: OPP_FILLER, loc, seq, pos: loc === LOC.MZONE ? POS.FD_DEF : POS.FD_ATK }); };
      (op.m || []).forEach((p, k) => pub(p, LOC.MZONE, k));
      (op.emz || []).forEach((p, k) => pub(p, LOC.MZONE, 5 + k));
      (op.s || []).forEach((p, k) => pub(p, LOC.SZONE, k));
      (op.f || []).forEach(p => pub(p, LOC.SZONE, 5));
      (op.gy || []).forEach((code, k) => { if (code) oppCards.push({ code, loc: LOC.GRAVE, seq: k, pos: POS.FU_ATK }); });
    }
    const codes = [...mine.map(c => c.code), ...mine.flatMap(c => (c.mats || []).map(m => m.id)), ...oppCards.map(c => c.code), OPP_FILLER];
    const need = [...new Set(codes)].join(',');
    if (Snap.loadedFor !== need) {
      await engineLoad();
      await loadCardScripts(codes);
      Snap.loadedFor = need;
    }
    Snap.result = snapRun(mine, oppCards, S);
    Snap.key = key;
    Snap.failed = false;
  } catch (e) {
    console.warn('盤面の判定ができませんでした', e);
    Snap.failed = true; Snap.key = key; Snap.result = null;
  } finally { Snap.busy = false; }
  if (typeof renderBoard === 'function') renderBoard();
}

function snapRun(mine, oppCards, S) {
  const d = new AutoDuel({ main: [], extra: [], handSize: 5, seed: [1n, 2n, 3n, 4n], opp: null, chainMode: 'off' });
  const savedMe = Engine.me;
  d.create = function () {
    const L = Engine.lib, O = Engine.ocg;
    this.log = []; this.pending = null; this.hint = 0; this.ended = null; this.turn = 0; this.turnPlayer = 0; this.phase = 0;
    this.lp = [8000, 8000]; this.chain = []; this.events = []; this.retries = 0; this.locks = [];
    this.justSummoned = new Set(); this.justMoved = new Set(); this.used = new Map();
    this.rng = seededRandom(7);
    const team = { drawCountPerTurn: 1, startingDrawCount: 0, startingLP: 8000 };
    this.h = L.createDuel({ flags: O.OcgDuelMode.MODE_MR5, seed: this.seed, team1: team, team2: team,
      cardReader: code => engineCardData(code), scriptReader: name => Engine.scripts.get(name) || null, errorHandler: () => {} });
    L.loadScript(this.h, 'constant.lua', Engine.scripts.get('constant.lua'));
    L.loadScript(this.h, 'utility.lua', Engine.scripts.get('utility.lua'));
    Engine.me = 0;
    const add = (con, c) => L.duelNewCard(this.h, { team: con, duelist: 0, code: c.code, controller: con, location: c.loc, sequence: c.seq, position: c.pos });
    for (const c of mine) {
      add(0, c);
      for (const m of c.mats || []) if (m.id) L.duelNewCard(this.h, { team: 0, duelist: 0, code: m.id, controller: 0, location: LOC.OVERLAY, sequence: c.seq, position: POS.FU_ATK });
    }
    for (const c of oppCards) add(1, c);
    // デッキが空だと負けてしまうので、足りない分は何もしないカードで埋める
    if (!mine.some(c => c.loc === LOC.DECK)) for (let i = 0; i < 5; i++) add(0, { code: OPP_FILLER, loc: LOC.DECK, seq: 0, pos: POS.FD_ATK });
    for (let i = 0; i < 20; i++) add(1, { code: OPP_FILLER, loc: LOC.DECK, seq: 0, pos: POS.FD_ATK });
    L.startDuel(this.h);
  };
  try {
    d.start();
    const p = d.pending;
    if (!p || p.type !== MSG.SELECT_IDLECMD) return null;
    // エンジンの位置 → 盤面のカード
    // 手札・墓地などは、エンジンの中の並び順がこちらと違うことがあるので、カードの番号で探す（同じ番号のカードは中身が同じなのでどれでもよい）
    const refOf = c => {
      const z = { [LOC.HAND]: 'hand', [LOC.GRAVE]: 'gy', [LOC.REMOVED]: 'ban', [LOC.EXTRA]: 'extra', [LOC.DECK]: 'deck' }[c.location];
      if (z) {
        const at = S[z][c.sequence];
        if (at && at.id === c.code) return at;
        return S[z].find(i => i.id === c.code) || null;
      }
      if (c.location === LOC.MZONE) return c.sequence < 5 ? S.m[c.sequence] : S.emz[c.sequence - 5];
      if (c.location === LOC.SZONE) return c.sequence < 5 ? S.s[c.sequence] : S.f[0];
      return null;
    };
    const res = new Map();   // uid → { summon, spsummon, activate }
    const mark = (list, kind) => (list || []).forEach(c => {
      if (c.controller !== 0) return;
      const inst = refOf(c);
      if (!inst) return;
      const r = res.get(inst.uid) || {};
      r[kind] = true;
      res.set(inst.uid, r);
    });
    if (!S.ns) { mark(p.summons, 'summon'); mark(p.monster_sets, 'summon'); }
    mark(p.special_summons, 'spsummon');
    mark(p.activates, 'activate');
    // 手動で「使用済み」にしたカード名は、発動できないものとして扱う
    const used = new Set(S.used || []);
    for (const [uid, r] of res) { const l = locate(uid); if (l && used.has(cardOf(l.inst).name)) r.activate = false; }
    return res;
  } finally {
    if (d.h) Engine.lib.destroyDuel(d.h);
    Engine.me = savedMe;
  }
}

// 今の盤面の判定結果（まだなら裏で計算を始めて null）。自分のメインフェイズ以外は判定しない
function snapActions(S) {
  if (!S || S.auto) return null;
  const dueling = typeof Duel !== 'undefined' && Duel.active;
  const phase = dueling ? (Duel.room && Duel.room.phase) : (S.phase || 'M1');
  if (dueling && !myTurn()) return new Map();
  if (phase !== 'M1' && phase !== 'M2') return new Map();
  if (Snap.key !== snapKey(S)) { setTimeout(() => snapCompute(Board.S), 0); return Snap.result && !Snap.failed ? null : null; }
  return Snap.failed ? null : Snap.result;
}
