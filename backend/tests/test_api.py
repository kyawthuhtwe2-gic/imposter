from fastapi.testclient import TestClient

from app import main
import app.game_service as game_module
from app.game_service import GameService
from app.models import GamePhase


def test_cors_allows_configured_origins() -> None:
    client = TestClient(main.app)
    origin = main.cors_origins[0]
    response = client.options(
        "/games",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


def test_spoken_imposter_guess_is_adjudicated_by_authenticated_host(monkeypatch) -> None:
    service = GameService()
    monkeypatch.setattr(main, "game_service", service)
    client = TestClient(main.app)
    host = client.post(
        "/games",
        json={"player_name": "Host", "hint_input_mode": "TABLE_TALK"},
    ).json()
    imposter = client.post(
        f"/games/{host['game_id']}/players",
        json={"player_name": "Imposter"},
    ).json()
    game = service.games[host["game_id"]]
    game.phase = GamePhase.IMPOSTER_GUESS
    game.round_number = 1
    game.eliminated_player_id = imposter["player_id"]
    game.secret_word = "secret"
    game.players[0].role = "player"
    game.players[1].role = "imposter"

    spoken = client.post(
        f"/games/{host['game_id']}/imposter-guess/spoken",
        json={"player_id": imposter["player_id"]},
        headers={"Authorization": f"Bearer {imposter['player_token']}"},
    )
    assert spoken.status_code == 200
    state = client.get(
        f"/games/{host['game_id']}/state",
        params={"player_id": host["player_id"]},
        headers={"Authorization": f"Bearer {host['player_token']}"},
    ).json()
    assert state["guess_submitted"] is True

    rejected = client.post(
        f"/games/{host['game_id']}/imposter-guess/resolve",
        json={"player_id": imposter["player_id"], "correct": True},
        headers={"Authorization": f"Bearer {imposter['player_token']}"},
    )
    assert rejected.status_code == 403

    resolved = client.post(
        f"/games/{host['game_id']}/imposter-guess/resolve",
        json={"player_id": host["player_id"], "correct": True},
        headers={"Authorization": f"Bearer {host['player_token']}"},
    )
    assert resolved.status_code == 200
    assert resolved.json() == {"correct": True}
    assert game.phase == GamePhase.GAME_OVER


def test_room_code_uses_two_uppercase_letters_and_six_digits(monkeypatch) -> None:
    monkeypatch.setattr(main, "game_service", GameService())
    client = TestClient(main.app)
    created = client.post("/games", json={"player_name": "Host"}).json()
    room_code = created["room_code"]

    assert len(room_code) == 9
    assert all("A" <= character <= "Z" for character in room_code[:2])
    assert room_code[2] == " "
    assert all("0" <= character <= "9" for character in room_code[3:])
    joined = client.post(
        f"/games/{room_code.lower().replace(' ', '')}/players",
        json={"player_name": "Guest"},
    )

    assert joined.status_code == 200
    assert joined.json()["game_id"] == created["game_id"]


def test_replay_restarts_same_room_for_connected_players(monkeypatch) -> None:
    monkeypatch.setattr(main, "game_service", GameService())
    main.connections.clear()
    client = TestClient(main.app)
    host = client.post("/games", json={"player_name": "Host"}).json()
    guest = client.post(
        f"/games/{host['game_id']}/players",
        json={"player_name": "Guest"},
    ).json()
    main.game_service.games[host["game_id"]].phase = GamePhase.GAME_OVER
    headers = {"Authorization": f"Bearer {host['player_token']}"}

    with client.websocket_connect(
        f"/ws/{host['game_id']}/{host['player_id']}?token={host['player_token']}"
    ) as host_socket:
        host_socket.receive_json()
        with client.websocket_connect(
            f"/ws/{host['game_id']}/{guest['player_id']}?token={guest['player_token']}"
        ) as guest_socket:
            guest_socket.receive_json()
            response = client.post(
                f"/games/{host['game_id']}/replay",
                json={"player_id": host["player_id"]},
                headers=headers,
            )

            assert response.status_code == 200
            host_message = host_socket.receive_json()
            guest_message = guest_socket.receive_json()
            assert response.json()["game_id"] == host["game_id"]
            assert response.json()["room_code"] == host["room_code"]
            assert response.json()["status"] == "restarted"
            assert host_message["game_id"] == host["game_id"]
            assert guest_message["game_id"] == host["game_id"]
            assert host_message["phase"] == "WAITING_FOR_PLAYERS"
            assert guest_message["phase"] == "WAITING_FOR_PLAYERS"
            assert len(main.game_service.games[host["game_id"]].players) == 2


def test_rest_game_creation_join_and_role_privacy(monkeypatch) -> None:
    monkeypatch.setattr(main, "game_service", GameService())
    monkeypatch.setattr(game_module, "sample", lambda players, count: players[1 : 1 + count])
    client = TestClient(main.app)
    created = client.post(
        "/games",
        json={
            "player_name": "Host",
            "category": "အစားအသောက်",
            "imposter_count": 1,
            "hint_input_mode": "TEXT_INPUT",
        },
    )
    assert created.status_code == 200
    game = created.json()
    assert game["player_token"]
    host_auth = {"Authorization": "Bearer " + game["player_token"]}
    players = [game]
    for name in ("Player 2", "Player 3"):
        joined = client.post(
            f"/games/{game['game_id']}/players", json={"player_name": name}
        )
        assert joined.status_code == 200
        players.append(joined.json())

    assert client.post(
        f"/games/{game['game_id']}/players", json={"player_name": " host "}
    ).status_code == 400
    assert client.post(
        f"/games/{game['game_id']}/start",
        json={"player_id": game["player_id"]},
        headers=host_auth,
    ).status_code == 200
    assert client.post(
        f"/games/{game['game_id']}/roles/start",
        json={"player_id": game["player_id"]},
        headers=host_auth,
    ).status_code == 200

    role = client.post(
        f"/games/{game['game_id']}/roles/{game['player_id']}/reveal",
        headers=host_auth,
    )
    assert role.status_code == 200
    assert "word" in role.json()
    state = client.get(
        f"/games/{game['game_id']}/state",
        params={"player_id": game["player_id"]},
        headers=host_auth,
    ).json()
    assert "role" not in state and "secret_word" not in state
    other_role = client.post(
        f"/games/{game['game_id']}/roles/{players[1]['player_id']}/reveal",
        headers=host_auth,
    )
    assert other_role.status_code == 403
    assert client.post(
        f"/games/{game['game_id']}/roles/{game['player_id']}/hint",
        headers=host_auth,
    ).status_code == 403
    assert client.post(
        f"/games/{game['game_id']}/roles/{game['player_id']}/next",
        headers=host_auth,
    ).status_code == 200
    for player in players[1:]:
        auth = {"Authorization": "Bearer " + player["player_token"]}
        role = client.post(
            f"/games/{game['game_id']}/roles/{player['player_id']}/reveal",
            headers=auth,
        )
        assert role.status_code == 200
        if role.json()["role"] == "imposter":
            hint = client.post(
                f"/games/{game['game_id']}/roles/{player['player_id']}/hint",
                headers=auth,
            )
            assert hint.status_code == 200
            assert hint.json()["hint"] != main.game_service.games[game["game_id"]].secret_word
            assert "not the secret word" in hint.json()["note"]
            assert client.post(
                f"/games/{game['game_id']}/roles/{player['player_id']}/hint",
                headers=auth,
            ).status_code == 400
            break
        assert client.post(
            f"/games/{game['game_id']}/roles/{player['player_id']}/next",
            headers=auth,
        ).status_code == 200
    assert client.get(
        f"/games/{game['game_id']}/state",
        params={"player_id": game["player_id"]},
    ).status_code == 401


def test_rest_invalid_transitions_and_unknown_game(monkeypatch) -> None:
    monkeypatch.setattr(main, "game_service", GameService())
    client = TestClient(main.app)
    assert client.get(
        "/games/unknown/state",
        params={"player_id": "nobody"},
        headers={"Authorization": "Bearer invalid"},
    ).status_code == 404
    created = client.post("/games", json={"player_name": "Host"}).json()
    start = client.post(
        f"/games/{created['game_id']}/start",
        json={"player_id": created["player_id"]},
        headers={"Authorization": "Bearer " + created["player_token"]},
    )
    assert start.status_code == 400
    assert main.game_service.games[created["game_id"]].imposter_count == 1


def test_round_count_settings_are_validated_and_host_only(monkeypatch) -> None:
    monkeypatch.setattr(main, "game_service", GameService())
    client = TestClient(main.app)
    assert client.post(
        "/games", json={"player_name": "Invalid", "total_rounds": 21}
    ).status_code == 422
    for clue_rounds in (0, 11):
        assert client.post(
            "/games", json={"player_name": "Invalid", "clue_rounds": clue_rounds}
        ).status_code == 422

    created = client.post(
        "/games",
        json={"player_name": "Host", "total_rounds": 1, "clue_rounds": 5},
    ).json()
    guest = client.post(
        f"/games/{created['game_id']}/players", json={"player_name": "Guest"}
    ).json()
    auth = {"Authorization": "Bearer " + created["player_token"]}
    update = client.post(
        f"/games/{created['game_id']}/settings/rounds",
        json={"player_id": created["player_id"], "total_rounds": 10},
        headers=auth,
    )
    assert update.status_code == 200
    state = client.get(
        f"/games/{created['game_id']}/state",
        params={"player_id": created["player_id"]},
        headers=auth,
    )
    assert state.json()["total_rounds"] == 10
    assert state.json()["clue_rounds"] == 5
    assert state.json()["current_clue_round"] == 0
    categories = client.get("/categories").json()["categories"]
    new_category = next(
        category
        for category in categories
        if category != state.json()["category"]
    )
    category_update = client.post(
        f"/games/{created['game_id']}/settings/category",
        json={"player_id": created["player_id"], "category": new_category},
        headers=auth,
    )
    assert category_update.status_code == 200
    state = client.get(
        f"/games/{created['game_id']}/state",
        params={"player_id": created["player_id"]},
        headers=auth,
    )
    assert state.json()["category"] == new_category
    clue_update = client.post(
        f"/games/{created['game_id']}/settings/clue-rounds",
        json={"player_id": created["player_id"], "clue_rounds": 8},
        headers=auth,
    )
    assert clue_update.status_code == 200
    state = client.get(
        f"/games/{created['game_id']}/state",
        params={"player_id": created["player_id"]},
        headers=auth,
    )
    assert state.json()["clue_rounds"] == 8
    assert client.post(
        f"/games/{created['game_id']}/settings/rounds",
        json={"player_id": guest["player_id"], "total_rounds": 2},
        headers=auth,
    ).status_code == 403
    assert client.post(
        f"/games/{created['game_id']}/settings/clue-rounds",
        json={"player_id": guest["player_id"], "clue_rounds": 2},
        headers=auth,
    ).status_code == 403
    assert client.post(
        f"/games/{created['game_id']}/settings/category",
        json={"player_id": guest["player_id"], "category": categories[0]},
        headers=auth,
    ).status_code == 403
    assert client.post(
        f"/games/{created['game_id']}/settings/category",
        json={"player_id": created["player_id"], "category": "Unknown category"},
        headers=auth,
    ).status_code == 400
    for clue_rounds in (0, 11):
        assert client.post(
            f"/games/{created['game_id']}/settings/clue-rounds",
            json={"player_id": created["player_id"], "clue_rounds": clue_rounds},
            headers=auth,
        ).status_code == 422


def test_hint_mode_selection_and_table_talk_turns(monkeypatch) -> None:
    monkeypatch.setattr(main, "game_service", GameService())
    monkeypatch.setattr(game_module, "sample", lambda players, count: players[:count])
    client = TestClient(main.app)
    created = client.post(
        "/games",
        json={
            "player_name": "Host",
            "clue_rounds": 2,
            "hint_input_mode": "TABLE_TALK",
        },
    ).json()
    players = [created]
    for name in ("Guest 1", "Guest 2"):
        players.append(
            client.post(
                f"/games/{created['game_id']}/players", json={"player_name": name}
            ).json()
        )
    auth = {"Authorization": "Bearer " + created["player_token"]}
    state_url = f"/games/{created['game_id']}/state"

    assert client.get(
        state_url,
        params={"player_id": created["player_id"]},
        headers=auth,
    ).json()["hint_input_mode"] == "TABLE_TALK"
    assert client.post(
        f"/games/{created['game_id']}/start",
        json={"player_id": created["player_id"]},
        headers=auth,
    ).status_code == 200
    assert client.post(
        f"/games/{created['game_id']}/settings/hint-mode",
        json={
            "player_id": created["player_id"],
            "hint_input_mode": "TEXT_INPUT",
        },
        headers=auth,
    ).status_code == 400

    client.post(
        f"/games/{created['game_id']}/roles/start",
        json={"player_id": created["player_id"]},
        headers=auth,
    )
    for player in players:
        player_auth = {"Authorization": "Bearer " + player["player_token"]}
        client.post(
            f"/games/{created['game_id']}/roles/{player['player_id']}/reveal",
            headers=player_auth,
        )
        client.post(
            f"/games/{created['game_id']}/roles/{player['player_id']}/next",
            headers=player_auth,
        )

    for clue_round in range(2):
        for player in players:
            response = client.post(
                f"/games/{created['game_id']}/hints/given",
                json={"player_id": player["player_id"]},
                headers={"Authorization": "Bearer " + player["player_token"]},
            )
            assert response.status_code == 200
        state = client.get(
            state_url,
            params={"player_id": created["player_id"]},
            headers=auth,
        ).json()
        assert state["phase"] == ("CLUE_ROUND" if clue_round == 0 else "VOTING")
        assert state["clues"] == []

    assert state["current_clue_round"] == 2
    assert state["completed_turns"] == 3
    assert state["hint_input_mode"] == "TABLE_TALK"
    assert "secret_word" not in state


def test_hint_mode_requires_valid_selection_before_start(monkeypatch) -> None:
    monkeypatch.setattr(main, "game_service", GameService())
    client = TestClient(main.app)
    assert client.post(
        "/games",
        json={"player_name": "Invalid", "hint_input_mode": "VOICE_CHAT"},
    ).status_code == 422
    created = client.post(
        "/games",
        json={"player_name": "Host", "desired_player_count": 3},
    ).json()
    for index in range(1, 3):
        client.post(
            f"/games/{created['game_id']}/players", json={"player_name": f"Guest {index}"}
        )
    response = client.post(
        f"/games/{created['game_id']}/start",
        json={"player_id": created["player_id"]},
        headers={"Authorization": "Bearer " + created["player_token"]},
    )
    assert response.status_code == 400
    assert "hint input mode" in response.json()["detail"]


def test_host_can_add_edit_and_remove_players_by_id(monkeypatch) -> None:
    monkeypatch.setattr(main, "game_service", GameService())
    client = TestClient(main.app)
    created = client.post(
        "/games", json={"player_name": "Host", "imposter_count": 1}
    ).json()
    auth = {"Authorization": "Bearer " + created["player_token"]}
    guest = client.post(
        f"/games/{created['game_id']}/players", json={"player_name": "Guest"}
    ).json()

    added_response = client.post(
        f"/games/{created['game_id']}/players/add",
        json={"player_id": created["player_id"], "player_name": "Added"},
        headers=auth,
    )
    assert added_response.status_code == 200
    added = added_response.json()
    assert added["player_token"]

    updated = client.put(
        f"/games/{created['game_id']}/players/{guest['player_id']}",
        json={"player_id": created["player_id"], "player_name": "Renamed"},
        headers=auth,
    )
    assert updated.status_code == 200
    assert updated.json()["player_id"] == guest["player_id"]
    duplicate = client.put(
        f"/games/{created['game_id']}/players/{guest['player_id']}",
        json={"player_id": created["player_id"], "player_name": " added "},
        headers=auth,
    )
    assert duplicate.status_code == 400

    removed = client.request(
        "DELETE",
        f"/games/{created['game_id']}/players/{added['player_id']}",
        json={"player_id": created["player_id"]},
        headers=auth,
    )
    assert removed.status_code == 200
    state = client.get(
        f"/games/{created['game_id']}/state",
        params={"player_id": created["player_id"]},
        headers=auth,
    ).json()
    assert [player["player_id"] for player in state["players"]] == [
        created["player_id"],
        guest["player_id"],
    ]
    assert state["players"][1]["name"] == "Renamed"


def test_guest_can_leave_waiting_room(monkeypatch) -> None:
    service = GameService()
    monkeypatch.setattr(main, "game_service", service)
    client = TestClient(main.app)
    host = client.post("/games", json={"player_name": "Host"}).json()
    guest = client.post(
        f"/games/{host['game_id']}/players", json={"player_name": "Guest"}
    ).json()

    response = client.post(
        f"/games/{host['game_id']}/leave",
        json={"player_id": guest["player_id"]},
        headers={"Authorization": f"Bearer {guest['player_token']}"},
    )

    assert response.status_code == 200
    assert response.json() == {"status": "left"}
    state = client.get(
        f"/games/{host['game_id']}/state",
        params={"player_id": host["player_id"]},
        headers={"Authorization": f"Bearer {host['player_token']}"},
    ).json()
    assert [player["player_id"] for player in state["players"]] == [host["player_id"]]


def test_host_exit_notifies_connected_players_and_closes_room(monkeypatch) -> None:
    service = GameService()
    monkeypatch.setattr(main, "game_service", service)
    main.connections.clear()
    client = TestClient(main.app)
    host = client.post("/games", json={"player_name": "Host"}).json()
    guest = client.post(
        f"/games/{host['game_id']}/players", json={"player_name": "Guest"}
    ).json()

    with client.websocket_connect(
        f"/ws/{host['game_id']}/{guest['player_id']}?token={guest['player_token']}"
    ) as guest_socket:
        guest_socket.receive_json()
        response = client.post(
            f"/games/{host['game_id']}/leave",
            json={"player_id": host["player_id"]},
            headers={"Authorization": f"Bearer {host['player_token']}"},
        )

        assert response.status_code == 200
        assert response.json() == {"status": "closed"}
        assert guest_socket.receive_json() == {"type": "room_closed"}
    assert host["game_id"] not in service.games


def test_selected_player_count_is_host_controlled_and_enforced(monkeypatch) -> None:
    monkeypatch.setattr(main, "game_service", GameService())
    client = TestClient(main.app)
    created = client.post(
        "/games",
        json={"player_name": "Host", "desired_player_count": 3},
    ).json()
    auth = {"Authorization": "Bearer " + created["player_token"]}
    guest = client.post(
        f"/games/{created['game_id']}/players", json={"player_name": "Guest"}
    ).json()

    update = client.post(
        f"/games/{created['game_id']}/settings/players",
        json={"player_id": created["player_id"], "desired_player_count": 4},
        headers=auth,
    )
    assert update.status_code == 200
    too_many = client.post(
        f"/games/{created['game_id']}/settings/players",
        json={"player_id": guest["player_id"], "desired_player_count": 4},
        headers={"Authorization": "Bearer " + guest["player_token"]},
    )
    assert too_many.status_code == 403
    client.post(
        f"/games/{created['game_id']}/players", json={"player_name": "Third"}
    )
    fourth = client.post(
        f"/games/{created['game_id']}/players", json={"player_name": "Fourth"}
    )
    assert fourth.status_code == 200
    fifth = client.post(
        f"/games/{created['game_id']}/players", json={"player_name": "Fifth"}
    )
    assert fifth.status_code == 400
    state = client.get(
        f"/games/{created['game_id']}/state",
        params={"player_id": created["player_id"]},
        headers=auth,
    ).json()
    assert state["desired_player_count"] == 4
    assert state["player_count"] == 4
