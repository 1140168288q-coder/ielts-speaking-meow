import { useState } from 'react'
import type { AiFeedback } from '../../../../domain'
import { ReferenceAnswerCard, TtsSection } from './ReferenceAnswers'

export function AiFeedbackCard({
  feedback,
  playingKey,
  onToggle,
  detail,
}: {
  feedback: AiFeedback
  playingKey: string | null
  onToggle: (key: string, text: string) => void
  detail: 'focused' | 'expanded'
}) {
  const [activeReferenceIndex, setActiveReferenceIndex] = useState(0)
  const topIssues = pickTopIssues(feedback)
  const references = feedback.referenceAnswers
  const activeReference = references[activeReferenceIndex] ?? references[0]

  return (
    <section className="ai-feedback-card">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">AI 文本分析 · 不评分</p>
          <h2>先改最值得改的 2-3 点</h2>
        </div>
      </div>

      <p className="ai-summary">{feedback.summary}</p>
      {feedback.strengths.length > 0 ? (
        <p className="ai-strengths">
          <strong>已经不错：</strong>
          {feedback.strengths.join('；')}
        </p>
      ) : null}

      {topIssues.length > 0 ? (
        <section className="priority-issues">
          <h3>优先改这 {topIssues.length} 点</h3>
          <ol>
            {topIssues.map((item, index) => (
              <li key={`${item.tone}-${index}`} className={item.tone}>
                <span>{index + 1}</span>
                <p>{item.text}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {feedback.grammarSuggestions.length > 0 ? (
        <details className="feedback-details grammar" open={detail === 'expanded'}>
          <summary>
            语法微修（{feedback.grammarSuggestions.length}）
          </summary>
          <ul>
            {feedback.grammarSuggestions.map((item, index) => (
              <li key={`grammar-${index}`}>{item}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {feedback.vocabularySuggestions.length > 0 ? (
        <details className="feedback-details vocabulary" open={detail === 'expanded'}>
          <summary>
            词汇替换（{feedback.vocabularySuggestions.length}）
          </summary>
          <ul>
            {feedback.vocabularySuggestions.map((item, index) => (
              <li key={`vocabulary-${index}`}>{item}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <details className="improved-answer-details" open={detail === 'expanded'}>
        <summary>优化答案（保持你的水平，不是范文）</summary>
        <TtsSection
          title="优化答案"
          text={feedback.improvedAnswer}
          playingKey={playingKey}
          onToggle={onToggle}
        />
      </details>

      {references.length > 0 ? (
        <section className="reference-answers">
          <div className="reference-heading">
            <p className="eyebrow">3 个参考回答</p>
            <h3>逐个看，不要一次读三篇</h3>
          </div>
          <div className="reference-tabs" role="tablist" aria-label="参考回答版本">
            {references.map((reference, index) => (
              <button
                key={`${reference.label}-${index}`}
                type="button"
                role="tab"
                aria-selected={index === activeReferenceIndex}
                className={index === activeReferenceIndex ? 'active' : ''}
                onClick={() => setActiveReferenceIndex(index)}
              >
                {reference.label}
              </button>
            ))}
          </div>
          {activeReference ? (
            <ReferenceAnswerCard
              reference={activeReference}
              playingKey={playingKey}
              onToggle={onToggle}
            />
          ) : null}
        </section>
      ) : null}
    </section>
  )
}

function pickTopIssues(feedback: AiFeedback): Array<{
  text: string
  tone: 'problem' | 'grammar' | 'vocabulary'
}> {
  if (feedback.problems.length > 0) {
    return feedback.problems.slice(0, 3).map((text) => ({
      text,
      tone: 'problem',
    }))
  }
  const fallback: Array<{ text: string; tone: 'grammar' | 'vocabulary' }> = [
    ...feedback.grammarSuggestions.slice(0, 2).map((text) => ({
      text,
      tone: 'grammar' as const,
    })),
    ...feedback.vocabularySuggestions.slice(0, 1).map((text) => ({
      text,
      tone: 'vocabulary' as const,
    })),
  ]
  return fallback.slice(0, 3)
}
