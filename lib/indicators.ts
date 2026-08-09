import { MACD, Stochastic, SMA, RSI } from "technicalindicators";
import type { GoApiPricePoint } from "./goapi";

export interface ComputedIndicators {
  macd: { value: number; signal: number; histogram: number } | null;
  stochastic: { k: number; d: number } | null;
  rsi: number | null;
  ma20: number | null;
  ma50: number | null;
  ma70: number | null;
  ma100: number | null;
  ma200: number | null;
  volume: number;
  avgVolume: number;
}

/**
 * Deteksi lonjakan harga tidak wajar antar-hari (>25%) yang biasanya
 * indikasi corporate action (rights issue, stock split, reverse split, dll),
 * bukan pergerakan pasar organik. Kalau ketemu di dalam window yang diminta,
 * potong data supaya cuma pakai periode SETELAH lonjakan terakhir —
 * biar Fibonacci/support-resistance nggak ke-tarik ke titik distorsi.
 */
function trimAfterLastAnomaly(
  candles: GoApiPricePoint[],
  thresholdPct = 25
): GoApiPricePoint[] {
  let lastAnomalyIndex = -1;

  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].close;
    const change = Math.abs((candles[i].close - prevClose) / prevClose) * 100;
    if (change > thresholdPct) lastAnomalyIndex = i;
  }

  if (lastAnomalyIndex === -1) return candles;
  return candles.slice(lastAnomalyIndex);
}

export interface SwingPoint {
  date: string;
  price: number;
}

export interface FibonacciLevels {
  high: SwingPoint;
  low: SwingPoint;
  levels: { ratio: number; price: number }[];
}

const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** Ambil nilai terakhir dari array hasil kalkulasi indikator, atau null kalau kosong. */
function last<T>(arr: T[]): T | null {
  return arr.length > 0 ? arr[arr.length - 1] : null;
}

