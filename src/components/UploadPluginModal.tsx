'use client';

// AURORA_PATCH: community plugin upload modal v1
import { apiFetch } from '@/lib/api';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { CommunityPlugin } from '@/types';
import { useAuthStore } from '@/store/useAuthStore';
import { usePluginStore } from '@/store/usePluginStore';
import { useToastStore } from '@/store/useToastStore';

export const MAX_PLUGIN_UPLOAD_BYTES = 500 * 1024;

function fileError(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.js')) {
    return 'Choose a .js plugin file.';
  }
  if (file.size === 0) {
    return 'The plugin file is empty.';
  }
  if (file.size > MAX_PLUGIN_UPLOAD_BYTES) {
    return 'Plugin files must be 500 KB or smaller.';
  }
  return null;
}

export function UploadPluginModal({ onClose }: { onClose: () => void }) {
  const user = useAuthStore((state) => state.user);
  const addPlugin = usePluginStore((state) => state.addPlugin);
  const showToast = useToastStore((state) => state.showToast);

  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [author, setAuthor] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [busy, onClose]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!user) {
      setError('Sign in to upload community plugins.');
      return;
    }

    if (!file) {
      setError('Choose a .js plugin file.');
      return;
    }

    const invalidFile = fileError(file);
    if (invalidFile) {
      setError(invalidFile);
      return;
    }

    if (!name.trim()) {
      setError('Plugin name is required.');
      return;
    }

    setBusy(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', name.trim());
      formData.append('author', author.trim());
      formData.append('version', version.trim());
      formData.append('description', description.trim());

      const response = await apiFetch('/api/marketplace/plugins/upload', {
        method: 'POST',
        credentials: 'same-origin',
        body: formData,
      });

      const data = (await response.json().catch(() => ({}))) as {
        ok?: unknown;
        error?: unknown;
        plugin?: unknown;
      };

      if (!response.ok || !data.plugin) {
        throw new Error(
          typeof data.error === 'string'
            ? data.error
            : `Upload failed (${response.status}).`
        );
      }

      const plugin = data.plugin as CommunityPlugin;
      addPlugin(plugin);
      showToast(`Plugin "${plugin.name}" uploaded. Enable it when ready.`);
      onClose();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : 'Upload failed. Please try again.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/70 p-3 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-plugin-title"
        className="mt-8 w-full max-w-2xl border border-[var(--term-border-bright)] bg-[var(--term-bg-panel)] font-mono text-xs"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--term-border)] p-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--term-text-dim)]">
              AuroraMP / Marketplace / Plugins
            </div>
            <h2
              id="upload-plugin-title"
              className="mt-1 text-sm font-semibold text-[var(--term-text-bright)]"
            >
              Upload Community Plugin
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close upload dialog"
            className="border border-[var(--term-border)] px-2 py-1 text-[10px] text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)] disabled:opacity-50"
          >
            [ CLOSE ]
          </button>
        </header>

        <div className="space-y-4 p-4">
          <div className="border border-red-900 bg-red-950/20 p-3 text-[11px] leading-relaxed text-red-200">
            Only upload plugins from trusted sources. The AuroraMP host API provides restricted access.
          </div>

          {!user && (
            <div className="border border-[var(--term-border)] bg-[var(--term-bg-input)] p-3 text-[11px] leading-relaxed text-[var(--term-text-muted)]">
              You are browsing as a guest. Community plugin uploads are tied to
              an account.{' '}
              <Link
                href="/login"
                onClick={onClose}
                className="text-[var(--term-border-bright)] underline decoration-dotted underline-offset-2"
              >
                Sign in
              </Link>{' '}
              to upload.
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            <label className="block space-y-1.5">
              <span className="block text-[10px] uppercase tracking-wide text-[var(--term-text-dim)]">
                Plugin file (.js, max 500 KB)
              </span>
              <input
                type="file"
                accept=".js,application/javascript,text/javascript"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setError(null);
                }}
                className="block w-full border border-[var(--term-border)] bg-[var(--term-bg-input)] p-2 text-[11px] text-[var(--term-text-muted)] file:mr-3 file:border file:border-[var(--term-border)] file:bg-[var(--term-bg-panel)] file:px-2 file:py-1 file:text-[10px] file:text-[var(--term-text-bright)]"
              />
              {file && (
                <span className="block text-[10px] text-[var(--term-text-dim)]">
                  {file.name} · {(file.size / 1024).toFixed(1)} KB
                </span>
              )}
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="block text-[10px] uppercase tracking-wide text-[var(--term-text-dim)]">
                  Plugin Name
                </span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={80}
                  required
                  placeholder="Now Playing Enhancer"
                  className="w-full border border-[var(--term-border)] bg-[var(--term-bg-input)] px-2.5 py-2 text-[11px] text-[var(--term-text-bright)] outline-none placeholder:text-[var(--term-text-dim)] focus:border-[var(--term-border-bright)]"
                />
              </label>

              <label className="space-y-1.5">
                <span className="block text-[10px] uppercase tracking-wide text-[var(--term-text-dim)]">
                  Author
                </span>
                <input
                  value={author}
                  onChange={(event) => setAuthor(event.target.value)}
                  maxLength={80}
                  placeholder={user?.username || 'Your name'}
                  className="w-full border border-[var(--term-border)] bg-[var(--term-bg-input)] px-2.5 py-2 text-[11px] text-[var(--term-text-bright)] outline-none placeholder:text-[var(--term-text-dim)] focus:border-[var(--term-border-bright)]"
                />
              </label>

              <label className="space-y-1.5 sm:col-span-2">
                <span className="block text-[10px] uppercase tracking-wide text-[var(--term-text-dim)]">
                  Version
                </span>
                <input
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                  maxLength={32}
                  placeholder="1.0.0"
                  className="w-full border border-[var(--term-border)] bg-[var(--term-bg-input)] px-2.5 py-2 text-[11px] text-[var(--term-text-bright)] outline-none placeholder:text-[var(--term-text-dim)] focus:border-[var(--term-border-bright)]"
                />
              </label>
            </div>

            <label className="block space-y-1.5">
              <span className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-[var(--term-text-dim)]">
                <span>Description</span>
                <span>{description.length} / 600</span>
              </span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={600}
                rows={4}
                placeholder="What does this plugin do?"
                className="w-full resize-y border border-[var(--term-border)] bg-[var(--term-bg-input)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--term-text-bright)] outline-none placeholder:text-[var(--term-text-dim)] focus:border-[var(--term-border-bright)]"
              />
            </label>

            {error && (
              <div className="border border-red-900 bg-red-950/20 p-2.5 text-[11px] leading-relaxed text-red-200">
                {error}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--term-border)] pt-3">
              <span className="text-[10px] leading-relaxed text-[var(--term-text-dim)]">
                The file is checked for JavaScript syntax before it is saved.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="border border-[var(--term-border)] px-3 py-1.5 text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)] disabled:opacity-50"
                >
                  [ CANCEL ]
                </button>
                <button
                  type="submit"
                  disabled={busy || !user}
                  className="border border-[var(--term-border-bright)] bg-[var(--term-invert-bg)] px-3 py-1.5 font-semibold text-[var(--term-invert-text)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? '[ UPLOADING... ]' : '[ UPLOAD PLUGIN ]'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
