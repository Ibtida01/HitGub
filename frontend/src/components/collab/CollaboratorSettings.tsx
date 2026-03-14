import { useState, useEffect, useCallback } from 'react';
import { UserPlus, Search, Filter, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Collaborator, Role } from '../../types';
import { collabApi } from '../../services/collabApi';
import { CollaboratorTable } from './CollaboratorTable';
import { InviteModal } from './InviteModal';

interface CollaboratorSettingsProps {
  repoId: number;
  currentUserId: number;
}

type FilterTab = 'all' | Role | 'pending';

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'owner', label: 'Owners' },
  { key: 'maintainer', label: 'Maintainers' },
  { key: 'contributor', label: 'Contributors' },
  { key: 'read-only', label: 'Read-only' },
  { key: 'pending', label: 'Pending' },
];

interface Toast {
  type: 'success' | 'error';
  message: string;
}

export function CollaboratorSettings({ repoId, currentUserId }: CollaboratorSettingsProps) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserRole, setCurrentUserRole] = useState<Role | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = useCallback((type: Toast['type'], message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [collabs, role] = await Promise.all([
        collabApi.getCollaborators(repoId),
        collabApi.getCurrentUserRole(repoId, currentUserId),
      ]);
      setCollaborators(collabs);
      setCurrentUserRole(role);
    } catch {
      showToast('error', 'Failed to load collaborators');
    } finally {
      setLoading(false);
    }
  }, [repoId, currentUserId, showToast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleInvite = async (userId: number, role: Role) => {
    await collabApi.inviteCollaborator(repoId, userId, role, currentUserId);
    showToast('success', 'Invitation sent successfully');
    await fetchData();
  };

  const handleRoleChange = async (collabId: number, newRole: Role) => {
    await collabApi.updateRole(collabId, newRole);
    showToast('success', 'Role updated successfully');
    await fetchData();
  };

  const handleRemove = async (collabId: number) => {
    await collabApi.removeCollaborator(collabId);
    showToast('success', 'Collaborator removed');
    await fetchData();
  };

  const canInvite = currentUserRole === 'owner' || currentUserRole === 'maintainer';

  const filtered = collaborators.filter((c) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        c.user?.username.toLowerCase().includes(q) ||
        c.user?.full_name?.toLowerCase().includes(q) ||
        c.user?.email.toLowerCase().includes(q);
      if (!matchesSearch) return false;
    }

    if (activeFilter === 'all') return true;
    if (activeFilter === 'pending') return c.status === 'pending';
    return c.role === activeFilter;
  });

  const pendingCount = collaborators.filter((c) => c.status === 'pending').length;
  const existingUserIds = collaborators.map((c) => c.user_id);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="animate-spin text-gh-text-muted" />
      </div>
    );
  }

  if (!currentUserRole) {
    return (
      <div className="text-center py-16">
        <AlertCircle size={32} className="mx-auto text-gh-text-muted mb-2" />
        <p className="text-sm text-gh-text-secondary">You don't have access to manage collaborators for this repository.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {toast && (
        <div
          className={`fixed top-4 right-4 z-[60] flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg shadow-black/30 text-sm font-medium text-white transition-all ${
            toast.type === 'success' ? 'bg-gh-success-em' : 'bg-gh-danger-em'
          }`}
        >
          {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {toast.message}
        </div>
      )}

      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-semibold text-gh-text">Manage access</h2>
          <p className="text-sm text-gh-text-secondary mt-0.5">
            {collaborators.length} collaborator{collaborators.length !== 1 ? 's' : ''} have access to this repository
          </p>
        </div>
        {canInvite && (
          <button
            onClick={() => setInviteOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gh-success-em rounded-lg hover:bg-gh-success transition-colors shadow-sm"
          >
            <UserPlus size={16} />
            Invite collaborator
          </button>
        )}
      </div>

      <div className="bg-gh-canvas-subtle border border-gh-border rounded-t-lg">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gh-border">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gh-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Find a collaborator..."
              className="w-full pl-9 pr-3 py-1.5 text-sm bg-gh-canvas border border-gh-border rounded-md text-gh-text placeholder:text-gh-text-muted focus:outline-none focus:ring-2 focus:ring-gh-accent focus:border-gh-accent"
            />
          </div>
          <Filter size={16} className="text-gh-text-muted" />
        </div>

        <div className="flex items-center gap-1 px-4 py-2 border-b border-gh-border-muted bg-gh-canvas overflow-x-auto">
          {FILTER_TABS.map((tab) => {
            const isActive = activeFilter === tab.key;
            const count =
              tab.key === 'all'
                ? collaborators.length
                : tab.key === 'pending'
                  ? pendingCount
                  : collaborators.filter((c) => c.role === tab.key).length;

            return (
              <button
                key={tab.key}
                onClick={() => setActiveFilter(tab.key)}
                className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-gh-accent-em text-white'
                    : 'text-gh-text-secondary hover:bg-gh-overlay'
                }`}
              >
                {tab.label}
                {count > 0 && (
                  <span
                    className={`ml-1.5 ${
                      isActive ? 'text-blue-200' : 'text-gh-text-muted'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <CollaboratorTable
          collaborators={filtered}
          currentUserRole={currentUserRole}
          currentUserId={currentUserId}
          onRoleChange={handleRoleChange}
          onRemove={handleRemove}
        />
      </div>

      {filtered.length === 0 && collaborators.length > 0 && (
        <div className="bg-gh-canvas-subtle border border-t-0 border-gh-border rounded-b-lg py-8 text-center">
          <p className="text-sm text-gh-text-secondary">
            No collaborators match the current filter.
          </p>
        </div>
      )}

      <InviteModal
        isOpen={inviteOpen}
        currentUserRole={currentUserRole}
        existingUserIds={existingUserIds}
        onInvite={handleInvite}
        onClose={() => setInviteOpen(false)}
      />
    </div>
  );
}
