"use client";

import Image from "next/image";
import { useState } from "react";
import { gameRequest } from "../utils/gameApi";
import ThemeToggle from "../components/ThemeToggle";
import SelectBox from "../components/SelectBox";

export default function HomePage() {
  const [playerName, setPlayerName] = useState("");
  const [joinPlayerName, setJoinPlayerName] = useState("");
  const [selectedAction, setSelectedAction] = useState("room");
  const [gameId, setGameId] = useState("");
  const [imposterCount, setImposterCount] = useState("1");
  const [playerCount, setPlayerCount] = useState("3");
  const [hintInputMode, setHintInputMode] = useState("TABLE_TALK");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function createRoom(event) {
    event.preventDefault();
    setError("");
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
          category: null,
          imposter_count: Number(imposterCount),
          total_rounds: 1,
          desired_player_count: Number(playerCount),
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
                <Image className="home-choice-image" src="/room.png" alt="" width={56} height={56} />
                <span className="home-choice-copy">
                  <span>Room</span>
                  <small>အခန်းအသစ် ဖွင့်မယ်</small>
                </span>
                {selectedAction === "room" && <span className="home-choice-check" aria-hidden="true">✓</span>}
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
                <Image className="home-choice-image" src="/player.png" alt="" width={56} height={56} />
                <span className="home-choice-copy">
                  <span>Player</span>
                  <small>အခန်းထဲ ဝင်မယ်</small>
                </span>
                {selectedAction === "player" && <span className="home-choice-check" aria-hidden="true">✓</span>}
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

          <label htmlFor="imposterCount">Imposter</label>
          <SelectBox
            id="imposterCount"
            value={imposterCount}
            onValueChange={(nextImposterCount) => {
              setImposterCount(nextImposterCount);
              setPlayerCount((currentCount) =>
                String(Math.max(Number(currentCount), Number(nextImposterCount) * 2 + 1)),
              );
            }}
          >
            <option value="1">၁ ယောက်</option>
            <option value="2">၂ ယောက်</option>
            <option value="3">၃ ယောက်</option>
          </SelectBox>

          <label htmlFor="playerCount">Player</label>
          <SelectBox
            id="playerCount"
            value={playerCount}
            onValueChange={(nextPlayerCount) => {
              setPlayerCount(nextPlayerCount);
              if (Number(nextPlayerCount) < Number(imposterCount) * 2 + 1) {
                setImposterCount("1");
              }
            }}
          >
            {Array.from({ length: 8 }, (_, index) => index + 3).map((count) => (
              <option key={count} value={count}>{count} ယောက်</option>
            ))}
          </SelectBox>

          <label htmlFor="hintInputMode">အရိပ်အမြွက်နှင့် ခန့်မှန်းပုံစံ</label>
          <SelectBox
            id="hintInputMode"
            value={hintInputMode}
            onValueChange={setHintInputMode}
            required
          >
            <option value="TABLE_TALK">လူချင်းပြောမည်</option>
            <option value="TEXT_INPUT">စာရိုက်ထည့်မည်</option>
          </SelectBox>

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