export function computeIndicators(candles: GoApiPricePoint[]): ComputedIndicators {
  const close = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);

  const macdResult = MACD.calculate({
    values: close,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const macdLast = last(macdResult);

  const stochResult = Stochastic.calculate({
    high: highs,
    low: lows,
    close,
    period: 14,
    signalPeriod: 3,
  });
  const stochLast = last(stochResult);

  const rsiResult = RSI.calculate({ values: close, period: 14 });

  const ma = (period: number) => {
    const result = SMA.calculate({ values: close, period });
    return last(result);
  };

  const recentVolume = volumes.slice(-20);
  const avgVolume =
    recentVolume.reduce((sum, v) => sum + v, 0) / (recentVolume.length || 1);

  return {
    macd: macdLast
      ? {
          value: macdLast.MACD ?? 0,
          signal: macdLast.signal ?? 0,
          histogram: macdLast.histogram ?? 0,
        }
      : null,
    stochastic: stochLast ? { k: stochLast.k, d: stochLast.d } : null,
    rsi: last(rsiResult),
    ma20: ma(20),
    ma50: ma(50),
    ma70: ma(70),
    ma100: ma(100),
    ma200: ma(200),
    volume: volumes[volumes.length - 1] ?? 0,
    avgVolume,
  };
}

/**
 * Cari swing high & swing low sederhana: harga tertinggi dan terendah
 * dalam N candle terakhir. Cukup untuk MVP — bukan pivot-point detection
 * yang lebih presisi untuk tren dengan banyak swing kecil.
 */
export function computeFibonacci(
  candles: GoApiPricePoint[],
  lookback: number
): FibonacciLevels | null {
  const rawWindow = candles.slice(-lookback);
  const window = trimAfterLastAnomaly(rawWindow);
  if (window.length === 0) return null;

  let high = window[0];
  let low = window[0];

  for (const candle of window) {
    if (candle.high > high.high) high = candle;
    if (candle.low < low.low) low = candle;
  }

  const highPoint: SwingPoint = { date: high.date, price: high.high };
  const lowPoint: SwingPoint = { date: low.date, price: low.low };
  const range = highPoint.price - lowPoint.price;

  const levels = FIB_RATIOS.map((ratio) => ({
    ratio,
    price: highPoint.price - range * ratio,
  }));

  return { high: highPoint, low: lowPoint, levels };
}

export interface SupportResistanceLevel {
  price: number;
  touches: number;
  type: "support" | "resistance";
}

/**
 * Cari support & resistance dari pivot point:
 * 1. Deteksi pivot high/low (titik balik lokal, bukan cuma max/min global)
 * 2. Cluster level yang berdekatan (dalam toleransi %) jadi satu zona
 * 3. Ranking berdasarkan jumlah "sentuhan" — makin sering harga reaksi di
 *    situ, makin kuat levelnya
 */
export function computeSupportResistance(
  candles: GoApiPricePoint[],
  currentPrice: number,
  options: { window?: number; tolerancePct?: number; maxLevels?: number } = {}
): SupportResistanceLevel[] {
  const window = options.window ?? 3;
  const tolerancePct = options.tolerancePct ?? 1.5;
  const maxLevels = options.maxLevels ?? 4;

  const cleaned = trimAfterLastAnomaly(candles);
  const pivotPrices: number[] = [];

  for (let i = window; i < cleaned.length - window; i++) {
    const slice = cleaned.slice(i - window, i + window + 1);
    const current = cleaned[i];

    const isPivotHigh = slice.every((c) => c.high <= current.high);
    const isPivotLow = slice.every((c) => c.low >= current.low);

    if (isPivotHigh) pivotPrices.push(current.high);
    if (isPivotLow) pivotPrices.push(current.low);
  }

  if (pivotPrices.length === 0) return [];

  // Cluster harga yang berdekatan (dalam toleransi %) jadi satu zona
  const sorted = [...pivotPrices].sort((a, b) => a - b);
  const clusters: { prices: number[] }[] = [];

  for (const price of sorted) {
    const lastCluster = clusters[clusters.length - 1];
    const avgOfLast = lastCluster
      ? lastCluster.prices.reduce((s, p) => s + p, 0) / lastCluster.prices.length
      : null;

    if (lastCluster && avgOfLast !== null && Math.abs(price - avgOfLast) / avgOfLast * 100 <= tolerancePct) {
      lastCluster.prices.push(price);
    } else {
      clusters.push({ prices: [price] });
    }
  }

  const levels: SupportResistanceLevel[] = clusters.map((cluster) => {
    const avgPrice = cluster.prices.reduce((s, p) => s + p, 0) / cluster.prices.length;
    return {
      price: Math.round(avgPrice),
      touches: cluster.prices.length,
      type: avgPrice < currentPrice ? "support" : "resistance",
    };
  });

  // Ambil level terkuat (paling banyak sentuhan) untuk masing-masing sisi
  const support = levels
    .filter((l) => l.type === "support")
    .sort((a, b) => b.touches - a.touches || b.price - a.price)
    .slice(0, maxLevels);

  const resistance = levels
    .filter((l) => l.type === "resistance")
    .sort((a, b) => b.touches - a.touches || a.price - b.price)
    .slice(0, maxLevels);

  return [...support, ...resistance].sort((a, b) => a.price - b.price);
}
export function summarize(
  type: "day" | "swing" | "position",
  ind: ComputedIndicators,
  price: number
): string {
  if (type === "day") {
    const volRatio = ind.volume / (ind.avgVolume || 1);
    const parts: string[] = [];
    if (ind.rsi !== null) {
      parts.push(
        ind.rsi > 70
          ? "RSI menunjukkan kondisi overbought"
          : ind.rsi < 30
          ? "RSI menunjukkan kondisi oversold"
          : "RSI dalam rentang netral"
      );
    }
    parts.push(
      volRatio > 1.3
        ? "volume di atas rata-rata 20 hari terakhir"
        : "volume masih dalam rentang normal"
    );
    return parts.join(", ") + ".";
  }

  if (type === "swing") {
    const parts: string[] = [];
    if (ind.macd) {
      parts.push(
        ind.macd.histogram > 0
          ? "MACD histogram positif (momentum cenderung naik)"
          : "MACD histogram negatif (momentum cenderung turun)"
      );
    }
    if (ind.ma20 && ind.ma50) {
      parts.push(
        ind.ma20 > ind.ma50
          ? "MA20 berada di atas MA50"
          : "MA20 berada di bawah MA50"
      );
    }
    return parts.join(", ") + ".";
  }

  // position
  const parts: string[] = [];
  if (ind.ma200) {
    parts.push(
      price > ind.ma200
        ? "harga berada di atas MA200 (tren jangka panjang cenderung bullish)"
        : "harga berada di bawah MA200 (tren jangka panjang cenderung bearish)"
    );
  }
  return parts.join(", ") + ".";
}