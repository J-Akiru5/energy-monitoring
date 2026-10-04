import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createClient, resolveAccess, AccessDeniedError } from "@energy/auth";
import { buildConsumptionSummary, parseReportFilters } from "../_lib";
import { buildReportLines, sanitizeWinAnsi } from "./_lines";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

/**
 * GET /api/reports/pdf?deviceId=<id>
 * Returns a downloadable PDF consumption summary report.
 *
 * Auth: requires a logged-in session with "view_energy" on some customer.
 * resolveAccess() resolves which customer the caller is authorized for —
 * that customerId is then passed down into buildConsumptionSummary(), which
 * explicitly filters power_readings and alerts by it.
 */
export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId");

    if (!deviceId) {
      return noStoreJson({ error: "Missing deviceId" }, 400);
    }

    // ── Authenticate the caller ───────────────────────────────
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return noStoreJson({ error: "Not authenticated" }, 401);
    }

    // ── Resolve which customer this caller is authorized for ──
    let customerId: string;
    try {
      const access = await resolveAccess(user.id, "view_energy");
      customerId = access.customerId;
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        return noStoreJson({ error: err.message }, 403);
      }
      throw err;
    }

    const filters = parseReportFilters(req.nextUrl.searchParams);
    const summary = await buildConsumptionSummary(deviceId, customerId, filters);

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]); // A4

    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    let y = 800;
    for (const line of buildReportLines(summary)) {
      y -= line.spaceBefore ?? 0;
      page.drawText(line.text, {
        x: 50,
        y,
        size: line.size,
        font: line.bold ? fontBold : font,
        color: rgb(...line.color),
      });
      y -= 20;
    }

    const bytes = await pdf.save();
    const filename = sanitizeWinAnsi(
      `consumption-summary-${summary.filters.metric}-${summary.filters.phase}-${summary.current.monthLabel}.pdf`
    );

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[/api/reports/pdf] Error:", err);
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}
