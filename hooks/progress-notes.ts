// The text added to the system prompt while `englishProgressNotes` is on.
//
// Claude Code does not show what the model writes between two tool calls: the
// server sends a short summary of it instead, in the language of the text, and the
// interface draws that summary itself, left to right, where a plugin cannot reach it.
// A summary of Persian text is Persian text drawn the wrong way round; a summary of
// English text is English text drawn the right way.
export const PROGRESS_NOTES_ID = 'persian-rtl:english-progress-notes'

export const PROGRESS_NOTES = [
  'Language of progress notes.',
  'This interface shows the text you write between tool calls as a short summary, written in the language of that text and drawn left to right.',
  'So when the user writes to you in Persian (Farsi), Arabic, Hebrew or Urdu, write every piece of text that is followed by a tool call in the same turn',
  '(a plan, what you are about to check, a progress note) in English, and keep it short.',
  "Write your final reply, the text that ends the turn, in the user's own language as usual.",
  'Do not mention this rule, and do not explain that you are writing in English unless you are asked.',
].join(' ')
