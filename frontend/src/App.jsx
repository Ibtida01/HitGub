import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileCode2,
  GitBranch,
  Settings,
  Users,
  Inbox,
  Search,
  Plus,
  Trash2,
  ChevronDown,
} from "lucide-react";
import {
  CollaboratorSettings,
  PendingInvitations,
  NotificationDropdown,
  Avatar,
} from "./components/collab";
import {
  CreateRepositoryModal,
  RepositoryManagement,
  RepositoryTrashPanel,
} from "./components/repo";
import { REPO_USE_MOCK, repoApi } from "./services/repoApi.js";
import { mockUsers } from "./mock/data.js";

import {
  clearAuthSession,
  getAuthToken,
  getAuthUsername,
  setAuthUsername,
} from "./services/collabApiConfig";
import { getCurrentUser as apiGetCurrentUser, logout as apiLogout } from "./services/authApi";
import Login from "./components/auth/Login";
import Signup from "./components/auth/Signup";
import { RepositoryCodeView } from "./components/code/RepositoryCodeView.jsx";

const REPO_TABS = [
  { key: "code", label: "Code", Icon: FileCode2 },
  { key: "settings", label: "Settings", Icon: Settings },
  { key: "collaborators", label: "Collaborators", Icon: Users },
];

export default function App() {
  const [currentUserId, setCurrentUserId] = useState(REPO_USE_MOCK ? 1 : null);
  const [currentUser, setCurrentUser] = useState(() =>
    REPO_USE_MOCK ? mockUsers.find((u) => u.user_id === 1) : null,
  );
  const [authChecking, setAuthChecking] = useState(() => !REPO_USE_MOCK && !!getAuthToken());
  const [selectedRepoId, setSelectedRepoId] = useState(null);
  const [selectedRepoMeta, setSelectedRepoMeta] = useState(null);
  const [activeRepoTab, setActiveRepoTab] = useState("code");
  const [activePanel, setActivePanel] = useState("repository");
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [repoRevision, setRepoRevision] = useState(0);
  const [memberRepos, setMemberRepos] = useState([]);
  const [sidebarFilter, setSidebarFilter] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [authToken, setAuthToken] = useState(() => getAuthToken());
  const [authMode, setAuthMode] = useState('login');
  const searchBoxRef = useRef(null);

  useEffect(() => {
    if (!authToken) {
      setCurrentUser(REPO_USE_MOCK ? mockUsers.find((u) => u.user_id === 1) : null);
      setCurrentUserId(REPO_USE_MOCK ? 1 : null);
      setAuthChecking(false);
      return;
    }

    if (REPO_USE_MOCK) {
      setAuthChecking(false);
      return;
    }

    let cancelled = false;
    setAuthChecking(true);
    apiGetCurrentUser()
      .then((user) => {
        if (cancelled) return;
        setCurrentUser(user);
        setCurrentUserId(user?.user_id ?? null);
        if (user?.username) {
          setAuthUsername(user.username);
        }
        setAuthChecking(false);
      })
      .catch((e) => {
        if (cancelled) return;
        const status = e && typeof e === 'object' ? e.status : undefined;

        if (status === 401 || status === 403) {
          clearAuthSession();
          setAuthToken(null);
          setAuthMode('login');
          setCurrentUser(null);
          setCurrentUserId(null);
        }

        setAuthChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authToken]);

  useEffect(() => {
    if (!REPO_USE_MOCK) {
      return;
    }

    const user = mockUsers.find((u) => u.user_id === currentUserId) ?? null;
    setCurrentUser(user);
  }, [currentUserId]);

  useEffect(() => {
    const onClickOutside = (event) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(event.target)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let intervalId;

    const refreshMemberRepositories = () => {
      repoApi
        .listRepositoriesForUser(currentUserId ?? 0)
        .then((repos) => {
          if (cancelled) {
            return;
          }

          setMemberRepos(repos);
          setSelectedRepoId((prev) => {
            if (!prev) return prev;
            const stillVisible = repos.some((repo) => repo.repository_id === prev);
            return stillVisible ? prev : null;
          });
          setSelectedRepoMeta((prev) => {
            if (!prev?.repository_id) {
              return prev;
            }
            const next = repos.find((repo) => repo.repository_id === prev.repository_id);
            return next ?? null;
          });
        })
        .catch(() => {
          if (!cancelled) {
            setMemberRepos([]);
          }
        });
    };

    if (authChecking) {
      return () => {
        cancelled = true;
      };
    }

    if (!authToken) {
      setMemberRepos([]);
      return () => {
        cancelled = true;
      };
    }

    refreshMemberRepositories();
    intervalId = setInterval(refreshMemberRepositories, 3000);

    return () => {
      cancelled = true;
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [authChecking, authToken, currentUserId, repoRevision]);

  useEffect(() => {
    if (selectedRepoId) {
      return;
    }
    if (memberRepos.length === 0) {
      setSelectedRepoId(null);
      setSelectedRepoMeta(null);
      return;
    }
    setSelectedRepoId(memberRepos[0].repository_id);
    setSelectedRepoMeta(memberRepos[0]);
  }, [memberRepos, selectedRepoId]);

  useEffect(() => {
    let cancelled = false;

    const q = globalSearch.trim();
    if (!q || !authToken || !currentUserId || authChecking) {
      setSearchResults([]);
      setSearchLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setSearchLoading(true);
    const timer = setTimeout(() => {
      repoApi
        .listDiscoverableRepositories(currentUserId, q)
        .then((rows) => {
          if (cancelled) return;
          setSearchResults(rows.slice(0, 10));
          setSearchOpen(true);
        })
        .catch(() => {
          if (!cancelled) {
            setSearchResults([]);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setSearchLoading(false);
          }
        });
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [authChecking, authToken, currentUserId, globalSearch, repoRevision]);

  const knownRepos = useMemo(() => {
    const map = new Map();
    memberRepos.forEach((repo) => map.set(repo.repository_id, repo));
    searchResults.forEach((repo) => {
      if (!map.has(repo.repository_id)) {
        map.set(repo.repository_id, repo);
      }
    });
    return map;
  }, [memberRepos, searchResults]);

  const filteredMemberRepos = useMemo(() => {
    const q = sidebarFilter.trim().toLowerCase();
    if (!q) return memberRepos;
    return memberRepos.filter((repo) => {
      const owner = repo?.owner?.username || "";
      const name = repo?.name || "";
      return `${owner}/${name}`.toLowerCase().includes(q);
    });
  }, [memberRepos, sidebarFilter]);

  const selectedRepo = selectedRepoId ? knownRepos.get(selectedRepoId) ?? selectedRepoMeta : null;
  const selectedRepoOwnerName =
    selectedRepo?.owner?.username ??
    (REPO_USE_MOCK
      ? mockUsers.find((u) => u.user_id === selectedRepo?.owner_id)?.username
      : undefined);

  const openRepository = (repoOrId, nextTab = "code") => {
    const repoId = typeof repoOrId === "number" ? repoOrId : repoOrId?.repository_id;
    if (!repoId) return;
    setSelectedRepoId(repoId);
    if (typeof repoOrId === "object") {
      setSelectedRepoMeta(repoOrId);
    }
    setActiveRepoTab(nextTab);
    setActivePanel("repository");
    setSearchOpen(false);
  };

  const handleNotificationNavigate = (notification) => {
    const type = notification?.type;

    if (type === "invitation") {
      setActivePanel("invitations");
      setUserMenuOpen(false);
      return;
    }

    if ((type === "accepted" || type === "declined") && notification?.repository_id) {
      openRepository(notification.repository_id, "collaborators");
      setUserMenuOpen(false);
    }
  };

  const handleRepositoryUnavailable = useCallback((repoId) => {
    if (!repoId) return;

    setMemberRepos((prev) => prev.filter((repo) => repo.repository_id !== repoId));

    if (selectedRepoId === repoId) {
      setSelectedRepoId(null);
      setSelectedRepoMeta(null);
      setActiveRepoTab("code");
      setActivePanel("repository");
    }

    setRepoRevision((v) => v + 1);
  }, [selectedRepoId]);

  const handleCreateRepository = async (payload) => {
    if (!currentUserId) {
      throw new Error("Could not identify current user. Please log in again.");
    }
    const created = await repoApi.createRepository(currentUserId, payload);
    setRepoRevision((v) => v + 1);
    openRepository(created, "settings");
  };

  const handleLeftRepository = (repoId) => {
    setRepoRevision((v) => v + 1);
    if (selectedRepoId === repoId) {
      setSelectedRepoId(null);
      setSelectedRepoMeta(null);
      setActiveRepoTab("code");
      setActivePanel("repository");
    }
  };

  const handleLogout = async () => {
    await apiLogout();
    setAuthToken(null);
    setAuthMode('login');
    setUserMenuOpen(false);
  };

  if (!authToken) {
    return authMode === 'login' ? (
      <Login
        onAuthSuccess={() => {
          setAuthToken(getAuthToken());
          // user will see RepositoryManagement as default view
        }}
        switchToSignup={() => setAuthMode('signup')}
      />
    ) : (
      <Signup
        onAuthSuccess={() => {
          setAuthToken(getAuthToken());
        }}
        switchToLogin={() => setAuthMode('login')}
      />
    );
  }

  if (authChecking) {
    return (
      <div className="min-h-screen bg-gh-canvas flex items-center justify-center text-gh-text-secondary">
        Verifying session...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gh-canvas">
      <header className="bg-gh-canvas-inset border-b border-gh-border sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-4 h-14 flex items-center gap-3">
          <div className="flex items-center gap-2 font-bold text-lg text-gh-text">
            <GitBranch size={22} />
            <span>HitGub</span>
          </div>

          <div ref={searchBoxRef} className="relative flex-1 max-w-xl ml-2">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gh-text-muted" />
            <input
              type="text"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              onFocus={() => {
                if (globalSearch.trim()) {
                  setSearchOpen(true);
                }
              }}
              placeholder="Search repositories"
              className="w-full pl-9 pr-3 py-2 text-sm bg-gh-canvas border border-gh-border rounded-md text-gh-text placeholder:text-gh-text-muted focus:outline-none focus:ring-2 focus:ring-gh-accent focus:border-gh-accent"
            />

            {searchOpen && globalSearch.trim() && (
              <div className="absolute left-0 right-0 mt-1 z-50 bg-gh-canvas-subtle border border-gh-border rounded-lg shadow-xl shadow-black/40 overflow-hidden">
                {searchLoading ? (
                  <div className="px-3 py-3 text-sm text-gh-text-secondary">Searching...</div>
                ) : searchResults.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-gh-text-secondary">No repositories found</div>
                ) : (
                  <div className="max-h-72 overflow-auto divide-y divide-gh-border-muted">
                    {searchResults.map((repo) => (
                      <button
                        type="button"
                        key={repo.repository_id}
                        onClick={() => openRepository(repo, "code")}
                        className="w-full text-left px-3 py-2.5 hover:bg-gh-overlay"
                      >
                        <div className="text-sm text-gh-text font-medium truncate">
                          {repo.owner?.username}/{repo.name}
                        </div>
                        <div className="text-xs text-gh-text-secondary truncate mt-0.5">
                          {repo.description || "No description"}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setActivePanel("invitations");
                setUserMenuOpen(false);
              }}
              className={`px-3 py-1.5 rounded-md text-sm border transition-colors flex items-center gap-1.5 ${
                activePanel === "invitations"
                  ? "border-gh-accent text-gh-accent bg-gh-accent/10"
                  : "border-gh-border text-gh-text-secondary hover:bg-gh-overlay"
              }`}
            >
              <Inbox size={14} />
              Invitations
            </button>

            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="px-3 py-1.5 rounded-md text-sm bg-gh-success-em text-white hover:bg-gh-success flex items-center gap-1.5"
            >
              <Plus size={14} />
              New repository
            </button>

            <NotificationDropdown
              currentUserId={currentUserId}
              onNotificationNavigate={handleNotificationNavigate}
            />

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setUserMenuOpen(!userMenuOpen);
                }}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/10 transition-colors"
              >
                <Avatar
                  username={currentUser?.username ?? getAuthUsername() ?? "user"}
                  avatarUrl={currentUser?.avatar_url}
                  size="sm"
                />
                <span className="text-sm font-medium text-gh-text">
                  {currentUser?.username ?? getAuthUsername() ?? "user"}
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
                    {REPO_USE_MOCK && (
                      <>
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
                            className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-gh-overlay ${user.user_id === currentUserId
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
                      </>
                    )}
                    {!REPO_USE_MOCK && (
                      <div className="px-3 py-2 text-sm text-gh-text-secondary">
                        <div className="font-medium text-gh-text truncate">
                          {currentUser?.full_name || currentUser?.username || getAuthUsername()}
                        </div>
                        <div className="text-xs text-gh-text-muted truncate">
                          @{currentUser?.username || getAuthUsername()}
                        </div>
                        {currentUser?.email && (
                          <div className="text-xs text-gh-text-muted truncate mt-0.5">
                            {currentUser.email}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="border-t border-gh-border mt-1 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setActivePanel("trash");
                          setUserMenuOpen(false);
                        }}
                        className={`w-full px-3 py-2 text-sm text-left hover:bg-gh-overlay flex items-center gap-2 ${
                          activePanel === "trash" ? "text-gh-accent" : "text-gh-text"
                        }`}
                      >
                        <Trash2 size={14} />
                        Repository trash
                      </button>
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="w-full px-3 py-2 text-sm text-red-500 hover:bg-gh-overlay text-left"
                      >
                        Log out
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 py-4 flex gap-4">
        <aside className="w-72 shrink-0">
          <div className="rounded-xl border border-gh-border bg-gh-canvas-subtle p-3">
            <div className="flex items-center gap-2 mb-3">
              <Avatar
                username={currentUser?.username ?? getAuthUsername() ?? "user"}
                avatarUrl={currentUser?.avatar_url}
                size="sm"
              />
              <div className="min-w-0">
                <div className="text-sm text-gh-text font-medium truncate">
                  {currentUser?.username ?? getAuthUsername() ?? "user"}
                </div>
                <div className="text-xs text-gh-text-muted">Top repositories</div>
              </div>
            </div>

            <input
              type="text"
              value={sidebarFilter}
              onChange={(e) => setSidebarFilter(e.target.value)}
              placeholder="Find a repository..."
              className="w-full px-3 py-2 text-sm bg-gh-canvas border border-gh-border rounded-md text-gh-text placeholder:text-gh-text-muted focus:outline-none focus:ring-2 focus:ring-gh-accent focus:border-gh-accent"
            />

            <div className="mt-3 max-h-[calc(100vh-220px)] overflow-auto pr-1 space-y-1">
              {filteredMemberRepos.map((repo) => (
                <button
                  key={repo.repository_id}
                  type="button"
                  onClick={() => openRepository(repo, "code")}
                  className={`w-full text-left px-2.5 py-2 rounded-md text-sm transition-colors ${
                    selectedRepoId === repo.repository_id && activePanel === "repository"
                      ? "bg-gh-accent/15 text-gh-accent"
                      : "text-gh-text-secondary hover:bg-gh-overlay hover:text-gh-text"
                  }`}
                >
                  <div className="truncate">
                    {repo.owner?.username}/{repo.name}
                  </div>
                </button>
              ))}
              {filteredMemberRepos.length === 0 && (
                <div className="text-xs text-gh-text-muted px-2 py-2">No repositories</div>
              )}
            </div>
          </div>
        </aside>

        <section className="flex-1 min-w-0">
          {activePanel === "invitations" ? (
            <PendingInvitations
              key={currentUserId ?? "me"}
              currentUserId={currentUserId}
              onRespond={() => setRepoRevision((v) => v + 1)}
            />
          ) : activePanel === "trash" ? (
            <RepositoryTrashPanel
              key={`trash-${currentUserId ?? "me"}-${repoRevision}`}
              currentUserId={currentUserId}
              onRepositoriesChanged={() => setRepoRevision((v) => v + 1)}
              onSelectRepo={(repoId) => openRepository(repoId, "settings")}
            />
          ) : selectedRepoId ? (
            <>
              <div className="bg-gh-canvas-subtle border border-gh-border rounded-xl px-4 py-3">
                <div className="flex items-center gap-2 text-sm">
                  <Avatar username={selectedRepoOwnerName ?? ""} size="sm" />
                  <span className="text-gh-text-secondary">{selectedRepoOwnerName}</span>
                  <span className="text-gh-text-muted">/</span>
                  <span className="font-semibold text-gh-accent">
                    {selectedRepo?.name ?? `repo-${selectedRepoId}`}
                  </span>
                  {selectedRepo?.visibility && (
                    <span className="text-xs border border-gh-border text-gh-text-secondary rounded-full px-2 py-0.5 ml-1">
                      {selectedRepo.visibility}
                    </span>
                  )}
                </div>

                <nav className="flex gap-1 mt-3 -mb-1">
                  {REPO_TABS.map(({ key, label, Icon }) => (
                    <button
                      type="button"
                      key={key}
                      onClick={() => setActiveRepoTab(key)}
                      className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                        activeRepoTab === key
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

              <div className="mt-4">
                {activeRepoTab === "code" && (
                  <RepositoryCodeView
                    key={`code-${selectedRepoId}-${currentUserId}`}
                    selectedRepoId={selectedRepoId}
                    currentUserId={currentUserId}
                    onRepositoryUnavailable={handleRepositoryUnavailable}
                  />
                )}
                {activeRepoTab === "settings" && (
                  <RepositoryManagement
                    key={`${selectedRepoId}-${currentUserId}-${repoRevision}`}
                    selectedRepoId={selectedRepoId}
                    currentUserId={currentUserId}
                    onSelectRepo={setSelectedRepoId}
                    onRepositoriesChanged={() => setRepoRevision((v) => v + 1)}
                  />
                )}
                {activeRepoTab === "collaborators" && (
                  <CollaboratorSettings
                    key={`${selectedRepoId}-${currentUserId}`}
                    repoId={selectedRepoId}
                    currentUserId={currentUserId}
                    onLeftRepository={handleLeftRepository}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-gh-border bg-gh-canvas-subtle p-8 text-center text-gh-text-secondary">
              Select a repository from the left sidebar or search above to begin.
            </div>
          )}
        </section>
      </main>

      <CreateRepositoryModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreateRepository}
      />
    </div>
  );
}
