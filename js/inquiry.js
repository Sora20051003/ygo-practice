// ---------- 問い合わせ（不具合・要望） ----------
// 送り先は GitHub の Issue（このアプリのリポジトリ）。「GitHubで送る」で、内容と画面の状態を入れた Issue の作成画面を開く。
// GitHub のアカウントが無い人は「内容をコピー」して、作った人に送ってもらう。
// 作った人は Claude Code に「問い合わせを直して」と言うと、Issue を読んで直す（タイトルの頭が「[問い合わせ]」のもの）
const INQ_REPO = 'Sora20051003/ygo-practice';
const INQ_MARK = '<!-- ygo-app-inquiry -->';
const INQ_KINDS = [['bug', '不具合'], ['request', 'こうしてほしい（要望）'], ['other', 'その他']];

// 最近のエラー（問い合わせに付ける）
const InqErrors = [];
function inqNoteError(text) { InqErrors.push(`${new Date().toLocaleTimeString()} ${String(text).slice(0, 300)}`); if (InqErrors.length > 8) InqErrors.shift(); }
window.addEventListener('error', e => inqNoteError(`${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
window.addEventListener('unhandledrejection', e => inqNoteError('Promise: ' + ((e.reason && (e.reason.message || e.reason)) || '')));
if (typeof showError === 'function') {
  const orig = showError;
  // eslint-disable-next-line no-global-assign
  showError = function (title, err) { inqNoteError(`${title}: ${(err && (err.message || err)) || ''}`); return orig.apply(this, arguments); };
}

// 今の画面の状態（版・端末・どの画面か・一人回しのモードと設定・デッキ・直前の操作ログ・最近のエラー）
function inqState() {
  const lines = [];
  const add = (k, v) => { if (v !== undefined && v !== null && v !== '') lines.push(`- ${k}：${v}`); };
  add('版', typeof APP_VERSION !== 'undefined' ? APP_VERSION : '');
  add('端末', typeof deviceName === 'function' ? deviceName() : navigator.userAgent);
  add('画面の大きさ', `${innerWidth}×${innerHeight}${document.body.classList.contains('land') ? '（横画面の盤面）' : ''}`);
  const v = document.querySelector('.view:not([hidden])');
  const tab = v && document.querySelector(`.tab[data-view="${v.id.replace('view-', '')}"]`);
  add('開いている画面', tab ? tab.textContent : v ? v.id : '');
  try {
    const deck = typeof Decks !== 'undefined' && Decks.current && Decks.current();
    if (deck) {
      const names = list => { const m = new Map(); for (const id of list || []) m.set(id, (m.get(id) || 0) + 1); return [...m].map(([id, n]) => `${(DB.byId.get(id) || {}).name || id}×${n}`).join('、'); };
      add('デッキ', `${deck.name}（${typeof deckFormat === 'function' ? deckFormat(deck) : ''}・${deck.reg || 'latest'}）`);
      add('メイン', names(deck.main));
      add('EX', names(deck.extra));
    }
  } catch { /* デッキが読めなくても送れるようにする */ }
  try {
    if (typeof Board !== 'undefined' && Board.S) {
      add('一人回し', Board.S.auto ? '効果を自動処理' : '手動');
      if (Board.S.auto && typeof Auto !== 'undefined' && Auto.duel) {
        const d = Auto.duel;
        add('相手', typeof oppMode === 'function' ? { trap: '誘発練習', cpu: 'デッキで対戦', none: '何もしない' }[oppMode()] || oppMode() : '');
        add('チェーン確認', d.chainMode);
        add('ターン・フェイズ', `T${d.turn} ${d.turnPlayer === d.me ? '自分' : '相手'}のターン・フェイズ${d.phase}`);
        add('今の選択', d.pending ? `${typeof promptTitle === 'function' ? promptTitle(d.pending) : d.pending.type}` : 'なし');
        if (d.log && d.log.length) lines.push('', '直前の操作ログ（最後の40行）', '```', ...d.log.slice(-40), '```');
      }
    }
  } catch { /* 状態が読めなくても送れるようにする */ }
  if (InqErrors.length) lines.push('', '最近のエラー', '```', ...InqErrors, '```');
  return lines.join('\n');
}

function openInquiry() {
  const kind = el('select', {}, INQ_KINDS.map(([v, l]) => el('option', { value: v, text: l })));
  const title = el('input', { type: 'text', class: 'full', placeholder: '一言で（例：レイズ・ムーンのドローした時の効果が使えない）', maxlength: 80 });
  const body = el('textarea', { class: 'full inq-body', rows: 6, placeholder: '何をしたら、どうなったか。どうなってほしいか。カード名やデッキ名があると直しやすいです。' });
  const withState = el('input', { type: 'checkbox', checked: true });
  const stateBox = el('pre', { class: 'inq-state' });
  const refresh = () => { stateBox.textContent = inqState(); stateBox.hidden = !withState.checked; };
  withState.onchange = refresh;
  refresh();
  const text = () => {
    const k = INQ_KINDS.find(x => x[0] === kind.value)[1];
    return [INQ_MARK, `種類：${k}`, '', body.value.trim() || '（内容なし）', ...(withState.checked ? ['', '---', '画面の状態（自動で付けたもの）', stateBox.textContent] : [])].join('\n');
  };
  const issueTitle = () => `[問い合わせ] ${title.value.trim() || body.value.trim().split('\n')[0].slice(0, 40) || INQ_KINDS.find(x => x[0] === kind.value)[1]}`;
  const send = () => {
    if (!body.value.trim() && !title.value.trim()) { toast('内容を書いてください'); return false; }
    // URL が長すぎると開けないので、状態のログを短くしてから送る
    let b = text();
    if (b.length > 6000) b = b.slice(0, 6000) + '\n…（長いので省略しました）';
    const url = `https://github.com/${INQ_REPO}/issues/new?` + new URLSearchParams({ title: issueTitle(), body: b, labels: '問い合わせ' });
    window.open(url, '_blank', 'noopener');
    toast('GitHubの画面で「Submit new issue」を押すと送られます');
    return false;
  };
  // そのまま送る（GitHub のアカウント不要）：中継サーバーに置き、GitHub の自動処理が15分ごとに Issue にする
  const direct = async () => {
    if (!body.value.trim() && !title.value.trim()) { toast('内容を書いてください'); return false; }
    let b = text();
    if (b.length > 12000) b = b.slice(0, 12000) + '\n…（長いので省略しました）';
    try {
      await inqSendDirect({ title: issueTitle(), body: b });
      toast('送りました。ありがとうございます（AIが読んで直します）');
      return true;   // 送れたら閉じる
    } catch (e) {
      toast('送れませんでした（' + (e.message || e) + '）。「内容をコピー」して作った人に送ってください');
      return false;
    }
  };
  const copy = async () => {
    const all = `${issueTitle()}\n\n${text()}`;
    try { await navigator.clipboard.writeText(all); toast('内容をコピーしました。作った人に送ってください'); }
    catch { stateBox.hidden = false; stateBox.textContent = all; toast('コピーできなかったので、下の文を選んでコピーしてください'); }
    return false;
  };
  showModal({
    title: '✉ 問い合わせ（不具合・要望）',
    body: el('div', { class: 'stack inq' },
      el('p', { class: 'muted small-note', text: '「送る」を押すと送られます（アカウントは要りません）。送った内容はAIが読んで直します。内容は公開されるので、個人情報は書かないでください。GitHubのアカウントがある人は「GitHubで送る」でも送れます。' }),
      el('label', { class: 'row' }, '種類 ', kind),
      title, body,
      el('label', { class: 'row inq-check' }, withState, '今の画面の状態（版・端末・デッキ・直前の操作ログ）を付ける'),
      stateBox),
    wide: true,
    buttons: [{ label: '内容をコピー', onClick: () => { copy(); return false; } }, { label: 'GitHubで送る', onClick: send }, { label: '送る', primary: true, onClick: close => { direct().then(ok => { if (ok) close(); }); return false; } }],
  });
  setTimeout(() => body.focus(), 0);
}

