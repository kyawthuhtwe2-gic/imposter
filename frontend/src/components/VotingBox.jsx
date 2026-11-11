export default function VotingBox({ players, onVote, disabled = false }) {
  return (
    <section aria-labelledby="voting-title" className="game-panel">
      <h2 id="voting-title">သံသယရှိသူကို မဲပေးပါ</h2>
      {disabled ? (
        <p>သင့်မဲကို မှတ်တမ်းတင်ပြီးပါပြီ။ ကျန်Player များ မဲပေးရန် စောင့်နေသည်။</p>
      ) : players.length === 0 ? (
        <p>မဲပေးနိုင်သော Player မရှိပါ။</p>
      ) : (
        <ul className="vote-options">
          {players.map((player) => (
            <li key={player.player_id}>
              <button type="button" onClick={() => onVote(player.player_id)}>
                {player.name} ကို မဲပေးမယ်
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
