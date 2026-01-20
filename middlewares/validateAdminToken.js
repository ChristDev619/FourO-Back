// middlewares/validateAdminToken.js
const jwt = require("jsonwebtoken");

const validateAdminToken = (req, res, next) => {
  const token = req.headers["authorization"];

  if (!token) {
    return res.status(403).send({ message: "No token provided!" });
  }

  jwt.verify(token, process.env.SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "Unauthorized!" });
    }

    // Check if the role is admin
    if (decoded.role !== "admin") {
      return res.status(401).send({ message: "Require Admin Role!" });
    }

    next();
  });
};

module.exports = validateAdminToken;
