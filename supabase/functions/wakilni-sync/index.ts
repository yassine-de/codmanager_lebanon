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
  const digits = normalizePhoneDigits(String(phone || "")).replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("961")) return `+${digits}`;
  if (digits.startsWith("0")) return `+961${digits.slice(1)}`;
  return digits ? `+961${digits}` : "";
}

function normalizePhoneDigits(raw: string): string {
  return String(raw || "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
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
  const sku = String(order.variant_sku || product?.sku || product?.display_id || order.order_id || "").trim();
  const productName = String(order.variant_name ? `${order.product_name} ${order.variant_name}` : (product?.name || order.product_name || "Product")).trim();
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
        name: "Regular Box",
        sku,
      },
    ],
  };
}

function isSafePreCreationRetry(error: string | null | undefined) {
  const message = String(error || "").toLowerCase();
  return message.includes("wakilni auth failed")
    || message.includes("start_bulk failed")
    || message.includes("start bulk");
}

async function finishExistingBulk(
  supabase: ReturnType<typeof createClient>,
  order: any,
  resumed = true,
) {
  if (!order.wakilni_bulk_id || (!order.wakilni_order_id && !order.wakilni_tracking_id)) {
    throw new Error("Cannot resume Wakilni sync without bulk and delivery identifiers");
  }

  await supabase
    .from("orders")
    .update({ wakilni_sync_status: "pending", wakilni_sync_error: null })
    .eq("id", order.id);

  try {
    const token = await getWakilniToken();
    const endResponse = await wakilniRequestWithFallback(
      [`/clients/end_bulk/${order.wakilni_bulk_id}`, `/end_bulk/${order.wakilni_bulk_id}`],
      token,
    );

    await supabase
      .from("orders")
      .update({
        wakilni_sync_status: "synced",
        wakilni_sync_error: null,
        wakilni_synced_at: new Date().toISOString(),
        wakilni_response: {
          ...(order.wakilni_response || {}),
          end: endResponse,
        },
      })
      .eq("id", order.id);

    return {
      success: true,
      resumed,
      order_id: order.order_id,
      wakilni_order_id: order.wakilni_order_id,
      wakilni_tracking_id: order.wakilni_tracking_id,
      wakilni_bulk_id: order.wakilni_bulk_id,
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
  if (
    order.wakilni_sync_status === "failed"
    && order.wakilni_bulk_id
    && (order.wakilni_order_id || order.wakilni_tracking_id)
  ) {
    return await finishExistingBulk(supabase, order);
  }
  if (order.wakilni_order_id || order.wakilni_tracking_id || order.wakilni_sync_status === "synced") {
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

    await supabase
      .from("orders")
      .update({
        wakilni_bulk_id: String(bulkId),
        wakilni_response: { start: startResponse },
      })
      .eq("id", order.id);

    const addResponse = await wakilniRequestWithFallback(
      [`/clients/add_delivery/${bulkId}`, `/add_delivery/${bulkId}`],
      token,
      deliveryPayload(order, product)
    );
    const wakilniOrderId = pickId(addResponse);
    const trackingId = pickTrackingId(addResponse);

    if (!wakilniOrderId && !trackingId) {
      throw new Error(`Wakilni add_delivery response did not include delivery identifiers: ${JSON.stringify(addResponse).slice(0, 500)}`);
    }

    await supabase
      .from("orders")
      .update({
        wakilni_order_id: wakilniOrderId ? String(wakilniOrderId) : null,
        wakilni_tracking_id: trackingId ? String(trackingId) : null,
        wakilni_bulk_id: String(bulkId),
        wakilni_sync_status: "pending",
        wakilni_sync_error: null,
        wakilni_response: { start: startResponse, add: addResponse },
      })
      .eq("id", order.id);

    return await finishExistingBulk(
      supabase,
      {
        ...order,
        wakilni_order_id: wakilniOrderId ? String(wakilniOrderId) : null,
        wakilni_tracking_id: trackingId ? String(trackingId) : null,
        wakilni_bulk_id: String(bulkId),
        wakilni_response: { start: startResponse, add: addResponse },
      },
      false,
    );
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

async function retryFailedOrderCreations(supabase: ReturnType<typeof createClient>, manual = false) {
  const retryBefore = new Date(Date.now() - (manual ? 0 : 10 * 60_000)).toISOString();
  let query = supabase
    .from("orders")
    .select("id, order_id, system_id, confirmation_status, delivery_status, wakilni_order_id, wakilni_tracking_id, wakilni_bulk_id, wakilni_sync_status, wakilni_sync_error, wakilni_response, updated_at")
    .eq("confirmation_status", "confirmed")
    .eq("delivery_status", "booked")
    .eq("wakilni_sync_status", "failed")
    .order("updated_at", { ascending: true })
    .limit(10);

  if (!manual) query = query.lte("updated_at", retryBefore);

  const { data: orders, error } = await query;
  if (error) throw error;

  const results = [];
  for (const order of orders || []) {
    const canResumeBulk = !!order.wakilni_bulk_id
      && !!(order.wakilni_order_id || order.wakilni_tracking_id);
    const safeBeforeCreation = !order.wakilni_bulk_id
      && !order.wakilni_order_id
      && !order.wakilni_tracking_id
      && isSafePreCreationRetry(order.wakilni_sync_error);

    if (!canResumeBulk && !safeBeforeCreation) {
      results.push({
        order_id: order.order_id,
        system_id: order.system_id,
        skipped: true,
        reason: "Ambiguous Wakilni failure requires manual verification",
      });
      continue;
    }

    try {
      const result = await syncOrder(supabase, order.id);
      results.push({
        order_id: order.order_id,
        system_id: order.system_id,
        success: !!result?.success,
        resumed: !!result?.resumed,
        skipped: !!result?.skipped,
        reason: result?.reason || null,
      });
    } catch (error) {
      results.push({
        order_id: order.order_id,
        system_id: order.system_id,
        error: String((error as Error)?.message || error).slice(0, 500),
      });
    }
  }

  return {
    checked: (orders || []).length,
    retried: results.filter((result: any) => !result.skipped).length,
    succeeded: results.filter((result: any) => result.success).length,
    skipped_ambiguous: results.filter((result: any) => result.skipped).length,
    results,
  };
}

async function getSettingMap(supabase: ReturnType<typeof createClient>, keys: string[]) {
  const { data } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", keys);

  const map = new Map<string, string>();
  data?.forEach((row: any) => map.set(row.key, row.value));
  return map;
}

function mapWakilniDeliveryStatus(status?: string | null, statusCode?: string | number | null) {
  const normalizedStatus = String(status || "").toLowerCase().trim();
  const normalizedCode = String(statusCode ?? "").toLowerCase().trim();
  const combined = `${normalizedStatus} ${normalizedCode}`.trim();
  const numericCode = /^\d+$/.test(normalizedCode)
    ? normalizedCode
    : /^\d+$/.test(normalizedStatus)
      ? normalizedStatus
      : "";

  if (numericCode === "10" || combined.includes("pending cancellation")) return "cancelled";
  if (numericCode === "7" || combined.includes("cancelled") || combined.includes("canceled")) return "cancelled";
  if (numericCode === "6" || ["declined", "rejected", "refused"].some((s) => combined.includes(s))) return "rejected";
  if (numericCode === "4" || combined.includes("success")) return "delivered";
  if (numericCode === "2" || numericCode === "3" || combined.includes("confirmed") || combined.includes("processing")) return "shipped";
  if (combined.includes("delivered")) return "delivered";
  if (combined.includes("return")) return "returned";
  if (combined.includes("failed")) return "failed_attempt";
  if (combined.includes("out for delivery") || combined.includes("with courier")) return "with_courier";
  if (combined.includes("transit")) return "in_transit";
  if (combined.includes("picked") || combined.includes("pickup") || combined.includes("shipped")) return "shipped";
  if (combined.includes("pending") || combined.includes("created")) return "booked";

  return null;
}

const ACTIVE_WAKILNI_STATUSES = ["pending", "booked", "shipped", "in_transit", "with_courier", "failed_attempt"];
const STATUS_SYNC_CRON_GRACE_MS = 60_000;
const STATUS_SYNC_INTERVAL_MINUTES: Record<string, number> = {
  with_courier: 15,
  failed_attempt: 30,
  shipped: 60,
  in_transit: 60,
  booked: 180,
  pending: 180,
};
const STATUS_SYNC_PRIORITY: Record<string, number> = {
  with_courier: 1,
  failed_attempt: 2,
  shipped: 3,
  in_transit: 4,
  booked: 5,
  pending: 6,
};

function getStatusSyncIntervalMinutes(status: string | null | undefined) {
  return STATUS_SYNC_INTERVAL_MINUTES[String(status || "")] ?? 180;
}

function isOrderDueForStatusSync(order: any, now: Date, manual = false) {
  if (manual) return true;
  if (!order.wakilni_synced_at) return true;

  const lastSyncedAt = new Date(order.wakilni_synced_at);
  if (Number.isNaN(lastSyncedAt.getTime())) return true;

  const intervalMs = getStatusSyncIntervalMinutes(order.delivery_status) * 60_000;
  return now.getTime() - lastSyncedAt.getTime() >= intervalMs;
}

async function updateLocalOrderStatus(
  supabase: ReturnType<typeof createClient>,
  result: any,
  identifiers: { trackingId?: string | null; wakilniOrderId?: string | null; localOrderId?: string | null; systemId?: string | number | null },
) {
  const mappedStatus = mapWakilniDeliveryStatus(result.status, result.status_code);

  let query = supabase.from("orders").select("id, order_id, delivery_status, delivered_at").limit(1);
  if (identifiers.trackingId) {
    query = query.eq("wakilni_tracking_id", identifiers.trackingId);
  } else if (identifiers.wakilniOrderId) {
    query = query.eq("wakilni_order_id", identifiers.wakilniOrderId);
  } else if (identifiers.localOrderId) {
    query = query.eq("order_id", identifiers.localOrderId);
  } else if (identifiers.systemId) {
    query = query.eq("system_id", identifiers.systemId);
  } else {
    return { ...result, delivery_status: mappedStatus };
  }

  const { data: rows } = await query;
  const order = rows?.[0];
  if (!order) return { ...result, delivery_status: mappedStatus };

  const nowIso = new Date().toISOString();
  const statusChanged = !!mappedStatus && order.delivery_status !== mappedStatus;
  const updatePayload: Record<string, unknown> = {
    wakilni_synced_at: nowIso,
  };

  if (statusChanged) {
    updatePayload.delivery_status = mappedStatus;
    updatePayload.updated_at = nowIso;
    if (mappedStatus === "delivered" && !order.delivered_at) {
      updatePayload.delivered_at = result.completed_on || nowIso;
    }
  }

  await supabase
    .from("orders")
    .update(updatePayload)
    .eq("id", order.id);

  if (statusChanged) {
    const { error: historyError } = await supabase.from("order_history").insert({
      order_id: order.order_id,
      changed_by: null,
      changed_by_role: "system",
      field_changed: "delivery_status",
      old_value: order.delivery_status,
      new_value: mappedStatus,
      action_type: "wakilni_tracking_sync",
    });
    if (historyError) console.error("order_history insert failed:", historyError);
  }

  return {
    ...result,
    delivery_status: mappedStatus,
    local_order_id: order.order_id,
    local_status_updated: statusChanged,
  };
}

async function trackOrder(supabase: ReturnType<typeof createClient>, body: any) {
  const trackingId = body.tracking_id || body.trackingId || null;
  const wakilniOrderId = body.wakilni_order_id || body.wakilniOrderId || null;
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

  return await updateLocalOrderStatus(supabase, result, {
    trackingId,
    wakilniOrderId,
    localOrderId: body.local_order_id || body.localOrderId || null,
    systemId: body.system_id || body.systemId || null,
  });
}

async function syncActiveStatuses(supabase: ReturnType<typeof createClient>, manual = false) {
  const settings = await getSettingMap(supabase, [
    "wakilni_api_enabled",
    "wakilni_status_sync_interval_minutes",
    "wakilni_last_status_sync",
  ]);

  if (String(settings.get("wakilni_api_enabled") || "true").toLowerCase() !== "true") {
    return { skipped: true, reason: "Wakilni API is disabled" };
  }

  const failedRetries = await retryFailedOrderCreations(supabase, manual);
  const intervalMinutes = Math.max(
    1,
    Math.min(1440, Number(settings.get("wakilni_status_sync_interval_minutes") || 30) || 30),
  );
  const lastRunRaw = settings.get("wakilni_last_status_sync");
  const lastRunAt = lastRunRaw ? new Date(lastRunRaw) : null;
  const now = new Date();

  if (!manual && lastRunAt && !Number.isNaN(lastRunAt.getTime())) {
    const nextRunAt = new Date(lastRunAt.getTime() + intervalMinutes * 60_000);
    if (now.getTime() + STATUS_SYNC_CRON_GRACE_MS < nextRunAt.getTime()) {
      return {
        skipped: true,
        reason: "Status sync interval not reached",
        failed_order_retries: failedRetries,
        interval_minutes: intervalMinutes,
        last_run_at: lastRunRaw,
        next_run_at: nextRunAt.toISOString(),
      };
    }
  }

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, order_id, system_id, wakilni_order_id, wakilni_tracking_id, delivery_status, wakilni_synced_at")
    .not("wakilni_tracking_id", "is", null)
    .in("delivery_status", ACTIVE_WAKILNI_STATUSES)
    .order("wakilni_synced_at", { ascending: true, nullsFirst: true })
    .limit(500);

  if (error) throw error;

  const dueOrders = (orders || [])
    .filter((order: any) => isOrderDueForStatusSync(order, now, manual))
    .sort((a: any, b: any) => {
      const priorityDiff = (STATUS_SYNC_PRIORITY[a.delivery_status] ?? 99) - (STATUS_SYNC_PRIORITY[b.delivery_status] ?? 99);
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(a.wakilni_synced_at || 0).getTime() - new Date(b.wakilni_synced_at || 0).getTime();
    })
    .slice(0, 75);

  const results = [];
  for (const order of dueOrders) {
    try {
      const result = await trackOrder(supabase, {
        tracking_id: order.wakilni_tracking_id,
        wakilni_order_id: order.wakilni_order_id,
        local_order_id: order.order_id,
        system_id: order.system_id,
      });
      results.push({
        order_id: order.order_id,
        status: result.status,
        delivery_status: result.delivery_status,
        updated: !!result.local_status_updated,
      });
    } catch (error) {
      results.push({
        order_id: order.order_id,
        error: String((error as Error)?.message || error).slice(0, 500),
      });
    }
  }

  await supabase
    .from("app_settings")
    .upsert(
      { key: "wakilni_last_status_sync", value: now.toISOString(), updated_at: now.toISOString() },
      { onConflict: "key" },
    );

  return {
    success: true,
    failed_order_retries: failedRetries,
    interval_minutes: intervalMinutes,
    active_candidates: (orders || []).length,
    due: dueOrders.length,
    checked: results.length,
    updated: results.filter((result: any) => result.updated).length,
    results,
  };
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
      result = await trackOrder(supabase, body);
    } else if (action === "sync-statuses") {
      result = await syncActiveStatuses(supabase, body.manual === true);
    } else if (action === "retry-failed") {
      result = await retryFailedOrderCreations(supabase, body.manual === true);
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
