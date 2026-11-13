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
    used.main = used.length;   // ここまでが展開に使うカード（このあとは手札コストで捨てるカード）
    if (ok && r.cost) {
      for (let k = 0; k < r.cost; k++) {
        let pick = -1;
        for (const j of m.costOrder) if (hc[j] > 0) { pick = j; break; }
        if (pick < 0) { ok = false; break; }
        hc[pick]--; used.push(pick);
      }
    }
    for (const c of used) hc[c]++;
    if (ok && r.fixedNs != null) ns = r.fixedNs;   // 自動で見つけた組み合わせは、試したときに使った召喚権の数
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
      for (let k = 0; k < (used.main ?? used.length); k++) vm |= m.cards[used[k]].vuln;   // 手札コストのカードは止められる理由にならない
      // 場でモンスター効果を使わない初動（チェーン隠しできるものなど）は、「場でモンスター効果を使った時」の妨害を受けない
      // 条件付きの0ターン展開：場（手札・墓地）でモンスター効果を使う初動にだけ動ける
      if (s.fieldBits || s.handBits) {
        let field = false, hand = false;
        for (let k = 0; k < (used.main ?? used.length); k++) { if (m.cards[used[k]].field) field = true; if (m.cards[used[k]].hand) hand = true; }
        const allowed = (field ? s.fieldBits : 0) | (hand ? s.handBits : 0);
        vm &= ~(s.fieldBits | s.handBits) | allowed;
      }
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
  // 貫通：相手が「止める誘発」を n 枚持っていて、止められる初動には必ず撃つとしたとき、それでも展開を続けられるか。
  // 誘発ケアは、その初動を止める誘発のどれかをケアできれば無効にできる（相手の誘発も1枚使ったことになる）
  function pierce(m, hc0, n, nsInit, s) {
    const hc = s.hc2, used = s.used;
    hc.set(hc0);
    let ns = nsInit, left = n;
    for (let i = 0; i < m.routes.length; i++) {
      const nsUsed = tryAssign(m, m.routes[i], hc, ns, used);
      if (nsUsed < 0) continue;
      let vm = 0;
      for (let k = 0; k < (used.main ?? used.length); k++) vm |= m.cards[used[k]].vuln;
      let stopped = false;
      while (left > 0 && vm) {
        let care = -1;
        for (const c of m.careIdx) if (hc[c] > 0 && (m.cards[c].counter & vm)) { care = c; break; }
        left--;
        if (care >= 0) { hc[care]--; continue; }   // ケア札で無効にした
        stopped = true; break;
      }
      if (!stopped) return true;
      for (const c of used) hc[c]--;
      ns -= nsUsed;
      i--;
    }
    return false;
  }
  function simulate(m, handSize, iters, second) {
    const C = m.cards.length, T = m.T;
    const deck = Int32Array.from(m.deck), N = deck.length, H = Math.min(handSize, N);
    let oppDeck = Int32Array.from(m.oppDeck), OD = oppDeck.length;
    const OH = m.oppHand;
    // 使用率から：毎回、大会のデッキを1つ選んで相手のデッキにする（その誘発を入れているか・何枚か、も確率に入る）
    const oppDecks = m.oppDecks ? m.oppDecks.map(d => Int32Array.from(d)) : null;
    // 相手のデッキのカードの番号（0ターン展開が最後まで届くかを試すのに使う。oppDecks と同じ順に並べ替える）
    const oppIds = m.oppIds ? m.oppIds.map(d => Int32Array.from(d)) : null;
    let ids = null;
    const hc = new Int32Array(C), opp = new Int32Array(T), single = new Int32Array(T);
    const s = { hc2: new Int32Array(C), opp2: new Int32Array(T), used: [] }, used = [];
    const res = { iters, raw: 0, nsok: 0, real: 0, realInfNs: 0, withHT: 0, pierce1: 0, pierce2: 0, perTrap: new Array(T).fill(0) };
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
      if (oppDecks) { const k = Math.floor(Math.random() * oppDecks.length); oppDeck = oppDecks[k]; OD = oppDeck.length; ids = oppIds ? oppIds[k] : null; }
      // 手札（OH 枚）と、その次の数枚（0ターン展開でデッキの上から墓地へ送るカード）まで混ぜる
      const MIX = Math.min(OD, OH + (ids ? 5 : 0));
      for (let i = 0; i < MIX; i++) {
        const j = i + Math.floor(Math.random() * (OD - i));
        const tmp = oppDeck[i]; oppDeck[i] = oppDeck[j]; oppDeck[j] = tmp;
        if (ids) { const t2 = ids[i]; ids[i] = ids[j]; ids[j] = t2; }
        if (i < OH && oppDeck[i] >= 0) opp[oppDeck[i]]++;
      }
      // 0ターン展開が妨害まで届くか（ティアラメンツ：ルルカロスを出せるか など）
      // fieldBits：こちらが場でモンスター効果を使ったときだけ使える妨害（ハゥフニス・クラックなど）
      let fieldBits = 0, handBits = 0;
      if (ids && m.zeroSim && !second) for (const [t, fn] of m.zeroSim) {
        const r = fn(ids, OH, OD);   // 1＝条件なしで動ける／2＝こちらが場でモンスター効果を使えば／4＝手札・墓地でモンスター効果を使えば
        opp[t] = r ? 1 : 0;
        if (r && !(r & 1)) { if (r & 2) fieldBits |= 1 << t; if (r & 4) handBits |= 1 << t; }
      }
      s.fieldBits = fieldBits; s.handBits = handBits;
      // 0ターン展開（相手が後攻のとき、こちらの先攻1ターン目に展開する）：そのテーマのカードが何枚あっても妨害1回。こちらが後攻なら無い
      for (const t of m.zeroIdx || []) opp[t] = second ? 0 : Math.min(opp[t], 1);
      if (!nsok) continue;
      res.nsok++;
      if (resolve(m, hc, opp, 99, s)) res.realInfNs++;
      if (resolve(m, hc, opp, 1, s)) res.real++;
      if (pierce(m, hc, 1, 1, s)) res.pierce1++;
      if (pierce(m, hc, 2, 1, s)) res.pierce2++;
      s.fieldBits = 0; s.handBits = 0;   // 1枚だけ持っていたとき：動けたものとして数える
      for (let t = 0; t < T; t++) { if (second && (m.zeroIdx || []).includes(t)) continue; single.fill(0); single[t] = 1; if (resolve(m, hc, single, 1, s)) res.perTrap[t]++; }
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
const OP_STOP_RE = /0ターン展開|うらら|泡影|ヴェーラー|わらし|しぐれ|うさぎ|ドロール|γ/;   // 初動を止める誘発（増殖するGなどは止めない扱い）
// 手札誘発として数えないカード（自分の展開を助けるカード・永続罠など）
const OP_NOT_TRAP = ['墓穴の指名者', '抹殺の指名者', '三戦の才', 'センサー万別'];
const OP_SRC = { md: 'マスターデュエル', ocg: 'OCG', tcg: 'TCG（海外）' };
const OP_SRC_NOTE = { md: 'Master Duel Meta の大会上位・高ランクのデッキ', ocg: '大会入賞デッキ', tcg: '海外の大会入賞デッキ' };

// ---------- 環境の手札誘発の使用率（サンプルデッキから数える） ----------
const opUsageCache = {};
async function opLoadUsage(fmt, oppHand) {
  if (opUsageCache[fmt] && !opUsageCache[fmt].partial) return opUsageCache[fmt];
  // 0ターン展開のカードを見分けるのに効果の文を使う（まだ読んでいなければ読む）
  // （起動直後はカードのデータを読み直していて、文がまだ付いていないことがあるので、付くまで少し待つ）
  const textReady = () => opTextReady();
  if (!textReady() && typeof loadJaTexts === 'function') { try { await loadJaTexts(() => {}); } catch (e) { /* 文が無くても手札誘発は数えられる */ } }
  for (let i = 0; i < 100 && !textReady(); i++) await new Promise(r => setTimeout(r, 200));
  // マルチャミー（相手の行動でドローする）も、増殖するGと同じ手札誘発として数える（止める誘発ではない）
  const isTrap = c => c && !OP_NOT_TRAP.includes(c.name) && (/^マルチャミー/.test(c.name) || (typeof isHandTrap === 'function' && isHandTrap(c.id)) || (typeof HANDTRAP_NAMES !== 'undefined' && HANDTRAP_NAMES.includes(c.name)));
  let list = null, from = '', src = 'samples';
  // マスターデュエル：今の期間の大会・ランク戦のデッキ全部（data/md-usage.js。毎日自動で更新）
  if (fmt === 'md') {
    if (typeof MD_USAGE === 'undefined') { try { await loadScript('data/md-usage.js?d=' + new Date().toISOString().slice(0, 10)); } catch (e) { /* 無ければサンプルデッキで数える */ } }
    if (typeof MD_USAGE !== 'undefined' && MD_USAGE.n >= 40) {
      const table = MD_USAGE.cards.map(v => sampleCard(v));
      // ランクマッチのデッキだけで数える（少なすぎるときは大会のデッキも入れる）
      const ranked = MD_USAGE.decks.filter(d => d[0] === 'r');
      const use = ranked.length >= 40 ? ranked : MD_USAGE.decks;
      src = ranked.length >= 40 ? 'ranked' : 'all';
      list = use.map(d => { const a = []; for (let i = 2; i + 1 < d.length; i += 2) if (table[d[i]]) a.push({ card: table[d[i]], n: d[i + 1] | 0 }); return a; });
      from = MD_USAGE.from;
    }
  }
  if (!list) {
    const data = await loadSamples(fmt);
    const periods = data && data.periods ? Object.keys(data.periods).filter(k => data.periods[k].length).sort() : [];
    if (!periods.length) return null;
    // 一番新しいリストの期間のデッキ（40個より少なければ1つ前の期間も足す）
    let decks = data.periods[periods[periods.length - 1]];
    from = periods[periods.length - 1];
    if (decks.length < 40 && periods.length > 1) { decks = [...data.periods[periods[periods.length - 2]], ...decks]; from = periods[periods.length - 2]; }
    list = decks.map(d => (d.m || []).map(([v, n, en]) => ({ card: sampleCard(v) || (en ? sampleCard(en) : null), n: n | 0 })).filter(x => x.card && x.n > 0));
  }
  const stat = new Map();
  for (const dl of list) for (const { card, n } of dl) {
    if (!isTrap(card)) continue;
    const s = stat.get(card.id) || { card, decks: 0, copies: 0 };
    s.decks++; s.copies += n; stat.set(card.id, s);
  }
  // 採用率が低くても出す（1つのデッキでも入っていれば）。誘発は20種類まで、0ターン展開と合わせて30まで（計算の都合）
  const traps = [...stat.values()].sort((a, b) => b.decks - a.decks).slice(0, 20)
    .map(s => ({ id: 'c' + s.card.id, cardId: s.card.id, name: s.card.name, rate: s.decks / list.length, avg: s.copies / s.decks }));
  const idx = new Map(traps.map((t, i) => [t.cardId, i]));
  // 0ターン展開（エルフェンノーツ・キラーチューンなど）：相手のターン（こちらの先攻1ターン目）に手札から動き出せるカード。
  // テーマごとに1つの「誘発」として数え、そのテーマのカードが相手の初手に1枚以上あれば、妨害が1回できるとみなす
  const zero = new Map();   // テーマ名 → { cards: Set, decks, copies }
  for (const dl of list) {
    const seen = new Map();
    for (const { card, n } of dl) {
      if (!opIsZeroTurn(card) || isTrap(card)) continue;
      const th = opThemeOf(card);
      seen.set(th, (seen.get(th) || 0) + n);
      const z = zero.get(th) || { cards: new Set(), decks: 0, copies: 0, allField: true };
      z.cards.add(card.id); if (!opIsZeroField(card)) z.allField = false; zero.set(th, z);
    }
    for (const [th, n] of seen) { const z = zero.get(th); z.decks++; z.copies += n; }
  }
  // 妨害になる効果が見つからないテーマは出さない（数えない）
  [...zero].filter(([th]) => opThemeStops(th)).sort((a, b) => b[1].decks - a[1].decks).slice(0, 30 - traps.length).forEach(([th, z]) => {
    const i = traps.length;
    traps.push({ id: 'z' + th, name: `${th}の0ターン展開`, zero: true, cardIds: [...z.cards], stopBy: opThemeStops(th), why: opZeroWhy(DB.byId.get([...z.cards][0])), cardNames: [...z.cards].map(id => DB.byId.get(id).name), rate: z.decks / list.length, avg: z.copies / z.decks });
    for (const id of z.cards) idx.set(id, i);
  });
  const both = list.map(dl => { const a = [], b = []; for (const { card, n } of dl) for (let k = 0; k < n; k++) { a.push(idx.has(card.id) ? idx.get(card.id) : -1); b.push(card.id); } return [a, b]; }).filter(([a]) => a.length >= 20);
  const oppDecks = both.map(x => x[0]), oppIds = both.map(x => x[1]);
  // ティアラメンツ：ルルカロスまで出せるかを、配った手札とデッキの上のカードで試す
  // 0ターン展開：配った手札で、どのカードから・どんな条件で動き出せるかを試す（ティアラメンツはルルカロスまで）
  traps.forEach(t => { if (t.zero) t.sim = /ティアラメンツ/.test(t.name) ? opTearSim() : opZeroSim(t.cardIds); });
  const res = { fmt, from, src, nDecks: oppDecks.length, traps, oppDecks, oppIds };
  res.partial = !textReady();   // 文が無いまま数えたものは、次に開いたときに数え直す
  if (res.partial) opStopCache.clear();
  opUsageCache[fmt] = res;
  return res;
}
// 相手のターンに手札から動き出せるカードか（効果の文から判断。手札誘発は別に数える）
// 1つの効果（①②③…）の中に、相手のターンに使える・手札にあるこのカードから・特殊召喚する、の3つがそろっているか
// （永続罠扱いで置かれているときだけ動けるカードや、手札から捨てて守るだけのカードは数えない）
const OP_ZERO_TIMING = /相手がフィールドのモンスターの効果を発動した時|相手メインフェイズ|相手ターン|自分・相手ターン|お互いのメインフェイズ|お互いのターン|相手の(メインフェイズ|ターン)|自分・相手のメインフェイズ/;
const OP_ZERO_HAND = /このカードを手札から|手札のこのカード|このカードが手札に存在する|このカードは手札から/;
// 自分の場にカードが必要な条件（0ターン目の相手の場には何も無いので満たせない）
const opNeedsOwnField = s => /自分フィールドの/.test(s) || /(^|[^手])(自分)?フィールドに[^。]{0,30}存在する場合/.test(s.replace(/相手フィールドに[^。]{0,30}存在する場合/g, ''));
function opIsZeroTurn(c) {
  if (!c || !(c.type & T.MONSTER) || (c.type & EXTRA_MASK)) return false;
  return opText(c).split(/[①②③④⑤⑥]/).some(s => OP_ZERO_TIMING.test(s) && OP_ZERO_HAND.test(s) && /特殊召喚/.test(s) && !opNeedsOwnField(s));
}
// そのテーマに、相手のターンに使える妨害（無効・破壊・除外・バウンスなど）があるか（効果の文から判断）。
// 無いテーマの0ターン展開は、最初から「数えない」にする
const OP_OPP_TIMING = /相手メインフェイズ|相手ターン|自分・相手ターン|お互いの(メインフェイズ|ターン)|相手[^。]{0,30}発動した(時|場合)|効果が発動した時|カードが発動した時|召喚・反転召喚・特殊召喚した(時|場合)/;
const OP_DISRUPT = /無効に|(相手|フィールド)[^。]{0,40}(破壊|除外|手札に戻|デッキに戻|裏側守備表示|コントロールを得)/;
const opStopCache = new Map();
function opThemeStops(th) {
  if (opStopCache.has(th)) return opStopCache.get(th);
  // kinds：neg＝発動・効果を無効にする／mon＝モンスターを除く（破壊・除外・バウンスなど）／st＝魔法・罠を除く／any＝カードの種類を問わず除く
  const kinds = new Set(), by = [];
  const cards = DB.cards.filter(c => c.jaText && !c.anime && (c.cid || c.pre) && ((typeof decThemesOf === 'function' ? decThemesOf(c) : []).includes(th) || c.name === th));
  // 0ターン目に場に出せる妨害だけ数える：
  //  ・相手ターンに手札から特殊召喚できるカード（0ターン展開のカード）自身の効果
  //  ・EXデッキのモンスターは、相手ターンにS・X・リンク・融合召喚できる効果がテーマにあるときだけ
  //  ・魔法・罠は、手札から発動できるものだけ（伏せる時間が無い）
  // 相手のターンにも使える効果：相手ターンと書いてあるもの、または「〜場合／〜時」の誘発（自分メインフェイズだけのものは除く）
  const anyTurn = s => !/自分メインフェイズ/.test(s) && (OP_OPP_TIMING.test(s) || /(場合|時)(に発動できる|に発動する|、)/.test(s));
  const segsOf = c => c.jaText.split(/[①②③④⑤⑥]/);
  const oppExtra = cards.some(c => segsOf(c).some(s => anyTurn(s) && /(シンクロ|エクシーズ|リンク|融合|Ｓ|Ｘ)召喚(する|を行う)/.test(s)));
  // 0ターン展開のカードや誘発で、手札・デッキ・墓地からモンスターを特殊召喚できれば、テーマのメインデッキのモンスターも出せる
  const oppMain = cards.some(c => !(c.type & EXTRA_MASK) && segsOf(c).some(s => anyTurn(s) && /(手札|デッキ|墓地)から[^。]{0,40}モンスター[^。]{0,20}特殊召喚/.test(s)));
  const reachable = c => {
    if (c.type & T.MONSTER) return c.type & EXTRA_MASK ? oppExtra : opIsZeroTurn(c) || oppMain;
    return /手札から発動できる/.test(c.jaText);
  };
  for (const c of cards) {
    if (!reachable(c)) continue;
    // 効果ごと（①②③…）に、相手のターンに使えて妨害になるものを探す
    for (const s of c.jaText.split(/[①②③④⑤⑥]/)) {
      if (!OP_OPP_TIMING.test(s) || !OP_DISRUPT.test(s)) continue;
      const before = kinds.size;
      if (/無効に/.test(s)) kinds.add('neg');
      const rm = s.match(/[^。]{0,40}(破壊|除外|手札に戻|デッキに戻|裏側守備表示|コントロールを得)/g) || [];
      for (const r of rm) {
        if (/魔法・罠/.test(r) && !/モンスター/.test(r)) kinds.add('st');
        else if (/モンスター|裏側守備表示|コントロール/.test(r)) kinds.add('mon');
        else if (/カード/.test(r)) kinds.add('any');
      }
      if (kinds.size > before && by.length < 3 && !by.includes(c.name)) by.push(c.name);
    }
  }
  const res = kinds.size ? { by, kinds: [...kinds] } : null;
  opStopCache.set(th, res);
  return res;
}
// その0ターン展開の妨害で、このカード（初動・展開札）が止まるか。
// 無効は何でも止まる。モンスターを除く妨害はモンスター、魔法・罠を除く妨害は永続・フィールド・装備などの残る魔法・罠だけ止まる
const OP_ZERO_V = 2;
function opZeroHits(stop, c) {
  if (!stop) return false;
  const k = new Set(stop.kinds);
  if (k.has('neg') || k.has('any')) return true;
  if (c.type & T.MONSTER) return k.has('mon');
  const stays = c.type & (T.CONTINUOUS | T.FIELD | T.EQUIP) || (c.type & T.TRAP && !(c.type & T.COUNTER));
  return k.has('st') && !!stays;
}
// カードのテーマ名（無ければカード名）
function opThemeOf(c) {
  const th = typeof decThemesOf === 'function' ? decThemesOf(c) : [];
  return th[0] || c.name;
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
  // 0ターン展開は、その妨害でこのカードが止まるときだけ
  const stop = traps.filter(t => (t.zero ? opZeroHits(t.stopBy, c) : OP_STOP_RE.test(t.name))).map(t => t.id);
  return {
    vuln: stop.length ? stop : traps.filter(t => !t.zero || opZeroHits(t.stopBy, c)).map(t => t.id),
    // 墓穴の指名者は、墓地へ行く誘発だけケアできる（泡影・ドロールなどは無理）
    // 0ターン展開は誘発ケアでは止められない扱い
    counters: traps.filter(t => !t.zero && !(c.name === '墓穴の指名者' && /泡影|γ/.test(t.name))).map(t => t.id),
  };
}
// デッキのカードの設定（初めてのカードは、名前などから役割を推測する）
function opCardSetting(st, id) {
  const s0 = st.cards[id];
  if (s0) {
    // 使用率の誘発の一覧で、まだ決めていなければ推測で入れる
    if (opUsing(st) && !s0.vulnU) { const d = opDefaultVuln(st, DB.byId.get(id) || {}); s0.vulnU = d.vuln; s0.countersU = d.counters; s0.seenU = opTraps(st).map(t => t.id); s0.zeroV = OP_ZERO_V; }
    else if (opUsing(st)) {
      // あとから増えた誘発（0ターン展開など）は、推測した値を足す
      const seen = new Set(s0.seenU || opTraps(st).filter(t => !t.zero).map(t => t.id));
      const fresh = opTraps(st).filter(t => !seen.has(t.id));
      if (fresh.length) {
        const d = opDefaultVuln(st, DB.byId.get(id) || {});
        for (const t of fresh) { if (d.vuln.includes(t.id)) s0.vulnU = [...(s0.vulnU || []), t.id]; if (d.counters.includes(t.id)) s0.countersU = [...(s0.countersU || []), t.id]; }
        s0.seenU = [...seen, ...fresh.map(t => t.id)];
      }
      // 0ターン展開の「止まる」を、妨害の種類とカードの種類から決め直す（判断のしかたを変えたとき）
      if (s0.zeroV !== OP_ZERO_V) {
        const c = DB.byId.get(id) || {}, zs = opTraps(st).filter(t => t.zero), zid = new Set(zs.map(t => t.id));
        s0.vulnU = (s0.vulnU || []).filter(x => !zid.has(x)).concat(zs.filter(t => opZeroHits(t.stopBy, c)).map(t => t.id));
        s0.zeroV = OP_ZERO_V;
      }
    }
    return s0;
  }
  const c = DB.byId.get(id) || {};
  const ht = (typeof isHandTrap === 'function' && isHandTrap(id)) || /^マルチャミー/.test(c.name || '');
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
  if (opUsing(st)) { const d = opDefaultVuln(st, c); s.vulnU = d.vuln; s.countersU = d.counters; s.seenU = opTraps(st).map(t => t.id); s.zeroV = OP_ZERO_V; }
  return s;
}
// ---------- 初動の自動判別 ----------
// そのカード1枚だけを手札にした対戦を作り、発動・通常召喚・特殊召喚を3手先まで試す。
// デッキのカードが手札・フィールド・墓地へ動いたら（サーチ・デッキからの特殊召喚・墓地へ送るなど）初動とみなす。
// 通常召喚を使わずに動ければ召喚権なし、通常召喚が必要なら召喚権ありにする
const OP_JUDGE_V = 3;   // 判別のしかたを変えたら上げる（前の結果を使わない）
const OP_COST_FILLER = 4206964;   // 落とし穴（自分のメインフェイズには使えず、素材にもならない。手札コスト用の1枚）
const OP_DEPTH = 3, OP_BRANCH = 6, OP_NODES = 60;
// 試している間の選択の答え：自分の効果はできるだけ使う
function opProbeAnswer(m, me) {
  switch (m.type) {
    case MSG.SELECT_CHAIN: {
      if (m.forced) return { type: RES.SELECT_CHAIN, index: 0 };
      const i = (m.selects || []).findIndex(c => c.controller === me);
      return { type: RES.SELECT_CHAIN, index: i >= 0 ? i : null };
    }
    case MSG.SELECT_CARD: { const k = Math.min(Math.max(m.min, 1), m.max || 1, m.selects.length); return { type: RES.SELECT_CARD, indicies: [...Array(k).keys()] }; }
    default: return probeAnswer(m, me);
  }
}
// 選択に答えながら、自分のメインフェイズの行動選択まで進める。
// branch のときは、デッキのカードを1枚選ぶ選択（何を除外する・何を墓地へ送るなど）で止めて、選べるカードごとの答えを返す
function opAdvance(t, branch) {
  let alt = null, k = 0;
  for (let guard = 0; guard < 80 && t.pending && t.pending.type !== MSG.SELECT_IDLECMD && !t.ended; guard++) {
    const p = t.pending;
    if (branch && !t.retry && p.type === MSG.SELECT_CARD && p.min === 1 && p.max === 1 && p.player === t.me) {
      const seen = new Set(), ch = [];
      p.selects.forEach((c, i) => { if (c.location === LOC.DECK && !seen.has(c.code)) { seen.add(c.code); ch.push({ type: RES.SELECT_CARD, indicies: [i] }); } });
      if (ch.length > 1) return { branch: ch.slice(0, 8) };
    }
    let res;
    if (t.retry) { if (!alt) alt = altAnswers(p); res = alt[k++]; if (!res) return null; }
    else { alt = null; k = 0; res = opProbeAnswer(p, t.me); }
    t.respond(res, false);
  }
  return t.pending && t.pending.type === MSG.SELECT_IDLECMD ? { ok: true } : null;
}

// デッキから動いたカードの数（ドローは数えない）。
// デッキから除外したカードは、そのあと効果を発動した・特殊召喚されたときだけ数える（封印の黄金櫃で「除外された場合」の効果を使うデッキなど）
function opGain(t) {
  let n = 0;
  t.events.forEach((e, i) => {
    if (e.t !== 'move' || e.from.loc !== LOC.DECK || e.from.con !== t.me) return;
    if (e.to.loc & (LOC.HAND | LOC.MZONE | LOC.SZONE | LOC.GRAVE)) { n++; return; }
    if (e.to.loc & LOC.REMOVED && t.events.slice(i + 1).some(x => x.code === e.code && (x.t === 'chain' || x.t === 'summon' || (x.t === 'move' && x.from.loc === LOC.REMOVED)))) n++;
  });
  return n;
}
async function opJudgeHand(base, hand, maxNodes = OP_NODES, maxDepth = OP_DEPTH) {
  const best = { free: 0, ns: 0, nsCode: 0 };
  let nodes = 0;
  const mk = () => new AutoDuel({ main: base.main, extra: base.extra, handIds: hand, handSize: 5, seed: [1n, 2n, 3n, 4n], opp: null, chainMode: 'off', autoTrigger: true, tools: false, rule: base.rule, speed: '', errata: base.errata, sv: 2 });
  const actionsOf = p => {
    const out = [], seen = new Set();
    const add = (list, action) => (list || []).forEach((c, i) => { const key = action + ':' + c.code + ':' + (c.description || ''); if (!seen.has(key)) { seen.add(key); out.push({ type: RES.SELECT_IDLECMD, action, index: i }); } });
    add(p.activates, IDLE.ACTIVATE); add(p.special_summons, IDLE.SPSUMMON); add(p.summons, IDLE.SUMMON);
    return out.slice(0, OP_BRANCH);
  };
  // hist まで流し直し、行動 act をして、選択に答えて次の行動選択まで進める（act が無ければ最初の状態）
  // branched：この手順で、もうデッキのカードの選び分けを試した（選び分けは1つの手順で1回だけ）
  // nsCode：この手順で通常召喚したカード
  const visit = async (hist, act, depth, usedNS, branched, nsCode) => {
    if (nodes >= maxNodes || best.free > 0) return;
    nodes++;
    if (nodes % 3 === 0) await new Promise(r => setTimeout(r, 0));   // 画面が固まらないように
    const t = mk();
    let next = null;
    try {
      t.create();
      t.run(hist.slice());
      if (act) { if (!t.pending) return; t.respond(act, false); }
      const r = opAdvance(t, !branched);
      if (!r) return;
      if (r.branch) next = { hist: t.history(), choices: r.branch };
      else {
        const g = opGain(t);
        if (usedNS) { if (g > best.ns) { best.ns = g; best.nsCode = nsCode; } } else best.free = Math.max(best.free, g);
        if (depth < maxDepth) next = { hist: t.history(), acts: actionsOf(t.pending), p: t.pending };
      }
    } catch (e) { return; } finally { if (t.h) Engine.lib.destroyDuel(t.h); }
    if (!next) return;
    if (next.choices) for (const c of next.choices) await visit(next.hist, c, depth, usedNS, true, nsCode);
    else for (const a of next.acts) { const ns = a.action === IDLE.SUMMON; await visit(next.hist, a, depth + 1, usedNS || ns, branched, ns ? next.p.summons[a.index].code : nsCode); }
  };
  await visit([], null, 0, false, false, 0);
  const ns = best.free === 0 && best.ns > 0;
  return { v: OP_JUDGE_V, starter: best.free > 0 || best.ns > 0, ns, nsCode: ns ? best.nsCode : 0, gain: Math.max(best.free, best.ns) };
}
// まだ判別していないカードを判別して、役割（初動／その他）と召喚権を入れる。自分で役割を変えたカードはそのまま
async function opAutoJudge(deck, st, onProgress) {
  st.auto = st.auto || {};
  const todo = opDeckCards(deck).filter(x => !(st.auto[x.id] && st.auto[x.id].v === OP_JUDGE_V));
  if (!todo.length) return false;
  const errata = errataOfDecks(errataMode(), deck);
  await engineLoad(() => {});
  await loadCardScripts([...deck.main, ...(deck.extra || []), OPP_FILLER, OP_COST_FILLER], () => {}, errata, true);
  const base = { main: [...deck.main.filter(id => DB.byId.has(id)), OP_COST_FILLER], extra: (deck.extra || []).filter(id => DB.byId.has(id)), rule: masterRule(), errata };
  let i = 0;
  for (const { id } of todo) {
    onProgress && onProgress(++i, todo.length, (DB.byId.get(id) || {}).name);
    const s = opCardSetting(st, id);
    // 手札誘発・誘発ケアは試さない（相手の行動が無いと使えない）
    const r = s.role === 'handtrap' || s.role === 'care' ? { v: OP_JUDGE_V, starter: false, ns: false, gain: 0, skip: true } : await opJudgeHand(base, [id]);
    // 1枚では動けないときは、何でもない1枚（落とし穴）を手札に足して試す（「手札を1枚捨てて特殊召喚」などの手札コスト）
    if (!r.skip && !r.starter) { const r2 = await opJudgeHand(base, [id, OP_COST_FILLER]); if (r2.starter) { Object.assign(r, r2); r.cost = 1; } }
    st.auto[id] = r;
    if (!s.manual && !r.skip) {
      s.role = r.starter ? 'starter' : s.role === 'starter' ? 'other' : s.role;
      if (r.starter) { s.ns = r.ns; s.cost = r.cost || 0; }
    }
  }
  return true;
}
// 2枚そろうと動けるカード（1枚では初動にならないカード同士）を試して、組み合わせ初動に入れる。
// 例：ヤミーの「リンク1＋レベル1の非チューナー」のように、手札の2枚から EXデッキを使って展開が始まるもの
const OP_PAIR_V = 3, OP_PAIR_CARDS = 18, OP_PAIR_NODES = 40, OP_PAIR_MAX = 60;
async function opAutoPairs(deck, st, onProgress) {
  const sig = deck.main.slice().sort().join(',') + '|' + (deck.extra || []).slice().sort().join(',');
  if (st.autoPairs && st.autoPairs.v === OP_PAIR_V && st.autoPairs.sig === sig) return false;
  const errata = errataOfDecks(errataMode(), deck);
  await engineLoad(() => {});
  await loadCardScripts([...deck.main, ...(deck.extra || []), OPP_FILLER, OP_COST_FILLER], () => {}, errata, true);
  const base = { main: [...deck.main.filter(id => DB.byId.has(id)), OP_COST_FILLER], extra: (deck.extra || []).filter(id => DB.byId.has(id)), rule: masterRule(), errata };
  // 試すカード：初動・手札誘発・誘発ケアではないもの（枚数の多い順）
  const cand = opDeckCards(deck).filter(x => { const s = opCardSetting(st, x.id); return s.role !== 'starter' && s.role !== 'handtrap' && s.role !== 'care'; })
    .sort((a, b) => b.n - a.n).slice(0, OP_PAIR_CARDS);
  const pairs = [];
  cand.forEach((a, i) => cand.forEach((b, j) => { if (j > i || (j === i && a.n >= 2)) pairs.push([a, b]); }));
  // 通常召喚できる手札誘発（うららなど）＋ほかのカード：誘発を通常召喚してリンク1（アルミラージなど）にして展開する形。
  // 相手のカードは、1枚では初動にならないもの、または召喚権が必要な初動（誘発で召喚権を使えば、そのカードは召喚権なしで動けることがある）
  const nsTrap = x => { const c = x.card; return opCardSetting(st, x.id).role === 'handtrap' && (c.type & T.MONSTER) && (c.level || 0) <= 4 && !(c.type & (T.SPSUMMON | T.LINK)); };
  const partners = opDeckCards(deck).filter(x => { const s = opCardSetting(st, x.id); const a = st.auto && st.auto[x.id]; return s.role !== 'handtrap' && s.role !== 'care' && !(s.role === 'starter' && a && a.starter && !a.ns); });
  for (const h of opDeckCards(deck).filter(nsTrap)) for (const b of partners) pairs.push([h, b]);
  const found = [];
  let k = 0;
  for (const [a, b] of pairs) {
    onProgress && onProgress(++k, pairs.length, `${a.card.name}＋${b.card.name}`);
    if (found.length >= OP_PAIR_MAX) break;
    const r = await opJudgeHand(base, [a.id, b.id], OP_PAIR_NODES, OP_DEPTH + 1);
    // 1枚でも初動のカードとの組み合わせは、1枚のときより多く展開できるときだけ入れる
    const single = Math.max(...[a, b].map(x => (st.auto && st.auto[x.id] && st.auto[x.id].starter ? st.auto[x.id].gain : 0)));
    if (r.starter && r.gain > single) found.push({ a, b, r });
  }
  // 前に自動で入れた組み合わせは入れ直す（自分で書いたものはそのまま）
  st.combos = st.combos.filter(c => !c.auto);
  for (const { a, b, r } of found) {
    st.combos.push({ id: opUid('k'), text: `${a.card.name} + ${b.card.name}`, priority: 30, auto: true, ns: r.ns ? 1 : 0 });
    // 組み合わせで使うカードは「展開札」にする（受けると止まる誘発を選べるように）
    for (const x of [a, b]) { const s = opCardSetting(st, x.id); if (!s.manual && s.role === 'other') s.role = 'extender'; }
  }
  st.autoPairs = { v: OP_PAIR_V, sig, n: found.length };
  return true;
}

function opDeckCards(deck) {
  const count = new Map();
  for (const id of deck.main) count.set(id, (count.get(id) || 0) + 1);
  return [...count].map(([id, n]) => ({ id, n, card: DB.byId.get(id) })).filter(x => x.card);
}

// 計算用のデータを作る
function opBuildModel(deck, st) {
  const usage = opUsing(st);
  // 使用率：「数えない」にした誘発は外す（相手のデッキでは何でもないカードとして扱う）
  const ignore = usage ? opIgnored(st) : new Set();
  const all = opTraps(st), traps = all.filter(t => !ignore.has(t.id));
  const remap = all.map(t => traps.indexOf(t));
  const oppDecksU = usage ? (ignore.size ? usage.oppDecks.map(d => d.map(x => (x >= 0 ? remap[x] : -1))) : usage.oppDecks) : null;
  const trapIndex = new Map(traps.map((t, i) => [t.id, i]));
  const maskOf = ids => (ids || []).reduce((m, id) => (trapIndex.has(id) ? m | (1 << trapIndex.get(id)) : m), 0);
  const cards = opDeckCards(deck).map(({ id, n, card }) => {
    const s = opCardSetting(st, id);
    return {
      id, name: card.name, count: n, role: s.role, ns: s.ns ? 1 : 0,
      vuln: s.role === 'starter' || s.role === 'extender' ? maskOf(s[opF(st, "vuln")]) : 0,
      counter: s.role === 'care' ? maskOf(s[opF(st, "counters")]) : 0,
      tags: String(s.tags || '').split(/[,、，\s]+/).map(opNorm).filter(Boolean),
      priority: Number(s.priority) || 0, cost: s.role === 'starter' ? s.cost | 0 : 0, field: s.noField ? 0 : 1, hand: s.noHand ? 0 : 1,
    };
  });
  const nameIdx = new Map();
  cards.forEach((c, i) => nameIdx.set(opNorm(c.name), i));
  // タグ → カード（召喚権を使わないもの・初動ではないものから先に使う）
  const tagCards = {};
  cards.forEach((c, i) => c.tags.forEach(t => (tagCards[t] = tagCards[t] || []).push(i)));
  for (const t in tagCards) tagCards[t].sort((a, b) => (cards[a].ns - cards[b].ns) || ((cards[a].role === 'starter') - (cards[b].role === 'starter')));
  const routes = [];
  cards.forEach((c, i) => { if (c.role === 'starter') routes.push({ named: [i], tags: [], priority: c.priority, single: true, cost: c.cost }); });
  // 手札コストで捨てるカードの順番：事故札 → その他 → 展開札 → 手札誘発 → 誘発ケア → 初動（初動はできるだけ残す）
  const costRank = { brick: 0, other: 1, extender: 2, handtrap: 3, care: 4, starter: 5 };
  const costOrder = cards.map((c, i) => i).sort((a, b) => costRank[cards[a].role] - costRank[cards[b].role]);
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
    if (named.length + tags.length) routes.push({ named, tags, priority: Number(cb.priority) || 0, single: false, fixedNs: cb.auto && cb.ns != null ? cb.ns : null });
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
  return { cards, routes, costOrder, deck: deckArr, careIdx, handtrapIdx, tagCards, comboErrors, traps, T: traps.length, oppDeck, oppDecks: oppDecksU, oppIds: usage ? usage.oppIds : null, staticField: traps.reduce((b, t, i) => (t.fieldOnly ? b | (1 << i) : b), 0), zeroSim: traps.map((t, i) => (t.sim ? [i, t.sim] : null)).filter(Boolean), zeroIdx: traps.map((t, i) => (t.zero ? i : -1)).filter(i => i >= 0), oppHand: usage ? st.opp.handSize | 0 : Math.min(st.opp.handSize | 0, oppDeck.length) };
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
  const autoMsg = el('div', { class: 'op-auto-msg muted small-note' });
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
    countBox.replaceChildren(
      el('div', { text: `メインデッキ ${deck.main.length}枚 ｜ 初動 ${by('starter')}・展開札 ${by('extender')}・手札誘発 ${by('handtrap')}・誘発ケア ${by('care')}・事故札 ${by('brick')}` }),
      starterSummary());
  }
  // 初動に割り振られたカードの一覧（1枚で初動・2枚の組み合わせ初動）
  function starterSummary() {
    const list = opDeckCards(deck).filter(x => opCardSetting(st, x.id).role === 'starter');
    const total = list.reduce((s, x) => s + x.n, 0);
    const combos = st.combos.filter(c => String(c.text || '').trim());
    return el('div', { class: 'op-starters' },
      el('div', {}, el('b', { text: `初動のカード ${list.length}種類・${total}枚` }), el('span', { class: 'muted', text: `（デッキの${deck.main.length ? Math.round(total / deck.main.length * 100) : 0}%）` })),
      list.length ? el('div', { class: 'op-chips' }, list.map(x => {
        const s = opCardSetting(st, x.id);
        return el('span', { class: 'op-starter-chip', title: s.ns ? '通常召喚権を使う' : '通常召喚権を使わない' }, `${x.card.name} ×${x.n}`, s.ns ? el('span', { class: 'op-ns-mark', text: '召' }) : null, s.cost ? el('span', { class: 'op-ns-mark cost', text: '手札+1', title: 'ほかに手札が1枚いる' }) : null);
      })) : el('div', { class: 'muted', text: '（まだありません。下の一覧で「初動」にしてください）' }),
      combos.length ? el('details', { class: 'op-combo-sum' }, el('summary', { text: `組み合わせ初動 ${combos.length}通り` }),
        el('ul', {}, combos.map(c => el('li', { text: c.text + (c.auto && c.ns ? '（召喚権を使う）' : '') })))) : null);
  }
  function renderCards() {
    const order = { starter: 0, extender: 1, care: 2, handtrap: 3, brick: 4, other: 5 };
    const list = opDeckCards(deck).sort((a, b) => order[opCardSetting(st, a.id).role] - order[opCardSetting(st, b.id).role]);
    names.replaceChildren(...list.map(x => el('option', { value: x.card.name })));
    cardsBox.replaceChildren(...list.map(({ id, n, card }) => {
      const s = opCardSetting(st, id);
      const role = el('select', {}, OP_ROLES.map(([v, l]) => el('option', { value: v, text: l, selected: s.role === v })));
      role.onchange = () => { s.role = role.value; s.manual = true; save(); renderCards(); renderCount(); };
      const uses = s.role === 'starter' || s.role === 'extender';
      const ns = el('input', { type: 'checkbox', checked: !!s.ns });
      ns.onchange = () => { s.ns = ns.checked; s.manual = true; save(); };
      const prio = el('input', { type: 'number', class: 'op-prio', value: s.priority });
      prio.oninput = () => { s.priority = Number(prio.value) || 0; save(); };
      const tags = el('input', { type: 'text', class: 'op-tags', value: s.tags || '', placeholder: 'タグ（例：素材）' });
      tags.onchange = () => { s.tags = tags.value; save(); renderCombos(); };
      return el('div', { class: 'op-card role-' + s.role },
        el('div', { class: 'op-card-head' },
          el('b', { class: 'op-name', text: card.name, title: card.name }), el('span', { class: 'muted', text: `×${n}` }), opBadge(st, id, s), role,
          uses ? el('label', { class: 'op-ns', title: 'このカードを使うと通常召喚権を使う' }, ns, '召喚権を使う') : null,
          uses ? (() => { const cb = el('input', { type: 'checkbox', checked: !s.noField }); cb.onchange = () => { s.noField = !cb.checked; save(); }; return el('label', { class: 'op-ns', title: 'このカードの展開で、場のモンスター効果を発動するか。チェーン隠しなどで、場のモンスター効果に合わせて動かれない（ハゥフニス・クラック・ブリッツクリークなど）なら外す' }, cb, '場でモンスター効果を使う'); })() : null,
          uses ? (() => { const cb = el('input', { type: 'checkbox', checked: !s.noHand }); cb.onchange = () => { s.noHand = !cb.checked; save(); }; return el('label', { class: 'op-ns', title: 'このカードの展開で、手札・墓地のモンスター効果を発動するか（K9－17号 イヅナなど「相手が手札・墓地のモンスター効果を発動した」ときに動くカードに関係する）' }, cb, '手札・墓地でモンスター効果を使う'); })() : null,
          s.role === 'starter' ? el('label', { class: 'op-ns', title: '小さいほど先に使う' }, '優先度', prio) : null,
          s.role === 'starter' ? (() => { const cb = el('input', { type: 'checkbox', checked: !!s.cost }); cb.onchange = () => { s.cost = cb.checked ? 1 : 0; s.manual = true; save(); renderCount(); }; return el('label', { class: 'op-ns', title: '「手札を1枚捨てて特殊召喚」など、ほかに手札が1枚いる（初動ではないカードから先に使う）' }, cb, '手札を1枚使う'); })() : null,
          tags),
        uses ? el('div', { class: 'op-sub' }, el('span', { class: 'muted', text: '受けると止まる誘発：' }), trapChips(s, 'vuln')) : null,
        s.role === 'care' ? el('div', { class: 'op-sub' }, el('span', { class: 'muted', text: 'ケアできる誘発：' }), trapChips(s, 'counters')) : null);
    }));
  }
  function renderCombos() {
    renderCount();   // 初動の一覧の「組み合わせ初動」も更新する
    const model = opBuildModel(deck, st);
    combosBox.replaceChildren(...st.combos.map(cb => {
      const text = el('input', { type: 'text', class: 'op-combo-text', value: cb.text, placeholder: 'カードA + カードB（#タグ も使えます）', list: 'op-names' });
      text.oninput = () => { cb.text = text.value; cb.auto = false; save(); };
      text.onchange = renderCombos;
      const prio = el('input', { type: 'number', class: 'op-prio', value: cb.priority });
      prio.oninput = () => { cb.priority = Number(prio.value) || 0; save(); };
      const errs = model.comboErrors[cb.id];
      return el('div', { class: 'op-combo' }, text, cb.auto ? el('span', { class: 'op-badge', text: '自動', title: '自動で見つけた組み合わせ（この2枚だけの手札から展開できました）' }) : null, el('label', { class: 'op-ns' }, '優先度', prio),
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
          // 効果の文がまだ付いていなかったときは、付いてから数え直す（0ターン展開の見分けに使う）
          if (r.partial) (async () => {
            for (let i = 0; i < 300 && !opTextReady(); i++) await new Promise(res => setTimeout(res, 500));
            if (st.opp.src !== src || st.opp.mode !== 'usage') return;
            opStopCache.clear(); await opLoadUsage(src); renderOpp(); renderCards();
          })();
        }).catch(e => oppBox.append(el('p', { class: 'warn', text: '読み込めませんでした：' + e.message })));
        return;
      }
      const num = el('input', { type: 'number', class: 'op-prio', value: H, min: 0, max: 10 });
      num.onchange = () => { st.opp.handSize = Math.max(0, parseInt(num.value, 10) || 0); save(); renderOpp(); };
      oppBox.replaceChildren(modeBar,
        el('p', { class: 'muted small-note', text: `${u.src === 'ranked' ? 'Master Duel Meta に載ったランクマッチ（マスター）のデッキ全部' : u.src === 'all' ? 'Master Duel Meta に載った大会・ランクマッチのデッキ全部' : OP_SRC_NOTE[u.fmt]} ${u.nDecks}個（${u.from} からのリスト）で数えた採用率です。計算では毎回このデッキの中から1つを相手に選び、そこから初手を配ります（その誘発を入れていないデッキや、入れていても引かない場合も確率に入ります）。` }),
        el('div', { class: 'op-row' },
          el('label', {}, '相手の手札 ', num, ' 枚'),
          el('span', { class: 'muted', text: `相手の初手に下の誘発・0ターン展開が1枚以上ある確率 ${pct(opUsageOpen(u, H, -1))}` })),
        el('p', { class: 'muted small-note', text: '「0ターン展開」は、相手が後攻のときに、こちらの先攻1ターン目に手札から展開して妨害してくること（エルフェンノーツ・キラーチューンなど。動き出せるカードは効果の文から見分けています）。こちらが先攻の計算だけに入り、後攻の計算には入りません。相手のターンに使える妨害（無効・破壊・除外など）があるテーマだけ出しています。そのテーマのカードが相手の初手に1枚以上あれば、妨害が1回あるとみなします。チェックを外した行は数えません。' }),
        el('table', { class: 'op-trap-table' },
          el('tr', {}, el('th', { text: '数える' }), el('th', { text: '誘発' }), el('th', { text: '採用率' }), el('th', { text: '採用時の枚数' }), el('th', { text: '相手の初手にある' })),
          u.traps.map((t, i) => {
            const cb = el('input', { type: 'checkbox', checked: !opIgnored(st).has(t.id) });
            cb.onchange = () => {
              const ig = new Set(st.opp.ignore || []), keep = new Set(st.opp.keep || []);
              if (cb.checked) { ig.delete(t.id); keep.add(t.id); } else { ig.add(t.id); keep.delete(t.id); }
              st.opp.ignore = [...ig]; st.opp.keep = [...keep]; save();
            };
            return el('tr', { class: t.zero ? 'op-zero' : null },
              el('td', {}, cb),
              el('td', { title: t.zero ? '数えるカード：' + t.cardNames.join('、') : null }, t.name, t.zero ? el('div', { class: 'muted small-note', text: (t.cardIds ? t.cardIds.map(id => opZeroCondLabel(id)).join('、') : t.cardNames.join('、')) + (t.stopBy ? `（妨害：${t.stopBy.by.join('、')}など。止められるもの：${opStopKinds(t.stopBy)}）` : '') }) : null, t.zero && t.why ? el('div', { class: 'muted small-note op-why', text: '動き出し：' + t.why }) : null),
              el('td', { text: pct(t.rate) }), el('td', { text: t.avg.toFixed(1) + '枚' }), el('td', {}, pct(opUsageOpen(u, H, i)), t.sim ? el('div', { class: 'muted small-note', text: `ルルカロスまで出せる：${pct(opSimRate(u, t, H), opSimRate(u, t, H) < 0.01 ? 2 : 1)}` }) : null));
          })));
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
        // 貫通率：初動がある手札の中で、相手が止める誘発を必ず撃ってきても展開を続けられる率
        el('div', { class: 'op-pierce' },
          el('div', { class: 'op-pierce-head' }, el('b', { text: '貫通率' }), el('span', { class: 'muted', text: '（初動を止められても、ほかの初動で展開を続けられる率）' })),
          ...[[1, r.pierce1], [2, r.pierce2]].map(([k, v]) => bar(`誘発${k}枚を受けても`, r.nsok ? v / r.nsok : 0, 'f4')),
          el('div', { class: 'muted small-note', text: `初動がある手札の中での率です（相手は止められる初動に必ず撃つ。誘発ケアで無効にできるときは使う）。全部の手札の中では 誘発1枚 ${pct(r.pierce1 / n)}・2枚 ${pct(r.pierce2 / n)}。` })),
        el('ul', { class: 'op-loss' },
          el('li', {}, '事故（初動なし）：', el('b', { text: pct(1 - raw) })),
          el('li', {}, '召喚権が足りない組み合わせしかない：', el('b', { text: pct(raw - nsok) })),
          el('li', {}, '相手の誘発で止まる：', el('b', { text: pct(nsok - real) }), el('span', { class: 'muted', text: `（うち召喚権のかぶりが原因：約${pct(Math.max(0, inf - real))}）` })),
          el('li', {}, '初動＋自分の手札誘発1枚以上：', el('b', { text: pct(r.withHT / n) }))),
        el('div', { class: 'muted small-note', text: `参考：1枚初動のカードだけの理論値 ${pct(exact)}` }),
        R.model.traps.length ? el('table', { class: 'op-trap-table' },
          el('tr', {}, el('th', { text: '相手が1枚だけ持っていた誘発' }), el('th', { text: '展開できる率' })),
          R.model.traps.map((t, i) => el('tr', {}, el('td', { text: t.name }), el('td', { text: r === R.second && t.zero ? '—（後攻では無い）' : pct(r.perTrap[i] / n) })))) : null);
    };
    resBox.replaceChildren(starterSummary(), el('div', { class: 'op-res-grid' }, col('先攻（手札5枚）', R.first, R.exact5), col('後攻（手札6枚）', R.second, R.exact6)));
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
      const R = { model, first: OpSim.simulate(model, 5, n), second: OpSim.simulate(model, 6, n, true), exact5: OpSim.exactSingle(model, 5), exact6: OpSim.exactSingle(model, 6) };
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
    autoMsg, countBox, cardsBox,
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
        el('li', { text: '実質初動率：相手にもデッキから手札を配り、止められずに展開できた割合（「環境の使用率から」では、毎回ランクマッチなどのデッキを1つ選んで相手のデッキにします）。初動を優先度の順に使い、相手は止められる誘発があれば撃ち（ケアされないものから）、自分はケア札があれば無効にします。止められた初動のカードと召喚権は失い、残りで次の初動を試します。' }),
        el('li', { text: '貫通率：初動がある手札で、相手が「止める誘発」を1枚（2枚）持っていて、止められる初動には必ず撃ってくるとしたときに、展開を続けられる割合。止められた初動のカードと召喚権は失い、残りの初動で動きます。誘発ケアは、その初動を止める誘発のどれかをケアできるカードなら使います。' }),
        el('li', { text: '分かりやすさ優先の近似です。止まった初動から一部のリソースが残る場合や、召喚権を増やすカード、増殖するGを受けて展開をやめる判断などは考えていません。' }))));
  renderCount(); renderCards(); renderCombos(); renderOpp();
  // 初動の自動判別（まだ判別していないカードだけ。終わったら役割を入れ直す）
  const judge = async (redo) => {
    if (redo) { st.auto = {}; st.autoPairs = null; for (const s of Object.values(st.cards)) delete s.manual; }
    autoMsg.textContent = '初動を自動で判別しています…';
    try {
      const changed = await opAutoJudge(deck, st, (i, n, name) => { autoMsg.textContent = `初動を自動で判別しています… ${i}/${n}（${name}）`; });
      if (changed) { save(); renderCards(); renderCount(); }
      // 2枚の組み合わせ（1枚では初動にならないカード同士）
      const changed2 = await opAutoPairs(deck, st, (i, n, name) => { autoMsg.textContent = `2枚の組み合わせ初動を探しています… ${i}/${n}（${name}）`; });
      if (changed2) { save(); renderCards(); renderCount(); renderCombos(); }
      const list = opDeckCards(deck), auto = st.auto || {};
      autoMsg.replaceChildren(`自動で判別しました：初動 ${list.filter(x => auto[x.id] && auto[x.id].starter).length}種類・2枚の組み合わせ初動 ${(st.autoPairs && st.autoPairs.n) || 0}通り（その手札だけから、デッキのカードを手札・フィールド・墓地へ動かせるもの）。組み合わせ初動も実質初動率に入ります。違っていたら直してください。`,
        el('button', { class: 'btn small', text: '判別をやり直す（手で変えた役割も戻す）', onclick: () => judge(true) }));
    } catch (e) { console.error(e); autoMsg.textContent = '初動を自動で判別できませんでした：' + e.message; }
  };
  judge(false);
  showModal({ title: `📊 初動率：${deck.name}`, body: root, wide: true, onClose: () => { clearTimeout(saveTimer); store.set(opKey(deck.id), st); } });
}

