const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");

const controller = require(
    "../controllers/googleScriptController"
);

router.get("/callback", controller.googleCallback);

router.use(authMiddleware);

router.get("/connect", controller.connectGoogle);
router.get("/status", controller.getGoogleStatus);

router.get("/projects/:id/content", controller.getProjectContent);
router.post("/projects", controller.createProject);
router.get("/projects", controller.getProjects);
router.put("/projects/:id", controller.saveProject);

// API thực thi function
router.post("/projects/:id/run", controller.runProject);

router.delete("/disconnect", controller.disconnectGoogle);

module.exports = router;