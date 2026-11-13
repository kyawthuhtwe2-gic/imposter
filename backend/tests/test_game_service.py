import pytest

import app.game_service as game_module
from app.game_service import GameService
from app.models import GamePhase, HintInputMode


def create_game(
    player_count: int = 3,
    imposter_count: int | None = 1,
    clue_rounds: int = 1,
) -> tuple[GameService, str, list[str]]:
    service = GameService()
    game, host = service.create_game(
        "Player 1",
        "အစားအသောက်",
        imposter_count,
        clue_rounds=clue_rounds,
        hint_input_mode=HintInputMode.TEXT_INPUT,
    )
    player_ids = [host.player_id]
    for index in range(2, player_count + 1):
        player_ids.append(service.add_player(game.game_id, f"Player {index}").player_id)
    return service, game.game_id, player_ids


def reveal_roles(service: GameService, game_id: str, host_id: str) -> dict[str, object]:
    game = service.games[game_id]
    service.assign_roles(game_id, host_id)
    assert game.phase == GamePhase.ROLE_ASSIGNMENT
    service.start_role_reveal(game_id, host_id)
    roles = {}
    for player in game.players:
        role = service.get_player_role(game_id, player.player_id)
        roles[player.player_id] = role
        service.advance_role_reveal(game_id, player.player_id)
    assert game.phase == GamePhase.CLUE_ROUND
    return roles


def finish_clue_round(service: GameService, game_id: str) -> None:
    game = service.games[game_id]
    while game.turn_index < len(game.turn_order):
        player_id = game.turn_order[game.turn_index]
        service.submit_clue(game_id, player_id, f"clue-{game.round_number}-{player_id}")


