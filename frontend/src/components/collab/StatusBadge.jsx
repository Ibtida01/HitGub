const CONFIG = {
  pending: { label: 'Pending', style: 'bg-yellow-400/10 text-gh-warning border-yellow-400/20' },
  accepted: { label: 'Active', style: 'bg-green-400/10 text-gh-success border-green-400/20' },
  rejected: { label: 'Rejected', style: 'bg-red-400/10 text-gh-danger border-red-400/20' },
};

export function StatusBadge({ status }) {
  if (status === 'accepted') {
    return null;
  }

  const { label, style } = CONFIG[status] ?? CONFIG.pending;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${style}`}
    >
      {label}
    </span>
  );
}
