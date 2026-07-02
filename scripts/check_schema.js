const fs = require('fs');
const c = fs.readFileSync('backend/db/schema_current.sql', 'utf8');
c.split('\n').forEach(function(l, i) {
  if (l.indexOf('template_invoice_id') >= 0 || l.indexOf('recurring_invoices') >= 0) {
    console.log(i + 1, l);
  }
});
