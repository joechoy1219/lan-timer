import { withElapsedCommitted } from './timerEngine'
import type { ReducerAction, RoomState } from './types'

const TIMELINE_LIMIT = 24

const markUpdated = (state: RoomState, now: number) => ({
  ...state,
  seq: state.seq + 1,
  updatedAt: now,
})

const pushTimeline = (state: RoomState, message: string, now: number): RoomState => ({
  ...state,
  timeline: [
    {
      id: `evt-${state.seq + 1}-${now}`,
      message,
      at: now,
    },
    ...state.timeline,
  ].slice(0, TIMELINE_LIMIT),
})

const getPlayerName = (state: RoomState, playerId: string | null) => {
  if (!playerId) {
    return 'Unknown'
  }
  return state.players.find((player) => player.id === playerId)?.name ?? 'Unknown'
}

const resolveTurnOrder = (state: RoomState, order?: string[]) => {
  const existingPlayerIds = state.players.map((player) => player.id)
  const filtered = (order ?? state.turnOrder).filter((id) => existingPlayerIds.includes(id))
  const appended = existingPlayerIds.filter((id) => !filtered.includes(id))
  const nextOrder = [...filtered, ...appended]
  return nextOrder.length > 0 ? nextOrder : existingPlayerIds
}

const withResolvedTurn = (state: RoomState, now: number, order?: string[]): RoomState => {
  const turnOrder = resolveTurnOrder(state, order)
  const activeIndex = Math.max(0, Math.min(state.turnIndex, Math.max(0, turnOrder.length - 1)))
  const activePlayerId = turnOrder[activeIndex] ?? null

  return {
    ...state,
    turnOrder,
    turnIndex: activeIndex,
    activePlayerId,
    lastTurnSwitchedAt: activePlayerId ? state.lastTurnSwitchedAt ?? now : null,
  }
}

const advanceTurn = (state: RoomState, now: number): RoomState => {
  if (state.turnOrder.length === 0) {
    return state
  }

  const nextIndex = (state.turnIndex + 1) % state.turnOrder.length
  const wrapped = nextIndex === 0

  return {
    ...state,
    turnIndex: nextIndex,
    activePlayerId: state.turnOrder[nextIndex] ?? null,
    lastTurnSwitchedAt: now,
    round: wrapped ? state.round + 1 : state.round,
    isRunning: !state.globalPaused,
    lastStartedAt: state.globalPaused ? null : now,
    phase: state.globalPaused ? 'paused' : 'running',
  }
}

