import os

from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.game_service import GameService
from app.models import (
    ClueRequest,
    CreateGameRequest,
    GameSettingsRequest,
    HintModeSettingsRequest,
    ImposterHintResponse,
    ImposterGuessDecisionRequest,
    ImposterGuessRequest,
    JoinGameRequest,
    PlayerActionRequest,
    PlayerCountSettingsRequest,
    PlayerNameRequest,
    RoundSettingsRequest,
    VoteRequest,
)
from app.word_list import WORDS_BY_CATEGORY

app = FastAPI(title="Imposter Game API")
cors_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
game_service = GameService()
connections: dict[str, dict[WebSocket, str]] = {}


def raise_game_error(error: Exception) -> None:
    if isinstance(error, PermissionError):
        raise HTTPException(status_code=403, detail=str(error)) from error
    status_code = 404 if str(error) == "Game not found" else 400
    raise HTTPException(status_code=status_code, detail=str(error)) from error


def authorize_player(game_id: str, player_id: str, authorization: str | None) -> None:
    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Player authentication is required")
    try:
        game_service.authenticate_player(
            game_id, player_id, authorization.removeprefix("Bearer ").strip()
        )
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except ValueError as error:
        raise_game_error(error)


async def broadcast(game_id: str) -> None:
    for websocket, player_id in connections.get(game_id, {}).copy().items():
        try:
            await websocket.send_json(
                game_service.get_game_state(game_id, player_id).model_dump(mode="json")
            )
        except WebSocketDisconnect:
            connections.get(game_id, {}).pop(websocket, None)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/categories")
async def list_categories() -> dict[str, list[str]]:
    return {"categories": list(WORDS_BY_CATEGORY)}


@app.post("/games")
@app.post("/rooms", include_in_schema=False)
async def create_game(request: CreateGameRequest) -> dict[str, str]:
    try:
        game, player = game_service.create_game(
            request.player_name,
            request.category,
            request.imposter_count,
            request.total_rounds,
            request.desired_player_count,
            request.clue_rounds,
            request.hint_input_mode,
        )
    except ValueError as error:
        raise_game_error(error)
    return {
        "game_id": game.game_id,
        "room_id": game.game_id,
        "room_code": game.room_code,
        "player_id": player.player_id,
        "player_token": player.player_token,
    }


@app.post("/games/{game_id}/players")
@app.post("/rooms/{game_id}/join", include_in_schema=False)
async def add_player(game_id: str, request: JoinGameRequest) -> dict[str, str]:
    try:
        resolved_game_id = game_service.resolve_room_code(game_id)
        player = game_service.add_player(resolved_game_id, request.player_name)
    except (ValueError, PermissionError) as error:
        raise_game_error(error)
    await broadcast(resolved_game_id)
    return {
        "game_id": resolved_game_id,
        "room_id": resolved_game_id,
        "player_id": player.player_id,
        "player_token": player.player_token,
    }


