/**
 * Repository Creation and Management API layer.
 *
 * Expected backend routes (when VITE_REPO_USE_MOCK=false):
 * - GET    /repos?scope=member
 * - GET    /repos/deleted
 * - GET    /repos/:repoId
 * - POST   /repos
 * - PATCH  /repos/:repoId
 * - DELETE /repos/:repoId
 * - POST   /repos/:repoId/restore
 * - DELETE /repos/:repoId/permanent
 * - GET    /repos/:repoId/members/me/role
 * - GET    /repos/:repoId/stats
 * - GET    /repos/:repoId/access-summary
 * - GET    /repos/:repoId/branches
 * - POST   /repos/:repoId/branches
 * - PATCH  /repos/:repoId/branches/:branchId/protection
 * - PATCH  /repos/:repoId/branches/:branchId/default
 * - DELETE /repos/:repoId/branches/:branchId
 */

import {
  mockUsers,
  mockRepositories,
  mockCollaborators,
  mockBranches,
  mockBranchCommits,
  mockBranchFiles,
  getNextRepoId,
  getNextBranchId,
  getNextCollabId,
  getNextCommitId,
  getNextFileId,
} from '../mock/data';
import { API_BASE, authHeaders, getAuthToken } from './collabApiConfig';

export const REPO_USE_MOCK = import.meta.env.VITE_REPO_USE_MOCK !== 'false';

const REPO_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const BRANCH_NAME_RE = /^[a-zA-Z0-9/_-]+$/;
const LICENSE_OPTIONS = new Set(['MIT', 'Apache-2.0', 'GPL-3.0', 'BSD-3-Clause', null]);
const RESTORE_WINDOW_DAYS = 30;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const mockBranchDirectories = [];

function repoRole(repoId, userId) {
  const repo = mockRepositories.find((r) => r.repository_id === repoId);
  if (!repo) return null;
  if (repo.owner_id === userId) return 'owner';

  const collab = mockCollaborators.find(
    (c) => c.repository_id === repoId && c.user_id === userId && c.status === 'accepted'
  );
  return collab?.role ?? null;
}

function assertOwner(repoId, actorId, action) {
  const role = repoRole(repoId, actorId);
  if (role !== 'owner') {
    throw new Error(`Only repository owner can ${action}.`);
  }
}

function assertWriteAccess(repoId, actorId, action) {
  const role = repoRole(repoId, actorId);
  if (!role || role === 'read-only') {
    throw new Error(`You do not have write access to ${action}.`);
  }
}

function toRepositoryDTO(repo) {
  const owner = mockUsers.find((u) => u.user_id === repo.owner_id);
  return {
    ...repo,
    owner,
  };
}

function isDeleted(repo) {
  return !!repo.deleted_at;
}

function restoreDeadline(isoDeletedAt) {
  const deleted = new Date(isoDeletedAt);
  deleted.setDate(deleted.getDate() + RESTORE_WINDOW_DAYS);
  return deleted.toISOString();
}

function daysUntil(isoDate) {
  const diff = new Date(isoDate).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

function toBranchDTO(branch) {
  const creator = mockUsers.find((u) => u.user_id === branch.created_by);
  return {
    ...branch,
    created_by_user: creator,
  };
}

function normalizeDirectoryPath(pathValue) {
  if (!pathValue) return '';
  const normalized = String(pathValue).replace(/\\/g, '/').trim().replace(/^\/+|\/+$/g, '');
  if (!normalized) return '';

  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new Error('Invalid path');
  }
  return parts.join('/');
}

function normalizeFilePath(pathValue) {
  const normalized = normalizeDirectoryPath(pathValue);
  if (!normalized) {
    throw new Error('File path is required');
  }
  return normalized;
}

function joinBranchPath(directory, filename) {
  return directory ? `${directory}/${filename}` : filename;
}

function directoryName(pathValue) {
  const normalized = normalizeDirectoryPath(pathValue);
  return normalized.split('/').pop();
}

function iterDirectoryAncestors(pathValue) {
  const normalized = normalizeDirectoryPath(pathValue);
  if (!normalized) return [];
  const parts = normalized.split('/');
  return parts.map((_, idx) => parts.slice(0, idx + 1).join('/'));
}

