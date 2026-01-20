const express = require('express');
const router = express.Router();
const TariffTypeController = require('../controllers/TariffTypeController');

router.get('/', TariffTypeController.getAllTariffTypes);
router.post('/', TariffTypeController.createTariffType);
router.put('/:id', TariffTypeController.updateTariffType);
router.delete('/:id', TariffTypeController.deleteTariffType);

module.exports = router;
