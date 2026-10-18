// カードデータ（YGOPro形式）の定数と表示用ヘルパー
const T = {
  MONSTER: 0x1, SPELL: 0x2, TRAP: 0x4, NORMAL: 0x10, EFFECT: 0x20, FUSION: 0x40,
  RITUAL: 0x80, TRAPMONSTER: 0x100, SPIRIT: 0x200, UNION: 0x400, GEMINI: 0x800,
  TUNER: 0x1000, SYNCHRO: 0x2000, TOKEN: 0x4000, QUICKPLAY: 0x10000,
  CONTINUOUS: 0x20000, EQUIP: 0x40000, FIELD: 0x80000, COUNTER: 0x100000,
  FLIP: 0x200000, TOON: 0x400000, XYZ: 0x800000, PENDULUM: 0x1000000,
  SPSUMMON: 0x2000000, LINK: 0x4000000,
};
const EXTRA_MASK = T.FUSION | T.SYNCHRO | T.XYZ | T.LINK;

const ATTR = { 1: '地', 2: '水', 4: '炎', 8: '風', 16: '光', 32: '闇', 64: '神' };
const RACE = {
  0x1: '戦士族', 0x2: '魔法使い族', 0x4: '天使族', 0x8: '悪魔族', 0x10: 'アンデット族',
  0x20: '機械族', 0x40: '水族', 0x80: '炎族', 0x100: '岩石族', 0x200: '鳥獣族',
  0x400: '植物族', 0x800: '昆虫族', 0x1000: '雷族', 0x2000: 'ドラゴン族', 0x4000: '獣族',
  0x8000: '獣戦士族', 0x10000: '恐竜族', 0x20000: '魚族', 0x40000: '海竜族',
  0x80000: '爬虫類族', 0x100000: 'サイキック族', 0x200000: '幻神獣族', 0x400000: '創造神族',
  0x800000: '幻竜族', 0x1000000: 'サイバース族', 0x2000000: '幻想魔族',
};
// リンクマーカー（守備力の欄にビットで入っている）
const LINK_ARROWS = [
  [0x40, '↖'], [0x80, '↑'], [0x100, '↗'],
  [0x08, '←'], [0, ''], [0x20, '→'],
  [0x01, '↙'], [0x02, '↓'], [0x04, '↘'],
];

const has = (c, bit) => (c.type & bit) !== 0;
const isMonster = c => has(c, T.MONSTER);
const isExtraType = c => isMonster(c) && has(c, EXTRA_MASK);
const isToken = c => has(c, T.TOKEN);

function levelKind(c) {
  if (has(c, T.LINK)) return 'link';
  if (has(c, T.XYZ)) return 'rank';
  return 'level';
}

// 「ドラゴン族／効果／チューナー」のような種類表示
function typeLine(c) {
  if (has(c, T.SPELL)) {
    if (has(c, T.QUICKPLAY)) return '速攻魔法';
    if (has(c, T.CONTINUOUS)) return '永続魔法';
    if (has(c, T.EQUIP)) return '装備魔法';
    if (has(c, T.FIELD)) return 'フィールド魔法';
    if (has(c, T.RITUAL)) return '儀式魔法';
    return '通常魔法';
  }
  if (has(c, T.TRAP)) {
    if (has(c, T.CONTINUOUS)) return '永続罠';
    if (has(c, T.COUNTER)) return 'カウンター罠';
    return '通常罠';
  }
  const parts = [RACE[c.race] || '？族'];
  const pairs = [
    [T.FUSION, '融合'], [T.RITUAL, '儀式'], [T.SYNCHRO, 'シンクロ'], [T.XYZ, 'エクシーズ'],
    [T.LINK, 'リンク'], [T.PENDULUM, 'ペンデュラム'], [T.TOON, 'トゥーン'], [T.SPIRIT, 'スピリット'],
    [T.UNION, 'ユニオン'], [T.GEMINI, 'デュアル'], [T.TUNER, 'チューナー'], [T.FLIP, 'リバース'],
    [T.SPSUMMON, '特殊召喚'], [T.TOKEN, 'トークン'],
  ];
  for (const [bit, label] of pairs) if (has(c, bit)) parts.push(label);
  if (has(c, T.EFFECT)) parts.push('効果');
  else if (has(c, T.NORMAL)) parts.push('通常');
  return parts.join('／');
}

// カード枠の色クラス
function frameClass(c) {
  if (has(c, T.SPELL)) return 'f-spell';
  if (has(c, T.TRAP)) return 'f-trap';
  let base = 'f-effect';
  if (has(c, T.TOKEN)) base = 'f-token';
  else if (has(c, T.LINK)) base = 'f-link';
  else if (has(c, T.XYZ)) base = 'f-xyz';
  else if (has(c, T.SYNCHRO)) base = 'f-synchro';
  else if (has(c, T.FUSION)) base = 'f-fusion';
  else if (has(c, T.RITUAL)) base = 'f-ritual';
  else if (has(c, T.NORMAL)) base = 'f-normal';
  return has(c, T.PENDULUM) ? base + ' f-pend' : base;
}

// 「★4」「ランク4」「LINK-2」
function levelText(c) {
  if (!isMonster(c)) return '';
  const k = levelKind(c);
  if (k === 'link') return 'LINK-' + c.level;
  if (k === 'rank') return '☆' + c.level;
  return '★' + c.level;
}

function statText(c) {
  if (!isMonster(c)) return '';
  const atk = c.atk < 0 ? '?' : c.atk;
  if (has(c, T.LINK)) return `ATK ${atk}`;
  const def = c.def < 0 ? '?' : c.def;
  return `${atk} / ${def}`;
}

function linkArrowsText(c) {
  if (!has(c, T.LINK)) return '';
  return LINK_ARROWS.filter(([b]) => b && (c.def & b)).map(([, a]) => a).join(' ');
}

// 並び順：モンスター（メイン→EX）→魔法→罠
function typeOrder(c) {
  if (isMonster(c)) {
    if (has(c, T.FUSION)) return 3;
    if (has(c, T.SYNCHRO)) return 4;
    if (has(c, T.XYZ)) return 5;
    if (has(c, T.LINK)) return 6;
    return has(c, T.NORMAL) ? 0 : (has(c, T.RITUAL) ? 2 : 1);
  }
  return has(c, T.SPELL) ? 7 : 8;
}

function compareCards(a, b) {
  return typeOrder(a) - typeOrder(b) || (b.level - a.level) || a.name.localeCompare(b.name, 'ja');
}

const OFFICIAL_DB_URL = cid =>
  `https://www.db.yugioh-card.com/yugiohdb/card_search.action?ope=2&cid=${cid}&request_locale=ja`;
