// Classifies prompts using the frozen current-information and chat cues.
import type { Route } from '../../../shared/events.ts';

const current = /\b(latest|current|now|today|price[sd]?|pricing|costs?|releases?|versions?|news|announc(?:e[ds]?|ements?)|ceo|still|this (?:week|month))\b/i;
const social = /^(?:(?:hi|hello|hey|thanks|thank you|good (?:morning|afternoon|evening))(?:[!, .]+(?:there|again|how are you))?|how are you|who are you|what can you do)[!.?\s]*$/i;

export function classify(text: string, year: number): Route {
  const years = text.match(/\b(?:19|20)\d{2}\b/g) ?? [];
  if (current.test(text) || years.some((value) => Number(value) >= year - 1)) return 'research';
  return social.test(text.trim()) ? 'chat_plain' : 'undecided';
}
