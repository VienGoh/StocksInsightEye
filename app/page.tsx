"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries, ColorType, IChartApi } from "lightweight-charts";
import { DrawingManager, FibRetracement, HorizontalLine } from "lightweight-charts-drawing";

// ---------------------------------------------------------------------------
// Types — harus sama persis dengan shape response dari /api/stock/[symbol]
// ---------------------------------------------------------------------------

type TraderType = "day" | "swing" | "position";

interface ApiResponse {
  symbol: string;
  price: number;
  date: string;
  candles: {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[];
  indicators: {
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
  };
  fibonacci: Record<
    TraderType,
    {
      high: { date: string; price: number };
      low: { date: string; price: number };
      levels: { ratio: number; price: number }[];
    } | null
  >;
  supportResistance: Record<
    TraderType,
    { price: number; touches: number; type: "support" | "resistance" }[]
  >;
  summary: Record<TraderType, string>;
}

const LOOKBACK_DAYS: Record<TraderType, number> = {
  day: 14,
  swing: 60,
  position: 9999, // seluruh data yang tersedia
};

const TABS: { key: TraderType; label: string }[] = [
  { key: "day", label: "Day Trade" },
  { key: "swing", label: "Swing Trade" },
  { key: "position", label: "Position Trade" },
];

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-neutral-800 py-2.5 last:border-0">
      <span className="text-sm text-neutral-400">{label}</span>
      <span className="font-mono text-sm text-neutral-100">{value}</span>
    </div>
  );
}

function fmt(n: number | null, digits = 1): string {
  return n === null ? "—" : n.toFixed(digits);
}

// ---------------------------------------------------------------------------
// Chart component — render candlestick + Fibonacci overlay for active tab
// ---------------------------------------------------------------------------

