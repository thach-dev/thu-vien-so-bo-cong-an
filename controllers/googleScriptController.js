
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
    getGoogleDeployment,
    runGoogleScript,
} = require("../services/googleScriptService");

// ============================================
// 1. CẤU HÌNH FRONTEND OAUTH
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
        const origin = new URL(value).origin;

        return ALLOWED_FRONTEND_ORIGINS.includes(origin)
            ? origin
            : null;
    } catch {
        return null;
    }
}

function getFrontendOrigin(req) {
    const origin = req.get("origin") || req.get("referer");

    if (!origin) {
        return getAllowedFrontendOrigin(DEFAULT_FRONTEND_URL);
    }

    return getAllowedFrontendOrigin(origin);
}

function redirectToFrontend(res, frontendOrigin, status) {
    const origin =
        getAllowedFrontendOrigin(frontendOrigin) ||
        getAllowedFrontendOrigin(DEFAULT_FRONTEND_URL);

    if (!origin) {
        return res.status(500).send("Frontend URL không hợp lệ.");
    }

    const redirectUrl = new URL("/script-ide", origin);

    redirectUrl.searchParams.set("google", status);

    return res.redirect(redirectUrl.toString());
}

// ============================================
// 2. CHUẨN HÓA LỖI
// ============================================

function getErrorMessage(error) {
    const googleError = error?.response?.data?.error;

    if (typeof googleError === "string") {
        return googleError;
    }

    if (googleError?.message) {
        return googleError.message;
    }

    if (typeof error?.message === "string" && error.message) {
        return error.message;
    }

    if (typeof error === "string") {
        return error;
    }

    if (error && typeof error === "object") {
        try {
            return JSON.stringify(error);
        } catch {
            return "Đã xảy ra lỗi không xác định.";
        }
    }

    return "Đã xảy ra lỗi không xác định.";
}

function getGoogleErrorDetails(error) {
    const responseData = error?.response?.data;

    if (responseData) {
        return responseData;
    }

    if (error?.error) {
        return error.error;
    }

    if (error && typeof error === "object") {
        return {
            code: error.code || null,
            message: getErrorMessage(error),
            stack: error.stack || null,
        };
    }

    return null;
}

function logGoogleError(label, error, stage = "") {
    console.error("\n========== GOOGLE API ERROR ==========");
    console.error("Chức năng:", label);
    console.error("Giai đoạn:", stage || "Không xác định");
    console.error("Message:", getErrorMessage(error));
    console.error("HTTP Status:", error?.response?.status || null);

    console.error(
        "Google Response:",
        JSON.stringify(error?.response?.data || null, null, 2)
    );

    console.error("Error Code:", error?.code || null);
    console.error("Stack:", error?.stack || null);
    console.error("======================================\n");
}

// ============================================
// 3. LẤY GOOGLE CLIENT CỦA NGƯỜI DÙNG
// ============================================

async function getUserGoogleClient(userId) {
    console.log("[GOOGLE OAUTH] Tìm connection:", userId);

    const { data, error } = await supabase
        .from("google_connections")
        .select("*")
        .eq("user_id", userId)
        .single();

    if (error || !data) {
        console.error("[GOOGLE OAUTH] Supabase error:", error);

        throw new Error("Bạn chưa kết nối tài khoản Google.");
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

    const { token } = await oauth2Client.getAccessToken();

    if (!token) {
        throw new Error(
            "Không thể lấy Google access token. Hãy kết nối lại Google."
        );
    }

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
// 4. KẾT NỐI GOOGLE
// ============================================

exports.connectGoogle = async (req, res) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Vui lòng đăng nhập.",
            });
        }

        const frontendOrigin = getFrontendOrigin(req);

        if (!frontendOrigin) {
            return res.status(403).json({
                success: false,
                message: "Frontend không được phép kết nối Google.",
            });
        }

        const state = crypto.randomBytes(32).toString("hex");

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
        logGoogleError("Connect Google", error);

        return res.status(500).json({
            success: false,
            message: getErrorMessage(error),
        });
    }
};

