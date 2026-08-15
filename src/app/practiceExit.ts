/**
 * 练习流的麦克风错误提示,保持纯函数以便回归测试。
 * App.tsx 与 features/practice/PracticeFlow 共用。
 */
export const formatMicrophoneStartError = (error: unknown): string => {
  const errorLike =
    typeof error === 'object' && error !== null
      ? (error as { name?: unknown; message?: unknown })
      : null
  const name = typeof errorLike?.name === 'string' ? errorLike.name : ''
  const message =
    typeof errorLike?.message === 'string' ? errorLike.message : ''

  const permissionDenied =
    name.toLowerCase() === 'notallowederror' ||
    message.toLowerCase().includes('permission denied')

  if (permissionDenied) {
    return '无法开始录音：麦克风权限未开启。请前往“系统设置 → 应用 → 雅思口语喵 → 权限 → 麦克风”并允许访问，然后返回重试。'
  }

  return error instanceof Error
    ? `无法开始录音：${error.message}`
    : '无法开始录音，请检查麦克风权限。'
}
