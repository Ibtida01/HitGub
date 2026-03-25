/**
 * Collaborator Management UI (React / JavaScript)
 *
 * import { CollaboratorSettings } from './components/collab';
 * <CollaboratorSettings repoId={repoId} currentUserId={userId} />
 *
 * Env: VITE_API_URL, VITE_COLLAB_USE_MOCK — see src/services/collabApi.js
 */

export { CollaboratorSettings } from './CollaboratorSettings.jsx';
export { PendingInvitations } from './PendingInvitations.jsx';
export { NotificationDropdown } from './NotificationDropdown.jsx';
export { PermissionInfo } from './PermissionInfo.jsx';
export { CollaboratorTable } from './CollaboratorTable.jsx';
export { InviteModal } from './InviteModal.jsx';
export { RoleBadge } from './RoleBadge.jsx';
export { StatusBadge } from './StatusBadge.jsx';
export { RoleSelect } from './RoleSelect.jsx';
export { Avatar } from './Avatar.jsx';
export { ConfirmDialog } from './ConfirmDialog.jsx';

export { mapViewRowToCollaborator } from '../../services/collabApi.js';
