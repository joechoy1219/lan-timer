import { useEffect, useState, type ReactNode } from 'react'
import type { ControlActionType, RoomState } from '../../domain/types'
import { QRCodeSVG } from 'qrcode.react'
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'

interface LivePlayerView {
  id: string
  name: string
  connected: boolean
  displayMs: number
}

interface HostLobbySetupProps {
  state: RoomState
  orderedPlayers: LivePlayerView[]
  reconnectBlocked: boolean
  copiedShare: 'code' | 'link' | null
  hostJoinCode: string
  hostShareLink: string
  pendingInitialMinutes: number
  setPendingInitialMinutes: (value: number) => void
  sendControl: (action: ControlActionType, payload?: Record<string, unknown>) => Promise<void>
  copyToClipboard: (value: string, mode: 'code' | 'link') => Promise<void>
  handleLeaveRoom: () => void
}

const truncateLobbyName = (name: string, maxLength = 18) => {
  if (name.length <= maxLength) {
    return name
  }
  return `${name.slice(0, maxLength)}....`
}

const ActionIconButton = ({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) => (
  <button
    type="button"
    className="mono inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-[#d6ece6] transition hover:border-amber-200/80 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200/90 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1d26] disabled:cursor-not-allowed disabled:opacity-35"
    aria-label={label}
    disabled={disabled}
    onClick={onClick}
  >
    {children}
  </button>
)

const IconButton = ({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) => (
  <button
    type="button"
    className="mono inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/20 bg-black/20 text-[#d6ece6] transition hover:border-amber-200/80 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200/90 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1d26]"
    aria-label={label}
    onClick={onClick}
  >
    {children}
  </button>
)

interface LobbyPlayerRowProps {
  player: LivePlayerView
  index: number
  totalPlayers: number
  isLocal: boolean
  reconnectBlocked: boolean
  onMoveToEdge: (playerId: string, edge: 'start' | 'end') => void
}

const LobbyPlayerRow = ({
  player,
  index,
  totalPlayers,
  isLocal,
  reconnectBlocked,
  onMoveToEdge,
}: LobbyPlayerRowProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: player.id, disabled: reconnectBlocked })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={`rounded-xl border border-white/20 bg-black/20 px-3 py-3 ${isDragging ? 'z-20 border-amber-200/70 bg-[#133240] shadow-[0_16px_36px_rgba(0,0,0,0.45)]' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            ref={setActivatorNodeRef}
            type="button"
            className="inline-flex h-12 w-12 cursor-grab touch-none select-none items-center justify-center rounded-xl text-[#b8d6cd] active:cursor-grabbing"
            aria-label={`Drag to reorder ${player.name}`}
            {...attributes}
            {...listeners}
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 bg-black/30 transition hover:border-white/25 hover:bg-black/40">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 pointer-events-none" fill="currentColor">
                <circle cx="8" cy="7" r="1.5" />
                <circle cx="8" cy="12" r="1.5" />
                <circle cx="8" cy="17" r="1.5" />
                <circle cx="16" cy="7" r="1.5" />
                <circle cx="16" cy="12" r="1.5" />
                <circle cx="16" cy="17" r="1.5" />
              </svg>
            </span>
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="mono text-[11px] uppercase tracking-[0.14em] text-[#c9dfd8]">#{index + 1}</p>
              {isLocal && (
                <span className="mono rounded-full border border-amber-200/80 bg-amber-200/20 px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-100 shadow-[0_0_0_1px_rgba(255,209,102,0.22)]">
                  You
                </span>
              )}
            </div>
            <p className="mt-1 truncate text-sm font-semibold text-white" title={player.name}>
              {truncateLobbyName(player.name)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <ActionIconButton
            label="Move to first"
            disabled={reconnectBlocked || index === 0}
            onClick={() => onMoveToEdge(player.id, 'start')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 5H19" />
              <path d="M12 18V8" />
              <path d="M8 12L12 8L16 12" />
            </svg>
          </ActionIconButton>
          <ActionIconButton
            label="Move to last"
            disabled={reconnectBlocked || index === totalPlayers - 1}
            onClick={() => onMoveToEdge(player.id, 'end')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 19H19" />
              <path d="M12 6V16" />
              <path d="M8 12L12 16L16 12" />
            </svg>
          </ActionIconButton>
        </div>
      </div>
    </div>
  )
}

const ModalFrame = ({
  title,
  children,
  onClose,
}: {
  title: string
  children: ReactNode
  onClose: () => void
}) => (
  <div
    className="fixed inset-0 z-40 flex items-center justify-center bg-[#041014]/84 p-4 backdrop-blur-sm"
    onClick={onClose}
  >
    <div
      className="panel-strong flex max-h-[85dvh] w-full max-w-md flex-col rounded-3xl p-5 shadow-[0_24px_80px_rgba(0,0,0,0.58)]"
      onClick={(event) => event.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xl font-semibold text-white">{title}</h3>
      </div>
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">{children}</div>
      <div className="mt-4 border-t border-white/15 pt-4">
        <Button className="w-full" onClick={onClose}>Close</Button>
      </div>
    </div>
  </div>
)

export const HostLobbySetup = ({
  state,
  orderedPlayers,
  reconnectBlocked,
  copiedShare,
  hostJoinCode,
  hostShareLink,
  pendingInitialMinutes,
  setPendingInitialMinutes,
  sendControl,
  copyToClipboard,
  handleLeaveRoom,
}: HostLobbySetupProps) => {
  const [shareOpen, setShareOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draftMinutes, setDraftMinutes] = useState(pendingInitialMinutes)

  const playerIds = orderedPlayers.map((player) => player.id)
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 35, tolerance: 10 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const applyTurnOrder = async (nextOrder: string[]) => {
    if (nextOrder.length < 1) {
      return
    }
    await sendControl('SET_TURN_ORDER', { turnOrder: nextOrder })
  }

  const moveToEdge = async (playerId: string, edge: 'start' | 'end') => {
    const currentIndex = playerIds.indexOf(playerId)
    if (currentIndex < 0) {
      return
    }

    const targetIndex = edge === 'start' ? 0 : playerIds.length - 1
    if (targetIndex === currentIndex) {
      return
    }

    await applyTurnOrder(arrayMove(playerIds, currentIndex, targetIndex))
  }

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) {
      return
    }

    const oldIndex = playerIds.indexOf(String(active.id))
    const newIndex = playerIds.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
      return
    }

    void applyTurnOrder(arrayMove(playerIds, oldIndex, newIndex))
  }

  useEffect(() => {
    if (!shareOpen && !settingsOpen) {
      return
    }

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShareOpen(false)
        setSettingsOpen(false)
      }
    }

    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [shareOpen, settingsOpen])

  return (
    <section className="h-full">
      <article className="panel-strong reveal flex h-full min-h-0 flex-col rounded-2xl p-4 md:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="mono text-[11px] uppercase tracking-[0.16em] text-amber-200">Host Lobby Setup</p>
            <h2 className="mt-2 text-2xl font-semibold text-white md:text-3xl">{state.roomName}</h2>
          </div>
          <div className="flex gap-2">
            <IconButton label="Open share room" onClick={() => setShareOpen(true)}>
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <path d="M8.7 10.8l6.6-3.6M8.7 13.2l6.6 3.6" />
              </svg>
            </IconButton>
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-white/20 bg-black/20 p-3 text-xs text-[#d3e3de]">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="mono whitespace-nowrap text-[11px] text-[#d3e3de]">Players ready: {orderedPlayers.length}</p>
              <p className="mono mt-1 whitespace-nowrap text-[11px] text-[#d3e3de]">Initial time: {Math.max(1, pendingInitialMinutes)} min</p>
            </div>
            <ActionIconButton
              label="Open round settings"
              onClick={() => {
                setDraftMinutes(pendingInitialMinutes)
                setSettingsOpen(true)
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h0a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 1 1.5h0a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v0a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.5 1z" />
              </svg>
            </ActionIconButton>
          </div>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          autoScroll={false}
        >
          <SortableContext items={playerIds} strategy={verticalListSortingStrategy}>
            <div className="mt-4 flex-1 min-h-0 space-y-2 overflow-x-hidden overflow-y-auto overscroll-contain pr-1">
              {orderedPlayers.map((player, index) => (
                <LobbyPlayerRow
                  key={player.id}
                  player={player}
                  index={index}
                  totalPlayers={orderedPlayers.length}
                  isLocal={player.id === state.localPlayerId}
                  reconnectBlocked={reconnectBlocked}
                  onMoveToEdge={(playerId, edge) => {
                    void moveToEdge(playerId, edge)
                  }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button
            className="w-full border-white/25 bg-transparent py-3 text-sm text-[#c8dad4] hover:border-white/40 hover:bg-white/6"
            onClick={handleLeaveRoom}
          >
            Leave Room
          </Button>
          <Button
            className="w-full border-emerald-200/90 bg-emerald-200/30 py-3 text-sm text-emerald-50 hover:border-emerald-200 hover:bg-emerald-200/36"
            disabled={reconnectBlocked || orderedPlayers.length < 1}
            onClick={() => void sendControl('START_ROUND')}
          >
            Start Round
          </Button>
        </div>
      </article>

      {shareOpen && (
        <ModalFrame title="Share Room" onClose={() => setShareOpen(false)}>
          <div className="space-y-3">
            {/* Invite Code — click to copy */}
            <button
              type="button"
              className="group w-full rounded-2xl border border-emerald-200/40 bg-emerald-200/10 px-4 py-4 text-center transition hover:border-emerald-200/70 hover:bg-emerald-200/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200/90"
              onClick={() => void copyToClipboard(hostJoinCode, 'code')}
              aria-label="Copy invite code"
            >
              <div className="flex items-center justify-center gap-2">
                <p className="mono text-[11px] uppercase tracking-[0.16em] text-emerald-100">Invite Code</p>
                <span className="transition-transform duration-200 group-active:scale-110">
                  {copiedShare === 'code' ? (
                    <svg className="h-4 w-4 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4 text-[#8dbdb6]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </span>
              </div>
              <p className="mono mt-2 text-3xl tracking-[0.1em] text-white">{hostJoinCode}</p>
              <p className={`mono mt-2 text-[11px] uppercase tracking-[0.12em] transition-colors duration-300 ${copiedShare === 'code' ? 'text-emerald-300' : 'text-[#cce6dd]'}`}>
                {copiedShare === 'code' ? 'Copied!' : 'Click to copy'}
              </p>
            </button>

            {/* QR Code + Invite Link — click card to copy link */}
            <button
              type="button"
              className="group w-full rounded-2xl border border-white/15 bg-black/20 px-4 py-4 transition hover:border-white/30 hover:bg-black/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200/90"
              onClick={() => void copyToClipboard(hostShareLink, 'link')}
              aria-label="Copy invite link"
            >
              {/* Invite Link row */}
              <div className="mb-3 flex items-center justify-center gap-2">
                <p className="mono text-[11px] uppercase tracking-[0.12em] text-[#d1e7df]">Invite Link</p>
                <span className="transition-transform duration-200 group-active:scale-110">
                  {copiedShare === 'link' ? (
                    <svg className="h-4 w-4 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4 text-[#8dbdb6]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </span>
              </div>

              {/* QR Code */}
              <div className="flex justify-center">
                <div className="inline-flex rounded-2xl border border-white/20 bg-white p-3">
                  <QRCodeSVG
                    value={hostShareLink || hostJoinCode}
                    size={140}
                    bgColor="transparent"
                    fgColor="#0f172a"
                    title="Scan to join room"
                  />
                </div>
              </div>

              {/* Caption */}
              <p className={`mono mt-3 text-[11px] uppercase tracking-[0.12em] transition-colors duration-300 ${copiedShare === 'link' ? 'text-emerald-300' : 'text-[#cce6dd]'}`}>
                {copiedShare === 'link' ? 'Copied!' : 'Click to Copy'}
              </p>
            </button>
          </div>
        </ModalFrame>
      )}

      {settingsOpen && (
        <ModalFrame title="Round Settings" onClose={() => setSettingsOpen(false)}>
          <p className="text-sm text-[#cadfd9]">
            Set each player clock before opening the match.
          </p>
          <div className="mt-4 flex gap-2">
            <Input
              type="number"
              min={1}
              max={180}
              disabled={reconnectBlocked}
              value={String(draftMinutes)}
              onChange={(event) => setDraftMinutes(Number(event.target.value))}
            />
            <Button
              disabled={reconnectBlocked}
              onClick={() => {
                const confirmed = Math.max(1, draftMinutes)
                setPendingInitialMinutes(confirmed)
                void sendControl('SET_INITIAL_TIME', {
                  initialTimeMs: confirmed * 60_000,
                })
                setSettingsOpen(false)
              }}
            >
              Apply
            </Button>
          </div>
        </ModalFrame>
      )}
    </section>
  )
}
