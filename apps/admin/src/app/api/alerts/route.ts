import { NextRequest, NextResponse } from "next/server";
import { getUnreadAlerts, markAlertRead } from "@energy/database";

export async function GET() {
  try {
    const alerts = await getUnreadAlerts();
    return NextResponse.json({ alerts });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { alertId } = await req.json();
    await markAlertRead(alertId);
    return NextResponse.json({ status: "read" });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
