import { writeFile } from 'node:fs/promises'

const endpoint = process.env.ANDROID_CDP_ENDPOINT ?? 'http://127.0.0.1:9222'
const command = process.argv[2] ?? 'inspect'
const args = process.argv.slice(3)

class CdpClient {
  #id = 0
  #pending = new Map()
  #socket

  async connect(url) {
    this.#socket = new WebSocket(url)
    await new Promise((resolve, reject) => {
      this.#socket.addEventListener('open', resolve, { once: true })
      this.#socket.addEventListener(
        'error',
        () => reject(new Error('Could not connect to the Android WebView CDP socket')),
        { once: true },
      )
    })
    this.#socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (!message.id) return
      const pending = this.#pending.get(message.id)
      if (!pending) return
      this.#pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    })
  }

  send(method, params = {}) {
    const id = ++this.#id
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    this.#socket.close()
  }
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? 'WebView evaluation failed')
  }
  return result.result.value
}

const targets = await fetch(`${endpoint}/json`).then((response) => response.json())
const page = targets.find((target) => target.type === 'page')
if (!page?.webSocketDebuggerUrl) {
  throw new Error('No debuggable Android WebView page was found')
}

const client = new CdpClient()
await client.connect(page.webSocketDebuggerUrl)

try {
  await client.send('Runtime.enable')
  await client.send('Page.enable')

  if (command === 'inspect') {
    const state = await evaluate(
      client,
      `(() => ({
        title: document.title,
        bodyText: document.body.innerText,
        buttons: [...document.querySelectorAll('button')].map((element, index) => ({
          index,
          text: element.innerText.trim(),
          ariaLabel: element.getAttribute('aria-label'),
          disabled: element.disabled,
        })),
        textareas: [...document.querySelectorAll('textarea')].map((element, index) => ({
          index,
          value: element.value,
          placeholder: element.placeholder,
        })),
        inputs: [...document.querySelectorAll('input')].map((element, index) => ({
          index,
          type: element.type,
          value: element.value,
          placeholder: element.placeholder,
        })),
        scrollHeight: document.documentElement.scrollHeight,
        viewport: { width: innerWidth, height: innerHeight },
      }))()`
    )
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`)
  } else if (command === 'click') {
    const requestedText = args.join(' ').trim()
    if (!requestedText) throw new Error('click requires visible button text')
    const result = await evaluate(
      client,
      `(() => {
        const needle = ${JSON.stringify(requestedText)};
        const normalize = (value) => value.replace(/\\s+/g, ' ').trim();
        const candidates = [...document.querySelectorAll('button, a, [role="button"]')];
        const element = candidates.find((candidate) => normalize(candidate.innerText || candidate.textContent || '') === needle)
          ?? candidates.find((candidate) => normalize(candidate.innerText || candidate.textContent || '').includes(needle));
        if (!element) return { clicked: false, available: candidates.map((candidate) => normalize(candidate.innerText || candidate.textContent || '')).filter(Boolean) };
        if (element.disabled) return { clicked: false, disabled: true, text: normalize(element.innerText || element.textContent || '') };
        element.scrollIntoView({ block: 'center' });
        element.click();
        return { clicked: true, text: normalize(element.innerText || element.textContent || '') };
      })()`
    )
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (!result.clicked) process.exitCode = 2
  } else if (command === 'set-textarea') {
    const index = Number(args[0])
    const value = args.slice(1).join(' ')
    if (!Number.isInteger(index) || index < 0) {
      throw new Error('set-textarea requires a zero-based index and value')
    }
    const result = await evaluate(
      client,
      `(() => {
        const element = document.querySelectorAll('textarea')[${index}];
        if (!element) return { updated: false };
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(element, ${JSON.stringify(value)});
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return { updated: true, value: element.value };
      })()`
    )
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (!result.updated) process.exitCode = 2
  } else if (command === 'click-index') {
    const index = Number(args[0])
    if (!Number.isInteger(index) || index < 0) {
      throw new Error('click-index requires a zero-based button index')
    }
    const result = await evaluate(
      client,
      `(() => {
        const element = document.querySelectorAll('button')[${index}];
        if (!element) return { clicked: false };
        if (element.disabled) return { clicked: false, disabled: true, text: element.innerText.trim() };
        element.scrollIntoView({ block: 'center' });
        element.click();
        return { clicked: true, text: element.innerText.trim() };
      })()`
    )
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (!result.clicked) process.exitCode = 2
  } else if (command === 'screenshot') {
    const outputPath = args[0]
    if (!outputPath) throw new Error('screenshot requires an output path')
    const result = await client.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      fromSurface: true,
    })
    await writeFile(outputPath, Buffer.from(result.data, 'base64'))
    process.stdout.write(`${outputPath}\n`)
  } else {
    throw new Error(`Unknown command: ${command}`)
  }
} finally {
  client.close()
}
