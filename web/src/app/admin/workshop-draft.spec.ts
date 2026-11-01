import { Workshop } from '../workshops/workshop';
import {
  Draft,
  colomboInstant,
  colomboWallDate,
  draftChanges,
  draftErrors,
  wallKey,
  parseWallText,
} from './workshop-draft';
const original: Workshop = {
  id: 'opaque/old',
  title: 'Original',
  capacity: 10,
  reservedSeats: 3,
  availableSeats: 7,
  registrationOpen: true,
  startsAt: '2020-01-01T04:30:17.123Z',
};
const edit = (): Draft => ({
  title: original.title,
  capacity: 10,
  registrationOpen: true,
  schedule: colomboWallDate(original.startsAt),
});
describe('Workshop draft rules', () => {
  it('preserves valid Colombo wall times even inside a host daylight-saving gap', () => {
    const date = parseWallText('11/03/2035 02:30')!;
    expect(colomboInstant(date)).toBe('2035-03-10T21:00:00.000Z');
    expect(wallKey(colomboWallDate('2035-03-10T21:00:00Z'))).toBe('2035-03-11-02-30');
    expect(parseWallText('31/02/2035 02:30')).toBeNull();
  });
  it('does not reschedule a historical instant or send unchanged registration when another field changes', () => {
    expect(draftChanges({ ...edit(), title: ' Updated ' }, original)).toEqual({ title: 'Updated' });
    expect(draftErrors({ ...edit(), title: 'Updated' }, original, false)).toEqual({});
    expect(draftChanges(edit(), original)).toEqual({});
  });
  it('converts a Colombo wall-clock schedule independently of the browser offset', () => {
    const date = new Date(2035, 5, 21, 14, 45);
    expect(colomboInstant(date)).toBe('2035-06-21T09:15:00.000Z');
    expect(wallKey(colomboWallDate('2035-06-21T09:15:00Z'))).toBe('2035-06-21-14-45');
  });
  it('sends all and only permitted create fields', () => {
    expect(
      draftChanges(
        {
          title: ' 😀 workshop ',
          capacity: 12,
          schedule: new Date(2035, 5, 21, 14, 45),
          registrationOpen: true,
        },
        null,
      ),
    ).toEqual({
      title: '😀 workshop',
      capacity: 12,
      startsAt: '2035-06-21T09:15:00.000Z',
      registrationOpen: true,
    });
  });
  it.each([0, -1, 1.5, 2_147_483_648, NaN, Infinity])('rejects invalid capacity %s', (capacity) => {
    expect(draftErrors({ ...edit(), capacity }, original, false).capacity).toBeTruthy();
  });
  it('allows the reserved boundary and PostgreSQL maximum', () => {
    expect(draftErrors({ ...edit(), capacity: 3 }, original, false).capacity).toBeUndefined();
    expect(draftErrors({ ...edit(), capacity: 2 }, original, false).capacity).toContain('reserved');
    expect(
      draftErrors({ ...edit(), capacity: 2_147_483_647 }, original, false).capacity,
    ).toBeUndefined();
  });
  it('counts Unicode code points after trimming', () => {
    expect(
      draftErrors({ ...edit(), title: ' 😀'.repeat(100) }, original, false).title,
    ).toBeUndefined();
    expect(draftErrors({ ...edit(), title: '😀'.repeat(201) }, original, false).title).toBeTruthy();
    expect(draftErrors({ ...edit(), title: '  ' }, original, false).title).toContain('Enter');
  });
  it('rejects null, invalid and typed string dates safely', () => {
    for (const schedule of [null, new Date(NaN), '31/02/2035 10:00' as unknown as Date]) {
      expect(draftErrors({ ...edit(), schedule }, original, false).schedule).toBeTruthy();
    }
    expect(draftErrors(edit(), original, true).schedule).toBeTruthy();
  });
  it('rechecks future schedules at the exact submission boundary', () => {
    const schedule = new Date(2035, 5, 21, 14, 45);
    const now = new Date(colomboInstant(schedule)).getTime();
    expect(draftErrors({ ...edit(), schedule }, original, false, now).schedule).toBeTruthy();
    expect(draftErrors({ ...edit(), schedule }, original, false, now - 1).schedule).toBeUndefined();
  });
  it('permits closing a past workshop but rejects reopening it', () => {
    expect(draftErrors({ ...edit(), registrationOpen: false }, original, false)).toEqual({});
    expect(
      draftErrors(edit(), { ...original, registrationOpen: false }, false).registrationOpen,
    ).toContain('future');
  });
});
