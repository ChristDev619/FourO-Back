const express = require('express');
const router = express.Router();
const generatorController = require('../controllers/generator.controller');

router.post('/', generatorController.createGenerator);
router.get('/', generatorController.getAllGenerators);
router.get('/:id', generatorController.getGeneratorById);
router.patch('/:id', generatorController.updateGenerator);
router.delete('/:id', generatorController.deleteGenerator);

// Add this to your generator routes file
router.get('/getAll/paginated', generatorController.getGeneratorsWithPagination);
router.get('/by-location/:locationId', generatorController.getGeneratorsByLocationId);

router.get("/by-fuel-type/:tariffType", generatorController.getGeneratorsByTariffType);

module.exports = router;
