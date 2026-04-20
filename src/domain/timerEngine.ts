import type { PlayerState, RoomState } from './types'

export const clampMs = (value: number) => Math.max(0, Math.floor(value))

export const getElapsedSince = (state: RoomState, now: number) => {
  if (!state.isRunning || !state.activePlayerId || !state.lastStartedAt) {
    return 0
  }
  return Math.max(0, now - state.lastStartedAt)
}

export const withElapsedCommitted = (state: RoomState, now: number): RoomState => {
  if (!state.isRunning || !state.activePlayerId || !state.lastStartedAt) {
    return state
  }

  const elapsed = getElapsedSince(state, now)
  if (elapsed <= 0) {
    return state
  }

  const players = state.players.map((player) => {
    if (player.id !== state.activePlayerId) {
      return player
    }

    return {
      ...player,
      remainingMs: clampMs(player.remainingMs - elapsed),
    }
  })

  return {
    ...state,
    players,
    lastStartedAt: now,
    updatedAt: now,
  }
}

export const resolveRemainingMs = (player: PlayerState, state: RoomState, now: number) => {
  if (!state.isRunning || state.activePlayerId !== player.id || !state.lastStartedAt) {
    return clampMs(player.remainingMs)
  }
  return clampMs(player.remainingMs - (now - state.lastStartedAt))
}

export const formatMs = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return `${mm}:${ss}`
}
