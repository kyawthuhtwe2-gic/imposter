from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator


class GamePhase(str, Enum):
    WAITING_FOR_PLAYERS = "WAITING_FOR_PLAYERS"
    ROLE_ASSIGNMENT = "ROLE_ASSIGNMENT"
    ROLE_REVEAL = "ROLE_REVEAL"
    CLUE_ROUND = "CLUE_ROUND"
    VOTING = "VOTING"
    VOTE_RESULTS = "VOTE_RESULTS"
    IMPOSTER_GUESS = "IMPOSTER_GUESS"
    ROUND_RESULTS = "ROUND_RESULTS"
    GAME_OVER = "GAME_OVER"


class HintInputMode(str, Enum):
    TABLE_TALK = "TABLE_TALK"
    TEXT_INPUT = "TEXT_INPUT"


class CreateGameRequest(BaseModel):
    player_name: str = Field(min_length=1, max_length=30)
    category: str | None = None
    imposter_count: int | None = Field(default=1, ge=1, le=3, strict=True)
    total_rounds: int = Field(default=1, ge=1, le=20, strict=True)
    desired_player_count: int | None = Field(default=None, ge=3, le=10, strict=True)
    clue_rounds: int = Field(default=1, ge=1, le=10, strict=True)
    hint_input_mode: HintInputMode | None = None

    @field_validator("player_name")
    @classmethod
    def normalize_player_name(cls, value: str) -> str:
        return value.strip()


class JoinGameRequest(BaseModel):
    player_name: str = Field(min_length=1, max_length=30)

    @field_validator("player_name")
    @classmethod
    def normalize_player_name(cls, value: str) -> str:
        return value.strip()


class PlayerActionRequest(BaseModel):
    player_id: str = Field(min_length=1)


class PlayerNameRequest(PlayerActionRequest):
    player_name: str = Field(min_length=1, max_length=30)

    @field_validator("player_name")
    @classmethod
    def normalize_player_name(cls, value: str) -> str:
        return value.strip()


class GameSettingsRequest(PlayerActionRequest):
    imposter_count: int = Field(ge=1, le=3, strict=True)


class RoundSettingsRequest(PlayerActionRequest):
    total_rounds: int = Field(ge=1, le=20, strict=True)


class ClueRoundSettingsRequest(PlayerActionRequest):
    clue_rounds: int = Field(ge=1, le=10, strict=True)


class CategorySettingsRequest(PlayerActionRequest):
    category: str = Field(min_length=1)


class PlayerCountSettingsRequest(PlayerActionRequest):
    desired_player_count: int = Field(ge=3, le=10, strict=True)


class HintModeSettingsRequest(PlayerActionRequest):
    hint_input_mode: HintInputMode


class ClueRequest(PlayerActionRequest):
    clue: str = Field(min_length=1, max_length=200)

    @field_validator("clue")
    @classmethod
    def normalize_clue(cls, value: str) -> str:
        return value.strip()


class VoteRequest(PlayerActionRequest):
    target_id: str = Field(min_length=1)


class ImposterGuessRequest(PlayerActionRequest):
    guess: str = Field(min_length=1, max_length=200)

    @field_validator("guess")
    @classmethod
    def normalize_guess(cls, value: str) -> str:
        return value.strip()


class ImposterGuessDecisionRequest(PlayerActionRequest):
    correct: bool


class PublicPlayer(BaseModel):
    player_id: str
    name: str
    score: int
    wins: int
    losses: int
    eliminated: bool
    has_voted: bool
    role_viewed: bool


class ClueRecord(BaseModel):
    player_id: str
    player_name: str
    clue: str
    round_number: int
    clue_round_number: int


class VoteCount(BaseModel):
    player_id: str
    player_name: str
    count: int


class RoundPlayerStats(BaseModel):
    player_id: str
    player_name: str
    role: str
    wins: int
    losses: int


class RoundResult(BaseModel):
    round_number: int
    secret_word: str
    imposter_names: list[str]
    winner: str
    vote_counts: list[VoteCount]
    player_stats: list[RoundPlayerStats]


class FinalResults(BaseModel):
    total_rounds: int
    rounds_played: int
    normal_player_wins: int
    imposter_wins: int
    winner: str
    player_stats: list[PublicPlayer]


class GameStateResponse(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    game_id: str
    room_code: str
    phase: GamePhase
    host_id: str
    category: str
    player_count: int
    imposter_count: int | None
    round_number: int
    total_rounds: int
    desired_player_count: int | None
    clue_rounds: int
    hint_input_mode: HintInputMode | None
    current_clue_round: int
    submitted_clue_player_ids: list[str]
    completed_turns: int
    completed_rounds: int
    normal_player_wins: int
    imposter_wins: int
    round_results: list[RoundResult]
    final_results: FinalResults | None
    players: list[PublicPlayer]
    current_reveal_player_id: str | None
    current_turn_player_id: str | None
    clues: list[ClueRecord]
    eligible_vote_ids: list[str]
    vote_counts: list[VoteCount] | None
    tied_player_ids: list[str]
    eliminated_player_id: str | None
    guess_submitted: bool
    winner: str | None
    result_message: str | None


class PlayerRoleResponse(BaseModel):
    player_id: str
    role: str
    word: str | None


class ImposterHintResponse(BaseModel):
    hint: str
    note: str
