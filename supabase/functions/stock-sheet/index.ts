import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STOCK_SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1hZUPZn6nbekGXRr8hfvhdVTIH21IY3NbjnXIw39LsKU/export?format=csv&gid=10108684";

function normalizeSku(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
}

function parseStockRows(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const pushField = () => {
    if (row.length < 6) row.push(field);
    field = "";
  };

  const pushRow = () => {
    pushField();
    if (row.length >= 6) rows.push(row);
    row = [];
  };

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];

    if (quoted) {
      if (char === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      pushField();
    } else if (char === "\n") {
      pushRow();
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length > 0) pushRow();
  return rows;
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const response = await fetch(STOCK_SHEET_CSV_URL, {
      headers: { "User-Agent": "COD-Manager-Lebanon/1.0" },
    });

    if (!response.ok) {
      throw new Error(`Google Sheet returned ${response.status}`);
    }

    const csv = await response.text();
    const rows = parseStockRows(csv);
    const stocks: Record<string, number> = {};

    rows.slice(1).forEach((columns) => {
      const sku = normalizeSku(columns[1] || "");
      const remainingText = String(columns[5] || "").trim().replace(",", ".");
      const remaining = Number(remainingText);

      if (!sku || !Number.isFinite(remaining)) return;
      stocks[sku] = remaining;
    });

    return new Response(
      JSON.stringify({
        stocks,
        source: STOCK_SHEET_CSV_URL,
        synced_at: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
