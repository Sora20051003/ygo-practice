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
  if (!Glow.on || !S) return res;
  if (typeof Duel !== 'undefined' && Duel.active && !myTurn()) return res;
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
