import { openDB } from 'idb'
import type { PersistedSnapshot } from '../domain/types'

const DB_NAME = 'lan-timer-db'
const STORE_NAME = 'snapshots'

const dbPromise = openDB(DB_NAME, 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME, { keyPath: 'roomId' })
    }
  },
})

export const saveSnapshot = async (snapshot: PersistedSnapshot) => {
  const db = await dbPromise
  await db.put(STORE_NAME, snapshot)
}

export const loadSnapshot = async (roomId: string): Promise<PersistedSnapshot | null> => {
  const db = await dbPromise
  return (await db.get(STORE_NAME, roomId)) ?? null
}
