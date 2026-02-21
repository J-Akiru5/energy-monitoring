import { NextRequest } from "next/server";
import { getLatestReading } from "@energy/database";

/**
 * GET /api/stream?deviceId=<id>
 *
 * Server-Sent Events endpoint.
 * Pushes fresh readings to the dashboard every 2 seconds.
 */
export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get("deviceId");

  if (!deviceId) {
    return new Response("Missing deviceId param", { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Send a reading every 2 seconds
      const interval = setInterval(async () => {
        try {
          const reading = await getLatestReading(deviceId);
          if (reading) {
            const data = `data: ${JSON.stringify(reading)}\n\n`;
            controller.enqueue(encoder.encode(data));
          }
        } catch {
          // If we can't read, send a heartbeat comment to keep connection alive
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        }
      }, 2000);

      // Cleanup on close
      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
