const { google } = require("googleapis");

// ============================================
// GOOGLE OAUTH SCOPES
// ============================================

const SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",

    "https://www.googleapis.com/auth/script.projects",
    "https://www.googleapis.com/auth/script.deployments",
    "https://www.googleapis.com/auth/script.scriptapp",

    "https://www.googleapis.com/auth/drive",
];

const REQUIRED_SCOPES = [
    "https://www.googleapis.com/auth/script.projects",
    "https://www.googleapis.com/auth/script.deployments",
    "https://www.googleapis.com/auth/script.scriptapp",
];

// ============================================
// CHUẨN HÓA LỖI GOOGLE
// ============================================

function getErrorMessage(error) {
    if (typeof error === "string") {
        return error;
    }

    if (error?.response?.data?.error?.message) {
        return error.response.data.error.message;
    }

    if (error?.response?.data?.error) {
        return JSON.stringify(error.response.data.error);
    }

    if (error?.message) {
        return error.message;
    }

    try {
        return JSON.stringify(error);
    } catch {
        return "Google API xảy ra lỗi không xác định.";
    }
}

function createGoogleError(error, stage) {
    const googleResponse = error?.response?.data || null;

    const message =
        googleResponse?.error?.message ||
        getErrorMessage(error);

    const newError = new Error(message);

    newError.stage = stage;
    newError.status = error?.response?.status || null;
    newError.code = error?.code || null;

    newError.googleError =
        googleResponse?.error || googleResponse || null;

    newError.stack = error?.stack || newError.stack;

    return newError;
}

// ============================================
// OAUTH CLIENT
// ============================================

function createOAuthClient() {
    if (
        !process.env.GOOGLE_CLIENT_ID ||
        !process.env.GOOGLE_CLIENT_SECRET ||
        !process.env.GOOGLE_REDIRECT_URI
    ) {
        throw new Error(
            "Thiếu GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET hoặc GOOGLE_REDIRECT_URI."
        );
    }

    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
}

// ============================================
// TẠO OAUTH URL
// ============================================

function generateAuthUrl(state) {
    const oauth2Client = createOAuthClient();

    return oauth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        response_type: "code",
        include_granted_scopes: true,
        scope: SCOPES,
        state,
    });
}

// ============================================
// ĐỔI CODE LẤY TOKEN
// ============================================

async function exchangeCode(code) {
    const oauth2Client = createOAuthClient();

    try {
        const { tokens } = await oauth2Client.getToken(code);

        if (!tokens.refresh_token) {
            throw new Error(
                "Google không cấp refresh token mới. Hãy ngắt kết nối và cấp quyền lại."
            );
        }

        oauth2Client.setCredentials(tokens);

        const tokenInfo = await oauth2Client.getTokenInfo(
            tokens.access_token
        );

        const grantedScopes = tokenInfo.scopes || [];

        console.log("\n========== GOOGLE OAUTH SCOPES ==========");
        console.log("Email:", tokenInfo.email);
        console.log("Granted scopes:", grantedScopes);
        console.log("=========================================\n");

        const missingScopes = REQUIRED_SCOPES.filter(
            scope => !grantedScopes.includes(scope)
        );

        if (missingScopes.length > 0) {
            throw new Error(
                `Google chưa cấp đủ quyền: ${missingScopes.join(", ")}`
            );
        }

        return {
            oauth2Client,
            tokens,
        };

    } catch (error) {
        throw createGoogleError(
            error,
            "Google OAuth exchangeCode"
        );
    }
}

// ============================================
// LẤY THÔNG TIN GOOGLE USER
// ============================================

async function getGoogleUser(oauth2Client) {
    try {
        const oauth2 = google.oauth2({
            auth: oauth2Client,
            version: "v2",
        });

        const { data } = await oauth2.userinfo.get();

        return {
            id: data.id,
            email: data.email,
            name: data.name,
            picture: data.picture,
        };

    } catch (error) {
        throw createGoogleError(
            error,
            "Google OAuth userinfo"
        );
    }
}

// ============================================
// APPS SCRIPT CLIENT
// ============================================

function getAppsScript(oauth2Client) {
    return google.script({
        version: "v1",
        auth: oauth2Client,
    });
}

// ============================================
// TẠO GOOGLE APPS SCRIPT PROJECT
// ============================================

