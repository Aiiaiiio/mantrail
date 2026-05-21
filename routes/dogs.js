const { Router } = require('express');
const { q, uuid } = require('../db/queries');
const { authenticateToken } = require('../middleware/auth');

const router = Router();
router.use(authenticateToken);

router.get('/', (req, res) => {
  const dogs = q.findDogs.all(req.user.userId);
  res.json({ dogs });
});

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Dog name required' });
  }
  const id = uuid();
  q.insertDog.run(id, req.user.userId, name.trim());
  const dog = q.findDogById.get(id);
  res.status(201).json({ dog });
});

router.delete('/:id', (req, res) => {
  const dog = q.findDogById.get(req.params.id);
  if (!dog) return res.status(404).json({ error: 'Dog not found' });
  if (dog.user_id !== req.user.userId) return res.status(403).json({ error: 'Not your dog' });
  q.deleteDog.run(req.params.id, req.user.userId);
  res.json({ success: true });
});

module.exports = router;
