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
    const oppDeck = Int32Array.from(m.oppDeck), OD = oppDeck.length, OH = m.oppHand;
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
      for (let i = 0; i < OH; i++) {
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
const OP_STOP_RE = /うらら|泡影|ヴェーラー|わらし|しぐれ/;   // 初動を止める誘発（増殖するGなどは止めない扱い）
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
  const s = store.get(opKey(deck.id), null);
  if (s && s.cards && s.opp) return s;
  return { cards: {}, combos: [], opp: { deckSize: 40, handSize: 5, traps: opDefaultTraps() }, iters: 100000 };
}
// デッキのカードの設定（初めてのカードは、名前などから役割を推測する）
function opCardSetting(st, id) {
  if (st.cards[id]) return st.cards[id];
  const c = DB.byId.get(id) || {};
  const ht = typeof isHandTrap === 'function' && isHandTrap(id);
  const care = OP_CARE_NAMES.includes(c.name);
  const monster = !!(c.type & T.MONSTER);
  const traps = st.opp.traps;
  const stop = traps.filter(t => OP_STOP_RE.test(t.name)).map(t => t.id);
  // 墓穴の指名者は、墓地へ行く誘発だけケアできる（泡影は無理）
  const counters = traps.filter(t => !(c.name === '墓穴の指名者' && /泡影/.test(t.name))).map(t => t.id);
  return (st.cards[id] = {
    role: care ? 'care' : ht ? 'handtrap' : 'other',
    ns: monster && !ht && (c.level || 0) <= 4 && !(c.type & (T.LINK | T.SPSUMMON)),
    tags: '', vuln: stop.length ? stop : traps.map(t => t.id), counters, priority: 10,
  });
}
function opDeckCards(deck) {
  const count = new Map();
  for (const id of deck.main) count.set(id, (count.get(id) || 0) + 1);
  return [...count].map(([id, n]) => ({ id, n, card: DB.byId.get(id) })).filter(x => x.card);
}

// 計算用のデータを作る
function opBuildModel(deck, st) {
  const traps = st.opp.traps;
  const trapIndex = new Map(traps.map((t, i) => [t.id, i]));
  const maskOf = ids => (ids || []).reduce((m, id) => (trapIndex.has(id) ? m | (1 << trapIndex.get(id)) : m), 0);
  const cards = opDeckCards(deck).map(({ id, n, card }) => {
    const s = opCardSetting(st, id);
    return {
      id, name: card.name, count: n, role: s.role, ns: s.ns ? 1 : 0,
      vuln: s.role === 'starter' || s.role === 'extender' ? maskOf(s.vuln) : 0,
      counter: s.role === 'care' ? maskOf(s.counters) : 0,
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
  const trapTotal = traps.reduce((s, t) => s + (t.count | 0), 0);
  const oppDeckSize = Math.max(st.opp.deckSize | 0, trapTotal);
  const oppDeck = [];
  traps.forEach((t, i) => { for (let k = 0; k < (t.count | 0); k++) oppDeck.push(i); });
  while (oppDeck.length < oppDeckSize) oppDeck.push(-1);
  return { cards, routes, deck: deckArr, careIdx, handtrapIdx, tagCards, comboErrors, traps, T: traps.length, oppDeck, oppHand: Math.min(st.opp.handSize | 0, oppDeck.length) };
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

  const trapChips = (s, field) => {
    if (!st.opp.traps.length) return el('span', { class: 'muted', text: '（相手の誘発がありません）' });
    const sel = new Set(s[field] || []);
    return el('div', { class: 'op-chips' }, st.opp.traps.map(t => {
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
  function renderOpp() {
    const D = Math.max(st.opp.deckSize | 0, 1), H = st.opp.handSize | 0;
    const atLeastOne = k => { let p = 1; for (let i = 0; i < H; i++) p *= Math.max(0, D - k - i) / (D - i); return 1 - p; };
    const num = (v, set, attrs) => { const i = el('input', { type: 'number', class: 'op-prio', value: v, ...attrs }); i.onchange = () => { set(Math.max(0, parseInt(i.value, 10) || 0)); save(); renderOpp(); renderCards(); }; return i; };
    const total = st.opp.traps.reduce((s, t) => s + (t.count | 0), 0);
    oppBox.replaceChildren(
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
        el('li', { text: '実質初動率：相手にもデッキから手札を配り、止められずに展開できた割合。初動を優先度の順に使い、相手は止められる誘発があれば撃ち（ケアされないものから）、自分はケア札があれば無効にします。止められた初動のカードと召喚権は失い、残りで次の初動を試します。' }),
        el('li', { text: '分かりやすさ優先の近似です。止まった初動から一部のリソースが残る場合や、召喚権を増やすカード、増殖するGを受けて展開をやめる判断などは考えていません。' }))));
  renderCount(); renderCards(); renderCombos(); renderOpp();
  showModal({ title: `📊 初動率：${deck.name}`, body: root, wide: true, onClose: () => { clearTimeout(saveTimer); store.set(opKey(deck.id), st); } });
}
