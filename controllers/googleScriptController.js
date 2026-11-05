
const crypto = require("crypto");
const { google } = require("googleapis");

const supabase = require("../config/supabase");

const {
    encrypt,
    decrypt,
} = require("../utils/tokenEncryption");

const {
    generateAuthUrl,
    exchangeCode,
    getGoogleUser,
    createGoogleProject,
    saveGoogleProject,
    getGoogleProjectContent,
    createGoogleVersion,
    createGoogleDeployment,
    updateGoogleDeployment,
    runGoogleScript,
} = require("../services/googleScriptService");

// ============================================
// CẤU HÌNH FRONTEND ĐƯỢC PHÉP OAUTH
// ============================================

const ALLOWED_FRONTEND_ORIGINS = [
    "http://localhost:5173",
    "https://thu-vien-so-bca.netlify.app",
];

// Frontend production mặc định
const DEFAULT_FRONTEND_URL =
    process.env.FRONTEND_URL ||
    "https://thu-vien-so-bca.netlify.app";

// Kiểm tra và lấy frontend origin hợp lệ
function getAllowedFrontendOrigin(value) {
    if (!value) return null;

    try {
        const url = new URL(value);
        const origin = url.origin;

        if (ALLOWED_FRONTEND_ORIGINS.includes(origin)) {
            return origin;
        }

        return null;
    } catch {
        return null;
    }
}

// Lấy frontend từ request khi bắt đầu OAuth
function getFrontendOrigin(req) {
    const origin =
        req.get("origin") ||
        req.get("referer");

    if (!origin) {
        return getAllowedFrontendOrigin(DEFAULT_FRONTEND_URL);
    }

    return getAllowedFrontendOrigin(origin);
}

// Tạo URL chuyển hướng về frontend
function redirectToFrontend(res, frontendOrigin, status) {
    const origin =
        getAllowedFrontendOrigin(frontendOrigin) ||
        getAllowedFrontendOrigin(DEFAULT_FRONTEND_URL);

    const redirectUrl = new URL(
        "/script-ide",
        origin
    );

    redirectUrl.searchParams.set("google", status);

    return res.redirect(redirectUrl.toString());
}

// ============================================
// LẤY OAUTH URL
// ============================================

exports.connectGoogle = async (req, res) => {
    try {
        const userId = req.user.id;

        // Xác định frontend đang sử dụng
        const frontendOrigin = getFrontendOrigin(req);

        if (!frontendOrigin) {
            return res.status(403).json({
                success: false,
                message: "Frontend không được phép kết nối Google",
            });
        }

        // Tạo state ngẫu nhiên
        const state = crypto
            .randomBytes(32)
            .toString("hex");

        const expiresAt = new Date(
            Date.now() + 10 * 60 * 1000
        ).toISOString();

        // Lưu state và frontend origin vào Supabase
        const { error } = await supabase
            .from("google_oauth_states")
            .insert({
                state,
                user_id: userId,
                frontend_origin: frontendOrigin,
                expires_at: expiresAt,
            });

        if (error) throw error;

        const url = generateAuthUrl(state);

        return res.json({
            success: true,
            url,
        });

    } catch (error) {
        console.error("Connect Google:", error);

        return res.status(500).json({
            success: false,
            message: "Không thể tạo liên kết Google OAuth",
        });
    }
};

// ============================================
// GOOGLE CALLBACK
// ============================================

exports.googleCallback = async (req, res) => {
    let frontendOrigin = DEFAULT_FRONTEND_URL;

    try {
        const { code, state, error } = req.query;

        // Nếu không có state, không thể xác định frontend
        if (!state || typeof state !== "string") {
            return res.status(400).send(
                "Thiếu hoặc không hợp lệ OAuth state"
            );
        }

        // Lấy OAuth state từ Supabase
        const {
            data: stateData,
            error: stateError,
        } = await supabase
            .from("google_oauth_states")
            .select("*")
            .eq("state", state)
            .single();

        if (stateError || !stateData) {
            return res.status(400).send(
                "OAuth state không hợp lệ hoặc đã được sử dụng"
            );
        }

        // Lấy frontend origin đã lưu lúc bắt đầu OAuth
        frontendOrigin =
            getAllowedFrontendOrigin(
                stateData.frontend_origin
            ) || DEFAULT_FRONTEND_URL;

        // Xóa state ngay khi sử dụng để chống replay
        const { error: deleteError } = await supabase
            .from("google_oauth_states")
            .delete()
            .eq("state", state);

        if (deleteError) throw deleteError;

        // Kiểm tra thời hạn
        if (
            new Date(stateData.expires_at).getTime() <
            Date.now()
        ) {
            return redirectToFrontend(
                res,
                frontendOrigin,
                "expired"
            );
        }

        // Người dùng từ chối cấp quyền
        if (error) {
            console.error("Google OAuth denied:", error);

            return redirectToFrontend(
                res,
                frontendOrigin,
                "denied"
            );
        }

        if (!code) {
            return redirectToFrontend(
                res,
                frontendOrigin,
                "failed"
            );
        }

        // Đổi authorization code lấy token
        const {
            oauth2Client,
            tokens,
        } = await exchangeCode(code);

        // Lấy thông tin tài khoản Google
        const googleUser = await getGoogleUser(
            oauth2Client
        );

        // Kiểm tra kết nối Google hiện tại
        const { data: existing } = await supabase
            .from("google_connections")
            .select("refresh_token")
            .eq("user_id", stateData.user_id)
            .maybeSingle();

        // Giữ refresh token cũ nếu Google không trả token mới
        const refreshToken = tokens.refresh_token
            ? encrypt(tokens.refresh_token)
            : existing?.refresh_token;

        if (!refreshToken) {
            return redirectToFrontend(
                res,
                frontendOrigin,
                "token_missing"
            );
        }

        // Lưu kết nối Google
        const { error: saveError } = await supabase
            .from("google_connections")
            .upsert(
                {
                    user_id: stateData.user_id,
                    google_user_id: googleUser.id,
                    google_email: googleUser.email,
                    refresh_token: refreshToken,
                    updated_at: new Date().toISOString(),
                },
                {
                    onConflict: "user_id",
                }
            );

        if (saveError) throw saveError;

        // Chuyển về đúng frontend đã bắt đầu OAuth
        return redirectToFrontend(
            res,
            frontendOrigin,
            "connected"
        );

    } catch (error) {
        console.error("Google callback:", error);

        return redirectToFrontend(
            res,
            frontendOrigin,
            "failed"
        );
    }
};

