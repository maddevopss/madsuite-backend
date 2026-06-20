const pool = require('./db');

async function fixDB() {
    try {
        console.log('Fixing roles constraint...');
        await pool.query(`
            ALTER TABLE utilisateurs DROP CONSTRAINT IF EXISTS chk_role;
            ALTER TABLE utilisateurs ADD CONSTRAINT chk_role CHECK (role IN ('admin', 'employe', 'manager', 'user', 'administrateur'));
        `);
        console.log('Roles constraint updated.');

        console.log('Activating all modules for organisation 1...');
        const modules = [
            'clients', 'projets', 'timesheet', 'reports', 'settings', 'invoices',
            'calcul_km', 'kiosk_km', 'estimates', 'activity_intelligence', 'billing_assistant'
        ];
        
        for (const mod of modules) {
            await pool.query(`
                INSERT INTO organisation_modules (organisation_id, module_key, is_active) 
                VALUES (1, $1, true)
                ON CONFLICT (organisation_id, module_key) DO UPDATE SET is_active = true
            `, [mod]);
        }
        console.log('Modules activated.');

    } catch (err) {
        console.error('Error:', err);
    } finally {
        // pool.end might not exist if it's a wrapper, we can just process.exit
        process.exit(0);
    }
}

fixDB();
