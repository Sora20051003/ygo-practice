// ---------- デッキの自動作成 ----------
// 大会・ランクマッチのデッキ（サンプルデッキ・マスターデュエルの使用率データ）から、カードの「同時採用率」を数えて組む。
// ・今のデッキにカードが入っていれば、そのカードが入っているデッキほど重く数える（入っているカードとの同時採用率が高いカードを積む）
// ・空のデッキなら、テーマ（デッキタイプ）を選んで、そのテーマのデッキでよく使われるカードを積む
// ・メインデッキの枚数（40〜60）を選べる
// ・実質初動率の下限を決めると、下回るあいだ「初動ではない、採用率の低いカード」を「初動のカード」に入れ替える
const AB_MIN_RATE = 0.04;   // これより同時採用率の低いカードは、枚数が足りないときだけ使う

// 数える元のデッキ：[{ t: デッキタイプ, cards: Map(カード名 → { card, n }) }]
async function abSourceDecks(fmt) {
  const out = [];
  const add = (t, list) => {
    const cards = new Map();
    for (const { card, n } of list) {
      if (!card) continue;
      const k = card.name;
      const cur = cards.get(k);
      cards.set(k, { card: cur ? cur.card : card, n: (cur ? cur.n : 0) + (n || 1) });
    }
    if (cards.size >= 10) out.push({ t: t || '', cards });
  };
  // マスターデュエル：今の期間の大会・ランクマッチのデッキ全部
  if (fmt === 'md') {
    if (typeof MD_USAGE === 'undefined') { try { await loadScript('data/md-usage.js?d=' + new Date().toISOString().slice(0, 10)); } catch { /* 無ければサンプルだけ */ } }
    if (typeof MD_USAGE !== 'undefined') {
      const table = MD_USAGE.cards.map(v => sampleCard(v));
      for (const d of MD_USAGE.decks) {
        const list = [];
        for (let i = 2; i + 1 < d.length; i += 2) list.push({ card: table[d[i]], n: d[i + 1] | 0 });
        add(d[1], list);
      }
    }
  }
  // サンプルデッキ：新しい期間から、デッキが十分な数になるまで
  const data = await loadSamples(fmt);
  if (data && data.periods) {
    const keys = Object.keys(data.periods).sort().reverse();
    let used = 0;
    for (const k of keys) {
      for (const s of data.periods[k]) {
        add(s.t, [...(s.m || []), ...(s.x || [])].map(([v, n, name]) => ({ card: sampleCardOf(v, name), n })));
        used++;
      }
      if (used >= 150 && out.length >= 150) break;
    }
  }
  return out;
}

// 同時採用率を数える。seeds：今のデッキのカード名、theme：テーマ（空のデッキのとき）
function abScore(decks, seeds, theme) {
  const seedSet = new Set(seeds);
  const weighted = [];
  for (const d of decks) {
    let w = 0;
    if (seedSet.size) {
      let hit = 0;
      for (const s of seedSet) if (d.cards.has(s)) hit++;
      const sim = hit / seedSet.size;
      w = sim * sim * sim;   // 入っているカードが多く重なるデッキほど重く
    } else if (theme) w = d.t === theme ? 1 : 0;
    if (w > 0) weighted.push([d, w]);
  }
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  const stat = new Map();   // 名前 → { card, w: 採用の重み, nw: 枚数×重み }
  for (const [d, w] of weighted) {
    for (const [k, { card, n }] of d.cards) {
      const s = stat.get(k) || { card, w: 0, nw: 0 };
      s.w += w; s.nw += w * n;
      stat.set(k, s);
    }
  }
  const list = [...stat.values()].map(s => ({ card: s.card, rate: total ? s.w / total : 0, avg: s.w ? s.nw / s.w : 1 }));
  list.sort((a, b) => b.rate - a.rate);
  return { list, decks: weighted.length };
}

// 入っているカードと同じテーマ（カテゴリ）のカード（同時採用のデータが少ないときの補い）
function abThemeMates(seedCards, fmt, ctx) {
  const codes = new Set();
  for (const c of seedCards) for (let s = c.setcode || 0; s > 0; s = Math.floor(s / 65536)) codes.add(s % 65536);
  if (!codes.size) return [];
  const out = [], seen = new Set(seedCards.map(c => c.name));
  for (const c of DB.cards) {
    if (seen.has(c.name) || isToken(c) || !cardAllowed(c, fmt) || !limitIn(c, ctx)) continue;
    let hit = false;
    for (let s = c.setcode || 0; s > 0 && !hit; s = Math.floor(s / 65536)) if (codes.has(s % 65536)) hit = true;
    if (hit) { seen.add(c.name); out.push(c); }
  }
  return out;
}

