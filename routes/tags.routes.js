const express = require('express');
const router = express.Router();
const tagsController = require('../controllers/tags.controller');

// CRUD Endpoints
router.post('/', tagsController.createTag);
router.get('/:id', tagsController.getTagById);
router.put('/:id', tagsController.updateTag);
router.delete('/:id', tagsController.deleteTag);
router.get('/type/:type/id/:id', tagsController.getTagsByTypeAndId);
router.get('/tag/ref', tagsController.getTagByRefAndTaggableId);

// Search by namew
router.get('/search', tagsController.searchTagsByName);

// Get all tags paginated
router.get('/', tagsController.getAllTagsPaginated);

module.exports = router;
