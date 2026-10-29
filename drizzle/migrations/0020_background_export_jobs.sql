CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE TABLE public.background_exports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_by uuid NOT NULL,
 source text NOT NULL CHECK (source IN ('owners','playbook')), filters jsonb NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','cancelled')),
 row_count bigint NOT NULL DEFAULT 0, cursor jsonb NOT NULL DEFAULT '{}', parts jsonb NOT NULL DEFAULT '[]',
 worker_token uuid NOT NULL DEFAULT gen_random_uuid(), lease_until timestamptz,
 error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT(id,created_by,source,filters,status,row_count,cursor,parts,error,created_at,updated_at,lease_until) ON public.background_exports TO authenticated;
GRANT ALL ON public.background_exports TO service_role;
ALTER TABLE public.background_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY background_exports_admin_read ON public.background_exports FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'admin'));
CREATE POLICY export_files_admin_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='export-files' AND public.has_role(auth.uid(),'admin'));
CREATE OR REPLACE FUNCTION public.claim_background_export(p_id uuid,p_token uuid) RETURNS SETOF public.background_exports LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 UPDATE public.background_exports SET status='running',lease_until=now()+interval '3 minutes',updated_at=now()
 WHERE id=p_id AND worker_token=p_token AND status='queued' RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.claim_background_export(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_background_export(uuid,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.wake_background_export() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
BEGIN
 IF NEW.status='queued' THEN
 PERFORM net.http_post(url:=TG_ARGV[0],headers:=jsonb_build_object('Content-Type','application/json'),body:=jsonb_build_object('action','work','id',NEW.id,'token',NEW.worker_token),timeout_milliseconds:=120000);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.wake_background_export() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER background_export_enqueue AFTER INSERT OR UPDATE OF status ON public.background_exports FOR EACH ROW EXECUTE FUNCTION public.wake_background_export('https://lwqdhithoxmdhkdogcuw.supabase.co/functions/v1/background-export');