import { Role, ASSIGNABLE_ROLES, ROLE_LEVEL } from '../../types';

interface RoleSelectProps {
  value: Role;
  currentUserRole: Role;
  targetRole: Role;
  onChange: (role: Role) => void;
  disabled?: boolean;
}

const LABELS: Record<Role, string> = {
  owner: 'Owner',
  maintainer: 'Maintainer',
  contributor: 'Contributor',
  'read-only': 'Read-only',
};

export function RoleSelect({
  value,
  currentUserRole,
  targetRole,
  onChange,
  disabled,
}: RoleSelectProps) {
  const assignable = ASSIGNABLE_ROLES[currentUserRole];
  const canChange =
    !disabled &&
    targetRole !== 'owner' &&
    ROLE_LEVEL[targetRole] > ROLE_LEVEL[currentUserRole];

  if (!canChange) return null;

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Role)}
      className="text-sm border border-gh-border rounded-md px-2 py-1 bg-gh-canvas text-gh-text hover:border-gh-text-muted focus:outline-none focus:ring-2 focus:ring-gh-accent focus:border-gh-accent cursor-pointer"
    >
      {assignable.map((role) => (
        <option key={role} value={role}>
          {LABELS[role]}
        </option>
      ))}
    </select>
  );
}
