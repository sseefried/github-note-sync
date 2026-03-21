export function createInitialAppMachineState(connectivity = 'online') {
  return {
    connectivity,
    file: {
      content: '',
      debugBaseCommit: null,
      path: null,
      phase: 'none',
      saveError: '',
    },
    replica: {
      blockedConflictCount: 0,
      pendingOperationCount: 0,
    },
    resolution: {
      busy: false,
      kind: 'none',
      prompt: null,
    },
    session: {
      hasUsers: true,
      phase: 'booting',
      registrationOpen: false,
      user: null,
    },
    sync: {
      phase: 'idle',
    },
    workspace: {
      error: '',
      phase: 'none',
      status: null,
      tree: null,
    },
  };
}

export function deriveWorkspacePhase({
  error = '',
  hasActiveRepoAlias = false,
  loading = false,
}) {
  if (loading) {
    return 'hydrating';
  }

  if (!hasActiveRepoAlias) {
    return 'none';
  }

  if (error) {
    return 'unavailable';
  }

  return 'ready';
}

export function deriveFilePhase({
  loading = false,
  path = null,
}) {
  if (loading) {
    return 'loading';
  }

  return path ? 'ready' : 'none';
}

function getResolutionPromptIdentity(resolution) {
  if (!resolution || resolution.kind === 'none' || !resolution.prompt) {
    return '';
  }

  const { prompt } = resolution;

  if (resolution.kind === 'merge_with_remote') {
    return `${prompt.repoAlias ?? ''}:${prompt.path ?? ''}:${prompt.opId ?? ''}`;
  }

  return `${resolution.kind}:${prompt.repoAlias ?? ''}:${prompt.path ?? ''}`;
}

export function buildResolutionState(
  {
    fastForward = null,
    reloadPrompt = null,
    selectedConflict = null,
  },
  currentResolution = createInitialAppMachineState().resolution,
) {
  let nextResolution = {
    busy: false,
    kind: 'none',
    prompt: null,
  };

  if (reloadPrompt) {
    nextResolution = {
      busy: false,
      kind: 'reload_from_server',
      prompt: reloadPrompt,
    };
  } else if (fastForward) {
    nextResolution = {
      busy: false,
      kind: 'fast_forward',
      prompt: fastForward,
    };
  } else if (selectedConflict) {
    nextResolution = {
      busy: false,
      kind: 'merge_with_remote',
      prompt: selectedConflict,
    };
  }

  if (
    currentResolution?.busy &&
    currentResolution.kind === nextResolution.kind &&
    getResolutionPromptIdentity(currentResolution) === getResolutionPromptIdentity(nextResolution)
  ) {
    return {
      ...nextResolution,
      busy: true,
    };
  }

  return nextResolution;
}

export function appMachineReducer(state, action) {
  switch (action.type) {
    case 'SESSION_PATCH':
      return {
        ...state,
        session: {
          ...state.session,
          ...action.patch,
        },
      };
    case 'CONNECTIVITY_SET':
      return {
        ...state,
        connectivity: action.connectivity,
      };
    case 'WORKSPACE_PATCH':
      return {
        ...state,
        workspace: {
          ...state.workspace,
          ...action.patch,
        },
      };
    case 'WORKSPACE_SET_PHASE':
      return {
        ...state,
        workspace: {
          ...state.workspace,
          phase: action.phase,
        },
      };
    case 'FILE_PATCH':
      return {
        ...state,
        file: {
          ...state.file,
          ...action.patch,
        },
      };
    case 'FILE_SET_PHASE':
      return {
        ...state,
        file: {
          ...state.file,
          phase: action.phase,
        },
      };
    case 'REPLICA_PATCH':
      return {
        ...state,
        replica: {
          ...state.replica,
          ...action.patch,
        },
      };
    case 'RESOLUTION_SET':
      return {
        ...state,
        resolution: action.resolution,
      };
    case 'RESOLUTION_SET_BUSY':
      if (state.resolution.kind === 'none') {
        return state;
      }

      return {
        ...state,
        resolution: {
          ...state.resolution,
          busy: action.busy,
        },
      };
    case 'SYNC_SET_PHASE':
      return {
        ...state,
        sync: {
          ...state.sync,
          phase: action.phase,
        },
      };
    case 'RESET_WORKSPACE_MACHINE': {
      const initialState = createInitialAppMachineState(state.connectivity);

      return {
        ...state,
        file: initialState.file,
        replica: initialState.replica,
        resolution: initialState.resolution,
        sync: initialState.sync,
        workspace: initialState.workspace,
      };
    }
    default:
      return state;
  }
}
