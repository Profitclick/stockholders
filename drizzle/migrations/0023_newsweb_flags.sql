CREATE TABLE public.newsweb_flags (
  message_id bigint PRIMARY KEY,
  issuer_sign text,
  issuer_name text,
  title text,
  published_time timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.newsweb_flags TO authenticated;
GRANT ALL ON public.newsweb_flags TO service_role;
ALTER TABLE public.newsweb_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read flags" ON public.newsweb_flags FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX newsweb_flags_sign_idx ON public.newsweb_flags (issuer_sign, published_time DESC);