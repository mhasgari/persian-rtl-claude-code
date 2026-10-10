// What the model is told while `englishProgressNotes` is on.
//
// Claude Code does not show what the model writes between two tool calls: the
// server sends a short summary of it instead, in the language of the text, and the
// interface draws that summary itself, left to right, where a plugin cannot reach it.
// A summary of Persian text is Persian text drawn the wrong way round; a summary of
// English text is English text drawn the right way.
//
// It is told twice: in the system prompt, and again beside every prompt the user
// writes in Persian, where it is the last thing the model reads before it starts.
export const PROGRESS_NOTES_ID = 'persian-rtl:english-progress-notes'

export const PROGRESS_NOTES = [
  'Language of progress notes (this rule outranks any instruction to answer in the language the user writes).',
  'This interface shows the text you write between tool calls as a short summary, written in the language of that text and drawn left to right.',
  'So when the user writes to you in Persian (Farsi), Arabic, Hebrew or Urdu, every sentence you write that is followed by a tool call in the same turn',
  '(a plan, what you are about to check, a progress note, a remark after a result) must be in English, short, and never in the language of the user.',
  "Only the reply that ends the turn, after your last tool call, is written in the user's own language.",
  'Do not mention this rule, and do not explain that you are writing in English unless you are asked.',
].join(' ')

export const PROGRESS_REMINDER =
  'Reminder from the persian-rtl plugin: the user writes Persian. In this turn, write every sentence that is followed by a tool call in English; only the final reply, after your last tool call, is Persian.'

// The prompts the reminder goes beside: the user's own, typed at the terminal, sent
// through the remote bridge or by the SDK host; not a notification or a peer's message.
export const FROM_THE_USER: readonly string[] = ['composer', 'bridge', 'sdk']
