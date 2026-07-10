import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Search, Truck, WalletCards } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type DeliveredOrder = {
  id: string;
  order_id: string | null;
  system_id: number | null;
  created_at: string;
  updated_at: string;
  delivered_at: string | null;
  delivered_status_at?: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_city: string | null;
  product_name: string | null;
  quantity: number | null;
  total_amount: number | null;
  delivery_status: string | null;
  wakilni_order_id: string | null;
  wakilni_tracking_id: string | null;
  wakilni_paid_at: string | null;
  wakilni_invoice_number: string | null;
  wakilni_invoice_collection_usd: number | null;
  wakilni_invoice_delivery_fee_usd: number | null;
  wakilni_invoice_import_id: string | null;
  invoice?: {
    id: string;
    file_name: string | null;
    invoice_number: string | null;
    google_drive_web_view_link: string | null;
    imported_at: string | null;
  } | null;
};

const money = (value: number) =>
  `${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;

const formatDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";

const shortWakilniId = (order: DeliveredOrder) => {
  const value = order.wakilni_order_id || order.wakilni_tracking_id || "";
  if (!value) return "-";
  return value.length > 8 ? value.slice(-5) : value;
};

function PaidBadge({ paid }: { paid: boolean }) {
  return paid ? <Badge variant="success">Paid</Badge> : <Badge variant="warning">Not paid</Badge>;
}

type SortKey = "created_desc" | "created_asc" | "order_desc" | "order_asc" | "wakilni_desc" | "wakilni_asc" | "amount_desc" | "amount_asc";

export default function WakilniDeliveredOrders() {
  const { authUser } = useAuth();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "paid" | "not_paid">("all");
  const [sort, setSort] = useState<SortKey>("created_desc");
  const isAdmin = authUser?.role === "admin";

  const { data: orders = [], isFetching } = useQuery({
    queryKey: ["wakilni-delivered-orders"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("orders")
        .select("id,order_id,system_id,created_at,updated_at,delivered_at,customer_name,customer_phone,customer_city,product_name,quantity,total_amount,delivery_status,wakilni_order_id,wakilni_tracking_id,wakilni_paid_at,wakilni_invoice_number,wakilni_invoice_collection_usd,wakilni_invoice_delivery_fee_usd,wakilni_invoice_import_id")
        .eq("delivery_status", "delivered")
        .order("updated_at", { ascending: false })
        .limit(10000);
      if (error) throw error;
      const orderRows = (data || []) as DeliveredOrder[];
      const orderIds = [...new Set(orderRows.map((order) => order.order_id).filter(Boolean))] as string[];
      const deliveredHistoryByOrder = new Map<string, string>();

      for (let i = 0; i < orderIds.length; i += 500) {
        const { data: historyRows, error: historyError } = await (supabase as any)
          .from("order_history")
          .select("order_id,created_at")
          .eq("field_changed", "delivery_status")
          .eq("new_value", "delivered")
          .in("order_id", orderIds.slice(i, i + 500))
          .order("created_at", { ascending: false });
        if (historyError) throw historyError;
        (historyRows || []).forEach((row: any) => {
          if (row.order_id && !deliveredHistoryByOrder.has(row.order_id)) {
            deliveredHistoryByOrder.set(row.order_id, row.created_at);
          }
        });
      }

      const withDeliveredStatusAt = orderRows.map((order) => ({
        ...order,
        delivered_status_at: order.delivered_at || (order.order_id ? deliveredHistoryByOrder.get(order.order_id) || null : null),
      }));
      const importIds = [...new Set(orderRows.map((order) => order.wakilni_invoice_import_id).filter(Boolean))];
      if (importIds.length === 0) return withDeliveredStatusAt;

      const { data: imports, error: importsError } = await (supabase as any)
        .from("wakilni_invoice_imports")
        .select("id,file_name,invoice_number,google_drive_web_view_link,imported_at")
        .in("id", importIds);
      if (importsError) throw importsError;

      const importsById = new Map((imports || []).map((item: any) => [item.id, item]));
      return withDeliveredStatusAt.map((order) => ({
        ...order,
        invoice: order.wakilni_invoice_import_id ? importsById.get(order.wakilni_invoice_import_id) || null : null,
      }));
    },
    enabled: isAdmin,
  });

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = orders.filter((order) => {
      const paid = !!order.wakilni_paid_at;
      if (status === "paid" && !paid) return false;
      if (status === "not_paid" && paid) return false;
      if (!q) return true;
      return [
        order.order_id,
        order.system_id,
        order.wakilni_order_id,
        order.wakilni_tracking_id,
        order.customer_name,
        order.customer_phone,
        order.customer_city,
        order.product_name,
        order.wakilni_invoice_number,
        order.invoice?.file_name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
    return [...filtered].sort((a, b) => {
      const orderNumber = (order: DeliveredOrder) => Number(order.order_id || order.system_id || 0);
      const createdTime = (order: DeliveredOrder) => new Date(order.created_at || 0).getTime();
      const wakilniNumber = (order: DeliveredOrder) => Number(order.wakilni_order_id || order.wakilni_tracking_id || 0);
      const amount = (order: DeliveredOrder) => Number(order.total_amount || 0);

      if (sort === "order_asc") return orderNumber(a) - orderNumber(b);
      if (sort === "order_desc") return orderNumber(b) - orderNumber(a);
      if (sort === "created_asc") return createdTime(a) - createdTime(b);
      if (sort === "created_desc") return createdTime(b) - createdTime(a);
      if (sort === "wakilni_asc") return wakilniNumber(a) - wakilniNumber(b);
      if (sort === "wakilni_desc") return wakilniNumber(b) - wakilniNumber(a);
      if (sort === "amount_asc") return amount(a) - amount(b);
      return amount(b) - amount(a);
    });
  }, [orders, search, sort, status]);

  const totals = useMemo(() => {
    return filteredOrders.reduce(
      (sum, order) => {
        const paid = !!order.wakilni_paid_at;
        const systemAmount = Number(order.total_amount || 0);
        const wakilniAmount = Number(order.wakilni_invoice_collection_usd || 0);
        return {
          count: sum.count + 1,
          paidCount: sum.paidCount + (paid ? 1 : 0),
          notPaidCount: sum.notPaidCount + (paid ? 0 : 1),
          systemAmount: sum.systemAmount + systemAmount,
          wakilniAmount: sum.wakilniAmount + wakilniAmount,
          difference: sum.difference + (paid ? wakilniAmount - systemAmount : 0),
        };
      },
      { count: 0, paidCount: 0, notPaidCount: 0, systemAmount: 0, wakilniAmount: 0, difference: 0 },
    );
  }, [filteredOrders]);

  if (!isAdmin) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Admin only</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Wakilni delivered order reconciliation is only available for admins.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Wakilni Delivered Orders</h1>
        <p className="text-sm text-muted-foreground">Track which delivered orders were paid by Wakilni and which are still open.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Delivered Orders</p>
              <div className="mt-2 text-2xl font-bold">{totals.count}</div>
              <p className="mt-1 text-xs text-muted-foreground">{money(totals.systemAmount)} system amount</p>
            </div>
            <Truck className="h-10 w-10 rounded-lg bg-info/10 p-2 text-info" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Paid by Wakilni</p>
              <div className="mt-2 text-2xl font-bold text-success">{totals.paidCount}</div>
              <p className="mt-1 text-xs text-muted-foreground">{money(totals.wakilniAmount)} received</p>
            </div>
            <CheckCircle2 className="h-10 w-10 rounded-lg bg-success/10 p-2 text-success" />
          </CardContent>
        </Card>
        <Card className={totals.notPaidCount > 0 ? "border-warning/50" : ""}>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Not Paid</p>
              <div className="mt-2 text-2xl font-bold text-warning">{totals.notPaidCount}</div>
              <p className="mt-1 text-xs text-muted-foreground">Delivered but no Wakilni payment mark</p>
            </div>
            <AlertTriangle className="h-10 w-10 rounded-lg bg-warning/10 p-2 text-warning" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Difference</p>
              <div className="mt-2 text-2xl font-bold">{money(totals.difference)}</div>
              <p className="mt-1 text-xs text-muted-foreground">Wakilni amount minus system amount</p>
            </div>
            <WalletCards className="h-10 w-10 rounded-lg bg-primary/10 p-2 text-primary" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <CardTitle className="text-base">Delivered Orders</CardTitle>
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
              <SelectTrigger className="w-full md:w-[160px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="not_paid">Not paid</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(value) => setSort(value as SortKey)}>
              <SelectTrigger className="w-full md:w-[190px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="created_desc">Created newest</SelectItem>
                <SelectItem value="created_asc">Created oldest</SelectItem>
                <SelectItem value="order_desc">Order ID high</SelectItem>
                <SelectItem value="order_asc">Order ID low</SelectItem>
                <SelectItem value="wakilni_desc">Wakilni ID high</SelectItem>
                <SelectItem value="wakilni_asc">Wakilni ID low</SelectItem>
                <SelectItem value="amount_desc">Amount high</SelectItem>
                <SelectItem value="amount_asc">Amount low</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative md:w-[320px]">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search order, Wakilni ID, invoice..." className="pl-9" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order ID</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Delivered</TableHead>
                <TableHead>Wakilni ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Unser Betrag</TableHead>
                <TableHead className="text-right">Betrag von Wakilni</TableHead>
                <TableHead className="text-right">Difference</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Paid At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrders.map((order) => {
                const paid = !!order.wakilni_paid_at;
                const systemAmount = Number(order.total_amount || 0);
                const wakilniAmount = Number(order.wakilni_invoice_collection_usd || 0);
                const invoice = order.invoice;
                return (
                  <TableRow key={order.id}>
                    <TableCell>
                      <div className="font-mono font-semibold">#{order.order_id || order.system_id || "-"}</div>
                      {order.system_id && <div className="text-xs text-muted-foreground">System {order.system_id}</div>}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{formatDateTime(order.created_at)}</div>
                      <div className="text-xs text-muted-foreground">System created</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{formatDateTime(order.delivered_status_at)}</div>
                      <div className="text-xs text-muted-foreground">Set delivered</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs" title={order.wakilni_order_id || order.wakilni_tracking_id || ""}>
                      {shortWakilniId(order)}
                    </TableCell>
                    <TableCell><PaidBadge paid={paid} /></TableCell>
                    <TableCell>
                      <div className="font-medium">{order.customer_name || "-"}</div>
                      <div className="text-xs text-muted-foreground">{order.customer_phone || "-"}</div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[220px] truncate font-medium" title={order.product_name || ""}>{order.product_name || "-"}</div>
                      <div className="text-xs text-muted-foreground">{order.customer_city || "-"}</div>
                    </TableCell>
                    <TableCell className="text-right font-semibold">{money(systemAmount)}</TableCell>
                    <TableCell className="text-right font-semibold">{paid ? money(wakilniAmount) : "-"}</TableCell>
                    <TableCell className="text-right">{paid ? money(wakilniAmount - systemAmount) : "-"}</TableCell>
                    <TableCell>
                      {invoice ? (
                        <div>
                          {invoice.google_drive_web_view_link ? (
                            <a href={invoice.google_drive_web_view_link} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                              {order.wakilni_invoice_number || invoice.invoice_number || invoice.file_name || "Invoice"}
                            </a>
                          ) : (
                            <span className="font-medium">{order.wakilni_invoice_number || invoice.invoice_number || invoice.file_name || "Invoice"}</span>
                          )}
                          {invoice.imported_at && <div className="text-xs text-muted-foreground">Imported {new Date(invoice.imported_at).toLocaleDateString("en-GB")}</div>}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>{order.wakilni_paid_at ? new Date(order.wakilni_paid_at).toLocaleString("en-GB") : "-"}</TableCell>
                  </TableRow>
                );
              })}
              {filteredOrders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={12} className="py-12 text-center text-muted-foreground">
                    {isFetching ? "Loading delivered orders..." : "No delivered orders found."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {filteredOrders.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={7}>Total</TableCell>
                  <TableCell className="text-right font-bold">{money(totals.systemAmount)}</TableCell>
                  <TableCell className="text-right font-bold">{money(totals.wakilniAmount)}</TableCell>
                  <TableCell className="text-right font-bold">{money(totals.difference)}</TableCell>
                  <TableCell colSpan={2}>{totals.paidCount} paid, {totals.notPaidCount} not paid</TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
