const pool = require('./db');

async function updateAdmin() {
    try {
        console.log('Fetching user admin@admin.com...');
        let res = await pool.query("SELECT id, email, role, role_org FROM utilisateurs WHERE email = 'admin@admin.com'");
        console.log('Before update:', res.rows[0]);
        
        await pool.query("UPDATE utilisateurs SET role_org = 'admin' WHERE email = 'admin@admin.com'");
        
        res = await pool.query("SELECT id, email, role, role_org FROM utilisateurs WHERE email = 'admin@admin.com'");
        console.log('After update:', res.rows[0]);
    } catch (err) {
        console.error('Error:', err);
    } finally {
        pool.end();
    }
}

updateAdmin();
