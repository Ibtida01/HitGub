/**
 * Collaborator Management API Service
 *
 * This is the abstraction layer between UI components and the backend.
 * Currently backed by mock data for standalone development.
 *
 * INTEGRATION: When the backend is ready, replace each method's body
 * with a real fetch()/axios call. The method signatures stay the same,
 * so the UI components won't need any changes.
 */

import { Collaborator, CollabNotification, Role, User } from '../types';
import {
  mockUsers,
  mockCollaborators,
  mockRepositories,
  mockNotifications,
  getNextCollabId,
  getNextNotifId,
} from '../mock/data';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function populateCollaborator(c: Collaborator): Collaborator {
  return {
    ...c,
    user: mockUsers.find((u) => u.user_id === c.user_id),
    invited_by_user: mockUsers.find((u) => u.user_id === c.invited_by),
    repository: mockRepositories.find((r) => r.repository_id === c.repository_id),
  };
}

export const collabApi = {
  async getCollaborators(repoId: number): Promise<Collaborator[]> {
    await delay(300);
    return mockCollaborators
      .filter((c) => c.repository_id === repoId)
      .map(populateCollaborator);
  },

  async inviteCollaborator(
    repoId: number,
    userId: number,
    role: Role,
    invitedBy: number
  ): Promise<Collaborator> {
    await delay(500);
    const existing = mockCollaborators.find(
      (c) => c.repository_id === repoId && c.user_id === userId
    );
    if (existing) throw new Error('User is already a collaborator');

    const newCollab: Collaborator = {
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

  async updateRole(collabId: number, newRole: Role): Promise<Collaborator> {
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

  async removeCollaborator(collabId: number): Promise<void> {
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

  async respondToInvitation(collabId: number, accept: boolean): Promise<Collaborator> {
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

  async searchUsers(query: string): Promise<User[]> {
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

  async getPendingInvitations(userId: number): Promise<Collaborator[]> {
    await delay(300);
    return mockCollaborators
      .filter((c) => c.user_id === userId && c.status === 'pending')
      .map(populateCollaborator);
  },

  async getNotifications(userId: number): Promise<CollabNotification[]> {
    await delay(200);
    return [...mockNotifications]
      .filter((n) => n.target_user_id === userId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },

  async markNotificationRead(notifId: number): Promise<void> {
    await delay(100);
    const notif = mockNotifications.find((n) => n.id === notifId);
    if (notif) notif.read = true;
  },

  async markAllNotificationsRead(userId: number): Promise<void> {
    await delay(100);
    mockNotifications
      .filter((n) => n.target_user_id === userId)
      .forEach((n) => {
        n.read = true;
      });
  },

  async getCurrentUserRole(repoId: number, userId: number): Promise<Role | null> {
    await delay(100);
    const collab = mockCollaborators.find(
      (c) => c.repository_id === repoId && c.user_id === userId && c.status === 'accepted'
    );
    return collab?.role ?? null;
  },
};
