const db = require("../dbInit");
const { Profile } = db;

exports.createProfile = async (req, res) => {
  try {
    const profile = await Profile.create(req.body);
    res.status(201).send(profile);
  } catch (error) {
    res.status(400).send(error);
  }
};

exports.getAllProfiles = async (req, res) => {
  try {
    const profiles = await Profile.findAll();
    res.status(200).send(profiles);
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getProfileByUserId = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await db.User.findOne({
      where: { id: id },
      attributes: ["id", "firstName", "lastName", "username", "email", "phoneNumber"], // Exclude password
      // include: [
      //   {
      //     model: Profile,
      //     as: 'profile',
      //     attributes: ['bio', 'phone', 'address'] // Example attributes
      //   },
      //   {
      //     model: Level,
      //     as: 'level',
      //     attributes: ['name'] // Assuming Level model has a name attribute
      //   }
      // ]
    });

    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    res.status(200).send(user);
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const updated = await Profile.update(req.body, {
      where: { userId: req.params.id },
    });
    if (updated[0] === 1) {
      res.status(200).send({ message: "Profile updated successfully." });
    } else {
      res.status(404).send({ message: "Profile not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.deleteProfile = async (req, res) => {
  try {
    const deleted = await Profile.destroy({
      where: { userId: req.params.id },
    });
    if (deleted === 1) {
      res.status(200).send({ message: "Profile deleted successfully." });
    } else {
      res.status(404).send({ message: "Profile not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};
