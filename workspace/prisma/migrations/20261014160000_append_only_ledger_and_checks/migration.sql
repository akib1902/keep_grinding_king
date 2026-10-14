-- Database-level guarantees that application code alone cannot be trusted to keep.
--
-- Two families of control live here:
--
-- 1. Append-only ledger (SRS-AUDIT-003). A completed ledger entry must not be
--    modifiable or deletable by an ordinary application workflow. Enforcing this
--    with a trigger means even a future bug, a stray script or an ad-hoc client
--    cannot rewrite financial history; the correction path is a new,
--    compensating entry.
--
-- 2. Financial CHECK constraints (SRS §5.2). Amounts are integer minor units and
--    must be positive; a state counter must not go negative. These are the same
--    invariants the domain layer validates, asserted one layer lower so they hold
--    regardless of which code path writes the row.

-- ---------------------------------------------------------------------------
-- Append-only ledger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION rfa_ledger_entries_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only: % is not permitted (entry %)', TG_OP, COALESCE(OLD.id, 'unknown')
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entries_no_update ON "ledger_entries";
CREATE TRIGGER ledger_entries_no_update
  BEFORE UPDATE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION rfa_ledger_entries_guard();

DROP TRIGGER IF EXISTS ledger_entries_no_delete ON "ledger_entries";
CREATE TRIGGER ledger_entries_no_delete
  BEFORE DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION rfa_ledger_entries_guard();

-- ---------------------------------------------------------------------------
-- Positive-money and counter constraints
-- ---------------------------------------------------------------------------

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_amount_positive" CHECK ("amount_minor" > 0);

ALTER TABLE "refund_proposals"
  ADD CONSTRAINT "refund_proposals_amount_positive" CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "refund_proposals_refundable_non_negative" CHECK ("refundable_amount_minor" >= 0),
  ADD CONSTRAINT "refund_proposals_revision_positive" CHECK ("revision" > 0);

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_amount_positive" CHECK ("amount_minor" > 0);

ALTER TABLE "runs"
  ADD CONSTRAINT "runs_attempt_count_non_negative" CHECK ("attempt_count" >= 0);

ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_attempts_non_negative" CHECK ("attempts" >= 0);

ALTER TABLE "settlement_operations"
  ADD CONSTRAINT "settlement_operations_attempts_non_negative" CHECK ("attempts" >= 0);

-- Transaction and invoice references must be present for refundable evidence.
ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_currency_supported" CHECK ("currency" IN ('USD'));
