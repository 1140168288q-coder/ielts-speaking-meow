import { questionBankSchema } from '../domain/models'

const builtInQuestions = [
  {
    id: 'p1-home-001',
    part: 1,
    topic: 'Home',
    prompt: 'What do you like most about the place where you live?',
  },
  {
    id: 'p1-study-001',
    part: 1,
    topic: 'Study and work',
    prompt: 'What part of your studies or work do you enjoy most?',
  },
  {
    id: 'p1-weekends-001',
    part: 1,
    topic: 'Weekends',
    prompt: 'How do you usually spend your weekends?',
  },
  {
    id: 'p1-music-001',
    part: 1,
    topic: 'Music',
    prompt: 'When do you usually listen to music?',
  },
  {
    id: 'p1-weather-001',
    part: 1,
    topic: 'Weather',
    prompt: 'What kind of weather do you enjoy most?',
  },
  {
    id: 'p1-photos-001',
    part: 1,
    topic: 'Photography',
    prompt: 'Do you often take photos with your phone?',
  },
  {
    id: 'p2-skill-001',
    part: 2,
    topic: 'Skills',
    prompt: 'Describe a useful skill you learned from another person.',
    cuePoints: [
      'what the skill was',
      'who taught you',
      'how you learned it',
      'why the skill is useful to you',
    ],
  },
  {
    id: 'p2-place-001',
    part: 2,
    topic: 'Places',
    prompt: 'Describe a place in your city that you enjoy visiting.',
    cuePoints: [
      'where it is',
      'what it looks like',
      'what you do there',
      'why you enjoy visiting it',
    ],
  },
  {
    id: 'p2-conversation-001',
    part: 2,
    topic: 'Communication',
    prompt: 'Describe a conversation that was important to you.',
    cuePoints: [
      'who you spoke with',
      'when and where it happened',
      'what you talked about',
      'why the conversation was important',
    ],
  },
  {
    id: 'p2-object-001',
    part: 2,
    topic: 'Objects',
    prompt: 'Describe something you use almost every day.',
    cuePoints: [
      'what it is',
      'when you first got it',
      'how you use it',
      'why it is important in your daily life',
    ],
  },
  {
    id: 'p2-challenge-001',
    part: 2,
    topic: 'Challenges',
    prompt: 'Describe a difficult task that you completed successfully.',
    cuePoints: [
      'what the task was',
      'why it was difficult',
      'what you did to complete it',
      'how you felt afterwards',
    ],
  },
  {
    id: 'p2-person-001',
    part: 2,
    topic: 'People',
    prompt: 'Describe someone who gives you practical advice.',
    cuePoints: [
      'who the person is',
      'how you know them',
      'what kind of advice they give',
      'why you value their advice',
    ],
  },
  {
    id: 'p3-skills-001',
    part: 3,
    topic: 'Skills and education',
    prompt: 'Which practical skills should schools teach more often?',
  },
  {
    id: 'p3-cities-001',
    part: 3,
    topic: 'Cities',
    prompt: 'How can cities make public spaces more useful for residents?',
  },
  {
    id: 'p3-communication-001',
    part: 3,
    topic: 'Communication',
    prompt: 'Has technology improved the quality of everyday conversations?',
  },
  {
    id: 'p3-consumption-001',
    part: 3,
    topic: 'Consumer habits',
    prompt: 'Why do some people replace useful objects before they wear out?',
  },
  {
    id: 'p3-challenges-001',
    part: 3,
    topic: 'Challenges',
    prompt: 'What helps people stay motivated when a task becomes difficult?',
  },
  {
    id: 'p3-advice-001',
    part: 3,
    topic: 'Advice',
    prompt: 'When should people follow advice, and when should they ignore it?',
  },
]

const difficultyByPart = {
  1: 'foundation',
  2: 'developing',
  3: 'stretch',
} as const

export const questionBank = questionBankSchema.parse(
  builtInQuestions.map((question) => ({
    ...question,
    difficulty: difficultyByPart[question.part as 1 | 2 | 3],
    source: '雅思口语喵内置题库 v1.4',
  })),
)
