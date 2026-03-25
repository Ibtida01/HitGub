import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Search, UserPlus, Loader2 } from 'lucide-react';
import { ASSIGNABLE_ROLES } from '../../types/index.js';
import { collabApi } from '../../services/collabApi.js';
import { Avatar } from './Avatar.jsx';

const ROLE_LABELS = {
  owner: 'Owner',
  contributor: 'Contributor',
  'read-only': 'Read-only',
};

export function InviteModal({
  isOpen,
  currentUserRole,
  existingUserIds,
  onInvite,
  onClose,
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [role, setRole] = useState('contributor');
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  const assignableRoles = ASSIGNABLE_ROLES[currentUserRole] || [];

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setSelectedUser(null);
      setRole('contributor');
      setError('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSearch = useCallback((q) => {
    setQuery(q);
    setError('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const users = await collabApi.searchUsers(q);
        setResults(users);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  const handleSubmit = async () => {
    if (!selectedUser) return;
    setSubmitting(true);
    setError('');
    try {
      await onInvite(selectedUser.user_id, role);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send invitation');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] p-4">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <div className="relative bg-gh-canvas-subtle border border-gh-border rounded-xl shadow-xl shadow-black/40 max-w-lg w-full">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gh-border">
          <h2 className="text-base font-semibold text-gh-text flex items-center gap-2">
            <UserPlus size={18} />
            Invite a collaborator
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gh-text-muted hover:text-gh-text-secondary p-1"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!selectedUser ? (
            <>
              <div className="relative">
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gh-text-muted"
                />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Search by username, name, or email..."
                  className="w-full pl-9 pr-3 py-2 text-sm bg-gh-canvas border border-gh-border rounded-lg text-gh-text placeholder:text-gh-text-muted focus:outline-none focus:ring-2 focus:ring-gh-accent focus:border-gh-accent"
                />
                {searching && (
                  <Loader2
                    size={16}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gh-text-muted animate-spin"
                  />
                )}
              </div>

              {results.length > 0 && (
                <div className="border border-gh-border rounded-lg max-h-56 overflow-y-auto divide-y divide-gh-border-muted">
                  {results.map((user) => {
                    const alreadyAdded = existingUserIds.includes(user.user_id);
                    return (
                      <button
                        type="button"
                        key={user.user_id}
                        disabled={alreadyAdded}
                        onClick={() => setSelectedUser(user)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                          alreadyAdded
                            ? 'opacity-40 cursor-not-allowed'
                            : 'hover:bg-gh-overlay cursor-pointer'
                        }`}
                      >
                        <Avatar username={user.username} avatarUrl={user.avatar_url} size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-gh-text truncate">
                            {user.full_name ?? user.username}
                          </div>
                          <div className="text-xs text-gh-text-secondary truncate">
                            @{user.username} &middot; {user.email}
                          </div>
                        </div>
                        {alreadyAdded && (
                          <span className="text-xs text-gh-text-muted shrink-0">Already added</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {query.trim() && !searching && results.length === 0 && (
                <p className="text-sm text-gh-text-secondary text-center py-4">
                  No users found matching &quot;{query}&quot;
                </p>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 p-3 bg-gh-accent/10 border border-gh-accent/20 rounded-lg">
                <Avatar
                  username={selectedUser.username}
                  avatarUrl={selectedUser.avatar_url}
                  size="lg"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gh-text">
                    {selectedUser.full_name ?? selectedUser.username}
                  </div>
                  <div className="text-sm text-gh-text-secondary">@{selectedUser.username}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedUser(null)}
                  className="text-gh-text-muted hover:text-gh-text-secondary p-1"
                >
                  <X size={16} />
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium text-gh-text mb-1.5">Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full border border-gh-border rounded-lg px-3 py-2 text-sm bg-gh-canvas text-gh-text focus:outline-none focus:ring-2 focus:ring-gh-accent focus:border-gh-accent"
                >
                  {assignableRoles.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {error && (
            <p className="text-sm text-gh-danger bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gh-border bg-gh-canvas-subtle rounded-b-xl">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm font-medium border border-gh-border rounded-md text-gh-text hover:bg-gh-overlay"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selectedUser || submitting}
            className="px-4 py-1.5 text-sm font-medium text-white bg-gh-success-em rounded-md hover:bg-gh-success disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Send invitation
          </button>
        </div>
      </div>
    </div>
  );
}