// カードの横の小さな印（自動で初動と判別した／自分で変えた）
function opBadge(st, id, s) {
  const a = st.auto && st.auto[id];
  if (s.manual) return el('span', { class: 'op-badge manual', text: '手動', title: '自分で役割・召喚権を変えたカード（自動の判別では変えません）' });
  if (a && a.starter) return el('span', { class: 'op-badge', text: `自動：初動${a.ns ? '（召喚）' : ''}`, title: `このカード1枚から、デッキのカードを${a.gain}枚以上動かせました${a.ns ? '（通常召喚が必要）' : ''}` });
  return null;
}

// 数えない誘発：自分で外したもの＋妨害の効果が見つからない0ターン展開（自分でチェックを入れ直したものは数える）
function opIgnored(st) {
  const u = opUsageCache[st.opp.src];
  const ig = new Set(st.opp.ignore || []), keep = new Set(st.opp.keep || []);
  if (u) for (const t of u.traps) if (t.zero && !t.stopBy && !keep.has(t.id)) ig.add(t.id);
  return ig;
}
// 妨害の種類の説明
function opStopKinds(stop) {
  const k = new Set(stop.kinds);
  if (k.has('neg') || k.has('any')) return 'すべての初動';
  return [k.has('mon') ? 'モンスターの初動' : null, k.has('st') ? '永続・フィールドなどの残る魔法・罠' : null].filter(Boolean).join('・');
}
// 0ターン展開の動き出し（判断に使った効果の文）
function opZeroWhy(c) {
  const segs = opText(c).split(/(?=[①②③④⑤⑥])/);
  const s = segs.find(x => OP_ZERO_TIMING.test(x) && OP_ZERO_HAND.test(x) && /特殊召喚/.test(x) && !opNeedsOwnField(x));
  return s ? `${c.name} ${s.replace(/\s+/g, '').slice(0, 90)}` : '';
}
// カードの日本語の文（カードのデータを読み直したあとでも、今のデータの文を使う）
function opText(c) { return String(((DB.byId.get(c.id) || {}).jaText) || c.jaText || ''); }
// 公式カードの日本語の文が付いているか（アニメのカードは最初から文があるので数えない）
function opTextReady() { let n = 0; for (const c of DB.cards) if (c.cid && c.jaText && ++n > 8000) return true; return false; }

