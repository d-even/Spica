'use client';

import { Bar, BarChart as Chart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface Point {
  label: string;
  value: number;
}

/** One series, so the card title names it and no legend is needed. The tables beneath serve as the table view. */
export function BarChart({ data, format }: { data: Point[]; format: (value: number) => string }) {
  return (
    <div className="h-44">
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--ink-3)', fontSize: 11 }} />
          <YAxis tickLine={false} axisLine={false} width={48} tick={{ fill: 'var(--ink-3)', fontSize: 11 }} tickFormatter={format} />
          <Tooltip
            cursor={{ fill: 'var(--surface-2)' }}
            formatter={(value) => [format(Number(value)), '']}
            separator=""
            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, fontSize: 12 }}
            labelStyle={{ color: 'var(--ink-3)' }}
            itemStyle={{ color: 'var(--ink)' }}
          />
          <Bar dataKey="value" fill="var(--chart)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}

/** The last seven UTC days, oldest first, with totals in dollars. */
export function lastSevenDays<T>(rows: T[], day: (row: T) => string, micros: (row: T) => bigint): Point[] {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.now() - (6 - index) * 86_400_000).toISOString().slice(0, 10);
    const total = rows.filter((row) => day(row).startsWith(date)).reduce((sum, row) => sum + micros(row), 0n);
    return { label: date.slice(5).replace('-', '/'), value: Number(total) / 1_000_000 };
  });
}
