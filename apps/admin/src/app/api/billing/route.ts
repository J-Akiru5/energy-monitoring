import { NextRequest, NextResponse } from "next/server";
import { getBillingRate, updateBillingRate } from "@energy/database";

export async function GET() {
  try {
    const rate = await getBillingRate();
    return NextResponse.json(rate);
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
    return NextResponse.json({ status: "updated", ratePerKwh });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
