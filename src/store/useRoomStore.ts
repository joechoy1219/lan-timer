import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { applyHostAction } from '../domain/reducer'
import type { ReducerAction, RoomState } from '../domain/types'
import { loadSnapshot, saveSnapshot } from '../persistence/db'
import { sha256 } from '../network/protocol'

const TIMELINE_LIMIT = 24

const normalizeRoomState = (rawState: RoomState): RoomState => {
  const fallbackOrder = rawState.players.map((player) => player.id)
  const givenOrder = Array.isArray((rawState as Partial<RoomState>).turnOrder)
    ? (rawState as Partial<RoomState>).turnOrder ?? []
    : []
  const turnOrder = [...givenOrder.filter((id) => fallbackOrder.includes(id)), ...fallbackOrder.filter((id) => !givenOrder.includes(id))]
  const safeOrder = turnOrder.length > 0 ? turnOrder : fallbackOrder
  const baseIndex = Number.isFinite((rawState as Partial<RoomState>).turnIndex)
    ? Number((rawState as Partial<RoomState>).turnIndex)
    : 0
  const turnIndex = Math.max(0, Math.min(baseIndex, Math.max(0, safeOrder.length - 1)))
  const phase = (rawState as Partial<RoomState>).phase ?? (rawState.isRunning ? 'running' : 'lobby')
  const round = Math.max(1, Number((rawState as Partial<RoomState>).round ?? 1))

  return {
    ...rawState,
    timeline: (rawState as Partial<RoomState>).timeline?.slice(0, TIMELINE_LIMIT) ?? [],
    turnOrder: safeOrder,
    turnIndex,
    phase,
    round,
    lastTurnSwitchedAt: (rawState as Partial<RoomState>).lastTurnSwitchedAt ?? null,
    activePlayerId: rawState.activePlayerId ?? safeOrder[turnIndex] ?? null,
  }
}

interface RoomStore {
  state: RoomState | null
  nowMs: number
  statusText: string
  setStatusText: (value: string) => void
  tick: () => void
  createRoom: (input: {
    roomName: string
    joinCode: string
    hostPeerId: string
  }) => Promise<RoomState>
  hydrateFromSnapshot: (roomId: string) => Promise<RoomState | null>
  setStateFromHost: (nextState: RoomState) => void
  applyHostAction: (action: ReducerAction) => Promise<RoomState | null>
  leaveRoom: () => void
}

const saveIfReady = async (state: RoomState | null) => {
  if (!state) {
    return
  }
  await saveSnapshot({ roomId: state.roomId, state, savedAt: Date.now() })
}

export const useRoomStore = create<RoomStore>((set, get) => ({
  state: null,
  nowMs: Date.now(),
  statusText: 'Idle',
  setStatusText: (value) => set({ statusText: value }),
  tick: () => set({ nowMs: Date.now() }),
  createRoom: async ({ roomName, joinCode, hostPeerId }) => {
    const roomId = joinCode
    const hostPlayerId = nanoid(12)
    const initialTimeMs = 10 * 60_000
    const passwordHash = await sha256(joinCode)

    const state: RoomState = {
      roomId,
      roomName: roomName.trim() || 'LAN Timer Room',
      hostPeerId,
      hostPlayerId,
      localPlayerId: hostPlayerId,
      role: 'host',
      passwordHash,
      initialTimeMs,
      players: [
        {
          id: hostPlayerId,
          name: 'Host',
          remainingMs: initialTimeMs,
          connected: true,
          lastPeerId: hostPeerId,
        },
      ],
      timeline: [
        {
          id: `room-created-${Date.now()}`,
          message: 'Room created. Waiting for players.',
          at: Date.now(),
        },
      ],
      turnOrder: [hostPlayerId],
      turnIndex: 0,
      phase: 'lobby',
      round: 1,
      lastTurnSwitchedAt: null,
      activePlayerId: hostPlayerId,
      isRunning: false,
      globalPaused: false,
      lastStartedAt: null,
      seq: 0,
      updatedAt: Date.now(),
    }

    set({ state, statusText: 'Room created. Waiting for players...' })
    await saveIfReady(state)
    return state
  },
  hydrateFromSnapshot: async (roomId) => {
    const snapshot = await loadSnapshot(roomId)
    if (!snapshot?.state) {
      return null
    }
    return normalizeRoomState(snapshot.state)
  },
  setStateFromHost: (nextState) => {
    const normalized = normalizeRoomState(nextState)
    set({ state: normalized })
    void saveIfReady(normalized)
  },
  applyHostAction: async (action) => {
    const current = get().state
    if (!current || current.role !== 'host') {
      return null
    }
    const nextState = applyHostAction(current, action)
    set({ state: nextState })
    await saveIfReady(nextState)
    return nextState
  },
  leaveRoom: () => set({ state: null, statusText: 'Idle' }),
}))
