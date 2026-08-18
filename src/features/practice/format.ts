import type { TrainingSession } from '../../domain'

export const partLabel = (part: 1 | 2 | 3) => `Part ${part}`

export const formatDuration = (milliseconds: number) => {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1_000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0
    ? `${minutes}:${seconds.toString().padStart(2, '0')}`
    : `${seconds} 秒`
}

export const formatDate = (value: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))

export const audioExtension = (mimeType: string) => {
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('mp4') || mimeType.includes('aac')) return 'm4a'
  if (mimeType.includes('mpeg')) return 'mp3'
  return 'webm'
}

export const statusLabel: Record<TrainingSession['status'], string> = {
  'first-ready': '等待第一次回答',
  'first-review': '查看第一次反馈',
  'feedback-ready': '选择建议版本',
  'second-ready': '等待第二次回答',
  'comparison-ready': '修改并收录第二次回答',
  completed: '已完成',
}
