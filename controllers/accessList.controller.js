const db = require('../dbInit');
const { AccessList } = db;

exports.createAccessList = async (req, res) => {
  try {
    const accessList = await AccessList.create(req.body);
    res.status(201).send(accessList);
  } catch (error) {
    res.status(400).send(error);
  }
};

exports.getAllAccessLists = async (req, res) => {
  try {
    const accessLists = await AccessList.findAll();
    res.status(200).send(accessLists);
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getAccessListById = async (req, res) => {
  try {
    const accessList = await AccessList.findByPk(req.params.id);
    if (accessList) {
      res.status(200).send(accessList);
    } else {
      res.status(404).send({ message: 'AccessList not found.' });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.updateAccessList = async (req, res) => {
  try {
    const updated = await AccessList.update(req.body, {
      where: { id: req.params.id }
    });
    if (updated[0] === 1) {
      res.status(200).send({ message: 'AccessList updated successfully.' });
    } else {
      res.status(404).send({ message: 'AccessList not found.' });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.deleteAccessList = async (req, res) => {
  try {
    const deleted = await AccessList.destroy({
      where: { id: req.params.id }
    });
    if (deleted === 1) {
      res.status(200).send({ message: 'AccessList deleted successfully.' });
    } else {
      res.status(404).send({ message: 'AccessList not found.' });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};
