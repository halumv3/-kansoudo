"use strict";

/* ==========================================================================
   観相堂 app.js
   - 生年月日から簡単な星座・干支（十二支）を割り出し、
     選んだ占い師の「口調」でGemini APIに鑑定文を作らせる。
   - 算命学の厳密な体系（十大主星・十二大従星など）は使わず、
     誰でも実装しやすい西洋星座＋十二支をネタとして渡すだけにしている。
   - APIキーはブラウザのlocalStorageにのみ保存し、どこにも送信しない。
     （localStorageが使えない環境ではメモリ上の変数にフォールバック）
   ========================================================================== */

// ---- 1. 占い師（ペルソナ）定義 -------------------------------------------
// 実在の人物を模したものではなく、口調の違うオリジナルキャラクターとして設計。
const TELLERS = [
  {
    id: "zubatto",
    emoji: "🗡️",
    name: "ズバッと先生",
    tagline: "辛口・単刀直入。オブラート一切なし",
    systemPrompt: `あなたは「ズバッと先生」という辛口の占い師キャラクターです。
一人称は「アタシ」、語尾は歯切れよく断定的。遠慮せずズバズバ言いますが、
根っこには相談者への愛情があり、最後は前向きな一言で締めます。
禁止事項：人格否定、差別的表現、自傷・自殺を仄めかす表現、健康や生死に関する断定的な予言、
相談者を絶望させる表現。これらは絶対に含めないこと。
出力は200〜320文字程度、日本語、改行を適度に入れて読みやすくすること。`,
  },
  {
    id: "yasashii",
    emoji: "🌙",
    name: "やさしい癒し系",
    tagline: "肯定重視。寄り添うトーン",
    systemPrompt: `あなたは「月見の巫女」という、とても優しく寄り添うタイプの占い師キャラクターです。
一人称は「わたし」、丁寧で温かい語り口。相談者の気持ちをまず受け止めてから、
やわらかい言葉で見立てを伝え、安心できる一言で締めます。
禁止事項：健康や生死に関する断定的な予言、相談者を不安にさせる表現。
出力は200〜320文字程度、日本語、改行を適度に入れて読みやすくすること。`,
  },
  {
    id: "renai",
    emoji: "💌",
    name: "恋愛専門鑑定士",
    tagline: "恋愛・人間関係にとことん特化",
    systemPrompt: `あなたは恋愛相談を専門とする占い師「縁結び先生」です。
一人称は「わたくし」、少し色っぽく粋な語り口。相談者の恋愛運・相性・
今後の人間関係の展開に絞って見立てを伝え、具体的な行動のヒントを一つ添えます。
禁止事項：特定の実在人物との相性を決めつける表現、相手をコントロールするような助言。
出力は200〜320文字程度、日本語、改行を適度に入れて読みやすくすること。`,
  },
  {
    id: "shigoto",
    emoji: "💼",
    name: "仕事運鑑定士",
    tagline: "キャリア・お金の流れに特化",
    systemPrompt: `あなたはキャリアと金運を専門とする占い師「大黒堂」です。
一人称は「わし」、落ち着いた貫禄のある語り口。相談者の仕事運・金運・
今後のキャリアの流れに絞って見立てを伝え、実践しやすいアドバイスを一つ添えます。
禁止事項：特定の投資や副業を勧める表現、断定的な収入額の予言。
出力は200〜320文字程度、日本語、改行を適度に入れて読みやすくすること。`,
  },
];

// ---- 2. 生年月日から星座・干支を出す（外部APIなし、純粋計算） ----------
const ZODIAC_TABLE = [
  { name: "山羊座", end: [1, 19] }, { name: "水瓶座", end: [2, 18] },
  { name: "魚座", end: [3, 20] }, { name: "牡羊座", end: [4, 19] },
  { name: "牡牛座", end: [5, 20] }, { name: "双子座", end: [6, 21] },
  { name: "蟹座", end: [7, 22] }, { name: "獅子座", end: [8, 22] },
  { name: "乙女座", end: [9, 22] }, { name: "天秤座", end: [10, 23] },
  { name: "蠍座", end: [11, 22] }, { name: "射手座", end: [12, 21] },
  { name: "山羊座", end: [12, 31] },
];

function getZodiac(month, day) {
  for (const z of ZODIAC_TABLE) {
    const [em, ed] = z.end;
    if (month < em || (month === em && day <= ed)) return z.name;
  }
  return "山羊座";
}

const ETO = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
function getEto(year) {
  // 1900年 = 子年 を基準にした簡易計算（一般的な十二支の割り出し方）
  const idx = ((year - 1900) % 12 + 12) % 12;
  return ETO[idx] + "年";
}

// ---- 3. APIキーの保存（localStorage、失敗時はメモリにフォールバック） ---
let memoryKey = "";
function saveApiKey(key) {
  try { localStorage.setItem("kansoudo_gemini_key", key); }
  catch { memoryKey = key; }
}
function loadApiKey() {
  try { return localStorage.getItem("kansoudo_gemini_key") || ""; }
  catch { return memoryKey; }
}

