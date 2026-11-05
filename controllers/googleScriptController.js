
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
// CẤU HÌNH FRONTEND OAUTH
// ============================================

const ALLOWED_FRONTEND_ORIGINS = [
    "http://localhost:5173",
    "https://thu-vien-so-bca.netlify.app",
];

const DEFAULT_FRONTEND_URL =
    process.env.FRONTEND_URL ||
    "https://thu-vien-so-bca.netlify.app";

function getAllowedFrontendOrigin(value) {
    if (!value) return null;

    try {
        const url = new URL(value);
        const origin = url.origin;

        return ALLOWED_FRONTEND_ORIGINS.includes(origin)
            ? origin
            : null;
    } catch {
        return null;
    }
}

function getFrontendOrigin(req) {
    const origin =
        req.get("origin") ||
        req.get("referer");

    if (!origin) {
        return getAllowedFrontendOrigin(DEFAULT_FRONTEND_URL);
    }

    return getAllowedFrontendOrigin(origin);
}

function redirectToFrontend(res, frontendOrigin, status) {
    const origin =
        getAllowedFrontendOrigin(frontendOrigin) ||
        getAllowedFrontendOrigin(DEFAULT_FRONTEND_URL);

    const redirectUrl = new URL("/script-ide", origin);

    redirectUrl.searchParams.set("google", status);

    return res.redirect(redirectUrl.toString());
}

// ============================================
// HÀM GHI LOG LỖI GOOGLE API
// ============================================

function logGoogleError(label, error, stage = "") {
    console.error("\n========== GOOGLE API ERROR ==========");
    console.error("Chức năng:", label);
    console.error("Giai đoạn:", stage || "Không xác định");
    console.error("Message:", error?.message);
    console.error("HTTP Status:", error?.response?.status);
    console.error(
        "Google Response:",
        JSON.stringify(error?.response?.data || {}, null, 2)
    );
    console.error("Error Code:", error?.code);
    console.error("======================================\n");
}

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
            "Bạn chưa kết nối tài khoản Google."
        );
    }

    if (!data.refresh_token) {
        throw new Error(
            "Không tìm thấy Google refresh token. Hãy kết nối lại Google."
        );
    }

    const refreshToken = decrypt(data.refresh_token);

    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
        refresh_token: refreshToken,
    });

    // Lấy access token mới
    const { token } = await oauth2Client.getAccessToken();

    if (!token) {
        throw new Error(
            "Không thể lấy Google access token. Hãy kết nối lại Google."
        );
    }

    // Kiểm tra quyền OAuth thực tế
    const tokenInfo = await oauth2Client.getTokenInfo(token);

    const grantedScopes = tokenInfo.scopes || [];

    console.log("\n========== GOOGLE OAUTH CHECK ==========");
    console.log("Google account:", data.google_email);
    console.log("Google user ID:", data.google_user_id);
    console.log("Granted scopes:");

    grantedScopes.forEach((scope, index) => {
        console.log(`${index + 1}. ${scope}`);
    });

    console.log("========================================\n");

    return {
        oauth2Client,
        connection: data,
        scopes: grantedScopes,
    };
}

// ============================================
// KẾT NỐI GOOGLE
// ============================================

exports.connectGoogle = async (req, res) => {
    try {
        const userId = req.user.id;

        const frontendOrigin = getFrontendOrigin(req);

        if (!frontendOrigin) {
            return res.status(403).json({
                success: false,
                message: "Frontend không được phép kết nối Google.",
            });
        }

        const state = crypto
            .randomBytes(32)
            .toString("hex");

        const expiresAt = new Date(
            Date.now() + 10 * 60 * 1000
        ).toISOString();

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
            message:
                error.message ||
                "Không thể tạo liên kết Google OAuth.",
        });
    }
};

// ============================================
// GOOGLE CALLBACK
// ============================================

