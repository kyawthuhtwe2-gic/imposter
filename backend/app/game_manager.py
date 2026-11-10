from dataclasses import dataclass, field
from secrets import choice
from uuid import uuid4

from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect

from app.word_list import WORDS_BY_CATEGORY

MIN_PLAYERS = 3


@dataclass
class Player:
    player_id: str
    name: str
    role: str | None = None
    word: str | None = None
    vote: str | None = None


@dataclass
class Room:
    room_id: str
    players: list[Player] = field(default_factory=list)
    host_id: str = ""
    phase: str = "lobby"
    imposter_id: str | None = None
    secret_word: str | None = None


class GameManager:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}
        self.connections: dict[str, dict[WebSocket, str]] = {}

    def create_room(self, player_name: str) -> Room:
        player = self._new_player(player_name)
        room = Room(room_id=uuid4().hex[:6].upper(), host_id=player.player_id)
        room.players.append(player)
        self.rooms[room.room_id] = room
        return room

    def join_room(self, room_id: str, player_name: str) -> Player:
        room = self._get_room(room_id)
        if room.phase != "lobby":
            raise ValueError("This game has already started")
        player = self._new_player(player_name)
        room.players.append(player)
        return player

    def start_game(self, room_id: str, player_id: str) -> Room:
        room = self._get_room(room_id)
        self._require_host(room, player_id)
        if room.phase not in ("lobby", "results"):
            raise ValueError("The game is already in progress")
        if len(room.players) < MIN_PLAYERS:
            raise ValueError(f"At least {MIN_PLAYERS} players are required to start")

        imposter = choice(room.players)
        word = choice(choice(list(WORDS_BY_CATEGORY.values())))
        room.imposter_id = imposter.player_id
        room.secret_word = word
        room.phase = "playing"
        for player in room.players:
            player.role = "imposter" if player is imposter else "player"
            player.word = None if player is imposter else word
            player.vote = None
        return room

    def start_voting(self, room_id: str, player_id: str) -> Room:
        room = self._get_room(room_id)
        self._require_host(room, player_id)
        if room.phase != "playing":
            raise ValueError("The game is not ready for voting")
        room.phase = "voting"
        return room

    def cast_vote(self, room_id: str, player_id: str, target_id: str) -> Room:
        room = self._get_room(room_id)
        if room.phase != "voting":
            raise ValueError("Voting is not open")
        voter = self._get_player(room, player_id)
        if voter.vote is not None:
            raise ValueError("You have already voted")
        if target_id == player_id:
            raise ValueError("You cannot vote for yourself")
        self._get_player(room, target_id)
        voter.vote = target_id
        if all(player.vote is not None for player in room.players):
            room.phase = "results"
        return room

    def player_state(self, room_id: str, player_id: str) -> dict:
        room = self._get_room(room_id)
        player = self._get_player(room, player_id)
        all_voted = all(candidate.vote is not None for candidate in room.players)
        return {
            "room_id": room.room_id,
            "phase": room.phase,
            "host_id": room.host_id,
            "players": [
                {
                    "player_id": candidate.player_id,
                    "name": candidate.name,
                    "has_voted": candidate.vote is not None,
                }
                for candidate in room.players
            ],
            "role": player.role if room.phase != "lobby" else None,
            "word": (
                player.word
                if room.phase in ("playing", "voting")
                else room.secret_word if room.phase == "results" else None
            ),
            "imposter_id": room.imposter_id if room.phase == "results" else None,
            "votes": (
                {candidate.player_id: candidate.vote for candidate in room.players}
                if room.phase == "results"
                else None
            ),
            "all_voted": all_voted,
        }

    async def connect(self, room_id: str, player_id: str, websocket: WebSocket) -> None:
        room = self._get_room(room_id)
        self._get_player(room, player_id)
        self.connections.setdefault(room_id, {})[websocket] = player_id
        await websocket.send_json(self.player_state(room_id, player_id))

    def disconnect(self, room_id: str, websocket: WebSocket) -> None:
        room_connections = self.connections.get(room_id)
        if room_connections is not None:
            room_connections.pop(websocket, None)
            if not room_connections:
                self.connections.pop(room_id, None)

    async def broadcast(self, room_id: str) -> None:
        room_connections = self.connections.get(room_id, {}).copy()
        for websocket, player_id in room_connections.items():
            try:
                await websocket.send_json(self.player_state(room_id, player_id))
            except WebSocketDisconnect:
                self.disconnect(room_id, websocket)

    def _get_room(self, room_id: str) -> Room:
        room = self.rooms.get(room_id)
        if room is None:
            raise ValueError(f"Room {room_id} does not exist")
        return room

    @staticmethod
    def _get_player(room: Room, player_id: str) -> Player:
        for player in room.players:
            if player.player_id == player_id:
                return player
        raise ValueError("Player is not in this room")

    @staticmethod
    def _require_host(room: Room, player_id: str) -> None:
        if player_id != room.host_id:
            raise PermissionError("Only the room host can do this")

    @staticmethod
    def _new_player(player_name: str) -> Player:
        return Player(player_id=uuid4().hex, name=player_name.strip())
