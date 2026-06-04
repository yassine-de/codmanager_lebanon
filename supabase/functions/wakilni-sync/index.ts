// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";

const WAKILNI_BASE = Deno.env.get("WAKILNI_API_BASE") || "https://api.wakilni.com/api/v2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function getSupabaseAdmin() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase service configuration");
  return createClient(supabaseUrl, serviceRoleKey);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function wakilniRequest(path: string, token: string, body?: Record<string, unknown>) {
  const response = await fetch(`${WAKILNI_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let payload: any;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok || payload?.success === false || payload?.status === false) {
    throw new Error(`Wakilni ${path} failed: ${response.status} ${JSON.stringify(payload).slice(0, 800)}`);
  }

  return payload;
}

async function wakilniRequestWithFallback(paths: string[], token: string, body?: Record<string, unknown>) {
  let lastError: Error | null = null;

  for (const path of paths) {
    try {
      return await wakilniRequest(path, token, body);
    } catch (error) {
      lastError = error as Error;
      if (!String((error as Error).message || "").includes("404")) break;
    }
  }

  throw lastError || new Error(`Wakilni request failed for ${paths.join(", ")}`);
}

async function wakilniGet(path: string, token: string) {
  const response = await fetch(`${WAKILNI_BASE}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  const text = await response.text();
  let payload: any;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok || payload?.success === false || payload?.status === false) {
    throw new Error(`Wakilni ${path} failed: ${response.status} ${JSON.stringify(payload).slice(0, 800)}`);
  }

  return payload;
}

