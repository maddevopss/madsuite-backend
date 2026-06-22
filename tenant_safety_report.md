# MADSuite — Multi-Tenant Safety Enforcement Agent

### TENANT SAFETY SCORE
**30 / 100**

### FINAL STATUS
**CRITICAL**

### CRITICAL FINDINGS
- **[src\generated\prisma\models\activity_app_rules.ts:1179]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\activity_context_rules.ts:879]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\activity_daily_summary.ts:962]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\activity_feedback.ts:1372]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\activity_logs.ts:1627]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\activity_patterns.ts:861]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\activity_project_cache.ts:988]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\billing_ai_suggestions.ts:854]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\business_audit_logs.ts:1014]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\clients.ts:1326]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\cognitive_state_events.ts:1133]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\daily_cognitive_metrics.ts:1307]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\daily_summaries.ts:953]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\estimates.ts:1786]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\estimate_items.ts:966]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\expenses.ts:1525]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\invoices.ts:2403]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\invoice_items.ts:1146]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\organisations.ts:5961]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\projets.ts:3219]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\refresh_tokens.ts:1307]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\schema_migrations.ts:486]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\schema_migrations_executed.ts:543]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\schema_migration_lock.ts:520]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\security_incidents_buffer.ts:902]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\security_incidents_buffer_old.ts:889]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\time_entries.ts:2378]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\user_sessions.ts:1111]** Cross-tenant update/delete possible.
- **[src\generated\prisma\models\utilisateurs.ts:3580]** Cross-tenant update/delete possible.
- **[src\routes\modules.routes.js:37]** Fetch global sans filtrage tenant.
- **[src\routes\punch.routes.js:101]** Cross-tenant update/delete possible.
- **[src\routes\punch.routes.js:135]** Cross-tenant update/delete possible.
- **[src\services\activity.service.js:23]** Cross-tenant update/delete possible.
- **[src\services\activity.service.js:339]** Cross-tenant update/delete possible.
- **[src\services\activity.service.js:360]** Cross-tenant update/delete possible.
- **[src\services\activityIntelligence.service.js:208]** Cross-tenant update/delete possible.
- **[src\services\activityIntelligence.service.js:358]** Cross-tenant update/delete possible.
- **[src\services\activityIntelligence.service.js:385]** Cross-tenant update/delete possible.
- **[src\services\clients.service.js:90]** Cross-tenant update/delete possible.
- **[src\services\portal.service.js:87]** Cross-tenant update/delete possible.
- **[src\services\projectDetection.service.js:78]** Fetch global sans filtrage tenant.
- **[src\services\projets.service.js:206]** Cross-tenant update/delete possible.
- **[src\services\stripe.service.js:33]** Cross-tenant update/delete possible.
- **[src\services\stripe.service.js:80]** Cross-tenant update/delete possible.
- **[src\services\stripe.service.js:142]** Cross-tenant update/delete possible.
- **[src\services\stripe.service.js:215]** Cross-tenant update/delete possible.
- **[src\services\stripe.service.js:228]** Cross-tenant update/delete possible.
- **[src\services\timesheet.service.js:236]** Fetch global sans filtrage tenant.
- **[src\services\users.service.js:183]** Cross-tenant update/delete possible.

### UNSAFE QUERIES
- **Fichier:** src\generated\prisma\internal\class.ts
  **Ligne:** 152
  **Raison:** Manque organisationId dans: `select * from user where id = ${1} or email = ${'user@email.com'};...`

- **Fichier:** src\generated\prisma\models\activity_app_rules.ts
  **Ligne:** 1051
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\activity_app_rules.ts
  **Ligne:** 1080
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\activity_app_rules.ts
  **Ligne:** 1114
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\activity_app_rules.ts
  **Ligne:** 1117
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\activity_app_rules.ts
  **Ligne:** 1179
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one activity_app_rules    *   }    *...`

- **Fichier:** src\generated\prisma\models\activity_app_rules.ts
  **Ligne:** 1193
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\activity_context_rules.ts
  **Ligne:** 751
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\activity_context_rules.ts
  **Ligne:** 780
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\activity_context_rules.ts
  **Ligne:** 814
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\activity_context_rules.ts
  **Ligne:** 817
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\activity_context_rules.ts
  **Ligne:** 879
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one activity_context_rules    *   }    *...`

