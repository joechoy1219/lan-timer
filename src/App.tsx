import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { nanoid } from 'nanoid'
import { AnimatePresence, animate, motion } from 'framer-motion'
import { resolveRemainingMs, withElapsedCommitted } from './domain/timerEngine'
import type { NetworkMessage, RoomState, SnapshotEnvelope } from './domain/types'
import {
  createControlRejected,
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
import { Button } from './components/ui/Button'
import { Input } from './components/ui/Input'
import { PlayersPanel } from './components/live/PlayersPanel'
import { ControlDeck } from './components/live/ControlDeck'
import { ParticipantTurnView } from './components/live/ParticipantTurnView'
import { HostLobbySetup } from './components/live/HostLobbySetup'
const service = new PeerRoomService()
const HOST_RECONNECT_TIMEOUT_MS = 60_000
const HOST_SIGNAL_LOSS_THRESHOLD_MS = 5_000
const RECONNECT_ATTEMPT_INTERVAL_MS = 5_000
const JOIN_REQUEST_TIMEOUT_MS = 15_000
const JOIN_RETRY_INTERVAL_MS = 1_800
const JOIN_TIMEOUT_SECONDS = JOIN_REQUEST_TIMEOUT_MS / 1000
const JOIN_CANCEL_GUARD_TTL_MS = 30_000
const ACTIVE_PLAYER_DISCONNECT_SKIP_MS = 4_000
const TIMELINE_LIMIT = 24
const JOIN_CODE_LENGTH = 8
const JOIN_CODE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

const generateJoinCode = () => {
  const bytes = new Uint8Array(JOIN_CODE_LENGTH)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => JOIN_CODE_CHARSET[value % JOIN_CODE_CHARSET.length]).join('')
}

const sanitizeJoinCode = (value: string) =>
  value.replace(/[^A-Za-z0-9]/g, '').slice(0, JOIN_CODE_LENGTH)

const getJoinCodeFromUrl = () => {
  if (typeof window === 'undefined') {
    return ''
  }

  return sanitizeJoinCode(new URL(window.location.href).searchParams.get('join') ?? '')
}

const mergeParticipantView = (snapshot: SnapshotEnvelope, current: RoomState | null): RoomState => ({
  ...snapshot.state,
  role: current?.role ?? 'participant',
  localPlayerId: current?.localPlayerId ?? snapshot.state.localPlayerId,
})

const clampTurnIndex = (state: RoomState) =>
  Math.max(0, Math.min(state.turnIndex, Math.max(0, state.turnOrder.length - 1)))

const getTurnContext = (state: RoomState) => {
  if (state.turnOrder.length === 0) {
    return {
      previousPlayerId: null,
      currentPlayerId: null,
      nextPlayerId: null,
    }
  }

  const currentIndex = clampTurnIndex(state)
  const previousIndex = (currentIndex - 1 + state.turnOrder.length) % state.turnOrder.length
  const nextIndex = (currentIndex + 1) % state.turnOrder.length

  return {
    previousPlayerId: state.turnOrder[previousIndex] ?? null,
    currentPlayerId: state.turnOrder[currentIndex] ?? null,
    nextPlayerId: state.turnOrder[nextIndex] ?? null,
  }
}

