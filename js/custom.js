// ---------- オリジナルカード ----------
// 自分で作ったカード。決まった効果（ドロー・サーチ・破壊など）を組み合わせて作り、効果はエンジン（EDOPro）の
// スクリプトを作って、ルールどおりに自動で処理する。この端末のブラウザに保存する（store 'ygo.customCards'）。
// 対戦では、デッキに入れたオリジナルカードの中身をデッキと一緒に相手へ送り、相手の画面でも同じように動かす。
const CUSTOM_KEY = 'ygo.customCards';
const CUSTOM_ID_MIN = 730000000, CUSTOM_ID_SPAN = 10000000;   // カードの番号（ほかのカードとぶつからない範囲から、ランダムに決める）
const Custom = { others: new Map() };   // others：対戦相手から届いたオリジナルカード（保存はしない）

const customList = () => store.get(CUSTOM_KEY, []);
const customDefOf = id => customList().find(d => d.id === id) || Custom.others.get(id) || null;
const isCustomId = id => id >= CUSTOM_ID_MIN && id < CUSTOM_ID_MIN + CUSTOM_ID_SPAN;

// テーマ名 → カテゴリ番号（オリジナルカードどうしで「同じテーマ」として扱う。本物のカードの番号とぶつからない 0xf00〜0xfff）
function customSetcode(theme) {
  const t = (theme || '').trim();
  if (!t) return 0;
  let h = 0;
  for (const ch of t) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return 0xf00 + (h % 0xff) + 1;
}
// テーマ名は「、」などで区切って3つまで（カテゴリ番号は 16bit ずつ詰めるので、JS の数で正しく持てる3つまで）
const customThemes = d => [...new Set(String((d && d.theme) || '').split(/[、,，\/／]+/).map(s => s.trim()).filter(Boolean))].slice(0, 3);
// 公式のテーマ（data/setnames.js）：名前 → { edo：エンジンの番号, own：アプリのテーマ分けの番号 }
let officialThemeMap = null;
function officialThemes() {
  if (!officialThemeMap) officialThemeMap = new Map((typeof SETNAMES !== 'undefined' ? SETNAMES : []).map(([edo, own, name, n]) => [name, { edo, own, name, n }]));
  return officialThemeMap;
}
// テーマ名の番号。公式のテーマならその番号（公式のカードと同じテーマになる）、ほかはオリジナルのテーマ
const themeCodes = name => { const o = officialThemes().get(name); if (o) return o; const h = customSetcode(name); return { edo: h, own: h }; };
// 文に書かれたテーマ名を、公式のテーマ名にそろえる（全角・半角や読みの違いは同じとみなす）。無ければそのまま
function themeByLooseName(s) {
  const k = normalizeText(s);
  for (const name of officialThemes().keys()) if (normalizeText(name) === k || normalizeText(name.replace(/（[^）]*）$/, "")) === k) return name;
  return s;
}
const customSetcodes = d => [...new Set(customThemes(d).map(t => themeCodes(t).own).filter(Boolean))];
const customEdoSetcodes = d => [...new Set(customThemes(d).map(t => themeCodes(t).edo).filter(Boolean))];
// 効果の「テーマのカードだけ」が指すテーマ名の一覧（どれかのテーマのカード）。
// f.themes（配列）。前の形：f.theme が文字ならそのテーマ、true ならこのカードの1つ目のテーマ
const filtThemes = (f, d) => {
  const ts = customThemes(d);
  if (!f || !ts.length) return [];
  if (Array.isArray(f.themes)) return f.themes.filter(t => ts.includes(t));
  if (!f.theme) return [];
  return [typeof f.theme === 'string' && ts.includes(f.theme) ? f.theme : ts[0]];
};
const themeLabel = t => `「${t.replace(/（[^）]*）$/, '')}」`;   // 公式のテーマ名の読み（「古代の機械（アンティーク・ギア）」など）は文に入れない
// 手札に加える・墓地へ送る・特殊召喚する枚数
const effCount = x => Math.max(1, Math.min(5, +(x && x.cnt) || 1));

// ---------- 選べるもの ----------
const CUSTOM_MTYPES = { normal: '通常モンスター', effect: '効果モンスター', fusion: '融合モンスター', synchro: 'シンクロモンスター', xyz: 'エクシーズモンスター', link: 'リンクモンスター' };
const CUSTOM_STYPES = { normal: '通常魔法', quick: '速攻魔法', continuous: '永続魔法', field: 'フィールド魔法' };
const CUSTOM_TTYPES = { normal: '通常罠', continuous: '永続罠', counter: 'カウンター罠' };

const OPP_ACT = '相手がモンスターの効果・魔法・罠カードを発動した時';
// いつ発動するか。pre：条件の文（「〜場合」）／cost：コストの文／quick：相手ターンでも発動できる／trig：誘発効果（強制にもできる）／ok：そのカードで選べるか
const CUSTOM_WHEN = {
  ignition: { label: '起動効果（自分のメインフェイズに）', pre: '', cost: '', ok: d => d.kind === 'monster' || isZoneST(d) },
  summon: { label: 'このカードが召喚・特殊召喚した場合', pre: 'このカードが召喚・特殊召喚した場合', cost: '', trig: true, ok: d => d.kind === 'monster' },
  nsummon: { label: 'このカードが召喚した場合（通常召喚だけ）', pre: 'このカードが召喚した場合', cost: '', trig: true, ok: d => d.kind === 'monster' && !isExtraMtype(d) },
  spsummon: { label: 'このカードが特殊召喚した場合', pre: 'このカードが特殊召喚した場合', cost: '', trig: true, ok: d => d.kind === 'monster' },
  tograve: { label: 'このカードが墓地へ送られた場合', pre: 'このカードが墓地へ送られた場合', cost: '', trig: true, ok: d => d.kind === 'monster' },
  quick: { label: 'フリーチェーン（相手ターンでも）', pre: '', cost: '', quick: true, ok: d => d.kind === 'monster' || (d.kind === 'trap' && d.ttype === 'continuous') },
  chain: { label: '相手が効果を発動した時', pre: OPP_ACT, cost: '', ok: d => d.kind === 'monster' },
  handquick: { label: '手札から捨てて（相手ターンでも）', pre: '', cost: 'このカードを手札から捨てて', quick: true, ok: d => d.kind === 'monster' && !isExtraMtype(d) },
  handchain: { label: '手札から捨てて・相手が効果を発動した時', pre: OPP_ACT, cost: 'このカードを手札から捨てて', ok: d => d.kind === 'monster' && !isExtraMtype(d) },
  handss: { label: '手札にある場合（起動効果）', pre: 'このカードが手札に存在する場合', cost: '', ok: d => d.kind === 'monster' && !isExtraMtype(d) },
  handattack: { label: '手札にある場合・相手モンスターの攻撃宣言時', pre: '相手モンスターの攻撃宣言時', cost: '', ok: d => d.kind === 'monster' && !isExtraMtype(d) },
  gyban: { label: '墓地から除外して（起動効果）', pre: '', cost: '墓地のこのカードを除外して', ok: d => d.kind === 'monster' },
  activate: { label: 'カードの発動', pre: '', cost: '', card: true, ok: d => (d.kind === 'spell' || d.kind === 'trap') && !isZoneST(d) },
  achain: { label: '相手が効果を発動した時（カードの発動）', pre: OPP_ACT, cost: '', card: true, ok: d => (d.kind === 'trap' || (d.kind === 'spell' && d.stype === 'quick')) && !isZoneST(d) },
  attack: { label: '相手モンスターの攻撃宣言時（カードの発動）', pre: '相手モンスターの攻撃宣言時', cost: '', card: true, ok: d => (d.kind === 'trap' || (d.kind === 'spell' && d.stype === 'quick')) && !isZoneST(d) },
};
// 発動のコスト（自分で決める分）。手札から捨てる・墓地から除外するタイミングには付けない
const CUSTOM_COSTS = { '': 'なし', discard: '手札を１枚捨てる', lp: 'LPを払う' };
const costOk = when => !CUSTOM_WHEN[when] || !CUSTOM_WHEN[when].cost;
// 相手フィールドのどのカードか（破壊・除外・手札に戻す）
const CUSTOM_AREAS = { card: 'カード', monster: 'モンスター', st: '魔法・罠カード' };
// 何をするか。n：数を選ぶ（その範囲）／filt：カードの条件を選べる／chain：相手の発動に対してだけ
const CUSTOM_WHAT = {
  draw: { label: 'ドローする', n: [1, 3] },
  search: { label: 'デッキからカードを手札に加える', filt: true },
  send: { label: 'デッキからカードを墓地へ送る', filt: true },
  deckss: { label: 'デッキからモンスターを特殊召喚する', filt: true, mon: true },
  gyss: { label: '自分の墓地のモンスターを特殊召喚する', filt: true, mon: true },
  handsp: { label: '手札からモンスターを特殊召喚する', filt: true, mon: true },
  self: { label: 'このカードを特殊召喚する' },
  destroy: { label: '相手フィールドのカードを1枚破壊する', area: true },
  destroyall: { label: '相手フィールドのカードを全て破壊する', area: true },
  banish: { label: '相手フィールドのカードを1枚除外する', area: true },
  bounce: { label: '相手フィールドのカードを1枚手札に戻す', area: true },
  damage: { label: '相手にダメージを与える', n: [100, 4000, 100] },
  recover: { label: '自分のLPを回復する', n: [100, 4000, 100] },
  atkup: { label: '自分のモンスター1体の攻撃力を上げる', n: [100, 3000, 100] },
  negate: { label: 'その発動を無効にして破壊する', chain: true },
  protect: { label: 'このターン、自分のカードを守る（対象にできない・チェーンできない）', prot: true },
};
const isZoneST = d => (d.kind === 'spell' && (d.stype === 'continuous' || d.stype === 'field')) || (d.kind === 'trap' && d.ttype === 'continuous');
const isExtraMtype = d => ['fusion', 'synchro', 'xyz', 'link'].includes(d.mtype);
const isChainWhen = w => w === 'chain' || w === 'handchain' || w === 'achain';
// 選んだタイミングで、選べる効果
const whatOk = (d, when, what) => {
  const w = CUSTOM_WHAT[what];
  if (!w) return false;
  if (w.chain && !isChainWhen(when)) return false;
  if (what === 'self') return when === 'handss' || when === 'tograve' || when === 'handattack';   // 手札・墓地にあるこのカードを出す
  if (when === 'handattack') return false;   // 手札での攻撃宣言時は「このカードを特殊召喚する」だけ
  return true;
};
// 1枚のカードに入れられる効果の数（通常・速攻魔法、通常・カウンター罠は発動の効果1つ）
const maxEffects = d => (d.kind === 'monster' ? (d.mtype === 'normal' ? 0 : 5) : isZoneST(d) ? 5 : 1);
// 1ターンに使える回数。name：このカード名で1ターンに1度（名称ターン1）／soft：このカード1枚ごとに1ターンに1度（ターン1）／none：制限なし
// （前の形 opt: true は名称ターン1）
const OPT_TYPES = { none: '制限なし', name: '名称ターン1（このカード名で1ターンに1度）', soft: 'ターン1（このカード1枚ごとに1ターンに1度）' };
const optOf = x => (x && OPT_TYPES[x.optType] ? x.optType : x && x.opt ? 'name' : 'none');