- **Fichier:** src\generated\prisma\models\activity_context_rules.ts
  **Ligne:** 893
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\activity_daily_summary.ts
  **Ligne:** 834
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\activity_daily_summary.ts
  **Ligne:** 863
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\activity_daily_summary.ts
  **Ligne:** 897
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\activity_daily_summary.ts
  **Ligne:** 900
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\activity_daily_summary.ts
  **Ligne:** 962
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one activity_daily_summary    *   }    *...`

- **Fichier:** src\generated\prisma\models\activity_daily_summary.ts
  **Ligne:** 976
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\activity_feedback.ts
  **Ligne:** 1244
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\activity_feedback.ts
  **Ligne:** 1273
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\activity_feedback.ts
  **Ligne:** 1307
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\activity_feedback.ts
  **Ligne:** 1310
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\activity_feedback.ts
  **Ligne:** 1372
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one activity_feedback    *   }    *...`

- **Fichier:** src\generated\prisma\models\activity_feedback.ts
  **Ligne:** 1386
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\activity_logs.ts
  **Ligne:** 1499
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\activity_logs.ts
  **Ligne:** 1528
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\activity_logs.ts
  **Ligne:** 1562
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\activity_logs.ts
  **Ligne:** 1565
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\activity_logs.ts
  **Ligne:** 1627
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one activity_logs    *   }    *...`

- **Fichier:** src\generated\prisma\models\activity_logs.ts
  **Ligne:** 1641
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\activity_patterns.ts
  **Ligne:** 733
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\activity_patterns.ts
  **Ligne:** 762
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\activity_patterns.ts
  **Ligne:** 796
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\activity_patterns.ts
  **Ligne:** 799
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\activity_patterns.ts
  **Ligne:** 861
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one activity_patterns    *   }    *...`

- **Fichier:** src\generated\prisma\models\activity_patterns.ts
  **Ligne:** 875
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\activity_project_cache.ts
  **Ligne:** 860
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\activity_project_cache.ts
  **Ligne:** 889
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\activity_project_cache.ts
  **Ligne:** 923
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\activity_project_cache.ts
  **Ligne:** 926
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\activity_project_cache.ts
  **Ligne:** 988
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one activity_project_cache    *   }    *...`

- **Fichier:** src\generated\prisma\models\activity_project_cache.ts
  **Ligne:** 1002
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\billing_ai_suggestions.ts
  **Ligne:** 726
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\billing_ai_suggestions.ts
  **Ligne:** 755
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\billing_ai_suggestions.ts
  **Ligne:** 789
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\billing_ai_suggestions.ts
  **Ligne:** 792
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\billing_ai_suggestions.ts
  **Ligne:** 854
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one billing_ai_suggestions    *   }    *...`

- **Fichier:** src\generated\prisma\models\billing_ai_suggestions.ts
  **Ligne:** 868
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\business_audit_logs.ts
  **Ligne:** 886
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\business_audit_logs.ts
  **Ligne:** 915
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\business_audit_logs.ts
  **Ligne:** 949
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\business_audit_logs.ts
  **Ligne:** 952
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\business_audit_logs.ts
  **Ligne:** 1014
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one business_audit_logs    *   }    *...`

- **Fichier:** src\generated\prisma\models\business_audit_logs.ts
  **Ligne:** 1028
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\clients.ts
  **Ligne:** 1198
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\clients.ts
  **Ligne:** 1227
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\clients.ts
  **Ligne:** 1261
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\clients.ts
  **Ligne:** 1264
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\clients.ts
  **Ligne:** 1326
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one clients    *   }    *...`

