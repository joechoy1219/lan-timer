import { QRCodeSVG } from 'qrcode.react'
import type { ControlActionType, RoomState } from '../../domain/types'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'

interface LivePlayerView {
  id: string
  name: string
}

interface TurnContext {
  previousPlayerId: string | null
  currentPlayerId: string | null
  nextPlayerId: string | null
}

interface ControlDeckProps {
  state: RoomState
  isHost: boolean
  participantMode?: boolean
  statusText: string
  reconnectBlocked: boolean
  hostReconnectDeadlineAt: number | null
  hostReconnectSecondsLeft: number
  myTurn: boolean
  pendingInitialMinutes: number
  setPendingInitialMinutes: (value: number) => void
  peerConnected: boolean
  localPeerId: string
  copiedShare: 'code' | 'link' | null
  hostJoinCode: string
  hostShareLink: string
  players: LivePlayerView[]
  turnContext: TurnContext
  sendControl: (action: ControlActionType, payload?: Record<string, unknown>) => Promise<void>
  copyToClipboard: (value: string, mode: 'code' | 'link') => Promise<void>
  handleLeaveRoom: () => void
}

const resolvePlayerName = (players: LivePlayerView[], playerId: string | null) =>
  players.find((player) => player.id === playerId)?.name ?? '-'

const formatEventTime = (at: number) => {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
}

export const ControlDeck = ({
  state,
  isHost,
  participantMode = false,
  statusText,
  reconnectBlocked,
  hostReconnectDeadlineAt,
  hostReconnectSecondsLeft,
  myTurn,
  pendingInitialMinutes,
  setPendingInitialMinutes,
  peerConnected,
  localPeerId,
  copiedShare,
  hostJoinCode,
  hostShareLink,
  players,
  turnContext,
  sendControl,
  copyToClipboard,
  handleLeaveRoom,
}: ControlDeckProps) => (
  <aside className="panel reveal rounded-2xl p-5 [animation-delay:80ms]">
    {isHost && (
      <div className="mb-4 rounded-2xl border border-emerald-200/30 bg-emerald-200/10 p-4">
        <p className="mono text-[11px] uppercase tracking-[0.16em] text-emerald-100">Share Room</p>
        <p className="mono mt-2 text-3xl tracking-[0.08em] text-white">{hostJoinCode}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            className="border-emerald-200/60 bg-emerald-200/15"
            onClick={() => void copyToClipboard(hostJoinCode, 'code')}
          >
            {copiedShare === 'code' ? 'Code Copied' : 'Copy Code'}
          </Button>
          <Button
            className="border-emerald-200/60 bg-emerald-200/15"
            onClick={() => void copyToClipboard(hostShareLink, 'link')}
          >
            {copiedShare === 'link' ? 'Link Copied' : 'Copy Invite Link'}
          </Button>
        </div>
        <div className="mt-4 inline-flex rounded-2xl border border-white/20 bg-white p-3">
          <QRCodeSVG
            value={hostShareLink || hostJoinCode}
            size={124}
            bgColor="transparent"
            fgColor="#0f172a"
            title="Scan to join room"
          />
        </div>
        <p className="mono mt-2 text-[11px] uppercase tracking-[0.12em] text-[#d2e4de]">
          Scan QR to open join link with code prefilled.
        </p>
      </div>
    )}

    <h3 className="text-xl font-semibold">Control Deck</h3>
    <p className="mono mt-1 text-xs text-[#b7d1c9]">{statusText}</p>
    <div className="mt-3 rounded-xl border border-white/20 bg-black/20 p-3 text-xs text-[#d3e3de]">
      <p className="mono">Round: {state.round}</p>
      <p className="mono mt-1">Phase: {state.phase}</p>
      <p className="mono mt-1">Previous: {resolvePlayerName(players, turnContext.previousPlayerId)}</p>
      <p className="mono mt-1">Current: {resolvePlayerName(players, turnContext.currentPlayerId)}</p>
      <p className="mono mt-1">Next: {resolvePlayerName(players, turnContext.nextPlayerId)}</p>
    </div>
    {hostReconnectDeadlineAt && (
      <p className="mono mt-2 rounded-md border border-amber-300/60 bg-amber-200/10 px-2 py-1 text-xs text-amber-200">
        Waiting host reconnect: {hostReconnectSecondsLeft}s
      </p>
    )}

    {myTurn && (
      <Button
        className="mt-4 w-full border-emerald-200/70 bg-emerald-200/20 py-4 text-sm"
        disabled={reconnectBlocked || state.globalPaused}
        onClick={() => void sendControl('END_TURN')}
      >
        End My Turn
      </Button>
    )}

    {participantMode && (
      <div className="mt-4 rounded-xl border border-cyan-200/35 bg-cyan-200/10 p-3 text-sm text-[#dcf4ee]">
        Keep this panel open and tap "End My Turn" after finishing your move. If host is reconnecting,
        controls will lock automatically to prevent timer divergence.
      </div>
    )}

    {!participantMode && (
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button
          disabled={reconnectBlocked || !isHost || state.turnOrder.length < 1}
          onClick={() => void sendControl('START_ROUND')}
        >
          Start Round
        </Button>
        <Button
          disabled={reconnectBlocked || !isHost || state.phase === 'lobby'}
          onClick={() => void sendControl('FORCE_NEXT')}
        >
          Force Next
        </Button>
        <Button disabled={reconnectBlocked || !isHost} onClick={() => void sendControl('PAUSE_TIMER')}>Pause</Button>
        <Button disabled={reconnectBlocked || !isHost} onClick={() => void sendControl('RESET_ALL')}>Reset All</Button>
        <Button disabled={reconnectBlocked || !isHost} onClick={() => void sendControl('GLOBAL_PAUSE')}>Global Pause</Button>
        <Button disabled={reconnectBlocked || !isHost} onClick={() => void sendControl('GLOBAL_RESUME')}>Global Resume</Button>
      </div>
    )}

    {isHost && !participantMode && (
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

    <div className="mt-4 rounded-xl border border-white/20 bg-black/20 p-3">
      <p className="mono text-[11px] uppercase tracking-[0.12em] text-[#bad7cf]">Recent Events</p>
      <ul
        className="mt-2 max-h-56 space-y-2 overflow-y-auto pr-1"
        role="log"
        aria-live="polite"
        aria-label="Room timeline events"
      >
        {state.timeline.slice(0, 8).map((event) => (
          <li key={event.id} className="rounded-lg border border-white/10 bg-white/5 px-2 py-2">
            <p className="text-xs text-[#dfece8]">{event.message}</p>
            <p className="mono mt-1 text-[10px] text-[#9fc0b7]">{formatEventTime(event.at)}</p>
          </li>
        ))}
        {state.timeline.length === 0 && (
          <li className="mono text-[11px] text-[#9fc0b7]">No events yet.</li>
        )}
      </ul>
    </div>

    <Button
      className="mt-4 w-full border-rose-200/60 text-rose-100 hover:border-rose-200"
      onClick={handleLeaveRoom}
    >
      Leave Room
    </Button>
  </aside>
)
