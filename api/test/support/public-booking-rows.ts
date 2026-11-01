import type { DataSource } from 'typeorm';
/** Public bookings may not exist until the additive development migration is applied. */
export async function publicBookingRows(
  database: DataSource,
): Promise<unknown[]> {
  const result = await database.query(
    "SELECT to_regclass('public.bookings') AS table_name",
  );
  return result[0].table_name
    ? database.query('SELECT * FROM public.bookings ORDER BY id')
    : [];
}
