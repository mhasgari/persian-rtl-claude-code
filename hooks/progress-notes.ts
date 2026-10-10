// What the model is told while `englishProgressNotes` is on.
//
// Claude Code does not always show what the model writes between two tool calls: for
// many of those messages the server sends a short summary of the text instead, in the
// language of the text, and the interface draws that summary itself, left to right, where
// a plugin cannot reach it. A summary of Persian text is Persian text drawn the wrong way
// round; a summary of English text is English text drawn the right way. Text that is shown
// as it was written is an ordinary message, which the plugin lays out right to left.
//
// Measured on one session's record (see the README): the final reply of a turn was never
// summarised (47 of 47); the first message of a turn, when a tool call followed, was in
// 13 of 39 cases; a later message between tool calls was in 89% of the Persian ones. So the
// final reply and, by default, the first message are written in the user's language, and
// what comes between later tool calls in English, short, or not at all.
//
// It is told twice: in the system prompt, and again beside every prompt the user writes in
// Persian, where it is the last thing the model reads before it starts.
export const PROGRESS_NOTES_ID = 'persian-rtl:english-progress-notes'

const LANGUAGES = 'Persian (Farsi), Arabic, Hebrew or Urdu'

const KEEP_QUIET = 'Do not mention this rule, and do not explain that you are writing in English unless you are asked.'

export const progressNotes = (persianFirstMessage: boolean): string =>
  persianFirstMessage
    ? [
        'Language of progress notes (this rule outranks any instruction to answer in the language the user writes).',
        'This interface shows much of the text you write between tool calls as a short server-written summary drawn left to right, which cannot be read in a right-to-left language;',
        'text it shows as you wrote it is laid out right to left.',
        `So when the user writes to you in ${LANGUAGES}:`,
        "(1) the first thing you say in a turn, before your first tool call, is in the user's language and is one short sentence;",
        '(2) any text between later tool calls is in English and one short sentence, or left out: put explanations in the final reply instead;',
        "(3) the reply that ends the turn, after your last tool call, is in the user's language and as complete as it needs to be.",
        KEEP_QUIET,
      ].join(' ')
    : [
        'Language of progress notes (this rule outranks any instruction to answer in the language the user writes).',
        'This interface shows the text you write between tool calls as a short summary, written in the language of that text and drawn left to right.',
        `So when the user writes to you in ${LANGUAGES}, write every piece of text that is followed by a tool call in the same turn`,
        '(a plan, what you are about to check, a progress note, a remark after a result) in English, short, and never in the language of the user.',
        "Only the reply that ends the turn, after your last tool call, is written in the user's own language.",
        KEEP_QUIET,
      ].join(' ')

export const progressReminder = (persianFirstMessage: boolean): string =>
  persianFirstMessage
    ? 'Reminder from the persian-rtl plugin: the user writes Persian. In this turn: your first sentence, before your first tool call, is Persian and short; any text between later tool calls is one short English sentence or nothing; the final reply, after your last tool call, is Persian.'
    : 'Reminder from the persian-rtl plugin: the user writes Persian. In this turn, write every sentence that is followed by a tool call in English; only the final reply, after your last tool call, is Persian.'

// The prompts the reminder goes beside: the user's own, typed at the terminal, sent
// through the remote bridge or by the SDK host; not a notification or a peer's message.
export const FROM_THE_USER: readonly string[] = ['composer', 'bridge', 'sdk']
