import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, MessageCircle, Pencil, RefreshCcw, Video } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { CitySelect } from "@/components/CitySelect";
import { useToast } from "@/hooks/use-toast";

type OrderRow = {
  id: string;
  system_id: number | null;
  order_id: string;
  created_at: string;
  updated_at: string;
  confirmation_status: string;
  customer_name: string;
  customer_phone: string;
  customer_city: string;
  customer_address: string | null;
  product_name: string;
  product_url: string | null;
  video_url: string | null;
  variant_name: string | null;
  variant_sku: string | null;
  quantity: number;
  price: number;
  total_amount: number;
  note: string | null;
  seller_id: string;
  agent_id: string | null;
  original_agent_id: string | null;
};

type ProductRow = {
  id: string;
  seller_id: string;
  name: string;
  sku: string;
  price: number;
  last_price: number | null;
  product_url: string | null;
  video_url: string | null;
  variants: any[] | null;
};

type EditForm = {
  confirmation_status: string;
  product_id: string;
  product_name: string;
  product_url: string;
  video_url: string;
  variant_name: string;
  variant_sku: string;
  customer_name: string;
  customer_phone: string;
  quantity: string;
  total_amount: string;
  customer_city: string;
  customer_address: string;
  note: string;
};

const statusOptions = [
  { value: "new", label: "New" },
  { value: "confirmed", label: "Confirmed" },
  { value: "postponed", label: "Postponed" },
  { value: "no_answer", label: "No Answer" },
  { value: "cancelled", label: "Cancelled" },
  { value: "wrong_number", label: "Wrong Number" },
];

const statusClass: Record<string, string> = {
  new: "bg-muted text-foreground border-border",
  confirmed: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  postponed: "bg-amber-500/10 text-amber-700 border-amber-500/20",
  no_answer: "bg-blue-500/10 text-blue-700 border-blue-500/20",
  cancelled: "bg-destructive/10 text-destructive border-destructive/20",
  wrong_number: "bg-rose-500/10 text-rose-700 border-rose-500/20",
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));

const formatMoney = (value: number | null | undefined) =>
  `${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

const parseMoney = (value: string) => {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeWhatsappPhone = (phone: string) => {
  const trimmed = phone.trim();
  let digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `961${digits.slice(1)}`;
  if (!digits.startsWith("961") && digits.length <= 8) digits = `961${digits}`;
  return digits.replace(/\D/g, "");
};

const whatsappUrl = (phone: string) => {
  const normalized = normalizeWhatsappPhone(phone);
  return normalized ? `https://wa.me/${normalized}` : "#";
};

const createEmptyForm = (): EditForm => ({
  confirmation_status: "new",
  product_id: "",
  product_name: "",
  product_url: "",
  video_url: "",
  variant_name: "",
  variant_sku: "",
  customer_name: "",
  customer_phone: "",
  quantity: "1",
  total_amount: "0",
  customer_city: "",
  customer_address: "",
  note: "",
});

