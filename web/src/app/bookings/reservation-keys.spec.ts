import { TestBed } from '@angular/core/testing';
import { ReservationKeys, RESERVATION_ENVIRONMENT } from './reservation-keys';
import { memoryStorage } from './booking-fixtures.spec-helper';
describe('Reload-safe reservation keys', () => {
  let storage: Storage, keys: ReservationKeys;
  let environment: { storage: () => Storage; uuid: () => string };
  beforeEach(() => {
    storage = memoryStorage();
    environment = {
      storage: () => storage,
      uuid: vi.fn().mockReturnValue('4302f733-de5b-4fca-8961-6ec85f79acc9'),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: RESERVATION_ENVIRONMENT, useValue: environment }],
    });
    keys = TestBed.inject(ReservationKeys);
  });
  it('persists only the version/account/workshop/key and reuses it after recreation', () => {
    const key = keys.obtain('account', 'legacy/id');
    expect(JSON.parse(storage.getItem(storage.key(0)!)!)).toEqual({
      version: 1,
      accountId: 'account',
      workshopId: 'legacy/id',
      key,
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: RESERVATION_ENVIRONMENT, useValue: environment }],
    });
    expect(TestBed.inject(ReservationKeys).obtain('account', 'legacy/id')).toBe(key);
    expect(environment.uuid).toHaveBeenCalledTimes(1);
  });
  it('keeps independent workshop records and never removes another unfinished attempt', () => {
    keys.obtain('account', 'one');
    keys.obtain('account', 'two');
    expect(keys.remove('account', 'one')).toBe(true);
    expect(keys.peek('account', 'two')).toBeTruthy();
    expect(keys.peek('other', 'two')).toBeNull();
  });
  it.each([
    '{',
    'null',
    '[]',
    '{"version":2}',
    '{"version":1,"accountId":"wrong","workshopId":"one","key":"valid-request-key-0001"}',
    '{"version":1,"accountId":"account","workshopId":"one","key":"valid-request-key-0001","token":"not-allowed"}',
  ])('blocks corrupt/mismatched records %s without replacing them', (raw) => {
    keys.obtain('account', 'one');
    const slot = storage.key(0)!;
    storage.setItem(slot, raw);
    expect(() => keys.obtain('account', 'one')).toThrow();
    expect(storage.getItem(slot)).toBe(raw);
    expect(keys.remove('account', 'one')).toBe(true);
  });
  it.each(['storage', 'read', 'write', 'uuid', 'verification'])(
    'fails closed for %s errors',
    (kind) => {
      if (kind === 'storage')
        environment.storage = () => {
          throw Error('private storage detail');
        };
      if (kind === 'read')
        storage.getItem = () => {
          throw Error();
        };
      if (kind === 'write')
        storage.setItem = () => {
          throw Error();
        };
      if (kind === 'uuid')
        environment.uuid = () => {
          throw Error();
        };
      if (kind === 'verification') storage.setItem = () => undefined;
      expect(() => keys.obtain('account', 'one')).toThrow('Reservation storage is unavailable');
    },
  );
  it('purges only SeatSafe request slots on logout or verified account switch', () => {
    keys.obtain('old', 'one');
    keys.obtain('new', 'two');
    storage.setItem('unrelated', 'preserve');
    keys.retainAccount('new');
    expect(keys.peek('old', 'one')).toBeNull();
    expect(keys.peek('new', 'two')).toBeTruthy();
    keys.clear();
    expect(storage.length).toBe(1);
    expect(storage.getItem('unrelated')).toBe('preserve');
  });
  it('does not remove a newer record from a late cleanup', () => {
    const key = keys.obtain('account', 'one');
    storage.setItem(
      storage.key(0)!,
      JSON.stringify({
        version: 1,
        accountId: 'account',
        workshopId: 'one',
        key: 'another-new-key-0001',
      }),
    );
    expect(keys.remove('account', 'one', key)).toBe(true);
    expect(keys.peek('account', 'one')).not.toBe(key);
  });
});
