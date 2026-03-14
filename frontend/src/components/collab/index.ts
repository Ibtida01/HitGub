/**
 * Collaborator Management UI Module
 *
 * INTEGRATION GUIDE:
 *
 * 1. In your repo settings page:
 *    import { CollaboratorSettings } from './components/collab';
 *    <CollaboratorSettings repoId={repoId} currentUserId={userId} />
 *
 * 2. In your user dashboard / invitations page:
 *    import { PendingInvitations } from './components/collab';
 *    <PendingInvitations currentUserId={userId} />
 *
 * 3. In your top navbar:
 *    import { NotificationDropdown } from './components/collab';
 *    <NotificationDropdown currentUserId={userId} />
 *
 * 4. Anywhere you need to show the permission matrix:
 *    import { PermissionInfo } from './components/collab';
 *    <PermissionInfo />
 *
 * When the backend is ready, update src/services/collabApi.ts
 * to make real HTTP calls. No component changes needed.
 */

export { CollaboratorSettings } from './CollaboratorSettings';
export { PendingInvitations } from './PendingInvitations';
export { NotificationDropdown } from './NotificationDropdown';
export { PermissionInfo } from './PermissionInfo';
export { CollaboratorTable } from './CollaboratorTable';
export { InviteModal } from './InviteModal';
export { RoleBadge } from './RoleBadge';
export { StatusBadge } from './StatusBadge';
export { RoleSelect } from './RoleSelect';
export { Avatar } from './Avatar';
export { ConfirmDialog } from './ConfirmDialog';
