-- Migration 051: Cron Execution Logs Table
-- Used to monitor background jobs execution status

CREATE TABLE IF NOT EXISTS cron_execution_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_name VARCHAR(100) NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) NOT NULL, -- 'STARTED', 'SUCCESS', 'FAILED'
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_cron_execution_logs_job_name ON cron_execution_logs(job_name);
CREATE INDEX IF NOT EXISTS idx_cron_execution_logs_status ON cron_execution_logs(status);
CREATE INDEX IF NOT EXISTS idx_cron_execution_logs_started_at ON cron_execution_logs(started_at);