// 中継サーバー（対戦と同じ MQTT の公開サーバー）に、問い合わせを「残すメッセージ」として置く。
// GitHub Actions（.github/workflows/inquiries.yml）が15分ごとに受け取って Issue にし、中継サーバーから消す。
// 2つのサーバーのどちらかに置ければ成功
async function inqSendDirect({ title, body }) {
  if (typeof mqtt === 'undefined') await loadScript(MQTT_URL);
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const payload = JSON.stringify({ id, title, body, ts: Date.now() });
  const topic = `${MQTT_BASE}/inq/${id}`;
  const one = url => new Promise((resolve, reject) => {
    const c = mqtt.connect(url, { clientId: 'ygo-inq-' + id + '-' + Math.random().toString(36).slice(2, 6), connectTimeout: 8000, reconnectPeriod: 0, clean: true });
    const timer = setTimeout(() => { try { c.end(true); } catch { /* もう閉じている */ } reject(new Error('時間切れ')); }, 12000);
    c.on('connect', () => c.publish(topic, payload, { qos: 1, retain: true }, err => {
      clearTimeout(timer);
      c.end();
      if (err) reject(err); else resolve();
    }));
    c.on('error', e => { clearTimeout(timer); try { c.end(true); } catch { /* もう閉じている */ } reject(e); });
  });
  const results = await Promise.allSettled(MQTT_BROKERS.map(one));
  if (!results.some(r => r.status === 'fulfilled')) throw new Error('中継サーバーにつながりません');
  return id;
}