// デッキを組む：今のカードはそのまま残し、同時採用率の高い順に、よく入っている枚数ずつ足す
function abFill(base, scored, mates, size, fmt, ctx) {
  const main = [...base.main], extra = [...(base.extra || [])];
  const count = new Map();
  for (const id of [...main, ...extra]) { const c = DB.byId.get(id); if (c) count.set(c.name, (count.get(c.name) || 0) + 1); }
  const room = c => (cardAllowed(c, fmt) ? limitIn(c, ctx) : 0) - (count.get(c.name) || 0);
  const put = (c, n) => {
    const ex = isExtraType(c);
    const arr = ex ? extra : main, cap = ex ? 15 : size;
    let k = Math.min(n, room(c), cap - arr.length);
    for (; k > 0; k--) { arr.push(c.id); count.set(c.name, (count.get(c.name) || 0) + 1); }
  };
  const full = () => main.length >= size && extra.length >= 15;
  // 1回目：同時採用率が高いカードを、よく入っている枚数で
  for (const x of scored) { if (full()) break; if (x.rate >= AB_MIN_RATE) put(x.card, Math.max(1, Math.round(x.avg))); }
  // 2回目：足りなければ、同じテーマのカード → 採用率の低いカードも
  for (const c of mates) { if (main.length >= size) break; if (!isExtraType(c)) put(c, 2); }
  for (const x of scored) { if (main.length >= size) break; if (!isExtraType(x.card)) put(x.card, Math.max(1, Math.round(x.avg))); }
  // 3回目：まだ足りなければ、採用率の高いカードの枚数を増やす
  for (const x of scored) { if (main.length >= size) break; if (!isExtraType(x.card)) put(x.card, 3); }
  return { main: main.slice(0, size), extra };
}

// 実質初動率（相手の誘発は環境の使用率から）。first：先攻（手札5枚）
function abRate(deck, st, iters = 20000) {
  const model = opBuildModel(deck, st);
  if (!model.routes.length || model.deck.length < 6) return { first: 0, second: 0 };
  const f = OpSim.simulate(model, 5, iters), s = OpSim.simulate(model, 6, iters, true);
  return { first: f.real / f.iters, second: s.real / s.iters };
}

