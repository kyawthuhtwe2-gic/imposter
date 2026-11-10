# Imposter Game

Multiplayer Imposter word game with a FastAPI/Pydantic backend and a React frontend.

## Requirements

- Python 3.10+
- Node.js 18+

## Run the backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:CORS_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000"
uvicorn app.main:app --reload
```

Set `CORS_ORIGINS` to a comma-separated list of frontend origins before starting the backend; see `backend/.env.example` for the local defaults. If unset, the backend allows `http://localhost:3000` and `http://127.0.0.1:3000`. The API is available at `http://localhost:8000`; interactive API documentation is at `http://localhost:8000/docs`.

## Run the frontend

```powershell
cd frontend
npm install
npm run dev
```

Copy `frontend/.env.example` to `frontend/.env.local` and set `NEXT_PUBLIC_API_URL` if the backend is not running at `http://localhost:8000`. The local environment file is ignored by Git.

Open `http://localhost:3000`.

## Game rules and API

- Games support 3–10 players with unique, case-insensitive names.
- The host can choose 1–3 imposters; two require at least 5 players, and three require at least 7 players.
- The host assigns roles, then players reveal them one at a time. Only the authenticated current player can request their role; imposters never receive the secret word.
- Clues proceed in player turn order. Every active player gives one clue per round; the host can start additional clue rounds or open voting.
- Votes are hidden until all eligible players vote. Ties trigger a revote limited to tied candidates.
- A normal player voted out gives the imposter team the win. An identified imposter gets one secret-word guess: a correct guess wins for imposters; an incorrect guess eliminates that imposter, and remaining imposters continue. If none remain, normal players win.
- Wins and losses accumulate per player between rounds. Only the host can reset a finished round.

The API is rooted at `/games`; browse `/docs` for the endpoints. `POST /games` and `POST /games/{id}/players` return a private player token. Send it as a `Bearer` authorization header on game actions and state requests. The frontend stores this token in browser session storage; WebSocket connections authenticate with the same token.

Game sessions are isolated and held in backend memory. Restarting the backend clears active games and scores.

## Tests

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest tests
```

```powershell
cd frontend
npm test
npm run build
```
