from collections import Counter
from dataclasses import dataclass, field
from hmac import compare_digest
from random import SystemRandom
from secrets import choice, randbelow, token_urlsafe
from uuid import uuid4

from app.models import (
    ClueRecord,
    FinalResults,
    GamePhase,
    GameStateResponse,
    HintInputMode,
    PlayerRoleResponse,
    PublicPlayer,
    RoundPlayerStats,
    RoundResult,
    VoteCount,
)
from app.word_list import WORDS_BY_CATEGORY

MIN_PLAYERS = 3
MAX_PLAYERS = 10
sample = SystemRandom().sample
IMPOSTER_GUESS = "imposter"
NORMAL_ROLE = "player"
IMPOSTER_TEAM = "IMPOSTERS"
PLAYER_TEAM = "PLAYERS"


@dataclass
class Player:
    player_id: str
    name: str
    player_token: str = field(repr=False)
    score: int = 0
    wins: int = 0
    losses: int = 0
    role: str | None = None
    eliminated: bool = False
    role_viewed: bool = False
    hint_viewed: bool = False
    vote: str | None = None


@dataclass
class Clue:
    player_id: str
    clue: str
    round_number: int
    clue_round_number: int


@dataclass
class Game:
    game_id: str
    room_code: str
    host_id: str
    category: str
    imposter_count: int | None = None
    total_rounds: int = 1
    desired_player_count: int | None = None
    clue_rounds: int = 1
    hint_input_mode: HintInputMode | None = None
    current_clue_round: int = 0
    submitted_clue_player_ids: list[str] = field(default_factory=list)
    phase: GamePhase = GamePhase.WAITING_FOR_PLAYERS
    players: list[Player] = field(default_factory=list)
    secret_word: str | None = None
    imposter_hint: str | None = None
    round_number: int = 0
    reveal_index: int = 0
    turn_order: list[str] = field(default_factory=list)
    turn_index: int = 0
    clues: list[Clue] = field(default_factory=list)
    votes: dict[str, str] = field(default_factory=dict)
    eligible_vote_ids: list[str] = field(default_factory=list)
    tied_player_ids: list[str] = field(default_factory=list)
    eliminated_player_id: str | None = None
    winner: str | None = None
    result_message: str | None = None
    score_updated: bool = False
    guess_submitted: bool = False
    guess_correct: bool = False
    round_results: list[RoundResult] = field(default_factory=list)
    normal_player_wins: int = 0
    imposter_wins: int = 0
    replay_game_id: str | None = None
    replay_player_ids: dict[str, str] = field(default_factory=dict)


