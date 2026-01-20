const express = require('express');
const router = express.Router();
const levelController = require('../controllers/level.controller');
router.get('/getAll/paginated', levelController.getAllLevelsPaginated);
router.post('/', levelController.createLevel);
router.get('/', levelController.getAllLevels);
router.get('/:id', levelController.getLevelById);
router.patch('/:id', levelController.updateLevel);
router.delete('/:id', levelController.deleteLevel);

module.exports = router;