// ---------- カードのデータ（アプリの形） ----------
function customType(d) {
  const stLink = d.stLink && d.markers ? T.LINK : 0;   // リンクマーカーを持つ魔法・罠
  if (d.kind === 'spell') return T.SPELL | stLink | ({ quick: T.QUICKPLAY, continuous: T.CONTINUOUS, field: T.FIELD }[d.stype] || 0);
  if (d.kind === 'trap') return T.TRAP | stLink | ({ continuous: T.CONTINUOUS, counter: T.COUNTER }[d.ttype] || 0);
  const ex = { fusion: T.FUSION, synchro: T.SYNCHRO, xyz: T.XYZ, link: T.LINK }[d.mtype] || 0;
  const eff = d.mtype === 'normal' ? T.NORMAL : (d.mtype === 'effect' || (d.effects || []).length ? T.EFFECT : 0);
  return T.MONSTER | ex | eff | (d.tuner && d.mtype !== 'link' && d.mtype !== 'xyz' ? T.TUNER : 0);
}
const CIRCLED = ['①', '②', '③', '④', '⑤'];
const zen = s => String(s).replace(/[0-9]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0xFEE0));
function filtText(f, d, mon, cnt, upto) {
  f = f || {};
  const parts = [];
  // 本物のカードの順：レベル・攻守 →「の」→ 属性 → 種族 →「テーマ」→ 種類（例：レベル４以下の闇属性戦士族「〇〇」モンスター）
  const stats = [];
  if (f.lv) stats.push(`レベル${zen(f.lv)}${{ ge: '以上', eq: '' }[f.lvMode] ?? '以下'}`);
  if (f.atkGe) stats.push(`攻撃力${zen(f.atkGe)}以上`);
  if (f.atkLe != null && f.atkLe !== '') stats.push(`攻撃力${zen(f.atkLe)}以下`);
  if (f.defGe) stats.push(`守備力${zen(f.defGe)}以上`);
  if (f.defLe != null && f.defLe !== '') stats.push(`守備力${zen(f.defLe)}以下`);
  const th = filtThemes(f, d);
  const tail = [f.attr ? `${ATTR[f.attr]}属性` : '', f.race ? RACE[f.race] : '', th.map(themeLabel).join('または')].join('');
  // 「レベル４モンスター」のように、ちょうどのレベルだけで後ろに何も無いときは「の」を付けない
  if (stats.length) parts.push(stats.join('で') + (tail || !(f.lvMode === 'eq' && stats.length === 1) ? 'の' : ''));
  parts.push(tail);
  const kind = mon || f.kind === 'monster' ? 'モンスター' : f.kind === 'spell' ? '魔法カード' : f.kind === 'trap' ? '罠カード' : 'カード';
  const count = zen(cnt || 1) + (kind === "モンスター" ? "体" : "枚");
  // 「〜を３枚まで」（1枚から選べる）／「〜３枚を」
  return upto ? parts.join("") + kind + "を" + count + "まで" : parts.join("") + kind + count + "を";
}
// 効果1つの文。tgt：対象にするもの（あれば「〜を対象として発動できる」）／rest：処理
function customWhatText(x, d) {
  const n = zen(x.n || 1);
  const area = CUSTOM_AREAS[x.area] ? x.area : 'card';
  const one = area === 'monster' ? '相手フィールドのモンスター１体' : area === 'st' ? '相手フィールドの魔法・罠カード１枚' : '相手フィールドのカード１枚';
  const that = area === 'monster' ? 'そのモンスター' : 'そのカード';
  switch (x.what) {
    case 'draw': return { rest: `自分は${n}枚ドローする` };
    case 'search': return { rest: `デッキから${filtText(x.filt, d, false, effCount(x), x.upto)}手札に加える` };
    case 'send': return { rest: `デッキから${filtText(x.filt, d, false, effCount(x), x.upto)}墓地へ送る` };
    case 'deckss': return { rest: `デッキから${filtText(x.filt, d, true, effCount(x), x.upto)}特殊召喚する` };
    case 'handsp': return { rest: `手札から${filtText(x.filt, d, true, effCount(x), x.upto)}特殊召喚する` };
    case 'gyss': return { rest: `自分の墓地から${filtText(x.filt, d, true, effCount(x), x.upto)}選んで特殊召喚する` };
    case 'self': return { rest: x.when === 'handattack' ? 'このカードを手札から特殊召喚する' : 'このカードを特殊召喚する' };
    case 'destroy': return { tgt: one, rest: `${that}を破壊する` };
    case 'destroyall': return { rest: `相手フィールドの${{ monster: 'モンスター', st: '魔法・罠カード', card: 'カード' }[area]}を全て破壊する` };
    case 'banish': return { tgt: one, rest: `${that}を除外する` };
    case 'bounce': return { tgt: one, rest: `${that}を持ち主の手札に戻す` };
    case 'damage': return { rest: `相手に${n}ダメージを与える` };
    case 'recover': return { rest: `自分は${n}LP回復する` };
    case 'atkup': return { tgt: '自分フィールドの表側表示モンスター１体', rest: `そのモンスターの攻撃力はターン終了時まで${n}アップする` };
    case 'negate': return { rest: 'その発動を無効にし破壊する' };
    case 'protect': {
      const p = x.prot || { target: true, chain: true };
      const th = filtThemes(x.filt, d);
      const S = `自分の${th.length ? th.map(themeLabel).join('または') : ''}カード`;
      const r = p.target && p.chain ? `相手は${S}を効果の対象にできず、${S}の効果の発動に対して効果を発動できない`
        : p.chain ? `${S}の効果の発動に対して相手は効果を発動できない` : `相手は${S}を効果の対象にできない`;
      return { rest: `このターン、${r}` };
    }
    default: return { rest: '' };
  }
}
// 縛りの文（「ターン終了時まで自分は「A」、「B」カードの効果しか発動できない」など）
function lockWhoText(lk) {
  const th = (lk.themes || []).map(themeLabel).join('、');
  return `${th}${lk.attr && ATTR[lk.attr] ? ATTR[lk.attr] + '属性' : ''}${lk.race && RACE[lk.race] ? RACE[lk.race] : ''}`;
}
function lockText(lk) {
  if (!lk) return '';
  const who = lockWhoText(lk), mon = lk.attr || lk.race;
  return lk.kind === 'ss' ? `ターン終了時まで自分は${lk.extra ? 'エクストラデッキから' : ''}${who}モンスターしか特殊召喚できない`
    : `ターン終了時まで自分は${who}${mon ? 'モンスター' : 'カード'}の効果しか発動できない`;
}
const lockOk = lk => !!(lk && (lk.kind === 'act' || lk.kind === 'ss') && ((lk.themes || []).length || lk.attr || lk.race));
// 効果文（本物のカードに近い書き方）
function customText(d) {
  const effs = (d.effects || []).slice(0, maxEffects(d)).filter(x => CUSTOM_WHEN[x.when] && CUSTOM_WHAT[x.what]);
  const lines = [];
  // 融合・シンクロ・エクシーズ・リンクの素材
  if (d.kind === 'monster') {
    const mat = { fusion: 'モンスター×２', synchro: 'チューナー＋チューナー以外のモンスター１体以上', xyz: `レベル${zen(d.level)}モンスター×２`, link: `モンスター${zen(Math.min(2, d.level) || 1)}体以上` }[d.mtype];
    if (mat) lines.push(mat);
  }
  if (d.kind === 'monster' && d.mtype === 'normal') return [...lines, d.flavor || ''].filter(Boolean).join('\n');
  if (d.useSrc && (d.src || '').trim()) return [...lines, d.src.trim()].join('\n');   // 自分の書いた文をそのまま出す
  const single = effs.length === 1 && CUSTOM_WHEN[effs[0].when].card;   // 魔法・罠の発動の効果だけ（今のカードと同じく①は付ける）
  const opt = effs.map((x, i) => (optOf(x) === 'name' ? CIRCLED[i] : null)).filter(Boolean);
  if (single && opt.length) lines.push('このカード名のカードは１ターンに１枚しか発動できない。');
  else if (opt.length) lines.push(`このカード名の${opt.join('')}の効果は${opt.length > 1 ? 'それぞれ' : ''}１ターンに１度しか使用できない。`);
  // 縛り：全部の効果に同じ縛りがあれば最後に1回（「このカードの効果の発動後、」）、ほかは効果ごと（「この効果の発動後、」）
  const lks = effs.map(x => (lockOk(x.lock) ? lockText(x.lock) : ''));
  const cardLock = effs.length > 1 && lks[0] && lks.every(t => t === lks[0]) ? lks[0] : '';
  effs.forEach((x, i) => {
    const w = CUSTOM_WHEN[x.when];
    let { tgt, rest } = customWhatText(x, d);
    if (lks[i] && !cardLock) rest += `。${single ? 'このカードの発動後' : 'この効果の発動後'}、${lks[i]}`;
    // ターン1（このカード1枚ごと）は文の頭に「１ターンに１度、」
    const head = `${CIRCLED[i]}：` + (!single && optOf(x) === 'soft' ? '１ターンに１度、' : '');
    // コスト：あとに「〜を対象として」が続くときは「捨て、」「払い、」、続かなければ「捨てて」「払って」
    const ct = costOk(x.when) && x.cost === 'discard' ? (tgt ? '手札を１枚捨て、' : '手札を１枚捨てて')
      : costOk(x.when) && x.cost === 'lp' ? `ＬＰを${zen(Math.max(100, +x.lp || 1000))}${tgt ? '払い、' : '払って'}` : '';
    const must = w.trig && x.must;   // 強制効果は「発動する」
    let s;
    if (w.card && !w.pre && !tgt && !ct) s = `${rest}。`;   // 魔法・罠の発動（条件・対象・コストなし）
    else s = `${w.pre ? w.pre + (tgt || w.cost || ct ? '、' : 'に') : ''}${w.cost}${w.cost && (tgt || ct) ? '、' : ''}${ct}${tgt ? tgt + 'を対象として' : ''}${must ? '発動する' : '発動できる'}。${rest}。${w.quick ? 'この効果は相手ターンでも発動できる。' : ''}`;
    lines.push(head + s.replace('捨てて、', '捨て、'));
  });
  if (cardLock) lines.push(`このカードの効果の発動後、${cardLock}。`);
  if (d.memo) lines.push(d.memo);
  return lines.join('\n');
}
function customToCard(d) {
  const type = customType(d);
  const link = d.kind === 'monster' && d.mtype === 'link';
  const c = {
    id: d.id, cid: 0, name: d.name || 'オリジナルカード', ruby: '', en: '', type,
    atk: d.kind === 'monster' ? +d.atk || 0 : 0,
    def: d.kind === 'monster' ? (link ? +d.markers || 0 : +d.def || 0) : (type & T.LINK ? +d.markers || 0 : 0),
    level: d.kind === 'monster' ? Math.max(1, Math.min(13, +d.level || 1)) : 0, ls: 0, rs: 0,
    race: d.kind === 'monster' ? +d.race || 1 : 0, attr: d.kind === 'monster' ? +d.attr || 1 : 0,
    setcode: customSetcodes(d).reduce((a, s, i) => a + s * 65536 ** i, 0), desc: '', pdesc: '', md: false, noJp: false,
    custom: true, def0: d,
    edoSet: customEdoSetcodes(d),   // エンジンに渡すテーマの番号（公式のテーマは EDOPro の番号）
  };
  c.jaText = customText(d);
  c.tkey = normalizeText(c.jaText);
  c.jaStrs = (d.effects || []).map(x => (CUSTOM_WHAT[x.what] ? CUSTOM_WHAT[x.what].label : '効果'));
  // 8番から：縛りの表示（エンジンの「制限が付いた」の文）
  (d.effects || []).forEach((x, i) => { if (lockOk(x.lock)) c.jaStrs[8 + i] = lockText(x.lock).replace(/^ターン終了時まで/, ''); });
  c.key = normalizeText(c.name) + '||';
  c.nkey = normalizeText(c.name);
  return c;
}

