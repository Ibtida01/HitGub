import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { repoApi } from "../../services/repoApi.js";
import { timeAgo } from "../../utils/datetime.js";

export function RepositoryTrashPanel({
  currentUserId,
  onRepositoriesChanged,
  onSelectRepo,
}) {
  const [loading, setLoading] = useState(true);
  const [deletedRepos, setDeletedRepos] = useState([]);
  const [toPermanentDelete, setToPermanentDelete] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((type, message) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const loadTrash = useCallback(async () => {
    if (!currentUserId) {
      setDeletedRepos([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const rows = await repoApi.listDeletedRepositoriesForUser(currentUserId);
      setDeletedRepos(rows);
    } catch (e) {
      showToast(
        "error",
        e instanceof Error ? e.message : "Failed to load repository trash",
      );
    } finally {
      setLoading(false);
    }
  }, [currentUserId, showToast]);

  useEffect(() => {
    loadTrash();
  }, [loadTrash]);

  const handleRestoreRepository = async (repoId, repoName) => {
    try {
      await repoApi.restoreRepository(repoId, currentUserId);
      showToast("success", `${repoName} restored from trash`);
      onRepositoriesChanged?.();
      onSelectRepo?.(repoId);
      await loadTrash();
    } catch (e) {
      showToast(
        "error",
        e instanceof Error ? e.message : "Failed to restore repository",
      );
    }
  };

  const handlePermanentDeleteRepository = async () => {
    if (!toPermanentDelete) return;

    try {
      await repoApi.permanentlyDeleteRepository(
        toPermanentDelete.repository_id,
        currentUserId,
      );
      showToast("success", `${toPermanentDelete.name} permanently deleted`);
      setToPermanentDelete(null);
      onRepositoriesChanged?.();
      await loadTrash();
    } catch (e) {
      showToast(
        "error",
        e instanceof Error
          ? e.message
          : "Failed to permanently delete repository",
      );
    }
  };

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
        <h3 className="font-semibold text-gh-text mb-2">Repository Trash</h3>
        <p className="text-sm text-gh-text-secondary mb-4">
          This trash is tied to your owner account. Only repositories you own
          can appear here.
        </p>

        {loading ? (
          <div className="py-8 text-center text-gh-text-secondary">
            <Loader2 className="animate-spin mx-auto mb-2" />
            Loading trash...
          </div>
        ) : deletedRepos.length === 0 ? (
          <p className="text-sm text-gh-text-secondary">Trash is empty.</p>
        ) : (
          <div className="divide-y divide-gh-border-muted rounded-lg border border-gh-border overflow-hidden">
            {deletedRepos.map((deletedRepo) => (
              <div
                key={deletedRepo.repository_id}
                className="px-4 py-3 bg-gh-canvas flex flex-wrap items-center gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-gh-text font-medium truncate">
                    {deletedRepo.name}
                  </div>
                  <div className="text-xs text-gh-text-secondary mt-1">
                    Deleted {timeAgo(deletedRepo.deleted_at, { emptyLabel: "just now" })} • {deletedRepo.days_left} day(s) left to restore
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      handleRestoreRepository(
                        deletedRepo.repository_id,
                        deletedRepo.name,
                      )
                    }
                    disabled={deletedRepo.days_left <= 0}
                    className="text-xs px-2.5 py-1.5 rounded-md border border-gh-border text-gh-text hover:bg-gh-overlay disabled:opacity-50 flex items-center gap-1"
                  >
                    <RotateCcw size={12} />
                    Restore
                  </button>
                  <button
                    type="button"
                    onClick={() => setToPermanentDelete(deletedRepo)}
                    className="text-xs px-2.5 py-1.5 rounded-md border border-gh-danger/40 text-gh-danger hover:bg-red-400/10"
                  >
                    Permanently delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {toPermanentDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setToPermanentDelete(null)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-md bg-gh-canvas-subtle border border-gh-border rounded-xl p-5">
            <h4 className="text-base font-semibold text-gh-text">
              Permanently delete repository
            </h4>
            <p className="text-sm text-gh-text-secondary mt-2">
              Permanently delete{" "}
              <span className="font-medium text-gh-text">
                {toPermanentDelete.name}
              </span>
              ? This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setToPermanentDelete(null)}
                className="px-3 py-1.5 text-sm border border-gh-border rounded-md text-gh-text"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePermanentDeleteRepository}
                className="px-3 py-1.5 text-sm rounded-md bg-gh-danger-em text-white flex items-center gap-1"
              >
                <Trash2 size={12} />
                Permanently delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
