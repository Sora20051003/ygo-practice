// ---------- 初動率（デッキ作成の「📊 初動率」） ----------
// 手札をたくさん配って、初動がそろう率と、召喚権のかぶり・相手の手札誘発まで考えた「実質初動率」を数える。
// 設定（カードの役割など）はデッキごとにこのブラウザへ保存する（ygo.opening.<デッキID>）

const OpSim = (() => {
  // ルート（初動のやり方）が手札で成立するか。成立すれば使う召喚権の数、不成立なら -1
  function tryAssign(m, r, hc, nsAvail, used) {
    used.length = 0;
    let ns = 0, ok = true;
    for (const c of r.named) {
      if (hc[c] <= 0) { ok = false; break; }
      hc[c]--; used.push(c); ns += m.cards[c].ns;
    }
    if (ok) {
      for (const tag of r.tags) {
        const list = m.tagCards[tag];
        let pick = -1;
        for (const j of list) if (hc[j] > 0) { pick = j; break; }
        if (pick < 0) { ok = false; break; }
        hc[pick]--; used.push(pick); ns += m.cards[pick].ns;
      }
    }
    for (const c of used) hc[c]++;
    return !ok || ns > nsAvail ? -1 : ns;
  }
  const anyRoute = (m, hc, nsAvail, used) => m.routes.some(r => tryAssign(m, r, hc, nsAvail, used) >= 0);
  function findCounter(m, hc, t) {
    for (const c of m.careIdx) if (hc[c] > 0 && ((m.cards[c].counter >> t) & 1)) return c;
    return -1;
  }
  // 相手の誘発 opp0 を受けながら、優先度の順に初動を試す。1つでも通れば true
  function resolve(m, hc0, opp0, nsInit, s) {
    const hc = s.hc2, opp = s.opp2, used = s.used;
    hc.set(hc0); opp.set(opp0);
    let ns = nsInit;
    for (let i = 0; i < m.routes.length; i++) {
      const nsUsed = tryAssign(m, m.routes[i], hc, ns, used);
      if (nsUsed < 0) continue;
      let vm = 0;
      for (const c of used) vm |= m.cards[c].vuln;
      let stopped = false;
      for (;;) {
        let tAny = -1, tPick = -1;
        for (let t = 0; t < m.T; t++) {
          if (opp[t] > 0 && ((vm >> t) & 1)) {
            if (tAny < 0) tAny = t;
            if (findCounter(m, hc, t) < 0) { tPick = t; break; }   // 相手は、ケアされない誘発から撃つ
          }
        }
        if (tAny < 0) break;                  // 止める手段がない＝通る
        if (tPick < 0) { const c = findCounter(m, hc, tAny); hc[c]--; opp[tAny]--; continue; }   // ケア札で無効にする
        opp[tPick]--; stopped = true; break;
      }
      if (!stopped) return true;
      for (const c of used) hc[c]--;          // 止められた初動のカードと召喚権は失う
      ns -= nsUsed;
      i--;                                    // 同じ初動の2枚目があれば、もう一度試す
    }
    return false;
  }
  function simulate(m, handSize, iters) {
    const C = m.cards.length, T = m.T;
    const deck = Int32Array.from(m.deck), N = deck.length, H = Math.min(handSize, N);
    let oppDeck = Int32Array.from(m.oppDeck), OD = oppDeck.length;
    const OH = m.oppHand;
    // 使用率から：毎回、大会のデッキを1つ選んで相手のデッキにする（その誘発を入れているか・何枚か、も確率に入る）
    const oppDecks = m.oppDecks ? m.oppDecks.map(d => Int32Array.from(d)) : null;
    const hc = new Int32Array(C), opp = new Int32Array(T), single = new Int32Array(T);
    const s = { hc2: new Int32Array(C), opp2: new Int32Array(T), used: [] }, used = [];
    const res = { iters, raw: 0, nsok: 0, real: 0, realInfNs: 0, withHT: 0, perTrap: new Array(T).fill(0) };
    for (let it = 0; it < iters; it++) {
      hc.fill(0);
      for (let i = 0; i < H; i++) {
        const j = i + Math.floor(Math.random() * (N - i));
        const tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
        hc[deck[i]]++;
      }
      if (!anyRoute(m, hc, 99, used)) continue;
      res.raw++;
      const nsok = anyRoute(m, hc, 1, used);
      opp.fill(0);
      if (oppDecks) { oppDeck = oppDecks[Math.floor(Math.random() * oppDecks.length)]; OD = oppDeck.length; }
      for (let i = 0; i < Math.min(OH, OD); i++) {
        const j = i + Math.floor(Math.random() * (OD - i));
        const tmp = oppDeck[i]; oppDeck[i] = oppDeck[j]; oppDeck[j] = tmp;
        if (oppDeck[i] >= 0) opp[oppDeck[i]]++;
      }
      if (!nsok) continue;
      res.nsok++;
      if (resolve(m, hc, opp, 99, s)) res.realInfNs++;
      if (resolve(m, hc, opp, 1, s)) res.real++;
      for (let t = 0; t < T; t++) { single.fill(0); single[t] = 1; if (resolve(m, hc, single, 1, s)) res.perTrap[t]++; }
      let ht = 0;
      for (const k of m.handtrapIdx) ht += hc[k];
      if (ht > 0) res.withHT++;
    }
    return res;
  }
  // 1枚初動のカードだけで数えた理論値（超幾何分布）
  function exactSingle(m, handSize) {
    const N = m.deck.length, S = m.cards.reduce((s, c) => s + (c.role === 'starter' ? c.count : 0), 0);
    if (!N) return 0;
    let p = 1;
    for (let i = 0; i < Math.min(handSize, N); i++) p *= Math.max(0, N - S - i) / (N - i);
    return 1 - p;
  }
  return { simulate, exactSingle };
})();