function touchMockDirectoryHierarchy(repoId, branchId, directoryPath, actorId, commitId, timestamp) {
  const ancestors = iterDirectoryAncestors(directoryPath);
  ancestors.forEach((dirPath) => {
    const existingIdx = mockBranchDirectories.findIndex(
      (d) => d.repository_id === repoId && d.branch_id === branchId && d.path === dirPath
    );

    const record = {
      directory_id:
        existingIdx >= 0
          ? mockBranchDirectories[existingIdx].directory_id
          : `dir-${repoId}-${branchId}-${dirPath}`,
      repository_id: repoId,
      branch_id: branchId,
      path: dirPath,
      name: directoryName(dirPath),
      created_by:
        existingIdx >= 0 ? mockBranchDirectories[existingIdx].created_by : actorId,
      last_touched_by: actorId,
      commit_id: commitId,
      created_at:
        existingIdx >= 0 ? mockBranchDirectories[existingIdx].created_at : timestamp,
      updated_at: timestamp,
    };

    if (existingIdx >= 0) {
      mockBranchDirectories[existingIdx] = record;
    } else {
      mockBranchDirectories.push(record);
    }
  });
}

function extractUploadDescriptor(entry) {
  if (entry && typeof entry === 'object' && entry.file) {
    return {
      file: entry.file,
      relativePath: entry.relativePath || '',
    };
  }

  const file = entry;
  const relativePath = file?.webkitRelativePath || '';
  return { file, relativePath };
}

