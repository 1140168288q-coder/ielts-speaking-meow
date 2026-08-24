import { describe, expect, it } from 'vitest'
import {
  backendConfigSchema,
  isPrivateLanHost,
  isSafeBackendBaseUrl,
  normalizeBackendBaseUrl,
} from './backendConfig'

describe('backendConfig', () => {
  it('normalizes only the service root and optional health suffix', () => {
    expect(normalizeBackendBaseUrl(' https://api.example.com/health/ ')).toBe(
      'https://api.example.com',
    )
    expect(normalizeBackendBaseUrl('https://api.example.com/')).toBe(
      'https://api.example.com',
    )
    expect(normalizeBackendBaseUrl('https://api.example.com/v1')).toBe(
      'https://api.example.com/v1',
    )
  })

  it('recognizes complete private addresses without prefix spoofing', () => {
    expect(isPrivateLanHost('192.168.1.20')).toBe(true)
    expect(isPrivateLanHost('172.31.255.2')).toBe(true)
    expect(isPrivateLanHost('10.0.2.2')).toBe(true)
    expect(isPrivateLanHost('192.168.1.20.example.com')).toBe(false)
    expect(isPrivateLanHost('172.32.0.1')).toBe(false)
    expect(isPrivateLanHost('999.168.1.1')).toBe(false)
  })

  it('requires HTTPS for public hosts and rejects URL smuggling fields', () => {
    expect(isSafeBackendBaseUrl('https://api.example.com')).toBe(true)
    expect(isSafeBackendBaseUrl('http://api.example.com')).toBe(false)
    expect(isSafeBackendBaseUrl('http://192.168.1.20:8000')).toBe(true)
    expect(isSafeBackendBaseUrl('https://user:pass@api.example.com')).toBe(false)
    expect(isSafeBackendBaseUrl('https://api.example.com?token=secret')).toBe(false)
    expect(isSafeBackendBaseUrl('https://api.example.com/v1')).toBe(false)
  })

  it('normalizes and validates through the persisted config schema', () => {
    const parsed = backendConfigSchema.parse({
      id: 'backend',
      baseUrl: 'https://api.example.com/health',
      updatedAt: '2026-08-24T08:00:00.000Z',
    })
    expect(parsed.baseUrl).toBe('https://api.example.com')
  })
})