- **Fichier:** src\generated\prisma\models\clients.ts
  **Ligne:** 1340
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\cognitive_state_events.ts
  **Ligne:** 1005
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\cognitive_state_events.ts
  **Ligne:** 1034
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\cognitive_state_events.ts
  **Ligne:** 1068
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\cognitive_state_events.ts
  **Ligne:** 1071
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\cognitive_state_events.ts
  **Ligne:** 1133
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one cognitive_state_events    *   }    *...`

- **Fichier:** src\generated\prisma\models\cognitive_state_events.ts
  **Ligne:** 1147
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\daily_cognitive_metrics.ts
  **Ligne:** 1179
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\daily_cognitive_metrics.ts
  **Ligne:** 1208
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\daily_cognitive_metrics.ts
  **Ligne:** 1242
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\daily_cognitive_metrics.ts
  **Ligne:** 1245
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\daily_cognitive_metrics.ts
  **Ligne:** 1307
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one daily_cognitive_metrics    *   }    *...`

- **Fichier:** src\generated\prisma\models\daily_cognitive_metrics.ts
  **Ligne:** 1321
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\daily_summaries.ts
  **Ligne:** 825
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\daily_summaries.ts
  **Ligne:** 854
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\daily_summaries.ts
  **Ligne:** 888
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\daily_summaries.ts
  **Ligne:** 891
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\daily_summaries.ts
  **Ligne:** 953
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one daily_summaries    *   }    *...`

- **Fichier:** src\generated\prisma\models\daily_summaries.ts
  **Ligne:** 967
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\estimates.ts
  **Ligne:** 1658
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\estimates.ts
  **Ligne:** 1687
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\estimates.ts
  **Ligne:** 1721
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\estimates.ts
  **Ligne:** 1724
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\estimates.ts
  **Ligne:** 1786
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one estimates    *   }    *...`

- **Fichier:** src\generated\prisma\models\estimates.ts
  **Ligne:** 1800
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\estimate_items.ts
  **Ligne:** 838
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\estimate_items.ts
  **Ligne:** 867
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\estimate_items.ts
  **Ligne:** 901
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\estimate_items.ts
  **Ligne:** 904
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\estimate_items.ts
  **Ligne:** 966
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one estimate_items    *   }    *...`

- **Fichier:** src\generated\prisma\models\estimate_items.ts
  **Ligne:** 980
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\expenses.ts
  **Ligne:** 1397
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\expenses.ts
  **Ligne:** 1426
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\expenses.ts
  **Ligne:** 1460
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\expenses.ts
  **Ligne:** 1463
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\expenses.ts
  **Ligne:** 1525
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one expenses    *   }    *...`

- **Fichier:** src\generated\prisma\models\expenses.ts
  **Ligne:** 1539
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\invoices.ts
  **Ligne:** 2275
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\invoices.ts
  **Ligne:** 2304
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\invoices.ts
  **Ligne:** 2338
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\invoices.ts
  **Ligne:** 2341
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\invoices.ts
  **Ligne:** 2403
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one invoices    *   }    *...`

- **Fichier:** src\generated\prisma\models\invoices.ts
  **Ligne:** 2417
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\invoice_items.ts
  **Ligne:** 1018
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\invoice_items.ts
  **Ligne:** 1047
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\invoice_items.ts
  **Ligne:** 1081
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\invoice_items.ts
  **Ligne:** 1084
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\invoice_items.ts
  **Ligne:** 1146
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one invoice_items    *   }    *...`

