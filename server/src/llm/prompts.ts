// Supplies the model with the conversation date and time zone.
export const researchPrefix = "Web research isn't built into this version yet; this answer comes from the model alone and may be out of date.\n\n";

export function systemPrompt(logicalNow: Date, tz: string): string {
  const date = new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: tz }).format(logicalNow);
  return 'You are Continuum, a helpful chat assistant. The conversation date is ' + date +
    ' in ' + tz + '. Be concise. You have no live web access in this chat.';
}
