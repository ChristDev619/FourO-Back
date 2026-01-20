const express = require('express');
const router = express.Router();
const locationController = require('../controllers/location.controller');

router.post('/', locationController.createLocation);
router.get('/', locationController.getAllLocations);
router.get('/paginated', locationController.getLocationsWithPagination);
router.get('/getTree/tree', locationController.getLocationsAsTree);
router.get('/:id', locationController.getLocationById);
router.get('/children/:parentLocationId', locationController.getChildrenByParentId);
router.patch('/:id', locationController.updateLocation);
router.delete('/:id', locationController.deleteLocation);
router.get('/getAll/roots', locationController.getRootLocations);


module.exports = router;
