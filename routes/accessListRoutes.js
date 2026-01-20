const express = require('express');
const router = express.Router();
const accessListController = require('../controllers/accessList.controller');

router.post('/', accessListController.createAccessList);
router.get('/', accessListController.getAllAccessLists);
router.get('/:id', accessListController.getAccessListById);
router.patch('/:id', accessListController.updateAccessList);
router.delete('/:id', accessListController.deleteAccessList);

module.exports = router;
