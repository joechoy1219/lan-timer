export type RoomRole = 'host' | 'participant'

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error'

export interface PlayerState {
  id: string
  name: string
  remainingMs: number
  connected: boolean
  lastPeerId?: string
}

export interface RoomTimelineEvent {
  id: string
  message: string
  at: number
}

export interface RoomState {
  roomId: string
  roomName: string
  hostPeerId: string
  hostPlayerId: string
  localPlayerId: string
  role: RoomRole
  passwordHash: string
  initialTimeMs: number
  players: PlayerState[]
  timeline: RoomTimelineEvent[]
  turnOrder: string[]
  turnIndex: number
  phase: 'lobby' | 'running' | 'paused' | 'finished'
  round: number
  lastTurnSwitchedAt: number | null
  activePlayerId: string | null
  isRunning: boolean
  globalPaused: boolean
  lastStartedAt: number | null
  seq: number
  updatedAt: number
}

export interface SnapshotEnvelope {
  type: 'STATE_SNAPSHOT'
  seq: number
  sentAt: number
  roomId: string
  state: RoomState
}

export interface SignedControl<TPayload = Record<string, unknown>> {
  type: 'CONTROL_REQUEST'
  id: string
  sentAt: number
  roomId: string
  seq: number
  fromPlayerId: string
  action: ControlActionType
  payload: TPayload
  signature: string
}

export interface JoinRequest {
  type: 'JOIN_REQUEST'
  id: string
  roomId: string
  sentAt: number
  playerId: string
  playerName: string
  passwordHash: string
}

export interface JoinAccepted {
  type: 'JOIN_ACCEPTED'
  roomId: string
  playerId: string
  state: RoomState
}

export interface JoinRejected {
  type: 'JOIN_REJECTED'
  roomId: string
  reason: string
}

export type ControlRejectReason =
  | 'ROOM_MISMATCH'
  | 'STALE_SEQ'
  | 'INVALID_SIGNATURE'
  | 'UNKNOWN_ACTOR'
  | 'NOT_ALLOWED'
  | 'INVALID_PAYLOAD'

export interface ControlRejected {
  type: 'CONTROL_REJECTED'
  roomId: string
  action: ControlActionType
  reason: ControlRejectReason
  message: string
  sentAt: number
}

export interface Heartbeat {
  type: 'HEARTBEAT'
  roomId: string
  seq: number
  sentAt: number
}

export interface ParticipantLeave {
  type: 'PARTICIPANT_LEAVE'
  roomId: string
  playerId: string
  sentAt: number
}

export interface PeerLeftLocal {
  type: 'PEER_LEFT_LOCAL'
  peerId: string
  sentAt: number
}

export type NetworkMessage =
  | SnapshotEnvelope
  | SignedControl
  | JoinRequest
  | JoinAccepted
  | JoinRejected
  | ControlRejected
  | Heartbeat
  | ParticipantLeave
  | PeerLeftLocal

export type ControlActionType =
  | 'START_TIMER'
  | 'START_ROUND'
  | 'END_TURN'
  | 'PAUSE_TIMER'
  | 'SWITCH_ACTIVE'
  | 'SET_TURN_ORDER'
  | 'FORCE_NEXT'
  | 'RESET_ALL'
  | 'SET_INITIAL_TIME'
  | 'GLOBAL_PAUSE'
  | 'GLOBAL_RESUME'
  | 'KICK_PLAYER'
  | 'RENAME_SELF'

export interface ReducerAction {
  type: ControlActionType
  actorId: string
  now: number
  payload?: Record<string, unknown>
}

export interface PersistedSnapshot {
  roomId: string
  state: RoomState
  savedAt: number
}
