import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { formatMs } from '../../domain/timerEngine'
import type { RoomState } from '../../domain/types'
import { Button } from '../ui/Button'

interface LivePlayerView {
  id: string
  name: string
  connected: boolean
  displayMs: number
}

interface PlayersPanelProps {
  state: RoomState
  isHost: boolean
  reconnectBlocked: boolean
  orderedPlayers: LivePlayerView[]
  moveTurnOrder: (playerId: string, direction: -1 | 1) => Promise<void>
  kickParticipant: (playerId: string) => Promise<void>
  adjustParticipantTime: (playerId: string, deltaMs: number) => Promise<void>
  fullHeight?: boolean
  leftActions?: ReactNode
  headerActions?: ReactNode
  onOpenControlDeck?: () => void
}

export const PlayersPanel = ({
  state,
  isHost,
  reconnectBlocked,
  orderedPlayers,
  moveTurnOrder,
  kickParticipant,
  adjustParticipantTime,
  fullHeight = false,
  leftActions,
  headerActions,
  onOpenControlDeck,
}: PlayersPanelProps) => {
  const [menuPlayerId, setMenuPlayerId] = useState<string | null>(null)
  const [applyingAdjust, setApplyingAdjust] = useState(false)
  const [lastAppliedAdjustPreset, setLastAppliedAdjustPreset] = useState<{
    sign: 1 | -1
    m3: string
    m2: string
    m1: string
    s2: string
    s1: string
  }>({
    sign: 1,
    m3: '0',
    m2: '0',
    m1: '0',
    s2: '0',
    s1: '0',
  })
  const [timeAdjustState, setTimeAdjustState] = useState<{
    playerId: string
    playerName: string
    remainingMs: number
    sign: 1 | -1
    m3: string
    m2: string
    m1: string
    s2: string
    s1: string
  } | null>(null)

  useEffect(() => {
    if (!menuPlayerId) {
      return
    }

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }
      if (target.closest('[data-player-card="true"]')) {
        return
      }
      setMenuPlayerId(null)
    }

    window.addEventListener('mousedown', handleOutsideClick)
    return () => window.removeEventListener('mousedown', handleOutsideClick)
  }, [menuPlayerId])

  useEffect(() => {
    if (!timeAdjustState) {
      return
    }

    const latest = orderedPlayers.find((player) => player.id === timeAdjustState.playerId)
    if (!latest) {
      return
    }

    setTimeAdjustState((current) => {
      if (!current || current.playerId !== latest.id || current.remainingMs === latest.displayMs) {
        return current
      }
      return {
        ...current,
        remainingMs: latest.displayMs,
      }
    })
  }, [orderedPlayers, timeAdjustState])

  const openTimeAdjustDialog = (player: LivePlayerView) => {
    setTimeAdjustState({
      playerId: player.id,
      playerName: player.name,
      remainingMs: player.displayMs,
      sign: lastAppliedAdjustPreset.sign,
      m3: lastAppliedAdjustPreset.m3,
      m2: lastAppliedAdjustPreset.m2,
      m1: lastAppliedAdjustPreset.m1,
      s2: lastAppliedAdjustPreset.s2,
      s1: lastAppliedAdjustPreset.s1,
    })
  }

  const deltaMs = timeAdjustState
    ? (
        ((Number(timeAdjustState.m3) * 100 + Number(timeAdjustState.m2) * 10 + Number(timeAdjustState.m1)) * 60)
        + (Number(timeAdjustState.s2) * 10 + Number(timeAdjustState.s1))
      ) * 1000 * timeAdjustState.sign
    : 0

  const updateAdjustDigit = (key: 'm3' | 'm2' | 'm1' | 's2' | 's1', direction: 1 | -1) => {
    setTimeAdjustState((current) => {
      if (!current) {
        return current
      }
      const currentValue = Number(current[key])
      const nextValue = (currentValue + direction + 10) % 10
      return {
        ...current,
        [key]: String(nextValue),
      }
    })
  }

  const canApplyDelta = Boolean(timeAdjustState) && Math.abs(deltaMs) > 0 && !reconnectBlocked && !applyingAdjust

  return (
  <>
  <article className={`panel-strong reveal rounded-2xl p-5 ${fullHeight ? 'flex h-full min-h-0 flex-col' : ''}`}>
    <div className="flex items-center gap-2">
      {leftActions}

      {/* Settings icon button for room actions while in-game */}
      {onOpenControlDeck ? (
        <button
          type="button"
          onClick={onOpenControlDeck}
          className="group mono inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/20 bg-black/20 text-[#d6ece6] transition duration-150 hover:border-amber-200/80 hover:bg-white/10 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200/90 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1d26]"
          aria-label="Open room settings"
          title="Room settings"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="h-5 w-5 transition duration-150 group-hover:rotate-45"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.08a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.08a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      ) : (
        <div className="flex-1" />
      )}

      {headerActions && (
        <div className="ml-auto flex shrink-0 items-center gap-2">{headerActions}</div>
      )}
    </div>

    <div className={`mt-4 grid content-start auto-rows-max gap-3 ${fullHeight ? 'min-h-0 flex-1 overflow-y-auto pr-1' : ''} md:grid-cols-2`}>
      {orderedPlayers.map((player, index) => {
        const isActive = state.activePlayerId === player.id
        const isLocal = state.localPlayerId === player.id
        const isConnected = player.connected
        const lowTime = player.displayMs < 30_000

        return (
          <div
            key={player.id}
            data-player-card="true"
            className={`relative rounded-2xl border p-4 transition ${
              isActive
                ? 'border-amber-300 bg-amber-100/10 shadow-[var(--glow)]'
                : 'border-white/15 bg-white/5'
            } ${
              isConnected
                ? 'opacity-100'
                : 'border-rose-300/40 bg-rose-200/5 opacity-70 saturate-50'
            } ${isHost ? 'cursor-pointer' : ''}`}
            onClick={() => {
              if (!isHost || reconnectBlocked) {
                return
              }
              setMenuPlayerId((current) => (current === player.id ? null : player.id))
            }}
          >
            {isHost && menuPlayerId === player.id && (
              <div
                className="absolute right-2 top-2 z-20 flex items-center gap-2 rounded-xl border border-white/20 bg-[#091923]/95 p-2 shadow-[0_14px_32px_rgba(0,0,0,0.42)] backdrop-blur-sm"
                onClick={(event) => event.stopPropagation()}
              >
                <Button
                  className="inline-flex h-11 w-11 min-h-0 items-center justify-center px-0 py-0"
                  aria-label="Adjust remaining time"
                  title="Adjust remaining time"
                  disabled={reconnectBlocked}
                  onClick={() => {
                    setMenuPlayerId(null)
                    openTimeAdjustDialog(player)
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2v20" />
                    <path d="M7 7h10" />
                    <path d="M7 17h10" />
                    <path d="m8 5-2 2 2 2" />
                    <path d="m16 19 2-2-2-2" />
                  </svg>
                </Button>
                <Button
                  className="inline-flex h-11 w-11 min-h-0 items-center justify-center px-0 py-0"
                  aria-label="Move up"
                  title="Move up"
                  disabled={reconnectBlocked || index === 0}
                  onClick={() => {
                    setMenuPlayerId(null)
                    void moveTurnOrder(player.id, -1)
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14" />
                    <path d="m6 11 6-6 6 6" />
                  </svg>
                </Button>
                <Button
                  className="inline-flex h-11 w-11 min-h-0 items-center justify-center px-0 py-0"
                  aria-label="Move down"
                  title="Move down"
                  disabled={reconnectBlocked || index === orderedPlayers.length - 1}
                  onClick={() => {
                    setMenuPlayerId(null)
                    void moveTurnOrder(player.id, 1)
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 19V5" />
                    <path d="m6 13 6 6 6-6" />
                  </svg>
                </Button>
                <Button
                  className="inline-flex h-11 w-11 min-h-0 items-center justify-center border-rose-200/60 px-0 py-0 text-rose-100 hover:border-rose-200"
                  aria-label="Kick player"
                  title="Kick player"
                  disabled={reconnectBlocked || player.id === state.hostPlayerId}
                  onClick={() => {
                    setMenuPlayerId(null)
                    void kickParticipant(player.id)
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18" />
                    <path d="M6 6l12 12" />
                  </svg>
                </Button>
              </div>
            )}
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex items-center gap-2">
                <p className="truncate text-sm font-semibold text-white">{player.name}</p>
                {isLocal && (
                  <span className="mono rounded-full border border-cyan-200/80 bg-cyan-300/15 px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100 shadow-[0_0_0_1px_rgba(125,211,252,0.24)]">
                    You
                  </span>
                )}
                {isActive && (
                  <span className="mono rounded-full border border-amber-200/80 bg-amber-200/15 px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200 shadow-[0_0_0_1px_rgba(253,224,71,0.22)]">
                    Active
                  </span>
                )}
              </div>
              <div className="ml-2 flex items-center gap-2">
                <span className="mono rounded-md border border-white/20 px-2 py-1 text-[10px] text-[#c3d7d0]">
                  #{index + 1}
                </span>
              </div>
            </div>
            {!isConnected && (
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-0 rounded-2xl bg-black/75" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="mono rounded-md border border-rose-300/70 bg-rose-200/15 px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-rose-200 shadow-[0_0_0_1px_rgba(252,165,165,0.15)]">
                    Disconnected
                  </span>
                </div>
              </div>
            )}
            <div className="mt-3 flex items-end justify-between gap-3">
              <p className={`mono text-4xl tracking-tight ${lowTime ? 'text-rose-300' : 'text-[#ecf5f1]'} ${isConnected ? '' : 'text-white/60'}`}>
                {formatMs(player.displayMs)}
              </p>
            </div>
            {isHost && (
              <span
                className={`pointer-events-none absolute bottom-2.5 right-3 mono text-sm leading-none ${
                  reconnectBlocked ? 'text-white/25' : 'text-white/40'
                }`}
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </span>
            )}
          </div>
        )
      })}
    </div>
  </article>

  {timeAdjustState && (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-[#041014]/84 p-4 backdrop-blur-sm"
      onClick={() => {
        if (applyingAdjust) {
          return
        }
        setTimeAdjustState(null)
      }}
    >
      <div
        className="panel-strong w-full max-w-md rounded-3xl p-5 shadow-[0_24px_80px_rgba(0,0,0,0.58)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Adjust participant time"
      >
        <p className="mono text-[11px] uppercase tracking-[0.16em] text-amber-200">Adjust Time</p>
        <h3 className="mt-2 text-xl font-semibold text-white">{timeAdjustState.playerName}</h3>

        <div className="mt-4 rounded-xl border border-white/20 bg-black/20 p-3 text-[#d8e8e3]">
          <p className="mono text-[11px] uppercase tracking-[0.14em] text-[#a8c5bc]">Remaining</p>
          <p className="mono mt-1 text-3xl tracking-[0.04em] text-white">{formatMs(timeAdjustState.remainingMs)}</p>
        </div>

        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Adjustment sign">
            <label
              className={`mono inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-xl border px-3 text-sm tracking-[0.06em] transition ${
                timeAdjustState.sign === 1
                  ? 'border-amber-200/80 bg-amber-200/16 text-amber-100'
                  : 'border-white/15 bg-black/15 text-white/35 hover:border-white/25 hover:text-white/50'
              } ${applyingAdjust ? 'pointer-events-none opacity-50' : ''}`}
            >
              <input
                type="radio"
                name="adjust-sign"
                className="sr-only"
                checked={timeAdjustState.sign === 1}
                onChange={() => setTimeAdjustState((current) => (current ? { ...current, sign: 1 } : current))}
                disabled={applyingAdjust}
              />
              +
            </label>
            <label
              className={`mono inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-xl border px-3 text-sm tracking-[0.06em] transition ${
                timeAdjustState.sign === -1
                  ? 'border-amber-200/80 bg-amber-200/16 text-amber-100'
                  : 'border-white/15 bg-black/15 text-white/35 hover:border-white/25 hover:text-white/50'
              } ${applyingAdjust ? 'pointer-events-none opacity-50' : ''}`}
            >
              <input
                type="radio"
                name="adjust-sign"
                className="sr-only"
                checked={timeAdjustState.sign === -1}
                onChange={() => setTimeAdjustState((current) => (current ? { ...current, sign: -1 } : current))}
                disabled={applyingAdjust}
              />
              -
            </label>
          </div>

          <div className="grid grid-cols-[1fr_1fr_1fr_auto_1fr_1fr] items-center gap-2">
            {([
              { key: 'm3', label: 'M3' },
              { key: 'm2', label: 'M2' },
              { key: 'm1', label: 'M1' },
            ] as const).map((digit) => (
              <div key={digit.key} className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  className="mono inline-flex h-6 w-8 items-center justify-center rounded-md border border-white/25 bg-black/20 text-[11px] text-amber-200/80 transition hover:border-amber-200/70 hover:text-amber-100 disabled:opacity-40"
                  onClick={() => updateAdjustDigit(digit.key, 1)}
                  disabled={applyingAdjust}
                  aria-label={`Increase ${digit.label}`}
                >
                  ^
                </button>
                <input
                  value={timeAdjustState[digit.key]}
                  readOnly
                  aria-label={`${digit.label} digit`}
                  className="mono h-14 w-full rounded-xl border border-white/25 bg-black/20 text-center text-3xl tracking-[0.04em] text-white caret-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200/90"
                />
                <button
                  type="button"
                  className="mono inline-flex h-6 w-8 items-center justify-center rounded-md border border-white/25 bg-black/20 text-[11px] text-amber-200/80 transition hover:border-amber-200/70 hover:text-amber-100 disabled:opacity-40"
                  onClick={() => updateAdjustDigit(digit.key, -1)}
                  disabled={applyingAdjust}
                  aria-label={`Decrease ${digit.label}`}
                >
                  v
                </button>
              </div>
            ))}

            <span className="mono text-2xl text-white/60">:</span>

            {([
              { key: 's2', label: 'S2' },
              { key: 's1', label: 'S1' },
            ] as const).map((digit) => (
              <div key={digit.key} className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  className="mono inline-flex h-6 w-8 items-center justify-center rounded-md border border-white/25 bg-black/20 text-[11px] text-amber-200/80 transition hover:border-amber-200/70 hover:text-amber-100 disabled:opacity-40"
                  onClick={() => updateAdjustDigit(digit.key, 1)}
                  disabled={applyingAdjust}
                  aria-label={`Increase ${digit.label}`}
                >
                  ^
                </button>
                <input
                  value={timeAdjustState[digit.key]}
                  readOnly
                  aria-label={`${digit.label} digit`}
                  className="mono h-14 w-full rounded-xl border border-white/25 bg-black/20 text-center text-3xl tracking-[0.04em] text-white caret-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200/90"
                />
                <button
                  type="button"
                  className="mono inline-flex h-6 w-8 items-center justify-center rounded-md border border-white/25 bg-black/20 text-[11px] text-amber-200/80 transition hover:border-amber-200/70 hover:text-amber-100 disabled:opacity-40"
                  onClick={() => updateAdjustDigit(digit.key, -1)}
                  disabled={applyingAdjust}
                  aria-label={`Decrease ${digit.label}`}
                >
                  v
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2">
          <Button
            className="w-full border-white/25 bg-transparent"
            onClick={() => setTimeAdjustState(null)}
            disabled={applyingAdjust}
          >
            Cancel
          </Button>
          <Button
            className="w-full border-emerald-200/70 text-emerald-100"
            disabled={!canApplyDelta}
            onClick={() => {
              if (!timeAdjustState || !canApplyDelta) {
                return
              }
              setLastAppliedAdjustPreset({
                sign: timeAdjustState.sign,
                m3: timeAdjustState.m3,
                m2: timeAdjustState.m2,
                m1: timeAdjustState.m1,
                s2: timeAdjustState.s2,
                s1: timeAdjustState.s1,
              })
              setApplyingAdjust(true)
              void adjustParticipantTime(timeAdjustState.playerId, deltaMs)
                .then(() => setTimeAdjustState(null))
                .finally(() => setApplyingAdjust(false))
            }}
          >
            Apply
          </Button>
        </div>
      </div>
    </div>
  )}
  </>
  )
}
