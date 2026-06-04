import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { Calendar, Loader2, MapPin, MessageSquare, Package, Truck } from "lucide-react";

interface WakilniTrackingModalProps {
  trackingId?: string | null;
  wakilniOrderId?: string | null;
  systemId?: number | null;
  sellerId?: string | null;
  open: boolean;
  onClose: () => void;
}

interface WakilniTrackingPayload {
  tracking_id?: string;
  order_id?: string;
  status?: string;
  status_code?: string | number;
  completed_on?: string | null;
  comments?: string[];
  logs?: { status?: string; status_code?: string | number; created_at?: string }[];
  raw?: unknown;
}

export default function WakilniTrackingModal({ trackingId, wakilniOrderId, systemId, sellerId, open, onClose }: WakilniTrackingModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<WakilniTrackingPayload | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setPayload(null);

    supabase.functions
      .invoke("wakilni-sync", {
        body: { action: "track", tracking_id: trackingId, wakilni_order_id: wakilniOrderId },
      })
      .then(({ data, error: fnError }) => {
        if (fnError) setError(fnError.message);
        else if (data?.error) setError(data.error);
        else setPayload(data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, trackingId, wakilniOrderId]);

  const titleId = payload?.tracking_id || trackingId || wakilniOrderId || "Wakilni";
  const logs = payload?.logs || [];
  const comments = payload?.comments || [];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Package className="w-4 h-4" />
            WAKILNI TRACKING - {titleId}
          </DialogTitle>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {systemId && <span className="text-[10px] font-semibold text-muted-foreground">SYSTEM ID: <span className="text-foreground">{systemId}</span></span>}
            {sellerId && <span className="text-[10px] font-semibold text-muted-foreground">SELLER ID: <span className="text-foreground">{sellerId}</span></span>}
            {wakilniOrderId && <span className="text-[10px] font-semibold text-muted-foreground">WAKILNI ORDER: <span className="text-foreground">{wakilniOrderId}</span></span>}
          </div>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {payload && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <SummaryItem icon={<Truck className="w-3.5 h-3.5" />} label="STATUS" value={String(payload.status || "Pending")} />
              <SummaryItem icon={<Package className="w-3.5 h-3.5" />} label="CODE" value={payload.status_code != null ? String(payload.status_code) : "-"} />
              <SummaryItem icon={<Calendar className="w-3.5 h-3.5" />} label="COMPLETED" value={payload.completed_on || "-"} />
              <SummaryItem icon={<MapPin className="w-3.5 h-3.5" />} label="TRACKING" value={payload.tracking_id || trackingId || "-"} />
            </div>

            {comments.length > 0 && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider">Comments</span>
                </div>
                <div className="space-y-1">
                  {comments.map((comment, index) => (
                    <p key={index} className="text-sm">{comment}</p>
                  ))}
                </div>
              </div>
            )}

            {logs.length > 0 ? (
              <div>
                <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-3">Tracking Timeline</h4>
                <div className="relative pl-6 border-l-2 border-muted space-y-4">
                  {logs.map((event, i) => (
                    <div key={i} className="relative">
                      <div className={`absolute -left-[25px] w-3 h-3 rounded-full border-2 ${i === 0 ? "bg-primary border-primary" : "bg-background border-muted-foreground/40"}`} />
                      <p className="text-sm font-medium">{event.status || "Status update"}</p>
                      <p className="text-xs text-muted-foreground">{event.created_at || "-"}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No tracking events available yet.</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SummaryItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-xs font-medium truncate" title={value}>{value}</p>
    </div>
  );
}