// カードの一覧に入れる（起動時：data.js の indexCards から呼ぶ）
function withCustomCards(cards) {
  const add = [...customList(), ...Custom.others.values()].map(customToCard);
  const ids = new Set(add.map(c => c.id));
  return [...cards.filter(c => !ids.has(c.id)), ...add];
}
// 1枚を一覧に入れ直す（作った・直したとき、対戦相手のカードが届いたとき）
function registerCustom(d) {
  if (!d || !isCustomId(d.id) || typeof DB === 'undefined' || !DB.byId) return null;
  const c = customToCard(d);
  const i = DB.cards.findIndex(x => x.id === c.id);
  if (i >= 0) DB.cards[i] = c; else DB.cards.push(c);
  DB.byId.set(c.id, c);
  DB.fuzzIndex = null;
  // 絵：ネットの画像は無いので、作った人が選んだ絵（無ければ枠だけ）
  for (const k of ['art', 'small', 'full']) missingImages.add(c.id + k);
  if (d.img) UserPics.set(c.id, d.img); else UserPics.delete(c.id);
  return c;
}
function unregisterCustom(id) {
  const i = DB.cards.findIndex(x => x.id === id);
  if (i >= 0) DB.cards.splice(i, 1);
  DB.byId.delete(id);
  UserPics.delete(id);
}
// 起動したとき：絵を出せるようにする（カードの一覧に入れるのは indexCards）
function setupCustomPics() {
  for (const d of customList()) {
    for (const k of ['art', 'small', 'full']) missingImages.add(d.id + k);
    if (d.img) UserPics.set(d.id, d.img);
  }
}

// ---------- 効果のスクリプト（EDOPro の Lua） ----------
const LUA_FILTER = (x, d, mon, id) => {
  const f = x.filt || {};
  const cond = ['not c:IsCode(id)'];
  if (mon || f.kind === 'monster') cond.push('c:IsType(TYPE_MONSTER)');
  else if (f.kind === 'spell') cond.push('c:IsType(TYPE_SPELL)');
  else if (f.kind === 'trap') cond.push('c:IsType(TYPE_TRAP)');
  if (f.race) cond.push(`c:IsRace(${+f.race})`);
  if (f.attr) cond.push(`c:IsAttribute(${+f.attr})`);
  if (f.lv) cond.push(f.lvMode === 'ge' ? `c:IsLevelAbove(${+f.lv})` : f.lvMode === 'eq' ? `c:IsLevel(${+f.lv})` : `c:IsLevelBelow(${+f.lv})`);
  if (f.atkGe) cond.push(`c:IsAttackAbove(${+f.atkGe})`);
  if (f.atkLe != null && f.atkLe !== '') cond.push(`c:IsAttackBelow(${+f.atkLe})`);
  if (f.defGe) cond.push(`c:IsDefenseAbove(${+f.defGe})`);
  if (f.defLe != null && f.defLe !== '') cond.push(`c:IsDefenseBelow(${+f.defLe})`);
  const th = [...new Set(filtThemes(f, d).map(t => themeCodes(t).edo).filter(Boolean))];
  if (th.length) cond.push('(' + th.map(s => `c:IsSetCard(${s})`).join(' or ') + ')');
  return cond.join(' and ');
};
// 効果1つの「対象・処理」と、カテゴリ・対象を取るか
function luaAction(x, d, i) {
  const n = Math.max(1, +x.n || 1);
  const F = `s.f${i}`, TG = `s.tg${i}`, OP = `s.op${i}`;
  const head = `function ${TG}(e,tp,eg,ep,ev,re,r,rp,chk,chkc)`;
  const opHead = `function ${OP}(e,tp,eg,ep,ev,re,r,rp)`;
  const k = effCount(x);
  const lo = x.upto ? 1 : k;   // 「〜まで」は1枚から選べる
  const fromDeck = (loc, cat, able, hint, act, mon) => ({
    cat, tgt: false,
    code: `function ${F}(c,e,tp) return ${LUA_FILTER(x, d, mon)} and ${able} end
${head}
	if chk==0 then return ${mon ? `Duel.GetLocationCount(tp,LOCATION_MZONE)>=${lo} and ` : ''}Duel.IsExistingMatchingCard(${F},tp,${loc},0,${lo},nil,e,tp) end
	Duel.SetOperationInfo(0,${cat.split('+')[0]},nil,${lo},tp,${loc})
end
${opHead}
	local mx=${k}
	${mon ? `mx=math.min(mx,Duel.GetLocationCount(tp,LOCATION_MZONE))\n\tif mx<${lo} then return end\n\t` : ''}if not Duel.IsExistingMatchingCard(${F},tp,${loc},0,${lo},nil,e,tp) then return end
	Duel.Hint(HINT_SELECTMSG,tp,${hint})
	local g=Duel.SelectMatchingCard(tp,${F},tp,${loc},0,${lo},mx,nil,e,tp)
	if #g>0 then ${act} end
end`,
  });
  // 相手フィールドのどのカードか（モンスター／魔法・罠／カード）
  const area = CUSTOM_AREAS[x.area] ? x.area : 'card';
  const AREA_LOC = { monster: 'LOCATION_MZONE', st: 'LOCATION_SZONE', card: 'LOCATION_ONFIELD' }[area];
  const AREA_OK = { monster: '', st: ' and c:IsSpellTrap()', card: '' }[area];
  const targetOpp = (cat, able, hint, act) => ({
    cat, tgt: true,
    code: `function ${F}(c) return ${able}${AREA_OK} end
${head}
	if chkc then return chkc:IsLocation(${AREA_LOC}) and chkc:IsControler(1-tp) and ${F}(chkc) end
	if chk==0 then return Duel.IsExistingTarget(${F},tp,0,${AREA_LOC},1,nil) end
	Duel.Hint(HINT_SELECTMSG,tp,${hint})
	local g=Duel.SelectTarget(tp,${F},tp,0,${AREA_LOC},1,1,nil)
	Duel.SetOperationInfo(0,${cat},g,1,0,0)
end
${opHead}
	local tc=Duel.GetFirstTarget()
	if tc and tc:IsRelateToEffect(e) then ${act} end
end`,
  });
  const playerVal = (cat, who, act) => ({
    cat, tgt: false,
    code: `${head}
	if chk==0 then return ${cat === 'CATEGORY_DRAW' ? `Duel.IsPlayerCanDraw(tp,${n})` : 'true'} end
	Duel.SetTargetPlayer(${who})
	Duel.SetTargetParam(${n})
	Duel.SetOperationInfo(0,${cat},nil,0,${who},${n})
end
${opHead}
	local p,d=Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)
	${act}
end`,
  });
  switch (x.what) {
    case 'draw': return playerVal('CATEGORY_DRAW', 'tp', 'Duel.Draw(p,d,REASON_EFFECT)');
    case 'damage': return playerVal('CATEGORY_DAMAGE', '1-tp', 'Duel.Damage(p,d,REASON_EFFECT)');
    case 'recover': return playerVal('CATEGORY_RECOVER', 'tp', 'Duel.Recover(p,d,REASON_EFFECT)');
    case 'search': return fromDeck('LOCATION_DECK', 'CATEGORY_TOHAND+CATEGORY_SEARCH', 'c:IsAbleToHand()', 'HINTMSG_ATOHAND', 'Duel.SendtoHand(g,nil,REASON_EFFECT) Duel.ConfirmCards(1-tp,g)');
    case 'send': return fromDeck('LOCATION_DECK', 'CATEGORY_TOGRAVE', 'c:IsAbleToGrave()', 'HINTMSG_TOGRAVE', 'Duel.SendtoGrave(g,REASON_EFFECT)');
    case 'deckss': return fromDeck('LOCATION_DECK', 'CATEGORY_SPECIAL_SUMMON', 'c:IsCanBeSpecialSummoned(e,0,tp,false,false)', 'HINTMSG_SPSUMMON', 'Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)', true);
    case 'handsp': return fromDeck('LOCATION_HAND', 'CATEGORY_SPECIAL_SUMMON', 'c:IsCanBeSpecialSummoned(e,0,tp,false,false)', 'HINTMSG_SPSUMMON', 'Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)', true);
    case 'destroyall': return {
      cat: 'CATEGORY_DESTROY', tgt: false,
      code: `function ${F}(c) return true${AREA_OK} end
${head}
	if chk==0 then return Duel.IsExistingMatchingCard(${F},tp,0,${AREA_LOC},1,nil) end
	local g=Duel.GetMatchingGroup(${F},tp,0,${AREA_LOC},nil)
	Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,0,0)
end
${opHead}
	local g=Duel.GetMatchingGroup(${F},tp,0,${AREA_LOC},nil)
	if #g>0 then Duel.Destroy(g,REASON_EFFECT) end
end`,
    };
    case 'gyss': return fromDeck('LOCATION_GRAVE', 'CATEGORY_SPECIAL_SUMMON', 'c:IsCanBeSpecialSummoned(e,0,tp,false,false)', 'HINTMSG_SPSUMMON', 'Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)', true);
    case 'destroy': return targetOpp('CATEGORY_DESTROY', 'true', 'HINTMSG_DESTROY', 'Duel.Destroy(tc,REASON_EFFECT)');
    case 'banish': return targetOpp('CATEGORY_REMOVE', 'c:IsAbleToRemove()', 'HINTMSG_REMOVE', 'Duel.Remove(tc,POS_FACEUP,REASON_EFFECT)');
    case 'bounce': return targetOpp('CATEGORY_TOHAND', 'c:IsAbleToHand()', 'HINTMSG_RTOHAND', 'Duel.SendtoHand(tc,nil,REASON_EFFECT)');
    case 'self': return {
      cat: 'CATEGORY_SPECIAL_SUMMON', tgt: false,
      code: `${head}
	local c=e:GetHandler()
	if chk==0 then return Duel.GetLocationCount(tp,LOCATION_MZONE)>0 and c:IsCanBeSpecialSummoned(e,0,tp,false,false) end
	Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,0,0)
end
${opHead}
	local c=e:GetHandler()
	if c:IsRelateToEffect(e) then Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP) end
end`,
    };
    case 'atkup': return {
      cat: 'CATEGORY_ATKCHANGE', tgt: true,
      code: `${head}
	if chkc then return chkc:IsLocation(LOCATION_MZONE) and chkc:IsControler(tp) and chkc:IsFaceup() end
	if chk==0 then return Duel.IsExistingTarget(Card.IsFaceup,tp,LOCATION_MZONE,0,1,nil) end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_FACEUP)
	Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,0,1,1,nil)
end
${opHead}
	local tc=Duel.GetFirstTarget()
	if tc and tc:IsRelateToEffect(e) and tc:IsFaceup() then
		local e1=Effect.CreateEffect(e:GetHandler())
		e1:SetType(EFFECT_TYPE_SINGLE)
		e1:SetCode(EFFECT_UPDATE_ATTACK)
		e1:SetValue(${n})
		e1:SetReset(RESET_EVENT+RESETS_STANDARD+RESET_PHASE+PHASE_END)
		tc:RegisterEffect(e1)
	end
end`,
    };
    case 'protect': {
      // このターン、相手は自分の（テーマの）カードを効果の対象にできない・その効果の発動にチェーンできない
      const p = x.prot || { target: true, chain: true };
      const th = [...new Set(filtThemes(x.filt, d).map(t => themeCodes(t).edo).filter(Boolean))];
      const cond = th.length ? '(' + th.map(s => `c:IsSetCard(${s})`).join(' or ') + ')' : 'true';
      const CH = `s.chop${i}`;
      return {
        cat: '0', tgt: false,
        code: `function ${F}(e,c) return ${cond} end
${head}
	if chk==0 then return true end
end
${opHead}
	local c=e:GetHandler()${p.target ? `
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_FIELD)
	e1:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
	e1:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
	e1:SetTargetRange(LOCATION_ONFIELD+LOCATION_GRAVE+LOCATION_REMOVED,0)
	e1:SetTarget(${F})
	e1:SetValue(function(_,re,rp) return rp==1-tp end)
	e1:SetReset(RESET_PHASE+PHASE_END)
	Duel.RegisterEffect(e1,tp)` : ''}${p.chain ? `
	local e2=Effect.CreateEffect(c)
	e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
	e2:SetCode(EVENT_CHAINING)
	e2:SetOperation(${CH})
	e2:SetReset(RESET_PHASE+PHASE_END)
	Duel.RegisterEffect(e2,tp)` : ''}
end
function ${CH}(e,tp,eg,ep,ev,re,r,rp)
	if rp==tp and ${F}(e,re:GetHandler()) then Duel.SetChainLimit(function(e,rp,tp) return tp==rp end) end
end`,
      };
    }
    case 'negate': return {
      cat: 'CATEGORY_NEGATE+CATEGORY_DESTROY', tgt: false,
      code: `${head}
	if chk==0 then return true end
	Duel.SetOperationInfo(0,CATEGORY_NEGATE,eg,1,0,0)
	if re:GetHandler():IsDestructable() and re:GetHandler():IsRelateToEffect(re) then Duel.SetOperationInfo(0,CATEGORY_DESTROY,eg,1,0,0) end
end
${opHead}
	if Duel.NegateActivation(ev) and re:GetHandler():IsRelateToEffect(re) then Duel.Destroy(eg,REASON_EFFECT) end
end`,
    };
    default: return null;
  }
}
// 効果1つを登録する Lua（initial_effect の中）
function luaRegister(x, d, i, act) {
  const w = x.when;
  const zone = d.kind === 'monster' ? 'LOCATION_MZONE' : d.kind === 'spell' && d.stype === 'field' ? 'LOCATION_FZONE' : 'LOCATION_SZONE';
  const props = [];
  if (act.tgt) props.push('EFFECT_FLAG_CARD_TARGET');
  const lines = [`	local e${i}=Effect.CreateEffect(c)`, `	e${i}:SetDescription(aux.Stringid(id,${i}))`, `	e${i}:SetCategory(${act.cat})`];
  const set = (type, code, range) => {
    lines.push(`	e${i}:SetType(${type})`);
    if (code) lines.push(`	e${i}:SetCode(${code})`);
    if (range) lines.push(`	e${i}:SetRange(${range})`);
  };
  const TRIG = `EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_${x.must ? 'F' : 'O'}`;   // 強制効果は TRIGGER_F
  switch (w) {
    case 'ignition': set('EFFECT_TYPE_IGNITION', null, zone); break;
    case 'summon': case 'nsummon': set(TRIG, 'EVENT_SUMMON_SUCCESS'); props.push('EFFECT_FLAG_DELAY'); break;
    case 'spsummon': set(TRIG, 'EVENT_SPSUMMON_SUCCESS'); props.push('EFFECT_FLAG_DELAY'); break;
    case 'tograve': set(TRIG, 'EVENT_TO_GRAVE'); props.push('EFFECT_FLAG_DELAY'); break;
    case 'handattack': set('EFFECT_TYPE_QUICK_O', 'EVENT_ATTACK_ANNOUNCE', 'LOCATION_HAND'); break;
    case 'attack': set('EFFECT_TYPE_ACTIVATE', 'EVENT_ATTACK_ANNOUNCE'); break;
    case 'quick': set('EFFECT_TYPE_QUICK_O', 'EVENT_FREE_CHAIN', zone); break;
    case 'chain': set('EFFECT_TYPE_QUICK_O', 'EVENT_CHAINING', zone); break;
    case 'handquick': set('EFFECT_TYPE_QUICK_O', 'EVENT_FREE_CHAIN', 'LOCATION_HAND'); break;
    case 'handchain': set('EFFECT_TYPE_QUICK_O', 'EVENT_CHAINING', 'LOCATION_HAND'); break;
    case 'handss': set('EFFECT_TYPE_IGNITION', null, 'LOCATION_HAND'); break;
    case 'gyban': set('EFFECT_TYPE_IGNITION', null, 'LOCATION_GRAVE'); break;
    case 'activate': set('EFFECT_TYPE_ACTIVATE', 'EVENT_FREE_CHAIN'); break;
    case 'achain': set('EFFECT_TYPE_ACTIVATE', 'EVENT_CHAINING'); break;
  }
  if (props.length) lines.push(`	e${i}:SetProperty(${props.join('+')})`);
  if (optOf(x) === 'name') lines.push(`	e${i}:SetCountLimit(1,{id,${i}})`);
  else if (optOf(x) === 'soft') lines.push(`	e${i}:SetCountLimit(1)`);
  if (isChainWhen(w)) lines.push(`	e${i}:SetCondition(s.chaincon${x.what === 'negate' ? 'neg' : ''})`);
  if (w === 'handquick' || w === 'handchain') lines.push(`	e${i}:SetCost(s.discost)`);
  if (w === 'gyban') lines.push(`	e${i}:SetCost(s.bancost)`);
  if (w === 'attack' || w === 'handattack') lines.push(`	e${i}:SetCondition(s.atkcon)`);
  // 自分で決めたコスト（手札を1枚捨てる・LPを払う）
  if (costOk(w) && x.cost === 'discard') lines.push(`	e${i}:SetCost(s.handcost)`);
  if (costOk(w) && x.cost === 'lp') lines.push(`	e${i}:SetCost(s.lpcost(${Math.max(100, +x.lp || 1000)}))`);
  // 縛り：発動したときに付ける（効果が無効になっても付く）
  const tg = lockOk(x.lock) ? `s.tgw(s.tg${i},s.lock${i})` : `s.tg${i}`;
  lines.push(`	e${i}:SetTarget(${tg})`, `	e${i}:SetOperation(s.op${i})`, `	c:RegisterEffect(e${i})`);
  // 召喚した場合：特殊召喚した場合も同じ効果
  if (w === 'summon') lines.push(`	local e${i}b=e${i}:Clone()`, `	e${i}b:SetCode(EVENT_SPSUMMON_SUCCESS)`, `	c:RegisterEffect(e${i}b)`);
  return lines.join('\n');
}
// 縛り：ターン終了時まで、自分は条件に合うカードの効果しか発動できない／条件に合うモンスターしか特殊召喚できない
function luaLock(lk, i) {
  const cond = [];
  const th = [...new Set((lk.themes || []).map(t => themeCodes(t).edo).filter(Boolean))];
  if (th.length) cond.push('(' + th.map(s => `c:IsSetCard(${s})`).join(' or ') + ')');
  if (lk.attr) cond.push(`c:IsAttribute(${+lk.attr})`);
  if (lk.race) cond.push(`c:IsRace(${+lk.race})`);
  if ((lk.attr || lk.race) && lk.kind === 'act') cond.push('c:IsType(TYPE_MONSTER)');
  const ok = cond.join(' and ') || 'true';
  const body = lk.kind === 'ss' ? `	e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
	e1:SetTarget(function(_,c,sump,sumtype,sumpos,targetp,se) return not (${ok})${lk.extra ? ' and c:IsLocation(LOCATION_EXTRA)' : ''} end)`
    : `	e1:SetCode(EFFECT_CANNOT_ACTIVATE)
	e1:SetValue(function(_,re,tp) local c=re:GetHandler() return not (${ok}) end)`;
  return `function s.lock${i}(e,tp)
	local e1=Effect.CreateEffect(e:GetHandler())
	e1:SetDescription(aux.Stringid(id,${8 + i}))
	e1:SetType(EFFECT_TYPE_FIELD)
	e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CLIENT_HINT)
	e1:SetTargetRange(1,0)
${body}
	e1:SetReset(RESET_PHASE+PHASE_END)
	Duel.RegisterEffect(e1,tp)
end`;
}
function customLua(d) {
  const init = [];
  if (d.kind === 'monster') {
    const lv = Math.max(1, +d.level || 1);
    switch (d.mtype) {
      case 'fusion': init.push('	c:EnableReviveLimit()', '	Fusion.AddProcMixN(c,true,true,aux.TRUE,2)'); break;
      case 'synchro': init.push('	c:EnableReviveLimit()', '	Synchro.AddProcedure(c,nil,1,1,Synchro.NonTuner(nil),1,99)'); break;
      case 'xyz': init.push('	c:EnableReviveLimit()', `	Xyz.AddProcedure(c,nil,${lv},2)`); break;
      case 'link': init.push('	c:EnableReviveLimit()', `	Link.AddProcedure(c,nil,${Math.min(2, lv)},${lv})`); break;
    }
  }
  // 永続魔法・フィールド魔法・永続罠：まずカードを発動して置けるようにする
  if (isZoneST(d)) init.push('	local e0=Effect.CreateEffect(c)', '	e0:SetType(EFFECT_TYPE_ACTIVATE)', '	e0:SetCode(EVENT_FREE_CHAIN)', '	c:RegisterEffect(e0)');
  const funcs = [];
  (d.effects || []).slice(0, maxEffects(d)).forEach((x, i) => {
    if (!CUSTOM_WHEN[x.when] || !CUSTOM_WHAT[x.what]) return;
    const act = luaAction(x, d, i);
    if (!act) return;
    init.push(luaRegister(x, d, i, act));
    funcs.push(act.code);
    if (lockOk(x.lock)) funcs.push(luaLock(x.lock, i));
  });
  return `local s,id=GetID()
function s.initial_effect(c)
${init.join('\n')}
end
function s.tgw(tg,lk)
	return function(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
		if chkc or chk==0 then return tg(e,tp,eg,ep,ev,re,r,rp,chk,chkc) end
		tg(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
		lk(e,tp)
	end
end
function s.chaincon(e,tp,eg,ep,ev,re,r,rp) return rp==1-tp end
function s.chainconneg(e,tp,eg,ep,ev,re,r,rp) return rp==1-tp and Duel.IsChainNegatable(ev) end
function s.discost(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return e:GetHandler():IsDiscardable() end
	Duel.SendtoGrave(e:GetHandler(),REASON_COST+REASON_DISCARD)
end
function s.bancost(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return e:GetHandler():IsAbleToRemoveAsCost() end
	Duel.Remove(e:GetHandler(),POS_FACEUP,REASON_COST)
end
function s.handcost(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return Duel.IsExistingMatchingCard(Card.IsDiscardable,tp,LOCATION_HAND,0,1,e:GetHandler()) end
	Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_COST+REASON_DISCARD,e:GetHandler())
end
function s.lpcost(n)
	return function(e,tp,eg,ep,ev,re,r,rp,chk)
		if chk==0 then return Duel.CheckLPCost(tp,n) end
		Duel.PayLPCost(tp,n)
	end
end
function s.atkcon(e,tp,eg,ep,ev,re,r,rp) return Duel.GetAttacker():IsControler(1-tp) end
${funcs.join('\n')}
`;
}