async function createGoogleProject(oauth2Client, title) {
    try {
        const script = getAppsScript(oauth2Client);

        const response = await script.projects.create({
            requestBody: {
                title,
            },
        });

        if (!response.data?.scriptId) {
            throw new Error(
                "Google không trả về scriptId khi tạo project."
            );
        }

        return response.data;

    } catch (error) {
        throw createGoogleError(
            error,
            "Google projects.create"
        );
    }
}

// ============================================
// LƯU SOURCE CODE VÀ MANIFEST
// ============================================

async function saveGoogleProject(
    oauth2Client,
    scriptId,
    code,
    additionalFiles = []
) {
    if (!scriptId) {
        throw new Error("Thiếu Google Apps Script Project ID.");
    }

    if (typeof code !== "string") {
        throw new Error("Source code không hợp lệ.");
    }

    try {
        const script = getAppsScript(oauth2Client);

        const files = [
            {
                name: "Code",
                type: "SERVER_JS",
                source: code,
            },
            {
                name: "appsscript",
                type: "JSON",
                source: JSON.stringify({
                    timeZone: "Asia/Ho_Chi_Minh",
                    dependencies: {},
                    exceptionLogging: "STACKDRIVER",
                    runtimeVersion: "V8",
                    executionApi: {
                        access: "MYSELF",
                    },
                }, null, 2),
            },
            ...additionalFiles,
        ];

        const response = await script.projects.updateContent({
            scriptId,
            requestBody: {
                files,
            },
        });

        return response.data;

    } catch (error) {
        throw createGoogleError(
            error,
            "Google projects.updateContent"
        );
    }
}

// ============================================
// LẤY NỘI DUNG PROJECT
// ============================================

async function getGoogleProjectContent(
    oauth2Client,
    scriptId
) {
    if (!scriptId) {
        throw new Error("Thiếu Google Apps Script Project ID.");
    }

    try {
        const script = getAppsScript(oauth2Client);

        const response = await script.projects.getContent({
            scriptId,
        });

        return response.data.files || [];

    } catch (error) {
        throw createGoogleError(
            error,
            "Google projects.getContent"
        );
    }
}

// ============================================
// TẠO VERSION
// ============================================

async function createGoogleVersion(
    oauth2Client,
    scriptId,
    description = "Automatic version"
) {
    if (!scriptId) {
        throw new Error("Thiếu Google Apps Script Project ID.");
    }

    try {
        const script = getAppsScript(oauth2Client);

        const response = await script.projects.versions.create({
            scriptId,
            requestBody: {
                description,
            },
        });

        if (!response.data?.versionNumber) {
            throw new Error(
                "Google không trả về versionNumber."
            );
        }

        return response.data;

    } catch (error) {
        throw createGoogleError(
            error,
            "Google projects.versions.create"
        );
    }
}

// ============================================
// TẠO API EXECUTABLE DEPLOYMENT
// ============================================

async function createGoogleDeployment(
    oauth2Client,
    scriptId,
    versionNumber,
    description = "Automatic deployment from Web IDE"
) {
    if (!oauth2Client) {
        throw new Error("Thiếu OAuth2 Client.");
    }

    if (!scriptId) {
        throw new Error("Thiếu Google Apps Script ID.");
    }

    if (!versionNumber || Number(versionNumber) <= 0) {
        throw new Error("Version number không hợp lệ.");
    }

    try {
        const script = getAppsScript(oauth2Client);

        // QUAN TRỌNG:
        // requestBody chính là DeploymentConfig.
        // Không bọc bên trong deploymentConfig.

        const response = await script.projects.deployments.create({
            scriptId,
            requestBody: {
                scriptId,
                versionNumber: Number(versionNumber),
                description,
            },
        });

        const deployment = response.data;

        if (!deployment?.deploymentId) {
            throw new Error(
                "Google không trả về Deployment ID."
            );
        }

        console.log("[CREATE DEPLOYMENT SUCCESS]", {
            scriptId,
            deploymentId: deployment.deploymentId,
            versionNumber,
            deploymentConfig: deployment.deploymentConfig,
            entryPoints: deployment.entryPoints,
        });

        return deployment;

    } catch (error) {
        console.error(
            "[CREATE DEPLOYMENT ERROR]",
            error.response?.data || error.message
        );

        throw createGoogleError(
            error,
            "Google projects.deployments.create"
        );
    }
}

// ============================================
// CẬP NHẬT DEPLOYMENT
// ============================================

