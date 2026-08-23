import { describe, expect, it } from 'vitest'
import {
  cloudAccountSessionSchema,
  cloudAuthResponseSchema,
  cloudCredentialsSchema,
} from './cloudAccount'

const session = {
  expiresAt: '2026-09-20T08:00:00+00:00',
  user: {
    id: 'user-1',
    email: 'learner@example.com',
    emailVerified: true,
    createdAt: '2026-08-21T08:00:00+00:00',
  },
}

describe('cloud account schemas', () => {
  it('accepts the backend auth and session contracts', () => {
    expect(cloudAccountSessionSchema.parse(session)).toEqual(session)
    expect(cloudAuthResponseSchema.parse({
      ...session,
      accessToken: 'a'.repeat(43),
      tokenType: 'Bearer',
    })).toMatchObject(session)
  })

  it('rejects malformed credentials and response dates', () => {
    expect(cloudCredentialsSchema.safeParse({
      email: 'not-an-email',
      password: '12345678',
    }).success).toBe(false)
    expect(cloudAccountSessionSchema.safeParse({
      ...session,
      expiresAt: 'tomorrow',
    }).success).toBe(false)
  })
})
