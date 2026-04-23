import { formatMs } from '../../domain/timerEngine'
import type { ControlActionType, RoomState } from '../../domain/types'
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
  sendControl: (action: ControlActionType, payload?: Record<string, unknown>) => Promise<void>
  moveTurnOrder: (playerId: string, direction: -1 | 1) => Promise<void>
}

export const PlayersPanel = ({
  state,
  isHost,
  reconnectBlocked,
  orderedPlayers,
  sendControl,
  moveTurnOrder,
}: PlayersPanelProps) => (
  <article className="panel-strong reveal rounded-2xl p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className="text-2xl font-semibold">{state.roomName}</h2>
        <p className="mono mt-1 text-xs text-[#b7d1c9]">
          Join Code {state.roomId} | Host Peer {state.hostPeerId}
        </p>
      </div>
      <div className="flex gap-2">
        <span className="mono rounded-full border border-white/25 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-amber-200">
          {state.role}
        </span>
        <span className="mono rounded-full border border-white/25 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-emerald-200">
          {state.globalPaused ? 'global paused' : state.phase}
        </span>
      </div>
    </div>

    <div className="mt-4 grid gap-3 md:grid-cols-2">
      {orderedPlayers.map((player, index) => {
        const isActive = state.activePlayerId === player.id
        const isLocal = state.localPlayerId === player.id
        const isConnected = player.connected
        const lowTime = player.displayMs < 30_000

        return (
          <div
            key={player.id}
            className={`rounded-2xl border p-4 transition ${
              isActive
                ? 'border-amber-300 bg-amber-100/10 shadow-[var(--glow)]'
                : 'border-white/15 bg-white/5'
            } ${
              isConnected
                ? 'opacity-100'
                : 'border-rose-300/40 bg-rose-200/5 opacity-70 saturate-50'
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">
                {player.name}
                {isLocal ? ' (You)' : ''}
              </p>
              <span className="mono rounded-md border border-white/20 px-2 py-1 text-[10px] text-[#c3d7d0]">
                #{index + 1}
              </span>
              {!isConnected && (
                <span className="mono rounded-md border border-rose-300/60 bg-rose-200/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-rose-200">
                  Disconnected
                </span>
              )}
            </div>
            <p className={`mono mt-3 text-4xl tracking-tight ${lowTime ? 'text-rose-300' : 'text-[#ecf5f1]'} ${isConnected ? '' : 'text-white/60'}`}>
              {formatMs(player.displayMs)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {isHost && (
                <>
                  <Button
                    className="px-2 py-1 text-[10px]"
                    disabled={reconnectBlocked || index === 0}
                    onClick={() => void moveTurnOrder(player.id, -1)}
                  >
                    Move Up
                  </Button>
                  <Button
                    className="px-2 py-1 text-[10px]"
                    disabled={reconnectBlocked || index === orderedPlayers.length - 1}
                    onClick={() => void moveTurnOrder(player.id, 1)}
                  >
                    Move Down
                  </Button>
                  <Button
                    className="px-2 py-1 text-[10px]"
                    disabled={reconnectBlocked || !isConnected}
                    onClick={() => void sendControl('SWITCH_ACTIVE', { nextPlayerId: player.id })}
                  >
                    Set Active
                  </Button>
                </>
              )}
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
)
