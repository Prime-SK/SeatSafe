import { assertOwnership } from '../browser/safety.js';
const schema = 'seatsafe_test_' + 'a'.repeat(32);
const marker = 'SeatSafe browser 11111111-1111-4111-8111-111111111111';
describe('Browser fixture cleanup boundary', () => {
  it('accepts only the exact owned marker', () => {
    expect(() => assertOwnership(schema, marker, marker)).not.toThrow();
    expect(() => assertOwnership(schema, marker, 'another owner')).toThrow(
      'mismatch',
    );
  });
  it.each(['public', schema + '"; DROP SCHEMA public', 'seatsafe_test_other'])(
    'rejects unsafe schema %s',
    (value) => {
      expect(() => assertOwnership(value, marker, marker)).toThrow(
        'Invalid owned',
      );
    },
  );
});