// ---------- 自由に書いた効果文を読み取る ----------
// 書いた文から「いつ」「何をする」「条件」「数」を探して、エンジンで動く効果に直す。
// 返り値：{ effects, themes（文に出てきた「テーマ名」）, notes（読み取れなかった部分など） }
const KANSUJI = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
function normEffText(s) {
  return String(s || '')
    // 行の終わりに「。」が無ければ足す（行ごとに別の文として読む）
    .split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => (/[。:：]$/.test(l) ? l : l + '。')).join('')
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[一二三四五六七八九](?=[枚体つ度])/g, ch => KANSUJI[ch])
    // いろいろな丸数字（➀➁…、❶❷…）を ①② にそろえる
    .replace(/[➀-➄]/g, ch => '①②③④⑤'[ch.charCodeAt(0) - 0x2780])
    .replace(/[❶-❺]/g, ch => '①②③④⑤'[ch.charCodeAt(0) - 0x2776])
    .replace(/[➊-➎]/g, ch => '①②③④⑤'[ch.charCodeAt(0) - 0x278A])
    .replace(/[\s　]+/g, '')
    // 書き方のゆれ
    .replace(/墓地に送/g, '墓地へ送')
    .replace(/召喚[、,，]特殊召喚/g, '召喚・特殊召喚')
    .replace(/召喚[、,，]反転召喚/g, '召喚・反転召喚')
    .replace(/(召喚|特殊召喚|反転召喚)された/g, '$1した')
    .replace(/墓地に(存在する|ある)このカード/g, '墓地のこのカード')
    .replace(/。+/g, '。');
}
// 縛りの文（「自分は「A」、「B」カードの効果しか発動できない」「自分は「A」モンスターしか特殊召喚できない」）を読む
const LOCK_RE = /しか(?:効果を)?(発動|特殊召喚)できない/;
function parseLockSentence(s) {
  const m = s.match(LOCK_RE);
  if (!m || /1ターンに1(度|回|枚)/.test(s)) return null;
  const head = s.slice(0, m.index);
  const lk = { kind: m[1] === '発動' ? 'act' : 'ss', themes: [] };
  // 「自分は」より後ろの部分（「このカードの効果の発動後、ターン終了時まで自分は〜」）
  const who = head.replace(/^.*自分は/, '');
  lk.themes = [...new Set([...who.matchAll(/「([^」]+)」/g)].map(x => themeByLooseName(x[1])))];
  for (const [k, v] of Object.entries(ATTR)) if (who.includes(v + '属性')) lk.attr = +k;
  let rl = 0;
  for (const [k, v] of Object.entries(RACE)) if (who.includes(v) && v.length > rl) { lk.race = +k; rl = v.length; }
  if (lk.kind === 'ss' && /エクストラデッキから/.test(who)) lk.extra = true;
  if (!lk.themes.length && !lk.attr && !lk.race) return null;
  return lk;
}
function parseEffectText(text, d) {
  const notes = [], themes = [];
  let all = normEffText(text);
  if (!all) return { effects: [], themes, notes: ['文が空です'] };
  // 縛りの文を先に抜き出す。「この効果の発動後」で①などの中にあればその効果だけ、ほかはカードの全部の効果に付ける
  const cardLocks = [], effLocks = {};
  {
    let cur = -1, kept = '';
    for (const s of all.split(/(?<=。)/).filter(Boolean)) {
      if (/^[①②③④⑤](?![、・,，の①②③④⑤])/.test(s)) cur++;
      const lk = LOCK_RE.test(s) ? parseLockSentence(s.replace(/^[①②③④⑤][:：]?/, '')) : null;
      if (!lk) { kept += s; continue; }
      if (/^[①②③④⑤]/.test(s)) kept += s.match(/^[①②③④⑤][:：]?/)[0];   // 番号だけは残す
      if (cur >= 0 && !/このカード(の効果)?(の発動後|を発動)/.test(s)) (effLocks[cur] = effLocks[cur] || []).push(lk);
      else cardLocks.push(lk);
      themes.push(...lk.themes.filter(t => customThemes(d).includes(t)));
    }
    all = kept;
  }
  // ①②…で分ける。無ければ「。」で文ごとにまとめて1つの効果として読む
  // 効果の頭の番号で分ける（「①：」「②」など。「①、②の効果は」「①②の効果は」の番号では分けない）
  const NUM_START = /(?=[①②③④⑤](?![、・,，の①②③④⑤]))/;
  const numbered = /[①②③④⑤](?![、・,，の①②③④⑤])/.test(all);
  let segs = all.split(NUM_START).filter(Boolean);
  let header = '';
  if (numbered && !/^[①②③④⑤]/.test(segs[0])) {
    // 番号より前：「このカード名の〜は1ターンに1度」の文は見出し、残り（番号を書き忘れた①など）は1つ目の効果
    const first = segs.shift();
    let restFirst = '';
    for (const s of first.split(/(?<=。)/).filter(Boolean)) {
      if (/1ターンに1(度|回|枚)しか/.test(s)) header += s; else restFirst += s;
    }
    if (restFirst) segs.unshift(restFirst);
  }
  if (!numbered) {
    // 番号が無いとき：処理（ドローなど）まで書いてある所で1つの効果として区切る
    const ACT = /(ドロー|手札に加え|墓地へ送|特殊召喚|破壊|除外|手札に戻|ダメージ|回復|アップ|無効)/;
    const sentences = all.split(/(?<=。)/).filter(Boolean);
    segs = []; let cur = '';
    for (const s of sentences) {
      if (/1ターンに1(度|回|枚)しか/.test(s)) { header += s; continue; }
      cur += s;
      const k = cur.search(/発動(でき|する)/);
      if (ACT.test(k >= 0 ? cur.slice(k) : cur)) { segs.push(cur); cur = ''; }
    }
    if (cur) { if (segs.length) segs[segs.length - 1] += cur; else segs.push(cur); }
  }
  const allOpt = /カード名のカードは1ターンに1(枚|度)/.test(header) || /1ターンに1(枚|度)しか発動/.test(header);
  const optNums = new Set();
  const hm = header.match(/((?:[①②③④⑤][、・,，]?)+)の効果/);
  if (hm) for (const ch of hm[1].replace(/[、・,，]/g, '')) optNums.add('①②③④⑤'.indexOf(ch));
  else if (/1ターンに1度/.test(header)) segs.forEach((_, i) => optNums.add(i));

  const num = (s, re, def) => { const m = s.match(re); return m ? +m[1] : def; };
  const effects = [];
  segs.forEach((seg, i) => {
    const body = seg.replace(/^[①②③④⑤][:：]?/, '');
    const no = CIRCLED[i] || `${i + 1}つ目`;
    const cutM = body.match(/発動(できる|する)。?/);
    const cut = cutM ? cutM.index : -1;
    let pre = cut >= 0 ? body.slice(0, cut) : '';
    let act = cut >= 0 ? body.slice(cut + cutM[0].length) : body;
    // 「発動できる」が書かれていないとき：「〜場合」「〜時」までを条件として読む
    if (cut < 0) {
      const cm = body.match(/^([^。]*?(?:場合|時|とき))[、,，]?(?=[^。])/);
      if (cm) { pre = cm[1]; act = body.slice(cm[0].length); }
    }
    // 処理の中心は、「発動できる。」のあとの最初の文（「この効果で特殊召喚したモンスターの効果は無効化される」のような後ろの文で決めない）
    const sentences = act.split(/(?<=。)/).filter(Boolean);
    const main = (sentences[0] || '').replace(/。$/, '');
    const rest = sentences.slice(1).join('').replace(/この効果は相手ターンでも発動できる。?/, '');
    // 対象にするもの（「〜を対象として」の前）
    const tgtM = pre.match(/([^、。]*)を対象として/);
    const tgt = tgtM ? tgtM[1] : '';
    const scope = tgt + main;
    // 発動しない効果（「〜する限り」「このカードの攻撃力は〜」など、ずっと続く効果）は作れない
    if (!cutM && /限り|この(カード|モンスター)の(攻撃力|守備力)は|では破壊されない|通常召喚できない|特殊召喚できる。?$/.test(body)) { notes.push(`読み取れなかった文（発動しない効果は作れません）：${seg}`); return; }
    // 「このカード名の①の効果は1ターンに1度」→ 名称ターン1、文の中の「1ターンに1度、」→ ターン1
    const x = { when: '', what: '', n: 1, cnt: 1, optType: allOpt || optNums.has(i) ? 'name' : /1ターンに1度/.test(body) ? 'soft' : 'none', filt: {} };
    const discardSelf = /このカードを手札から(捨て|墓地へ送[っり])/.test(pre);
    // いつ
    const oppAct = /相手が.*発動した(時|とき)|相手の.*発動した(時|とき)|効果が発動した(時|とき)/.test(pre || body);
    const attackDecl = /攻撃宣言時/.test(pre || body);
    if (discardSelf) x.when = oppAct ? 'handchain' : 'handquick';
    else if (/墓地の(この)?カードを除外|墓地から(この)?カードを除外|墓地から除外して/.test(pre)) x.when = 'gyban';
    else if (attackDecl) x.when = d.kind === 'monster' ? 'handattack' : 'attack';
    else if (/手札に(存在|ある)/.test(pre)) x.when = 'handss';
    else if (/墓地へ送られた/.test(pre)) x.when = 'tograve';
    else if (/召喚・(反転召喚・)?特殊召喚(に成功)?した/.test(pre)) x.when = 'summon';
    else if (/特殊召喚(に成功)?した(場合|時|とき)/.test(pre)) x.when = 'spsummon';
    else if (/召喚(に成功)?した(場合|時|とき)/.test(pre)) x.when = 'nsummon';
    else if (oppAct) x.when = d.kind === 'monster' ? 'chain' : 'achain';
    else if (/相手ターンでも|フリーチェーン|自分・相手ターン/.test(body)) x.when = d.kind === 'monster' || isZoneST(d) ? 'quick' : 'activate';
    else x.when = d.kind === 'monster' || isZoneST(d) ? 'ignition' : 'activate';
    if (cutM && cutM[1] === 'する' && CUSTOM_WHEN[x.when] && CUSTOM_WHEN[x.when].trig) x.must = true;   // 「発動する」＝強制効果
    // コスト（「このカードを手札から捨てて」以外の、手札を捨てる・LPを払う）
    if (!discardSelf && /手札(から[^、]*?|を\d+枚)(捨て|墓地へ送[っり])/.test(pre)) {
      x.cost = 'discard';
      if (/手札から[^、]*?(モンスター|魔法|罠)/.test(pre)) notes.push(`${no}：捨てるカードの種類は選べないので「手札を１枚捨てて」にしました`);
    }
    const lp = pre.match(/(?:LP|ＬＰ|ライフポイント)を(\d+)払/) || pre.match(/(\d+)(?:LP|ＬＰ|ライフポイント)を払/);
    if (lp) { x.cost = 'lp'; x.lp = Math.max(100, Math.round(+lp[1] / 100) * 100); }
    else if (/(LP|ＬＰ)を半分払/.test(pre)) notes.push(`${no}：「LPを半分払う」は作れないので、コストは入れていません`);
    // 何をする：処理の文の中で、いちばん前に出てくる言葉で決める
    // 相手フィールドのカードに対してだけ「破壊・除外・手札に戻す」と読む（墓地・デッキのカードの除外などは作れない）
    const opp = (/相手/.test(scope) || /フィールド/.test(scope)) && !/自分フィールド/.test(scope) && !/墓地|デッキ/.test(scope.replace(/墓地へ送/g, ""));
    const at = re => { const m = main.search(re); return m < 0 ? Infinity : m; };
    const cands = [
      ['negate', at(/その(発動|効果)を無効/)],
      ['draw', at(/\d+枚ドロー/)],
      ['self', at(/このカードを(手札から)?(守備表示で|攻撃表示で)?特殊召喚/)],
      ['sp', at(/特殊召喚する/)],
      ['send', /デッキ/.test(main) ? at(/墓地へ送/) : Infinity],
      ['search', at(/手札に加え/)],
      ['bounce', opp ? at(/手札に戻/) : Infinity],
      ['destroyall', at(/全て破壊/)],
      ['banish', opp ? at(/除外/) : Infinity],
      ['destroy', opp ? at(/破壊/) : Infinity],
      ['damage', at(/ダメージを与え/)],
      ['recover', at(/回復/)],
      ['atkup', /攻撃力/.test(main) ? at(/(アップ|上げ|上がる)/) : Infinity],
      ['protect', at(/対象に(取|と)れ|対象にでき|発動に対して/)],
    ].filter(c => c[1] < Infinity).sort((p, q) => p[1] - q[1]);
    let what = cands.length ? cands[0][0] : '';
    if (what === 'sp') {
      // どこから特殊召喚するか
      const src = tgt + main.slice(0, main.search(/特殊召喚する/));
      if (/墓地/.test(src)) { what = 'gyss'; if (/相手の墓地|自分か相手|自分または相手/.test(src)) notes.push(`${no}：相手の墓地からは出せないので、自分の墓地から出す効果にしました`); }
      else if (/デッキ/.test(src)) { what = 'deckss'; if (/手札・デッキ|手札またはデッキ/.test(src)) notes.push(`${no}：「手札・デッキから」は「デッキから」にしました`); }
      else if (/手札/.test(src)) what = 'handsp';
      else what = '';
    }
    if (what === 'negate' && !/その発動を無効/.test(main)) notes.push(`${no}：効果の無効は「その発動を無効にし破壊する」にしました`);
    x.what = what;
    if (!x.what) { notes.push(`読み取れなかった文：${seg}`); return; }
    if (x.what === 'draw') x.n = Math.min(3, num(main, /(\d+)枚ドロー/, 1));
    if (x.what === 'damage') x.n = num(main, /(\d+)(ポイントの)?ダメージ/, 500);
    if (x.what === 'recover') x.n = num(main, /(\d+)(LP|ＬＰ|ライフ)?(ポイント)?回復/, 500);
    if (x.what === 'atkup') x.n = num(main, /(\d+)(アップ|上げ|上がる)/, 500);
    if (x.n > 4000) x.n = 4000;
    if (['damage', 'recover', 'atkup'].includes(x.what)) x.n = Math.max(100, Math.round(x.n / 100) * 100);
    // 守る効果：相手は対象にできない／効果の発動に対して相手は発動できない（どのテーマのカードか）
    if (x.what === 'protect') {
      x.prot = { target: /対象に(取|と)れ|対象にでき/.test(main), chain: /発動に対して/.test(main) };
      const tms = [...main.matchAll(/「([^」]+)」/g)].map(m => themeByLooseName(m[1]));
      if (tms.length) { x.filt.themes = [...new Set(tms)]; themes.push(...x.filt.themes); }
      if (!/このターン/.test(main)) notes.push(`${no}：守る効果は「このターン」だけ続く効果にしました`);
    }
    if (x.what === 'destroyall' && /(攻撃|守備)表示/.test(main)) notes.push(`${no}：「攻撃表示の」などの条件は付けられないので、表示形式に関係なく破壊します`);
    // 相手フィールドのどのカードか
    if (CUSTOM_WHAT[x.what].area) x.area = /魔法・罠/.test(scope) ? 'st' : /モンスター/.test(scope) ? 'monster' : 'card';
    // 条件と数（手札に加える・墓地へ送る・特殊召喚）
    if (CUSTOM_WHAT[x.what].filt) {
      const f = x.filt;
      const fs = scope;
      // 「A」または「B」のように複数書かれていれば、すべて
      const tms = [...fs.matchAll(/「([^」]+)」/g)].map(m => themeByLooseName(m[1]));
      if (tms.length) { f.themes = [...new Set(tms)]; themes.push(...f.themes); }
      const lv = fs.match(/レベル(\d+)(以下|以上)?/);
      if (lv) { f.lv = Math.min(12, +lv[1]); f.lvMode = lv[2] === '以上' ? 'ge' : lv[2] === '以下' ? 'le' : 'eq'; }
      const atk = [...fs.matchAll(/攻撃力(\d+)(以下|以上)/g)], df = [...fs.matchAll(/守備力(\d+)(以下|以上)/g)];
      for (const m of atk) f[m[2] === '以上' ? 'atkGe' : 'atkLe'] = +m[1];
      for (const m of df) f[m[2] === '以上' ? 'defGe' : 'defLe'] = +m[1];
      for (const [k, v] of Object.entries(ATTR)) if (fs.includes(v + '属性')) f.attr = +k;
      for (const [k, v] of Object.entries(RACE)) if (fs.includes(v)) f.race = +k;
      if (!CUSTOM_WHAT[x.what].mon) f.kind = /モンスター/.test(fs) ? 'monster' : /魔法/.test(fs) && !/罠/.test(fs) ? 'spell' : /罠/.test(fs) && !/魔法/.test(fs) ? 'trap' : '';
      x.cnt = Math.max(1, Math.min(5, num(fs, /(\d+)(枚|体)/, 1)));
      if (/\d+(枚|体)まで/.test(fs)) x.upto = true;   // 「３枚まで」＝1枚から選べる
    }
    // 処理に入れなかった後ろの文・「その後」の処理を知らせる
    if (/その後|さらに/.test(main)) notes.push(`${no}：「その後」から先の処理は入れていません`);
    if (rest) notes.push(`${no}：処理に入れていない文：${rest}`);
    // 選んだ効果と合わないタイミングを直す
    if (!CUSTOM_WHEN[x.when].ok(d)) x.when = Object.keys(CUSTOM_WHEN).find(w => CUSTOM_WHEN[w].ok(d)) || 'ignition';
    if (x.what === 'negate' && !isChainWhen(x.when)) {
      x.when = d.kind === 'monster' ? (x.when.startsWith('hand') ? 'handchain' : 'chain') : 'achain';
      if (!CUSTOM_WHEN[x.when].ok(d)) { notes.push(`このカードの種類では「無効にする」効果は作れません：${seg}`); return; }
    }
    if (x.what === 'self' && !['handss', 'tograve', 'handattack'].includes(x.when)) x.when = d.kind === 'monster' && !isExtraMtype(d) ? 'handss' : 'tograve';
    if (x.when === 'handattack' && x.what !== 'self') x.when = 'quick';
    if (!whatOk(d, x.when, x.what)) { notes.push(`このカードでは使えない組み合わせです：${seg}`); return; }
    if (!costOk(x.when)) delete x.cost;
    const lk = (effLocks[i] || [])[0];
    if (lk) x.lock = lk;
    if ((effLocks[i] || []).length > 1) notes.push(`${no}：縛りは1つだけ入れました`);
    effects.push(x);
  });
  // カード全体の縛り：全部の効果に付ける
  if (cardLocks.length) {
    for (const x of effects) if (!x.lock) x.lock = { ...cardLocks[0], themes: [...cardLocks[0].themes] };
    if (cardLocks.length > 1) notes.push('縛りは1つだけ入れました');
  }
  if (cardLocks.length || Object.keys(effLocks).length) {
    const lk = cardLocks[0] || Object.values(effLocks)[0][0];
    notes.push(`✓ 縛りを読み取りました：${lockText(lk)}`);
  }
  const max = maxEffects(d);
  if (effects.length > max) { notes.push(`このカードに入れられる効果は${max}つまでなので、${max + 1}つ目から先は入れていません`); effects.length = max; }
  return { effects, themes: [...new Set(themes)], notes };
}

