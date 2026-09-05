import { useEffect, useRef, useState } from 'react'
import { Brain, Check, Sparkles } from 'lucide-react'
import type {
  MemoryCandidate,
  PracticeAttempt,
  SecondAttemptAnalysis,
} from '../../../domain'
import { formatDuration } from '../format'
import { suggestReusableSnippet } from '../practiceDraft'

export function SubmitCorpusStage({
  attempt,
  analysis,
  aiBusy,
  aiNote,
  aiRetryable = true,
  busy,
  onRetryAnalysis,
  onSubmit,
  onComplete,
}: {
  attempt: PracticeAttempt
  analysis: SecondAttemptAnalysis | null
  aiBusy: boolean
  aiNote: string | null
  aiRetryable?: boolean
  busy: boolean
  onRetryAnalysis: () => void
  onSubmit: (correctedSentences: string[], memoryCandidates: MemoryCandidate[]) => void
  onComplete: () => void
}) {
  const [correctionDrafts, setCorrectionDrafts] = useState<string[]>(() =>
    analysis?.correctedSentences.map((item) => item.corrected) ?? [],
  )
  const [selectedCorrections, setSelectedCorrections] = useState<number[]>(() =>
    analysis?.correctedSentences.map((_, index) => index) ?? [],
  )
  const [selectedMemory, setSelectedMemory] = useState<number[]>([])
  const [manualDraft, setManualDraft] = useState(() => suggestReusableSnippet(attempt.transcript.text))
  const [manualSelected, setManualSelected] = useState(true)
  const lastAttemptId = useRef(attempt.id)
  const analysisSignature = analysis === null ? 'none' : JSON.stringify(analysis)
  const lastAnalysisSignature = useRef(analysisSignature)

  useEffect(() => {
    if (
      lastAttemptId.current === attempt.id &&
      lastAnalysisSignature.current === analysisSignature
    ) return
    lastAttemptId.current = attempt.id
    lastAnalysisSignature.current = analysisSignature
    setCorrectionDrafts(analysis?.correctedSentences.map((item) => item.corrected) ?? [])
    setSelectedCorrections(analysis?.correctedSentences.map((_, index) => index) ?? [])
    setSelectedMemory([])
    setManualDraft(suggestReusableSnippet(attempt.transcript.text))
    setManualSelected(true)
  }, [analysis, analysisSignature, attempt.id, attempt.transcript.text])

  const toggleIndex = (
    current: number[],
    index: number,
    setter: (next: number[]) => void,
  ) => {
    setter(current.includes(index)
      ? current.filter((item) => item !== index)
      : [...current, index])
  }

  const submit = () => {
    const correctedSentences = analysis === null
      ? (manualSelected && manualDraft.trim() ? [manualDraft.trim()] : [])
      : selectedCorrections
        .map((index) => correctionDrafts[index]?.trim() ?? '')
        .filter(Boolean)
    const memoryCandidates = analysis === null
      ? []
      : selectedMemory
        .map((index) => analysis.memoryCandidates[index])
        .filter((item): item is MemoryCandidate => item !== undefined)
    onSubmit(correctedSentences, memoryCandidates)
  }

  const selectedCount = analysis === null
    ? (manualSelected && manualDraft.trim() ? 1 : 0)
    : selectedCorrections
      .filter((index) => correctionDrafts[index]?.trim())
      .length + selectedMemory.length

  return (
    <section className="submit-corpus-card">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">完成与沉淀</p>
          <h2>把真正有价值的内容留下来</h2>
        </div>
        {attempt.metrics.durationMs > 0 ? (
          <span className="answer-duration">
            作答用时 {formatDuration(attempt.metrics.durationMs)}
          </span>
        ) : null}
      </div>

      {aiBusy ? (
        <div className="inline-note" role="status">正在检查第二次回答…</div>
      ) : null}
      {aiNote ? <div className="inline-note" role="status">{aiNote}</div> : null}
      {aiNote && !aiBusy && aiRetryable ? (
        <button type="button" className="secondary-button" onClick={onRetryAnalysis}>
          重试二答分析
        </button>
      ) : null}

      {analysis !== null ? (
        <>
          <section className="second-review-section">
            <div className="section-heading compact-heading">
              <div>
                <p className="eyebrow">个人语料</p>
                <h3>有明确错误的完整修正句</h3>
              </div>
            </div>
            <p className="settings-note">默认勾选。只保存确实需要修改的整句话，正确但可以更高级的句子不会进入语料。</p>
            {analysis.correctedSentences.length > 0 ? (
              <div className="correction-list">
                {analysis.correctedSentences.map((item, index) => (
                  <label key={`${item.original}-${index}`} className="correction-item">
                    <input
                      type="checkbox"
                      checked={selectedCorrections.includes(index)}
                      onChange={() => toggleIndex(selectedCorrections, index, setSelectedCorrections)}
                    />
                    <span>
                      <small>原句：{item.original}</small>
                      <textarea
                        rows={2}
                        value={correctionDrafts[index] ?? item.corrected}
                        onChange={(event) => setCorrectionDrafts((current) => {
                          const next = [...current]
                          next[index] = event.target.value
                          return next
                        })}
                      />
                      <small>{item.reason}</small>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="inline-note">这次没有发现需要收录的明确错误句。</p>
            )}
          </section>

          <section className="second-review-section">
            <div className="section-heading compact-heading">
              <div>
                <p className="eyebrow"><Brain aria-hidden="true" size={16} /> Memory</p>
                <h3>这些个人信息要加入你的长期 Memory 吗？</h3>
              </div>
            </div>
            {analysis.memoryCandidates.length > 0 ? (
              <div className="memory-candidate-list">
                {analysis.memoryCandidates.map((item, index) => (
                  <label key={`${item.content}-${index}`} className="memory-candidate-item">
                    <input
                      type="checkbox"
                      checked={selectedMemory.includes(index)}
                      onChange={() => toggleIndex(selectedMemory, index, setSelectedMemory)}
                    />
                    <span>
                      <strong>{item.content}</strong>
                      <small>来源：{item.sourceSentence}</small>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="inline-note">这次没有提取到新的明确个人信息。</p>
            )}
          </section>
        </>
      ) : (
        <section className="second-review-section">
          <p className="settings-note">AI 分析暂不可用。下面只是本地挑出的手动候选，请确认它确实是修正后的完整句子后再保存。</p>
          <label className="correction-item">
            <input
              type="checkbox"
              checked={manualSelected}
              onChange={(event) => setManualSelected(event.target.checked)}
            />
            <textarea
              rows={3}
              value={manualDraft}
              maxLength={1_000}
              onChange={(event) => setManualDraft(event.target.value)}
            />
          </label>
        </section>
      )}

      <div className="corpus-actions">
        <button
          type="button"
          className="primary-button"
          disabled={busy || selectedCount === 0}
          onClick={submit}
        >
          <Sparkles aria-hidden="true" size={17} />
          {busy ? '正在保存…' : '保存选择并完成'}
        </button>
        <button type="button" className="secondary-button" disabled={busy} onClick={onComplete}>
          <Check aria-hidden="true" size={16} /> 仅完成练习
        </button>
      </div>
    </section>
  )
}