exports.googleCallback = async (req, res) => {
    let frontendOrigin = DEFAULT_FRONTEND_URL;

    try {
        const {
            code,
            state,
            error,
        } = req.query;

        if (!state || typeof state !== "string") {
            return res.status(400).send(
                "Thiếu hoặc không hợp lệ OAuth state."
            );
        }

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
                "OAuth state không hợp lệ hoặc đã được sử dụng."
            );
        }

        frontendOrigin =
            getAllowedFrontendOrigin(
                stateData.frontend_origin
            ) || DEFAULT_FRONTEND_URL;

        // Xóa state sau khi sử dụng
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

        // Kiểm tra scope ngay sau khi OAuth
        if (tokens.access_token) {
            const tokenInfo = await oauth2Client.getTokenInfo(
                tokens.access_token
            );

            console.log("\n========== NEW OAUTH SCOPES ==========");
            console.log("Google account:", tokenInfo.email);
            console.log("Granted scopes:", tokenInfo.scopes || []);
            console.log("======================================\n");
        }

        // Lấy thông tin tài khoản Google
        const googleUser = await getGoogleUser(
            oauth2Client
        );

        // Kiểm tra kết nối Google hiện tại
        const { data: existing, error: existingError } =
            await supabase
                .from("google_connections")
                .select("refresh_token")
                .eq("user_id", stateData.user_id)
                .maybeSingle();

        if (existingError) throw existingError;

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

        return redirectToFrontend(
            res,
            frontendOrigin,
            "connected"
        );

    } catch (error) {
        logGoogleError("Google Callback", error);

        return redirectToFrontend(
            res,
            frontendOrigin,
            "failed"
        );
    }
};

// ============================================
// KIỂM TRA TRẠNG THÁI GOOGLE
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
        console.error("Get Google status:", error);

        return res.status(500).json({
            success: false,
            message: "Không thể kiểm tra trạng thái Google.",
        });
    }
};

// ============================================
// TẠO GOOGLE APPS SCRIPT PROJECT
// ============================================

exports.createProject = async (req, res) => {
    let stage = "Bắt đầu tạo project";

    try {
        const userId = req.user.id;

        const title = String(
            req.body.title || "Untitled Project"
        ).trim();

        if (!title || title.length > 100) {
            return res.status(400).json({
                success: false,
                message: "Tên project không hợp lệ.",
            });
        }

        stage = "Lấy Google OAuth client";

        const { oauth2Client } =
            await getUserGoogleClient(userId);

        // 1. Tạo Apps Script project
        stage = "Tạo Google Apps Script project";

        const project = await createGoogleProject(
            oauth2Client,
            title
        );

        if (!project.scriptId) {
            throw new Error(
                "Google không trả về scriptId."
            );
        }

        // 2. Code mặc định
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

        // 3. Lưu code
        stage = "Lưu source code ban đầu";

        await saveGoogleProject(
            oauth2Client,
            project.scriptId,
            initialCode
        );

        // 4. Tạo version
        stage = "Tạo version đầu tiên";

        const version = await createGoogleVersion(
            oauth2Client,
            project.scriptId,
            "Initial version"
        );

        // 5. Tạo deployment
        stage = "Tạo API Executable deployment";

        const deployment = await createGoogleDeployment(
            oauth2Client,
            project.scriptId,
            version.versionNumber
        );

        if (!deployment.deploymentId) {
            throw new Error(
                "Google không trả về deploymentId."
            );
        }

        // 6. Lưu Supabase
        stage = "Lưu project vào Supabase";

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
        logGoogleError("Create project", error, stage);

        return res.status(500).json({
            success: false,
            stage,
            message:
                error.message ||
                "Không thể tạo project.",
            googleError: error.response?.data?.error || null,
        });
    }
};

// ============================================
// LƯU CODE VÀ CẬP NHẬT DEPLOYMENT
// ============================================

