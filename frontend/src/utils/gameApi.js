const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export function clearRoomTokens(gameId) {
  const tokenPrefix = `imposter-token:${gameId}`;
  for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = window.sessionStorage.key(index);
    if (key === tokenPrefix || key?.startsWith(`${tokenPrefix}:`)) {
      window.sessionStorage.removeItem(key);
    }
  }
}

function localizeError(detail) {
  const message = typeof detail === "string" ? detail : "";
  if (/authentication|required|invalid player/i.test(message)) {
    return "Player အတည်ပြုချက် မအောင်မြင်ပါ။ အခန်းထဲ ပြန်ဝင်ပါ။";
  }
  if (/not found|does not belong/i.test(message)) {
    return "အခန်း သို့မဟုတ် Playerကို ရှာမတွေ့ပါ။ ကုဒ်ကို ပြန်စစ်ပါ။";
  }
  if (/3 to 10 players|at least two active players/i.test(message)) {
    return "ဂိမ်းစရန် Player ၃ ယောက်မှ ၁၀ ယောက်အထိ လိုအပ်သည်။";
  }
  if (/at most \d+ players|supports at most/i.test(message)) {
    return "ဒီအခန်းတွင် Player အများဆုံး ၁၀ ယောက်သာ ဝင်နိုင်သည်။";
  }
  if (/unique|already in a game|already given this clue/i.test(message)) {
    return "အမည် သို့မဟုတ် အရိပ်အမြွက်ကို အသုံးပြုပြီးဖြစ်သည်။ တခြားတစ်ခုကို ရွေးပါ။";
  }
  if (/only the game host/i.test(message)) {
    return "ဒီလုပ်ဆောင်ချက်ကို အိမ်ရှင်သာ လုပ်နိုင်သည်။";
  }
  if (/hint input mode|table-talk hints|text hints/i.test(message)) {
    return "အရိပ်အမြွက်ပေးမည့်ပုံစံကို စစ်ဆေးပါ။ ဂိမ်းမစမီ အိမ်ရှင်က ပုံစံတစ်ခု ရွေးရပါမည်။";
  }
  if (/self|themselves/i.test(message)) {
    return "မိမိကိုယ်ကို မဲပေး၍မရပါ။";
  }
  if (/tie|tied|revote/i.test(message)) {
    return "မဲသရေကျနေသည်။ သတ်မှတ်ထားသော Player များကို ပြန်မဲပေးပါ။";
  }
  if (/vote|ballot|voting/i.test(message)) {
    return "မဲပေးမှုကို လက်ခံမရပါ။ မဲအဆင့်နှင့် သင့်ရွေးချယ်မှုကို စစ်ဆေးပါ။";
  }
  if (/clue round count|clue rounds.*between 1 and 10/i.test(message)) {
    return "အရိပ်အမြွက်အကြိမ်ကို ၁ မှ ၁၀ အတွင်း သတ်မှတ်ပါ။";
  }
  if (/clue/i.test(message)) {
    return "အရိပ်အမြွက်ကို လက်ခံမရပါ။ သင့်အလှည့်ဖြစ်ကြောင်းနှင့် စာသားကို စစ်ဆေးပါ။";
  }
  if (/role|imposter count|imposter/i.test(message)) {
    return "အခန်းကဏ္ဍ သတ်မှတ်မှု မအောင်မြင်ပါ။ Playerအရေအတွက်ကို စစ်ဆေးပါ။";
  }
  if (/guess/i.test(message)) {
    return "ခန့်မှန်းချက်ကို လက်ခံမရပါ။ စာသားကို ပြန်စစ်ပါ။";
  }
  if (/category/i.test(message)) {
    return "ရွေးချယ်ထားသော စကားလုံးအမျိုးအစားကို အသုံးပြု၍မရပါ။";
  }
  if (/round count|rounds.*between 1 and 20|total round/i.test(message)) {
    return "ကစားမည့် အကြိမ်အရေအတွက်ကို ၁ မှ ၂၀ အတွင်း သတ်မှတ်ပါ။";
  }
  return "လုပ်ဆောင်မှု မအောင်မြင်ပါ။ ထပ်မံကြိုးစားပါ။";
}

export async function gameRequest(path, { method = "GET", body, token } = {}) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("ဆာဗာနှင့် ချိတ်ဆက်မရပါ။ အင်တာနက် သို့မဟုတ် ဆာဗာကို စစ်ဆေးပါ။");
    }
    throw error;
  }

  const result = await response.json();
  if (!response.ok) {
    if (response.status === 404 && result.detail === "Not Found") {
      throw new Error("အသုံးပြုနေသော backend တွင် လူချင်းပြော ခန့်မှန်းစနစ် မပါသေးပါ။ Backend အသစ်ကို deploy လုပ်ပြီး ထပ်ကြိုးစားပါ။");
    }
    throw new Error(localizeError(result.detail));
  }
  return result;
}

export async function translateText(text) {
  const response = await fetch(`${API_URL}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof result.detail === "string" ? result.detail : "Japanese translation failed",
    );
  }
  if (typeof result.translation !== "string" || !result.translation.trim()) {
    throw new Error("Japanese translation service returned no translation");
  }
  return result.translation;
}

export function gameWebSocketUrl(gameId, playerId, token) {
  const websocketUrl = API_URL.replace(/^http/, "ws");
  const query = new URLSearchParams({ token });
  return `${websocketUrl}/ws/${encodeURIComponent(gameId)}/${encodeURIComponent(playerId)}?${query}`;
}
