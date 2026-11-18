// Supplies the model with the conversation date and time zone.
export function systemPrompt(logicalNow: Date, tz: string, research = false): string {
  const date = new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: tz }).format(logicalNow);
  return 'You are Continuum, a helpful chat assistant. The conversation date is ' + date +
    ' in ' + tz + '. Be concise. ' + (research ? 'Use the supplied research tools and evidence when appropriate.'
      : 'You have no live web access in this chat.');
}
