import { useEffect, useMemo, useRef, useState } from 'react';

const SERVER_URL = (import.meta.env.VITE_SERVER_URL ?? '').trim().replace(/\/$/, '');
const CLIENT_WRITE_DEBOUNCE_MS = 3_000;

async function fetchJson(url, options) {
  const response = await fetch(`${SERVER_URL}${url}`, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error ?? 'Request failed.');
  }

  return data;
}

function findFirstFile(node) {
  if (!node) {
    return null;
  }

  if (node.type === 'file') {
    return node.path;
  }

  for (const child of node.children ?? []) {
    const match = findFirstFile(child);

    if (match) {
      return match;
    }
  }

  return null;
}

function hasFilePath(node, targetPath) {
  if (!node) {
    return false;
  }

  if (node.type === 'file') {
    return node.path === targetPath;
  }

  return (node.children ?? []).some((child) => hasFilePath(child, targetPath));
}

function SyncBadge({ status }) {
  const label = status?.lastSyncStatus ?? 'starting';

  return <span className={`sync-badge sync-badge-${label}`}>{label}</span>;
}

function TreeNode({ node, selectedPath, onSelect }) {
  const [expanded, setExpanded] = useState(true);

  if (node.type === 'file') {
    return (
      <button
        className={`tree-file ${selectedPath === node.path ? 'tree-file-selected' : ''}`}
        onClick={() => onSelect(node.path)}
        type="button"
      >
        <span className="tree-prefix">#</span>
        <span>{node.name}</span>
      </button>
    );
  }

  return (
    <div className="tree-group">
      <button
        className="tree-directory"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <span className="tree-prefix">{expanded ? '-' : '+'}</span>
        <span>{node.name}</span>
      </button>
      {expanded ? (
        <div className="tree-children">
          {(node.children ?? []).map((child) => (
            <TreeNode
              key={child.path || child.name}
              node={child}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function App() {
  const [activeSidebarTab, setActiveSidebarTab] = useState('select');
  const [tree, setTree] = useState(null);
  const [status, setStatus] = useState(null);
  const [selectedPath, setSelectedPath] = useState(null);
  const [content, setContent] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [appError, setAppError] = useState('');
  const [repoError, setRepoError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [repoAliases, setRepoAliases] = useState([]);
  const [activeRepoAlias, setActiveRepoAlias] = useState('');
  const [repoAliasDraft, setRepoAliasDraft] = useState('');
  const [repoDraft, setRepoDraft] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [editingAlias, setEditingAlias] = useState('');
  const [editingRepoDraft, setEditingRepoDraft] = useState('');
  const [savingAlias, setSavingAlias] = useState(false);
  const [deletingAlias, setDeletingAlias] = useState(false);
  const [registeringRepo, setRegisteringRepo] = useState(false);

  const statusRef = useRef(null);
  const selectedPathRef = useRef(null);
  const activeRepoAliasRef = useRef('');
  const flushPendingWriteRef = useRef(null);
  const flushTimerRef = useRef(null);
  const pendingWriteRef = useRef(null);
  const writeSequenceRef = useRef(0);

  const missingServerUrl = SERVER_URL === '';

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);

  useEffect(() => {
    activeRepoAliasRef.current = activeRepoAlias;
  }, [activeRepoAlias]);

  async function flushPendingWrite({ keepalive = false } = {}) {
    if (flushTimerRef.current) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    const pendingWrite = pendingWriteRef.current;

    if (!pendingWrite) {
      return;
    }

    pendingWriteRef.current = null;

    try {
      const data = await fetchJson('/api/file', {
        method: 'PUT',
        body: JSON.stringify({
          repoAlias: pendingWrite.repoAlias,
          path: pendingWrite.path,
          content: pendingWrite.content,
        }),
        keepalive,
      });

      if (pendingWrite.sequence === writeSequenceRef.current) {
        setStatus(data.status);
      }
    } catch (error) {
      pendingWriteRef.current = pendingWrite;
      setSaveError(error.message);
      throw error;
    }
  }

  function schedulePendingWrite() {
    if (flushTimerRef.current) {
      window.clearTimeout(flushTimerRef.current);
    }

    flushTimerRef.current = window.setTimeout(() => {
      flushPendingWrite().catch(() => {});
    }, CLIENT_WRITE_DEBOUNCE_MS);
  }

  flushPendingWriteRef.current = flushPendingWrite;

  async function loadRepoAliases() {
    const data = await fetchJson('/api/repos');
    const aliases = data.repoAliases ?? [];

    setRepoAliases(aliases);
    setActiveRepoAlias((currentAlias) => {
      if (currentAlias && aliases.includes(currentAlias)) {
        return currentAlias;
      }

      return aliases[0] ?? '';
    });

    return aliases;
  }

  async function loadPublicKey(repoAlias) {
    if (!repoAlias) {
      setPublicKey('');
      return;
    }

    try {
      const data = await fetchJson(`/api/repos/${encodeURIComponent(repoAlias)}/public-key`);
      setPublicKey(data.publicKey);
    } catch (error) {
      setPublicKey('');
      setRepoError(error.message);
    }
  }

  async function loadRepoAliasDetails(repoAlias) {
    if (!repoAlias) {
      setEditingAlias('');
      setEditingRepoDraft('');
      return;
    }

    try {
      const data = await fetchJson(`/api/repos/${encodeURIComponent(repoAlias)}`);
      setEditingAlias(data.repoAlias);
      setEditingRepoDraft(data.repo);
    } catch (error) {
      setRepoError(error.message);
    }
  }

  async function loadFile(path, repoAlias = activeRepoAliasRef.current) {
    if (!path || !repoAlias) {
      setContent('');
      return;
    }

    setLoadingFile(true);
    setSaveError('');

    try {
      const data = await fetchJson(
        `/api/file?repoAlias=${encodeURIComponent(repoAlias)}&path=${encodeURIComponent(path)}`,
      );
      setContent(data.content);
      setSelectedPath(path);
    } catch (error) {
      setSaveError(error.message);
    } finally {
      setLoadingFile(false);
    }
  }

  async function loadState({ forceReloadFile = false, repoAlias = activeRepoAliasRef.current } = {}) {
    if (!repoAlias) {
      setTree(null);
      setStatus(null);
      setSelectedPath(null);
      setContent('');
      return;
    }

    try {
      const data = await fetchJson(`/api/bootstrap?repoAlias=${encodeURIComponent(repoAlias)}`);

      if (!data.ready) {
        setRepoError(data.error ?? 'The repository is not ready yet.');
        setTree(null);
        setStatus(null);
        setSelectedPath(null);
        setContent('');
        return;
      }

      setRepoError('');
      setTree(data.tree);
      setStatus(data.status);

      const activePath =
        selectedPathRef.current && hasFilePath(data.tree, selectedPathRef.current)
          ? selectedPathRef.current
          : findFirstFile(data.tree);
      const hasPendingWriteForActiveFile =
        pendingWriteRef.current?.repoAlias === repoAlias &&
        pendingWriteRef.current?.path === activePath;

      const stateChanged = data.status.stateVersion !== statusRef.current?.stateVersion;

      if (
        activePath &&
        !hasPendingWriteForActiveFile &&
        (forceReloadFile || stateChanged || activePath !== selectedPathRef.current)
      ) {
        await loadFile(activePath, repoAlias);
      } else if (!activePath) {
        setSelectedPath(null);
        setContent('');
      }
    } catch (error) {
      setRepoError(error.message);
    }
  }

  useEffect(() => {
    if (missingServerUrl) {
      setAppError(
        'Missing server URL. Start the client with --server-url=http://127.0.0.1:3001.',
      );
      return;
    }

    loadRepoAliases().catch((error) => {
      setAppError(error.message);
    });
  }, [missingServerUrl]);

  useEffect(() => {
    if (missingServerUrl || !activeRepoAlias) {
      setTree(null);
      setStatus(null);
      setSelectedPath(null);
      setContent('');
      return undefined;
    }

    loadState({ forceReloadFile: true, repoAlias: activeRepoAlias });

    const interval = window.setInterval(() => {
      loadState({ repoAlias: activeRepoAliasRef.current });
    }, 3_000);

    return () => window.clearInterval(interval);
  }, [activeRepoAlias, missingServerUrl]);

  useEffect(() => {
    if (missingServerUrl || activeSidebarTab !== 'aliases') {
      return;
    }

    loadRepoAliasDetails(editingAlias || activeRepoAlias);
  }, [activeRepoAlias, activeSidebarTab, editingAlias, missingServerUrl]);

  useEffect(() => {
    if (missingServerUrl || activeSidebarTab !== 'aliases') {
      return;
    }

    loadPublicKey(editingAlias || activeRepoAlias);
  }, [activeRepoAlias, activeSidebarTab, editingAlias, missingServerUrl]);

  useEffect(() => {
    function flushForLifecycle() {
      flushPendingWriteRef.current?.({ keepalive: true }).catch(() => {});
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        flushForLifecycle();
      }
    }

    window.addEventListener('beforeunload', flushForLifecycle);
    window.addEventListener('pagehide', flushForLifecycle);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (flushTimerRef.current) {
        window.clearTimeout(flushTimerRef.current);
      }

      window.removeEventListener('beforeunload', flushForLifecycle);
      window.removeEventListener('pagehide', flushForLifecycle);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  async function handleFileSelect(path) {
    await flushPendingWrite();
    await loadFile(path, activeRepoAliasRef.current);
  }

  async function handleRepoAliasChange(event) {
    const nextRepoAlias = event.target.value;

    try {
      await flushPendingWrite();
    } catch {}

    setActiveRepoAlias(nextRepoAlias);
    setEditingAlias(nextRepoAlias);
    setCopyStatus('');
  }

  async function handleCopyPublicKey() {
    if (!publicKey) {
      return;
    }

    try {
      await navigator.clipboard.writeText(publicKey);
      setCopyStatus('Copied');
    } catch {
      setCopyStatus('Copy failed');
    }
  }

  async function handleRegisterRepo(event) {
    event.preventDefault();

    setSaveError('');
    setRepoError('');
    setRegisteringRepo(true);

    try {
      const data = await fetchJson('/api/repos', {
        method: 'POST',
        body: JSON.stringify({
          repoAlias: repoAliasDraft.trim(),
          repo: repoDraft.trim(),
        }),
      });

      setPublicKey(data.publicKey);
      setRepoAliasDraft('');
      setRepoDraft('');
      await loadRepoAliases();
      setActiveRepoAlias(data.repoAlias);
      setEditingAlias(data.repoAlias);
      setEditingRepoDraft(data.repo);
      setPublicKey('');
      setActiveSidebarTab('aliases');
    } catch (error) {
      setRepoError(error.message);
    } finally {
      setRegisteringRepo(false);
    }
  }

  async function handleNewFile() {
    if (!activeRepoAliasRef.current) {
      return;
    }

    await flushPendingWrite();

    const nextPath = window.prompt('New file path', 'notes/untitled.md');

    if (!nextPath) {
      return;
    }

    try {
      const data = await fetchJson('/api/files', {
        method: 'POST',
        body: JSON.stringify({
          repoAlias: activeRepoAliasRef.current,
          path: nextPath.trim(),
        }),
      });

      setStatus(data.status);
      await loadState({ forceReloadFile: true, repoAlias: activeRepoAliasRef.current });
      await loadFile(nextPath.trim(), activeRepoAliasRef.current);
    } catch (error) {
      setSaveError(error.message);
    }
  }

  async function handleSaveAlias(event) {
    event.preventDefault();

    if (!editingAlias) {
      return;
    }

    setSavingAlias(true);
    setRepoError('');

    try {
      const data = await fetchJson(`/api/repos/${encodeURIComponent(editingAlias)}`, {
        method: 'PUT',
        body: JSON.stringify({
          repo: editingRepoDraft.trim(),
        }),
      });

      setEditingRepoDraft(data.repo);
      if (activeRepoAlias === data.repoAlias) {
        await loadState({ forceReloadFile: true, repoAlias: data.repoAlias });
      }
    } catch (error) {
      setRepoError(error.message);
    } finally {
      setSavingAlias(false);
    }
  }

  async function handleDeleteAlias() {
    if (!editingAlias) {
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to delete the repo alias "${editingAlias}"? This removes its local clone and SSH keys from the server.`,
    );

    if (!confirmed) {
      return;
    }

    setDeletingAlias(true);
    setRepoError('');
    setSaveError('');

    try {
      if (activeRepoAliasRef.current === editingAlias) {
        try {
          await flushPendingWrite();
        } catch {}
      }

      await fetchJson(`/api/repos/${encodeURIComponent(editingAlias)}`, {
        method: 'DELETE',
      });

      const deletedAlias = editingAlias;
      const aliases = await loadRepoAliases();
      const nextActiveAlias =
        activeRepoAliasRef.current === deletedAlias
          ? aliases[0] ?? ''
          : activeRepoAliasRef.current;

      if (deletedAlias === activeRepoAliasRef.current) {
        pendingWriteRef.current = null;
      }

      setEditingAlias(nextActiveAlias);
      setEditingRepoDraft('');

      if (!nextActiveAlias) {
        setTree(null);
        setStatus(null);
        setSelectedPath(null);
        setContent('');
        setPublicKey('');
      } else {
        await loadRepoAliasDetails(nextActiveAlias);
      }
    } catch (error) {
      setRepoError(error.message);
    } finally {
      setDeletingAlias(false);
    }
  }

  async function handleSyncNow() {
    if (!activeRepoAliasRef.current) {
      return;
    }

    setSaveError('');
    await flushPendingWrite();

    try {
      const data = await fetchJson('/api/sync', {
        method: 'POST',
        body: JSON.stringify({
          repoAlias: activeRepoAliasRef.current,
        }),
      });

      setStatus(data.status);
      setTree(data.tree);

      const activePath =
        selectedPathRef.current && hasFilePath(data.tree, selectedPathRef.current)
          ? selectedPathRef.current
          : findFirstFile(data.tree);

      if (activePath) {
        await loadFile(activePath, activeRepoAliasRef.current);
      }
    } catch (error) {
      setSaveError(error.message);
    }
  }

  async function handleEditorChange(event) {
    const nextContent = event.target.value;
    const activePath = selectedPathRef.current;

    setContent(nextContent);
    setSaveError('');

    if (!activeRepoAliasRef.current || !activePath) {
      return;
    }

    const sequence = ++writeSequenceRef.current;
    pendingWriteRef.current = {
      content: nextContent,
      path: activePath,
      repoAlias: activeRepoAliasRef.current,
      sequence,
    };
    setStatus((currentStatus) =>
      currentStatus
        ? {
            ...currentStatus,
            lastSyncMessage: `Unsynced edits in ${activePath}.`,
            lastSyncStatus: 'dirty',
          }
        : currentStatus,
    );
    schedulePendingWrite();
  }

  const title = useMemo(() => {
    if (!selectedPath) {
      return activeRepoAlias ? `Repo alias: ${activeRepoAlias}` : 'No repo alias selected';
    }

    return selectedPath;
  }, [activeRepoAlias, selectedPath]);

  const repoSlug = status?.repo ?? '';
  const deployKeyUrl = repoSlug ? `https://github.com/${repoSlug}/settings/keys` : '';

  if (appError) {
    return (
      <main className="app-shell">
        <section className="error-panel">
          <p className="eyebrow">Configuration required</p>
          <h1>GitHub Note Sync</h1>
          <p>{appError}</p>
          <p className="secondary-copy">
            Start the client with <code>npm run dev -- --server-url=http://127.0.0.1:3001</code>
            , or point it at the deployed API URL.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <section className="editor-pane">
          <header className="pane-header">
            <div>
              <p className="eyebrow">Editor</p>
              <h1>{title}</h1>
            </div>
            <div className="header-actions">
              <SyncBadge status={status} />
              <button
                className="ghost-button"
                disabled={!activeRepoAlias || repoError !== ''}
                onClick={handleSyncNow}
                type="button"
              >
                Sync now
              </button>
            </div>
          </header>

          <div className="status-row">
            <span>
              {activeRepoAlias ? `alias:${activeRepoAlias}` : 'No repo alias selected'}
              {status?.repo ? ` · ${status.repo}` : ''}
              {status?.branch ? ` · ${status.branch}` : ''}
            </span>
            <span>{repoError || status?.lastSyncMessage}</span>
          </div>

          <section className="editor-surface">
            {!activeRepoAlias ? (
              <div className="empty-state">Create or select a repo alias to begin.</div>
            ) : repoError ? (
              <div className="empty-state">{repoError}</div>
            ) : selectedPath ? (
              <textarea
                className="editor-textarea"
                onChange={handleEditorChange}
                onBlur={() => {
                  flushPendingWrite().catch(() => {});
                }}
                spellCheck={false}
                value={content}
              />
            ) : (
              <div className="empty-state">This repository does not contain any files yet.</div>
            )}
          </section>

          <footer className="footer-row">
            <span>{loadingFile ? 'Loading file…' : 'Edits write through to the local clone.'}</span>
            <span>{saveError}</span>
          </footer>
        </section>

        <aside className="tree-pane">
          <header className="pane-header pane-header-sidebar">
            <div>
              <p className="eyebrow">Repository</p>
              <h2>Files</h2>
            </div>
            {activeSidebarTab === 'select' ? (
              <button
                className="solid-button"
                disabled={!activeRepoAlias || repoError !== ''}
                onClick={handleNewFile}
                type="button"
              >
                New file
              </button>
            ) : null}
          </header>

          <div className="tab-row" role="tablist" aria-label="Repository actions">
            <button
              aria-selected={activeSidebarTab === 'select'}
              className={`tab-button ${activeSidebarTab === 'select' ? 'tab-button-active' : ''}`}
              onClick={() => setActiveSidebarTab('select')}
              role="tab"
              type="button"
            >
              Write
            </button>
            <button
              aria-selected={activeSidebarTab === 'create'}
              className={`tab-button ${activeSidebarTab === 'aliases' ? 'tab-button-active' : ''}`}
              onClick={() => setActiveSidebarTab('aliases')}
              role="tab"
              type="button"
            >
              Repos
            </button>
          </div>

          {activeSidebarTab === 'select' ? (
            <section className="repo-setup">
              <label className="field-label" htmlFor="repo-alias-select">
                Active repo alias
              </label>
              <select
                className="field-input"
                id="repo-alias-select"
                onChange={handleRepoAliasChange}
                value={activeRepoAlias}
              >
                <option value="">Select a repo alias</option>
                {repoAliases.map((repoAlias) => (
                  <option key={repoAlias} value={repoAlias}>
                    {repoAlias}
                  </option>
                ))}
              </select>
              <p className="repo-help-copy">See 'Repos' tab for configuration.</p>
            </section>
          ) : (
            <section className="repo-setup">
              <form className="repo-form" onSubmit={handleRegisterRepo}>
                <label className="field-label" htmlFor="repo-alias-input">
                  New repo alias
                </label>
                <input
                  className="field-input"
                  id="repo-alias-input"
                  onChange={(event) => setRepoAliasDraft(event.target.value)}
                  placeholder="personal-notes"
                  value={repoAliasDraft}
                />
                <label className="field-label" htmlFor="repo-input">
                  GitHub SSH repo
                </label>
                <input
                  className="field-input"
                  id="repo-input"
                  onChange={(event) => setRepoDraft(event.target.value)}
                  placeholder="git@github.com:you/notes.git"
                  value={repoDraft}
                />
                <button className="solid-button" disabled={registeringRepo} type="submit">
                  {registeringRepo ? 'Creating…' : 'Create alias'}
                </button>
              </form>

              <form className="repo-form" onSubmit={handleSaveAlias}>
                <label className="field-label" htmlFor="edit-alias-select">
                  Edit existing alias
                </label>
                <select
                  className="field-input"
                  id="edit-alias-select"
                  onChange={(event) => {
                    setEditingAlias(event.target.value);
                    setCopyStatus('');
                  }}
                  value={editingAlias || activeRepoAlias}
                >
                  <option value="">Select an alias to edit</option>
                  {repoAliases.map((repoAlias) => (
                    <option key={repoAlias} value={repoAlias}>
                      {repoAlias}
                    </option>
                  ))}
                </select>
                <label className="field-label" htmlFor="edit-repo-input">
                  GitHub SSH repo
                </label>
                <input
                  className="field-input"
                  id="edit-repo-input"
                  onChange={(event) => setEditingRepoDraft(event.target.value)}
                  placeholder="git@github.com:you/notes.git"
                  value={editingRepoDraft}
                />
                <div className="inline-key-panel">
                  <div className="inline-key-header">
                    <span className="field-label">SSH Deploy Key</span>
                    <button
                      aria-label={
                        copyStatus
                          ? `${copyStatus}. Copy deploy key to clipboard`
                          : 'Copy deploy key to clipboard'
                      }
                      className={`copy-icon-button${copyStatus ? ' copy-icon-button-copied' : ''}`}
                      disabled={!editingAlias || !publicKey}
                      onClick={handleCopyPublicKey}
                      title={
                        copyStatus
                          ? `${copyStatus}. Copy deploy key to clipboard`
                          : 'Copy deploy key to clipboard'
                      }
                      type="button"
                    >
                      <span className="copy-icon" aria-hidden="true">
                        <span className="copy-icon-back" />
                        <span className="copy-icon-front" />
                      </span>
                    </button>
                  </div>
                  <div className="key-block-shell key-block-shell-inline">
                    <pre className="key-block">
                      {editingAlias ? publicKey || 'Loading public key…' : 'Select an alias to view its public key.'}
                    </pre>
                  </div>
                  <p className="key-copy key-copy-inline">
                    {deployKeyUrl ? (
                      <>
                        Add public key above as{' '}
                        <a className="key-link" href={deployKeyUrl} rel="noreferrer" target="_blank">
                          deploy key
                        </a>{' '}
                        to {repoSlug}
                      </>
                    ) : (
                      'Add deploy key to repo'
                    )}
                  </p>
                </div>
                <div className="repo-form-actions">
                  <button
                    className="solid-button"
                    disabled={!editingAlias || savingAlias || deletingAlias}
                    type="submit"
                  >
                    {savingAlias ? 'Saving…' : 'Save alias'}
                  </button>
                  <button
                    className="danger-button"
                    disabled={!editingAlias || savingAlias || deletingAlias}
                    onClick={handleDeleteAlias}
                    type="button"
                  >
                    {deletingAlias ? 'Deleting…' : 'Delete alias'}
                  </button>
                </div>
              </form>
            </section>
          )}

          <div className="tree-meta">
            <span>Auto-sync every {(status?.syncIntervalMs ?? 30_000) / 1000}s</span>
            <span>{repoAliases.length} aliases</span>
          </div>

          <div className="tree-scroll">
            {activeSidebarTab === 'select' && tree ? (
              <TreeNode node={tree} onSelect={handleFileSelect} selectedPath={selectedPath} />
            ) : activeSidebarTab === 'select' && activeRepoAlias ? (
              <div className="empty-state">No files loaded for this repo alias yet.</div>
            ) : activeSidebarTab === 'aliases' ? (
              <div className="empty-state">Create new aliases or edit the repo URL for an existing alias.</div>
            ) : (
              <div className="empty-state">Create a repo alias to generate its SSH keypair.</div>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}
