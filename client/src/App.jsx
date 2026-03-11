import { useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const SERVER_URL = (import.meta.env.VITE_SERVER_URL ?? '').trim().replace(/\/$/, '');
const CLIENT_WRITE_DEBOUNCE_MS = 3_000;
const PATH_SEPARATOR_PATTERN = /[\\/]/;
const DEFAULT_SIDEBAR_WIDTH = 360;
const MIN_SIDEBAR_WIDTH = 280;
const MAX_SIDEBAR_WIDTH = 720;
const MIN_EDITOR_WIDTH = 320;
const SIDEBAR_WIDTH_STORAGE_KEY = 'github-note-sync.sidebar-width';
const MOBILE_LAYOUT_QUERY =
  '(max-width: 900px), ((max-width: 1024px) and (hover: none) and (pointer: coarse))';

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function fetchJson(url, options = {}) {
  const headers = new Headers(options.headers ?? {});

  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${SERVER_URL}${url}`, {
    credentials: 'include',
    ...options,
    headers,
  });

  const contentType = response.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : { error: await response.text() };

  if (!response.ok) {
    throw new ApiError(data.error ?? 'Request failed.', response.status);
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

function hasFileDescendant(node) {
  if (!node) {
    return false;
  }

  if (node.type === 'file') {
    return true;
  }

  return (node.children ?? []).some((child) => hasFileDescendant(child));
}

function SyncBadge({ compact = false, status }) {
  const label = status?.lastSyncStatus ?? 'starting';
  const compactLabel = label === 'syncing' || label === 'starting' ? 'Syncing' : 'Idle';
  const badgeLabel = compact ? compactLabel : label;
  const badgeClassSuffix = compact ? compactLabel.toLowerCase() : label;

  return (
    <span className={`sync-badge sync-badge-${badgeClassSuffix}${compact ? ' sync-badge-compact' : ''}`}>
      {badgeLabel}
    </span>
  );
}

function clampSidebarWidth(width, containerWidth = Number.POSITIVE_INFINITY) {
  const maxWidthFromContainer = Number.isFinite(containerWidth)
    ? Math.max(MIN_SIDEBAR_WIDTH, containerWidth - MIN_EDITOR_WIDTH)
    : MAX_SIDEBAR_WIDTH;

  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(width, MAX_SIDEBAR_WIDTH, maxWidthFromContainer));
}

function getRepoAliasFromLocation() {
  if (typeof window === 'undefined') {
    return '';
  }

  const [firstSegment = ''] = window.location.pathname.split('/').filter(Boolean);

  try {
    return decodeURIComponent(firstSegment ?? '').trim();
  } catch {
    return '';
  }
}

function getMobileEditorTitle(path) {
  if (typeof path !== 'string' || path.trim() === '') {
    return 'No file';
  }

  const segments = path.split('/').filter(Boolean);
  const fileName = segments.length > 0 ? segments[segments.length - 1] : path.trim();

  if (fileName.length <= 20) {
    return fileName;
  }

  return `${fileName.slice(0, 17)}...`;
}

function getViewportHeightPx() {
  if (typeof window === 'undefined') {
    return null;
  }

  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const normalizedHeight = Math.round(viewportHeight);

  return Number.isFinite(normalizedHeight) && normalizedHeight > 0 ? normalizedHeight : null;
}

function FilePlusIcon() {
  return (
    <svg aria-hidden="true" className="tree-action-icon" viewBox="0 0 16 16">
      <path
        d="M4.5 1.75h4.5l3 3V13a1.25 1.25 0 0 1-1.25 1.25h-6.5A1.25 1.25 0 0 1 3 13V3A1.25 1.25 0 0 1 4.25 1.75Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path d="M9 1.75V5h3.25" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <path
        d="M8 7.1v4.2M5.9 9.2h4.2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.25"
      />
    </svg>
  );
}

function FolderPlusIcon() {
  return (
    <svg aria-hidden="true" className="tree-action-icon" viewBox="0 0 16 16">
      <path
        d="M1.75 4.5A1.25 1.25 0 0 1 3 3.25h3l1.1 1.4h5.9a1.25 1.25 0 0 1 1.25 1.25v5.1A1.25 1.25 0 0 1 13 12.25H3A1.25 1.25 0 0 1 1.75 11Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path
        d="M8 6.8v3.6M6.2 8.6h3.6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.25"
      />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg aria-hidden="true" className="tree-action-icon" viewBox="0 0 16 16">
      <path
        d="M12.8 6.3A5.25 5.25 0 1 0 13 8"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.25"
      />
      <path
        d="M10.6 3.2h2.7v2.7"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.25"
      />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg aria-hidden="true" className="tree-action-icon" viewBox="0 0 16 16">
      <path
        d="M3.25 4.5h9.5M6 4.5v-1a.75.75 0 0 1 .75-.75h2.5A.75.75 0 0 1 10 3.5v1M5.1 6.2v5.1M8 6.2v5.1M10.9 6.2v5.1M4.4 4.5l.45 7.05c.03.48.43.85.91.85h4.5c.48 0 .88-.37.91-.85l.45-7.05"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.25"
      />
    </svg>
  );
}

function TreeNode({
  depth = 0,
  node,
  onCreateFile,
  onCreateFolder,
  onDeleteFolder,
  onRefresh,
  onSelect,
  selectedPath,
}) {
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

  const showNewFileAction = typeof onCreateFile === 'function';
  const showNewFolderAction = typeof onCreateFolder === 'function';
  const showRefreshAction = depth === 0 && typeof onRefresh === 'function';
  const showDeleteFolderAction =
    depth > 0 && typeof onDeleteFolder === 'function' && !hasFileDescendant(node);

  return (
    <div className="tree-group">
      <div className="tree-row">
        <button
          className="tree-directory"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          <span className="tree-prefix">{expanded ? '-' : '+'}</span>
          <span>{node.name}</span>
        </button>
        {showNewFileAction || showNewFolderAction ? (
          <div className="tree-actions">
            {showRefreshAction ? (
              <button
                className="tree-action-button"
                onClick={(event) => {
                  event.stopPropagation();
                  onRefresh();
                }}
                title="Refresh tree from disk"
                type="button"
              >
                <RefreshIcon />
              </button>
            ) : null}
            {showNewFileAction ? (
              <button
                className="tree-action-button"
                onClick={(event) => {
                  event.stopPropagation();
                  onCreateFile(node.path);
                }}
                title={depth === 0 ? 'New file in repo root' : `New file in ${node.name}`}
                type="button"
              >
                <FilePlusIcon />
              </button>
            ) : null}
            {showNewFolderAction ? (
              <button
                className="tree-action-button"
                onClick={(event) => {
                  event.stopPropagation();
                  onCreateFolder(node.path);
                }}
                title={depth === 0 ? 'New folder in repo root' : `New folder in ${node.name}`}
                type="button"
              >
                <FolderPlusIcon />
              </button>
            ) : null}
            {showDeleteFolderAction ? (
              <button
                className="tree-action-button tree-action-button-danger"
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteFolder(node.path, node.name);
                }}
                title={`Delete empty folder ${node.name}`}
                type="button"
              >
                <DeleteIcon />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {expanded ? (
        <div className="tree-children">
          {(node.children ?? []).map((child) => (
            <TreeNode
              depth={depth + 1}
              key={child.path || child.name}
              node={child}
              onCreateFile={onCreateFile}
              onCreateFolder={onCreateFolder}
              onDeleteFolder={onDeleteFolder}
              onRefresh={onRefresh}
              onSelect={onSelect}
              selectedPath={selectedPath}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AuthScreen({
  authBusy,
  authError,
  authMode,
  confirmPasswordDraft,
  hasUsers,
  onModeChange,
  onSubmit,
  passwordDraft,
  registrationOpen,
  serverUrl,
  setConfirmPasswordDraft,
  setPasswordDraft,
  setUsernameDraft,
  usernameDraft,
}) {
  const title = hasUsers ? 'Sign in to GitHub Note Sync' : 'Create the first GitHub Note Sync user';
  const submitLabel =
    authMode === 'register' ? (hasUsers ? 'Create account' : 'Create first user') : 'Sign in';

  return (
    <main className="app-shell auth-shell">
      <section className="auth-panel">
        <div className="auth-copy">
          <p className="eyebrow">Authentication required</p>
          <h1>{title}</h1>
          <p>
            Passwords and sessions are verified by the server. SSH keys stay on the server and are
            still generated per repo alias.
          </p>
          <p className="secondary-copy">
            Server: <code>{serverUrl}</code>
          </p>
        </div>

        <form className="auth-form" onSubmit={onSubmit}>
          {registrationOpen ? (
            <div className="auth-mode-row" role="tablist" aria-label="Authentication mode">
              <button
                aria-selected={authMode === 'login'}
                className={`auth-mode-button ${authMode === 'login' ? 'auth-mode-button-active' : ''}`}
                onClick={() => onModeChange('login')}
                role="tab"
                type="button"
              >
                Sign in
              </button>
              <button
                aria-selected={authMode === 'register'}
                className={`auth-mode-button ${authMode === 'register' ? 'auth-mode-button-active' : ''}`}
                onClick={() => onModeChange('register')}
                role="tab"
                type="button"
              >
                Register
              </button>
            </div>
          ) : null}

          <label className="field-label field-label-light" htmlFor="auth-username">
            Username
          </label>
          <input
            autoComplete="username"
            className="auth-input"
            id="auth-username"
            onChange={(event) => setUsernameDraft(event.target.value)}
            placeholder="notes-admin"
            value={usernameDraft}
          />

          <label className="field-label field-label-light" htmlFor="auth-password">
            Password
          </label>
          <input
            autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
            className="auth-input"
            id="auth-password"
            onChange={(event) => setPasswordDraft(event.target.value)}
            placeholder="At least 8 characters"
            type="password"
            value={passwordDraft}
          />

          {authMode === 'register' ? (
            <>
              <label className="field-label field-label-light" htmlFor="auth-password-confirm">
                Confirm password
              </label>
              <input
                autoComplete="new-password"
                className="auth-input"
                id="auth-password-confirm"
                onChange={(event) => setConfirmPasswordDraft(event.target.value)}
                placeholder="Repeat password"
                type="password"
                value={confirmPasswordDraft}
              />
            </>
          ) : null}

          <button className="solid-button auth-submit-button" disabled={authBusy} type="submit">
            {authBusy ? 'Working…' : submitLabel}
          </button>

          <p className="auth-feedback" role="status">
            {authError}
          </p>
        </form>
      </section>
    </main>
  );
}

export default function App() {
  const [activeSidebarTab, setActiveSidebarTab] = useState('select');
  const [routeRepoAlias, setRouteRepoAlias] = useState(() => getRepoAliasFromLocation());
  const [tree, setTree] = useState(null);
  const [status, setStatus] = useState(null);
  const [selectedPath, setSelectedPath] = useState(null);
  const [content, setContent] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [loadingTree, setLoadingTree] = useState(false);
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
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authMode, setAuthMode] = useState('login');
  const [authUser, setAuthUser] = useState(null);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [hasUsers, setHasUsers] = useState(true);
  const [usernameDraft, setUsernameDraft] = useState('');
  const [passwordDraft, setPasswordDraft] = useState('');
  const [confirmPasswordDraft, setConfirmPasswordDraft] = useState('');
  const [showMarkdownPreview, setShowMarkdownPreview] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_SIDEBAR_WIDTH;
    }

    const storedWidth = Number.parseInt(
      window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) ?? '',
      10,
    );

    return Number.isFinite(storedWidth)
      ? clampSidebarWidth(storedWidth, window.innerWidth)
      : DEFAULT_SIDEBAR_WIDTH;
  });
  const [viewportHeight, setViewportHeight] = useState(() => getViewportHeightPx());

  const workspaceRef = useRef(null);
  const editorPaneRef = useRef(null);
  const treePaneRef = useRef(null);
  const statusRef = useRef(null);
  const selectedPathRef = useRef(null);
  const activeRepoAliasRef = useRef('');
  const flushPendingWriteRef = useRef(null);
  const flushTimerRef = useRef(null);
  const pendingWriteRef = useRef(null);
  const writeSequenceRef = useRef(0);
  const resizeCleanupRef = useRef(null);

  const missingServerUrl = SERVER_URL === '';
  const isAuthenticated = authUser !== null;
  const mobileLayout = isMobileLayout();

  function isMobileLayout() {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.matchMedia(MOBILE_LAYOUT_QUERY).matches;
  }

  function scrollToEditorPane() {
    editorPaneRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }

  function scrollToFileTree() {
    setActiveSidebarTab('select');
    treePaneRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }

  function resetWorkspaceState() {
    setTree(null);
    setStatus(null);
    setSelectedPath(null);
    setContent('');
    setLoadingFile(false);
    setLoadingTree(false);
    setRepoError('');
    setSaveError('');
    setRepoAliases([]);
    setActiveRepoAlias('');
    setRepoAliasDraft('');
    setRepoDraft('');
    setPublicKey('');
    setCopyStatus('');
    setEditingAlias('');
    setEditingRepoDraft('');
    setShowMarkdownPreview(false);

    if (flushTimerRef.current) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    pendingWriteRef.current = null;
  }

  async function loadSessionState() {
    const data = await fetchJson('/api/auth/session');

    setHasUsers(Boolean(data.hasUsers));
    setRegistrationOpen(Boolean(data.registrationOpen));
    setAuthUser(data.user ?? null);
    setAuthReady(true);

    if (data.user) {
      setAuthError('');
      return data;
    }

    setAuthMode((currentMode) => {
      if (!data.hasUsers) {
        return 'register';
      }

      if (!data.registrationOpen && currentMode === 'register') {
        return 'login';
      }

      return currentMode;
    });

    return data;
  }

  function handleUnauthorized(error, message = 'Your session expired. Sign in again.') {
    if (!(error instanceof ApiError) || error.status !== 401) {
      return false;
    }

    resetWorkspaceState();
    setAuthUser(null);
    setAuthReady(true);
    setAuthError(message);

    loadSessionState().catch((sessionError) => {
      setAppError(sessionError.message);
    });

    return true;
  }

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);

  useEffect(() => {
    activeRepoAliasRef.current = activeRepoAlias;
  }, [activeRepoAlias]);

  useEffect(() => {
    function handlePopState() {
      setRouteRepoAlias(getRepoAliasFromLocation());
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const syncViewportHeight = () => {
      const nextHeight = getViewportHeightPx();
      setViewportHeight((currentHeight) => (currentHeight === nextHeight ? currentHeight : nextHeight));
    };

    const visualViewport = window.visualViewport;

    syncViewportHeight();
    window.addEventListener('resize', syncViewportHeight);
    visualViewport?.addEventListener('resize', syncViewportHeight);
    visualViewport?.addEventListener('scroll', syncViewportHeight);

    return () => {
      window.removeEventListener('resize', syncViewportHeight);
      visualViewport?.removeEventListener('resize', syncViewportHeight);
      visualViewport?.removeEventListener('scroll', syncViewportHeight);
    };
  }, []);

  useEffect(() => {
    function handleWindowResize() {
      const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      setSidebarWidth((currentWidth) => clampSidebarWidth(currentWidth, workspaceWidth));
    }

    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

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
        body: JSON.stringify({
          content: pendingWrite.content,
          path: pendingWrite.path,
          repoAlias: pendingWrite.repoAlias,
        }),
        keepalive,
        method: 'PUT',
      });

      if (pendingWrite.sequence === writeSequenceRef.current) {
        setStatus(data.status);
      }
    } catch (error) {
      if (handleUnauthorized(error)) {
        return;
      }

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

  function navigateToRepoAlias(repoAlias, { replace = false } = {}) {
    if (typeof window === 'undefined') {
      setRouteRepoAlias(repoAlias);
      return;
    }

    const normalizedAlias = typeof repoAlias === 'string' ? repoAlias.trim() : '';
    const nextPath = normalizedAlias ? `/${encodeURIComponent(normalizedAlias)}` : '/';
    const historyMethod = replace ? 'replaceState' : 'pushState';

    if (window.location.pathname !== nextPath) {
      window.history[historyMethod](null, '', nextPath);
    }

    setRouteRepoAlias(normalizedAlias);
  }

  function promptForSimpleName(label, placeholder) {
    const value = window.prompt(label, placeholder);

    if (value === null) {
      return null;
    }

    const normalizedValue = value.trim();

    if (normalizedValue === '') {
      throw new Error('A name is required.');
    }

    if (
      normalizedValue === '.' ||
      normalizedValue === '..' ||
      PATH_SEPARATOR_PATTERN.test(normalizedValue)
    ) {
      throw new Error('Only a simple name is allowed. Do not include path separators.');
    }

    return normalizedValue;
  }

  async function loadRepoAliases() {
    try {
      const data = await fetchJson('/api/repos');
      const aliases = data.repoAliases ?? [];

      setRepoAliases(aliases);

      return aliases;
    } catch (error) {
      if (handleUnauthorized(error)) {
        return [];
      }

      throw error;
    }
  }

  useEffect(() => {
    const nextActiveRepoAlias =
      routeRepoAlias && repoAliases.includes(routeRepoAlias) ? routeRepoAlias : '';

    setActiveRepoAlias(nextActiveRepoAlias);
  }, [repoAliases, routeRepoAlias]);

  async function loadPublicKey(repoAlias) {
    if (!repoAlias) {
      setPublicKey('');
      return;
    }

    try {
      const data = await fetchJson(`/api/repos/${encodeURIComponent(repoAlias)}/public-key`);
      setPublicKey(data.publicKey);
    } catch (error) {
      if (handleUnauthorized(error)) {
        return;
      }

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
      if (handleUnauthorized(error)) {
        return;
      }

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
      if (handleUnauthorized(error)) {
        return;
      }

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
      setLoadingTree(false);
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
        setLoadingTree(false);
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
      if (handleUnauthorized(error)) {
        return;
      }

      setRepoError(error.message);
    } finally {
      setLoadingTree(false);
    }
  }

  async function refreshTreeState({
    forceReloadFile = false,
    repoAlias = activeRepoAliasRef.current,
  } = {}) {
    if (!repoAlias) {
      setTree(null);
      setStatus(null);
      setSelectedPath(null);
      setContent('');
      setLoadingTree(false);
      return;
    }

    setLoadingTree(true);

    if (flushTimerRef.current) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    pendingWriteRef.current = null;

    try {
      const data = await fetchJson('/api/refresh', {
        body: JSON.stringify({
          repoAlias,
        }),
        method: 'POST',
      });

      setRepoError('');
      setStatus(data.status);
      setTree(data.tree);

      const activePath =
        selectedPathRef.current && hasFilePath(data.tree, selectedPathRef.current)
          ? selectedPathRef.current
          : findFirstFile(data.tree);

      if (!activePath) {
        setSelectedPath(null);
        setContent('');
        return;
      }

      if (forceReloadFile || activePath !== selectedPathRef.current) {
        await loadFile(activePath, repoAlias);
      }
    } catch (error) {
      if (handleUnauthorized(error)) {
        return;
      }

      setRepoError(error.message);
    } finally {
      setLoadingTree(false);
    }
  }

  useEffect(() => {
    if (missingServerUrl) {
      setAppError(
        'Missing server URL. Start the client with --server-url=https://api.notes.localhost.',
      );
      return;
    }

    setAppError('');
    loadSessionState().catch((error) => {
      setAppError(error.message);
      setAuthReady(true);
    });
  }, [missingServerUrl]);

  useEffect(() => {
    if (!isAuthenticated) {
      resetWorkspaceState();
      return;
    }

    loadRepoAliases().catch((error) => {
      setAppError(error.message);
    });
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !activeRepoAlias) {
      setTree(null);
      setStatus(null);
      setSelectedPath(null);
      setContent('');
      setLoadingTree(false);
      return undefined;
    }

    refreshTreeState({ forceReloadFile: true, repoAlias: activeRepoAlias });

    const interval = window.setInterval(() => {
      loadState({ repoAlias: activeRepoAliasRef.current });
    }, 3_000);

    return () => window.clearInterval(interval);
  }, [activeRepoAlias, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || activeSidebarTab !== 'aliases') {
      return;
    }

    loadRepoAliasDetails(editingAlias || activeRepoAlias);
  }, [activeRepoAlias, activeSidebarTab, editingAlias, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || activeSidebarTab !== 'aliases') {
      return;
    }

    loadPublicKey(editingAlias || activeRepoAlias);
  }, [activeRepoAlias, activeSidebarTab, editingAlias, isAuthenticated]);

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

      resizeCleanupRef.current?.();

      window.removeEventListener('beforeunload', flushForLifecycle);
      window.removeEventListener('pagehide', flushForLifecycle);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  function applySidebarWidthFromPointer(clientX) {
    const workspaceRect = workspaceRef.current?.getBoundingClientRect();

    if (!workspaceRect) {
      return;
    }

    const nextWidth = clampSidebarWidth(workspaceRect.right - clientX, workspaceRect.width);
    setSidebarWidth(nextWidth);
  }

  function handleResizeStart(event) {
    if (window.matchMedia(MOBILE_LAYOUT_QUERY).matches) {
      return;
    }

    event.preventDefault();

    const handlePointerMove = (moveEvent) => {
      applySidebarWidthFromPointer(moveEvent.clientX);
    };

    const handlePointerUp = () => {
      document.body.classList.remove('is-resizing-sidebar');
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      resizeCleanupRef.current = null;
    };

    resizeCleanupRef.current = handlePointerUp;
    document.body.classList.add('is-resizing-sidebar');
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }

  function handleResizeKeyDown(event) {
    const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth;

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setSidebarWidth((currentWidth) => clampSidebarWidth(currentWidth + 24, workspaceWidth));
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setSidebarWidth((currentWidth) => clampSidebarWidth(currentWidth - 24, workspaceWidth));
    }
  }

  async function handleFileSelect(path) {
    await flushPendingWrite();
    await loadFile(path, activeRepoAliasRef.current);

    if (isMobileLayout()) {
      scrollToEditorPane();
    }
  }

  async function handleRepoAliasChange(event) {
    const nextRepoAlias = event.target.value;

    try {
      await flushPendingWrite();
    } catch {}

    navigateToRepoAlias(nextRepoAlias);
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
        body: JSON.stringify({
          repo: repoDraft.trim(),
          repoAlias: repoAliasDraft.trim(),
        }),
        method: 'POST',
      });

      setPublicKey(data.publicKey);
      setRepoAliasDraft('');
      setRepoDraft('');
      await loadRepoAliases();
      navigateToRepoAlias(data.repoAlias);
      setEditingAlias(data.repoAlias);
      setEditingRepoDraft(data.repo);
      setActiveSidebarTab('aliases');
    } catch (error) {
      if (handleUnauthorized(error)) {
        return;
      }

      setRepoError(error.message);
    } finally {
      setRegisteringRepo(false);
    }
  }

  async function handleNewFile(parentPath = '') {
    if (!activeRepoAliasRef.current) {
      return;
    }

    await flushPendingWrite();

    try {
      const nextName = promptForSimpleName('New file name', 'untitled.md');

      if (nextName === null) {
        return;
      }

      const nextPath = parentPath ? `${parentPath}/${nextName}` : nextName;
      const data = await fetchJson('/api/files', {
        body: JSON.stringify({
          path: nextPath,
          repoAlias: activeRepoAliasRef.current,
        }),
        method: 'POST',
      });

      setStatus(data.status);
      setTree(data.tree);
      await loadFile(nextPath, activeRepoAliasRef.current);
    } catch (error) {
      if (handleUnauthorized(error)) {
        return;
      }

      setSaveError(error.message);
    }
  }

  async function handleNewFolder(parentPath) {
    if (!activeRepoAliasRef.current) {
      return;
    }

    await flushPendingWrite();

    try {
      const nextName = promptForSimpleName('New folder name', 'drafts');

      if (nextName === null) {
        return;
      }

      const data = await fetchJson('/api/folders', {
        body: JSON.stringify({
          name: nextName,
          parentPath,
          repoAlias: activeRepoAliasRef.current,
        }),
        method: 'POST',
      });

      setStatus(data.status);
      setTree(data.tree);
    } catch (error) {
      if (handleUnauthorized(error)) {
        return;
      }

      setSaveError(error.message);
    }
  }

  async function handleDeleteFolder(folderPath) {
    if (!activeRepoAliasRef.current) {
      return;
    }

    setSaveError('');

    try {
      const data = await fetchJson('/api/folders', {
        body: JSON.stringify({
          path: folderPath,
          repoAlias: activeRepoAliasRef.current,
        }),
        method: 'DELETE',
      });

      setStatus(data.status);
      setTree(data.tree);
    } catch (error) {
      if (handleUnauthorized(error)) {
        return;
      }

      setSaveError(error.message);
    }
  }

  async function handleRefreshTree() {
    if (!activeRepoAliasRef.current) {
      return;
    }

    setSaveError('');
    await refreshTreeState({ forceReloadFile: true, repoAlias: activeRepoAliasRef.current });
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
        body: JSON.stringify({
          repo: editingRepoDraft.trim(),
        }),
        method: 'PUT',
      });

      setEditingRepoDraft(data.repo);

      if (activeRepoAlias === data.repoAlias) {
        await loadState({ forceReloadFile: true, repoAlias: data.repoAlias });
      }
    } catch (error) {
      if (handleUnauthorized(error)) {
        return;
      }

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
      const deletedActiveAlias = activeRepoAliasRef.current === deletedAlias;

      if (deletedActiveAlias) {
        navigateToRepoAlias('', { replace: true });
      }

      await loadRepoAliases();

      if (deletedAlias === activeRepoAliasRef.current) {
        pendingWriteRef.current = null;
      }

      setEditingAlias('');
      setEditingRepoDraft('');

      if (deletedActiveAlias) {
        setTree(null);
        setStatus(null);
        setSelectedPath(null);
        setContent('');
        setPublicKey('');
      }
    } catch (error) {
      if (handleUnauthorized(error)) {
        return;
      }

      setRepoError(error.message);
    } finally {
      setDeletingAlias(false);
    }
  }

  function updateEditorContent(nextContent) {
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

  function handleEditorChange(event) {
    updateEditorContent(event.target.value);
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();

    setAuthBusy(true);
    setAuthError('');

    try {
      if (authMode === 'register' && passwordDraft !== confirmPasswordDraft) {
        throw new Error('Passwords do not match.');
      }

      const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const data = await fetchJson(endpoint, {
        body: JSON.stringify({
          password: passwordDraft,
          username: usernameDraft,
        }),
        method: 'POST',
      });

      setAuthUser(data.user);
      setAuthReady(true);
      setAuthError('');
      setUsernameDraft('');
      setPasswordDraft('');
      setConfirmPasswordDraft('');
      await loadSessionState();
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogout() {
    try {
      await flushPendingWrite();
    } catch {}

    try {
      await fetchJson('/api/auth/logout', {
        method: 'POST',
      });
    } catch {}

    resetWorkspaceState();
    setAuthUser(null);
    setAuthReady(true);
    setAuthError('');
    await loadSessionState().catch((error) => {
      setAppError(error.message);
    });
  }

  const title = useMemo(() => {
    if (!selectedPath) {
      return activeRepoAlias ? `Repo alias: ${activeRepoAlias}` : 'No repo alias selected';
    }

    return selectedPath;
  }, [activeRepoAlias, selectedPath]);
  const isMarkdownFile = useMemo(() => {
    if (!selectedPath) {
      return false;
    }

    return selectedPath.toLowerCase().endsWith('.md');
  }, [selectedPath]);
  const markdownEditorExtensions = useMemo(
    () => [
      markdown(),
      EditorView.lineWrapping,
      EditorView.editorAttributes.of({
        autocapitalize: 'sentences',
        autocorrect: 'off',
        autocomplete: 'on',
      }),
      EditorView.contentAttributes.of({
        autocapitalize: 'sentences',
        autocorrect: 'off',
        autocomplete: 'on',
      }),
    ],
    [],
  );
  const markdownPreviewActive = isMarkdownFile && showMarkdownPreview;

  useEffect(() => {
    if (!isMarkdownFile && showMarkdownPreview) {
      setShowMarkdownPreview(false);
    }
  }, [isMarkdownFile, showMarkdownPreview]);

  const repoSlug = status?.repo ?? '';
  const deployKeyUrl = repoSlug ? `https://github.com/${repoSlug}/settings/keys` : '';
  const mobileEditorTitle = getMobileEditorTitle(selectedPath);
  const workspaceStyle = useMemo(
    () => ({
      '--sidebar-width': `${sidebarWidth}px`,
      ...(viewportHeight ? { '--viewport-height': `${viewportHeight}px` } : {}),
    }),
    [sidebarWidth, viewportHeight],
  );

  if (appError) {
    return (
      <main className="app-shell">
        <section className="error-panel">
          <p className="eyebrow">Configuration required</p>
          <h1>GitHub Note Sync</h1>
          <p>{appError}</p>
          <p className="secondary-copy">
            Start the client with <code>npm run dev -- --server-url=https://api.notes.localhost</code>
            , or point it at the deployed API URL.
          </p>
        </section>
      </main>
    );
  }

  if (!authReady) {
    return (
      <main className="app-shell">
        <section className="error-panel">
          <p className="eyebrow">Connecting</p>
          <h1>GitHub Note Sync</h1>
          <p>Checking the server session and authentication policy…</p>
        </section>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <AuthScreen
        authBusy={authBusy}
        authError={authError}
        authMode={authMode}
        confirmPasswordDraft={confirmPasswordDraft}
        hasUsers={hasUsers}
        onModeChange={setAuthMode}
        onSubmit={handleAuthSubmit}
        passwordDraft={passwordDraft}
        registrationOpen={registrationOpen}
        serverUrl={SERVER_URL}
        setConfirmPasswordDraft={setConfirmPasswordDraft}
        setPasswordDraft={setPasswordDraft}
        setUsernameDraft={setUsernameDraft}
        usernameDraft={usernameDraft}
      />
    );
  }

  return (
    <main className="app-shell">
      <section className="workspace" ref={workspaceRef} style={workspaceStyle}>
        <section className="editor-pane" ref={editorPaneRef}>
          {mobileLayout ? (
            <header className="pane-header pane-header-mobile-editor">
              <div className="editor-header-copy editor-header-copy-mobile">
                <button
                  aria-label="Go back to file tree"
                  className="editor-mobile-back"
                  onClick={scrollToFileTree}
                  type="button"
                >
                  &lt;
                </button>
                {isMarkdownFile ? (
                  <button
                    aria-label={markdownPreviewActive ? 'Show markdown editor' : 'Show markdown preview'}
                    className="editor-mobile-toggle"
                    onClick={() => {
                      setShowMarkdownPreview((current) => !current);
                    }}
                    title={markdownPreviewActive ? 'Edit markdown source' : 'Preview rendered markdown'}
                    type="button"
                  >
                    {markdownPreviewActive ? '<>' : '#'}
                  </button>
                ) : null}
                <h1>{mobileEditorTitle}</h1>
              </div>
              <SyncBadge compact status={status} />
            </header>
          ) : (
            <header className="pane-header">
              <div className="editor-header-copy">
                <div>
                  <p className="eyebrow">Editor</p>
                  <h1>{title}</h1>
                </div>
              </div>
              <div className="header-actions">
                {isMarkdownFile ? (
                  <button
                    aria-label={markdownPreviewActive ? 'Show markdown editor' : 'Show markdown preview'}
                    className="editor-preview-toggle"
                    onClick={() => {
                      setShowMarkdownPreview((current) => !current);
                    }}
                    title={markdownPreviewActive ? 'Edit markdown source' : 'Preview rendered markdown'}
                    type="button"
                  >
                    {markdownPreviewActive ? '<>' : '#'}
                  </button>
                ) : null}
                <span className="user-badge">{authUser.username}</span>
                <SyncBadge status={status} />
              </div>
            </header>
          )}

          <div className="status-row">
            <span>
              {activeRepoAlias ? `alias:${activeRepoAlias}` : 'No repo alias selected'}
              {status?.repo ? ` · ${status.repo}` : ''}
              {status?.branch ? ` · ${status.branch}` : ''}
            </span>
            <span>{repoError || status?.lastSyncMessage}</span>
          </div>

          <section className="editor-surface">
            {!activeRepoAlias ? null : repoError ? (
              <div className="empty-state">{repoError}</div>
            ) : loadingTree ? (
              <div className="empty-state">Loading repository structure…</div>
            ) : selectedPath ? (
              markdownPreviewActive ? (
                <div className="markdown-preview">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                </div>
              ) : isMarkdownFile ? (
                <CodeMirror
                  basicSetup={{
                    lineNumbers: false,
                    foldGutter: false,
                    highlightActiveLineGutter: false,
                  }}
                  className="editor-code"
                  extensions={markdownEditorExtensions}
                  onBlur={() => {
                    flushPendingWrite().catch(() => {});
                  }}
                  onChange={(nextValue) => {
                    updateEditorContent(nextValue);
                  }}
                  spellCheck
                  value={content}
                />
              ) : (
                <textarea
                  autoCapitalize="sentences"
                  autoCorrect="on"
                  className="editor-textarea"
                  onBlur={() => {
                    flushPendingWrite().catch(() => {});
                  }}
                  onChange={handleEditorChange}
                  spellCheck={false}
                  value={content}
                />
              )
            ) : (
              <div className="empty-state">This repository does not contain any files yet.</div>
            )}
          </section>

          <footer className="footer-row">
            <span>{loadingFile ? 'Loading file…' : 'Edits write through to the local clone.'}</span>
            <span>{saveError}</span>
          </footer>
        </section>

        <div
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          className="pane-resizer"
          onKeyDown={handleResizeKeyDown}
          onPointerDown={handleResizeStart}
          role="separator"
          tabIndex={0}
        />

        <aside className="tree-pane" ref={treePaneRef}>
          <header className="pane-header pane-header-sidebar">
            <div>
              <p className="eyebrow">Repository</p>
              <h2>Files</h2>
            </div>
            <div className="tree-header-actions">
              <button className="ghost-button tree-logout-button" onClick={handleLogout} type="button">
                Log out
              </button>
            </div>
          </header>

          <div aria-label="Repository actions" className="tab-row" role="tablist">
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
              aria-selected={activeSidebarTab === 'aliases'}
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
                      <span aria-hidden="true" className="copy-icon">
                        <span className="copy-icon-back" />
                        <span className="copy-icon-front" />
                      </span>
                    </button>
                  </div>
                  <div className="key-block-shell key-block-shell-inline">
                    <pre className="key-block">
                      {editingAlias
                        ? publicKey || 'Loading public key…'
                        : 'Select an alias to view its public key.'}
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
            <span>Auto-sync to server every {(status?.syncIntervalMs ?? 30_000) / 1000}s</span>
            <span>{repoAliases.length} aliases</span>
          </div>

          <div className="tree-scroll">
            {activeSidebarTab === 'select' && tree ? (
              <TreeNode
                node={tree}
                onCreateFile={!activeRepoAlias || repoError !== '' ? null : handleNewFile}
                onCreateFolder={!activeRepoAlias || repoError !== '' ? null : handleNewFolder}
                onDeleteFolder={!activeRepoAlias || repoError !== '' ? null : handleDeleteFolder}
                onRefresh={!activeRepoAlias || repoError !== '' ? null : handleRefreshTree}
                onSelect={handleFileSelect}
                selectedPath={selectedPath}
              />
            ) : activeSidebarTab === 'select' && loadingTree ? (
              <div className="empty-state">Loading repository structure…</div>
            ) : activeSidebarTab === 'select' && activeRepoAlias ? (
              <div className="empty-state">No files loaded for this repo alias yet.</div>
            ) : activeSidebarTab === 'select' ? null : activeSidebarTab === 'aliases' ? (
              <div className="empty-state">
                Create new aliases or edit the repo URL for an existing alias.
              </div>
            ) : (
              <div className="empty-state">Create a repo alias to generate its SSH keypair.</div>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}