const appendTimeline = (state: RoomState, message: string, at = Date.now()): RoomState => ({
  ...state,
  timeline: [
    {
      id: `app-${state.seq + 1}-${at}`,
      message,
      at,
    },
    ...state.timeline,
  ].slice(0, TIMELINE_LIMIT),
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const validateControlPayload = (
  action: Parameters<typeof createSignedControl>[3],
  payload: Record<string, unknown>,
): string | null => {
  switch (action) {
    case 'SET_TURN_ORDER': {
      if (!Array.isArray(payload.turnOrder) || payload.turnOrder.some((id) => typeof id !== 'string')) {
        return 'turnOrder must be an array of player ids.'
      }
      if (payload.turnOrder.length < 1) {
        return 'turnOrder cannot be empty.'
      }
      return null
    }
    case 'SWITCH_ACTIVE': {
      if (typeof payload.nextPlayerId !== 'string' || payload.nextPlayerId.length < 1) {
        return 'nextPlayerId is required.'
      }
      return null
    }
    case 'SET_INITIAL_TIME': {
      if (typeof payload.initialTimeMs !== 'number' || !Number.isFinite(payload.initialTimeMs)) {
        return 'initialTimeMs must be a finite number.'
      }
      return null
    }
    case 'KICK_PLAYER': {
      if (typeof payload.targetId !== 'string' || payload.targetId.length < 1) {
        return 'targetId is required.'
      }
      return null
    }
    case 'START_TIMER': {
      if (payload.playerId !== undefined && typeof payload.playerId !== 'string') {
        return 'playerId must be a string when provided.'
      }
      return null
    }
    case 'RENAME_SELF': {
      if (typeof payload.name !== 'string' || payload.name.trim().length < 1) {
        return 'name is required for rename.'
      }
      return null
    }
    default:
      return null
  }
}

const validateControlAuthorization = (
  state: RoomState,
  actorId: string,
  action: Parameters<typeof createSignedControl>[3],
): string | null => {
  const isHostActor = actorId === state.hostPlayerId
  const hostOnlyActions: Parameters<typeof createSignedControl>[3][] = [
    'START_TIMER',
    'START_ROUND',
    'PAUSE_TIMER',
    'SWITCH_ACTIVE',
    'SET_TURN_ORDER',
    'FORCE_NEXT',
    'RESET_ALL',
    'SET_INITIAL_TIME',
    'GLOBAL_PAUSE',
    'GLOBAL_RESUME',
    'KICK_PLAYER',
  ]

  if (hostOnlyActions.includes(action) && !isHostActor) {
    return 'Only host can execute this action.'
  }

  if (action === 'END_TURN') {
    if (state.phase === 'lobby') {
      return 'Round has not started yet.'
    }
    if (state.activePlayerId !== actorId) {
      return 'Only the active player can end this turn.'
    }
  }

  return null
}

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
  })
  const [joinForm, setJoinForm] = useState(() => ({
    joinCode: getJoinCodeFromUrl(),
  }))
  const [cameraModalOpen, setCameraModalOpen] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [cameraScanning, setCameraScanning] = useState(false)
  const [copiedShare, setCopiedShare] = useState<'code' | 'link' | null>(null)
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
  const joinRetryInFlightRef = useRef(false)
  const joinStatusTimerRef = useRef<number | null>(null)
  const joinTimeoutRef = useRef<number | null>(null)
  const autoJoinCodeRef = useRef(getJoinCodeFromUrl())
  const autoJoinTriggeredRef = useRef(false)
  const joinAttemptRef = useRef<{
    roomId: string
    playerId: string
    cancelled: boolean
    interactive: boolean
    startedAt: number
  } | null>(null)
  const cancelledJoinPlayersRef = useRef<Map<string, number>>(new Map())
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const cameraScanFrameRef = useRef<number | null>(null)
  const activeDisconnectedAtRef = useRef<number | null>(null)
  const autoAdvanceInFlightRef = useRef(false)
  const lastHostSignalAtRef = useRef<number>(0)
  const handleNetworkMessageRef = useRef<((message: NetworkMessage, senderPeerId?: string) => Promise<void>) | null>(null)
  const joinRoomRef = useRef<
    | ((options?: {
        joinCode?: string
        roomId?: string
        hostPeerId?: string
        playerName?: string
        password?: string
        passwordHash?: string
        playerId?: string
        showModal?: boolean
        retryWithinAttempt?: boolean
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

  const createJoinShareLink = useCallback((joinCode: string) => {
    if (typeof window === 'undefined') {
      return joinCode
    }

    const shareUrl = new URL(window.location.href)
    shareUrl.searchParams.set('join', joinCode)
    return shareUrl.toString()
  }, [])

  const copyToClipboard = useCallback(async (value: string, mode: 'code' | 'link') => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = value
        textarea.setAttribute('readonly', 'true')
        textarea.style.position = 'absolute'
        textarea.style.left = '-9999px'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }

      setCopiedShare(mode)
      setStatusText(mode === 'code' ? 'Join code copied.' : 'Invite link copied.')
    } catch {
      setStatusText('Unable to copy automatically. Please copy manually.')
    }
  }, [setStatusText])

  const stopCameraScanner = useCallback(() => {
    if (cameraScanFrameRef.current) {
      window.cancelAnimationFrame(cameraScanFrameRef.current)
      cameraScanFrameRef.current = null
    }

    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop())
      cameraStreamRef.current = null
    }

    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null
    }

    setCameraScanning(false)
  }, [])

  const extractJoinCode = useCallback((rawValue: string) => {
    const sanitizedRaw = sanitizeJoinCode(rawValue)
    if (sanitizedRaw.length === JOIN_CODE_LENGTH) {
      return sanitizedRaw
    }

    try {
      const parsed = new URL(rawValue)
      const fromQuery = sanitizeJoinCode(parsed.searchParams.get('join') ?? '')
      if (fromQuery.length === JOIN_CODE_LENGTH) {
        return fromQuery
      }
      const fromPath = sanitizeJoinCode(parsed.pathname.split('/').pop() ?? '')
      if (fromPath.length === JOIN_CODE_LENGTH) {
        return fromPath
      }
    } catch {
      return ''
    }

    return ''
  }, [])

  const startCameraScanner = useCallback(async () => {
    setCameraError(null)

    const BarcodeDetectorCtor = (window as unknown as {
      BarcodeDetector?: new (options?: { formats?: string[] }) => {
        detect: (input: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>
      }
    }).BarcodeDetector

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('This device/browser does not support camera access.')
      return
    }

    if (!BarcodeDetectorCtor) {
      setCameraError('QR scanning is not supported in this browser. Please type the code manually.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
        },
        audio: false,
      })

      cameraStreamRef.current = stream
      const video = cameraVideoRef.current
      if (!video) {
        setCameraError('Camera preview is unavailable.')
        stopCameraScanner()
        return
      }

      video.srcObject = stream
      await video.play()
      setCameraScanning(true)

      const detector = new BarcodeDetectorCtor({ formats: ['qr_code'] })

      const scanLoop = async () => {
        const activeVideo = cameraVideoRef.current
        if (!activeVideo || activeVideo.readyState < 2) {
          cameraScanFrameRef.current = window.requestAnimationFrame(() => {
            void scanLoop()
          })
          return
        }

        try {
          const barcodes = await detector.detect(activeVideo as unknown as ImageBitmapSource)
          const matched = barcodes
            .map((barcode) => barcode.rawValue ?? '')
            .map((value) => extractJoinCode(value))
            .find((value) => value.length === JOIN_CODE_LENGTH)

          if (matched) {
            setJoinForm((prev) => ({ ...prev, joinCode: matched }))
            setStatusText('Join code captured from camera.')
            setCameraModalOpen(false)
            stopCameraScanner()
            return
          }
        } catch {
          setCameraError('Unable to scan this frame. Keep the code in focus and try again.')
        }

        cameraScanFrameRef.current = window.requestAnimationFrame(() => {
          void scanLoop()
        })
      }

      cameraScanFrameRef.current = window.requestAnimationFrame(() => {
        void scanLoop()
      })
    } catch {
      setCameraError('Camera permission was denied or unavailable.')
      stopCameraScanner()
    }
  }, [extractJoinCode, setStatusText, stopCameraScanner])

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
    const nextTurnOrder = committed.turnOrder.filter((playerId) => playerId !== departingPlayerId)
    const fallbackTurnOrder = nextTurnOrder.length > 0 ? nextTurnOrder : [committed.hostPlayerId]
    const currentIndex = Math.max(0, Math.min(committed.turnIndex, Math.max(0, committed.turnOrder.length - 1)))
    const nextIndex = fallbackTurnOrder.length === 0
      ? 0
      : wasActive
        ? currentIndex % fallbackTurnOrder.length
        : Math.max(0, Math.min(currentIndex, fallbackTurnOrder.length - 1))

    const nextStateBase: RoomState = {
      ...committed,
      seq: committed.seq + 1,
      updatedAt: now,
      players: committed.players.filter((player) => player.id !== departingPlayerId),
      turnOrder: fallbackTurnOrder,
      turnIndex: nextIndex,
      activePlayerId: fallbackTurnOrder[nextIndex] ?? null,
      phase: wasActive ? 'paused' : committed.phase,
      isRunning: wasActive ? false : committed.isRunning,
      lastStartedAt: wasActive ? null : committed.lastStartedAt,
      globalPaused: wasActive ? true : committed.globalPaused,
      lastTurnSwitchedAt: wasActive ? now : committed.lastTurnSwitchedAt,
    }
    const nextState = appendTimeline(
      nextStateBase,
      wasActive
        ? `${departing.name} left during active turn. Match paused for safety.`
        : `${departing.name} left the room.`,
      now,
    )

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

    const nextStateBase: RoomState = {
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
    const nextState = appendTimeline(nextStateBase, `${participant.name} disconnected.`, Date.now())

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
    if (!copiedShare) {
      return
    }

    const resetId = window.setTimeout(() => setCopiedShare(null), 1300)
    return () => window.clearTimeout(resetId)
  }, [copiedShare])

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

  useEffect(() => {
    if (!state || state.role !== 'host') {
      activeDisconnectedAtRef.current = null
      return
    }

    const id = window.setInterval(() => {
      if (autoAdvanceInFlightRef.current) {
        return
      }

      const latest = useRoomStore.getState().state
      if (!latest || latest.role !== 'host') {
        activeDisconnectedAtRef.current = null
        return
      }

      if (
        latest.phase === 'lobby'
        || latest.globalPaused
        || !latest.isRunning
        || !latest.activePlayerId
      ) {
        activeDisconnectedAtRef.current = null
        return
      }

      const active = latest.players.find((player) => player.id === latest.activePlayerId)
      if (!active) {
        activeDisconnectedAtRef.current = null
        return
      }

      const now = Date.now()
      const activeRemainingMs = resolveRemainingMs(active, latest, now)
      const shouldSkipForTimeout = activeRemainingMs <= 0
      const shouldSkipForDisconnect = !active.connected
        && activeDisconnectedAtRef.current !== null
        && now - activeDisconnectedAtRef.current >= ACTIVE_PLAYER_DISCONNECT_SKIP_MS

      if (shouldSkipForTimeout || shouldSkipForDisconnect) {
        autoAdvanceInFlightRef.current = true
        void applyHostAction({
          type: 'FORCE_NEXT',
          actorId: latest.hostPlayerId,
          now,
        }).then((next) => {
          if (!next) {
            return
          }

          service.broadcast(createSnapshot(next))
          if (shouldSkipForTimeout) {
            setStatusText(`${active.name} reached 00:00. Turn advanced automatically.`)
          } else {
            setStatusText(`${active.name} disconnected. Turn advanced automatically.`)
          }
        }).finally(() => {
          autoAdvanceInFlightRef.current = false
          activeDisconnectedAtRef.current = null
        })
        return
      }

      if (!active.connected) {
        if (!activeDisconnectedAtRef.current) {
          activeDisconnectedAtRef.current = now
        }
        return
      }

      activeDisconnectedAtRef.current = null
    }, 300)

    return () => window.clearInterval(id)
  }, [applyHostAction, setStatusText, state])

  useEffect(() => () => service.cleanup(), [])

  useEffect(() => {
    return () => {
      if (joinStatusTimerRef.current) {
        window.clearTimeout(joinStatusTimerRef.current)
      }
      if (joinTimeoutRef.current) {
        window.clearTimeout(joinTimeoutRef.current)
      }
      stopCameraScanner()
    }
  }, [stopCameraScanner])

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

  useEffect(() => {
    if (!joinStatusModal.open || joinStatusModal.phase !== 'connecting') {
      return
    }

    const retryId = window.setInterval(() => {
      if (peerConnected || joinRetryInFlightRef.current) {
        return
      }

      const attempt = joinAttemptRef.current
      if (!attempt || attempt.cancelled || !attempt.interactive) {
        return
      }

      if (Date.now() - attempt.startedAt >= JOIN_REQUEST_TIMEOUT_MS) {
        return
      }

      const retry = joinRoomRef.current
      if (!retry) {
        return
      }

      joinRetryInFlightRef.current = true
      void retry({
        joinCode: attempt.roomId,
        playerId: attempt.playerId,
        showModal: false,
        retryWithinAttempt: true,
      }).finally(() => {
        joinRetryInFlightRef.current = false
      })
    }, JOIN_RETRY_INTERVAL_MS)

    return () => window.clearInterval(retryId)
  }, [joinStatusModal.open, joinStatusModal.phase, peerConnected])

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

      const nextStateBase = exists
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
            turnOrder: [...current.turnOrder, message.playerId],
            activePlayerId: current.activePlayerId ?? current.turnOrder[0] ?? message.playerId,
          }
      const nextState = appendTimeline(
        nextStateBase,
        isReconnect
          ? `${message.playerName.slice(0, 24)} reconnected.`
          : exists
            ? `${message.playerName.slice(0, 24)} synced.`
            : `${message.playerName.slice(0, 24)} joined the room.`,
        Date.now(),
      )

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

    if (message.type === 'CONTROL_REJECTED') {
      setStatusText(`Control rejected (${message.reason}): ${message.message}`)
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
      const reject = (reason: Parameters<typeof createControlRejected>[2], detail: string) => {
        setStatusText(`Rejected ${message.action}: ${detail}`)
        if (senderPeerId) {
          service.sendToPeer(senderPeerId, createControlRejected(current.roomId, message.action, reason, detail))
        }
      }

      if (message.roomId !== current.roomId) {
        reject('ROOM_MISMATCH', 'Control was sent to a different room.')
        return
      }

      if (message.seq <= current.seq) {
        reject('STALE_SEQ', 'Control sequence is stale.')
        return
      }

      const actor = current.players.find((player) => player.id === message.fromPlayerId)
      if (!actor) {
        reject('UNKNOWN_ACTOR', 'Request actor is not in this room.')
        return
      }

      const valid = await verifySignedControl(message, current.passwordHash)
      if (!valid) {
        reject('INVALID_SIGNATURE', 'Signature validation failed.')
        return
      }

      const payload = isRecord(message.payload) ? message.payload : {}
      const payloadError = validateControlPayload(message.action, payload)
      if (payloadError) {
        reject('INVALID_PAYLOAD', payloadError)
        return
      }

      const authError = validateControlAuthorization(current, message.fromPlayerId, message.action)
      if (authError) {
        reject('NOT_ALLOWED', authError)
        return
      }

      const next = await applyHostAction({
        type: message.action,
        actorId: message.fromPlayerId,
        now: Date.now(),
        payload,
      })
      if (next) {
        service.broadcast(createSnapshot(next))
      }
    }
  }, [applyHostAction, clearHostReconnectWait, clearJoinTimeout, leaveRoom, markJoinCancelled, markParticipantDisconnected, openJoinStatusModal, removeParticipantFromHostState, setStateFromHost, setStatusText, showJoinSuccessAndAutoClose, wasJoinCancelledRecently])

  const createHostRoom = async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const joinCode = generateJoinCode()
      const hostPeerId = `host-${joinCode}`

      const hostReady = await new Promise<boolean>((resolve) => {
        let settled = false
        const settle = (value: boolean) => {
          if (settled) {
            return
          }
          settled = true
          resolve(value)
        }

        const timeoutId = window.setTimeout(() => settle(false), 2500)

        service.createHost(hostPeerId, handleNetworkMessage, (status) => {
          setStatusText(status)
          if (status.startsWith('Host ready as')) {
            window.clearTimeout(timeoutId)
            settle(true)
            return
          }

          const statusLower = status.toLowerCase()
          if (statusLower.includes('taken') || statusLower.includes('unavailable-id')) {
            window.clearTimeout(timeoutId)
            settle(false)
          }
        })
      })

      if (!hostReady) {
        continue
      }

      const created = await createRoom({
        roomName: createForm.roomName,
        joinCode,
        hostPeerId,
      })
      setJoinForm({ joinCode })
      setPendingInitialMinutes(Math.max(1, Math.round(created.initialTimeMs / 60_000)))
      setLocalPeerId(hostPeerId)
      setPeerConnected(false)
      return
    }

    setStatusText('Unable to allocate a unique join code. Please try again.')
  }

  const joinRoom = useCallback(async (options?: {
    joinCode?: string
    roomId?: string
    hostPeerId?: string
    playerName?: string
    password?: string
    passwordHash?: string
    playerId?: string
    showModal?: boolean
    retryWithinAttempt?: boolean
  }) => {
    const retryWithinAttempt = options?.retryWithinAttempt ?? false
    const manualJoinCode = sanitizeJoinCode(options?.joinCode ?? joinForm.joinCode)
    const derivedRoomId = manualJoinCode
    const derivedHostPeerId = manualJoinCode ? `host-${manualJoinCode}` : ''
    const roomId = (options?.roomId ?? derivedRoomId).trim()
    const hostPeerId = (options?.hostPeerId ?? derivedHostPeerId).trim()
    const playerName = (options?.playerName ?? 'Player').trim() || 'Player'
    const password = options?.password ?? manualJoinCode
    const showModal = options?.showModal ?? true

    if (!roomId || !hostPeerId) {
      setStatusText('Missing join code.')
      if (showModal) {
        openJoinStatusModal('error', 'Please enter a valid 8-character join code.')
      }
      return
    }

    if (!options?.passwordHash && manualJoinCode.length !== JOIN_CODE_LENGTH) {
      setStatusText('Join code must be 8 characters.')
      if (showModal) {
        openJoinStatusModal('error', 'Join code must be exactly 8 characters.')
      }
      return
    }

    if (showModal && !retryWithinAttempt) {
      setJoinElapsedSeconds(1)
      openJoinStatusModal('connecting', 'Connecting to host...')
    }

    const peerId = `peer-${nanoid(8)}`
    const playerId = options?.playerId ?? nanoid(12)
    const joinRequest = options?.passwordHash
      ? createJoinRequestWithHash(roomId, playerId, playerName, options.passwordHash)
      : await createJoinRequest(roomId, playerId, playerName, password)

    joinRequestRef.current = joinRequest
    if (!retryWithinAttempt) {
      joinAttemptRef.current = {
        roomId,
        playerId,
        cancelled: false,
        interactive: showModal,
        startedAt: Date.now(),
      }
      clearJoinTimeout()
    }

    if (showModal && !retryWithinAttempt) {
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

        if (activeAttempt.interactive) {
          setStatusText('Join in progress. Retrying automatically...')
          if (showModal) {
            openJoinStatusModal('connecting', 'Connection dropped. Retrying automatically...')
          }
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
  }, [abortJoinAttempt, beginHostReconnectWait, clearHostReconnectWait, clearJoinTimeout, handleNetworkMessage, joinForm.joinCode, markJoinCancelled, openJoinStatusModal, setStatusText])

  const joinProgressSeconds = Math.max(1, Math.min(JOIN_TIMEOUT_SECONDS, joinElapsedSeconds || 1))
  const joinProgressPercent = (joinProgressSeconds / JOIN_TIMEOUT_SECONDS) * 100
  const hostJoinCode = state?.role === 'host' ? state.roomId : ''
  const hostShareLink = hostJoinCode ? createJoinShareLink(hostJoinCode) : ''

  useEffect(() => {
    handleNetworkMessageRef.current = handleNetworkMessage
  }, [handleNetworkMessage])

  useEffect(() => {
    joinRoomRef.current = joinRoom
  }, [joinRoom])

  useEffect(() => {
    if (autoJoinTriggeredRef.current || state) {
      return
    }

    const autoJoinCode = autoJoinCodeRef.current
    if (autoJoinCode.length !== JOIN_CODE_LENGTH) {
      return
    }

    autoJoinTriggeredRef.current = true
    setStatusText('Join code detected from link. Auto joining...')
    void joinRoom({ joinCode: autoJoinCode, showModal: true })
  }, [joinRoom, setStatusText, state])

  useEffect(() => {
    if (!state) {
      return
    }
    localStorage.setItem('lan-timer:last-room-id', state.roomId)
  }, [state])

  useEffect(() => {
    if (!state || typeof window === 'undefined') {
      return
    }

    const currentUrl = new URL(window.location.href)
    if (!currentUrl.searchParams.has('join')) {
      return
    }

    currentUrl.searchParams.delete('join')
    window.history.replaceState({}, '', currentUrl.toString())
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
      if (autoJoinCodeRef.current.length === JOIN_CODE_LENGTH) {
        return
      }

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
        joinCode: recovered.roomId,
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

  const sendControl = useCallback(async (
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
  }, [applyHostAction, nowMs, reconnectBlocked, setStatusText])

  const players = useMemo(() => {
    if (!state) {
      return []
    }
    return state.players.map((player) => ({
      ...player,
      displayMs: resolveRemainingMs(player, state, nowMs),
    }))
  }, [state, nowMs])

  const orderedPlayers = useMemo(() => {
    if (!state) {
      return []
    }

    const byId = new Map(players.map((player) => [player.id, player]))
    return state.turnOrder
      .map((playerId) => byId.get(playerId))
      .filter((player): player is (typeof players)[number] => Boolean(player))
  }, [players, state])

  const turnContext = useMemo(() => {
    if (!state) {
      return {
        previousPlayerId: null,
        currentPlayerId: null,
        nextPlayerId: null,
      }
    }
    return getTurnContext(state)
  }, [state])

  const moveTurnOrder = useCallback(async (playerId: string, direction: -1 | 1) => {
    if (!state || state.role !== 'host') {
      return
    }

    const currentIndex = state.turnOrder.indexOf(playerId)
    if (currentIndex < 0) {
      return
    }

    const nextIndex = currentIndex + direction
    if (nextIndex < 0 || nextIndex >= state.turnOrder.length) {
      return
    }

    const turnOrder = [...state.turnOrder]
    ;[turnOrder[currentIndex], turnOrder[nextIndex]] = [turnOrder[nextIndex], turnOrder[currentIndex]]
    await sendControl('SET_TURN_ORDER', { turnOrder })
  }, [sendControl, state])

  const myTurn = Boolean(state && turnContext.currentPlayerId === state.localPlayerId && state.phase !== 'lobby')

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
                <p className="mono rounded-xl border border-amber-200/35 bg-amber-200/10 px-3 py-2 text-[11px] uppercase tracking-[0.14em] text-amber-100">
                  A secure 8-character join code will be generated automatically.
                </p>
                <Button
                  className="w-full"
                  onClick={() => void createHostRoom()}
                  disabled={!createForm.roomName.trim()}
                >
                  Create as Host
                </Button>
              </div>
            </article>

            <article className="panel reveal rounded-2xl p-5 [animation-delay:90ms]">
              <h2 className="text-xl font-semibold">Join Room</h2>
              <div className="mt-4 space-y-3">
                <Input
                  placeholder="Enter 8-character join code"
                  maxLength={JOIN_CODE_LENGTH}
                  value={joinForm.joinCode}
                  onChange={(event) =>
                    setJoinForm((prev) => ({
                      ...prev,
                      joinCode: sanitizeJoinCode(event.target.value),
                    }))
                  }
                />
                <p className="mono text-[11px] uppercase tracking-[0.12em] text-[#b7d1c9]">
                  Tip: paste works with spaces or symbols; they will be removed automatically.
                </p>
                <Button
                  className="w-full"
                  onClick={() => {
                    setCameraModalOpen(true)
                    void startCameraScanner()
                  }}
                >
                  Use Camera to Scan Code
                </Button>
                <Button
                  className="w-full"
                  onClick={() => void joinRoom()}
                  disabled={joinForm.joinCode.trim().length !== JOIN_CODE_LENGTH}
                >
                  Join as Participant
                </Button>
              </div>
            </article>
          </section>
        )}

        {state && isHost && state.phase === 'lobby' && (
          <HostLobbySetup
            state={state}
            orderedPlayers={orderedPlayers}
            reconnectBlocked={reconnectBlocked}
            copiedShare={copiedShare}
            hostJoinCode={hostJoinCode}
            hostShareLink={hostShareLink}
            pendingInitialMinutes={pendingInitialMinutes}
            setPendingInitialMinutes={setPendingInitialMinutes}
            sendControl={sendControl}
            moveTurnOrder={moveTurnOrder}
            copyToClipboard={copyToClipboard}
          />
        )}

        {state && isHost && state.phase !== 'lobby' && (
          <section className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
            <PlayersPanel
              state={state}
              isHost={isHost}
              reconnectBlocked={reconnectBlocked}
              orderedPlayers={orderedPlayers}
              sendControl={sendControl}
              moveTurnOrder={moveTurnOrder}
            />

            <ControlDeck
              state={state}
              isHost={isHost}
              statusText={statusText}
              reconnectBlocked={reconnectBlocked}
              hostReconnectDeadlineAt={hostReconnectDeadlineAt}
              hostReconnectSecondsLeft={hostReconnectSecondsLeft}
              myTurn={myTurn}
              pendingInitialMinutes={pendingInitialMinutes}
              setPendingInitialMinutes={setPendingInitialMinutes}
              peerConnected={peerConnected}
              localPeerId={localPeerId}
              copiedShare={copiedShare}
              hostJoinCode={hostJoinCode}
              hostShareLink={hostShareLink}
              players={players}
              turnContext={turnContext}
              sendControl={sendControl}
              copyToClipboard={copyToClipboard}
              handleLeaveRoom={handleLeaveRoom}
            />
          </section>
        )}

        {state && !isHost && (
          <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <ParticipantTurnView
              state={state}
              orderedPlayers={orderedPlayers}
              turnContext={turnContext}
              myTurn={myTurn}
              reconnectBlocked={reconnectBlocked}
              sendControl={sendControl}
            />

            <ControlDeck
              state={state}
              isHost={isHost}
              participantMode
              statusText={statusText}
              reconnectBlocked={reconnectBlocked}
              hostReconnectDeadlineAt={hostReconnectDeadlineAt}
              hostReconnectSecondsLeft={hostReconnectSecondsLeft}
              myTurn={myTurn}
              pendingInitialMinutes={pendingInitialMinutes}
              setPendingInitialMinutes={setPendingInitialMinutes}
              peerConnected={peerConnected}
              localPeerId={localPeerId}
              copiedShare={copiedShare}
              hostJoinCode={hostJoinCode}
              hostShareLink={hostShareLink}
              players={players}
              turnContext={turnContext}
              sendControl={sendControl}
              copyToClipboard={copyToClipboard}
              handleLeaveRoom={handleLeaveRoom}
            />
          </section>
        )}

        {state && myTurn && (
          <div className="fixed inset-x-4 bottom-4 z-30 md:hidden">
            <Button
              className="w-full border-emerald-200/70 bg-emerald-200/20 py-4 text-base"
              disabled={reconnectBlocked || state.globalPaused}
              onClick={() => void sendControl('END_TURN')}
            >
              Tap to End My Turn
            </Button>
          </div>
        )}

        <footer className="mono text-center text-xs tracking-[0.14em] text-[#aec6be]">
          Browser-only sync with host authority, sequence ordering, and IndexedDB recovery.
        </footer>
      </div>

      <AnimatePresence>
        {cameraModalOpen && !state && (
          <motion.div
            className="fixed inset-0 z-40 flex items-center justify-center bg-[#041014]/82 p-5 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-full max-w-md rounded-3xl border border-emerald-300/35 bg-[#061a23]/94 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.58)]"
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 260, damping: 25 }}
              role="dialog"
              aria-modal="true"
              aria-label="Scan join code"
            >
              <p className="mono text-[11px] uppercase tracking-[0.18em] text-emerald-100">Camera Scan</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Point camera at room QR</h2>
              <p className="mt-2 text-sm text-[#d2e4de]">
                Permission prompt will appear once. Keep the QR code inside frame to auto-fill join code.
              </p>

              <div className="mt-4 overflow-hidden rounded-2xl border border-white/20 bg-black/40">
                <video
                  ref={cameraVideoRef}
                  className="h-64 w-full object-cover"
                  playsInline
                  muted
                  autoPlay
                />
              </div>

              {cameraScanning && (
                <p className="mono mt-3 text-xs uppercase tracking-[0.12em] text-emerald-200">Scanning for QR code...</p>
              )}

              {cameraError && (
                <p className="mono mt-3 rounded-lg border border-rose-300/50 bg-rose-200/10 px-3 py-2 text-xs text-rose-100">
                  {cameraError}
                </p>
              )}

              <div className="mt-5 flex justify-end gap-2">
                <Button
                  className="border-rose-200/60 text-rose-100"
                  onClick={() => {
                    stopCameraScanner()
                    setCameraModalOpen(false)
                    setCameraError(null)
                  }}
                >
                  Close
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}

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
