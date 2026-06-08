const { Router } = require('express');
const { q, findLogEntriesByUserIds, uuid } = require('../db/queries');
const { authenticateToken } = require('../middleware/auth');
const { canInvite } = require('./auth');

const router = Router();
router.use(authenticateToken);

router.get('/', (req, res) => {
  const { userIds } = req.query;
  if (userIds) {
    if (!canInvite(req.user.userId)) return res.status(403).json({ error: 'Not authorized' });
    const ids = userIds.split(',').filter(Boolean);
    if (ids.length === 0) return res.json({ entries: [] });
    const entries = findLogEntriesByUserIds(ids);
    return res.json({ entries });
  }
  const entries = q.findLogEntries.all(req.user.userId);
  res.json({ entries });
});

router.post('/', (req, res) => {
  const {
    handler_name, dog_name, place_lat, place_lng, place_name,
    search_date, search_time, weather_conditions,
    search_duration_seconds, path_length_meters,
    difficulties, path_type, handler_feelings, notes,
    session_id, search_session_id,
  } = req.body;

  if (!handler_name || !dog_name || !search_date || !search_time) {
    return res.status(400).json({ error: 'handler_name, dog_name, search_date, search_time required' });
  }

  const id = uuid();
  q.insertLogEntry.run(
    id, req.user.userId, session_id || null, search_session_id || null,
    handler_name, dog_name,
    place_lat != null ? place_lat : null, place_lng != null ? place_lng : null, place_name || null,
    search_date, search_time,
    weather_conditions || '',
    search_duration_seconds != null ? search_duration_seconds : null,
    path_length_meters != null ? path_length_meters : null,
    JSON.stringify(difficulties || []),
    path_type || '',
    JSON.stringify(handler_feelings || []),
    notes || '',
  );

  const entry = q.findLogEntryById.get(id);
  res.status(201).json({ entry });
});

router.get('/:id', (req, res) => {
  const entry = q.findLogEntryById.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Log entry not found' });
  if (entry.user_id !== req.user.userId && !canInvite(req.user.userId)) {
    return res.status(403).json({ error: 'Not your entry' });
  }
  res.json({ entry });
});

router.put('/:id', (req, res) => {
  const existing = q.findLogEntryById.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Log entry not found' });
  if (existing.user_id !== req.user.userId) return res.status(403).json({ error: 'Not your entry' });

  const {
    handler_name, dog_name, place_lat, place_lng, place_name,
    search_date, search_time, weather_conditions,
    search_duration_seconds, path_length_meters,
    difficulties, path_type, handler_feelings, notes,
  } = req.body;

  q.updateLogEntry.run(
    handler_name ?? existing.handler_name,
    dog_name ?? existing.dog_name,
    place_lat != null ? place_lat : existing.place_lat,
    place_lng != null ? place_lng : existing.place_lng,
    place_name ?? existing.place_name,
    search_date ?? existing.search_date,
    search_time ?? existing.search_time,
    weather_conditions ?? existing.weather_conditions,
    search_duration_seconds != null ? search_duration_seconds : existing.search_duration_seconds,
    path_length_meters != null ? path_length_meters : existing.path_length_meters,
    difficulties ? JSON.stringify(difficulties) : existing.difficulties,
    path_type ?? existing.path_type,
    handler_feelings ? JSON.stringify(handler_feelings) : existing.handler_feelings,
    notes ?? existing.notes,
    req.params.id,
    req.user.userId,
  );

  const entry = q.findLogEntryById.get(req.params.id);
  res.json({ entry });
});

router.delete('/:id', (req, res) => {
  const existing = q.findLogEntryById.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Log entry not found' });
  if (existing.user_id !== req.user.userId) return res.status(403).json({ error: 'Not your entry' });
  q.deleteLogEntry.run(req.params.id, req.user.userId);
  res.json({ success: true });
});

module.exports = router;
