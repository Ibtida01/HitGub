let nextCollabId = 20;
let nextNotifId = 20;
let nextRepoId = 10;
let nextBranchId = 30;

export function getNextCollabId() {
  return nextCollabId++;
}
export function getNextNotifId() {
  return nextNotifId++;
}

export function getNextRepoId() {
  return nextRepoId++;
}

export function getNextBranchId() {
  return nextBranchId++;
}

export const mockUsers = [
  { user_id: 1, username: 'shakshor', email: 'shakshor@example.com', full_name: 'Sadik Mahamud Shakshor', avatar_url: null, is_active: true, created_at: '2025-01-01T00:00:00Z' },
  { user_id: 2, username: 'sakif', email: 'sakif@example.com', full_name: 'Sakif Naieb Raiyan', avatar_url: null, is_active: true, created_at: '2025-01-02T00:00:00Z' },
  { user_id: 3, username: 'masfi', email: 'masfi@example.com', full_name: 'Sayaad Muzahid Masfi', avatar_url: null, is_active: true, created_at: '2025-01-03T00:00:00Z' },
  { user_id: 4, username: 'aurchi', email: 'aurchi@example.com', full_name: 'Aurchi Chowdhury', avatar_url: null, is_active: true, created_at: '2025-01-04T00:00:00Z' },
  { user_id: 5, username: 'ibtida', email: 'ibtida@example.com', full_name: 'Ibtida bin Ahmed', avatar_url: null, is_active: true, created_at: '2025-01-05T00:00:00Z' },
  { user_id: 6, username: 'saif', email: 'saif@example.com', full_name: 'Saif uz Zaman', avatar_url: null, is_active: true, created_at: '2025-01-06T00:00:00Z' },
];

export const mockRepositories = [
  { repository_id: 1, owner_id: 1, name: 'github-clone', description: 'Repository management and collaboration system', visibility: 'public', default_branch: 'main', is_initialized: true, has_readme: true, license_type: null, created_at: '2025-06-01T00:00:00Z', updated_at: '2025-06-01T00:00:00Z' },
  { repository_id: 2, owner_id: 1, name: 'demo-project', description: 'A demo project for testing', visibility: 'private', default_branch: 'main', is_initialized: true, has_readme: false, license_type: null, created_at: '2025-06-05T00:00:00Z', updated_at: '2025-06-05T00:00:00Z' },
  { repository_id: 3, owner_id: 2, name: 'sakif-portfolio', description: 'Personal portfolio website', visibility: 'public', default_branch: 'main', is_initialized: true, has_readme: true, license_type: null, created_at: '2025-06-10T00:00:00Z', updated_at: '2025-06-10T00:00:00Z' },
];

export const mockBranches = [
  { branch_id: 1, repository_id: 1, name: 'main', is_protected: true, is_default: true, created_by: 1, created_at: '2025-06-01T00:00:00Z', last_commit_hash: 'a'.repeat(40), last_commit_at: '2025-06-22T13:10:00Z' },
  { branch_id: 2, repository_id: 1, name: 'develop', is_protected: false, is_default: false, created_by: 1, created_at: '2025-06-03T00:00:00Z', last_commit_hash: 'b'.repeat(40), last_commit_at: '2025-06-20T11:00:00Z' },
  { branch_id: 3, repository_id: 1, name: 'feature/auth-ui', is_protected: false, is_default: false, created_by: 3, created_at: '2025-06-07T00:00:00Z', last_commit_hash: 'c'.repeat(40), last_commit_at: '2025-06-18T16:45:00Z' },
  { branch_id: 4, repository_id: 2, name: 'main', is_protected: false, is_default: true, created_by: 1, created_at: '2025-06-05T00:00:00Z', last_commit_hash: 'd'.repeat(40), last_commit_at: '2025-06-17T09:00:00Z' },
  { branch_id: 5, repository_id: 2, name: 'release/v1', is_protected: true, is_default: false, created_by: 1, created_at: '2025-06-08T00:00:00Z', last_commit_hash: 'e'.repeat(40), last_commit_at: '2025-06-19T15:00:00Z' },
  { branch_id: 6, repository_id: 3, name: 'main', is_protected: true, is_default: true, created_by: 2, created_at: '2025-06-10T00:00:00Z', last_commit_hash: 'f'.repeat(40), last_commit_at: '2025-06-21T12:25:00Z' },
];

export const mockCollaborators = [
  { collaboration_id: 1, repository_id: 1, user_id: 1, role: 'owner', invited_by: 1, invited_at: '2025-06-01T00:00:00Z', accepted_at: '2025-06-01T00:00:00Z', status: 'accepted' },
  { collaboration_id: 2, repository_id: 1, user_id: 2, role: 'contributor', invited_by: 1, invited_at: '2025-06-02T00:00:00Z', accepted_at: '2025-06-02T12:00:00Z', status: 'accepted' },
  { collaboration_id: 3, repository_id: 1, user_id: 3, role: 'contributor', invited_by: 1, invited_at: '2025-06-03T00:00:00Z', accepted_at: '2025-06-03T08:00:00Z', status: 'accepted' },
  { collaboration_id: 4, repository_id: 1, user_id: 4, role: 'contributor', invited_by: 1, invited_at: '2025-06-04T00:00:00Z', accepted_at: null, status: 'pending' },
  { collaboration_id: 5, repository_id: 1, user_id: 5, role: 'read-only', invited_by: 1, invited_at: '2025-06-05T00:00:00Z', accepted_at: '2025-06-05T15:00:00Z', status: 'accepted' },
  { collaboration_id: 6, repository_id: 2, user_id: 1, role: 'owner', invited_by: 1, invited_at: '2025-06-05T00:00:00Z', accepted_at: '2025-06-05T00:00:00Z', status: 'accepted' },
  { collaboration_id: 7, repository_id: 2, user_id: 3, role: 'contributor', invited_by: 1, invited_at: '2025-06-06T00:00:00Z', accepted_at: '2025-06-06T10:00:00Z', status: 'accepted' },
  { collaboration_id: 8, repository_id: 3, user_id: 2, role: 'owner', invited_by: 2, invited_at: '2025-06-10T00:00:00Z', accepted_at: '2025-06-10T00:00:00Z', status: 'accepted' },
  { collaboration_id: 9, repository_id: 3, user_id: 1, role: 'contributor', invited_by: 2, invited_at: '2025-06-11T00:00:00Z', accepted_at: '2025-06-11T12:00:00Z', status: 'accepted' },
];

export const mockNotifications = [
  { id: 1, type: 'invitation', message: 'You have been invited to collaborate on github-clone', repo_name: 'github-clone', from_username: 'shakshor', created_at: '2025-06-04T00:00:00Z', read: false, target_user_id: 4 },
  { id: 2, type: 'accepted', message: 'masfi accepted your invitation to github-clone', repo_name: 'github-clone', from_username: 'masfi', created_at: '2025-06-03T08:00:00Z', read: false, target_user_id: 1 },
  { id: 3, type: 'role_change', message: 'Your role in github-clone was changed to contributor', repo_name: 'github-clone', from_username: 'shakshor', created_at: '2025-06-02T14:00:00Z', read: true, target_user_id: 2 },
];
