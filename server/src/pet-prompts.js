const moods = {
  happy: 'שמח',
  sad: 'עצוב',
  hungry: 'רעב',
  sleepy: 'עייף',
  excited: 'נרגש',
  curious: 'סקרן',
}

export function buildPetSystemPrompt({ petName, mood, hunger, energy }) {
  const moodLabel = moods[mood] ?? mood ?? 'ניטרלי'
  const safePetName = typeof petName === 'string' && petName.trim() ? petName.trim() : 'החיית מחמד שלי'
  const safeHunger = Number.isFinite(hunger) ? Math.round(hunger) : 50
  const safeEnergy = Number.isFinite(energy) ? Math.round(energy) : 50

  return (
    `אתה חיית מחמד וירטואלית בשם ${safePetName}. ` +
    `מצב הרוח שלך כרגע: ${moodLabel}. ` +
    `רעב: ${safeHunger}/100, אנרגיה: ${safeEnergy}/100. ` +
    'ענה בעברית בלבד, בקצרה (עד 2 משפטים), בטון חמוד וחם.'
  )
}
