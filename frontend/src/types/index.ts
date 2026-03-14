export type Role = 'owner' | 'maintainer' | 'contributor' | 'read-only';

export type CollaboratorStatus = 'pending' | 'accepted' | 'rejected' | 'revoked';

export type RepoVisibility = 'public' | 'private';

export interface User {
  user_id: number;
  username: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Repository {
  repository_id: number;
  owner_id: number;
  name: string;
  description: string | null;
  visibility: RepoVisibility;
  default_branch: string;
  is_initialized: boolean;
  has_readme: boolean;
  license_type: string | null;
  created_at: string;
  updated_at: string;
}

export interface Collaborator {
  collaboration_id: number;
  repository_id: number;
  user_id: number;
  role: Role;
  invited_by: number;
  invited_at: string;
  accepted_at: string | null;
  status: CollaboratorStatus;
  user?: User;
  invited_by_user?: User;
  repository?: Repository;
}

export interface CollabNotification {
  id: number;
  type: 'invitation' | 'role_change' | 'removed' | 'accepted' | 'declined';
  message: string;
  repo_name: string;
  from_username: string;
  created_at: string;
  read: boolean;
  target_user_id: number;
}

export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  owner: [
    'Full repository access',
    'Manage collaborators & permissions',
    'Change repository settings',
    'Delete repository',
    'Manage branches & protection rules',
    'Push to protected branches',
    'Merge pull requests',
  ],
  maintainer: [
    'Push to all branches',
    'Manage branches',
    'Merge pull requests',
    'Invite contributors & read-only users',
    'Manage issues & labels',
  ],
  contributor: [
    'Push to non-protected branches',
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

export const ROLE_LEVEL: Record<Role, number> = {
  owner: 0,
  maintainer: 1,
  contributor: 2,
  'read-only': 3,
};

export const ASSIGNABLE_ROLES: Record<Role, Role[]> = {
  owner: ['maintainer', 'contributor', 'read-only'],
  maintainer: ['contributor', 'read-only'],
  contributor: [],
  'read-only': [],
};
