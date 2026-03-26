import { useState } from 'react';
import { Trash2, MoreHorizontal, Check } from 'lucide-react';
import { ASSIGNABLE_ROLES } from '../../types/index.js';
import { Avatar } from './Avatar.jsx';
import { RoleBadge } from './RoleBadge.jsx';
import { StatusBadge } from './StatusBadge.jsx';
import { ConfirmDialog } from './ConfirmDialog.jsx';

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function CollaboratorTable({
  collaborators,
  currentUserRole,
  currentUserId,
  onRoleChange,
  onRemove,
}) {
  const [removeTarget, setRemoveTarget] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [openMenu, setOpenMenu] = useState(null);

  const canManage = (target) => {
    if (target.role === 'owner') return false;
    if (target.user_id === currentUserId) return false;
    return currentUserRole === 'owner';
  };

  const handleRoleChange = async (collabId, newRole) => {
    setActionLoading(collabId);
    try {
      await onRoleChange(collabId, newRole);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    setActionLoading(removeTarget.collaboration_id);
    try {
      await onRemove(removeTarget.collaboration_id);
    } finally {
      setActionLoading(null);
      setRemoveTarget(null);
    }
  };

  if (collaborators.length === 0) {
    return (
      <div className="text-center py-12 text-gh-text-secondary">
        <p className="text-sm">No collaborators found.</p>
      </div>
    );
  }

  return (
    <>
      <div className="divide-y divide-gh-border-muted">
        {collaborators.map((collab) => {
          const user = collab.user;
          if (!user) return null;
          const manageable = canManage(collab);
          const isLoading = actionLoading === collab.collaboration_id;

          return (
            <div
              key={collab.collaboration_id}
              className={`flex items-center gap-4 px-4 py-3 hover:bg-gh-overlay transition-colors ${
                isLoading ? 'opacity-60' : ''
              }`}
            >
              <Avatar username={user.username} avatarUrl={user.avatar_url} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gh-text truncate">
                    {user.full_name ?? user.username}
                  </span>
                  {collab.user_id === currentUserId && (
                    <span className="text-[10px] font-medium text-gh-text-muted bg-gh-overlay px-1.5 py-0.5 rounded">
                      you
                    </span>
                  )}
                </div>
                <div className="text-xs text-gh-text-secondary flex items-center gap-1.5">
                  <span>@{user.username}</span>
                  <span>&middot;</span>
                  <span>
                    {collab.status === 'accepted'
                      ? `Joined ${timeAgo(collab.accepted_at)}`
                      : `Invited ${timeAgo(collab.invited_at)}`}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <StatusBadge status={collab.status} />
                <RoleBadge role={collab.role} />

                {manageable && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenMenu(
                          openMenu === collab.collaboration_id ? null : collab.collaboration_id
                        )
                      }
                      className="p-1.5 rounded-md hover:bg-gh-border text-gh-text-secondary transition-colors"
                    >
                      <MoreHorizontal size={16} />
                    </button>

                    {openMenu === collab.collaboration_id && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          aria-hidden="true"
                          onClick={() => setOpenMenu(null)}
                        />
                        <div className="absolute right-0 top-full mt-1 z-20 bg-gh-canvas-subtle border border-gh-border rounded-lg shadow-xl shadow-black/40 py-1 w-52">
                          <div className="px-3 py-2 border-b border-gh-border-muted">
                            <p className="text-xs font-medium text-gh-text-muted uppercase tracking-wide">
                              Change role
                            </p>
                          </div>
                          <div className="py-1">
                            {(ASSIGNABLE_ROLES[currentUserRole] || []).map((r) => (
                              <button
                                type="button"
                                key={r}
                                onClick={() => {
                                  setOpenMenu(null);
                                  if (r !== collab.role) {
                                    handleRoleChange(collab.collaboration_id, r);
                                  }
                                }}
                                className={`w-full flex items-center justify-between px-3 py-1.5 text-sm transition-colors ${
                                  r === collab.role
                                    ? 'text-gh-accent font-medium bg-gh-accent/10'
                                    : 'text-gh-text hover:bg-gh-overlay'
                                }`}
                              >
                                <span className="capitalize">{r}</span>
                                {r === collab.role && <Check size={14} />}
                              </button>
                            ))}
                          </div>
                          <div className="border-t border-gh-border-muted pt-1">
                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenu(null);
                                setRemoveTarget(collab);
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gh-danger hover:bg-red-400/10 transition-colors"
                            >
                              <Trash2 size={14} />
                              Remove collaborator
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        isOpen={!!removeTarget}
        title="Remove collaborator"
        message={`Are you sure you want to remove @${removeTarget?.user?.username} from this repository? They will lose all access immediately.`}
        confirmLabel="Remove"
        variant="danger"
        onConfirm={handleRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </>
  );
}