// ティアラメンツの0ターン展開がルルカロスまで届くか。
// ①クシャトリラを相手メインフェイズに手札から特殊召喚（コストで、手札のほかの「クシャトリラ」「ティアラメンツ」カードを1枚除外。0ターン目は墓地が空）
// ②デッキの上から3枚を墓地へ → その中に融合できるティアラメンツ（メイルゥ・ハゥフニス・シェイレーン）があれば、クシャトリラと融合してキトカロス
// ③キトカロスの効果でデッキから名前の違う融合できるティアラメンツを墓地へ → キトカロスと融合してルルカロス
// 返り値：0＝届かない／1＝届く（クシャトリラから。こちらの動きに関係なく）／2＝こちらが場でモンスター効果を使ったときだけ届く（ハゥフニスから）
function opTearSim() {
  const themeOf = c => (typeof decThemesOf === 'function' ? decThemesOf(c) : []);
  const byName = n => new Set(DB.cards.filter(c => c.name === n).map(c => c.id));
  const kash = byName('ティアラメンツ・クシャトリラ'), havn = byName('ティアラメンツ・ハゥフニス');
  const cost = new Set(DB.cards.filter(c => themeOf(c).some(t => /ティアラメンツ|クシャトリラ/.test(t)) || /ティアラメンツ|クシャトリラ/.test(c.name)).map(c => c.id));
  // 融合できるティアラメンツ：効果で墓地へ送られた場合に、自分の手札・フィールド・墓地のモンスターで融合召喚するもの
  const trig = new Map(DB.cards.filter(c => (c.type & T.MONSTER) && !(c.type & EXTRA_MASK) && /ティアラメンツ/.test(c.name) && /融合素材として好きな順番でデッキの下に戻し/.test(opText(c))).map(c => [c.id, c.name]));
  // デッキの上から3枚を墓地へ送ったあと、キトカロス → ルルカロスまで行けるか
  const afterMill = (ids, OH, OD) => {
    const milled = [];
    for (let i = OH; i < Math.min(OH + 3, OD); i++) if (trig.has(ids[i])) milled.push(trig.get(ids[i]));
    if (!milled.length) return false;
    // ルルカロス用の2体目：名前の違う融合できるティアラメンツ（落ちたカードか、まだデッキにあるもの）
    const first = milled[0];
    if (milled.some(n => n !== first)) return true;
    for (let i = OH + 3; i < OD; i++) if (trig.has(ids[i]) && trig.get(ids[i]) !== first) return true;
    return false;
  };
  return (ids, OH, OD) => {
    // クシャトリラ：相手メインフェイズに手札から特殊召喚（手札のほかの「クシャトリラ」「ティアラメンツ」カードを1枚除外）→ 3枚墓地へ
    let k = -1;
    for (let i = 0; i < OH; i++) if (kash.has(ids[i])) { k = i; break; }
    if (k >= 0) {
      let other = false;
      for (let i = 0; i < OH; i++) if (i !== k && cost.has(ids[i])) { other = true; break; }
      if (other && afterMill(ids, OH, OD)) return 1;
    }
    // ハゥフニス：こちらが場でモンスター効果を使った時に手札から特殊召喚 → 3枚墓地へ（場のハゥフニスと落ちたカードでキトカロス）
    for (let i = 0; i < OH; i++) if (havn.has(ids[i])) return afterMill(ids, OH, OD) ? 2 : 0;
    return 0;
  };
}
// 0ターン展開の動き出しが「こちらが場でモンスター効果を使った時」だけのカードか
function opIsZeroField(c) {
  return opText(c).split(/[①②③④⑤⑥]/).some(s => OP_ZERO_TIMING.test(s) && OP_ZERO_HAND.test(s) && /特殊召喚/.test(s) && !opNeedsOwnField(s))
    && opText(c).split(/[①②③④⑤⑥]/).filter(s => OP_ZERO_TIMING.test(s) && OP_ZERO_HAND.test(s) && /特殊召喚/.test(s) && !opNeedsOwnField(s)).every(s => /相手がフィールドのモンスターの効果を発動した/.test(s));
}
// 0ターン展開が最後まで届く確率（相手の手札とデッキの上を配って試す。全部のデッキの中での率）
const opSimRateCache = new Map();
function opSimRate(u, t, hand) {
  const key = t.id + ':' + hand + ':' + u.nDecks;
  if (opSimRateCache.has(key)) return opSimRateCache.get(key);
  const N = 20000;
  let ok = 0;
  for (let it = 0; it < N; it++) {
    const ids = Int32Array.from(u.oppIds[Math.floor(Math.random() * u.oppIds.length)]);
    const OD = ids.length, MIX = Math.min(OD, hand + 5);
    for (let i = 0; i < MIX; i++) { const j = i + Math.floor(Math.random() * (OD - i)); const x = ids[i]; ids[i] = ids[j]; ids[j] = x; }
    if (t.sim(ids, hand, OD)) ok++;
  }
  opSimRateCache.set(key, ok / N);
  return ok / N;
}

