import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  useClueRound,
  useGameResults,
  usePlayers,
  useRoleReveal,
  useVoting,
} from "./useGameState";

describe("game state hooks", () => {
  it("derives players from server-owned game state", () => {
    const players = [{ player_id: "one", name: "One" }];
    const { result } = renderHook(() => usePlayers({ players }));
    expect(result.current).toEqual(players);
    const empty = renderHook(() => usePlayers(null));
    expect(empty.result.current).toEqual([]);
  });

  it("reveals only the current player's role and clears it before passing", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ role: "imposter", word: null })
      .mockResolvedValueOnce({ status: "advanced" })
      .mockResolvedValueOnce({ hint: "အခြားစကားလုံး", note: "မူရင်းစကားလုံးမဟုတ်ပါ" });
    const { result } = renderHook(() => useRoleReveal("game", "player", request));

    await act(async () => result.current.revealRole());
    expect(result.current.role).toEqual({ role: "imposter", word: null });
    await act(async () => result.current.hideAndPass());
    await act(async () => result.current.requestHint());

    expect(result.current.role).toBeNull();
    expect(result.current.hint.hint).toBe("အခြားစကားလုံး");
    expect(request).toHaveBeenNthCalledWith(
      1,
      "/games/game/roles/player/reveal",
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/games/game/roles/player/next",
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      "/games/game/roles/player/hint",
    );
  });

  it("sends clues, votes, guesses, and reset actions to the API", async () => {
    const request = vi.fn().mockResolvedValue({ status: "ok" });
    const clue = renderHook(() => useClueRound("g", "p", request));
    const voting = renderHook(() => useVoting("g", "p", request));
    const results = renderHook(() => useGameResults("g", "p", request));

    await act(async () => {
      await clue.result.current.submitClue("hint");
      await voting.result.current.submitVote("target");
      await voting.result.current.resolveVotes();
      await results.result.current.submitGuess("word");
      await results.result.current.resetGame();
      await results.result.current.createReplaySession("host");
    });

    expect(request.mock.calls.map(([path]) => path)).toEqual([
      "/games/g/clues",
      "/games/g/votes",
      "/games/g/votes/resolve",
      "/games/g/imposter-guess",
      "/games/g/reset",
      "/games/g/replay",
    ]);
    expect(request.mock.calls[0][1]).toEqual({ player_id: "p", clue: "hint" });
    expect(request.mock.calls[1][1]).toEqual({ player_id: "p", target_id: "target" });
    expect(request.mock.calls[3][1]).toEqual({ player_id: "p", guess: "word" });
    expect(request.mock.calls[5][1]).toEqual({ player_id: "host" });
  });

  it("marks table-talk hints through the shared clue-turn endpoint", async () => {
    const request = vi.fn().mockResolvedValue({ status: "hint_given" });
    const { result } = renderHook(() => useClueRound("room", "player", request));

    await act(async () => result.current.markHintGiven());

    expect(request).toHaveBeenCalledWith(
      "/games/room/hints/given",
      { player_id: "player" },
    );
  });
});
