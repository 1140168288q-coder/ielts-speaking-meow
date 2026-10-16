import { useState } from 'react'
import type { AiFeedback } from '../../../../domain'
import { ReferenceAnswerCard } from './ReferenceAnswers'

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
          <h2>先改最值得改的重点</h2>
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

      {references.length > 0 ? (
        <section className="reference-answers">
          <div className="reference-heading">
            <p className="eyebrow">2 个参考回答</p>
            <h3>先看简单优化，再看自然提升</h3>
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

      {feedback.naturalUpgradeSuggestions.addableContent.length > 0 ||
      feedback.naturalUpgradeSuggestions.advancedChanges.length > 0 ? (
        <details className="feedback-details natural-upgrade" open={detail === 'expanded'}>
          <summary>自然提升版的补充建议</summary>
          {feedback.naturalUpgradeSuggestions.addableContent.length > 0 ? (
            <div>
              <strong>可添加内容</strong>
              <ul>
                {feedback.naturalUpgradeSuggestions.addableContent.map((item, index) => (
                  <li key={`addable-${index}`}>
                    {item.content}
                    {item.replaceable ? '（示例内容，可替换）' : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {feedback.naturalUpgradeSuggestions.advancedChanges.length > 0 ? (
            <div>
              <strong>进阶修改建议</strong>
              <ul>
                {feedback.naturalUpgradeSuggestions.advancedChanges.map((item, index) => (
                  <li key={`advanced-${index}`}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </details>
      ) : null}

      {feedback.contextReferences && feedback.contextReferences.length > 0 ? (
        <details className="feedback-details context-references">
          <summary>本次参考了什么（{feedback.contextReferences.length}）</summary>
          <ul>
            {feedback.contextReferences.map((reference) => (
              <li key={`${reference.kind}:${reference.id}`}>
                <strong>{contextKindLabel(reference.kind)}</strong> · {reference.title}
              </li>
            ))}
          </ul>
          <small>仅显示真正影响自然提升版、且已通过来源校验的条目。</small>
        </details>
      ) : null}
    </section>
  )
}

function contextKindLabel(kind: NonNullable<AiFeedback['contextReferences']>[number]['kind']): string {
  if (kind === 'built_in_knowledge') return '内置教学知识'
  if (kind === 'user_knowledge') return '我的知识库'
  if (kind === 'memory') return '已确认长期记忆'
  return '已确认个人素材'
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