function StockChart({ data, activeTab }: { data: ApiResponse; activeTab: TraderType }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#a3a3a3",
      },
      grid: {
        vertLines: { color: "#262626" },
        horzLines: { color: "#262626" },
      },
      width: containerRef.current.clientWidth,
      height: 360,
      timeScale: { borderColor: "#404040" },
      rightPriceScale: { borderColor: "#404040" },
    });
    chartRef.current = chart;

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#f43f5e",
      borderVisible: false,
      wickUpColor: "#10b981",
      wickDownColor: "#f43f5e",
    });

    const relevant = data.candles.slice(-Math.min(LOOKBACK_DAYS[activeTab], data.candles.length));
    series.setData(
      relevant.map((c) => ({
        time: c.date,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );

    const fib = data.fibonacci[activeTab];
    let manager: DrawingManager | null = null;
    if (fib) {
      manager = new DrawingManager();
      manager.attach(chart, series, containerRef.current);
      const fibDrawing = new FibRetracement("fib-auto", [
        { time: fib.low.date, price: fib.low.price },
        { time: fib.high.date, price: fib.high.price },
      ]);
      manager.addDrawing(fibDrawing);
    }

    const srLevels = data.supportResistance[activeTab];
    if (srLevels.length > 0) {
      if (!manager) {
        manager = new DrawingManager();
        manager.attach(chart, series, containerRef.current);
      }
      const anchorTime = relevant[relevant.length - 1]?.date;
      srLevels.forEach((level, idx) => {
        const line = new HorizontalLine(
          `sr-${idx}`,
          [{ time: anchorTime, price: level.price }],
          {
            lineColor: level.type === "support" ? "#10b981" : "#f43f5e",          
            lineWidth: 1,
          }
        );
        manager!.addDrawing(line);
      });
    }

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [data, activeTab]);

  return <div ref={containerRef} className="w-full" />;
}

// ---------------------------------------------------------------------------
// Per-trader-type indicator panels
// ---------------------------------------------------------------------------

function IndicatorPanel({ data, activeTab }: { data: ApiResponse; activeTab: TraderType }) {
  const { indicators: ind } = data;
  const fib = data.fibonacci[activeTab];

  return (
    <div className="mt-4">
      <p className="mb-3 rounded-lg bg-neutral-900 px-3 py-2.5 text-sm text-neutral-300">
        {data.summary[activeTab]}
      </p>

      {activeTab === "day" && (
        <>
          <MetricRow label="RSI (14)" value={fmt(ind.rsi)} />
          <MetricRow
            label="Stochastic %K / %D"
            value={ind.stochastic ? `${fmt(ind.stochastic.k)} / ${fmt(ind.stochastic.d)}` : "—"}
          />
          <MetricRow label="Volume vs rata-rata 20 hari" value={`${(ind.volume / (ind.avgVolume || 1)).toFixed(2)}x`} />
        </>
      )}

      {activeTab === "swing" && (
        <>
          <MetricRow
            label="MACD (value / signal)"
            value={ind.macd ? `${fmt(ind.macd.value, 2)} / ${fmt(ind.macd.signal, 2)}` : "—"}
          />
          <MetricRow label="MA20" value={ind.ma20 ? ind.ma20.toLocaleString("id-ID") : "—"} />
          <MetricRow label="MA50" value={ind.ma50 ? ind.ma50.toLocaleString("id-ID") : "—"} />
          <MetricRow label="MA70" value={ind.ma70 ? ind.ma70.toLocaleString("id-ID") : "—"} />
        </>
      )}

      {activeTab === "position" && (
        <>
          <MetricRow label="MA100" value={ind.ma100 ? ind.ma100.toLocaleString("id-ID") : "—"} />
          <MetricRow label="MA200" value={ind.ma200 ? ind.ma200.toLocaleString("id-ID") : "—"} />
        </>
      )}

      {fib && (
        <div className="mt-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-neutral-500">
            Level Fibonacci ({fib.low.date} → {fib.high.date})
          </p>
          {fib.levels.map((lvl) => (
            <MetricRow
              key={lvl.ratio}
              label={`${(lvl.ratio * 100).toFixed(1)}%`}
              value={lvl.price.toLocaleString("id-ID")}
            />
          ))}
        </div>
      )}

      {data.supportResistance[activeTab].length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-neutral-500">
            Support &amp; Resistance
          </p>
          {data.supportResistance[activeTab].map((level) => (
            <div
              key={level.price}
              className="flex items-center justify-between border-b border-neutral-800 py-2.5 last:border-0"
            >
              <span
                className={`text-xs font-medium uppercase ${
                  level.type === "support" ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {level.type === "support" ? "Support" : "Resistance"}
              </span>
              <span className="font-mono text-sm text-neutral-100">
                {level.price.toLocaleString("id-ID")}
                <span className="ml-2 text-xs text-neutral-500">
                  ({level.touches}x sentuh)
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Home() {
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<TraderType>("swing");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await fetch(`/api/stock/${query.toUpperCase()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Gagal mengambil data");
      setData(json as ApiResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-10 text-neutral-100">
      <div className="mx-auto max-w-2xl">
        <header className="mb-8">
          <h1 className="text-xl font-semibold tracking-tight">StocksInsightEye</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Analisa teknikal saham IDX per gaya trading.
          </p>
        </header>

        <form onSubmit={handleSearch} className="mb-6 flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Kode saham, contoh: BBCA"
            className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm outline-none placeholder:text-neutral-600 focus:border-neutral-600"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-neutral-100 px-4 py-2.5 text-sm font-medium text-neutral-900 transition hover:bg-white disabled:opacity-50"
          >
            {loading ? "Mencari..." : "Cari"}
          </button>
        </form>

        {error && (
          <p className="mb-6 rounded-lg bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
            {error}
          </p>
        )}

        {!data && !loading && !error && (
          <div className="rounded-lg border border-dashed border-neutral-800 px-4 py-10 text-center text-sm text-neutral-600">
            Cari kode saham untuk mulai analisa.
          </div>
        )}

        {data && (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
            <div className="mb-5 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">{data.symbol}</h2>
                <p className="text-sm text-neutral-500">{data.date}</p>
              </div>
              <p className="font-mono text-lg">{data.price.toLocaleString("id-ID")}</p>
            </div>

            <div className="mb-5 flex gap-1 rounded-lg bg-neutral-900 p-1">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
                    activeTab === tab.key
                      ? "bg-neutral-100 text-neutral-900"
                      : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <StockChart data={data} activeTab={activeTab} />
            <IndicatorPanel data={data} activeTab={activeTab} />
          </div>
        )}
      </div>
    </main>
  );
}