- **Fichier:** src\generated\prisma\models\invoice_items.ts
  **Ligne:** 1160
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\organisations.ts
  **Ligne:** 5833
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\organisations.ts
  **Ligne:** 5862
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\organisations.ts
  **Ligne:** 5896
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\organisations.ts
  **Ligne:** 5899
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\organisations.ts
  **Ligne:** 5961
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one organisations    *   }    *...`

- **Fichier:** src\generated\prisma\models\organisations.ts
  **Ligne:** 5975
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\projets.ts
  **Ligne:** 3091
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\projets.ts
  **Ligne:** 3120
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\projets.ts
  **Ligne:** 3154
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\projets.ts
  **Ligne:** 3157
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\projets.ts
  **Ligne:** 3219
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one projets    *   }    *...`

- **Fichier:** src\generated\prisma\models\projets.ts
  **Ligne:** 3233
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\refresh_tokens.ts
  **Ligne:** 1179
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\refresh_tokens.ts
  **Ligne:** 1208
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\refresh_tokens.ts
  **Ligne:** 1242
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\refresh_tokens.ts
  **Ligne:** 1245
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\refresh_tokens.ts
  **Ligne:** 1307
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one refresh_tokens    *   }    *...`

- **Fichier:** src\generated\prisma\models\refresh_tokens.ts
  **Ligne:** 1321
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\schema_migrations.ts
  **Ligne:** 358
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\schema_migrations.ts
  **Ligne:** 387
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\schema_migrations.ts
  **Ligne:** 421
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\schema_migrations.ts
  **Ligne:** 424
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\schema_migrations.ts
  **Ligne:** 486
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one schema_migrations    *   }    *...`

- **Fichier:** src\generated\prisma\models\schema_migrations.ts
  **Ligne:** 500
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\schema_migrations_executed.ts
  **Ligne:** 415
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\schema_migrations_executed.ts
  **Ligne:** 444
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\schema_migrations_executed.ts
  **Ligne:** 478
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\schema_migrations_executed.ts
  **Ligne:** 481
  **Raison:** Manque organisationId dans: `select: { version: true }...`

- **Fichier:** src\generated\prisma\models\schema_migrations_executed.ts
  **Ligne:** 543
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one schema_migrations_executed    *   }    *...`

- **Fichier:** src\generated\prisma\models\schema_migrations_executed.ts
  **Ligne:** 557
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\schema_migration_lock.ts
  **Ligne:** 392
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\schema_migration_lock.ts
  **Ligne:** 421
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\schema_migration_lock.ts
  **Ligne:** 455
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\schema_migration_lock.ts
  **Ligne:** 458
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\schema_migration_lock.ts
  **Ligne:** 520
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one schema_migration_lock    *   }    *...`

- **Fichier:** src\generated\prisma\models\schema_migration_lock.ts
  **Ligne:** 534
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\security_incidents_buffer.ts
  **Ligne:** 774
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\security_incidents_buffer.ts
  **Ligne:** 803
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\security_incidents_buffer.ts
  **Ligne:** 837
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\security_incidents_buffer.ts
  **Ligne:** 840
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\security_incidents_buffer.ts
  **Ligne:** 902
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one security_incidents_buffer    *   }    *...`

- **Fichier:** src\generated\prisma\models\security_incidents_buffer.ts
  **Ligne:** 916
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\security_incidents_buffer_old.ts
  **Ligne:** 761
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\security_incidents_buffer_old.ts
  **Ligne:** 790
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\security_incidents_buffer_old.ts
  **Ligne:** 824
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\security_incidents_buffer_old.ts
  **Ligne:** 827
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\security_incidents_buffer_old.ts
  **Ligne:** 889
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one security_incidents_buffer_old    *   }    *...`

- **Fichier:** src\generated\prisma\models\security_incidents_buffer_old.ts
  **Ligne:** 903
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\time_entries.ts
  **Ligne:** 2250
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\time_entries.ts
  **Ligne:** 2279
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\time_entries.ts
  **Ligne:** 2313
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\time_entries.ts
  **Ligne:** 2316
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\time_entries.ts
  **Ligne:** 2378
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one time_entries    *   }    *...`

- **Fichier:** src\generated\prisma\models\time_entries.ts
  **Ligne:** 2392
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\user_sessions.ts
  **Ligne:** 983
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\user_sessions.ts
  **Ligne:** 1012
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\user_sessions.ts
  **Ligne:** 1046
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\user_sessions.ts
  **Ligne:** 1049
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\user_sessions.ts
  **Ligne:** 1111
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one user_sessions    *   }    *...`

