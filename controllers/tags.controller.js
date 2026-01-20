const db = require("../dbInit");
const { Tags, Meters, Machine, Generator, Line, Unit , Op} = db;

exports.createTag = async (req, res) => {
  try {
  const tagData = req.body;
    const tagNames = tagData.map((tag) => tag.name); // Extract tag names from request

    // Check if any of these tag names already exist
    const existingTags = await Tags.findAll({
      where: { name: tagNames },
    });

    if (existingTags.length > 0) {
      return res.status(400).send({ message: "exists" }); // Prevent insertion if any tag exists
    }

    // If no duplicates, insert new tags
    const tags = await Tags.bulkCreate(tagData, { validate: true });
    res.status(201).send(tags);
  } catch (error) {
    console.error("Error creating tags:", error);
    res.status(500).send({ message: "An error occurred while creating tags." });
  }
};

exports.getTagById = async (req, res) => {
  try {
    const tag = await Tags.findByPk(req.params.id, {
      include: [{ model: Unit, as: "unit" }],
    });
    if (!tag) {
      return res.status(404).send({ message: "Tag not found" });
    }
    res.send(tag);
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.updateTag = async (req, res) => {
  try {
    const { id } = req.params; // Get tag ID from request params
    const { name } = req.body; // Get new tag name from request body

    // Check if the tag exists
    const tag = await Tags.findByPk(id);
    if (!tag) {
      return res.status(404).send({ message: "Tag not found" });
    }

    // Check if another tag with the same name already exists (excluding current tag)
    const existingTag = await Tags.findOne({ where: { name, id: { [Op.ne]: id } } });
    if (existingTag) {
      return res.status(400).send({ message: "exists" });
    }

    // Update the tag
    await tag.update(req.body);
    res.status(200).send({ message: "Tag updated successfully" });

  } catch (error) {
    console.error("Error updating tag:", error);
    res.status(500).send({ message: "An error occurred while updating the tag." });
  }
};

exports.deleteTag = async (req, res) => {
  try {
    const result = await Tags.destroy({
      where: { id: req.params.id },
    });
    if (result == 0) {
      return res.status(404).send({ message: "Tag not found" });
    }
    res.send({ message: "Tag deleted successfully" });
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getTagsByTypeAndId = async (req, res) => {
  const { type, id } = req.params;

  try {
    const tags = await Tags.findAll({
      where: {
        taggableType: type,
        taggableId: id,
      },
      include: [{ model: Unit, as: "unit" }],
    });

    if (!tags.length) {
      return res.status(404).send({ message: "No tags found" });
    }

    res.send({ data: tags });
  } catch (error) {
    console.log(error);
    res.status(500).send(error);
  }
};

exports.getTagByRefAndTaggableId = async (req, res) => {
  const { id, ref } = req.query;

  try {
    const tag = await Tags.findOne({
      where: {
        ref: ref,
        taggableId: id,
      },
    });

    if (!tag) {
      return res.status(404).send({ message: "No tag found" });
    }

    res.send({ tag });
  } catch (error) {
    console.log(error);
    res.status(500).send(error);
  }
};

exports.searchTagsByName = async (req, res) => {
  try {
    const tags = await Tags.findAll({
      where: {
        name: {
          [Op.like]: `%${req.query.name}%`,
        },
      },
      include: [{ model: Unit, as: "unit" }],
    });
    res.send({ data: tags });
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getAllTagsPaginated = async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const page = parseInt(req.query.page) || 0;
  const offset = page * limit;

  try {
    const tags = await Tags.findAndCountAll({
      limit: limit,
      offset: offset,
      include: [{ model: Unit, as: "unit" }],
    });

    const fetchTaggableData = async (tag) => {
      let taggableData = null;
      if (tag.taggableType === "meter") {
        taggableData = await Meters.findByPk(tag.taggableId);
      } else if (tag.taggableType === "machine") {
        taggableData = await Machine.findByPk(tag.taggableId);
      } else if (tag.taggableType === "line") {
        taggableData = await Line.findByPk(tag.taggableId);
      }
      return taggableData;
    };

    const result = await Promise.all(
      tags.rows.map(async (tag) => {
        const taggableData = await fetchTaggableData(tag);
        return {
          ...tag.toJSON(),
          taggableData,
        };
      })
    );

    res.send({
      total: tags.count,
      pages: Math.ceil(tags.count / limit),
      data: result,
    });
  } catch (error) {
    res.status(500).send(error);
  }
};
