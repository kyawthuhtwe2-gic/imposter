const BODY = "#7c3aed";
const VISOR = "#bfe9ff";

const FACES = {
  wave: { emoji: "👋", label: "ဟိုင်း" },
  sneaky: { emoji: "🤫", label: "တိတ်တိတ်" },
  think: { emoji: "🤔", label: "စဉ်းစားနေ" },
  detective: { emoji: "🕵️", label: "စုံထောက်" },
  vote: { emoji: "🗳️", label: "မဲပေး" },
  tally: { emoji: "📊", label: "ရလဒ်" },
  guess: { emoji: "🔮", label: "ခန့်မှန်း" },
  win: { emoji: "🎉", label: "အနိုင်" },
  lose: { emoji: "😵", label: "အရှုံး" },
  wait: { emoji: "⏳", label: "စောင့်ပါ" },
  lost: { emoji: "🙈", label: "ရှာမတွေ့" },
  imposter: { emoji: "😈", label: "Imposter" },
  crew: { emoji: "😇", label: "Player" },
};

export default function FunnyImage({ variant = "wave", className = "" }) {
  const face = FACES[variant] ?? FACES.wave;
  return (
    <svg
      className={`funny-image ${className}`.trim()}
      viewBox="0 0 120 120"
      role="img"
      aria-label={face.label}
    >
      <ellipse cx="60" cy="112" rx="30" ry="5" fill="rgba(0,0,0,0.25)" />
      <rect x="82" y="46" width="14" height="34" rx="7" fill={BODY} />
      <path d="M32 50a28 28 0 0 1 56 0v44a8 8 0 0 1-8 8H72a6 6 0 0 1-6-6v-6H54v6a6 6 0 0 1-6 6H40a8 8 0 0 1-8-8z" fill={BODY} />
      <rect x="40" y="36" width="40" height="26" rx="13" fill={VISOR} />
      <ellipse cx="50" cy="42" rx="7" ry="3" fill="#fff" opacity="0.7" />
      <text x="60" y="56" textAnchor="middle" fontSize="18">{face.emoji}</text>
    </svg>
  );
}
