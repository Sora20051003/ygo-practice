// ---------- 一人回しの盤面を複数（ページ）にする ----------
// 一人回しの今の盤面は ygo.board（手動）・ygo.autoBoard（効果を自動処理）・ygo.boardMode（どちらか）に保存している。
// ページを切り替えるときは、今のページのこれらを ygo.slot.<id> にしまい、切り替え先のページの分を戻してから、いつもの「続きから」で開き直す。
// ページの一覧は ygo.slots = { list: [{ id, name }], cur: id }
const SLOT_MAX = 10;
const Slots = { rec: new Map() };   // 手動の記録（盤面の記録用。大きいので保存はせず、ページごとにメモリにだけ持つ）

function slotsState() {
  let s = store.get('ygo.slots', null);
  if (!s || !Array.isArray(s.list) || !s.list.length) s = { list: [{ id: 's1', name: '盤面1' }], cur: 's1' };
  if (!s.list.some(x => x.id === s.cur)) s.cur = s.list[0].id;
  return s;
}
function saveSlotsState(s) { store.set('ygo.slots', s); }

// 今のページの盤面をしまう
function stashCurrentSlot() {
  const s = slotsState();
  if (Auto.on && Auto.duel && !Auto.net) autoSave();
  else if (Board.S && !Board.S.auto) persist();
  store.set('ygo.slot.' + s.cur, {
    board: store.get('ygo.board', null),
    auto: store.get('ygo.autoBoard', null),
    mode: store.get('ygo.boardMode', 'manual'),
    deckId: $('#b-deck') ? $('#b-deck').value : null,
  });
  if (typeof Rec !== 'undefined') Slots.rec.set(s.cur, Rec.manual);
}
// ページの盤面を戻して開く
function openSlot(id) {
  const data = store.get('ygo.slot.' + id, null) || { board: null, auto: null, mode: store.get('ygo.boardMode', 'manual'), deckId: null };
  store.set('ygo.board', data.board);
  store.set('ygo.autoBoard', data.auto);
  store.set('ygo.boardMode', data.mode || 'manual');
  // 動いているもの（選択の窓・CPU の手番など）を止めて、盤面を作り直す
  closeAllModals();
  if (typeof closePromptModal === 'function') closePromptModal();
  if (typeof hideActionPopup === 'function') hideActionPopup();
  Auto.duel = null; Auto.resumed = false; Auto.redoLog = null; Auto.selQueue = null;
  Board.S = null; Board.initial = null; Board.history = []; Board.future = []; Board.pick = null;
  if (typeof Rec !== 'undefined') Rec.manual = Slots.rec.get(id) || null;
  if (data.deckId && $('#b-deck') && [...$('#b-deck').options].some(o => o.value === data.deckId)) $('#b-deck').value = data.deckId;
  setBoardMode((data.mode || 'manual') === 'auto');
}

function switchSlot(id) {
  if (typeof Duel !== 'undefined' && Duel.active) { toast('対戦中はページを切り替えられません'); return; }
  if (typeof Rep !== 'undefined' && Rep.on) { toast('記録の再生中はページを切り替えられません'); return; }
  const s = slotsState();
  if (id === s.cur) return;
  stashCurrentSlot();
  s.cur = id;
  saveSlotsState(s);
  openSlot(id);
  renderSlots();
}
function addSlot() {
  const s = slotsState();
  if (s.list.length >= SLOT_MAX) { toast(`ページは${SLOT_MAX}個までです`); return; }
  let n = s.list.length + 1;
  while (s.list.some(x => x.name === '盤面' + n)) n++;
  const id = 's' + Date.now().toString(36);
  // 新しいページは、今のページと同じモード・デッキで、まだ始めていない状態
  store.set('ygo.slot.' + id, { board: null, auto: null, mode: store.get('ygo.boardMode', 'manual'), deckId: $('#b-deck') ? $('#b-deck').value : null });
  s.list.push({ id, name: '盤面' + n });
  saveSlotsState(s);
  switchSlot(id);
  toast(`「盤面${n}」を作りました。「シャッフルして開始」で始めてください`);
}
function renameSlot(id) {
  const s = slotsState();
  const x = s.list.find(y => y.id === id);
  if (!x) return;
  const t = prompt('ページの名前', x.name);
  if (!t || !t.trim()) return;
  x.name = t.trim().slice(0, 20);
  saveSlotsState(s);
  renderSlots();
}
function removeSlot(id) {
  const s = slotsState();
  if (s.list.length <= 1) { toast('最後のページは消せません'); return; }
  const x = s.list.find(y => y.id === id);
  if (!confirm(`「${x ? x.name : ''}」を閉じますか？（このページの盤面は消えます）`)) return;
  const i = s.list.findIndex(y => y.id === id);
  s.list.splice(i, 1);
  store.set('ygo.slot.' + id, null);
  Slots.rec.delete(id);
  if (s.cur === id) {
    // 開いているページを閉じたら、となりのページを開く（今の盤面はしまわない）
    s.cur = s.list[Math.max(0, i - 1)].id;
    saveSlotsState(s);
    openSlot(s.cur);
  } else saveSlotsState(s);
  renderSlots();
}

// 盤面の上のページの切り替え
function renderSlots() {
  const bar = $('#b-slots');
  if (!bar) return;
  const s = slotsState();
  bar.innerHTML = '';
  for (const x of s.list) {
    const on = x.id === s.cur;
    const tab = el('div', { class: 'slot-tab' + (on ? ' on' : ''), title: on ? 'ダブルクリックで名前を変える' : 'このページに切り替える' },
      el('button', { class: 'slot-name', text: x.name, onclick: () => switchSlot(x.id), ondblclick: () => renameSlot(x.id) }),
      s.list.length > 1 ? el('button', { class: 'slot-close', text: '×', title: 'このページを閉じる', onclick: e => { e.stopPropagation(); removeSlot(x.id); } }) : null);
    bar.append(tab);
  }
  bar.append(el('button', { class: 'slot-add', text: '＋', title: '新しいページ（別の盤面）を作る', onclick: addSlot }),
    el('button', { class: 'slot-rename', text: '名前', title: '今のページの名前を変える', onclick: () => renameSlot(s.cur) }));
}
function setupSlots() {
  const s = slotsState();
  saveSlotsState(s);
  renderSlots();
}
