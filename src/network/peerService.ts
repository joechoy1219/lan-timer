import Peer, { type DataConnection } from 'peerjs'
import type { NetworkMessage } from '../domain/types'

type MessageHandler = (message: NetworkMessage, senderPeerId?: string) => void
type StatusHandler = (value: string) => void

export class PeerRoomService {
  private peer: Peer | null = null

  private hostConnection: DataConnection | null = null

  private peers = new Map<string, DataConnection>()

  private onMessage: MessageHandler | null = null

  private onStatus: StatusHandler | null = null

  private isHost = false

  private bindConnection(connection: DataConnection) {
    connection.on('data', (raw) => {
      if (typeof raw !== 'string') {
        return
      }
      try {
        const parsed = JSON.parse(raw) as NetworkMessage
        this.onMessage?.(parsed, connection.peer)
      } catch {
        this.onStatus?.('Malformed message received.')
      }
    })

    connection.on('close', () => {
      if (this.isHost && this.peers.has(connection.peer)) {
        this.onMessage?.(
          {
            type: 'PEER_LEFT_LOCAL',
            peerId: connection.peer,
            sentAt: Date.now(),
          },
          connection.peer,
        )
      }
      this.peers.delete(connection.peer)
      if (this.hostConnection?.peer === connection.peer) {
        this.hostConnection = null
        this.onStatus?.('Host connection closed.')
      }
    })

    connection.on('error', () => {
      if (this.hostConnection?.peer === connection.peer) {
        this.onStatus?.('Disconnected from host.')
      }
    })
  }

  private static send(connection: DataConnection, message: NetworkMessage) {
    if (!connection.open) {
      return
    }
    connection.send(JSON.stringify(message))
  }

  public createHost(peerId: string, onMessage: MessageHandler, onStatus: StatusHandler) {
    this.cleanup()
    this.isHost = true
    this.onMessage = onMessage
    this.onStatus = onStatus
    this.peer = new Peer(peerId)

    this.peer.on('open', () => this.onStatus?.(`Host ready as ${peerId}`))
    this.peer.on('connection', (connection) => {
      this.peers.set(connection.peer, connection)
      this.bindConnection(connection)
    })
    this.peer.on('error', (error) => this.onStatus?.(error.message))
  }

  public joinHost(
    localPeerId: string,
    hostPeerId: string,
    onMessage: MessageHandler,
    onStatus: StatusHandler,
  ) {
    this.cleanup()
    this.isHost = false
    this.onMessage = onMessage
    this.onStatus = onStatus
    this.peer = new Peer(localPeerId)

    this.peer.on('open', () => {
      if (!this.peer) {
        return
      }

      this.hostConnection = this.peer.connect(hostPeerId, {
        reliable: true,
      })

      if (!this.hostConnection) {
        return
      }

      this.bindConnection(this.hostConnection)
      this.hostConnection.on('open', () => this.onStatus?.('Connected to host.'))
    })

    this.peer.on('error', (error) => this.onStatus?.(error.message))
  }

  public sendToHost(message: NetworkMessage) {
    if (!this.hostConnection) {
      return
    }
    PeerRoomService.send(this.hostConnection, message)
  }

  public broadcast(message: NetworkMessage) {
    if (!this.isHost) {
      return
    }
    this.peers.forEach((connection) => PeerRoomService.send(connection, message))
  }

  public sendToPeer(peerId: string, message: NetworkMessage) {
    const connection = this.peers.get(peerId)
    if (!connection) {
      return
    }
    PeerRoomService.send(connection, message)
  }

  public cleanup() {
    this.hostConnection?.close()
    this.hostConnection = null
    this.peers.forEach((connection) => connection.close())
    this.peers.clear()
    this.peer?.destroy()
    this.peer = null
  }
}
