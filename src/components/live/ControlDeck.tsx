import { QRCodeSVG } from 'qrcode.react'
import type { ControlActionType } from '../../domain/types'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'

interface ControlDeckProps {
  isHost: boolean
  participantMode?: boolean
  showShareSection?: boolean
  inModal?: boolean
  statusText: string
  reconnectBlocked: boolean
  hostReconnectDeadlineAt: number | null
  hostReconnectSecondsLeft: number
  pendingInitialMinutes: number
  setPendingInitialMinutes: (value: number) => void
  copiedShare: 'code' | 'link' | null
  hostJoinCode: string
  hostShareLink: string
  sendControl: (action: ControlActionType, payload?: Record<string, unknown>) => Promise<void>
  copyToClipboard: (value: string, mode: 'code' | 'link') => Promise<void>
}

export const ControlDeck = ({
  isHost,
  participantMode = false,
  showShareSection = true,
  inModal = false,
  statusText,
  reconnectBlocked,
  hostReconnectDeadlineAt,
  hostReconnectSecondsLeft,
  pendingInitialMinutes,
  setPendingInitialMinutes,
  copiedShare,
  hostJoinCode,
  hostShareLink,
  sendControl,
  copyToClipboard,
}: ControlDeckProps) => (
  <aside className={inModal ? '' : 'panel reveal rounded-2xl p-5 [animation-delay:80ms]'}>
    {isHost && showShareSection && (
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

    {!inModal && <h3 className="text-xl font-semibold">Room Settings</h3>}
    {!inModal && <p className="mono mt-1 text-xs text-[#b7d1c9]">{statusText}</p>}
    {hostReconnectDeadlineAt && (
      <p className="mono mt-2 rounded-md border border-amber-300/60 bg-amber-200/10 px-2 py-1 text-xs text-amber-200">
        Waiting host reconnect: {hostReconnectSecondsLeft}s
      </p>
    )}

    {participantMode && (
      <div className="mt-4 rounded-xl border border-cyan-200/35 bg-cyan-200/10 p-3 text-sm text-[#dcf4ee]">
        Keep this panel open while playing. Use the main screen "End My Turn" action after finishing your move.
        If host is reconnecting, controls will lock automatically to prevent timer divergence.
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

  </aside>
)
