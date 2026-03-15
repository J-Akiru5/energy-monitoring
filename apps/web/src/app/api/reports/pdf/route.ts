import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { buildConsumptionSummary } from "../_lib";

export const dynamic = "force-dynamic";

function peso(value: number): string {
  return `PHP ${value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function kwh(value: number): string {
  return `${value.toLocaleString("en-PH", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })} kWh`;
}

/**
 * GET /api/reports/pdf?deviceId=<id>
 * Returns a downloadable PDF consumption summary report.
 */
export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId");

    if (!deviceId) {
      return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
    }

    const summary = await buildConsumptionSummary(deviceId);

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]); // A4

    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    let y = 800;
    const lineGap = 20;

    const draw = (text: string, size = 12, bold = false, color = rgb(0.15, 0.18, 0.23)) => {
      page.drawText(text, {
        x: 50,
        y,
        size,
        font: bold ? fontBold : font,
        color,
      });
      y -= lineGap;
    };

    draw("Energy Monitoring - Consumption Summary", 20, true, rgb(0.04, 0.32, 0.52));
    draw(`Device ID: ${summary.deviceId}`, 11);
    draw(`Generated: ${new Date(summary.generatedAt).toLocaleString("en-PH")}`, 11);
    draw(`Billing Rate: ${peso(summary.ratePhpPerKwh)} per kWh`, 11);

    y -= 8;
    draw("Current Consumption", 14, true, rgb(0.08, 0.42, 0.26));
    draw(`Day (last 24h): ${kwh(summary.current.dayKwh)}  |  ${peso(summary.current.dayEstimatedPhp)}`, 11);
    draw(`Week (last 7d): ${kwh(summary.current.weekKwh)}  |  ${peso(summary.current.weekEstimatedPhp)}`, 11);
    draw(
      `Month (${summary.current.monthLabel}): ${kwh(summary.current.monthKwh)}  |  ${peso(summary.current.monthEstimatedPhp)}`,
      11
    );

    y -= 8;
    draw("Average Consumption", 14, true, rgb(0.55, 0.32, 0.02));
    draw(`Average per day: ${kwh(summary.averages.dayKwh)}  |  ${peso(summary.averages.dayEstimatedPhp)}`, 11);
    draw(`Average per week: ${kwh(summary.averages.weekKwh)}  |  ${peso(summary.averages.weekEstimatedPhp)}`, 11);
    draw(`Average per month: ${kwh(summary.averages.monthKwh)}  |  ${peso(summary.averages.monthEstimatedPhp)}`, 11);

    y -= 8;
    draw("Monthly History (last 6 complete months)", 14, true, rgb(0.2, 0.24, 0.32));
    if (summary.monthlyHistory.length === 0) {
      draw("No historical monthly data available yet.", 11);
    } else {
      for (const month of summary.monthlyHistory) {
        draw(`${month.period}: ${kwh(month.totalKwh)}`, 11);
      }
    }

    const bytes = await pdf.save();
    const filename = `consumption-summary-${summary.current.monthLabel}.pdf`;

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
