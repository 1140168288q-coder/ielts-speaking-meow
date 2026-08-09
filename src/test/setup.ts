import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { Blob as NodeBlob } from 'node:buffer'

// jsdom's legacy Blob lacks text()/arrayBuffer(), while Android WebView and
// modern browsers provide the standard Blob API used by recording storage.
Object.defineProperty(globalThis, 'Blob', {
  configurable: true,
  writable: true,
  value: NodeBlob,
})
