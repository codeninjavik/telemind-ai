import type { Config } from "@netlify/functions";
import { handle } from "../../server/api";
import { liveDeps } from "../../server/deps";

export default async (req: Request) => handle(req, liveDeps());

export const config: Config = { path: "/api/*" };