// ============================================
// LẤY GOOGLE CLIENT CỦA NGƯỜI DÙNG
// ============================================

async function getUserGoogleClient(userId) {
    const { data, error } = await supabase
        .from("google_connections")
        .select("*")
        .eq("user_id", userId)
        .single();

    if (error || !data) {
        throw new Error(
            "Bạn chưa kết nối tài khoản Google"
        );
    }

    const refreshToken = decrypt(
        data.refresh_token
    );

    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
        refresh_token: refreshToken,
    });

    return {
        oauth2Client,
        connection: data,
    };
}

// ============================================
// KIỂM TRA GOOGLE ĐÃ KẾT NỐI CHƯA
// ============================================

exports.getGoogleStatus = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("google_connections")
            .select("google_email")
            .eq("user_id", req.user.id)
            .maybeSingle();

        if (error) throw error;

        return res.json({
            success: true,
            connected: !!data,
            email: data?.google_email || null,
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Không thể kiểm tra trạng thái Google",
        });
    }
};

// ============================================
// TẠO GOOGLE APPS SCRIPT PROJECT
// ============================================

exports.createProject = async (req, res) => {
    try {
        const userId = req.user.id;

        const title = String(
            req.body.title || "Untitled Project"
        ).trim();

        if (!title || title.length > 100) {
            return res.status(400).json({
                success: false,
                message: "Tên project không hợp lệ",
            });
        }

        const { oauth2Client } =
            await getUserGoogleClient(userId);

        // 1. Tạo Google Apps Script Project
        const project = await createGoogleProject(
            oauth2Client,
            title
        );

        if (!project.scriptId) {
            throw new Error("Google không trả về scriptId");
        }

        // 2. Ghi code mặc định
        const initialCode = `
function myFunction() {
    const message = "Hello Google Apps Script!";
    Logger.log(message);
    return message;
}

function createSheet() {
    const spreadsheet = SpreadsheetApp.create("My Spreadsheet");
    Logger.log(spreadsheet.getUrl());
    return spreadsheet.getUrl();
}
`;

        await saveGoogleProject(
            oauth2Client,
            project.scriptId,
            initialCode
        );

        // 3. Tạo version
        const version = await createGoogleVersion(
            oauth2Client,
            project.scriptId,
            "Initial version"
        );

        // 4. Tạo deployment
        const deployment = await createGoogleDeployment(
            oauth2Client,
            project.scriptId,
            version.versionNumber
        );

        if (!deployment.deploymentId) {
            throw new Error(
                "Google không trả về deploymentId"
            );
        }

        // 5. Lưu vào Supabase
        const { data, error } = await supabase
            .from("script_projects")
            .insert({
                user_id: userId,
                google_script_id: project.scriptId,
                title,
                deployment_id: deployment.deploymentId,
                version_number: version.versionNumber,
            })
            .select()
            .single();

        if (error) throw error;

        return res.status(201).json({
            success: true,
            project: data,
            deployment: {
                deploymentId: deployment.deploymentId,
                versionNumber: version.versionNumber,
            },
        });

    } catch (error) {
        console.error("Create project:", error);

        return res.status(500).json({
            success: false,
            message: error.message || "Không thể tạo project",
        });
    }
};

// ============================================
// LƯU CODE LÊN GOOGLE
// ============================================