// 0ターン展開のカードの動き出しの条件（効果の文から）
//  kind：1＝条件なし／2＝こちらが場でモンスター効果を使った時／4＝こちらが手札・墓地でモンスター効果を使った時／0＝単独では動けない
//  need：手札にほかに要るカード（「このカード以外の「○○」カード」「手札の他の「○○」モンスター」など）
function opZeroCond(c) {
  const segs = opText(c).split(/[①②③④⑤⑥]/).filter(s => OP_ZERO_TIMING.test(s) && OP_ZERO_HAND.test(s) && /特殊召喚/.test(s) && !opNeedsOwnField(s));
  let best = null;
  for (const s of segs) {
    if (/自分の「[^」]+」(カード|モンスター)の効果で/.test(s)) continue;   // 自分のテーマの効果のあとでしか動けない（ウィスカ・ブリッツクリークなど）
    const kind = /相手がフィールドのモンスターの効果を発動した/.test(s) ? 2 : /相手が手札・墓地のモンスターの効果を発動した/.test(s) ? 4 : 1;
    // 手札にほかに要るカード（0ターン目は墓地が空なので、「手札・墓地から○○を除外」なども手札に要る）
    const m = s.match(/(このカード以外の|他の|このカード以外の自分の)「([^」]+)」/) || s.match(/手札・墓地から()「([^」]+)」/);
    const cond = { kind, need: m ? m[2] : null };
    if (!best || (cond.kind === 1 && best.kind !== 1) || (cond.kind === best.kind && !cond.need && best.need)) best = cond;
  }
  return best || { kind: 0, need: null };
}
// テーマの0ターン展開：配った相手の手札で、どのカードから・どの条件で動き出せるか（返り値は条件のビット。0＝動けない）
function opZeroSim(cardIds) {
  const themeOf = c => (typeof decThemesOf === 'function' ? decThemesOf(c) : []);
  const info = new Map(), needSets = new Map();
  for (const id of cardIds) {
    const c = DB.byId.get(id);
    if (!c) continue;
    const cond = opZeroCond(c);
    if (!cond.kind) continue;
    if (cond.need && !needSets.has(cond.need)) {
      const key = normalizeText(cond.need);
      needSets.set(cond.need, new Set(DB.cards.filter(x => normalizeText(x.name).includes(key) || themeOf(x).some(t => normalizeText(t) === key)).map(x => x.id)));
    }
    info.set(id, cond);
  }
  return (ids, OH) => {
    let bits = 0;
    for (let i = 0; i < OH; i++) {
      const cond = info.get(ids[i]);
      if (!cond) continue;
      if (cond.need) {
        const set = needSets.get(cond.need);
        let ok = false;
        for (let j = 0; j < OH; j++) if (j !== i && set.has(ids[j])) { ok = true; break; }
        if (!ok) continue;
      }
      bits |= cond.kind;
    }
    return bits & 1 ? 1 : bits;
  };
}
// 0ターン展開のカードの名前と、動き出しの条件
function opZeroCondLabel(id) {
  const c = DB.byId.get(id);
  if (!c) return '';
  const k = opZeroCond(c);
  const what = k.kind === 0 ? '単独では動けない' : k.kind === 2 ? 'こちらが場でモンスター効果を使った時' : k.kind === 4 ? 'こちらが手札・墓地でモンスター効果を使った時' : '条件なし';
  return `${c.name}（${what}${k.kind && k.need ? `・手札にほかの「${k.need}」が要る` : ''}）`;
}
