const axios = require('axios');

async function fetchAndParseICal(url) {
  try {
    const { data } = await axios.get(url);
    const events = [];
    const lines = data.split(/\r?\n/);
    
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
          currentEvent.summary = line.substring(8);
        } else if (line.startsWith('DTSTART:')) {
          currentEvent.start = parseICalDate(line.substring(8));
        } else if (line.startsWith('DTEND:')) {
          currentEvent.end = parseICalDate(line.substring(6));
        } else if (line.startsWith('UID:')) {
          currentEvent.uid = line.substring(4);
        }
      }
    }
    
    return events;
  } catch (error) {
    console.error('Erreur iCal:', error.message);
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
    
    return new Date(`${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`);
  }
  return new Date();
}

module.exports = { fetchAndParseICal };
