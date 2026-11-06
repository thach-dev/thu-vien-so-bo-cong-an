
const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");

const controller = require(
    "../controllers/googleScriptController"
);

// ============================================
// 1. GOOGLE OAUTH CALLBACK
// Không yêu cầu JWT vì Google redirect về đây.
// ============================================

router.get("/callback", controller.googleCallback);

// ============================================
// 2. BẢO VỆ CÁC API CÒN LẠI
// ============================================

router.use(authMiddleware);

// ============================================
// 3. GOOGLE CONNECTION
// ============================================

router.get("/connect", controller.connectGoogle);
router.get("/status", controller.getGoogleStatus);
router.delete("/disconnect", controller.disconnectGoogle);

// ============================================
// 4. GOOGLE APPS SCRIPT PROJECT
// ============================================

// Tạo project mới
router.post("/projects", controller.createProject);

// Lấy danh sách project
router.get("/projects", controller.getProjects);

// Lấy nội dung code
router.get(
    "/projects/:id/content",
    controller.getProjectContent
);

// Lưu code và cập nhật deployment
router.put(
    "/projects/:id",
    controller.saveProject
);

// ============================================
// 5. GOOGLE CLOUD PROJECT
// ============================================

// Xác nhận người dùng đã liên kết Cloud Project
router.post(
    "/projects/:id/confirm-cloud-project",
    controller.confirmCloudProjectLink
);

// ============================================
// 6. THỰC THI GOOGLE APPS SCRIPT
// ============================================

router.post(
    "/projects/:id/run",
    controller.runProject
);

module.exports = router;
