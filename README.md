# LAN Turn Timer

Frontend-only LAN turn-based timer for 2-8 players.

## Features

- Host-authoritative timer state with sequence-based synchronization.
- WebRTC DataChannel transport with PeerJS.
- Room password check on join.
- Host controls: kick player, global pause/resume, set initial time.
- Participant controls: request start/switch/pause/reset actions.
- IndexedDB snapshot persistence for reload recovery.

## Stack

- React 19 + TypeScript + Vite
- Tailwind CSS v4 + custom premium UI styling
- Zustand for local state
- PeerJS for WebRTC data channel
- idb for IndexedDB

## Run

```bash
npm install
npm run dev -- --host
```

Open the app on two or more devices in the same LAN.

## How To Use

1. Host creates room with name, password, and initial minutes.
2. Host shares room ID and host peer ID.
3. Participants enter room ID, host peer ID, password, and name to join.
4. Start, switch, or pause from any client. Host commits and broadcasts authoritative state.

## Manual LAN Test Checklist

1. Create one room and join with at least 2 participants.
2. Verify only one timer can be active.
3. Trigger simultaneous actions from two clients and confirm state converges.
4. Validate wrong password is rejected.
5. Host triggers global pause/resume and all clients reflect it.
6. Host changes initial minutes and timers reset consistently.
7. Host kicks a participant and kicked user can no longer control room.
8. Refresh a tab and verify state recovers from snapshot.

## Notes

- This build uses PeerJS default signaling behavior for connection bootstrap.
- Current failover behavior is minimal. Deterministic host migration is the next reliability milestone.