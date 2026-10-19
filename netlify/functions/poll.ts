import type { Config } from "@netlify/functions";
import { liveDeps } from "../../server/deps";
import { getState, getTg, sync } from "../../server/service";

// Netlify cannot hold a live Telegram connection, so the assistant checks for new messages once a minute.
export default async () => {
  const d = liveDeps();
  try {
    const st = await getState(d);
    if (!st.running || (await getTg(d)).status !== "connected") return;
    await sync(d);
  } catch (e) {
    console.error("poll failed:", e instanceof Error ? e.name : "unknown");
  }
};

export const config: Config = { schedule: "* * * * *" };