// ============================================
// 5. GOOGLE CALLBACK
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
            getAllowedFrontendOrigin(stateData.frontend_origin) ||
            DEFAULT_FRONTEND_URL;

        const { error: deleteError } = await supabase
            .from("google_oauth_states")
            .delete()
            .eq("state", state);

        if (deleteError) throw deleteError;

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

        if (error) {
            console.error("[GOOGLE CALLBACK] OAuth denied:", error);

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

        const {
            oauth2Client,
            tokens,
        } = await exchangeCode(code);

        if (tokens.access_token) {
            const tokenInfo = await oauth2Client.getTokenInfo(
                tokens.access_token
            );

            console.log("\n========== NEW OAUTH SCOPES ==========");
            console.log("Google account:", tokenInfo.email);
            console.log("Granted scopes:", tokenInfo.scopes || []);
            console.log("======================================\n");
        }

        const googleUser = await getGoogleUser(oauth2Client);

        const {
            data: existing,
            error: existingError,
        } = await supabase
            .from("google_connections")
            .select("refresh_token")
            .eq("user_id", stateData.user_id)
            .maybeSingle();

        if (existingError) throw existingError;

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

        console.log("[GOOGLE CALLBACK] Connected:", googleUser.email);

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
// 6. KIỂM TRA TRẠNG THÁI GOOGLE
// ============================================

exports.getGoogleStatus = async (req, res) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Vui lòng đăng nhập.",
            });
        }

        const { data, error } = await supabase
            .from("google_connections")
            .select("google_email")
            .eq("user_id", userId)
            .maybeSingle();

        if (error) throw error;

        return res.json({
            success: true,
            connected: !!data,
            email: data?.google_email || null,
        });
    } catch (error) {
        logGoogleError("Get Google status", error);

        return res.status(500).json({
            success: false,
            message: getErrorMessage(error),
        });
    }
};

// ============================================
// 7. TẠO GOOGLE APPS SCRIPT PROJECT
// ============================================

exports.createProject = async (req, res) => {
    let stage = "Bắt đầu tạo project";

    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Vui lòng đăng nhập.",
            });
        }

        const title = String(
            req.body?.title || "Untitled Project"
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

        stage = "Tạo Google Apps Script project";

        const project = await createGoogleProject(
            oauth2Client,
            title
        );

        if (!project?.scriptId) {
            throw new Error("Google không trả về scriptId.");
        }

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

        stage = "Lưu source code ban đầu";

        await saveGoogleProject(
            oauth2Client,
            project.scriptId,
            initialCode
        );

        stage = "Tạo version đầu tiên";

        const version = await createGoogleVersion(
            oauth2Client,
            project.scriptId,
            "Initial version"
        );

        stage = "Tạo API Executable deployment";

        const deployment = await createGoogleDeployment(
            oauth2Client,
            project.scriptId,
            version.versionNumber
        );

        if (!deployment?.deploymentId) {
            throw new Error(
                "Google không trả về deploymentId."
            );
        }

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

        console.log("[CREATE PROJECT] Success:", {
            projectId: data.id,
            scriptId: project.scriptId,
            deploymentId: deployment.deploymentId,
            versionNumber: version.versionNumber,
        });

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
            message: getErrorMessage(error),
            googleError: getGoogleErrorDetails(error),
        });
    }
};

// ============================================
// 8. LƯU CODE VÀ CẬP NHẬT DEPLOYMENT
// ============================================

