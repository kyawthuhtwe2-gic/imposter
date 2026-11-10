"use client";

import Image from "next/image";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import ThemeToggle from "../../../components/ThemeToggle";
import {
  useClueRound,
  useGameResults,
  useGameState,
  usePlayers,
  useRoleReveal,
  useVoting,
} from "../../../hooks/useGameState";

const PHASE_LABELS = {
  WAITING_FOR_PLAYERS: "ကစားသမားများကို စောင့်နေသည်",
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
  const [editingPlayerId, setEditingPlayerId] = useState(null);
  const [editedName, setEditedName] = useState("");

  async function saveName(event, targetId) {
    event.preventDefault();
    const result = await request(
      `/games/${encodeURIComponent(game.game_id)}/players/${encodeURIComponent(targetId)}`,
      { player_id: playerId, player_name: editedName },
      "PUT",
    );
    if (result) setEditingPlayerId(null);
  }

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
      {players.map((player, index) => (
        <li className={`player-row${player.player_id === playerId ? " current-player" : ""}`} key={player.player_id}>
          <span className="player-avatar" aria-hidden="true">{index + 1}</span>
          <div className="player-name">
            {editingPlayerId === player.player_id ? (
              <form className="player-edit-form" onSubmit={(event) => saveName(event, player.player_id)}>
                <input
                  aria-label={`${player.name} အမည်ပြင်ရန်`}
                  value={editedName}
                  maxLength={30}
                  onChange={(event) => setEditedName(event.target.value)}
                  required
                />
                <button className="mini-action" type="submit">သိမ်းမယ်</button>
                <button className="mini-action quiet-action" type="button" onClick={() => setEditingPlayerId(null)}>မလုပ်တော့</button>
              </form>
            ) : <strong>{player.name}</strong>}
            <span>
              {player.player_id === playerId ? "သင်" : ""}
              {player.player_id === game.host_id ? (player.player_id === playerId ? " · " : "") + "အိမ်ရှင်" : ""}
            </span>
          </div>
          {isHost && game.phase === "WAITING_FOR_PLAYERS" ? (
            <span className="player-management">
              <button
                className="mini-action quiet-action"
                type="button"
                onClick={() => {
                  setEditingPlayerId(player.player_id);
                  setEditedName(player.name);
                }}
              >
                ပြင်ရန်
              </button>
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
    createReplaySession,
  } = useGameResults(id, guessPlayerId, request);
  const [clue, setClue] = useState("");
  const [submittingHint, setSubmittingHint] = useState(false);
  const [editingRoom, setEditingRoom] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const canControlPlayer = (candidateId) => localPlayerIds.includes(candidateId);
  const votingPlayer = players.find((player) => player.player_id === votingPlayerId);

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
      <h1>ကစားသမားအချက်အလက် မရှိပါ</h1>
      <p>ပင်မစာမျက်နှာမှ အခန်းထဲ ပြန်ဝင်ပါ။</p>
      <a className="primary-button link-button" href="/">ပင်မစာမျက်နှာသို့</a>
    </section></main>;
  }

  if (!game) {
    return <main className="state-shell"><section className="glass-card state-card">
      <div className="loading-orb" aria-hidden="true" />
      <h1>{error ? "ဂိမ်းကို ဖွင့်မရပါ" : "ဂိမ်းအချက်အလက်ကို ရယူနေသည်"}</h1>
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
  const overallWinner = game.final_results?.winner === "TIE"
    ? "သရေကျပါသည်"
    : game.final_results?.winner === "IMPOSTERS"
      ? "လျှို့ဝှက်လူလိမ်အဖွဲ့"
      : "ပုံမှန်ကစားသမားအဖွဲ့";
  const connectionLabel = connection === "Connected"
    ? "ချိတ်ဆက်ထားသည်"
    : connection === "Disconnected" || connection === "Connection error"
      ? "ပြန်လည်ချိတ်ဆက်ရန် လိုအပ်သည်"
      : "ချိတ်ဆက်နေသည်";

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

  async function advanceRound() {
    await request(`/games/${encodeURIComponent(id)}/rounds/next`, { player_id: playerId });
  }

  async function finishGame() {
    await request(`/games/${encodeURIComponent(id)}/finish`, { player_id: playerId });
  }

  async function changePlayerCount(event) {
    await request(`/games/${encodeURIComponent(id)}/settings/players`, {
      player_id: playerId,
      desired_player_count: Number(event.target.value),
    });
  }

  async function changeTotalRounds(event) {
    await request(`/games/${encodeURIComponent(id)}/settings/rounds`, {
      player_id: playerId,
      total_rounds: Number(event.target.value),
    });
  }

  async function changeHintMode(event) {
    await request(`/games/${encodeURIComponent(id)}/settings/hint-mode`, {
      player_id: playerId,
      hint_input_mode: event.target.value,
    });
  }

  async function changeImposterCount(event) {
    const imposterCount = Number(event.target.value);
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
    const newGame = await createReplaySession(playerId);
    if (!newGame) {
      setReplaying(false);
      return;
    }
    window.sessionStorage.setItem(`imposter-token:${newGame.game_id}`, newGame.player_token);
    window.location.href = `/room/${newGame.game_id}?playerId=${newGame.player_id}`;
  }

  return (
    <main className="room-shell">
      <header className="room-topbar">
        <a className="wordmark" href="/" aria-label="ပင်မစာမျက်နှာ">
          <Image
            className="wordmark-logo"
            src="/imposter-logo-icon.webp"
            alt=""
            width={345}
            height={370}
          />
          <span>လျှို့ဝှက်လူလိမ်</span>
        </a>
        <div className="room-header-actions">
          <div className="connection-pill">
            <span className={`connection-dot ${connection === "Connected" ? "online" : ""}`} />
            {connectionLabel}
          </div>
          <ThemeToggle />
        </div>
      </header>

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
              {isHost && editingRoom && (
                <div className="room-settings-grid">
                  <div>
                    <label htmlFor="editHintMode">အရိပ်အမြွက်နှင့် နောက်ဆုံးခန့်မှန်းပုံစံ</label>
                    <select id="editHintMode" value={game.hint_input_mode ?? ""} onChange={changeHintMode}>
                      <option value="TABLE_TALK">လူချင်းပြောမည် (အိမ်ရှင်က ခန့်မှန်းချက်စစ်မည်)</option>
                      <option value="TEXT_INPUT">စာရိုက်ထည့်မည် (ခန့်မှန်းချက်ကို အလိုအလျောက်စစ်မည်)</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="editPlayerCount">ကစားသမားအရေအတွက်</label>
                    <select
                      id="editPlayerCount"
                      value={game.desired_player_count ?? Math.max(3, game.player_count)}
                      onChange={changePlayerCount}
                    >
                      {Array.from({ length: 8 }, (_, index) => index + 3)
                        .filter((count) =>
                          count >= game.player_count &&
                          count >= (game.imposter_count ?? 1) * 2 + 1,
                        )
                        .map((count) => <option key={count} value={count}>{count} ယောက်</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="editImposterCount">လျှို့ဝှက်လူလိမ် အရေအတွက်</label>
                    <select
                      id="editImposterCount"
                      value={game.imposter_count ?? 1}
                      onChange={changeImposterCount}
                    >
                      <option value="1">၁ ယောက်</option>
                      <option value="2">၂ ယောက်</option>
                      <option value="3">၃ ယောက်</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="editTotalRounds">ဂိမ်းအကြိမ်ရေ</label>
                    <select id="editTotalRounds" value={game.total_rounds} onChange={changeTotalRounds}>
                      {Array.from({ length: 20 }, (_, index) => index + 1)
                        .map((count) => <option key={count} value={count}>{count} ကြိမ်</option>)}
                    </select>
                  </div>
                </div>
              )}
              <div className="form-row">
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
              {game.player_count < 3 && (
                <p className="inline-note">ဂိမ်းစရန် အနည်းဆုံး ကစားသမား ၃ ဦး လိုအပ်သည်။</p>
              )}
              {game.desired_player_count && game.player_count < game.desired_player_count && (
                <p className="inline-note">
                  စတင်ရန် ကစားသမား {game.desired_player_count - game.player_count} ဦး ထပ်ဝင်ရန် လိုသည်။
                </p>
              )}
              {!game.hint_input_mode && (
                <p className="inline-note">ဂိမ်းမစမီ အရိပ်အမြွက်ပေးမည့်ပုံစံကို ရွေးပါ။</p>
              )}
            </section>
          )}

          {game.phase === "ROLE_ASSIGNMENT" && (
            <section className="glass-card game-panel centered-panel">
              <div className="phase-icon" aria-hidden="true">✦</div>
              <p className="eyebrow">လျှို့ဝှက်အခန်းကဏ္ဍများ</p>
              <h2>လူတိုင်း အသင့်ဖြစ်ပြီလား?</h2>
              <p className="muted">စက်ကို တစ်ယောက်ချင်းစီထံ လွှဲပေးပြီး ကိုယ့်အခန်းကဏ္ဍကို သီးသန့်ကြည့်ပါ။</p>
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
              <p className="eyebrow">သီးသန့်ကြည့်ရှုရန်</p>
              {canControlPlayer(game.current_reveal_player_id) ? (
                <>
                  <h2>{currentReveal?.name ?? "ကစားသမား"}၊ သင့်အလှည့်ပါ</h2>
                  {!role ? (
                    <>
                      <div className="hidden-role-card">
                        <span className="lock-icon" aria-hidden="true">◈</span>
                        <strong>သင့်အခန်းကဏ္ဍကို ဖုံးကွယ်ထားသည်</strong>
                        <span>အခြားသူများ မကြည့်မိစေရန် သေချာပါစေ</span>
                      </div>
                      <button className="primary-button" type="button" onClick={revealRole}>
                        အခန်းကဏ္ဍ ဖော်ပြမယ် <span aria-hidden="true">↗</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <div className={`role-reveal-card ${role.role === "imposter" ? "imposter-role" : ""}`}>
                        <span className="role-symbol" aria-hidden="true">{role.role === "imposter" ? "◉" : "✦"}</span>
                        <p className="eyebrow">သင့်အခန်းကဏ္ဍ</p>
                        <h2>{role.role === "imposter" ? "လျှို့ဝှက်လူလိမ်" : "ပုံမှန်ကစားသမား"}</h2>
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
                    <strong>{currentReveal?.name ?? "နောက်ကစားသမား"} ကြည့်ရှုနေသည်</strong>
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
                  <p className="eyebrow">သံသယရှိသူကို ရှာဖွေပါ</p>
                  <h2>အရိပ်အမြွက်ပေးပါ</h2>
                </div>
                <span className="count-badge">{clueRoundSubmissionCount}/{activeCluePlayers.length}</span>
              </div>
              <ul className="clue-status-list" aria-label="အရိပ်အမြွက်ပေးပြီးသူများ">
                {activeCluePlayers.map((player) => {
                  const submitted = game.submitted_clue_player_ids.includes(player.player_id);
                  return (
                    <li key={player.player_id} className={submitted ? "submitted" : ""}>
                      <span className="clue-status-indicator" aria-hidden="true">
                        {submitted ? "✓" : "·"}
                      </span>
                      <span>{player.name}</span>
                      <span>{submitted ? "ပေးပြီး" : "စောင့်နေသည်"}</span>
                    </li>
                  );
                })}
              </ul>
              {currentTurn ? (
                <div className="turn-banner">
                  <span className="turn-dot" />
                  <span className="your-turn-indicator">သင့်အလှည့်</span>
                  <strong>{currentTurn.name}</strong>
                  {canControlPlayer(currentTurn.player_id) && <span className="you-badge">ဒီစက်</span>}
                </div>
              ) : (
                <p className="inline-note success-note">လူတိုင်း အရိပ်အမြွက် ပေးပြီးပါပြီ။ မဲပေးနိုင်ပါပြီ။</p>
              )}

              {game.hint_input_mode === "TEXT_INPUT" && clues.length > 0 ? (
                <ol className="clue-list">
                  {clues.map((item, index) => (
                    <li key={`${item.player_id}-${index}`}>
                      <span className="clue-index">{String(index + 1).padStart(2, "0")}</span>
                      <span className="clue-player">{item.player_name}</span>
                      <span className="clue-round-label">အကြိမ် {item.clue_round_number}</span>
                      <strong>{item.clue}</strong>
                    </li>
                  ))}
                </ol>
              ) : game.hint_input_mode === "TABLE_TALK" ? (
                <p className="empty-state">
                  လူချင်းမျက်နှာချင်းဆိုင် ပြောပါ။ ပြောဆိုမှုများကို မှတ်တမ်းတင်မထားပါ။
                </p>
              ) : clues.length === 0 ? (
                <p className="empty-state">အရိပ်အမြွက် မပေးရသေးပါ။</p>
              ) : null}

              {canControlPlayer(game.current_turn_player_id) &&
                game.hint_input_mode === "TABLE_TALK" && (
                  <div className="table-talk-actions">
                    <p className="table-talk-prompt">
                      {currentTurn?.name}၊ သင့်အရိပ်အမြွက်ကို အတူထိုင်နေသူများထံ ပြောပါ။
                    </p>
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
                  <label htmlFor="voterSelect">မဲပေးမည့် ကစားသမား</label>
                  <select
                    id="voterSelect"
                    value={votingPlayerId}
                    onChange={(event) => setSelectedVoterId(event.target.value)}
                  >
                    {eligibleLocalVoters.map((player) => (
                      <option key={player.player_id} value={player.player_id}>{player.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {game.tied_player_ids.length > 0 && (
                <p className="inline-note">သရေကျသူများထဲမှ တစ်ဦးကိုသာ ရွေးချယ်ပါ။</p>
              )}
              {votingPlayer?.has_voted ? (
                <div className="voted-state">
                  <span className="success-check" aria-hidden="true">✓</span>
                  <div><strong>{votingPlayer.name} ၏ မဲကို မှတ်တမ်းတင်ပြီးပါပြီ</strong><span>ကျန်ကစားသမားများ မဲပေးရန် စောင့်နေသည်။</span></div>
                </div>
              ) : canControlPlayer(votingPlayerId) && voteTargets.length > 0 ? (
                <ul className="vote-options">
                  {voteTargets.map((player) => (
                    <li key={player.player_id}>
                      <button className="vote-option" type="button" onClick={() => submitVote(player.player_id)}>
                        <span className="player-avatar">{player.name.slice(0, 1)}</span>
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
              <p className="eyebrow">နောက်ဆုံးအခွင့်အရေး</p>
              <h2>လျှို့ဝှက်စကားလုံးကို ခန့်မှန်းပါ</h2>
              <p className="muted">ဖော်ထုတ်ခံရသူက စကားလုံးကို တစ်ကြိမ်သာ ခန့်မှန်းနိုင်သည်။</p>
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
                  <p className="table-talk-prompt">
                    ဖော်ထုတ်ခံရသူက စကားလုံးကို လူချင်းပြောပါ။ ခန့်မှန်းချက်ကို အိမ်ရှင်က အတည်ပြုပေးမည်။
                  </p>
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
                  ) : !canControlPlayer(game.eliminated_player_id) ? (
                    <p className="inline-note">ဖော်ထုတ်ခံရသူက ခန့်မှန်းချက်ပြောပြီး အတည်ပြုရန် စောင့်နေသည်။</p>
                  ) : null}
                </div>
              ) : (
                <p className="inline-note">လျှို့ဝှက်လူလိမ်၏ ခန့်မှန်းချက်ကို စောင့်နေသည်။</p>
              )}
            </section>
          )}

          {(game.phase === "ROUND_RESULTS" || game.phase === "GAME_OVER") && roundResult && (
            <section className="glass-card game-panel result-screen">
              <div className={`result-emblem ${roundResult.winner === "IMPOSTERS" ? "imposter-emblem" : ""}`} aria-hidden="true">
                {roundResult.winner === "IMPOSTERS" ? "◉" : "✦"}
              </div>
              <p className="eyebrow">
                {game.phase === "GAME_OVER" ? "နောက်ဆုံးအကြိမ်ရလဒ်" : "အကြိမ်ရလဒ်"}
                {" · "}အကြိမ် {roundResult.round_number} / {game.total_rounds}
              </p>
              <h2>{roundResult.winner === "IMPOSTERS" ? "လျှို့ဝှက်လူလိမ်အဖွဲ့" : "ပုံမှန်ကစားသမားအဖွဲ့"} အနိုင်ရပါပြီ</h2>
              <div className="round-reveal">
                <div>
                  <span>လျှို့ဝှက်စကားလုံး</span>
                  <strong>{roundResult.secret_word}</strong>
                </div>
                <div>
                  <span>လျှို့ဝှက်လူလိမ်</span>
                  <strong>{roundResult.imposter_names.join("၊ ")}</strong>
                </div>
              </div>

              <div className="result-columns">
                <div>
                  <h3>မဲရလဒ်</h3>
                  <ul className="results-list">
                    {roundResult.vote_counts.map((result) => (
                      <li key={result.player_id}>
                        <span>{result.player_name}</span>
                        <strong>{result.count} မဲ</strong>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3>ကစားသမားစာရင်း</h3>
                  <ul className="results-list">
                    {roundResult.player_stats.map((player) => (
                      <li key={player.player_id}>
                        <span>
                          {player.player_name}
                          <small>{player.role === "imposter" ? " · လျှို့ဝှက်လူလိမ်" : " · ပုံမှန်ကစားသမား"}</small>
                        </span>
                        <strong>
                          {(roundResult.winner === "IMPOSTERS") === (player.role === "imposter")
                            ? "နိုင်"
                            : "ရှုံး"}
                        </strong>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {game.phase === "GAME_OVER" && game.final_results ? (
                <section className="final-results">
                  <p className="eyebrow">နောက်ဆုံးရလဒ်</p>
                  <h3>{overallWinner}{overallWinner !== "သရေကျပါသည်" ? " အနိုင်ရပါပြီ" : ""}</h3>
                  <div className="final-score">
                    <span>ကစားပြီး {game.final_results.rounds_played} / {game.final_results.total_rounds} ကြိမ်</span>
                    <strong>ပုံမှန်အဖွဲ့ {game.final_results.normal_player_wins} : {game.final_results.imposter_wins} လျှို့ဝှက်လူလိမ်အဖွဲ့</strong>
                  </div>
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
                        {replaying ? "ဂိမ်းအသစ် ဖွင့်နေသည်..." : "ပြန်ကစားမယ်"}
                        {!replaying && <span aria-hidden="true">↻</span>}
                      </button>
                    )}
                  </div>
                  <p className="inline-note">{isHost
                    ? "ဂိမ်းအသစ်အတွက် အခန်းကုဒ်ကို ကစားသမားများထံ မျှဝေပါ။"
                    : "အိမ်ရှင်က ဂိမ်းအသစ်စတင်ရန် စောင့်ပါ၊ သို့မဟုတ် အခန်းအသစ်ထဲ ဝင်ပါ။"}</p>
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

          {error && <p className="error-message" role="alert">{error}</p>}
        </section>

        <aside className="glass-card players-panel">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">အခန်းထဲရှိသူများ</p>
              <h2>ကစားသမားများ</h2>
            </div>
            <span className="count-badge">{game.player_count}</span>
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
