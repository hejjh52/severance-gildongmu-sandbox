import { campus } from "../server/data.js";
import { findRoute } from "../server/routing.js";

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const poi = campus.pois.find((item) => item.id === body.destinationPoiId);
    if (!poi) return res.status(400).json({ error: "Unknown destination" });
    const route = findRoute(campus, body.startNodeId, poi.nodeId, body.profile || {});
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(route);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Route calculation failed" });
  }
}
