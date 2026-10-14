-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ANALYST', 'APPROVER', 'ADMIN');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('PENDING', 'RUNNING', 'REQUIRES_HUMAN_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StepType" AS ENUM ('RUN_ACCEPTED', 'ATTEMPT_STARTED', 'MODEL_TURN', 'TOOL_CALL', 'RESEARCH_REPORT', 'PROPOSAL_CREATED', 'POLICY_EVALUATION', 'APPROVAL_REQUIRED', 'APPROVAL_DECIDED', 'SETTLEMENT', 'ATTEMPT_FAILED', 'RECOVERY_REQUEUE');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'DISPATCHED', 'FAILED');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('REQUIRES_APPROVAL', 'POLICY_DENIED', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'SETTLED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'COMMITTED', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('REFUND');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'AGENT', 'SYSTEM');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'PENDING',
    "request" JSONB NOT NULL,
    "policy_version" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "token_usage" JSONB,
    "result" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,
    "attempt_id" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "heartbeat_at" TIMESTAMP(3),
    "idempotency_key_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_steps" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "attempt_id" TEXT,
    "step_type" "StepType" NOT NULL,
    "status" "StepStatus" NOT NULL DEFAULT 'STARTED',
    "summary" TEXT,
    "payload" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,
    "retryable" BOOLEAN,
    "latency_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "run_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_events" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMP(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "status_code" INTEGER,
    "response_body" JSONB,
    "resource_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "external_ref" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "risk_tier" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "invoice_ref" TEXT,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_proposals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "refundable_amount_minor" INTEGER NOT NULL,
    "justification" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'REQUIRES_APPROVAL',
    "reviewed_hash" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "policy_version" TEXT NOT NULL,
    "policy_decision" JSONB NOT NULL,
    "requires_approval" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "proposal_revision" INTEGER NOT NULL,
    "proposal_hash" TEXT NOT NULL,
    "reviewed_snapshot" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "decided_at" TIMESTAMP(3),
    "decided_by_id" TEXT,
    "decision_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_operations" (
    "id" TEXT NOT NULL,
    "operation_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "ledger_entry_id" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_at" TIMESTAMP(3),

    CONSTRAINT "settlement_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "operation_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "entryType" "LedgerEntryType" NOT NULL DEFAULT 'REFUND',
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "memo" TEXT NOT NULL,
    "entry_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "run_id" TEXT,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_subject_key" ON "users"("subject");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "runs_idempotency_key_id_key" ON "runs"("idempotency_key_id");

-- CreateIndex
CREATE INDEX "runs_tenant_id_status_idx" ON "runs"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "runs_owner_id_created_at_idx" ON "runs"("owner_id", "created_at");

-- CreateIndex
CREATE INDEX "runs_status_heartbeat_at_idx" ON "runs"("status", "heartbeat_at");

-- CreateIndex
CREATE INDEX "run_steps_run_id_created_at_idx" ON "run_steps"("run_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "run_steps_run_id_sequence_key" ON "run_steps"("run_id", "sequence");

-- CreateIndex
CREATE INDEX "run_events_run_id_sequence_idx" ON "run_events"("run_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "run_events_run_id_sequence_key" ON "run_events"("run_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_dedupe_key_key" ON "outbox_events"("dedupe_key");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_tenant_id_created_at_idx" ON "idempotency_keys"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_scope_key_key" ON "idempotency_keys"("scope", "key");

-- CreateIndex
CREATE INDEX "suppliers_tenant_id_idx" ON "suppliers"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenant_id_external_ref_key" ON "suppliers"("tenant_id", "external_ref");

-- CreateIndex
CREATE INDEX "transactions_tenant_id_occurred_at_idx" ON "transactions"("tenant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "transactions_tenant_id_supplier_id_idx" ON "transactions"("tenant_id", "supplier_id");

-- CreateIndex
CREATE INDEX "transactions_tenant_id_invoice_ref_idx" ON "transactions"("tenant_id", "invoice_ref");

-- CreateIndex
CREATE INDEX "refund_proposals_tenant_id_status_idx" ON "refund_proposals"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "refund_proposals_run_id_idx" ON "refund_proposals"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_requests_proposal_id_key" ON "approval_requests"("proposal_id");

-- CreateIndex
CREATE INDEX "approval_requests_status_expires_at_idx" ON "approval_requests"("status", "expires_at");

-- CreateIndex
CREATE INDEX "approval_requests_run_id_idx" ON "approval_requests"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_operations_operation_id_key" ON "settlement_operations"("operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_operations_proposal_id_key" ON "settlement_operations"("proposal_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_operations_ledger_entry_id_key" ON "settlement_operations"("ledger_entry_id");

-- CreateIndex
CREATE INDEX "settlement_operations_status_idx" ON "settlement_operations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_operation_id_key" ON "ledger_entries"("operation_id");

-- CreateIndex
CREATE INDEX "ledger_entries_tenant_id_created_at_idx" ON "ledger_entries"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_supplier_id_idx" ON "ledger_entries"("supplier_id");

-- CreateIndex
CREATE INDEX "audit_events_run_id_created_at_idx" ON "audit_events"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_tenant_id_created_at_idx" ON "audit_events"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_idempotency_key_id_fkey" FOREIGN KEY ("idempotency_key_id") REFERENCES "idempotency_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_proposals" ADD CONSTRAINT "refund_proposals_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_proposals" ADD CONSTRAINT "refund_proposals_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_proposals" ADD CONSTRAINT "refund_proposals_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "refund_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_operations" ADD CONSTRAINT "settlement_operations_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_operations" ADD CONSTRAINT "settlement_operations_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "refund_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_operations" ADD CONSTRAINT "settlement_operations_ledger_entry_id_fkey" FOREIGN KEY ("ledger_entry_id") REFERENCES "ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "refund_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
