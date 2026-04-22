INSERT INTO storage.buckets (id, name, public)
VALUES ('whatsapp-media', 'whatsapp-media', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated can upload whatsapp media"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'whatsapp-media');

CREATE POLICY "Public can read whatsapp media"
ON storage.objects FOR SELECT
USING (bucket_id = 'whatsapp-media');

CREATE POLICY "Authenticated can update whatsapp media"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'whatsapp-media');