- **Fichier:** src\generated\prisma\models\user_sessions.ts
  **Ligne:** 1125
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\generated\prisma\models\utilisateurs.ts
  **Ligne:** 3452
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\utilisateurs.ts
  **Ligne:** 3481
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   }    *...`

- **Fichier:** src\generated\prisma\models\utilisateurs.ts
  **Ligne:** 3515
  **Raison:** Manque organisationId dans: `take: 10...`

- **Fichier:** src\generated\prisma\models\utilisateurs.ts
  **Ligne:** 3518
  **Raison:** Manque organisationId dans: `select: { id: true }...`

- **Fichier:** src\generated\prisma\models\utilisateurs.ts
  **Ligne:** 3580
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... filter to delete one utilisateurs    *   }    *...`

- **Fichier:** src\generated\prisma\models\utilisateurs.ts
  **Ligne:** 3594
  **Raison:** Manque organisationId dans: `*   where: {    *     // ... provide filter here    *   },    *   data: {    *     // ... provid...`

- **Fichier:** src\middleware\requireModule.js
  **Ligne:** 28
  **Raison:** Manque organisationId dans: `select plan_type from organisations where id = $1...`

- **Fichier:** src\middleware\requireModule.js
  **Ligne:** 66
  **Raison:** Manque organisationId dans: `select plan_type from organisations where id = $1...`

- **Fichier:** src\routes\billingAssistant.routes.js
  **Ligne:** 72
  **Raison:** Manque organisationId dans: `select te.*         from time_entries te         where ${conditions.join(" and ")}...`

- **Fichier:** src\routes\billingAssistant.routes.js
  **Ligne:** 117
  **Raison:** Manque organisationId dans: `select te.id, te.utilisateur_id, te.projet_id, te.start_time, te.end_time, te.description...`

- **Fichier:** src\routes\modules.routes.js
  **Ligne:** 20
  **Raison:** Manque organisationId dans: `select plan_type from organisations where id = $1...`

- **Fichier:** src\routes\modules.routes.js
  **Ligne:** 37
  **Raison:** Manque organisationId dans: `select module_key, price_cents, currency from module_pricing...`

- **Fichier:** src\routes\portal.routes.js
  **Ligne:** 72
  **Raison:** Manque organisationId dans: `select stripe_account_id from organisations where id = $1...`

- **Fichier:** src\routes\punch.routes.js
  **Ligne:** 12
  **Raison:** Manque organisationId dans: `select id, nom from organisations where kiosk_token = $1...`

- **Fichier:** src\routes\punch.routes.js
  **Ligne:** 72
  **Raison:** Manque organisationId dans: `select id, start_time, projet_id from time_entries where utilisateur_id = $1 and end_time is null an...`

- **Fichier:** src\routes\punch.routes.js
  **Ligne:** 101
  **Raison:** Manque organisationId dans: `update time_entries set end_time = now() where utilisateur_id = $1 and end_time is null and deleted_...`

- **Fichier:** src\routes\punch.routes.js
  **Ligne:** 135
  **Raison:** Manque organisationId dans: `update time_entries set end_time = now() where utilisateur_id = $1 and end_time is null and deleted_...`

- **Fichier:** src\services\activity.service.js
  **Ligne:** 23
  **Raison:** Manque organisationId dans: `delete from activity_logs      where utilisateur_id = $1        and captured_at < now() - ($2::int...`

- **Fichier:** src\services\activity.service.js
  **Ligne:** 89
  **Raison:** Manque organisationId dans: `insert into activity_logs (${columns.join(", ")})      values (${placeholders})      returning *...`

