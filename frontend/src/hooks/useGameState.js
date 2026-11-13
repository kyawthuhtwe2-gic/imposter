"use client";

import { useCallback, useEffect, useState } from "react";
import { clearRoomTokens, gameRequest, gameWebSocketUrl } from "../utils/gameApi";

const ROOM_CLOSED_CLOSE_CODE = 4001;

export function useGameState(gameId, playerId) {
  const [game, setGame] = useState(null);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("Connecting");
  const [token, setToken] = useState("");

  const request = useCallback(async (path, body, method = "POST") => {
    setError("");
    try {
      const pathPlayerId = path.match(/\/roles\/([^/]+)/)?.[1];
      const actingPlayerId = body?.player_id ?? pathPlayerId;
      const actingToken = actingPlayerId && actingPlayerId !== playerId
        ? window.sessionStorage.getItem(`imposter-token:${gameId}:${actingPlayerId}`) ?? token
        : token;
      return await gameRequest(path, { method, body, token: actingToken });
    } catch (requestError) {
      setError(requestError.message);
      return null;
    }
  }, [gameId, playerId, token]);

  useEffect(() => {
    if (!gameId || !playerId) {
      setConnection("Missing player information");
      return undefined;
    }
    const storedToken = window.sessionStorage.getItem(`imposter-token:${gameId}`);
    if (!storedToken) {
      setConnection("Missing player authentication");
      setError("ကိုယ်ပိုင်အတည်ပြုချက် မရှိပါ။ ဒီဘရောက်ဆာမှ အခန်းထဲ ပြန်ဝင်ပါ။");
      return undefined;
    }
    setToken(storedToken);

    let active = true;
    gameRequest(
      `/games/${encodeURIComponent(gameId)}/state?player_id=${encodeURIComponent(playerId)}`,
      { token: storedToken },
    )
      .then((state) => {
        if (active) setGame(state);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      });

    const socket = new WebSocket(gameWebSocketUrl(gameId, playerId, storedToken));
    socket.addEventListener("open", () => setConnection("Connected"));
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data);
        if (!active) return;
        if (message.type === "room_closed" || message.type === "player_left") {
          clearRoomTokens(gameId);
          window.location.href = "/";
          return;
        }
        if (message.type === "replay") {
          window.sessionStorage.setItem(
            `imposter-token:${message.game_id}`,
            message.player_token,
          );
          window.location.href = `/room/${message.game_id}?playerId=${message.player_id}`;
          return;
        }
        setGame(message);
      } catch {
        setError("ဂိမ်းအချက်အလက်ကို ဖတ်မရပါ။ ခဏစောင့်ပြီး ထပ်မံကြိုးစားပါ။");
      }
    });
    socket.addEventListener("close", (event) => {
      if (!active) return;
      if (event.code === ROOM_CLOSED_CLOSE_CODE) {
        clearRoomTokens(gameId);
        window.location.href = "/";
        return;
      }
      setConnection("Disconnected");
    });
    socket.addEventListener("error", () => {
      if (active) setConnection("Connection error");
    });

    return () => {
      active = false;
      socket.close();
    };
  }, [gameId, playerId]);

  return { game, error, connection, request };
}

export function usePlayers(game) {
  return game?.players ?? [];
}

export function useRoleReveal(gameId, playerId, request) {
  const [role, setRole] = useState(null);
  const [hint, setHint] = useState(null);
  const revealRole = useCallback(async () => {
    const result = await request(
      `/games/${encodeURIComponent(gameId)}/roles/${encodeURIComponent(playerId)}/reveal`,
    );
    if (result) setRole(result);
  }, [gameId, playerId, request]);
  const hideAndPass = useCallback(async () => {
    setRole(null);
    setHint(null);
    await request(
      `/games/${encodeURIComponent(gameId)}/roles/${encodeURIComponent(playerId)}/next`,
    );
  }, [gameId, playerId, request]);
  const requestHint = useCallback(async () => {
    const result = await request(
      `/games/${encodeURIComponent(gameId)}/roles/${encodeURIComponent(playerId)}/hint`,
    );
    if (result) setHint(result);
  }, [gameId, playerId, request]);
  return { role, hint, revealRole, requestHint, hideAndPass };
}

export function useClueRound(gameId, playerId, request) {
  const submitClue = useCallback(
    (clue) => request(`/games/${encodeURIComponent(gameId)}/clues`, { player_id: playerId, clue }),
    [gameId, playerId, request],
  );
  const markHintGiven = useCallback(
    () => request(`/games/${encodeURIComponent(gameId)}/hints/given`, { player_id: playerId }),
    [gameId, playerId, request],
  );
  return { submitClue, markHintGiven };
}

export function useVoting(gameId, playerId, request) {
  const submitVote = useCallback(
    (target_id) =>
      request(`/games/${encodeURIComponent(gameId)}/votes`, {
        player_id: playerId,
        target_id,
      }),
    [gameId, playerId, request],
  );
  const resolveVotes = useCallback(
    () =>
      request(`/games/${encodeURIComponent(gameId)}/votes/resolve`, {
        player_id: playerId,
      }),
    [gameId, playerId, request],
  );
  return { submitVote, resolveVotes };
}

export function useGameResults(gameId, playerId, request) {
  const restartGame = useCallback(
    (hostPlayerId = playerId) =>
      request(`/games/${encodeURIComponent(gameId)}/replay`, {
        player_id: hostPlayerId,
      }),
    [gameId, playerId, request],
  );
  const submitGuess = useCallback(
    (guess) =>
      request(`/games/${encodeURIComponent(gameId)}/imposter-guess`, {
        player_id: playerId,
        guess,
      }),
    [gameId, playerId, request],
  );
  const markGuessSpoken = useCallback(
    () =>
      request(`/games/${encodeURIComponent(gameId)}/imposter-guess/spoken`, {
        player_id: playerId,
      }),
    [gameId, playerId, request],
  );
  const resolveSpokenGuess = useCallback(
    (correct, hostPlayerId = playerId) =>
      request(`/games/${encodeURIComponent(gameId)}/imposter-guess/resolve`, {
        player_id: hostPlayerId,
        correct,
      }),
    [gameId, playerId, request],
  );
  const resetGame = useCallback(
    () =>
      request(`/games/${encodeURIComponent(gameId)}/reset`, {
        player_id: playerId,
      }),
    [gameId, playerId, request],
  );
  return {
    submitGuess,
    markGuessSpoken,
    resolveSpokenGuess,
    resetGame,
    restartGame,
  };
}
