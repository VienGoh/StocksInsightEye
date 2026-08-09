// ---------------------------------------------------------------------------
// GOAPI client wrapper
//
// ⚠️ VERIFIKASI WAJIB: base URL, nama header auth, dan path endpoint di bawah
// ini adalah ASUMSI berdasarkan pola REST API umum + struktur folder Postman
// collection GOAPI yang kamu screenshot (stock > idx > {symbol} > prices).
// Saya TIDAK bisa akses dokumentasi resmi mereka langsung.
//
// Buka Postman collection GOAPI kamu, klik salah satu request (misal di
// folder "prices"), lihat tab "Code" > pilih "cURL" — itu akan kasih tau
// PERSIS base URL, header auth yang benar, dan format path-nya.
// Sesuaikan 3 hal di bawah ini kalau beda dari yang saya tebak.
// ---------------------------------------------------------------------------

const GOAPI_BASE_URL = "https://api.goapi.io"; // ✅ confirmed dari docs
const GOAPI_API_KEY = process.env.GOAPI_KEY;

if (!GOAPI_API_KEY) {
  console.warn(
    "[goapi] GOAPI_KEY tidak ditemukan di .env.local — request akan gagal."
  );
}

async function goapiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${GOAPI_BASE_URL}${path}`, {
    headers: {
      // ✅ confirmed dari docs: header-nya X-API-KEY, bukan Authorization Bearer
      "X-API-KEY": GOAPI_API_KEY ?? "",
      Accept: "application/json",
    },
    // Data harian nggak perlu selalu fresh detik itu juga untuk
    // swing/position — cache 5 menit biar hemat kuota API gratis.
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GOAPI request failed: ${res.status} ${res.statusText} — ${body}`
    );
  }

  return res.json() as Promise<T>;
}

export interface GoApiPricePoint {
  date: string; // "2026-08-01"
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * GOAPI membungkus hasilnya dalam beberapa level object yang belum kita
 * ketahui persis namanya. Daripada nebak nama key satu-satu, cari secara
 * rekursif array pertama yang isinya object dengan field "date" dan "close"
 * — itu pasti array data harga OHLC-nya, di kedalaman berapa pun dia berada.
 */
function findPriceArray(node: unknown): GoApiPricePoint[] | null {
  if (Array.isArray(node)) {
    const looksLikePriceArray =
      node.length > 0 &&
      typeof node[0] === "object" &&
      node[0] !== null &&
      "date" in node[0] &&
      "close" in node[0];
    if (looksLikePriceArray) return node as GoApiPricePoint[];
  } else if (node && typeof node === "object") {
    for (const value of Object.values(node)) {
      const found = findPriceArray(value);
      if (found) return found;
    }
  }
  return null;
}

export async function getHistoricalPrices(
  symbol: string,
  from: string,
  to: string
): Promise<GoApiPricePoint[]> {
  const path = `/stock/idx/${symbol}/historical?from=${from}&to=${to}`;
  const data = await goapiFetch<unknown>(path);

  const prices = findPriceArray(data);
  if (!prices) {
    console.log("[goapi] raw response for", symbol, JSON.stringify(data, null, 2));
    throw new Error(
      "Tidak menemukan array data harga di response GOAPI — cek log server untuk struktur aslinya."
    );
  }

  return prices;
}

export interface GoApiCompany {
  code: string;
  name: string;
}

// ✅ confirmed endpoint: GET /stock/idx/companies (belum ada bukti parameter
// "search" didukung — kalau nanti kamu cek dan ternyata ada query param
// pencarian, tambahkan lagi di sini)
export async function searchCompany(query: string): Promise<GoApiCompany[]> {
  const path = `/stock/idx/companies`;
  const data = await goapiFetch<{ data: GoApiCompany[] } | GoApiCompany[]>(
    path
  );
  const all = Array.isArray(data) ? data : data.data;
  const q = query.toLowerCase();
  return all.filter(
    (c) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
  );
}