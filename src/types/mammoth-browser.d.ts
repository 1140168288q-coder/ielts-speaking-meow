declare module 'mammoth/mammoth.browser.js' {
  interface MammothMessage {
    type: 'warning' | 'error'
    message: string
  }

  interface MammothResult {
    value: string
    messages: MammothMessage[]
  }

  const mammoth: {
    extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<MammothResult>
  }

  export default mammoth
}
