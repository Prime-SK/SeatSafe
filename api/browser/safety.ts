import assert from 'node:assert/strict';

export function assertOwnership(
  schema: string,
  marker: string,
  observed: unknown,
): void {
  assert(
    /^seatsafe_test_[a-f0-9]{32}$/.test(schema),
    'Invalid owned browser schema',
  );
  assert(
    /^SeatSafe browser [a-f0-9-]{36}$/.test(marker),
    'Invalid browser ownership marker',
  );
  assert(
    observed === marker,
    'Browser schema ownership mismatch; cleanup refused',
  );
}
