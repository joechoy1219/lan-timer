import { nanoid } from 'nanoid'
import type {
  ControlActionType,
  Heartbeat,
  JoinRequest,
  ParticipantLeave,
  RoomState,
  SignedControl,
  SnapshotEnvelope,
} from '../domain/types'

const encoder = new TextEncoder()

const toHex = (bytes: Uint8Array) =>
  [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')

export const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return toHex(new Uint8Array(digest))
}

export const signPayload = async (payload: unknown, key: string) => {
  return sha256(`${JSON.stringify(payload)}::${key}`)
}

export const createSnapshot = (state: RoomState): SnapshotEnvelope => ({
  type: 'STATE_SNAPSHOT',
  seq: state.seq,
  sentAt: Date.now(),
  roomId: state.roomId,
  state,
})

export const createJoinRequest = async (
  roomId: string,
  playerId: string,
  playerName: string,
  password: string,
): Promise<JoinRequest> => ({
  type: 'JOIN_REQUEST',
  id: nanoid(),
  roomId,
  sentAt: Date.now(),
  playerId,
  playerName,
  passwordHash: await sha256(password),
})

export const createJoinRequestWithHash = (
  roomId: string,
  playerId: string,
  playerName: string,
  passwordHash: string,
): JoinRequest => ({
  type: 'JOIN_REQUEST',
  id: nanoid(),
  roomId,
  sentAt: Date.now(),
  playerId,
  playerName,
  passwordHash,
})

export const createHeartbeat = (roomId: string, seq: number): Heartbeat => ({
  type: 'HEARTBEAT',
  roomId,
  seq,
  sentAt: Date.now(),
})

export const createParticipantLeave = (roomId: string, playerId: string): ParticipantLeave => ({
  type: 'PARTICIPANT_LEAVE',
  roomId,
  playerId,
  sentAt: Date.now(),
})

export const createSignedControl = async (
  roomId: string,
  fromPlayerId: string,
  seq: number,
  action: ControlActionType,
  payload: Record<string, unknown>,
  passwordHash: string,
): Promise<SignedControl> => {
  const base = {
    roomId,
    fromPlayerId,
    seq,
    action,
    payload,
    sentAt: Date.now(),
    id: nanoid(),
  }

  return {
    type: 'CONTROL_REQUEST',
    ...base,
    signature: await signPayload(base, passwordHash),
  }
}

export const verifySignedControl = async (
  message: SignedControl,
  passwordHash: string,
) => {
  const { signature, ...rest } = message
  const expected = await signPayload(rest, passwordHash)
  return expected === signature
}
