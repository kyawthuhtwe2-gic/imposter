"use client";

import Image from "next/image";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import ThemeToggle from "../../../components/ThemeToggle";
import SelectBox from "../../../components/SelectBox";
import { clearRoomTokens } from "../../../utils/gameApi";
import {
  useClueRound,
  useGameResults,
  useGameState,
  usePlayers,
  useRoleReveal,
  useVoting,
} from "../../../hooks/useGameState";

const PHASE_LABELS = {
  WAITING_FOR_PLAYERS: "Player များကို စောင့်နေသည်",
  ROLE_ASSIGNMENT: "အခန်းကဏ္ဍ သတ်မှတ်ပြီးပါပြီ",
  ROLE_REVEAL: "အခန်းကဏ္ဍ ကြည့်ရှုချိန်",
  CLUE_ROUND: "အရိပ်အမြွက် ပေးချိန်",
  VOTING: "မဲပေးချိန်",
  VOTE_RESULTS: "မဲရလဒ်",
  IMPOSTER_GUESS: "နောက်ဆုံး ခန့်မှန်းချက်",
  ROUND_RESULTS: "အကြိမ်ရလဒ်",
  GAME_OVER: "ဂိမ်းပြီးဆုံးပါပြီ",
};

function PlayerList({ players, playerId, game, isHost, request }) {
  async function removePlayer(targetId) {
    const result = await request(
      `/games/${encodeURIComponent(game.game_id)}/players/${encodeURIComponent(targetId)}`,
      { player_id: playerId },
      "DELETE",
    );
    if (result) {
      window.sessionStorage.removeItem(`imposter-token:${game.game_id}:${targetId}`);
    }
  }

  return (
    <ul className="player-list">
      {players.map((player) => (
        <li className={`player-row${player.player_id === playerId ? " current-player" : ""}`} key={player.player_id}>
          <span className="player-avatar" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <circle cx="12" cy="8" r="4" />
              <path d="M4.5 21a7.5 7.5 0 0 1 15 0z" />
            </svg>
          </span>
          <div className="player-name">
            <strong>{player.name}</strong>
            <span>
              {player.player_id === playerId ? "သင်" : ""}
              {player.player_id === game.host_id ? (player.player_id === playerId ? " · " : "") + "အိမ်ရှင်" : ""}
            </span>
          </div>
          {isHost && game.phase === "WAITING_FOR_PLAYERS" ? (
            <span className="player-management">
              {player.player_id !== game.host_id && (
                <button className="mini-action remove-action" type="button" onClick={() => removePlayer(player.player_id)}>
                  ဖယ်ရှား
                </button>
              )}
            </span>
          ) : (
            <span className={`player-state ${player.eliminated ? "is-eliminated" : ""}`}>
              {game.phase === "GAME_OVER"
                ? "ဂိမ်းပြီးဆုံး"
                : player.eliminated
                  ? "ထွက်ပြီး"
                  : game.phase === "ROLE_REVEAL" && player.role_viewed
                  ? "ကြည့်ပြီး"
                  : game.phase === "VOTING" && player.has_voted
                    ? "မဲပေးပြီး"
                    : "ကစားနေ"}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function GamePage() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const playerId = searchParams.get("playerId");
  const { game, error, connection, request } = useGameState(id, playerId);
  const players = usePlayers(game);
  const isHost = game?.host_id === playerId;
  const [localPlayerIds, setLocalPlayerIds] = useState([]);
  const lastVibratedTurn = useRef("");
  const lastNotifiedTurn = useRef("");
  const audioContext = useRef(null);
  const [turnAlertsEnabled, setTurnAlertsEnabled] = useState(false);
  const [turnAlertMessage, setTurnAlertMessage] = useState("");
  const [selectedVoterId, setSelectedVoterId] = useState("");
  const [guess, setGuess] = useState("");
  const [submittingGuess, setSubmittingGuess] = useState(false);
  useEffect(() => {
    if (!game || !playerId) return;
    const availableIds = game.players
      .filter((player) =>
        player.player_id === playerId ||
        window.sessionStorage.getItem(`imposter-token:${game.game_id}:${player.player_id}`),
      )
      .map((player) => player.player_id);
    setLocalPlayerIds((current) =>
      current.length === availableIds.length &&
      current.every((player, index) => player === availableIds[index])
        ? current
        : availableIds,
    );
  }, [game?.players, game?.game_id, playerId]);

  const currentTurn = players.find((player) => player.player_id === game?.current_turn_player_id);
  const isMyTurn = game?.phase === "CLUE_ROUND" && currentTurn?.player_id === playerId;
  const turnKey = `${game?.game_id}:${game?.round_number}:${game?.current_clue_round}:${currentTurn?.player_id}`;
  const currentReveal = players.find((player) => player.player_id === game?.current_reveal_player_id);
  const revealPlayerId = game?.current_reveal_player_id ?? playerId;
  const cluePlayerId = game?.current_turn_player_id ?? playerId;
  const eligibleLocalVoters = game?.phase === "VOTING"
    ? players.filter((player) =>
      game.eligible_vote_ids.includes(player.player_id) &&
      !player.has_voted &&
      localPlayerIds.includes(player.player_id),
    )
    : [];
  const votingPlayerId = eligibleLocalVoters.find((player) => player.player_id === selectedVoterId)?.player_id
    ?? eligibleLocalVoters[0]?.player_id
    ?? playerId;
  const guessPlayerId = game?.eliminated_player_id ?? playerId;
  const { role, hint, revealRole, requestHint, hideAndPass } = useRoleReveal(id, revealPlayerId, request);
  const { submitClue, markHintGiven } = useClueRound(id, cluePlayerId, request);
  const { submitVote, resolveVotes } = useVoting(id, votingPlayerId, request);
  const {
    submitGuess,
    markGuessSpoken,
    resolveSpokenGuess,
    restartGame,
  } = useGameResults(id, guessPlayerId, request);
  const [clue, setClue] = useState("");
  const [submittingHint, setSubmittingHint] = useState(false);
  const [editingRoom, setEditingRoom] = useState(false);
  const [categories, setCategories] = useState([]);
  const selectableCategories = game?.hint_input_mode === "TEXT_INPUT"
    ? categories.filter((category) => !category.endsWith(" Kanji"))
    : categories;
  const [replaying, setReplaying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [leavingRoom, setLeavingRoom] = useState(false);
  const [exitFailed, setExitFailed] = useState(false);
  const exitButtonRef = useRef(null);

  useEffect(() => {
    if (!showExitDialog) return undefined;
    function handleEscape(event) {
      if (event.key === "Escape" && !leavingRoom) {
        setShowExitDialog(false);
        setExitFailed(false);
        exitButtonRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [showExitDialog, leavingRoom]);

  const canControlPlayer = (candidateId) => localPlayerIds.includes(candidateId);
  const votingPlayer = players.find((player) => player.player_id === votingPlayerId);

  async function enableTurnAlerts() {
    if (!window.AudioContext) {
      setTurnAlertMessage("ဒီဘရောက်ဆာတွင် အသံသတိပေးချက်ကို မပံ့ပိုးပါ။");
      return;
    }

    let permissionRequest = Promise.resolve("unsupported");
    try {
      if ("Notification" in window) {
        permissionRequest = window.Notification.permission === "default"
          ? window.Notification.requestPermission()
          : Promise.resolve(window.Notification.permission);
      }
    } catch {
      permissionRequest = Promise.resolve("unavailable");
    }

    try {
      if (!audioContext.current) audioContext.current = new window.AudioContext();
      await audioContext.current.resume();
      const permission = await permissionRequest.catch(() => "unavailable");
      setTurnAlertsEnabled(true);
      setTurnAlertMessage(
        permission === "granted"
          ? "အသံနှင့် Browser အသိပေးချက် ဖွင့်ထားပါပြီ။"
          : permission === "denied"
            ? "အသံဖွင့်ထားပါပြီ။ Browser အသိပေးချက်ကို ဘရောက်ဆာဆက်တင်မှ ခွင့်ပြုပါ။"
            : permission === "unsupported"
              ? "အသံသတိပေးချက် ဖွင့်ထားပါပြီ။"
              : "အသံဖွင့်ထားပါပြီ။ Browser အသိပေးချက် မရရှိနိုင်ပါ။",
      );
    } catch {
      setTurnAlertMessage("သတိပေးချက်ကို ဖွင့်မရပါ။ ဘရောက်ဆာဆက်တင်ကို စစ်ဆေးပြီး ထပ်ကြိုးစားပါ။");
    }
  }

  function playTurnAlert() {
    const context = audioContext.current;
    if (!context || context.state !== "running") return;

    const now = context.currentTime;
    [660, 880].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + index * 0.16;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.23);
    });
  }

  useEffect(() => {
    if (!isMyTurn || lastVibratedTurn.current === turnKey) return;
    lastVibratedTurn.current = turnKey;
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate([180, 90, 180]);
    }
  }, [isMyTurn, turnKey]);

  useEffect(() => {
    if (!isMyTurn || !turnAlertsEnabled || lastNotifiedTurn.current === turnKey) return;
    lastNotifiedTurn.current = turnKey;
    playTurnAlert();
    if ("Notification" in window && window.Notification.permission === "granted") {
      try {
        new window.Notification("သင့်အလှည့်ပါ", {
          body: "အရိပ်အမြွက် ပေးရန် သင့်အလှည့်ရောက်ပါပြီ။",
          icon: "/turn-alert.png",
        });
      } catch {
        setTurnAlertMessage("အသံသတိပေးချက် ဖွင့်ထားပါပြီ။ Browser အသိပေးချက် မပြနိုင်ပါ။");
      }
    }
  }, [isMyTurn, turnAlertsEnabled, turnKey]);

  useEffect(() => () => {
    audioContext.current?.close();
  }, []);

  useEffect(() => {
    if (!isHost || game?.phase !== "WAITING_FOR_PLAYERS" || categories.length > 0) return;
    request("/categories", undefined, "GET").then((result) => {
      if (result) setCategories(result.categories);
    });
  }, [categories.length, game?.phase, isHost, request]);

  async function submitTextGuess(event) {
    event.preventDefault();
    if (submittingGuess || !guess.trim()) return;

    setSubmittingGuess(true);
    const result = await submitGuess(guess.trim());
    if (result) setGuess("");
    setSubmittingGuess(false);
  }

  if (!playerId) {
    return <main className="state-shell"><section className="glass-card state-card">
      <p className="eyebrow">အခန်းထဲ ဝင်ရန်</p>
      <h1>Player အချက်အလက် မရှိပါ</h1>
      <p>ပင်မစာမျက်နှာမှ အခန်းထဲ ပြန်ဝင်ပါ။</p>
      <a className="primary-button link-button" href="/">ပင်မစာမျက်နှာသို့</a>
    </section></main>;
  }

  if (!game) {
    return <main className="state-shell"><section className="glass-card state-card">
      <div className="loading-orb" aria-hidden="true" />
      <h3>{error ? "ဂိမ်းကို ဖွင့်မရပါ" : "ဂိမ်းအချက်အလက်ကို ရယူနေသည်"}</h3>
      <p role={error ? "alert" : undefined}>{error || "ခဏစောင့်ပေးပါ..."}</p>
      {error && <a className="secondary-button link-button" href="/">ပင်မစာမျက်နှာသို့ ပြန်သွားမယ်</a>}
    </section></main>;
  }

  const votesSubmitted = players.filter(
    (player) => game.eligible_vote_ids.includes(player.player_id) && player.has_voted,
  ).length;
  const eligibleVoteCount = game.eligible_vote_ids.length;
  const voteTargets = players.filter(
    (player) =>
      !player.eliminated &&
      player.player_id !== playerId &&
      (game.tied_player_ids.length === 0 || game.tied_player_ids.includes(player.player_id)),
  );
  const clues = game.clues.filter((item) => item.round_number === game.round_number);
  const activeCluePlayers = players.filter((player) => !player.eliminated);
  const clueRoundSubmissionCount = activeCluePlayers.filter((player) =>
    game.submitted_clue_player_ids.includes(player.player_id),
  ).length;
  const clueProgress = game.clue_rounds
    ? ((game.current_clue_round - 1 + clueRoundSubmissionCount / Math.max(activeCluePlayers.length, 1)) /
      game.clue_rounds) * 100
    : 0;
  const roundResult = game.round_results.find((item) => item.round_number === game.round_number);
  const imposterPlayerIds = new Set(
    roundResult?.player_stats
      .filter((player) => player.role === "imposter")
      .map((player) => player.player_id) ?? [],
  );
  const overallWinner = game.final_results?.winner === "TIE"
    ? "သရေကျပါသည်"
    : game.final_results?.winner === "IMPOSTERS"
      ? "Imposter အဖွဲ့"
      : "Player အဖွဲ့";
  const roundWinner = roundResult?.winner === "IMPOSTERS"
    ? "Imposter အဖွဲ့"
    : "Player အဖွဲ့";
  const resultWinner = game.phase === "GAME_OVER" ? overallWinner : roundWinner;
  const isGameTie = game.phase === "GAME_OVER" && game.final_results?.winner === "TIE";
  const connectionLabel = connection === "Connected"
    ? "Connected"
    : connection === "Disconnected"
      ? "Disconnected"
      : connection === "Connection error"
        ? "Connection error"
        : "Connecting";
  const canExitRoom = game.phase === "WAITING_FOR_PLAYERS" || game.phase === "GAME_OVER";
  const closesRoom = isHost || game.phase !== "WAITING_FOR_PLAYERS";
  const exitCancelText = closesRoom ? "မပိတ်တော့ပါ" : "မထွက်တော့ပါ";
  const exitActionText = closesRoom ? "အခန်းပိတ်မည်" : "အခန်းမှ ထွက်မည်";
  const exitProgressText = closesRoom ? "အခန်းပိတ်နေသည်..." : "ထွက်နေသည်...";

  async function copyRoomCode() {
    try {
      await navigator.clipboard.writeText(game.room_code);
      setCopied(true);
      setCopyError("");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
      setCopyError("ကုဒ်ကို အလိုအလျောက်ကူးယူမရပါ။ အခန်းကုဒ်ကို ဖိ၍ကူးယူပါ။");
    }
  }

  async function leaveRoom() {
    if (leavingRoom) return;
    setLeavingRoom(true);
    setExitFailed(false);
    const result = await request(`/games/${encodeURIComponent(id)}/leave`, {
      player_id: playerId,
    });
    if (!result) {
      setLeavingRoom(false);
      setExitFailed(true);
      return;
    }

    clearRoomTokens(id);
    window.location.href = "/";
  }

  function closeExitDialog() {
    if (leavingRoom) return;
    setShowExitDialog(false);
    setExitFailed(false);
    exitButtonRef.current?.focus();
  }

  async function advanceRound() {
    await request(`/games/${encodeURIComponent(id)}/rounds/next`, { player_id: playerId });
  }

  async function finishGame() {
    await request(`/games/${encodeURIComponent(id)}/finish`, { player_id: playerId });
  }

  async function changePlayerCount(value) {
    await request(`/games/${encodeURIComponent(id)}/settings/players`, {
      player_id: playerId,
      desired_player_count: Number(value),
    });
  }

  async function changeCategory(value) {
    await request(`/games/${encodeURIComponent(id)}/settings/category`, {
      player_id: playerId,
      category: value,
    });
  }

  async function changeClueRounds(value) {
    await request(`/games/${encodeURIComponent(id)}/settings/clue-rounds`, {
      player_id: playerId,
      clue_rounds: Number(value),
    });
  }

  async function changeImposterCount(value) {
    const imposterCount = Number(value);
    const minimumPlayers = imposterCount * 2 + 1;
    const targetPlayerCount = Math.max(
      game.desired_player_count ?? 3,
      game.player_count,
      minimumPlayers,
    );

    if (targetPlayerCount !== game.desired_player_count) {
      const playerCountResult = await request(
        `/games/${encodeURIComponent(id)}/settings/players`,
        { player_id: playerId, desired_player_count: targetPlayerCount },
      );
      if (!playerCountResult) return;
    }

    await request(`/games/${encodeURIComponent(id)}/settings`, {
      player_id: playerId,
      imposter_count: imposterCount,
    });
  }

  async function replay() {
    if (replaying) return;
    setReplaying(true);
    await restartGame(playerId);
    setReplaying(false);
  }

  return (
    <main className="room-shell">
      <header className="room-topbar room-page-topbar">
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
        <div className="room-header-actions">
          <div
            className={`room-header-room-control ${canExitRoom ? "has-exit" : ""}`}
          >
            {canExitRoom && (
              <button
                ref={exitButtonRef}
                className="icon-button leave-room-button"
                type="button"
                onClick={() => {
                  setExitFailed(false);
                  setShowExitDialog(true);
                }}
                aria-label="အခန်းမှ ထွက်ရန်"
                title="အခန်းမှ ထွက်ရန်"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M10 17l5-5-5-5M15 12H3" />
                  <path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" />
                </svg>
              </button>
            )}
            <div
              className="room-id-pill"
              aria-label={`Room ID ${game.room_code}; ${connectionLabel}`}
              title={connectionLabel}
            >
              အခန်းကုဒ် {game.room_code}
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      {showExitDialog && (
        <div
          className="modal-backdrop confirm-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeExitDialog();
          }}
        >
          <section
            className="glass-card confirm-modal exit-confirm-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="exit-dialog-title"
            aria-describedby="exit-dialog-message"
            aria-busy={leavingRoom}
          >
            <div className="exit-dialog-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M10 17l5-5-5-5M15 12H3" />
                <path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" />
              </svg>
            </div>
            <h2 id="exit-dialog-title">
              {closesRoom ? "အခန်းကို ပိတ်မလား?" : "အခန်းမှ ထွက်မလား?"}
            </h2>
            <p id="exit-dialog-message" className="muted">
              {closesRoom
                ? "အခန်းမှ ထွက်ပါက အခန်းသည် အားလုံးအတွက် ပိတ်သွားပါမည်။"
                : "အခန်းမှ ထွက်ပြီး ပင်မစာမျက်နှာသို့ ပြန်သွားပါမည်။"}
            </p>
            {exitFailed && error && <p className="error-message" role="alert">{error}</p>}
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={closeExitDialog}
                disabled={leavingRoom}
                autoFocus
              >
                {exitCancelText}
              </button>
              <button
                className="exit-confirm-button"
                type="button"
                onClick={leaveRoom}
                disabled={leavingRoom}
              >
                {leavingRoom ? exitProgressText : exitActionText}
              </button>
            </div>
          </section>
        </div>
      )}

      <div className="room-layout">
        <section className="room-main">
          {game.phase === "CLUE_ROUND" && (
            <section className="round-progress" aria-label={`အရိပ်အမြွက်အကြိမ် ${game.current_clue_round} / ${game.clue_rounds}`}>
              <div className="round-progress-label">
                <span>အရိပ်အမြွက်အကြိမ် {game.current_clue_round} / {game.clue_rounds}</span>
                <span>ယခုအကြိမ် ပေးပြီးသူ {clueRoundSubmissionCount} / {activeCluePlayers.length}</span>
              </div>
              <div
                className="progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(clueProgress)}
              >
                <span style={{ width: `${clueProgress}%` }} />
              </div>
            </section>
          )}

          {copyError && <p className="error-message" role="alert">{copyError}</p>}

          {game.phase === "WAITING_FOR_PLAYERS" && (
            <section className="glass-card game-panel">
              <h2>သူငယ်ချင်းတွေကို ဖိတ်ခေါ်ပါ</h2>
              <p className="muted">
                အခန်းကုဒ်ကို မျှဝေပြီး {game.desired_player_count ?? "၃ မှ ၁၀"} ယောက် စုဝေးပါ။
                {" "}အရိပ်အမြွက်ကို {game.clue_rounds} ကြိမ်စီ ပေးရမည်။
              </p>
              <div className="lobby-code">
                <span>အခန်းကုဒ်</span>
                <strong>{game.room_code}</strong>
                <button
                  type="button"
                  className={`icon-button copy-room-button${copied ? " copied" : ""}`}
                  onClick={copyRoomCode}
                  aria-label={copied ? "အခန်းကုဒ်ကူးယူပြီးပါပြီ" : "အခန်းကုဒ်ကူးယူရန်"}
                  title={copied ? "ကူးယူပြီးပါပြီ" : "အခန်းကုဒ်ကူးယူရန်"}
                >
                  <span aria-hidden="true">{copied ? "✓" : "⧉"}</span>
                </button>
              </div>
              {isHost && (
                <div className="room-lobby-settings">
                  <div className="room-category-setting">
                    <label htmlFor="editCategory">စကားလုံးအမျိုးအစား</label>
                    <SelectBox id="editCategory" value={game.category} onValueChange={changeCategory}>
                      {selectableCategories.map((category) => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                    </SelectBox>
                  </div>
                  <div className="room-category-setting">
                    <label htmlFor="editClueRounds">အရိပ်အမြွက်</label>
                    <SelectBox
                      id="editClueRounds"
                      value={game.clue_rounds}
                      onValueChange={changeClueRounds}
                    >
                      {Array.from({ length: 10 }, (_, index) => index + 1)
                        .map((count) => <option key={count} value={count}>{count} ကြိမ်</option>)}
                    </SelectBox>
                  </div>
                </div>
              )}
              {isHost && editingRoom && (
                <div className="room-settings-grid">
                  <div>
                    <label htmlFor="editPlayerCount">Player</label>
                    <SelectBox
                      id="editPlayerCount"
                      value={game.desired_player_count ?? Math.max(3, game.player_count)}
                      onValueChange={changePlayerCount}
                    >
                      {Array.from({ length: 8 }, (_, index) => index + 3)
                        .filter((count) =>
                          count >= game.player_count &&
                          count >= (game.imposter_count ?? 1) * 2 + 1,
                        )
                        .map((count) => <option key={count} value={count}>{count} ယောက်</option>)}
                    </SelectBox>
                  </div>
                  <div>
                    <label htmlFor="editImposterCount">Imposter</label>
                    <SelectBox
                      id="editImposterCount"
                      value={game.imposter_count ?? 1}
                      onValueChange={changeImposterCount}
                    >
                      <option value="1">၁ ယောက်</option>
                      <option value="2">၂ ယောက်</option>
                      <option value="3">၃ ယောက်</option>
                    </SelectBox>
                  </div>
                </div>
              )}
              <div className="form-row lobby-actions">
                {isHost && (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={
                      !game.hint_input_mode ||
                      game.player_count < 3 ||
                      (game.desired_player_count !== null &&
                        game.player_count !== game.desired_player_count)
                    }
                    onClick={() => request(`/games/${encodeURIComponent(id)}/start`, { player_id: playerId })}
                  >
                    အခန်းကဏ္ဍ သတ်မှတ်မယ် <span aria-hidden="true">→</span>
                  </button>
                )}
                {isHost && (
                  <button
                    className="secondary-button room-edit-button"
                    type="button"
                    aria-expanded={editingRoom}
                    onClick={() => setEditingRoom((editing) => !editing)}
                  >
                    {editingRoom ? "ပြင်ဆင်မှု ပိတ်မယ်" : "အခန်းပြင်မယ်"}
                  </button>
                )}
              </div>
  
              {game.desired_player_count && game.player_count < game.desired_player_count && (
                <p className="inline-note">
                  စတင်ရန် Player {game.desired_player_count - game.player_count} ဦး ထပ်ဝင်ရန် လိုသည်။
                </p>
              )}
              {!game.hint_input_mode && (
                <p className="inline-note">ဂိမ်းမစမီ အရိပ်အမြွက်ပေးမည့်ပုံစံကို ရွေးပါ။</p>
              )}
            </section>
          )}

          {game.phase === "ROLE_ASSIGNMENT" && (
            <section className="glass-card game-panel centered-panel">
              <div className="phase-icon" aria-hidden="true">
                <Image src="/ready.png" alt="" width={72} height={72} />
              </div>
              <h2>လူတိုင်း အသင့်ဖြစ်ပြီလား?</h2>
              {isHost ? (
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => request(`/games/${encodeURIComponent(id)}/roles/start`, { player_id: playerId })}
                >
                  အခန်းကဏ္ဍကြည့်ရှုမှု စမယ် <span aria-hidden="true">→</span>
                </button>
              ) : <p className="inline-note">အိမ်ရှင်က စတင်ပေးရန် စောင့်နေသည်။</p>}
            </section>
          )}

          {game.phase === "ROLE_REVEAL" && (
            <section className="glass-card game-panel centered-panel">
              {canControlPlayer(game.current_reveal_player_id) ? (
                <>
                  <h2>{currentReveal?.name ?? "Player"}  သင့်အလှည့်ပါ</h2>
                  {!role ? (
                    <>
                      <div className="hidden-role-card">
                        <span className="lock-icon" aria-hidden="true">
                          <Image src="/show.png" alt="" width={64} height={64} />
                        </span>
                        <strong>သင့်အခန်းကဏ္ဍကို ဖုံးကွယ်ထားသည်</strong>
                      </div>
                      <button className="primary-button" type="button" onClick={revealRole}>
                        အခန်းကဏ္ဍ ဖော်ပြမယ် <span aria-hidden="true">↗</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <div className={`role-reveal-card ${role.role === "imposter" ? "imposter-role" : ""}`}>
                        <span className="role-symbol" aria-hidden="true">
                          <Image src={role.role === "imposter" ? "/question.png" : "/secret.png"} alt="" width={64} height={64} />
                        </span>
                        <h2>{role.role === "imposter" ? "Imposter" : "Player"}</h2>
                        {role.role === "imposter" ? (
                          <p>လျှို့ဝှက်စကားလုံးကို သင်မသိပါ။ အခြားသူများပေးသော အရိပ်အမြွက်များကို နားထောင်ပါ။</p>
                        ) : (
                          <>
                            <p>ဒီစကားလုံးကို မပြောဘဲ အရိပ်အမြွက် ပေးပါ။</p>
                            <strong className="secret-word">{role.word}</strong>
                          </>
                        )}
                      </div>
                      {role.role === "imposter" && (
                        <div className="hint-box">
                          {hint ? (
                            <>
                              <span>အကူအညီစကားလုံး</span>
                              <strong>{hint.hint}</strong>
                            </>
                          ) : (
                            <>
                              <p>အကူအညီစကားလုံးတစ်ခု ကြည့်နိုင်သည်။</p>
                              <button className="text-button" type="button" onClick={requestHint}>
                                အကူအညီ ကြည့်မယ်
                              </button>
                            </>
                          )}
                        </div>
                      )}
                      <button className="primary-button" type="button" onClick={hideAndPass}>
                        ဖုံးပြီး နောက်တစ်ယောက်ကို လွှဲမယ် <span aria-hidden="true">→</span>
                      </button>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div className="hidden-role-card">
                    <span className="loading-orb" aria-hidden="true" />
                    <strong>{currentReveal?.name ?? "နောက် Player"} ကြည့်ရှုနေသည်</strong>
                    <span>အလှည့်ရောက်သည်အထိ စောင့်ပါ။</span>
                  </div>
                  <p className="inline-note">အခြားသူ၏ အခန်းကဏ္ဍကို မကြည့်ပါနှင့်။</p>
                </>
              )}
            </section>
          )}

          {game.phase === "CLUE_ROUND" && (
            <section className="glass-card game-panel">
              <div className="section-title-row">
                <div>
                  <h2>အရိပ်အမြွက်ပေးပါ</h2>
                </div>
                <span className="count-badge">{clueRoundSubmissionCount}/{activeCluePlayers.length}</span>
              </div>
              <ul className="clue-status-list" aria-label="အရိပ်အမြွက်ပေးပြီးသူများ">
                {activeCluePlayers.map((player) => {
                  const submitted = game.submitted_clue_player_ids.includes(player.player_id);
                  const isCurrentTurn = currentTurn?.player_id === player.player_id;
                  const isLocalTurn = isCurrentTurn && canControlPlayer(player.player_id);
                  const isOtherTurn = isCurrentTurn && !isLocalTurn;
                  return (
                    <li
                      key={player.player_id}
                      className={`${submitted ? "submitted " : ""}${isLocalTurn ? "my-turn" : ""}${isOtherTurn ? " other-turn" : ""}`}
                    >
                      <span className="player-avatar" aria-hidden="true">
                        <svg viewBox="0 0 24 24" focusable="false">
                          <circle cx="12" cy="8" r="4" />
                          <path d="M4.5 21a7.5 7.5 0 0 1 15 0z" />
                        </svg>
                      </span>
                      <h3>{player.name}</h3>
                      {isCurrentTurn ? (
                        <span className={`clue-player-status${submitted ? " is-submitted" : ""}${isLocalTurn ? " is-local-turn" : " is-current-turn"}`}>
                          {submitted ? "ပေးပြီး" : isLocalTurn ? "Your Turn" : "အလှည့်ရောက်နေသည်"}
                        </span>
                      ) : (
                        <span className={`clue-player-status${submitted ? " is-submitted" : ""}`}>
                          {submitted ? "ပေးပြီး" : "စောင့်နေသည်"}
                        </span>
                      )}
                      <Image
                        className="clue-status-indicator"
                        src={submitted ? "/tick.png" : "/turn.png"}
                        alt=""
                        aria-hidden="true"
                        width={20}
                        height={20}
                      />
                    </li>
                  );
                })}
              </ul>
              {!currentTurn && (
                <p className="inline-note success-note">လူတိုင်း အရိပ်အမြွက် ပေးပြီးပါပြီ။ မဲပေးနိုင်ပါပြီ။</p>
              )}
              <div className="turn-alert-controls">
                <button
                  className="mini-action turn-alert-button"
                  type="button"
                  onClick={enableTurnAlerts}
                  disabled={turnAlertsEnabled}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" />
                    {turnAlertsEnabled ? (
                      <>
                        <path d="M15 9a5 5 0 0 1 0 6" />
                        <path d="M17.5 6.5a9 9 0 0 1 0 11" />
                      </>
                    ) : (
                      <path d="m16 9 5 6m0-6-5 6" />
                    )}
                  </svg>
                  {turnAlertsEnabled ? "အသံသတိပေးချက် ဖွင့်ထားသည်" : "အသံနှင့် Browser အသိပေးချက် ဖွင့်ရန်"}
                </button>
              </div>

              {game.hint_input_mode === "TEXT_INPUT" && clues.length > 0 ? (
                <ol className="clue-list">
                  {clues.map((item, index) => (
                    <li key={`${item.player_id}-${index}`}>
                      <span className="player-avatar" aria-hidden="true">
                        <svg viewBox="0 0 24 24" focusable="false">
                          <circle cx="12" cy="8" r="4" />
                          <path d="M4.5 21a7.5 7.5 0 0 1 15 0z" />
                        </svg>
                      </span>
                      <span className="clue-player">{item.player_name}</span>
                      <span className="clue-round-label">အကြိမ် {item.clue_round_number}</span>
                      <strong>{item.clue}</strong>
                    </li>
                  ))}
                </ol>
              ) : game.hint_input_mode === "TEXT_INPUT" && clues.length === 0 ? (
                <p className="empty-state">အရိပ်အမြွက် မပေးရသေးပါ။</p>
              ) : null}

              {canControlPlayer(game.current_turn_player_id) &&
                game.hint_input_mode === "TABLE_TALK" && (
                  <div className="table-talk-actions">
                    <button
                      className="primary-button hint-given-button"
                      type="button"
                      disabled={submittingHint}
                      onClick={async () => {
                        setSubmittingHint(true);
                        const result = await markHintGiven();
                        if (result) setClue("");
                        setSubmittingHint(false);
                      }}
                    >
                      {submittingHint ? "ခဏစောင့်ပါ..." : "အရိပ်အမြွက်ပေးပြီးပါပြီ"}
                    </button>
                  </div>
              )}

              {canControlPlayer(game.current_turn_player_id) &&
                game.hint_input_mode === "TEXT_INPUT" && (
                <form
                  className="action-form"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    setSubmittingHint(true);
                    if (await submitClue(clue)) setClue("");
                    setSubmittingHint(false);
                  }}
                >
                  <label htmlFor="clue">သင့်အရိပ်အမြွက်</label>
                  <textarea
                    id="clue"
                    value={clue}
                    maxLength={200}
                    onChange={(event) => setClue(event.target.value)}
                    placeholder="စကားလုံးကို တိုက်ရိုက်မပြောပါနှင့်"
                    required
                  />
                  <button className="primary-button" type="submit" disabled={submittingHint}>
                    {submittingHint ? "ခဏစောင့်ပါ..." : "အရိပ်အမြွက် ပေးပို့မည်"} <span aria-hidden="true">→</span>
                  </button>
                </form>
              )}
              {game.current_turn_player_id !== null && !canControlPlayer(game.current_turn_player_id) && (
                <p className="inline-note">သင့်အလှည့်ရောက်သည်အထိ စကားလုံးများကို နားထောင်ပါ။</p>
              )}
            </section>
          )}

          {game.phase === "VOTING" && (
            <section className="glass-card game-panel">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">မဲရလဒ်များကို မဲပြီးမှ ပြသမည်</p>
                  <h2>{game.tied_player_ids.length ? "သရေကျသူများကို ပြန်မဲပေးပါ" : "ဘယ်သူ့ကို သံသယရှိသလဲ?"}</h2>
                </div>
                <span className="count-badge">{votesSubmitted}/{eligibleVoteCount}</span>
              </div>
              <div className="progress-track" aria-label={`မဲပေးပြီး ${votesSubmitted} ဦး`}>
                <span style={{ width: `${eligibleVoteCount ? (votesSubmitted / eligibleVoteCount) * 100 : 0}%` }} />
              </div>
              <p className="muted">မိမိကိုယ်ကို မဲပေး၍မရပါ။ မဲရလဒ်ကို အားလုံးမဲပေးပြီးမှ ဖော်ပြပါမည်။</p>
              {eligibleLocalVoters.length > 1 && (
                <div className="voter-selector">
                  <label htmlFor="voterSelect">မဲပေးမည့် Player</label>
                  <SelectBox
                    id="voterSelect"
                    value={votingPlayerId}
                    onValueChange={setSelectedVoterId}
                  >
                    {eligibleLocalVoters.map((player) => (
                      <option key={player.player_id} value={player.player_id}>{player.name}</option>
                    ))}
                  </SelectBox>
                </div>
              )}
              {game.tied_player_ids.length > 0 && (
                <p className="inline-note">သရေကျသူများထဲမှ တစ်ဦးကိုသာ ရွေးချယ်ပါ။</p>
              )}
              {votingPlayer?.has_voted ? (
                <div className="voted-state">
                  <span className="success-check" aria-hidden="true">✓</span>
                  <div><strong>{votingPlayer.name} ၏ မဲကို မှတ်တမ်းတင်ပြီးပါပြီ</strong><span>ကျန်Player များ မဲပေးရန် စောင့်နေသည်။</span></div>
                </div>
              ) : canControlPlayer(votingPlayerId) && voteTargets.length > 0 ? (
                <ul className="vote-options">
                  {voteTargets.map((player) => (
                    <li key={player.player_id}>
                      <button className="vote-option" type="button" onClick={() => submitVote(player.player_id)}>
                        <span className="player-avatar" aria-hidden="true">
                          <svg viewBox="0 0 24 24" focusable="false">
                            <circle cx="12" cy="8" r="4" />
                            <path d="M4.5 21a7.5 7.5 0 0 1 15 0z" />
                          </svg>
                        </span>
                        <strong>{player.name}</strong>
                        <span aria-hidden="true">→</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="empty-state">မဲပေးရန် သင့်ကိုယ်ပိုင်စက်မှ ဝင်ပါ။</p>}
            </section>
          )}

          {game.phase === "VOTE_RESULTS" && (
            <section className="glass-card game-panel">
              <p className="eyebrow">အားလုံး မဲပေးပြီးပါပြီ</p>
              <h2>မဲရလဒ်</h2>
              <ul className="results-list">
                {game.vote_counts?.map((result) => (
                  <li key={result.player_id}>
                    <span className="player-avatar" aria-hidden="true">
                      <svg viewBox="0 0 24 24" focusable="false">
                        <circle cx="12" cy="8" r="4" />
                        <path d="M4.5 21a7.5 7.5 0 0 1 15 0z" />
                      </svg>
                    </span>
                    <span>{result.player_name}</span>
                    <strong>{result.count} မဲ</strong>
                  </li>
                ))}
              </ul>
              {isHost ? (
                <button className="primary-button" type="button" onClick={resolveVotes}>
                  ရလဒ်ကို ဆုံးဖြတ်မယ် <span aria-hidden="true">→</span>
                </button>
              ) : <p className="inline-note">အိမ်ရှင်က မဲရလဒ်ကို ဆုံးဖြတ်ပေးရန် စောင့်နေသည်။</p>}
            </section>
          )}

          {game.phase === "IMPOSTER_GUESS" && (
            <section className="glass-card game-panel centered-panel">
              <div className="phase-icon phase-icon-large" aria-hidden="true">
                <Image src="/qa.png" alt="" width={112} height={112} />
              </div>
              <h2 className="guess-title">လျှို့ဝှက်စကားလုံးကို ခန့်မှန်းပါ</h2>
              {game.hint_input_mode === "TEXT_INPUT" && canControlPlayer(game.eliminated_player_id) ? (
                <form
                  className="action-form"
                  onSubmit={submitTextGuess}
                >
                  <label htmlFor="guess">သင့်ခန့်မှန်းချက်</label>
                  <input
                    id="guess"
                    value={guess}
                    maxLength={200}
                    onChange={(event) => setGuess(event.target.value)}
                    placeholder="စကားလုံးရိုက်ထည့်ပါ"
                    required
                  />
                  <button className="primary-button" type="submit" disabled={submittingGuess || !guess.trim()}>
                    {submittingGuess ? "ပို့နေသည်…" : "ခန့်မှန်းချက် ပို့မယ်"} <span aria-hidden="true">→</span>
                  </button>
                </form>
              ) : game.hint_input_mode === "TABLE_TALK" ? (
                <div className="table-talk-actions">
                  {canControlPlayer(game.eliminated_player_id) && !game.guess_submitted && (
                    <button className="primary-button" type="button" onClick={markGuessSpoken}>
                      ခန့်မှန်းပြီးပါပြီ <span aria-hidden="true">→</span>
                    </button>
                  )}
                  {game.guess_submitted && isHost ? (
                    <div className="guess-decision-actions">
                      <button className="primary-button" type="button" onClick={() => resolveSpokenGuess(true, playerId)}>
                        မှန်သည်
                      </button>
                      <button className="secondary-button" type="button" onClick={() => resolveSpokenGuess(false, playerId)}>
                        မှားသည်
                      </button>
                    </div>
                  ) : game.guess_submitted ? (
                    <p className="inline-note">အိမ်ရှင်က ခန့်မှန်းချက်ကို မှန်/မှား အတည်ပြုပေးရန် စောင့်နေသည်။</p>
                  ) : null}
                </div>
              ) : (
                <p className="inline-note">Imposter ၏ ခန့်မှန်းချက်ကို စောင့်နေသည်။</p>
              )}
            </section>
          )}

          {(game.phase === "ROUND_RESULTS" || game.phase === "GAME_OVER") && roundResult && (
            <section className="glass-card game-panel result-screen">
              <header className={`result-hero${isGameTie ? " is-draw" : ""}`}>
                <span className="result-hero-icon has-image" aria-hidden="true">
                  <Image src={isGameTie ? "/draw.png" : "/winner.png"} alt="" width={64} height={64} />
                </span>
                <div className="result-hero-copy">
                  <h2>{resultWinner}{isGameTie ? "" : " အနိုင်ရပါပြီ"}</h2>
                </div>
              </header>

              <div className="round-reveal">
                <div className="round-reveal-secret">
                  <Image src="/secret.png" alt="" width={34} height={34} />
                  <div className="round-reveal-label">
                    <span>လျှို့ဝှက်စကားလုံး</span>
                    <strong>{roundResult.secret_word}</strong>
                  </div>
                </div>
                <div className="round-reveal-imposters">
                  <span className="player-avatar" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false">
                      <circle cx="12" cy="8" r="4" />
                      <path d="M4.5 21a7.5 7.5 0 0 1 15 0z" />
                    </svg>
                  </span>
                  <div className="round-reveal-label">
                    <span>Imposter</span>
                    <strong>{roundResult.imposter_names.join("၊ ")}</strong>
                  </div>
                </div>
              </div>

              <div className="result-columns">
                <div className="result-votes">
                  <div className="result-votes-heading">
                    <h3>မဲရလဒ်</h3>
                  </div>
                  <ul className="results-list">
                    {roundResult.vote_counts.map((result) => (
                      <li
                        key={result.player_id}
                        className={imposterPlayerIds.has(result.player_id) ? "imposter-vote-result" : undefined}
                      >
                        <span className="player-avatar" aria-hidden="true">
                          <svg viewBox="0 0 24 24" focusable="false">
                            <circle cx="12" cy="8" r="4" />
                            <path d="M4.5 21a7.5 7.5 0 0 1 15 0z" />
                          </svg>
                        </span>
                        <span>{result.player_name}</span>
                        <strong>{result.count} မဲ</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {game.phase === "GAME_OVER" && game.final_results ? (
                <section className="final-results">
                  <div className="modal-actions">
                    <button className="secondary-button" type="button" onClick={() => { window.location.href = "/"; }}>
                      ပင်မစာမျက်နှာသို့ ပြန်သွားမယ်
                    </button>
                    {isHost && (
                      <button
                        className="primary-button"
                        type="button"
                        onClick={replay}
                        disabled={replaying}
                      >
                        {replaying ? "ဂိမ်းပြန်စနေသည်..." : "ပြန်ကစားမယ်"}
                        {!replaying && <span aria-hidden="true">↻</span>}
                      </button>
                    )}
                  </div>
                  <p className="inline-note">{isHost
                    ? "လက်ရှိအခန်းနှင့် Player များကို ဆက်သုံးပြီး ဂိမ်းကို ပြန်စနိုင်သည်။"
                    : "အိမ်ရှင်က ဒီအခန်းထဲမှာ ဂိမ်းပြန်စရန် စောင့်နေသည်။"}</p>
                </section>
              ) : (
                <div className="round-result-actions">
                  {isHost ? (
                    <>
                      {game.round_number < game.total_rounds && (
                        <button className="primary-button" type="button" onClick={advanceRound}>
                          နောက်တစ်ကြိမ် ဆက်ကစားမယ် <span aria-hidden="true">→</span>
                        </button>
                      )}
                      <button className="secondary-button" type="button" onClick={finishGame}>
                        ဂိမ်းအဆုံးသတ်မယ်
                      </button>
                    </>
                  ) : <p className="inline-note">အိမ်ရှင်က နောက်တစ်ကြိမ် စရန် သို့မဟုတ် ဂိမ်းအဆုံးသတ်ရန် စောင့်နေသည်။</p>}
                </div>
              )}
            </section>
          )}

          {error && (!showExitDialog || !exitFailed) && <p className="error-message" role="alert">{error}</p>}
        </section>

        <aside className="glass-card players-panel">
          <div className="section-title-row">
            <div>
              <h2>Player များ</h2>
            </div>
          </div>
          <PlayerList
            players={players}
            playerId={playerId}
            game={game}
            isHost={isHost}
            request={request}
          />
          <div className="sidebar-tip">
            <span aria-hidden="true">✦</span>
            <p>လျှို့ဝှက်စကားလုံးကို မပြောဘဲ သဲလွန်စပေးပါ။</p>
          </div>
        </aside>
      </div>

    </main>
  );
}
