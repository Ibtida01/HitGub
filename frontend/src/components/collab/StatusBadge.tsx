import { CollaboratorStatus } from '../../types';

const CONFIG: Record<CollaboratorStatus, { label: string; style: string }> = {
  pending: { label: 'Pending', style: 'bg-yellow-400/10 text-gh-warning border-yellow-400/20' },
  accepted: { label: 'Active', style: 'bg-green-400/10 text-gh-success border-green-400/20' },
  rejected: { label: 'Rejected', style: 'bg-red-400/10 text-gh-danger border-red-400/20' },
  revoked: { label: 'Revoked', style: 'bg-gh-text-muted/10 text-gh-text-muted border-gh-text-muted/20' },
};

export function StatusBadge({ status }: { status: CollaboratorStatus }) {
  const { label, style } = CONFIG[status];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${style}`}
    >
      {label}
    </span>
  );
}
