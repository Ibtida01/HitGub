import { Shield, Eye, Users, Crown } from 'lucide-react';
import { Role } from '../../types';

const CONFIG: Record<Role, { label: string; style: string; Icon: typeof Shield }> = {
  owner: {
    label: 'Owner',
    style: 'bg-purple-400/10 text-purple-400 border-purple-400/20',
    Icon: Crown,
  },
  maintainer: {
    label: 'Maintainer',
    style: 'bg-blue-400/10 text-blue-400 border-blue-400/20',
    Icon: Shield,
  },
  contributor: {
    label: 'Contributor',
    style: 'bg-green-400/10 text-green-400 border-green-400/20',
    Icon: Users,
  },
  'read-only': {
    label: 'Read-only',
    style: 'bg-gh-text-muted/10 text-gh-text-secondary border-gh-text-muted/20',
    Icon: Eye,
  },
};

export function RoleBadge({ role }: { role: Role }) {
  const { label, style, Icon } = CONFIG[role];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${style}`}
    >
      <Icon size={12} />
      {label}
    </span>
  );
}
