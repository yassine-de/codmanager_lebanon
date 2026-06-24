import { useEffect, useMemo, useState } from "react";
import { Calendar, CheckCircle2, Clock3, Loader2, Package, Truck } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { formatPKT as format } from "@/lib/timezone";

interface SellerTrackingModalProps {
  orderId: string;
  open: boolean;
  onClose: () => void;
}

interface SellerTrackingPayload {
  order_id: string;
  status: string;
  delivery_status: string;
  completed_on?: string | null;
  events?: { label?: string; created_at?: string | null }[];
  error?: string;
}

const statusTone: Record<string, string> = {
  pending: "bg-muted text-muted-foreground border-border",
  booked: "bg-[hsl(200,65%,50%)]/12 text-[hsl(200,65%,50%)] border-[hsl(200,65%,50%)]/20",
  shipped: "bg-[hsl(210,60%,52%)]/12 text-[hsl(210,60%,52%)] border-[hsl(210,60%,52%)]/20",
  in_transit: "bg-[hsl(230,55%,55%)]/12 text-[hsl(230,55%,55%)] border-[hsl(230,55%,55%)]/20",
  with_courier: "bg-[hsl(185,55%,42%)]/12 text-[hsl(185,55%,42%)] border-[hsl(185,55%,42%)]/20",
  delivered: "bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/20",
  failed_attempt: "bg-[hsl(25,85%,55%)]/12 text-[hsl(25,85%,55%)] border-[hsl(25,85%,55%)]/20",
  returned: "bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/20",
  cancelled: "bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/20",
  rejected: "bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/20",
};

export default function SellerTrackingModal({ orderId, open, onClose }: SellerTrackingModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<SellerTrackingPayload | null>(null);

  useEffect(() => {
    if (!open || !orderId) return;

    setLoading(true);
    setError(null);
    setPayload(null);

    supabase.functions
      .invoke("seller-tracking", { body: { order_id: orderId } })
      .then(({ data, error: fnError }) => {
        if (fnError) setError(fnError.message);
        else if (data?.error) setError(data.error);
        else setPayload(data as SellerTrackingPayload);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, orderId]);

  const events = useMemo(() => {
    const rows = payload?.events || [];
    return rows.filter((event) => event.label || event.created_at);
  }, [payload]);

  const tone = statusTone[payload?.delivery_status || ""] || statusTone.pending;

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Package className="w-4 h-4" />
            Delivery Tracking
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            Tracking is not available for this order.
          </div>
        )}

        {payload && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <SummaryItem icon={<Package className="w-3.5 h-3.5" />} label="Order" value={payload.order_id || orderId} />
              <div className="rounded-lg border bg-card p-3">
                <div className="flex items-center gap-1.5 text-muted-foreground mb-1.5">
                  <Truck className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider">Status</span>
                </div>
                <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${tone}`}>
                  {payload.status || "Pending"}
                </span>
              </div>
              <SummaryItem
                icon={<Calendar className="w-3.5 h-3.5" />}
                label="Completed"
                value={payload.completed_on ? format(new Date(payload.completed_on), "dd MMM yyyy HH:mm") : "-"}
              />
            </div>

            {events.length > 0 ? (
              <div>
                <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-3">Tracking Timeline</h4>
                <div className="relative pl-6 border-l-2 border-muted space-y-4">
                  {events.map((event, index) => (
                    <div key={`${event.label}-${event.created_at}-${index}`} className="relative">
                      <div className={`absolute -left-[25px] w-3 h-3 rounded-full border-2 ${index === 0 ? "bg-primary border-primary" : "bg-background border-muted-foreground/40"}`} />
                      <p className="text-sm font-medium">{event.label || "Status update"}</p>
                      <p className="text-xs text-muted-foreground">
                        {event.created_at ? format(new Date(event.created_at), "dd MMM yyyy HH:mm") : "-"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 rounded-lg border bg-muted/20 py-8 text-sm text-muted-foreground">
                {payload.delivery_status === "delivered" ? <CheckCircle2 className="w-4 h-4" /> : <Clock3 className="w-4 h-4" />}
                No tracking events available yet.
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SummaryItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1.5">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-sm font-medium truncate" title={value}>{value}</p>
    </div>
  );
}
