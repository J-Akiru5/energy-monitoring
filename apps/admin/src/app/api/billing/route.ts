import { NextRequest, NextResponse } from "next/server";
import { getBillingRate, updateBillingRate } from "@energy/database";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const row = await getBillingRate();
    const ratePhpPerKwh = Number(row?.rate_php_per_kwh ?? 0);

    return NextResponse.json(
      {
        id: row?.id ?? null,
        ratePhpPerKwh,
        updatedAt: row?.updated_at ?? null,
        // Compatibility aliases for existing callers
        rate_php_per_kwh: ratePhpPerKwh,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { ratePerKwh } = await req.json();

    if (typeof ratePerKwh !== "number" || ratePerKwh <= 0) {
      return NextResponse.json(
        { error: "ratePerKwh must be a positive number" },
        { status: 400 }
      );
    }

    await updateBillingRate(ratePerKwh);
    const saved = await getBillingRate();

    return NextResponse.json({
      status: "updated",
      ratePhpPerKwh: Number(saved?.rate_php_per_kwh ?? ratePerKwh),
      updatedAt: saved?.updated_at ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
