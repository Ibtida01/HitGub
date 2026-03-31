import { useState, useEffect, useCallback } from 'react';
import { Loader2, Inbox, Check, X, GitBranch, Lock, Globe } from 'lucide-react';
import { collabApi } from '../../services/collabApi.js';
import { Avatar } from './Avatar.jsx';
import { RoleBadge } from './RoleBadge.jsx';
import { timeAgo } from '../../utils/datetime.js';

export function PendingInvitations({ currentUserId, onRespond }) {
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [respondingTo, setRespondingTo] = useState(null);

  const load = useCallback(async (options = {}) => {
    const { silent = false } = options;
    if (!silent) {
      setLoading(true);
    }
    try {
      const data = await collabApi.getPendingInvitations(currentUserId);
      setInvitations(data);
    } catch {
      if (!silent) {
        setInvitations([]);
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [currentUserId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const interval = setInterval(() => {
      load({ silent: true });
    }, 3000);

    return () => clearInterval(interval);
  }, [load]);

  const handleRespond = async (collabId, accept) => {
    setRespondingTo(collabId);
    try {
      const invitation = invitations.find((i) => i.collaboration_id === collabId);
      await collabApi.respondToInvitation(
        collabId,
        accept,
        invitation?.repository_id,
      );
      await load();
      onRespond?.();
    } finally {
      setRespondingTo(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="animate-spin text-gh-text-muted" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-5">
        <h2 className="text-xl font-semibold text-gh-text">Pending invitations</h2>
        <p className="text-sm text-gh-text-secondary mt-0.5">
          {invitations.length === 0
            ? "You don't have any pending invitations"
            : `You have ${invitations.length} pending invitation${invitations.length !== 1 ? 's' : ''}`}
        </p>
      </div>

      {invitations.length === 0 ? (
        <div className="bg-gh-canvas-subtle border border-gh-border rounded-lg py-16 text-center">
          <Inbox size={40} className="mx-auto text-gh-text-muted mb-3" />
          <p className="text-sm text-gh-text-secondary">No pending invitations</p>
          <p className="text-xs text-gh-text-muted mt-1">
            When someone invites you to collaborate, it will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {invitations.map((inv) => {
            const repo = inv.repository;
            const inviter = inv.invited_by_user;
            const isResponding = respondingTo === inv.collaboration_id;

            return (
              <div
                key={inv.collaboration_id}
                className={`bg-gh-canvas-subtle border border-gh-border rounded-lg p-4 transition-opacity ${
                  isResponding ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className="p-2.5 rounded-lg bg-gh-overlay">
                    <GitBranch size={20} className="text-gh-text-secondary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gh-text">
                        {repo?.name ?? 'Unknown repo'}
                      </span>
                      {repo?.visibility === 'private' ? (
                        <span className="inline-flex items-center gap-0.5 text-xs text-gh-text-secondary border border-gh-border rounded-full px-2 py-0.5">
                          <Lock size={10} /> Private
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 text-xs text-gh-text-secondary border border-gh-border rounded-full px-2 py-0.5">
                          <Globe size={10} /> Public
                        </span>
                      )}
                    </div>
                    {repo?.description && (
                      <p className="text-sm text-gh-text-secondary mt-0.5 truncate">
                        {repo.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-gh-text-secondary">
                      {inviter && (
                        <span className="flex items-center gap-1">
                          <Avatar
                            username={inviter.username}
                            avatarUrl={inviter.avatar_url}
                            size="sm"
                          />
                          Invited by @{inviter.username}
                        </span>
                      )}
                      <span>&middot;</span>
                      <span>{timeAgo(inv.invited_at)}</span>
                      <span>&middot;</span>
                      <RoleBadge role={inv.role} />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleRespond(inv.collaboration_id, false)}
                      disabled={isResponding}
                      className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium border border-gh-border text-gh-text rounded-md hover:bg-gh-overlay disabled:opacity-50 transition-colors"
                    >
                      <X size={14} />
                      Decline
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRespond(inv.collaboration_id, true)}
                      disabled={isResponding}
                      className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-gh-success-em rounded-md hover:bg-gh-success disabled:opacity-50 transition-colors"
                    >
                      {isResponding ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Check size={14} />
                      )}
                      Accept
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
