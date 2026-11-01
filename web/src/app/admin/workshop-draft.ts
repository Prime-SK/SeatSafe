import { Workshop } from '../workshops/workshop';

export interface WorkshopInput {
  title: string;
  capacity: number;
  startsAt: string;
  registrationOpen: boolean;
}
export interface Draft {
  title: string;
  capacity: number | null;
  schedule: Date | string | null;
  registrationOpen: boolean;
}
export type WorkshopField = 'title' | 'capacity' | 'schedule' | 'registrationOpen';
export const fields: WorkshopField[] = ['title', 'capacity', 'schedule', 'registrationOpen'];
// DatePicker represents wall-clock fields in a local Date. Its timezone is not the workshop timezone.
export function colomboWallDate(instant: string): Date | string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const number = (key: string) => Number(parts.find((part) => part.type === key)?.value);
  const pad = (key: string) => String(number(key)).padStart(2, '0');
  return parseWallText(
    `${pad('day')}/${pad('month')}/${number('year')} ${pad('hour')}:${pad('minute')}`,
  )!;
}
function textParts(text: string): number[] | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const parts = [
    Number(match[3]),
    Number(match[2]),
    Number(match[1]),
    Number(match[4]),
    Number(match[5]),
  ];
  const [year, month, day, hour, minute] = parts;
  const utc = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return utc.getUTCFullYear() === year &&
    utc.getUTCMonth() + 1 === month &&
    utc.getUTCDate() === day &&
    utc.getUTCHours() === hour &&
    utc.getUTCMinutes() === minute
    ? parts
    : null;
}
export function parseWallText(text: string): Date | string | null {
  const parts = textParts(text);
  if (!parts) return null;
  const [year, month, day, hour, minute] = parts;
  const date = new Date(year, month - 1, day, hour, minute);
  // A valid Colombo time can fall inside the host timezone's daylight-saving gap.
  // keepInvalid lets DatePicker display that valid wall text without silently moving it an hour.
  return date.getFullYear() === year &&
    date.getMonth() + 1 === month &&
    date.getDate() === day &&
    date.getHours() === hour &&
    date.getMinutes() === minute
    ? date
    : text;
}
export function wallKey(date: Date | string | null): string {
  const parts =
    typeof date === 'string'
      ? textParts(date)
      : date instanceof Date && Number.isFinite(date.getTime())
        ? [
            date.getFullYear(),
            date.getMonth() + 1,
            date.getDate(),
            date.getHours(),
            date.getMinutes(),
          ]
        : null;
  return parts
    ? parts.map((value, index) => String(value).padStart(index === 0 ? 4 : 2, '0')).join('-')
    : '';
}
export function colomboInstant(date: Date | string): string {
  const [year, month, day, hour, minute] = wallKey(date).split('-').map(Number);
  // All supported new (future) schedules use Sri Lanka's current fixed UTC+05:30 offset.
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - 330 * 60_000).toISOString();
}
export function draftChanges(draft: Draft, original: Workshop | null): Partial<WorkshopInput> {
  const changed: Partial<WorkshopInput> = {};
  if (!original || draft.title.trim() !== original.title) changed.title = draft.title.trim();
  if (!original || draft.capacity !== original.capacity)
    changed.capacity = draft.capacity ?? undefined;
  if (!original || draft.registrationOpen !== original.registrationOpen)
    changed.registrationOpen = draft.registrationOpen;
  if (
    (!original || wallKey(draft.schedule) !== wallKey(colomboWallDate(original.startsAt))) &&
    wallKey(draft.schedule)
  ) {
    changed.startsAt = colomboInstant(draft.schedule!);
  }
  return changed;
}
export function draftErrors(
  draft: Draft,
  original: Workshop | null,
  invalidDate: boolean,
  now = Date.now(),
): Partial<Record<WorkshopField, string>> {
  const errors: Partial<Record<WorkshopField, string>> = {};
  const title = draft.title.trim();
  if (!title) errors.title = 'Enter a workshop title.';
  else if ([...title].length > 200) errors.title = 'Use at most 200 characters.';
  if (draft.capacity === null) errors.capacity = 'Enter the workshop capacity.';
  else if (
    !Number.isInteger(draft.capacity) ||
    draft.capacity < 1 ||
    draft.capacity > 2_147_483_647
  )
    errors.capacity = 'Enter a whole number from 1 to 2,147,483,647.';
  else if (original && draft.capacity < original.reservedSeats)
    errors.capacity = `Capacity must be at least ${original.reservedSeats} reserved seats.`;
  const changes = draftChanges(draft, original);
  if (invalidDate || !wallKey(draft.schedule))
    errors.schedule = 'Enter a valid Sri Lanka date and time.';
  else if (changes.startsAt && new Date(changes.startsAt).getTime() <= now)
    errors.schedule = 'Choose a future date and time.';
  else if (
    changes.registrationOpen === true &&
    new Date(changes.startsAt ?? original?.startsAt ?? '').getTime() <= now
  )
    errors.registrationOpen = 'Registration can only open for a future workshop.';
  return errors;
}
