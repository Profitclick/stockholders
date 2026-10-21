CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own roles readable" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE TABLE public.user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.user_profiles TO authenticated;
GRANT ALL ON public.user_profiles TO service_role;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own profile read" ON public.user_profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Own profile update" ON public.user_profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- First account ever becomes the sole admin (owner). Later sign-ups get no access.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_profiles (id, display_name)
  VALUES (NEW.id, coalesce(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  PERFORM pg_advisory_xact_lock(424242);
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.person_holdings (
  id bigserial PRIMARY KEY,
  orgnr text NOT NULL,
  company text,
  shareholder_name text NOT NULL,
  birth_year integer,
  postal text,
  shares_2025 bigint,
  shares_2024 bigint,
  pct_2025 numeric,
  pct_2024 numeric,
  change_type text NOT NULL DEFAULT 'unchanged'
);
CREATE INDEX person_holdings_orgnr_idx ON public.person_holdings (orgnr);
CREATE INDEX person_holdings_name_idx ON public.person_holdings (lower(shareholder_name));
CREATE INDEX person_holdings_change_idx ON public.person_holdings (change_type, pct_2025 DESC);
GRANT SELECT ON public.person_holdings TO authenticated;
GRANT ALL ON public.person_holdings TO service_role;
ALTER TABLE public.person_holdings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read person holdings" ON public.person_holdings FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));