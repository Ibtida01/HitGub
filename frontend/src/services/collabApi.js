/**
 * Collaborator Management API (mock or HTTP via env).
 * See file header in previous TS version for suggested REST paths.
 */

import {
  mockUsers,
  mockCollaborators,
  mockRepositories,
  mockNotifications,
  getNextCollabId,
  getNextNotifId,
} from '../mock/data';
import { API_BASE, COLLAB_USE_MOCK, authHeaders } from './collabApiConfig';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function buildApiError(status, text, fallbackMessage) {
  let detail = text;

  if (text) {
    try {
      const parsed = JSON.parse(text);
      detail = parsed?.detail ?? parsed;
    } catch {
      // Keep plain-text response as-is.
    }
  }

  let message = fallbackMessage;
  if (typeof detail === 'string' && detail.trim()) {
    message = detail;
  } else if (detail && typeof detail === 'object') {
    if (typeof detail.message === 'string' && detail.message.trim()) {
      message = detail.message;
    } else if (typeof detail.detail === 'string' && detail.detail.trim()) {
      message = detail.detail;
    }
  }

  const err = new Error(message);
  err.status = status;
  err.detail = detail;
  err.raw = text;
  return err;
}

export function mapViewRowToCollaborator(row, options = {}) {
  const { useMockFallback = COLLAB_USE_MOCK } = options;
  const user = {
    user_id: row.user_id,
    username: row.username,
    email: row.email,
    full_name: row.full_name,
    avatar_url: row.avatar_url,
    is_active: true,
    created_at: row.invited_at,
  };
  const invitedByUser = useMockFallback && row.invited_by_username
    ? mockUsers.find((u) => u.username === row.invited_by_username)
    : undefined;
  const invitedBy = row.invited_by ?? invitedByUser?.user_id ?? row.user_id;
  const repository = useMockFallback
    ? mockRepositories.find((r) => r.repository_id === row.repository_id)
    : null;

  return {
    collaboration_id: row.collaboration_id,
    repository_id: row.repository_id,
    user_id: row.user_id,
    role: row.role,
    invited_by: invitedBy,
    invited_at: row.invited_at,
    accepted_at: row.accepted_at,
    status: row.status,
    user,
    invited_by_user: invitedByUser,
    repository:
      repository ?? {
        repository_id: row.repository_id,
        owner_id: 0,
        name: row.repository_name,
        description: null,
        visibility: 'public',
        default_branch: 'main',
        is_initialized: true,
        has_readme: false,
        license_type: null,
        created_at: row.invited_at,
        updated_at: row.invited_at,
      },
  };
}

function populateCollaborator(c, options = {}) {
  const { useMockFallback = COLLAB_USE_MOCK } = options;
  if (!useMockFallback) {
    return c;
  }

  const u = mockUsers.find((x) => x.user_id === c.user_id);
  const inv = mockUsers.find((x) => x.user_id === c.invited_by);
  const repo = mockRepositories.find((r) => r.repository_id === c.repository_id);
  return {
    ...c,
    user: u ?? c.user,
    invited_by_user: inv ?? c.invited_by_user,
    repository: repo ?? c.repository,
  };
}

function assertInviteRole(role) {
  if (role === 'owner') {
    throw new Error('Cannot invite as owner; use repository transfer on the backend.');
  }
}