async function abBuild(opt, onStep) {
  const cur = opt.base;
  const fmt = deckFormat(cur);
  const ctx = regContext({ format: fmt, reg: cur.reg || 'latest', cutoff: cur.cutoff });
  onStep('大会・ランクマッチのデッキを読み込んでいます…');
  const decks = await abSourceDecks(fmt);
  const seedCards = [...new Map([...cur.main, ...(cur.extra || [])].map(id => DB.byId.get(id)).filter(Boolean).map(c => [c.name, c])).values()];
  const { list: scored, decks: nSimilar } = abScore(decks, seedCards.map(c => c.name), opt.theme);
  const mates = abThemeMates(seedCards, fmt, ctx);
  const deck = { id: 'autobuild-tmp', name: cur.name, format: fmt, reg: cur.reg, cutoff: cur.cutoff, ...abFill(cur, scored, mates, opt.size, fmt, ctx) };
  const rateOf = new Map(scored.map(x => [x.card.name, x.rate]));
  const info = { nSimilar, nDecks: decks.length, swaps: [], rate: null, met: null, rateOf };
  if (!opt.minRate) return { deck, info };

  // ---- 実質初動率の下限 ----
  onStep('相手の手札誘発の使用率を読み込んでいます…');
  const st = opLoad(deck);
  st.opp.mode = 'usage';
  await opLoadUsage(st.opp.src);
  // 初動の判別：デッキのカードと、入れ替えの候補（採用率の高い、デッキに入っていないカード）
  const seedNames = new Set(seedCards.map(c => c.name));
  const inDeck = new Set(deck.main.map(id => DB.byId.get(id).name));
  const ctx2 = ctx;
  const pool = scored.filter(x => !isExtraType(x.card) && !inDeck.has(x.card.name) && cardAllowed(x.card, fmt) && limitIn(x.card, ctx2) > 0).slice(0, 20).map(x => x.card);
  const judgeDeck = { ...deck, main: [...deck.main, ...pool.map(c => c.id)] };
  await opAutoJudge(judgeDeck, st, (i, n, name) => onStep(`初動を判別しています… ${i}/${n}（${name}）`));
  onStep('2枚の組み合わせ初動を探しています…');
  await opAutoPairs(deck, st, (i, n) => onStep(`2枚の組み合わせ初動を探しています… ${i}/${n}`));
  const role = id => opCardSetting(st, id).role;
  const nameCount = () => { const m = new Map(); for (const id of deck.main) { const n = DB.byId.get(id).name; m.set(n, (m.get(n) || 0) + 1); } return m; };
  const limitOf = c => (cardAllowed(c, fmt) ? limitIn(c, ctx) : 0);
  let r = abRate(deck, st);
  for (let step = 0; step < 24 && r.first < opt.minRate; step++) {
    onStep(`実質初動率 ${(r.first * 100).toFixed(1)}%：初動を増やしています…（${step + 1}回目）`);
    const cnt = nameCount();
    // 足す：初動のカード（同時採用率の高い順）で、まだ積めるもの
    const starters = [...new Map([...deck.main.map(id => DB.byId.get(id)), ...pool].filter(c => role(c.id) === 'starter').map(c => [c.name, c])).values()]
      .filter(c => (cnt.get(c.name) || 0) < limitOf(c))
      .sort((a, b) => (rateOf.get(b.name) || 0) - (rateOf.get(a.name) || 0));
    // 抜く：今のデッキに最初から入っていたカード以外で、初動・手札誘発・誘発ケアではないもの（採用率の低い順。展開札は最後）
    const order = { brick: 0, other: 1, extender: 2 };
    const removable = [...new Set(deck.main)].map(id => DB.byId.get(id))
      .filter(c => !seedNames.has(c.name) && order[role(c.id)] != null)
      .sort((a, b) => (order[role(a.id)] - order[role(b.id)]) || ((rateOf.get(a.name) || 0) - (rateOf.get(b.name) || 0)));
    if (!starters.length || !removable.length) break;
    let improved = false;
    for (const out of removable.slice(0, 4)) {
      const add = starters[0];
      const i = deck.main.indexOf(out.id);
      deck.main.splice(i, 1, add.id);
      const r2 = abRate(deck, st);
      if (r2.first >= r.first) { info.swaps.push(`${out.name} → ${add.name}`); r = r2; improved = true; break; }
      deck.main.splice(i, 1, out.id);   // 下がったら戻す
    }
    if (!improved) break;
  }
  info.rate = r; info.met = r.first >= opt.minRate;
  return { deck, info };
}

