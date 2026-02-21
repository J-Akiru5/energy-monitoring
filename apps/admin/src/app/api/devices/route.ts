import { NextRequest, NextResponse } from "next/server";
import { listDevices, deactivateDevice } from "@energy/database";

export async function GET() {
  try {
    const devices = await listDevices();
    return NextResponse.json({ devices });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { deviceId, action } = await req.json();

    if (action === "deactivate") {
      await deactivateDevice(deviceId);
      return NextResponse.json({ status: "deactivated" });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