function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64 || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function buildBranchEntries(fileRows, directoryRows, currentPath) {
  const directoryEntries = new Map();
  const fileEntries = [];
  const prefix = currentPath ? `${currentPath}/` : '';
  const commitById = new Map(mockBranchCommits.map((c) => [c.commit_id, c.message]));

  const touchDirectory = (directoryPath, metadata = {}) => {
    const existing = directoryEntries.get(directoryPath);
    const payload = {
      type: 'dir',
      name: directoryName(directoryPath),
      path: directoryPath,
      updated_at: metadata.updated_at ?? null,
      commit_message: metadata.commit_message ?? null,
    };

    if (!existing) {
      directoryEntries.set(directoryPath, payload);
      return;
    }

    if (
      payload.updated_at &&
      (!existing.updated_at || new Date(payload.updated_at).getTime() > new Date(existing.updated_at).getTime())
    ) {
      directoryEntries.set(directoryPath, payload);
    }
  };

  directoryRows.forEach((row) => {
    const fullPath = row.path;
    if (currentPath && !fullPath.startsWith(prefix)) {
      return;
    }

    const relativePath = currentPath ? fullPath.slice(prefix.length) : fullPath;
    if (!relativePath) {
      return;
    }

    if (relativePath.includes('/')) {
      const dirname = relativePath.split('/')[0];
      const directoryPath = joinBranchPath(currentPath, dirname);
      touchDirectory(directoryPath);
      return;
    }

    touchDirectory(fullPath, {
      updated_at: row.updated_at,
      commit_message: row.commit_message || commitById.get(row.commit_id) || null,
    });
  });

  fileRows.forEach((row) => {
    const fullPath = row.path;
    if (currentPath && !fullPath.startsWith(prefix)) {
      return;
    }

    const relativePath = currentPath ? fullPath.slice(prefix.length) : fullPath;
    if (!relativePath) {
      return;
    }

    if (relativePath.includes('/')) {
      const dirname = relativePath.split('/')[0];
      const directoryPath = joinBranchPath(currentPath, dirname);
      touchDirectory(directoryPath);
      return;
    }

    fileEntries.push({
      type: 'file',
      file_id: row.file_id,
      name: row.filename,
      path: row.path,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      updated_at: row.updated_at,
      uploaded_by: row.uploaded_by,
      commit_id: row.commit_id,
      commit_message: row.commit_message || commitById.get(row.commit_id) || null,
    });
  });

  const directories = [...directoryEntries.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const files = fileEntries.sort((a, b) => a.name.localeCompare(b.name));
  return [...directories, ...files];
}

function repositoryStats(repoId) {
  const branches = mockBranches.filter((b) => b.repository_id === repoId);
  const accepted = mockCollaborators.filter(
    (c) => c.repository_id === repoId && c.status === 'accepted'
  );
  const pending = mockCollaborators.filter(
    (c) => c.repository_id === repoId && c.status === 'pending'
  );

  return {
    repository_id: repoId,
    branch_count: branches.length,
    protected_branch_count: branches.filter((b) => b.is_protected).length,
    collaborator_count: accepted.length,
    pending_invitation_count: pending.length,
  };
}

function accessSummary(repoId) {
  const rows = mockCollaborators.filter((c) => c.repository_id === repoId);
  return {
    repository_id: repoId,
    by_role: {
      owner: rows.filter((r) => r.role === 'owner' && r.status === 'accepted').length,
      contributor: rows.filter((r) => r.role === 'contributor' && r.status === 'accepted').length,
      'read-only': rows.filter((r) => r.role === 'read-only' && r.status === 'accepted').length,
    },
    by_status: {
      pending: rows.filter((r) => r.status === 'pending').length,
      accepted: rows.filter((r) => r.status === 'accepted').length,
      rejected: rows.filter((r) => r.status === 'rejected').length,
      revoked: rows.filter((r) => r.status === 'revoked').length,
    },
  };
}

export const repoApi = {
  async listRepositoriesForUser(userId) {
    if (!REPO_USE_MOCK) {
      const res = await fetch(`${API_BASE}/repos?scope=member`, { headers: authHeaders() });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }

    await delay(220);
    const memberRepoIds = new Set(
      mockCollaborators
        .filter((c) => c.user_id === userId && c.status === 'accepted')
        .map((c) => c.repository_id)
    );

    return mockRepositories
      .filter(
        (repo) =>
          (repo.owner_id === userId || memberRepoIds.has(repo.repository_id)) && !isDeleted(repo)
      )
      .map(toRepositoryDTO)
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async listOwnedRepositories(userId) {
    if (!REPO_USE_MOCK) {
      const res = await fetch(`${API_BASE}/repos?scope=owned`, { headers: authHeaders() });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }

    await delay(160);
    return mockRepositories
      .filter((repo) => repo.owner_id === userId && !isDeleted(repo))
      .map(toRepositoryDTO)
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async listDiscoverableRepositories(userId, query = '') {
    if (!REPO_USE_MOCK) {
      const params = new URLSearchParams({ scope: 'discover' });
      const trimmed = String(query || '').trim();
      if (trimmed) {
        params.set('q', trimmed);
      }
      const res = await fetch(`${API_BASE}/repos?${params.toString()}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }

    await delay(180);
    const trimmed = String(query || '').trim().toLowerCase();

    return mockRepositories
      .filter((repo) => {
        if (isDeleted(repo)) return false;

        const role = repoRole(repo.repository_id, userId);
        const canSee = repo.visibility === 'public' || !!role;
        if (!canSee) return false;

        if (!trimmed) return true;
        const owner = mockUsers.find((u) => u.user_id === repo.owner_id);
        const haystack = [repo.name, repo.description || '', owner?.username || '']
          .join(' ')
          .toLowerCase();
        return haystack.includes(trimmed);
      })
      .map(toRepositoryDTO)
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async listDeletedRepositoriesForUser(userId) {
    if (!REPO_USE_MOCK) {
      const res = await fetch(`${API_BASE}/repos/deleted`, { headers: authHeaders() });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }

    await delay(180);
    return mockRepositories
      .filter((repo) => repo.owner_id === userId && isDeleted(repo))
      .map((repo) => ({
        ...toRepositoryDTO(repo),
        restore_deadline: repo.restore_deadline || restoreDeadline(repo.deleted_at),
        days_left: daysUntil(repo.restore_deadline || restoreDeadline(repo.deleted_at)),
      }))
      .sort((a, b) => new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime());
  },

  async getRepository(repoId) {
    if (!REPO_USE_MOCK) {
      const res = await fetch(`${API_BASE}/repos/${repoId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }

    await delay(150);
    const repo = mockRepositories.find((r) => r.repository_id === repoId);
    if (repo && isDeleted(repo)) {
      throw new Error('Repository is in trash. Restore it first.');
    }
    if (!repo) throw new Error('Repository not found');
    return toRepositoryDTO(repo);
  },

  async createRepository(ownerId, payload) {
    if (!REPO_USE_MOCK) {
      const res = await fetch(`${API_BASE}/repos`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }

    await delay(450);
    const name = (payload.name || '').trim();
    if (!REPO_NAME_RE.test(name)) {
      throw new Error('Repository name can contain only letters, numbers, underscore, and hyphen.');
    }

    const duplicate = mockRepositories.find(
      (r) => r.owner_id === ownerId && r.name.toLowerCase() === name.toLowerCase() && !isDeleted(r)
    );
    if (duplicate) {
      throw new Error('Repository with this name already exists for this owner.');
    }

    const now = new Date().toISOString();
    const repo = {
      repository_id: getNextRepoId(),
      owner_id: ownerId,
      name,
      description: payload.description?.trim() || null,
      visibility: payload.visibility === 'private' ? 'private' : 'public',
      default_branch: payload.default_branch?.trim() || 'main',
      is_initialized: payload.initialize_with_readme !== false,
      has_readme: payload.initialize_with_readme !== false,
      license_type: LICENSE_OPTIONS.has(payload.license_type) ? payload.license_type : null,
      created_at: now,
      updated_at: now,
    };

    mockRepositories.push(repo);

    mockCollaborators.push({
      collaboration_id: getNextCollabId(),
      repository_id: repo.repository_id,
      user_id: ownerId,
      role: 'owner',
      invited_by: ownerId,
      invited_at: now,
      accepted_at: now,
      status: 'accepted',
    });

    mockBranches.push({
      branch_id: getNextBranchId(),
      repository_id: repo.repository_id,
      name: repo.default_branch,
      is_protected: false,
      is_default: true,
      created_by: ownerId,
      created_at: now,
      last_commit_hash: null,
      last_commit_at: null,
    });

    return toRepositoryDTO(repo);
  },

  async updateRepository(repoId, payload, actorId) {
    if (!REPO_USE_MOCK) {
      const res = await fetch(`${API_BASE}/repos/${repoId}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }

    await delay(380);
    assertOwner(repoId, actorId, 'update repository settings');

    const repo = mockRepositories.find((r) => r.repository_id === repoId);
    if (!repo) throw new Error('Repository not found');
    if (isDeleted(repo)) {
      throw new Error('Cannot update a deleted repository. Restore it first.');
    }

    if (payload.name !== undefined) {
      const name = payload.name.trim();
      if (!REPO_NAME_RE.test(name)) {
        throw new Error('Repository name can contain only letters, numbers, underscore, and hyphen.');
      }
      const duplicate = mockRepositories.find(
        (r) =>
          r.repository_id !== repoId &&
          r.owner_id === repo.owner_id &&
          r.name.toLowerCase() === name.toLowerCase()
      );
      if (duplicate) {
        throw new Error('Repository with this name already exists for this owner.');
      }
      repo.name = name;
    }

    if (payload.description !== undefined) {
      repo.description = payload.description?.trim() || null;
    }

    if (payload.visibility !== undefined) {
      repo.visibility = payload.visibility === 'private' ? 'private' : 'public';
    }

    if (payload.license_type !== undefined) {
      repo.license_type = LICENSE_OPTIONS.has(payload.license_type) ? payload.license_type : null;
    }

    if (payload.has_readme !== undefined) {
      repo.has_readme = !!payload.has_readme;
      repo.is_initialized = repo.has_readme || repo.is_initialized;
    }

    if (payload.default_branch !== undefined) {
      const target = mockBranches.find(
        (b) => b.repository_id === repoId && b.name === payload.default_branch
      );
      if (!target) {
        throw new Error('Default branch must exist in this repository.');
      }
      mockBranches
        .filter((b) => b.repository_id === repoId)
        .forEach((b) => {
          b.is_default = b.branch_id === target.branch_id;
        });
      repo.default_branch = payload.default_branch;
    }

    repo.updated_at = new Date().toISOString();
    return toRepositoryDTO(repo);
  },

  async deleteRepository(repoId, actorId) {
    if (!REPO_USE_MOCK) {
      const res = await fetch(`${API_BASE}/repos/${repoId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      return;
    }

    await delay(450);
    assertOwner(repoId, actorId, 'move this repository to trash');

    const repo = mockRepositories.find((r) => r.repository_id === repoId);
    if (!repo) throw new Error('Repository not found');
    if (isDeleted(repo)) {
      throw new Error('Repository is already in trash.');
    }

    const now = new Date().toISOString();
    repo.deleted_at = now;
    repo.restore_deadline = restoreDeadline(now);
    repo.updated_at = now;
  },

  async restoreRepository(repoId, actorId) {
    if (!REPO_USE_MOCK) {
      const res = await fetch(`${API_BASE}/repos/${repoId}/restore`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }

    await delay(260);
    assertOwner(repoId, actorId, 'restore this repository');

    const repo = mockRepositories.find((r) => r.repository_id === repoId);
    if (!repo) throw new Error('Repository not found');
    if (!isDeleted(repo)) {
      throw new Error('Repository is not in trash.');
    }

    if (daysUntil(repo.restore_deadline || restoreDeadline(repo.deleted_at)) <= 0) {
      throw new Error('Restore window has expired. Permanently delete this repository.');
    }

    repo.deleted_at = null;
    repo.restore_deadline = null;
    repo.updated_at = new Date().toISOString();
    return toRepositoryDTO(repo);
  },

  async permanentlyDeleteRepository(repoId, actorId) {
    if (!REPO_USE_MOCK) {
      const res = await fetch(`${API_BASE}/repos/${repoId}/permanent`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      return;
    }

    await delay(360);
    assertOwner(repoId, actorId, 'permanently delete this repository');

    const repoIdx = mockRepositories.findIndex((r) => r.repository_id === repoId);
    if (repoIdx === -1) throw new Error('Repository not found');
    if (!isDeleted(mockRepositories[repoIdx])) {
      throw new Error('Move repository to trash first.');
    }
    mockRepositories.splice(repoIdx, 1);

    for (let i = mockBranches.length - 1; i >= 0; i -= 1) {
      if (mockBranches[i].repository_id === repoId) {
        mockBranches.splice(i, 1);
      }
    }

    for (let i = mockCollaborators.length - 1; i >= 0; i -= 1) {
      if (mockCollaborators[i].repository_id === repoId) {
        mockCollaborators.splice(i, 1);
      }
    }
  },

  async getRepositoryRole(repoId, userId) {
    if (!REPO_USE_MOCK) {
      const res = await fetch(`${API_BASE}/repos/${repoId}/members/me/role`, {
        headers: authHeaders(),
      });
      if (res.status === 403 || res.status === 404) return null;
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      return data.role || null;
    }

    await delay(110);
    const repo = mockRepositories.find((r) => r.repository_id === repoId);
    if (repo && isDeleted(repo)) return null;
    return repoRole(repoId, userId);
  },

  async getRepositoryStats(repoId) {
    if (!REPO_USE_MOCK) {
      const res = await fetch(`${API_BASE}/repos/${repoId}/stats`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }

    await delay(150);
    const repo = mockRepositories.find((r) => r.repository_id === repoId);
    if (repo && isDeleted(repo)) {
      throw new Error('Repository is in trash.');
    }
    return repositoryStats(repoId);
  },

  async getAccessSummary(repoId) {
    if (!REPO_USE_MOCK) {
      const res = await fetch(`${API_BASE}/repos/${repoId}/access-summary`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }

    await delay(130);
    const repo = mockRepositories.find((r) => r.repository_id === repoId);
    if (repo && isDeleted(repo)) {
      throw new Error('Repository is in trash.');
    }
    return accessSummary(repoId);
  },

  async getBranches(repoId) {
    if (!REPO_USE_MOCK) {
      const res = await fetch(`${API_BASE}/repos/${repoId}/branches`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }

    await delay(260);
    const repo = mockRepositories.find((r) => r.repository_id === repoId);
    if (repo && isDeleted(repo)) {
      throw new Error('Repository is in trash.');
    }
    return mockBranches
      .filter((b) => b.repository_id === repoId)
      .map(toBranchDTO)
      .sort((a, b) => {
        if (a.is_default) return -1;
        if (b.is_default) return 1;
        return a.name.localeCompare(b.name);
      });
  },

  async createBranch(repoId, payload, actorId) {
    if (!REPO_USE_MOCK) {
      const res = await fetch(`${API_BASE}/repos/${repoId}/branches`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }

    await delay(320);
    const repo = mockRepositories.find((r) => r.repository_id === repoId);
    if (repo && isDeleted(repo)) {
      throw new Error('Repository is in trash. Restore it first.');
    }
    assertWriteAccess(repoId, actorId, 'create a branch');

    const name = (payload.name || '').trim();
    if (!BRANCH_NAME_RE.test(name)) {
      throw new Error('Branch name can contain only letters, numbers, slash, underscore, and hyphen.');
    }

    const duplicate = mockBranches.find(
      (b) => b.repository_id === repoId && b.name.toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      throw new Error('Branch with this name already exists.');
    }

    const now = new Date().toISOString();
    const branch = {
      branch_id: getNextBranchId(),
      repository_id: repoId,
      name,
      is_protected: false,
      is_default: false,
      created_by: actorId,
      created_at: now,
      last_commit_hash: null,
      last_commit_at: null,
    };
    mockBranches.push(branch);
    return toBranchDTO(branch);
  },

  async updateBranchProtection(repoId, branchId, isProtected, actorId) {
    if (!REPO_USE_MOCK) {
      const res = await fetch(`${API_BASE}/repos/${repoId}/branches/${branchId}/protection`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ is_protected: isProtected }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }

    await delay(210);
    const repo = mockRepositories.find((r) => r.repository_id === repoId);
    if (repo && isDeleted(repo)) {
      throw new Error('Repository is in trash. Restore it first.');
    }
    assertOwner(repoId, actorId, 'change branch protection');

    const branch = mockBranches.find(
      (b) => b.repository_id === repoId && b.branch_id === branchId
    );
    if (!branch) throw new Error('Branch not found');

    branch.is_protected = !!isProtected;
    return toBranchDTO(branch);
  },

  async setDefaultBranch(repoId, branchId, actorId) {
    if (!REPO_USE_MOCK) {
      const res = await fetch(`${API_BASE}/repos/${repoId}/branches/${branchId}/default`, {
        method: 'PATCH',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }

    await delay(220);
    const repo = mockRepositories.find((r) => r.repository_id === repoId);
    if (repo && isDeleted(repo)) {
      throw new Error('Repository is in trash. Restore it first.');
    }
    assertOwner(repoId, actorId, 'set default branch');

    const branch = mockBranches.find(
      (b) => b.repository_id === repoId && b.branch_id === branchId
    );
    if (!branch) throw new Error('Branch not found');

    mockBranches
      .filter((b) => b.repository_id === repoId)
      .forEach((b) => {
        b.is_default = b.branch_id === branchId;
      });

    if (repo) {
      repo.default_branch = branch.name;
      repo.updated_at = new Date().toISOString();
    }

    return toBranchDTO(branch);
  },

  async deleteBranch(repoId, branchId, actorId) {
    if (!REPO_USE_MOCK) {
      const res = await fetch(`${API_BASE}/repos/${repoId}/branches/${branchId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      return;
    }

    await delay(260);
    const repo = mockRepositories.find((r) => r.repository_id === repoId);
    if (repo && isDeleted(repo)) {
      throw new Error('Repository is in trash. Restore it first.');
    }
    assertOwner(repoId, actorId, 'delete branch');

    const idx = mockBranches.findIndex(
      (b) => b.repository_id === repoId && b.branch_id === branchId
    );
    if (idx === -1) throw new Error('Branch not found');
    if (mockBranches[idx].is_default) {
      throw new Error('Cannot delete the default branch.');
    }

    mockBranches.splice(idx, 1);
  },

  async listBranchFiles(repoId, branchId, path = '') {
    if (!REPO_USE_MOCK) {
      const query = new URLSearchParams({ path });
      const res = await fetch(`${API_BASE}/repos/${repoId}/branches/${branchId}/files?${query.toString()}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }

    await delay(180);
    const currentPath = normalizeDirectoryPath(path);
    const fileRows = mockBranchFiles.filter(
      (f) => f.repository_id === repoId && f.branch_id === branchId
    );
    const directoryRows = mockBranchDirectories.filter(
      (d) => d.repository_id === repoId && d.branch_id === branchId
    );

    return {
      repository_id: repoId,
      branch_id: branchId,
      path: currentPath,
      entries: buildBranchEntries(fileRows, directoryRows, currentPath),
    };
  },

  async uploadBranchFiles(repoId, branchId, payload, actorId) {
    const commitMessage = (payload?.commitMessage || '').trim();
    if (!commitMessage) {
      throw new Error('Commit message is required.');
    }
    const selectedFiles = payload?.files || [];
    if (!selectedFiles.length) {
      throw new Error('Select at least one file to upload.');
    }

    const uploadDescriptors = selectedFiles.map(extractUploadDescriptor);
    if (uploadDescriptors.some((entry) => !entry.file)) {
      throw new Error('Invalid file selection.');
    }

    if (!REPO_USE_MOCK) {
      const formData = new FormData();
      formData.append('commit_message', commitMessage);
      if (payload?.targetPath) {
        formData.append('target_path', payload.targetPath);
      }
      const relativePaths = [];
      uploadDescriptors.forEach(({ file, relativePath }) => {
        formData.append('files', file);
        relativePaths.push(relativePath || '');
      });
      if (relativePaths.some((pathValue) => !!pathValue)) {
        formData.append('relative_paths', JSON.stringify(relativePaths));
      }

      const token = getAuthToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${API_BASE}/repos/${repoId}/branches/${branchId}/files/upload`, {
        method: 'POST',
        headers,
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }

    await delay(280);
    assertWriteAccess(repoId, actorId, 'upload files');

    const directory = normalizeDirectoryPath(payload?.targetPath || '');
    const branch = mockBranches.find(
      (b) => b.repository_id === repoId && b.branch_id === branchId
    );
    if (!branch) {
      throw new Error('Branch not found');
    }

    const now = new Date().toISOString();
    const commit = {
      commit_id: getNextCommitId(),
      repository_id: repoId,
      branch_id: branchId,
      author_id: actorId,
      message: commitMessage,
      created_at: now,
    };
    mockBranchCommits.push(commit);

    const changedFiles = [];
    for (const descriptor of uploadDescriptors) {
      const file = descriptor.file;
      const normalizedRelativePath = descriptor.relativePath
        ? normalizeFilePath(descriptor.relativePath)
        : '';

      let directory = normalizeDirectoryPath(payload?.targetPath || '');
      let fileName = (file?.name || '').split('/').pop();

      if (normalizedRelativePath) {
        const slashIdx = normalizedRelativePath.lastIndexOf('/');
        const relDirectory = slashIdx >= 0 ? normalizedRelativePath.slice(0, slashIdx) : '';
        fileName = slashIdx >= 0 ? normalizedRelativePath.slice(slashIdx + 1) : normalizedRelativePath;
        directory = normalizeDirectoryPath(joinBranchPath(directory, relDirectory));
      }

      if (!fileName) {
        throw new Error('Invalid file name');
      }
      const fullPath = joinBranchPath(directory, fileName);
      const bytes = new Uint8Array(await file.arrayBuffer());

      if (directory) {
        touchMockDirectoryHierarchy(
          repoId,
          branchId,
          directory,
          actorId,
          commit.commit_id,
          now
        );
      }

      const existingIdx = mockBranchFiles.findIndex(
        (f) => f.repository_id === repoId && f.branch_id === branchId && f.path === fullPath
      );

      const record = {
        file_id: existingIdx >= 0 ? mockBranchFiles[existingIdx].file_id : getNextFileId(),
        repository_id: repoId,
        branch_id: branchId,
        path: fullPath,
        filename: fileName,
        mime_type: file.type || 'application/octet-stream',
        size_bytes: bytes.byteLength,
        content_base64: bytesToBase64(bytes),
        uploaded_by: actorId,
        commit_id: commit.commit_id,
        created_at: existingIdx >= 0 ? mockBranchFiles[existingIdx].created_at : now,
        updated_at: now,
      };

      if (existingIdx >= 0) {
        mockBranchFiles[existingIdx] = record;
      } else {
        mockBranchFiles.push(record);
      }

      changedFiles.push({
        file_id: record.file_id,
        path: record.path,
        filename: record.filename,
        mime_type: record.mime_type,
        size_bytes: record.size_bytes,
        updated_at: record.updated_at,
      });
    }

    return {
      repository_id: repoId,
      branch_id: branchId,
      commit: {
        commit_id: commit.commit_id,
        message: commit.message,
        author_id: commit.author_id,
        created_at: commit.created_at,
      },
      changed_files: changedFiles,
    };
  },

  async createBranchFolder(repoId, branchId, payload, actorId) {
    const folderPath = normalizeDirectoryPath(payload?.folderPath || '');
    const commitMessage = (payload?.commitMessage || '').trim();

    if (!folderPath) {
      throw new Error('Folder path is required.');
    }
    if (!commitMessage) {
      throw new Error('Commit message is required.');
    }

    if (!REPO_USE_MOCK) {
      const res = await fetch(`${API_BASE}/repos/${repoId}/branches/${branchId}/folders`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ folder_path: folderPath, commit_message: commitMessage }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }

    await delay(220);
    assertWriteAccess(repoId, actorId, 'create a folder');

    const now = new Date().toISOString();
    const commit = {
      commit_id: getNextCommitId(),
      repository_id: repoId,
      branch_id: branchId,
      author_id: actorId,
      message: commitMessage,
      created_at: now,
    };
    mockBranchCommits.push(commit);

    touchMockDirectoryHierarchy(repoId, branchId, folderPath, actorId, commit.commit_id, now);

    return {
      repository_id: repoId,
      branch_id: branchId,
      directory: {
        path: folderPath,
        name: directoryName(folderPath),
        updated_at: now,
        commit_id: commit.commit_id,
      },
      commit,
    };
  },

  async deleteBranchFile(repoId, branchId, filePath, commitMessage = '', actorId = null) {
    const normalizedPath = normalizeFilePath(filePath);
    const message = String(commitMessage || '').trim();

    if (!REPO_USE_MOCK) {
      const query = new URLSearchParams({ path: normalizedPath });
      if (message) {
        query.set('commit_message', message);
      }
      const res = await fetch(
        `${API_BASE}/repos/${repoId}/branches/${branchId}/files?${query.toString()}`,
        {
          method: 'DELETE',
          headers: authHeaders(),
        }
      );
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }

    await delay(180);
    assertWriteAccess(repoId, actorId, 'delete files');
    const fileIdx = mockBranchFiles.findIndex(
      (f) => f.repository_id === repoId && f.branch_id === branchId && f.path === normalizedPath
    );
    if (fileIdx < 0) {
      throw new Error('File not found');
    }

    const now = new Date().toISOString();
    const commit = {
      commit_id: getNextCommitId(),
      repository_id: repoId,
      branch_id: branchId,
      author_id: actorId ?? 0,
      message: message || `Delete file ${normalizedPath}`,
      created_at: now,
    };
    mockBranchCommits.push(commit);

    const deleted = mockBranchFiles[fileIdx];
    mockBranchFiles.splice(fileIdx, 1);

    return {
      detail: 'File deleted',
      repository_id: repoId,
      branch_id: branchId,
      deleted_file: {
        file_id: deleted.file_id,
        path: deleted.path,
        filename: deleted.filename,
      },
      commit,
    };
  },

  async deleteBranchFolder(repoId, branchId, folderPath, commitMessage = '', actorId = null) {
    const normalizedPath = normalizeDirectoryPath(folderPath);
    if (!normalizedPath) {
      throw new Error('Folder path is required.');
    }

    const message = String(commitMessage || '').trim();

    if (!REPO_USE_MOCK) {
      const query = new URLSearchParams({ path: normalizedPath });
      if (message) {
        query.set('commit_message', message);
      }
      const res = await fetch(
        `${API_BASE}/repos/${repoId}/branches/${branchId}/folders?${query.toString()}`,
        {
          method: 'DELETE',
          headers: authHeaders(),
        }
      );
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }

    await delay(220);
    assertWriteAccess(repoId, actorId, 'delete folders');
    const prefix = `${normalizedPath}/`;
    let deletedFiles = 0;
    for (let i = mockBranchFiles.length - 1; i >= 0; i -= 1) {
      const row = mockBranchFiles[i];
      if (
        row.repository_id === repoId &&
        row.branch_id === branchId &&
        (row.path === normalizedPath || row.path.startsWith(prefix))
      ) {
        mockBranchFiles.splice(i, 1);
        deletedFiles += 1;
      }
    }

    let deletedFolders = 0;
    for (let i = mockBranchDirectories.length - 1; i >= 0; i -= 1) {
      const row = mockBranchDirectories[i];
      if (
        row.repository_id === repoId &&
        row.branch_id === branchId &&
        (row.path === normalizedPath || row.path.startsWith(prefix))
      ) {
        mockBranchDirectories.splice(i, 1);
        deletedFolders += 1;
      }
    }

    if (deletedFiles === 0 && deletedFolders === 0) {
      throw new Error('Folder not found');
    }

    const now = new Date().toISOString();
    const commit = {
      commit_id: getNextCommitId(),
      repository_id: repoId,
      branch_id: branchId,
      author_id: actorId ?? 0,
      message: message || `Delete folder ${normalizedPath}`,
      created_at: now,
    };
    mockBranchCommits.push(commit);

    return {
      detail: 'Folder deleted',
      repository_id: repoId,
      branch_id: branchId,
      path: normalizedPath,
      deleted_files: deletedFiles,
      deleted_folders: deletedFolders,
      commit,
    };
  },

  async downloadBranchFile(repoId, branchId, filePath) {
    if (!REPO_USE_MOCK) {
      const query = new URLSearchParams({ path: filePath });
      const res = await fetch(
        `${API_BASE}/repos/${repoId}/branches/${branchId}/files/raw?${query.toString()}`,
        {
          headers: authHeaders(),
        }
      );
      if (!res.ok) throw new Error(await res.text());
      return res.blob();
    }

    await delay(120);
    const normalizedPath = normalizeFilePath(filePath);
    const row = mockBranchFiles.find(
      (f) =>
        f.repository_id === repoId && f.branch_id === branchId && f.path === normalizedPath
    );
    if (!row) {
      throw new Error('File not found');
    }

    const bytes = base64ToBytes(row.content_base64);
    return new Blob([bytes], { type: row.mime_type || 'application/octet-stream' });
  },

  async downloadBranchFolder(repoId, branchId, folderPath) {
    if (!REPO_USE_MOCK) {
      const query = new URLSearchParams({ path: folderPath });
      const res = await fetch(
        `${API_BASE}/repos/${repoId}/branches/${branchId}/folders/raw?${query.toString()}`,
        {
          headers: authHeaders(),
        }
      );
      if (!res.ok) throw new Error(await res.text());
      return res.blob();
    }

    throw new Error('Folder download is not available in mock mode.');
  },
};
