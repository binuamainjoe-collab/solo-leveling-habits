-- Beru reads pages now, not just search results.
--
-- beru-scout attaches Gemini's URL context tool next to Google Search, so the
-- model opens the most promising results and reads them before it reports.
-- `page_read` records whether that worked for a finding: true means Beru read
-- the page itself, false means it went on the search result alone (the page
-- would not open, or it is a kind URL context cannot read, such as YouTube).
-- Igris is told which is which and trusts the second kind less.
--
-- Existing rows predate the tool, so they are false: none of them was read.

alter table public.findings
  add column if not exists page_read boolean not null default false;

comment on column public.findings.page_read is
  'True when Beru opened and read the page through URL context; false when it went on the search result alone.';

-- The url column's note is out of date: beru-scout now follows each Vertex AI
-- Search redirect to the publisher''s own address before saving.
comment on column public.findings.url is
  'The publisher''s address. beru-scout follows grounding redirects before saving; a redirect is kept only when it could not be followed.';