- **Fichier:** src\services\activity.service.js
  **Ligne:** 262
  **Raison:** Manque organisationId dans: `select id, app_name, window_title, duration_seconds,             is_idle, idle_seconds, captured_at...`

- **Fichier:** src\services\activity.service.js
  **Ligne:** 281
  **Raison:** Manque organisationId dans: `select *      from activity_logs      where utilisateur_id = $1        and type = 'active'...`

- **Fichier:** src\services\activity.service.js
  **Ligne:** 311
  **Raison:** Manque organisationId dans: `select       ads.app_name,       sum(ads.total_seconds) as total_seconds     from activity_...`

- **Fichier:** src\services\activity.service.js
  **Ligne:** 339
  **Raison:** Manque organisationId dans: `update activity_logs      set duration_seconds = coalesce(duration_seconds, 0) + $1,          is_i...`

- **Fichier:** src\services\activity.service.js
  **Ligne:** 360
  **Raison:** Manque organisationId dans: `delete from activity_logs       where utilisateur_id = $1         ${organisationcondition}...`

- **Fichier:** src\services\activityIntelligence.service.js
  **Ligne:** 40
  **Raison:** Manque organisationId dans: `select id, app_pattern, title_pattern, category, tag, confidence, is_productive, priority, a...`

- **Fichier:** src\services\activityIntelligence.service.js
  **Ligne:** 150
  **Raison:** Manque organisationId dans: `select       app_name,       coalesce(activity_category, 'non classé') as activity_category,...`

- **Fichier:** src\services\activityIntelligence.service.js
  **Ligne:** 186
  **Raison:** Manque organisationId dans: `select *     from activity_logs     where ${conditions.join(" and ")}     limit 1...`

- **Fichier:** src\services\activityIntelligence.service.js
  **Ligne:** 208
  **Raison:** Manque organisationId dans: `update activity_logs     set activity_category = $1,         confidence_score = $2     wher...`

- **Fichier:** src\services\activityIntelligence.service.js
  **Ligne:** 258
  **Raison:** Manque organisationId dans: `select *     from activity_app_rules     where ${conditions.join(" and ")}     order by act...`

- **Fichier:** src\services\activityIntelligence.service.js
  **Ligne:** 313
  **Raison:** Manque organisationId dans: `select *     from activity_app_rules     where ${conditions.join(" and ")}     limit 1...`

- **Fichier:** src\services\activityIntelligence.service.js
  **Ligne:** 358
  **Raison:** Manque organisationId dans: `update activity_app_rules     set app_pattern = $1,         title_pattern = $2,         cat...`

- **Fichier:** src\services\activityIntelligence.service.js
  **Ligne:** 385
  **Raison:** Manque organisationId dans: `update activity_app_rules     set active = false,         updated_at = current_timestamp...`

- **Fichier:** src\services\ai.service.js
  **Ligne:** 102
  **Raison:** Manque organisationId dans: `select id, nom, taux_horaire from projets where id = any($1)...`

- **Fichier:** src\services\billingDashboard.service.js
  **Ligne:** 113
  **Raison:** Manque organisationId dans: `select         coalesce(sum(${hoursexpression}), 0) as unbilled_hours,         coalesce(su...`

- **Fichier:** src\services\billingDashboard.service.js
  **Ligne:** 125
  **Raison:** Manque organisationId dans: `select coalesce(sum(${hoursexpression}), 0) as billed_hours       from time_entries te...`

- **Fichier:** src\services\billingDashboard.service.js
  **Ligne:** 135
  **Raison:** Manque organisationId dans: `select         coalesce(sum(case when i.status in ('draft', 'sent', 'paid') then i.total el...`

- **Fichier:** src\services\billingDashboard.service.js
  **Ligne:** 148
  **Raison:** Manque organisationId dans: `select         c.id as client_id,         c.nom as client_nom,         coalesce(sum(${amo...`