export const collabApi = {
  async getCollaborators(repoId) {
    if (!COLLAB_USE_MOCK) {
      const res = await fetch(`${API_BASE}/repos/${repoId}/collaborators?status=all`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        const text = await res.text();
        throw buildApiError(res.status, text, `Failed to load collaborators (${res.status})`);
      }
      const payload = await res.json();
      const rows = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.collaborators)
          ? payload.collaborators
          : [];
      return rows.map((row) =>
        populateCollaborator(
          mapViewRowToCollaborator(row, { useMockFallback: false }),
          { useMockFallback: false }
        )
      );
    }
    await delay(300);
    return mockCollaborators
      .filter((c) => c.repository_id === repoId)
      .map(populateCollaborator);
  },

  async inviteCollaborator(repoId, userId, role, invitedBy) {
    assertInviteRole(role);
    if (!COLLAB_USE_MOCK) {
      const res = await fetch(`${API_BASE}/repos/${repoId}/collaborators/invite`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ invitee_id: userId, role }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw buildApiError(res.status, text, 'Failed to send invitation');
      }
      return res.json();
    }
    await delay(500);
    const existing = mockCollaborators.find(
      (c) => c.repository_id === repoId && c.user_id === userId
    );
    if (existing) throw new Error('User is already a collaborator');

    const newCollab = {
      collaboration_id: getNextCollabId(),
      repository_id: repoId,
      user_id: userId,
      role,
      invited_by: invitedBy,
      invited_at: new Date().toISOString(),
      accepted_at: null,
      status: 'pending',
    };
    mockCollaborators.push(newCollab);

    const repo = mockRepositories.find((r) => r.repository_id === repoId);
    const inviter = mockUsers.find((u) => u.user_id === invitedBy);
    mockNotifications.push({
      id: getNextNotifId(),
      type: 'invitation',
      message: `You have been invited to collaborate on ${repo?.name}`,
      repo_name: repo?.name ?? '',
      from_username: inviter?.username ?? '',
      created_at: new Date().toISOString(),
      read: false,
      target_user_id: userId,
    });

    return populateCollaborator(newCollab);
  },

  async updateRole(repoId, userId, newRole) {
    if (newRole === 'owner') {
      throw new Error('Promoting to owner is done via ownership transfer on the backend.');
    }
    if (!COLLAB_USE_MOCK) {
      const res = await fetch(`${API_BASE}/repos/${repoId}/collaborators/${userId}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ new_role: newRole }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw buildApiError(res.status, text, 'Failed to update collaborator role');
      }
      return res.json();
    }
    await delay(300);
    const collab = mockCollaborators.find(
      (c) => c.repository_id === repoId && c.user_id === userId
    );
    if (!collab) throw new Error('Collaborator not found');

    const oldRole = collab.role;
    collab.role = newRole;

    const repo = mockRepositories.find((r) => r.repository_id === collab.repository_id);
    mockNotifications.push({
      id: getNextNotifId(),
      type: 'role_change',
      message: `Your role in ${repo?.name} was changed from ${oldRole} to ${newRole}`,
      repo_name: repo?.name ?? '',
      from_username: '',
      created_at: new Date().toISOString(),
      read: false,
      target_user_id: collab.user_id,
    });

    return populateCollaborator(collab);
  },

  async removeCollaborator(repoId, userId) {
    if (!COLLAB_USE_MOCK) {
      const res = await fetch(`${API_BASE}/repos/${repoId}/collaborators/${userId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const text = await res.text();
        throw buildApiError(res.status, text, 'Failed to remove collaborator');
      }
      return;
    }
    await delay(300);
    const idx = mockCollaborators.findIndex(
      (c) => c.repository_id === repoId && c.user_id === userId
    );
    if (idx === -1) throw new Error('Collaborator not found');

    const collab = mockCollaborators[idx];
    const repo = mockRepositories.find((r) => r.repository_id === collab.repository_id);
    mockNotifications.push({
      id: getNextNotifId(),
      type: 'removed',
      message: `You have been removed from ${repo?.name}`,
      repo_name: repo?.name ?? '',
      from_username: '',
      created_at: new Date().toISOString(),
      read: false,
      target_user_id: collab.user_id,
    });

    mockCollaborators.splice(idx, 1);
  },

  async respondToInvitation(collabOrRepoId, accept, maybeRepoId) {
    if (!COLLAB_USE_MOCK) {
      const repoId = maybeRepoId ?? collabOrRepoId;
      const res = await fetch(`${API_BASE}/repos/${repoId}/collaborators/respond`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ accept }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }
    await delay(400);
    const collabId = collabOrRepoId;
    const collab = mockCollaborators.find((c) => c.collaboration_id === collabId);
    if (!collab) throw new Error('Invitation not found');

    collab.status = accept ? 'accepted' : 'rejected';
    collab.accepted_at = accept ? new Date().toISOString() : null;

    const repo = mockRepositories.find((r) => r.repository_id === collab.repository_id);
    const user = mockUsers.find((u) => u.user_id === collab.user_id);
    mockNotifications.push({
      id: getNextNotifId(),
      type: accept ? 'accepted' : 'declined',
      message: `${user?.username} ${accept ? 'accepted' : 'declined'} your invitation to ${repo?.name}`,
      repo_name: repo?.name ?? '',
      from_username: user?.username ?? '',
      created_at: new Date().toISOString(),
      read: false,
      target_user_id: collab.invited_by,
    });

    return populateCollaborator(collab);
  },

  async searchUsers(query) {
    if (!COLLAB_USE_MOCK) {
      const res = await fetch(
        `${API_BASE}/auth/users/search?q=${encodeURIComponent(query)}`,
        { headers: authHeaders() }
      );
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }
    await delay(200);
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return mockUsers.filter(
      (u) =>
        u.is_active &&
        (u.username.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          (u.full_name && u.full_name.toLowerCase().includes(q)))
    );
  },

  async getPendingInvitations(userId) {
    if (!COLLAB_USE_MOCK) {
      const res = await fetch(`${API_BASE}/auth/users/me/collaborations/pending`, {
        headers: authHeaders(),
      });
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(await res.text());
      const rows = await res.json();
      return rows.map((row) =>
        populateCollaborator(
          mapViewRowToCollaborator(row, { useMockFallback: false }),
          { useMockFallback: false }
        )
      );
    }
    await delay(300);
    return mockCollaborators
      .filter((c) => c.user_id === userId && c.status === 'pending')
      .map(populateCollaborator);
  },

  async getNotifications(userId) {
    if (!COLLAB_USE_MOCK) {
      const res = await fetch(`${API_BASE}/auth/users/me/notifications`, {
        headers: authHeaders(),
      });
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }
    await delay(200);
    return [...mockNotifications]
      .filter((n) => n.target_user_id === userId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },

  async markNotificationRead(notifId) {
    if (!COLLAB_USE_MOCK) {
      const res = await fetch(`${API_BASE}/auth/users/me/notifications/${notifId}/read`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (res.status !== 404 && !res.ok) {
        throw new Error(await res.text());
      }
      return;
    }
    await delay(100);
    const notif = mockNotifications.find((n) => n.id === notifId);
    if (notif) notif.read = true;
  },

  async markAllNotificationsRead(userId) {
    if (!COLLAB_USE_MOCK) {
      const res = await fetch(`${API_BASE}/auth/users/me/notifications/read-all`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (res.status !== 404 && !res.ok) {
        throw new Error(await res.text());
      }
      return;
    }
    await delay(100);
    mockNotifications
      .filter((n) => n.target_user_id === userId)
      .forEach((n) => {
        n.read = true;
      });
  },

  async clearNotification(notifId) {
    if (!COLLAB_USE_MOCK) {
      const res = await fetch(`${API_BASE}/auth/users/me/notifications/${notifId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (res.status !== 404 && !res.ok) {
        throw new Error(await res.text());
      }
      return;
    }

    await delay(100);
    const idx = mockNotifications.findIndex((n) => n.id === notifId);
    if (idx >= 0) {
      mockNotifications.splice(idx, 1);
    }
  },

  async clearAllNotifications(userId) {
    if (!COLLAB_USE_MOCK) {
      const res = await fetch(`${API_BASE}/auth/users/me/notifications`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (res.status !== 404 && !res.ok) {
        throw new Error(await res.text());
      }
      return;
    }

    await delay(100);
    for (let i = mockNotifications.length - 1; i >= 0; i -= 1) {
      if (mockNotifications[i].target_user_id === userId) {
        mockNotifications.splice(i, 1);
      }
    }
  },

  async getCurrentUserRole(repoId, userId) {
    if (!COLLAB_USE_MOCK) {
      const res = await fetch(`${API_BASE}/repos/${repoId}/members/me/role`, {
        headers: authHeaders(),
      });
      if (res.status === 403 || res.status === 404) return null;
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      return data.role === 'none' || !data.role ? null : data.role;
    }
    await delay(100);
    const repo = mockRepositories.find((r) => r.repository_id === repoId);
    if (repo?.owner_id === userId) {
      const row = mockCollaborators.find(
        (c) =>
          c.repository_id === repoId && c.user_id === userId && c.status === 'accepted'
      );
      return row?.role ?? 'owner';
    }
    const collab = mockCollaborators.find(
      (c) => c.repository_id === repoId && c.user_id === userId && c.status === 'accepted'
    );
    return collab?.role ?? null;
  },
};