export default function AgentOrderList() {
  const { authUser } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedOrder, setSelectedOrder] = useState<OrderRow | null>(null);
  const [form, setForm] = useState<EditForm>(createEmptyForm);
  const [saving, setSaving] = useState(false);

  const ordersQuery = useQuery({
    queryKey: ["agent-direct-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id,system_id,order_id,created_at,updated_at,confirmation_status,customer_name,customer_phone,customer_city,customer_address,product_name,product_url,video_url,variant_name,variant_sku,quantity,price,total_amount,note,seller_id,agent_id,original_agent_id")
        .eq("confirmation_status", "new")
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data || []) as OrderRow[];
    },
    refetchInterval: 30000,
  });

  const productsQuery = useQuery({
    queryKey: ["agent-edit-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id,seller_id,name,sku,price,last_price,product_url,video_url,variants")
        .eq("active", true)
        .order("name", { ascending: true });

      if (error) throw error;
      return (data || []) as ProductRow[];
    },
  });

  const productsForOrder = useMemo(() => {
    if (!selectedOrder) return productsQuery.data || [];
    return (productsQuery.data || []).filter((product) => product.seller_id === selectedOrder.seller_id);
  }, [productsQuery.data, selectedOrder]);

  const selectedProduct = useMemo(
    () => productsForOrder.find((product) => product.id === form.product_id) || null,
    [form.product_id, productsForOrder]
  );

  const selectedProductVariants = useMemo(() => {
    const variants = Array.isArray(selectedProduct?.variants) ? selectedProduct.variants : [];
    return variants.filter((variant) => variant?.name);
  }, [selectedProduct]);

  useEffect(() => {
    if (!selectedOrder) return;
    const matchingProduct = (productsQuery.data || []).find(
      (product) =>
        product.seller_id === selectedOrder.seller_id &&
        (product.name === selectedOrder.product_name || product.product_url === selectedOrder.product_url)
    );

    setForm({
      confirmation_status: selectedOrder.confirmation_status || "new",
      product_id: matchingProduct?.id || "",
      product_name: selectedOrder.product_name || "",
      product_url: selectedOrder.product_url || matchingProduct?.product_url || "",
      video_url: selectedOrder.video_url || matchingProduct?.video_url || "",
      variant_name: selectedOrder.variant_name || "",
      variant_sku: selectedOrder.variant_sku || "",
      customer_name: selectedOrder.customer_name || "",
      customer_phone: selectedOrder.customer_phone || "",
      quantity: String(selectedOrder.quantity || 1),
      total_amount: String(selectedOrder.total_amount || selectedOrder.price || 0),
      customer_city: selectedOrder.customer_city || "",
      customer_address: selectedOrder.customer_address || "",
      note: selectedOrder.note || "",
    });
  }, [productsQuery.data, selectedOrder]);

  const updateField = <K extends keyof EditForm>(field: K, value: EditForm[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleProductChange = (productId: string) => {
    if (productId === "custom") {
      setForm((current) => ({ ...current, product_id: "", variant_name: "", variant_sku: "" }));
      return;
    }

    const product = productsForOrder.find((p) => p.id === productId);
    updateField("product_id", productId);
    if (!product) return;

    setForm((current) => ({
      ...current,
      product_id: product.id,
      product_name: product.name,
      product_url: product.product_url || current.product_url,
      video_url: product.video_url || current.video_url,
      variant_name: "",
      variant_sku: "",
    }));
  };

  const handleVariantChange = (variantName: string) => {
    const variant = selectedProductVariants.find((item) => String(item.name) === variantName);
    setForm((current) => ({
      ...current,
      variant_name: variantName,
      variant_sku: String(variant?.sku || ""),
    }));
  };

  const saveOrder = async () => {
    if (!selectedOrder || !authUser) return;
    setSaving(true);

    try {
      const quantity = Math.max(1, Number.parseInt(form.quantity, 10) || 1);
      const totalAmount = parseMoney(form.total_amount);
      const unitPrice = totalAmount / quantity;
      const now = new Date().toISOString();
      const movedFromNew = form.confirmation_status !== "new";

      const updateData: Record<string, unknown> = {
        confirmation_status: form.confirmation_status,
        customer_name: form.customer_name.trim(),
        customer_phone: form.customer_phone.trim(),
        customer_city: form.customer_city.trim(),
        customer_address: form.customer_address.trim() || null,
        product_name: form.product_name.trim(),
        product_url: form.product_url.trim() || null,
        video_url: form.video_url.trim() || null,
        variant_name: form.variant_name.trim() || null,
        variant_sku: form.variant_sku.trim() || null,
        quantity,
        total_amount: totalAmount,
        price: unitPrice,
        note: form.note.trim() || null,
        updated_at: now,
      };

      if (movedFromNew) {
        updateData.agent_id = authUser.id;
        updateData.original_agent_id = selectedOrder.original_agent_id || authUser.id;
        if (!selectedOrder.agent_id) updateData.assigned_at = now;
        updateData.last_activity_at = now;
      }

      if (form.confirmation_status === "confirmed") {
        updateData.confirmed_at = now;
        updateData.delivery_status = "pending";
      }

      const { error } = await supabase
        .from("orders")
        .update(updateData)
        .eq("id", selectedOrder.id);

      if (error) throw error;

      toast({ title: "Order saved" });
      setSelectedOrder(null);
      await queryClient.invalidateQueries({ queryKey: ["agent-direct-orders"] });
      await queryClient.invalidateQueries({ queryKey: ["agent-new-orders-count"] });
    } catch (error: any) {
      toast({
        title: "Failed to save order",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const orders = ordersQuery.data || [];

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
          <p className="text-sm text-muted-foreground">Manage new orders directly from the list.</p>
        </div>
        <Button variant="outline" onClick={() => ordersQuery.refetch()} disabled={ordersQuery.isFetching}>
          <RefreshCcw className={`mr-2 h-4 w-4 ${ordersQuery.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-medium">{orders.length} orders</span>
          {ordersQuery.isError && (
            <span className="text-sm text-destructive">Could not load orders.</span>
          )}
        </div>

        <div className="overflow-x-auto">
          <Table className="min-w-[1280px]">
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-[120px] px-6 uppercase tracking-wider">Order ID</TableHead>
                <TableHead className="w-[110px] uppercase tracking-wider">Sheet ID</TableHead>
                <TableHead className="w-[170px] uppercase tracking-wider">Order Date</TableHead>
                <TableHead className="w-[120px] uppercase tracking-wider">Status</TableHead>
                <TableHead className="w-[220px] uppercase tracking-wider">Product Name</TableHead>
                <TableHead className="w-[170px] uppercase tracking-wider">Customer</TableHead>
                <TableHead className="w-[150px] uppercase tracking-wider">Phone</TableHead>
                <TableHead className="w-[80px] text-center uppercase tracking-wider">Qty</TableHead>
                <TableHead className="w-[130px] text-right uppercase tracking-wider">Total Price</TableHead>
                <TableHead className="w-[120px] text-center uppercase tracking-wider">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordersQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-32 text-center text-muted-foreground">
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                    Loading orders...
                  </TableCell>
                </TableRow>
              ) : orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-32 text-center text-muted-foreground">
                    No new orders found.
                  </TableCell>
                </TableRow>
              ) : (
                orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="px-6 font-medium">#{order.system_id || order.order_id}</TableCell>
                    <TableCell className="font-medium text-muted-foreground">{order.order_id}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(order.created_at)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusClass[order.confirmation_status] || statusClass.new}>
                        {statusOptions.find((s) => s.value === order.confirmation_status)?.label || order.confirmation_status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium" dir="auto">{order.product_name}</TableCell>
                    <TableCell dir="auto">{order.customer_name}</TableCell>
                    <TableCell className="text-muted-foreground">{order.customer_phone}</TableCell>
                    <TableCell className="text-center font-medium">{order.quantity}</TableCell>
                    <TableCell className="text-right font-semibold">{formatMoney(order.total_amount)}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-3">
                        <a href={whatsappUrl(order.customer_phone)} target="_blank" rel="noreferrer" className="text-emerald-600 hover:text-emerald-700">
                          <MessageCircle className="h-5 w-5" />
                        </a>
                        <button type="button" className="text-orange-500 hover:text-orange-600" onClick={() => setSelectedOrder(order)}>
                          <Pencil className="h-4 w-4" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={!!selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle className="text-xl">
              Edit Order #{selectedOrder?.system_id || selectedOrder?.order_id}
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-7 gap-y-5 pt-2">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.confirmation_status} onValueChange={(value) => updateField("confirmation_status", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((status) => (
                    <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Product</Label>
              <Select value={form.product_id || "custom"} onValueChange={handleProductChange}>
                <SelectTrigger>
                  <SelectValue placeholder={form.product_name || "Select product"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">{form.product_name || "Current product"}</SelectItem>
                  {productsForOrder.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name} - {formatMoney(product.last_price ?? product.price)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-4 text-sm">
                {form.product_url && (
                  <a href={form.product_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    <ExternalLink className="h-4 w-4" />
                    Product Page
                  </a>
                )}
                {form.video_url && (
                  <a href={form.video_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    <Video className="h-4 w-4" />
                    Video
                  </a>
                )}
              </div>
              {selectedProductVariants.length > 0 && (
                <div className="space-y-2 pt-2">
                  <Label>Variant</Label>
                  <Select value={form.variant_name} onValueChange={handleVariantChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select variant" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedProductVariants.map((variant) => (
                        <SelectItem key={variant.id || variant.sku || variant.name} value={String(variant.name)}>
                          {variant.name}{variant.sku ? ` - ${variant.sku}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Customer Name</Label>
              <Input value={form.customer_name} onChange={(event) => updateField("customer_name", event.target.value)} dir="auto" />
            </div>

            <div className="space-y-2">
              <Label>Phone</Label>
              <div className="flex gap-2">
                <Input value={form.customer_phone} onChange={(event) => updateField("customer_phone", event.target.value)} />
                <Button variant="ghost" size="icon" asChild>
                  <a href={whatsappUrl(form.customer_phone)} target="_blank" rel="noreferrer">
                    <MessageCircle className="h-5 w-5 text-emerald-600" />
                  </a>
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input value={form.quantity} onChange={(event) => updateField("quantity", event.target.value)} inputMode="numeric" />
            </div>

            <div className="space-y-2">
              <Label>Total Price</Label>
              <Input value={form.total_amount} onChange={(event) => updateField("total_amount", event.target.value)} inputMode="decimal" />
            </div>

            <div className="space-y-2">
              <Label>City</Label>
              <CitySelect
                value={form.customer_city}
                onValueChange={(value) => updateField("customer_city", value)}
                triggerClassName="h-11 w-full justify-between text-base"
                highlightInvalid
              />
            </div>

            <div className="space-y-2 md:row-span-2">
              <Label>Info</Label>
              <Textarea className="min-h-[100px]" value={form.note} onChange={(event) => updateField("note", event.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Address</Label>
              <Textarea className="min-h-[100px]" value={form.customer_address} onChange={(event) => updateField("customer_address", event.target.value)} dir="auto" />
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t pt-4">
            <Button variant="outline" onClick={() => setSelectedOrder(null)} disabled={saving}>Cancel</Button>
            <Button onClick={saveOrder} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
