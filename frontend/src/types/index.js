/**
 * Collaborator domain constants (aligned with database/init.sql + backend/py_git.py).
 * Roles: owner | contributor | read-only
 * Status: pending | accepted | rejected
 */

export const ROLE_PERMISSIONS = {
  owner: [
    'Full repository access',
    'Manage collaborators & permissions (invite contributor / read-only)',
    'Change repository settings & delete repository',
    'Manage branches & protection rules',
    'Push to all branches & merge pull requests',
  ],
  contributor: [
    'Push to branches (write access)',
    'Create pull requests',
    'Create and manage own issues',
    'Comment on pull requests & issues',
  ],
  'read-only': [
    'View repository contents',
    'Clone repository',
    'Comment on issues',
    'View pull requests',
  ],
};

export const ROLE_LEVEL = {
  owner: 0,
  contributor: 1,
  'read-only': 2,
};

/** Roles assignable when inviting (not owner — use transfer on backend). */
export const ASSIGNABLE_ROLES = {
  owner: ['contributor', 'read-only'],
  contributor: [],
  'read-only': [],
};