def test_assigns_expected_roles_and_keeps_secret_private(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(game_module, "sample", lambda players, count: players[:count])
    monkeypatch.setattr(game_module, "choice", lambda words: words[0])
    service, game_id, players = create_game(5, 2)

    roles = reveal_roles(service, game_id, players[0])

    assert sum(role.role == "imposter" for role in roles.values()) == 2
    assert all(role.word is None for role in roles.values() if role.role == "imposter")
    assert all(role.word for role in roles.values() if role.role == "player")
    assert all(
        not hasattr(player, "role")
        for player in service.get_game_state(game_id, players[0]).players
    )
    assert not hasattr(service.get_game_state(game_id, players[0]), "secret_word")


def test_assigns_three_imposters_in_seven_player_game(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(game_module, "sample", lambda players, count: players[:count])
    service = GameService()
    game, host = service.create_game(
        "Player 1",
        "အစားအသောက်",
        3,
        desired_player_count=7,
        hint_input_mode=HintInputMode.TEXT_INPUT,
    )
    player_ids = [host.player_id]
    for index in range(2, 8):
        player_ids.append(service.add_player(game.game_id, f"Player {index}").player_id)

    roles = reveal_roles(service, game.game_id, host.player_id)

    assert sum(role.role == "imposter" for role in roles.values()) == 3


def test_three_imposters_require_at_least_seven_configured_players() -> None:
    service = GameService()
    game, host = service.create_game(
        "Host",
        "အစားအသောက်",
        desired_player_count=7,
        hint_input_mode=HintInputMode.TEXT_INPUT,
    )

    service.set_imposter_count(game.game_id, host.player_id, 3)
    with pytest.raises(ValueError, match="support at most 2"):
        service.configure_player_count(game.game_id, host.player_id, 6)


def test_player_count_and_imposter_rules() -> None:
    service, game_id, players = create_game(2)
    with pytest.raises(ValueError, match="3 to 10"):
        service.assign_roles(game_id, players[0])

    service, game_id, players = create_game(4, 2)
    with pytest.raises(ValueError, match="at most 1"):
        service.assign_roles(game_id, players[0])

    service, game_id, players = create_game(10, 2)
    service.assign_roles(game_id, players[0])
    assert service.games[game_id].imposter_count == 2


def test_default_imposter_count_is_one() -> None:
    service = GameService()
    game, _ = service.create_game("Host", "အစားအသောက်")
    assert game.imposter_count == 1


def test_unique_names_and_player_limit() -> None:
    service, game_id, _ = create_game(3)
    with pytest.raises(ValueError, match="unique"):
        service.add_player(game_id, " player 1 ")
    for index in range(4, 11):
        service.add_player(game_id, f"Player {index}")
    with pytest.raises(ValueError, match="at most 10"):
        service.add_player(game_id, "Player 11")


def test_host_manages_players_by_stable_id_and_preserves_order() -> None:
    service, game_id, players = create_game(4, 1)
    original_order = players.copy()
    added = service.add_player_as_host(game_id, players[0], "  New Player  ")
    assert added.name == "New Player"
    assert added.player_id not in original_order

    service.update_player_name(game_id, players[0], players[2], "Renamed")
    with pytest.raises(ValueError, match="unique"):
        service.update_player_name(game_id, players[0], players[2], " player 1 ")
    with pytest.raises(ValueError, match="1 to 30"):
        service.update_player_name(game_id, players[0], players[2], "   ")

    service.remove_player(game_id, players[0], players[1])
    game_players = service.games[game_id].players
    assert [player.player_id for player in game_players] == [
        players[0],
        players[2],
        players[3],
        added.player_id,
    ]
    assert game_players[1].name == "Renamed"
    assert game_players[1].player_id == players[2]
    with pytest.raises(ValueError, match="cannot be removed"):
        service.remove_player(game_id, players[0], players[0])


def test_non_host_can_leave_waiting_room() -> None:
    service, game_id, players = create_game()

    room_closed = service.leave_game(game_id, players[1])

    assert room_closed is False
    assert [player.player_id for player in service.games[game_id].players] == [
        players[0],
        players[2],
    ]


def test_host_or_active_player_leaving_closes_room() -> None:
    service, game_id, players = create_game()
    assert service.leave_game(game_id, players[0]) is True
    assert game_id not in service.games

    service, game_id, players = create_game()
    service.games[game_id].phase = GamePhase.CLUE_ROUND
    assert service.leave_game(game_id, players[1]) is True
    assert game_id not in service.games


def test_selected_player_count_controls_room_capacity_and_start() -> None:
    service = GameService()
    game, host = service.create_game(
        "Host",
        "အစားအသောက်",
        total_rounds=3,
        desired_player_count=4,
        hint_input_mode=HintInputMode.TEXT_INPUT,
    )
    guest = service.add_player(game.game_id, "Guest")
    third = service.add_player(game.game_id, "Third")
    with pytest.raises(ValueError, match="selected player count"):
        service.assign_roles(game.game_id, host.player_id)

    service.configure_player_count(game.game_id, host.player_id, 4)
    fourth = service.add_player(game.game_id, "Fourth")
    with pytest.raises(ValueError, match="Remove players"):
        service.configure_player_count(game.game_id, host.player_id, 3)
    with pytest.raises(ValueError, match="already been reached"):
        service.add_player(game.game_id, "Extra")
    assert len(service.get_game_state(game.game_id).players) == 4
    service.assign_roles(game.game_id, host.player_id)
    state = service.get_game_state(game.game_id, host.player_id)
    assert state.desired_player_count == 4
    assert [player.player_id for player in service.games[game.game_id].players] == [
        host.player_id,
        guest.player_id,
        third.player_id,
        fourth.player_id,
    ]


def test_category_can_be_changed_by_host_before_game_starts() -> None:
    service, game_id, players = create_game()
    category = next(
        category
        for category in game_module.WORDS_BY_CATEGORY
        if category != service.games[game_id].category
    )

    service.configure_category(game_id, players[0], category)
    assert service.get_game_state(game_id, players[0]).category == category

    with pytest.raises(PermissionError, match="Only the game host"):
        service.configure_category(game_id, players[1], category)
    with pytest.raises(ValueError, match="Unknown category"):
        service.configure_category(game_id, players[0], "Unknown category")

    service.games[game_id].phase = GamePhase.ROLE_ASSIGNMENT
    with pytest.raises(ValueError, match="before the game starts"):
        service.configure_category(game_id, players[0], category)


def test_kanji_categories_are_only_available_for_table_talk(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(game_module, "choice", lambda categories: categories[-1])
    service = GameService()
    text_game, _ = service.create_game(
        "Text Host", hint_input_mode=HintInputMode.TEXT_INPUT
    )
    assert not text_game.category.endswith(" Kanji")

    with pytest.raises(ValueError, match="only available for face-to-face"):
        service.create_game(
            "Text Host",
            "JLPT N5 Kanji",
            hint_input_mode=HintInputMode.TEXT_INPUT,
        )

    talk_game, talk_host = service.create_game(
        "Talk Host",
        "JLPT N5 Kanji",
        hint_input_mode=HintInputMode.TABLE_TALK,
    )
    assert talk_game.category == "JLPT N5 Kanji"

    with pytest.raises(ValueError, match="only available for face-to-face"):
        service.configure_hint_input_mode(
            talk_game.game_id, talk_host.player_id, HintInputMode.TEXT_INPUT
        )


@pytest.mark.parametrize("round_count", [1, 3, 5, 10, 20])
def test_supported_round_counts(round_count: int) -> None:
    service, game_id, players = create_game()
    service.configure_total_rounds(game_id, players[0], round_count)
    assert service.get_game_state(game_id, players[0]).total_rounds == round_count


@pytest.mark.parametrize("round_count", [0, -1, 21, 1.5, True])
def test_invalid_round_counts_are_rejected(round_count: int) -> None:
    service, game_id, players = create_game()
    with pytest.raises(ValueError, match="between 1 and 20"):
        service.configure_total_rounds(game_id, players[0], round_count)


def test_clue_round_count_can_be_configured_by_host_before_game_starts() -> None:
    service, game_id, players = create_game()

    service.configure_clue_rounds(game_id, players[0], 5)
    assert service.get_game_state(game_id, players[0]).clue_rounds == 5

    with pytest.raises(PermissionError, match="Only the game host"):
        service.configure_clue_rounds(game_id, players[1], 3)
    for count in (0, 11, 1.5, True):
        with pytest.raises(ValueError, match="between 1 and 10"):
            service.configure_clue_rounds(game_id, players[0], count)

    service.games[game_id].phase = GamePhase.ROLE_ASSIGNMENT
    with pytest.raises(ValueError, match="before the game starts"):
        service.configure_clue_rounds(game_id, players[0], 2)


def test_role_reveal_is_sequential_private_and_one_time() -> None:
    service, game_id, players = create_game(3)
    service.assign_roles(game_id, players[0])
    service.start_role_reveal(game_id, players[0])

    with pytest.raises(PermissionError, match="turn"):
        service.get_player_role(game_id, players[1])
    with pytest.raises(ValueError, match="View your role"):
        service.advance_role_reveal(game_id, players[0])
    role = service.get_player_role(game_id, players[0])
    assert role.player_id == players[0]
    with pytest.raises(ValueError, match="already viewed"):
        service.get_player_role(game_id, players[0])
    service.advance_role_reveal(game_id, players[0])
    assert service.get_game_state(game_id, players[1]).current_reveal_player_id == players[1]


def test_imposter_receives_one_private_hint_not_the_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(game_module, "sample", lambda players, count: players[1 : 1 + count])
    monkeypatch.setattr(game_module, "choice", lambda words: words[0])
    service, game_id, players = create_game(3, 1)
    game = service.games[game_id]
    service.assign_roles(game_id, players[0])
    service.start_role_reveal(game_id, players[0])

    with pytest.raises(PermissionError, match="turn"):
        service.get_imposter_hint(game_id, players[1])
    service.get_player_role(game_id, players[0])
    with pytest.raises(PermissionError, match="Only imposters"):
        service.get_imposter_hint(game_id, players[0])
    service.advance_role_reveal(game_id, players[0])
    imposter = next(player for player in game.players if player.role == "imposter")

    role = None
    for player in game.players[1:]:
        role = service.get_player_role(game_id, player.player_id)
        if player.role == "imposter":
            break
        service.advance_role_reveal(game_id, player.player_id)
    assert role is not None and role.role == "imposter"
    hint = service.get_imposter_hint(game_id, imposter.player_id)
    assert hint != game.secret_word
    with pytest.raises(ValueError, match="already been shown"):
        service.get_imposter_hint(game_id, imposter.player_id)


def test_clue_turns_rounds_and_duplicate_clues() -> None:
    service, game_id, players = create_game(clue_rounds=2)
    reveal_roles(service, game_id, players[0])
    with pytest.raises(ValueError, match="Clue cannot be empty"):
        service.submit_clue(game_id, players[0], "   ")
    with pytest.raises(PermissionError, match="turn"):
        service.submit_clue(game_id, players[1], "first clue")
    service.submit_clue(game_id, players[0], "shared clue")
    with pytest.raises(ValueError, match="already submitted"):
        service.submit_clue(game_id, players[0], "another clue")
    with pytest.raises(ValueError, match="already given"):
        service.submit_clue(game_id, players[1], "SHARED CLUE")
    service.submit_clue(game_id, players[1], "second clue")
    service.submit_clue(game_id, players[2], "third clue")
    state = service.get_game_state(game_id, players[0])
    assert state.current_clue_round == 2
    assert state.current_turn_player_id == players[0]
    assert state.submitted_clue_player_ids == []
    assert service.games[game_id].round_number == 1
    finish_clue_round(service, game_id)
    state = service.get_game_state(game_id, players[0])
    assert state.phase == GamePhase.VOTING
    assert state.current_clue_round == 2
    assert len(state.clues) == len(players) * 2
    assert service.games[game_id].round_number == 1


def test_table_talk_uses_shared_turns_without_recording_spoken_hints() -> None:
    service = GameService()
    game, host = service.create_game(
        "Player 1",
        "အစားအသောက်",
        clue_rounds=2,
        hint_input_mode=HintInputMode.TABLE_TALK,
    )
    players = [host.player_id]
    players.extend(
        service.add_player(game.game_id, f"Player {index}").player_id
        for index in range(2, 4)
    )
    reveal_roles(service, game.game_id, host.player_id)

    with pytest.raises(ValueError, match="Text hints"):
        service.submit_clue(game.game_id, players[0], "must not be stored")
    for clue_round in range(1, 3):
        for index, player_id in enumerate(players):
            service.mark_hint_given(game.game_id, player_id)
            if index == 0:
                with pytest.raises(ValueError, match="already submitted"):
                    service.mark_hint_given(game.game_id, player_id)
        state = service.get_game_state(game.game_id, host.player_id)
        if clue_round == 1:
            assert state.phase == GamePhase.CLUE_ROUND
            assert state.current_clue_round == 2
            assert state.current_turn_player_id == players[0]
        else:
            assert state.phase == GamePhase.VOTING
            assert state.eligible_vote_ids == players

    assert state.hint_input_mode == HintInputMode.TABLE_TALK
    assert state.clues == []
    assert state.completed_turns == len(players)
    assert state.submitted_clue_player_ids == players
    assert not hasattr(state, "secret_word")


def test_hint_mode_is_required_host_selected_and_locked_after_start() -> None:
    service = GameService()
    game, host = service.create_game("Host", "အစားအသောက်")
    service.add_player(game.game_id, "Guest 1")
    service.add_player(game.game_id, "Guest 2")
    with pytest.raises(ValueError, match="must select"):
        service.assign_roles(game.game_id, host.player_id)
    with pytest.raises(PermissionError, match="Only the game host"):
        service.configure_hint_input_mode(
            game.game_id, game.players[1].player_id, HintInputMode.TEXT_INPUT
        )
    service.configure_hint_input_mode(
        game.game_id, host.player_id, HintInputMode.TABLE_TALK
    )
    service.assign_roles(game.game_id, host.player_id)
    with pytest.raises(ValueError, match="before the game starts"):
        service.configure_hint_input_mode(
            game.game_id, host.player_id, HintInputMode.TEXT_INPUT
        )


@pytest.mark.parametrize("clue_rounds", [1, 2, 3, 5, 6, 10])
def test_configured_clue_cycles_advance_automatically(clue_rounds: int) -> None:
    service, game_id, players = create_game(4, clue_rounds=clue_rounds)
    reveal_roles(service, game_id, players[0])
    with pytest.raises(ValueError, match="automatically"):
        service.start_voting(game_id, players[0])

    for clue_round in range(1, clue_rounds + 1):
        state = service.get_game_state(game_id, players[0])
        assert state.phase == GamePhase.CLUE_ROUND
        assert state.current_clue_round == clue_round
        for index, player_id in enumerate(players):
            service.submit_clue(game_id, player_id, f"clue-{clue_round}-{player_id}")
            state = service.get_game_state(game_id, players[0])
            if index < len(players) - 1:
                assert state.phase == GamePhase.CLUE_ROUND
                assert state.current_clue_round == clue_round
                assert state.current_turn_player_id == players[index + 1]
        state = service.get_game_state(game_id, players[0])
        if clue_round < clue_rounds:
            assert state.phase == GamePhase.CLUE_ROUND
            assert state.current_clue_round == clue_round + 1
            assert state.current_turn_player_id == players[0]
            assert state.submitted_clue_player_ids == []
        else:
            assert state.phase == GamePhase.VOTING
            assert state.current_clue_round == clue_rounds
            assert state.eligible_vote_ids == players

    assert len(state.clues) == len(players) * clue_rounds
    assert all(
        sum(
            clue.player_id == player_id and clue.clue_round_number == clue_round
            for clue in state.clues
        ) == 1
        for player_id in players
        for clue_round in range(1, clue_rounds + 1)
    )
    assert service.games[game_id].round_number == 1
    assert service.games[game_id].round_results == []
    assert len(service.games) == 1
    with pytest.raises(ValueError, match="only be submitted"):
        service.submit_clue(game_id, players[-1], "duplicate final clue")


@pytest.mark.parametrize("clue_rounds", [0, -1, 11])
def test_invalid_clue_round_count_is_rejected(clue_rounds: int) -> None:
    with pytest.raises(ValueError, match="between 1 and 10"):
        GameService().create_game("Host", clue_rounds=clue_rounds)


def test_votes_are_private_until_complete_and_ties_revote() -> None:
    service, game_id, players = create_game(4)
    reveal_roles(service, game_id, players[0])
    finish_clue_round(service, game_id)
    ballots = {players[0]: players[1], players[1]: players[0], players[2]: players[0], players[3]: players[1]}

    for voter in players[:-1]:
        service.submit_vote(game_id, voter, ballots[voter])
        assert service.get_game_state(game_id, players[0]).vote_counts is None
    with pytest.raises(ValueError, match="themselves"):
        service.submit_vote(game_id, players[-1], players[-1])
    service.submit_vote(game_id, players[-1], ballots[players[-1]])
    assert service.games[game_id].phase == GamePhase.VOTE_RESULTS
    assert sum(item.count for item in service.calculate_votes(game_id)) == 4
    with pytest.raises(PermissionError, match="Only the game host"):
        service.handle_tie(game_id, players[1])

    assert service.handle_tie(game_id, players[0]) == "tie"
    state = service.get_game_state(game_id, players[0])
    assert state.phase == GamePhase.VOTING
    assert set(state.tied_player_ids) == {players[0], players[1]}
    with pytest.raises(ValueError, match="only for a tied"):
        service.submit_vote(game_id, players[0], players[2])


def complete_ballot(
    service: GameService,
    game_id: str,
    players: list[str],
    target_id: str,
) -> None:
    for voter_id in players:
        service.submit_vote(
            game_id,
            voter_id,
            next(candidate for candidate in players if candidate != voter_id)
            if voter_id == target_id
            else target_id,
        )


def test_normal_player_identification_awards_imposters_and_scores(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(game_module, "sample", lambda players, count: players[:count])
    service, game_id, players = create_game(3, 1)
    roles = reveal_roles(service, game_id, players[0])
    assert roles[players[1]].role == "player"
    finish_clue_round(service, game_id)
    complete_ballot(service, game_id, players, players[1])
    service.handle_tie(game_id, players[0])

    state = service.get_game_state(game_id, players[0])
    assert state.phase == GamePhase.GAME_OVER
    assert state.winner == "IMPOSTERS"
    assert not hasattr(state, "secret_word")
    assert not hasattr(service.get_game_state(game_id, players[1]), "secret_word")
    assert service.games[game_id].players[0].wins == 1
    assert service.games[game_id].players[1].losses == 1


@pytest.mark.parametrize(("guess_correct", "expected_winner"), [(True, "IMPOSTERS"), (False, "PLAYERS")])
def test_imposter_guess_decides_winner_and_protects_secret(
    monkeypatch: pytest.MonkeyPatch,
    guess_correct: bool,
    expected_winner: str,
) -> None:
    monkeypatch.setattr(game_module, "sample", lambda players, count: players[:count])
    monkeypatch.setattr(game_module, "choice", lambda words: words[0])
    service, game_id, players = create_game()
    reveal_roles(service, game_id, players[0])
    secret = service.games[game_id].secret_word
    finish_clue_round(service, game_id)
    complete_ballot(service, game_id, players, players[0])
    service.handle_tie(game_id, players[0])
    assert service.games[game_id].phase == GamePhase.IMPOSTER_GUESS
    assert not hasattr(service.get_game_state(game_id, players[0]), "secret_word")
    guess = secret if guess_correct else f"not {secret}"
    assert service.submit_imposter_guess(game_id, players[0], guess) is guess_correct
    state = service.get_game_state(game_id, players[0])
    assert state.phase == GamePhase.GAME_OVER
    assert state.winner == expected_winner
    assert not hasattr(state, "secret_word")


def test_wrong_guess_eliminates_one_of_multiple_imposters_and_continues(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(game_module, "sample", lambda players, count: players[:count])
    service, game_id, players = create_game(5, 2)
    reveal_roles(service, game_id, players[0])
    finish_clue_round(service, game_id)
    complete_ballot(service, game_id, players, players[0])
    service.handle_tie(game_id, players[0])

    assert service.submit_imposter_guess(game_id, players[0], "incorrect") is False
    assert service.games[game_id].phase == GamePhase.CLUE_ROUND
    assert service.get_game_state(game_id, players[0]).current_turn_player_id == players[1]
    assert service.games[game_id].players[1].role == "imposter"
    assert all(player.score == 0 for player in service.games[game_id].players)


@pytest.mark.parametrize(("correct", "expected_winner"), [(True, "IMPOSTERS"), (False, "PLAYERS")])
def test_table_talk_imposter_guess_is_resolved_by_host(
    monkeypatch: pytest.MonkeyPatch,
    correct: bool,
    expected_winner: str,
) -> None:
    monkeypatch.setattr(game_module, "sample", lambda players, count: players[1 : 1 + count])
    service, game_id, players = create_game()
    service.configure_hint_input_mode(game_id, players[0], HintInputMode.TABLE_TALK)
    reveal_roles(service, game_id, players[0])
    assert service.games[game_id].players[1].role == "imposter"
    game = service.games[game_id]
    while game.turn_index < len(game.turn_order):
        service.mark_hint_given(game_id, game.turn_order[game.turn_index])
    complete_ballot(service, game_id, players, players[1])
    service.handle_tie(game_id, players[0])

    service.mark_imposter_guess_spoken(game_id, players[1])
    assert service.get_game_state(game_id, players[0]).guess_submitted
    with pytest.raises(ValueError, match="already submitted"):
        service.mark_imposter_guess_spoken(game_id, players[1])
    with pytest.raises(PermissionError, match="game host"):
        service.resolve_spoken_imposter_guess(game_id, players[1], correct)

    assert service.resolve_spoken_imposter_guess(game_id, players[0], correct) is correct
    state = service.get_game_state(game_id, players[0])
    assert state.phase == GamePhase.GAME_OVER
    assert state.winner == expected_winner


def test_reset_preserves_scores_and_clears_round_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(game_module, "sample", lambda players, count: players[:count])
    service, game_id, players = create_game()
    reveal_roles(service, game_id, players[0])
    finish_clue_round(service, game_id)
    complete_ballot(service, game_id, players, players[1])
    service.handle_tie(game_id, players[0])
    game = service.games[game_id]
    scores = [(player.score, player.wins, player.losses) for player in game.players]
    service.reset_round(game_id, players[0])

    assert game.phase == GamePhase.WAITING_FOR_PLAYERS
    assert not game.clues and not game.votes
    assert game.secret_word is None
    assert [(player.score, player.wins, player.losses) for player in game.players] == scores
    assert all(player.role is None and not player.role_viewed for player in game.players)


def test_restart_game_reuses_room_players_and_settings_and_clears_scores() -> None:
    service, game_id, players = create_game(3, 1, clue_rounds=2)
    game = service.games[game_id]
    game.phase = GamePhase.GAME_OVER
    game.total_rounds = 3
    game.desired_player_count = 3
    game.players[0].score = 7
    game.players[0].wins = 2
    game.players[1].losses = 2
    player_credentials = [
        (player.player_id, player.player_token) for player in game.players
    ]

    restarted = service.restart_game(game_id, players[0])

    assert restarted is game
    assert restarted.phase == GamePhase.WAITING_FOR_PLAYERS
    assert restarted.game_id == game_id
    assert [(player.player_id, player.player_token) for player in restarted.players] == player_credentials
    assert restarted.imposter_count == 1
    assert restarted.total_rounds == 3
    assert restarted.desired_player_count == 3
    assert restarted.clue_rounds == 2
    assert restarted.hint_input_mode == HintInputMode.TEXT_INPUT
    assert all((player.score, player.wins, player.losses) == (0, 0, 0) for player in restarted.players)


def finish_match_round(
    service: GameService,
    game_id: str,
    players: list[str],
) -> None:
    finish_clue_round(service, game_id)
    normal_player = next(
        player.player_id
        for player in service.games[game_id].players
        if player.role == "player"
    )
    complete_ballot(service, game_id, players, normal_player)
    service.handle_tie(game_id, players[0])


def test_multiround_results_are_saved_and_next_round_is_explicit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    selected_rounds = 0

    def select_imposters(players, count):
        nonlocal selected_rounds
        selected = players[selected_rounds : selected_rounds + count]
        selected_rounds += 1
        return selected

    monkeypatch.setattr(game_module, "sample", select_imposters)
    monkeypatch.setattr(game_module, "choice", lambda words: words[0])
    service, game_id, players = create_game(3, 1)
    service.configure_total_rounds(game_id, players[0], 2)

    reveal_roles(service, game_id, players[0])
    first_word = service.games[game_id].secret_word
    finish_match_round(service, game_id, players)

    first_state = service.get_game_state(game_id, players[0])
    assert first_state.phase == GamePhase.ROUND_RESULTS
    assert first_state.completed_rounds == 1
    assert first_state.final_results is None
    assert first_state.round_results[0].secret_word == first_word
    assert first_state.round_results[0].imposter_names == ["Player 1"]
    with pytest.raises(PermissionError, match="Only the game host"):
        service.advance_to_next_round(game_id, players[1])
    with pytest.raises(ValueError, match="Roles can only be assigned"):
        service.assign_roles(game_id, players[0])

    service.advance_to_next_round(game_id, players[0])
    game = service.games[game_id]
    assert game.round_number == 2
    assert game.phase == GamePhase.ROLE_ASSIGNMENT
    assert [player.name for player in game.players] == ["Player 1", "Player 2", "Player 3"]
    assert game.secret_word != first_word
    assert not game.clues and not game.votes
    assert all(not player.role_viewed for player in game.players)
    assert {
        player.player_id for player in game.players if player.role == "imposter"
    } == {players[1]}
    with pytest.raises(ValueError, match="current round must be complete"):
        service.advance_to_next_round(game_id, players[0])

    service.start_role_reveal(game_id, players[0])
    for player_id in players:
        service.get_player_role(game_id, player_id)
        service.advance_role_reveal(game_id, player_id)
    finish_match_round(service, game_id, players)

    final_state = service.get_game_state(game_id, players[0])
    assert final_state.phase == GamePhase.GAME_OVER
    assert final_state.completed_rounds == 2
    assert len(final_state.round_results) == 2
    assert final_state.round_results[1].secret_word != first_word
    assert final_state.final_results is not None
    assert final_state.final_results.rounds_played == 2
    assert final_state.final_results.imposter_wins == 2
    assert final_state.final_results.winner == "IMPOSTERS"
    with pytest.raises(ValueError, match="current round must be complete"):
        service.advance_to_next_round(game_id, players[0])


def test_round_count_validation_and_early_finish() -> None:
    service, game_id, players = create_game()
    with pytest.raises(ValueError, match="between 1 and 20"):
        service.configure_total_rounds(game_id, players[0], 21)
    with pytest.raises(PermissionError, match="Only the game host"):
        service.configure_total_rounds(game_id, players[1], 3)

    service.configure_total_rounds(game_id, players[0], 3)
    reveal_roles(service, game_id, players[0])
    finish_match_round(service, game_id, players)
    service.finish_game(game_id, players[0])

    final_results = service.get_game_state(game_id, players[0]).final_results
    assert final_results is not None
    assert final_results.total_rounds == 3
    assert final_results.rounds_played == 1
