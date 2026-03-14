import { useState } from 'react';
import { GitBranch, Users, Inbox, Shield, ChevronDown } from 'lucide-react';
import {
  CollaboratorSettings,
  PendingInvitations,
  NotificationDropdown,
  PermissionInfo,
  Avatar,
} from './components/collab';
import { mockUsers, mockRepositories } from './mock/data';

type View = 'manage' | 'invitations' | 'permissions';

const NAV_ITEMS: { key: View; label: string; Icon: typeof Users }[] = [
  { key: 'manage', label: 'Manage Access', Icon: Users },
  { key: 'invitations', label: 'My Invitations', Icon: Inbox },
  { key: 'permissions', label: 'Permissions', Icon: Shield },
];

export default function App() {
  const [currentUserId, setCurrentUserId] = useState(1);
  const [selectedRepoId, setSelectedRepoId] = useState(1);
  const [activeView, setActiveView] = useState<View>('manage');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [repoMenuOpen, setRepoMenuOpen] = useState(false);

  const currentUser = mockUsers.find((u) => u.user_id === currentUserId)!;
  const selectedRepo = mockRepositories.find((r) => r.repository_id === selectedRepoId)!;

  return (
    <div className="min-h-screen bg-gh-canvas">
      {/* Top navbar */}
      <header className="bg-gh-canvas-inset border-b border-gh-border sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-4">
          <div className="flex items-center gap-2 font-bold text-lg text-gh-text">
            <GitBranch size={22} />
            <span>HitGub</span>
          </div>

          <div className="flex-1" />

          {/* Repo selector */}
          <div className="relative">
            <button
              onClick={() => {
                setRepoMenuOpen(!repoMenuOpen);
                setUserMenuOpen(false);
              }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm hover:bg-white/10 transition-colors"
            >
              <span className="text-gh-text-muted">Repo:</span>
              <span className="font-medium text-gh-text">{selectedRepo.name}</span>
              <ChevronDown size={14} className="text-gh-text-muted" />
            </button>
            {repoMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setRepoMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-20 bg-gh-canvas-subtle border border-gh-border rounded-lg shadow-xl shadow-black/40 py-1 w-56">
                  {mockRepositories.map((repo) => (
                    <button
                      key={repo.repository_id}
                      onClick={() => {
                        setSelectedRepoId(repo.repository_id);
                        setRepoMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gh-overlay ${
                        repo.repository_id === selectedRepoId
                          ? 'text-gh-accent font-medium bg-gh-accent/10'
                          : 'text-gh-text'
                      }`}
                    >
                      <GitBranch size={14} />
                      <span className="truncate">{repo.name}</span>
                      <span className="ml-auto text-xs text-gh-text-muted">
                        {repo.visibility}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Notification bell */}
          <NotificationDropdown currentUserId={currentUserId} />

          {/* User selector */}
          <div className="relative">
            <button
              onClick={() => {
                setUserMenuOpen(!userMenuOpen);
                setRepoMenuOpen(false);
              }}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/10 transition-colors"
            >
              <Avatar
                username={currentUser.username}
                avatarUrl={currentUser.avatar_url}
                size="sm"
              />
              <span className="text-sm font-medium text-gh-text">{currentUser.username}</span>
              <ChevronDown size={14} className="text-gh-text-muted" />
            </button>
            {userMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setUserMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-20 bg-gh-canvas-subtle border border-gh-border rounded-lg shadow-xl shadow-black/40 py-1 w-64">
                  <p className="px-3 py-1.5 text-xs text-gh-text-muted font-medium uppercase tracking-wide">
                    Switch user (for testing)
                  </p>
                  {mockUsers.map((user) => (
                    <button
                      key={user.user_id}
                      onClick={() => {
                        setCurrentUserId(user.user_id);
                        setUserMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-gh-overlay ${
                        user.user_id === currentUserId
                          ? 'text-gh-accent font-medium bg-gh-accent/10'
                          : 'text-gh-text'
                      }`}
                    >
                      <Avatar
                        username={user.username}
                        avatarUrl={user.avatar_url}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <div className="truncate">{user.full_name}</div>
                        <div className="text-xs text-gh-text-muted">@{user.username}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Repo context bar */}
      <div className="bg-gh-canvas-subtle border-b border-gh-border">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center gap-2 py-3 text-sm">
            <Avatar
              username={
                mockUsers.find((u) => u.user_id === selectedRepo.owner_id)?.username ?? ''
              }
              size="sm"
            />
            <span className="text-gh-text-secondary">
              {mockUsers.find((u) => u.user_id === selectedRepo.owner_id)?.username}
            </span>
            <span className="text-gh-text-muted">/</span>
            <span className="font-semibold text-gh-accent hover:underline cursor-pointer">
              {selectedRepo.name}
            </span>
            <span className="text-xs border border-gh-border text-gh-text-secondary rounded-full px-2 py-0.5 ml-1">
              {selectedRepo.visibility}
            </span>
          </div>
        </div>
      </div>

      {/* View tabs */}
      <div className="bg-gh-canvas-subtle border-b border-gh-border">
        <div className="max-w-7xl mx-auto px-4">
          <nav className="flex gap-1 -mb-px">
            {NAV_ITEMS.map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => setActiveView(key)}
                className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeView === key
                    ? 'border-orange-500 text-gh-text'
                    : 'border-transparent text-gh-text-secondary hover:text-gh-text hover:border-gh-border'
                }`}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {activeView === 'manage' && (
          <CollaboratorSettings
            key={`${selectedRepoId}-${currentUserId}`}
            repoId={selectedRepoId}
            currentUserId={currentUserId}
          />
        )}
        {activeView === 'invitations' && (
          <PendingInvitations
            key={currentUserId}
            currentUserId={currentUserId}
          />
        )}
        {activeView === 'permissions' && <PermissionInfo />}
      </main>
    </div>
  );
}
