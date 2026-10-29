// ---------- AI（Claude）でオリジナルカードの効果を作る ----------
// 決まった効果の組み合わせでは作れない効果を、書いた文から AI に予測してもらい、
// EDOPro のスクリプト（Lua）・効果文・効果の説明（選択肢の文）を作る。
// Claude の API キーは使う人が自分で入れる（この端末のブラウザにだけ保存。料金はその人の Anthropic のアカウントにかかる）。
const AI_SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.134.0/+esm';
const AI_MODEL = 'claude-opus-5-5';
const AI_KEY = 'ygo.aiKey';

const aiKey = () => { try { return localStorage.getItem(AI_KEY) || ''; } catch { return ''; } };
const setAiKey = k => { try { if (k) localStorage.setItem(AI_KEY, k); else localStorage.removeItem(AI_KEY); } catch { /* 保存できなくても今回は使える */ } };

let aiSdk = null;
async function aiClient() {
  if (!aiSdk) aiSdk = (await import(AI_SDK_URL)).default;
  // ブラウザから直接呼ぶ（キーはこの人のもの。サーバーは無い）
  return { Anthropic: aiSdk, client: new aiSdk({ apiKey: aiKey(), dangerouslyAllowBrowser: true }) };
}

// AI に渡すカードの情報（エンジンに渡す値と同じもの）
function aiCardFacts(d) {
  const c = customToCard(d);
  const themes = customThemes(d).map(t => ({ name: t, setcode: '0x' + themeCodes(t).edo.toString(16) }));
  return {
    name: d.name || 'オリジナルカード',
    kind: d.kind,
    type_line: d.kind === 'monster' ? typeLine(c) : typeLine(c),
    edopro_type: '0x' + c.type.toString(16),
    level_or_rank_or_link: d.kind === 'monster' ? c.level : null,
    attribute: d.kind === 'monster' ? ATTR[c.attr] : null,
    race: d.kind === 'monster' ? RACE[c.race] : null,
    atk: d.kind === 'monster' ? c.atk : null,
    def: d.kind === 'monster' && !(c.type & T.LINK) ? c.def : null,
    link_markers: c.type & T.LINK ? '0x' + c.def.toString(16) : null,
    themes,
    summon_materials: d.kind === 'monster' ? ({ fusion: 'モンスター×２', synchro: 'チューナー＋チューナー以外のモンスター１体以上', xyz: `レベル${d.level}モンスター×２`, link: `モンスター${Math.min(2, d.level)}体以上` }[d.mtype] || null) : null,
  };
}

const AI_SYSTEM = `あなたは遊戯王 OCG のカードと、EDOPro（ProjectIgnis/CardScripts）のカードスクリプト（Lua）にくわしい開発者です。
ユーザーが自分で考えたオリジナルカードの効果文から、EDOPro でそのまま動くスクリプトを書きます。

スクリプトの決まり：
- 先頭は local s,id=GetID() 、効果は function s.initial_effect(c) の中で登録する。
- 使える関数・定数は、今の EDOPro（ProjectIgnis/CardScripts の utility.lua・constant.lua・proc_*.lua）にあるものだけ。古い aux 関数や存在しない関数は使わない。
- テーマ（カテゴリ）の判定は IsSetCard に、渡されたテーマの setcode の数値（例 0xf23）をそのまま使う。公式のテーマでも SET_ 定数ではなく渡された数値を使う。
- 効果の説明は aux.Stringid(id,n)（n は 0 から）。n 番目の説明の文を strs の n 番目に入れる。
- 融合・シンクロ・エクシーズ・リンクモンスターは、渡された素材（summon_materials）で召喚手順（Fusion.AddProcMixN / Synchro.AddProcedure / Xyz.AddProcedure / Link.AddProcedure など）を登録し、c:EnableReviveLimit() を付ける。
- 永続魔法・永続罠・フィールド魔法は、まずカードを発動できる EFFECT_TYPE_ACTIVATE（EVENT_FREE_CHAIN）を登録する。
- 「このカード名の〜は１ターンに１度」は SetCountLimit(1,{id,番号})、「１ターンに１度、」は SetCountLimit(1)。
- 対象を取る効果は EFFECT_FLAG_CARD_TARGET と chkc の処理を書く。コストは SetCost、条件は SetCondition。
- 正確に作れない部分は、いちばん近い動きにして、notes に日本語で短く書く。

text には、今の OCG のカードの書き方（①②…、「このカード名の①の効果は１ターンに１度しか使用できない。」など）にそろえた日本語の効果文を入れる（素材の行があれば最初の行）。
strs は、エンジンが選択肢に出す効果の説明（例：「デッキから手札に加える」）。短い日本語で。`;

const AI_SCHEMA = {
  type: 'object',
  properties: {
    lua: { type: 'string', description: 'EDOPro のカードスクリプト全体' },
    text: { type: 'string', description: 'カードに表示する日本語の効果文' },
    strs: { type: 'array', items: { type: 'string' }, description: 'aux.Stringid(id,n) の n 番目の説明' },
    notes: { type: 'string', description: '正確に作れなかった部分など（無ければ空）' },
  },
  required: ['lua', 'text', 'strs', 'notes'],
  additionalProperties: false,
};