// ---------- 作る・直す画面 ----------
function newCustomDef() {
  const used = new Set(customList().map(d => d.id));
  let id;
  do id = CUSTOM_ID_MIN + Math.floor(Math.random() * CUSTOM_ID_SPAN); while (used.has(id) || (DB.byId && DB.byId.has(id)));
  return { id, v: 1, name: '', kind: 'monster', mtype: 'effect', tuner: false, attr: 32, race: 2, level: 4, atk: 1500, def: 1000, markers: 0x22, stype: 'normal', ttype: 'normal', theme: '', img: '', flavor: '', memo: '', effects: [{ when: 'summon', what: 'draw', n: 1, optType: 'name', filt: {} }] };
}

// 絵を小さくして保存する（対戦で相手に送るので、小さめの JPEG にする）
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('画像を読めませんでした'));
    r.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('画像を読めませんでした'));
      img.onload = () => {
        // イラストの欄（正方形）に合わせて真ん中を切り出す
        const side = Math.min(img.width, img.height), size = Math.min(320, side);
        const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
        cv.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        resolve(cv.toDataURL('image/jpeg', 0.72));
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}

// 用意された絵（img/art/ の 8属性 × 15枚）から選ぶ
const ART_SETS = [['fire', '火'], ['water', '水'], ['earth', '地'], ['wind', '風'], ['dark', '闇'], ['light', '光'], ['thunder', '雷'], ['ice', '氷']];
let artTab = 'fire';
function openArtPicker(onPick) {
  const tabs = el('div', { class: 'art-tabs' });
  const grid = el('div', { class: 'art-grid' });
  const body = el('div', { class: 'stack' }, tabs, grid);
  let close = null;
  const draw = () => {
    tabs.innerHTML = ''; grid.innerHTML = '';
    for (const [key, label] of ART_SETS) {
      tabs.append(el('button', { type: 'button', class: 'btn small' + (key === artTab ? ' on' : ''), text: label, onclick: () => { artTab = key; draw(); } }));
    }
    for (let i = 1; i <= 15; i++) {
      const url = `img/art/${artTab}_${String(i).padStart(2, '0')}.jpg`;
      grid.append(el('button', { type: 'button', class: 'art-pick', onclick: () => { close && close(); onPick(url); } }, el('img', { src: url, alt: '', loading: 'lazy' })));
    }
  };
  draw();
  close = showModal({ title: '絵を選ぶ', body, wide: true });
}

