// OCG のサンプルデッキ（手で決める）。
// OCG の大会のリストは自動で取れる形の公開データが無いので、その期間に OCG の大会で入賞しているデッキタイプを選び、
// 中身はマスターデュエルの大会上位のリスト（data/md-samples.js）を元にする。アプリで追加するとき、OCG の禁止・制限に合わせて枚数を直す。
// periods：{ OCG のリストの開始日: { note: 説明, types: [[OCG での呼び名, マスターデュエルのデッキタイプ名]] } }
const OCG_SAMPLE_PICKS = {
  '2026-10-01': {
    note: '2026年10月のOCGの大会（超蓮杯・Mogi杯など）で入賞しているデッキタイプ',
    types: [
      ['エルフェンノーツ', 'Elfnote'],
      ['ドラゴンテイル', 'Dracotail'],
      ['獄神', 'Power Patron'],
      ['磁石の戦士', 'Magnet Warrior'],
      ['M∀LICE', 'Maliss'],
    ],
  },
};
