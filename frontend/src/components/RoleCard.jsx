export default function RoleCard({ role, word }) {
  return (
    <section className="role-card" aria-label="သင့်အခန်းကဏ္ဍ">
      <p className="eyebrow">သင့်အခန်းကဏ္ဍ</p>
      <h2>{role === "imposter" ? "Imposter" : "Player"}</h2>
      {word && <p>လျှို့ဝှက်စကားလုံး · {word}</p>}
    </section>
  );
}
