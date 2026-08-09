import type { AiFeedback, Question } from '../../domain'
import { analyzeSpeech } from '../../domain/speechAnalysis'
import {
  createConfiguredApiHarness,
  sttConfiguration,
  textConfiguration,
} from '../../test/fixtures/apiHarness'
import {
  createApiTransportFake,
  response,
} from '../../test/fixtures/apiTransportFake'
import { OpenAICompatibleSttProvider } from './openAiCompatibleSttProvider'
import { OpenAICompatibleTextProvider } from './openAiCompatibleTextProvider'

const question: Question = {
  id: 'p1-home-001',
  part: 1,
  topic: 'Home',
  prompt: 'What do you like about your home?',
}

const feedback: AiFeedback = {
  keyIssues: [
    {
      category: 'fluency',
      kind: 'focus',
      title: 'Pause instead of filling',
      observation: 'The answer starts with a filler.',
      action: 'Use one short silent pause before the main idea.',
      evidence: 'um',
    },
  ],
  secondAttemptTips: ['Pause once before giving the reason.'],
  revisions: {
    minimalFix: 'I enjoy reading at home.',
    naturalVersion: null,
    stretchVersion: null,
  },
}

const feedbackRequest = {
  question,
  transcript: 'Um I I enjoy reading at home.',
  metrics: analyzeSpeech({
    transcript: 'Um I I enjoy reading at home.',
    durationMs: 30_000,
  }),
}

const recordedAudioRequest = {
  audio: new Blob(['original recording'], { type: 'audio/webm' }),
  mimeType: 'audio/webm',
  fileName: 'attempt-one.webm',
  language: 'en',
}

describe('OpenAICompatibleTextProvider', () => {
  it('returns validated feedback and uses only the Text AI configuration and key', async () => {
    const settings = await createConfiguredApiHarness()
    const transport = createApiTransportFake()
    transport.postJson.mockResolvedValue(
      response(200, {
        choices: [{ message: { content: JSON.stringify(feedback) } }],
      }),
    )
    const provider = new OpenAICompatibleTextProvider(
      settings.service,
      transport.transport,
    )

    await expect(provider.getFeedback(feedbackRequest)).resolves.toEqual(feedback)

    expect(transport.postJson).toHaveBeenCalledOnce()
    const [url, key, body, timeout] = transport.postJson.mock.calls[0]!
    expect(url).toBe(`${textConfiguration.endpoint}/chat/completions`)
    expect(key === settings.keys['text-ai']).toBe(true)
    expect(key === settings.keys['voice-ai']).toBe(false)
    expect(key === settings.keys.stt).toBe(false)
    expect(timeout).toBe(45_000)
    expect(body).toMatchObject({
      model: textConfiguration.model,
      response_format: { type: 'json_object' },
    })
  })

  it.each([
    [401, 'unauthorized', false],
    [404, 'not-found', false],
    [429, 'rate-limited', true],
  ] as const)(
    'maps HTTP %i to %s without exposing the vendor body',
    async (status, code, retryable) => {
      const settings = await createConfiguredApiHarness()
      const transport = createApiTransportFake()
      transport.postJson.mockResolvedValue(
        response(status, { error: 'vendor-specific-private-error' }),
      )
      const provider = new OpenAICompatibleTextProvider(
        settings.service,
        transport.transport,
      )

      await expect(provider.getFeedback(feedbackRequest)).rejects.toMatchObject({
        code,
        retryable,
      })
    },
  )

  it('maps a transport rejection to a retryable network error', async () => {
    const settings = await createConfiguredApiHarness()
    const transport = createApiTransportFake()
    transport.postJson.mockRejectedValue(new TypeError('socket disconnected'))
    const provider = new OpenAICompatibleTextProvider(
      settings.service,
      transport.transport,
    )

    await expect(provider.getFeedback(feedbackRequest)).rejects.toMatchObject({
      code: 'network',
      retryable: true,
    })
  })

  it.each([
    { choices: [] },
    { choices: [{ message: { content: '{not-json' } }] },
    {
      choices: [
        { message: { content: JSON.stringify({ keyIssues: 'invalid' }) } },
      ],
    },
  ])('rejects an invalid Text AI response at runtime', async (data) => {
    const settings = await createConfiguredApiHarness()
    const transport = createApiTransportFake()
    transport.postJson.mockResolvedValue(response(200, data))
    const provider = new OpenAICompatibleTextProvider(
      settings.service,
      transport.transport,
    )

    await expect(provider.getFeedback(feedbackRequest)).rejects.toMatchObject({
      code: 'invalid-response',
      retryable: true,
    })
  })
})

describe('OpenAICompatibleSttProvider', () => {
  it('returns a faithful transcript and uses only the STT configuration and key', async () => {
    const settings = await createConfiguredApiHarness()
    const transport = createApiTransportFake()
    transport.postMultipart.mockResolvedValue(
      response(200, { text: ' um I I think it is useful ' }),
    )
    const provider = new OpenAICompatibleSttProvider(
      settings.service,
      transport.transport,
    )

    await expect(provider.transcribe(recordedAudioRequest)).resolves.toBe(
      ' um I I think it is useful ',
    )

    expect(transport.postMultipart).toHaveBeenCalledOnce()
    const [url, key, fields, file, timeout] =
      transport.postMultipart.mock.calls[0]!
    expect(url).toBe(`${sttConfiguration.endpoint}/audio/transcriptions`)
    expect(key === settings.keys.stt).toBe(true)
    expect(key === settings.keys['text-ai']).toBe(false)
    expect(key === settings.keys['voice-ai']).toBe(false)
    expect(fields).toEqual({
      model: sttConfiguration.model,
      language: 'en',
      response_format: 'json',
    })
    expect(file).toEqual({
      fieldName: 'file',
      fileName: recordedAudioRequest.fileName,
      mimeType: recordedAudioRequest.mimeType,
      data: recordedAudioRequest.audio,
    })
    expect(timeout).toBe(90_000)
  })

  it.each([
    [401, 'unauthorized', false],
    [404, 'not-found', false],
    [429, 'rate-limited', true],
  ] as const)(
    'maps HTTP %i to %s while leaving the caller in control of the audio',
    async (status, code, retryable) => {
      const settings = await createConfiguredApiHarness()
      const transport = createApiTransportFake()
      transport.postMultipart.mockResolvedValue(response(status, {}))
      const provider = new OpenAICompatibleSttProvider(
        settings.service,
        transport.transport,
      )

      await expect(provider.transcribe(recordedAudioRequest)).rejects.toMatchObject(
        { code, retryable },
      )
    },
  )

  it('maps a transport rejection to a retryable network error', async () => {
    const settings = await createConfiguredApiHarness()
    const transport = createApiTransportFake()
    transport.postMultipart.mockRejectedValue(new Error('network offline'))
    const provider = new OpenAICompatibleSttProvider(
      settings.service,
      transport.transport,
    )

    await expect(provider.transcribe(recordedAudioRequest)).rejects.toMatchObject(
      { code: 'network', retryable: true },
    )
  })

  it.each([{ text: '' }, { text: '   ' }, { transcript: 'wrong field' }])(
    'rejects an invalid STT response without normalising it into speech evidence',
    async (data) => {
      const settings = await createConfiguredApiHarness()
      const transport = createApiTransportFake()
      transport.postMultipart.mockResolvedValue(response(200, data))
      const provider = new OpenAICompatibleSttProvider(
        settings.service,
        transport.transport,
      )

      await expect(provider.transcribe(recordedAudioRequest)).rejects.toMatchObject(
        { code: 'invalid-response', retryable: true },
      )
    },
  )
})
