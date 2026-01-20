const express = require("express");
const router = express.Router();
const userController = require("../controllers/user.controller");

router.get('/getAll/paginated', userController.getAllUsersPaginated);

router.post("/users", userController.createUser);
router.get("/users", userController.getAllUsers);
router.get("/users/:id", userController.getUserById);
router.patch("/users/:id", userController.updateUser);
router.patch("/users/:id/theme", userController.updateTheme);
router.delete("/users/:id", userController.deleteUser);
router.post("/signup", userController.createUser);
router.post("/login", userController.loginUser);
router.post("/logout", userController.logoutUser);
router.get("/getAll/users", userController.getUsers);

// Assuming router is already declared and imported as needed.
router.get("/users/level/:levelId", userController.getUsersByLevelId);

router.get("/users/search/by-term", userController.searchUserByFirstName);

// New routes for user-location management
router.get("/users/location/:locationId", userController.getUsersByLocationId);
router.get("/users/:userId/accessible-locations", userController.getUserAccessibleLocations);

module.exports = router;
