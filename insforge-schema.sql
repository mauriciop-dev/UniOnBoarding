-- ProOnboarding - InsForge schema
-- Apply via InsForge raw SQL endpoint or dashboard SQL editor.

CREATE TABLE IF NOT EXISTS public.page_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  dom_hash text NOT NULL,
  lang text NOT NULL DEFAULT 'es',
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_page_analyses_hash_lang
  ON public.page_analyses (dom_hash, lang, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_page_analyses_url
  ON public.page_analyses (url);

-- Optional cleanup function (schedule via InsForge schedules / pg_cron)
CREATE OR REPLACE FUNCTION public.cleanup_old_analyses()
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM public.page_analyses
  WHERE created_at < now() - interval '30 days';
$$;
