"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { gameRequest } from "../utils/gameApi";
import ThemeToggle from "../components/ThemeToggle";

export default function HomePage() {
  const [playerName, setPlayerName] = useState("");
  const [joinPlayerName, setJoinPlayerName] = useState("");
  const [selectedAction, setSelectedAction] = useState("room");
  const [gameId, setGameId] = useState("");
  const [category, setCategory] = useState("");
  const [imposterCount, setImposterCount] = useState("1");
  const [playerCount, setPlayerCount] = useState("3");
  const [clueRoundChoice, setClueRoundChoice] = useState("1");
  const [customClueRounds, setCustomClueRounds] = useState("");
  const [hintInputMode, setHintInputMode] = useState("TABLE_TALK");
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState("");
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const clueRounds = clueRoundChoice === "custom"
    ? Number(customClueRounds)
    : Number(clueRoundChoice);
  const clueRoundCountValid =
    Number.isInteger(clueRounds) && clueRounds >= 1 && clueRounds <= 10;

  useEffect(() => {
    let active = true;
    gameRequest("/categories")
      .then((result) => {
        if (active) setCategories(result.categories);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoadingCategories(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function createRoom(event) {
    event.preventDefault();
    setError("");
    if (!clueRoundCountValid) {
      setError("အရိပ်အမြွက်အကြိမ်ကို ၁ မှ ၁၀ အတွင်း ထည့်ပါ။");
      return;
    }
    if (!hintInputMode) {
      setError("အရိပ်အမြွက်ပေးမည့်ပုံစံကို ရွေးပါ။");
      return;
    }
    setSubmitting(true);

    try {
      const game = await gameRequest("/games", {
        method: "POST",
        body: {
          player_name: playerName,
          category: category || null,
          imposter_count: Number(imposterCount),
          total_rounds: 1,
          desired_player_count: Number(playerCount),
          clue_rounds: clueRounds,
          hint_input_mode: hintInputMode,
        },
      });
      window.sessionStorage.setItem(`imposter-token:${game.game_id}`, game.player_token);
      window.location.href = `/room/${game.game_id}?playerId=${game.player_id}`;
    } catch (requestError) {
      setError(requestError.message);
      setSubmitting(false);
    }
  }

  async function joinRoom(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const player = await gameRequest(`/games/${encodeURIComponent(gameId.trim())}/players`, {
        method: "POST",
        body: { player_name: joinPlayerName },
      });
      window.sessionStorage.setItem(`imposter-token:${player.game_id}`, player.player_token);
      window.location.href = `/room/${player.game_id}?playerId=${player.player_id}`;
    } catch (requestError) {
      setError(requestError.message);
      setSubmitting(false);
    }
  }

  return (
    <main className="home-shell">
      <header className="room-topbar home-topbar">
        <a className="wordmark" href="/" aria-label="ပင်မစာမျက်နှာ">
          <Image
            className="wordmark-logo"
            src="/imposter-logo-icon.webp"
            alt=""
            width={345}
            height={370}
          />
          <span>Imposter</span>
        </a>
        <ThemeToggle />
      </header>

      <div className="home-content-layout">
        <div className="home-setup-column">
          <section className="setup-grid" aria-label="ဂိမ်းပြင်ဆင်ရန်">
            <div className="home-action-choices" aria-label="လုပ်ဆောင်မှု ရွေးပါ">
              <button
                className={`home-choice-button${selectedAction === "room" ? " active" : ""}`}
                type="button"
                aria-pressed={selectedAction === "room"}
                onClick={() => {
                  setSelectedAction("room");
                  setError("");
                }}
              >
                <svg className="home-choice-image" viewBox="0 0 48 48" aria-hidden="true">
                  <path d="M7 21.5 24 8l17 13.5v19H7z" />
                  <path d="M19 40V26h10v14M14 23h.01M34 23h.01" />
                </svg>
                <span className="home-choice-copy">
                  <span>Room</span>
                  <small>အခန်းအသစ် ဖွင့်မယ်</small>
                </span>
              </button>
              <button
                className={`home-choice-button${selectedAction === "player" ? " active" : ""}`}
                type="button"
                aria-pressed={selectedAction === "player"}
                onClick={() => {
                  setSelectedAction("player");
                  setError("");
                }}
              >
                <svg className="home-choice-image" viewBox="0 0 48 48" aria-hidden="true">
                  <circle cx="24" cy="15" r="8" />
                  <path d="M9 41v-4a15 15 0 0 1 30 0v4z" />
                </svg>
                <span className="home-choice-copy">
                  <span>Player</span>
                  <small>အခန်းထဲ ဝင်မယ်</small>
                </span>
              </button>
            </div>

            {selectedAction === "room" && <form className="glass-card setup-card setup-card-single" onSubmit={createRoom}>

          <label htmlFor="playerName">သင့်အမည်</label>
          <input
            id="playerName"
            value={playerName}
            onChange={(event) => setPlayerName(event.target.value)}
            maxLength={30}
            placeholder="အမည်ရိုက်ထည့်ပါ"
            autoComplete="nickname"
            required
          />

          <label htmlFor="category">စကားလုံးအမျိုးအစား</label>
          <select
            id="category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            disabled={loadingCategories}
          >
            <option value="">
              {loadingCategories ? "ခဏစောင့်ပါ..." : "ကျပန်းရွေးပါ"}
            </option>
            {categories.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>

          <label htmlFor="imposterCount">Imposter</label>
          <select
            id="imposterCount"
            value={imposterCount}
            onChange={(event) => {
              const nextImposterCount = event.target.value;
              setImposterCount(nextImposterCount);
              setPlayerCount((currentCount) =>
                String(Math.max(Number(currentCount), Number(nextImposterCount) * 2 + 1)),
              );
            }}
          >
            <option value="1">၁ ယောက်</option>
            <option value="2">၂ ယောက်</option>
            <option value="3">၃ ယောက်</option>
          </select>

          <label htmlFor="playerCount">Player</label>
          <select
            id="playerCount"
            value={playerCount}
            onChange={(event) => {
              const nextPlayerCount = event.target.value;
              setPlayerCount(nextPlayerCount);
              if (Number(nextPlayerCount) < Number(imposterCount) * 2 + 1) {
                setImposterCount("1");
              }
            }}
          >
            {Array.from({ length: 8 }, (_, index) => index + 3).map((count) => (
              <option key={count} value={count}>{count} ယောက်</option>
            ))}
          </select>

          <label htmlFor="clueRoundCount">အရိပ်အမြွက်ပေးရမည့် အကြိမ်</label>
          <select
            id="clueRoundCount"
            value={clueRoundChoice}
            onChange={(event) => setClueRoundChoice(event.target.value)}
          >
            <option value="1">၁ ကြိမ်</option>
            <option value="2">၂ ကြိမ်</option>
            <option value="3">၃ ကြိမ်</option>
            <option value="4">၄ ကြိမ်</option>
            <option value="5">၅ ကြိမ်</option>
            <option value="custom">စိတ်ကြိုက်သတ်မှတ်မယ်</option>
          </select>
          {clueRoundChoice === "custom" && (
            <>
              <label htmlFor="customClueRounds">အရိပ်အမြွက်အကြိမ် (၁ မှ ၁၀)</label>
              <input
                id="customClueRounds"
                type="number"
                min="1"
                max="10"
                step="1"
                inputMode="numeric"
                value={customClueRounds}
                onChange={(event) => setCustomClueRounds(event.target.value)}
                placeholder="ဥပမာ - ၆"
                required
              />
            </>
          )}

          <label htmlFor="hintInputMode">အရိပ်အမြွက်နှင့် နောက်ဆုံးခန့်မှန်းပုံစံ</label>
          <select
            id="hintInputMode"
            value={hintInputMode}
            onChange={(event) => setHintInputMode(event.target.value)}
            required
          >
            <option value="TABLE_TALK">လူချင်းပြောမည် (အိမ်ရှင်က ခန့်မှန်းချက်စစ်မည်)</option>
            <option value="TEXT_INPUT">စာရိုက်ထည့်မည် (ခန့်မှန်းချက်ကို အလိုအလျောက်စစ်မည်)</option>
          </select>

          <button className="primary-button" type="submit" disabled={submitting || !hintInputMode}>
            {submitting ? "ခဏစောင့်ပါ..." : "အခန်းအသစ် စတင်မယ်"}
            {!submitting && <span aria-hidden="true">↗</span>}
          </button>
            </form>}

            {selectedAction === "player" && <form className="glass-card setup-card join-card setup-card-single" onSubmit={joinRoom}>

          <label htmlFor="joinPlayerName">သင့်အမည်</label>
          <input
            id="joinPlayerName"
            value={joinPlayerName}
            onChange={(event) => setJoinPlayerName(event.target.value)}
            maxLength={30}
            placeholder="အမည်ရိုက်ထည့်ပါ"
            autoComplete="nickname"
            required
          />

          <label htmlFor="gameId">အခန်းကုဒ်</label>
          <input
            id="gameId"
            value={gameId}
            onChange={(event) => setGameId(event.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            maxLength={4}
            pattern="[0-9]{4}"
            placeholder="ဂဏန်း ၄ လုံး"
            autoComplete="off"
            required
          />

          <button className="secondary-button" type="submit" disabled={submitting}>
            {submitting ? "ခဏစောင့်ပါ..." : "အခန်းထဲ ဝင်မယ်"}
            {!submitting && <span aria-hidden="true">→</span>}
          </button>
            </form>}
          </section>

          {error && <p className="error-message home-error" role="alert">{error}</p>}
        </div>

        <aside className="how-to-play">
          <h3>ကစားနည်းအကျဉ်း</h3>
          <ol>
            <li>လူတိုင်းက ကိုယ့်အခန်းကဏ္ဍကို တစ်ယောက်ချင်းစီ ကြည့်ပါ။</li>
            <li>လျှို့ဝှက်စကားလုံးကို မပြောဘဲ အရိပ်အမြွက်တစ်ခု ပေးပါ။</li>
            <li>ဆွေးနွေးပြီး သံသယရှိသူကို မဲပေးရွေးချယ်ပါ။</li>
          </ol>
        </aside>
      </div>
    </main>
  );
}
