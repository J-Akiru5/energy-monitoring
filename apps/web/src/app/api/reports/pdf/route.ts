import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { buildConsumptionSummary, parseReportFilters } from "../_lib";

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

function watts(value: number): string {
  return `${value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} W`;
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

    const filters = parseReportFilters(req.nextUrl.searchParams);
    const summary = await buildConsumptionSummary(deviceId, filters);

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

    draw("Energy Monitoring - Filtered Consumption Summary", 20, true, rgb(0.04, 0.32, 0.52));
    draw(`Device ID: ${summary.deviceId}`, 11);
    draw(`Generated: ${new Date(summary.generatedAt).toLocaleString("en-PH")}`, 11);
    draw(
      `Window: ${new Date(summary.filters.fromIso).toLocaleString("en-PH")} → ${new Date(summary.filters.toIso).toLocaleString("en-PH")}`,
      11
    );
    draw(
      `Filters: phase=${summary.filters.phase.toUpperCase()} metric=${summary.filters.metric.toUpperCase()} alertOnly=${summary.filters.alertOnly ? "yes" : "no"} includeBlackout=${summary.filters.includeBlackout ? "yes" : "no"}`,
      11
    );
    draw(`Billing Rate: ${peso(summary.ratePhpPerKwh)} per kWh`, 11);

    y -= 8;
    draw("Current Consumption", 14, true, rgb(0.08, 0.42, 0.26));
    if (summary.filters.metric === "power") {
      draw(`Day average power: ${watts(summary.powerStats.dayAvgW)}`, 11);
      draw(`Week average power: ${watts(summary.powerStats.weekAvgW)}`, 11);
      draw(`Current point: ${watts(summary.powerStats.currentW)}`, 11);
    } else if (summary.filters.metric === "cost") {
      draw(`Day cost estimate: ${peso(summary.current.dayEstimatedPhp)}`, 11);
      draw(`Week cost estimate: ${peso(summary.current.weekEstimatedPhp)}`, 11);
      draw(`Month cost estimate (${summary.current.monthLabel}): ${peso(summary.current.monthEstimatedPhp)}`, 11);
    } else {
      draw(`Day (last 24h): ${kwh(summary.current.dayKwh)}  |  ${peso(summary.current.dayEstimatedPhp)}`, 11);
      draw(`Week (calendar week): ${kwh(summary.current.weekKwh)}  |  ${peso(summary.current.weekEstimatedPhp)}`, 11);
      draw(
        `Month (${summary.current.monthLabel}): ${kwh(summary.current.monthKwh)}  |  ${peso(summary.current.monthEstimatedPhp)}`,
        11
      );
    }

    y -= 8;
    draw("Average Consumption", 14, true, rgb(0.55, 0.32, 0.02));
    if (summary.filters.metric === "power") {
      draw(`Average per day: ${watts(summary.powerStats.dayAvgW)}`, 11);
      draw(`Average per week: ${watts(summary.powerStats.weekAvgW)}`, 11);
      draw(`Average per month: ${watts(summary.powerStats.monthAvgW)}`, 11);
    } else if (summary.filters.metric === "cost") {
      draw(`Average per day: ${peso(summary.averages.dayEstimatedPhp)}`, 11);
      draw(`Average per week: ${peso(summary.averages.weekEstimatedPhp)}`, 11);
      draw(`Average per month: ${peso(summary.averages.monthEstimatedPhp)}`, 11);
    } else {
      draw(`Average per day: ${kwh(summary.averages.dayKwh)}  |  ${peso(summary.averages.dayEstimatedPhp)}`, 11);
      draw(
        `Average per week (rolling): ${kwh(summary.averages.weekKwh)}  |  ${peso(summary.averages.weekEstimatedPhp)}`,
        11
      );
      draw(`Average per month: ${kwh(summary.averages.monthKwh)}  |  ${peso(summary.averages.monthEstimatedPhp)}`, 11);
    }

    y -= 8;
    draw("Monthly History (filtered window)", 14, true, rgb(0.2, 0.24, 0.32));
    if (summary.selectedSeries.length === 0) {
      draw("No monthly data available for the selected filters.", 11);
    } else {
      for (const month of summary.selectedSeries) {
        if (summary.filters.metric === "cost") {
          draw(`${month.period}: ${peso(month.value)}`, 11);
        } else if (summary.filters.metric === "power") {
          draw(`${month.period}: ${month.value.toFixed(2)} W`, 11);
        } else {
          draw(`${month.period}: ${kwh(month.value)}`, 11);
        }
      }
    }

    const bytes = await pdf.save();
    const filename = `consumption-summary-${summary.filters.metric}-${summary.filters.phase}-${summary.current.monthLabel}.pdf`;

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
