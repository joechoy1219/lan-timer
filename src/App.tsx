import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
} from 'react'
import { nanoid } from 'nanoid'
import { AnimatePresence, animate, motion } from 'framer-motion'
import { formatMs, resolveRemainingMs, withElapsedCommitted } from './domain/timerEngine'
import type { NetworkMessage, RoomState, SnapshotEnvelope } from './domain/types'
import {
  createHeartbeat,
  createJoinRequest,
  createJoinRequestWithHash,
  createParticipantLeave,
  createSignedControl,
  createSnapshot,
  verifySignedControl,
} from './network/protocol'
import { PeerRoomService } from './network/peerService'
import { useRoomStore } from './store/useRoomStore'
const service = new PeerRoomService()
const HOST_RECONNECT_TIMEOUT_MS = 60_000
const HOST_SIGNAL_LOSS_THRESHOLD_MS = 5_000
const RECONNECT_ATTEMPT_INTERVAL_MS = 5_000
const JOIN_REQUEST_TIMEOUT_MS = 15_000
const JOIN_TIMEOUT_SECONDS = JOIN_REQUEST_TIMEOUT_MS / 1000
const JOIN_CANCEL_GUARD_TTL_MS = 30_000

const Input = (props: InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className="mono w-full rounded-xl border border-white/20 bg-black/20 px-3 py-2 text-sm text-white outline-none transition focus:border-amber-300"
  />
)

