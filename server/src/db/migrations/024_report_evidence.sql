-- 024_report_evidence.sql — fixer round 1 (SEC-2/SO-5, SO-1, SEC-6).
-- evidence     the reported player said something the reporter could have seen (chatRef line / nearby delivered line)
-- counts       evidence AND a trusted reporter (account ≥ 1 day, ≥ 30 min play) → counts toward the automatic mute
-- reporter_ip  public IP key of the reporter (/64 for IPv6; NULL for loopback / private) — distinct reporters are
--              counted by account AND by IP
-- hits         filter flags: number of flagged lines folded into this report (one open filter report per 10 min)
-- purged_at    the chat copy (context) was cleared by the retention job
ALTER TABLE reports ADD COLUMN evidence boolean NOT NULL DEFAULT false;
ALTER TABLE reports ADD COLUMN counts boolean NOT NULL DEFAULT false;
ALTER TABLE reports ADD COLUMN reporter_ip text;
ALTER TABLE reports ADD COLUMN hits integer NOT NULL DEFAULT 1;
ALTER TABLE reports ADD COLUMN purged_at timestamptz;
-- reports filed before this migration keep counting as they did
UPDATE reports SET counts = true, evidence = true WHERE source = 'player';
