import type { DataSource } from 'typeorm';
/** Additive feature tables may not exist before their development rollout. */
export async function publicBookingRows(
  database: DataSource,
): Promise<unknown[]> {
  return Promise.all(
    ['bookings', 'booking_idempotency_records'].map(async (table) => {
      const result = await database.query(
        'SELECT to_regclass($1) AS table_name',
        [`public.${table}`],
      );
      return result[0].table_name
        ? database.query(`SELECT * FROM public."${table}" ORDER BY id`)
        : [];
    }),
  );
}
