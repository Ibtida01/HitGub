import { useEffect, useMemo, useState } from 'react';
import { FolderPlus, Loader2, X } from 'lucide-react';

const LICENSE_OPTIONS = [
  { value: '', label: 'No license' },
  { value: 'MIT', label: 'MIT License' },
  { value: 'Apache-2.0', label: 'Apache 2.0' },
  { value: 'GPL-3.0', label: 'GNU GPL v3.0' },
  { value: 'BSD-3-Clause', label: 'BSD 3-Clause' },
];

const REPO_NAME_RE = /^[a-zA-Z0-9_-]+$/;

export function CreateRepositoryModal({ isOpen, onClose, onCreate }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [licenseType, setLicenseType] = useState('');
  const [initializeReadme, setInitializeReadme] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setDescription('');
    setVisibility('public');
    setDefaultBranch('main');
    setLicenseType('');
    setInitializeReadme(true);
    setSubmitting(false);
    setError('');
  }, [isOpen]);

  const canSubmit = useMemo(() => {
    return REPO_NAME_RE.test(name.trim()) && defaultBranch.trim().length > 0;
  }, [name, defaultBranch]);

  if (!isOpen) return null;

  const submit = async () => {
    if (!canSubmit) {
      setError('Repository name is invalid. Use letters, numbers, underscores, or hyphens.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await onCreate({
        name: name.trim(),
        description,
        visibility,
        default_branch: defaultBranch.trim(),
        license_type: licenseType || null,
        initialize_with_readme: initializeReadme,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create repository');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] p-4">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-xl bg-gh-canvas-subtle border border-gh-border rounded-xl shadow-xl shadow-black/40">
        <div className="px-5 py-4 border-b border-gh-border flex items-center justify-between">
          <h2 className="text-base font-semibold text-gh-text flex items-center gap-2">
            <FolderPlus size={18} />
            Create new repository
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-gh-text-muted hover:text-gh-text transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gh-text mb-1.5">Repository name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-awesome-repo"
              className="w-full border border-gh-border rounded-md px-3 py-2 text-sm bg-gh-canvas text-gh-text placeholder:text-gh-text-muted focus:outline-none focus:ring-2 focus:ring-gh-accent"
            />
            {!REPO_NAME_RE.test(name.trim()) && name.trim().length > 0 && (
              <p className="mt-1 text-xs text-gh-danger">
                Use only letters, numbers, underscore (`_`) and hyphen (`-`).
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gh-text mb-1.5">Description</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell people what this repository is for"
              className="w-full border border-gh-border rounded-md px-3 py-2 text-sm bg-gh-canvas text-gh-text placeholder:text-gh-text-muted focus:outline-none focus:ring-2 focus:ring-gh-accent"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gh-text mb-1.5">Visibility</label>
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value)}
                className="w-full border border-gh-border rounded-md px-3 py-2 text-sm bg-gh-canvas text-gh-text focus:outline-none focus:ring-2 focus:ring-gh-accent"
              >
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gh-text mb-1.5">License</label>
              <select
                value={licenseType}
                onChange={(e) => setLicenseType(e.target.value)}
                className="w-full border border-gh-border rounded-md px-3 py-2 text-sm bg-gh-canvas text-gh-text focus:outline-none focus:ring-2 focus:ring-gh-accent"
              >
                {LICENSE_OPTIONS.map((opt) => (
                  <option key={opt.label} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gh-text mb-1.5">Default branch</label>
            <input
              type="text"
              value={defaultBranch}
              onChange={(e) => setDefaultBranch(e.target.value)}
              placeholder="main"
              className="w-full border border-gh-border rounded-md px-3 py-2 text-sm bg-gh-canvas text-gh-text placeholder:text-gh-text-muted focus:outline-none focus:ring-2 focus:ring-gh-accent"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-gh-text-secondary">
            <input
              type="checkbox"
              checked={initializeReadme}
              onChange={(e) => setInitializeReadme(e.target.checked)}
              className="accent-gh-accent"
            />
            Initialize with README
          </label>

          {error && <p className="text-sm text-gh-danger bg-red-400/10 px-3 py-2 rounded-md">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-gh-border flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm border border-gh-border rounded-md text-gh-text hover:bg-gh-overlay"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !canSubmit}
            className="px-4 py-1.5 text-sm rounded-md bg-gh-success-em text-white hover:bg-gh-success disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Create repository
          </button>
        </div>
      </div>
    </div>
  );
}