@app.post("/games/{game_id}/players/add")
async def add_player_as_host(
    game_id: str,
    request: PlayerNameRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    authorize_player(game_id, request.player_id, authorization)
    try:
        player = game_service.add_player_as_host(
            game_id, request.player_id, request.player_name
        )
    except (ValueError, PermissionError) as error:
        raise_game_error(error)
    await broadcast(game_id)
    return {
        "player_id": player.player_id,
        "player_name": player.name,
        "player_token": player.player_token,
    }


@app.put("/games/{game_id}/players/{target_id}")
async def update_player_name(
    game_id: str,
    target_id: str,
    request: PlayerNameRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    authorize_player(game_id, request.player_id, authorization)
    try:
        player = game_service.update_player_name(
            game_id, request.player_id, target_id, request.player_name
        )
    except (ValueError, PermissionError) as error:
        raise_game_error(error)
    await broadcast(game_id)
    return {"player_id": player.player_id, "player_name": player.name}


@app.delete("/games/{game_id}/players/{target_id}")
async def remove_player(
    game_id: str,
    target_id: str,
    request: PlayerActionRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    authorize_player(game_id, request.player_id, authorization)
    try:
        game_service.remove_player(game_id, request.player_id, target_id)
    except (ValueError, PermissionError) as error:
        raise_game_error(error)
    await broadcast(game_id)
    return {"status": "removed"}


@app.get("/games/{game_id}/state")
@app.get("/rooms/{game_id}/state", include_in_schema=False)
async def get_game_state(
    game_id: str,
    player_id: str,
    authorization: str | None = Header(default=None),
):
    authorize_player(game_id, player_id, authorization)
    try:
        return game_service.get_game_state(game_id, player_id)
    except (ValueError, PermissionError) as error:
        raise_game_error(error)


@app.post("/games/{game_id}/settings")
async def set_game_settings(
    game_id: str,
    request: GameSettingsRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    authorize_player(game_id, request.player_id, authorization)
    try:
        game_service.set_imposter_count(game_id, request.player_id, request.imposter_count)
    except (ValueError, PermissionError) as error:
        raise_game_error(error)
    await broadcast(game_id)
    return {"status": "updated"}


@app.post("/games/{game_id}/settings/rounds")
async def set_round_settings(
    game_id: str,
    request: RoundSettingsRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    authorize_player(game_id, request.player_id, authorization)
    try:
        game_service.configure_total_rounds(
            game_id, request.player_id, request.total_rounds
        )
    except (ValueError, PermissionError) as error:
        raise_game_error(error)
    await broadcast(game_id)
    return {"status": "updated"}


@app.post("/games/{game_id}/settings/players")
async def set_player_count(
    game_id: str,
    request: PlayerCountSettingsRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    authorize_player(game_id, request.player_id, authorization)
    try:
        game_service.configure_player_count(
            game_id, request.player_id, request.desired_player_count
        )
    except (ValueError, PermissionError) as error:
        raise_game_error(error)
    await broadcast(game_id)
    return {"status": "updated"}


@app.post("/games/{game_id}/settings/hint-mode")
async def set_hint_input_mode(
    game_id: str,
    request: HintModeSettingsRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    authorize_player(game_id, request.player_id, authorization)
    try:
        game_service.configure_hint_input_mode(
            game_id, request.player_id, request.hint_input_mode
        )
    except (ValueError, PermissionError) as error:
        raise_game_error(error)
    await broadcast(game_id)
    return {"status": "updated"}


@app.post("/games/{game_id}/start")
@app.post("/rooms/{game_id}/start", include_in_schema=False)
async def assign_roles(
    game_id: str,
    request: PlayerActionRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    authorize_player(game_id, request.player_id, authorization)
    try:
        game_service.assign_roles(game_id, request.player_id)
    except (ValueError, PermissionError) as error:
        raise_game_error(error)
    await broadcast(game_id)
    return {"status": "role_assignment"}


@app.post("/games/{game_id}/roles/start")
async def start_role_reveal(
    game_id: str,
    request: PlayerActionRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    authorize_player(game_id, request.player_id, authorization)
    try:
        game_service.start_role_reveal(game_id, request.player_id)
    except (ValueError, PermissionError) as error:
        raise_game_error(error)
    await broadcast(game_id)
    return {"status": "role_reveal"}


@app.post("/games/{game_id}/roles/{player_id}/reveal")
async def reveal_role(
    game_id: str,
    player_id: str,
    authorization: str | None = Header(default=None),
):
    authorize_player(game_id, player_id, authorization)
    try:
        role = game_service.get_player_role(game_id, player_id)
    except (ValueError, PermissionError) as error:
        raise_game_error(error)
    await broadcast(game_id)
    return role


@app.post("/games/{game_id}/roles/{player_id}/hint", response_model=ImposterHintResponse)
async def reveal_imposter_hint(
    game_id: str,
    player_id: str,
    authorization: str | None = Header(default=None),
) -> ImposterHintResponse:
    authorize_player(game_id, player_id, authorization)
    try:
        hint = game_service.get_imposter_hint(game_id, player_id)
    except (ValueError, PermissionError) as error:
        raise_game_error(error)
    return ImposterHintResponse(
        hint=hint,
        note="A different example from the category, not the secret word.",
    )


@app.post("/games/{game_id}/roles/{player_id}/next")
async def advance_role_reveal(
    game_id: str,
    player_id: str,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    authorize_player(game_id, player_id, authorization)
    try:
        game_service.advance_role_reveal(game_id, player_id)
    except (ValueError, PermissionError) as error:
        raise_game_error(error)
    await broadcast(game_id)
    return {"status": "advanced"}


@app.post("/games/{game_id}/clue-rounds/start")
async def start_clue_round(
    game_id: str,
    request: PlayerActionRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    authorize_player(game_id, request.player_id, authorization)
    try:
        game_service.start_clue_round(game_id, request.player_id)
    except (ValueError, PermissionError) as error:
        raise_game_error(error)
    await broadcast(game_id)
    return {"status": "clue_round_started"}


@app.post("/games/{game_id}/clues")
async def submit_clue(
    game_id: str,
    request: ClueRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    authorize_player(game_id, request.player_id, authorization)
    try:
        game_service.submit_clue(game_id, request.player_id, request.clue)
    except (ValueError, PermissionError) as error:
        raise_game_error(error)
    await broadcast(game_id)
    return {"status": "clue_submitted"}


@app.post("/games/{game_id}/hints/given")
async def mark_hint_given(
    game_id: str,
    request: PlayerActionRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    authorize_player(game_id, request.player_id, authorization)
    try:
        game_service.mark_hint_given(game_id, request.player_id)
    except (ValueError, PermissionError) as error:
        raise_game_error(error)
    await broadcast(game_id)
    return {"status": "hint_given"}


@app.post("/games/{game_id}/voting/start")
@app.post("/rooms/{game_id}/start-voting", include_in_schema=False)
async def start_voting(
    game_id: str,
    request: PlayerActionRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    authorize_player(game_id, request.player_id, authorization)
    try:
        game_service.start_voting(game_id, request.player_id)
    except (ValueError, PermissionError) as error:
        raise_game_error(error)
    await broadcast(game_id)
    return {"status": "voting"}


@app.post("/games/{game_id}/votes")
@app.post("/rooms/{game_id}/vote", include_in_schema=False)
async def submit_vote(
    game_id: str,
    request: VoteRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    authorize_player(game_id, request.player_id, authorization)
    try:
        game_service.submit_vote(game_id, request.player_id, request.target_id)
    except (ValueError, PermissionError) as error:
        raise_game_error(error)
    await broadcast(game_id)
    return {"status": "vote_submitted"}


@app.post("/games/{game_id}/votes/resolve")
async def resolve_votes(
    game_id: str,
    request: PlayerActionRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    authorize_player(game_id, request.player_id, authorization)
    try:
        result = game_service.handle_tie(game_id, request.player_id)
    except (ValueError, PermissionError) as error:
        raise_game_error(error)
    await broadcast(game_id)
    return {"status": result}


@app.post("/games/{game_id}/rounds/next")
async def advance_to_next_round(
    game_id: str,
    request: PlayerActionRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    authorize_player(game_id, request.player_id, authorization)
    try:
        game_service.advance_to_next_round(game_id, request.player_id)
    except (ValueError, PermissionError) as error:
        raise_game_error(error)
    await broadcast(game_id)
    return {"status": "round_started"}


@app.post("/games/{game_id}/finish")
async def finish_game(
    game_id: str,
    request: PlayerActionRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    authorize_player(game_id, request.player_id, authorization)
    try:
        game_service.finish_game(game_id, request.player_id)
    except (ValueError, PermissionError) as error:
        raise_game_error(error)
    await broadcast(game_id)
    return {"status": "game_over"}


@app.post("/games/{game_id}/replay")
async def restart_game(
    game_id: str,
    request: PlayerActionRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    authorize_player(game_id, request.player_id, authorization)
    try:
        game = game_service.restart_game(game_id, request.player_id)
    except (ValueError, PermissionError) as error:
        raise_game_error(error)
    await broadcast(game_id)
    return {
        "game_id": game.game_id,
        "room_code": game.room_code,
        "status": "restarted",
    }


@app.post("/games/{game_id}/imposter-guess")
async def submit_imposter_guess(
    game_id: str,
    request: ImposterGuessRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, bool]:
    authorize_player(game_id, request.player_id, authorization)
    try:
        correct = game_service.submit_imposter_guess(
            game_id, request.player_id, request.guess
        )
    except (ValueError, PermissionError) as error:
        raise_game_error(error)
    await broadcast(game_id)
    return {"correct": correct}


@app.post("/games/{game_id}/imposter-guess/spoken")
async def mark_spoken_imposter_guess(
    game_id: str,
    request: PlayerActionRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    authorize_player(game_id, request.player_id, authorization)
    try:
        game_service.mark_imposter_guess_spoken(game_id, request.player_id)
    except (ValueError, PermissionError) as error:
        raise_game_error(error)
    await broadcast(game_id)
    return {"status": "submitted"}


@app.post("/games/{game_id}/imposter-guess/resolve")
async def resolve_spoken_imposter_guess(
    game_id: str,
    request: ImposterGuessDecisionRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, bool]:
    authorize_player(game_id, request.player_id, authorization)
    try:
        correct = game_service.resolve_spoken_imposter_guess(
            game_id, request.player_id, request.correct
        )
    except (ValueError, PermissionError) as error:
        raise_game_error(error)
    await broadcast(game_id)
    return {"correct": correct}


@app.post("/games/{game_id}/reset")
async def reset_round(
    game_id: str,
    request: PlayerActionRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    authorize_player(game_id, request.player_id, authorization)
    try:
        game_service.reset_round(game_id, request.player_id)
    except (ValueError, PermissionError) as error:
        raise_game_error(error)
    await broadcast(game_id)
    return {"status": "reset"}


@app.websocket("/ws/{game_id}/{player_id}")
async def game_websocket(
    websocket: WebSocket, game_id: str, player_id: str, token: str
) -> None:
    try:
        game_service.authenticate_player(game_id, player_id, token)
        state = game_service.get_game_state(game_id, player_id)
    except (ValueError, PermissionError):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    connections.setdefault(game_id, {})[websocket] = player_id
    await websocket.send_json(state.model_dump(mode="json"))
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        room_connections = connections.get(game_id)
        if room_connections is not None:
            room_connections.pop(websocket, None)
            if not room_connections:
                connections.pop(game_id, None)
