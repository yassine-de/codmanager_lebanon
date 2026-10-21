// @ts-nocheck
// Scrapes the product's store URL via Firecrawl and caches the result in
// `products.ai_context`. Returns cached value if scraped within last 7 days,
// unless `force=true`. Requires admin auth (or service role internal call).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const FIRECRAWL_URL = "https://api.firecrawl.dev/v2/scrape";
const MAX_CONTEXT_CHARS = 8000; // keep prompt cost reasonable

const log = (...a: unknown[]) => console.log("[product-context]", ...a);
const errLog = (...a: unknown[]) => console.error("[product-context]", ...a);
const redactSecret = (value: string) => {
  if (!value) return "missing";
  if (value.length <= 8) return `${value.slice(0, 2)}…${value.slice(-2)}`;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
};

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)));
}

function extractMeta(html: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1].trim());
  }
  return "";
}

async function scrapeDirect(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; CODManagerProductBot/1.0)",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`store page returned ${response.status}`);
  const html = await response.text();
  const title = extractMeta(html, "og:title") ||
    decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || "");
  const description = extractMeta(html, "description") || extractMeta(html, "og:description");
  let image = extractMeta(html, "og:image") || extractMeta(html, "twitter:image") || null;
  let structuredProduct: any = null;
  const productAttribute = html.match(/:product=["']([\s\S]*?)["']\s*(?:[:@][\w-]+=|>)/i)?.[1];
  if (productAttribute) {
    try {
      structuredProduct = JSON.parse(decodeHtml(productAttribute));
      if (!image && /^https?:\/\//i.test(structuredProduct?.thumbnail || "")) {
        image = structuredProduct.thumbnail;
      }
    } catch {
      structuredProduct = null;
    }
  }

  const visibleText = decodeHtml(
    html
      .replace(/<(script|style|noscript|template|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(?:br|\/p|\/div|\/section|\/article|\/li|\/h[1-6])\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line, index, all) => line.length > 1 && line !== all[index - 1])
    .join("\n");
  const variants = Array.isArray(structuredProduct?.variants)
    ? structuredProduct.variants
        .map((variant: any) => Object.values(variant?.variations || {}).join(" / "))
        .filter(Boolean)
    : [];
  const structuredText = structuredProduct
    ? [
        structuredProduct.name ? `Product: ${structuredProduct.name}` : null,
        structuredProduct.description ? `Description: ${structuredProduct.description}` : null,
        Number.isFinite(structuredProduct.price) ? `Price: ${structuredProduct.price}` : null,
        Number.isFinite(structuredProduct.compare_at_price)
          ? `Previous/compare price: ${structuredProduct.compare_at_price}`
          : null,
        variants.length ? `Available options: ${variants.join(", ")}` : null,
      ].filter(Boolean).join("\n")
    : "";
  const text = [structuredText, visibleText]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_CONTEXT_CHARS);
  if (!text) throw new Error("store page contained no readable text");
  return { markdown: text, metadata: { title, description, ogImage: image } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const productId: string | undefined = body?.product_id;
    const force: boolean = !!body?.force;
    if (!productId || typeof productId !== "string") {
      return new Response(JSON.stringify({ error: "product_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY") || "";

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: product, error: prodErr } = await admin
      .from("products")
      .select("id,name,product_url,ai_context,ai_context_scraped_at,scraped_image_url")
      .eq("id", productId)
      .maybeSingle();

    if (prodErr || !product) {
      return new Response(JSON.stringify({ error: "product not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = (product.product_url || "").trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      return new Response(JSON.stringify({ error: "product has no valid product_url" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cache check
    const scrapedAt = product.ai_context_scraped_at ? new Date(product.ai_context_scraped_at).getTime() : 0;
    const fresh = product.ai_context && scrapedAt && (Date.now() - scrapedAt) < CACHE_TTL_MS;
    if (fresh && !force) {
      log("cache hit", { productId, ageHours: ((Date.now() - scrapedAt) / 3.6e6).toFixed(1) });
      return new Response(
        JSON.stringify({
          cached: true,
          ai_context: product.ai_context,
          ai_context_scraped_at: product.ai_context_scraped_at,
          scraped_image_url: product.scraped_image_url ?? null,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    log("scraping", { productId, url, provider: FIRECRAWL_API_KEY ? "firecrawl" : "direct" });
    let data: any = null;
    if (FIRECRAWL_API_KEY) {
      try {
        const fcRes = await fetch(FIRECRAWL_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
        });
        const fcJson: any = await fcRes.json().catch(() => ({}));
        if (fcRes.ok) data = fcJson?.data ?? fcJson;
        else errLog("firecrawl failed; using direct fallback", fcRes.status, fcJson?.error || null);
      } catch (error) {
        errLog("firecrawl unavailable; using direct fallback", (error as Error).message);
      }
    }
    if (!data?.markdown) data = await scrapeDirect(url);

    const markdown: string = data?.markdown || "";
    const metadata = data?.metadata || {};
    if (!markdown) {
      errLog("firecrawl returned no markdown", fcJson);
      return new Response(JSON.stringify({ error: "no content scraped" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Compose a compact context: header + truncated markdown
    const header = [
      metadata?.title ? `Title: ${metadata.title}` : null,
      metadata?.description ? `Description: ${metadata.description}` : null,
      `Source: ${url}`,
    ].filter(Boolean).join("\n");
    const trimmed = markdown.length > MAX_CONTEXT_CHARS
      ? markdown.slice(0, MAX_CONTEXT_CHARS) + "\n\n[…truncated…]"
      : markdown;
    const aiContext = `${header}\n\n${trimmed}`;

    // Extract product image from metadata (og:image / twitter:image / first markdown img).
    let scrapedImage: string | null = null;
    const candidates: unknown[] = [
      metadata?.ogImage,
      metadata?.["og:image"],
      metadata?.twitterImage,
      metadata?.["twitter:image"],
      metadata?.image,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && /^https?:\/\//i.test(c)) {
        scrapedImage = c;
        break;
      }
      if (Array.isArray(c)) {
        const first = c.find((v) => typeof v === "string" && /^https?:\/\//i.test(v));
        if (first) {
          scrapedImage = first as string;
          break;
        }
      }
    }
    if (!scrapedImage) {
      // Fallback: first ![](url) image in markdown
      const m = markdown.match(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/);
      if (m) scrapedImage = m[1];
    }

    const nowIso = new Date().toISOString();
    const updatePayload: Record<string, unknown> = {
      ai_context: aiContext,
      ai_context_scraped_at: nowIso,
    };
    if (scrapedImage) updatePayload.scraped_image_url = scrapedImage;

    const { error: updErr } = await admin
      .from("products")
      .update(updatePayload)
      .eq("id", productId);
    if (updErr) {
      errLog("update failed", updErr);
      return new Response(JSON.stringify({ error: "failed to save context" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    log("scraped", { productId, chars: aiContext.length, image: scrapedImage ? "yes" : "no" });
    return new Response(
      JSON.stringify({
        cached: false,
        ai_context: aiContext,
        ai_context_scraped_at: nowIso,
        scraped_image_url: scrapedImage,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    errLog("unhandled", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
