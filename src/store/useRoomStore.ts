import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { applyHostAction } from '../domain/reducer'
import type { ReducerAction, RoomState } from '../domain/types'
import { loadSnapshot, saveSnapshot } from '../persistence/db'
import { sha256 } from '../network/protocol'

interface RoomStore {
  state: RoomState | null
  nowMs: number
  statusText: string
  setStatusText: (value: string) => void
  tick: () => void
  createRoom: (input: {
    roomName: string
    hostName: string
    password: string
    initialMinutes: number
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
  createRoom: async ({ roomName, hostName, password, initialMinutes, hostPeerId }) => {
    const roomId = nanoid(10).toUpperCase()
    const hostPlayerId = nanoid(12)
    const initialTimeMs = Math.max(1, Math.floor(initialMinutes)) * 60_000
    const passwordHash = await sha256(password)

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
          name: hostName.trim() || 'Host',
          remainingMs: initialTimeMs,
          connected: true,
          lastPeerId: hostPeerId,
        },
      ],
      activePlayerId: null,
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
    return snapshot.state
  },
  setStateFromHost: (nextState) => {
    set({ state: nextState })
    void saveIfReady(nextState)
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
