import { withElapsedCommitted } from './timerEngine'
import type { ReducerAction, RoomState } from './types'

const markUpdated = (state: RoomState, now: number) => ({
  ...state,
  seq: state.seq + 1,
  updatedAt: now,
})

export const applyHostAction = (rawState: RoomState, action: ReducerAction): RoomState => {
  let state = withElapsedCommitted(rawState, action.now)
  const now = action.now

  switch (action.type) {
    case 'START_TIMER': {
      const playerId = (action.payload?.playerId as string | undefined) ?? action.actorId
      if (state.globalPaused || !state.players.some((player) => player.id === playerId)) {
        return state
      }
      state = {
        ...state,
        activePlayerId: playerId,
        isRunning: true,
        lastStartedAt: now,
      }
      return markUpdated(state, now)
    }
    case 'PAUSE_TIMER': {
      state = {
        ...state,
        isRunning: false,
        lastStartedAt: null,
      }
      return markUpdated(state, now)
    }
    case 'SWITCH_ACTIVE': {
      const nextPlayerId = action.payload?.nextPlayerId as string | undefined
      if (!nextPlayerId || !state.players.some((player) => player.id === nextPlayerId)) {
        return state
      }
      state = {
        ...state,
        activePlayerId: nextPlayerId,
        isRunning: !state.globalPaused,
        lastStartedAt: state.globalPaused ? null : now,
      }
      return markUpdated(state, now)
    }
    case 'RESET_ALL': {
      state = {
        ...state,
        players: state.players.map((player) => ({
          ...player,
          remainingMs: state.initialTimeMs,
        })),
        activePlayerId: null,
        isRunning: false,
        lastStartedAt: null,
      }
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
        activePlayerId: null,
        isRunning: false,
        lastStartedAt: null,
      }
      return markUpdated(state, now)
    }
    case 'GLOBAL_PAUSE': {
      state = {
        ...state,
        globalPaused: true,
        isRunning: false,
        lastStartedAt: null,
      }
      return markUpdated(state, now)
    }
    case 'GLOBAL_RESUME': {
      state = {
        ...state,
        globalPaused: false,
        isRunning: Boolean(state.activePlayerId),
        lastStartedAt: state.activePlayerId ? now : null,
      }
      return markUpdated(state, now)
    }
    case 'KICK_PLAYER': {
      const targetId = action.payload?.targetId as string | undefined
      if (!targetId || targetId === state.hostPlayerId) {
        return state
      }
      state = {
        ...state,
        players: state.players.filter((player) => player.id !== targetId),
        activePlayerId: state.activePlayerId === targetId ? null : state.activePlayerId,
        isRunning: state.activePlayerId === targetId ? false : state.isRunning,
        lastStartedAt: state.activePlayerId === targetId ? null : state.lastStartedAt,
      }
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
      return markUpdated(state, now)
    }
    default:
      return state
  }
}