function openCustomEditor(src, onSaved) {
  const d = JSON.parse(JSON.stringify(src || newCustomDef()));
  if (!Array.isArray(d.effects)) d.effects = [];
  const body = el('div', { class: 'stack custom-editor' });
  const preview = el('div', { class: 'custom-preview' });
  const form = el('div', { class: 'custom-form' });
  body.append(el('div', { class: 'custom-cols' }, preview, form));

  const sel = (opts, value, onchange) => {
    const s = el('select', null, Object.entries(opts).map(([v, t]) => el('option', { value: v, text: t, selected: String(v) === String(value) })));
    s.addEventListener('change', () => onchange(s.value));
    return s;
  };
  const num = (value, min, max, step, onchange) => {
    const i = el('input', { type: 'number', value, min, max, step: step || 1 });
    i.addEventListener('input', () => onchange(i.value === '' ? '' : +i.value));
    return i;
  };
  const field = (label, ...ctl) => el('label', { class: 'custom-field' }, el('span', { class: 'muted', text: label }), ...ctl);
  // 所属テーマ：チェックを付けて選ぶ（3つまで）。公式のテーマと、自分で作ったテーマ
  let themeQuery = '';
  const themePicker = () => {
    const wrap = el('div', { class: 'custom-field custom-themes' });
    const sel0 = customThemes(d);
    const setThemes = list => { d.theme = list.join('、'); render(); };
    const toggle = (name, on) => {
      const cur = customThemes(d).filter(t => t !== name);
      if (on) { if (cur.length >= 3) { toast('テーマは3つまでです'); render(); return; } cur.push(name); }
      setThemes(cur);
    };
    const row = (name, note) => {
      const on = sel0.includes(name);
      const cb = el('input', { type: 'checkbox', checked: on, disabled: !on && sel0.length >= 3 });
      cb.addEventListener('change', () => toggle(name, cb.checked));
      return el('label', { class: 'check theme-opt' + (on ? ' on' : '') }, cb, ' ' + name, note ? el('small', { class: 'muted', text: ' ' + note }) : null);
    };
    const list = el('div', { class: 'theme-list' });
    const drawList = () => {
      list.innerHTML = '';
      const q = normalizeText(themeQuery);
      const hit = name => !q || normalizeText(name).includes(q);
      // 自分のテーマ（ほかのオリジナルカードで使ったもの・このカードで作ったもの）
      const mine = [...new Set([...customList().flatMap(customThemes), ...sel0])].filter(t => !officialThemes().has(t) && hit(t));
      if (mine.length) list.append(el('div', { class: 'theme-head', text: '自分で作ったテーマ' }), ...mine.map(t => row(t, 'オリジナル')));
      const off = [...officialThemes().values()].filter(o => hit(o.name));
      const shown = (q ? off : off.slice(0, 40));
      // 選んでいる公式のテーマは、検索に当てはまらなくても上に出す
      const picked = sel0.filter(t => officialThemes().has(t) && !shown.some(o => o.name === t)).map(t => officialThemes().get(t));
      list.append(el('div', { class: 'theme-head', text: q ? `公式のテーマ（${off.length}件）` : '公式のテーマ（カードが多い順。名前で探せます）' }),
        ...[...picked, ...shown.slice(0, 120)].map(o => row(o.name, `${o.n}枚`)));
      if (!off.length && !mine.length) list.append(el('div', { class: 'muted small-note', text: '見つかりません。下の欄から新しいテーマとして作れます' }));
    };
    const search = el('input', { type: 'search', class: 'full', placeholder: 'テーマを名前で探す（例：ブラック・マジシャン）', value: themeQuery });
    search.addEventListener('input', () => { themeQuery = search.value; drawList(); });
    const newName = el('input', { type: 'text', placeholder: '新しいテーマの名前', maxlength: 20 });
    const add = () => { const v = newName.value.trim(); if (!v) return; if (!customThemes(d).includes(v)) toggle(v, true); };
    newName.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    drawList();
    wrap.append(el('span', { class: 'muted', text: '所属テーマ（チェックを付けたテーマのカードとして扱います。3つまで）' }),
      el('div', { class: 'theme-chips' }, sel0.length ? sel0.map(t => el('span', { class: 'theme-chip' }, `「${t}」`, el('button', { type: 'button', title: '外す', text: '✕', onclick: () => toggle(t, false) }))) : el('span', { class: 'muted small-note', text: 'テーマなし' })),
      search, list,
      el('div', { class: 'row' }, newName, el('button', { type: 'button', class: 'btn small', text: '＋ 新しいテーマを作って付ける', onclick: add })));
    return wrap;
  };
  // リンクマーカーを選ぶ 3×3 のボタン
  const markerGrid = () => {
    const grid = el('div', { class: 'custom-arrows' });
    for (const [bit, ch] of LINK_ARROWS) {
      if (!bit) { grid.append(el('span')); continue; }
      const b = el('button', { type: 'button', class: 'btn small' + (d.markers & bit ? ' on' : ''), text: ch, onclick: () => { d.markers ^= bit; b.classList.toggle('on'); redrawPreview(); } });
      grid.append(b);
    }
    return grid;
  };

  const redrawPreview = () => {
    preview.innerHTML = '';
    preview.append(cardFace({ ...customToCard(d), id: 0 }), el('div', { class: 'muted small-note', text: '効果文は選んだ効果から自動で作ります' }));
    // プレビューの絵（id を 0 にしているので、ここで直接入れる）
    if (d.img) { const art = preview.querySelector('.jp-art'); if (art) art.prepend(el('div', { class: 'jp-userart' }, el('img', { src: d.img, alt: '' }))); }
  };

  const render = () => {
    form.innerHTML = '';
    const name = el('input', { type: 'text', value: d.name, class: 'full', placeholder: 'カード名', maxlength: 40 });
    name.addEventListener('input', () => { d.name = name.value; redrawPreview(); });
    form.append(field('カード名', name));
    form.append(field('種類', sel({ monster: 'モンスター', spell: '魔法', trap: '罠' }, d.kind, v => { d.kind = v; fixEffects(); render(); })));
    if (d.kind === 'monster') {
      form.append(field('モンスターの種類', sel(CUSTOM_MTYPES, d.mtype, v => { d.mtype = v; if (v === 'link' && d.level > 6) d.level = 2; fixEffects(); render(); })));
      const row = el('div', { class: 'custom-row' });
      row.append(field('属性', sel(ATTR, d.attr, v => { d.attr = +v; redrawPreview(); })), field('種族', sel(RACE, d.race, v => { d.race = +v; redrawPreview(); })));
      form.append(row);
      const row2 = el('div', { class: 'custom-row' });
      const lvLabel = d.mtype === 'xyz' ? 'ランク' : d.mtype === 'link' ? 'リンク' : 'レベル';
      row2.append(field(lvLabel, num(d.level, 1, d.mtype === 'link' ? 6 : 12, 1, v => { d.level = v; redrawPreview(); })),
        field('攻撃力', num(d.atk, 0, 9999, 100, v => { d.atk = v; redrawPreview(); })));
      if (d.mtype !== 'link') row2.append(field('守備力', num(d.def, 0, 9999, 100, v => { d.def = v; redrawPreview(); })));
      form.append(row2);
      if (d.mtype === 'link') form.append(field('リンクマーカー', markerGrid()));
      if (!['xyz', 'link'].includes(d.mtype)) {
        const tu = el('input', { type: 'checkbox', checked: !!d.tuner });
        tu.addEventListener('change', () => { d.tuner = tu.checked; redrawPreview(); });
        form.append(el('label', { class: 'check' }, tu, ' チューナー'));
      }
    } else {
      if (d.kind === 'spell') form.append(field('魔法の種類', sel(CUSTOM_STYPES, d.stype, v => { d.stype = v; fixEffects(); render(); })));
      else form.append(field('罠の種類', sel(CUSTOM_TTYPES, d.ttype, v => { d.ttype = v; fixEffects(); render(); })));
      // リンクマーカーを持つ魔法・罠（マーカーの先のモンスターゾーンを指す）
      const lk = el('input', { type: 'checkbox', checked: !!d.stLink });
      lk.addEventListener('change', () => { d.stLink = lk.checked; if (d.stLink && !d.markers) d.markers = 0x02; render(); });
      form.append(el('label', { class: 'check' }, lk, ' リンクマーカーを持つ'));
      if (d.stLink) form.append(field('リンクマーカー（魔法＆罠ゾーンから、マーカーの先のモンスターゾーンを指します）', markerGrid()));
    }
    form.append(themePicker());

    // 絵
    const file = el('input', { type: 'file', accept: 'image/*' });
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      try { d.img = await shrinkImage(f); redrawPreview(); } catch (e) { toast(e.message); }
    });
    const pick = el('button', { type: 'button', class: 'btn small accent', text: '🖼 用意された絵から選ぶ', onclick: () => openArtPicker(async url => {
      try { const blob = await (await fetch(url)).blob(); d.img = await shrinkImage(blob); render(); redrawPreview(); } catch (e) { toast('絵を読み込めませんでした'); }
    }) });
    form.append(field('イラスト（画像を選ぶ）', pick, file, d.img ? el('button', { type: 'button', class: 'btn small', text: '絵を外す', onclick: () => { d.img = ''; render(); redrawPreview(); } }) : null));

    // 効果
    if (d.kind === 'monster' && d.mtype === 'normal') {
      const fl = el('textarea', { rows: 3, class: 'full', placeholder: 'フレーバーテキスト（なくてもよい）' }, d.flavor || '');
      fl.addEventListener('input', () => { d.flavor = fl.value; redrawPreview(); });
      form.append(field('テキスト', fl));
    } else {
      const max = maxEffects(d);
      const box = el('div', { class: 'custom-effects' });
      d.effects.slice(0, max).forEach((x, i) => box.append(effectRow(x, i)));
      // 空いている枠（①〜⑤）。押すとその枠に効果を作る
      for (let i = d.effects.length; i < max; i++) {
        box.append(el('div', { class: 'custom-effect empty' }, el('b', { text: CIRCLED[i] }),
          el('button', { type: 'button', class: 'btn small', text: '＋ この枠に効果を作る', onclick: () => { d.effects.push(defaultEffect()); render(); } })));
      }
      // 自由に書く → 読み取って下の効果に入れる → 下で直す
      const src = el('textarea', { rows: 4, class: 'full', placeholder: '例：①：このカードが召喚に成功した場合に発動できる。デッキから「蒼炎」モンスター1体を手札に加える。\n②：相手が効果を発動した時、このカードを手札から捨てて発動できる。その発動を無効にし破壊する。' }, d.src || '');
      src.addEventListener('input', () => { d.src = src.value; if (d.useSrc) redrawPreview(); });
      const result = el('div', { class: 'custom-parse-note' });
      if (d.parseNote) result.append(...d.parseNote.map(t => el('div', { class: t.startsWith('✓') ? '' : 'warn', text: t })));
      const read = el('button', { type: 'button', class: 'btn small accent', text: '✨ この文から効果を作る', onclick: () => {
        const r = parseEffectText(d.src, d);
        const notes = [];
        if (r.effects.length) {
          d.effects = r.effects;
          // 文に出てきた「テーマ名」を、このカードのテーマにも足す（3つまで）
          const ts = customThemes(d);
          const add = r.themes.filter(t => !ts.includes(t));
          if (add.length && ts.length < 3) { d.theme = [...ts, ...add].slice(0, 3).join('、'); notes.push(`✓ テーマ名に「${add.slice(0, 3 - ts.length).join('」「')}」を足しました`); }
          notes.push(`✓ ${r.effects.length}つの効果を読み取りました。下で確かめて、違うところを直してください`);
        } else notes.push('効果を読み取れませんでした。下で選んで作ってください');
        d.parseNote = [...notes, ...r.notes];
        render();
      } });
      const useSrc = el('input', { type: 'checkbox', checked: !!d.useSrc });
      useSrc.addEventListener('change', () => { d.useSrc = useSrc.checked; redrawPreview(); });
      form.append(el('h4', { text: '効果を自由に書く' }),
        el('div', { class: 'muted small-note', text: '書いた文から「いつ・何をする・条件・数」を読み取って、下の効果に入れます。そのあと下で直せます（動くのは下の効果のとおりです）' }),
        src, el('div', { class: 'row' }, read), result,
        el('label', { class: 'check' }, useSrc, ' カードには自分の書いた文をそのまま表示する'));
      form.append(el('h4', { text: max > 1 ? `効果（${max}枠。効果ごとに「いつ・何をする・1ターンに使える回数」を決めます）` : '効果' }), box);
      const memo = el('textarea', { rows: 2, class: 'full', placeholder: '効果文の最後に足す文（表示だけ。処理はされません）' }, d.memo || '');
      memo.addEventListener('input', () => { d.memo = memo.value; redrawPreview(); });
      form.append(field('メモ（任意）', memo));
    }
    redrawPreview();
  };

  const defaultEffect = () => {
    const when = Object.keys(CUSTOM_WHEN).find(w => CUSTOM_WHEN[w].ok(d)) || 'ignition';
    return { when, what: 'draw', n: 1, optType: d.kind === 'monster' ? 'name' : 'none', filt: {} };
  };
  // 種類を変えたとき：選べなくなったタイミング・効果を直す
  const fixEffects = () => {
    d.effects = d.effects.slice(0, maxEffects(d));
    for (const x of d.effects) {
      if (!CUSTOM_WHEN[x.when] || !CUSTOM_WHEN[x.when].ok(d)) x.when = defaultEffect().when;
      if (!whatOk(d, x.when, x.what)) x.what = 'draw';
    }
    if (!d.effects.length && maxEffects(d) && d.kind !== 'monster') d.effects.push(defaultEffect());
  };

  const effectRow = (x, i) => {
    const row = el('div', { class: 'custom-effect' });
    const whens = Object.fromEntries(Object.entries(CUSTOM_WHEN).filter(([, w]) => w.ok(d)).map(([k, w]) => [k, w.label]));
    const whats = Object.fromEntries(Object.entries(CUSTOM_WHAT).filter(([k]) => whatOk(d, x.when, k)).map(([k, w]) => [k, w.label]));
    if (!whats[x.what]) x.what = Object.keys(whats)[0];
    const w = CUSTOM_WHAT[x.what];
    row.append(el('div', { class: 'row between' }, el('b', { text: CIRCLED[i] || `効果${i + 1}` }),
      el('button', { type: 'button', class: 'btn small danger', text: '✕ 消す', onclick: () => { d.effects.splice(i, 1); render(); } })));
    row.append(field('いつ', sel(whens, x.when, v => { x.when = v; if (!whatOk(d, v, x.what)) x.what = v === 'handss' ? 'self' : isChainWhen(v) ? 'negate' : 'draw'; render(); })));
    row.append(field('何をする', sel(whats, x.what, v => { x.what = v; render(); })));
    if (w && w.n) {
      const [lo, hi, step] = w.n;
      if (!x.n || x.n < lo || x.n > hi) x.n = lo === 1 ? 1 : 500;
      row.append(field(x.what === 'draw' ? '枚数' : '数値', num(x.n, lo, hi, step || 1, v => { x.n = v; redrawPreview(); })));
    }
    if (w && w.filt) {
      x.filt = x.filt || {};
      const f = x.filt;
      const fr = el('div', { class: 'custom-row' });
      if (!w.mon) fr.append(field('カードの種類', sel({ '': 'どれでも', monster: 'モンスター', spell: '魔法', trap: '罠' }, f.kind || '', v => { f.kind = v; render(); })));
      if (w.mon || f.kind === 'monster') {
        fr.append(field('属性', sel({ '': 'どれでも', ...ATTR }, f.attr || '', v => { f.attr = v ? +v : 0; redrawPreview(); })),
          field('種族', sel({ '': 'どれでも', ...RACE }, f.race || '', v => { f.race = v ? +v : 0; redrawPreview(); })),
          field('レベル', num(f.lv || '', 1, 12, 1, v => { f.lv = v || 0; redrawPreview(); })),
          field('レベルの条件', sel({ le: '以下', ge: '以上', eq: 'ちょうど' }, f.lvMode || 'le', v => { f.lvMode = v; redrawPreview(); })));
        // 攻撃力・守備力（空欄＝条件なし）
        const stat = (key, label) => field(label, num(f[key] ?? '', 0, 5000, 100, v => { if (v === '') delete f[key]; else f[key] = v; redrawPreview(); }));
        fr.append(stat('atkGe', '攻撃力〜以上'), stat('atkLe', '攻撃力〜以下'), stat('defGe', '守備力〜以上'), stat('defLe', '守備力〜以下'));
      }
      const ts = customThemes(d);
      if (ts.length) {
        // チェックしたテーマのどれかのカード（何もチェックしなければテーマは問わない）
        f.themes = filtThemes(f, d); delete f.theme;
        const box = el('div', { class: 'custom-field eff-themes' }, el('span', { class: 'muted', text: 'テーマ（チェックしたテーマのどれかのカード。チェックなし＝どれでも）' }));
        const opts = el('div', { class: 'theme-chips' });
        for (const t of ts) {
          const cb = el('input', { type: 'checkbox', checked: f.themes.includes(t) });
          cb.addEventListener('change', () => { f.themes = ts.filter(n => n === t ? cb.checked : f.themes.includes(n)); redrawPreview(); });
          opts.append(el('label', { class: 'check' }, cb, ` ${themeLabel(t)}のカード`));
        }
        box.append(opts);
        fr.append(box);
      } else {
        fr.append(el('span', { class: 'muted small-note', text: 'テーマ名を入れると「テーマのカードだけ」にできます' }));
      }
      row.append(fr);
      x.cnt = effCount(x);
      const upto = el('input', { type: 'checkbox', checked: !!x.upto });
      upto.addEventListener('change', () => { x.upto = upto.checked; redrawPreview(); });
      row.append(el('div', { class: 'custom-row' }, field(w.mon ? '体数' : '枚数', num(x.cnt, 1, 5, 1, v => { x.cnt = v === '' ? 1 : Math.max(1, Math.min(5, v)); redrawPreview(); })),
        el('label', { class: 'check' }, upto, ' 「〜まで」（1枚から選べる）')));
    }
    // 守る効果：対象にできない／チェーンできない、どのテーマのカードか
    if (w && w.prot) {
      x.prot = x.prot || { target: true, chain: true };
      x.filt = x.filt || {};
      const cb = (key, label) => { const i2 = el('input', { type: 'checkbox', checked: !!x.prot[key] }); i2.addEventListener('change', () => { x.prot[key] = i2.checked; redrawPreview(); }); return el('label', { class: 'check' }, i2, ' ' + label); };
      row.append(cb('target', '相手は効果の対象にできない'), cb('chain', '効果の発動に対して相手は効果を発動できない'));
      const ts = customThemes(d);
      if (ts.length) {
        x.filt.themes = filtThemes(x.filt, d); delete x.filt.theme;
        const opts = el('div', { class: 'theme-chips' });
        for (const t of ts) {
          const c2 = el('input', { type: 'checkbox', checked: x.filt.themes.includes(t) });
          c2.addEventListener('change', () => { x.filt.themes = ts.filter(n => n === t ? c2.checked : x.filt.themes.includes(n)); redrawPreview(); });
          opts.append(el('label', { class: 'check' }, c2, ` ${themeLabel(t)}のカード`));
        }
        row.append(el('div', { class: 'custom-field eff-themes' }, el('span', { class: 'muted', text: '守るカード（チェックなし＝自分のカード全部）' }), opts));
      }
    }
    // 相手フィールドのどのカードか
    if (w && w.area) row.append(field('相手フィールドの', sel(CUSTOM_AREAS, CUSTOM_AREAS[x.area] ? x.area : 'card', v => { x.area = v; redrawPreview(); })));
    // コスト（手札から捨てる・墓地から除外するタイミング以外）
    if (costOk(x.when)) {
      const cr = el('div', { class: 'custom-row' });
      cr.append(field('コスト', sel(CUSTOM_COSTS, x.cost || '', v => { x.cost = v; render(); })));
      if (x.cost === 'lp') { x.lp = x.lp || 1000; cr.append(field('払うLP', num(x.lp, 100, 8000, 100, v => { x.lp = v || 1000; redrawPreview(); }))); }
      row.append(cr);
    } else delete x.cost;
    // 誘発効果：強制（必ず発動する）にできる
    if (CUSTOM_WHEN[x.when] && CUSTOM_WHEN[x.when].trig) {
      const m = el('input', { type: 'checkbox', checked: !!x.must });
      m.addEventListener('change', () => { x.must = m.checked; redrawPreview(); });
      row.append(el('label', { class: 'check' }, m, ' 強制効果（「発動する」。条件を満たすと必ず発動する）'));
    } else delete x.must;
    // 1ターンに使える回数（効果ごと）。魔法・罠の発動だけのカードは「名称ターン1」か「制限なし」
    const single = maxEffects(d) === 1 && CUSTOM_WHEN[x.when] && CUSTOM_WHEN[x.when].card;
    const opts = single ? { none: '制限なし', name: '名称ターン1（このカード名のカードは1ターンに1枚しか発動できない）' } : OPT_TYPES;
    x.optType = optOf(x); delete x.opt;
    if (!opts[x.optType]) x.optType = 'name';
    row.append(field('1ターンに使える回数', sel(opts, x.optType, v => { x.optType = v; redrawPreview(); })));
    // 縛り（この効果の発動後、ターン終了時まで〜しか発動できない／特殊召喚できない）
    const lk = x.lock || null;
    const lr = el('div', { class: 'custom-row' });
    lr.append(field('縛り（発動後、ターン終了時まで）', sel({ '': 'なし', act: '決めたカードの効果しか発動できない', ss: '決めたモンスターしか特殊召喚できない' }, lk ? lk.kind : '', v => {
      if (!v) delete x.lock; else x.lock = { ...(x.lock || { themes: customThemes(d).slice(0, 1) }), kind: v };
      render();
    })));
    if (lk) {
      const ti = el('input', { type: 'text', value: (lk.themes || []).join('、'), placeholder: '例：オルフェゴール、星遺物' });
      ti.addEventListener('input', () => { lk.themes = [...new Set(ti.value.split(/[、,，\/／]+/).map(s => s.replace(/[「」『』]/g, '').trim()).filter(Boolean).map(themeByLooseName))]; redrawPreview(); });
      lr.append(field('テーマ名（「、」で区切る）', ti),
        field('属性', sel({ '': 'どれでも', ...ATTR }, lk.attr || '', v => { lk.attr = v ? +v : 0; redrawPreview(); })),
        field('種族', sel({ '': 'どれでも', ...RACE }, lk.race || '', v => { lk.race = v ? +v : 0; redrawPreview(); })));
      if (lk.kind === 'ss') {
        const ex = el('input', { type: 'checkbox', checked: !!lk.extra });
        ex.addEventListener('change', () => { lk.extra = ex.checked; redrawPreview(); });
        lr.append(el('label', { class: 'check' }, ex, ' エクストラデッキから特殊召喚するときだけ'));
      }
      lr.append(el('span', { class: 'muted small-note', text: 'テーマ名・属性・種族のどれかを決めてください（決めないと縛りは付きません）' }));
    }
    row.append(lr);
    return row;
  };

  fixEffects();
  render();
  showModal({
    title: src ? 'オリジナルカードを直す' : 'オリジナルカードを作る', body, wide: true,
    buttons: [{
      label: '保存', primary: true, onClick: () => {
        d.name = (d.name || '').trim();
        delete d.parseNote;
        if (!d.name) { toast('カード名を入れてください'); return false; }
        if (((d.kind === 'monster' && d.mtype === 'link') || (d.kind !== 'monster' && d.stLink)) && !d.markers) { toast('リンクマーカーを1つ以上選んでください'); return false; }
        saveCustomDef(d);
        toast(`「${d.name}」を保存しました`);
        onSaved && onSaved(d);
      },
    }],
  });
}