class GameService:
    """Authoritative in-memory game sessions and rules."""

    def __init__(self) -> None:
        self.games: dict[str, Game] = {}

    def create_game(
        self,
        player_name: str,
        category: str | None = None,
        imposter_count: int | None = 1,
        total_rounds: int = 1,
        desired_player_count: int | None = None,
        clue_rounds: int = 1,
        hint_input_mode: HintInputMode | None = None,
    ) -> tuple[Game, Player]:
        name = self._normalize_name(player_name)
        if category is None:
            category = choice(list(WORDS_BY_CATEGORY))
        if category not in WORDS_BY_CATEGORY:
            raise ValueError(f"Unknown category: {category}")
        if imposter_count is not None and (
            type(imposter_count) is not int or imposter_count not in (1, 2, 3)
        ):
            raise ValueError("The imposter count must be between 1 and 3")
        if type(total_rounds) is not int or not 1 <= total_rounds <= 20:
            raise ValueError("The total round count must be between 1 and 20")
        if desired_player_count is not None and (
            type(desired_player_count) is not int
            or not MIN_PLAYERS <= desired_player_count <= MAX_PLAYERS
        ):
            raise ValueError("The selected player count must be between 3 and 10")
        if (
            desired_player_count is not None
            and imposter_count is not None
            and imposter_count > self._maximum_imposters(desired_player_count)
        ):
            maximum = self._maximum_imposters(desired_player_count)
            raise ValueError(
                f"{desired_player_count} players support at most {maximum} imposter(s)"
            )
        if type(clue_rounds) is not int or not 1 <= clue_rounds <= 10:
            raise ValueError("The clue round count must be between 1 and 10")
        if hint_input_mode is not None and not isinstance(hint_input_mode, HintInputMode):
            try:
                hint_input_mode = HintInputMode(hint_input_mode)
            except ValueError as error:
                raise ValueError("Choose a valid hint input mode") from error
        player = self._new_player(name)
        game = Game(
            game_id=uuid4().hex,
            room_code=self._new_room_code(),
            host_id=player.player_id,
            category=category,
            imposter_count=imposter_count,
            total_rounds=total_rounds,
            desired_player_count=desired_player_count,
            clue_rounds=clue_rounds,
            hint_input_mode=hint_input_mode,
            players=[player],
        )
        self.games[game.game_id] = game
        return game, player

    def resolve_room_code(self, room_code: str) -> str:
        if room_code in self.games:
            return room_code
        for game in self.games.values():
            if game.room_code == room_code:
                return game.game_id
        raise ValueError("Game not found")

    def add_player(self, game_id: str, player_name: str) -> Player:
        game = self._get_game(game_id)
        if game.phase != GamePhase.WAITING_FOR_PLAYERS:
            raise ValueError("Players can only join while the game is waiting")
        if len(game.players) >= MAX_PLAYERS:
            raise ValueError(f"A game supports at most {MAX_PLAYERS} players")
        if (
            game.desired_player_count is not None
            and len(game.players) >= game.desired_player_count
        ):
            raise ValueError("The selected player count has already been reached")
        name = self._normalize_name(player_name)
        if any(player.name.casefold() == name.casefold() for player in game.players):
            raise ValueError("Player names must be unique within a game")
        player = self._new_player(name)
        game.players.append(player)
        return player

    def configure_player_count(
        self, game_id: str, player_id: str, desired_player_count: int
    ) -> None:
        game = self._get_game(game_id)
        self._require_host(game, player_id)
        if game.phase != GamePhase.WAITING_FOR_PLAYERS:
            raise ValueError("The selected player count can only be changed before the game starts")
        if type(desired_player_count) is not int or not MIN_PLAYERS <= desired_player_count <= MAX_PLAYERS:
            raise ValueError("The selected player count must be between 3 and 10")
        if desired_player_count < len(game.players):
            raise ValueError("Remove players before lowering the selected player count")
        if (
            game.imposter_count is not None
            and game.imposter_count > self._maximum_imposters(desired_player_count)
        ):
            raise ValueError(
                f"{desired_player_count} players support at most "
                f"{self._maximum_imposters(desired_player_count)} imposter(s)"
            )
        game.desired_player_count = desired_player_count

    def add_player_as_host(
        self, game_id: str, host_id: str, player_name: str
    ) -> Player:
        game = self._get_game(game_id)
        self._require_host(game, host_id)
        return self.add_player(game_id, player_name)

    def update_player_name(
        self, game_id: str, host_id: str, target_id: str, player_name: str
    ) -> Player:
        game = self._get_game(game_id)
        self._require_host(game, host_id)
        if game.phase != GamePhase.WAITING_FOR_PLAYERS:
            raise ValueError("Player names can only be changed while the game is waiting")
        player = self._get_player(game, target_id)
        name = self._normalize_name(player_name)
        if any(
            candidate.player_id != target_id
            and candidate.name.casefold() == name.casefold()
            for candidate in game.players
        ):
            raise ValueError("Player names must be unique within a game")
        player.name = name
        return player

    def remove_player(self, game_id: str, host_id: str, target_id: str) -> None:
        game = self._get_game(game_id)
        self._require_host(game, host_id)
        if game.phase != GamePhase.WAITING_FOR_PLAYERS:
            raise ValueError("Players can only be removed while the game is waiting")
        if target_id == game.host_id:
            raise ValueError("The host cannot be removed from the game")
        self._get_player(game, target_id)
        game.players = [
            player for player in game.players if player.player_id != target_id
        ]
        target_player_count = game.desired_player_count or len(game.players)
        if (
            game.imposter_count is not None
            and game.imposter_count > self._maximum_imposters(target_player_count)
        ):
            game.imposter_count = None

    def authenticate_player(self, game_id: str, player_id: str, token: str) -> None:
        player = self._get_player(self._get_game(game_id), player_id)
        if not compare_digest(player.player_token, token):
            raise PermissionError("Invalid player authentication")

    def set_imposter_count(self, game_id: str, player_id: str, count: int) -> None:
        game = self._get_game(game_id)
        self._require_host(game, player_id)
        if game.phase != GamePhase.WAITING_FOR_PLAYERS:
            raise ValueError("Imposter count can only be changed before the game starts")
        if type(count) is not int or count not in (1, 2, 3):
            raise ValueError("The imposter count must be between 1 and 3")
        player_count = game.desired_player_count or len(game.players)
        maximum = self._maximum_imposters(player_count)
        if count > maximum:
            raise ValueError(
                f"{player_count} players support at most {maximum} imposter(s)"
            )
        game.imposter_count = count

    def configure_total_rounds(self, game_id: str, player_id: str, total_rounds: int) -> None:
        game = self._get_game(game_id)
        self._require_host(game, player_id)
        if game.phase != GamePhase.WAITING_FOR_PLAYERS:
            raise ValueError("The total round count can only be changed before the game starts")
        if type(total_rounds) is not int or not 1 <= total_rounds <= 20:
            raise ValueError("The total round count must be between 1 and 20")
        game.total_rounds = total_rounds

    def configure_hint_input_mode(
        self, game_id: str, player_id: str, hint_input_mode: HintInputMode
    ) -> None:
        game = self._get_game(game_id)
        self._require_host(game, player_id)
        if game.phase != GamePhase.WAITING_FOR_PLAYERS:
            raise ValueError("Hint input mode can only be changed before the game starts")
        if not isinstance(hint_input_mode, HintInputMode):
            try:
                hint_input_mode = HintInputMode(hint_input_mode)
            except ValueError as error:
                raise ValueError("Choose a valid hint input mode") from error
        game.hint_input_mode = hint_input_mode

    def assign_roles(self, game_id: str, player_id: str) -> None:
        game = self._get_game(game_id)
        self._require_host(game, player_id)
        if game.phase != GamePhase.WAITING_FOR_PLAYERS:
            raise ValueError("Roles can only be assigned while waiting for players")
        if not MIN_PLAYERS <= len(game.players) <= MAX_PLAYERS:
            raise ValueError(f"Games require {MIN_PLAYERS} to {MAX_PLAYERS} players")
        if game.hint_input_mode is None:
            raise ValueError("The host must select a hint input mode before starting")
        if (
            game.desired_player_count is not None
            and len(game.players) != game.desired_player_count
        ):
            raise ValueError(
                f"The selected player count is {game.desired_player_count}; "
                f"the room currently has {len(game.players)}"
            )
        if len({player.name.casefold() for player in game.players}) != len(game.players):
            raise ValueError("Player names must be unique within a game")

        maximum = self._maximum_imposters(len(game.players))
        if game.imposter_count is None:
            game.imposter_count = maximum
        if game.imposter_count > maximum:
            raise ValueError(
                f"{len(game.players)} players support at most {maximum} imposter(s)"
            )

        game.round_results.clear()
        game.normal_player_wins = 0
        game.imposter_wins = 0
        for player in game.players:
            player.score = 0
            player.wins = 0
            player.losses = 0
        self.start_round(game)

    def start_round(self, game: Game) -> None:
        if game.round_number >= game.total_rounds:
            raise ValueError("All configured rounds have already been played")
        self.assign_round_roles(game)
        game.round_number += 1
        game.phase = GamePhase.ROLE_ASSIGNMENT
        game.reveal_index = 0
        game.clues.clear()
        game.votes.clear()
        game.eligible_vote_ids.clear()
        game.tied_player_ids.clear()
        game.eliminated_player_id = None
        game.current_clue_round = 0
        game.submitted_clue_player_ids.clear()
        game.winner = None
        game.result_message = None
        game.score_updated = False
        game.guess_submitted = False
        game.guess_correct = False

    def assign_round_roles(self, game: Game) -> None:
        active_players = [player for player in game.players if not player.eliminated]
        if game.imposter_count is None or game.imposter_count >= len(active_players):
            raise ValueError("The imposter count must be less than the active player count")
        imposters = sample(active_players, game.imposter_count)
        self.generate_round_word(game)
        imposter_ids = {player.player_id for player in imposters}
        for player in game.players:
            player.role = IMPOSTER_GUESS if player.player_id in imposter_ids else NORMAL_ROLE
            player.role_viewed = False
            player.hint_viewed = False
            player.vote = None

    @staticmethod
    def generate_round_word(game: Game) -> None:
        previous_words = {result.secret_word for result in game.round_results}
        available_words = [
            word for word in WORDS_BY_CATEGORY[game.category] if word not in previous_words
        ]
        game.secret_word = choice(available_words)
        game.imposter_hint = choice(
            [word for word in WORDS_BY_CATEGORY[game.category] if word != game.secret_word]
        )

    def advance_to_next_round(self, game_id: str, player_id: str) -> None:
        game = self._get_game(game_id)
        self._require_host(game, player_id)
        if game.phase != GamePhase.ROUND_RESULTS:
            raise ValueError("The current round must be complete before starting the next round")
        if game.round_number >= game.total_rounds:
            raise ValueError("All configured rounds have already been played")
        for player in game.players:
            player.eliminated = False
        if len(game.round_results) != game.round_number:
            raise ValueError("The previous round result has not been saved")
        self.start_round(game)

    def finish_game(self, game_id: str, player_id: str) -> None:
        game = self._get_game(game_id)
        self._require_host(game, player_id)
        if game.phase != GamePhase.ROUND_RESULTS:
            raise ValueError("A game can only end after a round result")
        game.phase = GamePhase.GAME_OVER

    def create_replay_session(self, game_id: str, player_id: str) -> tuple[Game, Player]:
        previous_game = self._get_game(game_id)
        self._require_host(previous_game, player_id)
        if previous_game.phase != GamePhase.GAME_OVER:
            raise ValueError("A replay session can only be created after the game ends")
        if previous_game.replay_game_id is not None:
            replay_game = self._get_game(previous_game.replay_game_id)
            return replay_game, self._get_player(replay_game, replay_game.host_id)
        host = self._get_player(previous_game, player_id)
        replay_game, replay_host = self.create_game(
            host.name,
            previous_game.category,
            previous_game.imposter_count,
            previous_game.total_rounds,
            clue_rounds=previous_game.clue_rounds,
            hint_input_mode=previous_game.hint_input_mode,
        )
        previous_game.replay_player_ids[host.player_id] = replay_host.player_id
        for player in previous_game.players:
            if player.player_id != host.player_id:
                replay_player = self.add_player(replay_game.game_id, player.name)
                previous_game.replay_player_ids[player.player_id] = replay_player.player_id
        previous_game.replay_game_id = replay_game.game_id
        return replay_game, replay_host

    def start_role_reveal(self, game_id: str, player_id: str) -> None:
        game = self._get_game(game_id)
        self._require_host(game, player_id)
        if game.phase != GamePhase.ROLE_ASSIGNMENT:
            raise ValueError("Roles have not been assigned")
        game.phase = GamePhase.ROLE_REVEAL

    def get_player_role(self, game_id: str, player_id: str) -> PlayerRoleResponse:
        game = self._get_game(game_id)
        player = self._get_player(game, player_id)
        if game.phase != GamePhase.ROLE_REVEAL:
            raise ValueError("Roles can only be revealed during role assignment")
        current_player = game.players[game.reveal_index]
        if current_player.player_id != player_id:
            raise PermissionError("It is not this player's turn to reveal their role")
        if player.role_viewed:
            raise ValueError("This player has already viewed their role")
        player.role_viewed = True
        return PlayerRoleResponse(
            player_id=player.player_id,
            role=player.role or NORMAL_ROLE,
            word=game.secret_word if player.role == NORMAL_ROLE else None,
        )

    def get_imposter_hint(self, game_id: str, player_id: str) -> str:
        game = self._get_game(game_id)
        player = self._get_player(game, player_id)
        if game.phase != GamePhase.ROLE_REVEAL:
            raise ValueError("Hints are only available during role reveal")
        current_player = game.players[game.reveal_index]
        if current_player.player_id != player_id:
            raise PermissionError("It is not this player's turn to reveal their role")
        if not player.role_viewed:
            raise PermissionError("Reveal your role before asking for a hint")
        if player.role != IMPOSTER_GUESS:
            raise PermissionError("Only imposters can request this hint")
        if player.hint_viewed:
            raise ValueError("Your hint has already been shown")
        player.hint_viewed = True
        if game.imposter_hint is None:
            raise ValueError("No hint is available for this game")
        return game.imposter_hint

    def advance_role_reveal(self, game_id: str, player_id: str) -> None:
        game = self._get_game(game_id)
        if game.phase != GamePhase.ROLE_REVEAL:
            raise ValueError("Role reveal is not in progress")
        current_player = game.players[game.reveal_index]
        if current_player.player_id != player_id:
            raise PermissionError("Only the current player can finish their role reveal")
        if not current_player.role_viewed:
            raise ValueError("View your role before passing the device")
        game.reveal_index += 1
        if game.reveal_index == len(game.players):
            self.start_clue_round(game_id, first_round=True)

    def start_clue_round(
        self,
        game_id: str,
        player_id: str | None = None,
        *,
        first_round: bool = False,
    ) -> None:
        game = self._get_game(game_id)
        if first_round:
            if game.phase != GamePhase.ROLE_REVEAL or game.reveal_index != len(game.players):
                raise ValueError("All players must reveal their roles before clues begin")
        else:
            if player_id is None:
                raise PermissionError("A host player ID is required")
            self._require_host(game, player_id)
            raise ValueError("Clue rounds advance automatically after every player submits")
        active_players = [player for player in game.players if not player.eliminated]
        if len(active_players) < 2:
            raise ValueError("At least two active players are required to continue")
        game.phase = GamePhase.CLUE_ROUND
        game.current_clue_round = 1
        game.submitted_clue_player_ids.clear()
        game.turn_order = [player.player_id for player in active_players]
        game.turn_index = 0

    def submit_clue(self, game_id: str, player_id: str, clue_text: str) -> None:
        game = self._get_game(game_id)
        if game.hint_input_mode != HintInputMode.TEXT_INPUT:
            raise ValueError("Text hints are not enabled for this game")
        self._complete_hint_turn(game, player_id, clue_text)

    def mark_hint_given(self, game_id: str, player_id: str) -> None:
        game = self._get_game(game_id)
        if game.hint_input_mode != HintInputMode.TABLE_TALK:
            raise ValueError("Table-talk hints are not enabled for this game")
        self._complete_hint_turn(game, player_id, None)

    def _complete_hint_turn(
        self, game: Game, player_id: str, clue_text: str | None
    ) -> None:
        if game.phase != GamePhase.CLUE_ROUND:
            raise ValueError("Clues can only be submitted during a clue round")
        if player_id in game.submitted_clue_player_ids:
            raise ValueError("This player has already submitted a clue for this clue round")
        current_player = self._current_turn(game)
        if current_player is None:
            raise ValueError("All clues for this clue round have been submitted")
        if current_player != player_id:
            raise PermissionError("It is not this player's turn to give a clue")
        if clue_text is not None:
            clue_text = clue_text.strip()
            if not clue_text:
                raise ValueError("Clue cannot be empty")
            if any(
                clue.round_number == game.round_number
                and clue.clue_round_number == game.current_clue_round
                and clue.clue.casefold() == clue_text.casefold()
                for clue in game.clues
            ):
                raise ValueError("A player has already given this clue in the current clue round")
            game.clues.append(
                Clue(
                    player_id=player_id,
                    clue=clue_text,
                    round_number=game.round_number,
                    clue_round_number=game.current_clue_round,
                )
            )
        game.submitted_clue_player_ids.append(player_id)
        game.turn_index += 1
        if game.turn_index == len(game.turn_order):
            if game.current_clue_round < game.clue_rounds:
                game.current_clue_round += 1
                game.turn_order = [
                    player.player_id for player in self._active_players(game)
                ]
                game.turn_index = 0
                game.submitted_clue_player_ids.clear()
            else:
                game.phase = GamePhase.VOTING
                game.votes.clear()
                game.tied_player_ids.clear()
                game.eligible_vote_ids = [
                    player.player_id for player in self._active_players(game)
                ]

    def start_voting(self, game_id: str, player_id: str) -> None:
        game = self._get_game(game_id)
        self._require_host(game, player_id)
        raise ValueError("Voting starts automatically after all clue rounds are complete")

    def submit_vote(self, game_id: str, player_id: str, target_id: str) -> None:
        game = self._get_game(game_id)
        if game.phase != GamePhase.VOTING:
            raise ValueError("Voting is not open")
        voter = self._get_player(game, player_id)
        if voter.eliminated or player_id not in game.eligible_vote_ids:
            raise PermissionError("This player is not eligible to vote")
        if player_id in game.votes:
            raise ValueError("Each player may vote only once per ballot")
        if target_id == player_id:
            raise ValueError("Players cannot vote for themselves")
        if target_id not in {player.player_id for player in self._active_players(game)}:
            raise ValueError("Votes must target an active player in this game")
        if game.tied_player_ids and target_id not in game.tied_player_ids:
            raise ValueError("Revote only for a tied player")
        game.votes[player_id] = target_id
        voter.vote = target_id
        if all(voter_id in game.votes for voter_id in game.eligible_vote_ids):
            game.phase = GamePhase.VOTE_RESULTS

    def calculate_votes(self, game_id: str) -> list[VoteCount]:
        game = self._get_game(game_id)
        if game.phase not in (
            GamePhase.VOTE_RESULTS,
            GamePhase.ROUND_RESULTS,
            GamePhase.GAME_OVER,
        ):
            raise ValueError("Vote results are not available until everyone has voted")
        counts = Counter(game.votes.values())
        return [
            VoteCount(
                player_id=player.player_id,
                player_name=player.name,
                count=counts[player.player_id],
            )
            for player in self._active_players(game)
        ]

    def handle_tie(self, game_id: str, player_id: str) -> str:
        game = self._get_game(game_id)
        self._require_host(game, player_id)
        if game.phase != GamePhase.VOTE_RESULTS:
            raise ValueError("Resolve the ballot after all votes are in")
        counts = Counter(game.votes.values())
        if not counts:
            raise ValueError("There are no votes to resolve")
        maximum = max(counts.values())
        leaders = [target for target, count in counts.items() if count == maximum]
        if len(leaders) > 1:
            game.tied_player_ids = leaders
            game.votes.clear()
            for player in game.players:
                player.vote = None
            game.phase = GamePhase.VOTING
            return "tie"
        self.identify_imposter(game_id, leaders[0])
        return "resolved"

    def identify_imposter(self, game_id: str, player_id: str) -> None:
        game = self._get_game(game_id)
        if game.phase != GamePhase.VOTE_RESULTS:
            raise ValueError("A player can only be identified after vote results")
        counts = Counter(game.votes.values())
        if not counts:
            raise ValueError("There are no votes to resolve")
        maximum = max(counts.values())
        leaders = [target for target, count in counts.items() if count == maximum]
        if len(leaders) != 1 or leaders[0] != player_id:
            raise ValueError("Only the unique top-voted player can be identified")
        target = self._get_player(game, player_id)
        if target.eliminated:
            raise ValueError("This player was already eliminated")
        game.eliminated_player_id = player_id
        if target.role == NORMAL_ROLE:
            target.eliminated = True
            game.result_message = f"{target.name} was a normal player. The imposters win."
            self.calculate_winner(game_id, IMPOSTER_TEAM)
            return
        game.phase = GamePhase.IMPOSTER_GUESS
        game.guess_submitted = False
        game.guess_correct = False
        game.result_message = f"{target.name} was an imposter and may guess the secret word."

    def submit_imposter_guess(self, game_id: str, player_id: str, guess: str) -> bool:
        game = self._get_game(game_id)
        if game.phase != GamePhase.IMPOSTER_GUESS:
            raise ValueError("There is no imposter guess to submit")
        if game.hint_input_mode != HintInputMode.TEXT_INPUT:
            raise ValueError("Text guesses are not enabled for this game")
        if player_id != game.eliminated_player_id:
            raise PermissionError("Only the identified imposter may guess the secret word")
        player = self._get_player(game, player_id)
        if player.role != IMPOSTER_GUESS or player.eliminated:
            raise PermissionError("This player cannot guess the secret word")
        if game.guess_submitted:
            raise ValueError("The imposter guess was already submitted")
        guess = guess.strip()
        if not guess or len(guess) > 200:
            raise ValueError("The guess must contain 1 to 200 characters")
        correct = guess.casefold() == (game.secret_word or "").casefold()
        game.guess_submitted = True
        game.guess_correct = correct
        self._resolve_imposter_guess(game, correct)
        return correct

    def mark_imposter_guess_spoken(self, game_id: str, player_id: str) -> None:
        game = self._get_game(game_id)
        if game.phase != GamePhase.IMPOSTER_GUESS:
            raise ValueError("There is no imposter guess to submit")
        if game.hint_input_mode != HintInputMode.TABLE_TALK:
            raise ValueError("Spoken guesses are not enabled for this game")
        if player_id != game.eliminated_player_id:
            raise PermissionError("Only the identified imposter may guess the secret word")
        player = self._get_player(game, player_id)
        if player.role != IMPOSTER_GUESS or player.eliminated:
            raise PermissionError("This player cannot guess the secret word")
        if game.guess_submitted:
            raise ValueError("The imposter guess was already submitted")
        game.guess_submitted = True

    def resolve_spoken_imposter_guess(
        self, game_id: str, player_id: str, correct: bool
    ) -> bool:
        game = self._get_game(game_id)
        if game.phase != GamePhase.IMPOSTER_GUESS:
            raise ValueError("There is no imposter guess to resolve")
        if game.hint_input_mode != HintInputMode.TABLE_TALK:
            raise ValueError("Spoken guesses are not enabled for this game")
        self._require_host(game, player_id)
        if not game.guess_submitted:
            raise ValueError("The imposter must say their guess before it can be resolved")
        game.guess_correct = correct
        self._resolve_imposter_guess(game, correct)
        return correct

    def _resolve_imposter_guess(self, game: Game, correct: bool) -> None:
        player = self._get_player(game, game.eliminated_player_id or "")
        player.eliminated = True
        if correct:
            game.result_message = f"{player.name} guessed the secret word. The imposters win."
            self.calculate_winner(game.game_id, IMPOSTER_TEAM)
        elif any(
            candidate.role == IMPOSTER_GUESS and not candidate.eliminated
            for candidate in game.players
        ):
            game.result_message = (
                f"{player.name} guessed incorrectly and is eliminated. The remaining imposter(s) continue."
            )
            game.phase = GamePhase.CLUE_ROUND
            game.clues = [
                clue for clue in game.clues if clue.round_number != game.round_number
            ]
            game.votes.clear()
            game.tied_player_ids.clear()
            game.eligible_vote_ids.clear()
            game.turn_order = [
                candidate.player_id for candidate in self._active_players(game)
            ]
            game.turn_index = 0
            game.current_clue_round = 1
            game.submitted_clue_player_ids.clear()
        else:
            game.result_message = f"{player.name} guessed incorrectly. The normal players win."
            self.calculate_winner(game.game_id, PLAYER_TEAM)

    def calculate_winner(self, game_id: str, winner: str) -> str:
        game = self._get_game(game_id)
        if winner not in (IMPOSTER_TEAM, PLAYER_TEAM):
            raise ValueError("Winner must be IMPOSTERS or PLAYERS")
        if game.phase == GamePhase.GAME_OVER:
            if game.winner != winner:
                raise ValueError("The winner has already been determined")
            return winner
        if game.phase not in (GamePhase.VOTE_RESULTS, GamePhase.IMPOSTER_GUESS):
            raise ValueError("A winner can only be determined after voting or a word guess")
        if game.phase == GamePhase.VOTE_RESULTS and winner != IMPOSTER_TEAM:
            raise ValueError("Only an identified normal player can end the round after voting")
        if game.phase == GamePhase.IMPOSTER_GUESS and winner == IMPOSTER_TEAM:
            if not game.guess_submitted or not game.guess_correct:
                raise ValueError("The identified imposter must guess the secret word correctly")
        if winner == IMPOSTER_TEAM and not any(
            player.role == IMPOSTER_GUESS for player in game.players
        ):
            raise ValueError("This game has no imposters")
        if winner == PLAYER_TEAM and not any(
            player.role == NORMAL_ROLE for player in game.players
        ):
            raise ValueError("This game has no normal players")
        game.winner = winner
        game.phase = GamePhase.ROUND_RESULTS
        self.update_scores(game_id, winner)
        if winner == IMPOSTER_TEAM:
            game.imposter_wins += 1
        else:
            game.normal_player_wins += 1
        self.save_round_result(game)
        if game.round_number >= game.total_rounds:
            game.phase = GamePhase.GAME_OVER
        return winner

    @staticmethod
    def save_round_result(game: Game) -> RoundResult:
        if game.winner not in (IMPOSTER_TEAM, PLAYER_TEAM):
            raise ValueError("A valid round winner is required to save a round result")
        existing = next(
            (result for result in game.round_results if result.round_number == game.round_number),
            None,
        )
        if existing is not None:
            return existing
        counts = Counter(game.votes.values())
        result = RoundResult(
            round_number=game.round_number,
            secret_word=game.secret_word or "",
            imposter_names=[
                player.name for player in game.players if player.role == IMPOSTER_GUESS
            ],
            winner=game.winner,
            vote_counts=[
                VoteCount(
                    player_id=player.player_id,
                    player_name=player.name,
                    count=counts[player.player_id],
                )
                for player in game.players
            ],
            player_stats=[
                RoundPlayerStats(
                    player_id=player.player_id,
                    player_name=player.name,
                    role=player.role or NORMAL_ROLE,
                    wins=player.wins,
                    losses=player.losses,
                )
                for player in game.players
            ],
        )
        game.round_results.append(result)
        return result

    def get_round_result(self, game_id: str, round_number: int) -> RoundResult:
        game = self._get_game(game_id)
        for result in game.round_results:
            if result.round_number == round_number:
                return result
        raise ValueError("Round result is not available")

    @staticmethod
    def calculate_final_results(game: Game) -> FinalResults:
        if game.phase != GamePhase.GAME_OVER:
            raise ValueError("Final results are only available after the game ends")
        if game.normal_player_wins > game.imposter_wins:
            winner = PLAYER_TEAM
        elif game.imposter_wins > game.normal_player_wins:
            winner = IMPOSTER_TEAM
        else:
            winner = "TIE"
        return FinalResults(
            total_rounds=game.total_rounds,
            rounds_played=len(game.round_results),
            normal_player_wins=game.normal_player_wins,
            imposter_wins=game.imposter_wins,
            winner=winner,
            player_stats=[
                PublicPlayer(
                    player_id=player.player_id,
                    name=player.name,
                    score=player.score,
                    wins=player.wins,
                    losses=player.losses,
                    eliminated=player.eliminated,
                    has_voted=player.player_id in game.votes,
                    role_viewed=player.role_viewed,
                )
                for player in game.players
            ],
        )

    def update_scores(self, game_id: str, winner: str | None = None) -> None:
        game = self._get_game(game_id)
        winner = winner or game.winner
        if winner not in (IMPOSTER_TEAM, PLAYER_TEAM):
            raise ValueError("A valid winner is required to update scores")
        if game.phase != GamePhase.ROUND_RESULTS or winner != game.winner:
            raise ValueError("Scores can only be updated for the decided round winner")
        if game.score_updated:
            return
        for player in game.players:
            player_won = (
                player.role == IMPOSTER_GUESS
                if winner == IMPOSTER_TEAM
                else player.role == NORMAL_ROLE
            )
            if player_won:
                player.wins += 1
                player.score += 1
            else:
                player.losses += 1
        game.score_updated = True

    def reset_round(self, game_id: str, player_id: str) -> None:
        game = self._get_game(game_id)
        self._require_host(game, player_id)
        if game.phase != GamePhase.GAME_OVER:
            raise ValueError("A round can only be reset after the game is over")
        game.phase = GamePhase.WAITING_FOR_PLAYERS
        game.imposter_count = None
        game.secret_word = None
        game.imposter_hint = None
        game.reveal_index = 0
        game.turn_order.clear()
        game.turn_index = 0
        game.current_clue_round = 0
        game.submitted_clue_player_ids.clear()
        game.clues.clear()
        game.votes.clear()
        game.eligible_vote_ids.clear()
        game.tied_player_ids.clear()
        game.eliminated_player_id = None
        game.winner = None
        game.result_message = None
        game.score_updated = False
        game.guess_submitted = False
        game.guess_correct = False
        game.round_results.clear()
        game.total_rounds = 1
        game.desired_player_count = None
        game.round_number = 0
        game.normal_player_wins = 0
        game.imposter_wins = 0
        for player in game.players:
            player.role = None
            player.eliminated = False
            player.role_viewed = False
            player.hint_viewed = False
            player.vote = None

    def get_game_state(self, game_id: str, player_id: str | None = None) -> GameStateResponse:
        game = self._get_game(game_id)
        if player_id is not None:
            self._get_player(game, player_id)
        if game.phase == GamePhase.VOTE_RESULTS:
            visible_votes = self.calculate_votes(game_id)
        elif game.phase in (GamePhase.ROUND_RESULTS, GamePhase.GAME_OVER):
            visible_votes = game.round_results[-1].vote_counts if game.round_results else None
        else:
            visible_votes = None
        final_results = (
            self.calculate_final_results(game)
            if game.phase == GamePhase.GAME_OVER
            else None
        )
        return GameStateResponse(
            game_id=game.game_id,
            room_code=game.room_code,
            phase=game.phase,
            host_id=game.host_id,
            category=game.category,
            player_count=len(game.players),
            imposter_count=game.imposter_count,
            round_number=game.round_number,
            total_rounds=game.total_rounds,
            desired_player_count=game.desired_player_count,
            clue_rounds=game.clue_rounds,
            hint_input_mode=game.hint_input_mode,
            current_clue_round=game.current_clue_round,
            submitted_clue_player_ids=game.submitted_clue_player_ids.copy(),
            completed_turns=len(game.submitted_clue_player_ids),
            completed_rounds=len(game.round_results),
            normal_player_wins=game.normal_player_wins,
            imposter_wins=game.imposter_wins,
            round_results=game.round_results.copy(),
            final_results=final_results,
            players=[
                PublicPlayer(
                    player_id=player.player_id,
                    name=player.name,
                    score=player.score,
                    wins=player.wins,
                    losses=player.losses,
                    eliminated=player.eliminated,
                    has_voted=player.player_id in game.votes,
                    role_viewed=player.role_viewed,
                )
                for player in game.players
            ],
            current_reveal_player_id=(
                game.players[game.reveal_index].player_id
                if game.phase == GamePhase.ROLE_REVEAL and game.reveal_index < len(game.players)
                else None
            ),
            current_turn_player_id=self._current_turn(game),
            clues=[
                ClueRecord(
                    player_id=clue.player_id,
                    player_name=self._get_player(game, clue.player_id).name,
                    clue=clue.clue,
                    round_number=clue.round_number,
                    clue_round_number=clue.clue_round_number,
                )
                for clue in game.clues
            ],
            eligible_vote_ids=game.eligible_vote_ids.copy() if game.phase == GamePhase.VOTING else [],
            vote_counts=visible_votes,
            tied_player_ids=game.tied_player_ids.copy() if game.phase == GamePhase.VOTING else [],
            eliminated_player_id=game.eliminated_player_id,
            guess_submitted=game.guess_submitted,
            winner=game.winner,
            result_message=game.result_message,
        )

    def _get_game(self, game_id: str) -> Game:
        game = self.games.get(game_id)
        if game is None:
            raise ValueError("Game not found")
        return game

    @staticmethod
    def _get_player(game: Game, player_id: str) -> Player:
        for player in game.players:
            if player.player_id == player_id:
                return player
        raise ValueError("Player does not belong to this game")

    @staticmethod
    def _require_host(game: Game, player_id: str) -> None:
        if game.host_id != player_id:
            raise PermissionError("Only the game host can do this")

    @staticmethod
    def _active_players(game: Game) -> list[Player]:
        return [player for player in game.players if not player.eliminated]

    @staticmethod
    def _current_turn(game: Game) -> str | None:
        if game.phase != GamePhase.CLUE_ROUND or game.turn_index >= len(game.turn_order):
            return None
        return game.turn_order[game.turn_index]

    @staticmethod
    def _maximum_imposters(player_count: int) -> int:
        if player_count < 2:
            return 0
        return min(3, max(1, (player_count - 1) // 2))

    @staticmethod
    def _normalize_name(player_name: str) -> str:
        name = player_name.strip()
        if not name or len(name) > 30:
            raise ValueError("Player names must contain 1 to 30 characters")
        return name

    @staticmethod
    def _new_player(player_name: str) -> Player:
        return Player(
            player_id=uuid4().hex,
            name=player_name,
            player_token=token_urlsafe(32),
        )

    def _new_room_code(self) -> str:
        start = randbelow(10_000)
        used_codes = {game.room_code for game in self.games.values()}
        for offset in range(10_000):
            code = f"{(start + offset) % 10_000:04d}"
            if code not in used_codes:
                return code
        raise ValueError("No room codes are currently available")