export const applyHostAction = (rawState: RoomState, action: ReducerAction): RoomState => {
  let state = withElapsedCommitted(rawState, action.now)
  const now = action.now
  const isHostActor = action.actorId === state.hostPlayerId

  switch (action.type) {
    case 'START_TIMER': {
      const playerId = (action.payload?.playerId as string | undefined) ?? action.actorId
      if (state.globalPaused || !state.players.some((player) => player.id === playerId)) {
        return state
      }

      const turnIndex = state.turnOrder.indexOf(playerId)
      state = {
        ...state,
        turnIndex: turnIndex >= 0 ? turnIndex : state.turnIndex,
        activePlayerId: playerId,
        isRunning: true,
        lastStartedAt: now,
        phase: 'running',
        lastTurnSwitchedAt: now,
      }
      state = pushTimeline(state, `Timer started on ${getPlayerName(state, playerId)}.`, now)
      return markUpdated(state, now)
    }
    case 'START_ROUND': {
      if (!isHostActor || state.turnOrder.length === 0) {
        return state
      }
      const turnIndex = Math.max(0, Math.min(state.turnIndex, state.turnOrder.length - 1))
      state = {
        ...state,
        turnIndex,
        activePlayerId: state.turnOrder[turnIndex] ?? null,
        isRunning: !state.globalPaused,
        lastStartedAt: state.globalPaused ? null : now,
        phase: state.globalPaused ? 'paused' : 'running',
        lastTurnSwitchedAt: now,
      }
      state = pushTimeline(state, `Round started. ${getPlayerName(state, state.activePlayerId)} is up.`, now)
      return markUpdated(state, now)
    }
    case 'END_TURN': {
      if (!state.activePlayerId || state.phase === 'lobby') {
        return state
      }
      if (action.actorId !== state.activePlayerId) {
        return state
      }
      const actorName = getPlayerName(state, action.actorId)
      state = advanceTurn(state, now)
      state = pushTimeline(state, `${actorName} ended turn. ${getPlayerName(state, state.activePlayerId)} is up.`, now)
      return markUpdated(state, now)
    }
    case 'PAUSE_TIMER': {
      state = {
        ...state,
        isRunning: false,
        lastStartedAt: null,
        phase: state.phase === 'lobby' ? 'lobby' : 'paused',
      }
      state = pushTimeline(state, 'Timer paused.', now)
      return markUpdated(state, now)
    }
    case 'SWITCH_ACTIVE': {
      const nextPlayerId = action.payload?.nextPlayerId as string | undefined
      if (!isHostActor || !nextPlayerId || !state.players.some((player) => player.id === nextPlayerId)) {
        return state
      }
      const nextIndex = state.turnOrder.indexOf(nextPlayerId)
      state = {
        ...state,
        turnIndex: nextIndex >= 0 ? nextIndex : state.turnIndex,
        activePlayerId: nextPlayerId,
        isRunning: !state.globalPaused,
        lastStartedAt: state.globalPaused ? null : now,
        phase: state.globalPaused ? 'paused' : 'running',
        lastTurnSwitchedAt: now,
      }
      state = pushTimeline(state, `Host switched active player to ${getPlayerName(state, nextPlayerId)}.`, now)
      return markUpdated(state, now)
    }
    case 'SET_TURN_ORDER': {
      if (!isHostActor) {
        return state
      }
      const requestedOrder = action.payload?.turnOrder as string[] | undefined
      if (!Array.isArray(requestedOrder) || requestedOrder.length === 0) {
        return state
      }

      const currentActive = state.activePlayerId
      state = withResolvedTurn(state, now, requestedOrder)
      if (currentActive && state.turnOrder.includes(currentActive)) {
        state = {
          ...state,
          turnIndex: state.turnOrder.indexOf(currentActive),
          activePlayerId: currentActive,
        }
      }
      state = pushTimeline(state, 'Turn order was updated by host.', now)
      return markUpdated(state, now)
    }
    case 'FORCE_NEXT': {
      if (!isHostActor || state.phase === 'lobby') {
        return state
      }
      state = advanceTurn(state, now)
      state = pushTimeline(state, `Host forced next turn. ${getPlayerName(state, state.activePlayerId)} is up.`, now)
      return markUpdated(state, now)
    }
    case 'RESET_ALL': {
      const nextActivePlayerId = state.turnOrder[0] ?? null
      state = {
        ...state,
        players: state.players.map((player) => ({
          ...player,
          remainingMs: state.initialTimeMs,
        })),
        turnIndex: 0,
        activePlayerId: nextActivePlayerId,
        globalPaused: false,
        isRunning: Boolean(nextActivePlayerId),
        lastStartedAt: nextActivePlayerId ? now : null,
        phase: nextActivePlayerId ? 'running' : 'lobby',
        round: 1,
        lastTurnSwitchedAt: nextActivePlayerId ? now : null,
      }
      state = pushTimeline(state, `All timers reset. ${getPlayerName(state, nextActivePlayerId)} starts from turn #1.`, now)
      return markUpdated(state, now)
    }
    case 'SET_INITIAL_TIME': {
      const initialTimeMs = Number(action.payload?.initialTimeMs)
      if (!Number.isFinite(initialTimeMs) || initialTimeMs <= 0) {
        return state
      }
      state = {
        ...state,
        initialTimeMs,
        players: state.players.map((player) => ({
          ...player,
          remainingMs: initialTimeMs,
        })),
        turnIndex: 0,
        activePlayerId: state.turnOrder[0] ?? null,
        isRunning: false,
        lastStartedAt: null,
        phase: 'lobby',
        round: 1,
        lastTurnSwitchedAt: null,
      }
      state = pushTimeline(state, `Initial time set to ${Math.round(initialTimeMs / 60_000)} minute(s).`, now)
      return markUpdated(state, now)
    }
    case 'GLOBAL_PAUSE': {
      state = {
        ...state,
        globalPaused: true,
        isRunning: false,
        lastStartedAt: null,
        phase: state.phase === 'lobby' ? 'lobby' : 'paused',
      }
      state = pushTimeline(state, 'Paused.', now)
      return markUpdated(state, now)
    }
    case 'GLOBAL_RESUME': {
      state = {
        ...state,
        globalPaused: false,
        isRunning: state.phase !== 'lobby' && Boolean(state.activePlayerId),
        lastStartedAt: state.phase !== 'lobby' && state.activePlayerId ? now : null,
        phase: state.phase === 'lobby' ? 'lobby' : 'running',
      }
      state = pushTimeline(state, 'Resumed.', now)
      return markUpdated(state, now)
    }
    case 'RENAME_SELF': {
      const nextName = String(action.payload?.name ?? '').trim()
      if (!nextName) {
        return state
      }
      state = {
        ...state,
        players: state.players.map((player) =>
          player.id === action.actorId
            ? {
                ...player,
                name: nextName.slice(0, 24),
              }
            : player,
        ),
      }
      state = pushTimeline(state, `${getPlayerName(state, action.actorId)} updated display name.`, now)
      return markUpdated(state, now)
    }
    default:
      return state
  }
}
