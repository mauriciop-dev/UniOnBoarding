-- Feedback (growth loop): calificaciones + comentarios de los usuarios de la extension.
CREATE TABLE IF NOT EXISTS public.feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text,
  platform text,
  provider text,
  lang text NOT NULL DEFAULT 'es',
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_created
  ON public.feedback (created_at DESC);
