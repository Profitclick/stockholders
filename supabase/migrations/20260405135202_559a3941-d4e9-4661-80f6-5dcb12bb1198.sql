
-- plugin_logs table for tracking plugin activity
CREATE TABLE public.plugin_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plugin_id UUID REFERENCES public.plugins(id) ON DELETE CASCADE NOT NULL,
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.plugin_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON public.plugin_logs FOR SELECT TO public USING (true);
CREATE POLICY "Public write" ON public.plugin_logs FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Public delete" ON public.plugin_logs FOR DELETE TO public USING (true);

CREATE INDEX idx_plugin_logs_plugin_id ON public.plugin_logs(plugin_id);
CREATE INDEX idx_plugin_logs_created_at ON public.plugin_logs(created_at DESC);

-- plugin_data table for storing custom dataset rows
CREATE TABLE public.plugin_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plugin_id UUID REFERENCES public.plugins(id) ON DELETE CASCADE NOT NULL,
  row_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.plugin_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON public.plugin_data FOR SELECT TO public USING (true);
CREATE POLICY "Public write" ON public.plugin_data FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Public delete" ON public.plugin_data FOR DELETE TO public USING (true);
CREATE POLICY "Public update" ON public.plugin_data FOR UPDATE TO public USING (true);

CREATE INDEX idx_plugin_data_plugin_id ON public.plugin_data(plugin_id);