exports.saveProject = async (req, res) => {
    let stage = "Bắt đầu lưu project";

    try {
        const userId = req.user.id;
        const projectId = req.params.id;
        const code = req.body.code;

        if (typeof code !== "string") {
            return res.status(400).json({
                success: false,
                message: "Code không hợp lệ.",
            });
        }

        // Lấy project
        stage = "Lấy project từ Supabase";

        const {
            data: project,
            error,
        } = await supabase
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

        // Lấy Google client
        stage = "Lấy Google OAuth client";

        const { oauth2Client } =
            await getUserGoogleClient(userId);

        // BƯỚC 1: Cập nhật source code
        stage = "1. Google projects.updateContent - Lưu source code";

        await saveGoogleProject(
            oauth2Client,
            project.google_script_id,
            code
        );

        // BƯỚC 2: Tạo version
        stage = "2. Google projects.versions.create - Tạo version";

        const version = await createGoogleVersion(
            oauth2Client,
            project.google_script_id,
            `Saved at ${new Date().toISOString()}`
        );

        let deployment;

        // BƯỚC 3: Cập nhật hoặc tạo deployment
        if (project.deployment_id) {
            stage = "3. Google projects.deployments.update - Cập nhật deployment";

            deployment = await updateGoogleDeployment(
                oauth2Client,
                project.google_script_id,
                project.deployment_id,
                version.versionNumber
            );
        } else {
            stage = "3. Google projects.deployments.create - Tạo deployment";

            deployment = await createGoogleDeployment(
                oauth2Client,
                project.google_script_id,
                version.versionNumber
            );
        }

        const deploymentId =
            deployment.deploymentId ||
            project.deployment_id;

        if (!deploymentId) {
            throw new Error(
                "Không lấy được deploymentId sau khi lưu."
            );
        }

        // BƯỚC 4: Cập nhật Supabase
        stage = "4. Cập nhật thông tin project trong Supabase";

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
            message: "Đã lưu code và cập nhật deployment.",
            deploymentId,
            versionNumber: version.versionNumber,
        });

    } catch (error) {
        logGoogleError("Save project", error, stage);

        return res.status(500).json({
            success: false,
            stage,
            message:
                error.message ||
                "Không thể lưu project.",
            googleError: error.response?.data?.error || null,
        });
    }
};

// ============================================
// DANH SÁCH PROJECT
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
        console.error("Get projects:", error);

        return res.status(500).json({
            success: false,
            message: "Không thể lấy danh sách project.",
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
            message: "Đã ngắt kết nối Google.",
        });

    } catch (error) {
        console.error("Disconnect Google:", error);

        return res.status(500).json({
            success: false,
            message: "Không thể ngắt kết nối Google.",
        });
    }
};

// ============================================
// LẤY NỘI DUNG PROJECT
// ============================================

exports.getProjectContent = async (req, res) => {
    let stage = "Bắt đầu lấy nội dung project";

    try {
        const userId = req.user.id;
        const projectId = req.params.id;

        stage = "Lấy project từ Supabase";

        const {
            data: project,
            error,
        } = await supabase
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

        stage = "Lấy Google OAuth client";

        const { oauth2Client } =
            await getUserGoogleClient(userId);

        stage = "Google projects.getContent - Đọc nội dung project";

        const files = await getGoogleProjectContent(
            oauth2Client,
            project.google_script_id
        );

        return res.json({
            success: true,
            files,
        });

    } catch (error) {
        logGoogleError("Get project content", error, stage);

        return res.status(500).json({
            success: false,
            stage,
            message:
                error.message ||
                "Không thể lấy nội dung project.",
        });
    }
};

// ============================================
// CHẠY GOOGLE APPS SCRIPT
// ============================================

exports.runProject = async (req, res) => {
    let stage = "Bắt đầu chạy script";

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

        // Lấy project
        stage = "Lấy project từ Supabase";

        const {
            data: project,
            error,
        } = await supabase
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
                message:
                    "Project chưa được triển khai API Executable. Hãy lưu project để tạo deployment.",
            });
        }

        // Lấy Google client
        stage = "Lấy Google OAuth client";

        const { oauth2Client } =
            await getUserGoogleClient(userId);

        // Chạy function
        stage = "Google scripts.run - Thực thi function";

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
        logGoogleError("Run Google Script", error, stage);

        const googleMessage =
            error.response?.data?.error?.message ||
            error.message;

        return res.status(500).json({
            success: false,
            stage,
            message:
                googleMessage ||
                "Không thể thực thi script.",
            googleError: error.response?.data?.error || null,
        });
    }
};