const OP_ROLES = [['starter', '初動'], ['extender', '展開札'], ['handtrap', '手札誘発'], ['care', '誘発ケア'], ['brick', '事故札'], ['other', 'その他']];
const OP_CARE_NAMES = ['抹殺の指名者', '墓穴の指名者', '三戦の才', '禁じられた一滴'];
const OP_STOP_RE = /うらら|泡影|ヴェーラー|わらし|しぐれ|うさぎ|ドロール|γ/;   // 初動を止める誘発（増殖するGなどは止めない扱い）
// 手札誘発として数えないカード（自分の展開を助けるカード・永続罠など）
const OP_NOT_TRAP = ['墓穴の指名者', '抹殺の指名者', '三戦の才', 'センサー万別'];
const OP_SRC = { md: 'マスターデュエル', ocg: 'OCG', tcg: 'TCG（海外）' };
const OP_SRC_NOTE = { md: 'Master Duel Meta の大会上位・高ランクのデッキ', ocg: '大会入賞デッキ', tcg: '海外の大会入賞デッキ' };

// ---------- 環境の手札誘発の使用率（サンプルデッキから数える） ----------
const opUsageCache = {};
async function opLoadUsage(fmt, oppHand) {
  if (opUsageCache[fmt]) return opUsageCache[fmt];
  const data = await loadSamples(fmt);
  const periods = data && data.periods ? Object.keys(data.periods).filter(k => data.periods[k].length).sort() : [];
  if (!periods.length) return null;
  // 一番新しいリストの期間のデッキ（40個より少なければ1つ前の期間も足す）
  let decks = data.periods[periods[periods.length - 1]], from = periods[periods.length - 1];
  if (decks.length < 40 && periods.length > 1) { decks = [...data.periods[periods[periods.length - 2]], ...decks]; from = periods[periods.length - 2]; }
  const isTrap = c => c && !OP_NOT_TRAP.includes(c.name) && ((typeof isHandTrap === 'function' && isHandTrap(c.id)) || (typeof HANDTRAP_NAMES !== 'undefined' && HANDTRAP_NAMES.includes(c.name)));
  const list = decks.map(d => (d.m || []).map(([v, n, en]) => ({ card: sampleCard(v) || (en ? sampleCard(en) : null), n: n | 0 })).filter(x => x.card && x.n > 0));
  const stat = new Map();
  for (const dl of list) for (const { card, n } of dl) {
    if (!isTrap(card)) continue;
    const s = stat.get(card.id) || { card, decks: 0, copies: 0 };
    s.decks++; s.copies += n; stat.set(card.id, s);
  }
  const traps = [...stat.values()].filter(s => s.decks / list.length >= 0.02).sort((a, b) => b.decks - a.decks).slice(0, 30)
    .map(s => ({ id: 'c' + s.card.id, cardId: s.card.id, name: s.card.name, rate: s.decks / list.length, avg: s.copies / s.decks }));
  const idx = new Map(traps.map((t, i) => [t.cardId, i]));
  const oppDecks = list.map(dl => { const a = []; for (const { card, n } of dl) for (let k = 0; k < n; k++) a.push(idx.has(card.id) ? idx.get(card.id) : -1); return a; }).filter(a => a.length >= 20);
  return (opUsageCache[fmt] = { fmt, from, nDecks: oppDecks.length, traps, oppDecks });
}
// 相手の初手（hand 枚）に、そのカード（k 枚入り・デッキ n 枚）が1枚以上ある確率
function opAtLeastOne(n, k, hand) { let p = 1; for (let i = 0; i < hand; i++) p *= Math.max(0, n - k - i) / (n - i); return 1 - p; }
// 使用率のデッキ全体での、初手にある確率（採用していないデッキも含めた平均）
function opUsageOpen(u, hand, which) {
  let sum = 0;
  for (const d of u.oppDecks) { const k = d.filter(x => (which < 0 ? x >= 0 : x === which)).length; sum += opAtLeastOne(d.length, k, hand); }
  return u.oppDecks.length ? sum / u.oppDecks.length : 0;
}
const opUsing = st => st.opp.mode === 'usage' && opUsageCache[st.opp.src];
const opTraps = st => (opUsing(st) ? opUsageCache[st.opp.src].traps : st.opp.traps);
const opF = (st, f) => (opUsing(st) ? f + 'U' : f);   // 使用率のときは、止まる誘発・ケアできる誘発を別に覚える
const opKey = id => 'ygo.opening.' + id;
const opNorm = s => normalizeText(String(s || '').replace(/^[#＃]/, ''));
let opSeq = Date.now();
const opUid = p => p + (opSeq++).toString(36);

function opDefaultTraps() {
  return [
    { id: 't_urara', name: '灰流うらら', count: 3 },
    { id: 't_g', name: '増殖するG', count: 3 },
    { id: 't_hoyo', name: '無限泡影', count: 3 },
    { id: 't_veiler', name: 'エフェクト・ヴェーラー', count: 2 },
    { id: 't_warashi', name: '屋敷わらし', count: 1 },
  ];
}
function opLoad(deck) {
  const fmt = typeof deckFormat === 'function' ? deckFormat(deck) : 'ocg';
  const s = store.get(opKey(deck.id), null);
  const st = s && s.cards && s.opp ? s : { cards: {}, combos: [], opp: { deckSize: 40, handSize: 5, traps: opDefaultTraps() }, iters: 100000 };
  // 相手の誘発：最初は環境の使用率から（デッキのルールのサンプルデッキ）
  if (!st.opp.mode) st.opp.mode = 'usage';
  if (!OP_SRC[st.opp.src]) st.opp.src = OP_SRC[fmt] ? fmt : 'md';
  return st;
}
// 誘発の一覧が変わったとき用：止まる誘発・ケアできる誘発の初めの値（名前から推測）
function opDefaultVuln(st, c) {
  const traps = opTraps(st);
  const stop = traps.filter(t => OP_STOP_RE.test(t.name)).map(t => t.id);
  return {
    vuln: stop.length ? stop : traps.map(t => t.id),
    // 墓穴の指名者は、墓地へ行く誘発だけケアできる（泡影・ドロールなどは無理）
    counters: traps.filter(t => !(c.name === '墓穴の指名者' && /泡影|γ/.test(t.name))).map(t => t.id),
  };
}
// デッキのカードの設定（初めてのカードは、名前などから役割を推測する）
function opCardSetting(st, id) {
  const s0 = st.cards[id];
  if (s0) {
    // 使用率の誘発の一覧で、まだ決めていなければ推測で入れる
    if (opUsing(st) && !s0.vulnU) { const d = opDefaultVuln(st, DB.byId.get(id) || {}); s0.vulnU = d.vuln; s0.countersU = d.counters; }
    return s0;
  }
  const c = DB.byId.get(id) || {};
  const ht = typeof isHandTrap === 'function' && isHandTrap(id);
  const care = OP_CARE_NAMES.includes(c.name);
  const monster = !!(c.type & T.MONSTER);
  const traps = st.opp.traps;
  const stop = traps.filter(t => OP_STOP_RE.test(t.name)).map(t => t.id);
  // 墓穴の指名者は、墓地へ行く誘発だけケアできる（泡影は無理）
  const counters = traps.filter(t => !(c.name === '墓穴の指名者' && /泡影/.test(t.name))).map(t => t.id);
  const s = st.cards[id] = {
    role: care ? 'care' : ht ? 'handtrap' : 'other',
    ns: monster && !ht && (c.level || 0) <= 4 && !(c.type & (T.LINK | T.SPSUMMON)),
    tags: '', vuln: stop.length ? stop : traps.map(t => t.id), counters, priority: 10,
  };
  if (opUsing(st)) { const d = opDefaultVuln(st, c); s.vulnU = d.vuln; s.countersU = d.counters; }
  return s;
}
function opDeckCards(deck) {
  const count = new Map();
  for (const id of deck.main) count.set(id, (count.get(id) || 0) + 1);
  return [...count].map(([id, n]) => ({ id, n, card: DB.byId.get(id) })).filter(x => x.card);
}

// 計算用のデータを作る
function opBuildModel(deck, st) {
  const traps = opTraps(st), usage = opUsing(st);
  const trapIndex = new Map(traps.map((t, i) => [t.id, i]));
  const maskOf = ids => (ids || []).reduce((m, id) => (trapIndex.has(id) ? m | (1 << trapIndex.get(id)) : m), 0);
  const cards = opDeckCards(deck).map(({ id, n, card }) => {
    const s = opCardSetting(st, id);
    return {
      id, name: card.name, count: n, role: s.role, ns: s.ns ? 1 : 0,
      vuln: s.role === 'starter' || s.role === 'extender' ? maskOf(s[opF(st, "vuln")]) : 0,
      counter: s.role === 'care' ? maskOf(s[opF(st, "counters")]) : 0,
      tags: String(s.tags || '').split(/[,、，\s]+/).map(opNorm).filter(Boolean),
      priority: Number(s.priority) || 0,
    };
  });
  const nameIdx = new Map();
  cards.forEach((c, i) => nameIdx.set(opNorm(c.name), i));
  // タグ → カード（召喚権を使わないもの・初動ではないものから先に使う）
  const tagCards = {};
  cards.forEach((c, i) => c.tags.forEach(t => (tagCards[t] = tagCards[t] || []).push(i)));
  for (const t in tagCards) tagCards[t].sort((a, b) => (cards[a].ns - cards[b].ns) || ((cards[a].role === 'starter') - (cards[b].role === 'starter')));
  const routes = [];
  cards.forEach((c, i) => { if (c.role === 'starter') routes.push({ named: [i], tags: [], priority: c.priority, single: true }); });
  const comboErrors = {};
  for (const cb of st.combos) {
    if (!String(cb.text || '').trim()) continue;
    const named = [], tags = [], errors = [];
    for (const p0 of String(cb.text).split(/[+＋]/).map(p => p.trim()).filter(Boolean)) {
      let p = p0.normalize('NFKC').trim(), n = 1, m;
      if ((m = p.match(/^(\d+)\s*[x×*]\s*(.+)$/i))) { n = +m[1]; p = m[2].trim(); }
      else if ((m = p.match(/^(.+?)\s*[x×*]\s*(\d+)$/i))) { n = +m[2]; p = m[1].trim(); }
      if (/^[#＃]/.test(p)) { const tag = opNorm(p); if (!tagCards[tag]) errors.push(p + '（このタグのカードが無い）'); for (let k = 0; k < n; k++) tags.push(tag); }
      else { const idx = nameIdx.get(opNorm(p)); if (idx === undefined) errors.push(p); else for (let k = 0; k < n; k++) named.push(idx); }
    }
    if (errors.length) { comboErrors[cb.id] = errors; continue; }
    if (named.length + tags.length) routes.push({ named, tags, priority: Number(cb.priority) || 0, single: false });
  }
  routes.sort((a, b) => (a.priority - b.priority) || (b.single - a.single));
  const deckArr = [];
  cards.forEach((c, i) => { for (let k = 0; k < c.count; k++) deckArr.push(i); });
  const careIdx = [], handtrapIdx = [];
  cards.forEach((c, i) => { if (c.role === 'care' && c.counter) careIdx.push(i); if (c.role === 'handtrap') handtrapIdx.push(i); });
  const trapTotal = usage ? 0 : traps.reduce((s, t) => s + (t.count | 0), 0);
  const oppDeckSize = Math.max(st.opp.deckSize | 0, trapTotal);
  const oppDeck = [];
  if (!usage) traps.forEach((t, i) => { for (let k = 0; k < (t.count | 0); k++) oppDeck.push(i); });
  while (oppDeck.length < oppDeckSize) oppDeck.push(-1);
  return { cards, routes, deck: deckArr, careIdx, handtrapIdx, tagCards, comboErrors, traps, T: traps.length, oppDeck, oppDecks: usage ? usage.oppDecks : null, oppHand: usage ? st.opp.handSize | 0 : Math.min(st.opp.handSize | 0, oppDeck.length) };
}

function openOpeningRate() {
  const deck = Decks.current();
  if (!deck || !deck.main.length) { toast('メインデッキが空です。先にカードを入れてください'); return; }
  const st = opLoad(deck);
  let saveTimer = null;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set(opKey(deck.id), st), 200); };
  const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';
  const root = el('div', { class: 'op-root' });
  const cardsBox = el('div', { class: 'op-cards' }), countBox = el('div', { class: 'op-count muted' });
  const combosBox = el('div', { class: 'op-combos' }), oppBox = el('div', { class: 'op-opp' }), resBox = el('div', { class: 'op-results' });
  const runMsg = el('span', { class: 'muted' });
  const names = el('datalist', { id: 'op-names' });

  const trapChips = (s, field0) => {
    const traps = opTraps(st), field = opF(st, field0);
    if (!traps.length) return el('span', { class: 'muted', text: st.opp.mode === 'usage' && !opUsing(st) ? '（使用率を読み込み中…）' : '（相手の誘発がありません）' });
    const sel = new Set(s[field] || []);
    return el('div', { class: 'op-chips' }, traps.map(t => {
      const cb = el('input', { type: 'checkbox', checked: sel.has(t.id) });
      const lab = el('label', { class: 'op-chip' + (sel.has(t.id) ? ' on' : '') }, cb, t.name);
      cb.onchange = () => { const set = new Set(s[field] || []); cb.checked ? set.add(t.id) : set.delete(t.id); s[field] = [...set]; lab.classList.toggle('on', cb.checked); save(); };
      return lab;
    }));
  };

  function renderCount() {
    const list = opDeckCards(deck);
    const by = r => list.filter(x => opCardSetting(st, x.id).role === r).reduce((s, x) => s + x.n, 0);
    countBox.textContent = `メインデッキ ${deck.main.length}枚 ｜ 初動 ${by('starter')}・展開札 ${by('extender')}・手札誘発 ${by('handtrap')}・誘発ケア ${by('care')}・事故札 ${by('brick')}`;
  }
  function renderCards() {
    const order = { starter: 0, extender: 1, care: 2, handtrap: 3, brick: 4, other: 5 };
    const list = opDeckCards(deck).sort((a, b) => order[opCardSetting(st, a.id).role] - order[opCardSetting(st, b.id).role]);
    names.replaceChildren(...list.map(x => el('option', { value: x.card.name })));
    cardsBox.replaceChildren(...list.map(({ id, n, card }) => {
      const s = opCardSetting(st, id);
      const role = el('select', {}, OP_ROLES.map(([v, l]) => el('option', { value: v, text: l, selected: s.role === v })));
      role.onchange = () => { s.role = role.value; save(); renderCards(); renderCount(); };
      const uses = s.role === 'starter' || s.role === 'extender';
      const ns = el('input', { type: 'checkbox', checked: !!s.ns });
      ns.onchange = () => { s.ns = ns.checked; save(); };
      const prio = el('input', { type: 'number', class: 'op-prio', value: s.priority });
      prio.oninput = () => { s.priority = Number(prio.value) || 0; save(); };
      const tags = el('input', { type: 'text', class: 'op-tags', value: s.tags || '', placeholder: 'タグ（例：素材）' });
      tags.onchange = () => { s.tags = tags.value; save(); renderCombos(); };
      return el('div', { class: 'op-card role-' + s.role },
        el('div', { class: 'op-card-head' },
          el('b', { class: 'op-name', text: card.name, title: card.name }), el('span', { class: 'muted', text: `×${n}` }), role,
          uses ? el('label', { class: 'op-ns', title: 'このカードを使うと通常召喚権を使う' }, ns, '召喚権を使う') : null,
          s.role === 'starter' ? el('label', { class: 'op-ns', title: '小さいほど先に使う' }, '優先度', prio) : null,
          tags),
        uses ? el('div', { class: 'op-sub' }, el('span', { class: 'muted', text: '受けると止まる誘発：' }), trapChips(s, 'vuln')) : null,
        s.role === 'care' ? el('div', { class: 'op-sub' }, el('span', { class: 'muted', text: 'ケアできる誘発：' }), trapChips(s, 'counters')) : null);
    }));
  }
  function renderCombos() {
    const model = opBuildModel(deck, st);
    combosBox.replaceChildren(...st.combos.map(cb => {
      const text = el('input', { type: 'text', class: 'op-combo-text', value: cb.text, placeholder: 'カードA + カードB（#タグ も使えます）', list: 'op-names' });
      text.oninput = () => { cb.text = text.value; save(); };
      text.onchange = renderCombos;
      const prio = el('input', { type: 'number', class: 'op-prio', value: cb.priority });
      prio.oninput = () => { cb.priority = Number(prio.value) || 0; save(); };
      const errs = model.comboErrors[cb.id];
      return el('div', { class: 'op-combo' }, text, el('label', { class: 'op-ns' }, '優先度', prio),
        el('button', { class: 'btn small', text: '✕', title: '消す', onclick: () => { st.combos = st.combos.filter(x => x !== cb); save(); renderCombos(); } }),
        errs ? el('div', { class: 'warn', text: 'デッキに無いカード：' + errs.join('、') }) : null);
    }), el('button', { class: 'btn small', text: '＋ 組み合わせを追加', onclick: () => { st.combos.push({ id: opUid('k'), text: '', priority: 20 }); save(); renderCombos(); const ins = combosBox.querySelectorAll('.op-combo-text'); if (ins.length) ins[ins.length - 1].focus(); } }));
  }
  // 相手の誘発の決め方：環境の使用率から／自分で決める
  function renderOpp() {
    const H = st.opp.handSize | 0;
    const setMode = (mode, src) => { st.opp.mode = mode; if (src) st.opp.src = src; save(); renderOpp(); renderCards(); };
    const modeBar = el('div', { class: 'op-row' },
      el('div', { class: 'seg' },
        el('button', { class: st.opp.mode === 'usage' ? 'on' : '', text: '環境の使用率から', onclick: () => setMode('usage') }),
        el('button', { class: st.opp.mode !== 'usage' ? 'on' : '', text: '自分で決める', onclick: () => setMode('manual') })),
      st.opp.mode === 'usage' ? (() => {
        const sel = el('select', {}, Object.entries(OP_SRC).map(([v, l]) => el('option', { value: v, text: l, selected: st.opp.src === v })));
        sel.onchange = () => setMode('usage', sel.value);
        return el('label', {}, '環境 ', sel);
      })() : null);
    if (st.opp.mode === 'usage') {
      const u = opUsageCache[st.opp.src];
      if (!u) {
        oppBox.replaceChildren(modeBar, el('p', { class: 'muted', text: '大会のデッキを読み込んでいます…' }));
        const src = st.opp.src;
        opLoadUsage(src).then(r => {
          if (st.opp.src !== src || st.opp.mode !== 'usage') return;
          if (!r || !r.oppDecks.length) { oppBox.append(el('p', { class: 'warn', text: 'この環境のデッキのデータがありません。「自分で決める」を使ってください。' })); return; }
          renderOpp(); renderCards();
        }).catch(e => oppBox.append(el('p', { class: 'warn', text: '読み込めませんでした：' + e.message })));
        return;
      }
      const num = el('input', { type: 'number', class: 'op-prio', value: H, min: 0, max: 10 });
      num.onchange = () => { st.opp.handSize = Math.max(0, parseInt(num.value, 10) || 0); save(); renderOpp(); };
      oppBox.replaceChildren(modeBar,
        el('p', { class: 'muted small-note', text: `${OP_SRC_NOTE[u.fmt]} ${u.nDecks}個（${u.from} からのリスト）で数えた採用率です。計算では毎回このデッキの中から1つを相手に選び、そこから初手を配ります（その誘発を入れていないデッキや、入れていても引かない場合も確率に入ります）。` }),
        el('div', { class: 'op-row' },
          el('label', {}, '相手の手札 ', num, ' 枚'),
          el('span', { class: 'muted', text: `相手の初手に下の誘発が1枚以上ある確率 ${pct(opUsageOpen(u, H, -1))}` })),
        el('table', { class: 'op-trap-table' },
          el('tr', {}, el('th', { text: '誘発' }), el('th', { text: '採用率' }), el('th', { text: '採用時の枚数' }), el('th', { text: '相手の初手にある' })),
          u.traps.map((t, i) => el('tr', {}, el('td', { text: t.name }), el('td', { text: pct(t.rate) }), el('td', { text: t.avg.toFixed(1) + '枚' }), el('td', { text: pct(opUsageOpen(u, H, i)) })))));
      return;
    }
    const D = Math.max(st.opp.deckSize | 0, 1);
    const atLeastOne = k => { let p = 1; for (let i = 0; i < H; i++) p *= Math.max(0, D - k - i) / (D - i); return 1 - p; };
    const num = (v, set, attrs) => { const i = el('input', { type: 'number', class: 'op-prio', value: v, ...attrs }); i.onchange = () => { set(Math.max(0, parseInt(i.value, 10) || 0)); save(); renderOpp(); renderCards(); }; return i; };
    const total = st.opp.traps.reduce((s, t) => s + (t.count | 0), 0);
    oppBox.replaceChildren(modeBar,
      el('div', { class: 'op-row' },
        el('label', {}, '相手のデッキ ', num(st.opp.deckSize, v => (st.opp.deckSize = v), { min: 1, max: 60 }), ' 枚'),
        el('label', {}, '相手の手札 ', num(st.opp.handSize, v => (st.opp.handSize = v), { min: 0, max: 10 }), ' 枚'),
        el('span', { class: 'muted', text: `誘発 合計${total}枚 ／ 相手が1枚以上持つ確率 ${pct(atLeastOne(total))}` })),
      ...st.opp.traps.map(t => {
        const name = el('input', { type: 'text', value: t.name, class: 'op-trap-name' });
        name.onchange = () => { t.name = name.value; save(); renderCards(); };
        return el('div', { class: 'op-row' }, name, num(t.count, v => (t.count = v), { min: 0 }), el('span', { class: 'muted', text: `手札にある確率 ${pct(atLeastOne(t.count | 0))}` }),
          el('button', { class: 'btn small', text: '✕', title: '消す', onclick: () => {
            st.opp.traps = st.opp.traps.filter(x => x !== t);
            for (const s of Object.values(st.cards)) { s.vuln = (s.vuln || []).filter(x => x !== t.id); s.counters = (s.counters || []).filter(x => x !== t.id); }
            save(); renderOpp(); renderCards();
          } }));
      }),
      st.opp.traps.length < 30 ? el('button', { class: 'btn small', text: '＋ 誘発を追加', onclick: () => {
        const t = { id: opUid('t'), name: '新しい誘発', count: 1 };
        st.opp.traps.push(t);
        // 初動・展開札は、新しい誘発でも止まる扱いにしておく（あとで外せる）
        for (const s of Object.values(st.cards)) if (s.role === 'starter' || s.role === 'extender') s.vuln = [...(s.vuln || []), t.id];
        save(); renderOpp(); renderCards();
      } }) : null);
  }
  function renderResults(R) {
    const col = (title, r, exact) => {
      const n = r.iters, raw = r.raw / n, nsok = r.nsok / n, real = r.real / n, inf = r.realInfNs / n;
      const se = Math.sqrt(real * (1 - real) / n);
      const bar = (label, v, cls) => el('div', { class: 'op-bar' }, el('span', { text: label }), el('div', { class: 'op-track' }, el('div', { class: 'op-fill ' + cls, style: `width:${(v * 100).toFixed(2)}%` })), el('b', { text: pct(v) }));
      return el('div', { class: 'op-res-col' },
        el('h4', { text: title }),
        el('div', { class: 'muted', text: '実質初動率' }), el('div', { class: 'op-big', text: pct(real) }), el('div', { class: 'muted small-note', text: `誤差 ±${pct(1.96 * se, 2)}` }),
        bar('初動率', raw, 'f1'), bar('召喚権を考慮', nsok, 'f2'), bar('実質初動率', real, 'f3'),
        el('ul', { class: 'op-loss' },
          el('li', {}, '事故（初動なし）：', el('b', { text: pct(1 - raw) })),
          el('li', {}, '召喚権が足りない組み合わせしかない：', el('b', { text: pct(raw - nsok) })),
          el('li', {}, '相手の誘発で止まる：', el('b', { text: pct(nsok - real) }), el('span', { class: 'muted', text: `（うち召喚権のかぶりが原因：約${pct(Math.max(0, inf - real))}）` })),
          el('li', {}, '初動＋自分の手札誘発1枚以上：', el('b', { text: pct(r.withHT / n) }))),
        el('div', { class: 'muted small-note', text: `参考：1枚初動のカードだけの理論値 ${pct(exact)}` }),
        R.model.traps.length ? el('table', { class: 'op-trap-table' },
          el('tr', {}, el('th', { text: '相手が1枚だけ持っていた誘発' }), el('th', { text: '展開できる率' })),
          R.model.traps.map((t, i) => el('tr', {}, el('td', { text: t.name }), el('td', { text: pct(r.perTrap[i] / n) })))) : null);
    };
    resBox.replaceChildren(el('div', { class: 'op-res-grid' }, col('先攻（手札5枚）', R.first, R.exact5), col('後攻（手札6枚）', R.second, R.exact6)));
  }

  const iters = el('select', {}, [[20000, '2万回（速い）'], [100000, '10万回'], [300000, '30万回（精密）']].map(([v, l]) => el('option', { value: v, text: l, selected: (st.iters || 100000) === v })));
  iters.onchange = () => { st.iters = +iters.value; save(); };
  const run = el('button', { class: 'btn primary', text: '計算する' });
  run.onclick = () => {
    if (st.opp.mode === 'usage' && !opUsing(st)) { runMsg.textContent = '相手のデッキ（使用率）を読み込み中です。少し待ってからもう一度押してください'; return; }
    const model = opBuildModel(deck, st);
    save();
    if (model.deck.length < 6) { runMsg.textContent = 'デッキのカードが少なすぎます'; return; }
    if (!model.routes.length) { runMsg.textContent = '「初動」のカードか、組み合わせ初動を1つ以上決めてください'; return; }
    runMsg.textContent = '計算中…'; run.disabled = true;
    setTimeout(() => {
      const n = st.iters || 100000, t0 = performance.now();
      const R = { model, first: OpSim.simulate(model, 5, n), second: OpSim.simulate(model, 6, n), exact5: OpSim.exactSingle(model, 5), exact6: OpSim.exactSingle(model, 6) };
      renderResults(R);
      const errs = Object.keys(model.comboErrors).length;
      runMsg.textContent = `完了（${((performance.now() - t0) / 1000).toFixed(1)}秒）` + (errs ? `　※書き方に誤りのある組み合わせ ${errs}件は数えていません` : '');
      run.disabled = false;
    }, 30);
  };

  root.append(names,
    el('p', { class: 'muted small-note', text: '手札をたくさん配って数えます。「初動」にするカードを選び、2枚そろって初動になるものは「組み合わせ初動」に書いてください。設定はデッキごとに保存されます。' }),
    el('h3', { text: '1. カードの役割' }),
    el('p', { class: 'muted small-note', text: '初動＝1枚で展開が始まるカード ／ 展開札＝1枚では初動にならないカード（組み合わせで使う） ／ 誘発ケア＝抹殺の指名者など。「召喚権を使う」はそのカードで通常召喚する場合にチェック（推測で入れてあります）。' }),
    countBox, cardsBox,
    el('h3', { text: '2. 組み合わせ初動' }),
    el('p', { class: 'muted small-note', text: '例：「カードA + カードB」「#素材 + #素材」「2x #レベル4」。#タグ はカードのタグ欄に書いた名前で、そのタグのカードどれか1枚です。' }),
    combosBox,
    el('h3', { text: '3. 相手の手札誘発' }),
    oppBox,
    el('h3', { text: '4. 計算' }),
    el('div', { class: 'op-row' }, el('label', {}, '回数 ', iters), run, runMsg),
    resBox,
    el('details', { class: 'op-about' }, el('summary', { text: '計算のしかた' }),
      el('ul', {},
        el('li', { text: '初動率：初動のカード、または組み合わせ初動がそろっている手札の割合（召喚権は考えない）。' }),
        el('li', { text: '召喚権を考慮：通常召喚1回で始められる初動がある割合。' }),
        el('li', { text: '実質初動率：相手にもデッキから手札を配り、止められずに展開できた割合（「環境の使用率から」では、毎回大会のデッキを1つ選んで相手のデッキにします）。初動を優先度の順に使い、相手は止められる誘発があれば撃ち（ケアされないものから）、自分はケア札があれば無効にします。止められた初動のカードと召喚権は失い、残りで次の初動を試します。' }),
        el('li', { text: '分かりやすさ優先の近似です。止まった初動から一部のリソースが残る場合や、召喚権を増やすカード、増殖するGを受けて展開をやめる判断などは考えていません。' }))));
  renderCount(); renderCards(); renderCombos(); renderOpp();
  showModal({ title: `📊 初動率：${deck.name}`, body: root, wide: true, onClose: () => { clearTimeout(saveTimer); store.set(opKey(deck.id), st); } });
}
