import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getBillingRate, updateBillingRate } from "@energy/database";
import { createClient, resolveAccess, AccessDeniedError } from "@energy/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    try {
      await resolveAccess(user.id, "manage_billing");
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      throw err;
    }

    const row = await getBillingRate();
    const ratePhpPerKwh = Number(row?.rate_php_per_kwh ?? 0);

    return NextResponse.json(
      {
        id: row?.id ?? null,
        ratePhpPerKwh,
        updatedAt: row?.updated_at ?? null,
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
      { error: "Failed to fetch billing rate" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    try {
      await resolveAccess(user.id, "manage_billing");
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      throw err;
    }

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
      { error: "Failed to update billing rate" },
      { status: 500 }
    );
  }
}
