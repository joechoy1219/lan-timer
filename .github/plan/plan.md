## Plan: Backendless LAN Turn Timer (2-8 Players)

Build a React + TypeScript + Vite frontend-only LAN turn timer using WebRTC DataChannel and host-authoritative synchronization. Focus on deterministic state transitions, anti-conflict sequencing, room password gating, host moderation controls, and robust persistence via IndexedDB for refresh recovery.

**Steps**
1. Phase 1 - Foundation and contracts: initialize React + TS + Tailwind app, define domain models and message protocol (room, player, timer, control events, sequence number, timestamps, signatures), and define reducer-style state transition rules as single source of truth.
2. Phase 1 - Authority model and invariants (*depends on 1*): enforce host-authoritative actions for start/pause/reset/switch/global-pause/kick/set-initial-time; peers can only request actions; host validates and commits.
3. Phase 2 - Realtime transport layer (*depends on 1*): implement WebRTC DataChannel session manager (join/leave/reconnect), heartbeat, ordered patch broadcast, stale message rejection, idempotent replay handling.
4. Phase 2 - Room security and access (*parallel with 3 after 1*): implement room creation with password-derived key, join verification, signed control messages (HMAC over payload + seq + timestamp) to reduce spoof/replay risk on LAN.
5. Phase 3 - Timer engine (*depends on 2 and 3*): implement monotonic time accounting based on host epoch + accumulated elapsed model; enforce exactly one active player timer; handle switch logic for 2-8 players and global pause.
6. Phase 3 - Persistence and recovery (*depends on 3 and 5*): persist snapshots to IndexedDB (room, players, timer state, host id, seq), restore on refresh, then fast-resync from host with conflict resolution strategy.
7. Phase 4 - UI and UX (*depends on 5*): implement room lobby, player list/status, active-turn highlight, per-player timer cards, host control panel, optimistic pending indicators, and premium visual design (intentional typography, layered background, restrained motion, responsive mobile/desktop).
8. Phase 4 - Host moderation and participant features (*depends on 7*): implement rename-self, kick-user, lock controls by role, participant state visibility, and clear error/retry messaging for network instability.
9. Phase 5 - Reliability hardening (*depends on 3-8*): add reconnect flow, host migration policy (deterministic successor), anti-duplication guards, and rate-limited broadcasts.
10. Phase 5 - Testing and acceptance (*depends on all prior*): unit-test reducer/timer invariants; integration-test protocol handlers; multi-tab/manual LAN test matrix for 2/4/8 players, rapid concurrent actions, refresh restore, and host disconnect/failover.

**Relevant files**
- d:/dev/React/lan-timer/.github/skills/premium-frontend-ui/SKILL.md - visual and motion quality baseline to follow while implementing UI.
- d:/dev/React/lan-timer (workspace root) - new application scaffold and source tree should be created here.
- /memories/session/lan-timer-exploration.md - discovery constraints, risks, and recommended architecture reference.

**Verification**
1. Multi-client deterministic sync: with 2, 4, and 8 clients on same LAN, at any point exactly one player timer is running, and state convergence occurs within acceptable drift budget.
2. Security checks: wrong password cannot join; unsigned or stale sequence messages are rejected.
3. Concurrency checks: simultaneous start/switch/pause requests from different peers resolve to one authoritative ordered outcome.
4. Persistence checks: reload any peer and recover UI state, then reconcile with host snapshot without timer jump artifacts.
5. Moderation checks: host can kick, set initial time, global pause/resume; non-host cannot execute restricted actions.
6. Failure checks: host disconnect triggers successor election and continued timing without duplicate active timers.

**Decisions**
- Confirmed stack: React + TypeScript + Vite + Tailwind.
- Confirmed realtime: WebRTC DataChannel.
- Confirmed authority: host-authoritative control model.
- Confirmed scope: full 2-8 player feature set including host moderation controls.
- Included scope: frontend-only app, LAN synchronization, room password, refresh persistence, role-based controls.
- Excluded scope: backend account system, cloud persistence across devices, end-to-end cryptographic identity infrastructure.

**Further Considerations**
1. Signaling bootstrap for WebRTC still needs a practical path (manual offer/answer exchange vs lightweight temporary signaling service) and should be chosen before implementation starts.
2. Drift budget should be explicitly set (for example, soft warning above 120ms, forced resync above 300ms).
3. Host migration policy should be deterministic (stable ordering by join index + peer id) to avoid split-brain.

## Implementation Prompt (for coding agent)
You are implementing a frontend-only LAN turn-based multiplayer timer application.

Objective
- Build a production-ready web app for 2-8 players where only one player's timer can run at any moment.
- When one player's timer starts, all others pause.
- Support use cases like Go/chess/debate/tabletop turns.

Tech and constraints
- Use React + TypeScript + Vite + Tailwind.
- Use WebRTC DataChannel for realtime sync.
- No backend application server for room state.
- Persist room/timer state locally with IndexedDB for refresh recovery.

Core requirements
- Room system with password: host creates room + password; only users with password can join.
- Role model: host vs participant.
- Host permissions: kick user, global pause/resume, set initial time.
- Participant permissions: rename self, request timer actions.
- Visibility: all users can see every participant name and timer status.
- Capacity: 2-8 players.

Synchronization rules
- Host-authoritative state machine: only host commits state transitions.
- All actions carry sequence number and timestamp.
- Reject stale/out-of-order messages.
- Enforce invariant: exactly one active timer (or all paused during global pause).
- Include heartbeat + periodic full snapshot sync.

Timer logic
- Use monotonic clock-based elapsed calculation (avoid setInterval drift accumulation).
- Deterministic turn switch behavior.
- Reset and initial-time updates must remain consistent across peers.

Reliability and recovery
- Reconnect flow for temporary disconnects.
- Deterministic host migration when host leaves unexpectedly.
- Snapshot persistence in IndexedDB and restore on reload followed by host reconciliation.

UI/UX
- Build clear lobby + in-room dashboard + host control panel.
- Show active player emphasis and per-player timer cards.
- Provide explicit connection/sync status indicators.
- Follow premium-frontend-ui quality bar: intentional visual identity, expressive typography, layered background, restrained meaningful motion, responsive desktop/mobile.
- Respect prefers-reduced-motion for accessibility.

Testing and acceptance
- Add unit tests for reducer/timer invariants.
- Add integration tests for protocol ordering and message validation.
- Provide manual LAN test checklist for 2/4/8 players including concurrent actions, refresh restore, wrong password, host disconnect failover.

Output expectations
- Scaffold project and implement feature-complete MVP for the above scope.
- Keep architecture modular: domain state machine, transport, persistence, UI separated.
- Include concise README with run instructions and LAN testing steps.
