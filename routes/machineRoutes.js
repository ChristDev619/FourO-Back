const express = require('express');
const router = express.Router();
const machineController = require('../controllers/machine.controller');

// Create a new machine
router.post('/', machineController.createMachine);

// Retrieve all machines
router.get('/', machineController.getAllMachines);

// Retrieve a single machine with id
router.get('/:id', machineController.getMachineById);

// Retrieve all machines by lineId
router.get('/:id', machineController.getMachineById);

// Update a machine with id
router.patch('/:id', machineController.updateMachine);

// Delete a machine with id
router.delete('/:id', machineController.deleteMachine);

// Retrieve all machines paginated
router.get('/getAll/paginated', machineController.getAllMachinesPaginated);

// Retrieve machines by location ID
router.get('/by-location/:locationId', machineController.getMachinesByLocationId);


module.exports = router;
