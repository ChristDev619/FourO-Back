const db = require("../dbInit");
const { Program, Tags, TagValues, sequelize, Op } = db;
// const { insertTagValuesWithoutDuplicates, zeroOutTagValues } = require("../utils/tagValueUtils");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const TagRefs = require("../utils/constants/TagRefs");
dayjs.extend(utc);
exports.createProgram = async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const { number, startDate, endDate, lineId } = req.body;

        const existingProgram = await Program.findOne({ where: { number }, transaction });
        if (existingProgram) {
            await transaction.rollback();
            return res.status(400).json({ message: "exists" });
        }

        const newProgram = await Program.create(req.body, { transaction });
        const tag = await Tags.findOne({ where: { ref: TagRefs.CURRENT_PROGRAM, taggableId: lineId }, transaction });
        if (tag) {
            // await insertTagValuesWithoutDuplicates({
            //     tagId: tag.id,
            //     fromDate: startDate,
            //     toDate: endDate,
            //     transaction,
            // });
        }

        await transaction.commit();
        res.status(201).json(newProgram);
    } catch (error) {
        await transaction.rollback();
        console.error("Error creating program:", error);
        res.status(500).json({ message: "An error occurred", error });
    }
};

exports.getAllPrograms = async (req, res) => {
    try {
        const programs = await Program.findAll();
        res.status(200).send(programs);
    } catch (error) {
        res.status(500).send(error);
    }
};

exports.getProgramById = async (req, res) => {
    try {
        const program = await Program.findByPk(req.params.id);
        if (program) {
            res.status(200).send(program);
        } else {
            res.status(404).send({ message: "Program not found." });
        }
    } catch (error) {
        res.status(500).send(error);
    }
};

exports.updateProgram = async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const programId = req.params.id;
        const existing = await Program.findByPk(programId, { transaction });

        if (!existing) {
            await transaction.rollback();
            return res.status(404).json({ message: "Program not found." });
        }

    // Frontend now sends local formatted date (no UTC)
        const newStart = new Date(req.body.startDate);
        const newEnd = new Date(req.body.endDate);
        const oldEnd = new Date(existing.endDate);

        // Check for overlaps
        const overlap = await Program.findAll({
            where: {
                id: { [Op.ne]: existing.id },
                startDate: { [Op.lte]: newEnd },
                endDate: { [Op.gte]: newStart },
            },
            transaction,
        });

        if (overlap.length > 0) {
            await transaction.rollback();
            return res.status(200).json({
                mergeRequired: true,
                conflicts: overlap.map((p) => ({
                    id: p.id,
                    number: p.number,
                    startDate: p.startDate,
                    endDate: p.endDate,
                })),
            });
        }

        await Program.update(req.body, { where: { id: programId }, transaction });

        // Handle reduction
        if (newEnd < oldEnd) {
            const prgmTag = await Tags.findOne({
                where: { ref: TagRefs.CURRENT_PROGRAM, taggableId: existing.lineId },
                transaction,
            });

            if (prgmTag) {
                // await zeroOutTagValues({
                //     tagId: prgmTag.id,
                //     fromDate: newEnd,
                //     toDate: oldEnd,
                //     transaction,
                // });
            }
        }

        // Extend if needed
        await extendProgramIfNeeded(existing, newEnd, transaction);

        await transaction.commit();
        res.status(200).json({ message: "Program updated successfully." });
    } catch (error) {
        await transaction.rollback();
        console.error("Error updating program:", error);
        res.status(500).json({ message: "Failed to update program.", error });
    }
};

exports.deleteProgram = async (req, res) => {
    try {
        const program = await Program.destroy({ where: { id: req.params.id } });
        if (program == 1) {
            res.status(200).send({ message: "Program deleted successfully." });
        } else {
            res.status(404).send({ message: "Program not found." });
        }
    } catch (error) {
        res.status(500).send(error);
    }
};

