function defineJob(definition = {}) {
  const job = {
    name: String(definition.name || '').trim(),
    owner: String(definition.owner || '').trim(),
    schedule: String(definition.schedule || '').trim(),
    lockKey: String(definition.lockKey || '').trim(),
    timeoutMs: Number(definition.timeoutMs),
  };
  if (!job.name || !job.owner || !job.schedule || !job.lockKey || !Number.isInteger(job.timeoutMs) || job.timeoutMs < 1000) {
    throw new Error('job.definition.invalid');
  }
  return Object.freeze(job);
}

function buildJobRegistry(definitions = []) {
  const jobs = definitions.map(defineJob);
  const names = new Set();
  const locks = new Set();
  for (const job of jobs) {
    if (names.has(job.name)) throw new Error('job.name.duplicate');
    if (locks.has(job.lockKey)) throw new Error('job.lock.duplicate');
    names.add(job.name);
    locks.add(job.lockKey);
  }
  return Object.freeze({ contract: 'scheduled-jobs@1', jobs });
}

function executionWindow(job, startedAt = new Date()) {
  return { job: job.name, lockKey: job.lockKey, startedAt: startedAt.toISOString(), deadlineAt: new Date(startedAt.getTime() + job.timeoutMs).toISOString() };
}

module.exports = { defineJob, buildJobRegistry, executionWindow };
