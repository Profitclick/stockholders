CREATE TABLE public.short_positions (
  isin text PRIMARY KEY,
  issuer_name text NOT NULL,
  short_pct numeric NOT NULL DEFAULT 0,
  holders integer NOT NULL DEFAULT 0,
  as_of date,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.short_positions TO authenticated;
GRANT ALL ON public.short_positions TO service_role;
ALTER TABLE public.short_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read short positions" ON public.short_positions FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));