// AI に効果を作ってもらう。戻り値：{ lua, text, strs, notes }
async function aiBuildEffects(d, onStatus) {
  const { Anthropic, client } = await aiClient();
  const facts = aiCardFacts(d);
  const user = `次のオリジナルカードのスクリプトを書いてください。

カードの情報（JSON）：
${JSON.stringify(facts, null, 2)}

ユーザーが書いた効果文：
${(d.src || '').trim() || '（なし）'}`;
  onStatus && onStatus('AI が効果を考えています…（1〜2分かかることがあります）');
  try {
    const stream = client.beta.messages.stream({
      model: AI_MODEL,
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',   // AI が断ったときは、別のモデルでもう一度試す
      output_config: { effort: 'high', format: { type: 'json_schema', schema: AI_SCHEMA } },
      system: AI_SYSTEM,
      messages: [{ role: 'user', content: user }],
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new Error('AI がこの内容では作れないと答えました。効果文を変えてもう一度試してください');
    if (msg.stop_reason === 'max_tokens') throw new Error('AI の答えが長すぎて途中で切れました。効果を少なくしてもう一度試してください');
    const textBlock = msg.content.find(b => b.type === 'text');
    if (!textBlock) throw new Error('AI から答えが返ってきませんでした');
    const r = JSON.parse(textBlock.text);
    if (!/GetID\(\)/.test(r.lua || '') || !/initial_effect/.test(r.lua || '')) throw new Error('AI の作ったスクリプトの形が正しくありませんでした。もう一度試してください');
    return { lua: r.lua, text: (r.text || '').trim(), strs: Array.isArray(r.strs) ? r.strs.map(String) : [], notes: (r.notes || '').trim() };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('API キーが正しくありません。キーを確かめてください');
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error('この API キーではこのモデルを使えません');
    if (e instanceof Anthropic.RateLimitError) throw new Error('AI の利用が混み合っているか、上限に達しました。少し待ってからもう一度試してください');
    if (e instanceof Anthropic.BadRequestError) throw new Error('AI へのお願いの形が受け付けられませんでした（' + e.message + '）');
    if (e instanceof Anthropic.APIError) throw new Error(`AI でエラーが起きました（${e.status}）。少し待ってからもう一度試してください`);
    throw e;
  }
}

// 作る画面の「AIで効果を作る」の欄
function aiPanel(d, rerender) {
  const box = el('div', { class: 'custom-ai' });
  const status = el('div', { class: 'muted small-note' });
  const keyIn = el('input', { type: 'password', class: 'full', placeholder: 'Claude の API キー（sk-ant-…）', value: aiKey(), autocomplete: 'off' });
  keyIn.addEventListener('change', () => { setAiKey(keyIn.value.trim()); });
  const run = el('button', { type: 'button', class: 'btn small accent', text: '🤖 AIで効果を作る（上の文から）', onclick: async () => {
    setAiKey(keyIn.value.trim());
    if (!aiKey()) { toast('Claude の API キーを入れてください'); keyIn.focus(); return; }
    if (!(d.src || '').trim()) { toast('上の欄に効果文を書いてください'); return; }
    run.disabled = true;
    try {
      const r = await aiBuildEffects(d, t => { status.textContent = t; });
      d.aiLua = r.lua; d.aiText = r.text; d.aiStrs = r.strs; d.aiNotes = r.notes; d.useAi = true;
      toast('AI が効果を作りました。一人回しで動きを確かめてください');
      rerender();
    } catch (e) {
      status.textContent = '';
      toast(e.message || String(e));
      run.disabled = false;
    }
  } });
  box.append(el('h4', { text: '🤖 AIで効果を作る（読み取れない効果があるとき）' }),
    el('div', { class: 'muted small-note', text: '決まった効果では作れない効果を、上に書いた文から AI（Claude）が予測してスクリプトを作ります。Claude の API キーが必要です（キーはこの端末のブラウザにだけ保存します。使った分の料金はキーのアカウントにかかります）。AI が作った効果は、思いどおりに動かないこともあります。' }),
    keyIn, el('div', { class: 'row' }, run), status);
  if (d.useAi && d.aiLua) {
    box.append(el('div', { class: 'custom-ai-on' },
      el('div', { text: '✓ AI が作った効果を使っています（下の「効果」の設定は使われません）' }),
      d.aiNotes ? el('div', { class: 'warn', text: 'AI のメモ：' + d.aiNotes }) : null,
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'btn small', text: 'スクリプトを見る', onclick: () => showModal({ title: 'AI が作ったスクリプト', body: el('pre', { class: 'custom-ai-lua', text: d.aiLua }), wide: true }) }),
        el('button', { type: 'button', class: 'btn small danger', text: 'AIの効果をやめる', onclick: () => { d.useAi = false; rerender(); } }))));
  } else if (d.aiLua) {
    box.append(el('button', { type: 'button', class: 'btn small', text: '前に AI が作った効果に戻す', onclick: () => { d.useAi = true; rerender(); } }));
  }
  return box;
}
