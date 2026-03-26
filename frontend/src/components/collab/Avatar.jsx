const BG_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-purple-500",
  "bg-pink-500",
  "bg-indigo-500",
  "bg-teal-500",
  "bg-orange-500",
  "bg-cyan-500",
];

function hashUsername(name) {
  const safeName = typeof name === "string" ? name : "";
  let hash = 0;
  for (let i = 0; i < safeName.length; i++) {
    hash = safeName.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

const SIZE_CLASSES = {
  sm: "w-6 h-6 text-xs",
  md: "w-8 h-8 text-sm",
  lg: "w-10 h-10 text-base",
};

export function Avatar({ username, avatarUrl, size = "md" }) {
  const safeUsername = typeof username === "string" ? username : "";

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={safeUsername || "avatar"}
        className={`${SIZE_CLASSES[size]} rounded-full object-cover`}
      />
    );
  }

  const bg = BG_COLORS[hashUsername(safeUsername) % BG_COLORS.length];
  const initial = safeUsername.trim()[0]?.toUpperCase() || "?";

  return (
    <div
      className={`${SIZE_CLASSES[size]} ${bg} rounded-full flex items-center justify-center text-white font-semibold shrink-0`}
    >
      {initial}
    </div>
  );
}
