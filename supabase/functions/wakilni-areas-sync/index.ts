import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const WAKILNI_BASE = "https://api.wakilni.com/api/v2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface WakilniAreaRow {
  area_id: number;
  area_name: string;
  parent_id: number | null;
  raw_data: Record<string, unknown>;
  last_updated: string;
}

function pickAreaName(area: Record<string, unknown>): string {
  return String(area.name || area.area_name || area.title || area.label || "").trim();
}

function pickAreaId(area: Record<string, unknown>): number | null {
  const raw = area.id || area.area_id || area.location_id;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickParentId(area: Record<string, unknown>): number | null {
  const raw = area.parent_id || area.city_id || area.region_id || null;
  if (raw === null || raw === undefined || raw === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractAreas(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (!payload || typeof payload !== "object") return [];

  const obj = payload as Record<string, unknown>;
  if (Array.isArray(obj.data)) return obj.data as Record<string, unknown>[];
  if (Array.isArray(obj.areas)) return obj.areas as Record<string, unknown>[];

  if (obj.data && typeof obj.data === "object") {
    const data = obj.data as Record<string, unknown>;
    if (Array.isArray(data.data)) return data.data as Record<string, unknown>[];
    if (Array.isArray(data.areas)) return data.areas as Record<string, unknown>[];
  }

  return [];
}

function hasMorePages(payload: unknown, page: number): boolean {
  if (!payload || typeof payload !== "object") return false;
  const obj = payload as Record<string, unknown>;
  const meta = (obj.meta && typeof obj.meta === "object" ? obj.meta : obj) as Record<string, unknown>;

  const currentPage = Number(meta.current_page || page);
  const lastPage = Number(meta.last_page || meta.total_pages || 0);
  if (Number.isFinite(lastPage) && lastPage > 0) return currentPage < lastPage;

  const nextPageUrl = meta.next_page_url || meta.next;
  return Boolean(nextPageUrl);
}

async function getWakilniToken() {
  const key = Deno.env.get("WAKILNI_API_KEY");
  const secret = Deno.env.get("WAKILNI_API_SECRET");
  if (!key || !secret) {
    throw new Error("Missing WAKILNI_API_KEY or WAKILNI_API_SECRET");
  }

  const params = new URLSearchParams({ key, secret });
  const response = await fetch(`${WAKILNI_BASE}/third_party/auth_token?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Wakilni auth failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  const token = payload.token || payload.data?.token;
  if (!token) throw new Error("Wakilni auth response did not include a token");
  return String(token);
}

async function fetchAreas(token: string) {
  const areas: Record<string, unknown>[] = [];
  let page = 1;

  while (page <= 100) {
    const url = `${WAKILNI_BASE}/areas?with_pagination=true&page=${page}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Wakilni areas failed: ${response.status} ${await response.text()}`);
    }

    const payload = await response.json();
    const pageAreas = extractAreas(payload);
    areas.push(...pageAreas);

    if (pageAreas.length === 0 || !hasMorePages(payload, page)) break;
    page += 1;
  }

  return areas;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing Supabase service configuration");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const token = await getWakilniToken();
    const areas = await fetchAreas(token);
    const now = new Date().toISOString();

    const rows: WakilniAreaRow[] = areas
      .map((area) => {
        const areaId = pickAreaId(area);
        const areaName = pickAreaName(area);
        if (!areaId || !areaName) return null;
        return {
          area_id: areaId,
          area_name: areaName,
          parent_id: pickParentId(area),
          raw_data: area,
          last_updated: now,
        };
      })
      .filter((row): row is WakilniAreaRow => Boolean(row));

    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase
        .from("wakilni_areas_cache")
        .upsert(rows.slice(i, i + 200), { onConflict: "area_id" });
      if (error) throw error;
    }

    return new Response(JSON.stringify({ success: true, fetched: areas.length, cached: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: String(error?.message || error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
