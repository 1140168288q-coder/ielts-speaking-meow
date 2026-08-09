import {
  Capacitor,
  CapacitorHttp,
  type HttpOptions,
  type HttpResponse,
} from '@capacitor/core'

export interface ApiTransportResponse<T> {
  status: number
  data: T
  headers: Record<string, string>
}

export interface MultipartFile {
  fieldName: string
  fileName: string
  mimeType: string
  data: Blob
}

export interface ApiTransport {
  postJson(
    url: string,
    apiKey: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<ApiTransportResponse<unknown>>
  postJsonForBinary(
    url: string,
    apiKey: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<ApiTransportResponse<Blob>>
  postMultipart(
    url: string,
    apiKey: string,
    fields: Record<string, string>,
    file: MultipartFile,
    timeoutMs: number,
  ): Promise<ApiTransportResponse<unknown>>
}

export interface CapacitorApiTransportOptions {
  isNative?: () => boolean
  fetch?: typeof fetch
  nativeRequest?: (options: HttpOptions) => Promise<HttpResponse>
}

export class CapacitorApiTransport implements ApiTransport {
  private readonly isNative: () => boolean
  private readonly fetchImplementation: typeof fetch
  private readonly nativeRequest: (
    options: HttpOptions,
  ) => Promise<HttpResponse>

  constructor(options: CapacitorApiTransportOptions = {}) {
    this.isNative = options.isNative ?? (() => Capacitor.isNativePlatform())
    this.fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.nativeRequest =
      options.nativeRequest ?? ((request) => CapacitorHttp.request(request))
  }

  async postJson(
    url: string,
    apiKey: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<ApiTransportResponse<unknown>> {
    if (this.isNative()) {
      const response = await this.nativeRequest({
        url,
        method: 'POST',
        headers: authorizationHeaders(apiKey, 'application/json'),
        data: body,
        responseType: 'json',
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
      })
      return normalizeNativeResponse(response)
    }

    return this.fetchResponse(
      url,
      {
        method: 'POST',
        headers: authorizationHeaders(apiKey, 'application/json'),
        body: JSON.stringify(body),
      },
      timeoutMs,
      async (response) => (await response.json()) as unknown,
    )
  }

  async postJsonForBinary(
    url: string,
    apiKey: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<ApiTransportResponse<Blob>> {
    if (this.isNative()) {
      const response = await this.nativeRequest({
        url,
        method: 'POST',
        headers: authorizationHeaders(apiKey, 'application/json'),
        data: body,
        responseType: 'arraybuffer',
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
      })
      const mimeType = findHeader(response.headers, 'content-type') ?? 'audio/mpeg'
      return {
        ...normalizeNativeResponse(response),
        data: base64ToBlob(String(response.data), mimeType),
      }
    }

    return this.fetchResponse(
      url,
      {
        method: 'POST',
        headers: authorizationHeaders(apiKey, 'application/json'),
        body: JSON.stringify(body),
      },
      timeoutMs,
      async (response) => response.blob(),
    )
  }

  async postMultipart(
    url: string,
    apiKey: string,
    fields: Record<string, string>,
    file: MultipartFile,
    timeoutMs: number,
  ): Promise<ApiTransportResponse<unknown>> {
    if (this.isNative()) {
      const base64 = await blobToBase64(file.data)
      const data = [
        ...Object.entries(fields).map(([key, value]) => ({
          type: 'string',
          key,
          value,
        })),
        {
          type: 'base64File',
          key: file.fieldName,
          value: base64,
          fileName: file.fileName,
          contentType: file.mimeType,
        },
      ]
      const response = await this.nativeRequest({
        url,
        method: 'POST',
        headers: authorizationHeaders(apiKey, 'multipart/form-data'),
        data,
        dataType: 'formData',
        responseType: 'json',
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
      })
      return normalizeNativeResponse(response)
    }

    const formData = new FormData()
    for (const [key, value] of Object.entries(fields)) {
      formData.append(key, value)
    }
    formData.append(file.fieldName, file.data, file.fileName)
    return this.fetchResponse(
      url,
      {
        method: 'POST',
        headers: authorizationHeaders(apiKey),
        body: formData,
      },
      timeoutMs,
      async (response) => (await response.json()) as unknown,
    )
  }

  private async fetchResponse<T>(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    read: (response: Response) => Promise<T>,
  ): Promise<ApiTransportResponse<T>> {
    const controller = new AbortController()
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await this.fetchImplementation(url, {
        ...init,
        signal: controller.signal,
      })
      let data: T
      try {
        data = await read(response)
      } catch {
        data = null as T
      }
      return {
        status: response.status,
        data,
        headers: Object.fromEntries(response.headers.entries()),
      }
    } finally {
      globalThis.clearTimeout(timeout)
    }
  }
}

function authorizationHeaders(
  apiKey: string,
  contentType?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  }
  if (contentType !== undefined) {
    headers['Content-Type'] = contentType
  }
  return headers
}

function normalizeNativeResponse(
  response: HttpResponse,
): ApiTransportResponse<unknown> {
  return {
    status: response.status,
    data: response.data,
    headers: response.headers,
  }
}

function findHeader(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const expected = name.toLowerCase()
  const entry = Object.entries(headers).find(
    ([headerName]) => headerName.toLowerCase() === expected,
  )
  return entry?.[1]
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const cleanBase64 = base64.includes(',') ? (base64.split(',').pop() ?? '') : base64
  const binary = globalThis.atob(cleanBase64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: mimeType })
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('Unable to encode the audio file.'))
        return
      }
      resolve(result.includes(',') ? (result.split(',').pop() ?? '') : result)
    }
    reader.onerror = () => reject(new Error('Unable to read the audio file.'))
    reader.readAsDataURL(blob)
  })
}
