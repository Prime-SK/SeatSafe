import { WorkshopDatePipe } from './workshop-date.pipe';

describe('WorkshopDatePipe', () => {
  const pipe = new WorkshopDatePipe();
  it('displays 10:00 UTC at 3:30 pm in Sri Lanka', () => {
    expect(pipe.transform('2026-10-16T10:00:00.000Z')).toContain('3:30 pm');
  });
  it('crosses the local calendar boundary', () => {
    const result = pipe.transform('2026-10-16T20:00:00.000Z');
    expect(result).toContain('17 Oct 2026');
    expect(result).toContain('1:30 am');
  });
});
