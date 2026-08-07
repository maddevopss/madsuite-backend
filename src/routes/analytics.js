/**
 * Routes pour les analytics
 * @module routes/analytics
 */

const express = require('express');
const router = express.Router();
const db = require('../core/db');
const logger = require('../observability/logger');

/**
 * POST /api/analytics/event
 * Enregistre un événement
 * @body {string} event_name - Nom de l'événement (requis)
 * @body {Object} properties - Propriétés de l'événement
 * @body {string} timestamp - Timestamp de l'événement
 * @returns {Object} { success: boolean }
 */
router.post('/event', async (req, res) => {
  try {
    const { event_name, properties, timestamp } = req.body;
    const userId = req.user?.id || null;
    const orgId = req.user?.organisation_id || null;

    if (!event_name) {
      return res.status(400).json({ error: 'event_name is required' });
    }

    await db.query(
      `INSERT INTO analytics_events (user_id, organisation_id, event_name, properties, timestamp)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, orgId, event_name, JSON.stringify(properties || {}), timestamp || new Date()]
    );

    res.json({ success: true });
  } catch (error) {
    logger.error('Error recording event', { error });
    res.status(500).json({ error: 'Failed to record event' });
  }
});

/**
 * POST /api/analytics/conversion
 * Enregistre une conversion
 * @body {string} test_name - Nom du test (requis)
 * @body {string} variant - Variante ('A' ou 'B') (requis)
 * @body {Object} metadata - Métadonnées supplémentaires
 * @returns {Object} { success: boolean }
 */
router.post('/conversion', async (req, res) => {
  try {
    const { test_name, variant, ...metadata } = req.body;
    const userId = req.user?.id || null;

    if (!test_name || !variant) {
      return res.status(400).json({ error: 'test_name and variant are required' });
    }

    await db.query(
      `INSERT INTO analytics_conversions (user_id, test_name, variant, metadata)
       VALUES ($1, $2, $3, $4)`,
      [userId, test_name, variant, JSON.stringify(metadata || {})]
    );

    res.json({ success: true });
  } catch (error) {
    logger.error('Error recording conversion', { error });
    res.status(500).json({ error: 'Failed to record conversion' });
  }
});

/**
 * GET /api/analytics/stats
 * Récupère les statistiques d'analytics
 * @query {string} test_name - Nom du test (optionnel)
 * @returns {Object} { stats: Array }
 */
router.get('/stats', async (req, res) => {
  try {
    const { test_name } = req.query;

    let query = `
      SELECT 
        variant,
        COUNT(*) as conversions,
        COUNT(DISTINCT user_id) as unique_users
      FROM analytics_conversions
    `;

    const params = [];

    if (test_name) {
      query += ` WHERE test_name = $1`;
      params.push(test_name);
    }

    query += ` GROUP BY variant`;

    const result = await db.query(query, params);
    res.json({ stats: result.rows });
  } catch (error) {
    logger.error('Error fetching analytics stats', { error });
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * GET /api/analytics/events
 * Récupère les événements
 * @query {string} event_name - Nom de l'événement (optionnel)
 * @query {number} limit - Nombre de résultats (défaut: 100)
 * @returns {Object} { events: Array }
 */
router.get('/events', async (req, res) => {
  try {
    const { event_name, limit = 100 } = req.query;
    const userId = req.user?.id || null;

    let query = `
      SELECT id, event_name, properties, timestamp, created_at
      FROM analytics_events
      WHERE user_id = $1
    `;

    const params = [userId];

    if (event_name) {
      query += ` AND event_name = $${params.length + 1}`;
      params.push(event_name);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(Math.min(parseInt(limit, 10) || 100, 1000));

    const result = await db.query(query, params);
    res.json({ events: result.rows });
  } catch (error) {
    logger.error('Error fetching analytics events', { error });
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

module.exports = router;