function saveCustomDef(d) {
  const list = customList();
  const i = list.findIndex(x => x.id === d.id);
  if (i >= 0) list[i] = d; else list.push(d);
  store.set(CUSTOM_KEY, list);
  registerCustom(d);
  if (typeof Engine !== 'undefined') Engine.scripts.delete(`c${d.id}.lua`);
  refreshAfterCustom();
}
function deleteCustomDef(id) {
  store.set(CUSTOM_KEY, customList().filter(x => x.id !== id));
  unregisterCustom(id);
  refreshAfterCustom();
}
function refreshAfterCustom() {
  if (typeof renderResults === 'function') try { renderResults(); } catch { /* 画面がまだ無い */ }
  if (typeof renderDeck === 'function') try { renderDeck(); } catch { /* 画面がまだ無い */ }
}

// 一覧の画面
function openCustomList() {
  const body = el('div', { class: 'stack' });
  let close = null;
  const draw = () => {
    body.innerHTML = '';
    body.append(el('p', { class: 'muted small-note', text: '自分で作ったカードです。デッキに入れて、一人回し・対戦で使えます（効果はルールどおり自動で処理されます）。対戦では、相手の画面にもカードの内容が送られます。作ったカードはこの端末のブラウザに保存されます。' }));
    body.append(el('button', { class: 'btn primary', text: '＋ 新しく作る', onclick: () => openCustomEditor(null, () => draw()) }));
    const list = customList();
    if (!list.length) body.append(el('p', { class: 'muted', text: 'まだありません' }));
    const grid = el('div', { class: 'custom-list' });
    for (const d of list) {
      const c = DB.byId.get(d.id) || customToCard(d);
      grid.append(el('div', { class: 'custom-item' },
        el('div', { class: 'custom-face', onclick: () => showDeckCard ? showDeckCard(c) : null }, cardFace(c, { small: true })),
        el('div', { class: 'custom-btns' },
          el('button', { class: 'btn small primary', text: '＋ デッキに入れる', onclick: () => { addToDeck(c); } }),
          el('button', { class: 'btn small', text: '✎ 直す', onclick: () => openCustomEditor(d, () => draw()) }),
          el('button', { class: 'btn small danger', text: '✕ 削除', onclick: () => { if (confirm(`「${d.name}」を削除しますか？（デッキに入っている分は「不明なカード」になります）`)) { deleteCustomDef(d.id); draw(); } } }))));
    }
    body.append(grid);
  };
  draw();
  close = showModal({ title: 'オリジナルカード', body, wide: true });
  return close;
}

// 対戦で相手に送る：デッキに入っているオリジナルカードの中身
function customDefsOfDeck(deck) {
  const ids = new Set([...(deck.main || []), ...(deck.extra || []), ...(deck.side || [])].map(Number).filter(isCustomId));
  return [...ids].map(id => customDefOf(id)).filter(Boolean);
}
// 相手から届いたオリジナルカードを使えるようにする（自分のカードと同じ番号なら、自分のものを使う）
function receiveCustomDefs(defs) {
  for (const d of defs || []) {
    if (!d || !isCustomId(d.id)) continue;
    const mine = customList().find(x => x.id === d.id);
    if (mine) { if (!DB.byId.has(d.id)) registerCustom(mine); continue; }
    Custom.others.set(d.id, d);
    registerCustom(d);
    if (typeof Engine !== 'undefined') Engine.scripts.delete(`c${d.id}.lua`);
  }
}

// デッキ作成の「オリジナルカード」ボタン
{ const b = document.getElementById('deck-custom'); if (b) b.addEventListener('click', () => openCustomList()); }
