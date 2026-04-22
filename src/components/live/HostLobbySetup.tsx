import type { ControlActionType, RoomState } from '../../domain/types'
import { formatMs } from '../../domain/timerEngine'
import { QRCodeSVG } from 'qrcode.react'
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
  moveTurnOrder: (playerId: string, direction: -1 | 1) => Promise<void>
  copyToClipboard: (value: string, mode: 'code' | 'link') => Promise<void>
}

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
  moveTurnOrder,
  copyToClipboard,
}: HostLobbySetupProps) => (
  <section className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
    <article className="panel-strong reveal rounded-2xl p-5 md:p-6">
      <p className="mono text-[11px] uppercase tracking-[0.16em] text-amber-200">Host Lobby Setup</p>
      <h2 className="mt-2 text-2xl font-semibold text-white md:text-3xl">{state.roomName}</h2>
      <p className="mono mt-2 text-xs text-[#b8d6cd]">
        Arrange player turn order before starting the first round.
      </p>

      <div className="mt-5 space-y-3">
        {orderedPlayers.map((player, index) => (
          <div
            key={player.id}
            className="rounded-xl border border-white/20 bg-black/20 px-3 py-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-white">
                  #{index + 1} {player.name}
                  {player.id === state.localPlayerId ? ' (You)' : ''}
                </p>
                <p className="mono mt-1 text-xs text-[#bdd8d0]">{formatMs(player.displayMs)}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  className="px-2 py-1 text-[10px]"
                  disabled={reconnectBlocked || index === 0}
                  onClick={() => void moveTurnOrder(player.id, -1)}
                >
                  Up
                </Button>
                <Button
                  className="px-2 py-1 text-[10px]"
                  disabled={reconnectBlocked || index === orderedPlayers.length - 1}
                  onClick={() => void moveTurnOrder(player.id, 1)}
                >
                  Down
                </Button>
                {player.id !== state.hostPlayerId && (
                  <Button
                    className="px-2 py-1 text-[10px] border-rose-200/60 text-rose-100"
                    disabled={reconnectBlocked}
                    onClick={() => void sendControl('KICK_PLAYER', { targetId: player.id })}
                  >
                    Kick
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </article>

    <article className="panel reveal rounded-2xl p-5 md:p-6 [animation-delay:80ms]">
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
      </div>

      <p className="mono text-[11px] uppercase tracking-[0.16em] text-emerald-200">Round Settings</p>
      <h3 className="mt-2 text-xl font-semibold text-white">Initial Time</h3>
      <p className="mt-2 text-sm text-[#cadfd9]">
        Set each player clock before opening the match.
      </p>

      <div className="mt-4 flex gap-2">
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

      <div className="mt-4 rounded-xl border border-white/20 bg-black/20 p-3 text-xs text-[#d3e3de]">
        <p className="mono">Players ready: {orderedPlayers.length}</p>
        <p className="mono mt-1">Current order head: {orderedPlayers[0]?.name ?? '-'}</p>
      </div>

      <Button
        className="mt-5 w-full border-emerald-200/75 bg-emerald-200/20 py-4 text-sm"
        disabled={reconnectBlocked || orderedPlayers.length < 1}
        onClick={() => void sendControl('START_ROUND')}
      >
        Start Round
      </Button>
    </article>
  </section>
)