- **Fichier:** src\services\billingDashboard.service.js
  **Ligne:** 165
  **Raison:** Manque organisationId dans: `select         p.id as projet_id,         p.nom as projet_nom,         c.nom as client_no...`

- **Fichier:** src\services\billingDashboard.service.js
  **Ligne:** 183
  **Raison:** Manque organisationId dans: `select         i.id,         i.invoice_number,         i.status,         i.issue_date,...`

- **Fichier:** src\services\billingDashboard.service.js
  **Ligne:** 201
  **Raison:** Manque organisationId dans: `select         i.id,         i.invoice_number,         i.status,         i.issue_date,...`

- **Fichier:** src\services\billingDashboard.service.js
  **Ligne:** 219
  **Raison:** Manque organisationId dans: `select         i.id,         i.invoice_number,         i.status,         i.issue_date,...`

- **Fichier:** src\services\billingDashboard.service.js
  **Ligne:** 237
  **Raison:** Manque organisationId dans: `select         i.status,         count(*) as count,         coalesce(sum(i.total), 0) as...`

- **Fichier:** src\services\clients.service.js
  **Ligne:** 15
  **Raison:** Manque organisationId dans: `select * from clients ${where} order by created_at desc...`

- **Fichier:** src\services\clients.service.js
  **Ligne:** 26
  **Raison:** Manque organisationId dans: `select * from clients where ${conditions.join(" and ")}...`

- **Fichier:** src\services\clients.service.js
  **Ligne:** 90
  **Raison:** Manque organisationId dans: `update clients     set ${setclauses.join(", ")}     where ${conditions.join(" and ")}     r...`

- **Fichier:** src\services\invoice.service.js
  **Ligne:** 106
  **Raison:** Manque organisationId dans: `select       i.id,       i.invoice_number,       i.status,       i.issue_date,       i.du...`

- **Fichier:** src\services\invoice.service.js
  **Ligne:** 141
  **Raison:** Manque organisationId dans: `select       e.id,       e.montant as amount,       e.description,       e.date_depense as...`

- **Fichier:** src\services\invoice.service.js
  **Ligne:** 169
  **Raison:** Manque organisationId dans: `select       te.id,       te.projet_id,       p.nom as projet_nom,       c.id as client_id...`

- **Fichier:** src\services\invoice.service.js
  **Ligne:** 217
  **Raison:** Manque organisationId dans: `select i.*, c.nom as client_nom, c.email as client_email, c.phone as client_phone     from in...`

- **Fichier:** src\services\invoice.service.js
  **Ligne:** 641
  **Raison:** Manque organisationId dans: `select id, status, version       from invoices       where ${conditions.join(" and ")}...`

- **Fichier:** src\services\portal.service.js
  **Ligne:** 19
  **Raison:** Manque organisationId dans: `select stripe_account_id, nom from organisations where id = $1...`

- **Fichier:** src\services\portal.service.js
  **Ligne:** 42
  **Raison:** Manque organisationId dans: `select nom from organisations where id = $1...`

- **Fichier:** src\services\portal.service.js
  **Ligne:** 87
  **Raison:** Manque organisationId dans: `update estimates set status = $1, updated_at = current_timestamp${signatureclause} where id = $2 ret...`

- **Fichier:** src\services\projectDetection.service.js
  **Ligne:** 78
  **Raison:** Manque organisationId dans: `select projet_id, keyword, coalesce(weight, 1) as weight       from activity_patterns...`

- **Fichier:** src\services\projets.service.js
  **Ligne:** 15
  **Raison:** Manque organisationId dans: `select       p.*,       c.nom as client_nom     from projets p     join clients c on c.id...`

- **Fichier:** src\services\projets.service.js
  **Ligne:** 38
  **Raison:** Manque organisationId dans: `select p.*     from projets p     join clients c on c.id = p.client_id     where ${conditio...`

