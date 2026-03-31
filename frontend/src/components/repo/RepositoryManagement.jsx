import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  GitBranch,
  Loader2,
  Lock,
  Save,
  Settings,
  Shield,
  Trash2,
} from "lucide-react";
import { repoApi } from "../../services/repoApi.js";
import { Avatar } from "../collab/Avatar.jsx";
import { RoleBadge } from "../collab/RoleBadge.jsx";
import { timeAgo } from "../../utils/datetime.js";

const LICENSE_OPTIONS = [
  { value: "", label: "No license" },
  { value: "MIT", label: "MIT License" },
  { value: "Apache-2.0", label: "Apache 2.0" },
  { value: "GPL-3.0", label: "GNU GPL v3.0" },
  { value: "BSD-3-Clause", label: "BSD 3-Clause" },
];

function SummaryPill({ label, value }) {
  return (
    <div className="rounded-lg border border-gh-border bg-gh-canvas px-3 py-2">
      <div className="text-xs text-gh-text-muted uppercase tracking-wide">
        {label}
      </div>
      <div className="text-lg font-semibold text-gh-text">{value}</div>
    </div>
  );
}

export function RepositoryManagement({
  currentUserId,
  selectedRepoId,
  onSelectRepo,
  onRepositoriesChanged,
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [repoRole, setRepoRole] = useState(null);
  const [repo, setRepo] = useState(null);
  const [branches, setBranches] = useState([]);
  const [stats, setStats] = useState(null);
  const [accessSummary, setAccessSummary] = useState(null);
  const [newBranchName, setNewBranchName] = useState("");
  const [toDeleteBranch, setToDeleteBranch] = useState(null);
  const [repoForm, setRepoForm] = useState({
    name: "",
    description: "",
    visibility: "public",
    license_type: "",
    has_readme: false,
    default_branch: "main",
  });
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [toast, setToast] = useState(null);

  const showToast = useCallback((type, message) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (!selectedRepoId) {
        setRepo(null);
        setRepoRole(null);
        setBranches([]);
        setStats(null);
        setAccessSummary(null);
        return;
      }

      const results = await Promise.allSettled([
        repoApi.getRepository(selectedRepoId),
        repoApi.getRepositoryRole(selectedRepoId, currentUserId),
        repoApi.getBranches(selectedRepoId),
        repoApi.getRepositoryStats(selectedRepoId),
        repoApi.getAccessSummary(selectedRepoId),
      ]);

      const [
        repoResult,
        roleResult,
        branchResult,
        statsResult,
        summaryResult,
      ] = results;

      const repoData =
        repoResult.status === "fulfilled" ? repoResult.value : null;
      const role = roleResult.status === "fulfilled" ? roleResult.value : null;
      const branchRows =
        branchResult.status === "fulfilled" ? branchResult.value : [];
      const statRows =
        statsResult.status === "fulfilled" ? statsResult.value : null;
      const summaryRows =
        summaryResult.status === "fulfilled" ? summaryResult.value : null;

      setRepo(repoData);
      setRepoRole(role);
      setBranches(branchRows);
      setStats(statRows);
      setAccessSummary(summaryRows);

      if (repoData) {
        setRepoForm({
          name: repoData.name,
          description: repoData.description || "",
          visibility: repoData.visibility,
          license_type: repoData.license_type || "",
          has_readme: !!repoData.has_readme,
          default_branch: repoData.default_branch || "main",
        });
      }

      // Show error toast only if repo fetch failed.
      if (repoResult.status === "rejected" && !repoData) {
        showToast("error", "Unable to load selected repository.");
      }
    } catch (e) {
      showToast(
        "error",
        e instanceof Error ? e.message : "Failed to load repository data",
      );
    } finally {
      setLoading(false);
    }
  }, [selectedRepoId, currentUserId, showToast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const canWrite = repoRole === "owner" || repoRole === "contributor";
  const canAdmin = repoRole === "owner";

  const visibleBranches = useMemo(() => {
    return [...branches].sort((a, b) => {
      if (a.is_default) return -1;
      if (b.is_default) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [branches]);

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      await repoApi.updateRepository(selectedRepoId, repoForm, currentUserId);
      showToast("success", "Repository settings updated");
      onRepositoriesChanged();
      await refresh();
    } catch (e) {
      showToast(
        "error",
        e instanceof Error ? e.message : "Failed to update repository",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return;
    try {
      await repoApi.createBranch(
        selectedRepoId,
        { name: newBranchName.trim() },
        currentUserId,
      );
      setNewBranchName("");
      showToast("success", "Branch created");
      await refresh();
    } catch (e) {
      showToast(
        "error",
        e instanceof Error ? e.message : "Failed to create branch",
      );
    }
  };

  const handleToggleProtection = async (branch) => {
    try {
      await repoApi.updateBranchProtection(
        selectedRepoId,
        branch.branch_id,
        !branch.is_protected,
        currentUserId,
      );
      showToast("success", "Branch protection updated");
      await refresh();
    } catch (e) {
      showToast(
        "error",
        e instanceof Error ? e.message : "Failed to update protection",
      );
    }
  };

  const handleSetDefault = async (branch) => {
    try {
      await repoApi.setDefaultBranch(
        selectedRepoId,
        branch.branch_id,
        currentUserId,
      );
      showToast("success", `${branch.name} is now default branch`);
      await refresh();
    } catch (e) {
      showToast(
        "error",
        e instanceof Error ? e.message : "Failed to set default branch",
      );
    }
  };

  const handleDeleteBranch = async (branch) => {
    try {
      await repoApi.deleteBranch(
        selectedRepoId,
        branch.branch_id,
        currentUserId,
      );
      setToDeleteBranch(null);
      showToast("success", "Branch deleted");
      await refresh();
    } catch (e) {
      showToast(
        "error",
        e instanceof Error ? e.message : "Failed to delete branch",
      );
    }
  };

  const handleDeleteRepository = async () => {
    if (!repo || deleteConfirm !== repo.name) return;

    try {
      await repoApi.deleteRepository(selectedRepoId, currentUserId);
      showToast(
        "success",
        "Repository moved to trash. You can restore it within 30 days.",
      );
      onRepositoriesChanged();
      const activeRepos = await repoApi.listRepositoriesForUser(currentUserId);
      if (activeRepos[0]) {
        onSelectRepo(activeRepos[0].repository_id);
      } else {
        onSelectRepo(null);
        setRepo(null);
        setRepoRole(null);
        setBranches([]);
        setStats(null);
        setAccessSummary(null);
        setDeleteConfirm("");
      }
      setDeleteConfirm("");
    } catch (e) {
      showToast(
        "error",
        e instanceof Error ? e.message : "Failed to delete repository",
      );
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-gh-border bg-gh-canvas-subtle p-8 text-center text-gh-text-secondary">
        <Loader2 className="animate-spin mx-auto mb-3" />
        Loading repository management data...
      </div>
    );
  }

  if (selectedRepoId && !repo) {
    return (
      <div className="rounded-xl border border-gh-border bg-gh-canvas-subtle p-8 text-center text-gh-text-secondary">
        Unable to load selected repository.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {toast && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm flex items-center gap-2 ${
            toast.type === "success"
              ? "border-gh-success/40 bg-gh-success/10 text-gh-success"
              : "border-gh-danger/40 bg-gh-danger/10 text-gh-danger"
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle2 size={16} />
          ) : (
            <AlertCircle size={16} />
          )}
          {toast.message}
        </div>
      )}

      <section className="rounded-xl border border-gh-border bg-gh-canvas-subtle p-5">
        <div>
          <div>
            <h2 className="text-lg font-semibold text-gh-text">
              Repository Settings
            </h2>
            <p className="text-sm text-gh-text-secondary mt-1">
              Configure the selected repository and manage branch-level controls.
            </p>
            {repo && (
              <div className="mt-3 flex items-center gap-2 text-sm">
                {repoRole ? (
                  <RoleBadge role={repoRole} />
                ) : (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border border-gh-border text-gh-text-secondary">
                    Visitor
                  </span>
                )}
                <span className="text-gh-text-secondary">
                  Current repository role
                </span>
              </div>
            )}
          </div>
        </div>
      </section>

      {!repo && (
        <section className="rounded-xl border border-gh-border bg-gh-canvas-subtle p-6 text-gh-text-secondary">
          <p className="text-sm">
            No repository selected yet. Create your first repository using the
            <span className="text-gh-text font-medium"> New repository </span>
            button above, or pick one from the repo dropdown.
          </p>
        </section>
      )}

      {repo && (
        <>
          <section className="rounded-xl border border-gh-border bg-gh-canvas-subtle p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2 min-w-0">
                <Avatar
                  username={repo.owner?.username || ""}
                  avatarUrl={repo.owner?.avatar_url}
                  size="sm"
                />
                <h3 className="font-semibold text-gh-text truncate">
                  {repo.owner?.username}/{repo.name}
                </h3>
                <span className="text-xs border border-gh-border rounded-full px-2 py-0.5 text-gh-text-secondary">
                  {repo.visibility}
                </span>
              </div>
              <button
                type="button"
                onClick={refresh}
                className="text-sm px-3 py-1.5 border border-gh-border rounded-md text-gh-text hover:bg-gh-overlay"
              >
                Refresh
              </button>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <SummaryPill label="Branches" value={stats?.branch_count ?? 0} />
              <SummaryPill
                label="Protected"
                value={stats?.protected_branch_count ?? 0}
              />
              <SummaryPill
                label="Collaborators"
                value={stats?.collaborator_count ?? 0}
              />
              <SummaryPill
                label="Pending Invites"
                value={stats?.pending_invitation_count ?? 0}
              />
            </div>
          </section>

          <section className="rounded-xl border border-gh-border bg-gh-canvas-subtle p-5">
            <div className="flex items-center gap-2 mb-4">
              <GitBranch size={17} className="text-gh-accent" />
              <h3 className="font-semibold text-gh-text">Branches</h3>
            </div>

            {canWrite && (
              <div className="mb-4 flex gap-2">
                <input
                  type="text"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="feature/your-branch"
                  className="flex-1 border border-gh-border rounded-md px-3 py-2 text-sm bg-gh-canvas text-gh-text placeholder:text-gh-text-muted"
                />
                <button
                  type="button"
                  onClick={handleCreateBranch}
                  disabled={!newBranchName.trim()}
                  className="px-3 py-2 rounded-md text-sm bg-gh-success-em text-white hover:bg-gh-success disabled:opacity-50"
                >
                  Create branch
                </button>
              </div>
            )}

            <div className="divide-y divide-gh-border-muted rounded-lg border border-gh-border overflow-hidden">
              {visibleBranches.map((branch) => (
                <div
                  key={branch.branch_id}
                  className="px-4 py-3 flex flex-wrap items-center gap-3 bg-gh-canvas hover:bg-gh-overlay"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm text-gh-text">
                      <span className="font-medium truncate">
                        {branch.name}
                      </span>
                      {branch.is_default && (
                        <span className="text-xs bg-gh-accent/20 text-gh-accent rounded-full px-2 py-0.5">
                          default
                        </span>
                      )}
                      {branch.is_protected && (
                        <span className="text-xs bg-gh-warning/20 text-gh-warning rounded-full px-2 py-0.5 flex items-center gap-1">
                          <Lock size={12} /> protected
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gh-text-secondary mt-1">
                      Last commit {timeAgo(branch.last_commit_at, { emptyLabel: "No commits yet" })}
                    </div>
                  </div>

                  {canAdmin && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleToggleProtection(branch)}
                        className="text-xs px-2.5 py-1.5 rounded-md border border-gh-border text-gh-text hover:bg-gh-overlay"
                      >
                        {branch.is_protected ? "Unprotect" : "Protect"}
                      </button>
                      {!branch.is_default && (
                        <button
                          type="button"
                          onClick={() => handleSetDefault(branch)}
                          className="text-xs px-2.5 py-1.5 rounded-md border border-gh-border text-gh-text hover:bg-gh-overlay"
                        >
                          Set default
                        </button>
                      )}
                      {!branch.is_default && (
                        <button
                          type="button"
                          onClick={() => setToDeleteBranch(branch)}
                          className="text-xs px-2.5 py-1.5 rounded-md border border-gh-danger/40 text-gh-danger hover:bg-red-400/10"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-gh-border bg-gh-canvas-subtle p-5">
            <div className="flex items-center gap-2 mb-4">
              <Shield size={17} className="text-gh-accent" />
              <h3 className="font-semibold text-gh-text">
                Access Control and Permissions
              </h3>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryPill
                label="Owners"
                value={accessSummary?.by_role?.owner ?? 0}
              />
              <SummaryPill
                label="Contributors"
                value={accessSummary?.by_role?.contributor ?? 0}
              />
              <SummaryPill
                label="Read-only"
                value={accessSummary?.by_role?.["read-only"] ?? 0}
              />
              <SummaryPill
                label="Pending"
                value={accessSummary?.by_status?.pending ?? 0}
              />
            </div>
          </section>

          {canAdmin && (
            <section className="rounded-xl border border-gh-border bg-gh-canvas-subtle p-5">
              <div className="flex items-center gap-2 mb-4">
                <Settings size={17} className="text-gh-accent" />
                <h3 className="font-semibold text-gh-text">
                  Repository Configuration
                </h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gh-text mb-1.5">
                    Repository name
                  </label>
                  <input
                    type="text"
                    value={repoForm.name}
                    onChange={(e) =>
                      setRepoForm((p) => ({ ...p, name: e.target.value }))
                    }
                    className="w-full border border-gh-border rounded-md px-3 py-2 text-sm bg-gh-canvas text-gh-text"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gh-text mb-1.5">
                    Visibility
                  </label>
                  <select
                    value={repoForm.visibility}
                    onChange={(e) =>
                      setRepoForm((p) => ({ ...p, visibility: e.target.value }))
                    }
                    className="w-full border border-gh-border rounded-md px-3 py-2 text-sm bg-gh-canvas text-gh-text"
                  >
                    <option value="public">Public</option>
                    <option value="private">Private</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm text-gh-text mb-1.5">
                    Description
                  </label>
                  <textarea
                    rows={3}
                    value={repoForm.description}
                    onChange={(e) =>
                      setRepoForm((p) => ({ ...p, description: e.target.value }))
                    }
                    className="w-full border border-gh-border rounded-md px-3 py-2 text-sm bg-gh-canvas text-gh-text"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gh-text mb-1.5">
                    License
                  </label>
                  <select
                    value={repoForm.license_type}
                    onChange={(e) =>
                      setRepoForm((p) => ({ ...p, license_type: e.target.value }))
                    }
                    className="w-full border border-gh-border rounded-md px-3 py-2 text-sm bg-gh-canvas text-gh-text"
                  >
                    {LICENSE_OPTIONS.map((opt) => (
                      <option key={opt.label} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-gh-text mb-1.5">
                    Default branch
                  </label>
                  <select
                    value={repoForm.default_branch}
                    onChange={(e) =>
                      setRepoForm((p) => ({
                        ...p,
                        default_branch: e.target.value,
                      }))
                    }
                    className="w-full border border-gh-border rounded-md px-3 py-2 text-sm bg-gh-canvas text-gh-text"
                  >
                    {branches.map((branch) => (
                      <option key={branch.branch_id} value={branch.name}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </div>

                <label className="md:col-span-2 flex items-center gap-2 text-sm text-gh-text-secondary">
                  <input
                    type="checkbox"
                    checked={repoForm.has_readme}
                    onChange={(e) =>
                      setRepoForm((p) => ({ ...p, has_readme: e.target.checked }))
                    }
                    className="accent-gh-accent"
                  />
                  Repository has README
                </label>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={handleSaveSettings}
                  disabled={saving}
                  className="px-4 py-2 rounded-md text-sm bg-gh-accent-em text-white hover:bg-gh-accent disabled:opacity-50 flex items-center gap-1.5"
                >
                  {saving ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Save size={14} />
                  )}
                  Save settings
                </button>
              </div>
            </section>
          )}

          {canAdmin && (
            <section className="rounded-xl border border-gh-danger/40 bg-red-400/5 p-5">
              <h3 className="font-semibold text-gh-danger mb-2">Danger Zone</h3>
              <p className="text-sm text-gh-text-secondary mb-3">
                This will move the repository to trash. It can be restored
                within 30 days unless permanently deleted from trash.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
                <input
                  type="text"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder={`Type ${repo.name} to confirm`}
                  className="w-full border border-gh-danger/40 rounded-md px-3 py-2 text-sm bg-gh-canvas text-gh-text"
                />
                <button
                  type="button"
                  onClick={handleDeleteRepository}
                  disabled={deleteConfirm !== repo.name}
                  className="px-4 py-2 rounded-md text-sm bg-gh-danger-em text-white hover:bg-gh-danger disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Trash2 size={14} />
                  Move to trash
                </button>
              </div>
            </section>
          )}
        </>
      )}

      {toDeleteBranch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setToDeleteBranch(null)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-md bg-gh-canvas-subtle border border-gh-border rounded-xl p-5">
            <h4 className="text-base font-semibold text-gh-text">
              Delete branch
            </h4>
            <p className="text-sm text-gh-text-secondary mt-2">
              Delete{" "}
              <span className="font-medium text-gh-text">
                {toDeleteBranch.name}
              </span>
              ? This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setToDeleteBranch(null)}
                className="px-3 py-1.5 text-sm border border-gh-border rounded-md text-gh-text"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDeleteBranch(toDeleteBranch)}
                className="px-3 py-1.5 text-sm rounded-md bg-gh-danger-em text-white"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