exports.getProgramByName = async (req, res) => {
    try {
        const program = await Program.findOne({
            where: { programName: req.params.name },
        });
        if (program) {
            res.status(200).send(program);
        } else {
            res.status(404).send({ message: "Program not found." });
        }
    } catch (error) {
        res.status(500).send(error);
    }
};

exports.getAllProgramsPaginated = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const page = parseInt(req.query.page) || 0;
        const { count, rows } = await Program.findAndCountAll({
            limit,
            offset: page * limit,
            order: [["createdAt", "DESC"]],
        });
        res.status(200).send({
            total: count,
            pages: Math.ceil(count / limit),
            data: rows,
        });
    } catch (error) {
        res.status(500).send(error);
    }
};

exports.bulkInsertPrograms = async (req, res) => {
    try {
        const programs = req.body;

        if (!programs || programs.length === 0) {
            return res.status(400).json({ message: "No data to insert." });
        }

        const incomingNumbers = programs.map((program) => program.number);

        const existingPrograms = await Program.findAll({
            where: { number: incomingNumbers },
            attributes: ["number"],
        });

        const existingNumbers = existingPrograms.map((program) => program.number);
        const newPrograms = programs.filter((program) => !existingNumbers.includes(program.number));

        if (newPrograms.length > 0) {
            await Program.bulkCreate(newPrograms);
        }

        return res.status(201).json({
            message: "Programs bulk insert successfully!",
            inserted: newPrograms.map((p) => p.number),
            existing: existingNumbers,
        });
    } catch (error) {
        console.error("Error inserting programs:", error);
        return res.status(500).json({
            message: "Failed to insert programs",
            error: error.message,
        });
    }
};

exports.confirmMergeProgram = async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const programId = req.params.id;
        const program = await Program.findByPk(programId, { transaction });

        if (!program) {
            await transaction.rollback();
            return res.status(404).json({ message: "Program not found." });
        }

        await Program.update(req.body, { where: { id: programId }, transaction });
        await extendProgramIfNeeded(program, req.body.endDate, transaction);

        await transaction.commit();
        res.status(200).json({ message: "Program merge confirmed and updated." });
    } catch (err) {
        await transaction.rollback();
        console.error("Merge confirm error:", err);
        res.status(500).json({ message: "Server error during program merge." });
    }
};

async function extendProgramIfNeeded(program, newEnd, transaction) {
    const oldEnd = new Date(program.endDate);
    const newEndDate = new Date(newEnd);
    if (newEndDate <= oldEnd) return;

    const overlappingPrograms = await Program.findAll({
        where: {
            id: { [Op.ne]: program.id },
            startDate: { [Op.lte]: newEndDate },
            endDate: { [Op.gte]: oldEnd },
        },
        transaction,
    });

    if (overlappingPrograms.length > 0) {
        const mergeStart = new Date(Math.min(program.startDate.getTime(), ...overlappingPrograms.map(p => new Date(p.startDate).getTime())));
        const mergeEnd = new Date(Math.max(newEndDate.getTime(), ...overlappingPrograms.map(p => new Date(p.endDate).getTime())));

        await Program.update({ startDate: mergeStart, endDate: mergeEnd }, { where: { id: program.id }, transaction });

        const overlapIds = overlappingPrograms.map(p => p.id);
        await Program.destroy({ where: { id: { [Op.in]: overlapIds } }, transaction });
         
    } else {
        await Program.update({ endDate: newEndDate }, { where: { id: program.id }, transaction });
        const tag = await Tags.findOne({ where: { ref: TagRefs.CURRENT_PROGRAM, taggableId: program.lineId }, transaction });
        if (tag) {
            // await insertTagValuesWithoutDuplicates({
            //     tagId: tag.id,
            //     fromDate: oldEnd.getTime() + ONE_MINUTE,
            //     toDate: newEndDate,
            //     transaction,
            // });
        }

    }
}