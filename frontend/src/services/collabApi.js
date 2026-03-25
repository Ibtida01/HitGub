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

export function mapViewRowToCollaborator(row) {
  const user = {
    user_id: row.user_id,
    username: row.username,
    email: row.email,
    full_name: row.full_name,
    avatar_url: row.avatar_url,
    is_active: true,
    created_at: row.invited_at,
  };
  const invitedByUser = row.invited_by_username
    ? mockUsers.find((u) => u.username === row.invited_by_username)
    : undefined;
  const invitedBy = row.invited_by ?? invitedByUser?.user_id ?? row.user_id;
  const repository = mockRepositories.find((r) => r.repository_id === row.repository_id);

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

function populateCollaborator(c) {
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
      const res = await fetch(`${API_BASE}/repos/${repoId}/collaborators`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        throw new Error(`Failed to load collaborators: ${res.status}`);
      }
      const rows = await res.json();
      return rows.map((row) => populateCollaborator(mapViewRowToCollaborator(row)));
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
        body: JSON.stringify({ user_id: userId, role }),
      });
      if (!res.ok) throw new Error(await res.text());
      const row = await res.json();
      return populateCollaborator(mapViewRowToCollaborator(row));
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

  async updateRole(collabId, newRole) {
    if (newRole === 'owner') {
      throw new Error('Promoting to owner is done via ownership transfer on the backend.');
    }
    if (!COLLAB_USE_MOCK) {
      const res = await fetch(`${API_BASE}/collaborators/${collabId}/role`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) throw new Error(await res.text());
      const row = await res.json();
      return populateCollaborator(mapViewRowToCollaborator(row));
    }
    await delay(300);
    const collab = mockCollaborators.find((c) => c.collaboration_id === collabId);
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

  async removeCollaborator(collabId) {
    if (!COLLAB_USE_MOCK) {
      const res = await fetch(`${API_BASE}/collaborators/${collabId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      return;
    }
    await delay(300);
    const idx = mockCollaborators.findIndex((c) => c.collaboration_id === collabId);
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

  async respondToInvitation(collabId, accept) {
    if (!COLLAB_USE_MOCK) {
      const res = await fetch(`${API_BASE}/collaborations/${collabId}/respond`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ accept }),
      });
      if (!res.ok) throw new Error(await res.text());
      const row = await res.json();
      return populateCollaborator(mapViewRowToCollaborator(row));
    }
    await delay(400);
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
        `${API_BASE}/users/search?q=${encodeURIComponent(query)}`,
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
      const res = await fetch(`${API_BASE}/users/me/collaborations/pending`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      const rows = await res.json();
      return rows.map((row) => populateCollaborator(mapViewRowToCollaborator(row)));
    }
    await delay(300);
    return mockCollaborators
      .filter((c) => c.user_id === userId && c.status === 'pending')
      .map(populateCollaborator);
  },

  async getNotifications(userId) {
    if (!COLLAB_USE_MOCK) {
      const res = await fetch(`${API_BASE}/users/me/notifications`, {
        headers: authHeaders(),
      });
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
      await fetch(`${API_BASE}/users/me/notifications/${notifId}/read`, {
        method: 'POST',
        headers: authHeaders(),
      });
      return;
    }
    await delay(100);
    const notif = mockNotifications.find((n) => n.id === notifId);
    if (notif) notif.read = true;
  },

  async markAllNotificationsRead(userId) {
    if (!COLLAB_USE_MOCK) {
      await fetch(`${API_BASE}/users/me/notifications/read-all`, {
        method: 'POST',
        headers: authHeaders(),
      });
      return;
    }
    await delay(100);
    mockNotifications
      .filter((n) => n.target_user_id === userId)
      .forEach((n) => {
        n.read = true;
      });
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
