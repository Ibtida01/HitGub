import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronUp,
  ChevronRight,
  Download,
  File,
  Folder,
  FolderPlus,
  GitBranch,
  Loader2,
  Trash2,
  Upload,
} from 'lucide-react';
import { repoApi } from '../../services/repoApi.js';
import { formatApiDateTime } from '../../utils/datetime.js';

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function RepositoryCodeView({ selectedRepoId, currentUserId, onRepositoryUnavailable }) {
  const [repo, setRepo] = useState(null);
  const [repoRole, setRepoRole] = useState(null);
  const [branches, setBranches] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState(null);
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [deletingPath, setDeletingPath] = useState(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedUploads, setSelectedUploads] = useState([]);
  const [toast, setToast] = useState(null);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const showToast = useCallback((type, message) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const canWrite = repoRole === 'owner' || repoRole === 'contributor' || repoRole === 'maintainer';

  const selectedBranch = useMemo(
    () => branches.find((b) => b.branch_id === selectedBranchId) || null,
    [branches, selectedBranchId]
  );

  const breadcrumbs = useMemo(() => {
    if (!currentPath) return [];
    const parts = currentPath.split('/');
    return parts.map((name, idx) => ({
      name,
      path: parts.slice(0, idx + 1).join('/'),
    }));
  }, [currentPath]);

  const parentPath = useMemo(() => {
    if (!currentPath) return null;
    const parts = currentPath.split('/');
    parts.pop();
    return parts.join('/');
  }, [currentPath]);

  const folderSelectionCount = useMemo(
    () => selectedUploads.filter((entry) => !!entry.relativePath).length,
    [selectedUploads]
  );

  const loadRepoContext = useCallback(async () => {
    if (!selectedRepoId) {
      setRepo(null);
      setRepoRole(null);
      setBranches([]);
      setSelectedBranchId(null);
      setEntries([]);
      setCurrentPath('');
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [repoData, role, branchRows] = await Promise.all([
        repoApi.getRepository(selectedRepoId),
        repoApi.getRepositoryRole(selectedRepoId, currentUserId),
        repoApi.getBranches(selectedRepoId),
      ]);

      setRepo(repoData);
      setRepoRole(role);
      setBranches(branchRows);

      const defaultBranch =
        branchRows.find((b) => b.is_default)?.branch_id ?? branchRows[0]?.branch_id ?? null;
      setSelectedBranchId(defaultBranch);
      setCurrentPath('');
      setSelectedUploads([]);
      setCommitMessage('');
      setNewFolderName('');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load repository code view';
      if (
        typeof onRepositoryUnavailable === 'function' &&
        /Repository not found|Access denied|404|403/i.test(message)
      ) {
        onRepositoryUnavailable(selectedRepoId);
        return;
      }

      showToast('error', message);
    } finally {
      setLoading(false);
    }
  }, [selectedRepoId, currentUserId, showToast, onRepositoryUnavailable]);

  const loadBranchEntries = useCallback(
    async (branchId, pathValue) => {
      if (!selectedRepoId || !branchId) {
        setEntries([]);
        return;
      }

      setLoading(true);

      try {
        const data = await repoApi.listBranchFiles(selectedRepoId, branchId, pathValue);
        setEntries(data.entries || []);
      } catch (e) {
        showToast('error', e instanceof Error ? e.message : 'Failed to load branch files');
      } finally {
        setLoading(false);
      }
    },
    [selectedRepoId, showToast]
  );

  useEffect(() => {
    loadRepoContext();
  }, [loadRepoContext]);

  useEffect(() => {
    if (!selectedBranchId) {
      setEntries([]);
      return;
    }
    loadBranchEntries(selectedBranchId, currentPath);
  }, [selectedBranchId, currentPath, loadBranchEntries]);

  const handleDownload = async (entry) => {
    try {
      const blob =
        entry.type === 'dir'
          ? await repoApi.downloadBranchFolder(selectedRepoId, selectedBranchId, entry.path)
          : await repoApi.downloadBranchFile(selectedRepoId, selectedBranchId, entry.path);

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = entry.type === 'dir' ? `${entry.name || 'folder'}.zip` : entry.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast(
        'error',
        e instanceof Error
          ? e.message
          : entry.type === 'dir'
            ? 'Failed to download folder'
            : 'Failed to download file'
      );
    }
  };

  const handleUpload = async () => {
    if (!canWrite) return;
    if (!commitMessage.trim()) {
      showToast('error', 'Commit message is required');
      return;
    }
    if (!selectedUploads.length) {
      showToast('error', 'Select at least one file to upload');
      return;
    }

    setUploading(true);
    try {
      const result = await repoApi.uploadBranchFiles(
        selectedRepoId,
        selectedBranchId,
        {
          files: selectedUploads,
          commitMessage,
          targetPath: currentPath,
        },
        currentUserId
      );
      setSelectedUploads([]);
      setCommitMessage('');
      showToast(
        'success',
        `Committed ${result.changed_files?.length || selectedUploads.length} file(s) to ${selectedBranch?.name}`
      );
      await loadBranchEntries(selectedBranchId, currentPath);
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleChooseFiles = () => {
    if (!canWrite) return;
    fileInputRef.current?.click();
  };

  const handleChooseFolder = () => {
    if (!canWrite) return;
    folderInputRef.current?.click();
  };

  const handleCreateFolder = async () => {
    if (!canWrite) return;
    if (!selectedBranchId) return;

    const normalizedFolder = newFolderName
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '');

    if (!normalizedFolder) {
      showToast('error', 'Folder name/path is required');
      return;
    }
    if (!commitMessage.trim()) {
      showToast('error', 'Commit message is required');
      return;
    }

    const folderPath = currentPath ? `${currentPath}/${normalizedFolder}` : normalizedFolder;

    setCreatingFolder(true);
    try {
      await repoApi.createBranchFolder(
        selectedRepoId,
        selectedBranchId,
        { folderPath, commitMessage },
        currentUserId
      );
      setNewFolderName('');
      setCommitMessage('');
      showToast('success', `Created folder ${normalizedFolder}`);
      await loadBranchEntries(selectedBranchId, currentPath);
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : 'Failed to create folder');
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleDeleteEntry = async (entry) => {
    if (!canWrite || !selectedBranchId) return;

    const confirmed = window.confirm(
      entry.type === 'dir'
        ? `Delete folder "${entry.path}" and all nested content?`
        : `Delete file "${entry.path}"?`
    );
    if (!confirmed) return;

    setDeletingPath(entry.path);
    try {
      if (entry.type === 'dir') {
        await repoApi.deleteBranchFolder(
          selectedRepoId,
          selectedBranchId,
          entry.path,
          commitMessage,
          currentUserId
        );
      } else {
        await repoApi.deleteBranchFile(
          selectedRepoId,
          selectedBranchId,
          entry.path,
          commitMessage,
          currentUserId
        );
      }

      if (commitMessage.trim()) {
        setCommitMessage('');
      }
      showToast('success', `${entry.type === 'dir' ? 'Folder' : 'File'} deleted`);
      await loadBranchEntries(selectedBranchId, currentPath);
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingPath(null);
    }
  };

  if (!selectedRepoId) {
    return (
      <div className="rounded-lg border border-gh-border bg-gh-canvas-subtle p-6 text-gh-text-secondary">
        Select a repository to browse code.
      </div>
    );
  }

  if (loading && !repo) {
    return (
      <div className="rounded-lg border border-gh-border bg-gh-canvas-subtle p-8 text-center text-gh-text-secondary">
        <Loader2 className="animate-spin mx-auto mb-3" />
        Loading code view...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {toast && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            toast.type === 'success'
              ? 'border-gh-success/40 bg-gh-success/10 text-gh-success'
              : 'border-gh-danger/40 bg-gh-danger/10 text-gh-danger'
          }`}
        >
          {toast.message}
        </div>
      )}

      <section className="rounded-xl border border-gh-border bg-gh-canvas-subtle p-4">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-2 text-gh-text">
            <GitBranch size={16} />
            <span className="font-semibold">Code</span>
            <span className="text-gh-text-muted">{repo?.name}</span>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-gh-text-secondary">Branch</label>
            <select
              value={selectedBranchId ?? ''}
              onChange={(e) => {
                setSelectedBranchId(Number(e.target.value));
                setCurrentPath('');
                setSelectedUploads([]);
              }}
              className="border border-gh-border rounded-md px-2 py-1.5 text-sm bg-gh-canvas text-gh-text"
            >
              {branches.map((branch) => (
                <option key={branch.branch_id} value={branch.branch_id}>
                  {branch.name}
                  {branch.is_default ? ' (default)' : ''}
                </option>
              ))}
            </select>

            {canWrite && (
              <button
                type="button"
                onClick={handleChooseFiles}
                className="px-3 py-1.5 rounded-md text-sm bg-gh-success-em text-white hover:bg-gh-success inline-flex items-center gap-1.5"
              >
                <Upload size={14} />
                Add file
              </button>
            )}

            {canWrite && (
              <button
                type="button"
                onClick={handleChooseFolder}
                className="px-3 py-1.5 rounded-md text-sm border border-gh-border text-gh-text hover:bg-gh-overlay inline-flex items-center gap-1.5"
              >
                <Folder size={14} />
                Add folder
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 text-sm text-gh-text-secondary flex-wrap">
          <button
            type="button"
            onClick={() => setCurrentPath('')}
            className="hover:text-gh-text"
          >
            /
          </button>
          {breadcrumbs.map((crumb) => (
            <span key={crumb.path} className="inline-flex items-center gap-2">
              <ChevronRight size={14} />
              <button
                type="button"
                onClick={() => setCurrentPath(crumb.path)}
                className="hover:text-gh-text"
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            setSelectedUploads(files.map((file) => ({ file, relativePath: '' })));
          }}
        />

        <input
          ref={folderInputRef}
          type="file"
          multiple
          webkitdirectory=""
          directory=""
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            setSelectedUploads(
              files.map((file) => ({
                file,
                relativePath: file.webkitRelativePath || file.name,
              }))
            );
          }}
        />
      </section>

      {canWrite && (
        <section className="rounded-xl border border-gh-border bg-gh-canvas-subtle p-4">
          <h3 className="text-sm font-semibold text-gh-text mb-2">Add content</h3>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-3">
            <input
              type="text"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="Commit message"
              className="border border-gh-border rounded-md px-3 py-2 text-sm bg-gh-canvas text-gh-text"
            />
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading || !selectedBranchId || selectedUploads.length === 0}
              className="px-3 py-1.5 rounded-md text-sm bg-gh-success-em text-white hover:bg-gh-success disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Commit upload
            </button>
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-3">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="New folder name or path"
              className="border border-gh-border rounded-md px-3 py-2 text-sm bg-gh-canvas text-gh-text"
            />
            <button
              type="button"
              onClick={handleCreateFolder}
              disabled={creatingFolder || !selectedBranchId}
              className="px-3 py-1.5 rounded-md text-sm border border-gh-border text-gh-text hover:bg-gh-overlay disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {creatingFolder ? <Loader2 size={14} className="animate-spin" /> : <FolderPlus size={14} />}
              Create folder
            </button>
          </div>

          <div className="mt-2 text-xs text-gh-text-muted">
            <span className="text-xs text-gh-text-muted">
              {selectedUploads.length > 0
                ? `${selectedUploads.length} file(s) selected${folderSelectionCount > 0 ? ' (folder upload)' : ''}`
                : 'No files selected'}
            </span>
          </div>
        </section>
      )}

      {!canWrite && (
        <section className="rounded-xl border border-gh-border bg-gh-canvas-subtle p-4 text-sm text-gh-text-secondary">
          You currently have read-only access on this repository/branch. Upload, folder creation, and delete actions are disabled.
        </section>
      )}

      <section className="rounded-xl border border-gh-border bg-gh-canvas-subtle overflow-hidden">
        <div className="px-4 py-3 border-b border-gh-border text-sm font-medium text-gh-text flex items-center justify-between gap-2">
          <span>{selectedBranch ? `Files in ${selectedBranch.name}` : 'Files'}</span>
          <span className="text-xs text-gh-text-secondary">Path: /{currentPath || ''}</span>
        </div>

        <div className="hidden md:grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px_100px_140px] gap-3 px-4 py-2 text-xs text-gh-text-muted border-b border-gh-border-muted bg-gh-canvas">
          <span>Name</span>
          <span>Commit message</span>
          <span>Last updated</span>
          <span>Size</span>
          <span>Actions</span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gh-text-secondary">
            <Loader2 className="animate-spin mx-auto mb-2" />
            Loading files...
          </div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center text-gh-text-secondary">
            This location is empty.
          </div>
        ) : (
          <div className="divide-y divide-gh-border-muted">
            {parentPath !== null && (
              <div className="px-4 py-3 bg-gh-canvas hover:bg-gh-overlay grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px_100px_140px] gap-3 items-center">
                <button
                  type="button"
                  onClick={() => setCurrentPath(parentPath)}
                  className="flex items-center gap-2 text-sm text-gh-text hover:underline"
                >
                  <ChevronUp size={16} className="text-gh-text-secondary" />
                  ..
                </button>
                <span className="text-xs text-gh-text-secondary hidden md:block">-</span>
                <span className="text-xs text-gh-text-secondary hidden md:block">-</span>
                <span className="text-xs text-gh-text-secondary hidden md:block">-</span>
                <span className="text-xs text-gh-text-secondary hidden md:block">-</span>
              </div>
            )}

            {entries.map((entry) => (
              <div
                key={`${entry.type}-${entry.path}`}
                className="px-4 py-3 bg-gh-canvas hover:bg-gh-overlay grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px_100px_140px] gap-3 items-center"
              >
                <div className="min-w-0 flex items-center gap-2">
                  <span className="text-gh-text-secondary">
                    {entry.type === 'dir' ? <Folder size={16} /> : <File size={16} />}
                  </span>
                  {entry.type === 'dir' ? (
                    <button
                      type="button"
                      onClick={() => setCurrentPath(entry.path)}
                      className="text-sm text-gh-text hover:underline"
                    >
                      {entry.name}
                    </button>
                  ) : (
                    <div className="text-sm text-gh-text truncate">{entry.name}</div>
                  )}
                </div>

                <div className="text-xs text-gh-text-secondary truncate">
                  {entry.commit_message || '-'}
                </div>

                <div className="text-xs text-gh-text-secondary">
                  {entry.updated_at ? formatApiDateTime(entry.updated_at) : '-'}
                </div>

                <div className="text-xs text-gh-text-secondary">
                  {entry.type === 'file' ? formatBytes(entry.size_bytes) : '-'}
                </div>

                <div className="flex items-center gap-2">
                  {(entry.type === 'file' || entry.type === 'dir') && (
                    <button
                      type="button"
                      onClick={() => handleDownload(entry)}
                      aria-label={entry.type === 'dir' ? 'Download folder' : 'Download file'}
                      title={entry.type === 'dir' ? 'Download folder' : 'Download file'}
                      className="p-1.5 rounded-md border border-gh-border text-gh-text hover:bg-gh-overlay inline-flex items-center"
                    >
                      <Download size={13} />
                    </button>
                  )}

                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => handleDeleteEntry(entry)}
                      disabled={deletingPath === entry.path}
                      aria-label={entry.type === 'dir' ? 'Delete folder' : 'Delete file'}
                      title={entry.type === 'dir' ? 'Delete folder' : 'Delete file'}
                      className="p-1.5 rounded-md border border-red-500/30 text-gh-danger hover:bg-red-500/10 inline-flex items-center disabled:opacity-60"
                    >
                      {deletingPath === entry.path ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Trash2 size={13} />
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
