import { formatMs } from '../../domain/timerEngine'
import type { ControlActionType, RoomState } from '../../domain/types'
import { Button } from '../ui/Button'

interface LivePlayerView {
  id: string
  name: string
  connected: boolean
  displayMs: number
}

interface TurnContext {
  previousPlayerId: string | null
  currentPlayerId: string | null
  nextPlayerId: string | null
}

interface ParticipantTurnViewProps {
  state: RoomState
  orderedPlayers: LivePlayerView[]
  turnContext: TurnContext
  myTurn: boolean
  reconnectBlocked: boolean
  sendControl: (action: ControlActionType, payload?: Record<string, unknown>) => Promise<void>
}

const resolvePlayer = (players: LivePlayerView[], playerId: string | null) =>
  players.find((player) => player.id === playerId) ?? null

export const ParticipantTurnView = ({
  state,
  orderedPlayers,
  turnContext,
  myTurn,
  reconnectBlocked,
  sendControl,
}: ParticipantTurnViewProps) => {
  const me = resolvePlayer(orderedPlayers, state.localPlayerId)
  const previous = resolvePlayer(orderedPlayers, turnContext.previousPlayerId)
  const current = resolvePlayer(orderedPlayers, turnContext.currentPlayerId)
  const next = resolvePlayer(orderedPlayers, turnContext.nextPlayerId)

  return (
    <article className="panel-strong reveal overflow-hidden rounded-2xl p-5 md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="mono text-xs uppercase tracking-[0.16em] text-emerald-200">
          Participant View
        </p>
        <span className="mono rounded-full border border-white/25 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-amber-200">
          {state.phase}
        </span>
      </div>

      <div className="rounded-2xl border border-emerald-200/35 bg-gradient-to-br from-emerald-200/15 via-cyan-200/10 to-transparent p-4 md:p-6">
        <p className="mono text-[11px] uppercase tracking-[0.14em] text-[#d2ece3]">Active Player</p>
        <h2 className="mt-2 text-2xl font-semibold text-white md:text-3xl">
          {current?.name ?? '-'}
          {current?.id === state.localPlayerId ? ' (You)' : ''}
        </h2>
        <p className="mono mt-3 text-5xl tracking-tight text-[#f2f8f6] md:text-7xl">
          {current ? formatMs(current.displayMs) : '--:--'}
        </p>
        <p className="mt-3 text-sm text-[#cbe5dd]">
          {myTurn
            ? 'It is your turn. Tap the action button when your move is complete.'
            : `${current?.name ?? 'Current player'} is playing. Prepare your move.`}
        </p>

        {myTurn && (
          <Button
            className="mt-5 hidden w-full border-emerald-100/70 bg-emerald-200/20 py-4 text-sm md:block"
            disabled={reconnectBlocked || state.globalPaused}
            onClick={() => void sendControl('END_TURN')}
          >
            End My Turn
          </Button>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-white/20 bg-black/20 p-3">
          <p className="mono text-[11px] uppercase tracking-[0.12em] text-[#b8d6cd]">Previous</p>
          <p className="mt-1 text-sm font-medium text-white">{previous?.name ?? '-'}</p>
          <p className="mono mt-1 text-base text-[#deece8]">{previous ? formatMs(previous.displayMs) : '--:--'}</p>
        </div>
        <div className="rounded-xl border border-white/20 bg-black/20 p-3">
          <p className="mono text-[11px] uppercase tracking-[0.12em] text-[#b8d6cd]">Next</p>
          <p className="mt-1 text-sm font-medium text-white">{next?.name ?? '-'}</p>
          <p className="mono mt-1 text-base text-[#deece8]">{next ? formatMs(next.displayMs) : '--:--'}</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-white/20 bg-black/20 p-3">
        <p className="mono text-[11px] uppercase tracking-[0.12em] text-[#b8d6cd]">Your Clock</p>
        <p className="mono mt-2 text-3xl text-[#f2f8f6]">{me ? formatMs(me.displayMs) : '--:--'}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {orderedPlayers.map((player) => (
            <span
              key={player.id}
              className={`mono rounded-md border px-2 py-1 text-[10px] uppercase tracking-[0.1em] ${
                player.id === state.activePlayerId
                  ? 'border-amber-300/70 bg-amber-200/15 text-amber-100'
                  : player.id === state.localPlayerId
                    ? 'border-emerald-300/60 bg-emerald-200/10 text-emerald-100'
                    : 'border-white/20 bg-white/5 text-[#c7ddd6]'
              }`}
            >
              {player.name}
            </span>
          ))}
        </div>
      </div>
    </article>
  )
}