- **Fichier:** src\services\projets.service.js
  **Ligne:** 58
  **Raison:** Manque organisationId dans: `select id from clients where ${conditions.join(" and ")}...`

- **Fichier:** src\services\projets.service.js
  **Ligne:** 70
  **Raison:** Manque organisationId dans: `select       p.*,       c.nom as client_nom     from projets p     join clients c on c.id...`

- **Fichier:** src\services\projets.service.js
  **Ligne:** 206
  **Raison:** Manque organisationId dans: `update projets       set ${setclauses.join(", ")}       where ${conditions.join(" and ")}...`

- **Fichier:** src\services\reports.service.js
  **Ligne:** 50
  **Raison:** Manque organisationId dans: `select        c.id as client_id,        c.nom as client,        p.id as projet_id,        p.nom...`

- **Fichier:** src\services\reports.service.js
  **Ligne:** 144
  **Raison:** Manque organisationId dans: `select *     from activity_logs     where ${conditions.join(" and ")}     limit 10...`

- **Fichier:** src\services\stripe.service.js
  **Ligne:** 12
  **Raison:** Manque organisationId dans: `select nom, stripe_customer_id from organisations where id = $1...`

- **Fichier:** src\services\stripe.service.js
  **Ligne:** 33
  **Raison:** Manque organisationId dans: `update organisations set stripe_customer_id = $1 where id = $2...`

- **Fichier:** src\services\stripe.service.js
  **Ligne:** 68
  **Raison:** Manque organisationId dans: `select stripe_account_id from organisations where id = $1...`

- **Fichier:** src\services\stripe.service.js
  **Ligne:** 80
  **Raison:** Manque organisationId dans: `update organisations set stripe_account_id = $1 where id = $2...`

- **Fichier:** src\services\stripe.service.js
  **Ligne:** 142
  **Raison:** Manque organisationId dans: `update organisations               set stripe_subscription_id = $1,                   plan_type = 'p...`

- **Fichier:** src\services\stripe.service.js
  **Ligne:** 215
  **Raison:** Manque organisationId dans: `update organisations             set plan_type = 'free',                 subscription_status = 'canc...`

- **Fichier:** src\services\stripe.service.js
  **Ligne:** 228
  **Raison:** Manque organisationId dans: `update organisations             set subscription_status = $1            where stripe_customer_id =...`

- **Fichier:** src\services\stripeCheckout.service.js
  **Ligne:** 12
  **Raison:** Manque organisationId dans: `select price_cents, currency, description from module_pricing where module_key = $1...`

- **Fichier:** src\services\timesheet.service.js
  **Ligne:** 236
  **Raison:** Manque organisationId dans: `select count(*)::int as total     ${fromclause}...`

- **Fichier:** src\services\timesheet.service.js
  **Ligne:** 249
  **Raison:** Manque organisationId dans: `select       te.id,       te.projet_id,       te.utilisateur_id,       te.description,...`

- **Fichier:** src\services\users.service.js
  **Ligne:** 183
  **Raison:** Manque organisationId dans: `update user_sessions        set active = false,            logout_time = coalesce(logout_time, now...`

- **Fichier:** src\utils\organisationScope.js
  **Ligne:** 48
  **Raison:** Manque organisationId dans: `select timezone from organisations where id = $1...`

### SAFE QUERIES
- **Fichier:** src\controllers\invoiceController.js (Ligne: 10)
- **Fichier:** src\controllers\invoiceController.js (Ligne: 21)
- **Fichier:** src\controllers\invoiceController.js (Ligne: 38)
- **Fichier:** src\controllers\timeEntryController.js (Ligne: 31)
- **Fichier:** src\jobs\weeklyReport.js (Ligne: 86)
- ...et 97 autres

### AUTO FIXES
*(Auto fixes suggest using JOINs or explicit organisation_id filtering in the where clause)*