// ---- 4. Gemini API 呼び出し ----------------------------------------------
// 無料枠モデルは変更されやすいため、エイリアス名を使用。
// うまく動かない場合は https://ai.google.dev/gemini-api/docs/models で
// 現行の無料枠モデル名を確認し、下の GEMINI_MODEL を書き換えてください。
const GEMINI_MODEL = "gemini-flash-latest";

async function askTeller({ apiKey, systemPrompt, userPrompt }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.9, maxOutputTokens: 400 },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";
  if (!text) throw new Error("応答が空でした");
  return text.trim();
}

// ---- 5. UI 配線 -----------------------------------------------------------
let selectedTellerId = TELLERS[0].id;

function renderTellerGrid() {
  const grid = document.getElementById("tellerGrid");
  grid.innerHTML = "";
  TELLERS.forEach((teller) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "teller-card";
    card.role = "radio";
    card.setAttribute("aria-checked", String(teller.id === selectedTellerId));
    card.innerHTML = `
      <span class="teller-card__emoji" aria-hidden="true">${teller.emoji}</span>
      <span class="teller-card__name">${teller.name}</span>
      <span class="teller-card__tagline">${teller.tagline}</span>
    `;
    card.addEventListener("click", () => {
      selectedTellerId = teller.id;
      [...grid.children].forEach(c => c.setAttribute("aria-checked", "false"));
      card.setAttribute("aria-checked", "true");
    });
    grid.appendChild(card);
  });
}

function setKeyStatus(message, state) {
  const el = document.getElementById("keyStatus");
  el.textContent = message;
  if (state) el.dataset.state = state; else delete el.dataset.state;
}

function wireSettings() {
  const input = document.getElementById("apiKey");
  const saved = loadApiKey();
  if (saved) {
    input.value = saved;
    setKeyStatus("キーは保存済みです。", "ok");
  }
  document.getElementById("saveKeyBtn").addEventListener("click", () => {
    const key = input.value.trim();
    if (!key) { setKeyStatus("キーが空です。", "error"); return; }
    saveApiKey(key);
    setKeyStatus("保存しました。これで占えます。", "ok");
    document.getElementById("settingsDetails").open = false;
  });
}

function buildUserPrompt({ birthdate, concern, zodiac, eto }) {
  const [y, m, d] = birthdate.split("-").map(Number);
  let prompt = `相談者の生年月日は ${y}年${m}月${d}日、星座は${zodiac}、干支は${eto}生まれです。`;
  if (concern) prompt += `相談者が気にしていることは「${concern}」です。これに軽く触れつつ`;
  prompt += `今日から近い未来の運勢について、あなたのキャラクターらしい口調で鑑定してください。`;
  return prompt;
}

function wireForm() {
  const form = document.getElementById("fortuneForm");
  const resultSection = document.getElementById("resultSection");
  const submitBtn = document.getElementById("submitBtn");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const apiKey = loadApiKey();
    if (!apiKey) {
      document.getElementById("settingsDetails").open = true;
      setKeyStatus("先にAPIキーを保存してください。", "error");
      document.getElementById("settingsSection").scrollIntoView({ behavior: "smooth" });
      return;
    }

    const birthdate = document.getElementById("birthdate").value;
    if (!birthdate) return;
    const concern = document.getElementById("concern").value.trim();
    const [y, m, d] = birthdate.split("-").map(Number);
    const zodiac = getZodiac(m, d);
    const eto = getEto(y);
    const teller = TELLERS.find(t => t.id === selectedTellerId) || TELLERS[0];

    submitBtn.disabled = true;
    submitBtn.querySelector("span").textContent = "見立て中…";

    try {
      const text = await askTeller({
        apiKey,
        systemPrompt: teller.systemPrompt,
        userPrompt: buildUserPrompt({ birthdate, concern, zodiac, eto }),
      });
      document.getElementById("resultPersona").textContent = `${teller.emoji} ${teller.name} の見立て`;
      document.getElementById("resultBody").textContent = text;
      resultSection.hidden = false;
      resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      document.getElementById("resultPersona").textContent = "うまくいきませんでした";
      document.getElementById("resultBody").textContent =
        "占いの取得に失敗しました。APIキーが正しいか、無料枠の上限に達していないかをご確認ください。\n\n詳細: " + err.message;
      resultSection.hidden = false;
      resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
    } finally {
      submitBtn.disabled = false;
      submitBtn.querySelector("span").textContent = "見立てを申す";
    }
  });

  document.getElementById("retryBtn").addEventListener("click", () => {
    resultSection.hidden = true;
    document.getElementById("step-teller").scrollIntoView({ behavior: "smooth" });
  });
}

function init() {
  renderTellerGrid();
  wireSettings();
  wireForm();
}

document.addEventListener("DOMContentLoaded", init);