exports.saveProject = async (req, res) => {
    try {
        const userId = req.user.id;
        const projectId = req.params.id;
        const code = req.body.code;

        if (typeof code !== "string") {
            return res.status(400).json({
                success: false,
                message: "Code không hợp lệ",
            });
        }

        const { data: project, error } = await supabase
            .from("script_projects")
            .select("*")
            .eq("id", projectId)
            .eq("user_id", userId)
            .single();

        if (error || !project) {
            return res.status(404).json({
                success: false,
                message: "Không tìm thấy project",
            });
        }

        const { oauth2Client } =
            await getUserGoogleClient(userId);

        // 1. Cập nhật source code
        await saveGoogleProject(
            oauth2Client,
            project.google_script_id,
            code
        );

        // 2. Tạo version mới
        const version = await createGoogleVersion(
            oauth2Client,
            project.google_script_id,
            `Saved at ${new Date().toISOString()}`
        );

        let deployment;

        // 3. Cập nhật deployment cũ hoặc tạo deployment mới
        if (project.deployment_id) {
            deployment = await updateGoogleDeployment(
                oauth2Client,
                project.google_script_id,
                project.deployment_id,
                version.versionNumber
            );
        } else {
            deployment = await createGoogleDeployment(
                oauth2Client,
                project.google_script_id,
                version.versionNumber
            );
        }

        const deploymentId =
            deployment.deploymentId || project.deployment_id;

        // 4. Cập nhật Supabase
        const { error: updateError } = await supabase
            .from("script_projects")
            .update({
                deployment_id: deploymentId,
                version_number: version.versionNumber,
                updated_at: new Date().toISOString(),
            })
            .eq("id", projectId)
            .eq("user_id", userId);

        if (updateError) throw updateError;

        return res.json({
            success: true,
            message: "Đã lưu code và cập nhật deployment",
            deploymentId,
            versionNumber: version.versionNumber,
        });

    } catch (error) {
        console.error("Save project:", error);

        return res.status(500).json({
            success: false,
            message: error.message || "Không thể lưu project",
        });
    }
};

// ============================================
// DANH SÁCH PROJECT CỦA NGƯỜI DÙNG
// ============================================

exports.getProjects = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("script_projects")
            .select("*")
            .eq("user_id", req.user.id)
            .order("created_at", {
                ascending: false,
            });

        if (error) throw error;

        return res.json({
            success: true,
            projects: data || [],
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Không thể lấy danh sách project",
        });
    }
};

// ============================================
// NGẮT KẾT NỐI GOOGLE
// ============================================

exports.disconnectGoogle = async (req, res) => {
    try {
        const { error } = await supabase
            .from("google_connections")
            .delete()
            .eq("user_id", req.user.id);

        if (error) throw error;

        return res.json({
            success: true,
            message: "Đã ngắt kết nối Google",
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Không thể ngắt kết nối Google",
        });
    }
};

// ============================================
// LẤY NỘI DUNG PROJECT GOOGLE
// ============================================

exports.getProjectContent = async (req, res) => {
    try {
        const userId = req.user.id;
        const projectId = req.params.id;

        const { data: project, error } = await supabase
            .from("script_projects")
            .select("*")
            .eq("id", projectId)
            .eq("user_id", userId)
            .single();

        if (error || !project) {
            return res.status(404).json({
                success: false,
                message: "Không tìm thấy project",
            });
        }

        const { oauth2Client } =
            await getUserGoogleClient(userId);

        const files = await getGoogleProjectContent(
            oauth2Client,
            project.google_script_id
        );

        return res.json({
            success: true,
            files,
        });

    } catch (error) {
        console.error("Get project content:", error);

        return res.status(500).json({
            success: false,
            message: error.message || "Không thể lấy nội dung project",
        });
    }
};

// ============================================
// CHẠY GOOGLE APPS SCRIPT
// ============================================

exports.runProject = async (req, res) => {
    try {
        const userId = req.user.id;
        const projectId = req.params.id;

        const functionName = String(
            req.body.functionName || ""
        ).trim();

        const parameters = req.body.parameters || [];

        if (!functionName) {
            return res.status(400).json({
                success: false,
                message: "Bạn chưa chọn function.",
            });
        }

        if (!Array.isArray(parameters)) {
            return res.status(400).json({
                success: false,
                message: "Parameters phải là một mảng.",
            });
        }

        const { data: project, error } = await supabase
            .from("script_projects")
            .select("*")
            .eq("id", projectId)
            .eq("user_id", userId)
            .single();

        if (error || !project) {
            return res.status(404).json({
                success: false,
                message: "Không tìm thấy project.",
            });
        }

        if (!project.deployment_id) {
            return res.status(400).json({
                success: false,
                message: "Project chưa được triển khai API Executable. Hãy lưu project để thử tạo deployment.",
            });
        }

        const { oauth2Client } =
            await getUserGoogleClient(userId);

        const result = await runGoogleScript(
            oauth2Client,
            project.deployment_id,
            functionName,
            parameters
        );

        return res.json({
            success: true,
            message: "Thực thi thành công.",
            functionName,
            result,
        });

    } catch (error) {
        console.error("Run Google Script:", error);

        const googleMessage =
            error.response?.data?.error?.message ||
            error.message;

        return res.status(500).json({
            success: false,
            message: googleMessage || "Không thể thực thi script.",
        });
    }
};
