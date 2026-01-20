const express = require('express');
const router = express.Router();
const generatorMachineMeterTagValuesController = require('../controllers/generatorMachineMeterTagValues.controller');

// Route to get all data from the view
router.get('/', generatorMachineMeterTagValuesController.getAllData);
// router.post('/executeSankeyCardConfig', generatorMachineMeterTagValuesController.executeSankeyCardConfig);
// router.post("/executeHeatmapCardConfig", generatorMachineMeterTagValuesController.executeHeatmapCardConfig);
router.post('/withMetersAndTagsByUnit', generatorMachineMeterTagValuesController.withMetersAndTagsByUnit);
router.post('/withMetersAndTagsByTarifftype', generatorMachineMeterTagValuesController.withMetersAndTagsByTarifftype);
router.post('/withMetersAndTagsByUnit/all', generatorMachineMeterTagValuesController.withMetersAndTagsByUnitAll);
router.post('/withMetersAndTagsByUnit/all/nounit', generatorMachineMeterTagValuesController.withMetersAndTagsByUnitAllNoUnit);

module.exports = router;
