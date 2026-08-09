import { NextRequest, NextResponse } from "next/server";
import { getHistoricalPrices } from "@/lib/goapi";
import { computeIndicators, computeFibonacci, computeSupportResistance, summarize } from "@/lib/indicators";

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol: rawSymbol } = await params;
  const symbol = rawSymbol.toUpperCase();

  // ⚠️ GOAPI historical range max 1 tahun (dari dokumentasi PHP SDK mereka).
  // 6 bulan cukup untuk swing; kalau mau position trader lebih akurat
  // (MA200 butuh histori panjang), naikkan ke 1 tahun penuh.
  const to = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - 6);

  try {
    const candles = await getHistoricalPrices(
      symbol,
      formatDate(from),
      formatDate(to)
    );

    if (!candles || candles.length === 0) {
      return NextResponse.json(
        { error: `Tidak ada data historis untuk ${symbol}` },
        { status: 404 }
      );
    }

    // Urutkan naik berdasarkan tanggal — kalkulasi indikator butuh urutan
    // kronologis, dan API kadang mengembalikan urutan terbalik.
    const sorted = [...candles].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const latest = sorted[sorted.length - 1];
    const indicators = computeIndicators(sorted);

    const fibonacci = {
      day: computeFibonacci(sorted, 14),
      swing: computeFibonacci(sorted, 60),
      position: computeFibonacci(sorted, sorted.length),
    };

    const supportResistance = {
      day: computeSupportResistance(sorted.slice(-30), latest.close, { window: 2, tolerancePct: 1 }),
      swing: computeSupportResistance(sorted.slice(-90), latest.close, { window: 3, tolerancePct: 1.5 }),
      position: computeSupportResistance(sorted, latest.close, { window: 5, tolerancePct: 2.5 }),
    };

    const summary = {
      day: summarize("day", indicators, latest.close),
      swing: summarize("swing", indicators, latest.close),
      position: summarize("position", indicators, latest.close),
    };

    return NextResponse.json({
      symbol,
      price: latest.close,
      date: latest.date,
      candles: sorted,
      indicators,
      fibonacci,
      supportResistance,
      summary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}