exports.saveProject = async (req, res) => {
    let stage = "Bắt đầu lưu project";

    try {
        const userId = req.user?.id;
        const projectId = req.params.id;
        const code = req.body?.code;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Vui lòng đăng nhập.",
            });
        }

        if (typeof code !== "string") {
            return res.status(400).json({
                success: false,
                message: "Code không hợp lệ.",
            });
        }

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
                detail: error?.message || null,
            });
        }

        stage = "Lấy Google OAuth client";

        const { oauth2Client } =
            await getUserGoogleClient(userId);

        stage = "1. Google projects.updateContent - Lưu source code";

        await saveGoogleProject(
            oauth2Client,
            project.google_script_id,
            code
        );

        stage = "2. Google projects.versions.create - Tạo version";

        const version = await createGoogleVersion(
            oauth2Client,
            project.google_script_id,
            `Saved at ${new Date().toISOString()}`
        );

        let deployment;

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
            deployment?.deploymentId ||
            project.deployment_id;

        if (!deploymentId) {
            throw new Error(
                "Không lấy được deploymentId sau khi lưu."
            );
        }

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

        console.log("[SAVE PROJECT] Success:", {
            projectId,
            scriptId: project.google_script_id,
            deploymentId,
            versionNumber: version.versionNumber,
        });

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
            message: getErrorMessage(error),
            googleError: getGoogleErrorDetails(error),
        });
    }
};

// ============================================
// 9. DANH SÁCH PROJECT
// ============================================

exports.getProjects = async (req, res) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Vui lòng đăng nhập.",
            });
        }

        const { data, error } = await supabase
            .from("script_projects")
            .select("*")
            .eq("user_id", userId)
            .order("created_at", {
                ascending: false,
            });

        if (error) throw error;

        return res.json({
            success: true,
            projects: data || [],
        });
    } catch (error) {
        logGoogleError("Get projects", error);

        return res.status(500).json({
            success: false,
            message: getErrorMessage(error),
        });
    }
};

// ============================================
// 10. NGẮT KẾT NỐI GOOGLE
// ============================================

exports.disconnectGoogle = async (req, res) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Vui lòng đăng nhập.",
            });
        }

        const { error } = await supabase
            .from("google_connections")
            .delete()
            .eq("user_id", userId);

        if (error) throw error;

        return res.json({
            success: true,
            message: "Đã ngắt kết nối Google.",
        });
    } catch (error) {
        logGoogleError("Disconnect Google", error);

        return res.status(500).json({
            success: false,
            message: getErrorMessage(error),
        });
    }
};

// ============================================
// 11. LẤY NỘI DUNG PROJECT
// ============================================

exports.getProjectContent = async (req, res) => {
    let stage = "Bắt đầu lấy nội dung project";

    try {
        const userId = req.user?.id;
        const projectId = req.params.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Vui lòng đăng nhập.",
            });
        }

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
                detail: error?.message || null,
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
            message: getErrorMessage(error),
            googleError: getGoogleErrorDetails(error),
        });
    }
};

// ============================================
// 12. CHẠY GOOGLE APPS SCRIPT
// ============================================

