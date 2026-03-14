import { Shield, Check, Minus } from 'lucide-react';
import { ROLE_PERMISSIONS, Role } from '../../types';

const ALL_ROLES: Role[] = ['owner', 'maintainer', 'contributor', 'read-only'];

const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  maintainer: 'Maintainer',
  contributor: 'Contributor',
  'read-only': 'Read-only',
};

const ROLE_COLORS: Record<Role, string> = {
  owner: 'text-purple-400 bg-purple-400/10',
  maintainer: 'text-blue-400 bg-blue-400/10',
  contributor: 'text-green-400 bg-green-400/10',
  'read-only': 'text-gh-text-secondary bg-gh-overlay',
};

const ALL_PERMISSIONS = [
  'Full repository access',
  'Manage collaborators & permissions',
  'Change repository settings',
  'Delete repository',
  'Manage branches & protection rules',
  'Push to protected branches',
  'Merge pull requests',
  'Push to all branches',
  'Manage branches',
  'Invite contributors & read-only users',
  'Manage issues & labels',
  'Push to non-protected branches',
  'Create pull requests',
  'Create and manage own issues',
  'Comment on pull requests & issues',
  'View repository contents',
  'Clone repository',
  'Comment on issues',
  'View pull requests',
];

export function PermissionInfo() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-5">
        <h2 className="text-xl font-semibold text-gh-text flex items-center gap-2">
          <Shield size={20} />
          Permission levels
        </h2>
        <p className="text-sm text-gh-text-secondary mt-0.5">
          Each role grants a different level of access to the repository.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {ALL_ROLES.map((role) => (
          <div key={role} className="bg-gh-canvas-subtle border border-gh-border rounded-lg p-4">
            <h3
              className={`text-sm font-semibold px-2.5 py-1 rounded-full inline-block mb-3 ${ROLE_COLORS[role]}`}
            >
              {ROLE_LABELS[role]}
            </h3>
            <ul className="space-y-1.5">
              {ROLE_PERMISSIONS[role].map((perm) => (
                <li key={perm} className="flex items-start gap-2 text-sm text-gh-text-secondary">
                  <Check size={14} className="mt-0.5 text-gh-success shrink-0" />
                  {perm}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="bg-gh-canvas-subtle border border-gh-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gh-border bg-gh-canvas">
          <h3 className="text-sm font-semibold text-gh-text">Permission matrix</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gh-border">
                <th className="text-left px-4 py-2.5 text-gh-text-secondary font-medium">
                  Permission
                </th>
                {ALL_ROLES.map((role) => (
                  <th
                    key={role}
                    className={`px-4 py-2.5 text-center font-medium ${ROLE_COLORS[role].split(' ')[0]}`}
                  >
                    {ROLE_LABELS[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gh-border-muted">
              {ALL_PERMISSIONS.map((perm) => (
                <tr key={perm} className="hover:bg-gh-overlay">
                  <td className="px-4 py-2 text-gh-text-secondary">{perm}</td>
                  {ALL_ROLES.map((role) => {
                    const has = ROLE_PERMISSIONS[role].includes(perm);
                    return (
                      <td key={role} className="px-4 py-2 text-center">
                        {has ? (
                          <Check size={16} className="inline text-gh-success" />
                        ) : (
                          <Minus size={16} className="inline text-gh-text-muted" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
