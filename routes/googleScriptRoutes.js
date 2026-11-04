const express = require("express");

const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");

const controller = require(
    "../controllers/googleScriptController"
);

// OAuth callback không dùng JWT vì Google gọi trực tiếp
router.get("/callback", controller.googleCallback);

// Các API còn lại bắt buộc đăng nhập
router.use(authMiddleware);

router.get("/connect", controller.connectGoogle);

router.get("/status", controller.getGoogleStatus);

router.post("/projects", controller.createProject);

router.get("/projects", controller.getProjects);

router.put("/projects/:id", controller.saveProject);

router.delete("/disconnect", controller.disconnectGoogle);

module.exports = router;