exports.runProject = async (req, res) => {
    const requestId = crypto.randomUUID();

    let stage = "Bắt đầu thực thi Google Apps Script";

    console.log("\n");
    console.log("================================================");
    console.log("          GOOGLE APPS SCRIPT RUN");
    console.log("================================================");
    console.log("Request ID:", requestId);
    console.log("Time:", new Date().toISOString());

    try {
        // ----------------------------------------
        // BƯỚC 1: KIỂM TRA REQUEST
        // ----------------------------------------

        stage = "1. Kiểm tra request";

        const projectId = req.params.id;

        const functionName =
            typeof req.body?.functionName === "string" &&
            req.body.functionName.trim()
                ? req.body.functionName.trim()
                : "myFunction";

        const parameters = Array.isArray(req.body?.parameters)
            ? req.body.parameters
            : [];

        const userId = req.user?.id;

        console.log("[1] REQUEST:", {
            requestId,
            projectId,
            userId,
            functionName,
            parametersCount: parameters.length,
        });

        if (!userId) {
            return res.status(401).json({
                success: false,
                requestId,
                stage,
                message: "Vui lòng đăng nhập.",
            });
        }

        // ----------------------------------------
        // BƯỚC 2: LẤY PROJECT TỪ SUPABASE
        // ----------------------------------------

        stage = "2. Lấy project từ Supabase";

        console.log("[2] Đang truy vấn script_projects...");

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
            console.error("[2] SUPABASE ERROR:", error);

            return res.status(404).json({
                success: false,
                requestId,
                stage,
                message: "Không tìm thấy project.",
                detail: error?.message || null,
            });
        }

        console.log("[2] SUPABASE PROJECT:", {
            id: project.id,
            title: project.title,
            google_script_id: project.google_script_id,
            deployment_id: project.deployment_id,
            version_number: project.version_number,
            updated_at: project.updated_at,
        });

        if (!project.google_script_id) {
            throw new Error(
                "Project chưa có google_script_id."
            );
        }

        if (!project.deployment_id) {
            throw new Error(
                "Project chưa có deployment_id. Hãy lưu project trước khi chạy."
            );
        }

        // ----------------------------------------
        // BƯỚC 3: LẤY GOOGLE OAUTH CLIENT
        // ----------------------------------------

        stage = "3. Lấy Google OAuth client";

        console.log("[3] Đang lấy Google OAuth client...");

        const {
            oauth2Client,
            scopes,
            connection,
        } = await getUserGoogleClient(userId);

        console.log("[3] GOOGLE ACCOUNT:", {
            email: connection?.google_email,
            googleUserId: connection?.google_user_id,
        });

        console.log("[3] GOOGLE SCOPES:", scopes);

        // ----------------------------------------
        // BƯỚC 4: KIỂM TRA DEPLOYMENT TRÊN GOOGLE
        // ----------------------------------------

        stage = "4. Google deployments.get - Kiểm tra deployment";

        console.log("[4] DEPLOYMENT REQUEST:", {
            scriptId: project.google_script_id,
            deploymentId: project.deployment_id,
        });

        const deployment = await getGoogleDeployment(
            oauth2Client,
            project.google_script_id,
            project.deployment_id
        );

        if (!deployment) {
            throw new Error(
                "Google không trả về thông tin deployment."
            );
        }

        console.log("[4] GOOGLE DEPLOYMENT RESPONSE:");
        console.log(JSON.stringify(deployment, null, 2));

        const deploymentConfig =
            deployment.deploymentConfig || {};

        console.log("[4] DEPLOYMENT CONFIG:", {
            scriptId: deploymentConfig.scriptId || null,
            versionNumber: deploymentConfig.versionNumber || null,
            description: deploymentConfig.description || null,
        });

        // ----------------------------------------
        // BƯỚC 5: KIỂM TRA ENTRY POINT
        // ----------------------------------------

        stage = "5. Kiểm tra EXECUTION_API";

        const entryPoints = Array.isArray(deployment.entryPoints)
            ? deployment.entryPoints
            : [];

        const entryPointTypes = entryPoints.map(
            entry => entry.entryPointType
        );

        const hasExecutionApi = entryPointTypes.includes(
            "EXECUTION_API"
        );

        console.log("[5] ENTRY POINT CHECK:", {
            hasExecutionApi,
            entryPointTypes,
            entryPoints,
        });

        // Không kết luận deployment sai nếu API không trả entryPoints.
        // Nếu Google trả entryPoints rõ ràng nhưng không có EXECUTION_API,
        // dừng lại để tránh chạy nhầm loại deployment.
        if (
            entryPoints.length > 0 &&
            !hasExecutionApi
        ) {
            return res.status(400).json({
                success: false,
                requestId,
                stage,
                message:
                    "Deployment hiện tại không có EXECUTION_API entry point.",
                deployment: {
                    deploymentId: project.deployment_id,
                    deploymentConfig,
                    entryPoints,
                },
            });
        }

        // ----------------------------------------
        // BƯỚC 6: SO SÁNH VERSION
        // ----------------------------------------

        stage = "6. Kiểm tra version deployment";

        const deployedVersion =
            deploymentConfig.versionNumber || null;

        const savedVersion =
            project.version_number || null;

        console.log("[6] VERSION CHECK:", {
            supabaseVersion: savedVersion,
            googleDeploymentVersion: deployedVersion,
            matched:
                deployedVersion !== null &&
                Number(savedVersion) === Number(deployedVersion),
        });

        if (
            deployedVersion !== null &&
            savedVersion !== null &&
            Number(savedVersion) !== Number(deployedVersion)
        ) {
            console.warn(
                "[6] WARNING: Supabase version khác Google deployment version."
            );
        }

        // ----------------------------------------
        // BƯỚC 7: GỌI GOOGLE SCRIPTS.RUN
        // ----------------------------------------

        stage = "7. Google scripts.run - Thực thi function";

        console.log("[7] RUN REQUEST:", {
            scriptId: project.google_script_id,
            deploymentId: project.deployment_id,
            functionName,
            parameters,
            devMode: false,
        });

        const result = await runGoogleScript(
            oauth2Client,
            project.deployment_id,
            functionName,
            parameters
        );

        console.log("[7] GOOGLE RAW RESULT:");
        console.log(JSON.stringify(result, null, 2));

        // ----------------------------------------
        // BƯỚC 8: KIỂM TRA LỖI EXECUTION
        // ----------------------------------------

        stage = "8. Kiểm tra kết quả thực thi";

        if (result?.error) {
            const executionError = result.error;

            const errorDetails = Array.isArray(
                executionError.details
            )
                ? executionError.details
                    .map(item => item.errorMessage)
                    .filter(Boolean)
                    .join("\n")
                : null;

            const message =
                errorDetails ||
                executionError.message ||
                "Google Apps Script thực thi thất bại.";

            console.error("[8] EXECUTION ERROR:", {
                requestId,
                message,
                error: executionError,
            });

            return res.status(400).json({
                success: false,
                requestId,
                stage,
                message,
                googleError: executionError,
            });
        }

        // ----------------------------------------
        // BƯỚC 9: LẤY KẾT QUẢ FUNCTION
        // ----------------------------------------

        stage = "9. Trả kết quả thực thi";

        const executionResponse =
            result?.response || {};

        const returnValue =
            executionResponse.result ?? null;

        console.log("[9] EXECUTION SUCCESS:", {
            requestId,
            functionName,
            returnValue,
            executionId: result?.executionId || null,
            deploymentId: project.deployment_id,
            versionNumber: deployedVersion,
        });

        console.log("================================================");
        console.log("          EXECUTION COMPLETED");
        console.log("================================================\n");

        return res.status(200).json({
            success: true,
            requestId,
            message: `Thực thi ${functionName} thành công.`,
            functionName,
            result: returnValue,
            executionId: result?.executionId || null,
            deploymentId: project.deployment_id,
            versionNumber: deployedVersion,
        });

    } catch (error) {
        console.error("\n");
        console.error("================================================");
        console.error("          GOOGLE SCRIPT EXECUTION FAILED");
        console.error("================================================");

        console.error("Request ID:", requestId);
        console.error("Stage:", stage);
        console.error("Message:", getErrorMessage(error));
        console.error("HTTP Status:", error?.response?.status || null);

        console.error(
            "Google Response:",
            JSON.stringify(
                error?.response?.data || null,
                null,
                2
            )
        );

        console.error("Error Code:", error?.code || null);
        console.error("Stack:", error?.stack || null);

        console.error("================================================\n");

        logGoogleError(
            "Run Google Apps Script",
            error,
            stage
        );

        return res.status(
            error?.response?.status || 500
        ).json({
            success: false,
            requestId,
            stage,
            message: getErrorMessage(error),
            googleError: getGoogleErrorDetails(error),
        });
    }
};