async function getWakilniToken() {
  const key = Deno.env.get("WAKILNI_API_KEY");
  const secret = Deno.env.get("WAKILNI_API_SECRET");
  if (!key || !secret) throw new Error("Missing WAKILNI_API_KEY or WAKILNI_API_SECRET");

  const params = new URLSearchParams({ key, secret });
  const response = await fetch(`${WAKILNI_BASE}/third_party/auth_token?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  const text = await response.text();
  let payload: any;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`Wakilni auth failed: ${response.status} ${JSON.stringify(payload).slice(0, 500)}`);
  }

  const token = payload.token || payload.data?.token || payload.access_token;
  if (!token) throw new Error("Wakilni auth response did not include a token");
  return String(token);
}

function splitName(name: string | null | undefined) {
  const parts = String(name || "Customer").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Customer", lastName: "-" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ") || "-",
  };
}

function normalizePhone(phone: string | null | undefined) {
  const digits = String(phone || "").replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("961")) return `+${digits}`;
  if (digits.startsWith("0")) return `+961${digits.slice(1)}`;
  return digits ? `+961${digits}` : "";
}

function pickId(payload: any) {
  return payload?.data?.id
    || payload?.data?.order_id
    || payload?.data?.delivery_id
    || payload?.order_id
    || payload?.delivery_id
    || payload?.id
    || payload?.delivery?.id
    || payload?.data?.delivery?.id
    || null;
}

function pickTrackingId(payload: any) {
  return payload?.data?.tracking_id
    || payload?.tracking_id
    || payload?.data?.tracking_number
    || payload?.tracking_number
    || payload?.data?.delivery?.tracking_id
    || null;
}

function pickBulkId(payload: any) {
  return payload?.data?.id
    || payload?.bulk_id
    || payload?.data?.bulk_id
    || payload?.id
    || null;
}

function startBulkPayload() {
  const locationId = Number(Deno.env.get("WAKILNI_WAREHOUSE_LOCATION_ID") || 0);
  const longitude = Number(Deno.env.get("WAKILNI_WAREHOUSE_LONGITUDE") || 0);
  const latitude = Number(Deno.env.get("WAKILNI_WAREHOUSE_LATITUDE") || 0);

  return {
    location_id: Number.isFinite(locationId) ? locationId : 0,
    longitude: Number.isFinite(longitude) ? longitude : 0,
    latitude: Number.isFinite(latitude) ? latitude : 0,
    floor: Deno.env.get("WAKILNI_WAREHOUSE_FLOOR") || "",
    area: Deno.env.get("WAKILNI_WAREHOUSE_AREA") || "Wakilni Warehouse",
  };
}

function deliveryPayload(order: any, product: any) {
  const { firstName, lastName } = splitName(order.customer_name);
  const totalAmount = Number(order.total_amount ?? order.price * order.quantity ?? 0);
  const quantity = Number(order.quantity || 1);
  const area = String(order.customer_city || order.customer_address || "Lebanon").trim();
  const sku = String(product?.sku || product?.display_id || order.order_id || "").trim();
  const productName = String(product?.name || order.product_name || "Product").trim();
  const description = sku ? `${quantity}pc ${productName} ${sku}` : `${quantity}pc ${productName}`;
  const orderRef = Number(String(order.order_id || "").replace(/\D/g, "")) || Date.now();

  return {
    get_order_details: true,
    get_barcode: false,
    waybill: String(order.order_id),
    receiver_id: orderRef,
    receiver_first_name: firstName,
    receiver_last_name: lastName,
    receiver_phone_number: normalizePhone(order.customer_phone),
    receiver_gender: "1",
    receiver_email: "",
    receiver_secondary_phone_number: "",
    receiver_location_id: Number(order.wakilni_receiver_location_id || orderRef),
    receiver_longitude: 0,
    receiver_latitude: 0,
    receiver_building: "",
    receiver_floor: 0,
    receiver_directions: order.customer_address || area || "-",
    receiver_area: area,
    currency: 1,
    cash_collection_type_id: totalAmount > 0 ? 52 : 54,
    collection_amount: totalAmount,
    note: description,
    car_needed: false,
    packages: [
      {
        quantity,
        type_id: 58,
        name: sku || productName,
        sku,
      },
    ],
  };
}

async function syncOrder(supabase: ReturnType<typeof createClient>, orderId: string) {
  const { data: enabledSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "wakilni_api_enabled")
    .maybeSingle();

  if (enabledSetting && String(enabledSetting.value).toLowerCase() !== "true") {
    return { skipped: true, reason: "Wakilni API is disabled" };
  }

  let { data: order } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) {
    const result = await supabase
      .from("orders")
      .select("*")
      .eq("order_id", orderId)
      .maybeSingle();
    order = result.data;
  }

  if (!order) throw new Error(`Order not found: ${orderId}`);
  if (order.confirmation_status !== "confirmed") return { skipped: true, reason: "Order is not confirmed" };
  if (order.delivery_status !== "booked") return { skipped: true, reason: "Order is not booked" };
  if (order.wakilni_order_id || order.wakilni_sync_status === "synced") {
    return {
      skipped: true,
      reason: "Already synced",
      wakilni_order_id: order.wakilni_order_id,
      wakilni_tracking_id: order.wakilni_tracking_id,
    };
  }

  await supabase
    .from("orders")
    .update({ wakilni_sync_status: "pending", wakilni_sync_error: null })
    .eq("id", order.id);

  try {
    const { data: product } = await supabase
      .from("products")
      .select("name, sku, display_id")
      .eq("seller_id", order.seller_id)
      .eq("name", order.product_name)
      .maybeSingle();

    const token = await getWakilniToken();
    const startResponse = await wakilniRequestWithFallback(["/clients/start_bulk", "/start_bulk"], token, startBulkPayload());
    const bulkId = pickBulkId(startResponse);
    if (!bulkId) throw new Error(`Wakilni start_bulk response did not include bulk id: ${JSON.stringify(startResponse).slice(0, 500)}`);

    const addResponse = await wakilniRequestWithFallback(
      [`/clients/add_delivery/${bulkId}`, `/add_delivery/${bulkId}`],
      token,
      deliveryPayload(order, product)
    );
    const endResponse = await wakilniRequestWithFallback([`/clients/end_bulk/${bulkId}`, `/end_bulk/${bulkId}`], token);
    const wakilniOrderId = pickId(addResponse);
    const trackingId = pickTrackingId(addResponse) || pickTrackingId(endResponse);

    await supabase
      .from("orders")
      .update({
        wakilni_order_id: wakilniOrderId ? String(wakilniOrderId) : null,
        wakilni_tracking_id: trackingId ? String(trackingId) : null,
        wakilni_bulk_id: String(bulkId),
        wakilni_sync_status: "synced",
        wakilni_sync_error: null,
        wakilni_synced_at: new Date().toISOString(),
        wakilni_response: { start: startResponse, add: addResponse, end: endResponse },
      })
      .eq("id", order.id);

    return {
      success: true,
      order_id: order.order_id,
      wakilni_order_id: wakilniOrderId,
      wakilni_tracking_id: trackingId,
      wakilni_bulk_id: bulkId,
    };
  } catch (error) {
    const message = String((error as Error)?.message || error);
    await supabase
      .from("orders")
      .update({
        wakilni_sync_status: "failed",
        wakilni_sync_error: message.slice(0, 1000),
      })
      .eq("id", order.id);
    throw error;
  }
}

async function trackOrder(trackingId?: string | null, wakilniOrderId?: string | null) {
  const token = await getWakilniToken();
  const result: any = {
    tracking_id: trackingId || null,
    order_id: wakilniOrderId || null,
    logs: [],
    comments: [],
  };

  if (trackingId) {
    try {
      const statusPayload = await wakilniRequest(`/clients/tracking/orders/${encodeURIComponent(trackingId)}`, token);
      result.status = statusPayload.status_code || statusPayload.status || statusPayload.message;
      result.status_code = statusPayload.status;
      result.completed_on = statusPayload.completed_on || null;
      result.raw_status = statusPayload;
    } catch (error) {
      result.status_error = String((error as Error)?.message || error);
    }
  }

  const query = new URLSearchParams();
  if (trackingId) query.set("tracking_id", trackingId);
  if (wakilniOrderId) query.set("order_id", wakilniOrderId);
  if (query.toString()) {
    try {
      const details = await wakilniGet(`/clients/orders/status?${query.toString()}`, token);
      const data = details?.data || details?.order || details;
      result.raw_details = details;
      result.status = data?.status_code || data?.status || result.status;
      result.status_code = data?.status_id || data?.status || result.status_code;
      result.completed_on = data?.completed_on || data?.updated_at || result.completed_on || null;

      const possibleLogs = data?.logs || data?.tracking || data?.history || details?.logs || details?.tracking || [];
      if (Array.isArray(possibleLogs)) {
        result.logs = possibleLogs.map((event: any) => ({
          status: event.status || event.name || event.description || event.status_code,
          status_code: event.status_id || event.code,
          created_at: event.created_at || event.date || event.datetime || event.completed_on,
        }));
      }

      const possibleComments = data?.comments || data?.comment || details?.comments || details?.comment;
      result.comments = Array.isArray(possibleComments)
        ? possibleComments.map((comment: any) => String(comment?.comment || comment?.text || comment))
        : possibleComments
          ? [String(possibleComments)]
          : [];
    } catch (error) {
      result.details_error = String((error as Error)?.message || error);
    }
  }

  if (!result.status && result.status_error && result.details_error) {
    throw new Error(`${result.status_error}; ${result.details_error}`);
  }

  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();
    const action = body.action || "sync-order";
    const orderId = body.order_id || body.orderId;

    let result: unknown;
    if (action === "sync-order") {
      if (!orderId) throw new Error("order_id required");
      result = await syncOrder(supabase, String(orderId));
    } else if (action === "track") {
      result = await trackOrder(body.tracking_id || body.trackingId, body.wakilni_order_id || body.wakilniOrderId);
    } else {
      throw new Error(`Unknown action: ${action}`);
    }

    return jsonResponse(result);
  } catch (error) {
    const message = String(error?.message || error);
    console.error("wakilni-sync error:", error);
    return jsonResponse({ error: message }, 400);
  }
});
