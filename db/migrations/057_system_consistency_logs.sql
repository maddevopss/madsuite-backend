-- Table to store the results of business invariant checks
CREATE TABLE IF NOT EXISTS system_consistency_logs (
    id SERIAL PRIMARY KEY,
    invariant_name VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL, -- 'PASS', 'FAIL', 'WARNING', 'ERROR'
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    details JSONB
);

CREATE INDEX IF NOT EXISTS idx_system_consistency_logs_invariant ON system_consistency_logs(invariant_name);
CREATE INDEX IF NOT EXISTS idx_system_consistency_logs_status ON system_consistency_logs(status);