function openAutoBuild() {
  const cur = Decks.current();
  const fmt = deckFormat(cur);
  const size = el('input', { type: 'number', min: 40, max: 60, value: Math.max(40, Math.min(60, cur.main.length > 40 ? cur.main.length : 40)), class: 'op-prio' });
  const useMin = el('input', { type: 'checkbox', checked: true });
  const minRate = el('input', { type: 'number', min: 0, max: 100, step: 1, value: 70, class: 'op-prio' });
  const themeSel = el('select', {}, el('option', { value: '', text: '読み込み中…' }));
  const msg = el('div', { class: 'muted small-note' });
  const result = el('div', { class: 'stack' });
  const empty = !cur.main.length && !(cur.extra || []).length;
  const themeRow = el('label', { class: 'row', hidden: !empty }, 'テーマ ', themeSel);
  if (empty) {
    abSourceDecks(fmt).then(decks => {
      const n = new Map();
      for (const d of decks) if (d.t) n.set(d.t, (n.get(d.t) || 0) + 1);
      themeSel.replaceChildren(...[...n].sort((a, b) => b[1] - a[1]).map(([t, k]) => el('option', { value: t, text: `${t}（${k}個）` })));
    });
  }
  const run = el('button', { class: 'btn primary', text: '作る' });
  let last = null;
  run.onclick = async () => {
    run.disabled = true; result.replaceChildren();
    const opt = { base: cur, size: Math.max(40, Math.min(60, parseInt(size.value, 10) || 40)), minRate: useMin.checked ? Math.max(0, Math.min(100, +minRate.value || 0)) / 100 : 0, theme: empty ? themeSel.value : '' };
    if (empty && !opt.theme) { msg.textContent = 'テーマを選んでください'; run.disabled = false; return; }
    if (cur.main.length > opt.size) { msg.textContent = `今のメインデッキ（${cur.main.length}枚）より多い枚数にしてください`; run.disabled = false; return; }
    try {
      last = await abBuild(opt, t => { msg.textContent = t; });
      showResult(last, opt);
      msg.textContent = '';
    } catch (e) { console.error(e); msg.textContent = '作れませんでした：' + (e.message || e); }
    run.disabled = false;
  };
  const cardsOf = ids => { const m = new Map(); for (const id of ids) m.set(id, (m.get(id) || 0) + 1); return [...m]; };
  function showResult({ deck, info }, opt) {
    const list = (ids, title) => el('div', {}, el('b', { text: `${title} ${ids.length}枚` }),
      el('div', { class: 'op-chips' }, cardsOf(ids).map(([id, n]) => {
        const c = DB.byId.get(id), rate = info.rateOf.get(c.name);
        return el('span', { class: 'op-starter-chip', title: rate != null ? `同時採用率 ${(rate * 100).toFixed(0)}%` : '' }, `${c.name} ×${n}`, rate != null ? el('span', { class: 'muted', text: ` ${(rate * 100).toFixed(0)}%` }) : null);
      })));
    const pct = x => (x * 100).toFixed(1) + '%';
    result.replaceChildren(
      el('p', { class: 'muted small-note', text: `似ているデッキ ${info.nSimilar}個（全${info.nDecks}個）の同時採用率で組みました。カードの横の％は、似ているデッキに入っていた割合です。` }),
      info.nSimilar < 5 ? el('p', { class: 'warn', text: '似ているデッキが少ないので、同じテーマのカードで補っています。' }) : null,
      info.rate ? el('p', {}, '実質初動率（環境の手札誘発あり）：先攻 ', el('b', { text: pct(info.rate.first) }), '・後攻 ', el('b', { text: pct(info.rate.second) }),
        info.met ? el('span', { class: 'muted', text: `（下限 ${pct(opt.minRate)} 以上）` }) : el('span', { class: 'warn', text: `　下限 ${pct(opt.minRate)} に届きませんでした（入れ替えられる初動が足りません）` })) : null,
      info.swaps.length ? el('details', {}, el('summary', { text: `初動を増やすために入れ替えたカード ${info.swaps.length}枚` }), el('ul', {}, info.swaps.map(s => el('li', { text: s })))) : null,
      list(deck.main, 'メインデッキ'), list(deck.extra, 'EXデッキ'),
      el('div', { class: 'row' },
        el('button', { class: 'btn primary', text: '新しいデッキとして保存', onclick: () => {
          const nd = Decks.blank(`${cur.name || 'デッキ'}（自動作成）`, fmt);
          nd.reg = cur.reg; if (cur.cutoff) nd.cutoff = cur.cutoff;
          nd.main = deck.main.slice(); nd.extra = deck.extra.slice();
          Decks.list.push(nd); Decks.currentId = nd.id; Decks.save(); renderDeck();
          toast(`「${nd.name}」を作りました`);
        } }),
        el('button', { class: 'btn', text: '今のデッキを置き換える', onclick: () => {
          cur.main = deck.main.slice(); cur.extra = deck.extra.slice(); Decks.save(); renderDeck();
          toast('今のデッキを置き換えました');
        } })));
  }
  showModal({
    title: '🤖 デッキの自動作成', wide: true,
    body: el('div', { class: 'stack' },
      el('p', { class: 'muted small-note', text: empty
        ? '大会・ランクマッチのデッキから、選んだテーマでよく使われるカードを積みます。'
        : `今のデッキのカード（${cur.main.length + (cur.extra || []).length}枚）はそのまま残し、それが入っている大会・ランクマッチのデッキで一緒に使われることが多い（同時採用率が高い）カードを積みます。` }),
      themeRow,
      el('label', { class: 'row' }, 'メインデッキ ', size, ' 枚（40〜60）'),
      el('label', { class: 'row' }, useMin, '実質初動率の下限 ', minRate, ' %（先攻・環境の手札誘発あり。下回るときは初動を増やします）'),
      el('div', { class: 'row' }, run), msg, result),
  });
}
