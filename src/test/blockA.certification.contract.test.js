const path = require('path');
const { execFileSync } = require('child_process');

describe('Bloc A — certification backend', () => {
  test('les preuves transversales minimales sont présentes', () => {
    const script = path.resolve(__dirname, '../../scripts/guard-block-a-certification.js');
    const output = execFileSync(process.execPath, [script], { encoding: 'utf8' });

    expect(output).toContain('PASS permissions');
    expect(output).toContain('PASS migrations');
    expect(output).toContain('PASS transactions');
    expect(output).toContain('PASS multiTenant');
    expect(output).toContain('PASS api');
    expect(output).toContain('PASS performance');
    expect(output).toContain('PASS recovery');
  });
});