async function updateGoogleDeployment(
    oauth2Client,
    scriptId,
    deploymentId,
    versionNumber,
    description = "Automatic deployment from Web IDE"
) {
    if (!oauth2Client) {
        throw new Error("Thiếu OAuth2 Client.");
    }

    if (!scriptId) {
        throw new Error("Thiếu Google Apps Script ID.");
    }

    if (!deploymentId) {
        throw new Error("Thiếu Deployment ID.");
    }

    if (!versionNumber || Number(versionNumber) <= 0) {
        throw new Error("Version number không hợp lệ.");
    }

    try {
        const script = getAppsScript(oauth2Client);

        // QUAN TRỌNG:
        // DeploymentConfig được truyền trực tiếp.

        const response = await script.projects.deployments.update({
            scriptId,
            deploymentId,
            requestBody: {
                scriptId,
                versionNumber: Number(versionNumber),
                description,
            },
        });

        console.log("[UPDATE DEPLOYMENT SUCCESS]", {
            scriptId,
            deploymentId,
            versionNumber,
            returnedDeploymentId: response.data?.deploymentId,
        });

        return response.data;

    } catch (error) {
        console.error(
            "[UPDATE DEPLOYMENT ERROR]",
            error.response?.data || error.message
        );

        throw createGoogleError(
            error,
            "Google projects.deployments.update"
        );
    }
}

// ============================================
// LẤY THÔNG TIN DEPLOYMENT
// ============================================

async function getGoogleDeployment(
    oauth2Client,
    scriptId,
    deploymentId
) {
    if (!oauth2Client) {
        throw new Error("Thiếu OAuth2 Client.");
    }

    if (!scriptId) {
        throw new Error("Thiếu Google Script ID.");
    }

    if (!deploymentId) {
        throw new Error("Thiếu Google Deployment ID.");
    }

    try {
        const script = getAppsScript(oauth2Client);

        const response = await script.projects.deployments.get({
            scriptId,
            deploymentId,
        });

        const deployment = response.data;

        console.log("[GOOGLE DEPLOYMENT CHECK]", {
            scriptId,
            deploymentId,
            returnedDeploymentId: deployment.deploymentId,
            versionNumber:
                deployment.deploymentConfig?.versionNumber,
            entryPoints: deployment.entryPoints,
        });

        if (!deployment.deploymentId) {
            throw new Error(
                "Google không trả về Deployment ID hợp lệ."
            );
        }

        return deployment;

    } catch (error) {
        console.error(
            "[GOOGLE DEPLOYMENT CHECK ERROR]",
            error.response?.data || error.message
        );

        throw createGoogleError(
            error,
            "Google projects.deployments.get"
        );
    }
}

// ============================================
// CHẠY GOOGLE APPS SCRIPT
// ============================================

async function runGoogleScript(
    oauth2Client,
    scriptId,
    functionName,
    parameters = []
) {
    if (!oauth2Client) {
        throw new Error("Thiếu OAuth2 Client.");
    }

    if (!scriptId) {
        throw new Error("Thiếu Google Apps Script Project ID.");
    }

    if (!functionName || typeof functionName !== "string") {
        throw new Error("Tên function không hợp lệ.");
    }

    if (!Array.isArray(parameters)) {
        throw new Error("Parameters phải là một mảng.");
    }

    try {
        const script = getAppsScript(oauth2Client);

        console.log("[GOOGLE RUN REQUEST]", {
            scriptId,
            functionName,
            parameters,
            devMode: false,
        });

        const response = await script.scripts.run({
            // scripts.run sử dụng SCRIPT ID của project.
            scriptId,

            requestBody: {
                function: functionName.trim(),
                parameters,
                devMode: false,
            },
        });

        console.log("[GOOGLE RUN RESPONSE]", {
            scriptId,
            functionName,
            response: response.data,
        });

        if (response.data?.error) {
            console.error(
                "[GOOGLE EXECUTION ERROR]",
                response.data.error
            );
        }

        return response.data;

    } catch (error) {
        console.error("[GOOGLE scripts.run ERROR]", {
            scriptId,
            functionName,
            status: error.response?.status,
            message: error.message,
            response: error.response?.data,
        });

        throw createGoogleError(
            error,
            "Google scripts.run"
        );
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    SCOPES,
    REQUIRED_SCOPES,
    createOAuthClient,
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
};