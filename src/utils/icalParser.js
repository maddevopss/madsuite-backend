const axios = require('axios');
const logger = require('../config/logger');

const MAX_ICAL_BYTES = 1024 * 1024;
const ICAL_TIMEOUT_MS = 10000;
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^0\./,
  /^169\.254\./,
  /^::1$/,
];

function validateICalUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  if (rawUrl.length > 2048) return null;

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    return null;
  }

  if (!['https:', 'http:'].includes(parsed.protocol)) return null;
  if (!parsed.hostname) return null;

  const hostname = parsed.hostname.toLowerCase();
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) return null;

  return parsed.toString();
}

async function fetchAndParseICal(url) {
  const safeUrl = validateICalUrl(url);
  if (!safeUrl) return [];

  try {
    const { data } = await axios.get(safeUrl, {
      timeout: ICAL_TIMEOUT_MS,
      maxContentLength: MAX_ICAL_BYTES,
      maxBodyLength: MAX_ICAL_BYTES,
      responseType: 'text',
      transformResponse: [(body) => body],
      validateStatus: (status) => status >= 200 && status < 300,
    });

    if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > MAX_ICAL_BYTES) {
      return [];
    }

    const events = [];
    const lines = data.split(/\r?\n/).slice(0, 50000);
    
    let currentEvent = null;
    
    for (const line of lines) {
      if (line.startsWith('BEGIN:VEVENT')) {
        currentEvent = {};
      } else if (line.startsWith('END:VEVENT')) {
        if (currentEvent) {
          events.push(currentEvent);
          currentEvent = null;
        }
      } else if (currentEvent) {
        if (line.startsWith('SUMMARY:')) {
          currentEvent.summary = line.substring(8).slice(0, 500);
        } else if (line.startsWith('DTSTART:')) {
          currentEvent.start = parseICalDate(line.substring(8));
        } else if (line.startsWith('DTEND:')) {
          currentEvent.end = parseICalDate(line.substring(6));
        } else if (line.startsWith('UID:')) {
          currentEvent.uid = line.substring(4).slice(0, 300);
        }
      }
    }
    
    return events;
  } catch (error) {
    logger.warn('Erreur iCal', { error: error.message });
    return [];
  }
}

function parseICalDate(icalDateStr) {
  // Format: 20231024T140000Z or 20231024
  if (!icalDateStr) return new Date();
  
  const str = icalDateStr.replace(/[^0-9T]/g, '');
  if (str.length >= 8) {
    const year = str.substring(0, 4);
    const month = str.substring(4, 6);
    const day = str.substring(6, 8);
    
    let hours = '00', minutes = '00', seconds = '00';
    if (str.length >= 15 && str.includes('T')) {
      const timePart = str.split('T')[1];
      hours = timePart.substring(0, 2);
      minutes = timePart.substring(2, 4);
      seconds = timePart.substring(4, 6);
    }
    
    const parsed = new Date(`${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`);
    if (Number.isNaN(parsed.getTime())) return new Date();
    return parsed;
  }
  return new Date();
}

module.exports = { fetchAndParseICal, validateICalUrl };
