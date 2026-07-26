import { BrowserLocaleGenerator } from './locale'

export function generateRandomTimezone() {
  return BrowserLocaleGenerator.getRandomLocale().timeZone
}
