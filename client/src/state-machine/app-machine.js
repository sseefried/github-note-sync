export function createInitialAppMachineState(connectivity = 'online') {
  return {
    connectivity,
    session: {
      hasUsers: true,
      phase: 'booting',
      registrationOpen: false,
      user: null,
    },
    workspace: {
      error: '',
      phase: 'none',
      status: null,
      tree: null,
      file: {
        content: '',
        debugBaseCommit: null,
        path: null,
        phase: 'none',
        saveError: '',
      },
      interaction: {
        phase: 'browsing',
        resolution: null,
      },
      replica: {
        blockedConflictCount: 0,
        pendingOperationCount: 0,
      },
      sync: {
        phase: 'idle',
      },
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
  const nextResolution = resolution?.resolution ?? resolution;

  if (!nextResolution || resolution?.phase !== 'resolving' || !nextResolution.prompt) {
    return '';
  }

  const { prompt } = nextResolution;

  if (nextResolution.kind === 'merge_with_remote') {
    return `${prompt.repoAlias ?? ''}:${prompt.path ?? ''}:${prompt.opId ?? ''}`;
  }

  return `${nextResolution.kind}:${prompt.repoAlias ?? ''}:${prompt.path ?? ''}`;
}

export function buildResolutionState(
  {
    fastForward = null,
    reloadPrompt = null,
    selectedConflict = null,
  },
  currentResolution = createInitialAppMachineState().workspace.interaction,
) {
  let nextInteraction = {
    phase: 'browsing',
    resolution: null,
  };

  if (reloadPrompt) {
    nextInteraction = {
      phase: 'resolving',
      resolution: {
        busy: false,
        kind: 'reload_from_server',
        prompt: reloadPrompt,
      },
    };
  } else if (fastForward) {
    nextInteraction = {
      phase: 'resolving',
      resolution: {
        busy: false,
        kind: 'fast_forward',
        prompt: fastForward,
      },
    };
  } else if (selectedConflict) {
    nextInteraction = {
      phase: 'resolving',
      resolution: {
        busy: false,
        kind: 'merge_with_remote',
        prompt: selectedConflict,
      },
    };
  }

  if (
    currentResolution?.phase === 'resolving' &&
    currentResolution.resolution?.busy &&
    currentResolution.resolution.kind === nextInteraction.resolution?.kind &&
    getResolutionPromptIdentity(currentResolution) === getResolutionPromptIdentity(nextInteraction)
  ) {
    return {
      ...nextInteraction,
      resolution: {
        ...nextInteraction.resolution,
        busy: true,
      },
    };
  }

  return nextInteraction;
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
        workspace: {
          ...state.workspace,
          file: {
            ...state.workspace.file,
            ...action.patch,
          },
        },
      };
    case 'FILE_SET_PHASE':
      return {
        ...state,
        workspace: {
          ...state.workspace,
          file: {
            ...state.workspace.file,
            phase: action.phase,
          },
        },
      };
    case 'REPLICA_PATCH':
      return {
        ...state,
        workspace: {
          ...state.workspace,
          replica: {
            ...state.workspace.replica,
            ...action.patch,
          },
        },
      };
    case 'RESOLUTION_SET':
      return {
        ...state,
        workspace: {
          ...state.workspace,
          interaction: action.resolution,
        },
      };
    case 'RESOLUTION_SET_BUSY':
      if (state.workspace.interaction.phase !== 'resolving' || !state.workspace.interaction.resolution) {
        return state;
      }

      return {
        ...state,
        workspace: {
          ...state.workspace,
          interaction: {
            ...state.workspace.interaction,
            resolution: {
              ...state.workspace.interaction.resolution,
              busy: action.busy,
            },
          },
        },
      };
    case 'SYNC_SET_PHASE':
      return {
        ...state,
        workspace: {
          ...state.workspace,
          sync: {
            ...state.workspace.sync,
            phase: action.phase,
          },
        },
      };
    case 'RESET_WORKSPACE_MACHINE': {
      const initialState = createInitialAppMachineState(state.connectivity);

      return {
        ...state,
        workspace: initialState.workspace,
      };
    }
    default:
      return state;
  }
}