const Button = ({ children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    {...props}
    className={`mono rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-xs tracking-wide text-white transition hover:border-amber-300 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40 ${className ?? ''}`}
  >
    {children}
  </button>
)

const mergeParticipantView = (snapshot: SnapshotEnvelope, current: RoomState | null): RoomState => ({
  ...snapshot.state,
  role: current?.role ?? 'participant',
  localPlayerId: current?.localPlayerId ?? snapshot.state.localPlayerId,
})

function App() {
  const {
    state,
    nowMs,
    statusText,
    setStatusText,
    tick,
    createRoom,
    hydrateFromSnapshot,
    setStateFromHost,
    applyHostAction,
    leaveRoom,
  } = useRoomStore()

  const [preloaded, setPreloaded] = useState(false)
  const [peerConnected, setPeerConnected] = useState(false)
  const [createForm, setCreateForm] = useState({
    roomName: 'Go Match Room',
    hostName: 'Host',
    password: '',
    initialMinutes: 10,
  })
  const [joinForm, setJoinForm] = useState({
    roomId: '',
    hostPeerId: '',
    name: 'Player',
    password: '',
  })
  const [pendingInitialMinutes, setPendingInitialMinutes] = useState(10)
  const [localPeerId, setLocalPeerId] = useState('')
  const [hostReconnectDeadlineAt, setHostReconnectDeadlineAt] = useState<number | null>(null)
  const [hostReconnectSecondsLeft, setHostReconnectSecondsLeft] = useState(0)
  const [forcedLeaveReason, setForcedLeaveReason] = useState<string | null>(null)
  const [joinElapsedSeconds, setJoinElapsedSeconds] = useState(0)
  const [joinStatusModal, setJoinStatusModal] = useState<{
    open: boolean
    phase: 'connecting' | 'success' | 'error'
    message: string
  }>({
    open: false,
    phase: 'connecting',
    message: '',
  })
  const joinRequestRef = useRef<NetworkMessage | null>(null)
  const joinStatusTimerRef = useRef<number | null>(null)
  const joinTimeoutRef = useRef<number | null>(null)
  const joinAttemptRef = useRef<{
    roomId: string
    playerId: string
    cancelled: boolean
    interactive: boolean
    startedAt: number
  } | null>(null)
  const cancelledJoinPlayersRef = useRef<Map<string, number>>(new Map())
  const lastHostSignalAtRef = useRef<number>(0)
  const handleNetworkMessageRef = useRef<((message: NetworkMessage, senderPeerId?: string) => Promise<void>) | null>(null)
  const joinRoomRef = useRef<
    | ((options?: {
        roomId?: string
        hostPeerId?: string
        playerName?: string
        password?: string
        passwordHash?: string
        playerId?: string
        showModal?: boolean
      }) => Promise<void>)
    | null
  >(null)

  const isHost = state?.role === 'host'
  const reconnectBlocked = Boolean(hostReconnectDeadlineAt && state?.role === 'participant')

  const beginHostReconnectWait = useCallback((reason: string) => {
    setHostReconnectDeadlineAt((current) => {
      if (current) {
        return current
      }
      setStatusText(reason)
      setHostReconnectSecondsLeft(Math.ceil(HOST_RECONNECT_TIMEOUT_MS / 1000))
      return Date.now() + HOST_RECONNECT_TIMEOUT_MS
    })
  }, [setStatusText])

  const clearHostReconnectWait = useCallback(() => {
    setHostReconnectDeadlineAt(null)
    setHostReconnectSecondsLeft(0)
  }, [])

  const forceLeaveFromTimeout = useCallback((reason: string) => {
    service.cleanup()
    leaveRoom()
    localStorage.removeItem('lan-timer:last-room-id')
    setPeerConnected(false)
    setLocalPeerId('')
    setHostReconnectDeadlineAt(null)
    setHostReconnectSecondsLeft(0)
    setForcedLeaveReason(reason)
    setStatusText(reason)
  }, [leaveRoom, setStatusText])

  const removeParticipantFromHostState = useCallback((current: RoomState, departingPlayerId: string) => {
    if (departingPlayerId === current.hostPlayerId) {
      return
    }

    const now = Date.now()
    const committed = withElapsedCommitted(current, now)
    const departing = committed.players.find((player) => player.id === departingPlayerId)
    if (!departing) {
      return
    }

    const wasActive = committed.activePlayerId === departingPlayerId
    const nextState: RoomState = {
      ...committed,
      seq: committed.seq + 1,
      updatedAt: now,
      players: committed.players.filter((player) => player.id !== departingPlayerId),
      activePlayerId: wasActive ? null : committed.activePlayerId,
      isRunning: wasActive ? false : committed.isRunning,
      lastStartedAt: wasActive ? null : committed.lastStartedAt,
      globalPaused: wasActive ? true : committed.globalPaused,
    }

    setStateFromHost(nextState)
    service.broadcast(createSnapshot(nextState))
    setStatusText(
      wasActive
        ? `${departing.name} left. Global timer paused to keep state consistent.`
        : `${departing.name} left the room.`,
    )
  }, [setStateFromHost, setStatusText])

  const markParticipantDisconnected = useCallback((current: RoomState, participantId: string) => {
    if (participantId === current.hostPlayerId) {
      return
    }

    const participant = current.players.find((player) => player.id === participantId)
    if (!participant || !participant.connected) {
      return
    }

    const nextState: RoomState = {
      ...current,
      seq: current.seq + 1,
      updatedAt: Date.now(),
      players: current.players.map((player) =>
        player.id === participantId
          ? {
              ...player,
              connected: false,
            }
          : player,
      ),
    }

    setStateFromHost(nextState)
    service.broadcast(createSnapshot(nextState))
    setStatusText(`${participant.name} disconnected. Waiting for reconnect...`)
  }, [setStateFromHost, setStatusText])

  const openJoinStatusModal = useCallback((phase: 'connecting' | 'success' | 'error', message: string) => {
    setJoinStatusModal({
      open: true,
      phase,
      message,
    })
  }, [])

  const closeJoinStatusModal = useCallback(() => {
    setJoinStatusModal((prev) => ({
      ...prev,
      open: false,
    }))
    setJoinElapsedSeconds(0)
  }, [])

  const showJoinSuccessAndAutoClose = useCallback((message: string) => {
    if (joinStatusTimerRef.current) {
      window.clearTimeout(joinStatusTimerRef.current)
    }

    openJoinStatusModal('success', message)
    joinStatusTimerRef.current = window.setTimeout(() => {
      setJoinStatusModal((prev) => ({
        ...prev,
        open: false,
      }))
      setJoinElapsedSeconds(0)
      joinStatusTimerRef.current = null
    }, 1200)
  }, [openJoinStatusModal])

  const clearJoinTimeout = useCallback(() => {
    if (!joinTimeoutRef.current) {
      return
    }
    window.clearTimeout(joinTimeoutRef.current)
    joinTimeoutRef.current = null
  }, [])

  const abortJoinAttempt = useCallback((reason: string, showErrorModal: boolean) => {
    const attempt = joinAttemptRef.current
    if (attempt) {
      attempt.cancelled = true
      service.sendToHost(createParticipantLeave(attempt.roomId, attempt.playerId))
    }

    clearJoinTimeout()
    joinAttemptRef.current = null
    joinRequestRef.current = null
    service.cleanup()
    setPeerConnected(false)
    setLocalPeerId('')
    clearHostReconnectWait()
    setStatusText(reason)

    if (showErrorModal) {
      openJoinStatusModal('error', reason)
      return
    }

    closeJoinStatusModal()
  }, [clearHostReconnectWait, clearJoinTimeout, closeJoinStatusModal, openJoinStatusModal, setStatusText])

  const markJoinCancelled = useCallback((playerId: string) => {
    cancelledJoinPlayersRef.current.set(playerId, Date.now())
  }, [])

  const wasJoinCancelledRecently = useCallback((playerId: string) => {
    const now = Date.now()
    cancelledJoinPlayersRef.current.forEach((value, key) => {
      if (now - value > JOIN_CANCEL_GUARD_TTL_MS) {
        cancelledJoinPlayersRef.current.delete(key)
      }
    })
    const cancelledAt = cancelledJoinPlayersRef.current.get(playerId)
    if (!cancelledAt) {
      return false
    }
    return now - cancelledAt <= JOIN_CANCEL_GUARD_TTL_MS
  }, [])

  const handleLeaveRoom = useCallback(() => {
    const current = useRoomStore.getState().state
    if (current?.role === 'participant' && current.localPlayerId) {
      service.sendToHost(createParticipantLeave(current.roomId, current.localPlayerId))
    }
    service.cleanup()
    leaveRoom()
    localStorage.removeItem('lan-timer:last-room-id')
    setPeerConnected(false)
    setLocalPeerId('')
    clearHostReconnectWait()
    clearJoinTimeout()
    joinAttemptRef.current = null
    joinRequestRef.current = null
    setJoinElapsedSeconds(0)
    closeJoinStatusModal()
  }, [clearHostReconnectWait, clearJoinTimeout, closeJoinStatusModal, leaveRoom])

  useEffect(() => {
    const controls = animate(0, 1, {
      duration: 0.7,
      onComplete: () => setPreloaded(true),
    })
    return () => controls.stop()
  }, [])

  useEffect(() => {
    lastHostSignalAtRef.current = Date.now()
  }, [])

  useEffect(() => {
    const id = setInterval(() => tick(), 250)
    return () => clearInterval(id)
  }, [tick])

  useEffect(() => {
    if (!state || state.role !== 'host') {
      return
    }
    const id = setInterval(() => {
      const latest = useRoomStore.getState().state
      if (!latest) {
        return
      }
      service.broadcast(createHeartbeat(latest.roomId, latest.seq))
      if (latest.isRunning) {
        service.broadcast(createSnapshot(latest))
      }
    }, 1500)
    return () => clearInterval(id)
  }, [state])

  useEffect(() => () => service.cleanup(), [])

  useEffect(() => {
    return () => {
      if (joinStatusTimerRef.current) {
        window.clearTimeout(joinStatusTimerRef.current)
      }
      if (joinTimeoutRef.current) {
        window.clearTimeout(joinTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!joinStatusModal.open || joinStatusModal.phase !== 'connecting') {
      return
    }

    const timerId = window.setInterval(() => {
      const attempt = joinAttemptRef.current
      if (!attempt || !attempt.interactive) {
        return
      }
      const elapsed = Math.floor((Date.now() - attempt.startedAt) / 1000) + 1
      setJoinElapsedSeconds(Math.min(JOIN_TIMEOUT_SECONDS, Math.max(1, elapsed)))
    }, 200)

    return () => window.clearInterval(timerId)
  }, [joinStatusModal.open, joinStatusModal.phase])

  const handleNetworkMessage = useCallback(async (message: NetworkMessage, senderPeerId?: string) => {
    const current = useRoomStore.getState().state

    if (message.type === 'JOIN_REQUEST' && current?.role === 'host') {
      if (message.roomId !== current.roomId) {
        return
      }
      if (wasJoinCancelledRecently(message.playerId)) {
        service.sendToPeer(senderPeerId ?? '', {
          type: 'JOIN_REJECTED',
          roomId: current.roomId,
          reason: 'Join cancelled by participant',
        })
        return
      }
      if (message.passwordHash !== current.passwordHash) {
        service.sendToPeer(senderPeerId ?? '', {
          type: 'JOIN_REJECTED',
          roomId: current.roomId,
          reason: 'Wrong password',
        })
        return
      }
      const exists = current.players.some((player) => player.id === message.playerId)
      const existingPlayer = current.players.find((player) => player.id === message.playerId)
      const isReconnect = Boolean(existingPlayer && !existingPlayer.connected)
      if (!exists && current.players.length >= 8) {
        service.sendToPeer(senderPeerId ?? '', {
          type: 'JOIN_REJECTED',
          roomId: current.roomId,
          reason: 'Room is full',
        })
        return
      }

      const nextState = exists
        ? {
            ...current,
            seq: current.seq + 1,
            updatedAt: Date.now(),
            players: current.players.map((player) =>
              player.id === message.playerId
                ? {
                    ...player,
                    name: message.playerName.slice(0, 24),
                    connected: true,
                    lastPeerId: senderPeerId ?? player.lastPeerId,
                  }
                : player,
            ),
          }
        : {
            ...current,
            seq: current.seq + 1,
            updatedAt: Date.now(),
            players: [
              ...current.players,
              {
                id: message.playerId,
                name: message.playerName.slice(0, 24),
                remainingMs: current.initialTimeMs,
                connected: true,
                lastPeerId: senderPeerId,
              },
            ],
          }

      setStateFromHost(nextState)
      setStatusText(
        isReconnect
          ? `${message.playerName.slice(0, 24)} reconnected.`
          : exists
            ? `${message.playerName.slice(0, 24)} synced.`
            : `${message.playerName.slice(0, 24)} joined the room.`,
      )

      service.sendToPeer(senderPeerId ?? '', {
        type: 'JOIN_ACCEPTED',
        roomId: nextState.roomId,
        playerId: message.playerId,
        state: nextState,
      })
      service.broadcast(createSnapshot(nextState))
      return
    }

    if (message.type === 'PARTICIPANT_LEAVE' && current?.role === 'host') {
      if (message.roomId !== current.roomId) {
        return
      }
      if (!current.players.some((player) => player.id === message.playerId)) {
        markJoinCancelled(message.playerId)
        return
      }
      removeParticipantFromHostState(current, message.playerId)
      return
    }

    if (message.type === 'PEER_LEFT_LOCAL' && current?.role === 'host') {
      const leaving = current.players.find(
        (player) => player.id !== current.hostPlayerId && player.lastPeerId === message.peerId,
      )
      if (!leaving) {
        return
      }
      markParticipantDisconnected(current, leaving.id)
      return
    }

    if (message.type === 'JOIN_ACCEPTED') {
      const joinAttempt = joinAttemptRef.current
      if (!joinAttempt || joinAttempt.playerId !== message.playerId || joinAttempt.cancelled) {
        service.sendToHost(createParticipantLeave(message.roomId, message.playerId))
        return
      }

      clearJoinTimeout()
      joinAttemptRef.current = null
      setPeerConnected(true)
      lastHostSignalAtRef.current = Date.now()
      clearHostReconnectWait()
      showJoinSuccessAndAutoClose('Joined room successfully. Preparing room state...')
      setStateFromHost({
        ...message.state,
        role: 'participant',
        localPlayerId: message.playerId,
      })
      setStatusText('Joined room successfully.')
      return
    }

    if (message.type === 'JOIN_REJECTED') {
      clearJoinTimeout()
      joinAttemptRef.current = null
      leaveRoom()
      setPeerConnected(false)
      setLocalPeerId('')
      openJoinStatusModal('error', `Join rejected: ${message.reason}`)
      setStatusText(`Join rejected: ${message.reason}`)
      service.cleanup()
      return
    }

    if (message.type === 'STATE_SNAPSHOT') {
      lastHostSignalAtRef.current = Date.now()
      clearHostReconnectWait()
      const merged = mergeParticipantView(message, current)
      if (!current || message.seq > current.seq) {
        setStateFromHost(merged)
      }
      return
    }

    if (message.type === 'HEARTBEAT') {
      lastHostSignalAtRef.current = Date.now()
      clearHostReconnectWait()
      return
    }

    if (message.type === 'CONTROL_REQUEST' && current?.role === 'host') {
      if (message.roomId !== current.roomId || message.seq <= current.seq) {
        return
      }
      const valid = await verifySignedControl(message, current.passwordHash)
      if (!valid) {
        setStatusText('Rejected unsigned control request.')
        return
      }

      const next = await applyHostAction({
        type: message.action,
        actorId: message.fromPlayerId,
        now: Date.now(),
        payload: message.payload,
      })
      if (next) {
        service.broadcast(createSnapshot(next))
      }
    }
  }, [applyHostAction, clearHostReconnectWait, clearJoinTimeout, leaveRoom, markJoinCancelled, markParticipantDisconnected, openJoinStatusModal, removeParticipantFromHostState, setStateFromHost, setStatusText, showJoinSuccessAndAutoClose, wasJoinCancelledRecently])

  const createHostRoom = async () => {
    const hostPeerId = `host-${nanoid(8)}`
    service.createHost(hostPeerId, handleNetworkMessage, setStatusText)
    const created = await createRoom({
      ...createForm,
      hostPeerId,
      initialMinutes: Number(createForm.initialMinutes),
    })
    setPendingInitialMinutes(Math.max(1, Math.round(created.initialTimeMs / 60_000)))
    setLocalPeerId(hostPeerId)
    setPeerConnected(false)
  }

  const joinRoom = useCallback(async (options?: {
    roomId?: string
    hostPeerId?: string
    playerName?: string
    password?: string
    passwordHash?: string
    playerId?: string
    showModal?: boolean
  }) => {
    const roomId = (options?.roomId ?? joinForm.roomId).trim().toUpperCase()
    const hostPeerId = (options?.hostPeerId ?? joinForm.hostPeerId).trim()
    const playerName = (options?.playerName ?? joinForm.name).trim() || 'Player'
    const password = options?.password ?? joinForm.password
    const showModal = options?.showModal ?? true

    if (!roomId || !hostPeerId) {
      setStatusText('Missing room ID or host peer ID.')
      if (showModal) {
        openJoinStatusModal('error', 'Missing room ID or host peer ID.')
      }
      return
    }

    if (!options?.passwordHash && !password) {
      setStatusText('Password is required to join.')
      if (showModal) {
        openJoinStatusModal('error', 'Password is required to join.')
      }
      return
    }

    if (showModal) {
      setJoinElapsedSeconds(1)
      openJoinStatusModal('connecting', 'Connecting to host...')
    }

    const peerId = `peer-${nanoid(8)}`
    const playerId = options?.playerId ?? nanoid(12)
    const joinRequest = options?.passwordHash
      ? createJoinRequestWithHash(roomId, playerId, playerName, options.passwordHash)
      : await createJoinRequest(roomId, playerId, playerName, password)

    joinRequestRef.current = joinRequest
    joinAttemptRef.current = {
      roomId,
      playerId,
      cancelled: false,
      interactive: showModal,
      startedAt: Date.now(),
    }
    clearJoinTimeout()
    if (showModal) {
      joinTimeoutRef.current = window.setTimeout(() => {
        const attempt = joinAttemptRef.current
        if (!attempt || attempt.playerId !== playerId || attempt.cancelled) {
          return
        }
        markJoinCancelled(playerId)
        abortJoinAttempt('Join request timed out after 15 seconds. Please try again.', true)
      }, JOIN_REQUEST_TIMEOUT_MS)
    }

    setLocalPeerId(peerId)
    setPeerConnected(false)

    service.joinHost(peerId, hostPeerId, handleNetworkMessage, (status) => {
      setStatusText(status)
      if (status.includes('Connected to host') && joinRequestRef.current) {
        if (showModal) {
          openJoinStatusModal('connecting', 'Connected. Verifying room credentials...')
        }
        setPeerConnected(true)
        lastHostSignalAtRef.current = Date.now()
        clearHostReconnectWait()
        service.sendToHost(joinRequestRef.current)
        joinRequestRef.current = null
      }
      if (status.includes('Disconnected from host') || status.includes('Host connection closed')) {
        setPeerConnected(false)

        const activeAttempt = joinAttemptRef.current
        if (!activeAttempt || activeAttempt.playerId !== playerId || activeAttempt.cancelled) {
          return
        }

        if (showModal) {
          openJoinStatusModal('error', 'Connection dropped while joining. Please try again.')
          markJoinCancelled(playerId)
          abortJoinAttempt('Connection dropped while joining. Please try again.', true)
          return
        }

        beginHostReconnectWait('Host disconnected. Waiting up to 60 seconds for host reconnect...')
      }

      if (showModal && status.toLowerCase().includes('error')) {
        openJoinStatusModal('error', status)
      }
    })
  }, [abortJoinAttempt, beginHostReconnectWait, clearHostReconnectWait, clearJoinTimeout, handleNetworkMessage, joinForm.hostPeerId, joinForm.name, joinForm.password, joinForm.roomId, markJoinCancelled, openJoinStatusModal, setStatusText])

  const joinProgressSeconds = Math.max(1, Math.min(JOIN_TIMEOUT_SECONDS, joinElapsedSeconds || 1))
  const joinProgressPercent = (joinProgressSeconds / JOIN_TIMEOUT_SECONDS) * 100

  useEffect(() => {
    handleNetworkMessageRef.current = handleNetworkMessage
  }, [handleNetworkMessage])

  useEffect(() => {
    joinRoomRef.current = joinRoom
  }, [joinRoom])

  useEffect(() => {
    if (!state) {
      return
    }
    localStorage.setItem('lan-timer:last-room-id', state.roomId)
  }, [state])

  useEffect(() => {
    if (!state || state.role !== 'participant') {
      return
    }

    const monitorId = setInterval(() => {
      const now = Date.now()

      if (peerConnected) {
        if (now - lastHostSignalAtRef.current > HOST_SIGNAL_LOSS_THRESHOLD_MS) {
          beginHostReconnectWait('Host disconnected. Waiting up to 60 seconds for host reconnect...')
        }
        return
      }

      beginHostReconnectWait('Host disconnected. Waiting up to 60 seconds for host reconnect...')
    }, 1000)

    return () => clearInterval(monitorId)
  }, [beginHostReconnectWait, peerConnected, state])

  useEffect(() => {
    if (!hostReconnectDeadlineAt || !state || state.role !== 'participant') {
      return
    }

    const timeoutId = setInterval(() => {
      const remainingMs = hostReconnectDeadlineAt - Date.now()
      setHostReconnectSecondsLeft(Math.max(0, Math.ceil(remainingMs / 1000)))
      if (remainingMs <= 0) {
        forceLeaveFromTimeout('Host did not reconnect within 60 seconds. You have been removed from the room.')
      }
    }, 500)

    return () => clearInterval(timeoutId)
  }, [forceLeaveFromTimeout, hostReconnectDeadlineAt, state])

  useEffect(() => {
    if (!hostReconnectDeadlineAt || !state || state.role !== 'participant') {
      return
    }

    const reconnectId = setInterval(() => {
      if (peerConnected) {
        return
      }

      const reconnect = joinRoomRef.current
      if (!reconnect) {
        return
      }

      const me = state.players.find((player) => player.id === state.localPlayerId)
      const reconnectName = me?.name ?? 'Player'

      void reconnect({
        roomId: state.roomId,
        hostPeerId: state.hostPeerId,
        playerName: reconnectName,
        passwordHash: state.passwordHash,
        playerId: state.localPlayerId,
        showModal: false,
      })
    }, RECONNECT_ATTEMPT_INTERVAL_MS)

    return () => clearInterval(reconnectId)
  }, [hostReconnectDeadlineAt, peerConnected, state])

  useEffect(() => {
    let cancelled = false

    const tryRecover = async () => {
      const lastRoomId = localStorage.getItem('lan-timer:last-room-id')
      if (!lastRoomId) {
        return
      }

      const recovered = await hydrateFromSnapshot(lastRoomId)
      if (cancelled) {
        return
      }

      if (!recovered) {
        localStorage.removeItem('lan-timer:last-room-id')
        return
      }

      const me = recovered.players.find((player) => player.id === recovered.localPlayerId)
      const recoveredName = me?.name ?? 'Player'

      setJoinForm((prev) => ({
        ...prev,
        roomId: recovered.roomId,
        hostPeerId: recovered.hostPeerId,
        name: recoveredName,
      }))

      if (recovered.role === 'host') {
        const networkHandler = handleNetworkMessageRef.current
        if (!networkHandler) {
          return
        }
        service.createHost(recovered.hostPeerId, (message, senderPeerId) => {
          void networkHandler(message, senderPeerId)
        }, (status) => {
          setStatusText(status)
          if (status.startsWith('Host ready as')) {
            setStateFromHost(recovered)
            setPendingInitialMinutes(Math.max(1, Math.round(recovered.initialTimeMs / 60_000)))
            setLocalPeerId(recovered.hostPeerId)
            setPeerConnected(true)
          }
          if (!status.startsWith('Host ready as')) {
            setPeerConnected(false)
          }
        })
        setStatusText('Recovering host room connection...')
        return
      }

      setStatusText('Reconnecting to previous room...')
      const reconnect = joinRoomRef.current
      if (reconnect) {
        await reconnect({
          roomId: recovered.roomId,
          hostPeerId: recovered.hostPeerId,
          playerName: recoveredName,
          passwordHash: recovered.passwordHash,
          playerId: recovered.localPlayerId,
          showModal: false,
        })
      }
    }

    void tryRecover()

    return () => {
      cancelled = true
    }
  }, [hydrateFromSnapshot, setStatusText, setStateFromHost])

  const sendControl = async (
    action: Parameters<typeof createSignedControl>[3],
    payload: Record<string, unknown> = {},
  ) => {
    if (reconnectBlocked) {
      setStatusText('Host is reconnecting. Commands are temporarily locked.')
      return
    }

    const current = useRoomStore.getState().state
    if (!current) {
      return
    }

    if (current.role === 'host') {
      const next = await applyHostAction({
        type: action,
        actorId: current.localPlayerId,
        now: nowMs,
        payload,
      })
      if (next) {
        service.broadcast(createSnapshot(next))
      }
      return
    }

    const request = await createSignedControl(
      current.roomId,
      current.localPlayerId,
      current.seq + 1,
      action,
      payload,
      current.passwordHash,
    )
    service.sendToHost(request)
  }

  const players = useMemo(() => {
    if (!state) {
      return []
    }
    return state.players.map((player) => ({
      ...player,
      displayMs: resolveRemainingMs(player, state, nowMs),
    }))
  }, [state, nowMs])

  if (!preloaded) {
    return (
      <main className="grain flex min-h-dvh items-center justify-center">
        <div className="panel-strong mono reveal rounded-3xl px-8 py-6 text-center text-sm tracking-widest text-amber-200">
          Syncing arena...
        </div>
      </main>
    )
  }

  return (
    <main className="grain px-5 pb-10 pt-6 md:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="panel reveal relative overflow-hidden rounded-3xl p-6 md:p-10">
          <div className="float absolute right-[-30px] top-[-30px] h-40 w-40 rounded-full bg-emerald-300/15 blur-2xl" aria-hidden />
          <p className="mono text-xs uppercase tracking-[0.24em] text-amber-200">LAN Turn Timer</p>
          <h1 className="headline mt-3 text-balance">One Active Clock. Zero Ambiguity.</h1>
          <p className="mt-4 max-w-3xl text-sm text-[#cae5dd] md:text-base">
            Host-authoritative, browser-only timer room for Go, chess, debate, and tabletop games. Capacity 2-8 players.
          </p>
        </header>

        {!state && (
          <section className="grid gap-4 md:grid-cols-2">
            {forcedLeaveReason && (
              <article className="panel reveal rounded-2xl border border-rose-300/60 p-5 text-rose-100 md:col-span-2">
                <h2 className="text-xl font-semibold">Disconnected</h2>
                <p className="mt-2 text-sm text-rose-100/90">{forcedLeaveReason}</p>
                <Button className="mt-4" onClick={() => setForcedLeaveReason(null)}>
                  Dismiss
                </Button>
              </article>
            )}
            <article className="panel reveal rounded-2xl p-5">
              <h2 className="text-xl font-semibold">Create Room</h2>
              <div className="mt-4 space-y-3">
                <Input
                  placeholder="Room name"
                  value={createForm.roomName}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, roomName: event.target.value }))}
                />
                <Input
                  placeholder="Host name"
                  value={createForm.hostName}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, hostName: event.target.value }))}
                />
                <Input
                  type="password"
                  placeholder="Password"
                  value={createForm.password}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, password: event.target.value }))}
                />
                <Input
                  type="number"
                  min={1}
                  max={180}
                  placeholder="Initial minutes"
                  value={String(createForm.initialMinutes)}
                  onChange={(event) =>
                    setCreateForm((prev) => ({ ...prev, initialMinutes: Number(event.target.value) }))
                  }
                />
                <Button
                  className="w-full"
                  onClick={() => void createHostRoom()}
                  disabled={!createForm.password.trim()}
                >
                  Create as Host
                </Button>
              </div>
            </article>

            <article className="panel reveal rounded-2xl p-5 [animation-delay:90ms]">
              <h2 className="text-xl font-semibold">Join Room</h2>
              <div className="mt-4 space-y-3">
                <Input
                  placeholder="Room ID"
                  value={joinForm.roomId}
                  onChange={(event) =>
                    setJoinForm((prev) => ({ ...prev, roomId: event.target.value.toUpperCase() }))
                  }
                />
                <Input
                  placeholder="Host Peer ID"
                  value={joinForm.hostPeerId}
                  onChange={(event) => setJoinForm((prev) => ({ ...prev, hostPeerId: event.target.value }))}
                />
                <Input
                  placeholder="Your name"
                  value={joinForm.name}
                  onChange={(event) => setJoinForm((prev) => ({ ...prev, name: event.target.value }))}
                />
                <Input
                  type="password"
                  placeholder="Room password"
                  value={joinForm.password}
                  onChange={(event) => setJoinForm((prev) => ({ ...prev, password: event.target.value }))}
                />
                <Button
                  className="w-full"
                  onClick={() => void joinRoom()}
                  disabled={!joinForm.password || !joinForm.hostPeerId || !joinForm.roomId}
                >
                  Join as Participant
                </Button>
              </div>
            </article>
          </section>
        )}

        {state && (
          <section className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
            <article className="panel-strong reveal rounded-2xl p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-2xl font-semibold">{state.roomName}</h2>
                  <p className="mono mt-1 text-xs text-[#b7d1c9]">
                    Room {state.roomId} | Host Peer {state.hostPeerId}
                  </p>
                </div>
                <div className="flex gap-2">
                  <span className="mono rounded-full border border-white/25 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-amber-200">
                    {state.role}
                  </span>
                  <span className="mono rounded-full border border-white/25 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-emerald-200">
                    {state.globalPaused ? 'global paused' : state.isRunning ? 'running' : 'stopped'}
                  </span>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {players.map((player) => {
                  const isActive = state.activePlayerId === player.id
                  const isLocal = state.localPlayerId === player.id
                  const lowTime = player.displayMs < 30_000
                  return (
                    <div
                      key={player.id}
                      className={`rounded-2xl border p-4 transition ${
                        isActive
                          ? 'border-amber-300 bg-amber-100/10 shadow-[var(--glow)]'
                          : 'border-white/15 bg-white/5'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-white">
                          {player.name}
                          {isLocal ? ' (You)' : ''}
                        </p>
                        {isHost && player.id !== state.hostPlayerId && (
                          <Button
                            className="px-2 py-1 text-[10px]"
                            disabled={reconnectBlocked}
                            onClick={() => void sendControl('KICK_PLAYER', { targetId: player.id })}
                          >
                            Kick
                          </Button>
                        )}
                      </div>
                      <p className={`mono mt-3 text-4xl tracking-tight ${lowTime ? 'text-rose-300' : 'text-[#ecf5f1]'}`}>
                        {formatMs(player.displayMs)}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button disabled={reconnectBlocked} onClick={() => void sendControl('START_TIMER', { playerId: player.id })}>
                          Start
                        </Button>
                        <Button disabled={reconnectBlocked} onClick={() => void sendControl('SWITCH_ACTIVE', { nextPlayerId: player.id })}>
                          Switch
                        </Button>
                        {isActive && (
                          <span className="mono rounded-md border border-amber-200/60 px-2 py-1 text-[10px] text-amber-200">
                            ACTIVE
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </article>

            <aside className="panel reveal rounded-2xl p-5 [animation-delay:80ms]">
              <h3 className="text-xl font-semibold">Control Deck</h3>
              <p className="mono mt-1 text-xs text-[#b7d1c9]">{statusText}</p>
              {hostReconnectDeadlineAt && (
                <p className="mono mt-2 rounded-md border border-amber-300/60 bg-amber-200/10 px-2 py-1 text-xs text-amber-200">
                  Waiting host reconnect: {hostReconnectSecondsLeft}s
                </p>
              )}

              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button disabled={reconnectBlocked} onClick={() => void sendControl('PAUSE_TIMER')}>Pause</Button>
                <Button disabled={reconnectBlocked} onClick={() => void sendControl('RESET_ALL')}>Reset All</Button>
                <Button disabled={reconnectBlocked} onClick={() => void sendControl('GLOBAL_PAUSE')}>Global Pause</Button>
                <Button disabled={reconnectBlocked} onClick={() => void sendControl('GLOBAL_RESUME')}>Global Resume</Button>
              </div>

              {isHost && (
                <div className="mt-4 space-y-2 rounded-xl border border-white/20 bg-black/20 p-3">
                  <p className="mono text-xs uppercase tracking-[0.14em] text-amber-100">Host Settings</p>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={180}
                      disabled={reconnectBlocked}
                      value={String(pendingInitialMinutes)}
                      onChange={(event) => setPendingInitialMinutes(Number(event.target.value))}
                    />
                    <Button
                      disabled={reconnectBlocked}
                      onClick={() =>
                        void sendControl('SET_INITIAL_TIME', {
                          initialTimeMs: Math.max(1, pendingInitialMinutes) * 60_000,
                        })
                      }
                    >
                      Apply
                    </Button>
                  </div>
                </div>
              )}

              <div className="mt-4 rounded-xl border border-white/20 bg-black/20 p-3 text-xs text-[#d3e3de]">
                <p className="mono">Connection: {peerConnected || isHost ? 'online' : 'waiting'}</p>
                <p className="mono mt-1">Local Peer: {localPeerId || state.hostPeerId}</p>
                <p className="mono mt-1">Seq: {state.seq}</p>
              </div>

              <Button
                className="mt-4 w-full border-rose-200/60 text-rose-100 hover:border-rose-200"
                onClick={handleLeaveRoom}
              >
                Leave Room
              </Button>
            </aside>
          </section>
        )}

        <footer className="mono text-center text-xs tracking-[0.14em] text-[#aec6be]">
          Browser-only sync with host authority, sequence ordering, and IndexedDB recovery.
        </footer>
      </div>

      <AnimatePresence>
        {joinStatusModal.open && !state && (
          <motion.div
            className="fixed inset-0 z-40 flex items-center justify-center bg-[#041014]/70 p-5 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-full max-w-md rounded-3xl border border-emerald-300/35 bg-[#061a23]/92 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.58)]"
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 280, damping: 24 }}
              role="dialog"
              aria-modal="true"
              aria-label="Join room status"
            >
              <div className="flex items-start gap-4">
                <motion.div
                  className={`mt-1 h-3 w-3 rounded-full shadow-[0_0_16px_rgba(0,0,0,0.45)] ${
                    joinStatusModal.phase === 'connecting'
                      ? 'bg-amber-300'
                      : joinStatusModal.phase === 'success'
                        ? 'bg-emerald-300'
                        : 'bg-rose-300'
                  }`}
                  animate={
                    joinStatusModal.phase === 'connecting'
                      ? { scale: [1, 1.45, 1], opacity: [0.8, 1, 0.8] }
                      : { scale: 1, opacity: 1 }
                  }
                  transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                />
                <div className="space-y-2">
                  <p className="mono text-[11px] uppercase tracking-[0.2em] text-amber-200">Join Status</p>
                  <h2 className="text-2xl font-semibold text-white">
                    {joinStatusModal.phase === 'connecting'
                      ? 'Joining room...'
                      : joinStatusModal.phase === 'success'
                        ? 'Join successful'
                        : 'Unable to join'}
                  </h2>
                  <p className="text-sm text-[#d2e4de]">{joinStatusModal.message}</p>
                </div>
              </div>

              {joinStatusModal.phase === 'error' && (
                <div className="mt-6 flex justify-end">
                  <Button className="border-rose-200/60 text-rose-100" onClick={closeJoinStatusModal}>
                    Close
                  </Button>
                </div>
              )}

              {joinStatusModal.phase === 'connecting' && (
                <div className="mt-6 flex justify-end">
                  <div className="w-full space-y-2 pr-3">
                    <div className="flex items-center justify-between text-[11px] text-amber-100/90">
                      <span className="mono uppercase tracking-[0.12em]">Join Window</span>
                      <span className="mono">{joinProgressSeconds}/{JOIN_TIMEOUT_SECONDS}s</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full border border-amber-200/40 bg-black/30">
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-amber-200 via-orange-300 to-rose-300"
                        initial={{ width: 0 }}
                        animate={{ width: `${joinProgressPercent}%` }}
                        transition={{ duration: 0.25, ease: 'easeOut' }}
                      />
                    </div>
                  </div>
                  <Button
                    className="border-rose-200/60 text-rose-100"
                    onClick={() => {
                      const attempt = joinAttemptRef.current
                      if (attempt) {
                        markJoinCancelled(attempt.playerId)
                      }
                      abortJoinAttempt('Join cancelled by user.', false)
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}

        {reconnectBlocked && state && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#041014]/70 p-5 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-full max-w-md rounded-3xl border border-amber-300/50 bg-[#071820]/90 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 260, damping: 24 }}
              role="dialog"
              aria-modal="true"
              aria-label="Host reconnecting"
            >
              <div className="flex items-start gap-4">
                <motion.div
                  className="mt-1 h-3 w-3 rounded-full bg-amber-300 shadow-[0_0_14px_rgba(252,211,77,0.85)]"
                  animate={{ scale: [1, 1.45, 1], opacity: [0.8, 1, 0.8] }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                />
                <div className="space-y-2">
                  <p className="mono text-[11px] uppercase tracking-[0.2em] text-amber-200">Connection Guard</p>
                  <h2 className="text-2xl font-semibold text-white">Host is reconnecting</h2>
                  <p className="text-sm text-[#d2e4de]">
                    Commands are locked to prevent state divergence. Please wait for host recovery.
                  </p>
                  <p className="mono text-xs text-amber-100/90">Time remaining: {hostReconnectSecondsLeft}s</p>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <Button className="border-amber-300/60 bg-amber-200/10 text-amber-100" disabled>
                  Reconnecting...
                </Button>
                <Button className="border-rose-200/60 text-rose-100" onClick={handleLeaveRoom}>
                  Leave Room
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  )
}

export default App
