const express = require("express");
const profileController = require("../controllers/profile.controller");
const router = express.Router();

router.post("/", profileController.createProfile);
// router.get("/", profileController.getAllProfiles);
router.get("/:id", profileController.getProfileByUserId);
router.patch("/:id", profileController.updateProfile);
router.delete("/:id", profileController.deleteProfile);

module.exports = router;
