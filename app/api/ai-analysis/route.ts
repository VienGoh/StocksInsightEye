import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

type AIContentPart = {
  type: "text" | "image" | "audio" | "video" | "file" | "unknown";
  text?: string;
  mimeType?: string;
  data?: string;
  uri?: string;
};

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "GEMINI_API_KEY belum dikonfigurasi.",
        },
        { status: 500 }
      );
    }

    const body = await req.json();

    const {
      symbol,
      price,
      date,
      indicators,
      fibonacci,
      supportResistance,
      summary,
    } = body;

    if (!symbol) {
      return NextResponse.json(
        {
          error: "Symbol saham tidak ditemukan.",
        },
        { status: 400 }
      );
    }

    const ai = new GoogleGenAI({
      apiKey,
    });

    const prompt = `
Kamu adalah AI assistant untuk membantu membaca hasil analisis teknikal saham Indonesia.

Analisis saham berikut berdasarkan DATA TEKNIKAL yang diberikan.

PENTING:
- Jangan mengarang data yang tidak diberikan.
- Jangan memberikan jaminan keuntungan.
- Gunakan bahasa Indonesia.
- Fokus pada interpretasi teknikal.
- Jika indikator saling bertentangan, jelaskan konfliknya.
- Jangan hanya mengulang data mentah.
- Berikan analisis yang mudah dibaca.

DATA SAHAM
Symbol: ${symbol}
Harga: ${price}
Tanggal: ${date}

INDICATORS:
${JSON.stringify(indicators, null, 2)}

FIBONACCI:
${JSON.stringify(fibonacci, null, 2)}

SUPPORT & RESISTANCE:
${JSON.stringify(supportResistance, null, 2)}

SUMMARY:
${JSON.stringify(summary, null, 2)}

Berikan:

1. MARKET BIAS
2. MOMENTUM
3. TREND
4. SUPPORT & RESISTANCE
5. FIBONACCI
6. DAY TRADE
7. SWING TRADE
8. POSITION TRADE
9. RISK
10. FINAL SUMMARY

Jangan memberikan kepastian "pasti naik", "pasti turun",
"pasti beli", atau "pasti jual".
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: prompt,
    });

    // ---------------------------------------------------------
    // Ambil seluruh candidate/part dari Gemini
    // ---------------------------------------------------------

    const parts =
      response.candidates?.flatMap(
        (candidate) =>
          candidate.content?.parts ?? []
      ) ?? [];

    const contents: AIContentPart[] = [];

    for (const part of parts) {
      // -------------------------------------------------------
      // TEXT
      // -------------------------------------------------------

      if ("text" in part && part.text) {
        contents.push({
          type: "text",
          text: part.text,
        });

        continue;
      }

      // -------------------------------------------------------
      // INLINE DATA
      // -------------------------------------------------------

      if (
        "inlineData" in part &&
        part.inlineData
      ) {
        const mimeType =
          part.inlineData.mimeType ?? "";

        const data =
          part.inlineData.data ?? "";

        let type: AIContentPart["type"] =
          "unknown";

        if (mimeType.startsWith("image/")) {
          type = "image";
        } else if (
          mimeType.startsWith("audio/")
        ) {
          type = "audio";
        } else if (
          mimeType.startsWith("video/")
        ) {
          type = "video";
        } else {
          type = "file";
        }

        contents.push({
          type,
          mimeType,
          data,
        });

        continue;
      }

      // -------------------------------------------------------
      // FILE DATA / URI
      // -------------------------------------------------------

      if (
        "fileData" in part &&
        part.fileData
      ) {
        const mimeType =
          part.fileData.mimeType ?? "";

        const uri =
          part.fileData.fileUri ?? "";

        let type: AIContentPart["type"] =
          "file";

        if (mimeType.startsWith("image/")) {
          type = "image";
        } else if (
          mimeType.startsWith("audio/")
        ) {
          type = "audio";
        } else if (
          mimeType.startsWith("video/")
        ) {
          type = "video";
        }

        contents.push({
          type,
          mimeType,
          uri,
        });

        continue;
      }

      // -------------------------------------------------------
      // UNKNOWN
      // -------------------------------------------------------

      contents.push({
        type: "unknown",
      });
    }

    // ---------------------------------------------------------
    // Buat compatibility field "analysis"
    // ---------------------------------------------------------

    const analysis = contents
      .filter(
        (item) =>
          item.type === "text" &&
          item.text
      )
      .map((item) => item.text)
      .join("\n\n");

    // ---------------------------------------------------------
    // Return semuanya ke frontend
    // ---------------------------------------------------------

    return NextResponse.json({
      success: true,

      symbol,

      analysis,

      contents,
    });
  } catch (error) {
    console.error(
      "AI Analysis API Error:",
      error
    );

    return NextResponse.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Terjadi kesalahan saat menghubungi Gemini.",
      },
      { status: 500 }
    );
  }
}