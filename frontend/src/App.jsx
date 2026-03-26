import { useEffect, useState } from "react";
import {
  GitBranch,
  Users,
  Inbox,
  Shield,
  ChevronDown,
  FolderGit2,
} from "lucide-react";
import {
  CollaboratorSettings,
  PendingInvitations,
  NotificationDropdown,
  PermissionInfo,
  Avatar,
} from "./components/collab";
import { RepositoryManagement } from "./components/repo";
import { REPO_USE_MOCK, repoApi } from "./services/repoApi.js";
import { mockUsers, mockRepositories } from "./mock/data.js";

const NAV_ITEMS = [
  { key: "repo", label: "Repositories", Icon: FolderGit2 },
  { key: "manage", label: "Manage Access", Icon: Users },
  { key: "invitations", label: "My Invitations", Icon: Inbox },
  { key: "permissions", label: "Permissions", Icon: Shield },
];

export default function App() {
  const [currentUserId, setCurrentUserId] = useState(1);
  const [selectedRepoId, setSelectedRepoId] = useState(null);
  const [activeView, setActiveView] = useState("repo");
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [repoMenuOpen, setRepoMenuOpen] = useState(false);
  const [repoRevision, setRepoRevision] = useState(0);
  const [availableRepos, setAvailableRepos] = useState([]);

  useEffect(() => {
    let cancelled = false;

    if (REPO_USE_MOCK) {
      const repos = mockRepositories.filter((repo) => !repo.deleted_at);
      if (!cancelled) {
        setAvailableRepos(repos);
      }
      return () => {
        cancelled = true;
      };
    }

    repoApi
      .listRepositoriesForUser(currentUserId)
      .then((repos) => {
        if (!cancelled) {
          setAvailableRepos(repos);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAvailableRepos([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentUserId, repoRevision]);

  useEffect(() => {
    if (availableRepos.length === 0) {
      setSelectedRepoId(null);
      return;
    }

    const stillExists = availableRepos.some(
      (r) => r.repository_id === selectedRepoId,
    );
    if (!stillExists) {
      setSelectedRepoId(availableRepos[0].repository_id);
    }
  }, [availableRepos, selectedRepoId]);

  const currentUser = mockUsers.find((u) => u.user_id === currentUserId);
  const selectedRepo = availableRepos.find(
    (r) => r.repository_id === selectedRepoId,
  );
  const selectedRepoOwnerName =
    selectedRepo?.owner?.username ??
    mockUsers.find((u) => u.user_id === selectedRepo?.owner_id)?.username;

  return (
    <div className="min-h-screen bg-gh-canvas">
      <header className="bg-gh-canvas-inset border-b border-gh-border sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-4">
          <div className="flex items-center gap-2 font-bold text-lg text-gh-text">
            <GitBranch size={22} />
            <span>HitGub</span>
          </div>

          <div className="flex-1" />

          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setRepoMenuOpen(!repoMenuOpen);
                setUserMenuOpen(false);
              }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm hover:bg-white/10 transition-colors"
            >
              <span className="text-gh-text-muted">Repo:</span>
              <span className="font-medium text-gh-text">
                {selectedRepo?.name ?? "None"}
              </span>
              <ChevronDown size={14} className="text-gh-text-muted" />
            </button>
            {repoMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  aria-hidden="true"
                  onClick={() => setRepoMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-20 bg-gh-canvas-subtle border border-gh-border rounded-lg shadow-xl shadow-black/40 py-1 w-56">
                  {availableRepos.map((repo) => (
                    <button
                      type="button"
                      key={repo.repository_id}
                      onClick={() => {
                        setSelectedRepoId(repo.repository_id);
                        setRepoMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gh-overlay ${
                        repo.repository_id === selectedRepoId
                          ? "text-gh-accent font-medium bg-gh-accent/10"
                          : "text-gh-text"
                      }`}
                    >
                      <GitBranch size={14} />
                      <span className="truncate">{repo.name}</span>
                      <span className="ml-auto text-xs text-gh-text-muted">
                        {repo.visibility}
                      </span>
                    </button>
                  ))}
                  {availableRepos.length === 0 && (
                    <div className="px-3 py-2 text-sm text-gh-text-muted">
                      No repositories found
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <NotificationDropdown currentUserId={currentUserId} />

          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setUserMenuOpen(!userMenuOpen);
                setRepoMenuOpen(false);
              }}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/10 transition-colors"
            >
              <Avatar
                username={currentUser?.username ?? ""}
                avatarUrl={currentUser?.avatar_url}
                size="sm"
              />
              <span className="text-sm font-medium text-gh-text">
                {currentUser?.username}
              </span>
              <ChevronDown size={14} className="text-gh-text-muted" />
            </button>
            {userMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  aria-hidden="true"
                  onClick={() => setUserMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-20 bg-gh-canvas-subtle border border-gh-border rounded-lg shadow-xl shadow-black/40 py-1 w-64">
                  <p className="px-3 py-1.5 text-xs text-gh-text-muted font-medium uppercase tracking-wide">
                    Switch user (for testing)
                  </p>
                  {mockUsers.map((user) => (
                    <button
                      type="button"
                      key={user.user_id}
                      onClick={() => {
                        setCurrentUserId(user.user_id);
                        setUserMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-gh-overlay ${
                        user.user_id === currentUserId
                          ? "text-gh-accent font-medium bg-gh-accent/10"
                          : "text-gh-text"
                      }`}
                    >
                      <Avatar
                        username={user.username}
                        avatarUrl={user.avatar_url}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <div className="truncate">{user.full_name}</div>
                        <div className="text-xs text-gh-text-muted">
                          @{user.username}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="bg-gh-canvas-subtle border-b border-gh-border">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center gap-2 py-3 text-sm">
            <Avatar username={selectedRepoOwnerName ?? ""} size="sm" />
            <span className="text-gh-text-secondary">
              {selectedRepoOwnerName}
            </span>
            <span className="text-gh-text-muted">/</span>
            <span className="font-semibold text-gh-accent hover:underline cursor-pointer">
              {selectedRepo?.name}
            </span>
            <span className="text-xs border border-gh-border text-gh-text-secondary rounded-full px-2 py-0.5 ml-1">
              {selectedRepo?.visibility}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-gh-canvas-subtle border-b border-gh-border">
        <div className="max-w-7xl mx-auto px-4">
          <nav className="flex gap-1 -mb-px">
            {NAV_ITEMS.map(({ key, label, Icon }) => (
              <button
                type="button"
                key={key}
                onClick={() => setActiveView(key)}
                className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeView === key
                    ? "border-orange-500 text-gh-text"
                    : "border-transparent text-gh-text-secondary hover:text-gh-text hover:border-gh-border"
                }`}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {activeView === "repo" &&
          (selectedRepoId ? (
            <RepositoryManagement
              key={`${selectedRepoId}-${currentUserId}-${repoRevision}`}
              selectedRepoId={selectedRepoId}
              currentUserId={currentUserId}
              onSelectRepo={setSelectedRepoId}
              onRepositoriesChanged={() => setRepoRevision((v) => v + 1)}
            />
          ) : (
            <div className="rounded-lg border border-gh-border bg-gh-canvas-subtle p-6 text-gh-text-muted">
              No repository selected yet. Create a repository first, or pick one
              from the repo dropdown.
            </div>
          ))}
        {activeView === "manage" && (
          <CollaboratorSettings
            key={`${selectedRepoId}-${currentUserId}`}
            repoId={selectedRepoId}
            currentUserId={currentUserId}
          />
        )}
        {activeView === "invitations" && (
          <PendingInvitations
            key={currentUserId}
            currentUserId={currentUserId}
          />
        )}
        {activeView === "permissions" && <PermissionInfo />}
      </main>
    </div>
  );
}
