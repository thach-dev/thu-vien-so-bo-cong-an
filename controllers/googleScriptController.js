
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
// 2. XỬ LÝ LỖI
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

// Kiểm tra lỗi deployment không tồn tại.
function isDeploymentNotFound(error) {
    const status =
        error?.response?.status ??
        error?.response?.data?.error?.code ??
        error?.code;

    const googleStatus =
        error?.response?.data?.error?.status;

    const message = getErrorMessage(error).toLowerCase();

    return (
        Number(status) === 404 ||
        status === "NOT_FOUND" ||
        googleStatus === "NOT_FOUND" ||
        message.includes("requested entity was not found") ||
        message.includes("deployment not found")
    );
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

        if (new Date(stateData.expires_at).getTime() < Date.now()) {
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

        stage = "Lưu source code và cấu hình API Executable";

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

        stage = "Kiểm tra deployment vừa tạo";

        const deploymentInfo = await getGoogleDeployment(
            oauth2Client,
            project.scriptId,
            deployment.deploymentId
        );

        const entryPoints = Array.isArray(
            deploymentInfo?.entryPoints
        )
            ? deploymentInfo.entryPoints
            : [];

        const hasExecutionApi = entryPoints.some(
            item => item.entryPointType === "EXECUTION_API"
        );

        console.log("[CREATE PROJECT] DEPLOYMENT CHECK:", {
            deploymentId: deployment.deploymentId,
            entryPoints,
            hasExecutionApi,
        });

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
            hasExecutionApi,
        });

        return res.status(201).json({
            success: true,
            project: data,
            deployment: {
                deploymentId: deployment.deploymentId,
                versionNumber: version.versionNumber,
                entryPoints,
                hasExecutionApi,
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

        // BƯỚC 1: LẤY PROJECT

        stage = "1. Lấy project từ Supabase";

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

        // BƯỚC 2: GOOGLE CLIENT

        stage = "2. Lấy Google OAuth client";

        const { oauth2Client } =
            await getUserGoogleClient(userId);

        // BƯỚC 3: LƯU CODE

        stage = "3. Google projects.updateContent - Lưu source code";

        await saveGoogleProject(
            oauth2Client,
            project.google_script_id,
            code
        );

        // BƯỚC 4: TẠO VERSION MỚI

        stage = "4. Google projects.versions.create - Tạo version";

        const version = await createGoogleVersion(
            oauth2Client,
            project.google_script_id,
            `Saved at ${new Date().toISOString()}`
        );

        if (!version?.versionNumber) {
            throw new Error(
                "Google không trả về versionNumber."
            );
        }

        // BƯỚC 5: KIỂM TRA DEPLOYMENT CŨ

        let deployment = null;
        let deploymentId = null;
        let createdNewDeployment = false;
        let oldEntryPoints = [];

        if (project.deployment_id) {
            stage = "5. Google deployments.get - Kiểm tra deployment cũ";

            let oldDeployment = null;
            let oldDeploymentNotFound = false;

            try {
                oldDeployment = await getGoogleDeployment(
                    oauth2Client,
                    project.google_script_id,
                    project.deployment_id
                );

                console.log(
                    "[SAVE] OLD DEPLOYMENT:",
                    JSON.stringify(oldDeployment, null, 2)
                );
            } catch (getError) {
                if (isDeploymentNotFound(getError)) {
                    oldDeploymentNotFound = true;

                    console.warn(
                        "[SAVE] Deployment cũ không tồn tại. Sẽ tạo deployment mới.",
                        {
                            oldDeploymentId: project.deployment_id,
                            message: getErrorMessage(getError),
                        }
                    );
                } else {
                    throw getError;
                }
            }

            if (oldDeployment && !oldDeploymentNotFound) {
                oldEntryPoints = Array.isArray(
                    oldDeployment.entryPoints
                )
                    ? oldDeployment.entryPoints
                    : [];

                const oldHasExecutionApi = oldEntryPoints.some(
                    item => item.entryPointType === "EXECUTION_API"
                );

                console.log("[SAVE] OLD DEPLOYMENT CHECK:", {
                    deploymentId: project.deployment_id,
                    entryPoints: oldEntryPoints,
                    oldHasExecutionApi,
                });

                if (oldHasExecutionApi) {
                    stage = "5. Google deployments.update - Cập nhật deployment";

                    deployment = await updateGoogleDeployment(
                        oauth2Client,
                        project.google_script_id,
                        project.deployment_id,
                        version.versionNumber
                    );

                    deploymentId =
                        deployment?.deploymentId ||
                        project.deployment_id;

                } else {
                    stage = "5. Google deployments.create - Tạo deployment mới";

                    deployment = await createGoogleDeployment(
                        oauth2Client,
                        project.google_script_id,
                        version.versionNumber
                    );

                    createdNewDeployment = true;
                    deploymentId = deployment?.deploymentId;
                }
            } else {
                // Deployment cũ bị xóa hoặc không còn tồn tại.

                stage = "5. Google deployments.create - Thay thế deployment không tồn tại";

                deployment = await createGoogleDeployment(
                    oauth2Client,
                    project.google_script_id,
                    version.versionNumber
                );

                createdNewDeployment = true;
                deploymentId = deployment?.deploymentId;
            }
        } else {
            // Project chưa có deployment_id.

            stage = "5. Google deployments.create - Tạo deployment đầu tiên";

            deployment = await createGoogleDeployment(
                oauth2Client,
                project.google_script_id,
                version.versionNumber
            );

            createdNewDeployment = true;
            deploymentId = deployment?.deploymentId;
        }

        if (!deploymentId) {
            throw new Error(
                "Google không trả về deploymentId sau khi tạo hoặc cập nhật deployment."
            );
        }

        console.log("[SAVE] DEPLOYMENT CREATED/UPDATED:", {
            deploymentId,
            createdNewDeployment,
            versionNumber: version.versionNumber,
        });

        // BƯỚC 6: ĐỌC LẠI DEPLOYMENT ĐỂ XÁC MINH

        stage = "6. Google deployments.get - Xác minh deployment";

        const verifiedDeployment = await getGoogleDeployment(
            oauth2Client,
            project.google_script_id,
            deploymentId
        );

        const verifiedEntryPoints = Array.isArray(
            verifiedDeployment?.entryPoints
        )
            ? verifiedDeployment.entryPoints
            : [];

        const hasExecutionApi = verifiedEntryPoints.some(
            item => item.entryPointType === "EXECUTION_API"
        );

        const verifiedVersion =
            verifiedDeployment?.deploymentConfig?.versionNumber || null;

        console.log("[SAVE] VERIFIED DEPLOYMENT:", JSON.stringify({
            scriptId: project.google_script_id,
            deploymentId,
            versionNumber: version.versionNumber,
            verifiedVersion,
            createdNewDeployment,
            entryPoints: verifiedEntryPoints,
            hasExecutionApi,
            deploymentConfig:
                verifiedDeployment?.deploymentConfig || null,
        }, null, 2));

        // BƯỚC 7: LƯU DEPLOYMENT MỚI VÀO SUPABASE

        stage = "7. Cập nhật deployment_id trong Supabase";

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

        console.log("[SAVE PROJECT] SUCCESS:", {
            projectId,
            scriptId: project.google_script_id,
            oldDeploymentId: project.deployment_id,
            newDeploymentId: deploymentId,
            versionNumber: version.versionNumber,
            createdNewDeployment,
            hasExecutionApi,
        });

        return res.json({
            success: true,
            message: hasExecutionApi
                ? "Đã lưu code và xác minh API Executable deployment."
                : "Đã lưu code và tạo deployment, nhưng Google chưa xác nhận EXECUTION_API.",
            projectId,
            scriptId: project.google_script_id,
            oldDeploymentId: project.deployment_id,
            deploymentId,
            versionNumber: version.versionNumber,
            createdNewDeployment,
            hasExecutionApi,
            entryPoints: verifiedEntryPoints,
            deploymentConfig:
                verifiedDeployment?.deploymentConfig || null,
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
        // BƯỚC 1: KIỂM TRA REQUEST

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

        // BƯỚC 2: LẤY PROJECT

        stage = "2. Lấy project từ Supabase";

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

        // BƯỚC 3: GOOGLE CLIENT

        stage = "3. Lấy Google OAuth client";

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

        // BƯỚC 4: KIỂM TRA DEPLOYMENT

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

        console.log(
            "[4] GOOGLE DEPLOYMENT RESPONSE:",
            JSON.stringify(deployment, null, 2)
        );

        const deploymentConfig =
            deployment.deploymentConfig || {};

        // BƯỚC 5: KIỂM TRA EXECUTION API

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

        console.log("[5] ENTRY POINT CHECK:", JSON.stringify({
            hasExecutionApi,
            entryPointTypes,
            entryPoints,
        }, null, 2));

        if (!hasExecutionApi) {
            return res.status(400).json({
                success: false,
                requestId,
                stage,
                message:
                    "Deployment chưa có EXECUTION_API entry point. Hãy lưu project để tạo hoặc cập nhật deployment.",
                deployment: {
                    deploymentId: project.deployment_id,
                    deploymentConfig,
                    entryPoints,
                },
            });
        }

        // BƯỚC 6: KIỂM TRA VERSION

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

        // BƯỚC 7: CHẠY GOOGLE SCRIPT

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
            project.google_script_id,
            functionName,
            parameters
        );

        console.log(
            "[7] GOOGLE RAW RESULT:",
            JSON.stringify(result, null, 2)
        );

        // BƯỚC 8: KIỂM TRA LỖI

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

            console.error(
                "[8] EXECUTION ERROR FULL:",
                JSON.stringify({
                    requestId,
                    message,
                    error: executionError,
                }, null, 2)
            );

            return res.status(400).json({
                success: false,
                requestId,
                stage,
                message,
                googleError: executionError,
            });
        }

        // BƯỚC 9: TRẢ KẾT QUẢ

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
            "Google Response FULL:",
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
